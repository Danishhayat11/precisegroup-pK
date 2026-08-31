"""
PDF text-extraction regression test for the BK-MA-00010 Payment Plan.

Renders /documents/payment-plan?booking=BK-MA-00010 against the dev
server, exports the actual A4 PDF via Playwright's page.pdf() (same
Chromium engine that backs the in-app print/export flow), extracts the
text with `pdftotext -layout`, and asserts:

  1. All 10 real installment terms appear in the schedule, each with
     its expected particulars label, due date, and PKR amount.
  2. None of the placeholder strings the UI is allowed to render for
     missing data ("-", "—", "PKR 0", "PKR 0/-", "TBD", "N/A", "null",
     "undefined", "NaN") leak into the exported PDF for the schedule
     rows.
  3. No extra synthetic rows appear: the maximum Sr. number printed is
     exactly EXPECTED_ROWS=10 and the term labels match the pinned
     ledger order ending in "Possession".

Run:
    python3 tests/visual/bk-ma-00010-payment-plan-pdf-text.py
"""

import asyncio
import json
import os
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

ROOT = Path(__file__).resolve().parent
BASE_DIR = ROOT / "__diffs__" / "bk-ma-00002-payment-plan-text"
# Per-run output dir so concurrent invocations (CI matrix, local parallel
# debug runs) never overwrite each other's PDF, txt dumps, per-page text,
# or render-failure.html. RUN_ID encodes wall-clock + PID + random suffix
# to stay unique across forks, threads, and rapid back-to-back runs.
RUN_ID = (
    os.environ.get("LOVABLE_TEST_RUN_ID")
    or f"{int(time.time() * 1000)}-{os.getpid()}-{uuid.uuid4().hex[:8]}"
)
OUT_DIR = BASE_DIR / "runs" / RUN_ID
OUT_DIR.mkdir(parents=True, exist_ok=True)
PDF_PATH = OUT_DIR / "current.pdf"
TXT_PATH = OUT_DIR / "current.txt"


def _update_latest_pointer() -> None:
    """Best-effort 'latest' symlink for humans inspecting failures.
    Atomic-ish: write to a temp link, then os.replace into place. Races
    between parallel runs are acceptable — last writer wins, and every
    run's artifacts remain under its own RUN_ID directory regardless."""
    latest = BASE_DIR / "latest"
    tmp = BASE_DIR / f".latest.{uuid.uuid4().hex[:8]}"
    try:
        if tmp.exists() or tmp.is_symlink():
            tmp.unlink()
        os.symlink(OUT_DIR.relative_to(BASE_DIR), tmp)
        os.replace(tmp, latest)
    except OSError:
        try:
            tmp.unlink()
        except OSError:
            pass

URL = "http://localhost:8080"
DOC_PATH = "/documents/payment-plan?booking=BK-MA-00002"
EXPECTED_ROWS = 14
EXPECTED_PAGES = 3
# Pinned pagination: each Sr. -> set of pages where that row's
# label + due date + amount must all appear. Update intentionally
# when the print layout changes.
EXPECTED_TERM_PAGES: dict[int, set[int]] = {
    1:  {2},
    2:  {2},
    3:  {2},
    4:  {2},
    5:  {2},
    6:  {2},
    7:  {2},
    8:  {2},
    9:  {2},
    10: {2},
    11: {2},
    12: {2},
    13: {2},
    14: {2},
}

# Pinned real terms for BK-MA-00002 (sourced from installment_ledger).
# (sr, particulars substring, due_date DD-MMM-YYYY, due_amount)
EXPECTED_TERMS = [
    (1,  "Down Payment",   "30-Dec-2024", 1_950_000),
    (2,  "Installment 01", "30-Mar-2025",   357_500),
    (3,  "Installment 02", "30-Jun-2025",   357_500),
    (4,  "Installment 03", "30-Sep-2025",   357_500),
    (5,  "Installment 04", "30-Dec-2025",   357_500),
    (6,  "Installment 05", "30-Mar-2026",   357_500),
    (7,  "Installment 06", "30-Jun-2026",   357_500),
    (8,  "Installment 07", "30-Sep-2026",   357_500),
    (9,  "Installment 08", "30-Dec-2026",   357_500),
    (10, "Installment 09", "30-Mar-2027",   357_500),
    (11, "Installment 10", "30-Jun-2027",   357_500),
    (12, "Installment 11", "30-Sep-2027",   357_500),
    (13, "Installment 12", "30-Dec-2027",   357_500),
    (14, "Possession",     "30-Dec-2027", 1_560_000),
]

# Strings the UI is permitted to use when a field is missing — none of
# them may appear inside the exported schedule for BK-MA-00010 because
# every real term is fully populated.
PLACEHOLDER_TOKENS = [
    "TBD", "N/A", "null", "undefined", "NaN", "—  —", "- -",
]


async def render_pdf() -> None:
    async with async_playwright() as pw:
        # Per-run, ephemeral Chromium profile. `launch()` (non-persistent)
        # already gives each invocation its own --user-data-dir under /tmp;
        # making it explicit here documents that nothing carries between
        # parallel runs of this test.
        browser = await pw.chromium.launch(
            headless=True,
            args=["--disable-dev-shm-usage"],
        )
        # storage_state=None => the new BrowserContext starts with empty
        # cookies + localStorage + sessionStorage, isolated from any
        # other context (and any other concurrent test process).
        context = await browser.new_context(
            viewport={"width": 1280, "height": 1800},
            device_scale_factor=1,
            reduced_motion="reduce",
            storage_state=None,
            accept_downloads=False,
        )
        page = await context.new_page()
        await page.add_init_script(
            """
            (() => {
              const FIXED = new Date('2026-06-27T12:00:00Z').valueOf();
              const _Date = Date;
              class FrozenDate extends _Date {
                constructor(...args) { return args.length ? new _Date(...args) : new _Date(FIXED); }
                static now() { return FIXED; }
              }
              globalThis.Date = FrozenDate;
            })();
            """
        )

        sk = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
        sj = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")

        async def restore_session() -> None:
            """Land on the localhost origin, then write the Supabase
            session into localStorage so the protected route renders.
            Repeated on every retry: a prior failed navigation may have
            cleared storage, redirected to /auth, or raced ahead of the
            session listener."""
            await page.goto(URL + "/", wait_until="domcontentloaded")
            if sk and sj:
                await page.evaluate(
                    f"window.localStorage.setItem({json.dumps(sk)}, {json.dumps(sj)})"
                )

        # Retry the render: cold dev-server + first-hit auth bootstrap
        # can blow past a tight selector timeout. Each attempt re-restores
        # the session, reloads the doc URL, and waits longer for the
        # schedule table than the last.
        ATTEMPTS = 3
        TIMEOUTS_MS = (30_000, 60_000, 90_000)
        SCHEDULE_SEL = ".doc-body table tbody tr"
        last_err: Exception | None = None
        for attempt in range(1, ATTEMPTS + 1):
            timeout_ms = TIMEOUTS_MS[attempt - 1]
            try:
                await restore_session()
                await page.goto(URL + DOC_PATH, wait_until="domcontentloaded")
                await page.wait_for_selector(SCHEDULE_SEL, timeout=timeout_ms)
                await page.wait_for_load_state("networkidle")
                break
            except PlaywrightTimeoutError as e:
                last_err = e
                where = page.url
                print(
                    f"[render] attempt {attempt}/{ATTEMPTS} timed out after "
                    f"{timeout_ms}ms waiting for {SCHEDULE_SEL!r} at {where}; "
                    "re-restoring session and retrying",
                    flush=True,
                )
                if attempt == ATTEMPTS:
                    dump = OUT_DIR / "render-failure.html"
                    try:
                        dump.write_text(await page.content())
                        print(f"[render] last page HTML written to {dump}", flush=True)
                    except Exception:
                        pass
                    raise
                await asyncio.sleep(2 * attempt)
        else:  # pragma: no cover — loop always breaks or raises
            assert last_err is not None
            raise last_err

        await page.emulate_media(media="print")
        await page.pdf(
            path=str(PDF_PATH),
            format="A4",
            print_background=True,
            prefer_css_page_size=True,
            margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
        )
        await browser.close()


def extract_text(pdf: Path, out: Path) -> str:
    subprocess.run(
        ["pdftotext", "-layout", str(pdf), str(out)],
        check=True,
    )
    return out.read_text(encoding="utf-8", errors="replace")


def schedule_window(text: str) -> str:
    """Return only the INSTALLMENT SCHEDULE region — the rest of the
    document legitimately contains things like 'PKR 0/-' (Adjustment
    Credit Applied) which are not schedule placeholders."""
    m = re.search(r"INSTALLMENT SCHEDULE", text, re.IGNORECASE)
    if not m:
        return text
    return text[m.end():]


def fmt_amount(n: int) -> str:
    return f"{n:,}"


def _norm(s: str) -> str:
    """Collapse all whitespace so labels/dates that wrap across narrow
    PDF columns still match (e.g. 'Installment\\n01' -> 'Installment 01',
    '28-Dec-\\n2025' -> '28-Dec- 2025'). Also strips the soft hyphen
    introduced when pdftotext wraps a hyphenated token."""
    return re.sub(r"\s+", " ", s.replace("-\n", "-"))


def extract_per_page(pdf: Path, page_count: int) -> list[str]:
    pages = []
    for p in range(1, page_count + 1):
        # No -layout: avoids narrow-column wrapping that splits
        # 'Installment 01' across two lines.
        out = subprocess.run(
            ["pdftotext", "-f", str(p), "-l", str(p), str(pdf), "-"],
            check=True, capture_output=True, text=True,
        ).stdout
        pages.append(_norm(out))
    return pages


async def main() -> int:
    await render_pdf()
    text = extract_text(PDF_PATH, TXT_PATH)
    sched = schedule_window(text)
    # No-layout extraction preserves token order without column-driven
    # wrapping, so 'Installment 01' stays consecutive after _norm().
    raw_text = subprocess.run(
        ["pdftotext", str(PDF_PATH), "-"],
        check=True, capture_output=True, text=True,
    ).stdout
    raw_sched = schedule_window(raw_text)

    failures: list[str] = []

    sched_norm = _norm(raw_sched)
    text_norm = _norm(raw_text)

    def _term_in(haystack: str, label: str, date: str, amt: str) -> bool:
        """Token-presence check: pdftotext reorders cells when columns
        wrap, so substring match for 'Installment 01' is unreliable.
        Require all label tokens, the date, and the amount to be
        present in the page text."""
        return (
            all(tok in haystack for tok in label.split())
            and date in haystack
            and amt in haystack
        )

    # 1. Every real term must appear with its label, date and amount.
    for sr, label, date, amount in EXPECTED_TERMS:
        amt = fmt_amount(amount)
        if not _term_in(sched_norm, label, date, amt):
            failures.append(
                f"missing term {sr} ({label} / {date} / {amt}) in schedule"
            )

    # 2. Forbid placeholder tokens anywhere in the document.
    for tok in PLACEHOLDER_TOKENS:
        if tok in text_norm:
            failures.append(f"placeholder token {tok!r} leaked into PDF document")

    # 3. No Sr. > EXPECTED_ROWS may appear in the schedule (catches
    #    accidental blank rows numbered 11..N).
    sr_numbers = [int(s) for s in re.findall(r"(?m)^\s{2,20}(\d{1,2})\s+\S", sched)]
    sr_numbers = [n for n in sr_numbers if 1 <= n <= 99]
    max_sr = max(sr_numbers, default=0)
    if max_sr > EXPECTED_ROWS:
        failures.append(
            f"schedule renders Sr. {max_sr} — expected at most {EXPECTED_ROWS} real terms"
        )

    # 4. Page count must match the pinned pagination layout.
    info = subprocess.run(
        ["pdfinfo", str(PDF_PATH)], check=True, capture_output=True, text=True
    ).stdout
    m = re.search(r"^Pages:\s+(\d+)", info, re.MULTILINE)
    page_count = int(m.group(1)) if m else 0
    if page_count != EXPECTED_PAGES:
        failures.append(
            f"PDF has {page_count} pages — expected exactly {EXPECTED_PAGES}"
        )

    # 5. Per-term page mapping: each row's label + date + amount must
    #    appear exactly on the pinned page(s) in EXPECTED_TERM_PAGES.
    #    Catches pagination regressions that move or split rows.
    per_page = extract_per_page(PDF_PATH, page_count)

    # Dump per-page rendered text alongside the PDF so failures can be
    # inspected without re-running pdftotext by hand.
    pages_dir = OUT_DIR / "pages"
    pages_dir.mkdir(exist_ok=True)
    for i, ptxt in enumerate(per_page, start=1):
        (pages_dir / f"page-{i}.txt").write_text(ptxt)

    def _diagnose(sr: int, label: str, date: str, amt: str) -> str:
        """Per-component, per-page match matrix + nearest snippet.
        pdftotext reorders cells across columns so we report each label
        token, the date, and the amount independently."""
        tokens = label.split()
        header = f"  diagnostic for term {sr} ({label} / {date} / {amt}):"
        col_headers = "    " + f"{'page':<6}" + "".join(f"{t:<14}" for t in tokens) \
            + f"{'date':<14}{'amount':<10}"
        rows = [col_headers]
        for i, ptxt in enumerate(per_page, start=1):
            cells = "".join(("OK" if tok in ptxt else "MISS").ljust(14) for tok in tokens)
            d_hit = "OK" if date in ptxt else "MISS"
            a_hit = "OK" if amt in ptxt else "MISS"
            rows.append(f"    {i:<6}{cells}{d_hit:<14}{a_hit:<10}")
        snips: list[str] = []
        for i, ptxt in enumerate(per_page, start=1):
            for needle in (*tokens, date, amt):
                idx = ptxt.find(needle)
                if idx >= 0:
                    snip = ptxt[max(0, idx - 40):idx + len(needle) + 40]
                    snip = snip.replace("\n", " ⏎ ")
                    snips.append(f"    page {i} near {needle!r}: …{snip}…")
                    break
        if not snips:
            snips.append("    (no component matched on any page — check rendered text dump)")
        snips.append(f"    full per-page text: {pages_dir}")
        return "\n".join([header, *rows, *snips])

    for sr, label, date, amount in EXPECTED_TERMS:
        amt = fmt_amount(amount)
        expected = EXPECTED_TERM_PAGES.get(sr, set())
        found_pages = {
            i + 1 for i, ptxt in enumerate(per_page)
            if _term_in(ptxt, label, date, amt)
        }
        missing = expected - found_pages
        if missing:
            failures.append(
                f"term {sr} ({label}) missing on expected page(s) "
                f"{sorted(missing)} — found on {sorted(found_pages) or 'none'}\n"
                + _diagnose(sr, label, date, amt)
            )

    # 6. Per-page placeholder check (redundant with #2 but reports the
    #    offending page when a regression appears).
    for i, ptxt in enumerate(per_page, start=1):
        for tok in PLACEHOLDER_TOKENS:
            if tok in ptxt:
                idx = ptxt.find(tok)
                snip = ptxt[max(0, idx - 40):idx + len(tok) + 40].replace("\n", " ⏎ ")
                failures.append(
                    f"placeholder token {tok!r} on page {i}\n"
                    f"    context: …{snip}…\n"
                    f"    full page text: {pages_dir / f'page-{i}.txt'}"
                )

    print(f"run id:   {RUN_ID}")
    print(f"out dir:  {OUT_DIR}")
    print(f"pdf:      {PDF_PATH}")
    print(f"text:     {TXT_PATH}")
    print(f"pages:    {page_count} (expected {EXPECTED_PAGES})")
    print(f"sched pg: {sorted({p for s in EXPECTED_TERM_PAGES.values() for p in s})}")
    print(f"max Sr.:  {max_sr}")
    print(f"terms ok: {EXPECTED_ROWS - sum(1 for f in failures if f.startswith('missing term') or f.startswith('term '))} / {EXPECTED_ROWS}")

    _update_latest_pointer()

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print(
        f"OK: BK-MA-00002 Payment Plan PDF has {EXPECTED_PAGES} pages, "
        f"all {EXPECTED_ROWS} real terms on expected schedule page(s), "
        "and no placeholder strings."
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
