import { useParams, Link, useSearchParams } from "@/lib/router-compat";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Printer, ChevronLeft, Download } from "lucide-react";
import { toast } from "sonner";
import { fmtDate, fmtPKR } from "@/lib/format";
import { amountInWordsPK } from "@/lib/amountInWords";
import { useState, useEffect, useRef, useLayoutEffect } from "react";
import PrintPreviewModal from "@/components/PrintPreviewModal";
import { DialogSkeleton } from "@/components/ui/skeletons";
import AutoLogoEditor from "@/components/AutoLogoEditor";
import {
  LetterheadHeader,
  PrintFrame,
  PRINT_CSS,
  getDocStyle,
  PAGE_MARGIN_MM,
  HEADER_H_MM,
  FOOTER_H_MM,
} from "@/lib/letterhead";
import {
  LOGO_PICKER_ITEMS,
  loadSelectedLogoId,
  loadRawSelectedLogoId,
  saveSelectedLogoId,
  AUTO_LOGO_ID,
  resolveLogoOption,
  isKnownLogoId,
} from "@/lib/logos";
import { cleanLedger } from "@/lib/ledger";
import { preparePrint } from "@/lib/printFlow";
import { logAllocation } from "@/lib/paymentPlanAlloc";

const titles: Record<string, string> = {
  receipt: "Payment Receipt",
  "payment-plan": "Installment Payment Plan",
  allotment: "Allotment Letter",
  possession: "Possession Letter",
  "prov-possession": "Provisional Possession Letter",
  "deposit-summary": "Deposit / Payment Account Statement",
  "demand-notice": "Demand Notice",
  "transfer-form": "Booking Transfer Form",
  "sale-agreement": "Agreement to Sell",
  "legal-notice": "10. Legal Notice (Show Cause)",
  "final-legal-notice": "11. Final Legal Notice",
  "final-cancel-warning": "12. Final Legal Notice + Cancellation Warning",
  "cancellation-notice": "13. Final Cancellation Notice",
};

import { useAdminDocumentGate } from "@/lib/useAdminDocumentGate";
import { usePIIGuardedQuery, AccessDenied } from "@/lib/access";

export default function DocumentView() {
  const _adminGate = useAdminDocumentGate("document-generation");
  const { type = "receipt" } = useParams();
  const [params, setParams] = useSearchParams();
  const bookingId = params.get("booking") ?? "";
  const receiptParam = params.get("receipt") ?? "";
  const prev1Param = params.get("prev1") ?? "";
  const prev2Param = params.get("prev2") ?? "";
  const [selected, setSelected] = useState(bookingId);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<null | "print" | "saveviaprint" | "export">(
    null,
  );

  const PAGE_SIZES: Record<string, { w: number; h: number; label: string }> = {
    A4: { w: 210, h: 297, label: "A4 (210 × 297 mm)" },
    Letter: { w: 215.9, h: 279.4, label: "Letter (8.5 × 11 in)" },
    Legal: { w: 215.9, h: 355.6, label: "Legal (8.5 × 14 in)" },
  };
  const MARGIN_PRESETS: Record<string, number | "custom"> = {
    Narrow: 10,
    Normal: PAGE_MARGIN_MM,
    Wide: 25,
    Custom: "custom",
  };
  const [pageSize, setPageSize] = useState<keyof typeof PAGE_SIZES>(
    () => (localStorage.getItem("dv.pageSize") as any) || "A4",
  );
  const [marginPreset, setMarginPreset] = useState<keyof typeof MARGIN_PRESETS>(
    () => (localStorage.getItem("dv.marginPreset") as any) || "Normal",
  );
  const [customMargin, setCustomMargin] = useState<number>(() =>
    Number(localStorage.getItem("dv.customMargin") || PAGE_MARGIN_MM),
  );
  const [fitToPage, setFitToPage] = useState<boolean>(() => {
    const stored = localStorage.getItem("dv.fitToPage");
    if (stored === "1") return true;
    if (stored === "0") return false;
    // Default ON for dense multi-section documents so they land on a single A4 page.
    const singlePagePreferred = new Set([
      "payment-plan",
      "deposit-summary",
      "receipt",
      "demand-notice",
      "legal-notice",
      "final-legal-notice",
      "final-cancel-warning",
      "cancellation-notice",
    ]);
    return singlePagePreferred.has(type);
  });
  const [dpi, setDpi] = useState<number>(() => Number(localStorage.getItem("dv.dpi") || 200));
  const [quality, setQuality] = useState<"png" | "high" | "balanced" | "small">(
    () => (localStorage.getItem("dv.quality") as any) || "high",
  );
  useEffect(() => {
    localStorage.setItem("dv.fitToPage", fitToPage ? "1" : "0");
  }, [fitToPage]);
  useEffect(() => {
    localStorage.setItem("dv.pageSize", pageSize);
  }, [pageSize]);
  useEffect(() => {
    localStorage.setItem("dv.marginPreset", marginPreset);
  }, [marginPreset]);
  useEffect(() => {
    localStorage.setItem("dv.customMargin", String(customMargin));
  }, [customMargin]);
  useEffect(() => {
    localStorage.setItem("dv.dpi", String(dpi));
  }, [dpi]);
  useEffect(() => {
    localStorage.setItem("dv.quality", quality);
  }, [quality]);
  const [logoId, setLogoId] = useState<string>(() => loadSelectedLogoId(type));
  // Raw saved id (may reference a removed asset) — used to surface a clear
  // fallback indicator instead of silently swapping to Auto.
  const [rawLogoId, setRawLogoId] = useState<string | null>(() => loadRawSelectedLogoId(type));
  // Re-load when the document type changes so each type keeps its own choice.
  useEffect(() => {
    setLogoId(loadSelectedLogoId(type));
    setRawLogoId(loadRawSelectedLogoId(type));
  }, [type]);
  useEffect(() => {
    saveSelectedLogoId(logoId, type);
    setRawLogoId(logoId);
  }, [logoId, type]);
  const missingLogoId = rawLogoId && !isKnownLogoId(rawLogoId) ? rawLogoId : null;
  const [autoEditorOpen, setAutoEditorOpen] = useState(false);

  const pageDims = PAGE_SIZES[pageSize];
  const activeMargin =
    marginPreset === "Custom"
      ? Math.max(0, Math.min(40, customMargin))
      : (MARGIN_PRESETS[marginPreset] as number);

  // Fit-to-page: measure natural body height and compute uniform scale to fit within page bounds.
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [fitScale, setFitScale] = useState(1);
  useLayoutEffect(() => {
    if (!fitToPage || !sheetRef.current || !bodyRef.current) {
      setFitScale(1);
      return;
    }
    const measure = () => {
      const bodyH = bodyRef.current!.scrollHeight; // natural px (before scaling)
      const slotH = bodyRef.current!.getBoundingClientRect().height;
      const overflow = bodyH - slotH;
      if (overflow <= 1) {
        setFitScale(1);
        return;
      }
      // Aggressive floor (0.3) so dense documents always fit onto one page —
      // legibility of a shrunk single page beats spilling onto page 2.
      // 0.995 leaves a hair of safety so browser rounding never pushes a stray
      // pixel onto the next page.
      const s = Math.max(0.3, Math.min(1, (slotH / bodyH) * 0.995));
      setFitScale(s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(sheetRef.current);
    ro.observe(bodyRef.current);
    return () => ro.disconnect();
  }, [fitToPage, pageSize, marginPreset, customMargin, selected, type]);

  const bookingsQ = usePIIGuardedQuery({
    queryKey: ["doc-bookings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("booking_id,client_name,unit_id,project_name")
        .order("client_name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const bookings = bookingsQ.data ?? [];

  const bookingQ = usePIIGuardedQuery({
    queryKey: ["doc-booking", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("booking_id", selected)
        .maybeSingle();
      if (error) throw error;
      if (!data) return data;
      // Apply the editable per-project display-name override (Settings → Projects).
      // We look up projects by the booking's stored project_name; when a
      // non-empty `display_name` is set there, it replaces `project_name` for
      // every downstream doc renderer (letterhead, footer, notice bodies,
      // payment plan, receipts). Theme detection stays stable because it keys
      // off booking_id's project code (BK-MH-*, BK-NH-*, …), not the label.
      if (data.project_name) {
        const { data: proj } = await supabase
          .from("projects")
          .select("display_name")
          .eq("project_name", data.project_name)
          .maybeSingle();
        const dn = proj?.display_name?.trim();
        if (dn) return { ...data, project_name: dn };
      }
      return data;
    },
  });
  const booking = bookingQ.data;

  const ledgerQ = usePIIGuardedQuery({
    queryKey: ["doc-ledger", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("installment_ledger")
        .select("*")
        .eq("booking_id", selected)
        .order("term_no");
      if (error) throw error;
      return cleanLedger(data);
    },
  });
  const ledger = ledgerQ.data ?? [];

  const paymentsQ = usePIIGuardedQuery({
    queryKey: ["doc-payments", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("booking_id", selected)
        .order("payment_date");
      if (error) throw error;
      return data ?? [];
    },
  });
  const payments = paymentsQ.data ?? [];

  const adjustmentsQ = usePIIGuardedQuery({
    queryKey: ["doc-adjustments", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("adjustments")
        .select("*")
        .eq("booking_id", selected);
      if (error) throw error;
      return data ?? [];
    },
  });
  const adjustments = adjustmentsQ.data ?? [];

  const dataLoading =
    !!selected &&
    (bookingQ.isLoading || ledgerQ.isLoading || paymentsQ.isLoading || adjustmentsQ.isLoading);
  const dataFetching =
    !!selected &&
    (bookingQ.isFetching || ledgerQ.isFetching || paymentsQ.isFetching || adjustmentsQ.isFetching);
  const dataError =
    bookingQ.error || ledgerQ.error || paymentsQ.error || adjustmentsQ.error || bookingsQ.error;
  const dataErrorMsg = dataError ? (dataError as any)?.message || String(dataError) : "";
  const refetchAll = () => {
    bookingsQ.refetch();
    bookingQ.refetch();
    ledgerQ.refetch();
    paymentsQ.refetch();
    adjustmentsQ.refetch();
  };
  const bookingMissing = !!selected && !bookingQ.isLoading && !bookingQ.error && !booking;

  useEffect(() => {
    if (selected !== bookingId)
      setParams(
        selected ? { booking: selected, ...(receiptParam ? { receipt: receiptParam } : {}) } : {},
      );
  }, [selected]);

  const title = titles[type] ?? "Document";

  const [printing, setPrinting] = useState(false);
  async function triggerDirectPrint(asPdf: boolean) {
    if (!booking) {
      toast.error("Select a booking first", {
        description: "Pick a client/booking from the dropdown to load the document.",
      });
      return;
    }
    if (dataLoading) {
      toast.error("Still loading booking data", {
        description: "Please wait until ledger and payments finish loading, then try again.",
      });
      return;
    }
    const sheet = document.querySelector<HTMLElement>(".doc-sheet");
    if (!sheet) {
      toast.error("Preview not ready", {
        description: "The document sheet hasn't rendered yet. Wait a moment and retry.",
      });
      return;
    }
    setPrinting(true);
    const safeTitle = `${title.replace(/[^\w\- ]+/g, "")} - ${booking?.booking_id ?? ""}`.trim();
    try {
      const extra = `
        .doc-sheet { padding: ${activeMargin}mm !important; }
        ${
          fitToPage
            ? `
          @page { size: ${pageDims.w}mm ${pageDims.h}mm; margin: 0; }
          html, body { height: ${pageDims.h}mm !important; overflow: hidden !important; }
          .doc-sheet { height: ${pageDims.h}mm !important; max-height: ${pageDims.h}mm !important; min-height: ${pageDims.h}mm !important; overflow: hidden !important; page-break-after: avoid !important; page-break-inside: avoid !important; break-after: avoid !important; break-inside: avoid !important; }
          .doc-sheet * { page-break-inside: avoid !important; break-inside: avoid !important; }
          .doc-body, .doc-body-wrap { overflow: hidden !important; }
          .doc-body-scaled { transform: scale(${fitScale}) !important; transform-origin: top left !important; width: ${100 / fitScale}% !important; }
        `
            : ""
        }
      `;
      if (asPdf) {
        toast.info("In the print dialog, choose 'Save as PDF' as the destination.", {
          duration: 4000,
        });
      }
      await preparePrint({
        pageW: pageDims.w,
        pageH: pageDims.h,
        title: safeTitle,
        extraPrintCss: extra,
        message: asPdf ? "Preparing for print… (Save as PDF)" : "Preparing for print…",
      });
    } catch (e: any) {
      console.error(e);
      toast.error("Print failed", {
        description: e?.message || "An unexpected error occurred while preparing the print view.",
      });
    } finally {
      setPrinting(false);
    }
  }

  const [exporting, setExporting] = useState(false);
  type ExportStep =
    | "idle"
    | "loading"
    | "rendering"
    | "paginating"
    | "encoding"
    | "saving"
    | "done"
    | "error";
  const EXPORT_STEPS: { key: ExportStep; label: string; pct: number }[] = [
    { key: "loading", label: "Loading PDF libraries", pct: 10 },
    { key: "rendering", label: "Rendering document to image", pct: 35 },
    { key: "paginating", label: "Paginating into pages", pct: 60 },
    { key: "encoding", label: "Encoding & compressing PDF", pct: 85 },
    { key: "saving", label: "Saving file", pct: 100 },
  ];
  const [exportStep, setExportStep] = useState<ExportStep>("idle");
  const [exportProgress, setExportProgress] = useState(0);
  const [exportDetail, setExportDetail] = useState("");
  const setStep = (s: ExportStep, detail = "") => {
    setExportStep(s);
    setExportDetail(detail);
    const m = EXPORT_STEPS.find((x) => x.key === s);
    if (m) setExportProgress(m.pct);
  };
  const yieldFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

  async function exportPdfDirect() {
    if (!booking) {
      toast.error("Select a booking first", {
        description: "Pick a client/booking from the dropdown to load the document.",
      });
      return;
    }
    if (dataLoading) {
      toast.error("Still loading booking data", {
        description: "Wait for ledger and payments to finish loading, then export.",
      });
      return;
    }
    const sheet = sheetRef.current;
    if (!sheet) {
      toast.error("Preview not ready", {
        description: "The document sheet hasn't rendered yet. Wait a moment and retry.",
      });
      return;
    }
    setExporting(true);
    setExportProgress(0);
    setStep("loading", "Fetching html2canvas + jsPDF");
    const t = toast.loading("Generating PDF…", {
      description: `${dpi} DPI · ${quality} · ${pageSize}`,
    });
    try {
      await yieldFrame();
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas").catch((e) => {
          throw new Error(
            "Could not load PDF renderer (html2canvas). Check your network and retry. " +
              (e?.message || ""),
          );
        }),
        import("jspdf").catch((e) => {
          throw new Error(
            "Could not load PDF library (jspdf). Check your network and retry. " +
              (e?.message || ""),
          );
        }),
      ]);
      const scale = Math.max(1, Math.min(6, dpi / 96));
      setStep("rendering", `Rasterising at ${dpi} DPI (scale ×${scale.toFixed(2)})`);
      await yieldFrame();
      // When fit-to-page is on, cap capture to the sheet's rendered A4 box so
      // overflow never leaks into a second page.
      const captureH = fitToPage ? sheet.getBoundingClientRect().height : sheet.scrollHeight;
      const canvas = await html2canvas(sheet, {
        scale,
        useCORS: true,
        backgroundColor: "#ffffff",
        windowWidth: sheet.scrollWidth,
        windowHeight: captureH,
        height: captureH,
      }).catch((e) => {
        throw new Error(
          "Failed to render the document to canvas. " +
            (e?.message || "Try lowering the DPI and retry."),
        );
      });
      const orientation = pageDims.w > pageDims.h ? "landscape" : "portrait";
      const compress = quality !== "png";
      const pdf = new jsPDF({
        unit: "mm",
        format: [pageDims.w, pageDims.h],
        orientation,
        compress,
      });
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = pdf.internal.pageSize.getHeight();
      const imgRatio = canvas.height / canvas.width;
      const renderH = pdfW * imgRatio;
      const fmt: "PNG" | "JPEG" = quality === "png" ? "PNG" : "JPEG";
      const jpegQ = quality === "high" ? 0.95 : quality === "balanced" ? 0.85 : 0.72;
      const encode = (c: HTMLCanvasElement) =>
        fmt === "PNG" ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", jpegQ);

      // Force single-page output when fit-to-page is on: shrink the image
      // uniformly so it fits within pdfW × pdfH, centred horizontally.
      if (fitToPage || renderH <= pdfH + 0.5) {
        setStep("paginating", "Single page document");
        await yieldFrame();
        setStep(
          "encoding",
          `Encoding as ${fmt}${fmt === "JPEG" ? ` (${Math.round(jpegQ * 100)}%)` : " lossless"}`,
        );
        await yieldFrame();
        const imgData = encode(canvas);
        const fitScaleFactor = Math.min(1, pdfH / renderH);
        const drawW = pdfW * fitScaleFactor;
        const drawH = renderH * fitScaleFactor;
        const offsetX = (pdfW - drawW) / 2;
        pdf.addImage(imgData, fmt, offsetX, 0, drawW, drawH, undefined, compress ? "FAST" : "NONE");
      } else {
        const pxPerMm = canvas.width / pdfW;
        const pageHpx = pdfH * pxPerMm;
        const totalPages = Math.ceil(canvas.height / pageHpx);
        setStep("paginating", `Splitting into ${totalPages} pages`);
        await yieldFrame();
        let y = 0;
        let pageIdx = 0;
        while (y < canvas.height) {
          pageIdx++;
          const sliceH = Math.min(pageHpx, canvas.height - y);
          const sliceCanvas = document.createElement("canvas");
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = sliceH;
          const ctx = sliceCanvas.getContext("2d")!;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
          ctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
          setExportStep("encoding");
          setExportDetail(`Encoding page ${pageIdx} of ${totalPages}`);
          // Interpolate progress between paginating(60) and encoding(85)
          setExportProgress(60 + Math.round((pageIdx / totalPages) * 25));
          await yieldFrame();
          const sliceData = encode(sliceCanvas);
          if (pageIdx > 1) pdf.addPage([pageDims.w, pageDims.h], orientation);
          pdf.addImage(
            sliceData,
            fmt,
            0,
            0,
            pdfW,
            sliceH / pxPerMm,
            undefined,
            compress ? "FAST" : "NONE",
          );
          y += sliceH;
        }
      }
      setStep("saving", "Writing file to disk");
      await yieldFrame();
      const slug = (s: string) =>
        String(s || "")
          .trim()
          .replace(/[^\w]+/g, "_")
          .replace(/^_+|_+$/g, "");
      const clientSlug = slug(booking.client_name ?? "").slice(0, 40);
      const docSlug = slug(title ?? "Document");
      const datePart = new Date().toISOString().slice(0, 10);
      const fname =
        [booking.booking_id, docSlug, clientSlug, datePart].filter(Boolean).join("_") + ".pdf";
      pdf.save(fname);
      setExportStep("done");
      setExportProgress(100);
      toast.success(`PDF downloaded · ${dpi} DPI · ${quality}`, { id: t });
      setTimeout(() => {
        setExportStep("idle");
        setExportProgress(0);
        setExportDetail("");
      }, 1500);
    } catch (e: any) {
      console.error(e);
      const msg = e?.message || "An unexpected error occurred while exporting the PDF.";
      setExportStep("error");
      setExportDetail(msg);
      toast.error("PDF export failed", {
        id: t,
        description:
          msg +
          (dpi >= 450
            ? " · Tip: try a lower DPI (200–300) if your browser ran out of memory."
            : ""),
        action: { label: "Retry", onClick: () => exportPdfDirect() },
      });
      setTimeout(() => {
        if (!exporting) {
          setExportStep("idle");
          setExportProgress(0);
        }
      }, 4000);
    } finally {
      setExporting(false);
    }
  }

  if (_adminGate.blocked) return _adminGate.blocked;
  if (bookingsQ.accessDenied)
    return (
      <AccessDenied
        title="Document viewer restricted"
        description="Client bookings, ledger, payments, and adjustments feed these documents — visible only to admin, manager, and staff roles."
      />
    );

  return (
    <div>
      <Link
        to="/documents"
        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-3 print:hidden"
      >
        <ChevronLeft className="h-3 w-3" /> All documents
      </Link>
      <div className="mb-4 flex flex-col sm:flex-row sm:items-end gap-3 print:hidden">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold flex items-center gap-2 m-0">
            {title}
            {dataFetching && !dataLoading && (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground"
                aria-live="polite"
              >
                <span
                  className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin"
                  aria-hidden="true"
                />
                Refreshing…
              </span>
            )}
          </h1>
          <div className="text-sm text-muted-foreground">
            Pick a booking to auto-fill the template
          </div>
        </div>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={bookingsQ.isLoading}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm min-w-[260px] disabled:opacity-60"
        >
          <option value="">{bookingsQ.isLoading ? "Loading bookings…" : "Select booking…"}</option>
          {bookings.map((b: any) => (
            <option key={b.booking_id} value={b.booking_id}>
              {b.booking_id} — {b.client_name} ({b.unit_id})
            </option>
          ))}
        </select>
        {/* Quick project toggle — jumps to the first sample booking of each project
            so wording/branding can be verified without hunting through the list. */}
        {(() => {
          const isHeights = (b: any) =>
            /^BK-(MH|NH)-/i.test(String(b?.booking_id || "")) ||
            /heights/i.test(String(b?.project_name || ""));
          const heightsSample = bookings.find(isHeights);
          const arcadeSample = bookings.find((b: any) => !isHeights(b));
          const activeIsHeights = !!booking && isHeights(booking);
          const btn =
            "h-10 px-3 text-xs font-semibold rounded-md border transition-colors disabled:opacity-40";
          return (
            <div
              className="inline-flex items-center gap-1 rounded-md border border-input bg-muted/40 p-1"
              title="Preview toggle — swap between a Manal Heights and a Manal Arcade sample booking."
            >
              <button
                type="button"
                onClick={() => heightsSample && setSelected(heightsSample.booking_id)}
                disabled={!heightsSample}
                aria-pressed={activeIsHeights}
                className={`${btn} ${activeIsHeights ? "bg-emerald-700 text-white border-emerald-700" : "bg-background hover:bg-muted border-transparent"}`}
              >
                Manal Heights
              </button>
              <button
                type="button"
                onClick={() => arcadeSample && setSelected(arcadeSample.booking_id)}
                disabled={!arcadeSample}
                aria-pressed={!!booking && !activeIsHeights}
                className={`${btn} ${!!booking && !activeIsHeights ? "bg-slate-800 text-white border-slate-800 dark:bg-slate-700" : "bg-background hover:bg-muted border-transparent"}`}
              >
                Manal Arcade
              </button>
            </div>
          );
        })()}

        <Button
          variant="outline"
          onClick={() => setPreviewOpen(true)}
          disabled={!booking || dataLoading}
          title={dataLoading ? "Loading data…" : ""}
        >
          <Printer className="h-4 w-4 mr-1" /> Print Preview
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setPendingAction("print");
            setPreviewOpen(true);
          }}
          disabled={!booking || dataLoading || printing}
        >
          <Printer className="h-4 w-4 mr-1" /> {printing ? "Preparing…" : "Print"}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setPendingAction("saveviaprint");
            setPreviewOpen(true);
          }}
          disabled={!booking || dataLoading || printing}
        >
          <Download className="h-4 w-4 mr-1" /> Save via Print
        </Button>
        <Button
          onClick={() => {
            setPendingAction("export");
            setPreviewOpen(true);
          }}
          disabled={!booking || dataLoading || exporting}
        >
          <Download className="h-4 w-4 mr-1" /> {exporting ? "Generating PDF…" : "Export PDF"}
        </Button>
      </div>

      {(exporting || exportStep === "done" || exportStep === "error") && (
        <div
          className="mb-4 rounded-md border bg-card p-3 print:hidden"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-sm font-medium flex items-center gap-2">
              {exporting && (
                <span
                  className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin"
                  aria-hidden="true"
                />
              )}
              {exportStep === "done"
                ? "PDF ready"
                : exportStep === "error"
                  ? "Export failed"
                  : "Exporting PDF…"}
            </div>
            <div className="text-xs tabular-nums text-muted-foreground">{exportProgress}%</div>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${exportStep === "error" ? "bg-destructive" : "bg-primary"}`}
              style={{ width: `${exportProgress}%` }}
            />
          </div>
          <ol className="mt-2 grid grid-cols-2 md:grid-cols-5 gap-1 text-[11px]">
            {EXPORT_STEPS.map((s) => {
              const active = exportStep === s.key;
              const done =
                exportProgress >= s.pct && exportStep !== s.key && exportStep !== "error";
              return (
                <li
                  key={s.key}
                  className={`flex items-center gap-1.5 ${active ? "text-primary font-medium" : done ? "text-foreground" : "text-muted-foreground"}`}
                >
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${active ? "bg-primary animate-pulse" : done ? "bg-primary" : "bg-muted-foreground/40"}`}
                    aria-hidden="true"
                  />
                  {s.label}
                </li>
              );
            })}
          </ol>
          {exportDetail && (
            <div
              className={`mt-2 text-[11px] ${exportStep === "error" ? "text-destructive" : "text-muted-foreground"}`}
            >
              {exportDetail}
            </div>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Logo</label>
          <div className="flex items-center gap-1">
            <select
              value={logoId}
              onChange={(e) => setLogoId(e.target.value)}
              className="h-9 min-w-[260px] rounded-md border border-input bg-background px-3 text-sm"
              title="Choose which logo prints on the letterhead. Auto picks the right brand based on the document type."
            >
              {(() => {
                // Build grouped <optgroup>s so the longer logo list stays scannable.
                const items = LOGO_PICKER_ITEMS;
                const auto = items.find((o) => o.id === AUTO_LOGO_ID);
                const rest = items.filter((o) => o.id !== AUTO_LOGO_ID);
                const groups = new Map<string, typeof rest>();
                for (const o of rest) {
                  const g = (o as any).group ?? "Other";
                  if (!groups.has(g)) groups.set(g, [] as any);
                  groups.get(g)!.push(o);
                }
                return (
                  <>
                    {auto && (
                      <option key={auto.id} value={auto.id}>
                        {auto.label} —{" "}
                        {
                          resolveLogoOption(AUTO_LOGO_ID, {
                            style: getDocStyle(type),
                            docType: type,
                          }).label
                        }
                      </option>
                    )}
                    {Array.from(groups.entries()).map(([g, opts]) => (
                      <optgroup key={g} label={g}>
                        {opts.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </>
                );
              })()}
            </select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 px-2 text-xs"
              onClick={() => setAutoEditorOpen(true)}
              title="Customize which logo Auto picks per document type"
            >
              Customize Auto…
            </Button>
          </div>
          {missingLogoId && (
            <div
              role="status"
              aria-live="polite"
              className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <span aria-hidden="true">⚠️</span>
              <span>
                Saved logo{" "}
                <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px] dark:bg-amber-900/60">
                  {missingLogoId}
                </code>{" "}
                is no longer available — using <strong>Auto</strong> fallback.
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => setLogoId(AUTO_LOGO_ID)}
              >
                Reset to Auto
              </Button>
            </div>
          )}
          {/* Live letterhead preview — scaled-down render of the actual header
              using the currently selected logo, so the user can verify the
              brand mark before saving / exporting. */}
          <div className="mt-2 w-[420px] max-w-full rounded-md border border-border bg-card overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-2 py-1 bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
              <span>Letterhead preview</span>
              <span>
                {resolveLogoOption(logoId, { style: getDocStyle(type), docType: type }).label}
              </span>
            </div>
            {/* Render the real header at A4 width (210mm) then scale to fit. */}
            <div
              className="relative overflow-hidden"
              style={{ height: `${HEADER_H_MM[getDocStyle(type)] * 2.2}px` }}
            >
              <div
                style={{
                  width: "210mm",
                  transform: "scale(0.53)",
                  transformOrigin: "top left",
                  padding: `0 ${PAGE_MARGIN_MM}mm`,
                  background: "#fff",
                }}
              >
                <LetterheadHeader
                  style={getDocStyle(type)}
                  logoId={logoId}
                  docType={type}
                  projectName={booking?.project_name}
                />
              </div>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs text-muted-foreground mb-1">Page size</label>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(e.target.value as any)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {Object.entries(PAGE_SIZES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Margins</label>
          <select
            value={marginPreset}
            onChange={(e) => setMarginPreset(e.target.value as any)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {Object.entries(MARGIN_PRESETS).map(([k, v]) => (
              <option key={k} value={k}>
                {k}
                {v !== "custom" ? ` (${v} mm)` : ""}
              </option>
            ))}
          </select>
        </div>
        {marginPreset === "Custom" && (
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Custom (mm)</label>
            <input
              type="number"
              min={0}
              max={40}
              value={customMargin}
              onChange={(e) => setCustomMargin(Number(e.target.value))}
              className="h-9 w-24 rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
        )}
        <label className="inline-flex items-center gap-2 pb-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={fitToPage}
            onChange={(e) => setFitToPage(e.target.checked)}
            className="h-4 w-4"
          />
          <span>
            Fit to page{fitToPage && fitScale < 1 ? ` (${Math.round(fitScale * 100)}%)` : ""}
          </span>
        </label>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">PDF resolution</label>
          <select
            value={dpi}
            onChange={(e) => setDpi(Number(e.target.value))}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value={150}>150 DPI — Screen / draft</option>
            <option value={200}>200 DPI — Standard</option>
            <option value={300}>300 DPI — Print quality</option>
            <option value={450}>450 DPI — High-res print</option>
            <option value={600}>600 DPI — Archival (large file)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Render quality</label>
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value as any)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="png">Lossless PNG (sharpest, largest)</option>
            <option value="high">High JPEG (95%)</option>
            <option value="balanced">Balanced JPEG (85%)</option>
            <option value="small">Small JPEG (72%)</option>
          </select>
        </div>
        <div className="text-xs text-muted-foreground pb-2 basis-full">
          PDF export uses these settings. 300 DPI + High/PNG is recommended for printing.
        </div>
      </div>

      {dataError && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-start justify-between gap-3 print:hidden">
          <div>
            <div className="font-semibold">Couldn't load document data</div>
            <div className="text-xs opacity-90 mt-0.5">
              {dataErrorMsg || "Network or database error."}
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={refetchAll}>
            Retry
          </Button>
        </div>
      )}

      {!selected ? (
        <div className="card-elevated p-12 text-center text-muted-foreground">
          Select a booking to preview.
        </div>
      ) : dataLoading ? (
        <div className="card-elevated p-6">
          <div className="sr-only" aria-live="polite">
            Loading booking, ledger and payments…
          </div>
          <DialogSkeleton />
        </div>
      ) : bookingMissing ? (
        <div className="card-elevated p-12 text-center text-muted-foreground">
          Booking <span className="font-mono">{selected}</span> not found. Pick another from the
          list above.
        </div>
      ) : !booking ? (
        <div className="card-elevated p-12 text-center text-muted-foreground">
          Select a booking to preview.
        </div>
      ) : (
        (() => {
          const lhStyle = getDocStyle(type);
          return (
            <>
              <style>{PRINT_CSS}</style>
              <div
                ref={sheetRef}
                className="mx-auto bg-card text-card-foreground shadow-[var(--shadow-elegant)] print:shadow-none doc-sheet"
                style={{
                  width: `${pageDims.w}mm`,
                  minHeight: `${pageDims.h}mm`,
                  ...(fitToPage ? { height: `${pageDims.h}mm`, maxHeight: `${pageDims.h}mm` } : {}),
                  padding: `${activeMargin}mm`,
                  boxSizing: "border-box",
                  fontFamily: '"Times New Roman", Georgia, serif',
                  color: "#111",
                  fontSize: "11pt",
                  lineHeight: 1.55,
                  display: "flex",
                  flexDirection: "column",
                  overflow: fitToPage ? "hidden" : "visible",
                }}
              >
                <PrintFrame docTitle={title} bookingId={booking?.booking_id}>
                  <LetterheadHeader
                    style={lhStyle}
                    logoId={logoId}
                    docType={type}
                    projectName={booking?.project_name}
                  />
                  <div
                    className="doc-body"
                    style={{
                      flex: 1,
                      padding: "6mm 0 4mm 0",
                      minHeight: 0,
                      overflow: fitToPage ? "hidden" : "visible",
                    }}
                  >
                    <div
                      ref={bodyRef}
                      className="doc-body-scaled"
                      style={
                        fitToPage
                          ? {
                              transform: `scale(${fitScale})`,
                              transformOrigin: "top left",
                              width: `${100 / fitScale}%`,
                            }
                          : undefined
                      }
                    >
                      {renderDocBody({
                        type,
                        booking,
                        payments,
                        ledger,
                        adjustments,
                        receiptParam,
                        prev1: prev1Param,
                        prev2: prev2Param,
                      })}
                    </div>
                  </div>
                  {/* Full LetterheadFooter intentionally omitted — the compact
                    running footer in <tfoot> serves every page (including
                    page 1) so page 2+ shows a single footer, not two. */}
                </PrintFrame>
              </div>

              <PrintPreviewModal
                open={previewOpen}
                onOpenChange={(o) => {
                  setPreviewOpen(o);
                  if (!o) setPendingAction(null);
                }}
                title={`${title} — ${booking.booking_id}`}
                mode="react"
                style={lhStyle}
                docType={type}
                projectName={booking?.project_name}
                onConfirmPrint={
                  pendingAction === "print"
                    ? () => {
                        setPendingAction(null);
                        setPreviewOpen(false);
                        setTimeout(() => triggerDirectPrint(false), 60);
                      }
                    : pendingAction === "saveviaprint"
                      ? () => {
                          setPendingAction(null);
                          setPreviewOpen(false);
                          setTimeout(() => triggerDirectPrint(true), 60);
                        }
                      : undefined
                }
                onConfirmExport={
                  pendingAction === "export"
                    ? () => {
                        setPendingAction(null);
                        setPreviewOpen(false);
                        setTimeout(() => exportPdfDirect(), 60);
                      }
                    : undefined
                }
              >
                {renderDocBody({
                  type,
                  booking,
                  payments,
                  ledger,
                  adjustments,
                  receiptParam,
                  prev1: prev1Param,
                  prev2: prev2Param,
                })}
              </PrintPreviewModal>
            </>
          );
        })()
      )}
      <AutoLogoEditor open={autoEditorOpen} onOpenChange={setAutoEditorOpen} />
      {booking && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 md:hidden bg-background/95 backdrop-blur border-t p-3 flex gap-2 print:hidden"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0) + 0.75rem)" }}
        >
          <Button
            variant="outline"
            className="flex-1 min-h-12"
            onClick={() => {
              setPendingAction("print");
              setPreviewOpen(true);
            }}
            disabled={dataLoading || printing}
          >
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
          <Button
            variant="outline"
            className="flex-1 min-h-12"
            onClick={() => {
              setPendingAction("saveviaprint");
              setPreviewOpen(true);
            }}
            disabled={dataLoading || printing}
          >
            <Download className="h-4 w-4 mr-1" /> PDF
          </Button>
          <a
            href={`https://wa.me/${((booking as any).whatsapp || (booking as any).mobile || "")
              .toString()
              .replace(/\D/g, "")
              .replace(/^0/, "92")}?text=${encodeURIComponent(
              `${title} for booking ${booking.booking_id} — ${booking.client_name}`,
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Share via WhatsApp"
            className="flex-1 min-h-12 grid place-items-center rounded-md bg-emerald-600 text-white font-semibold"
          >
            WhatsApp
          </a>
        </div>
      )}
    </div>
  );
}

/* ---------- helpers ---------- */

const today = () => fmtDate(new Date());
const yearNow = () => new Date().getFullYear();
const seq3 = (s: string) => {
  let h = 0;
  for (const c of s || "") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return String((h % 999) + 1).padStart(3, "0");
};
const ref = (unit: string, kind: string) =>
  `PRB/MA/${(unit || "MA").replace(/[^A-Z0-9-]/gi, "")}/${kind}/${yearNow()}`;
const refSerial = (unit: string, kind: string, bookingId: string) =>
  `${ref(unit, kind)}-${seq3(bookingId)}`;

function pkr(n: number | null | undefined) {
  return `PKR ${fmtPKR(Number(n || 0))}`;
}
function pkrSlash(n: number | null | undefined) {
  return `PKR ${fmtPKR(Number(n || 0))}/-`;
}
function clientTitle(b: any) {
  const g = (b?.gender || b?.title || "").toString().toLowerCase();
  if (g.startsWith("f") || g.includes("mrs") || g.includes("ms")) return "Ms.";
  return "Mr.";
}
function fatherLine(b: any) {
  return b?.so_wo ? `S/O ${b.so_wo}` : "";
}
function cashOnly(payments: any[]) {
  return payments.reduce((s, p) => s + Number(p.safe_cash_amount || 0), 0);
}
function adjAllowed(adjustments: any[]) {
  return adjustments.reduce((s, a) => s + Number(a.approved_value || 0), 0);
}
function adjRealized(adjustments: any[]) {
  return adjustments.reduce((s, a) => s + Number(a.realized_value || 0), 0);
}
function nonCashPayments(payments: any[]) {
  // Adjustment receipts logged in payments
  return payments
    .filter((p) => p.non_cash_adjustment)
    .reduce((s, p) => s + Number(p.amount || 0), 0);
}
function totalAdjustmentCredit(adjustments: any[], payments: any[]) {
  // Prefer adjustments table; fall back to non-cash payment rows
  return adjAllowed(adjustments) || nonCashPayments(payments);
}

function H({ children }: any) {
  // Print-body document title. Rendered as <h2> because the page-level
  // <h1> already lives in the app chrome (DocumentView.tsx:344); using
  // <h2> here keeps a single-h1 hierarchy across the composed DOM.
  return (
    <h2
      style={{
        textAlign: "center",
        fontWeight: 700,
        fontSize: "14pt",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        textDecoration: "underline",
        margin: "0 0 6mm",
      }}
    >
      {children}
    </h2>
  );
}
function SubH({ children }: any) {
  // Section heading inside a print-body document — nested under <H> (h2).
  return (
    <h3
      style={{
        fontWeight: 700,
        fontSize: "10.5pt",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        background: "#f1f3f8",
        padding: "1.5mm 3mm",
        margin: "5mm 0 2mm",
        borderLeft: "3px solid #1B2B4B",
      }}
    >
      {children}
    </h3>
  );
}
function RefRow({ left, right }: { left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: "10pt",
        margin: "0 0 4mm",
      }}
    >
      <div>{left}</div>
      <div>{right}</div>
    </div>
  );
}

/**
 * Project-aware branding used by every legal / operational document.
 * Manal Heights bookings are detected via booking_id prefix `BK-NH-` OR a
 * project_name that contains "heights". Everything else falls back to the
 * Manal Arcade defaults so historical documents keep their exact wording.
 */
function projectInfo(booking: any) {
  // Heights bookings are stamped `BK-MH-*` (Manal Heights) in the current data;
  // the older `BK-NH-*` prefix is kept as a safety net for any legacy rows.
  // We also fall back to matching "heights" inside project_name so a mis-
  // prefixed booking still brands correctly.
  const id = String(booking?.booking_id || "");
  const pname = String(booking?.project_name || "");
  const isHeights = /^BK-(MH|NH)-/i.test(id) || /heights/i.test(pname);
  return {
    isHeights,
    name: isHeights ? "Manal Heights" : "Manal Arcade",
    NAME: isHeights ? "MANAL HEIGHTS" : "MANAL ARCADE",
    // Short address used in inline references like `Unit 202, {short}`.
    short: isHeights ? "B-17 Multi Gardens, Islamabad" : "B-1 Markaz, B-17, Islamabad",
    // Full postal address including project name.
    address: isHeights
      ? "Manal Heights, B-17 Multi Gardens, Islamabad"
      : "Manal Arcade, B-1 Markaz, B-17, Islamabad",
    // Legal/plot form for deeds & agreements.
    plot: isHeights
      ? "Manal Heights, Block B-17, Multi Gardens, Islamabad"
      : "Manal Arcade, Plot No. 04, Block B-1 Markaz, Sector B-17, Islamabad",
    officeAddress: isHeights
      ? "Office, Manal Heights, B-17 Multi Gardens, Islamabad"
      : "Office, Manal Arcade, B-1 Markaz, B-17, Islamabad",
    email: isHeights ? "manalheights@gmail.com" : "manalarcade@gmail.com",
  };
}

function To({ booking }: { booking: any }) {
  return (
    <div style={{ marginBottom: "4mm" }}>
      <div>
        <strong>To,</strong>
      </div>
      <div className="capitalize">
        {clientTitle(booking)} {booking.client_name}
      </div>
      {booking.so_wo && <div>{fatherLine(booking)}</div>}
      <div>
        CNIC: <span style={{ fontFamily: "monospace" }}>{booking.cnic || "____________"}</span>
      </div>
      <div>{booking.address || "____________"}</div>
    </div>
  );
}
function SignatureBlock({
  entity = "Precise Realtors & Builders (Pvt.) Ltd.",
  role = "Authorized Signatory",
}: any) {
  // Tightened spacing for A4 printing (was 12mm top + 16mm rule gap, which
  // pushed the block onto its own page on dense notices). Locks together
  // across page breaks so the signature lines never orphan.
  return (
    <div
      style={{
        marginTop: "10mm",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "12mm",
        fontSize: "10pt",
        lineHeight: 1.45,
        breakInside: "avoid",
        pageBreakInside: "avoid",
      }}
    >
      <div>
        <div>For and on behalf of</div>
        <div>
          <strong>{entity}</strong>
        </div>
        <div
          style={{
            borderTop: "0.6pt solid #000",
            marginTop: "12mm",
            paddingTop: "1.2mm",
            fontWeight: 600,
          }}
        >
          {role}
        </div>
        <div style={{ marginTop: "1mm" }}>Name: ___________________________</div>
        <div>Company Stamp: ___________________</div>
      </div>
      <div>
        <div>Client Acknowledgment</div>
        <div
          style={{
            borderTop: "0.6pt solid #000",
            marginTop: "12mm",
            paddingTop: "1.2mm",
            fontWeight: 600,
          }}
        >
          Signature
        </div>
        <div style={{ marginTop: "1mm" }}>Name: ___________________________</div>
        <div>Date: ___________________________</div>
      </div>
    </div>
  );
}

/* ---------- router ---------- */

export function renderDocBody(args: any) {
  switch (args.type) {
    case "receipt":
      return <ReceiptDoc {...args} />;
    case "payment-plan":
      return <PaymentPlanDoc {...args} />;
    case "allotment":
      return <AllotmentDoc {...args} />;
    case "possession":
      return <PossessionDoc {...args} />;
    case "prov-possession":
      return <ProvPossessionDoc {...args} />;
    case "deposit-summary":
      return <DepositSummaryDoc {...args} />;
    case "demand-notice":
      return <DemandNoticeDoc {...args} />;
    case "transfer-form":
      return <TransferFormDoc {...args} />;
    case "sale-agreement":
      return <SaleAgreementDoc {...args} />;
    case "legal-notice":
      return <LegalShowCauseDoc {...args} />;
    case "final-legal-notice":
      return <FinalLegalNoticeDoc {...args} />;
    case "final-cancel-warning":
      return <FinalCancelWarningDoc {...args} />;
    case "cancellation-notice":
      return <CancellationNoticeDoc {...args} />;
    default:
      return <GenericDoc {...args} />;
  }
}

/* ---------- DOC 1 — PAYMENT RECEIPT ---------- */

function ReceiptDoc({ booking, payments, adjustments, receiptParam }: any) {
  const proj = projectInfo(booking);
  const pay = receiptParam
    ? payments.find((p: any) => p.receipt_no === receiptParam)
    : [...payments].sort((a: any, b: any) =>
        (b.payment_date || "").localeCompare(a.payment_date || ""),
      )[0];
  const contract = Number(booking.total_contract_value ?? booking.sold_unit_value ?? 0);
  const cash = cashOnly(payments);
  const adj = totalAdjustmentCredit(adjustments, payments);
  const totalReceived = cash + adj;
  const remaining = Math.max(contract - totalReceived, 0);
  const mode = (pay?.payment_mode || "").toLowerCase();
  const check = (v: string) => (mode.includes(v) ? "☑" : "☐");
  const headLower = (pay?.payment_head || "").toLowerCase();
  const phCheck = (v: string) => (headLower.includes(v) ? "☑" : "☐");

  return (
    <>
      <H>Payment Receipt</H>
      <RefRow
        left={
          <>
            <strong>Receipt No.:</strong>{" "}
            <span style={{ fontFamily: "monospace" }}>{pay?.receipt_no ?? "—"}</span>
          </>
        }
        right={
          <>
            <strong>Date:</strong> {today()}
          </>
        }
      />
      <table style={{ width: "100%", fontSize: "10.5pt", marginBottom: "3mm" }}>
        <tbody>
          <tr>
            <td style={{ width: "38%", padding: "1mm 0" }}>Received From:</td>
            <td>
              <strong className="capitalize">{booking.client_name}</strong>
            </td>
          </tr>
          <tr>
            <td style={{ padding: "1mm 0" }}>CNIC No.:</td>
            <td style={{ fontFamily: "monospace" }}>{booking.cnic || "—"}</td>
          </tr>
          <tr>
            <td style={{ padding: "1mm 0" }}>Booking ID:</td>
            <td style={{ fontFamily: "monospace" }}>{booking.booking_id}</td>
          </tr>
          <tr>
            <td style={{ padding: "1mm 0" }}>Unit:</td>
            <td>
              {booking.unit_type} No. {booking.unit_id}, {proj.address}
            </td>
          </tr>
        </tbody>
      </table>
      <SubH>Amount</SubH>
      <table style={{ width: "100%", fontSize: "10.5pt" }}>
        <tbody>
          <tr>
            <td style={{ width: "38%", padding: "1mm 0" }}>Amount Received:</td>
            <td>
              <strong>{pkrSlash(pay?.amount)}</strong>
            </td>
          </tr>
          <tr>
            <td style={{ padding: "1mm 0" }}>Amount in Words:</td>
            <td>{amountInWordsPK(Number(pay?.amount || 0))}</td>
          </tr>
          <tr>
            <td style={{ padding: "1mm 0" }}>Payment Method:</td>
            <td>
              {check("cash")} Cash &nbsp; {check("cheque")} Cheque &nbsp;{" "}
              {check("bank") || check("transfer")} Bank Transfer
            </td>
          </tr>
          <tr>
            <td style={{ padding: "1mm 0" }}>Cheque / Transaction No.:</td>
            <td style={{ fontFamily: "monospace" }}>{pay?.cheque_txn_no || "—"}</td>
          </tr>
          <tr>
            <td style={{ padding: "1mm 0" }}>Bank Name:</td>
            <td>{pay?.account || "—"}</td>
          </tr>
          <tr>
            <td style={{ padding: "1mm 0" }}>Payment Date:</td>
            <td>{fmtDate(pay?.payment_date)}</td>
          </tr>
          <tr>
            <td style={{ padding: "1mm 0" }}>Payment Against:</td>
            <td>
              {phCheck("down")} Down Payment &nbsp; {phCheck("install")} Installment
              {pay?.installment_no ? ` No. ${pay.installment_no}` : ""} &nbsp;{" "}
              {phCheck("possession")} Possession &nbsp; ☐ Other
            </td>
          </tr>
        </tbody>
      </table>

      <SubH>Account Summary as of {today()}</SubH>
      <table style={{ width: "100%", fontSize: "10.5pt", borderCollapse: "collapse" }}>
        <tbody>
          <SumRow label="Total Contract Value" value={pkr(contract)} />
          <SumRow label="Total Received (Cash)" value={pkr(cash)} />
          <SumRow label="Total Adjustment Credit" value={pkr(adj)} />
          <SumRow label="Total Received (All)" value={pkr(totalReceived)} strong />
          <SumRow label="Remaining Balance" value={pkr(remaining)} strong />
        </tbody>
      </table>

      <p style={{ fontSize: "9.5pt", color: "#444", marginTop: "5mm" }}>
        <strong>IMPORTANT:</strong> Payment shall only be valid when received through the official
        Company bank account or in person at the Company office. Any payment made to any
        unauthorized person or account shall not be treated as valid unless duly acknowledged in
        writing by the Company.
      </p>

      <div
        style={{
          marginTop: "10mm",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "10mm",
          fontSize: "10pt",
        }}
      >
        <div>
          <div style={{ borderTop: "1px solid #000", marginTop: "14mm", paddingTop: "1.5mm" }}>
            Received By
          </div>
          <div>Name: ___________________________</div>
          <div>Date: ___________________________</div>
        </div>
        <div>
          <div style={{ borderTop: "1px solid #000", marginTop: "14mm", paddingTop: "1.5mm" }}>
            Authorized Signatory
          </div>
          <div>Name: ___________________________</div>
          <div>Company Stamp: ___________________</div>
        </div>
      </div>
    </>
  );
}

function SumRow({ label, value, strong }: any) {
  return (
    <tr>
      <td
        style={{
          padding: "1.5mm 3mm",
          borderBottom: "0.4pt solid #ddd",
          color: "#444",
          width: "60%",
        }}
      >
        {label}
      </td>
      <td
        style={{
          padding: "1.5mm 3mm",
          borderBottom: "0.4pt solid #ddd",
          textAlign: "right",
          fontWeight: strong ? 700 : 400,
        }}
      >
        {value}
      </td>
    </tr>
  );
}

/* ---------- DOC 2 — PAYMENT PLAN (DHA / Emaar print standard) ----------
 *
 * Design brief:
 *  · Manal Heights bookings (BK-NH-* or project_name "Manal Heights") render
 *    with the Manal Heights green palette matching the NIZAM_SHAH reference.
 *    All other projects keep the Manal Arcade navy+gold palette.
 *  · Received cash + adjustments are re-allocated FIFO across the schedule
 *    (Down Payment → installments by due date → possession). Any overpayment
 *    beyond the down payment cascades automatically to the next installments,
 *    which display as PAID. The single row that gets partial cover is split
 *    visually into an "Xa · Partial Paid (Advance)" + "Xb · Balance Due" pair
 *    so the client can see exactly where the money landed.
 */

type PlanStatus = "Paid" | "Overdue" | "Upcoming" | "Partial";

export function PaymentPlanDoc({ booking, ledger, payments, adjustments }: any) {
  // Detect Manal Heights vs Manal Arcade for palette + branding.
  // Centralized in `projectInfo` so display-name / email edits propagate here.
  const proj = projectInfo(booking);
  const isHeights = proj.isHeights;

  // Drop empty schedule rows (no due, no paid, no label).
  const rawSchedule = (ledger as any[]).filter((l: any) => {
    const due = Number(l.due_amount || 0);
    const paid = Number(l.paid_amount || 0);
    const hasLabel = (l.particulars || "").trim().length > 0;
    return due > 0 || paid > 0 || hasLabel;
  });

  const contract = Number(booking.total_contract_value ?? 0);
  const cash = cashOnly(payments);
  const adj = totalAdjustmentCredit(adjustments, payments);
  const totalReceived = cash + adj;
  const remaining = Math.max(contract - totalReceived, 0);

  // Calendar-day comparison guards against timezone drift (a due date parsed
  // as UTC midnight vs a local "now" can be 5–8h out — enough to flip a row
  // from Upcoming to Overdue and back).
  const toDay = (v: any): Date | null => {
    if (v == null || v === "") return null;
    const d = v instanceof Date ? new Date(v.getTime()) : new Date(String(v));
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const todayD = new Date();
  todayD.setHours(0, 0, 0, 0);

  // Latest cash-payment date across the booking — a defensive cross-check
  // against the machine clock. If a row's due_date is on or after the latest
  // real payment, we have hard proof the money was received in advance.
  const latestPaymentDay: Date | null = (() => {
    let best: Date | null = null;
    for (const p of (payments || []) as any[]) {
      const d = toDay(p?.payment_date);
      if (d && (!best || d > best)) best = d;
    }
    return best;
  })();

  const isFutureDue = (l: any) => {
    const dueDay = toDay(l.due_date);
    return !!dueDay && dueDay.getTime() >= todayD.getTime();
  };

  // Categorise + order rows: Down Payment → installments (by due date, term_no) → Possession → others.
  const catOf = (l: any): "dp" | "inst" | "poss" | "other" => {
    const p = String(l.particulars || "").toLowerCase();
    if (/down\s*payment|^dp\b/.test(p)) return "dp";
    if (/possession/.test(p)) return "poss";
    if (/install/.test(p)) return "inst";
    return "other";
  };
  const orderKey = (l: any) => {
    const c = catOf(l);
    const rank = c === "dp" ? 0 : c === "inst" ? 1 : c === "poss" ? 2 : 3;
    const d = toDay(l.due_date)?.getTime() ?? 0;
    const t = Number(l.term_no || 0);
    return [rank, d, t] as const;
  };
  const schedule = [...rawSchedule].sort((a, b) => {
    const [ra, da, ta] = orderKey(a);
    const [rb, db, tb] = orderKey(b);
    return ra - rb || da - db || ta - tb;
  });

  // FIFO-allocate the received pool across rows, top to bottom.
  //
  // Invariant: a row whose due_date is in the future can NEVER be overdue,
  // regardless of paid vs. due. A future partial is an advance payment and
  // must render as "Paid in Advance" + "Not Yet Due", not as overdue.
  //
  // We additionally cross-check `future` against the actual payment timestamp
  // (`latestPaymentDay`): if the client's latest payment predates the row's
  // due date, that's independent proof of advance, unaffected by clock skew.
  let pool = totalReceived;
  const alloc: Array<{
    row: any;
    paid: number;
    due: number;
    status: PlanStatus;
    future: boolean;
    paidBeforeDue: boolean;
    warnings: string[];
  }> = schedule.map((l) => {
    const due = Number(l.due_amount || 0);
    const paid = Math.min(pool, due);
    pool -= paid;
    const dueDay = toDay(l.due_date);
    const warnings: string[] = [];
    if (!dueDay && l.due_date) warnings.push(`unparseable due_date: ${l.due_date}`);
    let future = !!dueDay && dueDay.getTime() >= todayD.getTime();
    const paidBeforeDue =
      paid > 0 && !!dueDay && !!latestPaymentDay && latestPaymentDay.getTime() <= dueDay.getTime();
    if (paidBeforeDue && !future) {
      warnings.push(
        `advance override: latest payment ${latestPaymentDay!.toISOString().slice(0, 10)} ` +
          `predates due ${dueDay!.toISOString().slice(0, 10)} but clock-check said past`,
      );
      future = true;
    }
    let status: PlanStatus = "Upcoming";
    if (due > 0 && paid >= due) status = "Paid";
    else if (paid > 0 && paid < due) status = "Partial";
    else if (due > 0 && !future && !!dueDay) status = "Overdue";
    // Hard guard: future-dated rows must never carry an Overdue status.
    if (future && status === "Overdue") status = "Upcoming";
    return { row: l, paid, due, status, future, paidBeforeDue, warnings };
  });

  // Advance partial payments (future due-date) are NEVER overdue: only past-due
  // partials and fully missed past rows contribute to the overdue tally.
  const overdueEntries = alloc.filter(
    (a) => !a.future && (a.status === "Overdue" || (a.status === "Partial" && a.paid < a.due)),
  );
  const overdueCount = overdueEntries.length;
  const overdueAmt = overdueEntries.reduce((s, a) => s + (a.due - a.paid), 0);

  // Structured trace: emits one entry per render into
  // `window.__paymentPlanTrace` (ring buffer, 50 entries) and — when
  // debugging is enabled (dev mode or `localStorage.debug="paymentPlan"`) —
  // a grouped console.table so support can see exactly why each row was
  // classified as advance / overdue / upcoming.
  logAllocation(alloc as any, {
    bookingId: booking?.booking_id,
    totalReceived,
    contract,
    now: todayD,
  });

  const instTotal = schedule
    .filter((l: any) => /install/i.test(l.particulars || ""))
    .reduce((s: number, l: any) => s + Number(l.due_amount || 0), 0);
  const dpTotal = Number(booking.down_payment || 0);
  const possessionAmt = Number(booking.possession_amount || 0);
  const perInstallment = Number(booking.installment_amount || 0);

  /* Palette — green for Manal Heights, navy+gold for Manal Arcade */
  const BRAND = isHeights ? "#1B3A2F" : "#1B2B4B";
  const BRAND_HEAD = isHeights ? "#22513f" : "#2d3f5e";
  const ACCENT = isHeights ? "#3F7A5B" : "#C9A84C";
  const ACCENT_TXT = isHeights ? "#E9F5EE" : "#E8D5A3";
  const INK = "#000";
  const SUB = "#555";
  const LABEL = "#888";
  const RULE = "#d5d5d5";
  const ROW_RULE = "#ececec";
  const ZEBRA = isHeights ? "#f7fbf8" : "#fafafa";
  const OVERDUE_BG = "#fff8f8";
  const OVERDUE_BORDER = "#dc2626";
  const PAID_BG = isHeights ? "#f0f9f4" : "#f8fff8";
  const PAID_FG = isHeights ? "#1B3A2F" : "#059669";
  const PARTIAL_FG = "#b45309";
  const UPCOMING_FG = "#6b7280";
  const MONO = '"Courier New", Courier, monospace';
  const SANS = '"Calibri", Arial, sans-serif';

  // One-page fitting tiers (row splits can push count up, so budget generously).
  const partialCount = alloc.filter((a) => a.status === "Partial").length;
  const n = schedule.length + partialCount;
  const tier: 0 | 1 | 2 = n > 22 ? 2 : n > 14 ? 1 : 0;
  const bodyFs = ["8.5pt", "8pt", "7.5pt"][tier];
  const headFs = ["8pt", "7.5pt", "7pt"][tier];
  const rowH = ["6.2mm", "5.5mm", "4.8mm"][tier];
  const cellPad = "0 2mm";
  const sectionGap = ["4mm", "3mm", "2.5mm"][tier];

  const projectLabel = isHeights
    ? "Manal Heights, B-17 Multi Gardens, Islamabad"
    : "Manal Arcade, B-1 Markaz, B-17, Islamabad";
  const planPrefix = isHeights ? "MH/PLN" : "MA/PLN";
  const planNo = (() => {
    const id = String(booking?.booking_id || "PLN")
      .replace(/[^A-Z0-9]/gi, "")
      .toUpperCase();
    return `${planPrefix}/${new Date().getFullYear()}/${id.slice(-4) || "0001"}`;
  })();

  const infoPairs: Array<[string, React.ReactNode, string, React.ReactNode]> = [
    [
      "Client Name",
      <span style={{ textTransform: "capitalize" }}>{booking.client_name || "—"}</span>,
      "Booking ID",
      <span style={{ fontFamily: MONO }}>{booking.booking_id || "—"}</span>,
    ],
    [
      "CNIC",
      <span style={{ fontFamily: MONO }}>{booking.cnic || "—"}</span>,
      "Booking Date",
      fmtDate(booking.booking_date),
    ],
    [
      "Mobile",
      <span style={{ fontFamily: MONO }}>{booking.mobile || "—"}</span>,
      "Unit",
      `${booking.unit_type || "—"} No. ${booking.unit_id || "—"}${booking.floor ? `, Floor ${booking.floor}` : ""}`,
    ],
    [
      "Project",
      projectLabel,
      "Covered Area",
      `${booking.size_sqft ? Number(booking.size_sqft).toLocaleString("en-US") : "—"} sq.ft.`,
    ],
  ];

  const Bar = ({ children, mt }: { children: React.ReactNode; mt?: string }) => (
    <h2
      style={{
        background: BRAND,
        color: "#fff",
        fontFamily: SANS,
        fontWeight: 700,
        fontSize: "9pt",
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        padding: "2mm 4mm",
        marginTop: mt,
        marginBottom: 0,
      }}
    >
      {children}
    </h2>
  );

  const InfoGrid = ({ pairs }: { pairs: typeof infoPairs }) => (
    <div style={{ border: `1pt solid ${RULE}`, marginBottom: sectionGap }}>
      {pairs.map(([l1, v1, l2, v2], i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            borderBottom: i < pairs.length - 1 ? `0.5pt solid #eee` : "none",
          }}
        >
          <div style={{ borderRight: `0.5pt solid #e0e0e0`, padding: "1.3mm 3mm" }}>
            <div
              style={{
                fontSize: "7.2pt",
                color: LABEL,
                textTransform: "uppercase",
                letterSpacing: "0.3px",
              }}
            >
              {l1}
            </div>
            <div style={{ fontSize: "9pt", fontWeight: 700, color: INK }}>{v1}</div>
          </div>
          <div style={{ padding: "1.3mm 3mm" }}>
            <div
              style={{
                fontSize: "7.2pt",
                color: LABEL,
                textTransform: "uppercase",
                letterSpacing: "0.3px",
              }}
            >
              {l2}
            </div>
            <div style={{ fontSize: "9pt", fontWeight: 700, color: INK }}>{v2}</div>
          </div>
        </div>
      ))}
    </div>
  );

  const ThX = ({ children, align = "center", w }: any) => (
    <th style={{ padding: "1.5mm 2mm", textAlign: align, fontWeight: 700, width: w }}>
      {children}
    </th>
  );
  const TdX = ({ children, align = "center", mono, colSpan, style }: any) => (
    <td
      colSpan={colSpan}
      style={{
        padding: cellPad,
        textAlign: align,
        verticalAlign: "middle",
        borderBottom: `0.4pt solid ${ROW_RULE}`,
        fontFamily: mono ? MONO : SANS,
        fontSize: mono ? bodyFs : undefined,
        ...style,
      }}
    >
      {children}
    </td>
  );

  const Pill = ({
    text,
    bg,
    fg,
    border,
  }: {
    text: string;
    bg: string;
    fg: string;
    border: string;
  }) => (
    <span
      style={{
        display: "inline-block",
        padding: "0.6mm 2.4mm",
        borderRadius: "6pt",
        background: bg,
        color: fg,
        border: `0.6pt solid ${border}`,
        fontSize: "7.4pt",
        fontWeight: 700,
        letterSpacing: "0.4px",
        textTransform: "uppercase",
        minWidth: "18mm",
        textAlign: "center",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
  const ADVANCE_FG = isHeights ? "#0F6E3F" : "#0369a1";
  const ADVANCE_BG = isHeights ? "#e6f5ec" : "#e0f2fe";
  const statusCell = (s: PlanStatus | "Due" | "Advance") => {
    if (s === "Paid") return <Pill text="Paid" bg={PAID_BG} fg={PAID_FG} border={`${PAID_FG}55`} />;
    if (s === "Advance")
      return (
        <Pill text="Paid · Advance" bg={ADVANCE_BG} fg={ADVANCE_FG} border={`${ADVANCE_FG}55`} />
      );
    if (s === "Overdue")
      return (
        <Pill text="Overdue" bg="#fff1f1" fg={OVERDUE_BORDER} border={`${OVERDUE_BORDER}55`} />
      );
    if (s === "Partial")
      return <Pill text="Partial" bg="#fff7ed" fg={PARTIAL_FG} border={`${PARTIAL_FG}55`} />;
    if (s === "Due") return <Pill text="Due" bg="#fef3c7" fg="#92400e" border="#f59e0b88" />;
    return <Pill text="Upcoming" bg="#f5f5f5" fg={UPCOMING_FG} border="#d1d5db" />;
  };

  // Row-index label: DP / P / n, and split partial into Xa/Xb.
  const idxLabel = (a: (typeof alloc)[number], i: number) => {
    const c = catOf(a.row);
    if (c === "dp") return "DP";
    if (c === "poss") return "P";
    // installment index among installments preceding it
    let k = 0;
    for (let j = 0; j <= i; j++) if (catOf(alloc[j].row) === "inst") k++;
    return String(k);
  };

  // Descriptive fallback label for installments.
  const descLabel = (a: (typeof alloc)[number], i: number) => {
    if (a.row.particulars) return a.row.particulars;
    const c = catOf(a.row);
    if (c === "dp") return "Down Payment";
    if (c === "poss") return "Payment on Possession";
    return `Installment ${idxLabel(a, i)}`;
  };

  // One-click debug: download the last payment-plan trace entry (or the
  // full ring buffer) as a JSON file. The trace is populated by
  // logAllocation() above on every render — this control just serialises
  // whatever is currently on window.__paymentPlanTrace. Hidden from print.
  const exportTrace = (mode: "last" | "all") => {
    try {
      const buf = (typeof window !== "undefined" && (window as any).__paymentPlanTrace) || [];
      if (!Array.isArray(buf) || buf.length === 0) {
        alert("No payment plan trace has been recorded yet.");
        return;
      }
      const payload = mode === "all" ? buf : buf[buf.length - 1];
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const bid = booking?.booking_id ?? "unknown";
      const a = document.createElement("a");
      a.href = url;
      a.download = `payment-plan-trace-${bid}-${mode}-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("[PaymentPlan] trace export failed", e);
    }
  };

  // Per-row diagnostics copy: writes the trace fields for a single flagged
  // row to the clipboard as pretty JSON so support can paste into a ticket.
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const copyRowDiagnostics = async (a: (typeof alloc)[number], idx: number) => {
    const payload = {
      bookingId: booking?.booking_id ?? null,
      idx,
      particulars: a.row.particulars ?? null,
      due_date: a.row.due_date ?? null,
      dueDateValid: !!toDay(a.row.due_date),
      latest_payment_date:
        (payments || []).length > 0
          ? ([...(payments as any[])]
              .map((p) => p?.payment_date)
              .filter(Boolean)
              .sort()
              .at(-1) ?? null)
          : null,
      due: a.due,
      paid: a.paid,
      status: a.status,
      future: a.future,
      paidBeforeDue: a.paidBeforeDue,
      warnings: a.warnings,
      capturedAt: new Date().toISOString(),
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older browsers / insecure contexts.
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopiedIdx(idx);
      window.setTimeout(() => setCopiedIdx((cur) => (cur === idx ? null : cur)), 1600);
    } catch (e) {
      console.error("[PaymentPlan] copy diagnostics failed", e);
    }
  };

  // Per-row expandable payments timeline. Tracks which warned row is open so
  // reviewers can see the exact payment_date values that produced the
  // paidBeforeDue / advance-override decision. Screen-only.
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  // Screen-only filter + sort for the schedule table. Lets a reviewer quickly
  // narrow to rows carrying data-integrity badges ("Check date" for invalid
  // due dates, "Advance verified" for clock-skew overrides). The filter also
  // affects printed output when active — use "Reset" before printing.
  const [rowFilter, setRowFilter] = useState<"all" | "badges" | "check-date" | "advance-verified">(
    "all",
  );
  const [rowSort, setRowSort] = useState<"default" | "due-asc" | "due-desc">("default");

  // Build indexed view: preserve each entry's original index in `alloc` so
  // idxLabel() (which counts installments preceding it) keeps producing
  // stable numbers (DP / 1 / 2 / …) even after filter+sort.
  const viewList = (() => {
    const indexed = alloc.map((a, i) => ({ a, i }));
    const filtered = indexed.filter(({ a }) => {
      const hasInvalid = a.warnings.some((w) => w.startsWith("unparseable due_date"));
      const hasOverride = a.warnings.some((w) => w.startsWith("advance override"));
      if (rowFilter === "all") return true;
      if (rowFilter === "badges") return hasInvalid || hasOverride;
      if (rowFilter === "check-date") return hasInvalid;
      if (rowFilter === "advance-verified") return hasOverride;
      return true;
    });
    if (rowSort !== "default") {
      const dir = rowSort === "due-asc" ? 1 : -1;
      filtered.sort((x, y) => {
        const dx = toDay(x.a.row.due_date)?.getTime() ?? Number.POSITIVE_INFINITY;
        const dy = toDay(y.a.row.due_date)?.getTime() ?? Number.POSITIVE_INFINITY;
        return (dx - dy) * dir;
      });
    }
    return filtered;
  })();

  const badgeCounts = {
    checkDate: alloc.filter((a) => a.warnings.some((w) => w.startsWith("unparseable due_date")))
      .length,
    advanceVerified: alloc.filter((a) => a.warnings.some((w) => w.startsWith("advance override")))
      .length,
  };

  return (
    <div style={{ fontFamily: SANS, color: INK, fontSize: bodyFs, lineHeight: 1.4 }}>
      {/* Screen-only controls: badge filter, sort, and debug trace export. */}
      <div className="print:hidden mb-3 flex flex-wrap items-center justify-end gap-2 text-xs">
        <span className="text-muted-foreground mr-auto">
          Showing <strong>{viewList.length}</strong> of {alloc.length} rows
          {badgeCounts.checkDate + badgeCounts.advanceVerified > 0 && (
            <>
              {" · "}
              <span className="text-destructive font-medium">
                {badgeCounts.checkDate} check-date
              </span>
              {" · "}
              <span className="text-emerald-700 dark:text-emerald-500 font-medium">
                {badgeCounts.advanceVerified} advance-verified
              </span>
            </>
          )}
        </span>
        <label className="flex items-center gap-1">
          <span className="text-muted-foreground">Filter</span>
          <select
            value={rowFilter}
            onChange={(e) => setRowFilter(e.target.value as typeof rowFilter)}
            className="rounded border border-border bg-background px-2 py-1"
          >
            <option value="all">All rows</option>
            <option value="badges">
              Any badge ({badgeCounts.checkDate + badgeCounts.advanceVerified})
            </option>
            <option value="check-date">Check date ({badgeCounts.checkDate})</option>
            <option value="advance-verified">
              Advance verified ({badgeCounts.advanceVerified})
            </option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-muted-foreground">Sort</span>
          <select
            value={rowSort}
            onChange={(e) => setRowSort(e.target.value as typeof rowSort)}
            className="rounded border border-border bg-background px-2 py-1"
          >
            <option value="default">Schedule order</option>
            <option value="due-asc">Due date ↑</option>
            <option value="due-desc">Due date ↓</option>
          </select>
        </label>
        {(rowFilter !== "all" || rowSort !== "default") && (
          <button
            type="button"
            onClick={() => {
              setRowFilter("all");
              setRowSort("default");
            }}
            className="rounded border border-border bg-background px-2 py-1 font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            Reset
          </button>
        )}
        <span className="text-muted-foreground">·</span>
        <button
          type="button"
          onClick={() => exportTrace("last")}
          className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
          title="Download the most recent payment-plan trace entry as JSON"
        >
          Export trace (last)
        </button>
        <button
          type="button"
          onClick={() => exportTrace("all")}
          className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
          title="Download the full trace ring buffer (up to 50 entries) as JSON"
        >
          All (
          {typeof window !== "undefined" && Array.isArray((window as any).__paymentPlanTrace)
            ? (window as any).__paymentPlanTrace.length
            : 0}
          )
        </button>
      </div>

      {/* Warnings summary panel — data-integrity roll-up across all rows.
          Screen-only (print:hidden). Renders only when at least one row
          carries a Check date or Advance verified badge, or produced any
          other warning; otherwise a compact "no issues" line keeps the
          area visually stable. */}
      {(() => {
        const totalWarnings = alloc.reduce((s, a) => s + a.warnings.length, 0);
        const hasAny = badgeCounts.checkDate + badgeCounts.advanceVerified + totalWarnings > 0;
        if (!hasAny) {
          return (
            <div
              className="print:hidden"
              style={{
                marginBottom: "3mm",
                padding: "2mm 3mm",
                border: `0.5pt solid ${RULE}`,
                borderLeft: `2pt solid ${PAID_FG}`,
                borderRadius: "2pt",
                background: PAID_BG,
                color: PAID_FG,
                fontSize: "8pt",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "2mm",
              }}
            >
              <span aria-hidden>✓</span>
              <span>
                No data-integrity warnings across {alloc.length} schedule row
                {alloc.length === 1 ? "" : "s"}.
              </span>
            </div>
          );
        }
        const focusFilter = (mode: "check-date" | "advance-verified" | "badges") => {
          setRowFilter(mode);
          // Scroll the table into view so the reviewer sees the filtered rows.
          const anchor = document.getElementById("payment-plan-schedule");
          if (anchor) anchor.scrollIntoView({ behavior: "smooth", block: "start" });
        };
        return (
          <div
            className="print:hidden"
            role="region"
            aria-label="Payment plan warnings summary"
            style={{
              marginBottom: "3mm",
              padding: "2.5mm 3mm",
              border: `0.5pt solid ${RULE}`,
              borderLeft: `2pt solid ${badgeCounts.checkDate > 0 ? OVERDUE_BORDER : ADVANCE_FG}`,
              borderRadius: "2pt",
              background: "#fffaf5",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "3mm 6mm",
              fontSize: "8pt",
              color: INK,
            }}
          >
            <span
              style={{
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.4px",
                fontSize: "7pt",
                color: LABEL,
              }}
            >
              Warnings
            </span>
            <button
              type="button"
              onClick={() => focusFilter("check-date")}
              disabled={badgeCounts.checkDate === 0}
              title={
                badgeCounts.checkDate === 0
                  ? "No rows with unparseable due dates."
                  : "Filter the schedule to rows whose due_date could not be parsed."
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "1.5mm",
                padding: "1mm 2mm",
                borderRadius: "3pt",
                border: `0.6pt solid ${badgeCounts.checkDate > 0 ? `${OVERDUE_BORDER}55` : "#d1d5db"}`,
                background: badgeCounts.checkDate > 0 ? OVERDUE_BG : "#f5f5f5",
                color: badgeCounts.checkDate > 0 ? OVERDUE_BORDER : LABEL,
                fontWeight: 600,
                cursor: badgeCounts.checkDate > 0 ? "pointer" : "default",
              }}
            >
              <span style={{ fontSize: "10pt", fontWeight: 800 }}>{badgeCounts.checkDate}</span>
              <span>Check date</span>
            </button>
            <button
              type="button"
              onClick={() => focusFilter("advance-verified")}
              disabled={badgeCounts.advanceVerified === 0}
              title={
                badgeCounts.advanceVerified === 0
                  ? "No rows promoted via advance-override."
                  : "Filter the schedule to rows promoted to advance via payment_date ≤ due_date."
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "1.5mm",
                padding: "1mm 2mm",
                borderRadius: "3pt",
                border: `0.6pt solid ${badgeCounts.advanceVerified > 0 ? `${ADVANCE_FG}55` : "#d1d5db"}`,
                background: badgeCounts.advanceVerified > 0 ? ADVANCE_BG : "#f5f5f5",
                color: badgeCounts.advanceVerified > 0 ? ADVANCE_FG : LABEL,
                fontWeight: 600,
                cursor: badgeCounts.advanceVerified > 0 ? "pointer" : "default",
              }}
            >
              <span style={{ fontSize: "10pt", fontWeight: 800 }}>
                {badgeCounts.advanceVerified}
              </span>
              <span>Advance verified</span>
            </button>
            <span style={{ color: SUB }}>
              <span style={{ fontWeight: 700, color: INK }}>{totalWarnings}</span> total warning
              {totalWarnings === 1 ? "" : "s"} across{" "}
              <span style={{ fontWeight: 700, color: INK }}>{alloc.length}</span> row
              {alloc.length === 1 ? "" : "s"}
            </span>
            {badgeCounts.checkDate + badgeCounts.advanceVerified > 0 && (
              <button
                type="button"
                onClick={() => focusFilter("badges")}
                style={{
                  marginLeft: "auto",
                  padding: "1mm 2mm",
                  borderRadius: "3pt",
                  border: `0.6pt solid #d1d5db`,
                  background: "#fff",
                  color: INK,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                title="Filter the schedule to any warned row and scroll it into view."
              >
                Show flagged rows →
              </button>
            )}
          </div>
        );
      })()}

      {/* Doc reference strip — Heights uses a bold "PAYMENT SCHEDULE" pill matching
          the client-facing reference; Arcade keeps the classic all-caps title. */}
      {isHeights ? (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "flex-start",
            gap: "3mm",
            marginBottom: "2mm",
          }}
        >
          <div style={{ textAlign: "right", fontSize: "8pt", color: SUB, lineHeight: 1.5 }}>
            <div style={{ fontFamily: MONO, color: INK }}>
              Plan No.: <span style={{ fontWeight: 700 }}>{planNo}</span>
            </div>
            <div>
              Issue Date: <span style={{ color: INK, fontWeight: 600 }}>{today()}</span>
            </div>
            <div style={{ color: LABEL, letterSpacing: "0.3px", marginTop: "0.6mm" }}>
              NTN # 8169355 · CUI # 0150809
            </div>
          </div>
          <div
            style={{
              background: BRAND,
              color: "#fff",
              padding: "2mm 5mm",
              borderRadius: "3pt",
              fontFamily: SANS,
              fontWeight: 700,
              fontSize: "10.5pt",
              letterSpacing: "1.4px",
              textTransform: "uppercase",
              boxShadow: `0 1.5pt 0 ${ACCENT}`,
              whiteSpace: "nowrap",
            }}
          >
            Payment Schedule
          </div>
        </div>
      ) : (
        <div style={{ textAlign: "right", fontSize: "8pt", color: SUB, marginBottom: "3mm" }}>
          <div
            style={{
              fontFamily: SANS,
              fontWeight: 700,
              fontSize: "11pt",
              color: BRAND,
              letterSpacing: "0.5px",
            }}
          >
            INSTALLMENT PAYMENT PLAN
          </div>
          <div>
            Plan No.:{" "}
            <span style={{ fontWeight: 600, color: INK, fontFamily: MONO }}>{planNo}</span>
          </div>
          <div>Issue Date: {today()}</div>
        </div>
      )}

      {/* Brand + accent divider */}
      <div style={{ height: "2pt", background: BRAND }} />
      <div style={{ height: "0.75pt", background: ACCENT, marginBottom: sectionGap }} />

      {/* Client info grid */}
      <InfoGrid pairs={infoPairs} />

      {/* KPI cards — Total / Received / Remaining / Per Installment.
          Heights uses clean bordered cards (reference style); Arcade keeps
          the brand left-rail accent. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "2.5mm",
          marginBottom: sectionGap,
        }}
      >
        {[
          { lbl: "Total Contract", val: contract, color: INK },
          { lbl: "Received", val: totalReceived, color: PAID_FG },
          {
            lbl: "Remaining",
            val: remaining,
            color: remaining > 0 ? (isHeights ? "#B45309" : OVERDUE_BORDER) : PAID_FG,
          },
          { lbl: "Per Installment", val: perInstallment, color: INK },
        ].map((k, i) => (
          <div
            key={i}
            style={{
              border: `0.6pt solid ${RULE}`,
              borderLeft: isHeights ? `0.6pt solid ${RULE}` : `2pt solid ${BRAND}`,
              borderRadius: isHeights ? "2pt" : 0,
              padding: "2.4mm 3mm",
              background: "#fff",
            }}
          >
            <div
              style={{
                fontSize: "7pt",
                color: LABEL,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                fontWeight: 600,
              }}
            >
              {k.lbl}
            </div>
            <div
              style={{
                fontFamily: MONO,
                fontSize: "11pt",
                fontWeight: 700,
                color: k.color,
                marginTop: "0.8mm",
              }}
            >
              PKR {fmtPKR(k.val)}
            </div>
          </div>
        ))}
      </div>

      {/* Legend — pill meanings (hover for tooltip on-screen) */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "3mm 5mm",
          alignItems: "center",
          padding: "2mm 3mm",
          marginBottom: sectionGap,
          border: `0.5pt dashed ${RULE}`,
          background: "#fcfcfc",
          borderRadius: "2pt",
          fontSize: "7.5pt",
          color: SUB,
          fontFamily: SANS,
        }}
      >
        <span
          style={{
            fontWeight: 700,
            color: LABEL,
            textTransform: "uppercase",
            letterSpacing: "0.4px",
            fontSize: "7pt",
          }}
        >
          Legend
        </span>
        {[
          { s: "Paid" as const, d: "Installment fully cleared." },
          { s: "Advance" as const, d: "Paid ahead of the due date — no action needed." },
          { s: "Partial" as const, d: "Some amount received; balance still owed." },
          { s: "Overdue" as const, d: "Due date has passed and balance is unpaid." },
          { s: "Upcoming" as const, d: "Scheduled for a future due date." },
        ].map(({ s, d }, i) => (
          <span
            key={i}
            title={d}
            style={{ display: "inline-flex", alignItems: "center", gap: "1.8mm" }}
          >
            {statusCell(s as any)}
            <span style={{ color: SUB }}>{d}</span>
          </span>
        ))}
      </div>

      {/* Badge legend — data-integrity flags (screen-only; hidden from print). */}
      <div
        className="print:hidden"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "3mm 5mm",
          alignItems: "center",
          padding: "2mm 3mm",
          marginBottom: sectionGap,
          border: `0.5pt dashed ${RULE}`,
          background: "#fcfcfc",
          borderRadius: "2pt",
          fontSize: "7.5pt",
          color: SUB,
          fontFamily: SANS,
        }}
      >
        <span
          style={{
            fontWeight: 700,
            color: LABEL,
            textTransform: "uppercase",
            letterSpacing: "0.4px",
            fontSize: "7pt",
          }}
        >
          Row Badges
        </span>
        {(
          [
            {
              label: "Check date",
              fg: OVERDUE_BORDER,
              bg: OVERDUE_BG,
              when: "the row's due_date could not be parsed. Row is safely treated as Upcoming — please verify the schedule.",
            },
            {
              label: "Advance verified",
              fg: ADVANCE_FG,
              bg: ADVANCE_BG,
              when: "the latest payment_date is on or before the row's due_date, so it's promoted to future/advance even if the current clock reads past-due (protects against timezone or clock skew).",
            },
          ] as const
        ).map(({ label, fg, bg, when }, i) => (
          <span
            key={i}
            title={when}
            style={{ display: "inline-flex", alignItems: "center", gap: "1.8mm" }}
          >
            <span
              style={{
                display: "inline-block",
                padding: "0.2mm 1.6mm",
                borderRadius: "999px",
                background: bg,
                color: fg,
                border: `0.5pt solid ${fg}55`,
                fontSize: "6.6pt",
                fontWeight: 700,
                letterSpacing: "0.3px",
                textTransform: "uppercase",
              }}
            >
              {label}
            </span>
            <span style={{ color: SUB }}>Appears when {when}</span>
          </span>
        ))}
        <span style={{ color: LABEL, fontStyle: "italic" }}>
          Each flagged row also exposes “Copy diag” and “Show payments” actions for deeper
          inspection.
        </span>
      </div>

      {/* Schedule */}
      <div id="payment-plan-schedule" style={{ scrollMarginTop: "12mm" }}>
        <Bar>Payment Schedule</Bar>
      </div>

      <table
        style={{ width: "100%", borderCollapse: "collapse", fontFamily: SANS, fontSize: bodyFs }}
      >
        <colgroup>
          <col style={{ width: "6%" }} />
          <col style={{ width: "38%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "16%" }} />
        </colgroup>
        <thead>
          <tr style={{ background: BRAND_HEAD, color: "#fff", fontWeight: 700, fontSize: headFs }}>
            <ThX>#</ThX>
            <ThX align="left">Description</ThX>
            <ThX>Due Date</ThX>
            <ThX align="right">Amount</ThX>
            <ThX>Status</ThX>
          </tr>
        </thead>
        <tbody>
          {viewList.length === 0 && (
            <tr>
              <TdX
                colSpan={5}
                style={{ textAlign: "center", padding: "8mm", color: SUB, fontStyle: "italic" }}
              >
                {alloc.length === 0
                  ? "No scheduled installments recorded."
                  : "No rows match the current filter."}
              </TdX>
            </tr>
          )}
          {viewList.flatMap(({ a, i: origIdx }, viewIdx) => {
            // Use original alloc index for stable label/description numbering,
            // and the view index for zebra striping so filtered output still
            // alternates cleanly.
            const i = origIdx;
            const label = idxLabel(a, i);
            const desc = descLabel(a, i);
            const dueDate = catOf(a.row) === "poss" ? "On Possession" : fmtDate(a.row.due_date);
            const odd = viewIdx % 2 === 1;
            const rowBg =
              a.status === "Overdue"
                ? OVERDUE_BG
                : a.status === "Paid"
                  ? PAID_BG
                  : odd
                    ? ZEBRA
                    : "#fff";

            // Data-integrity badge: surfaces unparseable due dates and the
            // "payment predates due date" advance override so a reviewer can
            // spot why a row was reclassified without opening the console trace.
            const hasInvalidDueDate = a.warnings.some((w) => w.startsWith("unparseable due_date"));
            const hasAdvanceOverride = a.warnings.some((w) => w.startsWith("advance override"));
            const showDataBadge = hasInvalidDueDate || hasAdvanceOverride;
            const dataBadgeTip = hasInvalidDueDate
              ? `Due date could not be parsed (${String(a.row.due_date ?? "empty")}). Row is safely treated as Upcoming; please verify the schedule.`
              : `Payment was recorded on or before this due date, so it is treated as an advance payment even though the current clock reads past-due. This protects against timezone or clock-skew errors.`;
            const dataBadgeLabel = hasInvalidDueDate ? "Check date" : "Advance verified";
            const isCopied = copiedIdx === i;
            const DataBadge = showDataBadge ? (
              <>
                <span
                  title={dataBadgeTip}
                  style={{
                    display: "inline-block",
                    marginLeft: "1.8mm",
                    padding: "0.2mm 1.6mm",
                    borderRadius: "999px",
                    background: hasInvalidDueDate ? OVERDUE_BG : ADVANCE_BG,
                    color: hasInvalidDueDate ? OVERDUE_BORDER : ADVANCE_FG,
                    border: `0.5pt solid ${hasInvalidDueDate ? OVERDUE_BORDER : ADVANCE_FG}55`,
                    fontSize: "6.6pt",
                    fontWeight: 700,
                    letterSpacing: "0.3px",
                    textTransform: "uppercase",
                    verticalAlign: "middle",
                    cursor: "help",
                  }}
                >
                  {dataBadgeLabel}
                </span>
                <button
                  type="button"
                  onClick={() => copyRowDiagnostics(a, i)}
                  className="print:hidden"
                  title="Copy this row's trace diagnostics (due_date, dueDateValid, latest_payment_date, warnings) to clipboard"
                  aria-label={`Copy diagnostics for ${a.row.particulars ?? "row"}`}
                  style={{
                    display: "inline-block",
                    marginLeft: "1.2mm",
                    padding: "0.2mm 1.6mm",
                    borderRadius: "999px",
                    background: isCopied ? PAID_BG : "#f5f5f5",
                    color: isCopied ? PAID_FG : "#374151",
                    border: `0.5pt solid ${isCopied ? `${PAID_FG}55` : "#d1d5db"}`,
                    fontSize: "6.6pt",
                    fontWeight: 700,
                    letterSpacing: "0.3px",
                    textTransform: "uppercase",
                    verticalAlign: "middle",
                    cursor: "pointer",
                  }}
                >
                  {isCopied ? "Copied ✓" : "Copy diag"}
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedIdx((cur) => (cur === i ? null : i))}
                  className="print:hidden"
                  title="Show the payment_date values behind this classification"
                  aria-expanded={expandedIdx === i}
                  aria-label={`Toggle payments timeline for ${a.row.particulars ?? "row"}`}
                  style={{
                    display: "inline-block",
                    marginLeft: "1.2mm",
                    padding: "0.2mm 1.6mm",
                    borderRadius: "999px",
                    background: "#f5f5f5",
                    color: "#374151",
                    border: "0.5pt solid #d1d5db",
                    fontSize: "6.6pt",
                    fontWeight: 700,
                    letterSpacing: "0.3px",
                    textTransform: "uppercase",
                    verticalAlign: "middle",
                    cursor: "pointer",
                  }}
                >
                  {expandedIdx === i ? "Hide payments ▴" : "Show payments ▾"}
                </button>
              </>
            ) : null;

            // Chronological payments timeline for this row — rendered as an
            // extra <tr> after the row when the reviewer clicks "Show payments".
            // Highlights payments recorded on or before this row's due date,
            // which is exactly the signal that produces paidBeforeDue / the
            // advance override.
            const dueDayForRow = toDay(a.row.due_date);
            const timelineRow =
              showDataBadge && expandedIdx === i ? (
                <tr
                  key={`${i}-timeline`}
                  className="print:hidden"
                  style={{ background: "#fafafa" }}
                >
                  <TdX colSpan={5} style={{ padding: "2mm 3mm", textAlign: "left" }}>
                    <div style={{ fontSize: "8pt", color: SUB, marginBottom: "1.5mm" }}>
                      <strong style={{ color: INK }}>Payments timeline</strong>
                      {" · "}Due date:{" "}
                      <span style={{ fontFamily: MONO }}>{fmtDate(a.row.due_date) || "—"}</span>
                      {" · "}dueDateValid:{" "}
                      <span style={{ fontFamily: MONO }}>{String(!!dueDayForRow)}</span>
                      {a.warnings.length > 0 && (
                        <>
                          {" · "}
                          <span
                            style={{
                              color: hasInvalidDueDate ? OVERDUE_BORDER : ADVANCE_FG,
                              fontWeight: 600,
                            }}
                          >
                            {a.warnings.length} warning{a.warnings.length === 1 ? "" : "s"}
                          </span>
                        </>
                      )}
                    </div>
                    {(() => {
                      const rows = [...((payments || []) as any[])]
                        .filter((p) => p?.payment_date)
                        .sort((x, y) =>
                          String(x.payment_date).localeCompare(String(y.payment_date)),
                        );
                      if (rows.length === 0) {
                        return (
                          <div style={{ fontSize: "8pt", color: SUB, fontStyle: "italic" }}>
                            No payments with a recorded payment_date on this booking.
                          </div>
                        );
                      }
                      return (
                        <table
                          style={{ width: "100%", borderCollapse: "collapse", fontSize: "8pt" }}
                        >
                          <thead>
                            <tr
                              style={{
                                color: LABEL,
                                textTransform: "uppercase",
                                letterSpacing: "0.3px",
                                fontSize: "7pt",
                              }}
                            >
                              <th style={{ textAlign: "left", padding: "1mm 2mm" }}>#</th>
                              <th style={{ textAlign: "left", padding: "1mm 2mm" }}>
                                Payment date
                              </th>
                              <th style={{ textAlign: "right", padding: "1mm 2mm" }}>Amount</th>
                              <th style={{ textAlign: "left", padding: "1mm 2mm" }}>Mode</th>
                              <th style={{ textAlign: "left", padding: "1mm 2mm" }}>
                                Vs. due date
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((p, k) => {
                              const pd = toDay(p.payment_date);
                              const before =
                                !!pd && !!dueDayForRow && pd.getTime() <= dueDayForRow.getTime();
                              const relLabel = !dueDayForRow
                                ? "n/a (invalid due)"
                                : !pd
                                  ? "n/a (invalid pmt)"
                                  : before
                                    ? "before or on due ✓"
                                    : "after due";
                              const relColor =
                                !dueDayForRow || !pd ? SUB : before ? ADVANCE_FG : OVERDUE_BORDER;
                              return (
                                <tr key={k} style={{ background: k % 2 ? "#fff" : "transparent" }}>
                                  <td style={{ padding: "1mm 2mm", fontFamily: MONO, color: SUB }}>
                                    {k + 1}
                                  </td>
                                  <td style={{ padding: "1mm 2mm", fontFamily: MONO }}>
                                    {fmtDate(p.payment_date)}
                                  </td>
                                  <td
                                    style={{
                                      padding: "1mm 2mm",
                                      fontFamily: MONO,
                                      textAlign: "right",
                                    }}
                                  >
                                    {fmtPKR(Number(p.amount || 0))}
                                  </td>
                                  <td style={{ padding: "1mm 2mm" }}>{p.payment_mode || "—"}</td>
                                  <td
                                    style={{ padding: "1mm 2mm", color: relColor, fontWeight: 600 }}
                                  >
                                    {relLabel}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      );
                    })()}
                    {a.warnings.length > 0 && (
                      <ul
                        style={{
                          marginTop: "1.8mm",
                          paddingLeft: "4mm",
                          fontSize: "7.5pt",
                          color: SUB,
                        }}
                      >
                        {a.warnings.map((w, k) => (
                          <li key={k} style={{ fontFamily: MONO }}>
                            {w}
                          </li>
                        ))}
                      </ul>
                    )}
                  </TdX>
                </tr>
              ) : null;

            if (a.status === "Partial") {
              // Split into Xa (paid portion) + Xb (balance).
              //  · Future due  → Xa "Paid · Advance", Xb "Upcoming" (not overdue).
              //  · Past due    → Xa "Paid", Xb "Overdue" (red rail).
              const balance = a.due - a.paid;
              const aStatus: PlanStatus | "Advance" = a.future ? "Advance" : "Paid";
              const bStatus: PlanStatus | "Due" = a.future ? "Upcoming" : "Overdue";
              const aBg = a.future ? ADVANCE_BG : PAID_BG;
              const bBg = a.future ? (odd ? ZEBRA : "#fff") : OVERDUE_BG;
              const bRail = a.future ? undefined : `2.5pt solid ${OVERDUE_BORDER}`;
              const aLabelSuffix = a.future ? "Paid in Advance" : "Partial Paid";
              const bLabelSuffix = a.future ? "Remaining · Not Yet Due" : "Balance Due";
              const advanceTip = a.future
                ? `This installment isn't due until ${fmtDate(a.row.due_date)}. PKR ${fmtPKR(a.paid)} was received ahead of schedule and applied here automatically; the remaining PKR ${fmtPKR(balance)} stays scheduled and is not overdue.`
                : `Partial payment of PKR ${fmtPKR(a.paid)} received against a due amount of PKR ${fmtPKR(a.due)}. Balance of PKR ${fmtPKR(balance)} is overdue.`;
              return [
                <tr key={`${i}-a`} title={advanceTip} style={{ background: aBg, height: rowH }}>
                  <TdX>{label}a</TdX>
                  <TdX align="left">
                    {desc} · {aLabelSuffix}
                    {a.future && (
                      <span
                        title={advanceTip}
                        style={{
                          display: "inline-block",
                          marginLeft: "1.8mm",
                          padding: "0.2mm 1.6mm",
                          borderRadius: "999px",
                          background: ADVANCE_BG,
                          color: ADVANCE_FG,
                          border: `0.5pt solid ${ADVANCE_FG}55`,
                          fontSize: "6.6pt",
                          fontWeight: 700,
                          letterSpacing: "0.3px",
                          textTransform: "uppercase",
                          verticalAlign: "middle",
                          cursor: "help",
                        }}
                      >
                        Why?
                      </span>
                    )}
                    {DataBadge}
                  </TdX>
                  <TdX>{dueDate}</TdX>
                  <TdX align="right" mono>
                    {fmtPKR(a.paid)}
                  </TdX>
                  <TdX>{statusCell(aStatus)}</TdX>
                </tr>,
                <tr
                  key={`${i}-b`}
                  title={advanceTip}
                  style={{ background: bBg, height: rowH, borderLeft: bRail }}
                >
                  <TdX>{label}b</TdX>
                  <TdX align="left">
                    {desc} · {bLabelSuffix}
                  </TdX>
                  <TdX>{dueDate}</TdX>
                  <TdX align="right" mono>
                    {fmtPKR(balance)}
                  </TdX>
                  <TdX>{statusCell(bStatus)}</TdX>
                </tr>,
                timelineRow,
              ];
            }

            return [
              <tr
                key={i}
                style={{
                  background: rowBg,
                  height: rowH,
                  borderLeft: a.status === "Overdue" ? `2.5pt solid ${OVERDUE_BORDER}` : undefined,
                }}
              >
                <TdX>{label}</TdX>
                <TdX align="left">
                  {desc}
                  {DataBadge}
                </TdX>
                <TdX>{dueDate}</TdX>
                <TdX align="right" mono>
                  {a.due ? fmtPKR(a.due) : "—"}
                </TdX>
                <TdX>{statusCell(a.status)}</TdX>
              </tr>,
              timelineRow,
            ];
          })}
          {isHeights ? (
            <tr
              style={{
                background: PAID_BG,
                color: BRAND,
                fontWeight: 700,
                borderTop: `1pt solid ${BRAND}`,
              }}
            >
              <TdX
                colSpan={3}
                align="left"
                style={{
                  padding: "2mm 3mm",
                  color: BRAND,
                  textTransform: "uppercase",
                  letterSpacing: "0.6px",
                  fontSize: "8.5pt",
                }}
              >
                Total Contract Value
              </TdX>
              <TdX align="right" mono style={{ color: BRAND, fontSize: "10pt" }}>
                {fmtPKR(contract)}
              </TdX>
              <TdX style={{ color: `${BRAND}AA`, fontSize: "6.8pt", fontWeight: 600 }}>
                DP · Inst · Poss
              </TdX>
            </tr>
          ) : (
            <tr style={{ background: BRAND, color: ACCENT_TXT, fontWeight: 700 }}>
              <TdX colSpan={3} align="right" style={{ padding: "1.8mm 3mm", color: ACCENT_TXT }}>
                TOTAL CONTRACT VALUE
              </TdX>
              <TdX align="right" mono style={{ color: ACCENT_TXT }}>
                {fmtPKR(contract)}
              </TdX>
              <TdX style={{ color: ACCENT_TXT, fontSize: "7pt" }}>
                DP {fmtPKR(dpTotal)} · Inst {fmtPKR(instTotal)} · Poss {fmtPKR(possessionAmt)}
              </TdX>
            </tr>
          )}
        </tbody>
      </table>

      {/* Overdue underline */}
      {overdueAmt > 0 && (
        <div
          style={{
            marginTop: "3mm",
            padding: "2mm 0",
            borderBottom: `1pt solid ${OVERDUE_BORDER}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            color: OVERDUE_BORDER,
          }}
        >
          <span style={{ fontSize: "9pt" }}>
            Overdue Installments (as of {today()}): {overdueCount}
          </span>
          <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: "11pt" }}>
            PKR {fmtPKR(overdueAmt)}
          </span>
        </div>
      )}

      {/* Terms */}
      <div
        style={{
          marginTop: sectionGap,
          fontSize: tier === 2 ? "7pt" : "7.5pt",
          color: "#444",
          lineHeight: 1.55,
          fontStyle: isHeights ? "italic" : "normal",
        }}
      >
        {!isHeights && (
          <>
            <strong style={{ color: BRAND }}>Terms &amp; Conditions:</strong>{" "}
          </>
        )}
        Installments are payable on or before the due date. Amounts received in excess of any
        instalment are automatically applied to the next due instalment in chronological order. Late
        payments may attract a surcharge as per the sale agreement. Possession is subject to full
        clearance of the possession payment and all quarterly dues. Any discrepancy must be reported
        to the Accounts Office in writing within seven (7) days of issuance. All amounts are in
        Pakistani Rupees (PKR).
      </div>

      <SignatureBlock />

      {/* Footer rule */}
      <div style={{ marginTop: "5mm" }}>
        <div style={{ height: "0.5pt", background: ACCENT }} />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            fontSize: "7pt",
            color: LABEL,
            paddingTop: "1.5mm",
          }}
        >
          <span>
            {isHeights ? "Manal Heights" : "Manal Arcade"} · Precise Realtors &amp; Builders (Pvt.)
            Ltd.
          </span>
          <span style={{ textAlign: "center" }}>Plan {planNo}</span>
          <span style={{ textAlign: "right" }}>Computer-generated</span>
        </div>
      </div>
    </div>
  );
}

function Th({ children, right }: any) {
  return (
    <th
      style={{
        border: "0.4pt solid #1B2B4B66",
        padding: "1.5mm 2mm",
        textAlign: right ? "right" : "left",
        fontWeight: 700,
        fontSize: "9.5pt",
      }}
    >
      {children}
    </th>
  );
}
function Td({ children, right, strong, colSpan }: any) {
  return (
    <td
      colSpan={colSpan}
      style={{
        border: "0.4pt solid #1B2B4B33",
        padding: "1.2mm 2mm",
        textAlign: right ? "right" : "left",
        fontWeight: strong ? 700 : 400,
        fontVariantNumeric: right ? "tabular-nums" : undefined,
      }}
    >
      {children}
    </td>
  );
}

/* ---------- DOC 3 — ALLOTMENT LETTER ---------- */

function AllotmentDoc({ booking, payments, adjustments }: any) {
  const proj = projectInfo(booking);
  const contract = Number(booking.total_contract_value ?? 0);
  const dp = Number(booking.down_payment || 0) + adjAllowed(adjustments) || cashOnly(payments);
  return (
    <>
      <RefRow left={`Ref: ${ref(booking.unit_id, "ALLOT")}`} right={`Date: ${today()}`} />
      <H>Allotment Letter</H>
      <To booking={booking} />
      <p>
        <strong>Subject:</strong> Allotment of {booking.unit_type} No. {booking.unit_id} —{" "}
        {proj.short.startsWith("B-17") ? proj.name + ", " + proj.short : proj.address}
      </p>
      <p>
        Dear {clientTitle(booking)} <span className="capitalize">{booking.client_name}</span>,
      </p>
      <p>
        We are pleased to inform you that pursuant to your booking application dated{" "}
        <strong>{fmtDate(booking.booking_date)}</strong> and receipt of the initial payment, Precise
        Realtors &amp; Builders (Pvt.) Ltd. hereby formally allots you the following unit:
      </p>

      <SubH>Allotted Unit Details</SubH>
      <table style={{ width: "100%", fontSize: "10.5pt" }}>
        <tbody>
          <tr>
            <td style={{ width: "35%", padding: "1mm 0" }}>Project:</td>
            <td>{proj.name}</td>
          </tr>
          <tr>
            <td style={{ padding: "1mm 0" }}>Location:</td>
            <td>Plot No. 04, Block B-1 Markaz, Sector B-17, Islamabad</td>
          </tr>
          <tr>
            <td style={{ padding: "1mm 0" }}>Unit Type:</td>
            <td>{booking.unit_type}</td>
          </tr>
          <tr>
            <td style={{ padding: "1mm 0" }}>Unit No.:</td>
            <td style={{ fontFamily: "monospace" }}>{booking.unit_id}</td>
          </tr>
          <tr>
            <td style={{ padding: "1mm 0" }}>Floor:</td>
            <td>{booking.floor || "—"}</td>
          </tr>
          <tr>
            <td style={{ padding: "1mm 0" }}>Covered Area:</td>
            <td>{booking.size_sqft ?? "—"} Sq. Ft. (Approximately)</td>
          </tr>
          <tr>
            <td style={{ padding: "1mm 0" }}>Total Sale Price:</td>
            <td>
              <strong>{pkrSlash(contract)}</strong> ({amountInWordsPK(contract)})
            </td>
          </tr>
          <tr>
            <td style={{ padding: "1mm 0" }}>Booking ID:</td>
            <td style={{ fontFamily: "monospace" }}>{booking.booking_id}</td>
          </tr>
        </tbody>
      </table>

      <SubH>Payment Terms</SubH>
      <table style={{ width: "100%", fontSize: "10.5pt" }}>
        <tbody>
          <SumRow label="Down Payment Received" value={pkrSlash(dp)} />
          <SumRow
            label="Remaining Installments"
            value={`${booking.no_of_installments ?? 0} ${booking.installment_frequency ?? ""} of ${pkrSlash(booking.installment_amount)} each`}
          />
          <SumRow label="First Installment Due" value={fmtDate(booking.first_installment_due)} />
          <SumRow label="Possession Amount" value={pkrSlash(booking.possession_amount)} />
        </tbody>
      </table>

      <p>This allotment is subject to the following terms and conditions:</p>
      <ol style={{ paddingLeft: "5mm" }}>
        <li>
          <strong>Payment Compliance:</strong> You shall pay all installments strictly on the due
          dates. Failure to pay three (3) or more consecutive installments shall result in automatic
          cancellation, forfeiture of 20% of the total sale price, and re-allotment without further
          notice.
        </li>
        <li>
          <strong>Possession:</strong> Physical possession shall be handed over upon receipt of all
          installments and possession amount and subject to completion of construction.
        </li>
        <li>
          <strong>Transfer:</strong> This allotment is non-transferable without prior written
          consent. Transfer fee as per Company policy shall be applicable.
        </li>
        <li>
          <strong>Modifications:</strong> No structural modifications shall be made without prior
          written permission.
        </li>
        <li>
          <strong>Title:</strong> The Company warrants that the property is free from all
          encumbrances and third-party claims. Sale deed shall be executed upon receipt of all dues.
        </li>
        <li>
          <strong>Force Majeure:</strong> The Company shall not be liable for delays caused by
          factors beyond its control.
        </li>
        <li>
          <strong>Dispute Resolution:</strong> Any dispute shall first be resolved through mutual
          negotiation; failing which, referred to competent courts in Islamabad.
        </li>
      </ol>

      <p>
        Please acknowledge receipt of this Allotment Letter by signing and returning the enclosed
        copy. Congratulations on your investment in {proj.name}.
      </p>

      <SignatureBlock />
      <SubH>Acknowledgment (Client Copy)</SubH>
      <p style={{ fontSize: "10pt" }}>
        I/We, <strong className="capitalize">{booking.client_name}</strong>, CNIC{" "}
        <span style={{ fontFamily: "monospace" }}>{booking.cnic}</span>, hereby acknowledge receipt
        of the Allotment Letter for {booking.unit_type} No. {booking.unit_id}, {proj.name}, dated{" "}
        {today()}.
      </p>
      <div style={{ marginTop: "10mm", fontSize: "10pt" }}>
        <div>Signature: ____________________________ &nbsp;&nbsp; Date: ____________________</div>
      </div>
    </>
  );
}

/* ---------- DOC 4 — POSSESSION LETTER ---------- */

function PossessionDoc({ booking, payments, adjustments }: any) {
  const proj = projectInfo(booking);
  const contract = Number(booking.total_contract_value ?? 0);
  const totalReceived = cashOnly(payments) + totalAdjustmentCredit(adjustments, payments);
  return (
    <>
      <RefRow left={`Ref: ${ref(booking.unit_id, "POSS")}`} right={`Date: ${today()}`} />
      <H>Possession Letter</H>
      <To booking={booking} />
      <p>
        <strong>Subject:</strong> Grant of Possession — {booking.unit_type} No. {booking.unit_id},{" "}
        {proj.name}, {proj.short}
      </p>
      <p>
        Dear {clientTitle(booking)} <span className="capitalize">{booking.client_name}</span>,
      </p>
      <p>
        With reference to the Agreement to Sell dated{" "}
        <strong>{fmtDate(booking.booking_date)}</strong> and Allotment Letter Ref:
        <span style={{ fontFamily: "monospace" }}> {ref(booking.unit_id, "ALLOT")}</span>, we
        confirm that you have completed all financial obligations in respect of:
      </p>
      <table style={{ width: "100%", fontSize: "10.5pt" }}>
        <tbody>
          <SumRow
            label="Unit"
            value={`${booking.unit_type} No. ${booking.unit_id}, Floor ${booking.floor || "—"}`}
          />
          <SumRow label="Project" value={proj.plot} />
          <SumRow
            label="Covered Area"
            value={`${booking.size_sqft ?? "—"} Sq. Ft. (Approximately)`}
          />
          <SumRow label="Total Contract Value" value={pkrSlash(contract)} strong />
          <SumRow label="Total Received" value={pkrSlash(totalReceived)} strong />
        </tbody>
      </table>
      <p>
        Accordingly, Precise Realtors &amp; Builders (Pvt.) Ltd. hereby grants you formal{" "}
        <strong>POSSESSION</strong> of the above-mentioned unit with effect from{" "}
        <strong>{today()}</strong>.
      </p>
      <p>Please note the following:</p>
      <ol style={{ paddingLeft: "5mm" }}>
        <li>
          The keys and access to {booking.unit_type} No. {booking.unit_id} are hereby handed over to
          you.
        </li>
        <li>
          Inspect the unit and raise any snag / defect list within fifteen (15) days of possession.
        </li>
        <li>Maintenance charges shall be payable from the date of possession.</li>
        <li>
          Complete all remaining legal documentation including Sale Deed / Transfer within sixty
          (60) days from the date of this letter.
        </li>
        <li>No structural modifications shall be made without prior written approval.</li>
        <li>
          All utilities are to be registered in your name; the Company shall provide necessary NOC
          upon request.
        </li>
      </ol>

      <SubH>Handover Acknowledgment</SubH>
      <p style={{ fontSize: "10pt" }}>
        I, <strong className="capitalize">{booking.client_name}</strong>, CNIC{" "}
        <span style={{ fontFamily: "monospace" }}>{booking.cnic}</span>, hereby acknowledge receipt
        of possession of {booking.unit_type} No. {booking.unit_id}, {proj.name}, on {today()} in
        satisfactory condition.
      </p>
      <div style={{ fontSize: "10pt", marginTop: "4mm" }}>
        <div>
          Keys Received: ____________________ &nbsp;&nbsp; Condition of Unit: ____________________
        </div>
      </div>
      <SignatureBlock />
    </>
  );
}

/* ---------- DOC 5 — PROVISIONAL POSSESSION LETTER ---------- */

function ProvPossessionDoc({ booking, payments, adjustments }: any) {
  const proj = projectInfo(booking);
  const contract = Number(booking.total_contract_value ?? 0);
  const totalReceived = cashOnly(payments) + totalAdjustmentCredit(adjustments, payments);
  const remaining = Math.max(contract - totalReceived, 0);
  const deadlineDays = 30;
  const deadline = new Date(Date.now() + deadlineDays * 24 * 60 * 60 * 1000);
  return (
    <>
      <RefRow left={`Ref: ${ref(booking.unit_id, "PROV-POSS")}`} right={`Date: ${today()}`} />
      <H>Provisional Possession Letter</H>
      <To booking={booking} />
      <p>
        <strong>Subject:</strong> Grant of Provisional Possession — {booking.unit_type} No.{" "}
        {booking.unit_id}, {proj.name}
      </p>
      <p>
        Dear {clientTitle(booking)} <span className="capitalize">{booking.client_name}</span>,
      </p>
      <p>
        With reference to the Agreement to Sell dated{" "}
        <strong>{fmtDate(booking.booking_date)}</strong> in respect of {booking.unit_type} No.{" "}
        {booking.unit_id}, Floor {booking.floor}, {proj.address}, and taking into consideration your
        payment record and written request, Precise Realtors &amp; Builders (Pvt.) Ltd. hereby
        grants you <strong>PROVISIONAL POSSESSION</strong>:
      </p>

      <SubH>Account Status as of {today()}</SubH>
      <table style={{ width: "100%", fontSize: "10.5pt" }}>
        <tbody>
          <SumRow label="Total Contract Value" value={pkrSlash(contract)} />
          <SumRow label="Total Amount Received" value={pkrSlash(totalReceived)} />
          <SumRow label="Outstanding Balance" value={pkrSlash(remaining)} strong />
          <SumRow label="Outstanding in Words" value={amountInWordsPK(remaining)} />
        </tbody>
      </table>

      <SubH>Terms of Provisional Possession</SubH>
      <ol style={{ paddingLeft: "5mm" }}>
        <li>
          <strong>Outstanding Payment:</strong> Clear the remaining balance of{" "}
          <strong>{pkrSlash(remaining)}</strong> ({amountInWordsPK(remaining)}) within{" "}
          <strong>{deadlineDays} days</strong>, i.e., by <strong>{fmtDate(deadline)}</strong>.
        </li>
        <li>
          <strong>Conditional Access:</strong> Limited access for inspection and minor interior work
          only. No structural modifications, permanent fixtures, or renovation until full payment.
        </li>
        <li>
          <strong>No Title Transfer:</strong> Provisional possession does not confer any title,
          ownership, or legal right.
        </li>
        <li>
          <strong>No Subletting or Sale:</strong> You shall not sublet, sell, transfer, mortgage, or
          create any third-party interest.
        </li>
        <li>
          <strong>Utilities:</strong> Utilities remain in the Company's name until formal
          possession.
        </li>
        <li>
          <strong>Default:</strong> Failure to clear by <strong>{fmtDate(deadline)}</strong> shall
          automatically revoke this provisional possession.
        </li>
        <li>
          <strong>Formal Possession:</strong> Upon receipt of the remaining balance, a formal
          Possession Letter shall be issued.
        </li>
      </ol>

      <SubH>Acknowledgment</SubH>
      <p style={{ fontSize: "10pt" }}>
        I, <strong className="capitalize">{booking.client_name}</strong>, CNIC{" "}
        <span style={{ fontFamily: "monospace" }}>{booking.cnic}</span>, understand and accept all
        the above terms.
      </p>
      <SignatureBlock />
    </>
  );
}

/* ---------- DOC 6 — DEPOSIT SUMMARY ---------- */

function DepositSummaryDoc({ booking, payments, adjustments }: any) {
  const proj = projectInfo(booking);
  const contract = Number(booking.total_contract_value ?? 0);
  const cash = cashOnly(payments);
  const adjA = adjAllowed(adjustments);
  const adjR = adjRealized(adjustments);
  const totalReceived = cash + (adjA || nonCashPayments(payments));
  const remaining = Math.max(contract - totalReceived, 0);
  const overdueAmt = Number(booking.total_overdue_amount || 0);

  // Group cash by head
  const cashByHead = (head: RegExp) =>
    payments
      .filter((p: any) => !p.non_cash_adjustment && head.test(p.payment_head || ""))
      .reduce((s: number, p: any) => s + Number(p.safe_cash_amount || 0), 0);
  const dpCash = cashByHead(/down/i);
  const instCash = cashByHead(/install/i);
  const otherCash = Math.max(cash - dpCash - instCash, 0);

  let running = 0;
  const chronologic = [...payments].sort((a, b) =>
    (a.payment_date || "").localeCompare(b.payment_date || ""),
  );
  return (
    <>
      <RefRow left={`Ref: ${ref(booking.unit_id, "STMT")}`} right={`Date: ${today()}`} />
      <H>Deposit / Payment Account Statement</H>
      <table style={{ width: "100%", fontSize: "10.5pt" }}>
        <tbody>
          <tr>
            <td style={{ padding: "1mm 0", width: "25%" }}>Client Name:</td>
            <td className="capitalize">
              <strong>{booking.client_name}</strong>
            </td>
            <td style={{ padding: "1mm 0", width: "18%" }}>Booking ID:</td>
            <td style={{ fontFamily: "monospace" }}>{booking.booking_id}</td>
          </tr>
          <tr>
            <td style={{ padding: "1mm 0" }}>CNIC:</td>
            <td style={{ fontFamily: "monospace" }}>{booking.cnic}</td>
            <td>Booking Date:</td>
            <td>{fmtDate(booking.booking_date)}</td>
          </tr>
          <tr>
            <td style={{ padding: "1mm 0" }}>Phone:</td>
            <td style={{ fontFamily: "monospace" }}>{booking.mobile}</td>
            <td>Unit:</td>
            <td>
              {booking.unit_type} No. {booking.unit_id}, Floor {booking.floor}
            </td>
          </tr>
          <tr>
            <td colSpan={4} style={{ padding: "1mm 0" }}>
              Total Contract Value: <strong>{pkrSlash(contract)}</strong>
            </td>
          </tr>
        </tbody>
      </table>

      <SubH>Payment History</SubH>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "9.5pt" }}>
        <thead>
          <tr style={{ background: "#1B2B4B0d" }}>
            <Th>Sr.</Th>
            <Th>Date</Th>
            <Th>Receipt No.</Th>
            <Th>Type</Th>
            <Th>Head</Th>
            <Th right>Amount (PKR)</Th>
            <Th right>Running</Th>
          </tr>
        </thead>
        <tbody>
          {chronologic.map((p: any, i: number) => {
            running += Number(p.amount || 0);
            return (
              <tr key={p.receipt_no || i}>
                <Td>{i + 1}</Td>
                <Td>{fmtDate(p.payment_date)}</Td>
                <Td>{p.receipt_no}</Td>
                <Td>{p.payment_mode}</Td>
                <Td>{p.payment_head}</Td>
                <Td right>{fmtPKR(p.amount)}</Td>
                <Td right>{fmtPKR(running)}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <SubH>Account Summary</SubH>
      <table style={{ width: "100%", fontSize: "10.5pt" }}>
        <tbody>
          <SumRow label="Total Contract Value" value={pkr(contract)} strong />
        </tbody>
      </table>
      <div style={{ fontSize: "10.5pt", marginTop: "3mm", fontWeight: 700 }}>
        Cash / Bank Receipts
      </div>
      <table style={{ width: "100%", fontSize: "10.5pt" }}>
        <tbody>
          <SumRow label="Down Payment (Cash)" value={pkr(dpCash)} />
          <SumRow label="Installment Payments Received" value={pkr(instCash)} />
          <SumRow label="Other Receipts" value={pkr(otherCash)} />
          <SumRow label="Sub-Total Cash / Bank" value={pkr(cash)} strong />
        </tbody>
      </table>
      <div style={{ fontSize: "10.5pt", marginTop: "3mm", fontWeight: 700 }}>Adjustment Credit</div>
      <table style={{ width: "100%", fontSize: "10.5pt" }}>
        <tbody>
          <SumRow label="Asset / Property Given as Down Payment (Approved)" value={pkr(adjA)} />
          <SumRow label="Note: Asset realized by Company — Internal Record" value={pkr(adjR)} />
          <SumRow label="Sub-Total Adjustment" value={pkr(adjA)} strong />
        </tbody>
      </table>
      <table style={{ width: "100%", fontSize: "10.5pt", marginTop: "3mm" }}>
        <tbody>
          <SumRow label="TOTAL RECEIVED (Cash + Adjustment)" value={pkr(totalReceived)} strong />
          <SumRow label="OUTSTANDING BALANCE" value={pkr(remaining)} strong />
          <SumRow label="OVERDUE AMOUNT (Past Due)" value={pkr(overdueAmt)} strong />
        </tbody>
      </table>

      <p style={{ fontSize: "9.5pt", color: "#444", marginTop: "5mm" }}>
        Note: This statement is prepared based on payments recorded in Company books. Any
        discrepancy should be reported to the accounts office within 7 days. Amounts shown in
        Pakistani Rupees. This statement is for information only and is not a receipt or voucher.
      </p>
      <SignatureBlock role="Authorized Signatory" />
    </>
  );
}

/* ---------- DOC 7 — DEMAND NOTICE ---------- */

function DemandNoticeDoc({ booking, ledger }: any) {
  const proj = projectInfo(booking);
  const overdue = ledger.filter(
    (l: any) => (l.status || "").toLowerCase() === "overdue" || (l.days_overdue ?? 0) > 0,
  );
  const overdueAmt = overdue.reduce(
    (s: number, l: any) => s + (Number(l.due_amount || 0) - Number(l.paid_amount || 0)),
    0,
  );
  const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return (
    <>
      <RefRow
        left={`Ref: ${refSerial(booking.unit_id, "DEM", booking.booking_id)} `}
        right={`Date: ${today()} · Through: WhatsApp / Email / Courier`}
      />
      <H>Demand Notice</H>
      <To booking={booking} />
      <p>
        <strong>Subject:</strong> Demand Notice for Outstanding Installment(s) — {booking.unit_type}{" "}
        No. {booking.unit_id}, {proj.name}
      </p>
      <p>
        Dear {clientTitle(booking)} <span className="capitalize">{booking.client_name}</span>,
      </p>
      <p>
        This is to bring to your kind attention that as per Company records, the following
        installment(s) against your booking of {booking.unit_type} No. {booking.unit_id},
        {proj.address} (Booking ID:{" "}
        <span style={{ fontFamily: "monospace" }}>{booking.booking_id}</span>) are currently
        outstanding:
      </p>

      <SubH>Overdue Installments</SubH>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10pt" }}>
        <thead>
          <tr style={{ background: "#1B2B4B0d" }}>
            <Th>Sr.</Th>
            <Th>Description</Th>
            <Th>Due Date</Th>
            <Th right>Amount (PKR)</Th>
          </tr>
        </thead>
        <tbody>
          {overdue.map((l: any, i: number) => (
            <tr key={l.ledger_id}>
              <Td>{i + 1}</Td>
              <Td>{l.particulars || `Installment ${l.term_no ?? ""}`}</Td>
              <Td>{fmtDate(l.due_date)}</Td>
              <Td right>{fmtPKR(Number(l.due_amount || 0) - Number(l.paid_amount || 0))}</Td>
            </tr>
          ))}
          {overdue.length === 0 && (
            <tr>
              <Td colSpan={4}>No overdue installments on record.</Td>
            </tr>
          )}
        </tbody>
      </table>
      <p style={{ marginTop: "3mm" }}>
        <strong>Total Outstanding Amount:</strong> {pkrSlash(overdueAmt)} (
        {amountInWordsPK(overdueAmt)})
      </p>
      <p>
        You are hereby requested to clear the above-mentioned dues within{" "}
        <strong>seven (7) days</strong> of receipt of this notice, i.e., by{" "}
        <strong>{fmtDate(deadline)}</strong>.
      </p>

      <SubH>Company Bank Account</SubH>
      <div
        style={{
          fontSize: "10.5pt",
          padding: "2mm 3mm",
          border: "0.5pt solid #1B2B4B33",
          background: "#f7f7f7",
        }}
      >
        <div>
          <strong>Bank:</strong> Al Habib Limited
        </div>
        <div>
          <strong>Account Title:</strong> Precise Realtors &amp; Builders (Pvt.) Ltd.
        </div>
        <div>
          <strong>Account No.:</strong> 0440-0981-002027-01-4
        </div>
        <div>
          <strong>IBAN:</strong> PK12BAHL0440098100202701
        </div>
      </div>
      <p>
        After payment, please WhatsApp the transaction slip to <strong>+92 344 5533767</strong>.
      </p>
      <p>
        We trust this matter is an oversight and you shall clear the outstanding amount promptly.
        Failure to respond to this Demand Notice will compel the Company to issue a formal legal
        notice as per the terms of the Booking Agreement.
      </p>

      <div style={{ marginTop: "12mm", fontSize: "10pt" }}>
        <div>For and on behalf of</div>
        <div>
          <strong>Precise Realtors &amp; Builders (Pvt.) Ltd.</strong>
        </div>
        <div style={{ marginTop: "12mm" }}>Accounts / Recovery Department</div>
      </div>
    </>
  );
}

/* ---------- DOC 8 — TRANSFER FORM ---------- */

function TransferFormDoc({ booking, payments, adjustments }: any) {
  const proj = projectInfo(booking);
  const contract = Number(booking.total_contract_value ?? 0);
  const totalReceived = cashOnly(payments) + totalAdjustmentCredit(adjustments, payments);
  const remaining = Math.max(contract - totalReceived, 0);
  return (
    <>
      <RefRow
        left={`Ref: ${refSerial(booking.unit_id, "TRANS", booking.booking_id)}`}
        right={`Date: ${today()}`}
      />
      <H>Booking Transfer Form</H>
      <table style={{ width: "100%", fontSize: "10.5pt" }}>
        <tbody>
          <tr>
            <td style={{ width: "30%", padding: "1mm 0" }}>Project:</td>
            <td>{proj.address}</td>
          </tr>
          <tr>
            <td style={{ padding: "1mm 0" }}>Unit:</td>
            <td>
              {booking.unit_type} No. {booking.unit_id}, Floor {booking.floor},{" "}
              {booking.size_sqft ?? "—"} Sq. Ft.
            </td>
          </tr>
          <tr>
            <td style={{ padding: "1mm 0" }}>Booking ID:</td>
            <td style={{ fontFamily: "monospace" }}>{booking.booking_id}</td>
          </tr>
          <tr>
            <td style={{ padding: "1mm 0" }}>Original Booking Date:</td>
            <td>{fmtDate(booking.booking_date)}</td>
          </tr>
        </tbody>
      </table>

      <SubH>Part I — Transferor (Original Buyer)</SubH>
      <table style={{ width: "100%", fontSize: "10.5pt" }}>
        <tbody>
          <SumRow label="Full Name" value={booking.client_name} />
          <SumRow label="Father / Husband Name" value={booking.so_wo || "—"} />
          <SumRow label="CNIC" value={booking.cnic || "—"} />
          <SumRow label="Phone" value={booking.mobile || "—"} />
          <SumRow label="Address" value={booking.address || "—"} />
          <SumRow label="Total Paid to Date" value={pkrSlash(totalReceived)} strong />
          <SumRow label="Outstanding Balance" value={pkrSlash(remaining)} strong />
        </tbody>
      </table>

      <SubH>Part II — Transferee (New Buyer)</SubH>
      <BlankLine label="Full Name" />
      <BlankLine label="Father / Husband Name" prefix="S/O / W/O " />
      <BlankLine label="CNIC" />
      <BlankLine label="Phone (WhatsApp)" />
      <BlankLine label="Address" />

      <SubH>Part III — Transfer Details</SubH>
      <BlankLine label="Transfer Amount (between parties)" suffix=" PKR" />
      <BlankLine label="Transfer Fee (payable to Company)" suffix=" PKR" />
      <BlankLine label="Transfer Fee Payment Date" />
      <BlankLine label="Transfer Fee Receipt No." />
      <BlankLine label="Reason for Transfer" />

      <SubH>Part IV — Outstanding Balance</SubH>
      <p style={{ fontSize: "10pt" }}>
        The Transferee acknowledges that the outstanding balance of{" "}
        <strong>{pkrSlash(remaining)}</strong> is payable to the Company as per the original payment
        schedule. The Transferee agrees to be bound by all terms of the original Booking Agreement
        and Allotment Letter and shall be responsible for all future installment payments.
      </p>

      <SubH>Part V — Declarations</SubH>
      <p style={{ fontSize: "10pt" }}>
        <strong>Transferor:</strong> I, <span className="capitalize">{booking.client_name}</span>,
        CNIC <span style={{ fontFamily: "monospace" }}>{booking.cnic}</span>, hereby confirm that I
        am voluntarily transferring my booking/allotment rights for {booking.unit_type} No.{" "}
        {booking.unit_id}, {proj.name}, to the Transferee named above, free from all disputes,
        encumbrances, and claims.
      </p>
      <div style={{ fontSize: "10pt" }}>
        Signature: ____________________ &nbsp; Date: ____________________
      </div>
      <p style={{ fontSize: "10pt", marginTop: "4mm" }}>
        <strong>Transferee:</strong> I, _______________________, CNIC ________________, hereby
        accept the transfer of the above booking and agree to abide by all terms. I acknowledge the
        outstanding balance of <strong>{pkrSlash(remaining)}</strong> and commit to clear all future
        installments on time.
      </p>
      <div style={{ fontSize: "10pt" }}>
        Signature: ____________________ &nbsp; Date: ____________________
      </div>

      <SubH>Company Approval</SubH>
      <p style={{ fontSize: "10pt" }}>
        Precise Realtors &amp; Builders (Pvt.) Ltd. hereby approves the above transfer of
        booking/allotment effective <strong>{today()}</strong>, subject to receipt of the transfer
        fee and all documentation as required.
      </p>
      <SignatureBlock />

      <SubH>Witnesses</SubH>
      <div style={{ fontSize: "10pt", lineHeight: 1.9 }}>
        1. Name: ___________________ &nbsp; CNIC: ___________________ &nbsp; Signature:
        ___________________
        <br />
        2. Name: ___________________ &nbsp; CNIC: ___________________ &nbsp; Signature:
        ___________________
      </div>
    </>
  );
}

function BlankLine({ label, prefix, suffix }: { label: string; prefix?: string; suffix?: string }) {
  return (
    <div style={{ fontSize: "10pt", padding: "1mm 0" }}>
      <span style={{ display: "inline-block", width: "55mm" }}>{label}:</span>
      <span>
        {prefix}_____________________________________{suffix}
      </span>
    </div>
  );
}

/* ---------- DOC 9 — AGREEMENT TO SELL ---------- */

function SaleAgreementDoc({ booking, adjustments }: any) {
  const proj = projectInfo(booking);
  const contract = Number(booking.total_contract_value ?? 0);
  const dpCash = Number(booking.down_payment || 0);
  const adjA = adjAllowed(adjustments);
  return (
    <>
      <RefRow
        left={`Ref: ${ref(booking.unit_id, "AGREE")}/${booking.booking_id}`}
        right={`Date: ${today()}`}
      />
      <H>Agreement to Sell</H>
      <p>
        This Agreement to Sell (“Agreement”) is executed on this <strong>{today()}</strong> at
        Islamabad.
      </p>
      <p>
        <strong>BETWEEN:</strong>
      </p>
      <p>
        <strong>SELLER:</strong> Precise Realtors &amp; Builders (Pvt.) Ltd., a company incorporated
        under the Companies Act 2017, having NTN 8169355 and CUI 0150809, with its registered office
        at {proj.officeAddress}, hereinafter referred to as the “Company” or “Seller”.
      </p>
      <p>
        <strong>AND</strong>
      </p>
      <p>
        <strong>PURCHASER:</strong> <span className="capitalize">{booking.client_name}</span>,{" "}
        {fatherLine(booking)}, CNIC <span style={{ fontFamily: "monospace" }}>{booking.cnic}</span>,
        Phone <span style={{ fontFamily: "monospace" }}>{booking.mobile}</span>, Address:{" "}
        {booking.address}, hereinafter referred to as the “Purchaser” or “Buyer”.
      </p>

      <SubH>Property Description</SubH>
      <table style={{ width: "100%", fontSize: "10.5pt" }}>
        <tbody>
          <SumRow label="Project" value={proj.name} />
          <SumRow label="Location" value="Plot No. 04, Block B-1 Markaz, Sector B-17, Islamabad" />
          <SumRow label="Unit Type" value={booking.unit_type} />
          <SumRow label="Unit No." value={booking.unit_id} />
          <SumRow label="Floor" value={booking.floor || "—"} />
          <SumRow label="Covered Area" value={`${booking.size_sqft ?? "—"} Sq. Ft. (Approx.)`} />
        </tbody>
      </table>

      <SubH>Sale Consideration</SubH>
      <p>
        <strong>Total Sale Price:</strong> {pkrSlash(contract)} ({amountInWordsPK(contract)})
      </p>

      <SubH>Payment Schedule</SubH>
      <ol style={{ paddingLeft: "5mm" }}>
        <li>Down Payment: {pkrSlash(dpCash)} (Paid at signing — Receipt No. _______)</li>
        <li>
          Adjustment / Asset Credit: {pkrSlash(adjA)} (Asset: ___________________________________)
        </li>
        <li>
          Installments: {booking.no_of_installments ?? 0} {booking.installment_frequency ?? ""}{" "}
          installments of {pkrSlash(booking.installment_amount)} each. First installment due:{" "}
          {fmtDate(booking.first_installment_due)}
        </li>
        <li>
          Possession Amount: {pkrSlash(booking.possession_amount)} (Payable at time of possession)
        </li>
      </ol>
      <p>
        <strong>Total: {pkrSlash(contract)}</strong>
      </p>

      <SubH>Terms and Conditions</SubH>
      <ol style={{ paddingLeft: "5mm", fontSize: "10pt" }}>
        <li>
          <strong>Title:</strong> The Seller warrants good and marketable title, free from all
          encumbrances. Sale Deed shall be executed upon receipt of all consideration.
        </li>
        <li>
          <strong>Payment Obligation:</strong> Purchaser shall pay all installments on due dates.
          Time is of the essence.
        </li>
        <li>
          <strong>Default and Cancellation:</strong> Failure to pay three (3) consecutive
          installments shall entitle the Company to cancel by written notice, forfeit 20% of the
          total sale price, and refund any balance within sixty (60) days after re-allotment/resale,
          subject to final reconciliation.
        </li>
        <li>
          <strong>Possession:</strong> Possession shall be handed over subject to receipt of all
          installments and possession amount, completion of construction, and execution of all
          required legal documentation. Expected possession date:{" "}
          <strong>{fmtDate(booking.possession_due_date)}</strong>.
        </li>
        <li>
          <strong>Construction and Specifications:</strong> Variations up to ±5% in area or
          specifications shall not entitle the Purchaser to any claim.
        </li>
        <li>
          <strong>Transfer/Assignment:</strong> No transfer without prior written consent. Transfer
          fee per Company policy.
        </li>
        <li>
          <strong>Maintenance Charges:</strong> Payable from date of possession.
        </li>
        <li>
          <strong>Modifications:</strong> No structural modifications without prior written
          approval.
        </li>
        <li>
          <strong>Indemnity:</strong> Purchaser shall indemnify the Company from any claims arising
          from any act or default of the Purchaser.
        </li>
        <li>
          <strong>Force Majeure:</strong> Neither Party shall be liable for delays caused by events
          beyond reasonable control.
        </li>
        <li>
          <strong>Dispute Resolution:</strong> Amicable resolution within 30 days; failing which,
          arbitration under applicable law; courts in Islamabad shall have exclusive jurisdiction.
        </li>
        <li>
          <strong>Governing Law:</strong> Laws of the Islamic Republic of Pakistan, including the
          Contract Act 1872 and Transfer of Property Act 1882.
        </li>
        <li>
          <strong>Entire Agreement:</strong> This Agreement supersedes all prior discussions.
          Amendments must be in writing.
        </li>
        <li>
          <strong>Notices:</strong> All notices shall be in writing, delivered by hand, TCS, or
          WhatsApp.
        </li>
      </ol>

      <p>
        IN WITNESS WHEREOF, the Parties have executed this Agreement on the date and at the place
        first mentioned above.
      </p>

      <div
        style={{
          marginTop: "10mm",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "10mm",
          fontSize: "10pt",
        }}
      >
        <div>
          <div>
            <strong>FOR PRECISE REALTORS &amp; BUILDERS (PVT.) LTD.</strong>
          </div>
          <div style={{ borderTop: "1px solid #000", marginTop: "16mm", paddingTop: "1.5mm" }}>
            Authorized Signatory
          </div>
          <div>Name: ___________________________</div>
          <div>Designation: _____________________</div>
          <div>Company Stamp: ___________________</div>
        </div>
        <div>
          <div>
            <strong>PURCHASER</strong>
          </div>
          <div style={{ borderTop: "1px solid #000", marginTop: "16mm", paddingTop: "1.5mm" }}>
            <span className="capitalize">{booking.client_name}</span>
          </div>
          <div>
            CNIC: <span style={{ fontFamily: "monospace" }}>{booking.cnic}</span>
          </div>
          <div>Date: ___________________________</div>
        </div>
      </div>

      <SubH>Witnesses</SubH>
      <div style={{ fontSize: "10pt", lineHeight: 1.9 }}>
        1. Name: __________________ CNIC: __________________ Address: __________________ Signature:
        __________________
        <br />
        2. Name: __________________ CNIC: __________________ Address: __________________ Signature:
        __________________
      </div>
    </>
  );
}

/* ---------- fallback ---------- */

function GenericDoc({ booking }: any) {
  const proj = projectInfo(booking);
  return (
    <div style={{ fontSize: "11pt", lineHeight: 1.6 }}>
      <H>Document</H>
      <p>
        No template defined for this document type. Booking: <strong>{booking.booking_id}</strong>
      </p>
    </div>
  );
}

/* ---------- DOCS 10–13 — LEGAL NOTICES ---------- */

function overdueRowsFrom(ledger: any[]) {
  return (ledger || []).filter(
    (l: any) => (l.status || "").toLowerCase() === "overdue" || (l.days_overdue ?? 0) > 0,
  );
}
function overdueAmtFrom(rows: any[]) {
  return rows.reduce(
    (s: number, l: any) => s + (Number(l.due_amount || 0) - Number(l.paid_amount || 0)),
    0,
  );
}
function addDaysISO(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
function fmtPrev(s: string) {
  return s ? fmtDate(s) : "____________";
}
function BankBlockDV({ email = "manalarcade@gmail.com" }: { email?: string } = {}) {
  // DHA / Emaar-style printable bank panel: navy header bar, gold rule,
  // 2-col labelled grid, mono digits. Stays together across page breaks.
  const NAVY = "#1B2B4B";
  const GOLD = "#C9A84C";
  const LABEL = "#666";
  const MONO = '"Courier New", Courier, monospace';
  const Cell = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
    <div style={{ padding: "1.6mm 3mm" }}>
      <div
        style={{
          fontSize: "7.5pt",
          color: LABEL,
          textTransform: "uppercase",
          letterSpacing: "0.3px",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "10pt",
          fontWeight: 700,
          color: "#000",
          fontFamily: mono ? MONO : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
  return (
    <div
      style={{
        margin: "3mm 0",
        border: `1pt solid ${NAVY}`,
        breakInside: "avoid",
        pageBreakInside: "avoid",
      }}
    >
      <div
        style={{
          background: NAVY,
          color: "#fff",
          padding: "1.5mm 3mm",
          fontSize: "8.5pt",
          fontWeight: 700,
          letterSpacing: "0.5px",
          textTransform: "uppercase",
        }}
      >
        Designated Company Bank Account — Payment Instructions
      </div>
      <div style={{ height: "0.75pt", background: GOLD }} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        <div style={{ borderRight: "0.5pt solid #e0e0e0" }}>
          <Cell label="Bank" value="Bank Al Habib Limited" />
          <div style={{ borderTop: "0.5pt solid #eee" }}>
            <Cell label="Account Title" value="Precise Realtors & Builders (Pvt.) Ltd." />
          </div>
        </div>
        <div>
          <Cell label="Account No." value="0440-0981-002027-01-4" mono />
          <div style={{ borderTop: "0.5pt solid #eee" }}>
            <Cell label="IBAN" value="PK12 BAHL 0440 0981 0020 2701" mono />
          </div>
        </div>
      </div>
      <div
        style={{
          borderTop: `0.5pt solid #e0e0e0`,
          padding: "1.4mm 3mm",
          fontSize: "8.5pt",
          color: "#444",
        }}
      >
        Share transaction slip via <strong>WhatsApp +92 344 5533767</strong> or email
        <strong> {email}</strong> for prompt credit to your account.
      </div>
    </div>
  );
}

function SubjectLineDV({ children }: { children: React.ReactNode }) {
  // Bold uppercase subject line w/ navy left rail + bottom hairline so it
  // reads as a formal heading and never orphans from the body below.
  return (
    <div
      style={{
        margin: "4mm 0 3mm",
        padding: "1.6mm 3mm 1.8mm",
        borderLeft: "3pt solid #1B2B4B",
        borderBottom: "0.5pt solid #d9d9d9",
        background: "#f7f8fb",
        fontSize: "10.5pt",
        lineHeight: 1.4,
        breakInside: "avoid",
        pageBreakInside: "avoid",
      }}
    >
      <span
        style={{
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.3px",
          color: "#1B2B4B",
          marginRight: "4mm",
        }}
      >
        Subject:
      </span>
      <span style={{ fontWeight: 700 }}>{children}</span>
    </div>
  );
}

function OverdueTableDV({ rows }: { rows: any[] }) {
  if (!rows?.length) return null;
  const NAVY = "#1B2B4B";
  const NAVY_HEAD = "#2d3f5e";
  const GOLD_TEXT = "#E8D5A3";
  const MONO = '"Courier New", Courier, monospace';
  const total = rows.reduce(
    (s: number, l: any) => s + (Number(l.due_amount || 0) - Number(l.paid_amount || 0)),
    0,
  );
  const tight = rows.length > 10;
  const fs = tight ? "9pt" : "9.5pt";
  const pad = tight ? "1mm 2mm" : "1.4mm 2mm";
  return (
    <div style={{ margin: "3mm 0", breakInside: "avoid", pageBreakInside: "avoid" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: fs,
          border: `0.6pt solid ${NAVY}`,
        }}
      >
        <colgroup>
          <col style={{ width: "6%" }} />
          <col style={{ width: "46%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "28%" }} />
        </colgroup>
        <thead>
          <tr style={{ background: NAVY_HEAD, color: "#fff" }}>
            <th style={{ padding: pad, textAlign: "center", fontWeight: 700 }}>#</th>
            <th style={{ padding: pad, textAlign: "left", fontWeight: 700 }}>Description</th>
            <th style={{ padding: pad, textAlign: "center", fontWeight: 700 }}>Due Date</th>
            <th style={{ padding: pad, textAlign: "right", fontWeight: 700 }}>Outstanding (PKR)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l: any, i: number) => {
            const bal = Number(l.due_amount || 0) - Number(l.paid_amount || 0);
            return (
              <tr key={l.ledger_id ?? i} style={{ background: i % 2 === 1 ? "#fafafa" : "#fff" }}>
                <td
                  style={{ padding: pad, textAlign: "center", borderBottom: "0.4pt solid #e8e8e8" }}
                >
                  {i + 1}
                </td>
                <td
                  style={{ padding: pad, textAlign: "left", borderBottom: "0.4pt solid #e8e8e8" }}
                >
                  {l.particulars || `Installment ${l.term_no ?? ""}`}
                </td>
                <td
                  style={{ padding: pad, textAlign: "center", borderBottom: "0.4pt solid #e8e8e8" }}
                >
                  {fmtDate(l.due_date)}
                </td>
                <td
                  style={{
                    padding: pad,
                    textAlign: "right",
                    borderBottom: "0.4pt solid #e8e8e8",
                    fontFamily: MONO,
                  }}
                >
                  {fmtPKR(bal)}
                </td>
              </tr>
            );
          })}
          <tr style={{ background: NAVY, color: GOLD_TEXT, fontWeight: 700 }}>
            <td colSpan={3} style={{ padding: pad, textAlign: "right" }}>
              TOTAL OUTSTANDING
            </td>
            <td style={{ padding: pad, textAlign: "right", fontFamily: MONO }}>
              PKR {fmtPKR(total)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// A4 print shell for legal notices: locks body font (10.5pt / 1.55 line-height
// / justified) so paragraphs print evenly and signatures don't orphan.
function LegalShellDV({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: '"Calibri", Arial, sans-serif',
        fontSize: "10.5pt",
        lineHeight: 1.55,
        color: "#000",
        textAlign: "justify",
        hyphens: "auto",
      }}
    >
      {children}
    </div>
  );
}

function LegalShowCauseDoc({ booking, ledger }: any) {
  const proj = projectInfo(booking);
  const rows = overdueRowsFrom(ledger);
  const amt = overdueAmtFrom(rows);
  const deadline = addDaysISO(15);
  return (
    <LegalShellDV>
      <RefRow
        left={`Ref: ${refSerial(booking.unit_id, "LEG", booking.booking_id)}`}
        right={`Date: ${today()}`}
      />
      <H>Legal Notice (Show Cause)</H>
      <To booking={booking} />
      <SubjectLineDV>
        Show Cause Notice for Non-Payment of Installments — {booking.unit_type} No.{" "}
        {booking.unit_id}, {proj.NAME}, B-17 Islamabad
      </SubjectLineDV>
      <p>
        Dear {clientTitle(booking)} <span className="capitalize">{booking.client_name}</span>,
      </p>
      <p>
        This is to formally notify you, as per the records of Precise Realtors and Builders Pvt.
        Ltd., that despite repeated reminders, you have failed to clear the outstanding installments
        against {booking.unit_type} No. {booking.unit_id}, {proj.NAME}, {proj.short}. Such continued
        default is a material breach of the booking.
      </p>
      <p>
        You are hereby given a final opportunity to clear your outstanding dues as per the following
        instructions:
      </p>
      <p>
        <strong>Required Action:</strong>
      </p>
      <ol style={{ paddingLeft: "5mm" }}>
        <li>
          Pay the outstanding amount of <strong>{pkrSlash(amt)}</strong> ({amountInWordsPK(amt)})
          within fifteen (15) days into the Company's designated account (see panel below).
        </li>
        <li>Provide a written explanation justifying the delay within the same period.</li>
        <li>
          Submit proof of payment via email to <strong>{proj.email}</strong> and WhatsApp at{" "}
          <strong>+92 344 5533767</strong>.
        </li>
      </ol>
      <BankBlockDV email={proj.email} />
      <p>
        <strong>Consequences of Non-Compliance:</strong> If full payment is not received within the
        stipulated fifteen (15) days (by <strong>{fmtDate(deadline)}</strong>), your allotment of{" "}
        {booking.unit_type} No. {booking.unit_id} shall be cancelled without further notice. Precise
        Realtors and Builders Pvt. Ltd. shall be entitled to resell the {booking.unit_type} to
        another buyer. Any amounts previously paid shall be subject to deductions as per company
        policy, and no further claims shall be entertained.
      </p>
      <p>This is the final and binding notice. No extension of time shall be granted.</p>
      <SubH>Overdue Installments Detail</SubH>
      <OverdueTableDV rows={rows} />
      <SignatureBlock />
      <p style={{ fontSize: "9pt", marginTop: "4mm", color: "#444", fontStyle: "italic" }}>
        This notice is being served through registered courier and additionally forwarded to your
        WhatsApp number for record purposes.
      </p>
    </LegalShellDV>
  );
}

function FinalLegalNoticeDoc({ booking, ledger, prev1 }: any) {
  const proj = projectInfo(booking);
  const rows = overdueRowsFrom(ledger);
  const amt = overdueAmtFrom(rows);
  const deadline = addDaysISO(10);
  return (
    <LegalShellDV>
      <RefRow
        left={`Ref: ${refSerial(booking.unit_id, "FLN", booking.booking_id)}`}
        right={`Date: ${today()}`}
      />
      <H>Final Legal Notice</H>
      <To booking={booking} />
      <SubjectLineDV>
        Final Legal Notice for Non-Payment of Installments — {booking.unit_type} No.{" "}
        {booking.unit_id}, {proj.NAME}, B-17 Islamabad
      </SubjectLineDV>
      <p>
        This Final Legal Notice is hereby issued on behalf of Precise Realtors and Builders Pvt.
        Ltd.
      </p>
      <p>
        You were previously served with a legal notice dated <strong>{fmtPrev(prev1)}</strong>{" "}
        regarding your persistent failure to clear outstanding installments in respect of{" "}
        {booking.unit_type} No. {booking.unit_id}, {proj.NAME}, B-17, Islamabad. Despite lawful
        service, you have neither responded nor made payment and continue to remain in willful
        default.
      </p>
      <p>
        Your conduct constitutes a material and continuing breach of the Booking Agreement executed
        with the Company.
      </p>
      <p>
        You are hereby called upon, for the final and last time, to deposit the outstanding amount
        of <strong>{pkrSlash(amt)}</strong> ({amountInWordsPK(amt)}) within ten (10) days from
        receipt of this notice (by <strong>{fmtDate(deadline)}</strong>) into the Company's
        designated account shown below.
      </p>
      <BankBlockDV email={proj.email} />
      <p>
        Failing compliance, and strictly in accordance with the Booking Agreement, the Company shall
        without further notice be entitled to:
      </p>
      <ol style={{ paddingLeft: "5mm" }}>
        <li>
          Cancel your booking/allotment of {booking.unit_type} No. {booking.unit_id} automatically.
        </li>
        <li>Resell or re-allot the {booking.unit_type} to any third party at its discretion.</li>
        <li>
          Deduct twenty percent (20%) of the total unit price upon third-party sale towards
          cancellation charges, expenses, and damages.
        </li>
        <li>
          Refund any remaining balance, if applicable, only after resale, subject to verification
          and Company policy.
        </li>
        <li>
          Treat you as having no right, title, interest, or claim whatsoever in the{" "}
          {booking.unit_type}; and
        </li>
        <li>
          Initiate appropriate civil and/or criminal proceedings at your risk as to cost and
          consequences, without prejudice to other remedies.
        </li>
      </ol>
      <p>
        This notice is final, binding, and conclusive. No extension, waiver, or concession shall be
        granted.
      </p>
      <OverdueTableDV rows={rows} />
      <SignatureBlock />
      <p style={{ fontSize: "9pt", marginTop: "4mm", color: "#444", fontStyle: "italic" }}>
        This notice is being served through registered courier and simultaneously transmitted via
        WhatsApp for due service, record, and evidentiary purposes.
      </p>
    </LegalShellDV>
  );
}

function FinalCancelWarningDoc({ booking, ledger, prev1, prev2 }: any) {
  const proj = projectInfo(booking);
  const rows = overdueRowsFrom(ledger);
  const amt = overdueAmtFrom(rows);
  const deadline = addDaysISO(10);
  return (
    <LegalShellDV>
      <RefRow
        left={`Ref: ${refSerial(booking.unit_id, "FLN-CAN", booking.booking_id)}`}
        right={`Date: ${today()}`}
      />
      <H>Final Legal Notice — Cancellation Warning</H>
      <div
        style={{
          textAlign: "center",
          fontWeight: 700,
          fontSize: "10.5pt",
          margin: "-3mm 0 4mm",
          letterSpacing: "0.4px",
          color: "#1B2B4B",
        }}
      >
        (CANCELLATION, TERMINATION OF RIGHTS &amp; FINAL DEMAND)
      </div>
      <To booking={booking} />
      <SubjectLineDV>
        FINAL NOTICE — Cancellation of Booking &amp; Termination of Rights Due to Persistent Default
        — {booking.unit_type} No. {booking.unit_id}, {proj.NAME}, B-17 Islamabad
      </SubjectLineDV>
      <p>
        This Final Legal Notice is issued on behalf of{" "}
        <strong>PRECISE REALTORS &amp; BUILDERS (PVT.) LTD.</strong> in continuation of earlier
        legal notices duly served upon you, including the notice dated{" "}
        <strong>{fmtPrev(prev1)}</strong> and the Final Legal Notice dated{" "}
        <strong>{fmtPrev(prev2)}</strong>, whereby you were called upon to clear your outstanding
        liability.
      </p>
      <p>
        Under the Agreement to Sell dated <strong>{fmtDate(booking.booking_date)}</strong>, you
        purchased {booking.unit_type} No. {booking.unit_id} (approximately{" "}
        {booking.size_sqft ?? "____"} sq. ft.) in {proj.NAME},{" "}
        {proj.isHeights
          ? "Block B-17, Multi Gardens, Islamabad"
          : "Plot No. 04, Block B-1 Markaz, Sector B-17, Islamabad"}
        , and were obligated to pay all installments as per the agreed payment schedule.
      </p>
      <p>
        As per Company records, the outstanding amount payable by you is{" "}
        <strong>{pkrSlash(amt)}</strong> ({amountInWordsPK(amt)}).
      </p>
      <p>
        Despite repeated notices, reminders, and sufficient opportunity, you have willfully failed
        to discharge your contractual obligations.
      </p>
      <p>
        <strong style={{ color: "#1B2B4B" }}>FINAL AND LAST OPPORTUNITY</strong>
      </p>
      <p>
        You are hereby granted a final, strict, and non-extendable period of ten (10) days from{" "}
        <strong>{today()}</strong> (by <strong>{fmtDate(deadline)}</strong>) to:
      </p>
      <ol style={{ paddingLeft: "5mm" }}>
        <li>
          Pay the entire outstanding amount of <strong>{pkrSlash(amt)}</strong> into the Company's
          designated account (see panel below).
        </li>
        <li>
          Submit proof of payment via WhatsApp at <strong>+92 344 5533767</strong>.
        </li>
      </ol>
      <BankBlockDV email={proj.email} />
      <OverdueTableDV rows={rows} />
      <p>
        <strong style={{ color: "#1B2B4B" }}>CONSEQUENCES OF DEFAULT</strong>
      </p>
      <p>Take Final Notice That upon your failure to comply within the stipulated period:</p>
      <ul style={{ paddingLeft: "5mm" }}>
        <li>
          Your booking/allotment shall be cancelled automatically, without any further notice or
          correspondence.
        </li>
        <li>
          You shall cease to have any right, title, interest, claim, or lien whatsoever in respect
          of the said {booking.unit_type}.
        </li>
        <li>
          The Company shall be fully and absolutely entitled to resell, re-allot, transfer, or
          otherwise dispose of the said property to any third party, at its sole discretion, without
          any reference to you.
        </li>
        <li>
          Any amounts previously paid by you shall be adjusted, forfeited, and/or dealt with
          strictly in accordance with the terms of the Agreement, including recovery of losses,
          damages, and costs.
        </li>
        <li>
          The Company shall be at liberty of initiating appropriate civil and/or criminal
          proceedings, including but not limited to action under applicable laws, entirely at your
          risk as to cost and consequences.
        </li>
      </ul>
      <p>
        This notice is issued without prejudice to all rights, remedies, and claims available to the
        Company under the Agreement and applicable law.
      </p>
      <p style={{ fontSize: "9pt", color: "#444", fontStyle: "italic" }}>
        This Final Notice is being served through registered courier and electronic means (including
        WhatsApp) for proper service, record, and evidentiary purposes.
      </p>
      <SignatureBlock />
    </LegalShellDV>
  );
}

function CancellationNoticeDoc({ booking, ledger, prev1, prev2 }: any) {
  const proj = projectInfo(booking);
  const rows = overdueRowsFrom(ledger);
  const amt = overdueAmtFrom(rows);
  return (
    <LegalShellDV>
      <RefRow
        left={`Ref: ${refSerial(booking.unit_id, "CAN", booking.booking_id)}`}
        right={`Date: ${today()}`}
      />
      <H>Final Cancellation Notice</H>
      <To booking={booking} />
      <SubjectLineDV>
        Cancellation of Booking / Allotment of {booking.unit_type} No. {booking.unit_id},{" "}
        {proj.NAME}, B-17 Islamabad
      </SubjectLineDV>
      <p>
        Dear {clientTitle(booking)} <span className="capitalize">{booking.client_name}</span>,
      </p>
      <p>
        This is to formally notify you that despite service of previous notices, including the Legal
        Notice dated <strong>{fmtPrev(prev1)}</strong> and Final Legal Notice dated{" "}
        <strong>{fmtPrev(prev2)}</strong>, you have failed to clear the outstanding amount of{" "}
        <strong>{pkrSlash(amt)}</strong> against {booking.unit_type} No. {booking.unit_id},{" "}
        {proj.NAME}, {proj.short}.
      </p>
      <p>
        Your continued default constitutes a material breach of the booking/allotment terms.
        Therefore, Precise Realtors &amp; Builders (Pvt.) Ltd. hereby cancels your booking/allotment
        of {booking.unit_type} No. {booking.unit_id} with immediate effect.
      </p>
      <p>
        Consequently, you shall have no right, title, interest, lien, claim, possession claim, or
        demand in respect of the said {booking.unit_type}. The Company is entitled to
        resell/re-allot the {booking.unit_type} to any third party and to deduct 20% of the total
        unit price, along with all outstanding dues, damages, costs, charges, expenses, and any
        other lawful deductions as per agreement/company policy.
      </p>
      <p>
        Any remaining balance, if legally payable, shall be considered only after
        resale/re-allotment and final reconciliation of accounts. Any payment made after this notice
        shall not revive the booking unless expressly accepted in writing by the Company through an
        authorized signatory.
      </p>
      <p>
        This cancellation is final, binding, conclusive, and without prejudice to all legal rights
        and remedies of the Company.
      </p>
      <OverdueTableDV rows={rows} />
      <div
        style={{
          margin: "3mm 0",
          padding: "2mm 3mm",
          border: "0.5pt solid #1B2B4B33",
          background: "#f7f8fb",
          fontSize: "9.5pt",
          breakInside: "avoid",
          pageBreakInside: "avoid",
        }}
      >
        <div
          style={{
            fontWeight: 700,
            color: "#1B2B4B",
            textTransform: "uppercase",
            letterSpacing: "0.3px",
            fontSize: "8.5pt",
            marginBottom: "1mm",
          }}
        >
          Mode of Service
        </div>
        <div>
          Served via TCS courier and also forwarded through WhatsApp for record and legal purposes.
        </div>
        <div style={{ marginTop: "1mm" }}>
          TCS Tracking No.: ____________________ &nbsp;·&nbsp; WhatsApp: +92 344 5533767
        </div>
      </div>
      <SignatureBlock />
    </LegalShellDV>
  );
}
