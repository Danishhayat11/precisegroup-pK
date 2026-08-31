/**
 * Randomized fuzz tests for the CSV export envelope's filter/sort/page/
 * counts metadata block. Complements `csvExportMetadataFuzz` (which
 * focuses on column-key collisions) by throwing random filters/sort/
 * pagination/counts payloads at the writer + parser and asserting that
 * every field round-trips exactly through:
 *
 *   input → buildCsvMetadataHeader → parseCsvMetadataHeader → parsed
 *   input → buildJsonExportMetadata → JSON.stringify → JSON.parse → meta
 *
 * AND that explicit `{ key }` collisions on the same run still resolve
 * deterministically (the CSV `# Column keys:` line, the parsed
 * `columns[].key`, and the JSON envelope's `columns[].key` all agree,
 * and every explicit key survives verbatim).
 *
 * Auto-replay + seed capture is handled by `assertProperty` so any CI
 * failure is reproducible from the stored fast-check seed.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { propRuns } from "./_helpers/propRuns";
import { assertProperty } from "./support/fuzzReporter";
import {
  buildCsvMetadataHeader,
  buildJsonExportMetadata,
  type CsvMetadataInput,
} from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

/**
 * Compose a parseable CSV buffer from a metadata header + a stub body.
 * The parser only cares about the `#` lines, but it needs a blank
 * separator and at least a header row to compute `bodyStartIndex`.
 */
function toParseableCsv(headerLines: string[]): string {
  return `${headerLines.join("\n")}\n\nid\n1\n`;
}

// -------- Arbitraries --------

/**
 * Filter keys / values must survive the writer's sanitiser
 * (FILTER_KEY_BAD = /[\r\n|=:]/, FILTER_VALUE_BAD = /[\r\n|]/), so we
 * generate only strings that PASS the sanitiser. Anything the writer
 * would silently drop is out of scope for a round-trip test — that
 * behaviour is covered by `csvExportMetadataFuzz` and dedicated
 * sanitiser unit tests.
 */
const filterKeyArb = fc
  .stringMatching(/^[A-Za-z][A-Za-z0-9 _.-]{0,15}$/)
  .filter((s) => s.trim().length > 0);
const filterValueArb = fc
  .stringMatching(/^[A-Za-z0-9 _.,;:\-@#]{1,20}$/)
  .filter((s) => s.trim().length > 0 && !/[\r\n|]/.test(s));

const filtersArb = fc
  .dictionary(filterKeyArb, filterValueArb, { minKeys: 0, maxKeys: 6 })
  // Drop keys the sanitiser would strip so the round-trip expectation
  // stays byte-exact. `filterKeyArb` already excludes bad chars, but
  // dictionary keys are trimmed by the writer — enforce here too.
  // Writer emits values verbatim; parser trims. To keep the round-trip
  // byte-exact, trim both keys and values here and require non-empty
  // post-trim strings. Whitespace-lossy shapes are exercised by the
  // dedicated sanitiser tests.
  .map((d) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(d)) {
      const tk = k.trim();
      const tv = v.trim();
      if (tk && tv) out[tk] = tv;
    }
    return out;
  });

const sortArb = fc.option(
  fc.record({
    key: fc.stringMatching(/^[a-z][a-z0-9_]{0,12}$/),
    dir: fc.constantFrom("asc" as const, "desc" as const),
  }),
  { nil: null, freq: 3 },
);

const pageArb = fc.option(
  fc
    .tuple(
      fc.integer({ min: 1, max: 999 }),
      fc.integer({ min: 1, max: 999 }),
      fc.integer({ min: 1, max: 10_000 }),
    )
    .map(([page, extra, pageSize]) => ({
      page,
      totalPages: page + extra - 1, // guarantees totalPages >= page
      pageSize,
    })),
  { nil: null, freq: 3 },
);

const countsArb = fc.option(
  fc
    .record({
      shown: fc.option(fc.nat({ max: 100_000 }), { nil: undefined, freq: 4 }),
      filtered: fc.option(fc.nat({ max: 1_000_000 }), { nil: undefined, freq: 4 }),
      total: fc.option(fc.nat({ max: 10_000_000 }), { nil: undefined, freq: 4 }),
    })
    .filter((c) => c.shown !== undefined || c.filtered !== undefined || c.total !== undefined),
  { nil: null, freq: 3 },
);

// Columns arbitrary designed to force explicit-vs-derived collisions
// on the SAME run that carries filter/sort/page/counts payloads.
const labelArb = fc
  .stringMatching(/^[A-Za-z0-9 !?._-]{1,12}$/)
  .filter((s) => /[A-Za-z0-9]/.test(s));

const columnArb = fc.oneof(
  labelArb.map((label) => ({ label })),
  fc
    .tuple(fc.constantFrom("amount", "amount_2", "col", "col_2", "value", "value_3"), labelArb)
    .map(([key, label]) => ({ key, label })),
);

const columnsArb = fc.array(columnArb, { minLength: 1, maxLength: 10 });

const envelopeArb = fc.record({
  filters: filtersArb,
  sort: sortArb,
  page: pageArb,
  counts: countsArb,
  columns: columnsArb,
});

type Envelope = {
  filters: Record<string, string>;
  sort: { key: string; dir: "asc" | "desc" } | null;
  page: { page: number; totalPages: number; pageSize: number } | null;
  counts: { shown?: number; filtered?: number; total?: number } | null;
  columns: CsvMetadataInput["columns"];
};

function buildInput(env: Envelope): CsvMetadataInput {
  return {
    source: "Fuzz Envelope",
    generatedAt: FIXED_DATE,
    filters: env.filters,
    sort: env.sort ?? undefined,
    page: env.page ?? undefined,
    counts: env.counts ?? undefined,
    columns: env.columns,
  };
}

function explicitKeysOf(cols: CsvMetadataInput["columns"]): string[] {
  return (cols ?? [])
    .map((c) =>
      c && typeof c === "object" && "key" in c ? String((c as { key: unknown }).key) : null,
    )
    .filter((k): k is string => typeof k === "string" && k.length > 0);
}

describe("csvExportMetadata — filter/sort/page/counts round-trip fuzz", () => {
  it("filters round-trip exactly through the CSV parser", () => {
    assertProperty(
      "csvExportFilterSortPageCountsFuzz/filters",
      fc.property(envelopeArb, (env) => {
        const input = buildInput(env);
        const parsed = parseCsvMetadataHeader(toParseableCsv(buildCsvMetadataHeader(input)));
        expect(parsed.filters).toEqual(env.filters);
      }),
      { numRuns: propRuns(200) },
    );
  });

  it("sort / page / counts round-trip exactly through the CSV parser", () => {
    assertProperty(
      "csvExportFilterSortPageCountsFuzz/sort-page-counts",
      fc.property(envelopeArb, (env) => {
        const input = buildInput(env);
        const parsed = parseCsvMetadataHeader(toParseableCsv(buildCsvMetadataHeader(input)));
        expect(parsed.sort).toEqual(env.sort);
        expect(parsed.page).toEqual(env.page);
        expect(parsed.counts).toEqual(env.counts);
      }),
      { numRuns: propRuns(200) },
    );
  });

  it("JSON envelope carries the same filter/sort/page/counts payload", () => {
    assertProperty(
      "csvExportFilterSortPageCountsFuzz/json-parity",
      fc.property(envelopeArb, (env) => {
        const input = buildInput(env);
        const meta = JSON.parse(JSON.stringify(buildJsonExportMetadata(input))) as {
          filters?: Record<string, string>;
          sort?: { key: string; dir: string };
          page?: { page: number; totalPages: number; pageSize: number };
          counts?: { shown?: number; filtered?: number; total?: number };
        };
        // Filters: absent when the input map is empty (writer drops the key
        // rather than emitting `filters: {}`). Match that shape.
        if (Object.keys(env.filters).length === 0) {
          expect(meta.filters).toBeUndefined();
        } else {
          expect(meta.filters).toEqual(env.filters);
        }
        expect(meta.sort ?? null).toEqual(env.sort);
        expect(meta.page ?? null).toEqual(env.page);
        expect(meta.counts ?? null).toEqual(env.counts);
      }),
      { numRuns: propRuns(200) },
    );
  });

  it("explicit {key} collisions still resolve deterministically alongside the envelope payload", () => {
    assertProperty(
      "csvExportFilterSortPageCountsFuzz/explicit-key-collisions",
      fc.property(envelopeArb, (env) => {
        const input = buildInput(env);
        const parsed = parseCsvMetadataHeader(toParseableCsv(buildCsvMetadataHeader(input)));
        const jsonMeta = buildJsonExportMetadata(input) as {
          columns?: Array<{ key: string; label: string; order: number }>;
        };

        const parsedKeys = (parsed.columns ?? []).map((c) => c.key);
        const jsonKeys = (jsonMeta.columns ?? []).map((c) => c.key);

        // Structural invariants: same length as input, unique, non-empty,
        // and CSV + JSON agree byte-for-byte.
        expect(parsedKeys).toHaveLength(env.columns.length);
        expect(jsonKeys).toEqual(parsedKeys);
        expect(new Set(parsedKeys).size).toBe(parsedKeys.length);
        for (const k of parsedKeys) expect(k.length).toBeGreaterThan(0);

        // Every explicit key the caller supplied survives verbatim
        // somewhere in the output, regardless of filter/sort/page noise.
        for (const explicit of new Set(explicitKeysOf(env.columns))) {
          expect(parsedKeys).toContain(explicit);
        }

        // Determinism: rebuilding with the same input produces byte-identical keys.
        const parsedAgain = parseCsvMetadataHeader(toParseableCsv(buildCsvMetadataHeader(input)));
        expect((parsedAgain.columns ?? []).map((c) => c.key)).toEqual(parsedKeys);
      }),
      { numRuns: propRuns(200) },
    );
  });
});
