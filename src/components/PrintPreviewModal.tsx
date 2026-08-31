import {
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createFitState,
  fitStep,
  FIT_MIN,
  FIT_MAX,
  type FitState as FitStateLib,
} from "@/lib/fitToOnePage";
import {
  recordFitRun,
  downloadLatestFitTrail,
  buildLatestFitTrailReport,
} from "@/lib/fitTelemetry";
import { buildImpossibleFitMessage } from "@/lib/impossibleFitMessage";
import { FitSummary } from "@/components/print/FitSummary";
import { FitTrailPanel } from "@/components/print/FitTrailPanel";
import { PrintDebugOverlay } from "@/components/PrintDebugOverlay";
import { PrintLayoutDebugOverlay } from "@/components/PrintLayoutDebugOverlay";
import {
  downloadPreviewSheetsAsPdf,
  PDF_PROGRESS_LABEL,
  type PdfProgressStage,
} from "@/lib/downloadPreviewPdf";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Printer,
  X,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ListChecks,
  CheckCircle2,
  Download,
  Image as ImageIcon,
  Settings2,
  RotateCcw,
  Ruler,
  RectangleHorizontal,
  RectangleVertical,
  FileText,
  Loader2,
  Bug,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LetterheadHeader,
  LetterheadFooter,
  LetterheadStyle,
  HEADER_H_MM,
  FOOTER_H_MM,
  PAGE_MARGIN_MM,
  PRINT_CSS,
} from "@/lib/letterhead";
import {
  LOGO_PICKER_ITEMS,
  loadSelectedLogoId,
  saveSelectedLogoId,
  AUTO_LOGO_ID,
  DEFAULT_LOGO_ID,
  resolveLogoOption,
} from "@/lib/logos";
import AutoLogoEditor from "@/components/AutoLogoEditor";
import { preparePrint } from "@/lib/printFlow";
import { downloadPrintDebugBundle } from "@/lib/printDebugBundle";
import {
  PAPER_PRESETS,
  PaperPresetId,
  getPaperPreset,
  loadPaperPresetId,
  savePaperPresetId,
  DEFAULT_PAPER_PRESET_ID,
} from "@/lib/paperPresets";
import { useServerFn } from "@tanstack/react-start";
import { uploadPrintDiagnostics } from "@/lib/printDiagnosticsShare.functions";
import { Share2 } from "lucide-react";

/**
 * Page geometry is driven by the active paper preset (A4 or Letter). The
 * letterhead's header/footer bands are the same physical height for both,
 * so the safe writing area is preset.height − (2× preset.margin) − header
 * − footer.
 */
const MM_TO_PX = 96 / 25.4;

const PRINT_FONT = '"Times New Roman", Georgia, serif';
const RECEIPT_SAFE_MARGIN_MM = 5;
// Preview and native print must use the SAME scale so what the user sees
// on-screen matches what the browser prints. We use the safer "compact"
// value (86%) — the extra ~6% gutter is what actually prevents Chrome/Edge
// printer drivers from clipping the bottom copy of a dual-copy receipt.
const RECEIPT_COMPACT_SCALE_PCT = 86;
const RECEIPT_SAFE_SCALE_PCT = RECEIPT_COMPACT_SCALE_PCT;

// Shared receipt print CSS lives in `src/lib/receiptPrintStyles.ts` so both
// the on-screen preview (this modal) and the standalone PaymentReceipt
// template can inject the same non-clipping rules. `RECEIPT_SHARED_STYLES`
// covers every `.pp-receipt`; `PAYMENT_RECEIPT_PRINT_STYLES` adds the
// dual-copy A4 layout scoped to `.pp-receipt.pp-payment-receipt`.
import { RECEIPT_SHARED_STYLES, PAYMENT_RECEIPT_PRINT_STYLES } from "@/lib/receiptPrintStyles";

type TextMode = { mode: "text"; body: string };
type ReactMode = { mode: "react"; children: ReactNode };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Letterhead style — A (notices) or B (transactional). Defaults to B. */
  style?: LetterheadStyle;
  /** Document type (e.g. "receipt", "legal-notice") — used by Auto logo to honour per-doc overrides. */
  docType?: string | null;
  /**
   * When true, the shared LetterheadHeader / LetterheadFooter bands are
   * NOT rendered around the document body. Use for documents that carry
   * their own branded header/footer (e.g. the dual-copy payment receipt),
   * so the letterhead doesn't stack on top of an embedded header.
   */
  hideLetterhead?: boolean;
  /** If provided, the Print button calls this instead of the browser print dialog. */
  onConfirmPrint?: () => void;
  /** If provided, the Export PDF button calls this instead of the browser print dialog. */
  onConfirmExport?: () => void;
  /** Force React content into exactly one physical sheet (used by payment slips). */
  forceSinglePage?: boolean;
  /**
   * When set, the modal opens invisibly and immediately triggers the browser
   * print dialog once layout has settled. The user picks "Save as PDF" in the
   * dialog to download using the *same* print-safe layout as native printing.
   * Bypasses the setup checklist since the caller explicitly asked for it.
   */
  autoAction?: "print" | null;
  /** Project name — drives the Style A brand title (Manal Heights vs Manal Arcade). */
  projectName?: string | null;
  /**
   * Optional per-stage readiness timeout overrides (milliseconds). Each stage
   * (fonts / images / layout) is timed independently; whichever finishes first
   * "wins" and the remainder can still fail on its own limit. Defaults live in
   * DEFAULT_READINESS_TIMEOUTS below.
   */
  readinessTimeouts?: Partial<Record<"fonts" | "images" | "layout", number>>;
  /** Optional booking context — surfaced in the Attempts timeline filter bar
   *  so operators diagnosing a specific booking can narrow the log. */
  bookingId?: string | null;
  bookingLabel?: string | null;
} & (TextMode | ReactMode);

/** Default per-stage readiness limits (ms). Kept in sync with the values
 *  shown in the timeout-error panel so users see the exact active limits. */
const DEFAULT_READINESS_TIMEOUTS = {
  fonts: 4000,
  images: 4000,
  layout: 2000,
} as const;

/* ------------------------------------------------------------------ */

function paginateText(
  lines: string[],
  contentWmm: number,
  contentHpx: number,
  bodyPt: number,
  lineHeight: number,
): string[][] {
  const measurer = document.createElement("div");
  measurer.style.cssText = `
    position: fixed; left: -10000px; top: 0;
    width: ${contentWmm}mm;
    font-family: ${PRINT_FONT};
    font-size: ${bodyPt}pt; line-height: ${lineHeight};
    white-space: pre-wrap; word-wrap: break-word;
    visibility: hidden;
  `;
  document.body.appendChild(measurer);

  const pages: string[][] = [[]];
  let pageH = 0;
  for (const raw of lines) {
    const probe = document.createElement("div");
    probe.textContent = raw.length ? raw : "\u00A0";
    measurer.appendChild(probe);
    const h = probe.getBoundingClientRect().height;
    if (pageH + h > contentHpx && pages[pages.length - 1].length > 0) {
      pages.push([raw]);
      pageH = h;
    } else {
      pages[pages.length - 1].push(raw);
      pageH += h;
    }
  }
  document.body.removeChild(measurer);
  return pages;
}

function useReactPages(children: ReactNode, contentHpx: number) {
  const [pages, setPages] = useState<number[][]>([[0]]);
  const measureEl = useRef<HTMLDivElement | null>(null);

  const measureRef = (el: HTMLDivElement | null) => {
    measureEl.current = el;
  };

  useLayoutEffect(() => {
    const el = measureEl.current;
    if (!el) return;
    const kids = Array.from(el.children) as HTMLElement[];
    const out: number[][] = [[]];
    let h = 0;
    kids.forEach((k, i) => {
      const kh = k.getBoundingClientRect().height;
      if (h + kh > contentHpx && out[out.length - 1].length > 0) {
        out.push([i]);
        h = kh;
      } else {
        out[out.length - 1].push(i);
        h += kh;
      }
    });
    setPages(out.length ? out : [[0]]);
    const imgs = el.querySelectorAll("img");
    if (imgs.length) {
      const handlers: Array<() => void> = [];
      imgs.forEach((img) => {
        if (!(img as HTMLImageElement).complete) {
          const fn = () => measureRef(el);
          img.addEventListener("load", fn, { once: true });
          handlers.push(() => img.removeEventListener("load", fn));
        }
      });
      return () => handlers.forEach((h) => h());
    }
  }, [children, contentHpx]);

  return { pages, measureRef };
}

/* ------------------------------------------------------------------ */

const CHECKLIST_KEY = "pp-print-checklist-v1";
const buildChecklistItems = (paperLabel: string) =>
  [
    {
      id: "copies",
      label:
        "Copies: set to 1 in the browser dialog (JavaScript cannot change this — you must select 1 yourself)",
    },
    { id: "paper", label: `Paper size: ${paperLabel}` },
    { id: "margins", label: "Margins: Default" },
    { id: "bg", label: "Background graphics: ON" },
    { id: "scale", label: "Scale: Default (100%) — not 'Fit to page'" },
    { id: "headers", label: "Headers & footers: OFF" },
  ] as const;

export default function PrintPreviewModal(props: Props) {
  const {
    open,
    onOpenChange,
    title,
    style = "B",
    docType,
    autoAction,
    hideLetterhead,
    forceSinglePage,
    projectName,
    readinessTimeouts: readinessTimeoutsProp,
    bookingId: bookingIdProp,
    bookingLabel: bookingLabelProp,
  } = props;

  // User-adjustable overrides driven by the inputs in the timeout error
  // panel. These take precedence over the caller-provided prop so the
  // operator can bump a stalling stage and rerun readiness without
  // reloading the modal.
  const [timeoutOverrides, setTimeoutOverrides] = useState<{
    fonts?: number;
    images?: number;
    layout?: number;
  }>({});
  // Merge caller overrides with the defaults; each stage stays independent so
  // a very slow letterhead image doesn't drag the fonts limit up with it.
  const readinessTimeouts = useMemo(
    () => ({
      fonts:
        timeoutOverrides.fonts ?? readinessTimeoutsProp?.fonts ?? DEFAULT_READINESS_TIMEOUTS.fonts,
      images:
        timeoutOverrides.images ??
        readinessTimeoutsProp?.images ??
        DEFAULT_READINESS_TIMEOUTS.images,
      layout:
        timeoutOverrides.layout ??
        readinessTimeoutsProp?.layout ??
        DEFAULT_READINESS_TIMEOUTS.layout,
    }),
    [
      readinessTimeoutsProp?.fonts,
      readinessTimeoutsProp?.images,
      readinessTimeoutsProp?.layout,
      timeoutOverrides.fonts,
      timeoutOverrides.images,
      timeoutOverrides.layout,
    ],
  );
  const [zoom, setZoom] = useState(0.75);
  // Auto-fit initial zoom to the preview container width so the A4 sheet is
  // fully visible on narrow viewports (phones/tablets). Without this the sheet
  // is 794px wide and the preview area on a 390px phone is ~340px — the sheet
  // starts scrolled off-screen and users see an empty gray area, thinking the
  // preview failed to render. Recomputed on open and on viewport resize; the
  // user can still zoom manually and their setting sticks until the modal
  // closes.
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const userZoomedRef = useRef(false);
  const setZoomWithUserFlag = useCallback((updater: number | ((z: number) => number)) => {
    userZoomedRef.current = true;
    setZoom((prev) =>
      typeof updater === "function" ? (updater as (z: number) => number)(prev) : updater,
    );
  }, []);
  const [logoId, setLogoId] = useState<string>(() => loadSelectedLogoId());
  useEffect(() => {
    saveSelectedLogoId(logoId);
  }, [logoId]);
  const [paperId, setPaperId] = useState<PaperPresetId>(() => loadPaperPresetId());
  useEffect(() => {
    savePaperPresetId(paperId);
  }, [paperId]);
  const paper = getPaperPreset(paperId);
  const isReceiptDoc = props.docType === "receipt";
  const defaultMarginMm = isReceiptDoc ? RECEIPT_SAFE_MARGIN_MM : paper.marginMm;
  const defaultScalePct = isReceiptDoc ? RECEIPT_SAFE_SCALE_PCT : 100;

  // Orientation + layout-guide overlay preferences. Both persist per-browser
  // and are preview-only — the guides are never injected into `preparePrint()`
  // so they cannot leak into the printed sheet or "Save as PDF" output.
  type LayoutPrefs = { orientation: "portrait" | "landscape"; showGuides: boolean };
  const LAYOUT_KEY = "pp-layout-prefs-v1";
  const [layout, setLayout] = useState<LayoutPrefs>(() => {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<LayoutPrefs>) : {};
      return {
        orientation: parsed.orientation === "landscape" ? "landscape" : "portrait",
        showGuides: parsed.showGuides !== false,
      };
    } catch {
      return { orientation: "portrait", showGuides: true };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      /* ignore */
    }
  }, [layout]);

  // Temporary developer overlay for the receipt print flow — highlights the
  // measured content width, available width, and any descendant boxes that
  // overflow the sheet's content-box (i.e. what the printer would clip).
  // Preview-only; the overlay component wraps itself in `@media print`
  // `display: none` so it can never leak into the printed sheet.
  const [showPrintDebug, setShowPrintDebug] = useState(false);
  useEffect(() => {
    if (!open) setShowPrintDebug(false);
  }, [open]);

  const isLandscape = layout.orientation === "landscape";
  const PAGE_W_MM = isLandscape ? paper.heightMm : paper.widthMm;
  const PAGE_H_MM = isLandscape ? paper.widthMm : paper.heightMm;

  // Reset the "user has zoomed" flag whenever the modal opens or the page
  // geometry changes so the auto-fit-to-width effect can take another pass.
  useEffect(() => {
    if (open) userZoomedRef.current = false;
  }, [open, PAGE_W_MM]);

  // Auto-fit zoom to the preview container's width on open (only when the
  // user hasn't manually zoomed yet). A4 (~794 CSS px) far exceeds a phone's
  // preview area (~340 px), so without this the sheet renders far off-screen
  // and the preview appears empty. One-shot on open — polls a couple of rAFs
  // because Radix portal-mounts DialogContent after the initial render pass.
  const PX_PER_MM_FIT = 96 / 25.4;
  const FIT_PADDING = 48; // p-6 both sides
  const computeFitZoom = useCallback((): number | null => {
    const el = previewScrollRef.current;
    if (!el) return null;
    const availW = el.clientWidth - FIT_PADDING;
    const availH = el.clientHeight - FIT_PADDING;
    if (availW <= 0 || availH <= 0) return null;
    const sheetW = PAGE_W_MM * PX_PER_MM_FIT;
    const sheetH = PAGE_H_MM * PX_PER_MM_FIT;
    return Math.max(0.35, Math.min(1, Math.min(availW / sheetW, availH / sheetH)));
  }, [PAGE_W_MM, PAGE_H_MM]);

  // Manual "Fit to screen" — used by the mobile troubleshooter helper below.
  // Clears the user-zoom flag so the auto-fit effect can keep responding to
  // container resizes afterwards.
  const fitToScreen = useCallback(() => {
    const fit = computeFitZoom();
    if (fit == null) return;
    userZoomedRef.current = false;
    setZoom(+fit.toFixed(2));
  }, [computeFitZoom]);

  useEffect(() => {
    if (!open) return;
    if (userZoomedRef.current) return;
    let cancelled = false;
    let attempts = 0;
    let ro: ResizeObserver | null = null;
    const applyFit = () => {
      if (cancelled || userZoomedRef.current) return;
      const fit = computeFitZoom();
      if (fit == null) return;
      setZoom((z) => (Math.abs(z - fit) > 0.02 ? +fit.toFixed(2) : z));
    };
    const tryFit = () => {
      if (cancelled || userZoomedRef.current) return;
      const el = previewScrollRef.current;
      if (el && el.clientWidth > 0 && el.clientHeight > 0) {
        applyFit();
        if (typeof ResizeObserver !== "undefined") {
          ro = new ResizeObserver(() => applyFit());
          ro.observe(el);
        }
        return;
      }
      if (attempts++ < 20) requestAnimationFrame(tryFit);
    };
    requestAnimationFrame(tryFit);
    return () => {
      cancelled = true;
      ro?.disconnect();
    };
  }, [open, PAGE_W_MM, PAGE_H_MM, computeFitZoom]);

  // Mobile blank-preview detector. On narrow viewports users have historically
  // seen "empty gray" when the sheet is scrolled off-screen or renders at 0
  // height because the container hadn't measured yet. We watch the first
  // .pp-sheet inside the scroller and flag it as "not visible" when its
  // intersection with the container area is under 5% — that's the signal
  // to surface a troubleshooting helper with a one-tap "Fit to screen" fix.
  const [previewBlank, setPreviewBlank] = useState(false);
  const [helperDismissed, setHelperDismissed] = useState(false);
  useEffect(() => {
    if (!open) {
      setPreviewBlank(false);
      setHelperDismissed(false);
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const container = previewScrollRef.current;
    if (!container) return;
    let raf = 0;
    const check = () => {
      const sheet = container.querySelector<HTMLElement>(".pp-sheet");
      const cRect = container.getBoundingClientRect();
      if (!sheet || cRect.width === 0 || cRect.height === 0) {
        setPreviewBlank(true);
        return;
      }
      const sRect = sheet.getBoundingClientRect();
      const overlapW = Math.max(
        0,
        Math.min(cRect.right, sRect.right) - Math.max(cRect.left, sRect.left),
      );
      const overlapH = Math.max(
        0,
        Math.min(cRect.bottom, sRect.bottom) - Math.max(cRect.top, sRect.top),
      );
      const overlap = overlapW * overlapH;
      const sheetArea = Math.max(1, sRect.width * sRect.height);
      const containerArea = Math.max(1, cRect.width * cRect.height);
      const ratio = overlap / Math.min(sheetArea, containerArea);
      setPreviewBlank(ratio < 0.05);
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(check);
    };
    schedule();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(container);
    container.addEventListener("scroll", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      container.removeEventListener("scroll", schedule);
    };
  }, [open, zoom, PAGE_W_MM, PAGE_H_MM]);

  // Preview render/settle tracker. Flips to "rendering" whenever the modal
  // opens or key layout inputs change (paper, orientation, scale, page count),
  // then to "ready" once fonts + all sheet images have loaded and one rAF has
  // passed so pagination has settled. Fed to the on-screen status chip below.
  type RenderStatus = "rendering" | "ready";
  const [renderStatus, setRenderStatus] = useState<RenderStatus>("rendering");
  // Per-stage print readiness for the on-screen progress indicator. Each
  // stage flips from "pending" → "ready" as its underlying gate resolves
  // (see the settle() effect below). "timeout" means we bailed out after
  // the 4s safety window so the user isn't stuck watching a spinner. The
  // image stage carries loaded/total so we can show "3 / 8 images".
  type StageState = "pending" | "ready" | "timeout";
  type Readiness = {
    fonts: StageState;
    /** ms since startedAt at which fonts settled (ready or timed out). null while pending. */
    fontsEndedAtMs: number | null;
    images: StageState;
    imagesEndedAtMs: number | null;
    imagesLoaded: number;
    imagesTotal: number;
    /** Per-image completion offsets (ms since startedAt), in the order they fired. */
    imageEvents: number[];
    layout: StageState;
    layoutEndedAtMs: number | null;
    startedAt: number;
    /** Wall time (ms since startedAt) at which the full pipeline finished — set once. */
    totalMs: number | null;
  };
  const perfNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const [readiness, setReadiness] = useState<Readiness>(() => ({
    fonts: "pending",
    fontsEndedAtMs: null,
    images: "pending",
    imagesEndedAtMs: null,
    imagesLoaded: 0,
    imagesTotal: 0,
    imageEvents: [],
    layout: "pending",
    layoutEndedAtMs: null,
    startedAt: perfNow(),
    totalMs: null,
  }));

  // Live tick that advances the elapsed-ms readout for stages still in "pending".
  // Only runs while the pipeline is still settling; stops once renderStatus flips
  // to "ready" to avoid a 4Hz render loop after the preview is idle.
  const [readinessTick, setReadinessTick] = useState(0);
  // Bumped by the "Retry" button in the readiness panel to force the settle
  // effect to re-run without reloading the modal or the page. Included in
  // the effect's dep list so React tears down the current pass (cancels
  // pending timers/listeners) and starts a fresh one from t0.
  const [readinessNonce, setReadinessNonce] = useState(0);
  const retryReadiness = useCallback(() => {
    setReadinessNonce((n) => n + 1);
  }, []);

  // History of readiness passes for the current modal session. Each Retry
  // (or a fresh open) appends a new entry; the current entry mutates in-place
  // as fonts/images/layout settle so the timeline reflects live state. Used
  // by the "Attempts" list in the timeline panel so a stalling stage can be
  // compared across retries without losing prior outcomes.
  type ReadinessAttempt = {
    n: number;
    startedAt: number;
    /** Wall-clock start time (Date.now) — used by the date-range filter. */
    wallStartedAt: number;
    endedAt: number | null;
    fonts: StageState;
    fontsEndedAtMs: number | null;
    images: StageState;
    imagesEndedAtMs: number | null;
    layout: StageState;
    layoutEndedAtMs: number | null;
    totalMs: number | null;
    bookingId: string | null;
    bookingLabel: string | null;
  };
  const [attempts, setAttempts] = useState<ReadinessAttempt[]>([]);

  // Filter state for the Attempts timeline. All filters combine with AND;
  // empty multi-selects mean "all values". Reset when the modal closes.
  type StageKey = "fonts" | "images" | "layout";
  type OutcomeKey = "ready" | "timeout" | "pending" | "running" | "incomplete";
  type AttemptFilters = {
    stages: StageKey[];
    outcomes: OutcomeKey[];
    nMin: number | null;
    nMax: number | null;
    bookingId: string | null; // null = all
    dateFrom: string; // yyyy-mm-dd, "" = unbounded
    dateTo: string;
  };
  const emptyFilters: AttemptFilters = {
    stages: [],
    outcomes: [],
    nMin: null,
    nMax: null,
    bookingId: null,
    dateFrom: "",
    dateTo: "",
  };
  const [attemptFilters, setAttemptFilters] = useState<AttemptFilters>(emptyFilters);
  const [attemptFiltersOpen, setAttemptFiltersOpen] = useState(false);

  // Serializes the latest readiness snapshot (per-stage timestamps, last
  // measured image counts, per-image completion offsets, and total duration)
  // to a JSON file the user can attach to a bug report. Filename is time-
  // stamped so multiple downloads don't overwrite each other.
  const readinessRef = useRef<Readiness | null>(null);

  // Ring buffer of recent console.warn / console.error messages that look
  // readiness-related (fonts, images, layout, print, receipt). We patch
  // the two methods on modal mount, restore them on unmount, and cap the
  // buffer at 50 entries so a spammy dependency can't leak memory. The
  // captured entries are attached to the JSON diagnostics download so
  // support/debugging doesn't require the user to also copy the browser
  // devtools log.
  type ReadinessLogEntry = {
    level: "warn" | "error";
    tsIso: string;
    perfMs: number;
    message: string;
  };
  const readinessLogsRef = useRef<ReadinessLogEntry[]>([]);
  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;
    const MAX = 50;
    const KEYWORDS =
      /(readiness|print-?readiness|printFlow|receipt|font|image|layout|waitForReady)/i;
    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);
    const capture = (level: "warn" | "error", args: unknown[]) => {
      try {
        const message = args
          .map((a) => {
            if (a instanceof Error) return `${a.name}: ${a.message}`;
            if (typeof a === "string") return a;
            try {
              return JSON.stringify(a);
            } catch {
              return String(a);
            }
          })
          .join(" ");
        if (!KEYWORDS.test(message)) return;
        const buf = readinessLogsRef.current;
        buf.push({
          level,
          tsIso: new Date().toISOString(),
          perfMs: Math.round(perfNow()),
          message: message.slice(0, 2000),
        });
        if (buf.length > MAX) buf.splice(0, buf.length - MAX);
      } catch {
        // Never let the interceptor throw into the caller's console call.
      }
    };
    console.warn = (...args: unknown[]) => {
      capture("warn", args);
      origWarn(...args);
    };
    console.error = (...args: unknown[]) => {
      capture("error", args);
      origError(...args);
    };
    return () => {
      console.warn = origWarn;
      console.error = origError;
    };
  }, [open]);

  // Build the readiness diagnostics payload used by both the JSON
  // download and the "Generate share link" upload. Returns null when
  // readiness state has not been captured yet.
  const buildReadinessDiagnosticsPayload = useCallback(() => {
    const r = readinessRef.current;
    if (!r) return null;
    const now = perfNow();
    const stageSnapshot = (
      state: StageState,
      endedAt: number | null,
    ): { state: StageState; endedAtMs: number | null; elapsedMs: number } => ({
      state,
      endedAtMs: endedAt,
      elapsedMs: Math.round(endedAt ?? now - r.startedAt),
    });
    return {
      capturedAtIso: new Date().toISOString(),
      startedAtMs: r.startedAt,
      totalMs: r.totalMs,
      liveElapsedMs: Math.round(now - r.startedAt),
      timedOut: r.fonts === "timeout" || r.images === "timeout" || r.layout === "timeout",
      stages: {
        fonts: stageSnapshot(r.fonts, r.fontsEndedAtMs),
        images: {
          ...stageSnapshot(r.images, r.imagesEndedAtMs),
          loaded: r.imagesLoaded,
          total: r.imagesTotal,
          perImageOffsetsMs: r.imageEvents.map((t) => Math.round(t)),
        },
        layout: stageSnapshot(r.layout, r.layoutEndedAtMs),
      },
      limitsMs: {
        fonts: readinessTimeouts.fonts,
        images: readinessTimeouts.images,
        layout: readinessTimeouts.layout,
      },
      context: {
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        viewport:
          typeof window !== "undefined"
            ? { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }
            : null,
      },
      // Recent readiness-related console.warn / console.error messages
      // captured while this modal was open (keyword-filtered, capped at
      // 50). Empty array when nothing matched.
      consoleMessages: readinessLogsRef.current.slice(),
    };
  }, [readinessTimeouts]);

  // Inline confirmation for the last diagnostics download (JSON or CSV).
  // Persists alongside the sonner toast so the success signal stays visible
  // if the toast was missed or auto-dismissed.
  const [lastDiagnosticsDownload, setLastDiagnosticsDownload] = useState<{
    format: "JSON" | "CSV";
    filename: string;
    at: number;
  } | null>(null);
  const diagnosticsConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashDiagnosticsDownload = useCallback((format: "JSON" | "CSV", filename: string) => {
    setLastDiagnosticsDownload({ format, filename, at: Date.now() });
    if (diagnosticsConfirmTimerRef.current) {
      clearTimeout(diagnosticsConfirmTimerRef.current);
    }
    diagnosticsConfirmTimerRef.current = setTimeout(() => {
      setLastDiagnosticsDownload(null);
      diagnosticsConfirmTimerRef.current = null;
    }, 6000);
  }, []);
  useEffect(
    () => () => {
      if (diagnosticsConfirmTimerRef.current) {
        clearTimeout(diagnosticsConfirmTimerRef.current);
      }
    },
    [],
  );

  const downloadReadinessDiagnostics = useCallback(() => {
    const payload = buildReadinessDiagnosticsPayload();
    if (!payload) return;
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      a.href = url;
      const filename = `print-readiness-${stamp}.json`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      flashDiagnosticsDownload("JSON", filename);
      toast.success("Readiness diagnostics downloaded");
    } catch (err) {
      toast.error("Failed to download diagnostics");

      console.error("[print-readiness] download failed", err);
    }
  }, [buildReadinessDiagnosticsPayload, flashDiagnosticsDownload]);

  // Share-link state: uploads the same JSON payload to private storage
  // and returns a time-limited signed URL for teammates. The URL is kept
  // in local state so it stays visible after generation (and can be
  // re-copied without regenerating).
  const uploadDiagnosticsFn = useServerFn(uploadPrintDiagnostics);
  const [shareLink, setShareLink] = useState<{
    url: string;
    expiresAtIso: string;
  } | null>(null);
  const [shareLinkGenerating, setShareLinkGenerating] = useState(false);

  const generateShareLink = useCallback(async () => {
    const payload = buildReadinessDiagnosticsPayload();
    if (!payload) {
      toast.error("No diagnostics captured yet");
      return;
    }
    setShareLinkGenerating(true);
    try {
      const res = await uploadDiagnosticsFn({
        data: { payload: JSON.stringify(payload) },
      });
      setShareLink({ url: res.url, expiresAtIso: res.expiresAtIso });
      try {
        await navigator.clipboard?.writeText(res.url);
        toast.success("Share link copied to clipboard");
      } catch {
        toast.success("Share link generated");
      }
    } catch (err) {
      console.error("[print-readiness] share upload failed", err);
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast.error(`Failed to generate share link: ${msg}`);
    } finally {
      setShareLinkGenerating(false);
    }
  }, [buildReadinessDiagnosticsPayload, uploadDiagnosticsFn]);

  const copyShareLink = useCallback(async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink.url);
      toast.success("Link copied");
    } catch {
      toast.error("Copy failed — select and copy manually");
    }
  }, [shareLink]);

  // Clear the visible share link whenever the modal reopens or the user
  // re-runs readiness, so stale URLs don't get mistaken for the current run.
  useEffect(() => {
    if (!open) setShareLink(null);
  }, [open]);

  // CSV variant of the readiness diagnostics for spreadsheet review. Each
  // readiness stage becomes one row with its state, end-timestamp, elapsed
  // ms, active limit, and (for images) loaded/total counts. Per-image load
  // offsets and UA/viewport context are appended as trailing rows so the
  // whole snapshot fits in a single file that opens cleanly in Excel /
  // Sheets. Every cell is quoted and neutralized against CSV formula
  // injection (leading =, +, -, @, tab, CR) — see src/lib/csv.ts.
  const downloadReadinessDiagnosticsCsv = useCallback(() => {
    const r = readinessRef.current;
    if (!r) return;
    const now = perfNow();
    const esc = (v: unknown): string => {
      const s = v === null || v === undefined ? "" : String(v);
      const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return `"${guarded.replace(/"/g, '""')}"`;
    };
    const elapsedFor = (endedAt: number | null): number => Math.round(endedAt ?? now - r.startedAt);
    const rows: string[][] = [
      [
        "section",
        "key",
        "state",
        "ended_at_ms",
        "elapsed_ms",
        "limit_ms",
        "loaded",
        "total",
        "value",
      ],
      [
        "stage",
        "fonts",
        r.fonts,
        r.fontsEndedAtMs ?? "",
        elapsedFor(r.fontsEndedAtMs),
        readinessTimeouts.fonts,
        "",
        "",
        "",
      ].map(String),
      [
        "stage",
        "images",
        r.images,
        r.imagesEndedAtMs ?? "",
        elapsedFor(r.imagesEndedAtMs),
        readinessTimeouts.images,
        r.imagesLoaded,
        r.imagesTotal,
        "",
      ].map(String),
      [
        "stage",
        "layout",
        r.layout,
        r.layoutEndedAtMs ?? "",
        elapsedFor(r.layoutEndedAtMs),
        readinessTimeouts.layout,
        "",
        "",
        "",
      ].map(String),
      ["summary", "totalMs", "", "", r.totalMs ?? "", "", "", "", ""].map(String),
      ["summary", "liveElapsedMs", "", "", Math.round(now - r.startedAt), "", "", "", ""].map(
        String,
      ),
      [
        "summary",
        "timedOut",
        "",
        "",
        "",
        "",
        "",
        "",
        r.fonts === "timeout" || r.images === "timeout" || r.layout === "timeout"
          ? "true"
          : "false",
      ],
      ["summary", "capturedAtIso", "", "", "", "", "", "", new Date().toISOString()],
    ];
    r.imageEvents.forEach((t, i) => {
      rows.push(["image_event", `image[${i}]`, "", "", String(Math.round(t)), "", "", "", ""]);
    });
    if (typeof navigator !== "undefined") {
      rows.push(["context", "userAgent", "", "", "", "", "", "", navigator.userAgent]);
    }
    if (typeof window !== "undefined") {
      rows.push([
        "context",
        "viewport",
        "",
        "",
        "",
        "",
        "",
        "",
        `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
      ]);
    }
    const csv = rows.map((row) => row.map(esc).join(",")).join("\r\n");
    try {
      const blob = new Blob([`\uFEFF${csv}`], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      a.href = url;
      const filename = `print-readiness-${stamp}.csv`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      flashDiagnosticsDownload("CSV", filename);
      toast.success("Readiness diagnostics CSV downloaded");
    } catch (err) {
      toast.error("Failed to download diagnostics CSV");

      console.error("[print-readiness] csv download failed", err);
    }
  }, [readinessTimeouts, flashDiagnosticsDownload]);

  // Keep a ref of the latest readiness snapshot so the download handler
  // always serializes fresh values without re-creating its callback identity.
  useEffect(() => {
    readinessRef.current = readiness;
  });

  // Optional "Auto print when ready" mode. When enabled, the modal fires the
  // browser print dialog automatically as soon as every readiness stage
  // (fonts / images / layout) reports settled, so users don't have to click
  // Print again after tuning options. Persisted per browser via localStorage.
  const AUTO_PRINT_KEY = "pp:autoPrintWhenReady";
  const [autoPrintWhenReady, setAutoPrintWhenReady] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(AUTO_PRINT_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(AUTO_PRINT_KEY, autoPrintWhenReady ? "1" : "0");
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, [autoPrintWhenReady]);
  // Guards against re-firing the print dialog on the same "ready" transition
  // (e.g. React StrictMode double-invoke, Retry -> ready cycles). Reset when
  // the modal closes or a fresh settle pass starts (readinessNonce bump).
  const autoPrintFiredRef = useRef(false);

  // Optional "Auto-download diagnostics on timeout" mode. When enabled, the
  // modal automatically saves the readiness diagnostics JSON as soon as any
  // stage (fonts / images / layout) times out — so users don't lose the
  // measurements if they close the modal before clicking Download. Persisted
  // per browser via localStorage. Fires at most once per readiness pass
  // (reset on modal close and on Retry via readinessNonce).
  const AUTO_DL_ON_TIMEOUT_KEY = "pp:autoDownloadDiagnosticsOnTimeout";
  const [autoDownloadOnTimeout, setAutoDownloadOnTimeout] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(AUTO_DL_ON_TIMEOUT_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(AUTO_DL_ON_TIMEOUT_KEY, autoDownloadOnTimeout ? "1" : "0");
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, [autoDownloadOnTimeout]);
  const autoDownloadFiredRef = useRef(false);
  useEffect(() => {
    autoDownloadFiredRef.current = false;
  }, [readinessNonce, open]);
  useEffect(() => {
    if (!open) return;
    if (!autoDownloadOnTimeout) return;
    if (autoDownloadFiredRef.current) return;
    const anyTimeout =
      readiness.fonts === "timeout" ||
      readiness.images === "timeout" ||
      readiness.layout === "timeout";
    if (!anyTimeout) return;
    autoDownloadFiredRef.current = true;
    // Defer one frame so the readiness snapshot (endedAtMs, elapsedMs) is
    // fully committed before serialization.
    const id = window.setTimeout(() => {
      downloadReadinessDiagnostics();
    }, 0);
    return () => window.clearTimeout(id);
  }, [
    open,
    autoDownloadOnTimeout,
    readiness.fonts,
    readiness.images,
    readiness.layout,
    downloadReadinessDiagnostics,
  ]);

  // Print settings (margins / scale / include-logo). Persisted per browser so
  // the user's preferred layout survives across sessions. Margins reset to the
  // preset default whenever the paper size changes.
  type GutterSide = "left" | "right" | "top" | "bottom";
  type SettingsState = {
    marginMm: number;
    scalePct: number;
    includeLogo: boolean;
    customSides: boolean;
    marginTopMm: number;
    marginRightMm: number;
    marginBottomMm: number;
    marginLeftMm: number;
    gutterMm: number;
    gutterSide: GutterSide;
    fitOnePage: boolean;
    debugFit: boolean;
  };
  const SETTINGS_KEY = isReceiptDoc ? "pp-print-settings-receipt-v1" : "pp-print-settings-v2";
  // Debug flag lives in its own key so it survives the Reset button and any
  // future settings-schema migrations — diagnostics stay on until explicitly turned off.
  const DEBUG_FIT_KEY = "pp-fit-debug-v1";
  const [settings, setSettings] = useState<SettingsState>(() => {
    const base: SettingsState = {
      marginMm: defaultMarginMm,
      scalePct: defaultScalePct,
      includeLogo: true,
      customSides: false,
      marginTopMm: defaultMarginMm,
      marginRightMm: defaultMarginMm,
      marginBottomMm: defaultMarginMm,
      marginLeftMm: defaultMarginMm,
      gutterMm: 0,
      gutterSide: "left",
      fitOnePage: false,
      debugFit: false,
    };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<SettingsState>) : {};
      const parsedMargin = typeof parsed.marginMm === "number" ? parsed.marginMm : base.marginMm;
      const m = isReceiptDoc ? Math.min(parsedMargin, RECEIPT_SAFE_MARGIN_MM) : parsedMargin;
      const parsedScale = typeof parsed.scalePct === "number" ? parsed.scalePct : base.scalePct;
      const rawDebug = localStorage.getItem(DEBUG_FIT_KEY);
      const debugFit =
        rawDebug === "true" ? true : rawDebug === "false" ? false : parsed.debugFit === true;
      const gutterSide: GutterSide =
        parsed.gutterSide === "right" ||
        parsed.gutterSide === "top" ||
        parsed.gutterSide === "bottom"
          ? parsed.gutterSide
          : "left";
      return {
        ...base,
        marginMm: m,
        scalePct: isReceiptDoc ? RECEIPT_SAFE_SCALE_PCT : parsedScale,
        includeLogo: parsed.includeLogo !== false,
        customSides: parsed.customSides === true,
        marginTopMm:
          typeof parsed.marginTopMm === "number"
            ? isReceiptDoc
              ? Math.min(parsed.marginTopMm, RECEIPT_SAFE_MARGIN_MM)
              : parsed.marginTopMm
            : m,
        marginRightMm:
          typeof parsed.marginRightMm === "number"
            ? isReceiptDoc
              ? Math.min(parsed.marginRightMm, RECEIPT_SAFE_MARGIN_MM)
              : parsed.marginRightMm
            : m,
        marginBottomMm:
          typeof parsed.marginBottomMm === "number"
            ? isReceiptDoc
              ? Math.min(parsed.marginBottomMm, RECEIPT_SAFE_MARGIN_MM)
              : parsed.marginBottomMm
            : m,
        marginLeftMm:
          typeof parsed.marginLeftMm === "number"
            ? isReceiptDoc
              ? Math.min(parsed.marginLeftMm, RECEIPT_SAFE_MARGIN_MM)
              : parsed.marginLeftMm
            : m,
        gutterMm: typeof parsed.gutterMm === "number" ? parsed.gutterMm : 0,
        gutterSide,
        fitOnePage: parsed.fitOnePage === true,
        debugFit,
      };
    } catch {
      return base;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);
  // Persist the debug flag independently so it survives Reset and blob wipes.
  useEffect(() => {
    try {
      localStorage.setItem(DEBUG_FIT_KEY, settings.debugFit ? "true" : "false");
    } catch {
      /* ignore */
    }
  }, [settings.debugFit]);

  // Named margin presets — user-saved per-side margin sets, persisted per browser.
  type MarginPreset = {
    name: string;
    top: number;
    right: number;
    bottom: number;
    left: number;
    customSides: boolean;
    gutter?: number;
    gutterSide?: GutterSide;
  };
  const PRESETS_KEY = "pp-margin-presets-v1";
  const [marginPresets, setMarginPresets] = useState<MarginPreset[]>(() => {
    try {
      const raw = localStorage.getItem(PRESETS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((p) => p && typeof p.name === "string") : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(marginPresets));
    } catch {
      /* ignore */
    }
  }, [marginPresets]);
  const [newPresetName, setNewPresetName] = useState("");
  // Snap margins to the preset default when the paper changes.
  useEffect(() => {
    setSettings((s) => ({
      ...s,
      marginMm: defaultMarginMm,
      marginTopMm: defaultMarginMm,
      marginRightMm: defaultMarginMm,
      marginBottomMm: defaultMarginMm,
      marginLeftMm: defaultMarginMm,
      scalePct: isReceiptDoc ? RECEIPT_SAFE_SCALE_PCT : s.scalePct,
    }));
  }, [paperId, defaultMarginMm, isReceiptDoc]);

  const clampMm = (n: number) => Math.max(5, Math.min(40, Number.isFinite(n) ? n : paper.marginMm));
  const clampGutter = (n: number) => Math.max(0, Math.min(30, Number.isFinite(n) ? n : 0));
  const PAGE_MARGIN = clampMm(settings.marginMm);
  const baseMT = settings.customSides ? clampMm(settings.marginTopMm) : PAGE_MARGIN;
  const baseMR = settings.customSides ? clampMm(settings.marginRightMm) : PAGE_MARGIN;
  const baseMB = settings.customSides ? clampMm(settings.marginBottomMm) : PAGE_MARGIN;
  const baseML = settings.customSides ? clampMm(settings.marginLeftMm) : PAGE_MARGIN;
  const gutter = clampGutter(settings.gutterMm);
  const MT = baseMT + (settings.gutterSide === "top" ? gutter : 0);
  const MR = baseMR + (settings.gutterSide === "right" ? gutter : 0);
  const MB = baseMB + (settings.gutterSide === "bottom" ? gutter : 0);
  const ML = baseML + (settings.gutterSide === "left" ? gutter : 0);
  const marginShorthand = `${MT}mm ${MR}mm ${MB}mm ${ML}mm`;
  const marginLabel = settings.customSides
    ? `${MT.toFixed(1)}/${MR.toFixed(1)}/${MB.toFixed(1)}/${ML.toFixed(1)}mm`
    : `${PAGE_MARGIN.toFixed(1)}mm${gutter > 0 ? ` +${gutter.toFixed(1)} ${settings.gutterSide}` : ""}`;

  // Per-side margin validation. A margin is only "safe" if it leaves at least
  // MIN_CONTENT_MM of printable area along its axis after subtracting the
  // opposite side. Recomputed live so warnings react to paper size, orientation
  // and the value of the *other* side on the same axis.
  const MIN_CONTENT_MM = 40;
  const MIN_SIDE = 5;
  const MAX_SIDE_HARD = 40;
  const rawTop = Number.isFinite(settings.marginTopMm) ? settings.marginTopMm : paper.marginMm;
  const rawRight = Number.isFinite(settings.marginRightMm)
    ? settings.marginRightMm
    : paper.marginMm;
  const rawBottom = Number.isFinite(settings.marginBottomMm)
    ? settings.marginBottomMm
    : paper.marginMm;
  const rawLeft = Number.isFinite(settings.marginLeftMm) ? settings.marginLeftMm : paper.marginMm;
  const maxTop = Math.min(MAX_SIDE_HARD, PAGE_H_MM - rawBottom - MIN_CONTENT_MM);
  const maxBottom = Math.min(MAX_SIDE_HARD, PAGE_H_MM - rawTop - MIN_CONTENT_MM);
  const maxLeft = Math.min(MAX_SIDE_HARD, PAGE_W_MM - rawRight - MIN_CONTENT_MM);
  const maxRight = Math.min(MAX_SIDE_HARD, PAGE_W_MM - rawLeft - MIN_CONTENT_MM);
  const sideChecks = {
    marginTopMm: { raw: rawTop, max: maxTop },
    marginRightMm: { raw: rawRight, max: maxRight },
    marginBottomMm: { raw: rawBottom, max: maxBottom },
    marginLeftMm: { raw: rawLeft, max: maxLeft },
  } as const;
  const isSideInvalid = (k: keyof typeof sideChecks) => {
    const { raw, max } = sideChecks[k];
    return !Number.isFinite(raw) || raw < MIN_SIDE || raw > MAX_SIDE_HARD || raw > max;
  };
  const marginWarnings = settings.customSides
    ? (["marginTopMm", "marginRightMm", "marginBottomMm", "marginLeftMm"] as const)
        .filter(isSideInvalid)
        .map((k) => {
          const { raw, max } = sideChecks[k];
          const label =
            k === "marginTopMm"
              ? "Top"
              : k === "marginRightMm"
                ? "Right"
                : k === "marginBottomMm"
                  ? "Bottom"
                  : "Left";
          if (!Number.isFinite(raw)) return `${label}: not a number`;
          if (raw < MIN_SIDE) return `${label}: below ${MIN_SIDE}mm minimum`;
          if (raw > MAX_SIDE_HARD) return `${label}: above ${MAX_SIDE_HARD}mm hard cap`;
          return `${label} ${raw.toFixed(1)}mm exceeds printable area (max ${Math.max(MIN_SIDE, max).toFixed(1)}mm on ${paper.shortLabel} ${isLandscape ? "landscape" : "portrait"})`;
        })
    : [];
  const effectiveScalePct = isReceiptDoc ? RECEIPT_SAFE_SCALE_PCT : settings.scalePct;
  const SCALE = Math.max(50, Math.min(150, effectiveScalePct)) / 100;
  const bodyPt = paper.bodyPt * SCALE;
  const lineH = paper.lineHeight;
  const [autoEditorOpen, setAutoEditorOpen] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(CHECKLIST_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const [checklistOpen, setChecklistOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(CHECKLIST_KEY, JSON.stringify(checked));
    } catch {
      /* ignore */
    }
  }, [checked]);

  // Paper-size changes invalidate the "Paper size: …" checklist tick — force
  // the user to reconfirm the browser dialog matches the new preset.
  useEffect(() => {
    setChecked((s) => (s.paper ? { ...s, paper: false } : s));
  }, [paperId]);

  const CHECKLIST_ITEMS = useMemo(() => buildChecklistItems(paper.shortLabel), [paper.shortLabel]);

  const allChecked = CHECKLIST_ITEMS.every((i) => checked[i.id]);
  const checkedCount = CHECKLIST_ITEMS.filter((i) => checked[i.id]).length;

  // Auto-open the checklist the first time the modal opens if not all ticked.
  useEffect(() => {
    if (open && !allChecked) {
      setChecklistOpen(true);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const headerH = HEADER_H_MM[style];
  const footerH = FOOTER_H_MM[style];
  const contentWmm = PAGE_W_MM - ML - MR;
  const contentHmm = PAGE_H_MM - MT - MB - headerH - footerH;
  const contentHpx = contentHmm * MM_TO_PX;

  const textPages = useMemo(() => {
    if (props.mode !== "text" || !open) return null;
    return paginateText(props.body.split("\n"), contentWmm, contentHpx, bodyPt, lineH);
  }, [props, open, contentWmm, contentHpx, bodyPt, lineH]);

  const isReact = props.mode === "react";
  const { pages: reactPageGroups, measureRef } = useReactPages(
    isReact ? (props as ReactMode).children : null,
    contentHpx,
  );
  const effectiveReactPageGroups = forceSinglePage && isReact ? [[0]] : reactPageGroups;
  const reactChildren = isReact ? (props as ReactMode).children : null;

  const pageCount = textPages ? textPages.length : effectiveReactPageGroups.length;

  // Advance the pending-stage elapsed counter ~4× per second while the pipeline
  // is still settling. Interval cleared as soon as renderStatus flips to "ready".
  useEffect(() => {
    if (!open || renderStatus !== "rendering") return;
    const id = window.setInterval(() => setReadinessTick((t) => t + 1), 250);
    return () => window.clearInterval(id);
  }, [open, renderStatus]);

  // Drive the render/ready transition. Every time the modal opens or one of
  // the layout-affecting inputs changes we flip back to "rendering" and, on
  // the next frame, wait for fonts + images inside the preview scroller to
  // finish before flipping to "ready". Bail out safely after ~4 s to prevent
  // a stuck spinner from a broken image URL.
  useEffect(() => {
    if (!open) return;
    setRenderStatus("rendering");
    const startedAt = perfNow();
    setReadiness({
      fonts: "pending",
      fontsEndedAtMs: null,
      images: "pending",
      imagesEndedAtMs: null,
      imagesLoaded: 0,
      imagesTotal: 0,
      imageEvents: [],
      layout: "pending",
      layoutEndedAtMs: null,
      startedAt,
      totalMs: null,
    });
    let cancelled = false;
    const timers: number[] = [];
    const elapsed = () => perfNow() - startedAt;
    const patch = (p: Partial<Readiness>) => setReadiness((r) => (cancelled ? r : { ...r, ...p }));

    // Per-stage timeout: if the stage is still "pending" when its own deadline
    // elapses, flip it to "timeout" and record the moment. Each stage races
    // its own clock so a hung image doesn't wrongly time out the fonts stage.
    const scheduleStageTimeout = (stage: "fonts" | "images" | "layout", ms: number) => {
      const id = window.setTimeout(() => {
        if (cancelled) return;
        const at = elapsed();
        setReadiness((r) => {
          if (cancelled) return r;
          if (r[stage] !== "pending") return r;
          if (stage === "fonts") {
            return { ...r, fonts: "timeout", fontsEndedAtMs: at };
          }
          if (stage === "images") {
            return { ...r, images: "timeout", imagesEndedAtMs: at };
          }
          return { ...r, layout: "timeout", layoutEndedAtMs: at };
        });
      }, ms);
      timers.push(id);
    };

    scheduleStageTimeout("fonts", readinessTimeouts.fonts);
    scheduleStageTimeout("images", readinessTimeouts.images);
    scheduleStageTimeout("layout", readinessTimeouts.layout);

    const settle = () => {
      if (cancelled) return;
      const container = previewScrollRef.current;
      const imgs = container ? Array.from(container.querySelectorAll("img")) : [];
      const total = imgs.length;
      let loaded = imgs.filter((img) => (img as HTMLImageElement).complete).length;
      const initialEvents: number[] = [];
      const t0 = elapsed();
      for (let i = 0; i < loaded; i++) initialEvents.push(t0);
      patch({
        imagesTotal: total,
        imagesLoaded: loaded,
        imageEvents: initialEvents,
      });
      if (total === 0) patch({ images: "ready", imagesEndedAtMs: t0 });
      else if (loaded >= total) patch({ images: "ready", imagesEndedAtMs: t0 });

      const pending = imgs
        .filter((img) => !(img as HTMLImageElement).complete)
        .map(
          (img) =>
            new Promise<void>((resolve) => {
              const done = () => {
                img.removeEventListener("load", done);
                img.removeEventListener("error", done);
                loaded += 1;
                const at = elapsed();
                setReadiness((r) => {
                  if (cancelled) return r;
                  const next: Readiness = {
                    ...r,
                    imagesLoaded: loaded,
                    imageEvents: [...r.imageEvents, at],
                  };
                  if (loaded >= total && r.images === "pending") {
                    next.images = "ready";
                    next.imagesEndedAtMs = at;
                  }
                  return next;
                });
                resolve();
              };
              img.addEventListener("load", done, { once: true });
              img.addEventListener("error", done, { once: true });
            }),
        );

      const fontsReadyPromise =
        typeof document !== "undefined" &&
        (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts
          ? (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready
          : Promise.resolve();
      fontsReadyPromise.then(() => {
        if (cancelled) return;
        setReadiness((r) =>
          cancelled || r.fonts !== "pending"
            ? r
            : { ...r, fonts: "ready", fontsEndedAtMs: elapsed() },
        );
      });

      // Overall completion race: either every stage settles naturally, or the
      // longest per-stage deadline elapses. Either way we then run one rAF to
      // confirm layout, mark it ready (unless it already timed out), and flip
      // the modal to the "ready" render status.
      const maxTimeout = Math.max(
        readinessTimeouts.fonts,
        readinessTimeouts.images,
        readinessTimeouts.layout,
      );
      Promise.race([
        Promise.all([fontsReadyPromise, ...pending]),
        new Promise((r) => {
          const id = window.setTimeout(r, maxTimeout);
          timers.push(id);
        }),
      ]).then(() => {
        if (cancelled) return;
        requestAnimationFrame(() => {
          if (cancelled) return;
          const doneAt = elapsed();
          setReadiness((r) => {
            if (cancelled) return r;
            const next: Readiness = { ...r, totalMs: doneAt };
            if (r.layout === "pending") {
              next.layout = "ready";
              next.layoutEndedAtMs = doneAt;
            }
            return next;
          });
          setRenderStatus("ready");
        });
      });
    };
    const raf = requestAnimationFrame(settle);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      for (const id of timers) window.clearTimeout(id);
    };
  }, [
    open,
    pageCount,
    paperId,
    layout.orientation,
    marginShorthand,
    logoId,
    readinessNonce,
    readinessTimeouts,
  ]);

  // Attempt-history tracker. When the modal closes, clear the log so the next
  // open session starts fresh. When a new settle pass begins (open flips true
  // or Retry bumps the nonce), append a fresh pending entry. The follow-up
  // effect mirrors the live `readiness` snapshot onto the last entry so its
  // per-stage outcomes and total duration reflect the in-flight pass.
  useEffect(() => {
    if (!open) {
      setAttempts([]);
      setAttemptFilters(emptyFilters);
      setAttemptFiltersOpen(false);
      return;
    }
    setAttempts((prev) => [
      ...prev,
      {
        n: prev.length + 1,
        startedAt: perfNow(),
        wallStartedAt: Date.now(),
        endedAt: null,
        fonts: "pending",
        fontsEndedAtMs: null,
        images: "pending",
        imagesEndedAtMs: null,
        layout: "pending",
        layoutEndedAtMs: null,
        totalMs: null,
        bookingId: bookingIdProp ?? null,
        bookingLabel: bookingLabelProp ?? null,
      },
    ]);
    // emptyFilters is a stable module-adjacent literal; safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, readinessNonce, bookingIdProp, bookingLabelProp]);

  useEffect(() => {
    setAttempts((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      const patched: ReadinessAttempt = {
        ...last,
        fonts: readiness.fonts,
        fontsEndedAtMs: readiness.fontsEndedAtMs,
        images: readiness.images,
        imagesEndedAtMs: readiness.imagesEndedAtMs,
        layout: readiness.layout,
        layoutEndedAtMs: readiness.layoutEndedAtMs,
        totalMs: readiness.totalMs,
        endedAt: readiness.totalMs != null ? last.startedAt + readiness.totalMs : last.endedAt,
      };
      if (
        patched.fonts === last.fonts &&
        patched.fontsEndedAtMs === last.fontsEndedAtMs &&
        patched.images === last.images &&
        patched.imagesEndedAtMs === last.imagesEndedAtMs &&
        patched.layout === last.layout &&
        patched.layoutEndedAtMs === last.layoutEndedAtMs &&
        patched.totalMs === last.totalMs &&
        patched.endedAt === last.endedAt
      ) {
        return prev;
      }
      return [...prev.slice(0, -1), patched];
    });
  }, [readiness]);

  // "Fit to one page" convergence — hybrid ratio jump + binary search with
  // hard guardrails so a pathological layout (content taller than the printable
  // area even at 50%, or a non-monotonic paginator) can never spin forever.
  //
  // Bracket:
  //   • `lo` = largest scale known to spill (>1 page)
  //   • `hi` = smallest scale known to fit  (=1 page)
  //
  // Guardrails:
  //   • MAX_ITERATIONS caps total setState calls per search.
  //   • `tried` set breaks cycles if pagination is non-monotonic near a boundary.
  //   • On give-up we clamp to the tightest known-fitting scale, or the 50%
  //     floor if nothing has ever fit — never leaves the UI mid-search.
  //   • Bracket collapse (hi-lo ≤ 1) latches convergence so we stop nudging.
  // Delegated to `src/lib/fitToOnePage.ts` so runtime + unit tests share one
  // implementation (including non-monotonic pagination hardening).
  const fitBoundsRef = useRef<FitStateLib | null>(null);
  // Impossible = search terminated with no fitting scale ever observed.
  const [fitImpossible, setFitImpossible] = useState(false);
  // Summary shown after the search terminates: final scale, iteration count,
  // clamp range explored, and whether pagination was unstable.
  const [fitResult, setFitResult] = useState<{
    scale: number;
    steps: number;
    impossible: boolean;
    unstable: boolean;
    minScale: number;
    maxScale: number | null;
    geometry: { paper: string; orientation: "portrait" | "landscape"; margins: string };
  } | null>(null);
  useEffect(() => {
    if (!settings.fitOnePage) {
      fitBoundsRef.current = null;
      setFitImpossible(false);
      setFitResult(null);
    }
  }, [settings.fitOnePage]);
  // Reset the search whenever geometry that changes pagination changes.
  useEffect(() => {
    if (settings.fitOnePage) {
      fitBoundsRef.current = createFitState();
      setFitImpossible(false);
      setFitResult(null);
    }
  }, [settings.fitOnePage, paper.shortLabel, layout.orientation, marginShorthand]);

  useEffect(() => {
    if (!open || !settings.fitOnePage) return;
    const state = fitBoundsRef.current ?? createFitState();
    fitBoundsRef.current = state;
    if (state.done) return;

    const debug = settings.debugFit;
    // Always capture structured log entries so we can emit telemetry on the
    // terminal decision. `onLog` (console noise) stays gated behind the
    // debug toggle.
    const decision = fitStep(state, settings.scalePct, pageCount, {
      debug: true,
      onLog: debug
        ? (e) => {
            console.debug(
              `[fit] iter=${e.iteration} scale=${e.currentScale}% pages=${e.pageCount} lo=${e.lo} hi=${e.hi} fit=[${e.fittingScales.join(",")}]${e.unstable ? " UNSTABLE" : ""} → ${e.decision}:${e.nextScale} (${e.reason})`,
            );
          }
        : undefined,
    });
    const snapshotBracket = () => ({
      minScale: Math.max(FIT_MIN, state.lo + 1),
      maxScale: Number.isFinite(state.hi) ? (state.hi as number) : null,
    });

    if (decision.kind === "done") {
      const impossible = decision.impossible === true;
      const unstable = decision.unstable === true;
      if (impossible) setFitImpossible(true);
      if (decision.scalePct !== settings.scalePct) {
        setSettings((s) => ({ ...s, scalePct: decision.scalePct }));
      }
      setFitResult({
        scale: decision.scalePct,
        steps: state.iterations,
        impossible,
        unstable,
        geometry: {
          paper: paper.shortLabel,
          orientation: layout.orientation,
          margins: marginShorthand,
        },
        ...snapshotBracket(),
      });
      recordFitRun({
        source: "preview",
        finalScale: decision.scalePct,
        steps: state.iterations,
        impossible,
        unstable,
        log: state.log,
        context: {
          paper: paper.shortLabel,
          orientation: layout.orientation,
          margins: marginShorthand,
          pageCountObserved: pageCount,
          startScale: settings.scalePct,
        },
      });
      return;
    }

    // Guard against loops if FIT_MAX ever gets exceeded (shouldn't, but belt+braces).
    const next = Math.max(FIT_MIN, Math.min(FIT_MAX, decision.scalePct));
    if (next !== settings.scalePct) {
      setSettings((s) => ({ ...s, scalePct: next }));
    }
  }, [
    open,
    settings.fitOnePage,
    settings.debugFit,
    pageCount,
    settings.scalePct,
    paper.shortLabel,
    layout.orientation,
    marginShorthand,
  ]);

  const handlePrint = () => {
    // Settings-driven extras: font scale, margin override and optional
    // logo hide. `@page margin` stays 0 (the sheet handles padding) so
    // the browser dialog's own margin field must be "Default" — the
    // preview and native output both draw the same physical margin band.
    // Preview and print must share the same effective scale so the on-
    // screen sheet is a faithful WYSIWYG of the printed output. SCALE is
    // derived from settings.scalePct and — for receipts — clamped to
    // RECEIPT_SAFE_SCALE_PCT (= RECEIPT_COMPACT_SCALE_PCT).
    const receiptPrintScale = SCALE;
    const settingsPrintCss = `
      .doc-sheet {
        padding: ${marginShorthand} !important;
        box-sizing: border-box !important;
        font-size: ${bodyPt}pt !important;
        line-height: ${lineH} !important;
      }
      ${
        props.docType === "receipt"
          ? `
        /* Receipt uses CSS zoom so both text and mm-based spacing shrink
           uniformly to fit the configured margin box. Kept identical to
           the preview's .pp-print-root .pp-receipt { zoom: ... } rule. */
        .pp-receipt {
          zoom: ${receiptPrintScale};
          transform-origin: top left;
        }
      `
          : ""
      }
      ${
        settings.includeLogo
          ? ""
          : `
        .doc-sheet [data-letterhead-logo] { display: none !important; }
      `
      }
    `;
    // For receipts we deliberately DO NOT clamp the sheet to a fixed A4
    // height or hide overflow — long receipts (long client names, deep
    // payment breakdowns, multi-line amount-in-words) need to flow onto
    // a second physical page using the explicit break rules defined on
    // .pp-copy / .pp-tear-line, otherwise the extra content is clipped
    // off the sheet and the second copy appears to "disappear".
    const singlePagePrintCss =
      forceSinglePage && props.docType !== "receipt"
        ? `
        .pp-single-page-sheet.doc-sheet {
          width: ${PAGE_W_MM}mm !important;
          height: ${PAGE_H_MM}mm !important;
          min-height: ${PAGE_H_MM}mm !important;
          max-height: ${PAGE_H_MM}mm !important;
          overflow: hidden !important;
          page-break-before: avoid !important;
          page-break-after: avoid !important;
          page-break-inside: avoid !important;
          break-before: avoid !important;
          break-after: avoid !important;
          break-inside: avoid !important;
        }
        .pp-single-page-sheet.doc-sheet + .pp-single-page-sheet.doc-sheet {
          display: none !important;
        }
        .pp-single-page-sheet .doc-body,
        .pp-single-page-sheet .doc-body * {
          overflow: hidden !important;
        }
      `
        : forceSinglePage && props.docType === "receipt"
          ? `
        /* Receipt: keep the sheet A4-sized but let content overflow
           onto additional pages when it truly cannot fit. The .pp-copy
           break rules ensure each copy stays whole. */
        .pp-single-page-sheet.doc-sheet {
          width: ${PAGE_W_MM}mm !important;
          min-height: ${PAGE_H_MM}mm !important;
          overflow: visible !important;
        }
        .pp-single-page-sheet .doc-body {
          overflow: visible !important;
        }
      `
          : "";
    // Receipt-specific extras — the shared rules from RECEIPT_SHARED_STYLES
    // are re-emitted here with !important so they win against user-agent /
    // vendor print stylesheets. The preview injects the same rules without
    // !important, giving a true WYSIWYG match for anything that isn't
    // print-media specific.
    const receiptExtras =
      props.docType === "receipt"
        ? `
          .pp-single-page-sheet .doc-body {
            padding: 0 !important;
            min-height: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            overflow: visible !important;
          }
          .pp-single-page-sheet .doc-body > div {
            width: 100% !important;
            max-width: 100% !important;
            min-width: 0 !important;
          }
          ${RECEIPT_SHARED_STYLES.replace(/;(?=\s*(\n|}))/g, " !important;")}
          ${PAYMENT_RECEIPT_PRINT_STYLES}
        `
        : "";
    void preparePrint({
      pageW: PAGE_W_MM,
      pageH: PAGE_H_MM,
      title,
      extraPrintCss: paper.printExtras + receiptExtras + settingsPrintCss + singlePagePrintCss,
      singlePage: forceSinglePage,
    });
  };

  // Auto-trigger the browser print dialog once layout has settled, when a
  // caller opens the modal with `autoAction="print"` (e.g. "Download receipt
  // PDF"). Uses the same preparePrint pipeline as the manual Print button so
  // page-break rules and typography match native print exactly. Closes the
  // modal after firing so the preview never flashes on screen.
  const autoFiredRef = useRef(false);
  useEffect(() => {
    if (!open) {
      autoFiredRef.current = false;
      return;
    }
    if (autoAction !== "print" || autoFiredRef.current) return;
    if (pageCount < 1) return;
    autoFiredRef.current = true;
    const t = window.setTimeout(() => {
      handlePrint();
      // Close shortly after the print dialog opens so the modal doesn't linger.
      window.setTimeout(() => onOpenChange(false), 400);
    }, 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoAction, pageCount]);

  // "Auto print when ready" — fires the print dialog exactly once as soon as
  // every readiness stage settles. Skipped when the caller already drives an
  // auto-print via `autoAction="print"` (that path has its own timing and
  // close-after-print behavior). Reset on modal close and on Retry so a fresh
  // settle pass can re-arm the shot.
  useEffect(() => {
    if (!open) {
      autoPrintFiredRef.current = false;
      return;
    }
    if (!autoPrintWhenReady) return;
    if (autoAction === "print") return; // caller-driven auto-print wins
    if (renderStatus !== "ready") return;
    if (autoPrintFiredRef.current) return;
    autoPrintFiredRef.current = true;
    // Small delay so the "ready" state has a chance to paint before the
    // browser print dialog steals focus — helps users see it actually fired.
    const t = window.setTimeout(() => {
      handlePrint();
    }, 120);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoPrintWhenReady, renderStatus, autoAction]);

  // Re-arm auto-print whenever the user forces a fresh settle pass via Retry.
  useEffect(() => {
    autoPrintFiredRef.current = false;
  }, [readinessNonce]);

  const sheetStyle: React.CSSProperties = {
    width: `${PAGE_W_MM}mm`,
    height: `${PAGE_H_MM}mm`,
    padding: marginShorthand,
    boxSizing: "border-box",
    background: "#fff",
    color: "#111",
    fontFamily: PRINT_FONT,
    fontSize: `${bodyPt}pt`,
    lineHeight: lineH,
    overflow: isReceiptDoc ? "visible" : "hidden",
    display: "flex",
    flexDirection: "column",
    position: "relative",
  };

  // Preview-only layout-guide overlay. Rendered inside each sheet at the same
  // physical (mm) coordinates as the print output, so what you see is exactly
  // what will be printed. `aria-hidden` + `pointer-events:none` keep it out of
  // the a11y tree and never intercept clicks; the overlay is never included
  // in `preparePrint()`, so it cannot leak into paper or PDF output.
  //
  // The design language:
  //   • 1px dashed hairline outlining the margin box.
  //   • Two dashed cross-lines separating the header band, body, and footer.
  //   • Corner ticks reinforce alignment at print-safe corners.
  //   • Colour uses `currentColor` on a translucent primary hue so it stays
  //     high-contrast against both white sheets and (via mix-blend) darker
  //     themed dialog backgrounds. `mix-blend-mode: multiply` guarantees the
  //     hairline stays visible on the always-white sheet background.
  const LayoutGuides = () => {
    if (!layout.showGuides) return null;
    const guideColor = "rgba(37, 99, 235, 0.55)"; // slate/blue — passes AA on white
    const dash = "1px dashed " + guideColor;
    return (
      <div
        aria-hidden="true"
        className="pp-layout-guides"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          mixBlendMode: "multiply",
          zIndex: 5,
        }}
      >
        {/* Margin box */}
        <div
          style={{
            position: "absolute",
            top: `${MT}mm`,
            left: `${ML}mm`,
            right: `${MR}mm`,
            bottom: `${MB}mm`,
            border: dash,
            borderRadius: 2,
          }}
        />
        {/* Header/body divider */}
        <div
          style={{
            position: "absolute",
            top: `${MT + headerH}mm`,
            left: `${ML}mm`,
            right: `${MR}mm`,
            borderTop: dash,
          }}
        />
        {/* Body/footer divider */}
        <div
          style={{
            position: "absolute",
            bottom: `${MB + footerH}mm`,
            left: `${ML}mm`,
            right: `${MR}mm`,
            borderTop: dash,
          }}
        />
        {/* Corner ticks for alignment cues */}
        {(["tl", "tr", "bl", "br"] as const).map((c) => {
          const vertical = c[0] === "t" ? "top" : "bottom";
          const horizontal = c[1] === "l" ? "left" : "right";
          return (
            <div
              key={c}
              style={
                {
                  position: "absolute",
                  [vertical]: `calc(${c[0] === "t" ? MT : MB}mm - 3mm)`,
                  [horizontal]: `calc(${c[1] === "l" ? ML : MR}mm - 3mm)`,
                  width: "6mm",
                  height: "6mm",
                  borderTop: c[0] === "t" ? `1px solid ${guideColor}` : undefined,
                  borderBottom: c[0] === "b" ? `1px solid ${guideColor}` : undefined,
                  borderLeft: c[1] === "l" ? `1px solid ${guideColor}` : undefined,
                  borderRight: c[1] === "r" ? `1px solid ${guideColor}` : undefined,
                } as React.CSSProperties
              }
            />
          );
        })}
        {/* Bottom-right size caption */}
        <div
          style={{
            position: "absolute",
            right: `${MR}mm`,
            bottom: `calc(${MB}mm - 5mm)`,
            fontSize: "8pt",
            fontFamily: "system-ui, -apple-system, sans-serif",
            color: guideColor,
            letterSpacing: "0.02em",
          }}
        >
          {paper.shortLabel} · {isLandscape ? "Landscape" : "Portrait"} · {marginLabel} margin
        </div>
      </div>
    );
  };

  const contentBoxStyle: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    overflow: isReceiptDoc ? "visible" : "hidden",
    paddingTop: hideLetterhead ? 0 : "6mm",
    paddingBottom: hideLetterhead ? 0 : "4mm",
  };

  const measureNode =
    isReact && open
      ? createPortal(
          <div
            ref={measureRef}
            style={{
              position: "fixed",
              left: "-10000px",
              top: 0,
              width: `${contentWmm}mm`,
              fontFamily: PRINT_FONT,
              fontSize: `${bodyPt}pt`,
              lineHeight: lineH,
              visibility: "hidden",
            }}
          >
            {reactChildren}
          </div>,
          document.body,
        )
      : null;

  const reactChildArray = useMemo(() => {
    if (!isReact) return [] as ReactNode[];
    const arr: ReactNode[] = [];
    const walk = (n: ReactNode) => {
      if (Array.isArray(n)) n.forEach(walk);
      else arr.push(n);
    };
    walk(reactChildren);
    return arr;
  }, [isReact, reactChildren]);

  // Shared confirm-action helpers so the top toolbar and the mobile-only
  // sticky bottom action bar both go through the same checklist gate.
  const confirmExport = () => {
    if (!allChecked) {
      const remaining = CHECKLIST_ITEMS.filter((i) => !checked[i.id]).map((i) => i.label);
      toast.error("Complete the print setup checklist first", {
        description: `${checkedCount}/${CHECKLIST_ITEMS.length} confirmed. Still needed: ${remaining.join(", ")}.`,
        action: { label: "Open checklist", onClick: () => setChecklistOpen(true) },
      });
      setChecklistOpen(true);
      return;
    }
    if (props.onConfirmExport) {
      props.onConfirmExport();
      onOpenChange(false);
      return;
    }
    handlePrint();
  };
  const confirmPrint = () => {
    if (!allChecked) {
      const remaining = CHECKLIST_ITEMS.filter((i) => !checked[i.id]).map((i) => i.label);
      toast.error("Complete the print setup checklist first", {
        description: `${checkedCount}/${CHECKLIST_ITEMS.length} confirmed. Still needed: ${remaining.join(", ")}.`,
        action: { label: "Open checklist", onClick: () => setChecklistOpen(true) },
      });
      setChecklistOpen(true);
      return;
    }
    if (props.onConfirmPrint) {
      props.onConfirmPrint();
      onOpenChange(false);
      return;
    }
    handlePrint();
  };

  // Dedicated "Download PDF" — renders the exact preview sheets (same PRINT_CSS,
  // same DOM, same paper geometry) into a downloadable file. Distinct from
  // confirmExport / confirmPrint, which open the OS/browser print dialog and
  // rely on the user picking "Save as PDF" as the destination. This path
  // guarantees byte-for-byte preview parity without needing that manual step.
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfStage, setPdfStage] = useState<PdfProgressStage | null>(null);
  const downloadPdf = async () => {
    if (pdfBusy) return;
    const scroller = previewScrollRef.current;
    if (!scroller) {
      toast.error("Preview is not ready yet");
      return;
    }
    setPdfBusy(true);
    setPdfStage("collecting");
    const toastId = toast.loading("Preparing PDF…", {
      description: PDF_PROGRESS_LABEL.collecting,
    });
    try {
      const safeName =
        (title || "document")
          .replace(/[\\/:*?"<>|]+/g, "-")
          .replace(/\s+/g, " ")
          .trim() || "document";
      const result = await downloadPreviewSheetsAsPdf({
        root: scroller,
        filename: safeName,
        pageWidthMm: PAGE_W_MM,
        pageHeightMm: PAGE_H_MM,
        onProgress: (stage, extra) => {
          setPdfStage(stage);
          const suffix = extra?.page && extra?.total ? ` (${extra.page}/${extra.total})` : "";
          toast.loading("Preparing PDF…", {
            id: toastId,
            description: `${PDF_PROGRESS_LABEL[stage]}${suffix}`,
          });
        },
      });
      toast.success("PDF downloaded", {
        id: toastId,
        description: `${result.filename} · ${result.pageCount} page${result.pageCount === 1 ? "" : "s"}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to build the PDF.";
      toast.error("Download failed", { id: toastId, description: message });
    } finally {
      setPdfBusy(false);
      setPdfStage(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={
            "max-w-[min(96vw,1100px)] w-[min(96vw,1100px)] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden " +
            (autoAction === "print" ? "opacity-0 pointer-events-none" : "")
          }
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>

          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b bg-card">
            <div className="flex items-center gap-3 min-w-0">
              <div className="text-sm font-semibold truncate">{title}</div>
              <span
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium tabular-nums text-foreground/80 whitespace-nowrap"
                title={`Live page count — recalculated from paper size, orientation, margins and scale. Currently ${paper.shortLabel} ${isLandscape ? "landscape" : "portrait"}, margins ${marginLabel}, scale ${settings.scalePct}%.`}
                aria-live="polite"
                aria-label={`${pageCount} page${pageCount === 1 ? "" : "s"} at current settings`}
              >
                <FileText className="h-3 w-3 opacity-70" aria-hidden="true" />
                {pageCount} page{pageCount === 1 ? "" : "s"}
                {settings.fitOnePage ? " · fit" : ""}
              </span>
              <span className="text-[11px] text-muted-foreground whitespace-nowrap hidden sm:inline">
                {paper.shortLabel} · {isLandscape ? "Landscape" : "Portrait"} · Style {style}
              </span>
            </div>
            <div className="flex flex-nowrap items-center gap-1 min-w-0 overflow-x-auto [scrollbar-width:thin]">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 min-h-11 min-w-11"
                onClick={() => setZoomWithUserFlag((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))}
                title="Zoom out"
                aria-label="Zoom out"
              >
                <ZoomOut className="h-4 w-4" aria-hidden="true" />
              </Button>
              <div className="text-[11px] tabular-nums w-10 text-center text-muted-foreground">
                {Math.round(zoom * 100)}%
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 min-h-11 min-w-11"
                onClick={() => setZoomWithUserFlag((z) => Math.min(1.5, +(z + 0.1).toFixed(2)))}
                title="Zoom in"
                aria-label="Zoom in"
              >
                <ZoomIn className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 min-h-11 min-w-11"
                onClick={() => setZoomWithUserFlag(1)}
                title="100%"
                aria-label="Reset zoom to 100%"
              >
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
              </Button>
              <div
                className="w-px h-5 bg-border mx-1"
                role="separator"
                aria-orientation="vertical"
              />
              <div
                className="flex items-center gap-1.5"
                title="Paper size — matches @page size and the browser print dialog. Also swaps the cross-browser page-break preset."
              >
                <Select value={paperId} onValueChange={(v) => setPaperId(v as PaperPresetId)}>
                  <SelectTrigger
                    className="h-8 w-[104px] text-[11px] min-h-11 min-w-11"
                    aria-label="Paper size"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(PAPER_PRESETS).map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-[12px]">
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div
                  role="group"
                  aria-label="Page orientation"
                  className="inline-flex items-center rounded-md border border-border/60 bg-muted/40 p-0.5"
                >
                  <Button
                    type="button"
                    variant={isLandscape ? "ghost" : "default"}
                    size="sm"
                    className="h-7 px-2 text-[11px] gap-1 min-h-11 min-w-11"
                    onClick={() => setLayout((l) => ({ ...l, orientation: "portrait" }))}
                    aria-pressed={!isLandscape}
                    aria-label="Portrait orientation"
                    title="Portrait — page taller than wide"
                  >
                    <RectangleVertical className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden md:inline">Portrait</span>
                  </Button>
                  <Button
                    type="button"
                    variant={isLandscape ? "default" : "ghost"}
                    size="sm"
                    className="h-7 px-2 text-[11px] gap-1 min-h-11 min-w-11"
                    onClick={() => setLayout((l) => ({ ...l, orientation: "landscape" }))}
                    aria-pressed={isLandscape}
                    aria-label="Landscape orientation"
                    title="Landscape — page wider than tall"
                  >
                    <RectangleHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden md:inline">Landscape</span>
                  </Button>
                </div>
              </div>
              <div
                className="flex items-center gap-1.5 pl-1.5 ml-0.5 border-l"
                title="Toggle a preview-only overlay showing page margins and header/footer bands. Never printed."
              >
                <Ruler
                  className={`h-3.5 w-3.5 ${layout.showGuides ? "text-primary" : "text-muted-foreground"}`}
                  aria-hidden="true"
                />
                <Label htmlFor="pp-guides" className="text-[11px] cursor-pointer select-none">
                  Show Layout Guides
                </Label>
                <Switch
                  id="pp-guides"
                  checked={layout.showGuides}
                  onCheckedChange={(v) => setLayout((l) => ({ ...l, showGuides: !!v }))}
                  aria-label="Show layout guides overlay (preview only, never printed)"
                />
              </div>
              <div
                className="flex items-center gap-1.5 pl-1.5 ml-0.5 border-l"
                title={
                  isReceiptDoc
                    ? "Developer overlay: sheet + body bounding boxes, page-break separators, and receipt overflow diagnostics. Preview only — never printed."
                    : "Developer overlay: sheet + body bounding boxes and page-break separators to catch layout collapses. Preview only — never printed."
                }
              >
                <Bug
                  className={`h-3.5 w-3.5 ${showPrintDebug ? "text-primary" : "text-muted-foreground"}`}
                  aria-hidden="true"
                />
                <Label htmlFor="pp-debug" className="text-[11px] cursor-pointer select-none">
                  Debug overlay
                </Label>
                <Switch
                  id="pp-debug"
                  checked={showPrintDebug}
                  onCheckedChange={(v) => setShowPrintDebug(!!v)}
                  aria-label="Show print layout debug overlay (preview only, never printed)"
                />
              </div>

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 min-h-11 min-w-11"
                    aria-label={`Print settings — margins ${marginLabel}, scale ${settings.scalePct}%, logo ${settings.includeLogo ? "on" : "off"}`}
                    title="Print settings — margins, scale and logo"
                  >
                    <Settings2 className="h-4 w-4 mr-1" aria-hidden="true" />
                    Settings
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold">Print settings</h3>
                    <button
                      type="button"
                      className="text-[11px] text-muted-foreground hover:underline inline-flex items-center gap-1"
                      onClick={() => {
                        const defPaper = PAPER_PRESETS[DEFAULT_PAPER_PRESET_ID];
                        setPaperId(DEFAULT_PAPER_PRESET_ID);
                        setLogoId(DEFAULT_LOGO_ID);
                        setLayout({ orientation: "portrait", showGuides: true });
                        setSettings((s) => ({
                          marginMm: isReceiptDoc ? RECEIPT_SAFE_MARGIN_MM : defPaper.marginMm,
                          scalePct: isReceiptDoc ? RECEIPT_SAFE_SCALE_PCT : 100,
                          includeLogo: true,
                          customSides: false,
                          marginTopMm: isReceiptDoc ? RECEIPT_SAFE_MARGIN_MM : defPaper.marginMm,
                          marginRightMm: isReceiptDoc ? RECEIPT_SAFE_MARGIN_MM : defPaper.marginMm,
                          marginBottomMm: isReceiptDoc ? RECEIPT_SAFE_MARGIN_MM : defPaper.marginMm,
                          marginLeftMm: isReceiptDoc ? RECEIPT_SAFE_MARGIN_MM : defPaper.marginMm,
                          gutterMm: 0,
                          gutterSide: "left",
                          fitOnePage: false,
                          // Preserve the diagnostics toggle across Reset.
                          debugFit: s.debugFit,
                        }));
                      }}
                      aria-label="Reset print settings to defaults"
                      title="Reset paper, margins, scale, orientation and letterhead logo to defaults (keeps debug fit toggle)"
                    >
                      <RotateCcw className="h-3 w-3" /> Reset
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="pp-margin" className="text-[12px]">
                        Margins
                      </Label>
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {settings.customSides ? marginLabel : `${PAGE_MARGIN.toFixed(1)} mm`}
                      </span>
                    </div>
                    {!settings.customSides && (
                      <Slider
                        id="pp-margin"
                        value={[PAGE_MARGIN]}
                        min={5}
                        max={40}
                        step={0.5}
                        onValueChange={(v) =>
                          setSettings((s) => ({
                            ...s,
                            marginMm: v[0],
                            marginTopMm: v[0],
                            marginRightMm: v[0],
                            marginBottomMm: v[0],
                            marginLeftMm: v[0],
                          }))
                        }
                        aria-label="Page margin in millimetres"
                      />
                    )}
                    <div className="flex gap-1 pt-0.5">
                      {[
                        { label: "Narrow", v: 12.7 },
                        { label: "Normal", v: paper.marginMm },
                        { label: "Wide", v: 32 },
                      ].map((p) => (
                        <Button
                          key={p.label}
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px] flex-1 min-h-11 min-w-11"
                          onClick={() =>
                            setSettings((s) => ({
                              ...s,
                              marginMm: p.v,
                              marginTopMm: p.v,
                              marginRightMm: p.v,
                              marginBottomMm: p.v,
                              marginLeftMm: p.v,
                            }))
                          }
                        >
                          {p.label}
                        </Button>
                      ))}
                    </div>
                    <div className="flex items-center justify-between pt-1.5">
                      <Label
                        htmlFor="pp-custom-sides"
                        className="text-[11px] text-muted-foreground"
                      >
                        Custom per side (mm)
                      </Label>
                      <Switch
                        id="pp-custom-sides"
                        checked={settings.customSides}
                        onCheckedChange={(v) => setSettings((s) => ({ ...s, customSides: !!v }))}
                        aria-label="Toggle precise per-side margins"
                      />
                    </div>
                    {settings.customSides && (
                      <>
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          {(
                            [
                              { key: "marginTopMm", label: "Top" },
                              { key: "marginRightMm", label: "Right" },
                              { key: "marginBottomMm", label: "Bottom" },
                              { key: "marginLeftMm", label: "Left" },
                            ] as const
                          ).map(({ key, label }) => {
                            const invalid = isSideInvalid(key);
                            const { max } = sideChecks[key];
                            const softMax = Math.max(MIN_SIDE, Math.min(MAX_SIDE_HARD, max));
                            return (
                              <div key={key} className="space-y-1">
                                <Label
                                  htmlFor={`pp-m-${key}`}
                                  className="text-[10.5px] text-muted-foreground flex items-center justify-between"
                                >
                                  <span>{label}</span>
                                  <span
                                    className={`tabular-nums text-[9.5px] ${invalid ? "text-destructive" : "text-muted-foreground/60"}`}
                                    title={`Safe range for this side: ${MIN_SIDE}–${softMax.toFixed(1)} mm`}
                                  >
                                    ≤{softMax.toFixed(1)}
                                  </span>
                                </Label>
                                <Input
                                  id={`pp-m-${key}`}
                                  type="number"
                                  min={MIN_SIDE}
                                  max={MAX_SIDE_HARD}
                                  step={0.5}
                                  inputMode="decimal"
                                  className={`h-7 text-[11px] tabular-nums min-h-11 min-w-11 ${invalid ? "border-destructive text-destructive focus-visible:ring-destructive/40" : ""}`}
                                  value={settings[key]}
                                  aria-invalid={invalid}
                                  onChange={(e) => {
                                    const n = parseFloat(e.target.value);
                                    setSettings((s) => ({
                                      ...s,
                                      [key]: Number.isFinite(n) ? n : s[key],
                                    }));
                                  }}
                                  aria-label={`${label} margin in millimetres, safe up to ${softMax.toFixed(1)} on ${paper.shortLabel} ${isLandscape ? "landscape" : "portrait"}`}
                                />
                              </div>
                            );
                          })}
                        </div>
                        {marginWarnings.length > 0 && (
                          <div
                            role="alert"
                            className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[10.5px] leading-snug text-destructive"
                          >
                            <div className="font-medium mb-0.5">
                              Margin{marginWarnings.length > 1 ? "s" : ""} exceed printable area
                            </div>
                            <ul className="list-disc pl-4 space-y-0.5">
                              {marginWarnings.map((w, i) => (
                                <li key={i}>{w}</li>
                              ))}
                            </ul>
                            <div className="mt-1 text-muted-foreground text-[10px]">
                              Values are clamped for print — reduce to keep at least{" "}
                              {MIN_CONTENT_MM}mm of content on the page.
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Binding gutter — extra offset added to one edge for stapling/binding. */}
                    <div className="pt-2 border-t border-border/60 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="pp-gutter" className="text-[12px]">
                          Binding gutter
                        </Label>
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {gutter.toFixed(1)} mm · {settings.gutterSide}
                        </span>
                      </div>
                      <Slider
                        id="pp-gutter"
                        value={[gutter]}
                        min={0}
                        max={30}
                        step={0.5}
                        onValueChange={(v) => setSettings((s) => ({ ...s, gutterMm: v[0] }))}
                        aria-label="Binding gutter offset in millimetres"
                      />
                      <div className="grid grid-cols-4 gap-1 pt-0.5">
                        {(["left", "right", "top", "bottom"] as const).map((side) => (
                          <Button
                            key={side}
                            type="button"
                            size="sm"
                            variant={settings.gutterSide === side ? "default" : "outline"}
                            className="h-6 px-2 text-[10px] min-h-11 min-w-11 capitalize"
                            onClick={() => setSettings((s) => ({ ...s, gutterSide: side }))}
                            aria-label={`Place binding gutter on the ${side} edge`}
                            aria-pressed={settings.gutterSide === side}
                          >
                            {side}
                          </Button>
                        ))}
                      </div>
                      <p className="text-[10.5px] text-muted-foreground leading-snug">
                        Adds extra space on the binding edge (added on top of the base margin) so
                        content isn't lost when the page is bound or hole-punched.
                      </p>
                    </div>

                    {/* Saved named margin presets */}
                    <div className="pt-2 border-t border-border/60 space-y-1.5">
                      <Label className="text-[11px] text-muted-foreground">
                        Saved margin presets
                      </Label>
                      <div className="flex gap-1.5">
                        <Input
                          value={newPresetName}
                          onChange={(e) => setNewPresetName(e.target.value)}
                          placeholder="Preset name"
                          className="h-7 text-[11px] flex-1 min-h-11 min-w-11"
                          maxLength={24}
                          aria-label="New margin preset name"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[10.5px] min-h-11 min-w-11"
                          disabled={!newPresetName.trim()}
                          onClick={() => {
                            const name = newPresetName.trim();
                            if (!name) return;
                            const preset: MarginPreset = {
                              name,
                              top: baseMT,
                              right: baseMR,
                              bottom: baseMB,
                              left: baseML,
                              customSides: settings.customSides,
                              gutter,
                              gutterSide: settings.gutterSide,
                            };
                            setMarginPresets((list) => {
                              const filtered = list.filter((p) => p.name !== name);
                              return [...filtered, preset].slice(-12);
                            });
                            setNewPresetName("");
                          }}
                          title="Save current per-side margins as a named preset"
                        >
                          Save
                        </Button>
                      </div>
                      {marginPresets.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {marginPresets.map((p) => (
                            <div
                              key={p.name}
                              className="inline-flex items-center rounded border border-border/60 bg-muted/40 overflow-hidden"
                            >
                              <button
                                type="button"
                                className="px-2 py-0.5 text-[10.5px] hover:bg-muted transition-colors"
                                title={`Apply "${p.name}" — T${p.top} R${p.right} B${p.bottom} L${p.left} mm${p.gutter ? ` + ${p.gutter}mm ${p.gutterSide ?? "left"} gutter` : ""}`}
                                onClick={() =>
                                  setSettings((s) => ({
                                    ...s,
                                    marginMm: p.top,
                                    marginTopMm: p.top,
                                    marginRightMm: p.right,
                                    marginBottomMm: p.bottom,
                                    marginLeftMm: p.left,
                                    customSides: p.customSides,
                                    gutterMm: typeof p.gutter === "number" ? p.gutter : 0,
                                    gutterSide: p.gutterSide ?? "left",
                                  }))
                                }
                              >
                                {p.name}
                              </button>
                              <button
                                type="button"
                                className="px-1 py-0.5 text-muted-foreground hover:text-destructive hover:bg-muted transition-colors border-l border-border/60"
                                title={`Delete preset "${p.name}"`}
                                onClick={() =>
                                  setMarginPresets((list) => list.filter((x) => x.name !== p.name))
                                }
                                aria-label={`Delete ${p.name}`}
                              >
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="pp-scale" className="text-[12px]">
                        Scale
                      </Label>
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {settings.scalePct}%{settings.fitOnePage ? " · auto" : ""}
                      </span>
                    </div>
                    <Slider
                      id="pp-scale"
                      value={[settings.scalePct]}
                      min={70}
                      max={130}
                      step={5}
                      disabled={settings.fitOnePage}
                      onValueChange={(v) => setSettings((s) => ({ ...s, scalePct: v[0] }))}
                      aria-label="Content scale percentage"
                    />
                    <div className="flex items-center justify-between pt-1">
                      <div className="pr-2">
                        <Label htmlFor="pp-fit-one" className="text-[12px] block">
                          Fit to one page
                        </Label>
                        <p className="text-[10.5px] text-muted-foreground">
                          Auto-shrinks scale (down to 50%) so the receipt fits a single page at
                          current margins.
                        </p>
                      </div>
                      <Switch
                        id="pp-fit-one"
                        checked={settings.fitOnePage && !fitImpossible}
                        disabled={fitImpossible}
                        onCheckedChange={(v) => {
                          setFitImpossible(false);
                          setSettings((s) => ({
                            ...s,
                            fitOnePage: !!v,
                            // Restore full scale when turning fit off so the user isn't stuck small.
                            scalePct: v ? s.scalePct : 100,
                          }));
                        }}
                        aria-label="Auto-fit content to a single page"
                      />
                    </div>
                    {settings.fitOnePage &&
                      (() => {
                        const currentGeom = {
                          paper: paper.shortLabel,
                          orientation: layout.orientation,
                          margins: marginShorthand,
                        };
                        const stale =
                          !fitResult ||
                          fitResult.geometry.paper !== currentGeom.paper ||
                          fitResult.geometry.orientation !== currentGeom.orientation ||
                          fitResult.geometry.margins !== currentGeom.margins;
                        if (stale) {
                          return (
                            <FitSummary
                              fitResult={{
                                scale: 0,
                                steps: 0,
                                minScale: 0,
                                maxScale: null,
                                unstable: false,
                              }}
                              impossible={false}
                              recomputing={currentGeom}
                            />
                          );
                        }
                        return <FitSummary fitResult={fitResult} impossible={fitImpossible} />;
                      })()}
                    {fitImpossible &&
                      (() => {
                        const widestMm = Math.max(
                          ...Object.values(PAPER_PRESETS).map((p) =>
                            Math.max(p.widthMm, p.heightMm),
                          ),
                        );
                        const currentMax = Math.max(paper.widthMm, paper.heightMm);
                        const msg = buildImpossibleFitMessage({
                          paperLabel: paper.shortLabel,
                          isWidestPaper: currentMax >= widestMm,
                          orientation: layout.orientation,
                          marginsMm: { top: MT, right: MR, bottom: MB, left: ML },
                          minScalePct: FIT_MIN,
                        });
                        return (
                          <div
                            role="alert"
                            data-testid="fit-impossible-banner"
                            className="mt-1 rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1.5 text-[10.5px] leading-snug text-amber-700 dark:text-amber-300"
                          >
                            {msg.body}
                          </div>
                        );
                      })()}
                    <div className="flex items-center justify-between pt-1 border-t border-border/60 mt-2">
                      <div className="pr-2">
                        <Label htmlFor="pp-fit-debug" className="text-[12px] block">
                          Debug fit search
                        </Label>
                        <p className="text-[10.5px] text-muted-foreground">
                          Logs each iteration (scale, page count, bracket, reason) to the browser
                          console, and shows the trail below.
                        </p>
                      </div>
                      <Switch
                        id="pp-fit-debug"
                        checked={settings.debugFit}
                        onCheckedChange={(v) => setSettings((s) => ({ ...s, debugFit: !!v }))}
                        aria-label="Enable fit search debug logging"
                      />
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <div className="pr-2">
                        <Label className="text-[12px] block">Export fit trail</Label>
                        <p className="text-[10.5px] text-muted-foreground">
                          Download the most recent search (steps, scale, geometry) as JSON for bug
                          reports.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-[11px] min-h-11 min-w-11"
                        data-testid="pp-fit-export-trail"
                        disabled={!buildLatestFitTrailReport()}
                        onClick={() => downloadLatestFitTrail()}
                      >
                        Download JSON
                      </Button>
                    </div>
                    {settings.debugFit &&
                      settings.fitOnePage &&
                      fitBoundsRef.current &&
                      fitBoundsRef.current.log.length > 0 && (
                        <FitTrailPanel log={fitBoundsRef.current.log} />
                      )}
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t">
                    <div>
                      <Label htmlFor="pp-logo" className="text-[12px] block">
                        Include letterhead logo
                      </Label>
                      <p className="text-[10.5px] text-muted-foreground">
                        Hides only the logo tile — heading, address and footer stay.
                      </p>
                    </div>
                    <Switch
                      id="pp-logo"
                      checked={settings.includeLogo}
                      onCheckedChange={(v) => setSettings((s) => ({ ...s, includeLogo: !!v }))}
                      aria-label="Include letterhead logo in preview and print"
                    />
                  </div>
                </PopoverContent>
              </Popover>
              <div
                className="flex items-center gap-1.5"
                title="Choose which logo appears on the letterhead"
              >
                <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <Select value={logoId} onValueChange={setLogoId}>
                  <SelectTrigger
                    className="h-8 w-[180px] text-[11px] min-h-11 min-w-11"
                    aria-label="Letterhead logo"
                  >
                    <SelectValue placeholder="Logo" />
                  </SelectTrigger>
                  <SelectContent>
                    {LOGO_PICKER_ITEMS.map((o) => {
                      const isAuto = o.id === AUTO_LOGO_ID;
                      const resolved = isAuto
                        ? resolveLogoOption(AUTO_LOGO_ID, { style })
                        : (o as { url: string; bg?: "light" | "dark" });
                      return (
                        <SelectItem key={o.id} value={o.id} className="text-[12px]">
                          <span className="flex items-center gap-2">
                            <span
                              className="inline-block w-5 h-5 rounded-sm border"
                              style={{ background: resolved.bg === "dark" ? "#1B2B4B" : "#fff" }}
                            >
                              <img
                                src={resolved.url}
                                alt=""
                                className="w-full h-full object-contain"
                              />
                            </span>
                            {isAuto
                              ? `${o.label} — ${resolveLogoOption(AUTO_LOGO_ID, { style }).label}`
                              : o.label}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-[11px] min-h-11 min-w-11"
                  onClick={() => setAutoEditorOpen(true)}
                  title="Customize which logo Auto picks per document type"
                >
                  Customize…
                </Button>
              </div>
              <div
                className="w-px h-5 bg-border mx-1"
                role="separator"
                aria-orientation="vertical"
              />

              <Popover open={checklistOpen} onOpenChange={setChecklistOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant={allChecked ? "outline" : "secondary"}
                    size="sm"
                    className="h-8 min-h-11 min-w-11"
                    aria-label={`Print setup checklist, ${checkedCount} of ${CHECKLIST_ITEMS.length} settings confirmed${allChecked ? ", ready to print" : ""}`}
                    aria-haspopup="dialog"
                    aria-expanded={checklistOpen}
                  >
                    {allChecked ? (
                      <CheckCircle2 className="h-4 w-4 mr-1 text-green-600" aria-hidden="true" />
                    ) : (
                      <ListChecks className="h-4 w-4 mr-1" aria-hidden="true" />
                    )}
                    <span>Print setup</span>
                    <span className="ml-1.5 text-[10px] tabular-nums opacity-70" aria-hidden="true">
                      {checkedCount}/{CHECKLIST_ITEMS.length}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-80 p-3"
                  role="dialog"
                  aria-labelledby="pp-checklist-title"
                  aria-describedby="pp-checklist-desc"
                  onOpenAutoFocus={(e) => {
                    // Let Radix focus the first focusable (the first checkbox) by default.
                    // Just ensure focus actually lands inside, not on the trigger.
                    void e;
                  }}
                >
                  <h3 id="pp-checklist-title" className="text-xs font-semibold mb-1">
                    Before you print — set these in the browser dialog
                  </h3>
                  <p id="pp-checklist-desc" className="text-[11px] text-muted-foreground mb-2">
                    Browsers do not allow JavaScript to change the number of copies — you must set{" "}
                    <strong>Copies: 1</strong> yourself in the print dialog. Chrome, Edge and
                    Firefox use different labels for the same options; use Tab and Space to confirm
                    each item, then press Print.
                  </p>
                  <div
                    className="text-[11px] text-muted-foreground mb-3"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {checkedCount === CHECKLIST_ITEMS.length
                      ? "All print settings confirmed. Ready to print."
                      : `${checkedCount} of ${CHECKLIST_ITEMS.length} print settings confirmed.`}
                  </div>
                  <ul className="space-y-2" role="group" aria-labelledby="pp-checklist-title">
                    {CHECKLIST_ITEMS.map((item) => {
                      const cbId = `pp-chk-${item.id}`;
                      const isChecked = !!checked[item.id];
                      return (
                        <li key={item.id} className="flex items-start gap-2 leading-snug">
                          <Checkbox
                            id={cbId}
                            checked={isChecked}
                            onCheckedChange={(v) => setChecked((s) => ({ ...s, [item.id]: !!v }))}
                            className="mt-0.5"
                            aria-label={`${item.label}${isChecked ? ", confirmed" : ", not yet confirmed"}`}
                          />
                          <label htmlFor={cbId} className="text-[12px] cursor-pointer select-none">
                            {item.label}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex items-center justify-between mt-3 pt-2 border-t">
                    <button
                      type="button"
                      className="text-[11px] text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
                      onClick={() => setChecked({})}
                      aria-label="Reset all print settings to unchecked"
                    >
                      Reset
                    </button>
                    <Button
                      size="sm"
                      className="h-7 text-[11px] min-h-11 min-w-11"
                      onClick={() => {
                        setChecked(Object.fromEntries(CHECKLIST_ITEMS.map((i) => [i.id, true])));
                        setChecklistOpen(false);
                      }}
                      aria-label="Mark all print settings as confirmed and close checklist"
                    >
                      Mark all ready
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
              <Button
                variant="default"
                size="sm"
                onClick={downloadPdf}
                disabled={pdfBusy}
                aria-busy={pdfBusy}
                aria-label={
                  pdfBusy
                    ? pdfStage
                      ? PDF_PROGRESS_LABEL[pdfStage]
                      : "Preparing PDF…"
                    : `Download PDF (${pageCount} page${pageCount === 1 ? "" : "s"}) — matches preview exactly`
                }
                title="Download PDF using the same layout as the preview — no browser dialog needed"
                className="hidden sm:inline-flex"
              >
                <Download className="h-4 w-4 mr-1" aria-hidden="true" />
                {pdfBusy
                  ? pdfStage
                    ? PDF_PROGRESS_LABEL[pdfStage]
                    : "Preparing…"
                  : "Download PDF"}
                {!pdfBusy && (
                  <span className="ml-1.5 rounded-sm bg-primary-foreground/15 px-1.5 py-0.5 text-[10px] tabular-nums font-medium">
                    {pageCount} pg
                  </span>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={confirmExport}
                aria-label={
                  allChecked
                    ? `Export as PDF via browser print dialog (${pageCount} page${pageCount === 1 ? "" : "s"}). Choose 'Save as PDF' as destination.`
                    : `Print setup incomplete. ${checkedCount} of ${CHECKLIST_ITEMS.length} settings confirmed. Opens checklist.`
                }
                aria-disabled={!allChecked}
                title={
                  allChecked
                    ? `Export ${pageCount} page${pageCount === 1 ? "" : "s"} — set Destination to 'Save as PDF'`
                    : "Complete the print setup checklist first"
                }
                className="hidden sm:inline-flex"
              >
                <Download className="h-4 w-4 mr-1" aria-hidden="true" /> Export PDF
                <span className="ml-1.5 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] tabular-nums font-medium text-muted-foreground">
                  {pageCount} pg
                </span>
              </Button>
              <Button
                size="sm"
                onClick={confirmPrint}
                aria-label={
                  allChecked
                    ? `Open browser print dialog (${pageCount} page${pageCount === 1 ? "" : "s"})`
                    : `Print setup incomplete. ${checkedCount} of ${CHECKLIST_ITEMS.length} settings confirmed. Opens checklist.`
                }
                aria-disabled={!allChecked}
                title={
                  allChecked
                    ? `Print ${pageCount} page${pageCount === 1 ? "" : "s"} at ${paper.shortLabel} ${isLandscape ? "landscape" : "portrait"}`
                    : "Complete the print setup checklist first"
                }
                className="hidden sm:inline-flex"
              >
                <Printer className="h-4 w-4 mr-1" aria-hidden="true" /> Print
                <span className="ml-1.5 rounded-sm bg-primary-foreground/15 px-1.5 py-0.5 text-[10px] tabular-nums font-medium">
                  {pageCount} pg
                </span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  try {
                    downloadPrintDebugBundle("print-debug");
                    toast.success("Print debug bundle downloaded");
                  } catch (e) {
                    toast.error(
                      `Failed to build debug bundle: ${e instanceof Error ? e.message : String(e)}`,
                    );
                  }
                }}
                aria-label="Download print debug bundle (viewport, computed styles, font and image readiness, console logs)"
                title="Download print debug bundle (.json)"
                className="hidden sm:inline-flex"
              >
                <Bug className="h-4 w-4 mr-1" aria-hidden="true" /> Debug bundle
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 min-h-11 min-w-11"
                onClick={() => onOpenChange(false)}
                aria-label="Close print preview"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>

          <div
            ref={previewScrollRef}
            // Keyboard users must be able to scroll the preview to reach
            // paginated pages beyond the first fold. Focusable region +
            // aria-label + `region` role satisfies axe's
            // `scrollable-region-focusable` (WCAG 2.1.1) without changing
            // visual behavior. Discovered by print-modal-zoom-dpi-axe.spec.ts.
            tabIndex={0}
            role="region"
            aria-label="Print preview pages"
            className="relative flex-1 overflow-auto bg-[hsl(var(--muted))] p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          >
            <style>{PRINT_CSS}</style>
            {/* Safety net: guarantee the preview-only overlay never prints, even
              if a bundled print stylesheet ever forgets to hide it. */}
            <style>{`@media print { .pp-layout-guides { display: none !important; } }`}</style>
            {/* Preview render status chip — floats top-right of the preview
              scroller. While `renderStatus === "rendering"` we show a spinner
              + "Preparing preview…"; once ready it briefly confirms
              "Ready · N page(s)" before fading out. Announces via aria-live
              so assistive tech users get the same signal. */}
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className={`pointer-events-none sticky top-2 z-10 ml-auto w-fit -mr-2 rounded-full border border-border bg-card/95 backdrop-blur px-3 py-1.5 text-[11px] font-medium shadow-sm flex items-center gap-1.5 tabular-nums transition-opacity duration-300 ${
                renderStatus === "rendering"
                  ? "opacity-100 text-foreground"
                  : "opacity-0 text-muted-foreground"
              }`}
            >
              {renderStatus === "rendering" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  <span>Preparing preview…</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                  <span>
                    Ready · {pageCount} page{pageCount === 1 ? "" : "s"}
                  </span>
                </>
              )}
            </div>

            {/* Print readiness timeline — expanded checklist with per-stage
              timestamps so slow or missing stages (fonts stalled by a swap,
              a slow image, layout still shifting) can be diagnosed directly
              from the preview. Stays visible for the whole modal session so
              the final timing summary is inspectable even after the
              preview settles. Preview-only: never printed. Purely
              informational (aria-hidden) — the sibling chip above owns the
              aria-live announcement so screen readers aren't spammed. */}
            {(() => {
              // Format ms as "123 ms" or "1.24 s" for readability.
              const fmt = (ms: number) =>
                ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
              // Elapsed used for stages still in "pending" — advanced by the
              // readinessTick interval so the counter increments live.

              const _tickDep = readinessTick;
              const liveElapsed = perfNow() - readiness.startedAt;

              const stageTiming = (
                state: StageState,
                endedAt: number | null,
              ): { text: string; live: boolean } => {
                if (state === "pending") return { text: fmt(liveElapsed), live: true };
                if (endedAt != null) return { text: fmt(endedAt), live: false };
                return { text: "—", live: false };
              };

              const stages: Array<{
                key: "fonts" | "images" | "layout";
                label: string;
                state: StageState;
                detail?: string;
                timing: { text: string; live: boolean };
              }> = [
                {
                  key: "fonts",
                  label: "Fonts",
                  state: readiness.fonts,
                  timing: stageTiming(readiness.fonts, readiness.fontsEndedAtMs),
                },
                {
                  key: "images",
                  label: "Images",
                  state: readiness.images,
                  detail:
                    readiness.imagesTotal > 0
                      ? `${readiness.imagesLoaded} / ${readiness.imagesTotal}`
                      : undefined,
                  timing: stageTiming(readiness.images, readiness.imagesEndedAtMs),
                },
                {
                  key: "layout",
                  label: "Layout",
                  state: readiness.layout,
                  timing: stageTiming(readiness.layout, readiness.layoutEndedAtMs),
                },
              ];
              const readyCount = stages.filter((s) => s.state === "ready").length;
              const pct = Math.round((readyCount / stages.length) * 100);
              const settled = renderStatus === "ready";
              return (
                <div
                  data-testid="print-readiness-panel"
                  data-settled={settled ? "true" : "false"}
                  role="group"
                  aria-label={settled ? "Print timeline" : "Print readiness"}
                  className={`pointer-events-none sticky top-12 z-10 ml-auto w-fit -mr-2 mt-2 rounded-lg border border-border bg-card/95 backdrop-blur px-3 py-2 text-[11px] font-medium shadow-sm flex flex-col gap-1.5 tabular-nums transition-opacity duration-300 ${settled ? "opacity-70 hover:opacity-100" : "opacity-100"}`}
                >
                  <div className="flex items-center justify-between gap-3 text-foreground">
                    <span>{settled ? "Print timeline" : "Print readiness"}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground" data-testid="print-readiness-total">
                        {settled && readiness.totalMs != null ? fmt(readiness.totalMs) : `${pct}%`}
                      </span>
                      <button
                        type="button"
                        onClick={retryReadiness}
                        data-testid="print-readiness-retry"
                        title="Re-run font, image, and layout readiness checks"
                        aria-label="Retry print readiness check"
                        className="pointer-events-auto inline-flex items-center gap-1 rounded-md border border-border bg-background/80 hover:bg-accent hover:text-accent-foreground px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                  <label
                    className="pointer-events-auto flex items-center gap-1.5 text-[10px] font-normal text-muted-foreground select-none cursor-pointer"
                    title="Automatically open the print dialog once fonts, images, and layout finish loading"
                  >
                    {/* allow-small-tap: compact debug/status panel; the whole label (with 44px+ text row) is the tap target, not the checkbox glyph */}
                    <input
                      type="checkbox"
                      checked={autoPrintWhenReady}
                      onChange={(e) => setAutoPrintWhenReady(e.target.checked)}
                      data-testid="print-readiness-auto-print"
                      aria-label="Auto print when ready"
                      className="h-3 w-3 accent-primary cursor-pointer"
                    />
                    <span>Auto print when ready</span>
                  </label>
                  {!settled && (
                    <div
                      className="h-1 w-40 rounded-full bg-muted overflow-hidden"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={pct}
                      aria-label="Print readiness"
                    >
                      <div
                        className="h-full bg-primary transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                  <ul className="flex flex-col gap-1 mt-0.5">
                    {stages.map((s) => (
                      <li
                        key={s.key}
                        data-testid={`print-readiness-${s.key}`}
                        data-state={s.state}
                        data-elapsed-ms={
                          s.state === "pending"
                            ? Math.round(liveElapsed)
                            : s.key === "fonts"
                              ? (readiness.fontsEndedAtMs ?? "")
                              : s.key === "images"
                                ? (readiness.imagesEndedAtMs ?? "")
                                : (readiness.layoutEndedAtMs ?? "")
                        }
                        className="flex items-center gap-1.5"
                      >
                        {s.state === "ready" ? (
                          <CheckCircle2 className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                        ) : s.state === "timeout" ? (
                          <span
                            className="inline-block h-3 w-3 rounded-full border border-amber-500"
                            aria-hidden="true"
                          />
                        ) : (
                          <Loader2
                            className="h-3 w-3 animate-spin text-muted-foreground"
                            aria-hidden="true"
                          />
                        )}
                        <span
                          className={
                            s.state === "ready"
                              ? "text-foreground"
                              : s.state === "timeout"
                                ? "text-amber-600"
                                : "text-muted-foreground"
                          }
                        >
                          {s.label}
                          {s.detail ? ` · ${s.detail}` : ""}
                          {s.state === "timeout" ? " · timed out" : ""}
                        </span>
                        <span
                          className={`ml-auto pl-3 text-[10px] ${s.timing.live ? "text-muted-foreground/70" : "text-muted-foreground"}`}
                          data-testid={`print-readiness-${s.key}-timing`}
                        >
                          {s.timing.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {/* Attempt-history timeline. One row per readiness pass in
                    this modal session (initial open + each Retry). Shows the
                    outcome of every stage (ready / timed out / still pending)
                    alongside the total duration so operators can see whether
                    the second attempt fixed the first attempt's timeout, or
                    the same stage keeps stalling. Only appears once at least
                    one Retry has happened, since a single-pass session is
                    already fully described by the stage list above. */}
                  {attempts.length > 1 &&
                    (() => {
                      // Subscribe to the readinessTick heartbeat so the running
                      // attempt's elapsed counter re-renders live (~4×/sec) as
                      // new retries and stage outcomes stream in — no manual
                      // refresh required.
                      void readinessTick;
                      const latest = attempts[attempts.length - 1];
                      const latestRunning = renderStatus !== "ready";
                      const latestOutcome = latestRunning
                        ? "running"
                        : latest.fonts === "timeout" ||
                            latest.images === "timeout" ||
                            latest.layout === "timeout"
                          ? "timed out"
                          : latest.fonts === "ready" &&
                              latest.images === "ready" &&
                              latest.layout === "ready"
                            ? "ready"
                            : "incomplete";
                      return (
                        <div
                          className="mt-1 border-t border-border/60 pt-1"
                          data-testid="print-readiness-attempts"
                        >
                          <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center gap-1">
                            <span>Attempts</span>
                            {latestRunning && (
                              <span
                                className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"
                                aria-hidden="true"
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => setAttemptFiltersOpen((v) => !v)}
                              className="ml-auto text-[10px] underline decoration-dotted text-muted-foreground hover:text-foreground min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 px-1"
                              aria-expanded={attemptFiltersOpen}
                              aria-controls="print-readiness-attempt-filters"
                              data-testid="print-readiness-attempts-filter-toggle"
                            >
                              {attemptFiltersOpen ? "Hide filters" : "Filter"}
                              {(() => {
                                const active =
                                  attemptFilters.stages.length +
                                  attemptFilters.outcomes.length +
                                  (attemptFilters.nMin != null ? 1 : 0) +
                                  (attemptFilters.nMax != null ? 1 : 0) +
                                  (attemptFilters.bookingId ? 1 : 0) +
                                  (attemptFilters.dateFrom ? 1 : 0) +
                                  (attemptFilters.dateTo ? 1 : 0);
                                return active > 0 ? ` (${active})` : "";
                              })()}
                            </button>
                          </div>
                          {/* Screen-reader-only live region announces new
                        attempts and outcome transitions as they happen. */}
                          <div
                            role="status"
                            aria-live="polite"
                            aria-atomic="true"
                            className="sr-only"
                            data-testid="print-readiness-attempts-live"
                          >
                            Attempt #{latest.n}: {latestOutcome}
                          </div>
                          {attemptFiltersOpen &&
                            (() => {
                              const bookings = Array.from(
                                new Map(
                                  attempts
                                    .filter((a) => a.bookingId)
                                    .map((a) => [
                                      a.bookingId as string,
                                      a.bookingLabel || (a.bookingId as string),
                                    ]),
                                ).entries(),
                              );
                              const toggle = <T extends string>(arr: T[], v: T): T[] =>
                                arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
                              const stageOpts: Array<{ k: StageKey; label: string }> = [
                                { k: "fonts", label: "Fonts" },
                                { k: "images", label: "Images" },
                                { k: "layout", label: "Layout" },
                              ];
                              const outcomeOpts: Array<{
                                k: OutcomeKey;
                                label: string;
                              }> = [
                                { k: "ready", label: "Ready" },
                                { k: "timeout", label: "Timed out" },
                                { k: "running", label: "Running" },
                                { k: "pending", label: "Pending" },
                                { k: "incomplete", label: "Incomplete" },
                              ];
                              return (
                                <div
                                  id="print-readiness-attempt-filters"
                                  className="mb-1 rounded border border-border/60 bg-muted/30 p-1.5 text-[10px] flex flex-col gap-1"
                                  data-testid="print-readiness-attempts-filters"
                                >
                                  <div className="flex flex-wrap items-center gap-1">
                                    <span className="text-muted-foreground w-14">Stage</span>
                                    {stageOpts.map((s) => {
                                      const on = attemptFilters.stages.includes(s.k);
                                      return (
                                        <button
                                          key={s.k}
                                          type="button"
                                          onClick={() =>
                                            setAttemptFilters((f) => ({
                                              ...f,
                                              stages: toggle(f.stages, s.k),
                                            }))
                                          }
                                          aria-pressed={on}
                                          className={
                                            "rounded px-1.5 py-0.5 border min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 " +
                                            (on
                                              ? "bg-primary text-primary-foreground border-primary"
                                              : "bg-background text-foreground border-border")
                                          }
                                        >
                                          {s.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1">
                                    <span className="text-muted-foreground w-14">Outcome</span>
                                    {outcomeOpts.map((o) => {
                                      const on = attemptFilters.outcomes.includes(o.k);
                                      return (
                                        <button
                                          key={o.k}
                                          type="button"
                                          onClick={() =>
                                            setAttemptFilters((f) => ({
                                              ...f,
                                              outcomes: toggle(f.outcomes, o.k),
                                            }))
                                          }
                                          aria-pressed={on}
                                          className={
                                            "rounded px-1.5 py-0.5 border min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 " +
                                            (on
                                              ? "bg-primary text-primary-foreground border-primary"
                                              : "bg-background text-foreground border-border")
                                          }
                                        >
                                          {o.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1">
                                    <span className="text-muted-foreground w-14">Attempt #</span>
                                    <input
                                      type="number"
                                      min={1}
                                      placeholder="min"
                                      aria-label="Attempt number minimum"
                                      value={attemptFilters.nMin ?? ""}
                                      onChange={(e) =>
                                        setAttemptFilters((f) => ({
                                          ...f,
                                          nMin:
                                            e.target.value === "" ? null : Number(e.target.value),
                                        }))
                                      }
                                      className="w-14 rounded border border-border bg-background px-1 py-0.5 text-[10px]"
                                    />
                                    <span className="text-muted-foreground">–</span>
                                    <input
                                      type="number"
                                      min={1}
                                      placeholder="max"
                                      aria-label="Attempt number maximum"
                                      value={attemptFilters.nMax ?? ""}
                                      onChange={(e) =>
                                        setAttemptFilters((f) => ({
                                          ...f,
                                          nMax:
                                            e.target.value === "" ? null : Number(e.target.value),
                                        }))
                                      }
                                      className="w-14 rounded border border-border bg-background px-1 py-0.5 text-[10px]"
                                    />
                                  </div>
                                  {bookings.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-1">
                                      <span className="text-muted-foreground w-14">Booking</span>
                                      <select
                                        aria-label="Filter by booking"
                                        value={attemptFilters.bookingId ?? ""}
                                        onChange={(e) =>
                                          setAttemptFilters((f) => ({
                                            ...f,
                                            bookingId: e.target.value || null,
                                          }))
                                        }
                                        className="rounded border border-border bg-background px-1 py-0.5 text-[10px]"
                                      >
                                        <option value="">All</option>
                                        {bookings.map(([id, label]) => (
                                          <option key={id} value={id}>
                                            {label}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  )}
                                  <div className="flex flex-wrap items-center gap-1">
                                    <span className="text-muted-foreground w-14">Date</span>
                                    <input
                                      type="date"
                                      aria-label="From date"
                                      value={attemptFilters.dateFrom}
                                      onChange={(e) =>
                                        setAttemptFilters((f) => ({
                                          ...f,
                                          dateFrom: e.target.value,
                                        }))
                                      }
                                      className="rounded border border-border bg-background px-1 py-0.5 text-[10px]"
                                    />
                                    <span className="text-muted-foreground">–</span>
                                    <input
                                      type="date"
                                      aria-label="To date"
                                      value={attemptFilters.dateTo}
                                      onChange={(e) =>
                                        setAttemptFilters((f) => ({
                                          ...f,
                                          dateTo: e.target.value,
                                        }))
                                      }
                                      className="rounded border border-border bg-background px-1 py-0.5 text-[10px]"
                                    />
                                  </div>
                                  <div className="flex justify-end">
                                    <button
                                      type="button"
                                      onClick={() => setAttemptFilters(emptyFilters)}
                                      className="text-[10px] underline decoration-dotted text-muted-foreground hover:text-foreground min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 px-1"
                                      data-testid="print-readiness-attempts-filter-reset"
                                    >
                                      Reset
                                    </button>
                                  </div>
                                </div>
                              );
                            })()}
                          {(() => {
                            // Compute the visible subset once so the empty-state
                            // message and the <ol> stay in sync.
                            const computeOutcome = (a: ReadinessAttempt): OutcomeKey => {
                              const isCurrent = a.n === attempts.length;
                              const running = isCurrent && renderStatus !== "ready";
                              if (running) return "running";
                              const stages: StageState[] = [a.fonts, a.images, a.layout];
                              if (stages.some((s) => s === "timeout")) return "timeout";
                              if (stages.every((s) => s === "ready")) return "ready";
                              if (stages.some((s) => s === "pending")) return "pending";
                              return "incomplete";
                            };
                            const fromMs = attemptFilters.dateFrom
                              ? new Date(attemptFilters.dateFrom + "T00:00:00").getTime()
                              : null;
                            const toMs = attemptFilters.dateTo
                              ? new Date(attemptFilters.dateTo + "T23:59:59.999").getTime()
                              : null;
                            const visible = attempts.filter((a) => {
                              if (
                                attemptFilters.stages.length > 0 &&
                                !attemptFilters.stages.some((k) => a[k] !== "pending")
                              )
                                return false;
                              if (attemptFilters.outcomes.length > 0) {
                                const oc = computeOutcome(a);
                                if (!attemptFilters.outcomes.includes(oc)) return false;
                              }
                              if (attemptFilters.nMin != null && a.n < attemptFilters.nMin)
                                return false;
                              if (attemptFilters.nMax != null && a.n > attemptFilters.nMax)
                                return false;
                              if (
                                attemptFilters.bookingId &&
                                a.bookingId !== attemptFilters.bookingId
                              )
                                return false;
                              if (fromMs != null && a.wallStartedAt < fromMs) return false;
                              if (toMs != null && a.wallStartedAt > toMs) return false;
                              return true;
                            });
                            if (visible.length === 0) {
                              return (
                                <div
                                  className="text-[10px] text-muted-foreground italic py-1"
                                  data-testid="print-readiness-attempts-empty"
                                >
                                  No attempts match the current filters.
                                </div>
                              );
                            }
                            return (
                              <ol
                                className="flex flex-col gap-0.5"
                                aria-label="Readiness attempt history"
                              >
                                {visible.map((a) => {
                                  const stagesArr: Array<{
                                    k: "F" | "I" | "L";
                                    state: StageState;
                                  }> = [
                                    { k: "F", state: a.fonts },
                                    { k: "I", state: a.images },
                                    { k: "L", state: a.layout },
                                  ];
                                  const isCurrent = a.n === attempts.length;
                                  const running = isCurrent && renderStatus !== "ready";
                                  const anyTimeout = stagesArr.some((s) => s.state === "timeout");
                                  const allReady = stagesArr.every((s) => s.state === "ready");
                                  const outcome = running
                                    ? "running"
                                    : anyTimeout
                                      ? "timeout"
                                      : allReady
                                        ? "ready"
                                        : "partial";
                                  const total =
                                    a.totalMs != null
                                      ? fmt(a.totalMs)
                                      : running
                                        ? fmt(perfNow() - a.startedAt)
                                        : "—";
                                  return (
                                    <li
                                      key={a.n}
                                      data-testid={`print-readiness-attempt-${a.n}`}
                                      data-outcome={outcome}
                                      className="flex items-center gap-1.5 text-[10px]"
                                    >
                                      <span className="text-muted-foreground w-5">#{a.n}</span>
                                      <span className="flex items-center gap-0.5">
                                        {stagesArr.map((s) => (
                                          <span
                                            key={s.k}
                                            title={`${s.k === "F" ? "Fonts" : s.k === "I" ? "Images" : "Layout"}: ${s.state}`}
                                            className={
                                              "inline-flex h-3 w-3 items-center justify-center rounded-sm text-[9px] font-semibold " +
                                              (s.state === "ready"
                                                ? "bg-emerald-100 text-emerald-700"
                                                : s.state === "timeout"
                                                  ? "bg-amber-100 text-amber-700"
                                                  : "bg-muted text-muted-foreground")
                                            }
                                          >
                                            {s.k}
                                          </span>
                                        ))}
                                      </span>
                                      <span
                                        className={
                                          outcome === "timeout"
                                            ? "text-amber-600"
                                            : outcome === "ready"
                                              ? "text-foreground"
                                              : "text-muted-foreground"
                                        }
                                      >
                                        {outcome === "running"
                                          ? "running"
                                          : outcome === "ready"
                                            ? "ready"
                                            : outcome === "timeout"
                                              ? "timed out"
                                              : "incomplete"}
                                      </span>
                                      <span className="ml-auto text-muted-foreground tabular-nums">
                                        {total}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ol>
                            );
                          })()}
                        </div>
                      );
                    })()}

                  {/* Per-image completion offsets — only shown once we've
                    actually observed image loads so the tooltip stays quiet
                    for text-only receipts. Useful for spotting the one slow
                    image (e.g. remote letterhead) that stalled the pipeline. */}
                  {readiness.imageEvents.length > 0 && (
                    <div
                      className="mt-0.5 text-[10px] text-muted-foreground max-w-[220px] truncate"
                      title={readiness.imageEvents
                        .map((t, i) => `#${i + 1} @ ${fmt(t)}`)
                        .join("\n")}
                      data-testid="print-readiness-image-events"
                    >
                      images ·{" "}
                      {readiness.imageEvents
                        .slice(-3)
                        .map((t) => fmt(t))
                        .join(" · ")}
                      {readiness.imageEvents.length > 3
                        ? ` (+${readiness.imageEvents.length - 3})`
                        : ""}
                    </div>
                  )}
                  {/* Readiness timeout diagnostic panel. Surfaces when any
                    stage (fonts / images / layout) bailed out after the 4s
                    settle deadline so the user immediately knows why the
                    printed receipt may render blank or clipped. Includes the
                    last measured values captured at the moment of timeout —
                    elapsed ms, images loaded / total, and which stage(s)
                    stalled — plus a one-click Retry that re-runs the same
                    waitForReady pipeline. */}
                  {(readiness.fonts === "timeout" ||
                    readiness.images === "timeout" ||
                    readiness.layout === "timeout") && (
                    <div
                      role="alert"
                      aria-live="polite"
                      data-testid="print-readiness-timeout-panel"
                      className="pointer-events-auto mt-1 rounded-md border border-amber-500/60 bg-amber-50 dark:bg-amber-950/30 px-2 py-1.5 text-[10px] text-amber-900 dark:text-amber-200 leading-snug max-w-[240px]"
                    >
                      <div className="font-semibold mb-0.5">Readiness timed out</div>
                      <div className="text-amber-800/90 dark:text-amber-200/80 mb-1">
                        Printing now may produce a blank or clipped receipt.
                      </div>
                      <ul className="space-y-0.5">
                        {readiness.fonts === "timeout" && (
                          <li data-testid="print-readiness-timeout-fonts">
                            · Fonts stalled at {fmt(readiness.fontsEndedAtMs ?? 0)}{" "}
                            <span className="text-amber-800/70 dark:text-amber-200/60">
                              (limit {fmt(readinessTimeouts.fonts)})
                            </span>
                          </li>
                        )}
                        {readiness.images === "timeout" && (
                          <li data-testid="print-readiness-timeout-images">
                            · Images {readiness.imagesLoaded}/{readiness.imagesTotal} loaded at{" "}
                            {fmt(readiness.imagesEndedAtMs ?? 0)}{" "}
                            <span className="text-amber-800/70 dark:text-amber-200/60">
                              (limit {fmt(readinessTimeouts.images)})
                            </span>
                          </li>
                        )}
                        {readiness.layout === "timeout" && (
                          <li data-testid="print-readiness-timeout-layout">
                            · Layout unstable at {fmt(readiness.layoutEndedAtMs ?? 0)}{" "}
                            <span className="text-amber-800/70 dark:text-amber-200/60">
                              (limit {fmt(readinessTimeouts.layout)})
                            </span>
                          </li>
                        )}
                      </ul>
                      {/* Probable causes — infers likely root causes from
                        which stage(s) timed out and their last measured
                        values (e.g. 0 fonts.ready, images loaded < total,
                        layout still shifting) so the user has an
                        actionable hint before retrying or printing. */}
                      {(() => {
                        const causes: { key: string; text: string }[] = [];
                        if (readiness.fonts === "timeout") {
                          causes.push({
                            key: "fonts-network",
                            text: "Web fonts didn't finish loading — slow network or a blocked font CDN. Text may print in a fallback face or as blank boxes.",
                          });
                        }
                        if (readiness.images === "timeout") {
                          const total = readiness.imagesTotal ?? 0;
                          const loaded = readiness.imagesLoaded ?? 0;
                          if (total === 0) {
                            causes.push({
                              key: "images-none",
                              text: "No images were detected on the sheet — the receipt template may not have mounted before the deadline.",
                            });
                          } else if (loaded === 0) {
                            causes.push({
                              key: "images-zero",
                              text: `0 of ${total} images loaded — logo/signature URLs may be unreachable, causing a blank header area.`,
                            });
                          } else if (loaded < total) {
                            causes.push({
                              key: "images-partial",
                              text: `${loaded} of ${total} images loaded — remaining images may render as broken/empty regions and can clip the layout.`,
                            });
                          }
                        }
                        if (readiness.layout === "timeout") {
                          causes.push({
                            key: "layout-unstable",
                            text: "Layout kept shifting past the deadline — late-loading fonts/images or dynamic content are still reflowing, so the printed copy may be clipped or split across pages.",
                          });
                        }
                        if (causes.length === 0) return null;
                        return (
                          <div
                            data-testid="print-readiness-timeout-causes"
                            className="mt-1 rounded border border-amber-600/40 bg-amber-100/40 dark:bg-amber-900/20 px-1.5 py-1 text-[10px] text-amber-900 dark:text-amber-100"
                          >
                            <div className="font-semibold mb-0.5">Probable causes</div>
                            <ul className="space-y-0.5">
                              {causes.map((c) => (
                                <li
                                  key={c.key}
                                  data-testid={`print-readiness-timeout-cause-${c.key}`}
                                >
                                  · {c.text}
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })()}
                      <div
                        data-testid="print-readiness-timeout-limits"
                        data-fonts-limit-ms={readinessTimeouts.fonts}
                        data-images-limit-ms={readinessTimeouts.images}
                        data-layout-limit-ms={readinessTimeouts.layout}
                        className="mt-1 text-[10px] text-amber-800/80 dark:text-amber-200/70"
                      >
                        Active limits — fonts {fmt(readinessTimeouts.fonts)} · images{" "}
                        {fmt(readinessTimeouts.images)} · layout {fmt(readinessTimeouts.layout)}
                      </div>
                      {/* Adjustable stage thresholds. Each input is
                        seconds (0.1s step) and clamps to a sane range
                        so the operator can't set 0 or absurdly large
                        limits. Apply & rerun commits the new limits
                        and reruns readiness via retryReadiness(). We
                        render the inputs inline (no wrapper component)
                        so React keeps the same DOM node between
                        keystrokes and the focused field doesn't lose
                        focus while typing. */}
                      <div
                        data-testid="print-readiness-timeout-inputs"
                        className="mt-1 flex flex-wrap items-center gap-2 rounded border border-amber-600/40 bg-amber-100/40 dark:bg-amber-900/20 px-1.5 py-1 text-[10px]"
                      >
                        <span className="font-semibold text-amber-900 dark:text-amber-100">
                          Adjust limits
                        </span>
                        {[
                          { stage: "fonts" as const, label: "Fonts" },
                          { stage: "images" as const, label: "Images" },
                          { stage: "layout" as const, label: "Layout" },
                        ].map(({ stage, label }) => (
                          <label key={stage} className="inline-flex items-center gap-1">
                            <span className="text-amber-900/80 dark:text-amber-100/80">
                              {label}
                            </span>
                            <input
                              type="number"
                              inputMode="decimal"
                              step={0.1}
                              min={0.1}
                              max={60}
                              defaultValue={(readinessTimeouts[stage] / 1000).toFixed(1)}
                              key={`${stage}-${readinessNonce}`}
                              data-testid={`print-readiness-timeout-input-${stage}`}
                              aria-label={`${label} timeout in seconds`}
                              onChange={(e) => {
                                const secs = Number(e.currentTarget.value);
                                if (!Number.isFinite(secs) || secs <= 0) return;
                                const clamped = Math.min(60, Math.max(0.1, secs));
                                setTimeoutOverrides((prev) => ({
                                  ...prev,
                                  [stage]: Math.round(clamped * 1000),
                                }));
                              }}
                              className="w-12 rounded border border-amber-600/50 bg-white/70 dark:bg-amber-950/40 px-1 py-0.5 text-[10px] text-amber-900 dark:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                            />
                            <span className="text-amber-800/70 dark:text-amber-200/60">s</span>
                          </label>
                        ))}
                        <button
                          type="button"
                          data-testid="print-readiness-timeout-apply"
                          onClick={retryReadiness}
                          className="inline-flex items-center rounded border border-amber-600/60 bg-amber-100/60 hover:bg-amber-200/60 dark:bg-amber-900/40 dark:hover:bg-amber-900/60 px-1.5 py-0.5 font-medium text-amber-900 dark:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                        >
                          Apply & rerun
                        </button>
                        <button
                          type="button"
                          data-testid="print-readiness-timeout-reset"
                          onClick={() => {
                            setTimeoutOverrides({});
                            retryReadiness();
                          }}
                          className="inline-flex items-center rounded border border-amber-600/40 bg-transparent hover:bg-amber-100/40 dark:hover:bg-amber-900/30 px-1.5 py-0.5 text-amber-900 dark:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                        >
                          Reset
                        </button>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={retryReadiness}
                          data-testid="print-readiness-timeout-retry"
                          className="inline-flex items-center rounded border border-amber-600/60 bg-amber-100/60 hover:bg-amber-200/60 dark:bg-amber-900/40 dark:hover:bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                        >
                          Retry readiness
                        </button>
                        <button
                          type="button"
                          onClick={downloadReadinessDiagnostics}
                          data-testid="print-readiness-timeout-download"
                          title="Download the latest readiness diagnostics (timestamps, last measured values, and total duration) as a JSON file"
                          aria-label="Download readiness diagnostics as JSON"
                          className="inline-flex items-center gap-1 rounded border border-amber-600/60 bg-amber-100/60 hover:bg-amber-200/60 dark:bg-amber-900/40 dark:hover:bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                        >
                          <Download className="h-3 w-3" aria-hidden="true" />
                          Download JSON
                        </button>
                        <button
                          type="button"
                          onClick={downloadReadinessDiagnosticsCsv}
                          data-testid="print-readiness-timeout-download-csv"
                          title="Download the latest readiness diagnostics as a CSV file for spreadsheet review"
                          aria-label="Download readiness diagnostics as CSV"
                          className="inline-flex items-center gap-1 rounded border border-amber-600/60 bg-amber-100/60 hover:bg-amber-200/60 dark:bg-amber-900/40 dark:hover:bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                        >
                          <Download className="h-3 w-3" aria-hidden="true" />
                          Download CSV
                        </button>
                        <button
                          type="button"
                          onClick={generateShareLink}
                          disabled={shareLinkGenerating}
                          data-testid="print-readiness-timeout-share-link"
                          title="Upload the readiness diagnostics and generate a shareable link (valid for 7 days) you can send to teammates"
                          aria-label="Generate share link for readiness diagnostics"
                          className="inline-flex items-center gap-1 rounded border border-amber-600/60 bg-amber-100/60 hover:bg-amber-200/60 dark:bg-amber-900/40 dark:hover:bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {shareLinkGenerating ? (
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                          ) : (
                            <Share2 className="h-3 w-3" aria-hidden="true" />
                          )}
                          {shareLinkGenerating ? "Uploading…" : "Generate share link"}
                        </button>
                      </div>
                      <label
                        className="mt-1.5 inline-flex items-center gap-1.5 text-[10px] text-amber-900 dark:text-amber-100 cursor-pointer select-none"
                        title="Automatically save the readiness diagnostics JSON as soon as any stage times out"
                      >
                        <input
                          type="checkbox"
                          checked={autoDownloadOnTimeout}
                          onChange={(e) => setAutoDownloadOnTimeout(e.target.checked)}
                          data-testid="print-readiness-auto-download-toggle"
                          aria-label="Auto-download diagnostics on timeout"
                          className="h-3 w-3 min-h-11 min-w-11 lg:min-h-3 lg:min-w-3 rounded border-amber-600/60 accent-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                        />
                        <span>Auto-download diagnostics on timeout</span>
                      </label>
                      {lastDiagnosticsDownload && (
                        <div
                          role="status"
                          aria-live="polite"
                          data-testid="print-readiness-download-confirm"
                          className="mt-1.5 flex items-center gap-1.5 rounded border border-emerald-600/40 bg-emerald-50/80 dark:bg-emerald-950/40 px-1.5 py-1 text-[10px] text-emerald-900 dark:text-emerald-100"
                        >
                          <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span className="min-w-0 truncate">
                            {lastDiagnosticsDownload.format} diagnostics saved as{" "}
                            <span className="font-mono">{lastDiagnosticsDownload.filename}</span>
                          </span>
                        </div>
                      )}
                      {shareLink && (
                        <div
                          data-testid="print-readiness-timeout-share-link-result"
                          className="mt-1.5 rounded border border-amber-600/40 bg-amber-50/70 dark:bg-amber-950/40 px-1.5 py-1 text-[10px] text-amber-900 dark:text-amber-100"
                        >
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              readOnly
                              value={shareLink.url}
                              onFocus={(e) => e.currentTarget.select()}
                              aria-label="Diagnostics share link"
                              className="flex-1 min-w-0 rounded border border-amber-600/30 bg-transparent px-1 py-0.5 text-[10px] font-mono truncate focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500"
                            />
                            <button
                              type="button"
                              onClick={copyShareLink}
                              className="inline-flex items-center rounded border border-amber-600/60 bg-amber-100/60 hover:bg-amber-200/60 dark:bg-amber-900/40 dark:hover:bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                            >
                              Copy
                            </button>
                          </div>
                          <div className="mt-1 opacity-80">
                            Expires {new Date(shareLink.expiresAtIso).toLocaleString()}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Troubleshooting helper — shown when we detect the sheet is
              off-screen or unrendered in the preview container (see the
              previewBlank effect). Sticky so it stays visible even if the
              user scrolls the empty area. The `previewBlank` heuristic
              itself is size-agnostic, so this appears on any viewport
              (including landscape phones + short tablets) where the sheet
              can't be seen. Dismissible for the current modal session. */}
            {previewBlank && !helperDismissed && (
              <div
                role="status"
                aria-live="polite"
                className="sticky top-0 z-20 -mx-6 -mt-6 mb-4 border-b border-border bg-card/95 backdrop-blur px-4 py-3 shadow-sm"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 text-xs leading-relaxed text-foreground">
                    <p className="font-medium">Preview looks blank?</p>
                    <p className="text-muted-foreground mt-0.5">
                      The page may be zoomed past the edge of the screen. Tap
                      <span className="font-medium text-foreground"> Fit to screen </span>
                      to snap the sheet back into view.
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 min-h-11 min-w-11 shrink-0"
                    onClick={() => setHelperDismissed(true)}
                    aria-label="Dismiss blank preview helper"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="min-h-11"
                    onClick={fitToScreen}
                    aria-label="Fit the printable sheet to the preview screen"
                  >
                    <Maximize2 className="h-4 w-4 mr-1" aria-hidden="true" /> Fit to screen
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    onClick={() => setZoomWithUserFlag(0.5)}
                    aria-label="Reset zoom to 50%"
                  >
                    <ZoomOut className="h-4 w-4 mr-1" aria-hidden="true" /> Zoom 50%
                  </Button>
                </div>
              </div>
            )}
            {measureNode}
            {docType === "receipt" && (
              <style>{`.pp-print-root .pp-receipt { zoom: ${SCALE}; transform-origin: top left; } ${RECEIPT_SHARED_STYLES} ${PAYMENT_RECEIPT_PRINT_STYLES}`}</style>
            )}
            <PrintDebugOverlay
              active={isReceiptDoc && showPrintDebug}
              scrollerRef={previewScrollRef}
            />
            <PrintLayoutDebugOverlay active={showPrintDebug} scrollerRef={previewScrollRef} />

            <div className="pp-print-root mx-auto" style={{ width: `${PAGE_W_MM * zoom}mm` }}>
              <div
                className="pp-zoom-wrap"
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: "top left",
                  width: `${PAGE_W_MM}mm`,
                }}
              >
                {textPages?.map((lines, i) => (
                  <div
                    key={i}
                    className={`pp-sheet doc-sheet${forceSinglePage ? " pp-single-page-sheet" : ""} shadow-[0_2px_18px_rgba(0,0,0,0.15)] mb-6`}
                    style={sheetStyle}
                  >
                    {!hideLetterhead && (
                      <div
                        data-letterhead-logo
                        style={{ display: settings.includeLogo ? undefined : "none" }}
                      >
                        <LetterheadHeader
                          style={style}
                          logoId={logoId}
                          docType={docType}
                          projectName={projectName}
                        />
                      </div>
                    )}
                    <div className="doc-body" style={contentBoxStyle}>
                      <pre
                        style={{
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          wordWrap: "break-word",
                          fontFamily: "inherit",
                          fontSize: "inherit",
                          lineHeight: 1.55,
                        }}
                      >
                        {lines.join("\n")}
                      </pre>
                    </div>
                    {!hideLetterhead && <LetterheadFooter style={style} />}
                    <LayoutGuides />
                  </div>
                ))}

                {isReact &&
                  effectiveReactPageGroups.map((indices, i) => (
                    <div
                      key={i}
                      className={`pp-sheet doc-sheet${forceSinglePage ? " pp-single-page-sheet" : ""} shadow-[0_2px_18px_rgba(0,0,0,0.15)] mb-6`}
                      style={sheetStyle}
                    >
                      {!hideLetterhead && (
                        <div
                          data-letterhead-logo
                          style={{ display: settings.includeLogo ? undefined : "none" }}
                        >
                          <LetterheadHeader
                            style={style}
                            logoId={logoId}
                            docType={docType}
                            projectName={projectName}
                          />
                        </div>
                      )}
                      <div className="doc-body" style={contentBoxStyle}>
                        {indices.map((idx) => (
                          <div key={idx}>{reactChildArray[idx]}</div>
                        ))}
                      </div>
                      {!hideLetterhead && <LetterheadFooter style={style} />}
                      <LayoutGuides />
                    </div>
                  ))}
              </div>
            </div>
          </div>

          {/* Mobile-only sticky action bar. On phone viewports the top toolbar
            can't fit Export/Print alongside zoom + paper + settings, so those
            primary actions get pushed off-screen. This bar keeps them within
            thumb reach at all times and is hidden on sm+ where the toolbar
            already has room. */}
          <div className="sm:hidden shrink-0 border-t bg-card px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex flex-col gap-1.5">
            <div
              className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums"
              aria-live="polite"
              aria-label={`${pageCount} page${pageCount === 1 ? "" : "s"} at ${paper.shortLabel} ${isLandscape ? "landscape" : "portrait"}, scale ${settings.scalePct}%`}
            >
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                <FileText className="h-3 w-3 opacity-70" aria-hidden="true" />
                {pageCount} page{pageCount === 1 ? "" : "s"}
              </span>
              <span className="truncate">
                {paper.shortLabel} · {isLandscape ? "Landscape" : "Portrait"} · {settings.scalePct}%
                {settings.fitOnePage ? " · fit" : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 min-h-11"
                onClick={confirmExport}
                aria-label={
                  allChecked
                    ? `Export as PDF (${pageCount} page${pageCount === 1 ? "" : "s"}). Choose 'Save as PDF' as destination.`
                    : `Print setup incomplete. ${checkedCount} of ${CHECKLIST_ITEMS.length} settings confirmed. Opens checklist.`
                }
                aria-disabled={!allChecked}
              >
                <Download className="h-4 w-4 mr-1" aria-hidden="true" /> PDF · {pageCount}
              </Button>
              <Button
                size="sm"
                className="flex-1 min-h-11"
                onClick={confirmPrint}
                aria-label={
                  allChecked
                    ? `Open browser print dialog (${pageCount} page${pageCount === 1 ? "" : "s"})`
                    : `Print setup incomplete. ${checkedCount} of ${CHECKLIST_ITEMS.length} settings confirmed. Opens checklist.`
                }
                aria-disabled={!allChecked}
              >
                <Printer className="h-4 w-4 mr-1" aria-hidden="true" /> Print · {pageCount}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <AutoLogoEditor open={autoEditorOpen} onOpenChange={setAutoEditorOpen} />
    </>
  );
}
