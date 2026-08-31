/**
 * End-to-end round-trip: build the JSON metadata envelope AND the CSV
 * metadata header from the same `CsvMetadataInput`, parse the CSV back
 * with `parseCsvMetadataHeader`, then rebuild a JSON envelope from the
 * parsed result and assert it matches the original JSON envelope
 * EXACTLY (deep equal).
 *
 * This is the strongest guarantee we can give downstream consumers: a
 * CSV produced by the app carries enough metadata that a reader can
 * reconstruct the JSON envelope byte-for-byte, with no field loss and
 * no ordering drift.
 *
 * `generatedAt` is the one field that intentionally differs in on-disk
 * representation (CSV uses `toLocaleString()`, JSON uses ISO). We
 * assert both are present and non-empty, then normalise them to a
 * single sentinel before the deep-equal so the rest of the envelope is
 * compared strictly.
 */
import { describe, it, expect } from "vitest";
import {
  prefixCsvWithMetadata,
  buildJsonExportMetadata,
  JSON_ENVELOPE_SCHEMA,
  JSON_ENVELOPE_VERSION,
  type CsvMetadataInput,
} from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");
const GENERATED_AT_SENTINEL = "<generated-at>";

/**
 * Rebuild a JSON-envelope-shaped object from a parsed CSV metadata
 * block, matching the exact shape produced by `buildJsonExportMetadata`
 * (schema/version first, columns carry an `order` index, sorted extra
 * / filters keys, only-populated optional buckets).
 */
function reconstructJsonEnvelope(
  parsed: ReturnType<typeof parseCsvMetadataHeader>,
): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    schema: parsed.schema,
    version: parsed.version,
    source: parsed.source,
    generatedAt: parsed.generatedAt,
  };
  const sortKeys = <T extends Record<string, unknown>>(m: T): T => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(m).sort()) out[k] = m[k];
    return out as T;
  };
  if (Object.keys(parsed.extra).length > 0) meta.extra = sortKeys(parsed.extra);
  if (Object.keys(parsed.filters).length > 0) meta.filters = sortKeys(parsed.filters);
  if (parsed.sort) meta.sort = parsed.sort;
  if (parsed.page) meta.page = parsed.page;
  if (parsed.counts) meta.counts = parsed.counts;
  if (parsed.columns) {
    meta.columns = parsed.columns.map((c, i) => ({
      order: i,
      key: c.key,
      label: c.label,
    }));
  }
  return meta;
}

/**
 * Normalise `generatedAt` to a sentinel so the two envelopes (CSV
 * `toLocaleString()` vs JSON ISO) can be compared strictly on every
 * other field.
 */
function withStableGeneratedAt(meta: Record<string, unknown>): Record<string, unknown> {
  expect(meta.generatedAt).toBeTruthy();
  expect(typeof meta.generatedAt).toBe("string");
  return { ...meta, generatedAt: GENERATED_AT_SENTINEL };
}

function e2e(input: CsvMetadataInput): {
  fromJson: Record<string, unknown>;
  fromCsv: Record<string, unknown>;
} {
  const csv = prefixCsvWithMetadata("h1,h2\r\nv1,v2\r\n", input);
  const parsed = parseCsvMetadataHeader(csv);
  return {
    fromJson: withStableGeneratedAt(buildJsonExportMetadata(input)),
    fromCsv: withStableGeneratedAt(reconstructJsonEnvelope(parsed)),
  };
}

describe("CSV → JSON metadata E2E round-trip", () => {
  it("minimal input (source only) round-trips exactly", () => {
    const { fromJson, fromCsv } = e2e({
      source: "Dashboard — KPI Trend",
      generatedAt: FIXED_DATE,
    });
    expect(fromCsv).toEqual(fromJson);
    expect(fromJson).toEqual({
      schema: JSON_ENVELOPE_SCHEMA,
      version: JSON_ENVELOPE_VERSION,
      source: "Dashboard — KPI Trend",
      generatedAt: GENERATED_AT_SENTINEL,
    });
  });

  it("fully-populated input round-trips exactly across every field", () => {
    const input: CsvMetadataInput = {
      source: "Ledger — Postings",
      generatedAt: FIXED_DATE,
      extra: { Report: "Weekly", Owner: "ops" },
      filters: { Status: "Open", Owner: "Ada" },
      sort: { key: "postedAt", dir: "desc" },
      page: { page: 2, totalPages: 7, pageSize: 25 },
      counts: { shown: 25, filtered: 175, total: 500 },
      columns: [
        { key: "id", label: "ID" },
        { key: "postedAt", label: "Posted At" },
        { key: "amount", label: "Amount (PKR)" },
      ],
    };
    const { fromJson, fromCsv } = e2e(input);
    expect(fromCsv).toEqual(fromJson);
  });

  it("preserves column order and derived keys exactly", () => {
    const input: CsvMetadataInput = {
      source: "Fits — Overview",
      generatedAt: FIXED_DATE,
      columns: ["Zeta Score", "Alpha Bucket", "Gamma", { label: "Zeta Score" }],
    };
    const { fromJson, fromCsv } = e2e(input);
    // Deep-equal proves both order AND collision-suffix keys survive
    // the CSV boundary identically.
    expect(fromCsv).toEqual(fromJson);
    expect(fromJson.columns).toEqual([
      { order: 0, key: "zeta_score", label: "Zeta Score" },
      { order: 1, key: "alpha_bucket", label: "Alpha Bucket" },
      { order: 2, key: "gamma", label: "Gamma" },
      { order: 3, key: "zeta_score_2", label: "Zeta Score" },
    ]);
  });

  it("omits every optional bucket identically on both sides", () => {
    const { fromJson, fromCsv } = e2e({
      source: "Empty",
      generatedAt: FIXED_DATE,
      extra: {},
      filters: {},
      counts: null,
      page: null,
      sort: null,
      columns: [],
    });
    expect(fromCsv).toEqual(fromJson);
    // No optional fields leaked into either envelope.
    for (const k of ["extra", "filters", "sort", "page", "counts", "columns"]) {
      expect(fromJson).not.toHaveProperty(k);
      expect(fromCsv).not.toHaveProperty(k);
    }
  });
});
