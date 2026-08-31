/**
 * Pure state machine for what the fit summary should show right now.
 *
 * The preview modal owns three moving parts:
 *   1. `fitOnePage` — user's toggle
 *   2. `fitResult`  — most recently completed search (may be stale)
 *   3. current geometry — paper + orientation + margins the user just picked
 *
 * When any geometry knob changes, the modal resets and re-runs the fit
 * search. During that gap `fitResult` is either `null` (first run after a
 * change) or still tagged with the *previous* geometry. Rather than show
 * a stale range or a blank panel, we surface an explicit `recomputing`
 * state so the min/max/chosen summary reacts *immediately* to the change.
 */

export type FitGeometry = {
  paper: string;
  orientation: "portrait" | "landscape";
  margins: string;
};

export type CompletedFitResult = {
  scale: number;
  steps: number;
  minScale: number;
  maxScale: number | null;
  unstable: boolean;
  impossible: boolean;
  /** Geometry the search was run against. Used to detect staleness. */
  geometry: FitGeometry;
};

export type FitDisplay =
  | { status: "off" }
  | { status: "recomputing"; geometry: FitGeometry }
  | { status: "success"; result: CompletedFitResult }
  | { status: "impossible"; result: CompletedFitResult };

export function geometryKey(g: FitGeometry): string {
  return `${g.paper}|${g.orientation}|${g.margins}`;
}

export function sameGeometry(a: FitGeometry, b: FitGeometry): boolean {
  return geometryKey(a) === geometryKey(b);
}

export function deriveFitDisplay(input: {
  fitOnePage: boolean;
  fitResult: CompletedFitResult | null;
  currentGeometry: FitGeometry;
}): FitDisplay {
  const { fitOnePage, fitResult, currentGeometry } = input;
  if (!fitOnePage) return { status: "off" };
  if (!fitResult || !sameGeometry(fitResult.geometry, currentGeometry)) {
    return { status: "recomputing", geometry: currentGeometry };
  }
  return fitResult.impossible
    ? { status: "impossible", result: fitResult }
    : { status: "success", result: fitResult };
}

/** Human-readable geometry echo used in the recomputing banner. */
export function describeGeometry(g: FitGeometry): string {
  return `${g.paper} ${g.orientation}, margins ${g.margins}`;
}
