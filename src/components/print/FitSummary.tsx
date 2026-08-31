/**
 * Presentational summary for the fit-to-one-page search result.
 *
 * Extracted out of PrintPreviewModal so we can unit-test the exact
 * displayed min/max bracket and chosen scale — including the amber
 * fallback path — without mounting the whole preview.
 *
 * Two shapes, both driven by the same `fitResult` prop:
 *   • Success (emerald): "Auto-fit settled at N% ..." + explored range.
 *   • Impossible (amber): "Clamp range explored ... fell back to N%".
 */

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type FitSummaryResult = {
  scale: number;
  steps: number;
  minScale: number;
  maxScale: number | null;
  unstable: boolean;
};

export type FitSummaryProps = {
  fitResult: FitSummaryResult;
  impossible: boolean;
  /**
   * Optional "recomputing" banner shown when the underlying geometry
   * (paper / orientation / margins) just changed and a fresh search is
   * still in flight. When set, this replaces the success / impossible
   * panel so the user sees an immediate acknowledgement of the change.
   */
  recomputing?: { paper: string; orientation: string; margins: string } | null;
};

function FormattedRange({
  min,
  max,
  fallback,
}: {
  min: number;
  max: number | null;
  fallback: string;
}): ReactNode {
  return (
    <>
      <span className="tabular-nums" data-testid="fit-summary-min">
        {min}%
      </span>
      {" – "}
      <span className="tabular-nums" data-testid="fit-summary-max">
        {max != null ? `${max}%` : fallback}
      </span>
    </>
  );
}

/**
 * Small info affordance that opens a legend explaining the three numbers
 * shown in the fit summary. Rendered as a real button so it is keyboard
 * reachable and screen-reader friendly.
 */
function FitLegend({ impossible }: { impossible: boolean }) {
  const chosenLine = impossible
    ? "Chosen (clamped): the scale we fell back to because nothing in the explored range fit — usually the floor."
    : "Chosen (clamped): the scale we locked in — the tightest value proven to fit on one page, clamped inside the explored range.";

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-testid="fit-summary-legend-trigger"
            aria-label="What do min, max, and chosen scale mean?"
            className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-current/70 hover:text-current focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current/60"
          >
            <Info className="h-3 w-3" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          data-testid="fit-summary-legend"
          className="max-w-[260px] text-[11px] leading-snug"
        >
          <p className="mb-1 font-semibold">How to read this range</p>
          <ul className="space-y-1">
            <li>
              <span className="font-medium">Min scale:</span> the smallest scale the search was ever
              willing to try (the safety floor).
            </li>
            <li>
              <span className="font-medium">Max scale:</span> the largest scale observed to still
              fit on a single page during the search.
            </li>
            <li>{chosenLine}</li>
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function FitSummary({ fitResult, impossible, recomputing }: FitSummaryProps) {
  if (recomputing) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="fit-summary-recomputing"
        data-fit-geometry={`${recomputing.paper}|${recomputing.orientation}|${recomputing.margins}`}
        className="mt-1 rounded border border-sky-500/40 bg-sky-500/10 px-2 py-1.5 text-[10.5px] leading-snug text-sky-700 dark:text-sky-300"
      >
        <span className="inline-flex items-center">
          Recomputing fit for{" "}
          <span className="ml-1 font-semibold" data-testid="fit-summary-recomputing-geometry">
            {recomputing.paper} {recomputing.orientation}, margins {recomputing.margins}
          </span>
          …
        </span>
      </div>
    );
  }
  if (impossible) {
    return (
      <div
        role="status"
        data-testid="fit-summary-impossible"
        data-fit-scale={fitResult.scale}
        className="mt-1 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-[10.5px] leading-snug text-amber-700 dark:text-amber-300"
      >
        <span className="inline-flex items-center">
          Clamp range explored
          <FitLegend impossible />
        </span>
        {": "}
        <FormattedRange min={fitResult.minScale} max={fitResult.maxScale} fallback="no fit found" />
        {" · fell back to "}
        <span className="font-semibold tabular-nums" data-testid="fit-summary-chosen">
          {fitResult.scale}%
        </span>
        .
      </div>
    );
  }

  const chosenIsTightest = fitResult.maxScale != null && fitResult.scale === fitResult.maxScale;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="fit-summary-success"
      data-fit-scale={fitResult.scale}
      className="mt-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-[10.5px] leading-snug text-emerald-700 dark:text-emerald-300"
    >
      <div>
        Auto-fit settled at{" "}
        <span className="font-semibold tabular-nums" data-testid="fit-summary-chosen">
          {fitResult.scale}%
        </span>{" "}
        scale in{" "}
        <span className="font-semibold tabular-nums" data-testid="fit-summary-steps">
          {fitResult.steps}
        </span>{" "}
        step{fitResult.steps === 1 ? "" : "s"}.
      </div>
      <div className="mt-0.5 opacity-80">
        <span className="inline-flex items-center">
          Allowed range explored
          <FitLegend impossible={false} />
        </span>
        {": "}
        <FormattedRange min={fitResult.minScale} max={fitResult.maxScale} fallback="—" />
        {" · chosen "}
        <span className="font-semibold tabular-nums">{fitResult.scale}%</span>
        {chosenIsTightest ? " (tightest known-fitting)" : ""}
      </div>
      {fitResult.unstable && (
        <div
          data-testid="fit-summary-unstable"
          className="mt-1 rounded bg-amber-500/15 px-1.5 py-1 text-amber-800 dark:text-amber-200"
        >
          ⚠︎ Pagination reported inconsistent page counts at the same scale (fonts/images may still
          be loading). Locked to the smallest scale that was ever observed to fit for maximum safety
          margin.
        </div>
      )}
    </div>
  );
}
