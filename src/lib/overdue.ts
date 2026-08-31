/**
 * Single source of truth for overdue recomputation.
 *
 * Mirrors the SQL function `public.recompute_booking_overdue()` so that
 * cached values on `bookings` (current_overdue_count, total_overdue_amount,
 * remaining_balance) can be verified against a live recomputation from
 * `installment_ledger` rows.
 *
 * Rules (must match the SQL trigger):
 *  - An installment is any ledger row whose `particulars` does NOT match
 *    /down payment|possession/i.
 *  - A row is overdue when due_date < today AND remaining > 0.
 *  - remaining = max(due_amount - paid_amount, 0)
 *  - od_amount is capped at total_remaining (LEAST(...)).
 */

export type LedgerRow = {
  booking_id: string;
  particulars?: string | null;
  due_date?: string | null;
  due_amount?: number | string | null;
  paid_amount?: number | string | null;
};

export type OverdueStats = {
  current_overdue_count: number;
  total_overdue_amount: number;
  remaining_balance: number;
};

const NON_INSTALLMENT = /down payment|possession/i;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** ISO date (YYYY-MM-DD) comparison matches Postgres date < CURRENT_DATE. */
export function isOverdueRow(row: LedgerRow, today: string): boolean {
  if (!row.due_date || row.due_date >= today) return false;
  const remaining = Math.max(num(row.due_amount) - num(row.paid_amount), 0);
  return remaining > 0;
}

export function isInstallmentRow(row: LedgerRow): boolean {
  return !NON_INSTALLMENT.test(String(row.particulars ?? ""));
}

/** Compute overdue stats for one booking from its ledger rows. */
export function recomputeOverdueForBooking(rows: LedgerRow[], today: string): OverdueStats {
  let od_count = 0;
  let od_amount = 0;
  let total_remaining = 0;
  for (const r of rows) {
    const remaining = Math.max(num(r.due_amount) - num(r.paid_amount), 0);
    total_remaining += remaining;
    if (!isInstallmentRow(r)) continue;
    if (!r.due_date || r.due_date >= today) continue;
    if (remaining <= 0) continue;
    od_count += 1;
    od_amount += remaining;
  }
  return {
    current_overdue_count: od_count,
    total_overdue_amount: Math.min(od_amount, total_remaining),
    remaining_balance: total_remaining,
  };
}

/** Compute overdue stats for every booking referenced by the ledger. */
export function recomputeOverdueByBooking(
  rows: LedgerRow[],
  today: string,
): Map<string, OverdueStats> {
  const byBooking = new Map<string, LedgerRow[]>();
  for (const r of rows) {
    if (!r.booking_id) continue;
    const list = byBooking.get(r.booking_id);
    if (list) list.push(r);
    else byBooking.set(r.booking_id, [r]);
  }
  const out = new Map<string, OverdueStats>();
  for (const [bid, list] of byBooking) {
    out.set(bid, recomputeOverdueForBooking(list, today));
  }
  return out;
}

export type CachedBooking = {
  booking_id: string;
  current_overdue_count?: number | string | null;
  total_overdue_amount?: number | string | null;
  remaining_balance?: number | string | null;
};

export type CacheDrift = {
  booking_id: string;
  field: keyof OverdueStats;
  cached: number;
  live: number;
};

/**
 * Returns the set of bookings whose cached overdue fields disagree with
 * a fresh recomputation from the ledger. An empty array means the cache
 * is in sync.
 *
 * Bookings with no ledger rows are expected to read 0/0 for the overdue
 * fields (the SQL function zeros them out). `remaining_balance` is only
 * compared when the booking has ledger rows, because the SQL keeps the
 * existing remaining_balance when no rows exist.
 */
export function findOverdueCacheDrift(
  bookings: CachedBooking[],
  ledger: LedgerRow[],
  today: string,
): CacheDrift[] {
  const live = recomputeOverdueByBooking(ledger, today);
  const drift: CacheDrift[] = [];
  for (const b of bookings) {
    const liveStats = live.get(b.booking_id) ?? {
      current_overdue_count: 0,
      total_overdue_amount: 0,
      remaining_balance: num(b.remaining_balance),
    };
    const cachedCount = num(b.current_overdue_count);
    const cachedAmount = num(b.total_overdue_amount);
    const cachedRemaining = num(b.remaining_balance);
    if (cachedCount !== liveStats.current_overdue_count) {
      drift.push({
        booking_id: b.booking_id,
        field: "current_overdue_count",
        cached: cachedCount,
        live: liveStats.current_overdue_count,
      });
    }
    if (cachedAmount !== liveStats.total_overdue_amount) {
      drift.push({
        booking_id: b.booking_id,
        field: "total_overdue_amount",
        cached: cachedAmount,
        live: liveStats.total_overdue_amount,
      });
    }
    if (live.has(b.booking_id) && cachedRemaining !== liveStats.remaining_balance) {
      drift.push({
        booking_id: b.booking_id,
        field: "remaining_balance",
        cached: cachedRemaining,
        live: liveStats.remaining_balance,
      });
    }
  }
  return drift;
}
