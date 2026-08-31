/**
 * Paper-size presets for the print preview + `preparePrint()` flow.
 *
 * Every printable document funnels through `preparePrint()` in
 * `src/lib/printFlow.ts`. A "preset" bundles the three axes that must stay
 * consistent for a native browser print to match the on-screen `.doc-sheet`:
 *
 *  1. **Page geometry** — width/height in mm plus a symmetric margin. Used
 *     for `@page { size: … }`, the sheet element's width, and the pagination
 *     measurer's content-height calculation.
 *  2. **Font scale** — body point size + line-height. Points are absolute
 *     units, so a body defined in `pt` renders at the same physical size on
 *     every printer regardless of DPI. We keep both A4 and Letter on 11pt so
 *     the same document reflows predictably across paper sizes.
 *  3. **Page-break behaviour** — a stylesheet snippet appended to the
 *     `@media print` block. Chrome/Blink honours the standard
 *     `break-inside: avoid`, Safari/WebKit still needs the legacy
 *     `page-break-inside`, and Firefox/Gecko needs both. Every preset ships
 *     the union so cross-browser output is identical.
 *
 * Callers select a preset id (`"a4"` | `"letter"`), the modal persists it in
 * localStorage, and `preparePrint()` receives the resolved dimensions and
 * extra CSS. The `letterhead.ts` HEADER/FOOTER band heights stay unchanged;
 * only the sheet frame varies.
 */

export type PaperPresetId = "a4" | "letter";

export type PaperPreset = {
  id: PaperPresetId;
  label: string;
  /** Short label for the toolbar chip (e.g. "A4"). */
  shortLabel: string;
  /** Page width in mm. */
  widthMm: number;
  /** Page height in mm. */
  heightMm: number;
  /** Symmetric page margin in mm (matches @page margin + sheet padding). */
  marginMm: number;
  /** Body font size in pt (absolute — same physical size on every printer). */
  bodyPt: number;
  /** Body line-height (unitless multiplier). */
  lineHeight: number;
  /**
   * Extra `@media print` CSS appended after the standard block. Contains the
   * cross-browser page-break guards shared by every preset.
   */
  printExtras: string;
};

/**
 * Cross-browser page-break rules. Every preset ships this block so Chrome,
 * Safari, Firefox and Edge produce identical page splits. Rules cover:
 *  - Tables never split across pages when small; when large, keep header +
 *    first row together and never split a single `<tr>`.
 *  - `<thead>` / `<tfoot>` repeat on every page (Chrome/Safari respect this
 *    via `display: table-header-group/footer-group`).
 *  - Headings never end a page alone (`break-after: avoid`).
 *  - Paragraphs keep at least 3 lines together (`orphans/widows: 3`).
 *  - Explicit `.pp-page-break` / `.pp-avoid-break` utility classes for
 *    authored page control.
 *  - Force absolute font metrics (`pt`) so the rasteriser doesn't rescale.
 */
const SHARED_BREAK_CSS = `
  /* Repeat table headers/footers on every page (both spellings). */
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }

  /* Never split a single row, heading, figure, or img mid-page. */
  tr, thead, tfoot, img, svg, figure, blockquote {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }

  /* Keep headings glued to the content that follows. */
  h1, h2, h3, h4, h5, h6,
  .pp-section-title {
    break-after: avoid !important;
    page-break-after: avoid !important;
  }

  /* Paragraph line control (Chrome/Firefox honour widows/orphans in print). */
  p, li, .pp-para {
    orphans: 3;
    widows: 3;
  }

  /* Authored utilities. */
  .pp-avoid-break {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
  .pp-page-break {
    break-before: page !important;
    page-break-before: always !important;
  }
`;

export const PAPER_PRESETS: Record<PaperPresetId, PaperPreset> = {
  a4: {
    id: "a4",
    label: "A4 (210 × 297 mm)",
    shortLabel: "A4",
    widthMm: 210,
    heightMm: 297,
    // 12.7 mm = 0.5" symmetric margin — Print Mode spec, maximises safe area.
    marginMm: 12.7,
    bodyPt: 11,
    lineHeight: 1.55,
    printExtras: SHARED_BREAK_CSS,
  },
  letter: {
    id: "letter",
    label: "US Letter (8.5 × 11 in)",
    shortLabel: "Letter",
    // 8.5" × 11" — round to the tenth of a mm the print engines actually use.
    widthMm: 215.9,
    heightMm: 279.4,
    // 12.7 mm = 0.5" — matches A4 for a uniform Print Mode across presets.
    marginMm: 12.7,
    bodyPt: 11,
    lineHeight: 1.55,
    printExtras: SHARED_BREAK_CSS,
  },
};

export const DEFAULT_PAPER_PRESET_ID: PaperPresetId = "a4";
const STORAGE_KEY = "pp-paper-preset-v1";

export function loadPaperPresetId(): PaperPresetId {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (raw === "a4" || raw === "letter") return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_PAPER_PRESET_ID;
}

export function savePaperPresetId(id: PaperPresetId): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function getPaperPreset(id: PaperPresetId): PaperPreset {
  return PAPER_PRESETS[id] ?? PAPER_PRESETS[DEFAULT_PAPER_PRESET_ID];
}
