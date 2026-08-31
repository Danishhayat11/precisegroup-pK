/**
 * Pure filter/sort/serialisation helpers for the responsive-audit page.
 *
 * Kept in a separate module (no React, no browser APIs) so both the
 * interactive UI (`responsive-audit.tsx`) and the automated test suite can
 * import the SAME code — guaranteeing that the CSV and JSON downloads use
 * the exact same `filteredRows` + `sortBy` logic the on-screen table
 * shows.
 */

export type Offender = { tag: string; cls: string; right: number };

export type Row = {
  device: "mobile" | "tablet" | "desktop";
  route: string;
  path: string;
  viewport: { width: number; height: number };
  status: "ok" | "overflow" | "skipped" | "error";
  overflowPx: number;
  offenders: Offender[];
  screenshot: string | null;
  reason?: string;
  durationMs: number;
};

export type SortKey = "route-asc" | "route-desc" | "overflow-desc" | "status" | "duration-desc";

export function isFailing(status: Row["status"]): boolean {
  return status === "overflow" || status === "error";
}

const STATUS_RANK: Record<Row["status"], number> = {
  overflow: 0,
  error: 1,
  skipped: 2,
  ok: 3,
};

export function sortRows(rows: Row[], key: SortKey): Row[] {
  const copy = rows.slice();
  switch (key) {
    case "route-desc":
      return copy.sort((a, b) => b.path.localeCompare(a.path) || a.device.localeCompare(b.device));
    case "overflow-desc":
      return copy.sort(
        (a, b) => (b.overflowPx || 0) - (a.overflowPx || 0) || a.path.localeCompare(b.path),
      );
    case "status":
      return copy.sort(
        (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.path.localeCompare(b.path),
      );
    case "duration-desc":
      return copy.sort((a, b) => b.durationMs - a.durationMs);
    case "route-asc":
    default:
      return copy.sort((a, b) => a.path.localeCompare(b.path) || a.device.localeCompare(b.device));
  }
}

export type ResponsiveAuditFilters = {
  routeFilter: string; // path, or "all"
  deviceFilter: string; // device, or "all"
  statusFilter: string; // "all" | "failing" | status
  sortBy: SortKey;
};

/**
 * The single source of truth for "which rows does the responsive-audit
 * page currently show, in which order". The UI's `filteredRows` useMemo
 * and every export button MUST route through this function.
 */
export function applyResponsiveAuditFilters(
  results: Row[],
  { routeFilter, deviceFilter, statusFilter, sortBy }: ResponsiveAuditFilters,
): Row[] {
  const filtered = results.filter((r) => {
    if (routeFilter !== "all" && r.path !== routeFilter) return false;
    if (deviceFilter !== "all" && r.device !== deviceFilter) return false;
    if (statusFilter === "failing" && !isFailing(r.status)) return false;
    if (statusFilter !== "all" && statusFilter !== "failing" && r.status !== statusFilter)
      return false;
    return true;
  });
  return sortRows(filtered, sortBy);
}

// ── Export column registry ─────────────────────────────────────────────
export type ExportColumn = {
  key: string;
  label: string;
  get: (r: Row) => unknown;
};

export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "device", label: "Device", get: (r) => r.device },
  { key: "route", label: "Route", get: (r) => r.route },
  { key: "path", label: "Path", get: (r) => r.path },
  { key: "viewport_width", label: "Viewport width", get: (r) => r.viewport.width },
  { key: "viewport_height", label: "Viewport height", get: (r) => r.viewport.height },
  { key: "status", label: "Status", get: (r) => r.status },
  { key: "overflow_px", label: "Overflow (px)", get: (r) => r.overflowPx },
  { key: "duration_ms", label: "Duration (ms)", get: (r) => r.durationMs },
  { key: "screenshot", label: "Screenshot", get: (r) => r.screenshot ?? "" },
  { key: "reason", label: "Reason", get: (r) => r.reason ?? "" },
  {
    key: "offenders",
    label: "Offenders",
    get: (r) => r.offenders.map((o) => `${o.tag}.${o.cls}@${o.right}`).join(" | "),
  },
];

export const EXPORT_COLUMN_KEYS = EXPORT_COLUMNS.map((c) => c.key);

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCsvBody(rows: Row[], columnKeys: string[]): string {
  const cols = EXPORT_COLUMNS.filter((c) => columnKeys.includes(c.key));
  const lines = [
    cols
      .map((c) => c.key)
      .map(csvEscape)
      .join(","),
  ];
  for (const r of rows) {
    lines.push(cols.map((c) => csvEscape(c.get(r))).join(","));
  }
  return lines.join("\n");
}

export function rowsToJson(rows: Row[], columnKeys: string[]): Array<Record<string, unknown>> {
  const cols = EXPORT_COLUMNS.filter((c) => columnKeys.includes(c.key));
  return rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const c of cols) out[c.key] = c.get(r);
    return out;
  });
}
