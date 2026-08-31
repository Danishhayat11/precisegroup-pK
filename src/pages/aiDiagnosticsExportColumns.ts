/**
 * Canonical column registry for AI Diagnostics exports.
 *
 * Single source of truth for the label, ordering, and value extractors
 * used by BOTH the CSV writer (`rowToCsvCells`) and the JSON writer
 * (`handleExportJson` / `handleExportFilteredJson`). Keeping them in
 * one place is what makes optional column selection safe: the export
 * pipeline reads `getFilteredExportColumns(selectedKeys)` and emits
 * columns in canonical order, so CSV headers, CSV cells, JSON keys and
 * metadata `columns` can NEVER drift.
 *
 * Persisted user selection lives in localStorage under
 * `AI_DIAGNOSTICS_EXPORT_COLUMNS_KEY` as a JSON string[] of enabled
 * column keys.
 */
import type { GatewayPayloadFormat } from "./aiDiagnosticsGatewayPayload";

export interface DiagnosticsRow {
  id: string;
  created_at: string;
  request_id: string;
  round: number;
  tool_name: string | null;
  tool_args: unknown;
  tool_result: unknown;
  success: boolean;
  error_message: string | null;
  duration_ms: number | null;
  gateway_status: number | null;
  gateway_model: string | null;
  retry_strategy: string | null;
  in_flight: boolean | null;
  completed_at: string | null;
}

export type ExportColumnKey =
  | "created_at"
  | "request_id"
  | "round"
  | "tool_name"
  | "success"
  | "duration_ms"
  | "gateway_status"
  | "gateway_model"
  | "retry_strategy"
  | "error_message"
  | "tool_args"
  | "tool_result"
  | "gateway_error_payload";

export interface ExportColumnDef {
  key: ExportColumnKey;
  label: string;
  /**
   * When `alwaysInclude` is true, the checkbox is disabled in the UI so
   * downstream tools always find the row identifiers. Currently that's
   * `created_at` and `request_id` — enough to correlate an export with
   * the live view even when the user drops every payload column.
   */
  alwaysInclude?: boolean;
  /** Value used for the CSV cell (already-serialised primitives). */
  csvValue: (
    r: DiagnosticsRow,
    buildGatewayErrorPayload: (r: DiagnosticsRow, fmt: GatewayPayloadFormat) => unknown,
    prettyGatewayPayload: boolean,
  ) => unknown;
  /** Value used for the JSON row object. */
  jsonValue: (
    r: DiagnosticsRow,
    buildGatewayErrorPayload: (r: DiagnosticsRow, fmt: GatewayPayloadFormat) => unknown,
    prettyGatewayPayload: boolean,
  ) => unknown;
}

export const ALL_EXPORT_COLUMNS: readonly ExportColumnDef[] = [
  {
    key: "created_at",
    label: "Timestamp",
    alwaysInclude: true,
    csvValue: (r) => r.created_at,
    jsonValue: (r) => r.created_at,
  },
  {
    key: "request_id",
    label: "Request ID",
    alwaysInclude: true,
    csvValue: (r) => r.request_id,
    jsonValue: (r) => r.request_id,
  },
  { key: "round", label: "Round", csvValue: (r) => r.round, jsonValue: (r) => r.round },
  { key: "tool_name", label: "Tool", csvValue: (r) => r.tool_name, jsonValue: (r) => r.tool_name },
  { key: "success", label: "Success", csvValue: (r) => r.success, jsonValue: (r) => r.success },
  {
    key: "duration_ms",
    label: "Duration (ms)",
    csvValue: (r) => r.duration_ms,
    jsonValue: (r) => r.duration_ms,
  },
  {
    key: "gateway_status",
    label: "Gateway status",
    csvValue: (r) => r.gateway_status,
    jsonValue: (r) => r.gateway_status,
  },
  {
    key: "gateway_model",
    label: "Gateway model",
    csvValue: (r) => r.gateway_model,
    jsonValue: (r) => r.gateway_model,
  },
  {
    key: "retry_strategy",
    label: "Retry strategy",
    csvValue: (r) => r.retry_strategy,
    jsonValue: (r) => r.retry_strategy,
  },
  {
    key: "error_message",
    label: "Error message",
    csvValue: (r) => r.error_message,
    jsonValue: (r) => r.error_message,
  },
  {
    key: "tool_args",
    label: "Arguments",
    csvValue: (r) => r.tool_args,
    jsonValue: (r) => r.tool_args,
  },
  {
    key: "tool_result",
    label: "Result",
    csvValue: (r) => r.tool_result,
    jsonValue: (r) => r.tool_result,
  },
  {
    key: "gateway_error_payload",
    label: "Gateway error payload",
    csvValue: (r, build, pretty) => build(r, pretty ? "pretty" : "compact"),
    jsonValue: (r, build, pretty) => build(r, pretty ? "pretty" : "object"),
  },
];

export const ALL_EXPORT_COLUMN_KEYS: readonly ExportColumnKey[] = ALL_EXPORT_COLUMNS.map(
  (c) => c.key,
);

export const REQUIRED_EXPORT_COLUMN_KEYS: readonly ExportColumnKey[] = ALL_EXPORT_COLUMNS.filter(
  (c) => c.alwaysInclude,
).map((c) => c.key);

export const AI_DIAGNOSTICS_EXPORT_COLUMNS_KEY = "ai-diagnostics.export-columns.v1";

/** Load persisted selection; defaults to all columns when missing / corrupt. */
export function loadSelectedColumnKeys(): ExportColumnKey[] {
  if (typeof window === "undefined") return [...ALL_EXPORT_COLUMN_KEYS];
  try {
    const raw = window.localStorage.getItem(AI_DIAGNOSTICS_EXPORT_COLUMNS_KEY);
    if (!raw) return [...ALL_EXPORT_COLUMN_KEYS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...ALL_EXPORT_COLUMN_KEYS];
    const allowed = new Set(ALL_EXPORT_COLUMN_KEYS);
    const picked = parsed.filter(
      (k): k is ExportColumnKey => typeof k === "string" && allowed.has(k as ExportColumnKey),
    );
    // Force required columns even if the user's saved copy predates them.
    const withRequired = new Set<ExportColumnKey>([...picked, ...REQUIRED_EXPORT_COLUMN_KEYS]);
    if (withRequired.size === 0) return [...ALL_EXPORT_COLUMN_KEYS];
    return ALL_EXPORT_COLUMN_KEYS.filter((k) => withRequired.has(k));
  } catch {
    return [...ALL_EXPORT_COLUMN_KEYS];
  }
}

export function saveSelectedColumnKeys(keys: ExportColumnKey[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AI_DIAGNOSTICS_EXPORT_COLUMNS_KEY, JSON.stringify(keys));
  } catch {
    /* storage disabled — session copy still works */
  }
}

/** Return column defs in canonical order for the given selection. */
export function getFilteredExportColumns(selected: readonly ExportColumnKey[]): ExportColumnDef[] {
  const set = new Set<ExportColumnKey>([...selected, ...REQUIRED_EXPORT_COLUMN_KEYS]);
  return ALL_EXPORT_COLUMNS.filter((c) => set.has(c.key));
}
