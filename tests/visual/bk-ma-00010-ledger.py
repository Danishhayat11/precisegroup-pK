"""
Visual regression test for the BK-MA-00010 booking ledger.

Renders /bookings/BK-MA-00010 against the running dev server, screenshots
the installment ledger table, and asserts:

  1. The table has exactly EXPECTED_ROWS=10 real terms.
  2. No row in the DOM is a placeholder (all of due, paid, particulars,
     date empty).
  3. The rendered pixels match the committed baseline at
     tests/visual/__baselines__/bk-ma-00010-ledger.png within
     PIXEL_TOLERANCE.

Run:
    python3 tests/visual/bk-ma-00010-ledger.py            # compare
    UPDATE_BASELINE=1 python3 tests/visual/bk-ma-00010-ledger.py   # refresh

The first run (no baseline file) writes the baseline and exits 0.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from PIL import Image, ImageChops
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent
BASELINE_DIR = ROOT / "__baselines__"
DIFF_DIR = ROOT / "__diffs__"
BASELINE = BASELINE_DIR / "bk-ma-00010-ledger.png"
CURRENT = DIFF_DIR / "bk-ma-00010-ledger.current.png"
DIFF = DIFF_DIR / "bk-ma-00010-ledger.diff.png"

BASELINE_DIR.mkdir(parents=True, exist_ok=True)
DIFF_DIR.mkdir(parents=True, exist_ok=True)

URL = "http://localhost:8080"
BOOKING_PATH = "/bookings/BK-MA-00010"
EXPECTED_ROWS = 10
PIXEL_TOLERANCE = 0.005  # 0.5% of pixels may differ (font hinting / antialias)
CHANNEL_TOLERANCE = 8    # per-channel delta below this is considered equal


async def capture() -> dict:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 1800},
            device_scale_factor=1,
            reduced_motion="reduce",
        )
        page = await context.new_page()

        await page.goto(URL + "/", wait_until="domcontentloaded")

        storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
        session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
        if storage_key and session_json:
            await page.evaluate(
                f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
            )

        await page.goto(URL + BOOKING_PATH, wait_until="networkidle")

        ledger = page.locator("table").first
        await ledger.wait_for(state="visible", timeout=15000)
        # Wait for at least one term row to render.
        await page.wait_for_function(
            "() => document.querySelector('table tbody tr') !== null"
        )

        info = await page.evaluate(
            """() => {
              const table = document.querySelector('table');
              const rows = [...table.querySelectorAll('tbody tr')];
              const placeholders = rows.filter(r => {
                const cells = [...r.querySelectorAll('td')].map(c => c.innerText.trim());
                return cells.every(c => !c || c === '-' || c === '—' || c === 'PKR 0' || c === '0');
              }).length;
              return { rowCount: rows.length, placeholders };
            }"""
        )

        await ledger.screenshot(path=str(CURRENT))
        await browser.close()
        return info


def compare_images(baseline: Path, current: Path) -> tuple[float, tuple[int, int]]:
    a = Image.open(baseline).convert("RGB")
    b = Image.open(current).convert("RGB")
    if a.size != b.size:
        return (1.0, a.size)
    diff = ImageChops.difference(a, b)
    bbox = diff.getbbox()
    if bbox is None:
        return (0.0, a.size)
    # Count pixels whose max channel delta exceeds tolerance.
    px = diff.load()
    w, h = diff.size
    bad = 0
    for y in range(h):
        for x in range(w):
            r, g, bl = px[x, y]
            if max(r, g, bl) > CHANNEL_TOLERANCE:
                bad += 1
    diff.save(DIFF)
    return (bad / (w * h), a.size)


async def main() -> int:
    info = await capture()
    print(f"ledger rows: {info['rowCount']}  placeholder rows: {info['placeholders']}")

    failures = []
    if info["rowCount"] != EXPECTED_ROWS:
        failures.append(
            f"expected {EXPECTED_ROWS} ledger rows for BK-MA-00010, got {info['rowCount']}"
        )
    if info["placeholders"] != 0:
        failures.append(f"found {info['placeholders']} empty placeholder row(s) in DOM")

    if os.environ.get("UPDATE_BASELINE") or not BASELINE.exists():
        Image.open(CURRENT).save(BASELINE)
        print(f"baseline written → {BASELINE}")
        if failures:
            for f in failures:
                print("FAIL:", f)
            return 1
        return 0

    ratio, size = compare_images(BASELINE, CURRENT)
    print(f"pixel diff ratio: {ratio:.4%} (tolerance {PIXEL_TOLERANCE:.2%}), size {size}")
    if ratio > PIXEL_TOLERANCE:
        failures.append(
            f"visual diff {ratio:.4%} exceeds tolerance {PIXEL_TOLERANCE:.2%} — see {DIFF}"
        )

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("OK: BK-MA-00010 ledger matches baseline with only real terms.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
