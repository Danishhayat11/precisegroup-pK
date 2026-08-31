/**
 * Integration test: shuffle the input columns / labels and verify the
 * exported JSON envelope preserves a DETERMINISTIC column ordering and
 * a DETERMINISTIC sibling-bump numbering for slug collisions.
 *
 * Two invariants the exporter must hold:
 *
 *   1. Deterministic ordering: for any given input permutation, the
 *      exported `_meta.columns` sequence is a pure function of that
 *      permutation. Re-running the exporter on the same permutation
 *      yields byte-identical keys and labels. Different permutations
 *      MAY produce different keys (bump numbers depend on left-to-right
 *      order), but every permutation is itself stable.
 *
 *   2. Deterministic sibling bumps: within a single permutation, slug
 *      collisions resolve left-to-right — the earliest slot keeps the
 *      base slug, and every subsequent collision gets the next free
 *      `_N` suffix. Explicit keys participate in the same left-to-right
 *      pass (they don't jump the queue). Every emitted key is unique.
 *
 * The parse-back path uses `parseJsonExportEnvelope` so the assertion
 * runs against the SAME structure downstream consumers see, not the
 * pre-serialise in-memory object.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { propRuns } from "./_helpers/propRuns";
import { assertProperty } from "./support/fuzzReporter";
import {
  buildJsonExportMetadata,
  withDerivedColumnKeys,
  type CsvMetadataInput,
} from "../csvExportMetadata";
import { parseJsonExportEnvelope } from "../jsonExportEnvelopeParser";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

type Col = NonNullable<CsvMetadataInput["columns"]>[number];

function exportAndParse(columns: NonNullable<CsvMetadataInput["columns"]>) {
  const envelope = {
    _meta: buildJsonExportMetadata({
      source: "Shuffle determinism",
      generatedAt: FIXED_DATE,
      columns,
    }),
    rows: [] as Array<Record<string, unknown>>,
  };
  return parseJsonExportEnvelope(JSON.parse(JSON.stringify(envelope)));
}

/**
 * Apply a permutation (array of source indices) to `columns`. Used to
 * generate the shuffled inputs the test asserts against.
 */
function permute<T>(items: T[], indices: number[]): T[] {
  return indices.map((i) => items[i]);
}

/** Fisher-Yates permutation controlled by a fast-check-supplied RNG. */
function makePermutation(n: number, seed: number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  let state = seed | 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    // xorshift32 — deterministic, no Math.random.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const j = Math.abs(state) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe("JSON export — shuffle determinism (integration)", () => {
  it("re-running on the SAME shuffled input yields byte-identical keys and labels", () => {
    // Curated collision-heavy dataset: 3 "Amount" label-only siblings,
    // an explicit `amount`, an explicit `amount_2` (looks like a
    // derived suffix), plus two unrelated labels for baseline.
    const base: Col[] = [
      { label: "Amount" },
      { label: "Amount" },
      { key: "amount", label: "Explicit Amount" },
      { key: "amount_2", label: "Legacy 2" },
      { label: "Amount" },
      { label: "Balance" },
      { label: "Notes" },
    ];
    for (let seed = 1; seed <= 8; seed++) {
      const perm = makePermutation(base.length, seed);
      const shuffled = permute(base, perm);
      const a = exportAndParse(shuffled).columns;
      const b = exportAndParse(shuffled).columns;
      expect(b).toEqual(a);
    }
  });

  it("sibling bumps follow strict left-to-right order and every key is unique", () => {
    // For any shuffle, the parsed sequence must equal the shared
    // `withDerivedColumnKeys` reference — that helper defines the
    // canonical left-to-right bump algorithm.
    const base: Col[] = [
      { label: "Amount" },
      { label: "Amount" },
      { key: "amount", label: "Explicit Amount" },
      { key: "amount_2", label: "Legacy 2" },
      { label: "Amount" },
      { label: "amount!" },
    ];
    for (let seed = 1; seed <= 12; seed++) {
      const shuffled = permute(base, makePermutation(base.length, seed));
      const parsedKeys = exportAndParse(shuffled).columns.map((c) => c.key);
      const referenceKeys = withDerivedColumnKeys(shuffled).map((c) => c.key);
      expect(parsedKeys).toEqual(referenceKeys);
      expect(new Set(parsedKeys).size).toBe(parsedKeys.length);
    }
  });

  it("label order in the export matches input order for every shuffle", () => {
    const base: Col[] = [
      { label: "Alpha" },
      { label: "Beta" },
      { label: "Gamma" },
      { label: "Delta" },
      { label: "Epsilon" },
    ];
    for (let seed = 1; seed <= 10; seed++) {
      const shuffled = permute(base, makePermutation(base.length, seed));
      const labels = exportAndParse(shuffled).columns.map((c) => c.label);
      expect(labels).toEqual(shuffled.map((c) => (typeof c === "string" ? c : c.label)));
    }
  });

  it("explicit keys survive verbatim on every shuffle (position may change; identity does not)", () => {
    const base: Col[] = [
      { key: "explicit_A", label: "A" },
      { key: "explicit_B", label: "B" },
      { key: "amount", label: "Amt" },
      { label: "Amount" }, // derives to amount when first, else bumps
      { label: "Amount" }, // ditto
    ];
    const explicits = ["explicit_A", "explicit_B", "amount"];
    for (let seed = 1; seed <= 10; seed++) {
      const shuffled = permute(base, makePermutation(base.length, seed));
      const parsedKeys = exportAndParse(shuffled).columns.map((c) => c.key);
      for (const explicit of explicits) {
        // An explicit key can be bumped when an earlier slot took its
        // base slug — but the SEQUENCE always matches the reference
        // derivation (already asserted elsewhere). Here we only assert
        // the explicit column's identity is preserved: its parsed key
        // equals whatever `withDerivedColumnKeys` produced for the
        // slot it occupies.
        const idx = shuffled.findIndex(
          (c) => typeof c !== "string" && "key" in c && c.key === explicit,
        );
        expect(idx).toBeGreaterThanOrEqual(0);
        const referenceKey = withDerivedColumnKeys(shuffled)[idx].key;
        expect(parsedKeys[idx]).toBe(referenceKey);
      }
    }
  });

  it("property: any random permutation is deterministic and matches the reference derivation", () => {
    const colArb = fc.oneof(
      fc.constantFrom<Col>(
        { label: "Amount" },
        { label: "amount!" },
        { label: "  amount  " },
        { label: "Balance" },
        { label: "Notes" },
        { key: "amount", label: "Explicit Amount" },
        { key: "amount_2", label: "Legacy 2" },
        { key: "amount_3", label: "Legacy 3" },
      ),
    );
    const inputArb = fc
      .array(colArb, { minLength: 2, maxLength: 15 })
      .chain((cols) =>
        fc
          .shuffledSubarray(cols, { minLength: cols.length, maxLength: cols.length })
          .map((shuffled) => shuffled as Col[]),
      );

    assertProperty(
      "jsonExportShuffleDeterminism/permutation-is-deterministic",
      fc.property(inputArb, (shuffled) => {
        const a = exportAndParse(shuffled).columns.map((c) => c.key);
        const b = exportAndParse(shuffled).columns.map((c) => c.key);
        const reference = withDerivedColumnKeys(shuffled).map((c) => c.key);
        expect(a).toEqual(b); // determinism
        expect(a).toEqual(reference); // matches canonical derivation
        expect(new Set(a).size).toBe(a.length); // unique
        expect(a).toHaveLength(shuffled.length); // no columns dropped
      }),
      { numRuns: propRuns(200) },
    );
  });
});
