/**
 * Fit-tester UI + logic regression suite.
 *
 * Covers the extreme paper/orientation/margin scenarios PrintPreviewModal
 * feeds into fitStep(). We can't render the browser paginator inside jsdom,
 * so each scenario is expressed as the *effective fitting threshold* the
 * paginator would produce for that paper geometry — e.g. an A4-portrait
 * page with 25mm margins holding a dense receipt collapses the printable
 * area to roughly 60% of nominal, so any scale > ~60 spills to a second
 * page. That single knob exercises every branch of the search:
 *
 *   - grow-up (start below fitting threshold)
 *   - bisect-down (start above)
 *   - ratio-jump on unknown upper bound
 *   - convergence at exactly hi - lo == 1
 *   - impossible / iteration-cap when threshold < FIT_MIN
 *
 * Two layers of assertions:
 *   1. runFit() — pure invariants (final ≤ threshold when possible, etc.)
 *   2. <FitTesterPage /> — the summary DOM (data-testid="fit-final-scale",
 *      "fit-step-count", "fit-status") matches those values, which is what
 *      downstream Playwright specs actually assert on.
 */
import { describe, it, expect } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FIT_MAX, FIT_MIN } from "@/lib/fitToOnePage";
import { FitTesterPage, runFit } from "@/routes/fit-tester";

/**
 * Real-world paper/orientation/margin combinations mapped to the effective
 * "largest scale that still fits on one page" the browser paginator would
 * report. Numbers picked to straddle every interesting branch of fitStep
 * (well below start, at start, above start, at the ceiling, below the floor).
 */
type Scenario = {
  name: string;
  /** paper + orientation + margins summary (docs only — not consumed by fitStep). */
  geometry: string;
  threshold: number;
  startScale: number;
  /** null = expect impossible / no fitting scale. */
  expectPossible: boolean;
};

const SCENARIOS: Scenario[] = [
  {
    name: "A4 portrait, 25mm margins, dense receipt (tight fit)",
    geometry: "A4 · portrait · 25/25/25/25 mm",
    threshold: 62,
    startScale: 100,
    expectPossible: true,
  },
  {
    name: "A4 portrait, 5mm margins, roomy content (already fits at start)",
    geometry: "A4 · portrait · 5/5/5/5 mm",
    threshold: 118,
    startScale: 100,
    expectPossible: true,
  },
  {
    name: "Letter landscape, 15mm margins (near-1:1)",
    geometry: "Letter · landscape · 15/15/15/15 mm",
    threshold: 96,
    startScale: 100,
    expectPossible: true,
  },
  {
    name: "A5 portrait, 30mm margins (extreme squeeze, above start)",
    geometry: "A5 · portrait · 30/30/30/30 mm",
    threshold: 55,
    startScale: 150,
    expectPossible: true,
  },
  {
    name: "Legal landscape, 0mm margins (ceiling — already at FIT_MAX)",
    geometry: "Legal · landscape · 0/0/0/0 mm",
    threshold: FIT_MAX,
    startScale: FIT_MAX,
    expectPossible: true,
  },
  {
    name: "A4 portrait, 40mm margins + oversized artwork (impossible)",
    geometry: "A4 · portrait · 40/40/40/40 mm",
    threshold: FIT_MIN - 5, // below the minimum selectable scale
    startScale: 100,
    expectPossible: false,
  },
  {
    name: "Floor threshold: exactly FIT_MIN (grow from below)",
    geometry: "A4 · portrait · 35/35/35/35 mm",
    threshold: FIT_MIN,
    startScale: FIT_MIN,
    expectPossible: true,
  },
];

// --------------------------------------------------------------------------
// Layer 1 — pure runFit invariants across every scenario.
// --------------------------------------------------------------------------
describe("runFit — extreme paper/orientation/margin invariants", () => {
  for (const s of SCENARIOS) {
    it(`${s.name} [${s.geometry}]`, () => {
      const r = runFit(s.threshold, s.startScale);

      expect(r.steps).toBeGreaterThan(0);
      expect(r.trail).toHaveLength(r.steps);
      expect(r.finalScale).toBeGreaterThanOrEqual(FIT_MIN);
      expect(r.finalScale).toBeLessThanOrEqual(FIT_MAX);

      if (s.expectPossible) {
        expect(r.impossible).toBe(false);
        // The terminal scale must actually fit under the simulated geometry.
        expect(r.finalScale).toBeLessThanOrEqual(s.threshold);
        // And it must be the largest known-fitting scale we saw (no
        // needlessly conservative shrink beyond what geometry required).
        const fittingScalesSeen = r.trail
          .filter((e) => e.pageCount === 1)
          .map((e) => e.currentScale);
        if (fittingScalesSeen.length > 0) {
          const maxFitting = Math.max(...fittingScalesSeen);
          expect(r.finalScale).toBeGreaterThanOrEqual(Math.min(maxFitting, s.threshold));
        }
      } else {
        expect(r.impossible).toBe(true);
        // Fallback is FIT_MIN by contract when no scale fits.
        expect(r.finalScale).toBe(FIT_MIN);
      }
    });
  }
});

// --------------------------------------------------------------------------
// Layer 2 — the summary DOM the QA harness and Playwright specs assert on.
// --------------------------------------------------------------------------
describe("<FitTesterPage /> summary matches runFit for extreme scenarios", () => {
  for (const s of SCENARIOS) {
    it(`renders Final Scale + Step Count for: ${s.name}`, async () => {
      // Inputs clamp to [FIT_MIN, FIT_MAX] on change — mirror that clamp
      // when computing the expected values so the UI (which sees the clamped
      // value) and the reference calculation stay in sync for edge scenarios
      // like the "impossible" case where threshold is intentionally < FIT_MIN.
      const effectiveThreshold = Math.max(FIT_MIN, Math.min(FIT_MAX, s.threshold));
      const effectiveStart = Math.max(FIT_MIN, Math.min(FIT_MAX, s.startScale));
      const expected = runFit(effectiveThreshold, effectiveStart);
      const user = userEvent.setup();
      render(<FitTesterPage />);

      // Prime the inputs to the scenario. `fireEvent.change` sets the value
      // in one shot — `userEvent.type()` types digit-by-digit which loses
      // large values here (each intermediate keystroke re-clamps to [50,150]
      // and clobbers the next character).
      const thresholdInput = screen.getByTestId("fit-threshold") as HTMLInputElement;
      const startInput = screen.getByTestId("fit-start-scale") as HTMLInputElement;
      fireEvent.change(thresholdInput, { target: { value: String(s.threshold) } });
      fireEvent.change(startInput, { target: { value: String(s.startScale) } });

      // Sanity: inputs clamp to [FIT_MIN, FIT_MAX] via onChange.
      expect(Number(thresholdInput.value)).toBe(Math.max(FIT_MIN, Math.min(FIT_MAX, s.threshold)));
      expect(Number(startInput.value)).toBe(Math.max(FIT_MIN, Math.min(FIT_MAX, s.startScale)));

      await user.click(screen.getByTestId("fit-run"));

      // The run is async (setTimeout 220ms in the component) — wait for the
      // status pill to flip to complete rather than sleeping.
      await waitFor(
        () => {
          expect(screen.getByTestId("fit-status")).toHaveAttribute("data-status", "complete");
        },
        { timeout: 2000 },
      );

      const finalScaleEl = screen.getByTestId("fit-final-scale");
      const stepCountEl = screen.getByTestId("fit-step-count");

      // The numeric `data-value` attribute is the stable machine-readable
      // channel; the visible text is what a human tester sees.
      expect(finalScaleEl).toHaveAttribute("data-value", String(expected.finalScale));
      expect(finalScaleEl).toHaveTextContent(`${expected.finalScale}%`);
      expect(stepCountEl).toHaveAttribute("data-value", String(expected.steps));
      expect(stepCountEl).toHaveTextContent(String(expected.steps));

      // Step-count badge mirrors the numeric value and pluralises correctly.
      const badge = screen.getByTestId("fit-step-count-badge");
      expect(badge).toHaveTextContent(`${expected.steps} step${expected.steps === 1 ? "" : "s"}`);

      // Impossible surfaces an unambiguous label so testers can grep for
      // regressions without parsing numeric fallbacks. Note: input clamping
      // to [FIT_MIN, FIT_MAX] means a scenario asking for threshold < FIT_MIN
      // becomes possible-at-FIT_MIN in the UI — key off the actual runFit
      // outcome rather than the scenario's raw intent.
      if (expected.impossible) {
        expect(screen.getByTestId("fit-status")).toHaveTextContent(/impossible/i);
      } else {
        expect(screen.getByTestId("fit-status")).toHaveTextContent(/complete/i);
      }
    }, 10_000);
  }
});

// --------------------------------------------------------------------------
// Reset behaviour — required so long test batches don't leak state between
// scenarios in the manual QA flow.
// --------------------------------------------------------------------------
describe("<FitTesterPage /> reset restores idle state", () => {
  it("clears final scale + step count and returns status to idle", async () => {
    const user = userEvent.setup();
    render(<FitTesterPage />);
    await user.click(screen.getByTestId("fit-run"));
    await waitFor(
      () => {
        expect(screen.getByTestId("fit-status")).toHaveAttribute("data-status", "complete");
      },
      { timeout: 2000 },
    );

    await user.click(screen.getByTestId("fit-reset"));

    expect(screen.getByTestId("fit-status")).toHaveAttribute("data-status", "idle");
    expect(screen.getByTestId("fit-final-scale")).toHaveTextContent("—");
    expect(screen.getByTestId("fit-step-count")).toHaveTextContent("—");
  }, 10_000);
});
