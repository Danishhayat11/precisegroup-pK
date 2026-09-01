import { describe, it, expect, vi } from "vitest";
import { stampFormulaFooter, type JsPdfLike } from "@/lib/pdfFooter";

/**
 * Regression: footer Y-position and font settings (size, grey color) must stay
 * consistent across page sizes (A4 / Letter / Legal / landscape) AND remain
 * identical on every page of multi-page exports.
 *
 * Contract from stampFormulaFooter:
 *   - y = pageH - 8                    (8pt above the bottom edge)
 *   - x (formula) = margin             (default 24)
 *   - x (Page i/N) = pageW - margin    (right-aligned)
 *   - setFontSize(fontSize)            (default 7)
 *   - setTextColor(110)                (mid-grey)
 *   - both calls happen ONCE total, before the per-page loop
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

// (label, width, height) — pt units, jsPDF's default for "pt"
const PAGE_SIZES: Array<[string, number, number]> = [
  ["A4 portrait", 595, 842],
  ["A4 landscape", 842, 595],
  ["Letter portrait", 612, 792],
  ["Letter landscape", 792, 612],
  ["Legal portrait", 612, 1008],
];

const PAGE_COUNTS = [1, 3, 8];

describe("stampFormulaFooter — consistent footer geometry & font", () => {
  for (const [label, w, h] of PAGE_SIZES) {
    for (const pageCount of PAGE_COUNTS) {
      it(`${label} × ${pageCount}p: y/x/font/color match contract on every page`, () => {
        const pdf = makeFakePdf({ pageCount, w, h });
        stampFormulaFooter(pdf, FORMULA);

        // font + color configured exactly once, with defaults
        expect(pdf._fontSizes).toEqual([7]);
        expect(pdf._textColors).toEqual([110]);

        const formulaCalls = pdf._calls.filter((c) => c.text === FORMULA);
        const pageMarkCalls = pdf._calls.filter((c) => /^Page \d+\/\d+$/.test(c.text));

        // one of each per page, in order
        expect(formulaCalls).toHaveLength(pageCount);
        expect(pageMarkCalls).toHaveLength(pageCount);
        expect(formulaCalls.map((c) => c.page)).toEqual(
          Array.from({ length: pageCount }, (_, i) => i + 1),
        );

        const expectedY = h - 8;
        for (const c of formulaCalls) {
          expect(c.y).toBe(expectedY);
          expect(c.x).toBe(24); // default margin (left aligned)
        }
        for (const c of pageMarkCalls) {
          expect(c.y).toBe(expectedY);
          expect(c.x).toBe(w - 24); // right-aligned anchor
        }

        // identical Y across every page in this run
        const ys = new Set(pdf._calls.map((c) => c.y));
        expect(ys.size).toBe(1);
      });
    }
  }

  it("honours custom margin + fontSize uniformly across pages", () => {
    const pdf = makeFakePdf({ pageCount: 4, w: 595, h: 842 });
    stampFormulaFooter(pdf, FORMULA, { margin: 36, fontSize: 9 });

    expect(pdf._fontSizes).toEqual([9]);
    expect(pdf._textColors).toEqual([110]);

    const formulas = pdf._calls.filter((c) => c.text === FORMULA);
    const marks = pdf._calls.filter((c) => /^Page \d+\/4$/.test(c.text));

    for (const c of formulas) {
      expect(c.x).toBe(36);
      expect(c.y).toBe(842 - 8);
    }
    for (const c of marks) {
      expect(c.x).toBe(595 - 36);
      expect(c.y).toBe(842 - 8);
    }
  });

  it("font + color are set ONCE, not per page (no flicker across pages)", () => {
    const pdf = makeFakePdf({ pageCount: 10, w: 612, h: 792 });
    const sfSpy = vi.spyOn(pdf, "setFontSize");
    const tcSpy = vi.spyOn(pdf, "setTextColor");
    stampFormulaFooter(pdf, FORMULA);
    expect(sfSpy).toHaveBeenCalledTimes(1);
    expect(tcSpy).toHaveBeenCalledTimes(1);
    expect(sfSpy).toHaveBeenCalledWith(7);
    expect(tcSpy).toHaveBeenCalledWith(110);
  });

  it("real jsPDF: footer Y is identical across a mixed multi-page A4 export", async () => {
    const { default: jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
    pdf.addPage();
    pdf.addPage();
    pdf.addPage(); // 4 pages
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
  });
});
