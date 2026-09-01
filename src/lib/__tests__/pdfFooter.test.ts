import { describe, it, expect, vi } from "vitest";
import { stampFormulaFooter, type JsPdfLike } from "@/lib/pdfFooter";

/**
 * Regression: the Total Received formula footer note must be stamped onto
 * EVERY page of the exported Dashboard PDF — not only the first.
 */

function makeFakePdf(pageCount: number) {
  const calls: Array<{ page: number; text: string; x: number; y: number }> = [];
  let current = 1;
  const pdf: JsPdfLike & { _calls: typeof calls } = {
    _calls: calls,
    getNumberOfPages: () => pageCount,
    setFontSize: vi.fn(),
    setTextColor: vi.fn(),
    setPage: (n: number) => {
      current = n;
    },
    text: (s, x, y) => {
      calls.push({ page: current, text: s, x, y });
    },
    internal: { pageSize: { getWidth: () => 595, getHeight: () => 842 } },
  };
  return pdf;
}

const FORMULA = "Total Received = Cash + Adjustment Approved \u2212 Commission Paid";

describe("stampFormulaFooter — every-page coverage", () => {
  it("stamps the formula note on every page of a single-page PDF", () => {
    const pdf = makeFakePdf(1);
    stampFormulaFooter(pdf, FORMULA);
    const formulaCalls = pdf._calls.filter((c) => c.text === FORMULA);
    expect(formulaCalls).toHaveLength(1);
    expect(formulaCalls.map((c) => c.page)).toEqual([1]);
  });

  it("stamps the formula note on EVERY page of a 5-page PDF", () => {
    const pdf = makeFakePdf(5);
    stampFormulaFooter(pdf, FORMULA);
    const formulaCalls = pdf._calls.filter((c) => c.text === FORMULA);
    expect(formulaCalls).toHaveLength(5);
    expect(formulaCalls.map((c) => c.page)).toEqual([1, 2, 3, 4, 5]);
  });

  it("also stamps a Page i/N marker on every page", () => {
    const pdf = makeFakePdf(3);
    stampFormulaFooter(pdf, FORMULA);
    const pageMarks = pdf._calls.filter((c) => /^Page \d+\/\d+$/.test(c.text)).map((c) => c.text);
    expect(pageMarks).toEqual(["Page 1/3", "Page 2/3", "Page 3/3"]);
  });

  it("places the formula in the page footer (near the bottom edge)", () => {
    const pdf = makeFakePdf(2);
    stampFormulaFooter(pdf, FORMULA);
    for (const c of pdf._calls.filter((c) => c.text === FORMULA)) {
      // pageH=842, footer y = 842-8 = 834
      expect(c.y).toBe(834);
    }
  });

  it("works against a real jsPDF instance with multiple pages", async () => {
    const { default: jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
    pdf.addPage();
    pdf.addPage();
    pdf.addPage(); // now 4 pages

    // Spy on text() to observe what gets written, page by page.
    const calls: Array<{ page: number; text: string }> = [];
    let current = 1;
    const origSetPage = pdf.setPage.bind(pdf);
    pdf.setPage = ((n: number) => {
      current = n;
      return origSetPage(n);
    }) as typeof pdf.setPage;
    const origText = pdf.text.bind(pdf);
    pdf.text = ((s: string, x: number, y: number, opts?: unknown) => {
      if (typeof s === "string") calls.push({ page: current, text: s });
      return origText(s as string, x, y, opts as never);
    }) as typeof pdf.text;

    stampFormulaFooter(pdf as unknown as JsPdfLike, FORMULA);

    const formulaPages = calls.filter((c) => c.text === FORMULA).map((c) => c.page);
    expect(formulaPages).toEqual([1, 2, 3, 4]);
  });
});
