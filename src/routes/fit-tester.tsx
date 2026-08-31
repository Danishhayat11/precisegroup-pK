/**
 * /fit-tester — Auto-fit validation harness.
 *
 * Purpose:
 *   Deterministic UI wrapper around `fitToOnePage.ts` so we can (a) eyeball
 *   the search behaviour outside PrintPreviewModal, and (b) let automated
 *   scripts (Playwright/Vitest-DOM) assert on the terminal `Final Scale` and
 *   `Search Step Count` without mounting the whole print pipeline.
 *
 * Determinism:
 *   The real modal observes browser pagination (noisy). Here we simulate a
 *   monotonic layout: page count = ceil(contentPct / currentScale). The user
 *   picks a `Target fit threshold` — the largest scale that yields 1 page.
 *   That's enough to exercise every code path in fitStep (grow, bisect,
 *   ratio-jump, converge) with reproducible output.
 *
 * Test hooks (STABLE — do not rename without updating e2e specs):
 *   data-testid="fit-final-scale"     — numeric % of terminal scalePct
 *   data-testid="fit-step-count"      — total observations fed to fitStep
 *   data-testid="fit-status"          — "idle" | "running" | "complete"
 *   data-testid="fit-run"             — trigger button
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { createFitState, fitStep, FIT_MAX, FIT_MIN, type FitLogEntry } from "@/lib/fitToOnePage";
import { recordFitRun, downloadLatestFitTrail } from "@/lib/fitTelemetry";

export const Route = createFileRoute("/fit-tester")({
  head: () => ({
    meta: [
      { title: "Auto-Fit Validator · Precise" },
      {
        name: "description",
        content:
          "Deterministic harness for the print auto-fit search: inspect final scale, step count, and the full decision trail.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { name: "googlebot", content: "noindex, nofollow" },
    ],
  }),
  component: FitTesterPage,
});

type RunResult = {
  finalScale: number;
  steps: number;
  impossible: boolean;
  unstable: boolean;
  trail: FitLogEntry[];
  thresholdUsed: number;
  startScale: number;
};

/** Simulated pagination: 1 page iff currentScale <= threshold, else scales up. */
function simulatePageCount(scale: number, threshold: number): number {
  if (scale <= threshold) return 1;
  // Smooth ramp so ratio-jump has something meaningful to divide against.
  return Math.max(2, Math.ceil((scale / threshold) * 1.0));
}

export function runFit(threshold: number, startScale: number): RunResult {
  const state = createFitState();
  let current = startScale;
  const trail: FitLogEntry[] = [];
  // Safety net beyond fitStep's internal cap.
  for (let i = 0; i < 32; i++) {
    const pages = simulatePageCount(current, threshold);
    const decision = fitStep(state, current, pages, {
      debug: true,
      onLog: (e) => trail.push(e),
    });
    state.iterations += 1;
    if (decision.kind === "done") {
      const result: RunResult = {
        finalScale: decision.scalePct,
        steps: trail.length,
        impossible: decision.impossible,
        unstable: !!decision.unstable,
        trail,
        thresholdUsed: threshold,
        startScale,
      };
      recordFitRun({
        source: "tester",
        finalScale: result.finalScale,
        steps: result.steps,
        impossible: result.impossible,
        unstable: result.unstable,
        log: trail,
        context: { threshold, startScale },
      });
      return result;
    }
    current = decision.scalePct;
  }
  const fallback: RunResult = {
    finalScale: current,
    steps: trail.length,
    impossible: true,
    unstable: state.unstable,
    trail,
    thresholdUsed: threshold,
    startScale,
  };
  recordFitRun({
    source: "tester",
    finalScale: fallback.finalScale,
    steps: fallback.steps,
    impossible: fallback.impossible,
    unstable: fallback.unstable,
    log: trail,
    context: { threshold, startScale, exhaustedSafetyLoop: true },
  });
  return fallback;
}

type Status = "idle" | "running" | "complete";

export function FitTesterPage() {
  const reduce = useReducedMotion();
  const [threshold, setThreshold] = useState(82);
  const [startScale, setStartScale] = useState(100);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<RunResult | null>(null);
  const runId = useRef(0);

  const run = () => {
    const id = ++runId.current;
    setStatus("running");
    setResult(null);
    // Yield so the "running" transition is observable to tests & humans.
    setTimeout(() => {
      if (runId.current !== id) return;
      const r = runFit(threshold, startScale);
      setResult(r);
      setStatus("complete");
    }, 220);
  };

  const reset = () => {
    runId.current++;
    setResult(null);
    setStatus("idle");
  };

  const stateBadge = useMemo(() => {
    if (status === "idle")
      return {
        label: "Idle",
        cls: "bg-slate-200/60 text-slate-700 dark:bg-white/10 dark:text-slate-200",
      };
    if (status === "running")
      return {
        label: "Running",
        cls: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200",
      };
    return {
      label: result?.impossible ? "Impossible" : "Complete",
      cls: result?.impossible
        ? "bg-rose-100 text-rose-900 dark:bg-rose-500/20 dark:text-rose-200"
        : "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200",
    };
  }, [status, result]);

  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground antialiased">
      <div className="mx-auto grid max-w-6xl gap-6">
        {/* Header */}
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Print pipeline · QA
            </p>
            <h1 className="mt-1 truncate font-display font-semibold tracking-tight">
              Auto-Fit Validator
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Deterministic wrapper around{" "}
              <code className="rounded bg-slate-200/70 px-1.5 py-0.5 font-mono text-[12px] dark:bg-white/10">
                fitStep()
              </code>
              . Set a simulated fitting threshold and starting scale, then run the search to inspect
              the terminal scale and decision trail.
            </p>
          </div>
          <span
            data-testid="fit-status"
            data-status={status}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${stateBadge.cls}`}
          >
            {stateBadge.label}
          </span>
        </header>

        {/* Controls */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03]">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto]">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Fitting threshold (%)
              </span>
              <input
                data-testid="fit-threshold"
                type="number"
                min={FIT_MIN}
                max={FIT_MAX}
                value={threshold}
                onChange={(e) =>
                  setThreshold(Math.max(FIT_MIN, Math.min(FIT_MAX, Number(e.target.value) || 0)))
                }
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm tabular-nums shadow-inner focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-white/10 dark:bg-white/5"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Start scale (%)
              </span>
              <input
                data-testid="fit-start-scale"
                type="number"
                min={FIT_MIN}
                max={FIT_MAX}
                value={startScale}
                onChange={(e) =>
                  setStartScale(Math.max(FIT_MIN, Math.min(FIT_MAX, Number(e.target.value) || 0)))
                }
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm tabular-nums shadow-inner focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-white/10 dark:bg-white/5"
              />
            </label>
            <button
              data-testid="fit-run"
              onClick={run}
              disabled={status === "running"}
              className="h-10 self-end rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-sky-500 dark:hover:bg-sky-400"
            >
              {status === "running" ? "Running…" : "Run fit search"}
            </button>
            <button
              data-testid="fit-reset"
              onClick={reset}
              disabled={status === "idle"}
              className="h-10 self-end rounded-lg border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
            >
              Reset
            </button>
            <button
              data-testid="fit-export-trail"
              onClick={() => downloadLatestFitTrail()}
              disabled={status !== "complete"}
              title="Download the latest fit search trail as JSON for bug reports"
              className="h-10 self-end rounded-lg border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
            >
              Export trail JSON
            </button>
          </div>
        </section>

        {/* Summary metrics */}
        <section aria-label="Auto-fit summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            testId="fit-final-scale-card"
            label="Final Scale"
            value={result ? `${result.finalScale}%` : "—"}
            valueTestId="fit-final-scale"
            valueDataAttr={result ? String(result.finalScale) : undefined}
            hint={
              result
                ? result.impossible
                  ? "No fitting scale found"
                  : "Terminal scalePct from fitStep"
                : "Run the search to populate"
            }
            emphasis
            complete={status === "complete"}
            reduce={reduce}
          />
          <MetricCard
            testId="fit-step-count-card"
            label="Search Step Count"
            value={result ? String(result.steps) : "—"}
            valueTestId="fit-step-count"
            valueDataAttr={result ? String(result.steps) : undefined}
            hint={
              result
                ? `Observations across ${result.trail.length} iteration${result.trail.length === 1 ? "" : "s"}`
                : "Total fitStep observations"
            }
            badge={result ? `${result.steps} step${result.steps === 1 ? "" : "s"}` : undefined}
            emphasis
            complete={status === "complete"}
            reduce={reduce}
          />
          <MetricCard
            testId="fit-stability-card"
            label="Stability"
            value={result ? (result.unstable ? "Unstable" : "Stable") : "—"}
            hint={result?.unstable ? "Same scale flipped pageCount" : "Monotonic across the run"}
            complete={status === "complete"}
            reduce={reduce}
          />
          <MetricCard
            testId="fit-threshold-card"
            label="Threshold used"
            value={result ? `${result.thresholdUsed}%` : `${threshold}%`}
            hint={`Start ${result?.startScale ?? startScale}% · range ${FIT_MIN}–${FIT_MAX}%`}
            complete={status === "complete"}
            reduce={reduce}
          />
        </section>

        {/* Decision trail */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03]">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-white/[0.08]">
            <h2 className="text-sm font-semibold">Decision trail</h2>
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {result ? `${result.trail.length} entries` : "awaiting run"}
            </span>
          </div>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-background/80 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">#</th>
                  <th className="px-4 py-2.5">Scale</th>
                  <th className="px-4 py-2.5">Pages</th>
                  <th className="px-4 py-2.5">Lo</th>
                  <th className="px-4 py-2.5">Hi</th>
                  <th className="px-4 py-2.5">Next</th>
                  <th className="px-4 py-2.5">Reason</th>
                </tr>
              </thead>
              <tbody data-testid="fit-trail" className="font-mono text-[13px] tabular-nums">
                {result?.trail.length ? (
                  result.trail.map((e, i) => (
                    <tr
                      key={i}
                      className="border-t border-slate-100 hover:bg-slate-50/60 dark:border-white/[0.05] dark:hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-2 text-slate-500">{i + 1}</td>
                      <td className="px-4 py-2">{e.currentScale}%</td>
                      <td
                        className={`px-4 py-2 ${e.pageCount === 1 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-700 dark:text-slate-300"}`}
                      >
                        {e.pageCount}
                      </td>
                      <td className="px-4 py-2 text-slate-500">{e.lo}</td>
                      <td className="px-4 py-2 text-slate-500">
                        {typeof e.hi === "number" ? e.hi : "∞"}
                      </td>
                      <td className="px-4 py-2">{e.nextScale}%</td>
                      <td className="px-4 py-2 text-slate-500">{e.reason}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-10 text-center font-sans text-sm text-slate-500 dark:text-slate-400"
                    >
                      {status === "running"
                        ? "Searching…"
                        : "Run the search to see per-iteration decisions."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Completion overlay/pulse — subtle affordance for humans; tests key off data-status. */}
        <AnimatePresence>
          {status === "complete" && !reduce && (
            <motion.div
              key="pulse"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              aria-hidden
              className="pointer-events-none fixed inset-x-0 bottom-6 mx-auto h-1 max-w-md rounded-full bg-emerald-400/60"
            />
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}

function MetricCard({
  label,
  value,
  hint,
  testId,
  valueTestId,
  valueDataAttr,
  badge,
  emphasis,
  complete,
  reduce,
}: {
  label: string;
  value: string;
  hint?: string;
  testId?: string;
  valueTestId?: string;
  valueDataAttr?: string;
  badge?: string;
  emphasis?: boolean;
  complete?: boolean;
  reduce?: boolean | null;
}) {
  return (
    <motion.div
      data-testid={testId}
      initial={false}
      animate={complete && !reduce ? { scale: [1, 1.02, 1] } : { scale: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] as const }}
      className={`relative overflow-hidden rounded-2xl border p-5 shadow-sm ${
        emphasis
          ? "border-slate-900/10 bg-white dark:border-white/[0.1] dark:bg-white/[0.04]"
          : "border-slate-200 bg-white dark:border-white/[0.08] dark:bg-white/[0.03]"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
          {label}
        </span>
        {badge && (
          <span
            data-testid={valueTestId ? `${valueTestId}-badge` : undefined}
            className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-700 dark:bg-sky-500/20 dark:text-sky-300"
          >
            {badge}
          </span>
        )}
      </div>
      <div
        data-testid={valueTestId}
        data-value={valueDataAttr}
        className={`mt-3 font-display font-semibold tabular-nums tracking-tight ${
          emphasis ? "text-4xl sm:text-5xl" : "text-2xl"
        }`}
      >
        {value}
      </div>
      {hint && (
        <p className="mt-2 text-xs leading-snug text-slate-500 dark:text-slate-400">{hint}</p>
      )}
      {complete && emphasis && !reduce && (
        <motion.span
          aria-hidden
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] as const }}
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-gradient-to-r from-emerald-400 via-sky-400 to-violet-400"
        />
      )}
    </motion.div>
  );
}
