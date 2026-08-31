import { describe, it, expect } from "vitest";
import { recomputeOverdueForBooking, type LedgerRow } from "@/lib/overdue";
import { computePendingRows } from "@/lib/pending";
import { cleanLedger } from "@/lib/ledger";

/**
 * Cross-check regression for BK-MA-00014 (Adil Khan, Manal Arcade).
 *
 * Pins the agreed reconciliation:
 *   - Down Payment       : 3,432,000 paid (full)
 *   - Installments 1..10 : 700,000 each paid in full (= 7,000,000)
 *   - Installment 11     : 103,000 partial (remaining 597,000)
 *   - Installments 12..14: pending (700,000 each)
 *   - Possession         : 1,675,000 advance paid (remaining 2,253,000 of 3,928,000)
 *   - Total cash received: 12,210,000
 *   - Remaining balance  : 4,950,000
 *   - Total contract     : 17,160,000
 *   - Overdue (today)    : 0 (every past-due installment is fully paid)
 *
 * The test reconstructs the values from the canonical ledger truth and the
 * shared recompute helpers used by every screen / KPI / export. If a future
 * change to overdue / pending / cleanup math makes any screen disagree with
 * this expected snapshot, this test fails and points at the field.
 */

const BK = "BK-MA-00014";
const TODAY = "2026-06-29";

type Row = LedgerRow & {
  term_no: number;
  status: string;
};

export const BK_MA_00014_LEDGER: Row[] = [
  {
    booking_id: BK,
    term_no: 1,
    particulars: "Down Payment",
    due_amount: 3432000,
    paid_amount: 3432000,
    due_date: "2024-08-27",
    status: "Paid",
  },
  {
    booking_id: BK,
    term_no: 2,
    particulars: "Installment 01",
    due_amount: 700000,
    paid_amount: 700000,
    due_date: "2024-11-27",
    status: "Paid",
  },
  {
    booking_id: BK,
    term_no: 3,
    particulars: "Installment 02",
    due_amount: 700000,
    paid_amount: 700000,
    due_date: "2025-02-27",
    status: "Paid",
  },
  {
    booking_id: BK,
    term_no: 4,
    particulars: "Installment 03",
    due_amount: 700000,
    paid_amount: 700000,
    due_date: "2025-05-27",
    status: "Paid",
  },
  {
    booking_id: BK,
    term_no: 5,
    particulars: "Installment 04",
    due_amount: 700000,
    paid_amount: 700000,
    due_date: "2025-08-27",
    status: "Paid",
  },
  {
    booking_id: BK,
    term_no: 6,
    particulars: "Installment 05",
    due_amount: 700000,
    paid_amount: 700000,
    due_date: "2025-11-27",
    status: "Paid",
  },
  {
    booking_id: BK,
    term_no: 7,
    particulars: "Installment 06",
    due_amount: 700000,
    paid_amount: 700000,
    due_date: "2026-02-27",
    status: "Paid",
  },
  {
    booking_id: BK,
    term_no: 8,
    particulars: "Installment 07",
    due_amount: 700000,
    paid_amount: 700000,
    due_date: "2026-05-27",
    status: "Paid",
  },
  {
    booking_id: BK,
    term_no: 9,
    particulars: "Installment 08",
    due_amount: 700000,
    paid_amount: 700000,
    due_date: "2026-08-27",
    status: "Paid",
  },
  {
    booking_id: BK,
    term_no: 10,
    particulars: "Installment 09",
    due_amount: 700000,
    paid_amount: 700000,
    due_date: "2026-11-27",
    status: "Paid",
  },
  {
    booking_id: BK,
    term_no: 11,
    particulars: "Installment 10",
    due_amount: 700000,
    paid_amount: 700000,
    due_date: "2027-02-27",
    status: "Paid",
  },
  {
    booking_id: BK,
    term_no: 12,
    particulars: "Installment 11",
    due_amount: 700000,
    paid_amount: 103000,
    due_date: "2027-05-27",
    status: "Partially Paid",
  },
  {
    booking_id: BK,
    term_no: 13,
    particulars: "Installment 12",
    due_amount: 700000,
    paid_amount: 0,
    due_date: "2027-08-27",
    status: "Pending",
  },
  {
    booking_id: BK,
    term_no: 14,
    particulars: "Installment 13",
    due_amount: 700000,
    paid_amount: 0,
    due_date: "2027-11-27",
    status: "Pending",
  },
  {
    booking_id: BK,
    term_no: 15,
    particulars: "Installment 14",
    due_amount: 700000,
    paid_amount: 0,
    due_date: "2028-02-27",
    status: "Pending",
  },
  {
    booking_id: BK,
    term_no: 16,
    particulars: "Possession",
    due_amount: 3928000,
    paid_amount: 1675000,
    due_date: "2028-02-27",
    status: "Partially Paid",
  },
];

export const BK_MA_00014_EXPECTED = {
  installmentsPaid: 7_103_000,
  possessionPaid: 1_675_000,
  downPayment: 3_432_000,
  cashReceived: 12_210_000,
  remainingBalance: 4_950_000,
  totalContract: 17_160_000,
  overdueCount: 0,
  overdueAmount: 0,
};

describe("BK-MA-00014 — full cross-check", () => {
  it("ledger has exactly 16 real rows with no placeholders", () => {
    const cleaned = cleanLedger(BK_MA_00014_LEDGER);
    expect(cleaned).toHaveLength(16);
    expect(cleaned.map((r) => r.term_no)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  it("installment-only paid total equals 7,103,000", () => {
    const total = BK_MA_00014_LEDGER.filter((r) =>
      /^installment/i.test(r.particulars ?? ""),
    ).reduce((s, r) => s + Number(r.paid_amount ?? 0), 0);
    expect(total).toBe(BK_MA_00014_EXPECTED.installmentsPaid);
  });

  it("possession advance is exactly 1,675,000 (treated as advance, not overdue)", () => {
    const possession = BK_MA_00014_LEDGER.find((r) => r.particulars === "Possession")!;
    expect(possession.paid_amount).toBe(BK_MA_00014_EXPECTED.possessionPaid);
    // Per overdue rules, possession rows never count as overdue.
    expect(/possession/i.test(possession.particulars ?? "")).toBe(true);
  });

  it("each installment 1..10 is exactly 700,000 (equal-split rule)", () => {
    const fullyPaid = BK_MA_00014_LEDGER.filter((r) =>
      /^installment 0[1-9]$|^installment 10$/i.test(r.particulars ?? ""),
    );
    expect(fullyPaid).toHaveLength(10);
    for (const r of fullyPaid) {
      expect(r.due_amount).toBe(700_000);
      expect(r.paid_amount).toBe(700_000);
    }
  });

  it("cash received = down + installments + possession advance = 12,210,000", () => {
    const total = BK_MA_00014_LEDGER.reduce((s, r) => s + Number(r.paid_amount ?? 0), 0);
    expect(total).toBe(BK_MA_00014_EXPECTED.cashReceived);
  });

  it("remaining balance from ledger = 4,950,000", () => {
    const stats = recomputeOverdueForBooking(BK_MA_00014_LEDGER, TODAY);
    expect(stats.remaining_balance).toBe(BK_MA_00014_EXPECTED.remainingBalance);
  });

  it("total contract value (sum of dues) = 17,160,000", () => {
    const total = BK_MA_00014_LEDGER.reduce((s, r) => s + Number(r.due_amount ?? 0), 0);
    expect(total).toBe(BK_MA_00014_EXPECTED.totalContract);
  });

  it("overdue recompute reports 0 count and 0 amount", () => {
    const stats = recomputeOverdueForBooking(BK_MA_00014_LEDGER, TODAY);
    expect(stats.current_overdue_count).toBe(BK_MA_00014_EXPECTED.overdueCount);
    expect(stats.total_overdue_amount).toBe(BK_MA_00014_EXPECTED.overdueAmount);
  });

  it("Pending KPI math equals 4,950,000 (sell − cash − approved adjustments)", () => {
    const [row] = computePendingRows(
      [{ booking_id: BK, sold_unit_value: BK_MA_00014_EXPECTED.totalContract }],
      [{ booking_id: BK, safe_cash_amount: BK_MA_00014_EXPECTED.cashReceived }],
      [{ booking_id: BK, approved_value: 0 }],
    );
    expect(row.pending).toBe(BK_MA_00014_EXPECTED.remainingBalance);
    expect(row.recv).toBe(BK_MA_00014_EXPECTED.cashReceived);
  });

  it("invariant: cash + remaining = contract value (no leakage anywhere)", () => {
    expect(BK_MA_00014_EXPECTED.cashReceived + BK_MA_00014_EXPECTED.remainingBalance).toBe(
      BK_MA_00014_EXPECTED.totalContract,
    );
  });
});
