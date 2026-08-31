/**
 * csvReplay — reproduce a previous CSV export from its metadata header.
 *
 * Every CSV the app writes carries a `# key: value` metadata block on top
 * (see `csvExportMetadata.ts`) describing the exact source, filters, sort,
 * pagination, and ordered columns that produced it. This module reads that
 * block and — for any export source that has registered a replayer — asks
 * the source to re-run the same query so the download can be regenerated
 * on demand (audit "reproduce this file" flows, comparison diffs, etc.).
 *
 * Because different exports pull from wildly different pipelines
 * (Data Health audits, Dashboard KPIs, Import Center manifests, …) a
 * single generic replayer is not possible. Instead each surface
 * registers a typed replayer keyed by the exact `source` string it
 * wrote into the metadata header. The replay lookup is by that string.
 */

import { parseCsvMetadataHeader, type ParsedCsvMetadata } from "./csvMetadataParser";
import { prefixCsvWithMetadata, type CsvMetadataInput } from "./csvExportMetadata";

export interface CsvReplayContext {
  /**
   * Filters parsed from `# Filters: k=v | k=v` — values are raw strings.
   * The parser keys these by whatever token the writer used, which is
   * often a column label. Prefer `filtersByColumnKey` when a replayer
   * wants to align a filter to a specific column, since labels can be
   * renamed while keys stay stable.
   */
  filters: Record<string, string>;
  /**
   * Filters re-keyed by the matching column's stable key. Any filter
   * whose token equals a known column label OR key is exposed under the
   * column's key here; unmatched filters are kept under their original
   * token. Case-insensitive on the label match.
   */
  filtersByColumnKey: Record<string, string>;
  /**
   * Sort parsed from `# Sort: <key> <asc|desc>` (null when the file was
   * unsorted). If the recorded sort token matched a column label rather
   * than its key (e.g. legacy writer), it is normalised to the column's
   * key here so replayers can trust `ctx.sort.key` as a stable identifier.
   */
  sort: { key: string; dir: "asc" | "desc" } | null;
  /** Ordered columns parsed from `# Columns (N, in order): …` (+ `# Column keys:`). */
  columns: Array<{ key: string; label: string }>;
  /** Ordered stable column keys — convenience shortcut for `columns.map(c => c.key)`. */
  columnKeys: string[];
  /** Column lookup by stable key — labels may change, keys are canonical. */
  columnsByKey: Record<string, { key: string; label: string; index: number }>;
  /** Any extra `# Key: Value` lines the exporter wrote (e.g. Project, Device). */
  extra: Record<string, string>;
  /** Full parsed metadata for advanced replayers that need pagination or counts. */
  raw: ParsedCsvMetadata;
}

/**
 * A registered replayer must accept the parsed context and return either:
 *   - a full CSV string (metadata header + body), or
 *   - an object with `body` + partial overrides — the runner prepends a
 *     metadata header derived from the parsed context so the reproduced
 *     file carries the SAME `# Filters:` / `# Sort:` / `# Columns:` lines
 *     as the original (only `generatedAt` is refreshed to "now").
 */
export type CsvReplayResult =
  | { kind: "csv"; csv: string }
  | { kind: "body"; body: string; overrides?: Partial<CsvMetadataInput> };

export type CsvReplayer = (ctx: CsvReplayContext) => Promise<CsvReplayResult> | CsvReplayResult;

const REGISTRY = new Map<string, CsvReplayer>();

/** Register (or replace) the replayer for a given `source` header value. */
export function registerCsvReplayer(source: string, replayer: CsvReplayer): void {
  REGISTRY.set(source, replayer);
}

/** Remove a replayer — mainly used by tests. */
export function unregisterCsvReplayer(source: string): void {
  REGISTRY.delete(source);
}

/** True when a replayer exists for the given source string. */
export function hasCsvReplayer(source: string): boolean {
  return REGISTRY.has(source);
}

/** List the currently registered replay sources (for UI menus / debugging). */
export function listCsvReplaySources(): string[] {
  return Array.from(REGISTRY.keys()).sort();
}

export interface ReplayCsvExportResult {
  /** The reproduced CSV, ready to hand to a download link or diff viewer. */
  csv: string;
  /** The metadata parsed from the original file, for the caller to inspect. */
  metadata: ParsedCsvMetadata;
  /** The `source` string that identified the replayer. */
  source: string;
}

export class CsvReplayError extends Error {
  readonly code: "no-metadata" | "no-source" | "no-replayer";
  constructor(code: "no-metadata" | "no-source" | "no-replayer", message: string) {
    super(message);
    this.code = code;
    this.name = "CsvReplayError";
  }
}

/**
 * Reproduce a CSV export from the metadata block of a previously
 * downloaded file. Throws `CsvReplayError` when the file has no
 * metadata block, no `source`, or no registered replayer for that source.
 */
export async function replayCsvExport(csvText: string): Promise<ReplayCsvExportResult> {
  const metadata = parseCsvMetadataHeader(csvText);
  if (metadata.rawLines.length === 0) {
    throw new CsvReplayError(
      "no-metadata",
      "This file does not have a Precise Realtors metadata header and cannot be replayed.",
    );
  }
  if (!metadata.source) {
    throw new CsvReplayError(
      "no-source",
      "Metadata header is missing the `# Precise Realtors — <source>` line.",
    );
  }
  const replayer = REGISTRY.get(metadata.source);
  if (!replayer) {
    throw new CsvReplayError(
      "no-replayer",
      `No replayer is registered for source "${metadata.source}". Call registerCsvReplayer("${metadata.source}", …) first.`,
    );
  }

  const columns = (metadata.columns ?? []).map((c) => ({ key: c.key, label: c.label }));
  const columnKeys = columns.map((c) => c.key);
  const columnsByKey: Record<string, { key: string; label: string; index: number }> = {};
  // Also build a label → key map so we can rewrite filter tokens / sort
  // keys that were written using the display label rather than the stable
  // key. Case-insensitive because labels are human-facing text.
  const labelToKey = new Map<string, string>();
  columns.forEach((c, index) => {
    columnsByKey[c.key] = { key: c.key, label: c.label, index };
    if (c.label) labelToKey.set(c.label.trim().toLowerCase(), c.key);
  });

  // Slugify tokens the same way the writer slugifies labels — this lets us
  // rekey filter/sort tokens that were written as labels ("Sold On") to the
  // stable column key ("sold_on") even after the label has been renamed
  // in-place ("Sold On" → "Deal Date"). Keys are the canonical anchor.
  const slugify = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  const rekey = (token: string): string => {
    if (columnsByKey[token]) return token; // already a stable key
    const viaLabel = labelToKey.get(token.trim().toLowerCase());
    if (viaLabel) return viaLabel;
    const viaSlug = slugify(token);
    if (viaSlug && columnsByKey[viaSlug]) return viaSlug;
    return token;
  };

  const filtersByColumnKey: Record<string, string> = {};
  for (const [token, value] of Object.entries(metadata.filters)) {
    filtersByColumnKey[rekey(token)] = value;
  }

  const normalisedSort = metadata.sort
    ? { key: rekey(metadata.sort.key), dir: metadata.sort.dir }
    : null;

  const ctx: CsvReplayContext = {
    filters: metadata.filters,
    filtersByColumnKey,
    sort: normalisedSort,
    columns,
    columnKeys,
    columnsByKey,
    extra: metadata.extra,
    raw: metadata,
  };
  const result = await replayer(ctx);

  if (result.kind === "csv") {
    return { csv: result.csv, metadata, source: metadata.source };
  }

  // Compose a fresh metadata header from the parsed values, then let
  // the replayer override any field it wants (e.g. updated counts after
  // fresh data). `generatedAt` intentionally defaults to "now" so the
  // reproduced file records when it was replayed.
  const baseInput: CsvMetadataInput = {
    source: metadata.source,
    extra: metadata.extra,
    filters: metadata.filters,
    sort: metadata.sort,
    page: metadata.page,
    counts: metadata.counts,
    columns: ctx.columns.map((c) => ({ key: c.key, label: c.label })),
  };
  const merged: CsvMetadataInput = { ...baseInput, ...(result.overrides ?? {}) };
  return {
    csv: prefixCsvWithMetadata(result.body, merged),
    metadata,
    source: metadata.source,
  };
}

/** Convenience: inspect the metadata block without running a replayer. */
export function inspectCsvMetadata(csvText: string): ParsedCsvMetadata {
  return parseCsvMetadataHeader(csvText);
}
