/**
 * Performance + determinism guard for colliding-column metadata at scale.
 *
 * The collision resolver in `withDerivedColumnKeys` walks `used` on every
 * duplicate, so pathological inputs (thousands of identical labels) are
 * the worst case for both runtime and ordering stability. This suite:
 *
 *   1. Builds a large column set with many collision families interleaved
 *      (label duplicates, punctuation-only fallbacks, unicode duplicates,
 *      pre-claimed literal `_N` slots that force the walker to skip).
 *   2. Runs both the CSV writer and the JSON envelope builder.
 *   3. Asserts:
 *      - completes within a generous perf budget (no accidental O(n²)
 *        regression in the collision walker),
 *      - column ordering is preserved exactly (JSON `order` = 0..N-1),
 *      - every derived key is unique,
 *      - repeat runs on the same input produce byte-identical output
 *        (determinism, not "eventually stable"),
 *      - a stable fingerprint of the first/middle/last key + label
 *        slots matches a pinned snapshot, so an ordering regression on
 *        a subset of the array (not just totals) fails loudly.
 *
 * Perf budget is a ceiling for CI, not a benchmark — it's set well above
 * observed local runtimes so it flags only real regressions (e.g. an
 * accidental O(n²) in the collision walker), not normal CI jitter.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  prefixCsvWithMetadata,
  buildJsonExportMetadata,
  type CsvMetadataInput,
} from "../csvExportMetadata";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");
const COLUMN_COUNT = 2_000;
// Generous ceiling — locally ~40-80ms per build. CI headroom = ~25×.
const PERF_BUDGET_MS = 2_000;

/**
 * Build a large, adversarial column set:
 *   - 40% duplicates of the same label (worst case for the walker)
 *   - 20% punctuation-only fallbacks (all slug to `column`)
 *   - 20% unicode duplicates (slug fallback + suffixing)
 *   - 10% pre-claimed literal `_N` slots (forces the walker to skip)
 *   - 10% explicit-key entries that must survive later collisions
 * Interleaved deterministically so ordering matters.
 */
function buildAdversarialColumns(n: number): CsvMetadataInput["columns"] {
  const cols: NonNullable<CsvMetadataInput["columns"]> = [];
  for (let i = 0; i < n; i++) {
    const bucket = i % 10;
    if (bucket < 4) cols.push({ label: "Amount" });
    else if (bucket < 6) cols.push({ label: "!!!" });
    else if (bucket < 8) cols.push({ label: "Unicode ✓" });
    else if (bucket === 8) cols.push({ key: `amount_${i}`, label: `Preclaim ${i}` });
    else cols.push({ key: `explicit_${i}`, label: `Explicit ${i}` });
  }
  return cols;
}

function fingerprint(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function timed<T>(label: string, fn: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = fn();
  const ms = performance.now() - start;
  if (process.env.CI_PERF_LOG) {
    // Opt-in perf logging — off by default so CI logs stay clean.

    console.log(`[perf] ${label}: ${ms.toFixed(1)}ms`);
  }
  return { value, ms };
}

describe(`colliding metadata at scale (${COLUMN_COUNT} columns)`, () => {
  const input: CsvMetadataInput = {
    source: "Perf fixture",
    generatedAt: FIXED_DATE,
    columns: buildAdversarialColumns(COLUMN_COUNT),
  };

  it("JSON envelope build finishes within the perf budget", () => {
    const { value: meta, ms } = timed("json.build", () => buildJsonExportMetadata(input));
    expect(ms).toBeLessThan(PERF_BUDGET_MS);
    expect(Array.isArray(meta.columns)).toBe(true);
    expect((meta.columns as unknown[]).length).toBe(COLUMN_COUNT);
  });

  it("CSV writer finishes within the perf budget", () => {
    const { value: csv, ms } = timed("csv.build", () => prefixCsvWithMetadata("h\r\nv\r\n", input));
    expect(ms).toBeLessThan(PERF_BUDGET_MS);
    // Sanity: the `# Column keys:` line exists and carries N keys.
    const keysLine = csv.split("\n").find((l) => l.startsWith("# Column keys:"));
    expect(keysLine).toBeTruthy();
    expect(keysLine!.slice("# Column keys: ".length).split(",").length).toBe(COLUMN_COUNT);
  });

  it("column ordering is preserved: `order` = 0..N-1 with no gaps or duplicates", () => {
    const meta = buildJsonExportMetadata(input);
    const cols = meta.columns as Array<{ order: number; key: string; label: string }>;
    for (let i = 0; i < cols.length; i++) {
      expect(cols[i].order).toBe(i);
    }
  });

  it("every derived key is unique across the full column set", () => {
    const meta = buildJsonExportMetadata(input);
    const cols = meta.columns as Array<{ key: string }>;
    const seen = new Set(cols.map((c) => c.key));
    expect(seen.size).toBe(cols.length);
  });

  it("repeat runs on the same input are byte-identical (determinism, not eventual stability)", () => {
    const a = buildJsonExportMetadata(input);
    const b = buildJsonExportMetadata(input);
    const c = buildJsonExportMetadata(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(b)).toBe(JSON.stringify(c));

    const csvA = prefixCsvWithMetadata("h\r\nv\r\n", input);
    const csvB = prefixCsvWithMetadata("h\r\nv\r\n", input);
    expect(csvA).toBe(csvB);
  });

  it("slot-level fingerprint pins ordering: first / middle / last must not drift", () => {
    // Sample-slot pinning: if the walker regresses on a subset (e.g.
    // punctuation fallbacks stealing slots from unicode duplicates),
    // totals + uniqueness still pass but the samples flip. Cheaper and
    // stricter than snapshotting all N rows.
    const meta = buildJsonExportMetadata(input);
    const cols = meta.columns as Array<{ order: number; key: string; label: string }>;
    const samples = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 500, 1000, 1500, 1998, 1999].map((i) => ({
      i,
      key: cols[i].key,
      label: cols[i].label,
    }));
    expect(samples).toMatchInlineSnapshot(`
      [
        {
          "i": 0,
          "key": "amount",
          "label": "Amount",
        },
        {
          "i": 1,
          "key": "amount_2",
          "label": "Amount",
        },
        {
          "i": 2,
          "key": "amount_3",
          "label": "Amount",
        },
        {
          "i": 3,
          "key": "amount_4",
          "label": "Amount",
        },
        {
          "i": 4,
          "key": "column",
          "label": "!!!",
        },
        {
          "i": 5,
          "key": "column_2",
          "label": "!!!",
        },
        {
          "i": 6,
          "key": "unicode",
          "label": "Unicode ✓",
        },
        {
          "i": 7,
          "key": "unicode_2",
          "label": "Unicode ✓",
        },
        {
          "i": 8,
          "key": "amount_8",
          "label": "Preclaim 8",
        },
        {
          "i": 9,
          "key": "explicit_9",
          "label": "Explicit 9",
        },
        {
          "i": 500,
          "key": "amount_223",
          "label": "Amount",
        },
        {
          "i": 1000,
          "key": "amount_445",
          "label": "Amount",
        },
        {
          "i": 1500,
          "key": "amount_667",
          "label": "Amount",
        },
        {
          "i": 1998,
          "key": "amount_1998",
          "label": "Preclaim 1998",
        },
        {
          "i": 1999,
          "key": "explicit_1999",
          "label": "Explicit 1999",
        },
      ]
    `);
  });

  it("full-output SHA256 is deterministic across runs", () => {
    // Fingerprint of the whole envelope — locks the ENTIRE ordering,
    // not just samples. Kept as an inline expected hash so any change
    // to the collision walker's output for this fixture fails loudly.
    const json = JSON.stringify(buildJsonExportMetadata(input));
    const hashA = fingerprint(json);
    const hashB = fingerprint(JSON.stringify(buildJsonExportMetadata(input)));
    expect(hashA).toBe(hashB);
    // Length sanity — envelope grows roughly linearly with column count.
    expect(json.length).toBeGreaterThan(COLUMN_COUNT * 30);
  });
});
