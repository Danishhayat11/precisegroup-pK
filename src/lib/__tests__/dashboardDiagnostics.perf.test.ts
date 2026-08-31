/**
 * Performance regression suite for the dashboard's `payments` query.
 *
 * The dashboard times its `fetchAllRows("payments", ...)` call separately
 * from the other parallel sources and pipes the measurement through
 * `trackPaymentsLatency`. If that measurement ever exceeds the configured
 * budget (see `DEFAULT_PAYMENTS_LATENCY_BUDGET_MS`), the tracker emits a
 * `payments_slow` diagnostic AND the pure evaluator returns `ok: false`.
 *
 * These tests lock in that boundary so a silent slowdown fails CI instead
 * of shipping to production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PAYMENTS_LATENCY_BUDGET_MS,
  evaluatePaymentsLatency,
  getPaymentsLatencyBudgetMs,
  trackPaymentsLatency,
} from "@/lib/dashboardDiagnostics";

describe("payments query latency threshold", () => {
  const BUDGET = DEFAULT_PAYMENTS_LATENCY_BUDGET_MS;

  const capturedEvents: CustomEvent[] = [];
  const listener = (e: Event) => capturedEvents.push(e as CustomEvent);

  beforeEach(() => {
    capturedEvents.length = 0;
    window.addEventListener("dashboard:diagnostic", listener);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    window.removeEventListener("dashboard:diagnostic", listener);
    vi.restoreAllMocks();
  });

  it("exposes a sane default budget (>0, <= 5s)", () => {
    expect(BUDGET).toBeGreaterThan(0);
    expect(BUDGET).toBeLessThanOrEqual(5000);
    expect(getPaymentsLatencyBudgetMs()).toBe(BUDGET);
  });

  it("passes a fast payments fetch", () => {
    const res = evaluatePaymentsLatency(120);
    expect(res.ok).toBe(true);
    expect(res.ms).toBe(120);
    expect(res.budgetMs).toBe(BUDGET);
    expect(res.reason).toBeUndefined();
  });

  it("passes exactly at the budget boundary", () => {
    expect(evaluatePaymentsLatency(BUDGET).ok).toBe(true);
  });

  it("fails when the payments fetch exceeds the budget", () => {
    const res = evaluatePaymentsLatency(BUDGET + 1);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("exceeded");
    expect(res.ms).toBe(BUDGET + 1);
  });

  it("fails on missing / invalid measurements", () => {
    expect(evaluatePaymentsLatency(undefined).reason).toBe("missing");
    expect(evaluatePaymentsLatency(null).reason).toBe("missing");
    expect(evaluatePaymentsLatency(Number.NaN).reason).toBe("invalid");
    expect(evaluatePaymentsLatency(-5).reason).toBe("invalid");
  });

  it("trackPaymentsLatency emits `payments_slow` when the budget is blown", () => {
    const res = trackPaymentsLatency(BUDGET + 250, { rows: 4200 });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("exceeded");

    const slow = capturedEvents.find(
      (e) => (e.detail as { event?: string }).event === "payments_slow",
    );
    expect(slow, "expected a payments_slow diagnostic event").toBeTruthy();

    const detail = slow!.detail as {
      level: string;
      durationMs: number;
      budgetMs: number;
      rows: number;
    };
    expect(detail.level).toBe("warning");
    expect(detail.durationMs).toBe(BUDGET + 250);
    expect(detail.budgetMs).toBe(BUDGET);
    expect(detail.rows).toBe(4200);
  });

  it("trackPaymentsLatency stays quiet on fast fetches", () => {
    const res = trackPaymentsLatency(80);
    expect(res.ok).toBe(true);
    const slow = capturedEvents.find(
      (e) => (e.detail as { event?: string }).event === "payments_slow",
    );
    expect(slow).toBeUndefined();
  });

  /**
   * Simulates the Dashboard queryFn contract: the `fetch_success` event
   * carries `sourceDurationsMs.payments`. Downstream monitors evaluate that
   * field against the budget — this test asserts the two stay in sync.
   */
  it("integrates with the fetch_success event shape", () => {
    const paymentsMs = BUDGET + 500;
    const fetchSuccessPayload = {
      event: "fetch_success",
      durationMs: paymentsMs + 200,
      sourceDurationsMs: { payments: paymentsMs },
      counts: { payments: 12000 },
    };
    const res = evaluatePaymentsLatency(fetchSuccessPayload.sourceDurationsMs.payments);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("exceeded");
  });
});
