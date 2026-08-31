/**
 * Unit tests for `runWithBudget` — pins the determinism-vs-budget
 * contract so downstream fuzz files can rely on it.
 */
import { describe, it, expect } from "vitest";
import { runWithBudget } from "../csvFuzzBudget";

describe("runWithBudget — determinism floor", () => {
  it("runs at least `minIterations` even when budgetMs is tiny", () => {
    let ran = 0;
    const res = runWithBudget({
      name: "floor",
      minIterations: 50,
      budgetMs: 1, // effectively 0 budget — floor must still win
      run: () => {
        ran++;
      },
    });
    expect(ran).toBeGreaterThanOrEqual(50);
    expect(res.ranIterations).toBe(ran);
  });

  it("adds extra iterations past the floor while budget remains", () => {
    // Deliberately trivial workload so we get hundreds of extras.
    const res = runWithBudget({
      name: "extras",
      minIterations: 1,
      budgetMs: 20,
      run: () => {
        // no-op
      },
    });
    expect(res.ranIterations).toBeGreaterThan(1);
    expect(res.hitBudget).toBe(true);
  });
});

describe("runWithBudget — hard perf ceiling", () => {
  it("throws when the minimum alone blows budgetMs * hardLimitFactor", () => {
    expect(() =>
      runWithBudget({
        name: "regression",
        minIterations: 3,
        budgetMs: 5,
        hardLimitFactor: 1.5, // hard limit = 7.5ms
        // 20ms per iter × 3 = 60ms — way over the hard limit.
        run: () => {
          const stop = performance.now() + 20;
          // eslint-disable-next-line no-empty
          while (performance.now() < stop) {}
        },
      }),
    ).toThrowError(/fuzz-budget:regression.*exceeding hard limit/);
  });

  it("does NOT throw when the minimum fits under the hard limit but exceeds soft budget", () => {
    // 3 × 5ms = 15ms > budget 5ms, but <= hardLimit 5*4 = 20ms → OK.
    const res = runWithBudget({
      name: "soft-only",
      minIterations: 3,
      budgetMs: 5,
      hardLimitFactor: 4,
      run: () => {
        const stop = performance.now() + 5;
        // eslint-disable-next-line no-empty
        while (performance.now() < stop) {}
      },
    });
    expect(res.ranIterations).toBe(3);
  });
});

describe("runWithBudget — env multipliers", () => {
  const savedMin = process.env.CSV_FUZZ_MIN_ITER_MULT;
  const savedBudget = process.env.CSV_FUZZ_BUDGET_MS_MULT;
  afterEachRestore(savedMin, savedBudget);

  it("CSV_FUZZ_MIN_ITER_MULT scales the floor (rounded up, never down below 1)", () => {
    process.env.CSV_FUZZ_MIN_ITER_MULT = "3";
    let ran = 0;
    runWithBudget({
      name: "scaled",
      minIterations: 4,
      budgetMs: 1,
      run: () => {
        ran++;
      },
    });
    expect(ran).toBeGreaterThanOrEqual(12); // 4 × 3
  });

  it("CSV_FUZZ_BUDGET_MS_MULT scales the soft budget (fewer extras with smaller mult)", () => {
    // Bake in a slow-enough workload that iteration count is visibly
    // bounded by wall clock (1ms per iter × N ≈ elapsed ms). Then run
    // once with mult=1 and once with mult=0.1 and check the smaller
    // multiplier finished FEWER iterations.
    const slow = () => {
      const stop = performance.now() + 1;
      // eslint-disable-next-line no-empty
      while (performance.now() < stop) {}
    };
    delete process.env.CSV_FUZZ_BUDGET_MS_MULT;
    const big = runWithBudget({ name: "big", minIterations: 1, budgetMs: 50, run: slow });
    process.env.CSV_FUZZ_BUDGET_MS_MULT = "0.1";
    const small = runWithBudget({ name: "small", minIterations: 1, budgetMs: 50, run: slow });
    expect(small.ranIterations).toBeLessThan(big.ranIterations);
  });

  it("invalid env values fall back to 1x (no crash)", () => {
    process.env.CSV_FUZZ_MIN_ITER_MULT = "not-a-number";
    process.env.CSV_FUZZ_BUDGET_MS_MULT = "-5";
    let ran = 0;
    runWithBudget({
      name: "invalid-env",
      minIterations: 3,
      budgetMs: 1,
      run: () => {
        ran++;
      },
    });
    expect(ran).toBeGreaterThanOrEqual(3);
  });
});

// Vitest reset helper — restores the env vars mutated above after each
// test so we don't leak state into subsequent suites in the same file.
import { afterEach } from "vitest";
function afterEachRestore(savedMin: string | undefined, savedBudget: string | undefined) {
  afterEach(() => {
    if (savedMin === undefined) delete process.env.CSV_FUZZ_MIN_ITER_MULT;
    else process.env.CSV_FUZZ_MIN_ITER_MULT = savedMin;
    if (savedBudget === undefined) delete process.env.CSV_FUZZ_BUDGET_MS_MULT;
    else process.env.CSV_FUZZ_BUDGET_MS_MULT = savedBudget;
  });
}
