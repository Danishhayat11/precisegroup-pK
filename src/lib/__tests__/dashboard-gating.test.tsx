/**
 * Dashboard loader / query-retry / error-boundary gating tests.
 *
 * These tests exercise the exact state machine the Dashboard route relies on
 * without pulling in the full 3k-line component:
 *
 *   1. On mount the loader shows the "Loading dashboard…" gate and emits a
 *      `fetch_start` diagnostic.
 *   2. When the fetch fails the error gate replaces the loader, the
 *      `fetch_error` + `query_error_surface` diagnostics fire, and clicking
 *      Retry re-runs the query and emits `retry_click` / `retry_result`.
 *   3. When the retried fetch succeeds the ready gate renders the data and a
 *      `loading_state` transition with phase `success` is logged.
 *   4. DashboardErrorBoundary catches a render-time throw inside the ready
 *      subtree and shows its accessible fallback with a Retry action.
 */
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { logDashboardEvent, reportDashboardError } from "@/lib/dashboardDiagnostics";
import { DashboardErrorBoundary } from "@/components/DashboardErrorBoundary";

// ---------------------------------------------------------------------------
// Test double for the Dashboard's gating machine.
//
// Mirrors the real component's:
//   - useQuery({ queryKey: ["dashboard"], retry: 1 })
//   - fetch_start / fetch_success / fetch_error diagnostics
//   - loading_state transition emitter (initial → error_surfaced → retry → success)
//   - Error UI Retry button that calls refetch() and logs retry_click / retry_result
//   - Loading gate / Error gate / Ready gate
// ---------------------------------------------------------------------------
function DashboardHarness({ queryFn }: { queryFn: () => Promise<{ n: number }> }) {
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      logDashboardEvent("fetch_start");
      try {
        const data = await queryFn();
        logDashboardEvent("fetch_success", { counts: data });
        return data;
      } catch (err) {
        reportDashboardError("fetch_error", err);
        throw err;
      }
    },
    retry: 1,
  });
  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
    status,
    fetchStatus,
    failureCount,
  } = query;

  useEffect(() => {
    if (isError && error) reportDashboardError("query_error_surface", error);
  }, [isError, error]);

  const gate: "error" | "loading" | "ready" = isError
    ? "error"
    : isLoading || !data
      ? "loading"
      : "ready";

  const prev = useRef<null | { gate: string; failureCount: number }>(null);
  useEffect(() => {
    const p = prev.current;
    if (p && p.gate === gate && p.failureCount === failureCount) return;
    let phase = "initial";
    if (p) {
      if (p.failureCount < failureCount) phase = "retry";
      else if (gate === "ready" && p.gate !== "ready") phase = "success";
      else if (gate === "error" && p.gate !== "error") phase = "error_surfaced";
      else if (gate === "loading" && p.gate === "ready") phase = "refetch";
      else phase = "transition";
    }
    logDashboardEvent("loading_state", {
      phase,
      from: p,
      to: { gate, failureCount, status, fetchStatus },
    });
    prev.current = { gate, failureCount };
  }, [gate, failureCount, status, fetchStatus]);

  const onRetry = () => {
    logDashboardEvent("retry_click", { previousFailureCount: failureCount });
    void refetch().then((r) =>
      logDashboardEvent("retry_result", {
        outcome: r.status,
        failureCount: r.failureCount ?? null,
      }),
    );
  };

  if (isError) {
    return (
      <div role="alert" data-testid="gate-error">
        <div>Failed to load dashboard data.</div>
        <div>{(error as Error)?.message ?? "Unknown"}</div>
        <button type="button" onClick={onRetry}>
          {isFetching ? "Retrying…" : "Retry"}
        </button>
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div role="status" aria-busy="true" data-testid="gate-loading">
        Loading dashboard…
      </div>
    );
  }
  return <div data-testid="gate-ready">rows: {data.n}</div>;
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Zero retry delay so the internal `retry: 1` completes synchronously
        // under fake timers / awaits.
        retry: 1,
        retryDelay: 0,
        gcTime: 0,
        staleTime: 0,
      },
    },
  });
}

function wrap(ui: React.ReactElement) {
  const client = makeClient();
  return {
    client,
    ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>),
  };
}

// Capture every `dashboard:diagnostic` CustomEvent so we can assert on the
// full transition sequence — the same channel the dev diagnostics panel and
// Sentry breadcrumbs consume.
function collectDiagnostics() {
  const events: Array<{ event: string; level: string; [k: string]: unknown }> = [];
  const handler = (ev: Event) => {
    const d = (ev as CustomEvent).detail as {
      event: string;
      level: string;
    };
    events.push(d);
  };
  window.addEventListener("dashboard:diagnostic", handler as EventListener);
  return {
    events,
    dispose: () => window.removeEventListener("dashboard:diagnostic", handler as EventListener),
  };
}

describe("Dashboard gating: loader → error → retry → success", () => {
  let consoleErr: ReturnType<typeof vi.spyOn>;
  let consoleInfo: ReturnType<typeof vi.spyOn>;
  let diag: ReturnType<typeof collectDiagnostics>;

  beforeEach(() => {
    consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    diag = collectDiagnostics();
  });
  afterEach(() => {
    diag.dispose();
    consoleErr.mockRestore();
    consoleInfo.mockRestore();
  });

  it("renders the loading gate on initial hydration and emits fetch_start", async () => {
    let resolveFetch: (v: { n: number }) => void = () => {};
    const queryFn = vi.fn(() => new Promise<{ n: number }>((r) => (resolveFetch = r)));
    wrap(<DashboardHarness queryFn={queryFn} />);

    // Initial render: loading gate, no data.
    expect(screen.getByTestId("gate-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("gate-error")).toBeNull();
    expect(screen.queryByTestId("gate-ready")).toBeNull();

    await waitFor(() => expect(diag.events.some((e) => e.event === "fetch_start")).toBe(true));

    // Resolve the fetch so React Query settles before test teardown.
    await act(async () => {
      resolveFetch({ n: 7 });
    });
    await screen.findByTestId("gate-ready");
  });

  it("surfaces the error gate after retries exhaust and logs fetch_error + query_error_surface", async () => {
    const queryFn = vi.fn<() => Promise<{ n: number }>>().mockRejectedValue(new Error("boom-net"));
    wrap(<DashboardHarness queryFn={queryFn} />);

    await screen.findByTestId("gate-error");
    expect(screen.getByRole("alert")).toHaveTextContent(/boom-net/);
    // `retry: 1` → initial attempt + one retry = 2 calls total.
    expect(queryFn).toHaveBeenCalledTimes(2);

    const kinds = diag.events.map((e) => e.event);
    expect(kinds).toContain("fetch_error");
    expect(kinds).toContain("query_error_surface");
    // A loading_state transition must land on the error gate (phase may be
    // `initial` or `error_surfaced` depending on how quickly the retry cycle
    // resolves before the first commit).
    const landedOnError = diag.events.find(
      (e) => e.event === "loading_state" && (e as { to?: { gate?: string } }).to?.gate === "error",
    );
    expect(landedOnError).toBeTruthy();
  });

  it("Retry click re-runs the query, transitions loading → ready, and logs retry_click/retry_result", async () => {
    let call = 0;
    const queryFn = vi.fn(async () => {
      call++;
      if (call <= 2) throw new Error("still-down");
      return { n: 42 };
    });
    wrap(<DashboardHarness queryFn={queryFn} />);

    await screen.findByTestId("gate-error");
    diag.events.length = 0; // focus assertions on the retry cycle.

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    });

    await screen.findByTestId("gate-ready");
    expect(screen.getByTestId("gate-ready")).toHaveTextContent("rows: 42");

    const kinds = diag.events.map((e) => e.event);
    expect(kinds).toContain("retry_click");
    expect(kinds).toContain("retry_result");
    expect(kinds).toContain("fetch_success");
    const success = diag.events.find(
      (e) => e.event === "loading_state" && (e as { phase?: string }).phase === "success",
    );
    expect(success).toBeTruthy();
  });
});

describe("DashboardErrorBoundary wraps the ready subtree", () => {
  it("catches a render-time throw inside the ready gate and shows the fallback", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    function Ready(): React.ReactElement {
      const [shouldThrow, setThrow] = useState(false);
      if (shouldThrow) throw new Error("post-hydration render kaboom");
      return (
        <button type="button" onClick={() => setThrow(true)}>
          detonate
        </button>
      );
    }

    render(
      <DashboardErrorBoundary>
        <Ready />
      </DashboardErrorBoundary>,
    );

    // Baseline: no alert, child renders.
    expect(screen.queryByRole("alert")).toBeNull();

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /detonate/i }));
    });

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/post-hydration render kaboom/);
    expect(screen.getByRole("button", { name: /^retry$/i })).toBeInTheDocument();

    spy.mockRestore();
  });
});
