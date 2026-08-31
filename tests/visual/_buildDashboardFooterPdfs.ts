// Build two PDFs (1-page + multi-page) using the SAME jspdf build and
// `stampFormulaFooter` helper the Dashboard "Export PDF" button uses, and
// write them to disk so the Python sibling can inspect their geometry.
//
// Usage: bun tests/visual/_buildDashboardFooterPdfs.ts <outDir> <multiPageCount>
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import jsPDF from "jspdf";
import { stampFormulaFooter, type JsPdfLike } from "../../src/lib/pdfFooter";

const FORMULA = "Total Received = Cash + Adjustment Realised \u2212 Commission Paid";

function build(pageCount: number, file: string) {
  const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
  pdf.setFontSize(12);
  pdf.text("Page 1 body — formula footer test", 24, 40);
  for (let i = 2; i <= pageCount; i++) {
    pdf.addPage();
    pdf.text(`Page ${i} body — formula footer test`, 24, 40);
  }
  stampFormulaFooter(pdf as unknown as JsPdfLike, FORMULA);
  const buf = pdf.output("arraybuffer");
  writeFileSync(file, Buffer.from(buf));
}

const outDir = resolve(process.argv[2] ?? "tests/visual/__diffs__/dashboard-pdf-footer-geometry");
const multiPages = Number(process.argv[3] ?? 6);
mkdirSync(outDir, { recursive: true });
build(1, resolve(outDir, "single-page.pdf"));
build(multiPages, resolve(outDir, "multi-page.pdf"));
console.log(`wrote ${outDir}/single-page.pdf and ${outDir}/multi-page.pdf (${multiPages}p)`);
