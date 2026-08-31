/**
 * Shared CSV metadata header builder.
 *
 * Every CSV export in the app prepends a block of `# key: value` lines
 * describing exactly WHAT the file contains: source view, filters that were
 * applied, sort order, pagination, and row counts. Excel / LibreOffice /
 * Google Sheets treat leading `#` rows as ordinary text so they don't
 * break parsing, and a downstream reviewer can reproduce the exact
 * data set from the header alone.
 *
 * Keep the format stable — external tooling and past exports rely on it:
 *   # Precise Realtors — <source>
 *   # Schema: <schema-id>
 *   # Version: <n>
 *   # Generated: <local timestamp>
 *   # <extra key>: <value>            (repeated)
 *   # Filters: k=v | k=v | …          (omitted when no filters active)
 *   # Sort: <col> <asc|desc>          (omitted when unsorted)
 *   # Page: N of M (size S)           (omitted when unpaged)
 *   # Showing X of Y (Z total)        (omitted when unavailable)
 *   # Columns (N, in order): l1 | l2 | …   (omitted when no columns)
 *   # Column keys: k1,k2,…                 (omitted when no columns)
 *   <blank line>
 *   <header row>
 *   <data rows>
 */

export type CsvMetaFilters = Record<string, string | number | boolean | null | undefined>;

export interface CsvMetadataInput {
  /** Human-readable source view, e.g. "Dashboard — KPI Trend". */
  source: string;
  /** Optional extra `# key: value` lines that don't fit the standard slots. */
  extra?: Record<string, string | number | undefined | null>;
  /** Active filters keyed by label. Empty / "all" / null entries are dropped. */
  filters?: CsvMetaFilters;
  /** Active sort as { column, direction }. */
  sort?: { key: string; dir: "asc" | "desc" } | null;
  /** Pagination info if the export represents a single page. */
  page?: { page: number; totalPages: number; pageSize: number } | null;
  /** Row-count summary: shown / filtered-total / grand-total. */
  counts?: { shown?: number; filtered?: number; total?: number } | null;
  /**
   * Selected export columns in the exact left-to-right order they appear in
   * the file. Included in metadata so a re-download reproduces the same
   * layout (and picker state) the exporter chose.
   */
  columns?: Array<string | { key?: string; label: string }> | null;
  /** Override "Generated:" — defaults to `new Date().toLocaleString()`. */
  generatedAt?: Date;
}

const CSV_META_SENTINEL_VALUES = new Set(["all", "any", "", "null", "undefined"]);

function isMeaningful(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  if (s === "") return false;
  return !CSV_META_SENTINEL_VALUES.has(s.toLowerCase());
}

/**
 * Thrown by the CSV / JSON metadata builders when the caller hands in a
 * value that cannot produce a well-formed metadata block. The builders
 * split malformed input into two buckets:
 *
 *   • FAIL-FAST (throw)  — structural fields that anchor the block:
 *       `source`, `sort.dir`, `page`, and every `columns` entry.
 *       These MUST be correct or the whole export is meaningless, so
 *       the caller finds out at build time instead of shipping a
 *       corrupt file.
 *
 *   • SILENTLY EXCLUDE   — row-shaped fields where the caller commonly
 *       passes many entries (filters, extras, counts buckets). A
 *       single bad entry drops out; the rest still ship. This matches
 *       the existing `isMeaningful` drop pattern.
 *
 * `columnIndex` is -1 for non-column errors (source/sort/page).
 */
export class CsvExportMetadataError extends Error {
  readonly code:
    | "empty-column-entry"
    | "empty-column-label"
    | "empty-column-key"
    | "derived-key-empty"
    | "invalid-column-type"
    | "invalid-column-label-type"
    | "invalid-column-key-type"
    | "blank-source"
    | "invalid-sort-direction"
    | "invalid-page-number";
  readonly columnIndex: number;
  constructor(code: CsvExportMetadataError["code"], columnIndex: number, message: string) {
    super(message);
    this.name = "CsvExportMetadataError";
    this.code = code;
    this.columnIndex = columnIndex;
  }
}

/**
 * Slugify a column label into a machine-safe key. Lowercased, non-alphanumeric
 * runs collapsed to `_`, leading/trailing `_` trimmed. Falls back to `column`
 * when the label has no alphanumeric characters at all (e.g. "—").
 *
 * Exported so tests and future callers can reach the primitive directly
 * without going through the full metadata builders. Both `buildCsvMetadataHeader`
 * and `buildJsonExportMetadata` route every derived key through this
 * function, so any change here shifts BOTH exporters identically.
 */
export function slugifyColumnKey(label: string): string {
  const slug = String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "column";
}

/**
 * Guarantee every column has a non-empty key. Explicit keys win; missing
 * keys are derived from the label via `slugifyColumnKey`, then deduplicated
 * within this column list so `# Column keys:` stays a unique CSV of
 * identifiers. Throws `CsvExportMetadataError` when a column entry can't
 * yield a valid key (missing entry, blank label AND blank key, etc.).
 *
 * SHARED helper — the single source of truth for column-key derivation
 * used by BOTH the CSV metadata header and the JSON envelope. Exported so
 * tests can pin the derivation contract in isolation from the surrounding
 * metadata serialisers, and so future consumers (e.g. new export formats,
 * downstream data-quality checks) can reuse the exact same rules.
 */
export function withDerivedColumnKeys(
  columns: NonNullable<CsvMetadataInput["columns"]>,
): Array<{ key: string; label: string }> {
  const seen = new Map<string, number>();
  const used = new Set<string>();
  return columns.map((c, idx) => {
    if (c === null || c === undefined) {
      throw new CsvExportMetadataError(
        "empty-column-entry",
        idx,
        `Column at index ${idx} is null/undefined.`,
      );
    }
    // Only two entry shapes are legal: a bare string label, or a plain
    // object with `label` (and optionally `key`). Numbers, booleans,
    // functions, arrays and other exotic values are caller bugs that
    // would silently mis-serialise (`[1,2].label` is undefined, etc.),
    // so we refuse them up-front with a distinct error code.
    if (typeof c !== "string") {
      if (
        typeof c !== "object" ||
        Array.isArray(c) ||
        typeof (c as { then?: unknown }).then === "function"
      ) {
        throw new CsvExportMetadataError(
          "invalid-column-type",
          idx,
          `Column at index ${idx} must be a string or a { key?, label } object; got ${
            Array.isArray(c) ? "array" : typeof c
          }.`,
        );
      }
    }
    const rawLabel = typeof c === "string" ? c : (c as { label?: unknown }).label;
    const rawKey = typeof c === "string" ? undefined : (c as { key?: unknown }).key;
    // `key` field, when present, MUST be a string. `null`, numbers,
    // booleans, arrays etc. are rejected instead of being silently
    // ignored (which would let a `{key: 42, label: "x"}` typo produce
    // a slug-derived key with no warning).
    if (rawKey !== undefined && typeof rawKey !== "string") {
      throw new CsvExportMetadataError(
        "invalid-column-key-type",
        idx,
        `Column at index ${idx} has a non-string \`key\` (${
          rawKey === null ? "null" : typeof rawKey
        }); expected string or omitted.`,
      );
    }
    // `label` field on object entries MUST be a string when the property
    // is present. `null` / `undefined` labels are only tolerated when the
    // property is entirely absent AND an explicit `key` is provided.
    const labelPropertyPresent =
      typeof c !== "string" && Object.prototype.hasOwnProperty.call(c, "label");
    if (labelPropertyPresent && typeof rawLabel !== "string") {
      throw new CsvExportMetadataError(
        "invalid-column-label-type",
        idx,
        `Column at index ${idx} has a non-string \`label\` (${
          rawLabel === null ? "null" : typeof rawLabel
        }); expected string.`,
      );
    }
    const explicit = typeof rawKey === "string" ? rawKey : undefined;
    const label = typeof rawLabel === "string" ? rawLabel : "";
    const explicitTrimmed = explicit ? explicit.trim() : "";
    const labelTrimmed = label.trim();
    // An explicit key that's present but blank is a caller bug — refuse it.
    if (typeof explicit === "string" && explicit.length > 0 && explicitTrimmed.length === 0) {
      throw new CsvExportMetadataError(
        "empty-column-key",
        idx,
        `Column at index ${idx} has an explicit key that is only whitespace.`,
      );
    }
    if (!explicitTrimmed && !labelTrimmed) {
      throw new CsvExportMetadataError(
        "empty-column-label",
        idx,
        `Column at index ${idx} has neither a key nor a non-empty label.`,
      );
    }
    const base = explicitTrimmed || slugifyColumnKey(labelTrimmed);
    if (!base) {
      // Belt-and-braces — slugifyColumnKey has a "column" fallback, so this
      // should be unreachable. Kept so a future refactor can't silently
      // regress the invariant.
      throw new CsvExportMetadataError(
        "derived-key-empty",
        idx,
        `Column at index ${idx} produced an empty derived key.`,
      );
    }
    // Bump the base counter, then walk past any suffix that a *literal*
    // sibling label already claimed — e.g. bases `[amount, amount, amount_2]`
    // must not collide the second `amount` onto the literal `amount_2`.
    let n = (seen.get(base) ?? 0) + 1;
    let key = n === 1 ? base : `${base}_${n}`;
    while (used.has(key)) {
      n += 1;
      key = `${base}_${n}`;
    }
    seen.set(base, n);
    used.add(key);
    return { key, label: labelTrimmed || base };
  });
}

/**
 * Validate the structural fields (`source`, `sort`, `page`) that anchor
 * the metadata block. Called by BOTH the CSV and JSON builders so a
 * malformed input fails identically no matter which serialiser the
 * caller picked. All checks are fail-fast.
 */
function validateStructuralFields(input: CsvMetadataInput): void {
  if (typeof input.source !== "string" || input.source.trim().length === 0) {
    throw new CsvExportMetadataError(
      "blank-source",
      -1,
      "Metadata `source` must be a non-empty string — it anchors the first `# Precise Realtors — <source>` line.",
    );
  }
  if (input.sort && input.sort.key) {
    const dir = input.sort.dir as unknown;
    if (dir !== "asc" && dir !== "desc") {
      throw new CsvExportMetadataError(
        "invalid-sort-direction",
        -1,
        `Metadata \`sort.dir\` must be "asc" or "desc"; got ${JSON.stringify(dir)}.`,
      );
    }
  }
  if (input.page) {
    const { page, totalPages, pageSize } = input.page;
    for (const [name, n] of [
      ["page", page],
      ["totalPages", totalPages],
      ["pageSize", pageSize],
    ] as const) {
      if (!Number.isInteger(n) || n < 1) {
        throw new CsvExportMetadataError(
          "invalid-page-number",
          -1,
          `Metadata \`page.${name}\` must be a positive integer; got ${JSON.stringify(n)}.`,
        );
      }
    }
  }
}

/**
 * Filter/extra keys and values that would corrupt the wire format
 * (newlines / `|` in values, newlines / `:` / `=` in keys, blank keys)
 * are DROPPED silently, matching the existing `isMeaningful` pattern.
 * `filters` also drop `=` in values would be ambiguous on parse; only
 * newlines and `|` are truly disallowed there.
 */
const FILTER_VALUE_BAD = /[\r\n|]/;
const EXTRA_VALUE_BAD = /[\r\n]/;
const FILTER_KEY_BAD = /[\r\n|=:]/;
const EXTRA_KEY_BAD = /[\r\n:]/;

function sanitisedEntries(
  source: Record<string, unknown> | undefined,
  badKey: RegExp,
  badValue: RegExp,
): Array<[string, string]> {
  if (!source) return [];
  const out: Array<[string, string]> = [];
  for (const [rawK, v] of Object.entries(source)) {
    const k = typeof rawK === "string" ? rawK.trim() : "";
    if (!k || badKey.test(k)) continue;
    if (!isMeaningful(v)) continue;
    const val = String(v);
    if (badValue.test(val)) continue;
    out.push([k, val]);
  }
  return out;
}

/** Keep only finite non-negative integers in the counts buckets. */
function sanitisedCounts(
  counts: CsvMetadataInput["counts"],
): { shown?: number; filtered?: number; total?: number } | null {
  if (!counts) return null;
  const out: { shown?: number; filtered?: number; total?: number } = {};
  for (const bucket of ["shown", "filtered", "total"] as const) {
    const n = counts[bucket];
    if (typeof n === "number" && Number.isInteger(n) && n >= 0) out[bucket] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Return an array of `# …` comment lines describing the export context. */
export function buildCsvMetadataHeader(input: CsvMetadataInput): string[] {
  validateStructuralFields(input);
  const lines: string[] = [];
  lines.push(`# Precise Realtors — ${input.source.trim()}`);
  // Schema + version echo the JSON envelope's `schema` / `version` fields so
  // a downstream parser can identify and version-branch a CSV export the
  // same way it does a JSON one. Keep the labels stable — external tooling
  // greps for `# Schema:` / `# Version:`.
  lines.push(`# Schema: ${JSON_ENVELOPE_SCHEMA}`);
  lines.push(`# Version: ${JSON_ENVELOPE_VERSION}`);
  lines.push(`# Generated: ${(input.generatedAt ?? new Date()).toLocaleString()}`);

  for (const [k, v] of sanitisedEntries(input.extra, EXTRA_KEY_BAD, EXTRA_VALUE_BAD)) {
    lines.push(`# ${k}: ${v}`);
  }

  const filterParts = sanitisedEntries(input.filters, FILTER_KEY_BAD, FILTER_VALUE_BAD).map(
    ([k, v]) => `${k}=${v}`,
  );
  if (filterParts.length > 0) lines.push(`# Filters: ${filterParts.join(" | ")}`);

  if (input.sort && input.sort.key) {
    lines.push(`# Sort: ${input.sort.key} ${input.sort.dir}`);
  }

  if (input.page) {
    lines.push(
      `# Page: ${input.page.page} of ${input.page.totalPages} (size ${input.page.pageSize})`,
    );
  }

  const counts = sanitisedCounts(input.counts);
  if (counts) {
    const bits: string[] = [];
    if (typeof counts.shown === "number") bits.push(`${counts.shown} shown`);
    if (typeof counts.filtered === "number") bits.push(`${counts.filtered} filtered`);
    if (typeof counts.total === "number") bits.push(`${counts.total} total`);
    if (bits.length > 0) lines.push(`# Rows: ${bits.join(" · ")}`);
  }

  if (input.columns && input.columns.length > 0) {
    const withKeys = withDerivedColumnKeys(input.columns);
    // Explicit order is the whole point — pipe-separated preserves order and
    // survives spreadsheet re-imports (CSVs never split on `|`).
    lines.push(
      `# Columns (${withKeys.length}, in order): ${withKeys.map((c) => c.label).join(" | ")}`,
    );
    // `Column keys` is now ALWAYS emitted: missing keys are derived from
    // the label (slugified + deduped) so downstream tooling can always
    // restore the exact picker state without label matching.
    lines.push(`# Column keys: ${withKeys.map((c) => c.key).join(",")}`);
  }

  return lines;
}

/**
 * Convenience: prefix the metadata header (plus one blank line) onto an
 * already-serialised CSV body. Body is returned unchanged when the header
 * would be empty, which never happens in practice but keeps callers safe.
 */
export function prefixCsvWithMetadata(body: string, input: CsvMetadataInput): string {
  const header = buildCsvMetadataHeader(input);
  if (header.length === 0) return body;
  return `${header.join("\n")}\n\n${body}`;
}

/**
 * Strong shape of the JSON envelope returned by
 * `buildJsonExportMetadata`. Required fields are always present;
 * optional buckets are omitted entirely when empty (never `null` /
 * never `undefined` when present) so callers and tests never have to
 * `!`-assert or read through a possibly-null value.
 *
 * Keep the field order in sync with the runtime object literal below
 * so JSON stringification stays byte-stable.
 */
export interface JsonExportMetadataColumn {
  order: number;
  key: string;
  label: string;
}

export interface JsonExportMetadata {
  schema: typeof JSON_ENVELOPE_SCHEMA;
  version: typeof JSON_ENVELOPE_VERSION;
  source: string;
  /** ISO-8601 timestamp (`Date.toISOString()`). */
  generatedAt: string;
  extra?: Record<string, string>;
  filters?: Record<string, string>;
  sort?: { key: string; dir: "asc" | "desc" };
  page?: { page: number; totalPages: number; pageSize: number };
  counts?: { shown?: number; filtered?: number; total?: number };
  columns?: JsonExportMetadataColumn[];
  // Index signature keeps the envelope assignable to `Record<string, unknown>`
  // for existing call sites that spread it into a wider payload. New code
  // should read the typed fields above directly — never invent new keys.
  [key: string]: unknown;
}

/**
 * JSON sibling: returns a `_meta` object with the same fields as the CSV
 * header, so downloads shared as JSON also carry the exact filter/sort/
 * column snapshot. Callers typically spread it under a top-level `_meta`
 * key next to their data payload.
 */
export function buildJsonExportMetadata(input: CsvMetadataInput): JsonExportMetadata {
  validateStructuralFields(input);
  // Versioning fields FIRST — downstream consumers branch on `schema` /
  // `version` before touching any other field. Bump `version` on any
  // breaking change to the envelope shape; keep `schema` stable so old
  // parsers can still identify the payload.
  const meta: JsonExportMetadata = {
    schema: JSON_ENVELOPE_SCHEMA,
    version: JSON_ENVELOPE_VERSION,
    source: input.source.trim(),
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
  };
  // `extra` / `filters` map keys are sorted alphabetically so the
  // serialised envelope is BYTE-STABLE across caller insertion order
  // (`{a,b}` and `{b,a}` produce identical JSON).
  const extra = sortedEntriesToObject(
    sanitisedEntries(
      input.extra as Record<string, unknown> | undefined,
      EXTRA_KEY_BAD,
      EXTRA_VALUE_BAD,
    ),
  );
  if (Object.keys(extra).length > 0) meta.extra = extra;

  const filters = sortedEntriesToObject(
    sanitisedEntries(
      input.filters as Record<string, unknown> | undefined,
      FILTER_KEY_BAD,
      FILTER_VALUE_BAD,
    ),
  );
  if (Object.keys(filters).length > 0) meta.filters = filters;

  if (input.sort && input.sort.key) meta.sort = { key: input.sort.key, dir: input.sort.dir };
  if (input.page) meta.page = input.page;
  const counts = sanitisedCounts(input.counts);
  if (counts) meta.counts = counts;
  if (input.columns && input.columns.length > 0) {
    const withKeys = withDerivedColumnKeys(input.columns);
    meta.columns = withKeys.map((c, i) => ({ order: i, key: c.key, label: c.label }));
  }
  return meta;
}

/**
 * JSON envelope schema identifier + numeric major version. Bump
 * `JSON_ENVELOPE_VERSION` on any breaking change to the envelope shape;
 * keep `JSON_ENVELOPE_SCHEMA` stable so downstream parsers keyed on the
 * schema id continue to recognise the payload.
 */
export const JSON_ENVELOPE_SCHEMA = "precise-realtors.csv-export-metadata" as const;
export const JSON_ENVELOPE_VERSION = 1 as const;

/** Alphabetically-sorted `Object.fromEntries` for byte-stable output. */
function sortedEntriesToObject(entries: Array<[string, string]>): Record<string, string> {
  return Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
