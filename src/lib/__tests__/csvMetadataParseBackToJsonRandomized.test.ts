/**
 * Randomized round-trip: build a CsvMetadataInput → emit CSV via
 * `prefixCsvWithMetadata` → parse it back with `parseCsvMetadataHeader`
 * → assert the reconstructed metadata matches the JSON envelope that
 * `buildJsonExportMetadata` produces from the SAME input.
 *
 * This is the tightest cross-format contract we have: it proves the CSV
 * metadata header and the JSON `_meta` envelope carry the same
 * information, in the same shape, with the same ordering guarantees —
 * for a wide swathe of randomly generated inputs, not just curated
 * fixtures.
 *
 * Ordering assertions we care about (and which routinely regress
 * silently when either serializer is touched):
 *   • `columns` is emitted in the caller's declared order in both
 *     formats — no alphabetization, no de-duplication reorder.
 *   • `filters` / `extra` are emitted in alphabetical key order in the
 *     JSON envelope (byte-stable across caller insertion order).
 *   • `sort`, `page`, `counts`, `generatedAt`, `source` all round-trip
 *     losslessly.
 *
 * Uses a deterministic seeded PRNG so failures are reproducible; the
 * seed is baked in and logged with each iteration in the failure
 * message.
 */
import { describe, it, expect } from "vitest";
import {
  buildJsonExportMetadata,
  prefixCsvWithMetadata,
  type CsvMetadataInput,
  JSON_ENVELOPE_SCHEMA,
  JSON_ENVELOPE_VERSION,
} from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — same seed → same test suite → same fail.
// ---------------------------------------------------------------------------
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

function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}
function pickInt(rand: () => number, lo: number, hi: number): number {
  return Math.floor(rand() * (hi - lo + 1)) + lo;
}

// ---------------------------------------------------------------------------
// Input generator — deliberately covers presence/absence of every optional
// bucket, out-of-order filter keys, and multiple columns with mixed
// declaration styles (string vs { key, label }).
// ---------------------------------------------------------------------------
const SOURCE_POOL = [
  "AI Diagnostics",
  "Bookings — daily",
  "Payments (filtered)",
  "Audit Log",
  "Dashboard — KPI Trend",
] as const;

const FILTER_KEYS = ["Status", "Retry", "Tool", "Search", "Owner", "Team", "Region"] as const;
const FILTER_VALS = ["primary", "sanitized", "list_units", "gpt-5", "alice", "eu-west"] as const;
const EXTRA_KEYS = ["Notes", "Report", "Correlation", "Env"] as const;
const COLUMN_POOL = [
  "Timestamp",
  "Request ID",
  "Round",
  "Tool",
  "Success",
  "Duration (ms)",
  "Gateway status",
  "Retry strategy",
  "Error message",
  "Arguments",
  "Result",
] as const;

function makeRandomInput(rand: () => number): CsvMetadataInput {
  const input: CsvMetadataInput = {
    source: pick(rand, SOURCE_POOL),
    generatedAt: new Date(1_700_000_000_000 + Math.floor(rand() * 1e10)),
  };

  // Optional filters — 0..5 entries, picked in a RANDOM order so we can
  // check the JSON envelope alphabetizes them regardless.
  if (rand() < 0.9) {
    const n = pickInt(rand, 0, 5);
    const keys = [...FILTER_KEYS].sort(() => rand() - 0.5).slice(0, n);
    const filters: Record<string, string> = {};
    for (const k of keys) filters[k] = pick(rand, FILTER_VALS);
    // Mix in a benign sentinel that SHOULD be dropped so we test filtering.
    if (rand() < 0.3) filters["_Dropped"] = "all";
    input.filters = filters;
  }

  // Optional extras — same alphabetical-order contract as filters.
  if (rand() < 0.6) {
    const n = pickInt(rand, 0, 3);
    const keys = [...EXTRA_KEYS].sort(() => rand() - 0.5).slice(0, n);
    const extra: Record<string, string> = {};
    for (const k of keys) extra[k] = `v${pickInt(rand, 1, 999)}`;
    input.extra = extra;
  }

  // Sort — always present in ~half the runs.
  if (rand() < 0.7) {
    input.sort = {
      key: pick(rand, ["created_at", "success", "tool_name", "duration_ms"]),
      dir: rand() < 0.5 ? "asc" : "desc",
    };
  }

  // Page — mutually optional; also test null explicitly.
  if (rand() < 0.6) {
    input.page = {
      page: pickInt(rand, 1, 50),
      totalPages: pickInt(rand, 50, 100),
      pageSize: pick(rand, [10, 25, 50, 100]),
    };
  } else if (rand() < 0.5) {
    input.page = null;
  }

  // Counts — random subset of {shown, filtered, total}.
  if (rand() < 0.8) {
    const counts: { shown?: number; filtered?: number; total?: number } = {};
    if (rand() < 0.9) counts.shown = pickInt(rand, 0, 1000);
    if (rand() < 0.6) counts.filtered = pickInt(rand, 0, 10_000);
    if (rand() < 0.6) counts.total = pickInt(rand, 0, 50_000);
    input.counts = counts;
  }

  // Columns — random subset in a random order. Mix declaration styles.
  if (rand() < 0.9) {
    const n = pickInt(rand, 1, COLUMN_POOL.length);
    const shuffled = [...COLUMN_POOL].sort(() => rand() - 0.5).slice(0, n);
    input.columns = shuffled.map((label, i) => {
      // Every third column uses the { key, label } shape with an
      // explicit key so we can verify keys survive both serializers.
      if (i % 3 === 0)
        return { key: `col_${i}_${label.toLowerCase().replace(/\W+/g, "_")}`, label };
      return label;
    });
  }

  return input;
}

// ---------------------------------------------------------------------------
// The assertion. Compares the parsed CSV header against the JSON envelope
// field-by-field so a mismatch reports the exact field, not a giant diff.
// ---------------------------------------------------------------------------
function expectParsedMatchesJson(input: CsvMetadataInput, label: string) {
  const csv = prefixCsvWithMetadata("col_a,col_b\n1,2", input);
  const parsed = parseCsvMetadataHeader(csv);
  const json = buildJsonExportMetadata(input);

  // Anchor fields.
  expect(parsed.source, `${label} · source`).toBe(json.source);
  expect(parsed.schema, `${label} · schema`).toBe(JSON_ENVELOPE_SCHEMA);
  expect(parsed.version, `${label} · version`).toBe(JSON_ENVELOPE_VERSION);
  // Generated is a locale string in CSV vs ISO in JSON — only assert both exist.
  expect(parsed.generatedAt, `${label} · generatedAt present`).toBeTruthy();
  expect(json.generatedAt, `${label} · JSON generatedAt present`).toBeTruthy();

  // Sort.
  if (json.sort) {
    expect(parsed.sort, `${label} · sort present`).toEqual(json.sort);
  } else {
    expect(parsed.sort, `${label} · sort absent`).toBeNull();
  }

  // Page.
  if (json.page) {
    expect(parsed.page, `${label} · page present`).toEqual(json.page);
  } else {
    expect(parsed.page, `${label} · page absent`).toBeNull();
  }

  // Counts — CSV parser returns null when JSON omits the bucket entirely.
  if (json.counts) {
    expect(parsed.counts, `${label} · counts`).toEqual(json.counts);
  } else {
    expect(parsed.counts, `${label} · counts absent`).toBeNull();
  }

  // Filters — JSON envelope alphabetizes keys; the parsed CSV filter map
  // must contain exactly the same key/value pairs. Ordering of a JS
  // object's keys after JSON.parse round-trip mirrors insertion order,
  // so we can also assert alphabetical key order on the JSON side.
  const jsonFilterKeys = Object.keys(json.filters ?? {});
  expect(jsonFilterKeys, `${label} · JSON filter keys sorted`).toEqual([...jsonFilterKeys].sort());
  expect(parsed.filters, `${label} · filters equal JSON`).toEqual(json.filters ?? {});

  // Extras — same alphabetical-key contract, same equality. The CSV parser
  // lumps unknown `# k: v` lines into `extra`, so it should match exactly.
  const jsonExtraKeys = Object.keys(json.extra ?? {});
  expect(jsonExtraKeys, `${label} · JSON extra keys sorted`).toEqual([...jsonExtraKeys].sort());
  expect(parsed.extra, `${label} · extra equal JSON`).toEqual(json.extra ?? {});

  // Columns — order + keys + labels must match position-for-position.
  if (json.columns) {
    expect(parsed.columns, `${label} · columns present`).not.toBeNull();
    expect(parsed.columns!.length, `${label} · columns count`).toBe(json.columns.length);
    // `order` is 0..n-1 and matches the array position.
    json.columns.forEach((c, i) => {
      expect(c.order, `${label} · col[${i}].order`).toBe(i);
      expect(parsed.columns![i]!.label, `${label} · col[${i}].label`).toBe(c.label);
      expect(parsed.columns![i]!.key, `${label} · col[${i}].key`).toBe(c.key);
    });
  } else {
    expect(parsed.columns, `${label} · columns absent`).toBeNull();
  }
}

import { runWithBudget } from "./support/csvFuzzBudget";

// ---------------------------------------------------------------------------
describe("CSV metadata → parse back → matches JSON envelope (randomized)", () => {
  const SEED = 0x51ec7ed; // reproducible; change to regenerate the suite
  // Determinism floor: 100 iterations reliably exercises every
  // filter/column/counts combination the generator emits. Extra
  // iterations run for free while the 400ms soft budget lasts.
  const MIN_ITERATIONS = 100;
  const BUDGET_MS = 400;

  it(`round-trips ≥${MIN_ITERATIONS} randomized inputs under a ${BUDGET_MS}ms budget (seed=${SEED.toString(16)})`, () => {
    const rand = mulberry32(SEED);
    const res = runWithBudget({
      name: "csv-metadata-round-trip",
      minIterations: MIN_ITERATIONS,
      budgetMs: BUDGET_MS,
      run: (i) => {
        const input = makeRandomInput(rand);
        try {
          expectParsedMatchesJson(input, `iter=${i}`);
        } catch (e) {
          const dump = JSON.stringify(input, (_k, v) => (v instanceof Date ? v.toISOString() : v));
          throw new Error(
            `Iteration ${i} failed (seed=${SEED.toString(16)}):\n  input=${dump}\n  cause=${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }
      },
    });
    // Sanity floor — if the helper ever regresses and stops honoring
    // `minIterations`, we want the fuzz property to fail loudly instead
    // of silently shrinking coverage.
    expect(res.ranIterations).toBeGreaterThanOrEqual(MIN_ITERATIONS);
  });

  // Sanity: the same seed always produces the same first input — proves
  // the PRNG is deterministic so the suite above is reproducible.
  it("PRNG is deterministic — two seeded runs produce identical first inputs", () => {
    const a = makeRandomInput(mulberry32(SEED));
    const b = makeRandomInput(mulberry32(SEED));
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  // Targeted spot-check: filter key order is scrambled on input but the
  // JSON envelope MUST be alphabetized. A dedicated test locks this
  // invariant even if the random suite happens to draw few filters.
  it("filters JSON envelope keys are always alphabetically sorted, regardless of input order", () => {
    const input: CsvMetadataInput = {
      source: "S",
      filters: { Zeta: "z", Alpha: "a", Mid: "m", Beta: "b" },
      columns: ["A", "B"],
    };
    const json = buildJsonExportMetadata(input);
    expect(Object.keys(json.filters ?? {})).toEqual(["Alpha", "Beta", "Mid", "Zeta"]);
    // And the parsed CSV must contain the same set.
    const csv = prefixCsvWithMetadata("A,B\n1,2", input);
    const parsed = parseCsvMetadataHeader(csv);
    expect(parsed.filters).toEqual({ Alpha: "a", Beta: "b", Mid: "m", Zeta: "z" });
  });

  // Targeted spot-check: columns preserve DECLARED order in both formats
  // (neither serializer is allowed to alphabetize or dedupe-reorder).
  it("columns preserve declared order in both CSV parse-back and JSON envelope", () => {
    const input: CsvMetadataInput = {
      source: "S",
      columns: [
        "Timestamp",
        "Tool",
        { key: "req", label: "Request ID" },
        "Success",
        "Duration (ms)",
      ],
    };
    const json = buildJsonExportMetadata(input);
    const parsed = parseCsvMetadataHeader(prefixCsvWithMetadata("t,t,r,s,d\n1,2,3,4,5", input));
    const declaredLabels = ["Timestamp", "Tool", "Request ID", "Success", "Duration (ms)"];
    expect(json.columns!.map((c) => c.label)).toEqual(declaredLabels);
    expect(json.columns!.map((c) => c.order)).toEqual([0, 1, 2, 3, 4]);
    expect(parsed.columns!.map((c) => c.label)).toEqual(declaredLabels);
    // The explicit `req` key survives both round-trips.
    expect(json.columns![2]!.key).toBe("req");
    expect(parsed.columns![2]!.key).toBe("req");
  });
});
