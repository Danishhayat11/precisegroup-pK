import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectRouteContext,
  isDashboardSentryEnabled,
  logDashboardEvent,
  reportDashboardError,
  setDashboardSentryEnabled,
} from "../dashboardDiagnostics";

describe("dashboardDiagnostics route context", () => {
  const originalHref = window.location.href;

  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/dashboard?tab=overdue#pending");
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    window.history.replaceState({}, "", originalHref);
    vi.restoreAllMocks();
    delete (window as unknown as { Sentry?: unknown }).Sentry;
  });

  it("captures pathname, search, hash, viewport, and a stable session id", () => {
    const a = collectRouteContext();
    const b = collectRouteContext();
    expect(a.pathname).toBe("/dashboard");
    expect(a.search).toBe("?tab=overdue");
    expect(a.hash).toBe("#pending");
    expect(a.viewport).toEqual(
      expect.objectContaining({
        w: expect.any(Number),
        h: expect.any(Number),
      }),
    );
    expect(a.sessionId).toBeTruthy();
    expect(a.sessionId).toBe(b.sessionId);
  });

  it("attaches route context to logDashboardEvent payloads", () => {
    const listener = vi.fn();
    window.addEventListener("dashboard:diagnostic", listener as EventListener);
    logDashboardEvent("fetch_start", { rows: 12 });
    const detail = (listener.mock.calls[0][0] as CustomEvent).detail as {
      event: string;
      route: { pathname: string };
      rows: number;
    };
    expect(detail.event).toBe("fetch_start");
    expect(detail.rows).toBe(12);
    expect(detail.route.pathname).toBe("/dashboard");
    window.removeEventListener("dashboard:diagnostic", listener as EventListener);
  });

  it("forwards stack + route context to Sentry.captureException with tags", () => {
    const captureException = vi.fn();
    const setContext = vi.fn();
    (window as unknown as { Sentry: unknown }).Sentry = {
      captureException,
      setContext,
    };

    const err = new Error("boom");
    reportDashboardError("render_error", err, { boundary: "route" });

    expect(setContext).toHaveBeenCalledWith(
      "dashboard_route",
      expect.objectContaining({ pathname: "/dashboard" }),
    );
    expect(captureException).toHaveBeenCalledTimes(1);
    const [captured, ctx] = captureException.mock.calls[0];
    expect(captured).toBe(err);
    expect(ctx.tags).toEqual(
      expect.objectContaining({
        surface: "dashboard",
        event: "render_error",
        pathname: "/dashboard",
      }),
    );
    expect(ctx.extra.stack).toContain("Error");
    expect(ctx.extra.route.pathname).toBe("/dashboard");
    expect(ctx.extra.boundary).toBe("route");
  });
});

describe("dashboardDiagnostics Sentry toggle", () => {
  beforeEach(() => {
    setDashboardSentryEnabled(null);
    window.localStorage.removeItem("precise.dashboardSentry");
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    setDashboardSentryEnabled(null);
    window.localStorage.removeItem("precise.dashboardSentry");
    delete (window as unknown as { Sentry?: unknown }).Sentry;
    vi.restoreAllMocks();
  });

  it("is enabled by default", () => {
    expect(isDashboardSentryEnabled()).toBe(true);
  });

  it("skips Sentry forwarding when disabled via runtime override", () => {
    const addBreadcrumb = vi.fn();
    const captureException = vi.fn();
    (window as unknown as { Sentry: unknown }).Sentry = {
      addBreadcrumb,
      captureException,
    };
    setDashboardSentryEnabled(false);
    logDashboardEvent("fetch_start");
    reportDashboardError("render_error", new Error("x"));
    expect(addBreadcrumb).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("honors localStorage 'off' value", () => {
    window.localStorage.setItem("precise.dashboardSentry", "off");
    expect(isDashboardSentryEnabled()).toBe(false);
  });

  it("localStorage 'on' overrides an env default of off", () => {
    setDashboardSentryEnabled(true);
    expect(isDashboardSentryEnabled()).toBe(true);
  });

  it("re-enables Sentry when the override is cleared", () => {
    const addBreadcrumb = vi.fn();
    (window as unknown as { Sentry: unknown }).Sentry = { addBreadcrumb };
    setDashboardSentryEnabled(false);
    logDashboardEvent("a");
    expect(addBreadcrumb).not.toHaveBeenCalled();
    setDashboardSentryEnabled(null);
    logDashboardEvent("b");
    expect(addBreadcrumb).toHaveBeenCalledTimes(1);
  });
});
