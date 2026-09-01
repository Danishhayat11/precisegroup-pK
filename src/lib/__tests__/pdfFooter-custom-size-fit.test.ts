import { describe, it, expect, vi } from "vitest";
import { stampFormulaFooter, type JsPdfLike } from "@/lib/pdfFooter";

/**
 * Regression: even when a caller uses a CUSTOM page size and applies a
 * fit-to-page transform to the body content (scaling the image/canvas so it
 * always fills exactly one page), the formula footer MUST stay anchored at
 * `pageH - 8` with the same 7pt grey font on every page — across 1-, 2-, and
 * 7-page exports.
 *
 * Why this matters: the Dashboard PDF export and the print-preview flow can
 * both swap A4 for a custom format (e.g. tall ledger sheets) and shrink the
 * body to fit. The footer stamping pass runs AFTER any content scaling, so
 * it must read page geometry fresh per page and never inherit a scaled
 * transform. A regression where the footer drifts (different Y or font on
 * page 2 vs page 1) breaks every "print preview matches saved PDF" check.
 */

type Call = { page: number; text: string; x: number; y: number };

function makeFakePdf(opts: { pageCount: number; w: number; h: number }) {
  const calls: Call[] = [];
  const fontSizes: number[] = [];
  const textColors: number[] = [];
  let current = 1;
  const pdf: JsPdfLike & {
    _calls: Call[];
    _fontSizes: number[];
    _textColors: number[];
  } = {
    _calls: calls,
    _fontSizes: fontSizes,
    _textColors: textColors,
    getNumberOfPages: () => opts.pageCount,
    setFontSize: (n) => fontSizes.push(n),
    setTextColor: (n) => textColors.push(n),
    setPage: (n) => {
      current = n;
    },
    text: (s, x, y) => {
      calls.push({ page: current, text: s, x, y });
    },
    internal: { pageSize: { getWidth: () => opts.w, getHeight: () => opts.h } },
  };
  return pdf;
}

const FORMULA = "Total Received = Cash + Asset Realized \u2212 Commission Paid";

// (label, w_pt, h_pt) — non-standard page sizes a caller might pass to jsPDF.
// Includes tall/narrow, wide/short, square, and a tiny custom thumbnail size
// to make sure the helper still computes `pageH - 8` correctly at every scale.
const CUSTOM_SIZES: Array<[string, number, number]> = [
  ["tabloid portrait", 792, 1224],
  ["tabloid landscape", 1224, 792],
  ["A3 portrait", 842, 1191],
  ["A5 portrait", 420, 595],
  ["receipt (narrow tall)", 226, 1200],
  ["square 800", 800, 800],
  ["thumbnail 300x420", 300, 420],
];

const PAGE_COUNTS = [1, 2, 7];

/**
 * Simulate a "fit-to-page" body render before stamping: the caller computes
 * a scale factor so an image of `srcW x srcH` fills the printable area
 * (`pageW - 2*margin`, `pageH - 2*margin - footerBand`) and stamps the image
 * once per page. The footer stamping pass runs AFTER and must be invariant
 * to that scale.
 */
function simulateFitToPageThenStamp(
  pdf: JsPdfLike,
  pageW: number,
  pageH: number,
  pageCount: number,
  margin = 24,
) {
  const srcW = 2480; // arbitrary "html2canvas at 2x" raster width
  const srcH = 3508;
  const printableW = pageW - margin * 2;
  const printableH = pageH - margin * 2 - 18; // footer band reserved
  const scale = Math.min(printableW / srcW, printableH / srcH);
  // The caller would now `pdf.addImage(...)` `pageCount` times at this scale.
  // We don't model addImage on the fake — what matters is that stampFooter()
  // doesn't pick up `scale` from anywhere. Call the real helper.
  stampFormulaFooter(pdf, FORMULA, { margin });
  return scale;
}

describe("stampFormulaFooter — custom page sizes + fit-to-page", () => {
  for (const [label, w, h] of CUSTOM_SIZES) {
    for (const pageCount of PAGE_COUNTS) {
      it(`${label} × ${pageCount}p: footer Y, X, font, color stay uniform`, () => {
        const pdf = makeFakePdf({ pageCount, w, h });
        const scale = simulateFitToPageThenStamp(pdf, w, h, pageCount);
        expect(scale).toBeGreaterThan(0); // sanity

        // font + color set exactly once, with helper defaults
        expect(pdf._fontSizes).toEqual([7]);
        expect(pdf._textColors).toEqual([110]);

        const formulaCalls = pdf._calls.filter((c) => c.text === FORMULA);
        const markerCalls = pdf._calls.filter((c) => /^Page \d+\/\d+$/.test(c.text));

        // one formula + one Page i/N per page
        expect(formulaCalls).toHaveLength(pageCount);
        expect(markerCalls).toHaveLength(pageCount);
        expect(formulaCalls.map((c) => c.page)).toEqual(
          Array.from({ length: pageCount }, (_, i) => i + 1),
        );
        expect(markerCalls.map((c) => c.text)).toEqual(
          Array.from({ length: pageCount }, (_, i) => `Page ${i + 1}/${pageCount}`),
        );

        // Y is `pageH - 8` on EVERY page of this export
        const expectedY = h - 8;
        const ys = new Set(pdf._calls.map((c) => c.y));
        expect(ys.size).toBe(1);
        expect([...ys][0]).toBe(expectedY);

        // X anchors honour margin + custom page width
        for (const c of formulaCalls) expect(c.x).toBe(24);
        for (const c of markerCalls) expect(c.x).toBe(w - 24);
      });
    }
  }

  it("custom margin + fontSize stay uniform across 7 pages on a custom size", () => {
    const w = 226,
      h = 1200; // narrow receipt
    const pdf = makeFakePdf({ pageCount: 7, w, h });
    stampFormulaFooter(pdf, FORMULA, { margin: 12, fontSize: 8 });

    expect(pdf._fontSizes).toEqual([8]);
    expect(pdf._textColors).toEqual([110]);

    const formulaCalls = pdf._calls.filter((c) => c.text === FORMULA);
    const markerCalls = pdf._calls.filter((c) => /^Page \d+\/7$/.test(c.text));
    expect(formulaCalls).toHaveLength(7);
    expect(markerCalls).toHaveLength(7);

    const expectedY = h - 8;
    for (const c of formulaCalls) {
      expect(c.x).toBe(12);
      expect(c.y).toBe(expectedY);
    }
    for (const c of markerCalls) {
      expect(c.x).toBe(w - 12);
      expect(c.y).toBe(expectedY);
    }
  });

  it("font + color are set ONCE per export — fit-to-page rerenders never re-stamp them", () => {
    const pdf = makeFakePdf({ pageCount: 7, w: 600, h: 900 });
    const sf = vi.spyOn(pdf, "setFontSize");
    const tc = vi.spyOn(pdf, "setTextColor");
    simulateFitToPageThenStamp(pdf, 600, 900, 7);
    expect(sf).toHaveBeenCalledTimes(1);
    expect(tc).toHaveBeenCalledTimes(1);
    expect(sf).toHaveBeenCalledWith(7);
    expect(tc).toHaveBeenCalledWith(110);
  });

  it("real jsPDF on a custom 600×1000pt format: footer Y identical across 7 pages", async () => {
    const { default: jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ orientation: "p", unit: "pt", format: [600, 1000] });
    for (let i = 0; i < 6; i++) pdf.addPage(); // 7 pages total
    const pageH = pdf.internal.pageSize.getHeight();

    const seen: Array<{ page: number; text: string; y: number }> = [];
    let current = 1;
    const origSetPage = pdf.setPage.bind(pdf);
    pdf.setPage = ((n: number) => {
      current = n;
      return origSetPage(n);
    }) as typeof pdf.setPage;
    const origText = pdf.text.bind(pdf);
    pdf.text = ((s: string, x: number, y: number, opts?: unknown) => {
      if (typeof s === "string") seen.push({ page: current, text: s, y });
      return origText(s as string, x, y, opts as never);
    }) as typeof pdf.text;

    stampFormulaFooter(pdf as unknown as JsPdfLike, FORMULA);

    const ys = new Set(seen.map((s) => s.y));
    expect(ys.size).toBe(1);
    expect([...ys][0]).toBe(pageH - 8);
    expect(seen.filter((s) => s.text === FORMULA).map((s) => s.page)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });
});
