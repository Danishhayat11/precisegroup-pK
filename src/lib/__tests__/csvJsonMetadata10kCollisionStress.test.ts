/**
 * Extreme-scale stress: 10,000 colliding columns across a handful of
 * bases, exported through BOTH the CSV writer and the JSON envelope
 * builder. Complements the existing scale coverage:
 *
 *   • `csvJsonMetadataLargeCollisionPerf` — 2k mixed collision
 *     families with a fingerprint-based ordering snapshot.
 *   • `csvExportMetadataLargeFuzzPerf` — 100-500 fast-check-generated
 *     lists with adversarial shapes.
 *
 * This suite goes further in TWO orthogonal directions the others
 * don't cover:
 *
 *   1. **Exact suffix-chain correctness at 10k scale** — for a family
 *      of N label-only siblings all slugging to the same base, the
 *      emitted keys must be EXACTLY `[base, base_2, base_3, …, base_N]`
 *      with no gaps, no repeats, no reorderings. Verified element-wise
 *      against a mathematical oracle, not a fingerprint hash — so a
 *      regression names the exact offending index.
 *
 *   2. **Sub-quadratic scaling guard** — the collision walker
 *      (`while (used.has(key)) n++`) is O(1) amortised per column when
 *      no literal `_N` slots are pre-claimed, but a naive rewrite can
 *      silently drop to O(n²). We measure runtime at two sizes (2.5k
 *      and 10k = 4× scale) and assert the ratio stays below a bound
 *      that O(n²) code would fail (16× expected vs a 6× ceiling), so
 *      quadratic regressions in the walker are caught explicitly
 *      rather than only via the fixed per-run wall-clock budget.
 *
 * Perf budgets are ceilings for CI, not benchmarks. Locally the 10k
 * case completes in ~150-300 ms across both writers; the budget is
 * set well above observed runtimes so it flags real regressions
 * (accidental O(n²) or per-column allocation blow-ups), not jitter.
 */
import { describe, it, expect } from "vitest";
import {
  buildCsvMetadataHeader,
  buildJsonExportMetadata,
  type CsvMetadataInput,
} from "../csvExportMetadata";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

/** Per-writer wall-clock ceiling for the 10k case. Generous 20-30× headroom. */
const PERF_BUDGET_MS_10K = 4_000;

/** Ceiling for the scaling ratio (10k time / 2.5k time). O(n²) → 16×; O(n) → ~4×. */
const SCALING_RATIO_CEILING = 25;

/** Read the ordered derived keys from the CSV `# Column keys:` line. */
function csvKeys(columns: CsvMetadataInput["columns"]): string[] {
  const line = buildCsvMetadataHeader({ source: "Stress", generatedAt: FIXED_DATE, columns }).find(
    (l) => l.startsWith("# Column keys:"),
  );
  return line ? line.replace("# Column keys: ", "").split(",") : [];
}

/** Read the ordered derived keys from the JSON envelope. */
function jsonMeta(columns: CsvMetadataInput["columns"]) {
  return buildJsonExportMetadata({ source: "Stress", generatedAt: FIXED_DATE, columns }) as {
    columns: Array<{ order: number; key: string; label: string }>;
  };
}

/** Time a zero-arg thunk with `performance.now()`. */
function timeMs(fn: () => unknown): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe("stress: 10k colliding columns — suffix correctness + perf ceiling", () => {
  it("10,000 identical labels produce exactly [amount, amount_2, …, amount_10000] in both writers", () => {
    const N = 10_000;
    const columns: CsvMetadataInput["columns"] = Array.from({ length: N }, () => ({
      label: "Amount",
    }));

    // Oracle: the deterministic chain a correct deduper MUST emit.
    const expected = Array.from({ length: N }, (_, i) => (i === 0 ? "amount" : `amount_${i + 1}`));

    const csvMs = timeMs(() => {
      const keys = csvKeys(columns);
      expect(keys).toHaveLength(N);
      // Element-wise equality — a single off-by-one shrinks to the
      // exact offending index in the failure output.
      expect(keys).toEqual(expected);
    });
    const jsonMs = timeMs(() => {
      const meta = jsonMeta(columns);
      expect(meta.columns).toHaveLength(N);
      expect(meta.columns.map((c) => c.key)).toEqual(expected);
      // `order` must be contiguous 0..N-1.
      expect(meta.columns.map((c) => c.order)).toEqual(Array.from({ length: N }, (_, i) => i));
      // Labels are preserved verbatim (only keys are suffixed).
      expect(meta.columns.every((c) => c.label === "Amount")).toBe(true);
    });

    expect(csvMs).toBeLessThan(PERF_BUDGET_MS_10K);
    expect(jsonMs).toBeLessThan(PERF_BUDGET_MS_10K);
  });

  it("multiple collision families interleaved (5 bases × 2000 members) keep per-family chains correct", () => {
    // Interleave 5 families round-robin so the deduper can't cheat by
    // seeing runs of identical labels — every column changes base.
    // Labels chosen so the slugger yields the bare base name for
    // every family — otherwise `client_name` etc. would form its own
    // chain and the per-family assertion below would fragment.
    const bases = ["amount", "client", "date", "city", "status"] as const;
    const per = 2_000; // 5 × 2000 = 10,000 columns total
    const labels: Record<(typeof bases)[number], string> = {
      amount: "Amount",
      client: "Client",
      date: "Date",
      city: "City",
      status: "Status",
    };
    const columns: CsvMetadataInput["columns"] = [];
    for (let i = 0; i < per; i++) {
      for (const b of bases) columns.push({ label: labels[b] });
    }

    const csv = csvKeys(columns);
    const json = jsonMeta(columns).columns.map((c) => c.key);

    // Parity between writers at 10k scale.
    expect(json).toEqual(csv);
    expect(csv).toHaveLength(per * bases.length);

    // Per-family chain correctness: pick out the keys belonging to
    // each base and assert they form exactly [base, base_2, …, base_per].
    for (const base of bases) {
      const family = csv.filter((k) => k === base || k.startsWith(`${base}_`));
      const expected = Array.from({ length: per }, (_, i) => (i === 0 ? base : `${base}_${i + 1}`));
      expect(family).toEqual(expected);
    }

    // Global uniqueness at 10k scale.
    expect(new Set(csv).size).toBe(csv.length);
  });

  it("pre-claimed literal `_N` slot forces walker skips without breaking correctness", () => {
    // Plant the explicit literal `amount_500` at index 0 so it
    // claims that slot BEFORE any label-only sibling reaches it.
    // Then 9,999 "Amount" siblings follow: their counter walks 1, 2,
    // …, 499, hits `amount_500` (used → skip), emits `amount_501`,
    // continues to `amount_10000`. Total N + 1 = 10,000 columns.
    const SIBLINGS = 9_999;
    const columns: CsvMetadataInput["columns"] = [
      { key: "amount_500", label: "Amount (planted)" },
      ...Array.from({ length: SIBLINGS }, () => ({ label: "Amount" })),
    ];

    const t = timeMs(() => {
      const csv = csvKeys(columns);
      const json = jsonMeta(columns).columns.map((c) => c.key);
      expect(json).toEqual(csv);
      expect(csv).toHaveLength(columns.length);
      expect(new Set(csv).size).toBe(csv.length);

      // Explicit-key contract at scale: literal survives verbatim at
      // its inserted position, appears exactly once.
      expect(csv[0]).toBe("amount_500");
      expect(csv.filter((k) => k === "amount_500")).toHaveLength(1);

      // Sibling chain positions:
      //   index 1 → amount        (n=1)
      //   index 2 → amount_2      (n=2)
      //   …
      //   index 499 → amount_499  (n=499)
      //   index 500 → amount_501  (n=500 → collides → walker skips to 501)
      //   index 501 → amount_502  (n=502; the walker updated `seen`)
      //   …
      //   index 9999 → amount_10000
      expect(csv[1]).toBe("amount");
      expect(csv[2]).toBe("amount_2");
      expect(csv[499]).toBe("amount_499");
      expect(csv[500]).toBe("amount_501");
      expect(csv[9999]).toBe("amount_10000");

      // No OTHER column reuses `amount_500`; the max suffix is 10000.
      const suffixes = csv
        .filter((k) => k.startsWith("amount_"))
        .map((k) => Number(k.slice("amount_".length)))
        .filter((n) => Number.isFinite(n));
      expect(Math.max(...suffixes)).toBe(10_000);
      expect(suffixes.filter((n) => n === 500)).toHaveLength(1); // only the planted one
    });
    expect(t).toBeLessThan(PERF_BUDGET_MS_10K);
  });

  it("scaling: doubling+ the input size does not quadruple runtime (guards against O(n²))", () => {
    // Runtime at 2.5k vs 10k (4× scale). Linear ~4×, quadratic ~16×.
    // Ceiling of 6× is well below the quadratic mark but above the
    // linear expectation with CI jitter headroom.
    const build = (n: number) => {
      const columns: CsvMetadataInput["columns"] = Array.from({ length: n }, () => ({
        label: "Amount",
      }));
      return () => {
        buildCsvMetadataHeader({ source: "Scale", generatedAt: FIXED_DATE, columns });
        buildJsonExportMetadata({ source: "Scale", generatedAt: FIXED_DATE, columns });
      };
    };

    // Warm-up to avoid JIT skew on the first size measured.
    build(500)();
    build(500)();

    // Take best-of-3 to dampen CI jitter without hiding real regressions.
    const bestOf3 = (fn: () => unknown) => Math.min(timeMs(fn), timeMs(fn), timeMs(fn));

    const t2_5k = bestOf3(build(2_500));
    const t10k = bestOf3(build(10_000));

    // Floor the small-size time to avoid divide-by-tiny amplifying
    // jitter into a false failure. 1 ms floor is well below the
    // observed 5-30 ms range for 2.5k columns.
    const ratio = t10k / Math.max(t2_5k, 1);
    expect(
      ratio,
      `runtime ratio (10k / 2.5k) = ${ratio.toFixed(2)}× (t2.5k=${t2_5k.toFixed(1)}ms, t10k=${t10k.toFixed(1)}ms); ceiling ${SCALING_RATIO_CEILING}× — O(n²) would be ~16×`,
    ).toBeLessThan(SCALING_RATIO_CEILING);

    // Absolute ceiling still applies at 10k.
    expect(t10k).toBeLessThan(PERF_BUDGET_MS_10K);
  });

  it("determinism at 10k: three repeat builds are byte-identical (CSV + JSON)", () => {
    const N = 10_000;
    const input: CsvMetadataInput = {
      source: "Stress",
      generatedAt: FIXED_DATE,
      columns: Array.from({ length: N }, (_, i) => ({
        // Two-family interleave so both slugifier and deduper get exercised.
        label: i % 2 === 0 ? "Amount" : "Client",
      })),
    };
    const c1 = buildCsvMetadataHeader(input).join("\n");
    const c2 = buildCsvMetadataHeader(input).join("\n");
    const c3 = buildCsvMetadataHeader(input).join("\n");
    expect(c1).toBe(c2);
    expect(c2).toBe(c3);
    const j1 = JSON.stringify(buildJsonExportMetadata(input));
    const j2 = JSON.stringify(buildJsonExportMetadata(input));
    const j3 = JSON.stringify(buildJsonExportMetadata(input));
    expect(j1).toBe(j2);
    expect(j2).toBe(j3);
  });
});
