import { ReactNode, useRef, useState } from "react";
import { Printer, Eye, X, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/lib/useCompany";
import { exportToPdf } from "@/lib/export";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

/**
 * Shared wrapper for printable documents (reports, allotment letters,
 * legal notices, payment plans). Renders a screen-friendly card while
 * exposing a `.print-doc` root that `@media print` styles in styles.css
 * pick up: Times New Roman 12pt, A4 with 15/20mm margins, page numbers
 * and company footer, no row-splitting.
 *
 * The toolbar exposes a "Preview" step that opens a modal rendering the
 * exact printed content at true A4 width so the user can confirm the
 * layout — page breaks, header, footer — before hitting Print.
 */
export interface PrintDocProps {
  title: string;
  subtitle?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  /** Optional right-aligned meta printed inline with the title (e.g. Date, Ref No). */
  meta?: ReactNode;
  /**
   * Orientation of the document.
   * @default "portrait"
   */
  orientation?: "portrait" | "landscape";
  /**
   * Margin preset for the document.
   * @default "normal" (15mm top/bottom, 20mm left/right)
   */
  marginPreset?: "normal" | "narrow" | "wide";
}

export function PrintDoc({
  title,
  subtitle,
  toolbar,
  meta,
  children,
  orientation = "portrait",
  marginPreset = "normal",
}: PrintDocProps) {
  const company = useCompany();
  const ref = useRef<HTMLDivElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handlePrint = () => {
    // Native print pipeline; @media print rules on `.print-doc` do the rest.
    // Close preview first so no dialog markup is in the DOM at print time.
    setPreviewOpen(false);
    // Defer so the dialog unmount lands before the print dialog opens.
    requestAnimationFrame(() => window.print());
  };

  const handleExport = async () => {
    if (!ref.current) return;
    setIsExporting(true);
    try {
      // Find the element that specifically holds the document content
      // and has the .print-doc class (which applies the A4 styling)
      const docElement = ref.current;

      // Temporarily add a class to ensure it's styled correctly for capture
      docElement.classList.add("pdf-capture");

      await exportToPdf(docElement, `${title.replace(/\s+/g, "_")}.pdf`);

      docElement.classList.remove("pdf-capture");
      toast.success("PDF exported successfully");
    } catch (error) {
      console.error("PDF export failed:", error);
      toast.error("Failed to export PDF");
    } finally {
      setIsExporting(false);
    }
  };

  // The document body — identical markup used both on-page and inside preview.
  const body = (
    <table
      className="print-frame"
      style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}
    >
      <thead className="print-running print-running-header">
        <tr>
          <td>
            <div
              className="print-running-inner"
              style={{
                fontSize: "9pt",
                borderBottom: "1px solid #eee",
                marginBottom: "8px",
                color: "#666",
              }}
            >
              <span>
                {company.name} · {title}
              </span>
            </div>
          </td>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="print-frame-body">
            <header
              className="doc-header"
              style={{ borderBottom: "2px solid #000", paddingBottom: "8px", marginBottom: "16px" }}
            >
              <div style={{ fontSize: "16pt", fontWeight: 700, letterSpacing: "0.04em" }}>
                {company.name}
              </div>
              {(company.address || company.city) && (
                <div style={{ fontSize: "10pt", fontWeight: 400, marginTop: "2px" }}>
                  {[company.address, company.city].filter(Boolean).join(", ")}
                </div>
              )}
              {(company.phone || company.email) && (
                <div style={{ fontSize: "10pt", fontWeight: 400 }}>
                  {[company.phone, company.email].filter(Boolean).join(" · ")}
                </div>
              )}
            </header>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: "10px",
              }}
            >
              <h1 className="doc-title" style={{ margin: 0, flex: 1, textAlign: "center" }}>
                {title}
              </h1>
            </div>
            {(subtitle || meta) && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "10pt",
                  marginBottom: "12px",
                }}
              >
                <div>{subtitle}</div>
                <div style={{ textAlign: "right" }}>{meta}</div>
              </div>
            )}

            <div>{children}</div>
          </td>
        </tr>
      </tbody>
      <tfoot className="print-running print-running-footer">
        <tr>
          <td>
            <div
              className="print-running-inner"
              style={{ marginTop: "24px", borderTop: "1px solid #999", paddingTop: "8px" }}
            >
              {company.name} · Computer Generated Report
            </div>
          </td>
        </tr>
      </tfoot>
    </table>
  );

  return (
    <>
      <div
        ref={ref}
        className={`print-doc ${orientation === "landscape" ? "print-landscape" : "print-portrait"} print-margin-${marginPreset}`}
      >
        {/* Screen-only toolbar */}
        <div className="no-print flex items-center justify-between gap-3 mb-4">
          <div className="text-sm text-muted-foreground">
            Preview — layout below matches the printed A4 output.
          </div>
          <div className="flex items-center gap-2">
            {toolbar}
            <Button variant="outline" onClick={() => setPreviewOpen(true)} size="sm">
              <Eye className="h-4 w-4 mr-1.5" />
              Preview
            </Button>
            <Button variant="outline" onClick={handleExport} size="sm" disabled={isExporting}>
              {isExporting ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-1.5" />
              )}
              Download PDF
            </Button>
            <Button onClick={handlePrint} size="sm">
              <Printer className="h-4 w-4 mr-1.5" />
              Print
            </Button>
          </div>
        </div>

        {body}
      </div>

      {/* Print-preview modal — renders the document at true A4 width so the
          user can confirm layout, page breaks and header/footer placement
          before sending it to the printer. */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent
          className="max-w-[900px] w-[95vw] max-h-[92vh] overflow-hidden p-0 gap-0"
          aria-describedby="print-preview-desc"
        >
          <DialogHeader className="px-4 py-3 border-b flex-row items-center justify-between space-y-0">
            <div>
              <DialogTitle className="text-base">Print preview</DialogTitle>
              <DialogDescription id="print-preview-desc" className="text-xs">
                A4 · Times New Roman · {marginPreset} margins. Row splitting is prevented on print.
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={handlePrint} size="sm">
                <Printer className="h-4 w-4 mr-1.5" />
                Print
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPreviewOpen(false)}
                aria-label="Close preview"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>

          <div className="print-preview-scroll overflow-auto bg-muted/40 p-6 flex justify-center">
            <div
              className={`print-preview-page bg-white shadow-2xl ring-1 ring-black/5 ${orientation === "landscape" ? "preview-landscape" : "preview-portrait"} preview-margin-${marginPreset}`}
            >
              {body}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
