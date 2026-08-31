/**
 * Large-scale fuzz + perf for the derived-key deduper across BOTH
 * exporters.
 *
 * The existing fuzz suite (`csvExportMetadataFuzz`) caps generated
 * column lists at 30 entries — that's enough to explore collision
 * SHAPES but doesn't stress the walker at scale. This suite generates
 * 100–500 columns per case with the same adversarial biases
 * (label duplicates, explicit-key survivors, deliberate `_N` shapes
 * that race the deduper), and asserts on every case:
 *
 *   1. **Determinism** — running the CSV exporter twice on the same
 *      input produces byte-identical key sequences.
 *   2. **CSV ↔ JSON parity** — CSV `# Column keys` list equals the JSON
 *      envelope's `columns[].key` list, in the same order.
 *   3. **Order preservation** — output length equals input length,
 *      JSON `order` is contiguous 0..N-1, keys align to input indices.
 *   4. **Uniqueness** — every derived key is unique across the full list.
 *   5. **Explicit-key survival** — every distinct explicit key appears
 *      verbatim somewhere in the output.
 *   6. **Perf ceiling** — CSV + JSON build together stay under a
 *      generous per-case budget so an accidental O(n²) regression in
 *      the collision walker fails loudly instead of silently slowing
 *      CI down.
 *
 * Runs scale with `FC_RUNS_MULTIPLIER` via `propRuns()`; base counts
 * are lower than the small-fuzz suite because each case is 10-20×
 * bigger.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { propRuns } from "./_helpers/propRuns";
import {
  buildCsvMetadataHeader,
  buildJsonExportMetadata,
  type CsvMetadataInput,
} from "../csvExportMetadata";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");
// Generous per-case ceiling: CSV + JSON build together locally
// ~5–15 ms even at 500 columns. 300 ms = ~20× headroom for CI jitter.
const PER_CASE_BUDGET_MS = 300;

// ---- Arbitraries (bias toward collisions) --------------------------

const labelArb = fc
  .tuple(
    fc.string({ unit: fc.constantFrom(" ", "!", "?", "—", ".", "$", "#"), maxLength: 3 }),
    fc.stringMatching(/^[A-Za-z0-9 ]{1,10}$/),
    fc.string({ unit: fc.constantFrom(" ", "!", "?", "…", "€", "✓"), maxLength: 3 }),
  )
  .map(([a, mid, z]) => `${a}${mid}${z}`)
  .filter((s) => /[A-Za-z0-9]/.test(s));

const explicitKeyArb = fc.oneof(
  fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/),
  fc
    .tuple(fc.stringMatching(/^[a-z]{1,6}$/), fc.integer({ min: 2, max: 6 }))
    .map(([base, n]) => `${base}_${n}`),
);

/**
 * Column arbitrary: heavily reuses a small "collision family" of
 * explicit keys (`amount`, `col`, `value`, `amount_2`, `col_2`) so
 * derived-vs-explicit races are common, not rare, at scale.
 */
const columnArb = fc.oneof(
  labelArb.map((label) => ({ label })),
  fc.record({ key: explicitKeyArb, label: labelArb }),
  fc
    .tuple(fc.constantFrom("amount", "amount_2", "amount_3", "col", "col_2", "value"), labelArb)
    .map(([key, label]) => ({ key, label })),
  // A recurring set of duplicate labels — the walker's worst case.
  fc.constantFrom(
    { label: "Amount" },
    { label: "Amount" },
    { label: "!!!" },
    { label: "Unicode ✓" },
    { label: "Notes" },
  ),
);

const largeColumnsArb = fc.array(columnArb, { minLength: 100, maxLength: 500 });

// ---- Extract keys via each exporter --------------------------------

function csvKeys(columns: CsvMetadataInput["columns"]): string[] {
  const line = buildCsvMetadataHeader({
    source: "Large fuzz",
    generatedAt: FIXED_DATE,
    columns,
  }).find((l) => l.startsWith("# Column keys:"));
  if (!line) return [];
  return line.replace("# Column keys: ", "").split(",");
}

function jsonEnvelopeColumns(
  columns: CsvMetadataInput["columns"],
): Array<{ order: number; key: string; label: string }> {
  const meta = buildJsonExportMetadata({
    source: "Large fuzz",
    generatedAt: FIXED_DATE,
    columns,
  });
  return (meta.columns as Array<{ order: number; key: string; label: string }>) ?? [];
}

function explicitKeysOf(cols: ReadonlyArray<unknown>): string[] {
  return cols
    .map((c) =>
      c && typeof c === "object" && "key" in (c as object)
        ? String((c as { key: unknown }).key)
        : null,
    )
    .filter((k): k is string => typeof k === "string" && k.length > 0);
}

// ---- Suite ---------------------------------------------------------

describe("csvExportMetadata — large-scale fuzz (100–500 columns)", () => {
  it("CSV and JSON produce byte-identical key sequences in the same order", () => {
    fc.assert(
      fc.property(largeColumnsArb, (cols) => {
        const fromCsv = csvKeys(cols);
        const fromJson = jsonEnvelopeColumns(cols).map((c) => c.key);
        expect(fromCsv).toEqual(fromJson);
        expect(fromCsv).toHaveLength(cols.length);
      }),
      { numRuns: propRuns(30) },
    );
  });

  it("determinism: three repeat builds return byte-identical keys AND labels", () => {
    fc.assert(
      fc.property(largeColumnsArb, (cols) => {
        const a = jsonEnvelopeColumns(cols);
        const b = jsonEnvelopeColumns(cols);
        const c = jsonEnvelopeColumns(cols);
        expect(a).toEqual(b);
        expect(b).toEqual(c);
        // And the CSV writer agrees across repeats too.
        expect(csvKeys(cols)).toEqual(csvKeys(cols));
      }),
      { numRuns: propRuns(30) },
    );
  });

  it("ordering: `order` is contiguous 0..N-1 and every key is unique", () => {
    fc.assert(
      fc.property(largeColumnsArb, (cols) => {
        const envelope = jsonEnvelopeColumns(cols);
        expect(envelope).toHaveLength(cols.length);
        for (let i = 0; i < envelope.length; i++) {
          expect(envelope[i].order).toBe(i);
          expect(envelope[i].key.length).toBeGreaterThan(0);
        }
        expect(new Set(envelope.map((c) => c.key)).size).toBe(envelope.length);
      }),
      { numRuns: propRuns(30) },
    );
  });

  it("explicit keys survive verbatim at scale (distinct-values contract)", () => {
    fc.assert(
      fc.property(largeColumnsArb, (cols) => {
        const keys = csvKeys(cols);
        for (const e of new Set(explicitKeysOf(cols))) {
          expect(keys).toContain(e);
        }
      }),
      { numRuns: propRuns(30) },
    );
  });

  it("perf: CSV + JSON build together stays under the per-case budget", () => {
    // Track the WORST-case runtime across the whole fast-check run so
    // the final assertion pinpoints the single pathological case if a
    // regression lands. Fast-check shrinks failing counterexamples,
    // so the reported case is minimal-ish.
    let worstMs = 0;
    let worstLen = 0;
    fc.assert(
      fc.property(largeColumnsArb, (cols) => {
        const start = performance.now();
        buildCsvMetadataHeader({ source: "Perf", generatedAt: FIXED_DATE, columns: cols });
        buildJsonExportMetadata({ source: "Perf", generatedAt: FIXED_DATE, columns: cols });
        const ms = performance.now() - start;
        if (ms > worstMs) {
          worstMs = ms;
          worstLen = cols.length;
        }
        // In-property assertion so the failing shrinker converges on a
        // small counterexample instead of a 500-column blob.
        expect(ms).toBeLessThan(PER_CASE_BUDGET_MS);
      }),
      { numRuns: propRuns(30) },
    );
    // Sanity — the whole run should have exercised something meaningful.
    expect(worstLen).toBeGreaterThanOrEqual(100);
    if (process.env.CI_PERF_LOG) {
      // Opt-in perf logging only — keeps CI logs clean by default.

      console.log(`[perf] worst case: ${worstMs.toFixed(1)}ms at ${worstLen} cols`);
    }
  });
});
