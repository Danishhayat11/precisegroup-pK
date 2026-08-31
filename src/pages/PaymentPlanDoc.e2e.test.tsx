import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PaymentPlanDoc } from "@/pages/DocumentView";

/**
 * End-to-end integration test for the Payment Plan document.
 *
 * Scenario mirrors the real Manal Heights BK-MH-* case verified against
 * the production DB:
 *   · Contract 5,640,000 (down payment 846,000; 6 installments of 799,000)
 *   · Client has paid 846,000 (down payment) + 799,000×2 (first two
 *     installments) + 150,000 partial towards installment 3.
 *   · Installment 3 is FUTURE-dated → the partial is an ADVANCE payment
 *     and must NOT contribute to overdue KPIs.
 *
 * Asserts the on-screen pills and KPI text render exactly the expected
 * values so any regression in the FIFO cascade or advance-classification
 * logic fails this test.
 */

const today = () => new Date("2026-07-13T00:00:00Z");

// Freeze "now" so `future` classification is deterministic across CI.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(today());
});

// Vitest is available globally in the project's test setup; the explicit
// import keeps the file self-contained if that changes.
import { vi } from "vitest";

function iso(d: string) {
  return d;
}

const booking = {
  booking_id: "BK-MH-99999",
  client_name: "Test Client",
  project_name: "Manal Heights",
  unit_id: "A-101",
  unit_type: "Apartment",
  total_contract_value: 5_640_000,
  down_payment: 846_000,
  installment_amount: 799_000,
  possession_amount: 0,
  no_of_installments: 6,
  installment_frequency: "quarterly",
  booking_date: "2024-08-01",
  cnic: "12345-1234567-1",
  address: "Test address",
};

const ledger = [
  {
    term_no: 1,
    particulars: "Down Payment",
    due_date: iso("2024-08-01"),
    due_amount: 846_000,
    paid_amount: 846_000,
  },
  {
    term_no: 2,
    particulars: "Installment 01",
    due_date: iso("2024-11-01"),
    due_amount: 799_000,
    paid_amount: 799_000,
  },
  {
    term_no: 3,
    particulars: "Installment 02",
    due_date: iso("2025-02-01"),
    due_amount: 799_000,
    paid_amount: 799_000,
  },
  // FUTURE-dated installment with an advance partial:
  {
    term_no: 4,
    particulars: "Installment 03",
    due_date: iso("2027-05-01"),
    due_amount: 799_000,
    paid_amount: 150_000,
  },
  {
    term_no: 5,
    particulars: "Installment 04",
    due_date: iso("2027-08-01"),
    due_amount: 799_000,
    paid_amount: 0,
  },
  {
    term_no: 6,
    particulars: "Installment 05",
    due_date: iso("2027-11-01"),
    due_amount: 799_000,
    paid_amount: 0,
  },
  {
    term_no: 7,
    particulars: "Installment 06",
    due_date: iso("2028-02-01"),
    due_amount: 799_000,
    paid_amount: 0,
  },
];

// Cash total = 846k + 799k + 799k + 150k = 2,594,000
const payments = [
  {
    amount: 846_000,
    payment_mode: "Cash",
    non_cash_adjustment: false,
    cash_bank_include: true,
    safe_cash_amount: 846_000,
  },
  {
    amount: 799_000,
    payment_mode: "Cash",
    non_cash_adjustment: false,
    cash_bank_include: true,
    safe_cash_amount: 799_000,
  },
  {
    amount: 799_000,
    payment_mode: "Cash",
    non_cash_adjustment: false,
    cash_bank_include: true,
    safe_cash_amount: 799_000,
  },
  {
    amount: 150_000,
    payment_mode: "Cash",
    non_cash_adjustment: false,
    cash_bank_include: true,
    safe_cash_amount: 150_000,
  },
];
const adjustments: any[] = [];

describe("PaymentPlanDoc — advance partial E2E", () => {
  it("renders the Paid · Advance pill for the future-dated partial row", () => {
    render(
      <PaymentPlanDoc
        booking={booking}
        ledger={ledger}
        payments={payments}
        adjustments={adjustments}
      />,
    );
    // "Paid · Advance" appears twice (legend + the split row Xa).
    const advancePills = screen.getAllByText(/Paid\s*·\s*Advance/i);
    expect(advancePills.length).toBeGreaterThanOrEqual(2);
    // Upcoming pill also appears (legend + the Xb "Not Yet Due" row).
    expect(screen.getAllByText(/Upcoming/i).length).toBeGreaterThan(0);
  });

  it("split row labels the advance portion 'Paid in Advance' and the balance 'Not Yet Due'", () => {
    render(
      <PaymentPlanDoc
        booking={booking}
        ledger={ledger}
        payments={payments}
        adjustments={adjustments}
      />,
    );
    expect(screen.getByText(/Paid in Advance/i)).toBeInTheDocument();
    expect(screen.getByText(/Not Yet Due/i)).toBeInTheDocument();
  });

  it("KPI cards show Received = 2,594,000 and Remaining = 3,046,000", () => {
    const { container } = render(
      <PaymentPlanDoc
        booking={booking}
        ledger={ledger}
        payments={payments}
        adjustments={adjustments}
      />,
    );
    expect(within(container).getByText(/PKR\s*5,640,000/)).toBeInTheDocument(); // Total Contract
    expect(within(container).getByText(/PKR\s*2,594,000/)).toBeInTheDocument(); // Received
    expect(within(container).getByText(/PKR\s*3,046,000/)).toBeInTheDocument(); // Remaining
  });

  it("no schedule row is classified as Overdue (trace-verified)", () => {
    (window as any).__paymentPlanTrace = [];
    render(
      <PaymentPlanDoc
        booking={booking}
        ledger={ledger}
        payments={payments}
        adjustments={adjustments}
      />,
    );
    const last = ((window as any).__paymentPlanTrace as any[]).at(-1);
    expect(last.overdueCount).toBe(0);
    expect(last.rows.some((r: any) => r.classification === "overdue")).toBe(false);
    expect(last.rows.some((r: any) => r.classification === "past-partial-overdue")).toBe(false);
  });

  it("appends an entry to window.__paymentPlanTrace with overdueCount=0 and advanceCount=1", () => {
    (window as any).__paymentPlanTrace = [];
    render(
      <PaymentPlanDoc
        booking={booking}
        ledger={ledger}
        payments={payments}
        adjustments={adjustments}
      />,
    );
    const trace = (window as any).__paymentPlanTrace as any[];
    expect(trace.length).toBeGreaterThan(0);
    const last = trace[trace.length - 1];
    expect(last.bookingId).toBe("BK-MH-99999");
    expect(last.overdueCount).toBe(0);
    expect(last.overdueAmount).toBe(0);
    expect(last.advanceCount).toBe(1);
    const advanceRow = last.rows.find((r: any) => r.classification === "advance-partial");
    expect(advanceRow).toBeTruthy();
    expect(advanceRow.paid).toBe(150_000);
    expect(advanceRow.due).toBe(799_000);
    expect(advanceRow.future).toBe(true);
  });
});

describe("PaymentPlanDoc — invalid due_date E2E", () => {
  // Same booking header, but installment 03 has a garbage due_date.
  // Only the down payment has been received, so the FIFO pool is exhausted
  // before it reaches any installment — the bad row must therefore stay
  // Upcoming (never Overdue) and a warning must land in the trace.
  const badLedger = [
    {
      term_no: 1,
      particulars: "Down Payment",
      due_date: "2024-08-01",
      due_amount: 846_000,
      paid_amount: 846_000,
    },
    {
      term_no: 2,
      particulars: "Installment 01",
      due_date: "2024-11-01",
      due_amount: 799_000,
      paid_amount: 0,
    },
    {
      term_no: 3,
      particulars: "Installment 02",
      due_date: "2025-02-01",
      due_amount: 799_000,
      paid_amount: 0,
    },
    {
      term_no: 4,
      particulars: "Installment 03",
      due_date: "not-a-real-date",
      due_amount: 799_000,
      paid_amount: 0,
    },
    {
      term_no: 5,
      particulars: "Installment 04",
      due_date: "2027-08-01",
      due_amount: 799_000,
      paid_amount: 0,
    },
    {
      term_no: 6,
      particulars: "Installment 05",
      due_date: "2027-11-01",
      due_amount: 799_000,
      paid_amount: 0,
    },
    {
      term_no: 7,
      particulars: "Installment 06",
      due_date: "2028-02-01",
      due_amount: 799_000,
      paid_amount: 0,
    },
  ];
  const badPayments = [
    {
      amount: 846_000,
      payment_mode: "Cash",
      non_cash_adjustment: false,
      cash_bank_include: true,
      safe_cash_amount: 846_000,
    },
  ];

  it("classifies an unparseable-due_date row as Upcoming (not Overdue)", () => {
    (window as any).__paymentPlanTrace = [];
    render(
      <PaymentPlanDoc
        booking={booking}
        ledger={badLedger}
        payments={badPayments}
        adjustments={[]}
      />,
    );
    const last = ((window as any).__paymentPlanTrace as any[]).at(-1);
    const badRow = last.rows.find((r: any) => r.particulars === "Installment 03");
    expect(badRow).toBeTruthy();
    expect(badRow.status).toBe("Upcoming");
    expect(badRow.classification).not.toBe("overdue");
    expect(badRow.paid).toBe(0);
    // The bad row itself must never appear in the overdue tally, even though
    // other past-due rows (Installments 01 & 02) legitimately do.
    expect(badRow.due - badRow.paid).toBeGreaterThan(0);
  });

  it("records an 'unparseable due_date' warning in the trace for the bad row", () => {
    (window as any).__paymentPlanTrace = [];
    render(
      <PaymentPlanDoc
        booking={booking}
        ledger={badLedger}
        payments={badPayments}
        adjustments={[]}
      />,
    );
    const last = ((window as any).__paymentPlanTrace as any[]).at(-1);
    const badRow = last.rows.find((r: any) => r.particulars === "Installment 03");
    expect(Array.isArray(badRow.warnings)).toBe(true);
    expect(badRow.warnings.some((w: string) => /unparseable due_date/i.test(w))).toBe(true);
    expect(last.warningCount).toBeGreaterThanOrEqual(1);
  });

  it("renders the 'Check date' data-integrity badge on the invalid-date row", () => {
    render(
      <PaymentPlanDoc
        booking={booking}
        ledger={badLedger}
        payments={badPayments}
        adjustments={[]}
      />,
    );
    // "Check date" appears in the row badge AND the on-screen badge legend.
    expect(screen.getAllByText("Check date").length).toBeGreaterThanOrEqual(2);
  });
});

describe("PaymentPlanDoc — clock-skew advance override E2E", () => {
  // Simulate a machine clock running FAR into the future (2027-06-01).
  // Installment 01's due_date (2026-05-01) has passed by clock, but the
  // partial payment was recorded on 2026-04-15 — BEFORE the due date.
  // The paidBeforeDue cross-check must promote the row to `future=true`,
  // record an "advance override" warning, render the "Paid · Advance" pill,
  // and keep the row OUT of the overdue tally.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-06-01T00:00:00Z"));
  });

  const skewLedger = [
    {
      term_no: 1,
      particulars: "Down Payment",
      due_date: "2024-08-01",
      due_amount: 846_000,
      paid_amount: 846_000,
    },
    // Past-due by clock, but paid in advance of due date:
    {
      term_no: 2,
      particulars: "Installment 01",
      due_date: "2026-05-01",
      due_amount: 799_000,
      paid_amount: 150_000,
    },
    // Future rows to keep the trace clean:
    {
      term_no: 3,
      particulars: "Installment 02",
      due_date: "2027-08-01",
      due_amount: 799_000,
      paid_amount: 0,
    },
    {
      term_no: 4,
      particulars: "Installment 03",
      due_date: "2027-11-01",
      due_amount: 799_000,
      paid_amount: 0,
    },
    {
      term_no: 5,
      particulars: "Installment 04",
      due_date: "2028-02-01",
      due_amount: 799_000,
      paid_amount: 0,
    },
    {
      term_no: 6,
      particulars: "Installment 05",
      due_date: "2028-05-01",
      due_amount: 799_000,
      paid_amount: 0,
    },
    {
      term_no: 7,
      particulars: "Installment 06",
      due_date: "2028-08-01",
      due_amount: 799_000,
      paid_amount: 0,
    },
  ];
  // Latest payment_date across booking must be <= 2026-05-01 for the override
  // to fire (paidBeforeDue compares against the max payment date).
  const skewPayments = [
    {
      amount: 846_000,
      payment_mode: "Cash",
      non_cash_adjustment: false,
      cash_bank_include: true,
      safe_cash_amount: 846_000,
      payment_date: "2024-08-01",
    },
    {
      amount: 150_000,
      payment_mode: "Cash",
      non_cash_adjustment: false,
      cash_bank_include: true,
      safe_cash_amount: 150_000,
      payment_date: "2026-04-15",
    },
  ];

  it("advance-override promotes a clock-past row to future=true with an override warning in the trace", () => {
    (window as any).__paymentPlanTrace = [];
    render(
      <PaymentPlanDoc
        booking={booking}
        ledger={skewLedger}
        payments={skewPayments}
        adjustments={[]}
      />,
    );
    const last = ((window as any).__paymentPlanTrace as any[]).at(-1);
    const row = last.rows.find((r: any) => r.particulars === "Installment 01");
    expect(row).toBeTruthy();
    expect(row.future).toBe(true);
    expect(row.paidBeforeDue).toBe(true);
    expect(row.status).toBe("Partial");
    expect(row.classification).toBe("advance-partial");
    expect(row.warnings.some((w: string) => /advance override/i.test(w))).toBe(true);
    // The row must NOT contribute to overdue KPIs.
    expect(last.overdueCount).toBe(0);
    expect(last.overdueAmount).toBe(0);
    expect(last.advanceCount).toBe(1);
  });

  it("renders the 'Paid · Advance' pill and the 'Advance verified' data-integrity badge for the overridden row", () => {
    render(
      <PaymentPlanDoc
        booking={booking}
        ledger={skewLedger}
        payments={skewPayments}
        adjustments={[]}
      />,
    );
    // "Paid · Advance" appears in the legend and on the promoted row.
    expect(screen.getAllByText(/Paid\s*·\s*Advance/i).length).toBeGreaterThanOrEqual(2);
    // Advance-verified badge appears on the row and in the legend.
    expect(screen.getAllByText("Advance verified").length).toBeGreaterThanOrEqual(2);

    // Balance row for the split shows Not Yet Due, not Overdue.
    expect(screen.getByText(/Not Yet Due/i)).toBeInTheDocument();
  });
});
