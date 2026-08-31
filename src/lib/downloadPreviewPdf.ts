/**
 * downloadPreviewSheetsAsPdf — render the currently-mounted print preview
 * sheets into a downloadable PDF using the same CSS/DOM/renderer the on-screen
 * preview uses.
 *
 * The `<PrintPreviewModal>` renders one `.pp-sheet.doc-sheet` per output page,
 * scaled to `PAGE_W_MM × PAGE_H_MM` at 96dpi and styled by the shared PRINT_CSS.
 * By rasterising those exact nodes with html2canvas and dropping each canvas
 * into a jsPDF page sized to the same physical dimensions, the downloaded file
 * matches the preview 1:1 — no divergent "PDF path" that renders through a
 * different pipeline.
 *
 * Callers pass in the currently-selected paper geometry so the exported PDF
 * page size matches whatever the user picked in the preview toolbar (A4, A5,
 * Letter, portrait/landscape).
 */
import type jsPDF from "jspdf";

export type PdfProgressStage = "collecting" | "rendering" | "composing" | "saving";

export interface DownloadPreviewPdfOptions {
  /** Root element that contains the `.pp-sheet.doc-sheet` nodes (usually the preview region). */
  root: HTMLElement;
  /** Filename to save as, `.pdf` extension optional. */
  filename: string;
  /** Physical page width in millimetres (already accounts for orientation). */
  pageWidthMm: number;
  /** Physical page height in millimetres (already accounts for orientation). */
  pageHeightMm: number;
  /** Optional progress callback for toast/UI feedback. */
  onProgress?: (stage: PdfProgressStage, extra?: { page?: number; total?: number }) => void;
}

/** Return the ordered list of preview sheet nodes, or throw if none are mounted. */
export function collectPreviewSheets(root: HTMLElement): HTMLElement[] {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(".pp-sheet.doc-sheet"));
  if (nodes.length === 0) {
    throw new Error(
      "No preview pages are ready yet. Wait for the preview to finish rendering, then try again.",
    );
  }
  return nodes;
}

/**
 * Rasterise every `.pp-sheet.doc-sheet` under `root` and compose them into a
 * single PDF sized to the supplied page dimensions.
 */
export async function downloadPreviewSheetsAsPdf(
  options: DownloadPreviewPdfOptions,
): Promise<{ pageCount: number; filename: string }> {
  const { root, pageWidthMm, pageHeightMm, onProgress } = options;
  const filename = options.filename.toLowerCase().endsWith(".pdf")
    ? options.filename
    : `${options.filename}.pdf`;

  onProgress?.("collecting");
  const sheets = collectPreviewSheets(root);

  onProgress?.("rendering", { page: 0, total: sheets.length });
  const [{ default: html2canvas }, jsPDFModule] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const JsPDFCtor =
    (jsPDFModule as unknown as { jsPDF: typeof jsPDF }).jsPDF ??
    (jsPDFModule as unknown as { default: typeof jsPDF }).default;

  const isLandscape = pageWidthMm > pageHeightMm;
  const pdf = new JsPDFCtor({
    orientation: isLandscape ? "landscape" : "portrait",
    unit: "mm",
    format: [pageWidthMm, pageHeightMm],
    compress: true,
  });

  for (let i = 0; i < sheets.length; i++) {
    onProgress?.("rendering", { page: i + 1, total: sheets.length });
    const sheet = sheets[i];

    // Render at 2× device pixels for a sharp raster without ballooning the
    // file. Background is white so any transparent regions do not turn black
    // when JPEG-compressed inside the PDF.
    const canvas = await html2canvas(sheet, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      // Prevent html2canvas from clipping to the current viewport when a
      // sheet sits below the fold.
      windowWidth: Math.max(document.documentElement.clientWidth, sheet.offsetWidth),
      windowHeight: Math.max(document.documentElement.clientHeight, sheet.offsetHeight),
    });

    onProgress?.("composing", { page: i + 1, total: sheets.length });
    if (i > 0) pdf.addPage([pageWidthMm, pageHeightMm], isLandscape ? "landscape" : "portrait");
    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    // Fill the whole page — the sheet DOM itself already contains the print
    // margins baked into its layout, so we do NOT re-inset here or margins
    // would double.
    pdf.addImage(imgData, "JPEG", 0, 0, pageWidthMm, pageHeightMm, undefined, "FAST");
  }

  onProgress?.("saving", { page: sheets.length, total: sheets.length });
  pdf.save(filename);
  return { pageCount: sheets.length, filename };
}

export const PDF_PROGRESS_LABEL: Record<PdfProgressStage, string> = {
  collecting: "Collecting preview pages…",
  rendering: "Rendering pages…",
  composing: "Composing PDF…",
  saving: "Saving file…",
};
