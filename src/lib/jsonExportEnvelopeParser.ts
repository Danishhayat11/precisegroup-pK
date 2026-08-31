/**
 * Reverse of `buildJsonExportMetadata` + the app's envelope wrapper.
 *
 * Given the raw text of a `.json` file produced by the exporter (or an
 * already-parsed object), validate it against `jsonExportEnvelopeSchema`
 * and normalise it into the internal structures the app uses to
 * reason about an export:
 *
 *   - `columns`: array of `{ order, key, label }` in export order.
 *   - `columnByKey`: `Map<key, column>` for O(1) lookup by explicit /
 *     derived key. Because every key is unique (schema-enforced), this
 *     map's size equals `columns.length`.
 *   - `rows`: the raw row records, unchanged.
 *   - `rowValuesInColumnOrder(row)`: helper that returns cell values
 *     aligned to `columns` order — the shape most call sites want
 *     when re-projecting an imported export back into a table view.
 *
 * The parser is deliberately strict: schema failure throws
 * `JsonExportParseError` with the full zod issue list attached. Callers
 * that need best-effort behaviour can catch and fall back.
 */
import {
  jsonExportEnvelopeSchema,
  type JsonExportEnvelope,
  type JsonExportMetaParsed,
} from "./jsonExportEnvelopeSchema";
import type { z } from "zod";

export class JsonExportParseError extends Error {
  readonly issues: z.ZodIssue[];
  constructor(message: string, issues: z.ZodIssue[]) {
    super(message);
    this.name = "JsonExportParseError";
    this.issues = issues;
  }
}

export interface ParsedJsonExportColumn {
  order: number;
  key: string;
  label: string;
}

export interface ParsedJsonExport {
  meta: JsonExportMetaParsed;
  columns: ParsedJsonExportColumn[];
  /** Keyed by the column's derived / explicit `key`. */
  columnByKey: Map<string, ParsedJsonExportColumn>;
  rows: Array<Record<string, unknown>>;
  /** Extract a row's cell values in `columns` order (missing → undefined). */
  rowValuesInColumnOrder: (row: Record<string, unknown>) => unknown[];
}

/**
 * Parse a JSON export envelope (string or object) into the internal
 * shape. Throws `JsonExportParseError` on schema violations.
 */
export function parseJsonExportEnvelope(input: string | unknown): ParsedJsonExport {
  const raw = typeof input === "string" ? JSON.parse(input) : input;
  const result = jsonExportEnvelopeSchema.safeParse(raw);
  if (!result.success) {
    throw new JsonExportParseError(
      "JSON export envelope does not conform to the expected schema.",
      result.error.issues,
    );
  }
  const env: JsonExportEnvelope = result.data;
  const columns: ParsedJsonExportColumn[] = (env._meta.columns ?? []).map((c) => ({
    order: c.order,
    key: c.key,
    label: c.label,
  }));
  const columnByKey = new Map<string, ParsedJsonExportColumn>();
  for (const c of columns) columnByKey.set(c.key, c);

  const rowValuesInColumnOrder = (row: Record<string, unknown>): unknown[] =>
    columns.map((c) => row[c.key]);

  return {
    meta: env._meta,
    columns,
    columnByKey,
    rows: env.rows,
    rowValuesInColumnOrder,
  };
}
