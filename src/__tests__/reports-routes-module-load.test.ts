/**
 * Module-load smoke for report routes.
 *
 * If any report module goes missing (rename, deleted export), or a report route file fails to parse, the
 * dynamic import below throws and this suite fails. Cheaper than a
 * Playwright pass and doesn't need a Supabase session.
 */
import { describe, it, expect } from "vitest";

const ROUTE_MODULES = [
  () => import("@/routes/_authenticated/reports.overdue"),
  () => import("@/routes/_authenticated/reports.overdue.lazy"),
  () => import("@/routes/_authenticated/reports.payments"),
  () => import("@/routes/_authenticated/reports.payments.lazy"),
  () => import("@/routes/_authenticated/reports.adjustments"),
  () => import("@/routes/_authenticated/reports.adjustments.lazy"),
  () => import("@/routes/_authenticated/reports.bookings"),
  () => import("@/routes/_authenticated/reports.bookings.lazy"),
  () => import("@/routes/_authenticated/reports.cashflow"),
  () => import("@/routes/_authenticated/reports.cashflow.lazy"),
  () => import("@/routes/_authenticated/reports.outstanding"),
  () => import("@/routes/_authenticated/reports.outstanding.lazy"),
];

const REPORT_EXPORTS = [
  "ReportRouteWrapper",
  "prefetchDrillDowns",
  "OverdueInstallmentsReport",
  "PaymentCollectionReport",
  "AdjustmentRegisterReport",
  "BookingSummaryReport",
  "CashFlowSummaryReport",
  "OutstandingBalanceReport",
];

describe("reports routes — module load smoke", () => {
  it.each(ROUTE_MODULES.map((load, i) => [i, load] as const))(
    "route module #%i loads and exports a Route",
    async (_i, load) => {
      const mod = await load();
      expect(mod.Route, "route file must export `Route`").toBeDefined();
    },
  );

  it("the report placeholders module exposes every expected symbol", async () => {
    const mod = await import("@/components/reports");
    for (const name of REPORT_EXPORTS) {
      expect((mod as Record<string, unknown>)[name], `missing export: ${name}`).toBeDefined();
    }
  });

  it("ReportRoutePending is importable", async () => {
    const mod = await import("@/components/reports");
    expect(mod.ReportRoutePending).toBeDefined();
  });
});
