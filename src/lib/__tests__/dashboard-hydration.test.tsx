/**
 * Regression coverage for the "blank dashboard on hydration" incident.
 *
 * Two failure modes are pinned down:
 *
 * 1. **Theme init parity.** The pre-hydration <script> in __root.tsx and the
 *    runtime ThemeProvider must produce identical `class` and `color-scheme`
 *    values on <html>. If they drift, hydration aborts the client tree and
 *    the dashboard renders blank.
 *
 * 2. **DashboardErrorBoundary UX.** If any child throws during render, the
 *    boundary must show an accessible error state with a Retry action
 *    instead of leaving the page blank. When the child renders normally, the
 *    boundary must pass through untouched.
 */
import type React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "@/lib/theme";
import { DashboardErrorBoundary } from "@/components/DashboardErrorBoundary";

function resetHtml() {
  const html = document.documentElement;
  html.classList.remove("dark");
  html.removeAttribute("style");
}

function runInitScript() {
  // The script is an IIFE; eval executes it against the current jsdom window.

  (0, eval)(THEME_INIT_SCRIPT);
}

function snapshotHtml() {
  const html = document.documentElement;
  return {
    hasDark: html.classList.contains("dark"),
    colorScheme: html.style.colorScheme,
  };
}

describe("theme init parity (SSR script vs runtime)", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    resetHtml();
    localStorage.clear();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    resetHtml();
    localStorage.clear();
  });

  function mockPrefersDark(dark: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("dark") ? dark : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  }

  const cases: Array<{
    stored: string | null;
    prefersDark: boolean;
    expect: { hasDark: boolean; colorScheme: "dark" | "light" };
  }> = [
    { stored: null, prefersDark: false, expect: { hasDark: false, colorScheme: "light" } },
    { stored: null, prefersDark: true, expect: { hasDark: true, colorScheme: "dark" } },
    { stored: "system", prefersDark: false, expect: { hasDark: false, colorScheme: "light" } },
    { stored: "system", prefersDark: true, expect: { hasDark: true, colorScheme: "dark" } },
    { stored: "light", prefersDark: true, expect: { hasDark: false, colorScheme: "light" } },
    { stored: "dark", prefersDark: false, expect: { hasDark: true, colorScheme: "dark" } },
    { stored: "garbage", prefersDark: true, expect: { hasDark: true, colorScheme: "dark" } },
  ];

  for (const c of cases) {
    it(`stored=${c.stored ?? "(none)"} prefersDark=${c.prefersDark} → init script and ThemeProvider agree`, () => {
      if (c.stored !== null) localStorage.setItem(THEME_STORAGE_KEY, c.stored);
      mockPrefersDark(c.prefersDark);

      // 1. Simulate the pre-hydration <script> mutating <html>.
      runInitScript();
      const afterScript = snapshotHtml();
      expect(afterScript).toEqual(c.expect);

      // 2. Mount ThemeProvider — its useLayoutEffect runs `apply(resolved)`.
      //    The resulting <html> attrs must match the script's output exactly.
      resetHtml();
      render(
        <ThemeProvider>
          <div>ok</div>
        </ThemeProvider>,
      );
      const afterRuntime = snapshotHtml();
      expect(afterRuntime).toEqual(afterScript);
    });
  }
});

describe("DashboardErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(
      <DashboardErrorBoundary>
        <div data-testid="ok">dashboard content</div>
      </DashboardErrorBoundary>,
    );
    expect(screen.getByTestId("ok")).toHaveTextContent("dashboard content");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows accessible error UI with Retry + Reload when a child throws", async () => {
    // Suppress React's noisy error log during the deliberate throw.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const Boom = (): React.ReactElement => {
      throw new Error("kaboom from a dashboard child");
    };

    render(
      <DashboardErrorBoundary>
        <Boom />
      </DashboardErrorBoundary>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/couldn't render/i);
    expect(alert).toHaveTextContent(/kaboom from a dashboard child/);
    expect(screen.getByRole("button", { name: /^retry$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload page/i })).toBeInTheDocument();

    spy.mockRestore();
  });

  it("clears the error and re-renders children when Retry is clicked", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    let shouldThrow = true;
    const Toggle = (): React.ReactElement => {
      if (shouldThrow) throw new Error("first render fails");
      return <div data-testid="recovered">recovered</div>;
    };

    render(
      <DashboardErrorBoundary>
        <Toggle />
      </DashboardErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Fix the underlying condition, then click Retry.
    shouldThrow = false;
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("recovered")).toHaveTextContent("recovered");

    spy.mockRestore();
  });
});
