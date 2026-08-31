/* allow-small-tap-file: compact floating exports panel; icon-only controls in tight stacked rows keep the widget non-intrusive over page content */
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Download,
  Loader2,
  X,
  CheckCircle2,
  AlertTriangle,
  MinusCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useState } from "react";

export type ExportJobKind = "csv" | "json" | "xlsx";
export type ExportJobStatus = "running" | "done" | "error" | "cancelled";

export interface ExportJob {
  id: string;
  kind: ExportJobKind;
  label: string;
  status: ExportJobStatus;
  /** High-level phase for the running spinner label. */
  phase: "fetching" | "building" | "finalising" | "done";
  matched: number | null;
  exported: number;
  cap: number;
  startedAt: number;
  finishedAt?: number;
  filename?: string;
  /** Blob URL kept alive while the job is on the panel so the user can re-download. */
  blobUrl?: string;
  error?: string;
  onCancel: () => void;
}

interface Props {
  jobs: ExportJob[];
  onDismiss: (id: string) => void;
}

const KIND_LABEL: Record<ExportJobKind, string> = {
  csv: "CSV",
  json: "JSON",
  xlsx: "XLSX",
};

function formatCount(job: ExportJob): string {
  const exp = job.exported.toLocaleString();
  if (job.matched == null) return `${exp} rows`;
  const mat = job.matched.toLocaleString();
  return `${exp} / ${mat} rows`;
}

function statusIcon(job: ExportJob) {
  if (job.status === "running")
    return <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />;
  if (job.status === "done") return <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />;
  if (job.status === "cancelled")
    return <MinusCircle className="h-4 w-4 text-muted-foreground" aria-hidden />;
  return <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />;
}

function phaseLabel(job: ExportJob): string {
  if (job.status !== "running") return "";
  if (job.phase === "fetching") return "Fetching rows…";
  if (job.phase === "building") return `Building ${KIND_LABEL[job.kind]}…`;
  if (job.phase === "finalising") return "Finalising…";
  return "";
}

/**
 * Floating panel that surfaces long-running filtered exports so the user
 * can leave them running in the background and come back for a re-download.
 *
 * The panel is a controlled component — the parent owns `jobs` state and
 * fires `onDismiss` when the user clears a finished/failed job. Running
 * jobs are never dismissible from the panel (only cancellable) so a stray
 * click can't orphan an in-flight request.
 */
export function BackgroundExportsPanel({ jobs, onDismiss }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const running = useMemo(() => jobs.filter((j) => j.status === "running").length, [jobs]);
  const done = jobs.length - running;

  if (jobs.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Background exports"
      className="fixed bottom-4 right-4 z-40 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card shadow-lg"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          {running > 0 ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
          )}
          <span>
            Background exports
            <span className="ml-2 text-xs text-muted-foreground">
              {running > 0 ? `${running} running` : `${done} finished`}
            </span>
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCollapsed((v) => !v)}
          className="min-h-9 min-w-9 h-9 w-9 p-0"
          aria-label={collapsed ? "Expand background exports" : "Collapse background exports"}
        >
          {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>
      {!collapsed && (
        <ul className="max-h-80 overflow-y-auto divide-y divide-border">
          {jobs.map((job) => (
            <li key={job.id} className="px-3 py-2">
              <div className="flex items-start gap-2">
                <div className="mt-0.5">{statusIcon(job)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{job.label}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
                      {KIND_LABEL[job.kind]}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {job.status === "running" && phaseLabel(job)}
                    {job.status !== "running" && job.filename}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatCount(job)}
                    {job.status === "error" && job.error && (
                      <span className="text-destructive"> — {job.error}</span>
                    )}
                    {job.status === "cancelled" && <span> — cancelled</span>}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  {job.status === "running" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={job.onCancel}
                      className="min-h-9 min-w-9 h-9 px-2 text-destructive hover:text-destructive"
                      aria-label={`Cancel ${job.label}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                  {job.status === "done" && job.blobUrl && job.filename && (
                    <a
                      href={job.blobUrl}
                      download={job.filename}
                      className="inline-flex items-center justify-center rounded-md text-sm font-medium min-h-9 min-w-9 h-9 px-2 hover:bg-accent hover:text-accent-foreground"
                      aria-label={`Re-download ${job.filename}`}
                      title="Re-download"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  )}
                  {job.status !== "running" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDismiss(job.id)}
                      className="min-h-9 min-w-9 h-9 px-2"
                      aria-label={`Dismiss ${job.label}`}
                      title="Dismiss"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
