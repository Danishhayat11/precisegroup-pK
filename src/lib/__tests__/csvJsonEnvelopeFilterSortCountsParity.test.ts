/**
 * Cross-format parity for the metadata dimensions that describe the
 * *query state* behind an export — filters, sort, page, counts — not
 * just the column set. Existing suites already assert dedup/suffix
 * parity for columns (csvJsonExporterParity) and one-shot equivalence
 * across a handful of shapes (csvJsonMetadataEquivalence). This file
 * exhaustively pairs realistic combinations of filters × sort × counts
 * × page × columns and asserts the FULL serialized envelope structure
 * matches between the CSV metadata block (parsed back) and the JSON
 * envelope. Each scenario is exercised through the on-disk boundary
 * (build CSV → parse CSV → compare to JSON envelope) so any silent
 * drift in a single writer is caught immediately.
 *
 * Coverage grid:
 *   - Filters: none, single, multi-key, values with `=`, sentinel-only
 *     (drops), mixed sentinel+real, boolean/number stringification
 *   - Sort:    none, asc, desc, key with unicode
 *   - Counts:  none, all buckets, shown-only, shown+total, edge zeros,
 *     large numbers, and non-integer/negative values that must drop
 *   - Page:    none, first/mid/last, single-page dataset
 *   - Columns: none, plain, colliding labels (parity for derived keys)
 *
 * Every scenario is also run twice with the SAME semantic input but
 * different Object insertion orders for `filters` / `extra` — the
 * JSON envelope sorts these alphabetically for byte-stability, and
 * the parsed CSV compares by unordered key/value maps, so both must
 * yield the same parity result regardless of caller insertion order.
 */
import { describe, it, expect } from "vitest";
import {
  prefixCsvWithMetadata,
  buildJsonExportMetadata,
  JSON_ENVELOPE_SCHEMA,
  JSON_ENVELOPE_VERSION,
  type CsvMetadataInput,
} from "../csvExportMetadata";
import { parseCsvMetadataHeader, type ParsedCsvMetadata } from "../csvMetadataParser";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

/** Trim + stringify a value map so CSV (always strings) matches JSON. */
function trimValues(m: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m ?? {})) {
    if (v === null || v === undefined) continue;
    out[k] = String(v).trim();
  }
  return out;
}

function csvRoundTrip(input: CsvMetadataInput): ParsedCsvMetadata {
  const csv = prefixCsvWithMetadata("h\r\nv\r\n", input);
  return parseCsvMetadataHeader(csv);
}

function jsonEnvelope(input: CsvMetadataInput): {
  meta: Record<string, unknown>;
  columnsNoOrder: Array<{ key: string; label: string }> | null;
} {
  const meta = buildJsonExportMetadata(input) as Record<string, unknown> & {
    columns?: Array<{ order: number; key: string; label: string }>;
  };
  const columnsNoOrder = meta.columns?.map(({ key, label }) => ({ key, label })) ?? null;
  return { meta, columnsNoOrder };
}

/**
 * Full-envelope parity assertion: every serialised dimension the CSV
 * carries must be recoverable identically from the JSON envelope.
 * Versioning fields (`schema`, `version`) are asserted separately —
 * they only live in JSON — and columns are compared without `order`
 * because the CSV parser reconstructs order positionally.
 */
function assertFullParity(input: CsvMetadataInput) {
  const parsed = csvRoundTrip(input);
  const { meta, columnsNoOrder } = jsonEnvelope(input);

  // Versioning — JSON only. Assert present & correct so a bump in
  // JSON_ENVELOPE_VERSION forces this suite to be updated.
  expect(meta.schema).toBe(JSON_ENVELOPE_SCHEMA);
  expect(meta.version).toBe(JSON_ENVELOPE_VERSION);

  // Source — byte-identical after trim.
  expect(meta.source).toBe(parsed.source);

  // generatedAt — both must be present (formats differ by design).
  expect(parsed.generatedAt).toBeTruthy();
  expect(typeof meta.generatedAt).toBe("string");
  expect((meta.generatedAt as string).length).toBeGreaterThan(0);

  // extra + filters — trimmed-value maps must be equal SETS (JSON
  // sorts alphabetically, CSV preserves insertion; assertEqual on
  // plain objects ignores property order in vitest).
  expect(trimValues(meta.extra as Record<string, unknown> | undefined)).toEqual(
    trimValues(parsed.extra),
  );
  expect(trimValues(meta.filters as Record<string, unknown> | undefined)).toEqual(
    trimValues(parsed.filters),
  );

  // sort / page / counts — deep-equal (null when absent on either side).
  expect(meta.sort ?? null).toEqual(parsed.sort);
  expect(meta.page ?? null).toEqual(parsed.page);
  expect(meta.counts ?? null).toEqual(parsed.counts);

  // columns — ORDERED, key + label. Both may be null when the input
  // has no columns; the equivalence still holds.
  expect(columnsNoOrder).toEqual(parsed.columns);
}

interface Scenario {
  name: string;
  input: CsvMetadataInput;
}

/**
 * Return a semantically-identical clone with `filters` and `extra`
 * re-keyed in reverse insertion order — used to prove alphabetical
 * sorting inside the JSON envelope doesn't perturb parity.
 */
function reorderMaps(input: CsvMetadataInput): CsvMetadataInput {
  const reverse = <T>(m: Record<string, T> | undefined): Record<string, T> | undefined => {
    if (!m) return m;
    const entries = Object.entries(m);
    return Object.fromEntries(entries.reverse());
  };
  return {
    ...input,
    filters: reverse(input.filters) as CsvMetadataInput["filters"],
    extra: reverse(input.extra) as CsvMetadataInput["extra"],
  };
}

const scenarios: Scenario[] = [
  {
    name: "no filters, no sort, no counts, no page, no columns",
    input: {
      source: "Bare Export",
      generatedAt: FIXED_DATE,
    },
  },
  {
    name: "single filter + asc sort + shown-only counts",
    input: {
      source: "Bookings — Active",
      generatedAt: FIXED_DATE,
      filters: { status: "active" },
      sort: { key: "sold_on", dir: "asc" },
      counts: { shown: 25 },
    },
  },
  {
    name: "multi-key filter + desc sort + full counts + first page",
    input: {
      source: "Bookings — Karachi Q3",
      generatedAt: FIXED_DATE,
      filters: { city: "Karachi", status: "active", owner: "alice" },
      sort: { key: "amount", dir: "desc" },
      counts: { shown: 50, filtered: 240, total: 1200 },
      page: { page: 1, totalPages: 5, pageSize: 50 },
    },
  },
  {
    name: "mid page + partial counts (shown + total, no filtered)",
    input: {
      source: "Ledger — Page 3",
      generatedAt: FIXED_DATE,
      counts: { shown: 25, total: 500 },
      page: { page: 3, totalPages: 20, pageSize: 25 },
      sort: { key: "created_at", dir: "desc" },
    },
  },
  {
    name: "last page (single-row remainder) + full counts",
    input: {
      source: "Ledger — Tail",
      generatedAt: FIXED_DATE,
      counts: { shown: 1, filtered: 501, total: 501 },
      page: { page: 21, totalPages: 21, pageSize: 25 },
    },
  },
  {
    name: "single-page dataset (page=1 of 1)",
    input: {
      source: "Tiny Dataset",
      generatedAt: FIXED_DATE,
      counts: { shown: 3, filtered: 3, total: 3 },
      page: { page: 1, totalPages: 1, pageSize: 25 },
    },
  },
  {
    name: "edge counts: all zeros (empty result set)",
    input: {
      source: "Empty Result",
      generatedAt: FIXED_DATE,
      filters: { status: "closed" },
      counts: { shown: 0, filtered: 0, total: 0 },
    },
  },
  {
    name: "large counts (millions) survive without truncation",
    input: {
      source: "Large Dataset",
      generatedAt: FIXED_DATE,
      counts: { shown: 100_000, filtered: 5_000_000, total: 12_345_678 },
    },
  },
  {
    name: "filter values with `=` inside — split-on-first-eq must hold",
    input: {
      source: "Equation Filter",
      generatedAt: FIXED_DATE,
      filters: { equation: "a=b+c", note: "x = y" },
      sort: { key: "equation", dir: "asc" },
    },
  },
  {
    name: "sentinel-only filters get dropped by BOTH formats",
    input: {
      source: "Sentinel Drop Only",
      generatedAt: FIXED_DATE,
      filters: { status: "all", owner: "", tag: null },
      counts: { shown: 100, total: 100 },
    },
  },
  {
    name: "mixed sentinel + real filters — only real ones survive",
    input: {
      source: "Sentinel Mixed",
      generatedAt: FIXED_DATE,
      filters: { status: "all", city: "Karachi", owner: "", tier: "gold" },
      sort: { key: "city", dir: "asc" },
    },
  },
  {
    name: "boolean + number filter values stringify identically",
    input: {
      source: "Type Coercion Filter",
      generatedAt: FIXED_DATE,
      filters: { active: true, priority: 3, archived: false },
    },
  },
  {
    name: "sort key with unicode + underscored key",
    input: {
      source: "Unicode Sort",
      generatedAt: FIXED_DATE,
      sort: { key: "客户_name", dir: "desc" },
    },
  },
  {
    name: "non-integer / negative counts are dropped by BOTH formats",
    input: {
      source: "Sanitised Counts",
      generatedAt: FIXED_DATE,
      counts: {
        shown: 25,
        filtered: -1 as unknown as number, // dropped
        total: 3.14 as unknown as number, // dropped
      },
    },
  },
  {
    name: "all counts invalid → counts collapse to null on both sides",
    input: {
      source: "All Bad Counts",
      generatedAt: FIXED_DATE,
      counts: {
        shown: -5 as unknown as number,
        filtered: Number.NaN as unknown as number,
        total: 1.5 as unknown as number,
      },
    },
  },
  {
    name: "filters + sort + counts + page + columns — everything at once",
    input: {
      source: "Full Snapshot",
      generatedAt: FIXED_DATE,
      extra: { Environment: "production", Build: "abc123" },
      filters: { status: "active", city: "Karachi", tier: "gold" },
      sort: { key: "amount", dir: "desc" },
      counts: { shown: 50, filtered: 240, total: 1200 },
      page: { page: 2, totalPages: 5, pageSize: 50 },
      columns: [
        { key: "id", label: "ID" },
        { label: "Amount" },
        { label: "Amount" }, // collides → amount_2
        { label: "Sold Date" },
      ],
    },
  },
  {
    name: "full snapshot with colliding label-only columns (parity across derivation)",
    input: {
      source: "Colliding Columns + Query State",
      generatedAt: FIXED_DATE,
      filters: { currency: "PKR" },
      sort: { key: "amount", dir: "desc" },
      counts: { shown: 3, total: 3 },
      columns: [{ label: "Amount" }, { label: "amount!" }, { label: "AMOUNT" }],
    },
  },
];

describe("CSV ↔ JSON envelope parity — filters, sorting, counts, page (complete structure)", () => {
  for (const { name, input } of scenarios) {
    it(`full envelope matches — ${name}`, () => {
      assertFullParity(input);
    });

    it(`insertion-order independent — ${name}`, () => {
      // Same semantic input, reversed insertion order on map fields.
      // JSON sorts alphabetically for byte stability; CSV preserves
      // insertion but is compared as an unordered map. Parity must
      // hold either way.
      assertFullParity(reorderMaps(input));
    });
  }

  it("null sort / null page inputs produce absent-or-null in both formats", () => {
    const input: CsvMetadataInput = {
      source: "Null Sort + Page",
      generatedAt: FIXED_DATE,
      sort: null,
      page: null,
      counts: { shown: 5 },
    };
    const parsed = csvRoundTrip(input);
    const { meta } = jsonEnvelope(input);
    expect(parsed.sort).toBeNull();
    expect(parsed.page).toBeNull();
    expect(meta.sort ?? null).toBeNull();
    expect(meta.page ?? null).toBeNull();
    assertFullParity(input);
  });

  it("versioning fields are present in JSON and stable across scenarios", () => {
    for (const { input } of scenarios) {
      const meta = buildJsonExportMetadata(input);
      expect(meta.schema).toBe(JSON_ENVELOPE_SCHEMA);
      expect(meta.version).toBe(JSON_ENVELOPE_VERSION);
      // Versioning fields lead the envelope for stable prefix parsing.
      const keys = Object.keys(meta);
      expect(keys[0]).toBe("schema");
      expect(keys[1]).toBe("version");
    }
  });

  it("cross-scenario: envelope field SETS are consistent per input shape", () => {
    // For every scenario, the set of JSON envelope keys must exactly
    // predict which CSV metadata dimensions parse back non-null. This
    // guards against a future writer emitting an extra JSON field
    // without a matching CSV line, or vice versa.
    for (const { name, input } of scenarios) {
      const parsed = csvRoundTrip(input);
      const { meta } = jsonEnvelope(input);
      const jsonHas = (k: string) => Object.prototype.hasOwnProperty.call(meta, k);
      // filters
      const jsonFilters = (meta.filters as Record<string, unknown> | undefined) ?? {};
      expect(
        Object.keys(jsonFilters).length > 0,
        `${name} — filters key presence must match parsed.filters`,
      ).toBe(Object.keys(parsed.filters).length > 0);
      // sort / page / counts / columns
      expect(jsonHas("sort"), `${name} — sort presence`).toBe(parsed.sort !== null);
      expect(jsonHas("page"), `${name} — page presence`).toBe(parsed.page !== null);
      expect(jsonHas("counts"), `${name} — counts presence`).toBe(parsed.counts !== null);
      expect(jsonHas("columns"), `${name} — columns presence`).toBe(parsed.columns !== null);
    }
  });
});
