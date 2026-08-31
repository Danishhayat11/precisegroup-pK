/**
 * Regression tests for <DashboardErrorBoundary />.
 *
 * Locks in the two recovery paths users depend on when a dashboard render throws:
 *   • "Retry"   — clears the boundary, re-renders children, page recovers
 *                     without a full navigation.
 *   • "Reload page" — invokes window.location.reload() for hard-reset cases.
 *
 * Also verifies the error UI is accessible (role="alert", aria-live="assertive")
 * so assistive tech announces the failure instead of silently going blank,
 * which is the exact regression this boundary was added to prevent.
 */
import type React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardErrorBoundary } from "@/components/DashboardErrorBoundary";

// React logs a big stack when a boundary catches — silence it for these tests
// so the run output stays readable. Restored per-test.
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("DashboardErrorBoundary — error UI", () => {
  it("shows an accessible alert with the error message and both recovery buttons", () => {
    const Boom = (): React.ReactElement => {
      throw new Error("dashboard tile crashed");
    };

    render(
      <DashboardErrorBoundary>
        <Boom />
      </DashboardErrorBoundary>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveTextContent(/couldn't render/i);
    expect(alert).toHaveTextContent(/dashboard tile crashed/);

    expect(screen.getByRole("button", { name: /^retry$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload page/i })).toBeInTheDocument();
  });

  it("passes children through untouched when nothing throws", () => {
    render(
      <DashboardErrorBoundary>
        <div data-testid="ok">happy path</div>
      </DashboardErrorBoundary>,
    );
    expect(screen.getByTestId("ok")).toHaveTextContent("happy path");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("DashboardErrorBoundary — Retry (Retry)", () => {
  it("clears the error and successfully re-renders children after Retry", async () => {
    let shouldThrow = true;
    const Flaky = (): React.ReactElement => {
      if (shouldThrow) throw new Error("transient fetch failed");
      return <div data-testid="recovered">dashboard back online</div>;
    };

    render(
      <DashboardErrorBoundary>
        <Flaky />
      </DashboardErrorBoundary>,
    );

    // 1. Boundary caught the throw — error UI visible.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("recovered")).toBeNull();

    // 2. Underlying cause resolves (e.g. network back), user clicks Retry.
    shouldThrow = false;
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    });

    // 3. Alert is gone and the real dashboard content rendered.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("recovered")).toHaveTextContent("dashboard back online");
  });

  it("stays in the error state if Retry runs while the underlying error persists", async () => {
    const StillBroken = (): React.ReactElement => {
      throw new Error("still broken");
    };

    render(
      <DashboardErrorBoundary>
        <StillBroken />
      </DashboardErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    });

    // Boundary re-caught immediately — alert is still there with the message.
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/still broken/);
  });
});

describe("DashboardErrorBoundary — Reload page", () => {
  it("calls window.location.reload() when Reload page is clicked", async () => {
    const reload = vi.fn();
    // jsdom's location.reload is non-configurable in some versions; redefine.
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload },
    });

    const Boom = (): React.ReactElement => {
      throw new Error("need hard reload");
    };

    try {
      render(
        <DashboardErrorBoundary>
          <Boom />
        </DashboardErrorBoundary>,
      );

      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: /reload page/i }));
      });

      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    }
  });
});

describe("DashboardErrorBoundary — onRetry wiring", () => {
  it("invokes onRetry and only clears the error after it resolves", async () => {
    let resolveRetry: (() => void) | null = null;
    const onRetry = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveRetry = r;
        }),
    );

    let shouldThrow = true;
    const Flaky = (): React.ReactElement => {
      if (shouldThrow) throw new Error("data fetch failed");
      return <div data-testid="recovered">ok</div>;
    };

    render(
      <DashboardErrorBoundary onRetry={onRetry}>
        <Flaky />
      </DashboardErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Click Retry — onRetry should fire and the button should enter a pending state.
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /^retry/i }));
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    const pendingBtn = screen.getByRole("button", { name: /retrying/i });
    expect(pendingBtn).toBeDisabled();
    expect(pendingBtn).toHaveAttribute("aria-busy", "true");

    // Simulate the refetch finishing successfully.
    shouldThrow = false;
    await act(async () => {
      resolveRetry!();
      await Promise.resolve();
    });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("recovered")).toHaveTextContent("ok");
  });

  it("still clears retrying state if onRetry rejects (child re-throws next render)", async () => {
    const onRetry = vi.fn(() => Promise.reject(new Error("network down")));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const Broken = (): React.ReactElement => {
      throw new Error("still failing");
    };

    render(
      <DashboardErrorBoundary onRetry={onRetry}>
        <Broken />
      </DashboardErrorBoundary>,
    );

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /^retry/i }));
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    // Boundary re-catches the throw on the next render — alert is back and
    // the Retry button is no longer in the pending state.
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/still failing/);
    expect(screen.getByRole("button", { name: /^retry/i })).not.toBeDisabled();

    spy.mockRestore();
  });

  it("falls back to a plain reset when no onRetry is provided", async () => {
    let shouldThrow = true;
    const Flaky = (): React.ReactElement => {
      if (shouldThrow) throw new Error("boom");
      return <div data-testid="recovered">ok</div>;
    };

    render(
      <DashboardErrorBoundary>
        <Flaky />
      </DashboardErrorBoundary>,
    );

    shouldThrow = false;
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /^retry/i }));
    });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("recovered")).toHaveTextContent("ok");
  });
});
