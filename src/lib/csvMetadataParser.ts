/**
 * Reverse of `buildCsvMetadataHeader` / `prefixCsvWithMetadata`.
 *
 * Given the raw text of a CSV file that was produced by this app, extract
 * the `# key: value` metadata block sitting above the data. Import and
 * audit flows use this to reconstruct the exact filter / sort / pagination
 * / column state the exporter recorded, without having to re-derive it
 * from the data rows.
 *
 * Contract with the writer (see csvExportMetadata.ts):
 *   # Precise Realtors — <source>
 *   # Generated: <local timestamp string>
 *   # <extra key>: <value>            (repeated, optional)
 *   # Filters: k=v | k=v | …          (optional)
 *   # Sort: <col> <asc|desc>          (optional)
 *   # Page: N of M (size S)           (optional)
 *   # Rows: X shown · Y filtered · Z total   (optional, any subset)
 *   # Columns (N, in order): L1 | L2 | …     (optional)
 *   # Column keys: k1,k2,…                    (optional, only when all keys known)
 *   <blank line>
 *   <header row>
 *   <data rows>
 */

/**
 * Default schema/version applied to CSVs that WERE produced by this app
 * (i.e. carry a `# Precise Realtors — <source>` line or any other metadata
 * header line) but predate the addition of the `# Schema:` / `# Version:`
 * lines. Older exports don't declare an envelope, but conceptually they
 * ARE version 1 of the same schema — downstream tooling keyed on the
 * envelope should treat them as such rather than crash on `null`.
 *
 * A CSV with no metadata header at all (bodyStartIndex === 0) intentionally
 * leaves both fields null: we can't claim it's ours.
 */
export const LEGACY_CSV_SCHEMA = "precise-realtors.csv-export-metadata" as const;
export const LEGACY_CSV_VERSION = 1 as const;

export interface ParsedCsvMetadata {
  source: string | null;
  /** JSON envelope schema id echoed by the CSV writer (`# Schema:` line). */
  schema: string | null;
  /** JSON envelope numeric version echoed by the CSV writer (`# Version:` line). */
  version: number | null;
  /**
   * True when `schema` / `version` were absent from the metadata header
   * and defaulted to `LEGACY_CSV_SCHEMA` / `LEGACY_CSV_VERSION`. Callers
   * that need to distinguish "legacy export" from "current export" (e.g.
   * to warn about missing envelope guarantees) can branch on this flag.
   */
  schemaDefaulted: boolean;
  generatedAt: string | null;
  extra: Record<string, string>;
  filters: Record<string, string>;
  sort: { key: string; dir: "asc" | "desc" } | null;
  page: { page: number; totalPages: number; pageSize: number } | null;
  counts: { shown?: number; filtered?: number; total?: number } | null;
  columns: Array<{ key: string; label: string }> | null;
  /** Raw `# …` lines exactly as they appeared, in order. */
  rawLines: string[];
  /** 0-based index of the first non-metadata line (blank separator or data). */
  bodyStartIndex: number;
  /**
   * Auto-detected body delimiter, sniffed from the first non-blank body
   * line by counting unquoted occurrences of each candidate (`,`, `;`,
   * `\t`, `|`). The metadata header itself is delimiter-agnostic (it
   * lives on `#` lines that use `|` internally), so this field only
   * describes what to hand to a CSV body parser — nothing in the
   * metadata block depends on it.
   *
   * `null` when there is no body to sniff (empty file, body-only file
   * with a single unstructured line, or all candidates tie at zero).
   * When multiple candidates tie at the highest non-zero count, the
   * preference order `, ; \t |` breaks the tie — `,` wins over `;`,
   * which wins over `\t`, which wins over `|`. This matches the
   * historical assumption that unconfigured CSVs are comma-delimited.
   */
  bodyDelimiter: "," | ";" | "\t" | "|" | null;
}

/**
 * Thrown by `parseCsvMetadataHeader` when the metadata block violates a
 * structural invariant. The default (tolerant) mode only throws for the
 * `-column-*` codes, which the writer's own contract makes impossible;
 * passing `{ strict: true }` additionally throws for missing/malformed
 * required lines so import pipelines can fail loudly on hand-edited or
 * corrupted files rather than silently dropping fields.
 */
export type CsvMetadataParseErrorCode =
  | "missing-column-keys"
  | "empty-column-key"
  | "column-key-count-mismatch"
  | "missing-source"
  | "missing-columns"
  | "malformed-line";

export class CsvMetadataParseError extends Error {
  readonly code: CsvMetadataParseErrorCode;
  readonly details: {
    labelCount?: number;
    keyCount?: number;
    keyIndex?: number;
    field?: string;
    line?: string;
    lineNumber?: number;
  };
  constructor(
    code: CsvMetadataParseErrorCode,
    message: string,
    details: CsvMetadataParseError["details"] = {},
  ) {
    super(message);
    this.name = "CsvMetadataParseError";
    this.code = code;
    this.details = details;
  }
}

export interface ParseCsvMetadataOptions {
  /**
   * When true, throw `CsvMetadataParseError` on:
   *   - a `# Precise Realtors — <source>` line that is missing or empty
   *   - a metadata block with no `# Columns (…): …` line
   *   - a `#` line whose leading key matches a known field
   *     (Schema / Version / Generated / Filters / Sort / Page / Rows /
   *     Columns / Column keys) but whose value can't be parsed
   *
   * Default is `false` (the historical tolerant behaviour) so existing
   * callers that only need best-effort parsing keep working.
   */
  strict?: boolean;
}

const SOURCE_RE = /^#\s*Precise Realtors\s*[—-]\s*(.+?)\s*$/;
const SCHEMA_RE = /^#\s*Schema:\s*(.+?)\s*$/;
const VERSION_RE = /^#\s*Version:\s*(.+?)\s*$/;
const GENERATED_RE = /^#\s*Generated:\s*(.+?)\s*$/;
const FILTERS_RE = /^#\s*Filters:\s*(.+?)\s*$/;
const SORT_RE = /^#\s*Sort:\s*(\S+)\s+(asc|desc)\s*$/i;
const PAGE_RE = /^#\s*Page:\s*(\d+)\s+of\s+(\d+)\s*\(size\s+(\d+)\)\s*$/i;
const ROWS_RE = /^#\s*Rows:\s*(.+?)\s*$/;
const COLUMNS_RE = /^#\s*Columns\s*\(\s*(\d+)\s*,\s*in order\s*\):\s*(.+?)\s*$/i;
const COLUMN_KEYS_RE = /^#\s*Column keys:\s*(.*?)\s*$/;
const EXTRA_RE = /^#\s*([^:]+?):\s*(.*?)\s*$/;

/** Parse a `# Filters: k=v | k=v` payload into a plain object. */
function parseFiltersPayload(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of payload.split("|")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

/** Parse `25 shown · 100 filtered · 500 total` (any subset, either separator). */
function parseRowsPayload(payload: string): ParsedCsvMetadata["counts"] {
  const counts: { shown?: number; filtered?: number; total?: number } = {};
  // Tolerate both middle dot and ASCII separators just in case an editor
  // normalised the file.
  for (const part of payload.split(/\s*[·•|]\s*/)) {
    const m = /^(\d+)\s+(shown|filtered|total)$/i.exec(part.trim());
    if (!m) continue;
    const n = Number(m[1]);
    const bucket = m[2].toLowerCase() as "shown" | "filtered" | "total";
    counts[bucket] = n;
  }
  return Object.keys(counts).length > 0 ? counts : null;
}

/**
 * Sniff the body delimiter from the first non-blank line at or after
 * `bodyStartIndex`. Counts unquoted occurrences of each candidate so
 * quoted cells containing a delimiter don't bias the pick. Returns
 * `null` when there is no body line, or when every candidate ties at
 * zero (a single-column body has no delimiter to detect). Ties at a
 * non-zero count break by preference order `, ; \t |`.
 */
function sniffBodyDelimiter(
  lines: string[],
  bodyStartIndex: number,
): ParsedCsvMetadata["bodyDelimiter"] {
  let line: string | null = null;
  for (let idx = bodyStartIndex; idx < lines.length; idx++) {
    if (lines[idx].trim() !== "") {
      line = lines[idx];
      break;
    }
  }
  if (line === null) return null;

  const candidates: Array<ParsedCsvMetadata["bodyDelimiter"] & string> = [",", ";", "\t", "|"];
  const counts = new Map<string, number>();
  for (const d of candidates) counts.set(d, 0);
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (counts.has(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best: ParsedCsvMetadata["bodyDelimiter"] = null;
  let bestCount = 0;
  // Iterate in preference order so higher-priority candidates win ties.
  for (const d of candidates) {
    const n = counts.get(d) ?? 0;
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return bestCount > 0 ? best : null;
}

/**
 * Parse the metadata header out of a CSV string. Non-metadata files (no
 * leading `#` lines) return a fully-empty result with `bodyStartIndex = 0`
 * so callers can hand the same buffer straight to a CSV parser.
 *
 * Pass `{ strict: true }` to enforce required fields (source, columns) and
 * reject malformed lines whose leading key matches a well-known field —
 * useful for import pipelines that need to fail loudly on corrupted files.
 */
export function parseCsvMetadataHeader(
  csv: string,
  options: ParseCsvMetadataOptions = {},
): ParsedCsvMetadata {
  const strict = options.strict === true;
  const result: ParsedCsvMetadata = {
    source: null,
    schema: null,
    version: null,
    schemaDefaulted: false,
    generatedAt: null,
    extra: {},
    filters: {},
    sort: null,
    page: null,
    counts: null,
    columns: null,
    rawLines: [],
    bodyStartIndex: 0,
    bodyDelimiter: null,
  };

  // Split on any line ending; keep indices so we can report bodyStartIndex.
  const lines = csv.split(/\r\n|\n|\r/);
  let i = 0;
  let columnLabels: string[] | null = null;
  let columnKeys: string[] | null = null;

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("#")) break;
    result.rawLines.push(line);

    let m: RegExpExecArray | null;
    if ((m = SOURCE_RE.exec(line))) {
      result.source = m[1];
      continue;
    }
    if ((m = SCHEMA_RE.exec(line))) {
      result.schema = m[1];
      continue;
    }
    if ((m = VERSION_RE.exec(line))) {
      const n = Number(m[1]);
      result.version = Number.isFinite(n) ? n : null;
      continue;
    }
    if ((m = GENERATED_RE.exec(line))) {
      result.generatedAt = m[1];
      continue;
    }
    if ((m = FILTERS_RE.exec(line))) {
      result.filters = parseFiltersPayload(m[1]);
      continue;
    }
    if ((m = SORT_RE.exec(line))) {
      result.sort = { key: m[1], dir: m[2].toLowerCase() as "asc" | "desc" };
      continue;
    }
    if ((m = PAGE_RE.exec(line))) {
      result.page = {
        page: Number(m[1]),
        totalPages: Number(m[2]),
        pageSize: Number(m[3]),
      };
      continue;
    }
    if ((m = ROWS_RE.exec(line))) {
      result.counts = parseRowsPayload(m[1]);
      continue;
    }
    if ((m = COLUMNS_RE.exec(line))) {
      columnLabels = m[2]
        .split("|")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      continue;
    }
    if ((m = COLUMN_KEYS_RE.exec(line))) {
      columnKeys = m[1]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      continue;
    }
    // Fallback: any other `# Key: Value` line becomes an extra.
    if ((m = EXTRA_RE.exec(line))) {
      const k = m[1].trim();
      const v = m[2].trim();
      // If the key is one we DO understand, the earlier specific regex
      // must have rejected the value — treat it as malformed rather than
      // silently dumping into `extra` where it would masquerade as an
      // unknown key. In strict mode this is a hard error; otherwise we
      // just skip it (historical tolerant behaviour).
      if (/^(Filters|Sort|Page|Rows|Columns|Column keys|Generated|Schema|Version)$/i.test(k)) {
        if (strict) {
          throw new CsvMetadataParseError(
            "malformed-line",
            `CSV metadata has a malformed \`# ${k}:\` line at line ${i + 1}: value \`${v}\` does not match the expected format.`,
            { field: k, line, lineNumber: i + 1 },
          );
        }
        // tolerant mode: skip silently, do NOT pollute `extra`.
      } else {
        result.extra[k] = v;
      }
    } else if (strict && line.trim() !== "#" && line.trim() !== "") {
      // A `#` line with no `Key: Value` shape at all — legal as a free
      // comment in tolerant mode, but strict mode rejects it so hand
      // edits don't quietly change the parse.
      throw new CsvMetadataParseError(
        "malformed-line",
        `CSV metadata has an unrecognised comment line at line ${i + 1}: \`${line}\`.`,
        { line, lineNumber: i + 1 },
      );
    }
  }

  // A `# Columns` block MUST be accompanied by a `# Column keys` line with
  // the same length and no blank entries. The writer always emits keys, so
  // any violation is a hand-edited or corrupted metadata block — fail fast
  // rather than silently drop keys and let downstream tooling misalign.
  if (columnLabels) {
    if (!columnKeys) {
      throw new CsvMetadataParseError(
        "missing-column-keys",
        "CSV metadata has a `# Columns` block but no `# Column keys:` line.",
        { labelCount: columnLabels.length },
      );
    }
    if (columnKeys.length !== columnLabels.length) {
      throw new CsvMetadataParseError(
        "column-key-count-mismatch",
        `CSV metadata declares ${columnLabels.length} columns but ${columnKeys.length} keys.`,
        { labelCount: columnLabels.length, keyCount: columnKeys.length },
      );
    }
    const emptyIdx = columnKeys.findIndex((k) => !k || !k.trim());
    if (emptyIdx !== -1) {
      throw new CsvMetadataParseError(
        "empty-column-key",
        `CSV metadata has an empty column key at index ${emptyIdx}.`,
        { keyIndex: emptyIdx },
      );
    }
    result.columns = columnLabels.map((label, idx) => ({
      label,
      key: columnKeys![idx],
    }));
  }

  // Skip exactly one blank separator line so bodyStartIndex points at the
  // header row of the data (matching what `prefixCsvWithMetadata` writes).
  if (i < lines.length && lines[i].trim() === "") i++;
  result.bodyStartIndex = i;
  result.bodyDelimiter = sniffBodyDelimiter(lines, i);

  /*
   * Back-fill Schema / Version for legacy exports. The `# Schema:` and
   * `# Version:` lines were added after v1 shipped, so older files that
   * still carry OUR metadata block predate them. We recognise "ours" via
   * the `# Precise Realtors — <source>` marker specifically — matching
   * on "any # comment line" would misclaim arbitrary CSVs whose authors
   * happen to prefix comments with `#`. Files without that marker (or
   * without any metadata header) stay null.
   */
  if (result.source !== null) {
    if (result.schema === null) {
      result.schema = LEGACY_CSV_SCHEMA;
      result.schemaDefaulted = true;
    }
    if (result.version === null) {
      result.version = LEGACY_CSV_VERSION;
      result.schemaDefaulted = true;
    }
  }

  /*
   * Strict-mode required-field checks. These run AFTER back-fill so
   * `strict` doesn't reject legacy files just because they omit Schema
   * / Version — those are recoverable. Missing `source` or `columns`
   * are not: without a source line we can't identify the file as ours,
   * and without columns downstream tooling can't map cells to fields.
   */
  if (strict) {
    if (result.source === null || result.source.trim() === "") {
      throw new CsvMetadataParseError(
        "missing-source",
        "CSV metadata is missing the required `# Precise Realtors — <source>` line.",
      );
    }
    if (result.columns === null) {
      throw new CsvMetadataParseError(
        "missing-columns",
        "CSV metadata is missing the required `# Columns (N, in order): …` line.",
      );
    }
  }

  return result;
}

/**
 * Return the CSV body (header row + data rows) with the metadata block
 * stripped. Safe to hand directly to any CSV parser.
 */
export function stripCsvMetadataHeader(csv: string): string {
  const parsed = parseCsvMetadataHeader(csv);
  if (parsed.bodyStartIndex === 0) return csv;
  // Preserve the original line ending style by re-splitting the same way.
  const lines = csv.split(/\r\n|\n|\r/);
  return lines.slice(parsed.bodyStartIndex).join("\n");
}
