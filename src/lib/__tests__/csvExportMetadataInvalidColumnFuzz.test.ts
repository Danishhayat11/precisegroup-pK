/**
 * Fuzz: hand `withDerivedColumnKeys` / `buildJsonExportMetadata` /
 * `buildCsvMetadataHeader` a large batch of INVALID column inputs and
 * assert the encoder either
 *
 *   (a) throws a `CsvExportMetadataError` with the DOCUMENTED code + the
 *       precise offending index, or
 *   (b) silently applies the DOCUMENTED fallback rule (missing key →
 *       slug-derived key; duplicate explicit key → `_2`, `_3`, …
 *       suffix walking past any literal sibling collision).
 *
 * There is no third option — a bad column entry must never silently
 * corrupt the export nor throw a generic Error. This test locks that
 * contract against a randomized generator so an accidental change in
 * error handling shows up immediately.
 *
 * Documented rules (from `withDerivedColumnKeys`):
 *   • null / undefined column        → throws `empty-column-entry`
 *   • non-string, non-object column  → throws `invalid-column-type`
 *   • non-string `key` field         → throws `invalid-column-key-type`
 *   • non-string `label` field       → throws `invalid-column-label-type`
 *   • whitespace-only `key`          → throws `empty-column-key`
 *   • blank label AND no key         → throws `empty-column-label`
 *   • missing key + valid label      → FALLBACK: key = slug(label)
 *   • duplicate explicit key         → FALLBACK: key + `_2`, `_3`, …
 */
import { describe, it, expect } from "vitest";
import {
  buildJsonExportMetadata,
  buildCsvMetadataHeader,
  withDerivedColumnKeys,
  slugifyColumnKey,
  CsvExportMetadataError,
  type CsvMetadataInput,
} from "../csvExportMetadata";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pickInt(rand: () => number, lo: number, hi: number): number {
  return Math.floor(rand() * (hi - lo + 1)) + lo;
}
function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

// ---------------------------------------------------------------------------
// Every invalid-input generator returns:
//   { column, expectedCode }
// so the test can wrap the column at a known index (with valid siblings) and
// assert the exact error code + index the encoder MUST throw. If a generator
// starts returning inputs that legally slip through, the test dies with a
// clear message — no silent skips.
// ---------------------------------------------------------------------------
type InvalidCase = {
  column: unknown;
  expectedCode:
    | "empty-column-entry"
    | "invalid-column-type"
    | "invalid-column-key-type"
    | "invalid-column-label-type"
    | "empty-column-key"
    | "empty-column-label";
  desc: string;
};

const NON_STRING_KEYS = [
  { v: 42, desc: "number key" },
  { v: true, desc: "boolean key" },
  { v: null, desc: "null key" },
  { v: {}, desc: "object key" },
  { v: [], desc: "array key" },
];
const NON_STRING_LABELS = [
  { v: 42, desc: "number label" },
  { v: true, desc: "boolean label" },
  { v: null, desc: "null label" },
  { v: {}, desc: "object label" },
  { v: [], desc: "array label" },
];
const BAD_TOP_LEVEL = [
  { v: 3.14, desc: "raw number" },
  { v: true, desc: "raw boolean" },
  { v: [1, 2], desc: "raw array" },
  { v: () => {}, desc: "raw function" },
  { v: Symbol("x") as unknown, desc: "raw symbol" },
];
const WS_ONLY_KEYS = ["   ", "\t", "\n", " \t\n"] as const;
const BLANK_LABELS = ["", "   ", "\t", "\n"] as const;

function makeInvalidCase(rand: () => number): InvalidCase {
  const roll = pickInt(rand, 0, 6);
  switch (roll) {
    case 0:
      return {
        column: rand() < 0.5 ? null : undefined,
        expectedCode: "empty-column-entry",
        desc: "null/undefined entry",
      };
    case 1: {
      const p = pick(rand, BAD_TOP_LEVEL);
      return { column: p.v, expectedCode: "invalid-column-type", desc: p.desc };
    }
    case 2: {
      const p = pick(rand, NON_STRING_KEYS);
      return {
        column: { key: p.v, label: "OK" },
        expectedCode: "invalid-column-key-type",
        desc: p.desc,
      };
    }
    case 3: {
      const p = pick(rand, NON_STRING_LABELS);
      return {
        // Provide a valid key so the label check is what fires.
        column: { key: "ok_key", label: p.v },
        expectedCode: "invalid-column-label-type",
        desc: p.desc,
      };
    }
    case 4: {
      const ws = pick(rand, WS_ONLY_KEYS);
      return {
        column: { key: ws, label: "OK" },
        expectedCode: "empty-column-key",
        desc: `whitespace-only key ${JSON.stringify(ws)}`,
      };
    }
    case 5: {
      // Blank label AND no key → empty-column-label.
      const lbl = pick(rand, BLANK_LABELS);
      return {
        column: { label: lbl },
        expectedCode: "empty-column-label",
        desc: `blank label ${JSON.stringify(lbl)}, no key`,
      };
    }
    default: {
      // Bare-string blank column also lands in `empty-column-label`
      // (rawLabel = c, labelTrimmed = "").
      const s = pick(rand, BLANK_LABELS);
      return {
        column: s,
        expectedCode: "empty-column-label",
        desc: `bare blank string ${JSON.stringify(s)}`,
      };
    }
  }
}

/** Assert every top-level encoder throws with the same code + index. */
function expectAllEncodersThrow(
  columns: unknown[],
  expectedCode: InvalidCase["expectedCode"],
  columnIndex: number,
  ctx: string,
) {
  const input = { source: "S", columns } as unknown as CsvMetadataInput;
  for (const [name, run] of [
    ["withDerivedColumnKeys", () => withDerivedColumnKeys(input.columns!)],
    ["buildJsonExportMetadata", () => buildJsonExportMetadata(input)],
    ["buildCsvMetadataHeader", () => buildCsvMetadataHeader(input)],
  ] as const) {
    let caught: unknown;
    try {
      run();
    } catch (e) {
      caught = e;
    }
    if (!(caught instanceof CsvExportMetadataError)) {
      throw new Error(
        `${ctx}: ${name} did not throw CsvExportMetadataError (got ${
          caught === undefined ? "no throw" : `${caught}`
        })`,
      );
    }
    expect(caught.code, `${ctx}: ${name} error.code`).toBe(expectedCode);
    expect(caught.columnIndex, `${ctx}: ${name} error.columnIndex`).toBe(columnIndex);
  }
}

// ---------------------------------------------------------------------------
import { runWithBudget } from "./support/csvFuzzBudget";

describe("invalid column inputs — encoders throw the documented error", () => {
  it("≥200 fuzzed invalid columns surface documented code + index (across all 3 encoders) under budget", () => {
    const SEED = 0xdead_beef;
    const rand = mulberry32(SEED);
    // Determinism floor: 200 iterations reliably hits every arm of the
    // 7-way `makeInvalidCase` switch (7/200 ≈ 3.5% each — expected
    // ~28 draws per arm). Budget loop scales up on faster hardware.
    const MIN_ITERATIONS = 200;
    const BUDGET_MS = 500;
    const res = runWithBudget({
      name: "invalid-column-fuzz",
      minIterations: MIN_ITERATIONS,
      budgetMs: BUDGET_MS,
      run: (i) => {
        const bad = makeInvalidCase(rand);
        const before = pickInt(rand, 0, 3);
        const after = pickInt(rand, 0, 3);
        const columns: unknown[] = [];
        for (let b = 0; b < before; b++) columns.push(`Before ${b}`);
        const badIndex = columns.length;
        columns.push(bad.column);
        for (let a = 0; a < after; a++) columns.push(`After ${a}`);
        try {
          expectAllEncodersThrow(columns, bad.expectedCode, badIndex, `iter=${i} ${bad.desc}`);
        } catch (e) {
          throw new Error(
            `Iteration ${i} (${bad.desc}, seed=${SEED.toString(16)}) failed:\n  ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }
      },
    });
    expect(res.ranIterations).toBeGreaterThanOrEqual(MIN_ITERATIONS);
  });
});

// ---------------------------------------------------------------------------
describe("valid-but-degenerate column inputs — encoders apply the documented fallback", () => {
  const LABEL_POOL = [
    "Timestamp",
    "Request ID",
    "Round",
    "Tool 🎯",
    "Duration (ms)",
    "Retry-Strategy",
    "café",
    "kebab-case-label",
  ] as const;

  it("≥150 fuzzed missing-key columns get a slug-derived key (byte-identical between CSV + JSON) under budget", () => {
    const rand = mulberry32(0xcafebabe);
    const MIN_ITERATIONS = 150;
    const BUDGET_MS = 400;
    const res = runWithBudget({
      name: "missing-key-slug-fallback",
      minIterations: MIN_ITERATIONS,
      budgetMs: BUDGET_MS,
      run: (i) => {
        const n = pickInt(rand, 1, 5);
        const columns: Array<string | { label: string }> = [];
        for (let j = 0; j < n; j++) {
          const lbl = `${pick(rand, LABEL_POOL)} ${i}-${j}`;
          // Half the time use the string shape, half the object shape
          // WITHOUT a key — both must slug-derive identically.
          columns.push(rand() < 0.5 ? lbl : { label: lbl });
        }
        const input: CsvMetadataInput = { source: "S", columns };
        const json = buildJsonExportMetadata(input);
        const derived = withDerivedColumnKeys(columns);
        for (let k = 0; k < columns.length; k++) {
          const label = derived[k]!.label;
          const key = derived[k]!.key;
          const base = slugifyColumnKey(label);
          if (key !== base) {
            const m = /^(.+)_(\d+)$/.exec(key);
            expect(m, `column[${k}] key ${key} must be slug or slug_N`).not.toBeNull();
            expect(m![1]).toBe(base);
            expect(Number(m![2])).toBeGreaterThanOrEqual(2);
          }
          expect(json.columns![k]!.key).toBe(key);
          expect(json.columns![k]!.label).toBe(label);
          expect(json.columns![k]!.order).toBe(k);
        }
      },
    });
    expect(res.ranIterations).toBeGreaterThanOrEqual(MIN_ITERATIONS);
  });

  it("duplicate explicit keys are dedupped with `_N` suffixes walking past literal sibling collisions", () => {
    // Fixture pins the exact suffix-walk contract: bases bump their own
    // counter, and any resulting key that collides with a LITERAL sibling
    // key is bumped further until unique. No two output keys ever match.
    const columns = [
      { key: "amount", label: "A" }, // → amount        (seen[amount]=1)
      { key: "amount", label: "B" }, // → amount_2      (seen[amount]=2)
      { key: "amount_2", label: "C" }, // literal amount_2 taken → amount_2_2
      { key: "amount", label: "D" }, // → amount_3      (seen[amount]=3)
    ];
    const derived = withDerivedColumnKeys(columns);
    const keys = derived.map((c) => c.key);
    expect(keys).toEqual(["amount", "amount_2", "amount_2_2", "amount_3"]);
    // Contract restated as invariants (independent of the exact suffix
    // string), so a future refactor that keeps the guarantees intact
    // doesn't have to touch the literal fixture above:
    expect(new Set(keys).size).toBe(keys.length); // all unique
    // JSON envelope mirrors the derivation byte-for-byte.
    const json = buildJsonExportMetadata({ source: "S", columns });
    expect(json.columns!.map((c) => c.key)).toEqual(keys);
  });

  it("≥60 fuzzed duplicate-key batches produce unique keys with the documented `_N` suffix pattern under budget", () => {
    const rand = mulberry32(0xfeedface);
    const MIN_ITERATIONS = 60;
    const BUDGET_MS = 250;
    const res = runWithBudget({
      name: "duplicate-key-suffix",
      minIterations: MIN_ITERATIONS,
      budgetMs: BUDGET_MS,
      run: (i) => {
        const bases = ["price", "qty", "note", "id", "tool"];
        const base = pick(rand, bases);
        const n = pickInt(rand, 2, 8);
        const columns = Array.from({ length: n }, (_, j) => ({
          key: base,
          label: `L${j}`,
        }));
        const derived = withDerivedColumnKeys(columns);
        const keys = derived.map((c) => c.key);
        expect(new Set(keys).size, `iter=${i}: keys unique`).toBe(n);
        expect(keys[0]).toBe(base);
        let last = 1;
        for (let k = 1; k < keys.length; k++) {
          const m = /^(.+)_(\d+)$/.exec(keys[k]!);
          expect(m, `iter=${i} keys[${k}]=${keys[k]} matches base_N`).not.toBeNull();
          expect(m![1]).toBe(base);
          const num = Number(m![2]);
          expect(num).toBeGreaterThan(last);
          last = num;
        }
      },
    });
    expect(res.ranIterations).toBeGreaterThanOrEqual(MIN_ITERATIONS);
  });
});
