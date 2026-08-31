import { describe, it, expect } from "vitest";
import { recalculateLedger, checkPlanIdentity, checkOverdueInvariant } from "@/lib/fifoEngine";

const TODAY = "2026-06-30";

const schedule = [
  {
    ledger_id: "L1",
    particulars: "Down Payment",
    due_date: "2024-01-01",
    due_amount: 500_000,
    term_no: 0,
  },
  {
    ledger_id: "L2",
    particulars: "Installment 01",
    due_date: "2024-04-01",
    due_amount: 200_000,
    term_no: 1,
  },
  {
    ledger_id: "L3",
    particulars: "Installment 02",
    due_date: "2024-07-01",
    due_amount: 200_000,
    term_no: 2,
  },
  {
    ledger_id: "L4",
    particulars: "Installment 03",
    due_date: "2027-12-01",
    due_amount: 200_000,
    term_no: 3,
  },
  {
    ledger_id: "L5",
    particulars: "Possession",
    due_date: "2028-12-01",
    due_amount: 100_000,
    term_no: 99,
  },
];

describe("FIFO engine", () => {
  it("allocates cash to oldest rows first", () => {
    const out = recalculateLedger({
      schedule,
      cashTotal: 750_000,
      adjustmentCredit: 0,
      today: TODAY,
    });
    expect(out.rows.map((r) => [r.ledger_id, r.paid_amount, r.status])).toEqual([
      ["L1", 500_000, "Paid"],
      ["L2", 200_000, "Paid"],
      ["L3", 50_000, "Partial"],
      ["L4", 0, "Upcoming"],
      ["L5", 0, "Upcoming"],
    ]);
  });

  it("adjustment credit applies BEFORE cash (top of schedule)", () => {
    const out = recalculateLedger({
      schedule,
      cashTotal: 0,
      adjustmentCredit: 600_000,
      today: TODAY,
    });
    // 500k covers L1, 100k partial on L2
    expect(out.rows[0].status).toBe("Paid");
    expect(out.rows[1].paid_amount).toBe(100_000);
    expect(out.rows[1].status).toBe("Partial");
  });

  it("future-dated row with no payment is NEVER overdue (Rule 1 / Rule 2)", () => {
    const out = recalculateLedger({
      schedule,
      cashTotal: 900_000,
      adjustmentCredit: 0,
      today: TODAY,
    });
    const l4 = out.rows.find((r) => r.ledger_id === "L4")!;
    expect(l4.due_date! > TODAY).toBe(true);
    expect(l4.status).not.toBe("Overdue");
  });

  it("overdue invariant: sum(overdue balances) <= total remaining balance", () => {
    const out = recalculateLedger({ schedule, cashTotal: 0, adjustmentCredit: 0, today: TODAY });
    const totalBalance = out.totalDue - out.totalEffectivePaid;
    expect(out.overdueAmount).toBeLessThanOrEqual(totalBalance);
    expect(checkOverdueInvariant("BK", out.overdueAmount, totalBalance)).toBeNull();
  });

  it("full payment marks every row Paid and zeroes overdue", () => {
    const total = schedule.reduce((s, r) => s + r.due_amount, 0);
    const out = recalculateLedger({
      schedule,
      cashTotal: total,
      adjustmentCredit: 0,
      today: TODAY,
    });
    expect(out.rows.every((r) => r.status === "Paid")).toBe(true);
    expect(out.overdueAmount).toBe(0);
  });

  it("plan identity matches when components sum to contract", () => {
    // `adjustment_credit` is mirrored inside `down_payment` on legacy bookings
    // (see checkPlanIdentity.mirror.test.ts) and MUST be excluded from planSum.
    // So the identity to satisfy is: down_payment + installment*N + possession == contract.
    const r = checkPlanIdentity({
      down_payment: 500_000,
      adjustment_credit: 100_000, // mirrored — excluded
      installment_amount: 200_000,
      no_of_installments: 10,
      possession_amount: 500_000,
      total_contract_value: 3_000_000,
    });
    expect(r.matches).toBe(true);
    expect(r.diff).toBe(0);
  });

  it("plan identity flags mismatch over PKR 1", () => {
    const r = checkPlanIdentity({
      down_payment: 500_000,
      adjustment_credit: 0,
      installment_amount: 200_000,
      no_of_installments: 10,
      possession_amount: 400_000,
      total_contract_value: 3_000_000,
    });
    expect(r.matches).toBe(false);
    expect(r.diff).toBe(-100_000);
  });

  it("ordering is stable across equal due_dates", () => {
    const same = [
      { ledger_id: "B", due_date: "2024-01-01", due_amount: 100, term_no: 2 },
      { ledger_id: "A", due_date: "2024-01-01", due_amount: 100, term_no: 1 },
    ];
    const out = recalculateLedger({
      schedule: same,
      cashTotal: 100,
      adjustmentCredit: 0,
      today: TODAY,
    });
    expect(out.rows[0].ledger_id).toBe("A"); // lower term_no wins
    expect(out.rows[0].paid_amount).toBe(100);
  });
});
