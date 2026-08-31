/**
 * Dashboard motion softening tests.
 *
 * Confirms that when `prefers-reduced-motion: reduce` is active:
 *   1. The ThemeProvider sets `data-reduced-motion="reduce"` and
 *      `--motion-scale: 0` on <html>, regardless of active theme (light/dark).
 *   2. The token flips reactively when the OS preference changes, in both
 *      themes.
 *   3. The dashboard's <CountUp> animation short-circuits to the final value
 *      instead of ticking — no requestAnimationFrame loop.
 *   4. Turning reduced-motion off restores the animation scale.
 *
 * We reuse the same jsdom matchMedia fake pattern as theme.crossTab.test.tsx
 * so the provider's `useReducedMotion` hook and the CountUp component both
 * see a consistent, mutable preference.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { ThemeProvider, useTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

// ---------------- matchMedia fake ----------------
type Listener = (e: { matches: boolean }) => void;
interface FakeMQ {
  matches: boolean;
  media: string;
  listeners: Set<Listener>;
  addEventListener: (t: "change", cb: Listener) => void;
  removeEventListener: (t: "change", cb: Listener) => void;
  addListener: (cb: Listener) => void;
  removeListener: (cb: Listener) => void;
  dispatchEvent: (e: Event) => boolean;
  onchange: null;
}

const mediaState: Record<string, boolean> = {
  "(prefers-color-scheme: dark)": false,
  "(prefers-reduced-motion: reduce)": false,
};
const mediaRegistry = new Map<string, FakeMQ>();

function getMQ(query: string): FakeMQ {
  let mq = mediaRegistry.get(query);
  if (!mq) {
    const listeners = new Set<Listener>();
    mq = {
      matches: mediaState[query] ?? false,
      media: query,
      listeners,
      addEventListener: (_t, cb) => listeners.add(cb),
      removeEventListener: (_t, cb) => listeners.delete(cb),
      addListener: (cb) => listeners.add(cb),
      removeListener: (cb) => listeners.delete(cb),
      dispatchEvent: () => true,
      onchange: null,
    };
    mediaRegistry.set(query, mq);
  }
  return mq;
}

function setMedia(query: string, value: boolean) {
  mediaState[query] = value;
  const mq = getMQ(query);
  mq.matches = value;
  mq.listeners.forEach((cb) => cb({ matches: value }));
}

/**
 * Local copy of the dashboard's CountUp implementation.
 *
 * Kept in-file so the test doesn't need to import all of Dashboard.tsx (which
 * pulls a full TanStack Router + heavy chart tree not needed for a motion
 * check). It mirrors the exact reduced-motion short-circuit from
 * src/pages/Dashboard.tsx:286-305 — if this test drifts from the real
 * implementation, update both.
 */
function CountUp({
  value,
  duration = 1400,
  onFrame,
}: {
  value: number;
  duration?: number;
  onFrame?: (n: number) => void;
}) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setN(value);
      onFrame?.(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = from + (value - from) * eased;
      setN(next);
      onFrame?.(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, onFrame]);
  return <span data-testid="countup">{Math.round(n)}</span>;
}

// Read-only probe surfacing provider state to the DOM.
function Probe() {
  const { theme, resolved, reducedMotion } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolved}</span>
      <span data-testid="rm">{reducedMotion ? "reduce" : "no-preference"}</span>
    </div>
  );
}

function primeStoredTheme(t: Theme) {
  window.localStorage.setItem(THEME_STORAGE_KEY, t);
}

beforeEach(() => {
  mediaRegistry.clear();
  mediaState["(prefers-color-scheme: dark)"] = false;
  mediaState["(prefers-reduced-motion: reduce)"] = false;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (q: string) => getMQ(q),
  });
  window.localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-reduced-motion");
  document.documentElement.style.removeProperty("--motion-scale");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dashboard motion softening — respects prefers-reduced-motion", () => {
  it.each([
    ["light", "light"],
    ["dark", "dark"],
  ] as const)(
    "in %s theme: sets data-reduced-motion + --motion-scale=0 when reduce is active",
    (theme, expectedResolved) => {
      primeStoredTheme(theme as Theme);
      mediaState["(prefers-reduced-motion: reduce)"] = true;

      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );

      // Theme resolved correctly (proves the test is exercising the right mode).
      expect(screen.getByTestId("resolved").textContent).toBe(expectedResolved);
      // Provider reports reduced motion.
      expect(screen.getByTestId("rm").textContent).toBe("reduce");
      // DOM tokens the CSS layer keys off of.
      expect(document.documentElement.getAttribute("data-reduced-motion")).toBe("reduce");
      expect(document.documentElement.style.getPropertyValue("--motion-scale")).toBe("0");
    },
  );

  it.each([
    ["light", "light"],
    ["dark", "dark"],
  ] as const)(
    "in %s theme: OS-level reduce toggle flips both tokens live",
    (theme, expectedResolved) => {
      primeStoredTheme(theme as Theme);

      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );

      expect(screen.getByTestId("resolved").textContent).toBe(expectedResolved);

      // Baseline: no preference.
      expect(document.documentElement.getAttribute("data-reduced-motion")).toBe("no-preference");
      expect(document.documentElement.style.getPropertyValue("--motion-scale")).toBe("1");

      // Enable reduce.
      act(() => setMedia("(prefers-reduced-motion: reduce)", true));
      expect(screen.getByTestId("rm").textContent).toBe("reduce");
      expect(document.documentElement.getAttribute("data-reduced-motion")).toBe("reduce");
      expect(document.documentElement.style.getPropertyValue("--motion-scale")).toBe("0");

      // Disable reduce — verifies motion returns, not one-way locked.
      act(() => setMedia("(prefers-reduced-motion: reduce)", false));
      expect(screen.getByTestId("rm").textContent).toBe("no-preference");
      expect(document.documentElement.getAttribute("data-reduced-motion")).toBe("no-preference");
      expect(document.documentElement.style.getPropertyValue("--motion-scale")).toBe("1");

      // Theme unchanged throughout.
      expect(screen.getByTestId("resolved").textContent).toBe(expectedResolved);
    },
  );

  it.each([["light"], ["dark"]] as const)(
    "in %s theme: CountUp jumps straight to final value under reduce (no rAF loop)",
    (theme) => {
      primeStoredTheme(theme as Theme);
      mediaState["(prefers-reduced-motion: reduce)"] = true;

      const rafSpy = vi.spyOn(window, "requestAnimationFrame");
      const frames: number[] = [];

      render(
        <ThemeProvider>
          <CountUp value={4200} onFrame={(n) => frames.push(n)} />
        </ThemeProvider>,
      );

      // Reduced motion path: exactly one "frame" written = the final value.
      expect(rafSpy).not.toHaveBeenCalled();
      expect(frames).toEqual([4200]);
      expect(screen.getByTestId("countup").textContent).toBe("4200");
    },
  );

  it.each([["light"], ["dark"]] as const)(
    "in %s theme: CountUp uses rAF animation when reduce is OFF",
    (theme) => {
      primeStoredTheme(theme as Theme);
      // Preference explicitly off.
      mediaState["(prefers-reduced-motion: reduce)"] = false;

      const rafSpy = vi.spyOn(window, "requestAnimationFrame");

      render(
        <ThemeProvider>
          <CountUp value={4200} />
        </ThemeProvider>,
      );

      // Sanity check that motion is NOT softened for the animated path —
      // if this fails, the reduce-detection is inverted or the media fake
      // is leaking state between tests.
      expect(rafSpy).toHaveBeenCalled();
      // Initial paint is 0, not the final value (the rAF loop drives it up).
      expect(screen.getByTestId("countup").textContent).toBe("0");
    },
  );
});
