/* allow-raw-color-file: builds a standalone print-only HTML document in a new window that has no access to the app's CSS theme tokens */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  RefreshCw,
  FilterX,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ExternalLink,
  Download,
  History,
  RotateCcw,
  Printer,
  Loader2,
  Columns3,
  MoreHorizontal,
  GitCompare,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { BASELINE_STORAGE_KEY } from "./responsive-audit.history";
import {
  applyResponsiveAuditFilters,
  EXPORT_COLUMNS,
  EXPORT_COLUMN_KEYS,
  isFailing,
  rowsToCsvBody,
  rowsToJson,
  sortRows,
  type Row,
  type SortKey,
} from "@/lib/responsive-audit/filters";

/**
 * Responsive audit dashboard.
 *
 * Reads the manifest produced by `scripts/run-responsive-audit.mjs`
 * (served statically at `/responsive-audit/manifest.json`) and renders a
 * matrix of route × viewport cards. Each card shows:
 *   • overflow status (ok / overflow / skipped / error) as a Badge,
 *   • the amount of overflow in px + first offending elements,
 *   • the viewport screenshot captured by the runner.
 *
 * The page is intentionally read-only and static — refresh runs the audit
 * again by re-executing the script; this UI just re-fetches the manifest.
 * Not indexable (auth-gated under `_authenticated`).
 */

export const Route = createFileRoute("/_authenticated/responsive-audit")({
  ssr: false,
  component: ResponsiveAuditPage,
  head: () => ({
    meta: [
      { title: "Responsive Audit — Precise ERP" },
      { name: "robots", content: "noindex,nofollow" },
      {
        name: "description",
        content:
          "Latest responsive layout audit — overflow status and screenshots for /site, /login, and /dashboard across mobile, tablet, and desktop.",
      },
    ],
  }),
});

type Manifest = {
  generatedAt: string;
  baseUrl: string;
  hasAuthSession: boolean;
  viewports: Record<string, { width: number; height: number }>;
  previousGeneratedAt?: string | null;
  results: Row[];
};

type DiffKind = "new-failure" | "still-failing" | "fixed" | "changed" | "unchanged" | "no-baseline";
type DiffEntry = { kind: DiffKind; previousStatus?: Row["status"] };

const DEVICES = ["mobile", "tablet", "desktop"] as const;
const rowKey = (r: { device: string; route: string }) => `${r.device}::${r.route}`;

function buildDiff(current: Row[], previous: Row[] | null): Map<string, DiffEntry> {
  const key = (r: { device: string; route: string }) => `${r.device}::${r.route}`;
  const out = new Map<string, DiffEntry>();
  if (!previous) {
    for (const r of current) out.set(key(r), { kind: "no-baseline" });
    return out;
  }
  const prev = new Map(previous.map((r) => [key(r), r] as const));
  for (const r of current) {
    const p = prev.get(key(r));
    const failNow = isFailing(r.status);
    const failThen = p ? isFailing(p.status) : false;
    let kind: DiffKind = "unchanged";
    if (!p) kind = failNow ? "new-failure" : "unchanged";
    else if (failNow && !failThen) kind = "new-failure";
    else if (!failNow && failThen) kind = "fixed";
    else if (failNow && failThen) kind = p.status === r.status ? "still-failing" : "changed";
    else if (p.status !== r.status) kind = "changed";
    out.set(key(r), { kind, previousStatus: p?.status });
  }
  return out;
}

function downloadBlob(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type ExportColumn = (typeof EXPORT_COLUMNS)[number];
const EXPORT_COLUMNS_STORAGE_KEY = "responsive-audit:export-columns";

/**
 * Metadata that gets stamped onto the top of every CSV / PDF export so a
 * reviewer opening the file weeks later can tell which run produced it,
 * which baseline it was diffed against, and at what viewport sizes the
 * screenshots were captured. Kept flat + string-only so it lines up with
 * `# key: value` CSV comment rows and print-view meta cells.
 */
export type ExportMetadata = {
  baselineRunId: string;
  baselineGeneratedAt: string;
  currentRunId: string;
  currentGeneratedAt: string;
  viewports: string;
  exportedAt: string;
};

const fmtWhen = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString() : "—");

const fmtViewports = (viewports: Manifest["viewports"] | undefined): string => {
  if (!viewports) return "—";
  const entries = Object.entries(viewports);
  if (entries.length === 0) return "—";
  return entries.map(([name, v]) => `${name} ${v.width}×${v.height}`).join(" | ");
};

export function buildExportMetadata({
  current,
  previous,
  baselineId,
}: {
  current: Manifest | null;
  previous: Manifest | null;
  baselineId: string | null;
}): ExportMetadata {
  return {
    baselineRunId: baselineId ?? (previous ? "auto:previous" : "none"),
    baselineGeneratedAt: fmtWhen(previous?.generatedAt),
    currentRunId: current?.generatedAt ? `run:${current.generatedAt}` : "current",
    currentGeneratedAt: fmtWhen(current?.generatedAt),
    viewports: fmtViewports(current?.viewports),
    exportedAt: new Date().toISOString(),
  };
}

const META_LABEL: Record<keyof ExportMetadata, string> = {
  baselineRunId: "Baseline run id",
  baselineGeneratedAt: "Baseline captured at",
  currentRunId: "Current run id",
  currentGeneratedAt: "Current captured at (viewport/screenshot ts)",
  viewports: "Viewports",
  exportedAt: "Exported at",
};

/**
 * Compact, filesystem-safe timestamp slug — turns `2026-07-06T10:15:30.123Z`
 * into `20260706T101530Z` so filenames sort lexicographically by run time
 * and don't contain characters that need escaping.
 */
function slugTs(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/**
 * Build a filename stem that puts the CURRENT run timestamp first (so the
 * file list sorts by "when was this audited") followed by the baseline run
 * timestamp for easy pairing. Example:
 *   responsive-audit__curr-20260706T101530Z__base-20260705T093010Z.csv
 */
export function buildExportFilename({
  prefix,
  suffix = "",
  extension,
  meta,
}: {
  prefix: string;
  suffix?: string;
  extension: "csv" | "json";
  meta: ExportMetadata;
}): string {
  const cur = slugTs(meta.currentGeneratedAt);
  const base = meta.baselineRunId === "none" ? "nobase" : slugTs(meta.baselineGeneratedAt);
  return `${prefix}${suffix}__curr-${cur}__base-${base}.${extension}`;
}

/**
 * Filesystem-safe slug — lowercases, replaces runs of non-alphanumerics with
 * `-`, and trims leading/trailing dashes. Used to embed filter values into
 * export filenames without breaking on `/`, spaces, or unicode.
 */
function slugValue(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build a `__route-…__device-…__status-…__sort-…` suffix from the active
 * table filters so downloaded files are self-identifying. Filters set to
 * `"all"` are omitted; `sort` is always included so two exports of the same
 * dataset with different sort orders don't collide on disk.
 */
export function buildFilterFilenameSuffix(filters: {
  route: string;
  device: string;
  status: string;
  sortBy: string;
}): string {
  const parts: string[] = [];
  if (filters.route && filters.route !== "all") parts.push(`route-${slugValue(filters.route)}`);
  if (filters.device && filters.device !== "all") parts.push(`device-${slugValue(filters.device)}`);
  if (filters.status && filters.status !== "all") parts.push(`status-${slugValue(filters.status)}`);
  parts.push(`sort-${slugValue(filters.sortBy)}`);
  return `__${parts.join("__")}`;
}

/**
 * Prepend metadata as `# key: value` comment rows on top of a CSV body.
 * A blank line separates the header block from the data so tools that
 * skip comment lines (Excel's "From Text" wizard, `csvkit`, pandas
 * `comment="#"`) can either strip or preserve the header cleanly.
 */
function withCsvMetadataHeader(meta: ExportMetadata, body: string): string {
  const header = (Object.keys(META_LABEL) as (keyof ExportMetadata)[])
    .map((k) => `# ${META_LABEL[k]}: ${csvEscape(meta[k])}`)
    .join("\n");
  return `${header}\n#\n${body}`;
}

function rowsToCsv(rows: Row[], columnKeys: string[], meta?: ExportMetadata): string {
  const body = rowsToCsvBody(rows, columnKeys);
  return meta ? withCsvMetadataHeader(meta, body) : body;
}

/**
 * Runs a synchronous export (build content + trigger download) while surfacing
 * a loading spinner and success/error toast, so users get feedback even for
 * near-instant downloads.
 */
function useExportRunner() {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // Recursive so the failure toast's "Retry" action re-invokes the same
  // work fn — closures capture the latest inputs from the calling scope.
  const run = async (key: string, label: string, work: () => void | Promise<void>) => {
    if (busyKey) return;
    setBusyKey(key);
    const toastId = toast.loading(`Preparing ${label}…`);
    try {
      await work();
      // Small delay so the spinner is visible for near-instant exports.
      await new Promise((r) => setTimeout(r, 150));
      toast.success(`${label} downloaded`, { id: toastId });
    } catch (err) {
      toast.error(`${label} export failed`, {
        id: toastId,
        description: err instanceof Error ? err.message : "Unknown error",
        duration: 10_000,
        action: {
          label: "Retry",
          onClick: () => {
            // Fire-and-forget — re-runs the same export pipeline. The busy
            // gate above prevents double-fire if the user spam-clicks.
            void run(key, label, work);
          },
        },
      });
    } finally {
      setBusyKey(null);
    }
  };
  return { busyKey, run };
}

function ResponsiveAuditPage() {
  const { busyKey: exportBusy, run: runExport } = useExportRunner();
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<Manifest>({
    queryKey: ["responsive-audit-manifest"],
    queryFn: async () => {
      // Cache-bust so a fresh runner output is picked up immediately.
      const res = await fetch(`/responsive-audit/manifest.json?ts=${Date.now()}`);
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? "No audit results yet. Run `node scripts/run-responsive-audit.mjs` to generate them."
            : `Failed to load manifest (${res.status})`,
        );
      }
      return (await res.json()) as Manifest;
    },
    retry: false,
    staleTime: 30_000,
  });

  // The comparison baseline is either an explicit run-id chosen from the
  // Run History page (stored in localStorage), or — when no explicit choice
  // has been made — the previous run archived alongside the current one.
  const [baselineId, setBaselineId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(BASELINE_STORAGE_KEY);
  });
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === BASELINE_STORAGE_KEY) setBaselineId(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const { data: previous } = useQuery<Manifest | null>({
    queryKey: ["responsive-audit-manifest-previous", baselineId ?? "auto"],
    queryFn: async () => {
      const url = baselineId
        ? `/responsive-audit/history/${baselineId}/manifest.json?ts=${Date.now()}`
        : `/responsive-audit/manifest.previous.json?ts=${Date.now()}`;
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) return null;
      return (await res.json()) as Manifest;
    },
    retry: false,
    staleTime: 30_000,
  });

  const clearBaseline = () => {
    window.localStorage.removeItem(BASELINE_STORAGE_KEY);
    setBaselineId(null);
  };

  const totals = summarise(data?.results ?? []);
  const diff = buildDiff(data?.results ?? [], previous?.results ?? null);
  const newFailures = (data?.results ?? []).filter(
    (r) => diff.get(`${r.device}::${r.route}`)?.kind === "new-failure",
  );
  const fixedRows = (data?.results ?? []).filter(
    (r) => diff.get(`${r.device}::${r.route}`)?.kind === "fixed",
  );
  const changedRows = (data?.results ?? []).filter(
    (r) => diff.get(`${r.device}::${r.route}`)?.kind === "changed",
  );

  const [routeFilter, setRouteFilter] = useState<string>("all");
  const [deviceFilter, setDeviceFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortKey>("route-asc");
  const [previewRow, setPreviewRow] = useState<Row | null>(null);

  const [selectedColumns, setSelectedColumns] = useState<string[]>(() => {
    if (typeof window === "undefined") return EXPORT_COLUMN_KEYS;
    try {
      const raw = window.localStorage.getItem(EXPORT_COLUMNS_STORAGE_KEY);
      if (!raw) return EXPORT_COLUMN_KEYS;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return EXPORT_COLUMN_KEYS;
      const valid = parsed.filter(
        (k): k is string => typeof k === "string" && EXPORT_COLUMN_KEYS.includes(k),
      );
      return valid.length > 0 ? valid : EXPORT_COLUMN_KEYS;
    } catch {
      return EXPORT_COLUMN_KEYS;
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(EXPORT_COLUMNS_STORAGE_KEY, JSON.stringify(selectedColumns));
  }, [selectedColumns]);
  const toggleColumn = (key: string, checked: boolean) => {
    setSelectedColumns((prev) => {
      if (checked) {
        if (prev.includes(key)) return prev;
        // Preserve canonical column order regardless of toggle sequence.
        return EXPORT_COLUMN_KEYS.filter((k) => k === key || prev.includes(k));
      }
      // Keep at least one column selected so the export isn't empty.
      if (prev.length <= 1) return prev;
      return prev.filter((k) => k !== key);
    });
  };
  const orderedSelectedColumns = useMemo(
    () => EXPORT_COLUMN_KEYS.filter((k) => selectedColumns.includes(k)),
    [selectedColumns],
  );

  const routeOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const r of data?.results ?? []) seen.add(r.path);
    return Array.from(seen).sort();
  }, [data]);

  const filteredRows = useMemo(
    () =>
      applyResponsiveAuditFilters(data?.results ?? [], {
        routeFilter,
        deviceFilter,
        statusFilter,
        sortBy,
      }),
    [data, routeFilter, deviceFilter, statusFilter, sortBy],
  );

  // Row selection: keys of picked rows plus a toggle that restricts exports
  // to only those rows when the user has any selection.
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(() => new Set());
  const [exportSelectedOnly, setExportSelectedOnly] = useState(false);
  const toggleRow = (key: string, checked: boolean) => {
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };
  const clearSelection = () => setSelectedRowKeys(new Set());
  // Drop keys that no longer match the current filter set, so "selected"
  // never counts rows the user can't see.
  const selectedInView = useMemo(
    () => filteredRows.filter((r) => selectedRowKeys.has(rowKey(r))),
    [filteredRows, selectedRowKeys],
  );
  const allFilteredSelected =
    filteredRows.length > 0 && selectedInView.length === filteredRows.length;
  const someFilteredSelected = selectedInView.length > 0 && !allFilteredSelected;
  const toggleAllFiltered = (checked: boolean) => {
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      for (const r of filteredRows) {
        if (checked) next.add(rowKey(r));
        else next.delete(rowKey(r));
      }
      return next;
    });
  };
  const exportRows =
    exportSelectedOnly && selectedInView.length > 0 ? selectedInView : filteredRows;

  const filtersActive =
    routeFilter !== "all" ||
    deviceFilter !== "all" ||
    statusFilter !== "all" ||
    sortBy !== "route-asc";
  const clearFilters = () => {
    setRouteFilter("all");
    setDeviceFilter("all");
    setStatusFilter("all");
    setSortBy("route-asc");
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <PageHeader
        title="Responsive Audit"
        description={
          data
            ? `Last run ${new Date(data.generatedAt).toLocaleString()} · ${totals.ok} ok · ${totals.overflow} overflow · ${totals.skipped} skipped · ${totals.error} error`
            : "Latest overflow + screenshot results across mobile, tablet, and desktop."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!data}
                  title="Choose which fields to include in CSV and JSON exports"
                >
                  <Columns3 className="h-4 w-4 mr-2" />
                  Columns ({orderedSelectedColumns.length}/{EXPORT_COLUMN_KEYS.length})
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Export columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {EXPORT_COLUMNS.map((col) => {
                  const checked = selectedColumns.includes(col.key);
                  const isLastSelected = checked && orderedSelectedColumns.length === 1;
                  return (
                    <DropdownMenuCheckboxItem
                      key={col.key}
                      checked={checked}
                      disabled={isLastSelected}
                      onSelect={(e) => e.preventDefault()}
                      onCheckedChange={(next) => toggleColumn(col.key, next === true)}
                    >
                      {col.label}
                    </DropdownMenuCheckboxItem>
                  );
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setSelectedColumns(EXPORT_COLUMN_KEYS);
                  }}
                >
                  Select all
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <label
              className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground has-[:disabled]:opacity-60"
              title={
                selectedInView.length === 0
                  ? "Pick rows first to limit the export to your selection"
                  : "Toggle to export only the rows you've picked"
              }
            >
              <Checkbox
                checked={exportSelectedOnly && selectedInView.length > 0}
                onCheckedChange={(v) => setExportSelectedOnly(v === true)}
                disabled={selectedInView.length === 0}
                aria-label="Export only selected rows"
              />
              Selected only ({selectedInView.length})
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                runExport("csv", "CSV", () => {
                  const meta = buildExportMetadata({
                    current: data ?? null,
                    previous: previous ?? null,
                    baselineId,
                  });
                  const filterSuffix = buildFilterFilenameSuffix({
                    route: routeFilter,
                    device: deviceFilter,
                    status: statusFilter,
                    sortBy,
                  });
                  downloadBlob(
                    buildExportFilename({
                      prefix: "responsive-audit",
                      suffix: filterSuffix,
                      extension: "csv",
                      meta,
                    }),
                    "text/csv;charset=utf-8",
                    rowsToCsv(exportRows, orderedSelectedColumns, meta),
                  );
                })
              }
              disabled={!data || exportRows.length === 0 || exportBusy !== null}
              title={
                exportSelectedOnly && selectedInView.length > 0
                  ? `Download ${selectedInView.length} selected row${selectedInView.length === 1 ? "" : "s"} as CSV`
                  : "Download filtered results as CSV"
              }
            >
              {exportBusy === "csv" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                runExport("json", "JSON", () => {
                  const usingSelection = exportSelectedOnly && selectedInView.length > 0;
                  const meta = buildExportMetadata({
                    current: data ?? null,
                    previous: previous ?? null,
                    baselineId,
                  });
                  const payload = {
                    // Reproducibility block — same shape as the regression
                    // JSON so a downstream script can key off either export.
                    runMetadata: {
                      ...meta,
                      currentGeneratedAtRaw: data?.generatedAt ?? null,
                      previousGeneratedAtRaw: previous?.generatedAt ?? null,
                    },
                    generatedAt: data?.generatedAt,
                    baseUrl: data?.baseUrl,
                    viewports: data?.viewports,
                    exportedAt: meta.exportedAt,
                    filters: {
                      route: routeFilter,
                      device: deviceFilter,
                      status: statusFilter,
                      sortBy,
                    },
                    selectionOnly: usingSelection,
                    columns: orderedSelectedColumns,
                    count: exportRows.length,
                    filteredCount: filteredRows.length,
                    totalCount: data?.results.length ?? 0,
                    results: rowsToJson(exportRows, orderedSelectedColumns),
                  };
                  const filterSuffix = buildFilterFilenameSuffix({
                    route: routeFilter,
                    device: deviceFilter,
                    status: statusFilter,
                    sortBy,
                  });
                  downloadBlob(
                    buildExportFilename({
                      prefix: "responsive-audit",
                      suffix: filterSuffix,
                      extension: "json",
                      meta,
                    }),
                    "application/json",
                    JSON.stringify(payload, null, 2),
                  );
                })
              }
              disabled={!data || exportRows.length === 0 || exportBusy !== null}
              title={
                exportSelectedOnly && selectedInView.length > 0
                  ? `Download ${selectedInView.length} selected row${selectedInView.length === 1 ? "" : "s"} as JSON`
                  : "Download filtered results as JSON"
              }
            >
              {exportBusy === "json" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              JSON
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/responsive-audit/history">
                <History className="h-4 w-4 mr-2" />
                Run history
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
              Reload manifest
            </Button>
          </div>
        }
      />

      {baselineId && (
        <Alert className="mb-4 border-primary/50">
          <History className="h-4 w-4" />
          <AlertTitle>Comparing against a pinned baseline</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              Diff is against run <span className="font-mono text-xs">{baselineId}</span>
              {previous?.generatedAt ? (
                <> ({new Date(previous.generatedAt).toLocaleString()})</>
              ) : null}
              .
            </span>
            <Button variant="ghost" size="sm" onClick={clearBaseline}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset to previous run
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <p className="text-muted-foreground">Loading audit results…</p>
      ) : isError ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Manifest unavailable</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : "Unknown error."}
          </AlertDescription>
        </Alert>
      ) : !data || data.results.length === 0 ? (
        <EmptyState
          title="No audit results"
          description="Run `node scripts/run-responsive-audit.mjs` to populate this page."
        />
      ) : (
        <div className="space-y-8">
          <RegressionSummary
            current={data ?? null}
            previous={previous ?? null}
            newFailures={newFailures}
            fixedRows={fixedRows}
            changedRows={changedRows}
            diff={diff}
            baselineId={baselineId}
            exportBusy={exportBusy}
            runExport={runExport}
          />

          <div
            className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3"
            role="region"
            aria-label="Filter and sort audit results"
          >
            <FilterField label="Route" htmlFor="ra-route">
              <Select value={routeFilter} onValueChange={setRouteFilter}>
                <SelectTrigger id="ra-route" className="w-[220px]">
                  <SelectValue placeholder="All routes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All routes</SelectItem>
                  {routeOptions.map((path) => (
                    <SelectItem key={path} value={path} className="font-mono text-xs">
                      {path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Viewport" htmlFor="ra-device">
              <Select value={deviceFilter} onValueChange={setDeviceFilter}>
                <SelectTrigger id="ra-device" className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All viewports</SelectItem>
                  {DEVICES.map((d) => (
                    <SelectItem key={d} value={d} className="capitalize">
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Overflow status" htmlFor="ra-status">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger id="ra-status" className="w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="failing">Failing (overflow + error)</SelectItem>
                  <SelectItem value="ok">OK</SelectItem>
                  <SelectItem value="overflow">Overflow</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                  <SelectItem value="skipped">Skipped</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Sort by" htmlFor="ra-sort">
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
                <SelectTrigger id="ra-sort" className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="route-asc">Route (A→Z)</SelectItem>
                  <SelectItem value="route-desc">Route (Z→A)</SelectItem>
                  <SelectItem value="overflow-desc">Overflow (most px)</SelectItem>
                  <SelectItem value="status">Status (failing first)</SelectItem>
                  <SelectItem value="duration-desc">Duration (slowest)</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <div className="ml-auto flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Checkbox
                  checked={
                    allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false
                  }
                  onCheckedChange={(v) => toggleAllFiltered(v === true)}
                  disabled={filteredRows.length === 0}
                  aria-label="Select all filtered rows"
                />
                Select all filtered
              </label>
              {selectedInView.length > 0 && (
                <Button variant="ghost" size="sm" onClick={clearSelection}>
                  Clear selection ({selectedInView.length})
                </Button>
              )}
              <span className="text-xs text-muted-foreground" aria-live="polite">
                {filteredRows.length} of {data.results.length} result
                {data.results.length === 1 ? "" : "s"}
              </span>
              {filtersActive && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <FilterX className="mr-1.5 h-4 w-4" />
                  Clear
                </Button>
              )}
            </div>
          </div>

          {filteredRows.length === 0 ? (
            <EmptyState
              title="No results match these filters"
              description="Try clearing filters or widening the status selection."
            />
          ) : deviceFilter === "all" && sortBy === "route-asc" ? (
            DEVICES.map((device) => {
              const rows = filteredRows.filter((r) => r.device === device);
              if (rows.length === 0) return null;
              const size = data.viewports[device];
              return (
                <section key={device}>
                  <h2 className="mb-3 text-lg font-semibold capitalize">
                    {device}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      {size.width}×{size.height}
                    </span>
                  </h2>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {rows.map((row) => {
                      const k = rowKey(row);
                      return (
                        <ResultCard
                          key={`${row.device}-${row.route}`}
                          row={row}
                          diff={diff.get(k)}
                          onPreview={setPreviewRow}
                          selected={selectedRowKeys.has(k)}
                          onToggleSelect={(checked) => toggleRow(k, checked)}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredRows.map((row) => {
                const k = rowKey(row);
                return (
                  <ResultCard
                    key={`${row.device}-${row.route}`}
                    row={row}
                    diff={diff.get(k)}
                    onPreview={setPreviewRow}
                    selected={selectedRowKeys.has(k)}
                    onToggleSelect={(checked) => toggleRow(k, checked)}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
      <ScreenshotPreviewDialog
        row={previewRow}
        diff={previewRow ? diff.get(`${previewRow.device}::${previewRow.route}`) : undefined}
        onClose={() => setPreviewRow(null)}
      />
    </div>
  );
}

function FilterField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function regressionRowsToCsv(
  current: Manifest | null,
  previous: Manifest | null,
  entries: Array<{
    category: "NEW" | "FIXED" | "CHANGED";
    row: Row;
    previousStatus?: Row["status"] | "absent";
  }>,
  meta: ExportMetadata,
): string {
  const headers = [
    "category",
    "device",
    "route",
    "path",
    "previous_status",
    "current_status",
    "overflow_px",
    "previous_run_at",
    "current_run_at",
  ];
  const lines = [headers.join(",")];
  for (const e of entries) {
    lines.push(
      [
        e.category,
        e.row.device,
        e.row.route,
        e.row.path,
        e.previousStatus ?? "",
        e.row.status,
        e.row.overflowPx,
        previous?.generatedAt ?? "",
        current?.generatedAt ?? "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return withCsvMetadataHeader(meta, lines.join("\n"));
}

function regressionRowsToJson(
  current: Manifest | null,
  previous: Manifest | null,
  entries: Array<{
    category: "NEW" | "FIXED" | "CHANGED";
    row: Row;
    previousStatus?: Row["status"] | "absent";
  }>,
  meta: ExportMetadata,
) {
  return {
    ...meta,
    currentGeneratedAtRaw: current?.generatedAt ?? null,
    previousGeneratedAtRaw: previous?.generatedAt ?? null,
    categories: {
      NEW: entries.filter((e) => e.category === "NEW").length,
      FIXED: entries.filter((e) => e.category === "FIXED").length,
      CHANGED: entries.filter((e) => e.category === "CHANGED").length,
    },
    count: entries.length,
    results: entries.map((e) => ({
      category: e.category,
      device: e.row.device,
      route: e.row.route,
      path: e.row.path,
      previous_status: e.previousStatus ?? null,
      current_status: e.row.status,
      overflow_px: e.row.overflowPx,
      screenshot: e.row.screenshot ?? null,
    })),
  };
}

function openRegressionPrintView(
  current: Manifest | null,
  previous: Manifest | null,
  entries: Array<{
    category: "NEW" | "FIXED" | "CHANGED";
    row: Row;
    previousStatus?: Row["status"] | "absent";
  }>,
  meta: ExportMetadata,
) {
  const win = window.open("", "_blank", "noopener,noreferrer,width=900,height=1100");
  if (!win) return; // Popup blocked — CSV path still works.
  // Standalone print-only HTML document (opened in a new window) — cannot reference
  // the app's CSS theme tokens, so palette hexes below are intentional.
  const HEAD_BORDER = "#e5e7eb"; // allow-raw-color: standalone print document, no theme context
  const ROW_BORDER = "#f1f5f9"; // allow-raw-color: standalone print document, no theme context
  const BODY_TEXT = "#111827"; // allow-raw-color: standalone print document, no theme context
  const META_TEXT = "#4b5563"; // allow-raw-color: standalone print document, no theme context
  const MUTED_TEXT = "#6b7280"; // allow-raw-color: standalone print document, no theme context
  const NEW_COLOR = "#b91c1c"; // allow-raw-color: standalone print document, no theme context
  const FIXED_COLOR = "#047857"; // allow-raw-color: standalone print document, no theme context
  const CHANGED_COLOR = "#a16207"; // allow-raw-color: standalone print document, no theme context
  const sections = (["NEW", "FIXED", "CHANGED"] as const)
    .map((cat) => {
      const rows = entries.filter((e) => e.category === cat);
      const color = cat === "NEW" ? NEW_COLOR : cat === "FIXED" ? FIXED_COLOR : CHANGED_COLOR;
      return `
      <section>
        <h2 style="color:${color};margin:24px 0 8px">
          ${cat} <span style="color:${MUTED_TEXT};font-weight:400">(${rows.length})</span>
        </h2>
        ${
          rows.length === 0
            ? `<p style="color:${MUTED_TEXT};margin:0">None.</p>`
            : `<table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead>
                  <tr style="text-align:left;border-bottom:1px solid ${HEAD_BORDER}">
                    <th style="padding:6px 8px">Viewport</th>
                    <th style="padding:6px 8px">Route</th>
                    <th style="padding:6px 8px">Previous</th>
                    <th style="padding:6px 8px">Current</th>
                    <th style="padding:6px 8px;text-align:right">Overflow</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows
                    .map(
                      (e) => `
                    <tr style="border-bottom:1px solid ${ROW_BORDER}">
                      <td style="padding:6px 8px;text-transform:capitalize">${e.row.device}</td>
                      <td style="padding:6px 8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${e.row.path}</td>
                      <td style="padding:6px 8px">${e.previousStatus ?? "—"}</td>
                      <td style="padding:6px 8px">${e.row.status}</td>
                      <td style="padding:6px 8px;text-align:right">${
                        e.row.status === "overflow" ? `+${e.row.overflowPx}px` : "—"
                      }</td>
                    </tr>`,
                    )
                    .join("")}
                </tbody>
              </table>`
        }
      </section>`;
    })
    .join("");

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Regression Summary — Responsive Audit</title>
    <style>
      body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color:${BODY_TEXT}; margin:32px; }
      h1 { font-size:20px; margin:0 0 4px }
      .meta { color:${META_TEXT}; font-size:12px; margin: 0 0 16px }
      .meta table { border-collapse:collapse; width:100%; }
      .meta th { text-align:left; font-weight:600; color:${BODY_TEXT}; padding:3px 8px 3px 0; white-space:nowrap; vertical-align:top; width:1%; }
      .meta td { padding:3px 0; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; word-break:break-all; }
      @media print { @page { margin: 18mm } body { margin: 0 } }
    </style>
  </head>
  <body>
    <h1>Regression Summary</h1>
    <div class="meta">
      <table>
        <tr><th>Baseline run id</th><td>${escapeHtml(meta.baselineRunId)}</td></tr>
        <tr><th>Baseline captured at</th><td>${escapeHtml(meta.baselineGeneratedAt)}</td></tr>
        <tr><th>Current run id</th><td>${escapeHtml(meta.currentRunId)}</td></tr>
        <tr><th>Current captured at (viewport/screenshot ts)</th><td>${escapeHtml(meta.currentGeneratedAt)}</td></tr>
        <tr><th>Viewports</th><td>${escapeHtml(meta.viewports)}</td></tr>
        <tr><th>Exported at</th><td>${escapeHtml(meta.exportedAt)}</td></tr>
      </table>
    </div>
    ${sections}
    <script>window.addEventListener("load", function () { setTimeout(function(){ window.print(); }, 100); });</script>
  </body>
</html>`;
  win.document.open();
  win.document.write(html);
  win.document.close();
}

function RegressionSummary({
  current,
  previous,
  newFailures,
  fixedRows,
  changedRows,
  diff,
  baselineId,
  exportBusy,
  runExport,
}: {
  current: Manifest | null;
  previous: Manifest | null;
  newFailures: Row[];
  fixedRows: Row[];
  changedRows: Row[];
  diff: Map<string, DiffEntry>;
  baselineId: string | null;
  exportBusy: string | null;
  runExport: (key: string, label: string, work: () => void | Promise<void>) => Promise<void>;
}) {
  if (!previous) {
    return (
      <Alert>
        <AlertTitle>No baseline yet</AlertTitle>
        <AlertDescription>
          This is the first recorded run — the next audit will be diffed against it.
        </AlertDescription>
      </Alert>
    );
  }
  const stillFailing = [...diff.values()].filter((d) => d.kind === "still-failing").length;
  const when = new Date(previous.generatedAt).toLocaleString();

  const entries: Array<{
    category: "NEW" | "FIXED" | "CHANGED";
    row: Row;
    previousStatus?: Row["status"] | "absent";
  }> = [
    ...newFailures.map((r) => ({
      category: "NEW" as const,
      row: r,
      previousStatus: (diff.get(`${r.device}::${r.route}`)?.previousStatus ?? "absent") as
        | Row["status"]
        | "absent",
    })),
    ...fixedRows.map((r) => ({
      category: "FIXED" as const,
      row: r,
      previousStatus: diff.get(`${r.device}::${r.route}`)?.previousStatus,
    })),
    ...changedRows.map((r) => ({
      category: "CHANGED" as const,
      row: r,
      previousStatus: diff.get(`${r.device}::${r.route}`)?.previousStatus,
    })),
  ];
  const hasEntries = entries.length > 0;
  // useExportRunner called at the parent component scope to avoid conditional hook rules.

  // Category toggle filters — control which of NEW / FIXED / CHANGED rows are
  // included in the CSV and PDF exports. Default: all three enabled, matching
  // the previous "export everything" behaviour. Categories that have zero
  // rows in the current diff render as disabled chips so users can't select
  // an empty export.
  const CATEGORIES = ["NEW", "FIXED", "CHANGED"] as const;
  type Category = (typeof CATEGORIES)[number];
  const categoryCounts: Record<Category, number> = {
    NEW: newFailures.length,
    FIXED: fixedRows.length,
    CHANGED: changedRows.length,
  };
  const [enabledCategories, setEnabledCategories] = useState<Set<Category>>(
    () => new Set(CATEGORIES),
  );
  const toggleCategory = (c: Category) => {
    setEnabledCategories((prev) => {
      const next = new Set(prev);
      // Guard: keep at least one category on so the export button isn't
      // silently disabled after an over-eager click.
      if (next.has(c)) {
        if (next.size === 1) return prev;
        next.delete(c);
      } else {
        next.add(c);
      }
      return next;
    });
  };
  const filteredEntries = entries.filter((e) => enabledCategories.has(e.category));
  const selectedList = CATEGORIES.filter((c) => enabledCategories.has(c));
  const isAllSelected = selectedList.length === CATEGORIES.length;
  const filenameSuffix = isAllSelected
    ? ""
    : `-${selectedList.map((c) => c.toLowerCase()).join("-")}`;
  const exportDisabled = exportBusy !== null || filteredEntries.length === 0;

  const exportActions = hasEntries ? (
    <div className="mt-3 space-y-2">
      <div
        className="flex flex-wrap items-center gap-4"
        role="group"
        aria-label="Filter export by category"
      >
        <span className="text-xs text-muted-foreground">Include:</span>
        {CATEGORIES.map((c) => {
          const count = categoryCounts[c];
          const active = enabledCategories.has(c);
          const empty = count === 0;
          const id = `regression-cat-${c.toLowerCase()}`;
          return (
            <label
              key={c}
              htmlFor={id}
              className={`inline-flex min-h-11 items-center gap-2 text-xs font-medium ${
                empty ? "cursor-not-allowed text-muted-foreground opacity-60" : "cursor-pointer"
              }`}
            >
              <Checkbox
                id={id}
                checked={active}
                disabled={empty}
                onCheckedChange={() => toggleCategory(c)}
                aria-label={`Include ${c} rows in exports (${count})`}
              />
              <span>
                {c} <span className="tabular-nums opacity-70">({count})</span>
              </span>
            </label>
          );
        })}
        <span className="text-xs text-muted-foreground ml-auto" aria-live="polite">
          {filteredEntries.length} row{filteredEntries.length === 1 ? "" : "s"} in export
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={exportDisabled}
          onClick={() =>
            runExport("regression-csv", "Regression CSV", () => {
              const meta = buildExportMetadata({ current, previous, baselineId });
              downloadBlob(
                buildExportFilename({
                  prefix: "regression-summary",
                  suffix: filenameSuffix,
                  extension: "csv",
                  meta,
                }),
                "text/csv;charset=utf-8",
                regressionRowsToCsv(current, previous, filteredEntries, meta),
              );
            })
          }
          title={
            isAllSelected
              ? "Download NEW / FIXED / CHANGED rows as CSV"
              : `Download ${selectedList.join(" / ")} rows as CSV`
          }
        >
          {exportBusy === "regression-csv" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Export CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={exportDisabled}
          onClick={() =>
            runExport("regression-json", "Regression JSON", () => {
              const meta = buildExportMetadata({ current, previous, baselineId });
              const payload = regressionRowsToJson(current, previous, filteredEntries, meta);
              downloadBlob(
                buildExportFilename({
                  prefix: "regression-summary",
                  suffix: filenameSuffix,
                  extension: "json",
                  meta,
                }),
                "application/json",
                JSON.stringify(payload, null, 2),
              );
            })
          }
          title={
            isAllSelected
              ? "Download NEW / FIXED / CHANGED rows as JSON"
              : `Download ${selectedList.join(" / ")} rows as JSON`
          }
        >
          {exportBusy === "regression-json" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Export JSON
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={exportDisabled}
          onClick={() =>
            openRegressionPrintView(
              current,
              previous,
              filteredEntries,
              buildExportMetadata({ current, previous, baselineId }),
            )
          }
          title={
            isAllSelected
              ? "Open a print-friendly view — choose “Save as PDF” in the print dialog"
              : `Print-friendly view of ${selectedList.join(" / ")} rows`
          }
        >
          <Printer className="mr-2 h-4 w-4" />
          Export PDF
        </Button>
      </div>
    </div>
  ) : null;

  if (newFailures.length === 0 && fixedRows.length === 0 && changedRows.length === 0) {
    return (
      <Alert>
        <AlertTitle>No new regressions</AlertTitle>
        <AlertDescription>
          No new failing combinations since the previous run ({when}). {stillFailing} still failing.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant={newFailures.length > 0 ? "destructive" : "default"}>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>
        {newFailures.length} new failure{newFailures.length === 1 ? "" : "s"} since previous run
      </AlertTitle>
      <AlertDescription>
        <p className="mb-2 text-xs text-muted-foreground">
          Compared against {when} · {stillFailing} still failing · {fixedRows.length} fixed ·{" "}
          {changedRows.length} changed
        </p>
        {newFailures.length > 0 && (
          <ul className="space-y-1 text-sm">
            {newFailures.map((r) => {
              const prev = diff.get(`${r.device}::${r.route}`)?.previousStatus ?? "absent";
              return (
                <li key={`${r.device}-${r.route}`} className="font-mono">
                  <Badge className="mr-2 bg-destructive text-destructive-foreground">NEW</Badge>
                  {r.device} · {r.path} — {prev} → {r.status}
                  {r.status === "overflow" ? ` (+${r.overflowPx}px)` : ""}
                </li>
              );
            })}
          </ul>
        )}
        {fixedRows.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {fixedRows.map((r) => (
              <li key={`fixed-${r.device}-${r.route}`} className="font-mono text-muted-foreground">
                <Badge className="mr-2 bg-success text-success-foreground">FIXED</Badge>
                {r.device} · {r.path}
              </li>
            ))}
          </ul>
        )}
        {changedRows.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {changedRows.map((r) => {
              const prev = diff.get(`${r.device}::${r.route}`)?.previousStatus ?? "—";
              return (
                <li
                  key={`changed-${r.device}-${r.route}`}
                  className="font-mono text-muted-foreground"
                >
                  <Badge variant="outline" className="mr-2">
                    CHANGED
                  </Badge>
                  {r.device} · {r.path} — {prev} → {r.status}
                </li>
              );
            })}
          </ul>
        )}
        {exportActions}
      </AlertDescription>
    </Alert>
  );
}

function ResultCard({
  row,
  diff,
  onPreview,
  selected,
  onToggleSelect,
}: {
  row: Row;
  diff?: DiffEntry;
  onPreview: (row: Row) => void;
  selected: boolean;
  onToggleSelect: (checked: boolean) => void;
}) {
  const tone = STATUS_TONE[row.status];
  const isNew = diff?.kind === "new-failure";
  const isFixed = diff?.kind === "fixed";
  const changed = diff?.kind === "changed";
  return (
    <Card
      className={
        isNew
          ? "border-destructive ring-2 ring-destructive/40"
          : selected
            ? "ring-2 ring-primary/60"
            : undefined
      }
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <div className="flex min-w-0 items-center gap-2">
            <Checkbox
              checked={selected}
              onCheckedChange={(v) => onToggleSelect(v === true)}
              aria-label={`Select ${row.path} on ${row.device}`}
            />
            <span className="font-mono text-sm truncate">{row.path}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {isNew && (
              <Badge
                className="bg-destructive text-destructive-foreground"
                title={`was ${diff?.previousStatus ?? "absent"}`}
              >
                NEW
              </Badge>
            )}
            {isFixed && (
              <Badge
                className="bg-success text-success-foreground"
                title={`was ${diff?.previousStatus}`}
              >
                FIXED
              </Badge>
            )}
            {changed && !isNew && !isFixed && (
              <Badge
                className="bg-warning text-warning-foreground"
                title={`was ${diff?.previousStatus}`}
              >
                CHANGED
              </Badge>
            )}
            <Badge className={tone}>
              {row.status === "overflow" ? `overflow +${row.overflowPx}px` : row.status}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="min-h-11 min-w-11"
                  aria-label={`Actions for ${row.path} on ${row.device}`}
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onSelect={(e) => {
                    // Prevent Radix from stealing focus back to the trigger
                    // before the dialog opens — the dialog manages its own
                    // focus and Radix's default focus-return conflicts.
                    e.preventDefault();
                    onPreview(row);
                  }}
                  disabled={!row.screenshot}
                >
                  <GitCompare className="mr-2 h-4 w-4" aria-hidden="true" />
                  View diff
                  {diff?.kind === "new-failure" && (
                    <Badge className="ml-auto bg-destructive text-destructive-foreground text-[10px] px-1.5 py-0">
                      NEW
                    </Badge>
                  )}
                  {diff?.kind === "fixed" && (
                    <Badge className="ml-auto bg-success text-success-foreground text-[10px] px-1.5 py-0">
                      FIXED
                    </Badge>
                  )}
                  {diff?.kind === "changed" && !isNew && !isFixed && (
                    <Badge className="ml-auto bg-warning text-warning-foreground text-[10px] px-1.5 py-0">
                      CHG
                    </Badge>
                  )}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {row.screenshot ? (
          <button
            type="button"
            onClick={() => onPreview(row)}
            className="group relative block w-full overflow-hidden rounded-md border bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Open zoomable screenshot for ${row.path} on ${row.device}`}
          >
            <img
              src={row.screenshot}
              alt={`${row.device} viewport screenshot of ${row.path}`}
              loading="lazy"
              className="h-48 w-full object-cover object-top transition-transform group-hover:scale-[1.02]"
            />
            <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-background/85 px-2 py-1 text-[11px] font-medium text-foreground shadow-sm opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <Maximize2 className="h-3 w-3" aria-hidden="true" />
              Zoom
            </span>
          </button>
        ) : (
          <div className="grid h-48 place-items-center rounded-md border bg-muted text-sm text-muted-foreground">
            {row.status === "skipped" ? "Skipped — no session" : "No screenshot"}
          </div>
        )}
        {row.reason && <p className="text-xs text-muted-foreground">{row.reason}</p>}
        {row.offenders.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              {row.offenders.length} offending element
              {row.offenders.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-2 space-y-1 font-mono">
              {row.offenders.map((o, i) => (
                <li key={i} className="truncate">
                  <span className="text-foreground">{o.tag}</span>
                  <span className="text-muted-foreground"> · right {o.right}px</span>
                  {o.cls && <div className="truncate text-muted-foreground">.{o.cls}</div>}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            {row.viewport.width}×{row.viewport.height}
          </span>
          <span>{row.durationMs} ms</span>
        </div>
      </CardContent>
    </Card>
  );
}

const STATUS_TONE: Record<Row["status"], string> = {
  ok: "bg-success text-success-foreground",
  overflow: "bg-destructive text-destructive-foreground",
  skipped: "bg-muted text-muted-foreground",
  error: "bg-warning text-warning-foreground",
};

function summarise(rows: Row[]) {
  const t = { ok: 0, overflow: 0, skipped: 0, error: 0 };
  for (const r of rows) t[r.status]++;
  return t;
}

/**
 * Full-screen screenshot preview with zoom + pan and full row context.
 * Zoom controls: [-] / [+] / Reset, plus keyboard shortcuts (+, -, 0).
 * At >100% zoom the image becomes scrollable in both axes inside the frame.
 */
function ScreenshotPreviewDialog({
  row,
  diff,
  onClose,
}: {
  row: Row | null;
  diff?: DiffEntry;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  // Reset zoom whenever the modal opens on a different row.
  const rowKey = row ? `${row.device}::${row.route}` : null;
  useEffect(() => {
    setZoom(1);
  }, [rowKey]);

  if (!row) return null;
  const tone = STATUS_TONE[row.status];
  const canZoomIn = zoom < 4;
  const canZoomOut = zoom > 0.5;
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)));
    else if (e.key === "-" || e.key === "_") setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)));
    else if (e.key === "0") setZoom(1);
  };

  return (
    <Dialog
      open={!!row}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent
        className="max-w-6xl w-[95vw] p-0 gap-0 sm:max-h-[92vh] overflow-hidden"
        onKeyDown={onKeyDown}
      >
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <span className="font-mono text-sm">{row.path}</span>
            <Badge className={tone}>
              {row.status === "overflow" ? `overflow +${row.overflowPx}px` : row.status}
            </Badge>
            {diff?.kind === "new-failure" && (
              <Badge className="bg-destructive text-destructive-foreground">NEW</Badge>
            )}
            {diff?.kind === "fixed" && (
              <Badge className="bg-success text-success-foreground">FIXED</Badge>
            )}
            {diff?.kind === "changed" && (
              <Badge className="bg-warning text-warning-foreground">CHANGED</Badge>
            )}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="capitalize">{row.device}</span>
              <span>
                {row.viewport.width}×{row.viewport.height}
              </span>
              <span>{row.durationMs} ms</span>
              {diff?.previousStatus && (
                <span>
                  previous: <span className="font-medium">{diff.previousStatus}</span>
                </span>
              )}
              {row.screenshot && (
                <a
                  href={row.screenshot}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Open original <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
            disabled={!canZoomOut}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}
            disabled={!canZoomIn}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setZoom(1)} aria-label="Reset zoom">
            Reset
          </Button>
          <span className="ml-2 text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline">
            Shortcuts: + / − / 0
          </span>
        </div>

        <div className="flex flex-col md:flex-row md:max-h-[70vh]">
          <div className="relative flex-1 overflow-auto bg-[repeating-conic-gradient(hsl(var(--muted))_0_25%,transparent_0_50%)] bg-[length:16px_16px]">
            {row.screenshot ? (
              <div className="min-h-full min-w-full p-4">
                <img
                  src={row.screenshot}
                  alt={`${row.device} viewport screenshot of ${row.path}`}
                  style={{
                    width: `${zoom * 100}%`,
                    maxWidth: "none",
                    transformOrigin: "top left",
                  }}
                  className="block h-auto rounded border bg-background shadow-sm"
                />
              </div>
            ) : (
              <div className="grid h-full min-h-[300px] place-items-center p-8 text-sm text-muted-foreground">
                {row.status === "skipped" ? "Skipped — no session" : "No screenshot available"}
              </div>
            )}
          </div>

          <aside className="w-full shrink-0 overflow-y-auto border-t bg-card p-4 text-sm md:w-72 md:border-l md:border-t-0">
            <dl className="space-y-2">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Route</dt>
                <dd className="font-mono text-xs break-all">{row.path}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Route ID
                </dt>
                <dd className="font-mono text-xs break-all">{row.route}</dd>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Device
                  </dt>
                  <dd className="capitalize">{row.device}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Viewport
                  </dt>
                  <dd>
                    {row.viewport.width}×{row.viewport.height}
                  </dd>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Status
                  </dt>
                  <dd>
                    <Badge className={tone}>
                      {row.status === "overflow" ? `+${row.overflowPx}px` : row.status}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Duration
                  </dt>
                  <dd>{row.durationMs} ms</dd>
                </div>
              </div>
              {row.reason && (
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Reason
                  </dt>
                  <dd className="text-xs text-muted-foreground">{row.reason}</dd>
                </div>
              )}
              {row.offenders.length > 0 && (
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Offenders ({row.offenders.length})
                  </dt>
                  <dd>
                    <ul className="mt-1 space-y-1 font-mono text-xs">
                      {row.offenders.map((o, i) => (
                        <li key={i} className="rounded border bg-muted/40 p-1.5">
                          <div className="truncate">
                            <span className="text-foreground">{o.tag}</span>
                            <span className="text-muted-foreground"> · right {o.right}px</span>
                          </div>
                          {o.cls && <div className="truncate text-muted-foreground">.{o.cls}</div>}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
