import {
  Component,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
  type RefObject,
} from "react";
import { Link, useRouter } from "@tanstack/react-router";
import {
  AlertTriangle,
  Download,
  FileQuestion,
  FileX,
  Home,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { reportLovableError } from "@/lib/lovable-error-reporting";

type PdfStage = "rendering" | "composing" | "saving";

const PDF_STAGE_LABEL: Record<PdfStage, string> = {
  rendering: "Rendering report…",
  composing: "Composing PDF…",
  saving: "Saving file…",
};

async function exportNodeToPdf(
  node: HTMLElement,
  filename: string,
  onProgress?: (stage: PdfStage) => void,
) {
  onProgress?.("rendering");
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const canvas = await html2canvas(node, {
    scale: 2,
    backgroundColor: getComputedStyle(node).backgroundColor,
    useCORS: true,
    logging: false,
  });

  onProgress?.("composing");
  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const usableWidth = pageWidth - margin * 2;
  const imgHeight = (canvas.height * usableWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = margin;

  pdf.addImage(imgData, "PNG", margin, position, usableWidth, imgHeight);
  heightLeft -= pageHeight - margin * 2;

  while (heightLeft > 0) {
    position = margin - (imgHeight - heightLeft);
    pdf.addPage();
    pdf.addImage(imgData, "PNG", margin, position, usableWidth, imgHeight);
    heightLeft -= pageHeight - margin * 2;
  }

  onProgress?.("saving");
  pdf.save(filename);
}

export function ReportPdfExport({
  targetRef,
  filename,
  label = "Download PDF",
}: {
  targetRef: RefObject<HTMLElement | null>;
  filename: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<PdfStage | null>(null);

  const handleClick = async () => {
    if (busy) return;
    if (!targetRef.current) {
      toast.error("Nothing to export", {
        description: "The report content is not ready yet. Please wait for it to load.",
      });
      return;
    }
    setBusy(true);
    setStage("rendering");
    const toastId = toast.loading("Preparing PDF…", {
      description: PDF_STAGE_LABEL.rendering,
    });
    try {
      await exportNodeToPdf(targetRef.current, filename, (nextStage) => {
        setStage(nextStage);
        toast.loading("Preparing PDF…", {
          id: toastId,
          description: PDF_STAGE_LABEL[nextStage],
        });
      });
      toast.success("PDF ready", {
        id: toastId,
        description: `Downloaded ${filename}`,
      });
    } catch (err) {
      console.error("[ReportPdfExport] failed", err);
      const message =
        err instanceof Error ? err.message : "Something went wrong while generating the PDF.";
      toast.error("PDF export failed", {
        id: toastId,
        description: message,
        action: {
          label: "Retry",
          onClick: () => {
            void handleClick();
          },
        },
      });
    } finally {
      setBusy(false);
      setStage(null);
    }
  };

  const buttonLabel = busy ? (stage ? PDF_STAGE_LABEL[stage] : "Preparing…") : label;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={busy}
      aria-busy={busy}
      aria-live="polite"
      className="min-h-11 gap-2"
      aria-label={buttonLabel}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Download className="h-4 w-4" aria-hidden />
      )}
      {buttonLabel}
    </Button>
  );
}

export function useReportPdfExport(filename: string, label?: string) {
  const ref = useRef<HTMLDivElement>(null);
  const button = <ReportPdfExport targetRef={ref} filename={filename} label={label} />;
  return { ref, button };
}

export function ReportRoutePending({ label }: { label?: string }) {
  const title = label ?? "report";
  return (
    <div className="space-y-6 p-6" role="status" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        <p className="text-sm">Loading {title}…</p>
      </div>
      <div className="h-8 w-56 animate-pulse rounded-md bg-muted" aria-hidden />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl border border-border bg-muted/50"
            aria-hidden
          />
        ))}
      </div>
      <div className="space-y-2 rounded-xl border border-border p-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-6 w-full animate-pulse rounded bg-muted" aria-hidden />
        ))}
      </div>
      <span className="sr-only">Loading {title}. Please wait.</span>
    </div>
  );
}

export function isReportUnavailableError(error: unknown): boolean {
  const msg = (error as { message?: string } | null | undefined)?.message ?? String(error ?? "");
  return /Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|Cannot find module|Unable to preload|ChunkLoadError|MODULE_NOT_FOUND|UNLOADABLE_DEPENDENCY|UNRESOLVED_IMPORT/i.test(
    msg,
  );
}

interface ReportUnavailableProps {
  reportLabel: string;
  error?: Error;
  onRetry?: () => void;
}

export function ReportUnavailable({ reportLabel, error, onRetry }: ReportUnavailableProps) {
  const router = useRouter();

  useEffect(() => {
    if (error) {
      console.error(`[report_unavailable] ${reportLabel}`, error);
      reportLovableError(error, {
        boundary: "report_unavailable",
        routeLabel: reportLabel,
      });
    }
  }, [error, reportLabel]);

  const handleRetry = () => {
    if (onRetry) return onRetry();
    router.invalidate();
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-16" role="alert">
      <div className="rounded-2xl border border-border/60 bg-muted/30 p-6 md:p-8">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-muted p-3 text-muted-foreground">
            <FileX className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-foreground">
              {reportLabel} is not available
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              We couldn't load this report right now. This can happen after a recent deployment or
              if your connection dropped. Please retry, or reload the page.
            </p>
            {error?.message && (
              <p className="mt-3 rounded-md border border-border/60 bg-background/50 px-3 py-2 font-mono text-xs text-muted-foreground break-words">
                {error.message}
              </p>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <Button onClick={handleRetry} size="sm" className="gap-2">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Try again
              </Button>
              <Button
                onClick={() => window.location.reload()}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Reload page
              </Button>
              <Button asChild variant="ghost" size="sm" className="gap-2">
                <Link to="/reports">
                  <Home className="h-4 w-4" aria-hidden="true" />
                  Back to Reports
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function makeReportErrorComponent(reportLabel: string) {
  return function BoundReportError(props: { error: Error; reset: () => void }) {
    if (isReportUnavailableError(props.error)) {
      return (
        <ReportUnavailable reportLabel={reportLabel} error={props.error} onRetry={props.reset} />
      );
    }
    return (
      <RouteErrorBoundary
        {...props}
        routeLabel={reportLabel}
        boundary={`report:${reportLabel.toLowerCase().replace(/\s+/g, "-")}`}
      />
    );
  };
}

interface ReportChunkErrorBoundaryProps {
  label: string;
  children: ReactNode;
}

interface ReportChunkErrorBoundaryState {
  error: Error | null;
}

export class ReportChunkErrorBoundary extends Component<
  ReportChunkErrorBoundaryProps,
  ReportChunkErrorBoundaryState
> {
  state: ReportChunkErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ReportChunkErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[report_chunk_error] ${this.props.label}`, error, info);
    reportLovableError(error, {
      boundary: "report_chunk_error_boundary",
      routeLabel: this.props.label,
    });
  }

  retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    if (isReportUnavailableError(this.state.error)) {
      return (
        <ReportUnavailable
          reportLabel={this.props.label}
          error={this.state.error}
          onRetry={this.retry}
        />
      );
    }

    return (
      <div className="mx-auto max-w-2xl px-4 py-16" role="alert">
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 md:p-8">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-destructive/15 p-3 text-destructive">
              <AlertTriangle className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold text-foreground">
                {this.props.label} couldn't load
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Something went wrong rendering this report. You can retry, or head back to reports.
              </p>
              {this.state.error.message && (
                <p className="mt-3 rounded-md border border-destructive/30 bg-background/50 px-3 py-2 font-mono text-xs text-destructive break-words">
                  {this.state.error.message}
                </p>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                <Button onClick={this.retry} size="sm" className="gap-2">
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Try again
                </Button>
                <Button
                  onClick={() => window.location.reload()}
                  variant="outline"
                  size="sm"
                  className="gap-2"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Reload page
                </Button>
                <Button asChild variant="ghost" size="sm" className="gap-2">
                  <Link to="/reports">
                    <Home className="h-4 w-4" aria-hidden="true" />
                    Back to Reports
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export function prefetchDrillDowns(): Promise<unknown> {
  return Promise.resolve();
}

export function ReportRouteWrapper({
  label,
  Component,
}: {
  label: string;
  Component: ComponentType;
}) {
  return (
    <ReportChunkErrorBoundary label={label}>
      <Suspense fallback={<ReportRoutePending label={label} />}>
        <section aria-label={label} className="p-6">
          <Component />
        </section>
      </Suspense>
    </ReportChunkErrorBoundary>
  );
}

function slugify(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function Placeholder({ title }: { title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const filename = `${slugify(title)}-${new Date().toISOString().slice(0, 10)}.pdf`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        <ReportPdfExport targetRef={ref} filename={filename} />
      </div>
      <div ref={ref} className="rounded-lg border border-border bg-card p-6">
        <h2 className="sr-only">{title}</h2>
        <p className="text-sm text-muted-foreground">
          This report is being prepared. Data will appear here once available.
        </p>
      </div>
    </div>
  );
}

export const OverdueInstallmentsReport = () => <Placeholder title="Overdue Installments" />;
export const PaymentCollectionReport = () => <Placeholder title="Payment Collection" />;
export const AdjustmentRegisterReport = () => <Placeholder title="Adjustment Register" />;
export const BookingSummaryReport = () => <Placeholder title="Booking Summary" />;
export const CashFlowSummaryReport = () => <Placeholder title="Cash Flow Summary" />;
export const OutstandingBalanceReport = () => <Placeholder title="Outstanding Balance" />;

export { AlertTriangle };
/**
 * Presentational fallback for unknown `/reports/*` URLs. Inlined here (rather
 * than in `src/components/reports/UnknownReportFallback.tsx`) because the
 * `reports.tsx` barrel file shadows the sibling `reports/` directory at
 * import resolution — bundlers pick the `.tsx` sibling over the folder.
 */
export function UnknownReportFallback({ slug }: { slug: string }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center">
      <div className="rounded-full bg-muted p-4">
        <FileQuestion className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Report not found</h1>
        <p className="text-sm text-muted-foreground">
          {slug ? (
            <>
              We couldn&rsquo;t find a report at{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">/reports/{slug}</code>.
            </>
          ) : (
            <>That report doesn&rsquo;t exist.</>
          )}{" "}
          Pick one from the reports list.
        </p>
      </div>
      <Button asChild>
        <Link to="/reports">Back to reports</Link>
      </Button>
    </div>
  );
}
