// Build per-size/orientation PDFs containing ONLY the formula footer stamp
// (no body content), so the rasterized snapshot is a pure measurement of the
// footer's pixel placement. Used by tests/visual/pdf-footer-snapshot.py.
//
// Usage: bun tests/visual/_buildFooterSizeMatrixPdfs.ts <outDir>
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import jsPDF from "jspdf";
import { stampFormulaFooter, type JsPdfLike } from "../../src/lib/pdfFooter";

const FORMULA = "Total Received = Cash + Adjustment Realised \u2212 Commission Paid";

const SIZES: Array<{ name: string; format: "a4" | "letter" | "legal"; orientation: "p" | "l" }> = [
  { name: "a4-portrait", format: "a4", orientation: "p" },
  { name: "a4-landscape", format: "a4", orientation: "l" },
  { name: "letter-portrait", format: "letter", orientation: "p" },
  { name: "letter-landscape", format: "letter", orientation: "l" },
  { name: "legal-portrait", format: "legal", orientation: "p" },
  { name: "legal-landscape", format: "legal", orientation: "l" },
];

function build(
  name: string,
  format: "a4" | "letter" | "legal",
  orientation: "p" | "l",
  file: string,
) {
  const pdf = new jsPDF({ orientation, unit: "pt", format });
  stampFormulaFooter(pdf as unknown as JsPdfLike, FORMULA);
  writeFileSync(file, Buffer.from(pdf.output("arraybuffer")));
}

const outDir = resolve(process.argv[2] ?? "tests/visual/__diffs__/pdf-footer-snapshot");
mkdirSync(outDir, { recursive: true });
for (const s of SIZES) build(s.name, s.format, s.orientation, resolve(outDir, `${s.name}.pdf`));
console.log(`wrote ${SIZES.length} footer-only PDFs to ${outDir}`);
