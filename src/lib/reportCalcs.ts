/**
 * Pure calculation helpers that mirror the report logic in
 * `src/components/reports/DrillDowns.tsx`. Keeping the math in one
 * dependency-free module makes it testable in isolation (see
 * `src/lib/__tests__/reportCalcs.test.ts`).
 *
 * If a formula ever diverges between DrillDowns and this file, the tests
 * will catch it — treat this module as the executable spec.
 */

export type BookingRow = {
  booking_id: string;
  client_name?: string | null;
  unit_id?: string | null;
  project_code?: string | null;
  booking_status?: string | null;
  booking_date?: string | null;
  total_contract_value?: number | null;
  down_payment?: number | null;
  adjustment_credit?: number | null;
  cash_received?: number | null;
  remaining_balance?: number | null;
  current_overdue_count?: number | null;
  oldest_overdue_date?: string | null;
  risk_level?: string | null;
};

export type PaymentRow = {
  receipt_no: string;
  booking_id?: string | null;
  payment_date?: string | null;
  payment_mode?: string | null;
  payment_head?: string | null;
  amount?: number | null;
};

export type LedgerRow = {
  ledger_id?: string;
  booking_id: string;
  term_no?: number | null;
  due_date?: string | null;
  due_amount?: number | null;
  paid_amount?: number | null;
  particulars?: string | null;
};

export type AdjustmentRow = {
  adjustment_id: string;
  booking_id: string;
  approved_value?: number | null;
  realized_value?: number | null;
  company_loss_gain?: number | null;
  approval_date?: string | null;
  realization_date?: string | null;
  status?: string | null;
};

export function num(x: unknown): number {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function inRange(dateStr: string | null | undefined, from: string, to: string): boolean {
  if (!dateStr) return false;
  const d = String(dateStr).slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

/* -------- Report 1: Booking Summary ------------------------------- */

export type BookingSummaryTotals = {
  sale: number;
  down: number;
  adj: number;
  paid: number;
  bal: number;
};

export function bookingSummary(
  bookings: BookingRow[],
  opts: { status?: string; from?: string; to?: string } = {},
): { rows: BookingRow[]; totals: BookingSummaryTotals } {
  const { status = "all", from = "", to = "" } = opts;
  const rows = bookings.filter((b) => {
    if (status !== "all" && (b.booking_status ?? "") !== status) return false;
    if (from || to) {
      if (!inRange(b.booking_date, from, to)) return false;
    }
    return true;
  });
  const totals = rows.reduce<BookingSummaryTotals>(
    (acc, b) => {
      acc.sale += num(b.total_contract_value);
      acc.down += num(b.down_payment);
      acc.adj += num(b.adjustment_credit);
      acc.paid += num(b.cash_received);
      acc.bal += num(b.remaining_balance);
      return acc;
    },
    { sale: 0, down: 0, adj: 0, paid: 0, bal: 0 },
  );
  return { rows, totals };
}

/* -------- Report 2: Payment Collection (grouped by month) --------- */

export function paymentCollection(
  payments: PaymentRow[],
  opts: { from?: string; to?: string; mode?: string } = {},
): {
  filtered: PaymentRow[];
  byMonth: Array<{ month: string; rows: PaymentRow[]; subtotal: number }>;
  grandTotal: number;
} {
  const { from = "", to = "", mode = "all" } = opts;
  const filtered = payments
    .filter((p) => {
      if (from || to) {
        if (!inRange(p.payment_date, from, to)) return false;
      }
      if (mode !== "all" && (p.payment_mode ?? "") !== mode) return false;
      return true;
    })
    .sort((a, b) => String(a.payment_date ?? "").localeCompare(String(b.payment_date ?? "")));

  const map = new Map<string, PaymentRow[]>();
  for (const p of filtered) {
    const key = String(p.payment_date ?? "").slice(0, 7) || "Unknown";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  const byMonth = Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, rows]) => ({
      month,
      rows,
      subtotal: rows.reduce((s, p) => s + num(p.amount), 0),
    }));
  const grandTotal = filtered.reduce((s, p) => s + num(p.amount), 0);
  return { filtered, byMonth, grandTotal };
}

/* -------- Report 3: Outstanding Balance --------------------------- */

export function outstandingBalance(bookings: BookingRow[]): {
  rows: BookingRow[];
  total: number;
} {
  const rows = bookings
    .filter((b) => num(b.remaining_balance) > 0)
    .slice()
    .sort((a, b) => num(b.remaining_balance) - num(a.remaining_balance));
  const total = rows.reduce((s, b) => s + num(b.remaining_balance), 0);
  return { rows, total };
}

/* -------- Report 4: Overdue Installments -------------------------- */

export type OverdueRow = {
  booking_id: string;
  client: string;
  unit: string;
  term_no: number | null | undefined;
  due_date: string;
  due: number;
  days: number;
  paid: number;
  bal: number;
};

export function overdueInstallments(
  ledger: LedgerRow[],
  bookings: BookingRow[],
  now: Date = new Date(),
): { rows: OverdueRow[]; total: number } {
  const today = now.toISOString().slice(0, 10);
  const byId = new Map(bookings.map((b) => [b.booking_id, b]));
  const rows: OverdueRow[] = [];
  for (const l of ledger) {
    const due = num(l.due_amount);
    const paid = num(l.paid_amount);
    const bal = Math.max(due - paid, 0);
    if (!l.due_date || l.due_date >= today || bal <= 0) continue;
    if (/down payment|possession/i.test(l.particulars ?? "")) continue;
    const days = Math.floor((now.getTime() - new Date(l.due_date).getTime()) / 86400000);
    const b = byId.get(l.booking_id);
    rows.push({
      booking_id: l.booking_id,
      client: b?.client_name ?? "—",
      unit: b?.unit_id ?? "—",
      term_no: l.term_no,
      due_date: l.due_date,
      due,
      days,
      paid,
      bal,
    });
  }
  rows.sort((a, b) => b.days - a.days);
  const total = rows.reduce((s, r) => s + r.bal, 0);
  return { rows, total };
}

/* -------- Report 5: Adjustment Register --------------------------- */

export type AdjustmentTotals = { approved: number; realized: number; net: number };

export function adjustmentRegister(adjustments: AdjustmentRow[]): {
  rows: AdjustmentRow[];
  totals: AdjustmentTotals;
} {
  const rows = adjustments
    .slice()
    .sort((a, b) => String(b.approval_date ?? "").localeCompare(String(a.approval_date ?? "")));
  const totals = rows.reduce<AdjustmentTotals>(
    (acc, a) => {
      acc.approved += num(a.approved_value);
      acc.realized += num(a.realized_value);
      acc.net += num(a.company_loss_gain);
      return acc;
    },
    { approved: 0, realized: 0, net: 0 },
  );
  return { rows, totals };
}

/* -------- Report 6: Cash Flow Summary ----------------------------- */

export type CashFlowMonth = {
  month: string;
  installments: number;
  down: number;
  other: number;
  adj: number;
  cashIn: number;
  totalRealized: number;
  running: number;
};

export type CashFlowTotals = Omit<CashFlowMonth, "month" | "running">;

export function cashFlowSummary(
  payments: PaymentRow[],
  adjustments: AdjustmentRow[],
): { rows: CashFlowMonth[]; totals: CashFlowTotals } {
  const months = new Map<
    string,
    { installments: number; down: number; other: number; adj: number }
  >();
  const bump = (m: string) => {
    if (!months.has(m)) months.set(m, { installments: 0, down: 0, other: 0, adj: 0 });
    return months.get(m)!;
  };
  for (const p of payments) {
    const m = String(p.payment_date ?? "").slice(0, 7);
    if (!m) continue;
    const bucket = bump(m);
    const head = String(p.payment_head ?? "").toLowerCase();
    const amt = num(p.amount);
    if (head.includes("down")) bucket.down += amt;
    else if (head.includes("installment")) bucket.installments += amt;
    else bucket.other += amt;
  }
  for (const a of adjustments) {
    const m = String(a.realization_date ?? "").slice(0, 7);
    if (!m) continue;
    bump(m).adj += num(a.realized_value);
  }
  const sorted = Array.from(months.entries()).sort(([a], [b]) => a.localeCompare(b));
  let running = 0;
  const rows: CashFlowMonth[] = sorted.map(([month, v]) => {
    const cashIn = v.installments + v.down + v.other;
    const totalRealized = cashIn + v.adj;
    running += totalRealized;
    return { month, ...v, cashIn, totalRealized, running };
  });
  const totals = rows.reduce<CashFlowTotals>(
    (acc, r) => {
      acc.installments += r.installments;
      acc.down += r.down;
      acc.other += r.other;
      acc.cashIn += r.cashIn;
      acc.adj += r.adj;
      acc.totalRealized += r.totalRealized;
      return acc;
    },
    { installments: 0, down: 0, other: 0, cashIn: 0, adj: 0, totalRealized: 0 },
  );
  return { rows, totals };
}
