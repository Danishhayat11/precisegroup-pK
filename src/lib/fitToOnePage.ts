/**
 * Pure decision function for the PrintPreviewModal "Fit to one page" search.
 *
 * Extracted so we can unit-test convergence + geometry preservation without
 * mounting the full print preview. The React component wires observed page
 * counts back through this function to pick the next scale to render at.
 *
 * Invariants:
 *   • Only `scalePct` is chosen — the caller owns paper/orientation/margins.
 *   • `lo` = largest scale known to spill (>1 page); `hi` = smallest known-fitting.
 *   • Terminates on bracket collapse, iteration cap, or cycle (see guardrails).
 */

export const FIT_MIN = 50;
export const FIT_MAX = 150;
export const FIT_MAX_ITERATIONS = 12;

export type FitLogEntry = {
  iteration: number;
  currentScale: number;
  pageCount: number;
  lo: number;
  hi: number | "inf";
  fittingScales: number[];
  unstable: boolean;
  decision: "done" | "next";
  nextScale: number;
  /** One of: "converged", "iteration-cap", "cycle", "no-progress", "grow-cap", "step". */
  reason: string;
  impossible?: boolean;
};

export type FitState = {
  lo: number;
  hi: number;
  iterations: number;
  tried: Set<number>;
  done: boolean;
  impossible: boolean;
  /**
   * Instability tracking. Real-world pagination isn't strictly monotonic —
   * webkit re-layouts, font metrics, and image decoding can flip the observed
   * pageCount for the same scale between renders. We record every scale we've
   * seen fit (=1 page) so that, when instability is detected, we can prefer
   * the *smallest* known-fitting scale (largest safety margin) instead of
   * trusting `hi` alone.
   */
  fittingScales: Set<number>;
  unstable: boolean;
  /** Debug trail — appended only when `fitStep(..., { debug: true })`. */
  log: FitLogEntry[];
};

export function createFitState(): FitState {
  // `hi = Infinity` = "no fitting upper bound observed yet". Distinct from
  // FIT_MAX (the hard ceiling on user-selectable scale) so the bracket logic
  // can tell "unknown" apart from "known-fitting at 150%".
  return {
    lo: FIT_MIN - 1,
    hi: Infinity,
    iterations: 0,
    tried: new Set(),
    done: false,
    impossible: false,
    fittingScales: new Set(),
    unstable: false,
    log: [],
  };
}

export type FitDecision =
  | { kind: "done"; scalePct: number; impossible: boolean; unstable?: boolean; reason?: string }
  | { kind: "next"; scalePct: number; reason?: string };

export type FitStepOptions = {
  /** Capture a structured trace entry on `state.log` for this step. */
  debug?: boolean;
  /** Optional sink invoked with the entry (e.g. console.debug). */
  onLog?: (entry: FitLogEntry) => void;
};

/**
 * Advance the fit search by one observation. Mutates `state` in place so
 * repeat calls form the search history. Returns the next scale to render
 * (kind: "next") or the terminal scale (kind: "done").
 */
export function fitStep(
  state: FitState,
  currentScale: number,
  pageCount: number,
  options: FitStepOptions = {},
): FitDecision {
  const emit = (decision: FitDecision, reason: string): FitDecision => {
    if (options.debug) {
      const entry: FitLogEntry = {
        iteration: state.iterations,
        currentScale,
        pageCount,
        lo: state.lo,
        hi: Number.isFinite(state.hi) ? (state.hi as number) : "inf",
        fittingScales: [...state.fittingScales].sort((a, b) => a - b),
        unstable: state.unstable,
        decision: decision.kind,
        nextScale: decision.scalePct,
        reason,
        impossible: decision.kind === "done" ? decision.impossible : undefined,
      };
      state.log.push(entry);
      options.onLog?.(entry);
    }
    if (decision.kind === "done") return { ...decision, reason };
    return { ...decision, reason };
  };

  if (state.done) {
    return emit(
      {
        kind: "done",
        scalePct: currentScale,
        impossible: state.impossible,
        unstable: state.unstable,
      },
      "already-done",
    );
  }

  const wasFitting = state.fittingScales.has(currentScale);
  const nowFitting = pageCount === 1;
  if (state.tried.has(currentScale) && wasFitting !== nowFitting) {
    state.unstable = true;
  }

  state.tried.add(currentScale);
  if (nowFitting) state.fittingScales.add(currentScale);

  if (pageCount > 1) state.lo = Math.max(state.lo, currentScale);
  else if (pageCount === 1) state.hi = Math.min(state.hi, currentScale);

  const pickTerminal = (): number => {
    // When the observed pagination has been unstable, prefer the LARGEST
    // known-fitting scale so we don't over-shrink the document just because
    // one flaky measurement reported >1 page at a higher scale. `hi` alone
    // can under-shoot when the bracket is wide.
    if (state.fittingScales.size > 0) {
      return Math.max(...state.fittingScales);
    }
    if (Number.isFinite(state.hi)) return state.hi;
    return FIT_MIN;
  };

  const converged =
    (state.hi - state.lo <= 1 && Number.isFinite(state.hi)) ||
    (pageCount === 1 && currentScale >= 100 && !state.unstable);
  if (converged) {
    state.done = true;
    const target = state.unstable
      ? pickTerminal()
      : Number.isFinite(state.hi) && pageCount !== 1
        ? state.hi
        : currentScale;
    return emit(
      { kind: "done", scalePct: target, impossible: false, unstable: state.unstable },
      "converged",
    );
  }

  if (state.iterations >= FIT_MAX_ITERATIONS) {
    state.done = true;
    state.impossible = state.fittingScales.size === 0;
    const fallback = state.impossible ? FIT_MIN : pickTerminal();
    return emit(
      { kind: "done", scalePct: fallback, impossible: state.impossible, unstable: state.unstable },
      "iteration-cap",
    );
  }

  let next = currentScale;
  let stepReason = "step";
  if (pageCount > 1) {
    if (Number.isFinite(state.hi)) {
      next = Math.floor((currentScale + state.hi) / 2);
      stepReason = "bisect-down";
    } else {
      const guess = Math.floor(((currentScale / pageCount) * 98) / 100);
      next = Math.min(currentScale - 1, guess);
      stepReason = "ratio-jump";
    }
  } else if (pageCount === 1 && currentScale < 100) {
    const upper = Math.min(100, currentScale + Math.max(1, Math.floor((100 - currentScale) / 2)));
    next =
      state.lo >= FIT_MIN
        ? Math.ceil((currentScale + Math.max(state.lo, FIT_MIN - 1) + 2) / 2)
        : upper;
    next = Math.min(next, 100);
    stepReason = "grow-up";
  } else {
    state.done = true;
    return emit(
      {
        kind: "done",
        scalePct: state.unstable ? pickTerminal() : currentScale,
        impossible: false,
        unstable: state.unstable,
      },
      "grow-cap",
    );
  }

  const clamped = Math.max(FIT_MIN, Math.min(FIT_MAX, next));
  if (clamped !== next) stepReason += "+clamped";
  next = clamped;

  if (next === currentScale || state.tried.has(next)) {
    state.done = true;
    state.impossible = state.fittingScales.size === 0;
    const fallback = state.impossible ? FIT_MIN : pickTerminal();
    return emit(
      { kind: "done", scalePct: fallback, impossible: state.impossible, unstable: state.unstable },
      next === currentScale ? "no-progress" : "cycle",
    );
  }

  state.iterations += 1;
  return emit({ kind: "next", scalePct: next }, stepReason);
}
