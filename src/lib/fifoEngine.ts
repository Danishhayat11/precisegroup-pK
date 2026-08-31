/**
 * Pure, deterministic FIFO ledger-allocation engine — the single TypeScript
 * mirror of `public.recalculate_ledger_for_booking` in SQL. Used by tests,
 * the Data Health dashboard for live recomputation, and any client-side
 * preview UI.
 *
 * Rule 1 — Adjustment credit applies up front (top of schedule), then
 * cash/bank payments are walked across due rows in due-date order.
 * Rule 2 — `today` is an explicit parameter; never call `new Date()` here.
 * Rule 6 — Overdue amount is the sum of `balance` on rows whose due_date
 * has actually passed; this is by construction ≤ total balance.
 */

export type LedgerInputRow = {
  ledger_id: string;
  particulars?: string | null;
  due_date: string | null; // YYYY-MM-DD
  due_amount: number | null;
  term_no?: number | null;
};

export type LedgerOutputRow = {
  ledger_id: string;
  particulars: string;
  due_date: string | null;
  due_amount: number;
  cumulative_due: number;
  paid_amount: number;
  balance: number;
  status: "Paid" | "Partial" | "Overdue" | "Upcoming";
  days_overdue: number;
};

export type EngineInput = {
  schedule: LedgerInputRow[];
  cashTotal: number; // sum of cash/bank receipts only (NOT adjustment)
  adjustmentCredit: number;
  today: string; // YYYY-MM-DD
};

export type EngineOutput = {
  rows: LedgerOutputRow[];
  totalEffectivePaid: number;
  totalDue: number;
  overdueAmount: number;
  overdueCount: number;
};

const n = (v: unknown) => {
  const x = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

export function recalculateLedger(input: EngineInput): EngineOutput {
  const today = input.today;
  // Stable ordering: due_date ASC (nulls last), then term_no, then ledger_id
  const sorted = [...input.schedule].sort((a, b) => {
    const ad = a.due_date ?? "9999-12-31";
    const bd = b.due_date ?? "9999-12-31";
    if (ad !== bd) return ad < bd ? -1 : 1;
    const at = a.term_no ?? Number.POSITIVE_INFINITY;
    const bt = b.term_no ?? Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
    return a.ledger_id < b.ledger_id ? -1 : 1;
  });

  const effective = n(input.cashTotal) + n(input.adjustmentCredit);
  let cum = 0;
  let overdueAmount = 0;
  let overdueCount = 0;

  const rows: LedgerOutputRow[] = sorted.map((row) => {
    const due = n(row.due_amount);
    cum += due;
    const dueBefore = cum - due;
    const paid = Math.max(0, Math.min(due, effective - dueBefore));
    const balance = Math.max(0, due - paid);
    const past = !!row.due_date && row.due_date < today;
    let status: LedgerOutputRow["status"];
    if (effective >= cum) status = "Paid";
    else if (paid > 0) status = "Partial";
    else if (past) status = "Overdue";
    else status = "Upcoming";

    let days = 0;
    if (past && balance > 0 && row.due_date) {
      const ms = Date.parse(today) - Date.parse(row.due_date);
      days = Math.max(0, Math.floor(ms / 86_400_000));
    }
    if (past && balance > 0) {
      overdueAmount += balance;
      overdueCount += 1;
    }

    return {
      ledger_id: row.ledger_id,
      particulars: String(row.particulars ?? ""),
      due_date: row.due_date,
      due_amount: due,
      cumulative_due: cum,
      paid_amount: paid,
      balance,
      status,
      days_overdue: days,
    };
  });

  return {
    rows,
    totalEffectivePaid: effective,
    totalDue: cum,
    overdueAmount,
    overdueCount,
  };
}

/**
 * Rule 5 — Payment-plan identity. Compares the payment-schedule line-item
 * sum to contract value. `adjustment_credit` is EXCLUDED because on legacy
 * bookings the adjustment (asset given in) is already mirrored inside
 * `down_payment` — including it here double-counts the concession and
 * produces false plan-identity mismatches. The adjustment credit is
 * validated separately by the ledger engine (it feeds `v_effective`).
 */
export function checkPlanIdentity(b: {
  down_payment?: number | null;
  adjustment_credit?: number | null;
  installment_amount?: number | null;
  no_of_installments?: number | null;
  possession_amount?: number | null;
  total_contract_value?: number | null;
  sold_unit_value?: number | null;
}) {
  const planSum =
    n(b.down_payment) + n(b.installment_amount) * n(b.no_of_installments) + n(b.possession_amount);
  const contract = n(b.total_contract_value || b.sold_unit_value);
  const diff = Math.round((planSum - contract) * 100) / 100;
  return { planSum, contract, diff, matches: Math.abs(diff) <= 1 };
}

/**
 * Rule 6 — Hard invariant. Returns null if overdue ≤ balance, else a CRITICAL
 * issue payload to surface in the Data Health dashboard.
 */
export function checkOverdueInvariant(
  bookingId: string,
  overdueAmount: number,
  totalBalance: number,
) {
  if (overdueAmount <= totalBalance + 1) return null;
  return {
    booking_id: bookingId,
    severity: "CRITICAL" as const,
    rule: "overdue_exceeds_balance" as const,
    message: `Overdue (${overdueAmount}) exceeds total balance (${totalBalance}) — cached value is wrong.`,
  };
}
