#!/usr/bin/env python3
"""Visual snapshot regression: detect pixel-level drift in the PDF footer text
placement across A4/Letter/Legal × portrait/landscape.

How it works
------------
1. `bun tests/visual/_buildFooterSizeMatrixPdfs.ts` builds 6 single-page PDFs
   that contain ONLY the footer stamp (no body). Body is intentionally empty so
   the snapshot measures the footer's *placement*, not unrelated content.
2. For each size, rasterize with pdftoppm at a fixed 150 DPI and crop the
   bottom 60pt footer band (converted to pixels at 150 DPI). Cropping isolates
   the footer; any shift in y/x of the "Total Received = …" string or the
   "Page 1/1" marker changes the cropped raster's SHA-256.
3. Compare the cropped raster against the committed baseline PNG under
   `tests/visual/__snapshots__/pdf-footer/`.  Mismatches write a `.actual.png`
   + a side-by-side `.diff.png` (when Pillow is available) so a human can
   inspect what moved.

Update baselines intentionally by deleting the old `.png` (or running with
`UPDATE_SNAPSHOTS=1`) and re-running the test; the first run writes the
current rasters as the new baseline.

This is invoked from CI as:  python tests/visual/pdf-footer-snapshot.py
"""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "tests" / "visual" / "__diffs__" / "pdf-footer-snapshot"
BASELINES = ROOT / "tests" / "visual" / "__snapshots__" / "pdf-footer"
DPI = 150  # 1pt = DPI/72 px → 150 DPI ≈ 2.083 px/pt; subpixel shifts collapse.
FOOTER_BAND_PT = 60  # bottom 60pt covers footer baseline + descender comfortably
SIZES = [
    "a4-portrait", "a4-landscape",
    "letter-portrait", "letter-landscape",
    "legal-portrait", "legal-landscape",
]

UPDATE = os.environ.get("UPDATE_SNAPSHOTS") == "1"


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def require(tool: str) -> None:
    if shutil.which(tool) is None:
        print(f"FAIL: required tool `{tool}` not found in PATH", file=sys.stderr)
        sys.exit(2)


def build_pdfs() -> None:
    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True, exist_ok=True)
    run(["bun", str(ROOT / "tests/visual/_buildFooterSizeMatrixPdfs.ts"), str(WORK)], cwd=ROOT)


def rasterize_footer(pdf: Path) -> Path:
    """Render page 1 at DPI, then crop the bottom FOOTER_BAND_PT band."""
    stem = pdf.with_suffix("").name
    out_prefix = WORK / f"{stem}-raster"
    run([
        "pdftoppm", "-png", "-r", str(DPI),
        "-f", "1", "-l", "1",
        str(pdf), str(out_prefix),
    ])
    # pdftoppm appends "-1" for single-page output
    raster = WORK / f"{stem}-raster-1.png"
    if not raster.exists():
        # some poppler builds use no suffix when single-page
        alt = WORK / f"{stem}-raster.png"
        raster = alt if alt.exists() else raster
    band_px = round(FOOTER_BAND_PT * DPI / 72)
    cropped = WORK / f"{stem}-footer.png"
    # Use Pillow if available for a deterministic crop; fall back to imagemagick.
    try:
        from PIL import Image  # type: ignore
        with Image.open(raster) as im:
            w, h = im.size
            box = (0, max(0, h - band_px), w, h)
            im.crop(box).save(cropped, format="PNG", optimize=True)
    except Exception:
        require("convert")
        # crop +0+(h-band): use imagemagick gravity south + extent
        run(["convert", str(raster),
             "-gravity", "south", "-crop", f"x{band_px}+0+0", "+repage",
             str(cropped)])
    return cropped


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def write_diff(baseline: Path, actual: Path, out: Path) -> None:
    try:
        from PIL import Image, ImageChops  # type: ignore
        b = Image.open(baseline).convert("RGB")
        a = Image.open(actual).convert("RGB")
        if b.size != a.size:
            # pad smaller to the larger so the diff is visible
            w = max(b.size[0], a.size[0]); h = max(b.size[1], a.size[1])
            bb = Image.new("RGB", (w, h), "white"); bb.paste(b, (0, 0))
            aa = Image.new("RGB", (w, h), "white"); aa.paste(a, (0, 0))
            b, a = bb, aa
        diff = ImageChops.difference(b, a)
        # stack baseline | actual | diff vertically
        w, h = b.size
        stacked = Image.new("RGB", (w, h * 3 + 4), "black")
        stacked.paste(b, (0, 0))
        stacked.paste(a, (0, h + 2))
        stacked.paste(diff, (0, h * 2 + 4))
        stacked.save(out)
    except Exception:
        pass


def main() -> int:
    require("pdftoppm")
    BASELINES.mkdir(parents=True, exist_ok=True)
    build_pdfs()

    failures: list[str] = []
    for name in SIZES:
        pdf = WORK / f"{name}.pdf"
        if not pdf.exists():
            failures.append(f"{name}: PDF was not generated at {pdf}")
            continue
        cropped = rasterize_footer(pdf)
        baseline = BASELINES / f"{name}.png"
        if UPDATE or not baseline.exists():
            shutil.copyfile(cropped, baseline)
            print(f"  baseline {'updated' if UPDATE else 'created'}: {baseline.relative_to(ROOT)}")
            continue
        if sha256(cropped) == sha256(baseline):
            print(f"  ok  {name}")
            continue
        actual = BASELINES / f"{name}.actual.png"
        diff = BASELINES / f"{name}.diff.png"
        shutil.copyfile(cropped, actual)
        write_diff(baseline, cropped, diff)
        failures.append(
            f"{name}: footer pixels drifted — see "
            f"{actual.relative_to(ROOT)} and {diff.relative_to(ROOT)}"
        )

    if failures:
        print("\nFAIL — PDF footer visual snapshot drift detected:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        print("\nIf the change is intentional, re-run with UPDATE_SNAPSHOTS=1 to refresh baselines.", file=sys.stderr)
        return 1
    print(f"\nOK — {len(SIZES)} footer snapshots match baselines.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
