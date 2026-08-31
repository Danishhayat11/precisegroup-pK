/**
 * Stamp a formula-reference footer + "Page i/N" marker onto EVERY page of a
 * jsPDF document. Extracted from Dashboard PDF export so we can regression-test
 * that the formula note never goes missing on later pages.
 */
export type JsPdfLike = {
  getNumberOfPages: () => number;
  setFontSize: (n: number) => void;
  setTextColor: (n: number) => void;
  setPage: (n: number) => void;
  text: (
    s: string,
    x: number,
    y: number,
    opts?: { align?: "left" | "center" | "right" | "justify" },
  ) => unknown;
  internal: { pageSize: { getWidth: () => number; getHeight: () => number } };
};

export function stampFormulaFooter(
  pdf: JsPdfLike,
  formulaNote: string,
  opts: { margin?: number; fontSize?: number } = {},
) {
  const margin = opts.margin ?? 24;
  const fontSize = opts.fontSize ?? 7;
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const pageCount = pdf.getNumberOfPages();
  pdf.setFontSize(fontSize);
  pdf.setTextColor(110);
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i);
    pdf.text(formulaNote, margin, pageH - 8);
    pdf.text(`Page ${i}/${pageCount}`, pageW - margin, pageH - 8, { align: "right" });
  }
}
