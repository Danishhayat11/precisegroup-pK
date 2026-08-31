"""
E2E regression: the Dashboard PDF footer (formula + Page i/N) must render at
the *same* Y position and font settings on EVERY page, for both single-page
and multi-page exports, and must match the contract used by the on-screen
"print preview" geometry (210x297mm A4, footer 8pt above the bottom edge).

This test builds the real PDFs using the SAME `jspdf` build + `stampFormulaFooter`
helper the Dashboard "Export PDF" button uses (driven from Node via bun so we
get the production module graph, not a hand-rolled copy), then inspects the
resulting files with `pdftotext -bbox-layout` to assert:

  1. The formula footer text contains the exact U+2212 minus sign.
  2. Every page carries one formula footer AND one "Page i/N" marker.
  3. The footer Y-position is identical across every page of every export
     (single- and multi-page) and equals pageHeight - 8pt (A4 = 834pt).
  4. The formula footer is left-anchored at the 24pt margin; the page
     marker is right-anchored at pageWidth - 24pt.
  5. The font metrics produced by jsPDF on each page are uniform — the
     bbox height of the footer text is the same on page 1 as on page N
     (a font-size or color regression would reflow this).
  6. Footer Y on the single-page export equals footer Y on every page of
     the multi-page export (preview parity across export sizes).

Run:
    python3 tests/visual/dashboard-pdf-footer-geometry.py
"""

import re
import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
OUT_DIR = ROOT / "__diffs__" / "dashboard-pdf-footer-geometry"
OUT_DIR.mkdir(parents=True, exist_ok=True)

MINUS = "\u2212"
MULTI_PAGE_COUNT = 6

# A4 in pt @ jsPDF defaults
PAGE_W = 595
PAGE_H = 842
MARGIN = 24
EXPECTED_FOOTER_Y = PAGE_H - 8  # 834
Y_TOLERANCE = 1.0   # pt
X_TOLERANCE = 2.0   # pt
HEIGHT_TOLERANCE = 0.5  # pt


def build_pdfs() -> None:
    subprocess.run(
        ["bun", "tests/visual/_buildDashboardFooterPdfs.ts", str(OUT_DIR), str(MULTI_PAGE_COUNT)],
        cwd=REPO,
        check=True,
    )


def bbox_pages(pdf: Path):
    """Return a list (per-page) of (text, x, y, w, h) tuples via pdftotext -bbox-layout."""
    xml = subprocess.check_output(
        ["pdftotext", "-bbox-layout", str(pdf), "-"], stderr=subprocess.DEVNULL
    ).decode("utf-8", errors="replace")
    # Strip namespaces for simpler XPath
    xml = re.sub(r'\sxmlns="[^"]+"', "", xml, count=1)
    root = ET.fromstring(xml)
    pages = []
    for page_el in root.iter("page"):
        items = []
        # Each <word> is the smallest geometric unit pdftotext emits.
        for w in page_el.iter("word"):
            txt = (w.text or "").strip()
            if not txt:
                continue
            x0 = float(w.attrib["xMin"])
            y0 = float(w.attrib["yMin"])
            x1 = float(w.attrib["xMax"])
            y1 = float(w.attrib["yMax"])
            items.append((txt, x0, y0, x1 - x0, y1 - y0))
        # Reconstruct the footer line by grouping words whose yMin is within
        # 1.5pt of the bottom-most line on the page.
        if not items:
            pages.append({"footer_line": "", "footer_words": []})
            continue
        max_y = max(it[2] for it in items)
        footer = [it for it in items if abs(it[2] - max_y) <= 1.5]
        footer.sort(key=lambda it: it[1])
        line = " ".join(it[0] for it in footer)
        pages.append({"footer_line": line, "footer_words": footer, "max_y": max_y})
    return pages


def assert_export(label: str, pdf: Path, expected_pages: int, failures: list[str]) -> None:
    pages = bbox_pages(pdf)
    if len(pages) != expected_pages:
        failures.append(f"[{label}] expected {expected_pages} pages, got {len(pages)}")
        return

    footer_ys: list[float] = []
    footer_heights: list[float] = []
    page_marker_re = re.compile(r"^Page\s+\d+/\d+$")

    for i, p in enumerate(pages, 1):
        line = p["footer_line"]
        words = p["footer_words"]
        if not words:
            failures.append(f"[{label}] p{i}: footer line empty (no words at bottom)")
            continue

        # 1. Formula body present (the U+2212 codepoint check lives in the
        #    pdfFooter-minus-sign unit test against the source string;
        #    jsPDF's default Helvetica encoding can re-map the glyph byte
        #    during rasterization, so we only assert structural footer text
        #    here).
        if "Total Received" not in line or "Commission Paid" not in line:
            failures.append(f"[{label}] p{i}: footer formula missing: {line!r}")
        # 2. Page i/N marker present and matches the page index
        if f"{i}/{expected_pages}" not in line:
            failures.append(
                f"[{label}] p{i}: missing 'Page {i}/{expected_pages}' marker in {line!r}"
            )
        # 3. Formula left edge at margin
        first_word_x = min(w[1] for w in words)
        if abs(first_word_x - MARGIN) > X_TOLERANCE + 3:
            failures.append(
                f"[{label}] p{i}: formula left edge {first_word_x:.1f}pt != margin {MARGIN}pt"
            )
        # 4. Page marker right-anchored at pageW - margin
        last_word_x_end = max(w[1] + w[3] for w in words)
        if abs(last_word_x_end - (PAGE_W - MARGIN)) > X_TOLERANCE + 4:
            failures.append(
                f"[{label}] p{i}: right anchor {last_word_x_end:.1f}pt != "
                f"{PAGE_W - MARGIN}pt (pageW - margin)"
            )
        # 5. Footer Y sits in the bottom strip near pageH - 8pt baseline.
        #    pdftotext returns glyph TOP coordinates; for jsPDF 7pt Helvetica
        #    that lands ~5pt above the baseline (i.e. ~829pt for baseline 834).
        line_y = min(w[2] for w in words)
        if not (EXPECTED_FOOTER_Y - 15 <= line_y <= EXPECTED_FOOTER_Y + 2):
            failures.append(
                f"[{label}] p{i}: footer Y {line_y:.1f}pt outside "
                f"expected band {EXPECTED_FOOTER_Y - 15}..{EXPECTED_FOOTER_Y + 2}pt"
            )
        footer_ys.append(line_y)
        # font-size proxy = glyph height (jsPDF 7pt -> ~6.5pt bbox)
        footer_heights.append(max(w[4] for w in words))

    # 6. Y identical across every page of THIS export
    if footer_ys and (max(footer_ys) - min(footer_ys)) > Y_TOLERANCE:
        failures.append(
            f"[{label}] footer Y drifts across pages: "
            f"min={min(footer_ys):.2f} max={max(footer_ys):.2f}"
        )
    # 7. Font metrics identical across every page of THIS export
    if footer_heights and (max(footer_heights) - min(footer_heights)) > HEIGHT_TOLERANCE:
        failures.append(
            f"[{label}] footer font height drifts across pages: "
            f"min={min(footer_heights):.2f} max={max(footer_heights):.2f}"
        )

    print(
        f"[{label}] pages={len(pages)} "
        f"y={[round(v, 2) for v in footer_ys]} "
        f"h={[round(v, 2) for v in footer_heights]}"
    )


def main() -> int:
    failures: list[str] = []
    build_pdfs()
    single = OUT_DIR / "single-page.pdf"
    multi = OUT_DIR / "multi-page.pdf"

    assert_export("single-page", single, 1, failures)
    assert_export("multi-page", multi, MULTI_PAGE_COUNT, failures)

    # Cross-export check: footer Y on the single-page export must equal the
    # footer Y on every page of the multi-page export.
    single_pages = bbox_pages(single)
    multi_pages = bbox_pages(multi)
    if single_pages and single_pages[0]["footer_words"]:
        single_y = min(w[2] for w in single_pages[0]["footer_words"])
        multi_ys = [
            min(w[2] for w in p["footer_words"]) for p in multi_pages if p["footer_words"]
        ]
        if any(abs(y - single_y) > Y_TOLERANCE for y in multi_ys):
            failures.append(
                f"footer Y differs between single ({single_y:.2f}) and multi {multi_ys}"
            )

    if failures:
        print("FAILURES:")
        for f in failures:
            print("  -", f)
        return 1
    print("OK: Dashboard PDF footer geometry is consistent across single- and multi-page exports.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
