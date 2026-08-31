/**
 * CsvExportConfirmDialog + useCsvExportConfirm
 *
 * A two-step guard for CSV / JSON exports:
 *   1. User clicks the export button.
 *   2. This dialog opens, showing the exact metadata header that will be
 *      written into the file — the same content as `CsvExportMetadataPreview`.
 *   3. User must click "Confirm & download" to actually trigger the export.
 *      A "Cancel" button dismisses without downloading.
 *
 * Usage pattern (colocated with the export button):
 *
 *   const { requestExport, dialog } = useCsvExportConfirm();
 *   ...
 *   <Button onClick={() => requestExport({
 *     label: "the Overdue Clients CSV",
 *     input: () => ({ source: "Overdue Clients", ... }),
 *     onConfirm: exportOverdueCsv,
 *   })}>CSV</Button>
 *   {dialog}
 *
 * The `input` accepts a factory so filter / sort / page state is re-read
 * at click time (matching how `CsvExportMetadataPreview` works).
 */
import { useCallback, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildCsvMetadataHeader, type CsvMetadataInput } from "@/lib/csvExportMetadata";

type InputOrFactory = CsvMetadataInput | (() => CsvMetadataInput);

export interface CsvExportConfirmRequest {
  /** Short human phrase describing the download, e.g. "the Overdue Clients CSV". */
  label?: string;
  /** Metadata that will be written to the file, or a factory that returns it. */
  input: InputOrFactory;
  /** Runs when the user confirms — this is where you kick off the download. */
  onConfirm: () => void | Promise<void>;
  /** Optional override for the confirm button label. */
  confirmLabel?: string;
  /** Optional extra body to render above the metadata block (e.g. warnings). */
  extraBody?: ReactNode;
}

interface OpenState {
  request: CsvExportConfirmRequest;
  resolved: CsvMetadataInput;
  saved: SavedExportSnapshot | null;
}

/**
 * Snapshot of a previously-confirmed export, persisted to localStorage per
 * source so the next preview from the same page can display what was used
 * last time (filters / sort / column order / row counts).
 */
export interface SavedExportSnapshot {
  savedAt: string;
  filters: CsvMetadataInput["filters"];
  sort: CsvMetadataInput["sort"];
  columns: CsvMetadataInput["columns"];
  counts: CsvMetadataInput["counts"];
}

const STORAGE_PREFIX = "csv-export:last:";

function storageKeyFor(source: string | undefined): string | null {
  const s = (source ?? "").trim();
  if (!s) return null;
  return STORAGE_PREFIX + s;
}

function readSavedSnapshot(source: string | undefined): SavedExportSnapshot | null {
  const key = storageKeyFor(source);
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedExportSnapshot;
    if (!parsed || typeof parsed.savedAt !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSavedSnapshot(source: string | undefined, input: CsvMetadataInput): void {
  const key = storageKeyFor(source);
  if (!key || typeof window === "undefined") return;
  try {
    const snap: SavedExportSnapshot = {
      savedAt: new Date().toISOString(),
      filters: input.filters ?? undefined,
      sort: input.sort ?? undefined,
      columns: input.columns ?? undefined,
      counts: input.counts ?? undefined,
    };
    window.localStorage.setItem(key, JSON.stringify(snap));
  } catch {
    // best-effort — quota/private-mode failures are non-fatal
  }
}

export function useCsvExportConfirm() {
  const [state, setState] = useState<OpenState | null>(null);
  const [busy, setBusy] = useState(false);

  const requestExport = useCallback((request: CsvExportConfirmRequest) => {
    // Resolve the input factory ONCE at request time so the preview and
    // the eventual download see the same snapshot even if filters change
    // while the dialog is open.
    const resolved =
      typeof request.input === "function"
        ? (request.input as () => CsvMetadataInput)()
        : request.input;
    const saved = readSavedSnapshot(resolved.source);
    setState({ request, resolved, saved });
  }, []);

  const close = useCallback(() => {
    if (busy) return; // don't close mid-download
    setState(null);
  }, [busy]);

  const confirm = useCallback(async () => {
    if (!state) return;
    try {
      setBusy(true);
      await state.request.onConfirm();
      // Persist AFTER a successful confirm so cancelled/failed exports
      // don't overwrite the last-good snapshot.
      writeSavedSnapshot(state.resolved.source, state.resolved);
    } finally {
      setBusy(false);
      setState(null);
    }
  }, [state]);

  const dialog = (
    <CsvExportConfirmDialog state={state} busy={busy} onCancel={close} onConfirm={confirm} />
  );

  return { requestExport, dialog };
}

interface DialogProps {
  state: OpenState | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function CsvExportConfirmDialog({ state, busy, onCancel, onConfirm }: DialogProps) {
  const open = state !== null;
  const lines = state ? buildCsvMetadataHeader(state.resolved) : [];
  const label = state?.request.label ?? "this export";
  const filterCount = state ? countMeaningful(state.resolved.filters) : 0;
  const sortText = state?.resolved.sort?.key
    ? `${state.resolved.sort.key} ${state.resolved.sort.dir}`
    : "unsorted";
  const columnCount = state?.resolved.columns?.length ?? 0;
  const rowText = describeCounts(state?.resolved.counts);
  const [copied, setCopied] = useState(false);
  const copyMetadata = useCallback(async () => {
    if (lines.length === 0) return;
    const text = lines.join("\n");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for insecure contexts / older browsers.
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (err) {
      console.error("copy metadata failed", err);
    }
  }, [lines]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onCancel();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirm export settings</DialogTitle>
          <DialogDescription>
            Review the filters, sort, and columns that will be recorded in{" "}
            <span className="font-medium text-foreground">{label}</span>. The download starts only
            after you click confirm.
          </DialogDescription>
        </DialogHeader>

        {state?.request.extraBody}

        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs grid grid-cols-2 gap-x-4 gap-y-1">
          <div>
            <span className="text-muted-foreground">Filters</span>
            <div className="font-medium">{filterCount} active</div>
          </div>
          <div>
            <span className="text-muted-foreground">Sort</span>
            <div className="font-medium truncate">{sortText}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Columns</span>
            <div className="font-medium">{columnCount} in order</div>
          </div>
          <div>
            <span className="text-muted-foreground">Rows</span>
            <div className="font-medium truncate">{rowText}</div>
          </div>
        </div>

        {state?.saved && <SavedSnapshotStrip saved={state.saved} current={state.resolved} />}

        <div className="rounded-md border bg-background">
          <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-2 py-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              Metadata header preview
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-[11px] min-h-11 min-w-11"
              onClick={copyMetadata}
              disabled={lines.length === 0}
              aria-label="Copy metadata header to clipboard"
              title="Copy the exact metadata header lines shown below"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" aria-hidden />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  Copy metadata
                </>
              )}
            </Button>
          </div>
          <div className="max-h-64 overflow-auto">
            {lines.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">No metadata to preview.</div>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed p-3">
                {lines.join("\n")}
              </pre>
            )}
          </div>
        </div>

        {filterCount === 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              No filters are active — this file will contain the entire unfiltered result set.
              Continue only if that is intended.
            </span>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? "Downloading…" : (state?.request.confirmLabel ?? "Confirm & download")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function countMeaningful(filters: CsvMetadataInput["filters"] | undefined): number {
  if (!filters) return 0;
  let n = 0;
  for (const v of Object.values(filters)) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim().toLowerCase();
    if (["", "all", "any", "null", "undefined"].includes(s)) continue;
    n++;
  }
  return n;
}

function describeCounts(counts: CsvMetadataInput["counts"] | undefined | null): string {
  if (!counts) return "—";
  const bits: string[] = [];
  if (typeof counts.shown === "number") bits.push(`${counts.shown} shown`);
  if (typeof counts.filtered === "number") bits.push(`${counts.filtered} filtered`);
  if (typeof counts.total === "number") bits.push(`${counts.total} total`);
  return bits.length ? bits.join(" · ") : "—";
}

function columnOrderText(columns: CsvMetadataInput["columns"] | undefined): string {
  if (!columns || columns.length === 0) return "—";
  return columns.map((c) => (typeof c === "string" ? c : (c.label ?? c.key ?? ""))).join(" › ");
}

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  } catch {
    return false;
  }
}

function formatSavedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function SavedSnapshotStrip({
  saved,
  current,
}: {
  saved: SavedExportSnapshot;
  current: CsvMetadataInput;
}) {
  const savedFilters = countMeaningful(saved.filters);
  const savedSort = saved.sort?.key ? `${saved.sort.key} ${saved.sort.dir}` : "unsorted";
  const savedCols = saved.columns?.length ?? 0;
  const savedRows = describeCounts(saved.counts);
  const matches =
    sameJson(saved.filters, current.filters) &&
    sameJson(saved.sort, current.sort) &&
    sameJson(saved.columns, current.columns);

  return (
    <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2 text-xs space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">Last export</span>
        <span className="text-[10px] text-muted-foreground">
          {formatSavedAt(saved.savedAt)} · {matches ? "matches current" : "differs from current"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
        <div>
          Filters: <span className="text-foreground">{savedFilters} active</span>
        </div>
        <div>
          Sort: <span className="text-foreground">{savedSort}</span>
        </div>
        <div>
          Columns: <span className="text-foreground">{savedCols} in order</span>
        </div>
        <div>
          Rows: <span className="text-foreground">{savedRows}</span>
        </div>
      </div>
      {savedCols > 0 && (
        <div
          className="truncate text-[10px] text-muted-foreground"
          title={columnOrderText(saved.columns)}
        >
          Order: <span className="text-foreground/80">{columnOrderText(saved.columns)}</span>
        </div>
      )}
    </div>
  );
}
