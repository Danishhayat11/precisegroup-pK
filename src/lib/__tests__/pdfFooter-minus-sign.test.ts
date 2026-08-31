import { describe, it, expect } from "vitest";
import { stampFormulaFooter, type JsPdfLike } from "@/lib/pdfFooter";

/**
 * Regression: the Total Received formula footer MUST use the Unicode U+2212
 * MINUS SIGN (not ASCII hyphen-minus U+002D) on EVERY page so the printed
 * report matches the on-screen fmtPKR formatting.
 */

const MINUS = "\u2212";
const HYPHEN = "-";
const FORMULA = `Total Received = Cash + Adjustment Realised ${MINUS} Commission Paid`;

function makeFakePdf(pageCount: number) {
  const calls: Array<{ page: number; text: string }> = [];
  let current = 1;
  const pdf: JsPdfLike & { _calls: typeof calls } = {
    _calls: calls,
    getNumberOfPages: () => pageCount,
    setFontSize: () => {},
    setTextColor: () => {},
    setPage: (n) => {
      current = n;
    },
    text: (s) => {
      calls.push({ page: current, text: s });
    },
    internal: { pageSize: { getWidth: () => 595, getHeight: () => 842 } },
  };
  return pdf;
}

describe("stampFormulaFooter — U+2212 minus sign on every page", () => {
  it("formula constant uses U+2212, not ASCII hyphen", () => {
    expect(FORMULA.includes(MINUS)).toBe(true);
    expect(FORMULA.codePointAt(FORMULA.indexOf(MINUS))).toBe(0x2212);
    // No ASCII hyphen surrounded by spaces (i.e., used as a minus operator)
    expect(/ - /.test(FORMULA)).toBe(false);
  });

  for (const pageCount of [1, 2, 7]) {
    it(`stamps the U+2212 footer on every one of ${pageCount} page(s)`, () => {
      const pdf = makeFakePdf(pageCount);
      stampFormulaFooter(pdf, FORMULA);
      const footers = pdf._calls.filter((c) => c.text === FORMULA);
      expect(footers).toHaveLength(pageCount);
      expect(footers.map((c) => c.page)).toEqual(
        Array.from({ length: pageCount }, (_, i) => i + 1),
      );
      for (const f of footers) {
        // exact U+2212 codepoint preserved on every stamped page
        const idx = f.text.indexOf(MINUS);
        expect(idx).toBeGreaterThan(-1);
        expect(f.text.codePointAt(idx)).toBe(0x2212);
        // and NOT silently downgraded to ASCII hyphen as a minus operator
        expect(/ - /.test(f.text)).toBe(false);
        expect(f.text).not.toContain(`Realised ${HYPHEN} Commission`);
      }
    });
  }

  it("real jsPDF: every page's stamped footer carries U+2212", async () => {
    const { default: jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
    pdf.addPage();
    pdf.addPage();
    pdf.addPage(); // 4 pages total

    const seen: Array<{ page: number; text: string }> = [];
    let current = 1;
    const origSetPage = pdf.setPage.bind(pdf);
    pdf.setPage = ((n: number) => {
      current = n;
      return origSetPage(n);
    }) as typeof pdf.setPage;
    const origText = pdf.text.bind(pdf);
    pdf.text = ((s: string, x: number, y: number, opts?: unknown) => {
      if (typeof s === "string") seen.push({ page: current, text: s });
      return origText(s as string, x, y, opts as never);
    }) as typeof pdf.text;

    stampFormulaFooter(pdf as unknown as JsPdfLike, FORMULA);

    const footerPages = seen.filter((c) => c.text === FORMULA).map((c) => c.page);
    expect(footerPages).toEqual([1, 2, 3, 4]);
    for (const c of seen.filter((c) => c.text === FORMULA)) {
      const idx = c.text.indexOf(MINUS);
      expect(c.text.codePointAt(idx)).toBe(0x2212);
    }
  });
});
