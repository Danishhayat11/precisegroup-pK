import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { propRuns } from "./_helpers/propRuns";
import { buildCsvMetadataHeader, buildJsonExportMetadata } from "../csvExportMetadata";

/**
 * Property-based tests for the column-key derivation invariants in
 * `withDerivedColumnKeys` (exercised via `buildCsvMetadataHeader` /
 * `buildJsonExportMetadata`). Every generated case must hold ALL of:
 *
 *   1. Every emitted key is non-empty.
 *   2. Every emitted key is unique within the column list.
 *   3. An explicit `{ key }` always survives verbatim as SOME emitted key
 *      (siblings that would slugify to the same value get bumped instead).
 *   4. Chained siblings whose bases collide increment `_2`, `_3`, `_4`, …
 *      in declaration order — no gaps, no repeats.
 *   5. Both exporters (CSV metadata block and JSON envelope) emit the
 *      exact same key sequence for the same input.
 */

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

/**
 * Arbitrary matching the slugifier's stable-identity subset: no
 * underscores, no leading digits. Any label taken from this set
 * slugifies to itself, so we can predict bases without re-implementing
 * `slugifyColumnKey`.
 */
const asciiSlugFragment = fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/);

/** Read the emitted keys from the CSV metadata header. */
function csvKeys(columns: Parameters<typeof buildCsvMetadataHeader>[0]["columns"]): string[] {
  const line = buildCsvMetadataHeader({
    source: "X",
    generatedAt: FIXED_DATE,
    columns,
  }).find((l) => l.startsWith("# Column keys:"));
  if (!line) return [];
  return line.replace("# Column keys: ", "").split(",");
}

/** Read the emitted keys from the JSON envelope. */
function jsonKeys(columns: Parameters<typeof buildJsonExportMetadata>[0]["columns"]): string[] {
  const meta = buildJsonExportMetadata({
    source: "X",
    generatedAt: FIXED_DATE,
    columns,
  });
  const cols = (meta.columns as Array<{ key: string }> | undefined) ?? [];
  return cols.map((c) => c.key);
}

describe("csvExportMetadata — property-based key derivation", () => {
  it("every emitted key is non-empty and globally unique", () => {
    // Any mix of label-only and explicit-key columns, any size 1..12.
    const columnArb = fc.oneof(
      asciiSlugFragment.map((label) => ({ label })),
      fc
        .record({ key: asciiSlugFragment, label: asciiSlugFragment })
        .map((r) => ({ key: r.key, label: r.label })),
    );
    fc.assert(
      fc.property(fc.array(columnArb, { minLength: 1, maxLength: 12 }), (cols) => {
        const keys = csvKeys(cols);
        expect(keys).toHaveLength(cols.length);
        expect(keys.every((k) => k.length > 0)).toBe(true);
        expect(new Set(keys).size).toBe(keys.length);
      }),
      { numRuns: propRuns(200) },
    );
  });

  it("CSV and JSON exporters emit the exact same key sequence for the same input", () => {
    const columnArb = fc.oneof(
      asciiSlugFragment.map((label) => ({ label }) as { key?: string; label: string }),
      fc.record({ key: asciiSlugFragment, label: asciiSlugFragment }),
    );
    fc.assert(
      fc.property(fc.array(columnArb, { minLength: 1, maxLength: 10 }), (cols) => {
        expect(jsonKeys(cols)).toEqual(csvKeys(cols));
      }),
      { numRuns: propRuns(200) },
    );
  });

  it("every explicit {key} survives verbatim as one of the emitted keys", () => {
    // Build a scenario with N label-only siblings that all slugify to
    // the same base, PLUS one explicit key equal to that base placed at
    // a random index. The explicit key must always appear untouched in
    // the output — the label-only siblings are what shift.
    fc.assert(
      fc.property(
        asciiSlugFragment,
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 0, max: 5 }),
        (base, siblings, insertAt) => {
          const labelForm = base
            .split("")
            .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c))
            .join(""); // e.g. "amount" → "AmOuNt", still slugifies to `base`.
          const cols: Array<{ key?: string; label: string }> = Array.from(
            { length: siblings },
            () => ({ label: labelForm }),
          );
          const idx = Math.min(insertAt, cols.length);
          cols.splice(idx, 0, { key: base, label: "Explicit" });
          const keys = csvKeys(cols);
          // (1) Explicit key survives verbatim somewhere in the output.
          expect(keys).toContain(base);
          // (2) It's still unique — no duplicate `base` key emitted.
          expect(keys.filter((k) => k === base)).toHaveLength(1);
          // (3) Every other emitted key sits under the same base with a
          //     numeric suffix (or is the base itself for the one winner).
          const suffixRe = new RegExp(`^${base}(_\\d+)?$`);
          expect(keys.every((k) => suffixRe.test(k))).toBe(true);
        },
      ),
      { numRuns: propRuns(150) },
    );
  });

  it("N label-only siblings that slugify to the same base emit base, base_2, base_3, …", () => {
    // Pure chained-sibling case: no explicit keys at all. The bump
    // sequence must be exactly [base, base_2, …, base_N] in order.
    fc.assert(
      fc.property(asciiSlugFragment, fc.integer({ min: 1, max: 8 }), (base, n) => {
        const cols = Array.from({ length: n }, () => ({ label: base }));
        const keys = csvKeys(cols);
        const expected = Array.from({ length: n }, (_, i) => (i === 0 ? base : `${base}_${i + 1}`));
        expect(keys).toEqual(expected);
      }),
      { numRuns: propRuns(100) },
    );
  });

  it("explicit key at position 0 always wins the base slot; siblings bump _2, _3, … in order", () => {
    // When the explicit key comes FIRST, its slot is deterministic (the
    // bare base) and the label-only siblings that follow it must fill
    // exactly _2, _3, …, _N+1.
    fc.assert(
      fc.property(asciiSlugFragment, fc.integer({ min: 1, max: 6 }), (base, siblings) => {
        const cols = [
          { key: base, label: "Explicit" } as { key?: string; label: string },
          ...Array.from({ length: siblings }, () => ({ label: base })),
        ];
        const keys = csvKeys(cols);
        const expected = [base, ...Array.from({ length: siblings }, (_, i) => `${base}_${i + 2}`)];
        expect(keys).toEqual(expected);
      }),
      { numRuns: propRuns(100) },
    );
  });

  it("multiple explicit keys sharing the same base still each appear exactly once", () => {
    // K explicit `{ key: base }` columns interleaved with label-only
    // siblings of the same base. Every explicit key must survive (though
    // only one gets the bare base — the rest get suffixed), and the
    // total emitted key set is unique and full-length.
    fc.assert(
      fc.property(
        asciiSlugFragment,
        fc.integer({ min: 2, max: 4 }),
        fc.integer({ min: 0, max: 4 }),
        (base, explicitCount, labelCount) => {
          const explicits = Array.from({ length: explicitCount }, (_, i) => ({
            key: base,
            label: `E${i}`,
          }));
          const labels = Array.from({ length: labelCount }, (_, i) => ({
            label: `${base.toUpperCase()}${i === 0 ? "" : " " + i}`,
          }));
          // Interleave — the invariant must hold regardless of order.
          const cols: Array<{ key?: string; label: string }> = [];
          const maxLen = Math.max(explicits.length, labels.length);
          for (let i = 0; i < maxLen; i++) {
            if (explicits[i]) cols.push(explicits[i]);
            if (labels[i]) cols.push(labels[i]);
          }
          const keys = csvKeys(cols);
          expect(keys).toHaveLength(cols.length);
          expect(new Set(keys).size).toBe(keys.length);
          // Every key lives under the shared base.
          const suffixRe = new RegExp(`^${base}(_\\d+)*$`);
          expect(keys.every((k) => suffixRe.test(k))).toBe(true);
          // The bare base appears exactly once — whichever column
          // reached the derivation helper first claims it.
          expect(keys.filter((k) => k === base)).toHaveLength(1);
        },
      ),
      { numRuns: propRuns(150) },
    );
  });
});
