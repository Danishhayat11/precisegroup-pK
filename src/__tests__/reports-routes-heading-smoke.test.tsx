/**
 * Render smoke for every authenticated report route.
 *
 * Renders each report component that the lazy route mounts and asserts the
 * expected `<h1>` heading is in the DOM. Guards against renames of the
 * placeholder titles, broken barrel exports, and accidental removal of a
 * report's heading.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  OverdueInstallmentsReport,
  PaymentCollectionReport,
  AdjustmentRegisterReport,
  BookingSummaryReport,
  CashFlowSummaryReport,
  OutstandingBalanceReport,
} from "@/components/reports";

const CASES: Array<{
  route: string;
  heading: string;
  Component: React.ComponentType;
}> = [
  {
    route: "/_authenticated/reports/overdue",
    heading: "Overdue Installments",
    Component: OverdueInstallmentsReport,
  },
  {
    route: "/_authenticated/reports/payments",
    heading: "Payment Collection",
    Component: PaymentCollectionReport,
  },
  {
    route: "/_authenticated/reports/adjustments",
    heading: "Adjustment Register",
    Component: AdjustmentRegisterReport,
  },
  {
    route: "/_authenticated/reports/bookings",
    heading: "Booking Summary",
    Component: BookingSummaryReport,
  },
  {
    route: "/_authenticated/reports/cashflow",
    heading: "Cash Flow Summary",
    Component: CashFlowSummaryReport,
  },
  {
    route: "/_authenticated/reports/outstanding",
    heading: "Outstanding Balance",
    Component: OutstandingBalanceReport,
  },
];

describe("authenticated reports — heading render smoke", () => {
  it.each(CASES)("$route renders <h1>$heading</h1>", ({ heading, Component }) => {
    render(<Component />);
    const h1 = screen.getByRole("heading", { level: 1, name: heading });
    expect(h1).toBeInTheDocument();
  });
});
