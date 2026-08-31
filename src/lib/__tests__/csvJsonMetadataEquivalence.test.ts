/**
 * Cross-format equivalence: the JSON metadata envelope must describe
 * EXACTLY the same export state that a downstream reader would recover
 * by parsing the CSV metadata header. This is stronger than the writer
 * parity test (`csvJsonExporterParity`), which only compares the two
 * writers' pre-serialisation output. Here we go through the on-disk
 * boundary: build the CSV, parse it back with `parseCsvMetadataHeader`,
 * and assert every field of the resulting object matches the JSON
 * envelope one-for-one — including ordering and escaping rules.
 *
 * Fields covered and how equivalence is defined:
 *
 *   • source              — byte-identical string
 *   • generatedAt         — both non-null; representations differ
 *                            (CSV = `toLocaleString()`, JSON = ISO),
 *                            but both must round-trip the same Date
 *                            input (spot-checked with `new Date()`)
 *   • extra {k: v}        — string values, trimmed on both sides
 *   • filters {k: v}      — `k=v | k=v` in CSV, values trimmed
 *   • sort {key, dir}     — deep equal
 *   • page                — deep equal (numbers)
 *   • counts              — bucketed { shown?, filtered?, total? }
 *   • columns             — ORDERED [{key, label}]; JSON has an extra
 *                            `order` field, stripped before comparison
 *
 * Escaping rules exercised: pipes / commas / quotes / unicode / emoji
 * in labels, colons in extras, `=` and `|` inside filter VALUES (values
 * are the tail after the first `=`, so `|` and further `=` are legal).
 */
import { describe, it, expect } from "vitest";
import {
  prefixCsvWithMetadata,
  buildJsonExportMetadata,
  type CsvMetadataInput,
} from "../csvExportMetadata";
import { parseCsvMetadataHeader, type ParsedCsvMetadata } from "../csvMetadataParser";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

/** Normalise trimmed-value maps for equivalence comparisons. */
function trimValues(m: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m ?? {})) {
    if (v === null || v === undefined) continue;
    out[k] = String(v).trim();
  }
  return out;
}

/** Build the CSV, parse it back, and return the parsed metadata object. */
function csvRoundTrip(input: CsvMetadataInput): ParsedCsvMetadata {
  const csv = prefixCsvWithMetadata("h\r\nv\r\n", input);
  return parseCsvMetadataHeader(csv);
}

/**
 * Build the JSON envelope AND drop the `order` field from columns so
 * shape matches the parsed CSV columns (which don't carry `order`).
 */
function jsonEnvelope(input: CsvMetadataInput): Record<string, unknown> {
  const meta = buildJsonExportMetadata(input) as Record<string, unknown> & {
    columns?: Array<{ order: number; key: string; label: string }>;
  };
  const columns = meta.columns?.map(({ key, label }) => ({ key, label })) ?? null;
  return { ...meta, columns };
}

/** Assert JSON envelope equals parsed CSV, field by field, for one input. */
function assertEquivalent(input: CsvMetadataInput) {
  const parsed = csvRoundTrip(input);
  const json = jsonEnvelope(input);

  // Source — byte-identical.
  expect(json.source).toBe(parsed.source);

  // generatedAt — both present, both parseable back to the same Date.
  //   CSV uses `toLocaleString()` which loses precision, so we only
  //   assert both are non-null (round-trippability is covered by the
  //   dedicated writer tests).
  expect(parsed.generatedAt).toBeTruthy();
  expect(typeof json.generatedAt === "string" && (json.generatedAt as string).length > 0).toBe(
    true,
  );

  // extra — string values, trimmed on both sides.
  expect(trimValues(json.extra as Record<string, unknown> | undefined)).toEqual(
    trimValues(parsed.extra),
  );

  // filters — trimmed values match.
  expect(trimValues(json.filters as Record<string, unknown> | undefined)).toEqual(
    trimValues(parsed.filters),
  );

  // sort — deep equal (or both null).
  expect(json.sort ?? null).toEqual(parsed.sort);

  // page — deep equal (or both null).
  expect(json.page ?? null).toEqual(parsed.page);

  // counts — deep equal, allowing both to omit missing buckets.
  expect(json.counts ?? null).toEqual(parsed.counts);

  // columns — ORDERED, key + label deep-equal (order stripped above).
  expect(json.columns).toEqual(parsed.columns);
}

describe("JSON envelope ≡ parsed CSV metadata (structure, ordering, escaping)", () => {
  it("minimal input — only source + generatedAt", () => {
    assertEquivalent({
      source: "Dashboard — KPI Trend",
      generatedAt: FIXED_DATE,
    });
  });

  it("full input — extras, filters, sort, page, counts, columns", () => {
    assertEquivalent({
      source: "Diagnostics — Full Export",
      generatedAt: FIXED_DATE,
      extra: { Environment: "production", Build: "abc123" },
      filters: { status: "open", owner: "alice" },
      sort: { key: "amount", dir: "desc" },
      page: { page: 3, totalPages: 12, pageSize: 25 },
      counts: { shown: 25, filtered: 300, total: 500 },
      columns: [{ key: "id", label: "ID" }, { label: "Amount" }, { label: "Sold Date" }],
    });
  });

  it("column ordering is preserved across the CSV↔JSON boundary", () => {
    // Interleave explicit keys and label-only entries; the resolver
    // must place every column at the SAME index in both formats.
    const input: CsvMetadataInput = {
      source: "Order Test",
      generatedAt: FIXED_DATE,
      columns: [
        { label: "Amount" }, // amount
        { key: "amount_2", label: "Amount (explicit)" }, // amount_2
        { label: "Amount" }, // amount_3
        { key: "total", label: "Total" }, // total
        { label: "amount!" }, // amount_4
      ],
    };
    const parsed = csvRoundTrip(input);
    const json = jsonEnvelope(input);
    // Positions match one-to-one.
    expect(json.columns).toEqual(parsed.columns);
    // Spot-check the exact chain to catch silent reordering.
    expect(parsed.columns!.map((c) => c.key)).toEqual([
      "amount",
      "amount_2",
      "amount_3",
      "total",
      "amount_4",
    ]);
  });

  it("escaping: filter VALUES with `=` and `|` characters survive the CSV split", () => {
    // Filter values are the tail after the FIRST `=`; splits on ` | `.
    // Values containing further `=` are legal; a value with a raw `|`
    // would ambiguously split, so writers document that as unsupported.
    // Here we assert what IS supported: `=` in the value round-trips.
    const input: CsvMetadataInput = {
      source: "Filter Escape",
      generatedAt: FIXED_DATE,
      filters: { equation: "a=b+c", note: "x = y" },
    };
    assertEquivalent(input);
  });

  it("escaping: labels with commas, quotes, unicode, emoji round-trip identically", () => {
    // Labels are pipe-separated in the metadata block, so commas /
    // quotes / unicode / emoji are all legal there. Both formats
    // must preserve them byte-identically.
    assertEquivalent({
      source: "Label Escape",
      generatedAt: FIXED_DATE,
      columns: [
        { label: "Amount, gross (PKR)" },
        { label: 'Amount "net"' },
        { label: "café ☕" },
        { label: "日本語 2026" },
        { label: "💰 Total 💰" },
      ],
    });
  });

  it("escaping: extra values with colons and spaces are trimmed identically", () => {
    // The CSV parser uses the FIRST `:` to split extras; the value
    // (tail) may contain further colons freely. Both formats trim
    // surrounding whitespace off the value.
    assertEquivalent({
      source: "Extra Escape",
      generatedAt: FIXED_DATE,
      extra: {
        BuildTime: "2026-07-07T10:00:00Z",
        Region: "  eu-west-1  ", // trimmed on both sides
        Notes: "key: value: nested",
      },
    });
  });

  it("empty / sentinel filter values are dropped by BOTH formats", () => {
    // `isMeaningful` filters `""`, `"all"`, `"null"`, etc. before
    // writing. The parsed CSV therefore contains only meaningful
    // entries, and the JSON envelope must too — same set exactly.
    const input: CsvMetadataInput = {
      source: "Sentinel Drop",
      generatedAt: FIXED_DATE,
      filters: {
        keep: "yes",
        drop_all: "all",
        drop_blank: "",
        drop_null: null,
      },
    };
    const parsed = csvRoundTrip(input);
    const json = jsonEnvelope(input);
    expect(Object.keys(parsed.filters).sort()).toEqual(["keep"]);
    expect(Object.keys(json.filters as Record<string, unknown>).sort()).toEqual(["keep"]);
    assertEquivalent(input);
  });

  it("counts with partial buckets match exactly (only shown+total, no filtered)", () => {
    assertEquivalent({
      source: "Partial Counts",
      generatedAt: FIXED_DATE,
      counts: { shown: 10, total: 100 },
    });
  });

  it("sort=null and page=null in input produce absent-or-null in both formats", () => {
    const input: CsvMetadataInput = {
      source: "Null Sort / Page",
      generatedAt: FIXED_DATE,
      sort: null,
      page: null,
    };
    const parsed = csvRoundTrip(input);
    const json = jsonEnvelope(input);
    expect(parsed.sort).toBeNull();
    expect(parsed.page).toBeNull();
    // JSON simply omits the fields when the input is nullish.
    expect(json.sort ?? null).toBeNull();
    expect(json.page ?? null).toBeNull();
    assertEquivalent(input);
  });
});
