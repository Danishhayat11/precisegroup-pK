/**
 * Integration test: determinism of collision resolution.
 *
 * Contract under test: given the SAME input column list (same labels,
 * same explicit `{ key }` entries in the same positions), the CSV and
 * JSON exporters must produce byte-identical metadata across repeated
 * runs. Specifically:
 *
 *   1. Explicit-first ordering — an explicit `{ key }` always claims
 *      its slot before any label-derived sibling can walk into it, no
 *      matter how many times we rebuild.
 *   2. Chained-sibling ordering — when N labels collide on the same
 *      slug base, the `_2`, `_3`, … suffixes are assigned in the exact
 *      same left-to-right order every run.
 *
 * We drive this with a seeded PRNG so the "generated collisions" are
 * reproducible: the test file itself is deterministic AND it asserts
 * the exporter is deterministic on top of that.
 */
import { describe, it, expect } from "vitest";
import { prefixCsvWithMetadata, buildJsonExportMetadata } from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";

/** Tiny seeded PRNG (mulberry32) — deterministic across environments. */
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Col = { key?: string; label: string };

/**
 * Generate a column list with intentional collisions: several bases,
 * each repeated N times, with a few explicit-key entries sprinkled in
 * positions chosen by the seeded PRNG.
 */
function generateCollisions(seed: number): Col[] {
  const rnd = mulberry32(seed);
  const bases = ["Amount", "Total", "Fee", "Net"];
  const cols: Col[] = [];
  for (const base of bases) {
    const repeats = 3 + Math.floor(rnd() * 3); // 3–5 duplicates per base
    for (let i = 0; i < repeats; i++) {
      // Vary punctuation so labels differ but slugs collide.
      const decoration = ["", "!", "?", " ", "."][Math.floor(rnd() * 5)];
      cols.push({ label: `${base}${decoration}` });
    }
    // Sprinkle an explicit-key entry claiming a mid-chain slot.
    if (rnd() > 0.4) {
      const slot = 2 + Math.floor(rnd() * 2); // amount_2 or amount_3
      cols.push({
        key: `${base.toLowerCase()}_${slot}`,
        label: `${base} (explicit ${slot})`,
      });
    }
  }
  // Shuffle deterministically to interleave bases.
  for (let i = cols.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [cols[i], cols[j]] = [cols[j], cols[i]];
  }
  return cols;
}

function csvKeys(columns: Col[]): string[] {
  const csv = prefixCsvWithMetadata("h\r\nv\r\n", {
    source: "Determinism",
    generatedAt: new Date("2026-07-07T10:00:00Z"),
    columns,
    counts: { shown: 1, total: 1 },
  });
  return parseCsvMetadataHeader(csv).columns!.map((c) => c.key!);
}

function jsonKeys(columns: Col[]): string[] {
  const meta = buildJsonExportMetadata({
    source: "Determinism",
    generatedAt: new Date("2026-07-07T10:00:00Z"),
    columns,
    counts: { shown: 1, total: 1 },
  }) as { columns: Array<{ key: string; label: string }> };
  return meta.columns.map((c) => c.key);
}

describe("Repeated runs with the same generated collisions are deterministic", () => {
  const seeds = [1, 7, 42, 1337, 90210];

  it.each(seeds)("seed %i: CSV keys identical across 10 rebuilds", (seed) => {
    const cols = generateCollisions(seed);
    const runs = Array.from({ length: 10 }, () => csvKeys(cols));
    // Every run equals the first run — byte-identical ordering.
    for (const run of runs) expect(run).toEqual(runs[0]);
    // Every key is unique (no collision escaped resolution).
    expect(new Set(runs[0]).size).toBe(runs[0].length);
  });

  it.each(seeds)("seed %i: JSON keys identical across 10 rebuilds", (seed) => {
    const cols = generateCollisions(seed);
    const runs = Array.from({ length: 10 }, () => jsonKeys(cols));
    for (const run of runs) expect(run).toEqual(runs[0]);
    expect(new Set(runs[0]).size).toBe(runs[0].length);
  });

  it.each(seeds)("seed %i: CSV and JSON agree on ordering (parity)", (seed) => {
    const cols = generateCollisions(seed);
    expect(csvKeys(cols)).toEqual(jsonKeys(cols));
  });

  it("explicit-first: an explicit key ALWAYS holds its slot, no matter the rebuild count", () => {
    // Explicit `amount_2` is declared BEFORE any label-derived sibling
    // that would slugify onto it. Chain of `Amount` labels then walks
    // past the reserved slot in the same order on every rebuild.
    const cols: Col[] = [
      { key: "amount_2", label: "Amount (explicit)" },
      { label: "Amount" }, // → amount
      { label: "Amount!" }, // → amount_2 taken → amount_3
      { label: "Amount?" }, // → amount_4
      { label: "Amount." }, // → amount_5
    ];
    const first = csvKeys(cols);
    for (let i = 0; i < 20; i++) expect(csvKeys(cols)).toEqual(first);
    // Explicit key survived verbatim at position 0.
    expect(first[0]).toBe("amount_2");
    // Chained siblings landed in stable left-to-right order.
    expect(first).toEqual(["amount_2", "amount", "amount_3", "amount_4", "amount_5"]);
    // All unique.
    expect(new Set(first).size).toBe(first.length);
    // CSV and JSON agree.
    expect(jsonKeys(cols)).toEqual(first);
  });

  it("chained-sibling ordering is stable when the same base collides many times", () => {
    // 8 identical labels — the `_2..._8` chain must land in the same
    // positions every rebuild, and match CSV↔JSON.
    const cols: Col[] = Array.from({ length: 8 }, () => ({ label: "Amount" }));
    const csv = csvKeys(cols);
    const json = jsonKeys(cols);
    expect(csv).toEqual(json);
    // Left-to-right assignment: base, then _2, _3, …, _8.
    expect(csv).toEqual([
      "amount",
      "amount_2",
      "amount_3",
      "amount_4",
      "amount_5",
      "amount_6",
      "amount_7",
      "amount_8",
    ]);
    // Repeated rebuilds give the same chain.
    for (let i = 0; i < 15; i++) {
      expect(csvKeys(cols)).toEqual(csv);
      expect(jsonKeys(cols)).toEqual(csv);
    }
  });
});
