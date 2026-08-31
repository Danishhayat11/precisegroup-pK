/**
 * Cross-engine "today" consistency tests.
 *
 * Goal: when the admin changes `get_system_date()`, every downstream
 * derivation of overdue and aging MUST move in lock-step. There can be
 * no module that silently uses `new Date()` instead of the override.
 *
 * Strategy: feed identical ledger fixtures into both pure engines that
 * derive overdue/aging on the client side:
 *   - `recomputeOverdueByBooking` (cache reconciliation + KPIs)
 *   - `recalculateLedger` (FIFO row engine used by BookingDetail)
 *
 * For each engine and each `today` value, the count of overdue installments
 * and the total overdue amount MUST match. We then sweep `today` across
 * three values that span before, during, and after the schedule and assert
 * the numbers change identically in both engines.
 */
import { describe, it, expect } from "vitest";
import { recomputeOverdueByBooking, type LedgerRow } from "@/lib/overdue";
import { recalculateLedger, type LedgerInputRow } from "@/lib/fifoEngine";

const BOOKING = "BK-TEST-01";

const SCHEDULE: { ledger_id: string; due_date: string; due_amount: number; particulars: string }[] =
  [
    { ledger_id: "L1", due_date: "2026-01-15", due_amount: 100_000, particulars: "Installment 01" },
    { ledger_id: "L2", due_date: "2026-02-15", due_amount: 100_000, particulars: "Installment 02" },
    { ledger_id: "L3", due_date: "2026-03-15", due_amount: 100_000, particulars: "Installment 03" },
    { ledger_id: "L4", due_date: "2026-04-15", due_amount: 100_000, particulars: "Installment 04" },
    { ledger_id: "L5", due_date: "2026-05-15", due_amount: 100_000, particulars: "Installment 05" },
  ];

// Cash receipts cover installments 1-2 exactly; nothing on 3+.
const CASH_TOTAL = 200_000;

function overdueViaOverdueLib(today: string): { count: number; amount: number } {
  const rows: LedgerRow[] = SCHEDULE.map((r) => ({
    booking_id: BOOKING,
    particulars: r.particulars,
    due_date: r.due_date,
    due_amount: r.due_amount,
    // The overdue lib assumes the cache already reflects paid amounts,
    // mirroring how the SQL trigger writes paid_amount before recomputing.
    paid_amount: r.ledger_id === "L1" || r.ledger_id === "L2" ? r.due_amount : 0,
  }));
  const stats = recomputeOverdueByBooking(rows, today).get(BOOKING)!;
  return { count: stats.current_overdue_count, amount: stats.total_overdue_amount };
}

function overdueViaFifo(today: string): { count: number; amount: number } {
  const rows: LedgerInputRow[] = SCHEDULE.map((r, i) => ({
    ledger_id: r.ledger_id,
    term_no: i + 1,
    particulars: r.particulars,
    due_date: r.due_date,
    due_amount: r.due_amount,
  }));
  const out = recalculateLedger({
    schedule: rows,
    cashTotal: CASH_TOTAL,
    adjustmentCredit: 0,
    today,
  });
  return { count: out.overdueCount, amount: out.overdueAmount };
}

describe("today override propagates identically across overdue engines", () => {
  // Three checkpoints chosen so each engine should report a different
  // number of overdue installments at each step.
  const CASES: { today: string; expectedCount: number; expectedAmount: number }[] = [
    { today: "2026-01-01", expectedCount: 0, expectedAmount: 0 }, // before any due date
    { today: "2026-04-01", expectedCount: 1, expectedAmount: 100_000 }, // L3 past due, L1+L2 paid
    { today: "2026-06-01", expectedCount: 3, expectedAmount: 300_000 }, // L3, L4, L5 past due
  ];

  for (const c of CASES) {
    it(`agrees on overdue count + amount for today=${c.today}`, () => {
      const a = overdueViaOverdueLib(c.today);
      const b = overdueViaFifo(c.today);
      expect(a).toEqual({ count: c.expectedCount, amount: c.expectedAmount });
      expect(b).toEqual({ count: c.expectedCount, amount: c.expectedAmount });
      // Cross-engine equality is the strongest guarantee that no engine
      // silently reaches for `new Date()` behind the scenes.
      expect(a).toEqual(b);
    });
  }

  it("aging days move in lock-step with the override", () => {
    const overdueRows = (today: string) =>
      recalculateLedger({
        schedule: SCHEDULE.map((r, i) => ({
          ledger_id: r.ledger_id,
          term_no: i + 1,
          particulars: r.particulars,
          due_date: r.due_date,
          due_amount: r.due_amount,
        })),
        cashTotal: CASH_TOTAL,
        adjustmentCredit: 0,
        today,
      }).rows.filter((r) => r.status === "Overdue");

    const earlier = overdueRows("2026-04-01");
    const later = overdueRows("2026-04-10");
    expect(earlier).toHaveLength(1);
    expect(later).toHaveLength(1);
    // 9 calendar days between the two overrides → days_overdue must shift by 9.
    expect(later[0].days_overdue - earlier[0].days_overdue).toBe(9);
  });

  it("changing the override is the ONLY thing that changes the result", () => {
    // Same engine, same inputs, different `today` → must differ.
    expect(overdueViaOverdueLib("2026-04-01")).not.toEqual(overdueViaOverdueLib("2026-06-01"));
    // Same engine, same inputs, same `today` → must match exactly even
    // across calls (no hidden time-dependent state).
    expect(overdueViaOverdueLib("2026-04-01")).toEqual(overdueViaOverdueLib("2026-04-01"));
    expect(overdueViaFifo("2026-04-01")).toEqual(overdueViaFifo("2026-04-01"));
  });
});
