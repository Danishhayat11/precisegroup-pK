/**
 * Randomized fuzz tests for `withDerivedColumnKeys` (via the CSV & JSON
 * exporters). These complement the property tests by throwing large,
 * heavily-adversarial mixes at the deduper — unicode, punctuation,
 * whitespace-heavy labels, explicit keys that DELIBERATELY collide with
 * derived-suffix targets (`amount_2`, `col_3`, etc.), and long chains
 * of slug-colliding siblings.
 *
 * Invariants asserted on every generated case:
 *   1. Every emitted key is non-empty.
 *   2. Every emitted key is unique.
 *   3. The output length equals the input length (no columns dropped).
 *   4. Every explicit `{ key }` appears verbatim in the output.
 *   5. Output is stable — running the exporter twice on the same input
 *      yields byte-identical key sequences.
 *   6. CSV and JSON exporters emit the identical key sequence.
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

function csvKeys(columns: CsvMetadataInput["columns"]): string[] {
  const line = buildCsvMetadataHeader({
    source: "Fuzz",
    generatedAt: FIXED_DATE,
    columns,
  }).find((l) => l.startsWith("# Column keys:"));
  if (!line) return [];
  return line.replace("# Column keys: ", "").split(",");
}

function jsonKeys(columns: CsvMetadataInput["columns"]): string[] {
  const meta = buildJsonExportMetadata({
    source: "Fuzz",
    generatedAt: FIXED_DATE,
    columns,
  });
  const cols = (meta.columns as Array<{ key: string }> | undefined) ?? [];
  return cols.map((c) => c.key);
}

/**
 * Non-empty label arbitrary. Guarantees at least one alphanumeric so
 * `slugifyColumnKey` never falls all the way through to the `column`
 * default (that path has dedicated coverage elsewhere). Includes
 * unicode, punctuation, whitespace, and mixed case — everything a
 * real UI could produce.
 */
const labelArb = fc
  .tuple(
    fc.string({ unit: fc.constantFrom(" ", "!", "?", "—", ".", "$", "#"), maxLength: 3 }),
    fc.stringMatching(/^[A-Za-z0-9 ]{1,10}$/),
    fc.string({ unit: fc.constantFrom(" ", "!", "?", "…", "€"), maxLength: 3 }),
  )
  .map(([a, mid, z]) => `${a}${mid}${z}`)
  .filter((s) => /[A-Za-z0-9]/.test(s));

/** Explicit-key arbitrary. Includes bare bases AND deliberate `_N`-suffix
 *  shapes that will race the deduper's derived suffixes. */
const explicitKeyArb = fc.oneof(
  fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/),
  fc
    .tuple(fc.stringMatching(/^[a-z]{1,6}$/), fc.integer({ min: 2, max: 6 }))
    .map(([base, n]) => `${base}_${n}`),
);

/** Column arbitrary: either label-only or explicit-key + label. Explicit
 *  keys often reuse the same small base pool ("amount", "col", "value")
 *  so collisions are common, not rare. */
const columnArb = fc.oneof(
  labelArb.map((label) => ({ label })),
  fc.record({ key: explicitKeyArb, label: labelArb }),
  // Bias generator: heavily reuse the "amount" family to force the
  // adversarial derived-vs-explicit collisions this suite is here for.
  fc
    .tuple(fc.constantFrom("amount", "amount_2", "amount_3", "col", "col_2"), labelArb)
    .map(([key, label]) => ({ key, label })),
);

const columnsArb = fc.array(columnArb, { minLength: 1, maxLength: 30 });

function explicitKeysOf(cols: ReadonlyArray<unknown>): string[] {
  return cols
    .map((c) =>
      c && typeof c === "object" && "key" in (c as object)
        ? String((c as { key: unknown }).key)
        : null,
    )
    .filter((k): k is string => typeof k === "string" && k.length > 0);
}

describe("csvExportMetadata — randomized fuzz", () => {
  it("keys are always non-empty, unique, and preserve column count", () => {
    fc.assert(
      fc.property(columnsArb, (cols) => {
        const keys = csvKeys(cols);
        expect(keys).toHaveLength(cols.length);
        for (const k of keys) expect(k.length).toBeGreaterThan(0);
        expect(new Set(keys).size).toBe(keys.length);
      }),
      { numRuns: propRuns(300) },
    );
  });

  it("every explicit key survives verbatim somewhere in the output", () => {
    fc.assert(
      fc.property(columnsArb, (cols) => {
        const keys = csvKeys(cols);
        const explicits = explicitKeysOf(cols);
        // De-dup explicit keys: if the caller supplied the same explicit
        // key twice, only the first instance can survive verbatim — the
        // second must be bumped. So we count distinct explicit values
        // and assert each appears at least once.
        for (const e of new Set(explicits)) {
          expect(keys).toContain(e);
        }
      }),
      { numRuns: propRuns(300) },
    );
  });

  it("output is stable — same input produces byte-identical key sequences", () => {
    fc.assert(
      fc.property(columnsArb, (cols) => {
        const a = csvKeys(cols);
        const b = csvKeys(cols);
        const c = csvKeys(cols);
        expect(a).toEqual(b);
        expect(b).toEqual(c);
      }),
      { numRuns: propRuns(200) },
    );
  });

  it("CSV and JSON exporters emit the identical key sequence", () => {
    fc.assert(
      fc.property(columnsArb, (cols) => {
        expect(csvKeys(cols)).toEqual(jsonKeys(cols));
      }),
      { numRuns: propRuns(300) },
    );
  });

  it("shuffling the input order never introduces duplicate keys", () => {
    // Order changes the emitted keys (dedup is left-to-right), but
    // uniqueness must hold under every permutation the fuzzer picks.
    fc.assert(
      fc.property(
        columnsArb.chain((cols) =>
          fc
            .shuffledSubarray(cols, { minLength: cols.length, maxLength: cols.length })
            .map((shuffled) => shuffled),
        ),
        (shuffled) => {
          const keys = csvKeys(shuffled);
          expect(new Set(keys).size).toBe(keys.length);
        },
      ),
      { numRuns: propRuns(300) },
    );
  });

  it("adversarial dense collisions on 'amount' still produce a unique key per column", () => {
    // Forced pathological case: N label-only Amount siblings interleaved
    // with explicit `amount_K` keys. The deduper must never emit a
    // duplicate, no matter how the collisions stack.
    const denseArb = fc.array(
      fc.oneof(
        fc.constant({ label: "Amount" }),
        fc.constant({ label: "amount!" }),
        fc.constant({ label: "  amount  " }),
        fc.integer({ min: 2, max: 8 }).map((n) => ({ key: `amount_${n}`, label: `Legacy ${n}` })),
      ),
      { minLength: 5, maxLength: 25 },
    );
    fc.assert(
      fc.property(denseArb, (cols) => {
        const keys = csvKeys(cols);
        expect(keys).toHaveLength(cols.length);
        expect(new Set(keys).size).toBe(keys.length);
        for (const k of keys) expect(k).toMatch(/^amount(_\d+)+$|^amount$/);
        // And every explicit `amount_N` must survive verbatim.
        for (const e of new Set(explicitKeysOf(cols))) {
          expect(keys).toContain(e);
        }
      }),
      { numRuns: propRuns(200) },
    );
  });
});
