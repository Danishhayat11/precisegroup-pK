"""
Visual regression test for the exported BK-MA-00010 Payment Plan PDF.

Renders /documents/payment-plan?booking=BK-MA-00010 against the dev
server, generates the actual A4 PDF the user would print/export via
Playwright's page.pdf() (same Chromium engine that backs the in-app
print dialog), rasterizes every page with pdftoppm, and asserts:

  1. The Payment Plan schedule table has exactly EXPECTED_ROWS=10 real
     terms — no empty placeholders.
  2. The rendered PDF page count matches the baseline.
  3. Each rasterized page matches the committed baseline image within
     PIXEL_TOLERANCE.

Run:
    python3 tests/visual/bk-ma-00010-payment-plan-pdf.py
    UPDATE_BASELINE=1 python3 tests/visual/bk-ma-00010-payment-plan-pdf.py
"""

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageChops
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent
BASELINE_DIR = ROOT / "__baselines__" / "bk-ma-00010-payment-plan"
DIFF_DIR = ROOT / "__diffs__" / "bk-ma-00010-payment-plan"
PDF_PATH = DIFF_DIR / "current.pdf"
BASELINE_DIR.mkdir(parents=True, exist_ok=True)
DIFF_DIR.mkdir(parents=True, exist_ok=True)

URL = "http://localhost:8080"
DOC_PATH = "/documents/payment-plan?booking=BK-MA-00010"
EXPECTED_ROWS = 10
PIXEL_TOLERANCE = 0.01   # 1% pixels may differ (subpixel/AA)
CHANNEL_TOLERANCE = 12
RASTER_DPI = 110


async def render_pdf() -> dict:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 1800},
            device_scale_factor=1,
            reduced_motion="reduce",
        )
        page = await context.new_page()
        # Freeze "today" to keep dynamic headers/refs deterministic.
        await page.add_init_script(
            """
            (() => {
              const FIXED = new Date('2026-06-27T12:00:00Z').valueOf();
              const _Date = Date;
              class FrozenDate extends _Date {
                constructor(...args) { return args.length ? new _Date(...args) : new _Date(FIXED); }
                static now() { return FIXED; }
              }
              // @ts-ignore
              globalThis.Date = FrozenDate;
            })();
            """
        )

        await page.goto(URL + "/", wait_until="domcontentloaded")
        sk = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
        sj = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
        if sk and sj:
            await page.evaluate(
                f"window.localStorage.setItem({json.dumps(sk)}, {json.dumps(sj)})"
            )

        await page.goto(URL + DOC_PATH, wait_until="networkidle")
        # Schedule table renders once the booking + ledger queries resolve.
        await page.wait_for_selector(".doc-body table tbody tr", timeout=15000)
        await page.wait_for_load_state("networkidle")

        info = await page.evaluate(
            """() => {
              const tables = [...document.querySelectorAll('.doc-body table')];
              // Schedule table = the one with a Sr. / # first header and multiple money rows
              const schedule = tables.find(t => {
                const heads = [...t.querySelectorAll('thead th, th')].map(h => h.innerText.trim().toLowerCase());
                return heads.includes('sr.') || heads.includes('#') || heads.some(h => h.includes('particular'));
              }) || tables[0];
              if (!schedule) return { rowCount: 0, placeholders: 0 };
              const rows = [...schedule.querySelectorAll('tbody tr')];
              const placeholders = rows.filter(r => {
                const cells = [...r.querySelectorAll('td')].map(c => c.innerText.trim());
                if (!cells.length) return false;
                return cells.every(c => !c || c === '-' || c === '—' || c === 'PKR 0' || c === 'PKR 0/-' || c === '0');
              }).length;
              return { rowCount: rows.length, placeholders };
            }"""
        )

        await page.emulate_media(media="print")
        await page.pdf(
            path=str(PDF_PATH),
            format="A4",
            print_background=True,
            prefer_css_page_size=True,
            margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
        )
        await browser.close()
        return info


def rasterize(pdf: Path, out_dir: Path, prefix: str) -> list[Path]:
    for p in out_dir.glob(f"{prefix}-*.png"):
        p.unlink()
    subprocess.run(
        ["pdftoppm", "-png", "-r", str(RASTER_DPI), str(pdf), str(out_dir / prefix)],
        check=True,
    )
    return sorted(out_dir.glob(f"{prefix}-*.png"))


def diff_ratio(a_path: Path, b_path: Path, out_path: Path) -> float:
    a = Image.open(a_path).convert("RGB")
    b = Image.open(b_path).convert("RGB")
    if a.size != b.size:
        return 1.0
    diff = ImageChops.difference(a, b)
    if diff.getbbox() is None:
        return 0.0
    px = diff.load()
    w, h = diff.size
    bad = 0
    for y in range(h):
        for x in range(w):
            r, g, bl = px[x, y]
            if max(r, g, bl) > CHANNEL_TOLERANCE:
                bad += 1
    diff.save(out_path)
    return bad / (w * h)


async def main() -> int:
    info = await render_pdf()
    print(f"schedule rows: {info['rowCount']}  placeholders: {info['placeholders']}")

    failures: list[str] = []
    if info["rowCount"] != EXPECTED_ROWS:
        failures.append(
            f"expected {EXPECTED_ROWS} schedule rows in exported PDF, got {info['rowCount']}"
        )
    if info["placeholders"] != 0:
        failures.append(f"exported PDF contains {info['placeholders']} placeholder row(s)")

    current_pages = rasterize(PDF_PATH, DIFF_DIR, "current")
    print(f"PDF page count: {len(current_pages)}")

    if os.environ.get("UPDATE_BASELINE") or not any(BASELINE_DIR.glob("page-*.png")):
        for p in BASELINE_DIR.glob("page-*.png"):
            p.unlink()
        for i, page in enumerate(current_pages, 1):
            Image.open(page).save(BASELINE_DIR / f"page-{i:02d}.png")
        print(f"baseline written → {BASELINE_DIR} ({len(current_pages)} page(s))")
        if failures:
            for f in failures:
                print("FAIL:", f)
            return 1
        return 0

    baseline_pages = sorted(BASELINE_DIR.glob("page-*.png"))
    if len(baseline_pages) != len(current_pages):
        failures.append(
            f"page count drift: baseline {len(baseline_pages)} vs current {len(current_pages)}"
        )

    for i, (b, c) in enumerate(zip(baseline_pages, current_pages), 1):
        ratio = diff_ratio(b, c, DIFF_DIR / f"diff-{i:02d}.png")
        print(f"page {i}: pixel diff {ratio:.4%} (tolerance {PIXEL_TOLERANCE:.2%})")
        if ratio > PIXEL_TOLERANCE:
            failures.append(f"page {i} diff {ratio:.4%} exceeds tolerance {PIXEL_TOLERANCE:.2%}")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("OK: BK-MA-00010 Payment Plan PDF matches baseline with only real terms.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
