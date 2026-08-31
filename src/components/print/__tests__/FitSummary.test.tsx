import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { FitSummary, type FitSummaryResult } from "@/components/print/FitSummary";

afterEach(cleanup);

function make(overrides: Partial<FitSummaryResult> = {}): FitSummaryResult {
  return {
    scale: 85,
    steps: 4,
    minScale: 50,
    maxScale: 90,
    unstable: false,
    ...overrides,
  };
}

describe("<FitSummary />", () => {
  describe("success (emerald) panel", () => {
    it("renders chosen scale, step count, and explored min/max", () => {
      render(
        <FitSummary
          fitResult={make({ scale: 85, steps: 4, minScale: 50, maxScale: 90 })}
          impossible={false}
        />,
      );

      const panel = screen.getByTestId("fit-summary-success");
      expect(panel).toHaveAttribute("data-fit-scale", "85");
      expect(panel).toHaveAttribute("aria-live", "polite");

      expect(within(panel).getByTestId("fit-summary-chosen")).toHaveTextContent("85%");
      expect(within(panel).getByTestId("fit-summary-steps")).toHaveTextContent("4");
      expect(within(panel).getByTestId("fit-summary-min")).toHaveTextContent("50%");
      expect(within(panel).getByTestId("fit-summary-max")).toHaveTextContent("90%");

      // "chosen 85%" appears twice — once in the headline, once in the range line.
      expect(panel.textContent).toContain("chosen 85%");
    });

    it("pluralises 'steps' correctly for a single-step search", () => {
      render(<FitSummary fitResult={make({ steps: 1 })} impossible={false} />);
      const panel = screen.getByTestId("fit-summary-success");
      expect(panel.textContent).toMatch(/in\s+1\s+step\./);
      expect(panel.textContent).not.toMatch(/steps\./);
    });

    it("annotates 'tightest known-fitting' when chosen equals the max bound", () => {
      render(<FitSummary fitResult={make({ scale: 90, maxScale: 90 })} impossible={false} />);
      expect(screen.getByTestId("fit-summary-success").textContent).toContain(
        "(tightest known-fitting)",
      );
    });

    it("omits the tightest tag when chosen is below max", () => {
      render(<FitSummary fitResult={make({ scale: 80, maxScale: 90 })} impossible={false} />);
      expect(screen.getByTestId("fit-summary-success").textContent).not.toContain(
        "tightest known-fitting",
      );
    });

    it("renders em-dash when no maximum was observed", () => {
      render(<FitSummary fitResult={make({ maxScale: null })} impossible={false} />);
      expect(screen.getByTestId("fit-summary-max")).toHaveTextContent("—");
    });

    it("surfaces the unstable-pagination warning only when flagged", () => {
      const { rerender } = render(
        <FitSummary fitResult={make({ unstable: false })} impossible={false} />,
      );
      expect(screen.queryByTestId("fit-summary-unstable")).toBeNull();

      rerender(<FitSummary fitResult={make({ unstable: true })} impossible={false} />);
      expect(screen.getByTestId("fit-summary-unstable").textContent).toMatch(
        /inconsistent page counts/i,
      );
    });
  });

  describe("impossible (amber) fallback panel", () => {
    it("renders the amber panel with the clamp range and fallback scale", () => {
      render(
        <FitSummary
          fitResult={make({ scale: 50, minScale: 50, maxScale: null, steps: 12 })}
          impossible
        />,
      );

      // The success panel must NOT render in the impossible branch.
      expect(screen.queryByTestId("fit-summary-success")).toBeNull();

      const panel = screen.getByTestId("fit-summary-impossible");
      expect(panel).toHaveAttribute("data-fit-scale", "50");
      expect(within(panel).getByTestId("fit-summary-min")).toHaveTextContent("50%");
      expect(within(panel).getByTestId("fit-summary-max")).toHaveTextContent("no fit found");
      expect(within(panel).getByTestId("fit-summary-chosen")).toHaveTextContent("50%");
      expect(panel.textContent).toMatch(/fell back to\s+50%\./);
    });

    it("still shows a numeric max when one was observed but rejected", () => {
      render(<FitSummary fitResult={make({ scale: 50, minScale: 50, maxScale: 65 })} impossible />);
      const panel = screen.getByTestId("fit-summary-impossible");
      expect(within(panel).getByTestId("fit-summary-max")).toHaveTextContent("65%");
      expect(panel.textContent).not.toContain("no fit found");
    });
  });

  describe("recomputing (sky) panel — geometry-change reactivity", () => {
    const anyResult = make();

    it("renders the recomputing banner with the echoed geometry", () => {
      render(
        <FitSummary
          fitResult={anyResult}
          impossible={false}
          recomputing={{ paper: "A4", orientation: "landscape", margins: "6mm" }}
        />,
      );
      // Neither the success nor the impossible panels may render in this mode.
      expect(screen.queryByTestId("fit-summary-success")).toBeNull();
      expect(screen.queryByTestId("fit-summary-impossible")).toBeNull();

      const panel = screen.getByTestId("fit-summary-recomputing");
      expect(panel).toHaveAttribute("data-fit-geometry", "A4|landscape|6mm");
      expect(panel).toHaveAttribute("aria-live", "polite");
      expect(screen.getByTestId("fit-summary-recomputing-geometry").textContent).toBe(
        "A4 landscape, margins 6mm",
      );
    });

    it("recomputing banner takes precedence even if impossible=true is passed", () => {
      // The parent may still be carrying the previous impossible result while
      // the fresh search is in flight — the recomputing state must win.
      render(
        <FitSummary
          fitResult={make({ scale: 50, maxScale: null })}
          impossible
          recomputing={{ paper: "Letter", orientation: "portrait", margins: "12.7mm" }}
        />,
      );
      expect(screen.getByTestId("fit-summary-recomputing")).toBeTruthy();
      expect(screen.queryByTestId("fit-summary-impossible")).toBeNull();
    });

    it("updates the panel immediately when orientation switches, then settles on the new result", () => {
      // Step 1: settled portrait success.
      const { rerender } = render(
        <FitSummary
          fitResult={make({ scale: 90, maxScale: 90 })}
          impossible={false}
          recomputing={null}
        />,
      );
      expect(screen.getByTestId("fit-summary-chosen")).toHaveTextContent("90%");

      // Step 2: user flips to landscape → parent passes `recomputing`
      // synchronously. The summary must swap to the sky banner *now*, not
      // wait for the next search to finish.
      rerender(
        <FitSummary
          fitResult={make({ scale: 90, maxScale: 90 })}
          impossible={false}
          recomputing={{ paper: "A4", orientation: "landscape", margins: "12.7mm" }}
        />,
      );
      expect(screen.getByTestId("fit-summary-recomputing")).toBeTruthy();
      expect(screen.getByTestId("fit-summary-recomputing-geometry").textContent).toContain(
        "landscape",
      );
      expect(screen.queryByTestId("fit-summary-success")).toBeNull();

      // Step 3: the new landscape search finishes with a different chosen scale.
      rerender(
        <FitSummary
          fitResult={make({ scale: 70, steps: 6, minScale: 50, maxScale: 74 })}
          impossible={false}
          recomputing={null}
        />,
      );
      expect(screen.queryByTestId("fit-summary-recomputing")).toBeNull();
      expect(screen.getByTestId("fit-summary-chosen")).toHaveTextContent("70%");
      expect(screen.getByTestId("fit-summary-max")).toHaveTextContent("74%");
    });

    it("updates the panel immediately when margin preset changes", () => {
      const { rerender } = render(
        <FitSummary
          fitResult={make({ scale: 88, maxScale: 92 })}
          impossible={false}
          recomputing={null}
        />,
      );
      expect(screen.getByTestId("fit-summary-chosen")).toHaveTextContent("88%");

      // User picks the "Narrow" margin preset.
      rerender(
        <FitSummary
          fitResult={make({ scale: 88, maxScale: 92 })}
          impossible={false}
          recomputing={{ paper: "A4", orientation: "portrait", margins: "6mm" }}
        />,
      );
      const banner = screen.getByTestId("fit-summary-recomputing");
      expect(banner.textContent).toContain("margins 6mm");

      // Search converges on a roomier max because the margins shrank.
      rerender(
        <FitSummary
          fitResult={make({ scale: 96, maxScale: 100 })}
          impossible={false}
          recomputing={null}
        />,
      );
      expect(screen.getByTestId("fit-summary-chosen")).toHaveTextContent("96%");
      expect(screen.getByTestId("fit-summary-max")).toHaveTextContent("100%");
    });
  });
});
