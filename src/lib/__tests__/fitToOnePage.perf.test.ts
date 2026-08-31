/**
 * Performance guardrail for the fit-to-one-page search.
 *
 * Asserts the pure `fitStep` state machine, driven through the deterministic
 * `runFit` harness in /fit-tester, always terminates well inside its declared
 * budgets — even for pathological geometry (tiny paper, giant margins, huge
 * starting scale). A regression here means the search is looping or thrashing
 * and would freeze the preview UI in production.
 *
 * Budgets are intentionally loose relative to observed cost (~0.05 ms per run
 * on CI) so we don't false-flag on noisy runners, but tight enough that a real
 * O(n^2) or infinite-loop regression trips the alarm.
 */
import { describe, it, expect } from "vitest";
import { runFit } from "@/routes/fit-tester";
import { FIT_MAX_ITERATIONS } from "@/lib/fitToOnePage";

type Case = { name: string; threshold: number; startScale: number };

// Extreme corners of the (threshold, startScale) space. `threshold` is the
// simulated single-page ceiling — below it fits, above it spills. These cover:
//   - immediate fit (nothing to search)
//   - tight fit from high start (must bisect down repeatedly)
//   - narrow feasible band near FIT_MIN (worst-case bracket collapse)
//   - infeasible (below FIT_MIN) → impossible termination
//   - roomy fit from low start (grow-up path)
const CASES: Case[] = [
  { name: "trivial fit at start", threshold: 150, startScale: 100 },
  { name: "tight fit from ceiling", threshold: 51, startScale: 150 },
  { name: "narrow band near floor", threshold: 50, startScale: 150 },
  { name: "infeasible (below FIT_MIN)", threshold: 40, startScale: 150 },
  { name: "grow-up from low start", threshold: 120, startScale: 50 },
  { name: "midrange bisect", threshold: 82, startScale: 100 },
  { name: "ceiling start, roomy", threshold: 140, startScale: 150 },
  { name: "floor start, spills", threshold: 49, startScale: 50 },
];

// Absolute cap includes a safety margin over FIT_MAX_ITERATIONS (12) because
// `runFit` counts every emitted log entry, including the terminal "done".
const MAX_STEPS = FIT_MAX_ITERATIONS + 4;

// CI runners are noisy (shared cores, JIT warm-up, GC pauses). We defend
// against flakes on two axes:
//   1. Drop per-case single-shot wall-clock assertions — a cold-start GC
//      spike on one 0.05ms call is meaningless signal. Step counts remain
//      the deterministic correctness guard.
//   2. For the aggregate sweep, warm the JIT and take the fastest of N
//      samples so a single scheduler hiccup can't fail the run.
// A `PERF_BUDGET_MULT` env multiplier lets slow CI tiers dial the budget
// up without editing the test.
const BUDGET_MULT = Math.max(1, Number.parseFloat(process.env.PERF_BUDGET_MULT ?? "1") || 1);

const SWEEP_RUNS = 1000;
// Base budget was 200ms on a single unwarmed sample. Observed cost is
// ~10-30ms per warmed sweep; 500ms leaves >10x headroom for CI drift while
// still tripping on a real O(n^2) regression (which would blow past seconds).
const MAX_MS_PER_SWEEP = 500 * BUDGET_MULT;
const SWEEP_SAMPLES = 3;

function timeSweep(): number {
  const t0 = performance.now();
  let maxSteps = 0;
  for (let i = 0; i < SWEEP_RUNS; i++) {
    const c = CASES[i % CASES.length];
    const r = runFit(c.threshold, c.startScale);
    if (r.steps > maxSteps) maxSteps = r.steps;
  }
  const elapsed = performance.now() - t0;
  // Attach step count to the elapsed via a side channel so callers can
  // assert both without re-running the loop.
  (timeSweep as unknown as { lastMaxSteps: number }).lastMaxSteps = maxSteps;
  return elapsed;
}

describe("fitToOnePage performance", () => {
  it.each(CASES)("$name stays inside the step budget", ({ threshold, startScale }) => {
    // Correctness-only assertion. Wall-clock on a single ~0.05ms call is
    // dominated by scheduler/GC noise on CI and produces false failures.
    const result = runFit(threshold, startScale);
    expect(result.steps).toBeLessThanOrEqual(MAX_STEPS);
  });

  it(`sweeps ${SWEEP_RUNS} extreme runs under ${MAX_MS_PER_SWEEP}ms with no step overruns`, () => {
    // Warm-up: prime the JIT and inline caches so the first timed sample
    // isn't measuring compile cost.
    timeSweep();

    // Best-of-N: a real perf regression is systemic and will fail every
    // sample; a scheduler blip only affects one, so min() rejects noise.
    let bestElapsed = Infinity;
    let worstSteps = 0;
    for (let s = 0; s < SWEEP_SAMPLES; s++) {
      const elapsed = timeSweep();
      if (elapsed < bestElapsed) bestElapsed = elapsed;
      const stepsThisSample = (timeSweep as unknown as { lastMaxSteps: number }).lastMaxSteps;
      if (stepsThisSample > worstSteps) worstSteps = stepsThisSample;
    }

    expect(worstSteps).toBeLessThanOrEqual(MAX_STEPS);
    expect(bestElapsed).toBeLessThan(MAX_MS_PER_SWEEP);
  });

  it("never exceeds FIT_MAX_ITERATIONS+4 for any scan across the full threshold range", () => {
    // Full grid: every integer threshold in [30, 160] × a handful of start
    // scales. ~1000 runs — cheap, but exhaustively covers every branch of the
    // bracket state machine.
    const starts = [50, 75, 100, 125, 150];
    let worst = { steps: 0, threshold: 0, startScale: 0 };
    for (let threshold = 30; threshold <= 160; threshold++) {
      for (const startScale of starts) {
        const r = runFit(threshold, startScale);
        if (r.steps > worst.steps) worst = { steps: r.steps, threshold, startScale };
      }
    }
    expect(worst.steps, `worst case: ${JSON.stringify(worst)}`).toBeLessThanOrEqual(MAX_STEPS);
  });
});
