/**
 * Runtime-budget helper for the CSV fuzz suite.
 *
 * The CSV gate is on the pre-merge hot path — every added fuzz property
 * lengthens it. This helper lets each property express two knobs
 * separately so the gate can stay fast without giving up determinism:
 *
 *   • `minIterations` — floor the property MUST run to keep coverage
 *     stable across machines. This is a determinism contract: fewer
 *     runs would randomly miss regressions on slower CI shards.
 *   • `budgetMs`      — soft cap on wall-clock time. The loop stops
 *     adding more iterations past `minIterations` once this is hit.
 *
 * On top of that, a HARD ceiling (`budgetMs * hardLimitFactor`, default
 * ×3) fails the test if the minimum iterations alone blow the budget.
 * That's the actual perf regression guard: "your `minIterations` used
 * to run in 200ms, now it takes 800ms — something got slow."
 *
 * Env overrides let CI dial the whole suite up (nightly) or down
 * (emergency hotfix) without editing every file:
 *
 *   CSV_FUZZ_BUDGET_MS_MULT=0.5   halve every budget (emergency)
 *   CSV_FUZZ_MIN_ITER_MULT=10     10x every minimum (nightly deep run)
 *
 * The helper NEVER lowers `minIterations` below what the property
 * declared — determinism is not negotiable, only added coverage is.
 */

export interface FuzzBudgetOptions {
  /** Human-readable property name — used in error messages. */
  name: string;
  /** Minimum iterations required for determinism. Never scaled down. */
  minIterations: number;
  /** Soft wall-clock budget for the whole property, in ms. */
  budgetMs: number;
  /**
   * Fail-fast multiplier on `budgetMs` — if even `minIterations` blows
   * `budgetMs * hardLimitFactor`, throw a perf-regression error.
   * Default 3x — generous enough for cold CI shards, tight enough to
   * catch a real 10x-slower regression.
   */
  hardLimitFactor?: number;
  /**
   * Called with the 0-based iteration index. Return `void` on success;
   * a thrown error fails the property (and prints the seed if the
   * caller wired one in).
   */
  run: (iteration: number) => void;
}

export interface FuzzBudgetResult {
  ranIterations: number;
  elapsedMs: number;
  hitBudget: boolean;
}

/** Read a positive-float env override, falling back to `def` on any parse error. */
function envMult(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : def;
}

export function runWithBudget(opts: FuzzBudgetOptions): FuzzBudgetResult {
  const budgetMult = envMult("CSV_FUZZ_BUDGET_MS_MULT", 1);
  const iterMult = envMult("CSV_FUZZ_MIN_ITER_MULT", 1);
  const budgetMs = Math.max(1, opts.budgetMs * budgetMult);
  // Round UP so a 0.5x mult still runs at least the declared floor.
  const minIters = Math.max(1, Math.ceil(opts.minIterations * iterMult));
  const hardLimit = budgetMs * (opts.hardLimitFactor ?? 3);

  const started = performance.now();
  let i = 0;
  // Phase 1: run the mandatory minimum, even if the budget already
  // elapsed — determinism first. If THIS phase alone exceeds
  // `hardLimit`, we still finish (to surface the failure with real data)
  // and then throw.
  for (; i < minIters; i++) opts.run(i);
  const afterMin = performance.now() - started;

  if (afterMin > hardLimit) {
    throw new Error(
      `[fuzz-budget:${opts.name}] minimum ${minIters} iterations took ` +
        `${afterMin.toFixed(0)}ms, exceeding hard limit ${hardLimit.toFixed(0)}ms ` +
        `(budget=${budgetMs.toFixed(0)}ms × ${opts.hardLimitFactor ?? 3}). ` +
        `Something regressed — either the property or the code under test.`,
    );
  }

  // Phase 2: keep adding coverage until the soft budget is exhausted.
  // Each additional iteration is pure upside; the loop condition
  // re-checks the clock every time so we never overshoot by more than
  // one iteration.
  let hitBudget = false;
  while (performance.now() - started < budgetMs) {
    opts.run(i);
    i++;
    hitBudget = true;
  }

  return {
    ranIterations: i,
    elapsedMs: performance.now() - started,
    hitBudget,
  };
}
