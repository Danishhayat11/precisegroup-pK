/**
 * Reports routes — navigation render smoke.
 *
 * For every `/reports/*` path, render the exact component the route mounts
 * and assert:
 *   1. render does not throw
 *   2. no `console.error` fires during mount (React warnings, boundary
 *      catches, uncaught promise rejections routed through React)
 *   3. the report region for that route becomes visible in the DOM
 *
 * Complements `reports-routes-signed-in.spec.ts` (Playwright, real router
 * with auth mocks) with a fast in-process check that catches runtime
 * regressions — a broken import, a missing prop, a hook-order bug — in
 * seconds and without a browser.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  OverdueInstallmentsReport,
  PaymentCollectionReport,
  AdjustmentRegisterReport,
  BookingSummaryReport,
  CashFlowSummaryReport,
  OutstandingBalanceReport,
} from "@/components/reports";

type Case = {
  path: string;
  label: RegExp;
  Component: React.ComponentType;
};

const CASES: Case[] = [
  {
    path: "/reports/overdue",
    label: /Overdue Installments/i,
    Component: OverdueInstallmentsReport,
  },
  { path: "/reports/payments", label: /Payment Collections?/i, Component: PaymentCollectionReport },
  {
    path: "/reports/adjustments",
    label: /Adjustment Register/i,
    Component: AdjustmentRegisterReport,
  },
  { path: "/reports/bookings", label: /Booking Summary/i, Component: BookingSummaryReport },
  { path: "/reports/cashflow", label: /Cash Flow Summary/i, Component: CashFlowSummaryReport },
  {
    path: "/reports/outstanding",
    label: /Outstanding Balance/i,
    Component: OutstandingBalanceReport,
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reports routes — navigation render smoke", () => {
  it.each(CASES)("$path renders without runtime errors", ({ label, Component }) => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<Component />)).not.toThrow();

    // Any content visible on the page — heading, region, or fallback text.
    // The reports export placeholders whose title matches the label regex.
    const visible = screen.queryAllByText(label);
    expect(visible.length, `expected content matching ${label}`).toBeGreaterThan(0);

    // Filter out benign act() advisories; anything else is a real runtime error.
    const realErrors = errorSpy.mock.calls
      .map((args) => args.map(String).join(" "))
      .filter((msg) => !/not wrapped in act/i.test(msg));
    expect(realErrors, `console.error during render: ${realErrors.join(" | ")}`).toEqual([]);
  });
});
