/**
 * Regression coverage: the diagnostic event stream that the dashboard,
 * Sentry, and the dev diagnostics panel all subscribe to must fire the
 * correct events with the expected shape for the three canonical dashboard
 * paths:
 *
 *   1. Hydration        → `mount`, `hydrated`, `fetch_start`
 *   2. Fetch success    → `fetch_start` then `fetch_success` (info, with counts)
 *   3. Fetch error path → `fetch_start` then `fetch_error` (error level,
 *                         name/message/stack), then `query_error_surface`
 *                         when the boundary/effect surfaces it.
 *
 * All events must:
 *   - Log via console.info (info) or console.error (error) with the
 *     `[dashboard] <event>` prefix.
 *   - Dispatch a `window` CustomEvent named `dashboard:diagnostic` carrying
 *     the same payload (event, level, route, timestamp, extra).
 *   - Forward as Sentry breadcrumbs (info/warn) or captureException (error)
 *     when Sentry is present and enabled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  logDashboardEvent,
  reportDashboardError,
  setDashboardSentryEnabled,
} from "../dashboardDiagnostics";

type Captured = {
  event: string;
  level: "info" | "warning" | "error";
  at: string;
  route: { pathname: string };
} & Record<string, unknown>;

function captureBus() {
  const events: Captured[] = [];
  const handler = (ev: Event) => events.push((ev as CustomEvent).detail as Captured);
  window.addEventListener("dashboard:diagnostic", handler as EventListener);
  return {
    events,
    dispose: () => window.removeEventListener("dashboard:diagnostic", handler as EventListener),
  };
}

describe("dashboardDiagnostics event stream regressions", () => {
  const originalHref = window.location.href;
  let info: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  let bus: ReturnType<typeof captureBus>;

  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/dashboard");
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
    setDashboardSentryEnabled(null);
    bus = captureBus();
  });
  afterEach(() => {
    bus.dispose();
    window.history.replaceState({}, "", originalHref);
    delete (window as unknown as { Sentry?: unknown }).Sentry;
    setDashboardSentryEnabled(null);
    vi.restoreAllMocks();
  });

  // -------- Hydration path -------------------------------------------------
  it("hydration path: emits mount → fetch_start → hydrated in order with info level", () => {
    logDashboardEvent("mount");
    logDashboardEvent("fetch_start");
    logDashboardEvent("hydrated", { msSinceMount: 42 });

    const names = bus.events.map((e) => e.event);
    expect(names).toEqual(["mount", "fetch_start", "hydrated"]);
    for (const e of bus.events) {
      expect(e.level).toBe("info");
      expect(e.route.pathname).toBe("/dashboard");
      expect(new Date(e.at).toString()).not.toBe("Invalid Date");
    }
    expect(bus.events[2].msSinceMount).toBe(42);

    // Console: each hydration event goes through console.info with the prefix.
    const prefixes = info.mock.calls.map((c: unknown[]) => c[0]);
    expect(prefixes).toEqual([
      "[dashboard] mount",
      "[dashboard] fetch_start",
      "[dashboard] hydrated",
    ]);
    expect(error).not.toHaveBeenCalled();
  });

  // -------- Fetch success path --------------------------------------------
  it("fetch_success path: carries durationMs + row counts and stays at info level", () => {
    logDashboardEvent("fetch_start");
    logDashboardEvent("fetch_success", {
      durationMs: 320,
      counts: { bookings: 12, payments: 40 },
    });

    expect(bus.events.map((e) => e.event)).toEqual(["fetch_start", "fetch_success"]);
    const success = bus.events[1] as Captured & {
      durationMs: number;
      counts: { bookings: number; payments: number };
    };
    expect(success.level).toBe("info");
    expect(success.durationMs).toBe(320);
    expect(success.counts).toEqual({ bookings: 12, payments: 40 });
    expect(error).not.toHaveBeenCalled();
  });

  it("fetch_success forwards as a Sentry breadcrumb (not an exception)", () => {
    const addBreadcrumb = vi.fn();
    const captureException = vi.fn();
    (window as unknown as { Sentry: unknown }).Sentry = {
      addBreadcrumb,
      captureException,
    };
    logDashboardEvent("fetch_success", { durationMs: 10 });
    expect(addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(addBreadcrumb.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        category: "dashboard",
        message: "fetch_success",
        level: "info",
      }),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  // -------- Fetch error path ----------------------------------------------
  it("fetch_error path: reportDashboardError emits an error-level event with name/message/stack", () => {
    logDashboardEvent("fetch_start");
    const err = new Error("network down");
    reportDashboardError("fetch_error", err, { durationMs: 120 });

    expect(bus.events.map((e) => e.event)).toEqual(["fetch_start", "fetch_error"]);
    const failure = bus.events[1] as Captured & {
      name: string;
      message: string;
      stack: string;
      durationMs: number;
    };
    expect(failure.level).toBe("error");
    expect(failure.name).toBe("Error");
    expect(failure.message).toBe("network down");
    expect(failure.stack).toContain("Error");
    expect(failure.durationMs).toBe(120);

    // Console: fetch_start goes to info, fetch_error goes to error.
    expect(info.mock.calls[0][0]).toBe("[dashboard] fetch_start");
    expect(error.mock.calls[0][0]).toBe("[dashboard] fetch_error");
  });

  it("query_error_surface follows fetch_error and both forward to Sentry.captureException", () => {
    const captureException = vi.fn();
    const setContext = vi.fn();
    (window as unknown as { Sentry: unknown }).Sentry = {
      captureException,
      setContext,
    };

    const err = new Error("boom");
    reportDashboardError("fetch_error", err);
    reportDashboardError("query_error_surface", err);

    expect(bus.events.map((e) => e.event)).toEqual(["fetch_error", "query_error_surface"]);
    expect(captureException).toHaveBeenCalledTimes(2);
    const tags = captureException.mock.calls.map((c) => c[1].tags.event);
    expect(tags).toEqual(["fetch_error", "query_error_surface"]);
    // Route context is attached for each capture so Sentry shows the pathname panel.
    expect(setContext).toHaveBeenCalledWith(
      "dashboard_route",
      expect.objectContaining({ pathname: "/dashboard" }),
    );
  });

  it("respects Sentry disable flag: bus + console still fire, Sentry does not", () => {
    const addBreadcrumb = vi.fn();
    const captureException = vi.fn();
    (window as unknown as { Sentry: unknown }).Sentry = {
      addBreadcrumb,
      captureException,
    };
    setDashboardSentryEnabled(false);

    logDashboardEvent("fetch_start");
    logDashboardEvent("fetch_success", { durationMs: 5 });
    reportDashboardError("fetch_error", new Error("nope"));

    // Bus still receives all three events → dev diagnostics panel keeps working.
    expect(bus.events.map((e) => e.event)).toEqual(["fetch_start", "fetch_success", "fetch_error"]);
    // Console still logs.
    expect(info).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    // Sentry short-circuits.
    expect(addBreadcrumb).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("serializes non-Error thrown values without crashing the pipeline", () => {
    reportDashboardError("fetch_error", "string-thrown-value");
    const evt = bus.events[0] as Captured & { value?: string; message?: string };
    expect(evt.event).toBe("fetch_error");
    expect(evt.level).toBe("error");
    // Non-Error inputs are stringified into `value` (no `stack`/`message`).
    expect(evt.value).toBe("string-thrown-value");
  });
});
