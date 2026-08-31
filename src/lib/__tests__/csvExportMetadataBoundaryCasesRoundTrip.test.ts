/**
 * CSV metadata boundary-case round-trip tests.
 *
 * Focus: shapes that historically caused writer/parser drift or
 * envelope-shape regressions —
 *
 *   • empty results (counts=0, no filters, no sort, no page)
 *   • labels with special chars (unicode, emoji, tabs, non-BMP)
 *   • filter values / labels containing commas and (escaped) newlines
 *   • null / undefined / whitespace optional fields (must be dropped,
 *     not serialised as literal "null" / "undefined")
 *
 * Contract asserted end-to-end for each case:
 *   1. `buildCsvMetadataHeader` + `parseCsvMetadataHeader` round-trip
 *      the fields that CAN survive the wire format byte-for-byte.
 *   2. `buildJsonExportMetadata` produces the documented envelope shape:
 *      required keys always present, optional keys omitted (never
 *      undefined/null), `filters`/`extra` alphabetically sorted,
 *      `columns` in caller-declared order with `{order,key,label}`.
 *   3. CSV columns and JSON envelope columns share the SAME derived keys
 *      in the SAME order — the two exports never disagree on picker
 *      state, no matter what the caller passes.
 */
import { describe, it, expect } from "vitest";
import {
  buildJsonExportMetadata,
  prefixCsvWithMetadata,
  withDerivedColumnKeys,
  JSON_ENVELOPE_SCHEMA,
  JSON_ENVELOPE_VERSION,
  type CsvMetadataInput,
  type JsonExportMetadata,
} from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";

const FIXED_DATE = new Date("2026-07-07T12:00:00.000Z");

/**
 * Build → parse the CSV, and build the JSON envelope from the same
 * input. Returns both so per-test assertions can cross-check them.
 */
function roundTrip(input: CsvMetadataInput) {
  // Strict parse requires a `# Columns` block; every fixture gets a
  // trivial single-column set when the caller doesn't care about
  // columns, so per-test assertions can focus on filters / counts / etc.
  const withDefaults: CsvMetadataInput = {
    ...input,
    columns: input.columns ?? [{ key: "col", label: "col" }],
  };
  const csv = prefixCsvWithMetadata("col\n1\n", withDefaults);
  const parsed = parseCsvMetadataHeader(csv, { strict: true });
  const json = buildJsonExportMetadata(withDefaults);
  return { csv, parsed, json };
}

/** JSON envelope structural invariants that hold for EVERY input. */
function assertEnvelopeShape(json: JsonExportMetadata) {
  // Required keys — always present, in insertion order.
  const keys = Object.keys(json);
  expect(keys.slice(0, 4)).toEqual(["schema", "version", "source", "generatedAt"]);
  expect(json.schema).toBe(JSON_ENVELOPE_SCHEMA);
  expect(json.version).toBe(JSON_ENVELOPE_VERSION);
  expect(typeof json.source).toBe("string");
  expect(json.source.length).toBeGreaterThan(0);
  // ISO-8601 with millisecond precision + "Z" — asserts we didn't
  // regress to `toLocaleString`.
  expect(json.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  // Optional keys: when absent they must be MISSING, never `undefined`
  // or `null`. When present they must be non-empty objects/arrays.
  for (const opt of ["extra", "filters", "sort", "page", "counts", "columns"] as const) {
    if (opt in json) {
      const v = json[opt];
      expect(v).not.toBeNull();
      expect(v).not.toBeUndefined();
      if (Array.isArray(v)) expect(v.length).toBeGreaterThan(0);
      else if (typeof v === "object") expect(Object.keys(v as object).length).toBeGreaterThan(0);
    }
  }
}

describe("CSV ↔ JSON metadata round-trip: boundary cases", () => {
  it("empty results: no filters/sort/page, counts all zero → CSV omits blocks, JSON omits keys", () => {
    const input: CsvMetadataInput = {
      source: "Empty dashboard",
      generatedAt: FIXED_DATE,
      // All zero counts still count as meaningful — the writer keeps them.
      counts: { shown: 0, filtered: 0, total: 0 },
      columns: [{ key: "id", label: "ID" }, { label: "Name" }],
    };
    const { csv, parsed, json } = roundTrip(input);

    // CSV: no `# Filters:`, no `# Sort:`, no `# Page:` blocks appear.
    expect(csv).not.toMatch(/^# Filters:/m);
    expect(csv).not.toMatch(/^# Sort:/m);
    expect(csv).not.toMatch(/^# Page:/m);
    // `# Rows:` still appears because 0-counts are meaningful.
    expect(csv).toMatch(/^# Rows: 0 shown · 0 filtered · 0 total$/m);

    // Parse: matches CSV state exactly.
    expect(parsed.filters).toEqual({});
    expect(parsed.sort).toBeNull();
    expect(parsed.page).toBeNull();
    expect(parsed.counts).toEqual({ shown: 0, filtered: 0, total: 0 });

    // JSON: absent optional keys.
    assertEnvelopeShape(json);
    expect("filters" in json).toBe(false);
    expect("sort" in json).toBe(false);
    expect("page" in json).toBe(false);
    // `counts` IS present with all three buckets — zeros are meaningful.
    expect(json.counts).toEqual({ shown: 0, filtered: 0, total: 0 });
    // Column keys stayed aligned across CSV parse and JSON envelope.
    expect(json.columns!.map((c) => c.key)).toEqual(parsed.columns!.map((c) => c.key));
  });

  it("special characters in labels survive round-trip; JSON preserves declared column order", () => {
    // Labels intentionally cover: emoji, non-BMP, combining mark, tab
    // (rendered as-is by the writer but harmless in `# Columns` which
    // is line-oriented), and unicode punctuation.
    const labels = [
      "Amount 💰 (USD)",
      "\uD83D\uDCC8 Trend", // 📈 as an explicit surrogate pair
      "Cafe\u0301", // é via combining acute
      "Δ Change",
      "Notes — free form",
    ];
    const input: CsvMetadataInput = {
      source: "Special-char labels",
      generatedAt: FIXED_DATE,
      columns: labels.map((label) => ({ label })),
    };
    const { parsed, json } = roundTrip(input);

    // Labels come back verbatim, in order.
    expect(parsed.columns!.map((c) => c.label)).toEqual(labels);
    // JSON envelope preserves the SAME order via `order: i` — this is
    // the contract downstream picker-state restore depends on.
    expect(json.columns!.map((c) => c.order)).toEqual([0, 1, 2, 3, 4]);
    expect(json.columns!.map((c) => c.label)).toEqual(labels);
    // CSV-parsed keys and JSON envelope keys are the SAME array.
    expect(json.columns!.map((c) => c.key)).toEqual(parsed.columns!.map((c) => c.key));
  });

  it("commas in filter values survive (pipe is the record separator, comma is legal)", () => {
    const input: CsvMetadataInput = {
      source: "Comma filters",
      generatedAt: FIXED_DATE,
      filters: {
        city: "Karachi, Lahore, Islamabad", // commas legal — parser splits on `|`
        client: 'Bob "Quoted" Co',
      },
    };
    const { parsed, json } = roundTrip(input);
    expect(parsed.filters).toEqual({
      city: "Karachi, Lahore, Islamabad",
      client: 'Bob "Quoted" Co',
    });
    // JSON envelope: filters present, alphabetically sorted (byte-stable).
    expect(json.filters).toEqual({
      city: "Karachi, Lahore, Islamabad",
      client: 'Bob "Quoted" Co',
    });
    expect(Object.keys(json.filters!)).toEqual(["city", "client"]);
  });

  it("filter values containing raw newlines or `|` are DROPPED silently (would corrupt wire format)", () => {
    const input: CsvMetadataInput = {
      source: "Hostile filters",
      generatedAt: FIXED_DATE,
      filters: {
        clean: "ok",
        withPipe: "a|b", // dropped — `|` is the record separator
        withNewline: "line1\nline2", // dropped — metadata is line-oriented
        withCR: "row1\rrow2", // dropped — same reason
      },
    };
    const { parsed, json } = roundTrip(input);
    expect(parsed.filters).toEqual({ clean: "ok" });
    expect(json.filters).toEqual({ clean: "ok" });
    // The envelope must not contain the dropped keys.
    expect(Object.keys(json.filters!)).toEqual(["clean"]);
  });

  it("null / undefined / whitespace / sentinel optional fields are all dropped (never serialised as literals)", () => {
    // Every filter here uses one of the writer's DROPPED shapes.
    const input: CsvMetadataInput = {
      source: "Nullish filters",
      generatedAt: FIXED_DATE,
      filters: {
        nullValue: null,
        undefinedValue: undefined,
        emptyString: "",
        whitespace: "   ",
        sentinelAll: "all",
        sentinelAny: "any",
        sentinelNull: "null",
        sentinelUndefined: "undefined",
        real: "keep me",
      },
      // Extra sort/page shapes that should be OMITTED, not empty-serialised.
      sort: null,
      page: null,
      counts: null,
    };
    const { csv, parsed, json } = roundTrip(input);

    // Only the real filter survives.
    expect(parsed.filters).toEqual({ real: "keep me" });
    // Sort/Page/Rows blocks were never emitted — parser sees nothing.
    expect(csv).not.toMatch(/^# Sort:/m);
    expect(csv).not.toMatch(/^# Page:/m);
    expect(csv).not.toMatch(/^# Rows:/m);
    expect(parsed.sort).toBeNull();
    expect(parsed.page).toBeNull();
    expect(parsed.counts).toBeNull();
    // Filters block WAS emitted (one real key survived).
    expect(csv).toMatch(/^# Filters: real=keep me$/m);
    // Filters do NOT contain the literal string "null" / "undefined" —
    // this is the canonical regression this test guards.
    expect(csv).not.toMatch(/=null\b/);
    expect(csv).not.toMatch(/=undefined\b/);

    // JSON envelope: only the real filter survived, other optional keys
    // are ABSENT (not present with a null value).
    assertEnvelopeShape(json);
    expect(json.filters).toEqual({ real: "keep me" });
    expect("sort" in json).toBe(false);
    expect("page" in json).toBe(false);
    expect("counts" in json).toBe(false);
  });

  it("filters and extras are alphabetically sorted in the JSON envelope regardless of insertion order", () => {
    const input: CsvMetadataInput = {
      source: "Sort order",
      generatedAt: FIXED_DATE,
      // Insertion order is intentionally reverse-alphabetical so any
      // caller-order preservation would fail the assertion.
      filters: { zebra: "z", mango: "m", apple: "a" },
      extra: { zeta: "Z", mu: "M", alpha: "A" },
    };
    const { json } = roundTrip(input);
    // Byte-stable ordering — critical for content-hash-based caching
    // and diffing exports across runs.
    expect(Object.keys(json.filters!)).toEqual(["apple", "mango", "zebra"]);
    expect(Object.keys(json.extra!)).toEqual(["alpha", "mu", "zeta"]);
  });

  it("partial counts (only 'shown') round-trip correctly and omit the other buckets", () => {
    const input: CsvMetadataInput = {
      source: "Partial counts",
      generatedAt: FIXED_DATE,
      counts: { shown: 42 }, // no filtered / total supplied
    };
    const { csv, parsed, json } = roundTrip(input);
    expect(csv).toMatch(/^# Rows: 42 shown$/m);
    expect(parsed.counts).toEqual({ shown: 42 });
    expect(json.counts).toEqual({ shown: 42 });
    // Missing buckets are ABSENT, not `undefined` — asserts the writer
    // doesn't emit `{ shown: 42, filtered: undefined, total: undefined }`.
    expect(Object.keys(json.counts!)).toEqual(["shown"]);
  });

  it("CSV parsed column order and JSON envelope column order stay identical under label collisions", () => {
    // Every collision shape in one input: explicit key first, derived
    // slug collision second, punctuation-only label third, duplicate
    // label fourth.
    const columns = [
      { key: "amount", label: "Amount (canonical)" },
      { label: "Amount" }, // → "amount_2"
      { label: "!!!" }, // → "column"
      { label: "Amount" }, // → "amount_3"
    ];
    const input: CsvMetadataInput = {
      source: "Collision ordering",
      generatedAt: FIXED_DATE,
      columns,
    };
    const { parsed, json } = roundTrip(input);
    const expectedKeys = withDerivedColumnKeys(columns).map((c) => c.key);
    // CSV parse order.
    expect(parsed.columns!.map((c) => c.key)).toEqual(expectedKeys);
    expect(parsed.columns!.map((c) => c.label)).toEqual(columns.map((c) => c.label));
    // JSON envelope order — `order` field is 0..n and matches the
    // caller's declaration index.
    expect(json.columns!.map((c) => c.order)).toEqual([0, 1, 2, 3]);
    expect(json.columns!.map((c) => c.key)).toEqual(expectedKeys);
    expect(json.columns!.map((c) => c.label)).toEqual(columns.map((c) => c.label));
    // Cross-check: parsed CSV and JSON envelope agree row-for-row.
    for (let i = 0; i < expectedKeys.length; i++) {
      expect(parsed.columns![i].key).toBe(json.columns![i].key);
      expect(parsed.columns![i].label).toBe(json.columns![i].label);
    }
  });
});
