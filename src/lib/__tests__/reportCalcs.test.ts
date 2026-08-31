import { describe, it, expect } from "vitest";
import {
  bookingSummary,
  paymentCollection,
  outstandingBalance,
  overdueInstallments,
  adjustmentRegister,
  cashFlowSummary,
  type BookingRow,
  type PaymentRow,
  type LedgerRow,
  type AdjustmentRow,
} from "@/lib/reportCalcs";

/* ---------------- Seeded fixtures ---------------- */
// 3 bookings, mix of statuses, dates spanning Jan–Mar 2026.
const bookings: BookingRow[] = [
  {
    booking_id: "B001",
    client_name: "Alice",
    unit_id: "U-1",
    project_code: "P1",
    booking_status: "active",
    booking_date: "2026-01-10",
    total_contract_value: 1_000_000,
    down_payment: 200_000,
    adjustment_credit: 50_000,
    cash_received: 400_000,
    remaining_balance: 600_000,
    current_overdue_count: 1,
    oldest_overdue_date: "2026-02-01",
    risk_level: "medium",
  },
  {
    booking_id: "B002",
    client_name: "Bob",
    unit_id: "U-2",
    project_code: "P1",
    booking_status: "closed",
    booking_date: "2026-02-15",
    total_contract_value: 500_000,
    down_payment: 500_000,
    adjustment_credit: 0,
    cash_received: 500_000,
    remaining_balance: 0,
    current_overdue_count: 0,
    oldest_overdue_date: null,
    risk_level: "low",
  },
  {
    booking_id: "B003",
    client_name: "Carol",
    unit_id: "U-3",
    project_code: "P2",
    booking_status: "active",
    booking_date: "2026-03-05",
    total_contract_value: 2_000_000,
    down_payment: 400_000,
    adjustment_credit: 0,
    cash_received: 600_000,
    remaining_balance: 1_400_000,
    current_overdue_count: 2,
    oldest_overdue_date: "2026-02-20",
    risk_level: "high",
  },
];

const payments: PaymentRow[] = [
  {
    receipt_no: "R1",
    booking_id: "B001",
    payment_date: "2026-01-10",
    payment_mode: "cash",
    payment_head: "Down Payment",
    amount: 200_000,
  },
  {
    receipt_no: "R2",
    booking_id: "B001",
    payment_date: "2026-02-05",
    payment_mode: "cheque",
    payment_head: "Installment",
    amount: 100_000,
  },
  {
    receipt_no: "R3",
    booking_id: "B001",
    payment_date: "2026-02-20",
    payment_mode: "cash",
    payment_head: "Installment",
    amount: 100_000,
  },
  {
    receipt_no: "R4",
    booking_id: "B002",
    payment_date: "2026-02-15",
    payment_mode: "transfer",
    payment_head: "Down Payment",
    amount: 500_000,
  },
  {
    receipt_no: "R5",
    booking_id: "B003",
    payment_date: "2026-03-05",
    payment_mode: "cash",
    payment_head: "Down Payment",
    amount: 400_000,
  },
  {
    receipt_no: "R6",
    booking_id: "B003",
    payment_date: "2026-03-20",
    payment_mode: "cheque",
    payment_head: "Utility Fee",
    amount: 200_000,
  },
];

// "today" for overdue tests: 2026-03-15 → R6 not yet in payments but ledger has overdue.
const NOW = new Date("2026-03-15T12:00:00Z");

const ledger: LedgerRow[] = [
  // B001 term 1 fully paid → not overdue
  {
    ledger_id: "L1",
    booking_id: "B001",
    term_no: 1,
    due_date: "2026-02-01",
    due_amount: 100_000,
    paid_amount: 100_000,
    particulars: "Installment 1",
  },
  // B001 term 2 overdue by (2026-03-15 - 2026-02-15) = 28 days, bal 50k
  {
    ledger_id: "L2",
    booking_id: "B001",
    term_no: 2,
    due_date: "2026-02-15",
    due_amount: 100_000,
    paid_amount: 50_000,
    particulars: "Installment 2",
  },
  // B003 term 1 overdue by (2026-03-15 - 2026-01-10) = 64 days, bal 100k
  {
    ledger_id: "L3",
    booking_id: "B003",
    term_no: 1,
    due_date: "2026-01-10",
    due_amount: 100_000,
    paid_amount: 0,
    particulars: "Installment 1",
  },
  // Down payment ledger row — must be excluded even if overdue
  {
    ledger_id: "L4",
    booking_id: "B003",
    term_no: 0,
    due_date: "2026-01-01",
    due_amount: 400_000,
    paid_amount: 400_000,
    particulars: "Down Payment",
  },
  // Future due — not overdue
  {
    ledger_id: "L5",
    booking_id: "B003",
    term_no: 2,
    due_date: "2026-04-10",
    due_amount: 100_000,
    paid_amount: 0,
    particulars: "Installment 2",
  },
];

const adjustments: AdjustmentRow[] = [
  {
    adjustment_id: "A1",
    booking_id: "B001",
    approved_value: 50_000,
    realized_value: 40_000,
    company_loss_gain: -10_000,
    approval_date: "2026-02-01",
    realization_date: "2026-02-10",
    status: "realized",
  },
  {
    adjustment_id: "A2",
    booking_id: "B003",
    approved_value: 30_000,
    realized_value: 0,
    company_loss_gain: -30_000,
    approval_date: "2026-03-01",
    realization_date: null,
    status: "approved",
  },
];

/* ---------------- Report 1 — Booking Summary ---------------- */

describe("bookingSummary", () => {
  it("totals sum sale, down, adjustment, paid, balance across all rows", () => {
    const { rows, totals } = bookingSummary(bookings);
    expect(rows).toHaveLength(3);
    expect(totals).toEqual({
      sale: 3_500_000,
      down: 1_100_000,
      adj: 50_000,
      paid: 1_500_000,
      bal: 2_000_000,
    });
  });

  it("filters by status", () => {
    const { rows, totals } = bookingSummary(bookings, { status: "active" });
    expect(rows.map((r) => r.booking_id)).toEqual(["B001", "B003"]);
    expect(totals.sale).toBe(3_000_000);
    expect(totals.bal).toBe(2_000_000);
  });

  it("filters by inclusive date range", () => {
    const { rows } = bookingSummary(bookings, { from: "2026-02-01", to: "2026-02-28" });
    expect(rows.map((r) => r.booking_id)).toEqual(["B002"]);
  });
});

/* ---------------- Report 2 — Payment Collection ---------------- */

describe("paymentCollection", () => {
  it("groups by YYYY-MM with sorted subtotals and a grand total", () => {
    const { byMonth, grandTotal } = paymentCollection(payments);
    expect(byMonth.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(byMonth.map((m) => m.subtotal)).toEqual([200_000, 700_000, 600_000]);
    expect(grandTotal).toBe(1_500_000);
    // Subtotals sum to grand total
    expect(byMonth.reduce((s, m) => s + m.subtotal, 0)).toBe(grandTotal);
  });

  it("respects payment_mode filter", () => {
    const { grandTotal, byMonth } = paymentCollection(payments, { mode: "cash" });
    expect(grandTotal).toBe(200_000 + 100_000 + 400_000);
    expect(byMonth.every((m) => m.rows.every((r) => r.payment_mode === "cash"))).toBe(true);
  });

  it("respects date range filter", () => {
    const { grandTotal } = paymentCollection(payments, { from: "2026-02-01", to: "2026-02-28" });
    expect(grandTotal).toBe(700_000);
  });

  it("sorts filtered payments by date ascending", () => {
    const { filtered } = paymentCollection(payments);
    const dates = filtered.map((p) => p.payment_date);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });
});

/* ---------------- Report 3 — Outstanding Balance ---------------- */

describe("outstandingBalance", () => {
  it("excludes zero-balance bookings and sorts by balance descending", () => {
    const { rows, total } = outstandingBalance(bookings);
    expect(rows.map((r) => r.booking_id)).toEqual(["B003", "B001"]);
    expect(total).toBe(2_000_000);
  });
});

/* ---------------- Report 4 — Overdue Installments ---------------- */

describe("overdueInstallments", () => {
  it("keeps only past-due rows with positive balance, excludes down payments", () => {
    const { rows, total } = overdueInstallments(ledger, bookings, NOW);
    expect(rows.map((r) => r.booking_id)).toEqual(["B003", "B001"]); // sorted by days desc
    expect(rows[0].days).toBe(64);
    expect(rows[1].days).toBe(28);
    expect(rows[0].bal).toBe(100_000);
    expect(rows[1].bal).toBe(50_000);
    expect(total).toBe(150_000);
  });

  it("skips future and fully-paid ledger rows", () => {
    const { rows } = overdueInstallments(ledger, bookings, NOW);
    const ids = rows.map((r) => `${r.booking_id}#${r.term_no}`);
    expect(ids).not.toContain("B001#1"); // fully paid
    expect(ids).not.toContain("B003#2"); // future
    expect(ids).not.toContain("B003#0"); // down payment excluded
  });
});

/* ---------------- Report 5 — Adjustment Register ---------------- */

describe("adjustmentRegister", () => {
  it("sums approved, realized and loss/gain and sorts by approval_date desc", () => {
    const { rows, totals } = adjustmentRegister(adjustments);
    expect(rows.map((r) => r.adjustment_id)).toEqual(["A2", "A1"]);
    expect(totals).toEqual({ approved: 80_000, realized: 40_000, net: -40_000 });
  });
});

/* ---------------- Report 6 — Cash Flow Summary ---------------- */

describe("cashFlowSummary", () => {
  it("buckets payments into installments / down / other and adjustments by realization month", () => {
    const { rows, totals } = cashFlowSummary(payments, adjustments);
    expect(rows.map((r) => r.month)).toEqual(["2026-01", "2026-02", "2026-03"]);

    // January: only Down Payment 200k, no adj.
    expect(rows[0]).toMatchObject({
      installments: 0,
      down: 200_000,
      other: 0,
      adj: 0,
      cashIn: 200_000,
      totalRealized: 200_000,
      running: 200_000,
    });
    // February: 200k installments + 500k down + adj realized 40k
    expect(rows[1]).toMatchObject({
      installments: 200_000,
      down: 500_000,
      other: 0,
      adj: 40_000,
      cashIn: 700_000,
      totalRealized: 740_000,
      running: 940_000,
    });
    // March: 400k down + 200k other, no realized adj (A2 not realized)
    expect(rows[2]).toMatchObject({
      installments: 0,
      down: 400_000,
      other: 200_000,
      adj: 0,
      cashIn: 600_000,
      totalRealized: 600_000,
      running: 1_540_000,
    });

    expect(totals).toEqual({
      installments: 200_000,
      down: 1_100_000,
      other: 200_000,
      cashIn: 1_500_000,
      adj: 40_000,
      totalRealized: 1_540_000,
    });
  });

  it("running total equals cumulative sum of totalRealized", () => {
    const { rows } = cashFlowSummary(payments, adjustments);
    let acc = 0;
    for (const r of rows) {
      acc += r.totalRealized;
      expect(r.running).toBe(acc);
    }
  });
});
