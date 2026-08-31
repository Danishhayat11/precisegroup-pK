import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { FitLogEntry } from "@/lib/fitToOnePage";
import {
  FitTrailPanel,
  FIT_TRAIL_ROW_HEIGHT,
  FIT_TRAIL_VIEWPORT_PX,
  FIT_TRAIL_OVERSCAN,
} from "@/components/print/FitTrailPanel";

function makeLog(n: number): FitLogEntry[] {
  return Array.from(
    { length: n },
    (_, i) =>
      ({
        iteration: i + 1,
        currentScale: 100 - (i % 50),
        pageCount: 2,
        lo: 50,
        hi: 100,
        decision: i === n - 1 ? "done" : "shrink",
        nextScale: 99 - (i % 50),
        reason: "test",
        impossible: false,
        unstable: false,
      }) as FitLogEntry,
  );
}

/** Simulate what a real scroll container would report in jsdom. */
function stubScrollGeometry(scrollHeightPx: number) {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return scrollHeightPx;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return FIT_TRAIL_VIEWPORT_PX;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return FIT_TRAIL_VIEWPORT_PX;
    },
  });
}

beforeEach(() => {
  stubScrollGeometry(1000);
});

describe("FitTrailPanel — virtualization", () => {
  it("renders all entries when the log fits within the viewport", () => {
    render(<FitTrailPanel log={makeLog(5)} />);
    expect(screen.getAllByTestId("fit-trail-row")).toHaveLength(5);
    expect(screen.getByText(/5 steps/)).toBeInTheDocument();
  });

  it("windows the DOM so a very large log renders only a small slice", () => {
    const total = 10_000;
    render(<FitTrailPanel log={makeLog(total)} />);
    const rowCount = screen.getAllByTestId("fit-trail-row").length;
    // Upper bound = viewport rows + 2× overscan. Anything close to `total`
    // means virtualization is not working.
    const cap = Math.ceil(FIT_TRAIL_VIEWPORT_PX / FIT_TRAIL_ROW_HEIGHT) + FIT_TRAIL_OVERSCAN * 2;
    expect(rowCount).toBeLessThanOrEqual(cap);
    expect(rowCount).toBeGreaterThan(0);
    // The spacer preserves scroll geometry for the whole log.
    const spacer = screen.getByTestId("fit-trail-spacer");
    expect(spacer.style.height).toBe(`${total * FIT_TRAIL_ROW_HEIGHT}px`);
  });

  it("advertises the current window range in the status header", () => {
    const total = 10_000;
    render(<FitTrailPanel log={makeLog(total)} />);
    const indicator = screen.getByTestId("fit-trail-window-indicator");
    expect(indicator).toHaveTextContent(new RegExp(`/ ${total}$`));
  });

  it("mounts different rows after the user scrolls down", () => {
    const total = 5_000;
    render(<FitTrailPanel log={makeLog(total)} />);
    const initialFirst = screen.getAllByTestId("fit-trail-row")[0]!.getAttribute("data-iteration");

    const scroller = within(screen.getByTestId("fit-trail-panel")).getByRole("log");
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      value: 2_000 * FIT_TRAIL_ROW_HEIGHT,
      writable: true,
    });
    fireEvent.scroll(scroller);

    const nextFirst = screen.getAllByTestId("fit-trail-row")[0]!.getAttribute("data-iteration");
    expect(nextFirst).not.toBe(initialFirst);
    // Row iteration is 1-indexed; scrolling to ~2000 * row-height should land near iteration 2000.
    expect(Number(nextFirst)).toBeGreaterThan(1_500);
  });

  it("shows Jump to latest once the user scrolls away from the tail", () => {
    render(<FitTrailPanel log={makeLog(1_000)} />);
    const scroller = within(screen.getByTestId("fit-trail-panel")).getByRole("log");
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 0, writable: true });
    fireEvent.scroll(scroller);
    expect(screen.getByTestId("fit-trail-jump-latest")).toBeInTheDocument();
  });

  it("resets scroll to the tail when a new run starts (log shrinks)", () => {
    const { rerender } = render(<FitTrailPanel log={makeLog(2_000)} />);
    rerender(<FitTrailPanel log={makeLog(3)} />);
    expect(screen.getAllByTestId("fit-trail-row")).toHaveLength(3);
    // No window indicator hiding data when it all fits.
    const indicator = screen.getByTestId("fit-trail-window-indicator");
    expect(indicator).toHaveTextContent(/\/ 3$/);
  });

  it("keeps rendered row nodes stable across appends within the window", () => {
    const initial = makeLog(3);
    const { rerender } = render(<FitTrailPanel log={initial} />);
    const firstRow = screen.getAllByTestId("fit-trail-row")[0];
    const appended = [
      ...initial,
      {
        iteration: 4,
        currentScale: 80,
        pageCount: 1,
        lo: 50,
        hi: 100,
        decision: "done",
        nextScale: 80,
        reason: "ok",
        impossible: false,
        unstable: false,
      } as FitLogEntry,
    ];
    rerender(<FitTrailPanel log={appended} />);
    // Iteration #1 is still the same DOM node — memoized row was reused.
    expect(screen.getAllByTestId("fit-trail-row")[0]).toBe(firstRow);
    expect(screen.getAllByTestId("fit-trail-row")).toHaveLength(4);
  });
});

// keeps ESLint happy about the unused import in some setups
void vi;
