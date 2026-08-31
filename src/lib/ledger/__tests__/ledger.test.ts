import { describe, expect, it } from "vitest";
import {
  allocateReceipts,
  buildBookingSummary,
  deriveStatus,
  projectInstallments,
  type InstallmentRow,
  type LedgerTxn,
} from "../";

const TODAY = new Date("2026-07-15T12:00:00Z");

function inst(
  over: Partial<InstallmentRow> & {
    id: string;
    term_no: number;
    due_date: string;
    due_amount: number;
    paid_amount?: number;
  },
): InstallmentRow {
  return {
    booking_id: "BK-1",
    particulars: `Installment ${over.term_no}`,
    paid_amount: 0,
    ...over,
  } as InstallmentRow;
}

describe("allocation engine — FIFO, no-skip", () => {
  it("clears the oldest unpaid installment first and cascades forward", () => {
    const rows = [
      inst({ id: "L1", term_no: 1, due_date: "2026-01-01", due_amount: 500_000 }),
      inst({ id: "L2", term_no: 2, due_date: "2026-02-01", due_amount: 842_000 }),
      inst({ id: "L3", term_no: 3, due_date: "2026-03-01", due_amount: 842_000 }),
      inst({ id: "L4", term_no: 4, due_date: "2026-04-01", due_amount: 842_000 }),
    ];
    const res = allocateReceipts(rows, [
      { receipt_no: "R1", amount: 2_000_000, payment_date: "2026-04-15" },
    ]);
    expect(res.lines).toEqual([
      { receipt_no: "R1", installment_id: "L1", amount: 500_000 },
      { receipt_no: "R1", installment_id: "L2", amount: 842_000 },
      { receipt_no: "R1", installment_id: "L3", amount: 658_000 },
    ]);
    expect(res.advance).toBe(0);
    expect(res.paidByInstallment).toEqual({ L1: 500_000, L2: 842_000, L3: 658_000, L4: 0 });
  });

  it("carries surplus into advance when everything is paid", () => {
    const rows = [inst({ id: "L1", term_no: 1, due_date: "2026-01-01", due_amount: 100 })];
    const res = allocateReceipts(rows, [{ receipt_no: "R1", amount: 250 }]);
    expect(res.advance).toBe(150);
  });

  it("supports unlimited partial payments against one installment", () => {
    const rows = [inst({ id: "L1", term_no: 1, due_date: "2026-01-01", due_amount: 842_000 })];
    const res = allocateReceipts(rows, [
      { receipt_no: "R1", amount: 200_000 },
      { receipt_no: "R2", amount: 300_000 },
      { receipt_no: "R3", amount: 342_000 },
    ]);
    expect(res.paidByInstallment.L1).toBe(842_000);
    expect(res.advance).toBe(0);
    expect(res.lines).toHaveLength(3);
  });

  it("respects existing paid_amount so allocations do not double-count", () => {
    const rows = [
      inst({ id: "L1", term_no: 1, due_date: "2026-01-01", due_amount: 500, paid_amount: 500 }),
      inst({ id: "L2", term_no: 2, due_date: "2026-02-01", due_amount: 500 }),
    ];
    const res = allocateReceipts(rows, [{ receipt_no: "R1", amount: 300 }]);
    expect(res.lines).toEqual([{ receipt_no: "R1", installment_id: "L2", amount: 300 }]);
  });
});

describe("status engine — derived, never stored", () => {
  const base = { id: "L", booking_id: "B", term_no: 1, particulars: "x" } as const;
  it("PAID when paid >= due", () => {
    expect(
      deriveStatus({ ...base, due_date: "2026-01-01", due_amount: 100, paid_amount: 100 }, TODAY),
    ).toBe("PAID");
  });
  it("OVERDUE when past due and unpaid", () => {
    expect(
      deriveStatus({ ...base, due_date: "2026-01-01", due_amount: 100, paid_amount: 0 }, TODAY),
    ).toBe("OVERDUE");
  });
  it("PARTIAL when some paid and not yet past due", () => {
    expect(
      deriveStatus({ ...base, due_date: "2026-12-01", due_amount: 100, paid_amount: 40 }, TODAY),
    ).toBe("PARTIAL");
  });
  it("OVERDUE when past due even with partial payment", () => {
    expect(
      deriveStatus({ ...base, due_date: "2026-01-01", due_amount: 100, paid_amount: 40 }, TODAY),
    ).toBe("OVERDUE");
  });
  it("UPCOMING when future and untouched", () => {
    expect(
      deriveStatus({ ...base, due_date: "2026-12-31", due_amount: 100, paid_amount: 0 }, TODAY),
    ).toBe("UPCOMING");
  });
  it("lifecycle flags override numbers", () => {
    expect(
      deriveStatus(
        { ...base, due_date: "2026-01-01", due_amount: 100, paid_amount: 0, is_waived: true },
        TODAY,
      ),
    ).toBe("WAIVED");
    expect(
      deriveStatus(
        { ...base, due_date: "2026-01-01", due_amount: 100, paid_amount: 100, is_cancelled: true },
        TODAY,
      ),
    ).toBe("CANCELLED");
  });
});

describe("projection — combines allocation + status + running balance", () => {
  it("produces a monotonically increasing running balance across unpaid rows", () => {
    const installments: InstallmentRow[] = [
      inst({ id: "L1", term_no: 1, due_date: "2026-01-01", due_amount: 500_000 }),
      inst({ id: "L2", term_no: 2, due_date: "2026-02-01", due_amount: 842_000 }),
      inst({ id: "L3", term_no: 3, due_date: "2026-03-01", due_amount: 842_000 }),
    ];
    const txns: LedgerTxn[] = [
      {
        id: "T1",
        booking_id: "BK-1",
        txn_date: "2026-01-05",
        posted_at: "2026-01-05T00:00:00Z",
        txn_type: "PAYMENT_RECEIVED",
        debit: 0,
        credit: 700_000,
        reference_type: "payments",
        reference_id: "R1",
        voucher_no: "R1",
        description: null,
      },
    ];
    const rows = projectInstallments({ installments, transactions: txns, today: TODAY });
    expect(rows.map((r) => r.status)).toEqual(["PAID", "OVERDUE", "OVERDUE"]);
    expect(rows[0].remaining).toBe(0);
    expect(rows[1].remaining).toBe(642_000); // 842_000 - 200_000 leftover
    expect(rows[2].remaining).toBe(842_000);
    expect(rows[2].running_balance).toBeCloseTo(500_000 + 842_000 + 842_000 - 700_000, 2);
  });
});

describe("summary engine — derives headline figures from the ledger", () => {
  it("splits current / future / overdue and rolls up grand outstanding", () => {
    const installments: InstallmentRow[] = [
      inst({ id: "L1", term_no: 1, due_date: "2026-01-01", due_amount: 1000 }),
      inst({ id: "L2", term_no: 2, due_date: "2026-05-01", due_amount: 1000 }),
      inst({ id: "L3", term_no: 3, due_date: "2026-12-01", due_amount: 1000 }),
    ];
    const txns: LedgerTxn[] = [
      {
        id: "T1",
        booking_id: "BK-1",
        txn_date: "2026-01-01",
        posted_at: "2026-01-01T00:00:00Z",
        txn_type: "INSTALLMENT_DUE",
        debit: 1000,
        credit: 0,
        reference_type: "installment_ledger",
        reference_id: "L1",
        voucher_no: "L1",
        description: null,
      },
      {
        id: "T2",
        booking_id: "BK-1",
        txn_date: "2026-05-01",
        posted_at: "2026-05-01T00:00:00Z",
        txn_type: "INSTALLMENT_DUE",
        debit: 1000,
        credit: 0,
        reference_type: "installment_ledger",
        reference_id: "L2",
        voucher_no: "L2",
        description: null,
      },
      {
        id: "T3",
        booking_id: "BK-1",
        txn_date: "2026-12-01",
        posted_at: "2026-12-01T00:00:00Z",
        txn_type: "INSTALLMENT_DUE",
        debit: 1000,
        credit: 0,
        reference_type: "installment_ledger",
        reference_id: "L3",
        voucher_no: "L3",
        description: null,
      },
      {
        id: "T4",
        booking_id: "BK-1",
        txn_date: "2026-01-05",
        posted_at: "2026-01-05T00:00:00Z",
        txn_type: "PAYMENT_RECEIVED",
        debit: 0,
        credit: 1400,
        reference_type: "payments",
        reference_id: "R1",
        voucher_no: "R1",
        description: null,
      },
      {
        id: "T5",
        booking_id: "BK-1",
        txn_date: "2026-06-01",
        posted_at: "2026-06-01T00:00:00Z",
        txn_type: "MAINTENANCE_CHARGE",
        debit: 500,
        credit: 0,
        reference_type: "maintenance_charges",
        reference_id: "M1",
        voucher_no: "M1",
        description: null,
      },
    ];
    const projected = projectInstallments({ installments, transactions: txns, today: TODAY });
    const s = buildBookingSummary({
      transactions: txns,
      installments: projected,
      possession_amount: 200,
      today: TODAY,
    });

    expect(s.total_contract_value).toBe(3000);
    expect(s.total_received).toBe(1400);
    expect(s.overdue_amount).toBe(600); // L2 unpaid remainder
    expect(s.overdue_count).toBe(1);
    expect(s.future_due).toBe(1000); // L3
    expect(s.additional_charges).toBe(500);
    expect(s.outstanding_balance).toBe(3500 - 1400); // charges - credits
    expect(s.grand_outstanding).toBe(2100 + 200);
  });
});
