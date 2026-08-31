/**
 * FIFO payment-plan allocation used by the on-screen and PDF Payment Plan.
 *
 * Contract (relied on by DocumentView + tests):
 *  · Cash + adjustment pool is distributed top-to-bottom across the schedule.
 *  · A row whose due_date is strictly in the future can NEVER be "Overdue".
 *    A future-dated row with a partial payment is an **advance** payment
 *    and renders downstream as "Paid in Advance" + "Not Yet Due".
 *  · Overdue KPIs only include past-due rows: `!future && (Overdue || Partial)`.
 */

export type PlanStatus = "Paid" | "Overdue" | "Upcoming" | "Partial";

export interface ScheduleRow {
  due_amount?: number | string | null;
  paid_amount?: number | string | null;
  due_date?: string | Date | null;
  particulars?: string | null;
  term_no?: number | null;
  /**
   * Optional: latest payment timestamp applied to this row from the payments
   * ledger. When present, it is cross-checked against `due_date` to confirm
   * that a partial payment was truly received in advance — independent of
   * the machine clock (`now`). This defends against timezone slop and clock
   * skew.
   */
  latest_payment_date?: string | Date | null;
}

export interface AllocEntry<Row extends ScheduleRow = ScheduleRow> {
  row: Row;
  paid: number;
  due: number;
  status: PlanStatus;
  future: boolean;
  /** True when `due_date` parsed to a valid calendar date. */
  dueDateValid: boolean;
  /**
   * True when a payment date is available AND was recorded on or before the
   * due date. Independent confirmation of "advance" status, unaffected by
   * the current clock.
   */
  paidBeforeDue: boolean;
  /** Warning strings — surfaced in the structured trace for support. */
  warnings: string[];
}

/**
 * Parse a value into a calendar-day Date (time set to local midnight), or
 * return null when the value is missing / unparseable. Comparing at
 * calendar-day granularity avoids "same day but different timezone" bugs
 * where a due date renders as overdue by 5 hours.
 */
function toCalendarDay(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? new Date(v.getTime()) : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

export function allocatePaymentPlan<Row extends ScheduleRow>(
  schedule: Row[],
  totalReceived: number,
  now: Date = new Date(),
): AllocEntry<Row>[] {
  let pool = Math.max(0, Number(totalReceived) || 0);
  const today = toCalendarDay(now) ?? new Date(new Date().setHours(0, 0, 0, 0));

  return schedule.map((l) => {
    const due = Number(l.due_amount || 0);
    const paid = Math.min(pool, due);
    pool -= paid;

    const warnings: string[] = [];
    const dueDay = toCalendarDay(l.due_date);
    const dueDateValid = dueDay !== null;
    if (!dueDateValid && l.due_date != null && l.due_date !== "") {
      warnings.push(`unparseable due_date: ${String(l.due_date)}`);
    }

    // Primary signal — clock-based comparison at day granularity.
    let future = dueDateValid && dueDay!.getTime() >= today.getTime();

    // Cross-check against the underlying payment timestamp (defensive).
    const payDay = toCalendarDay(l.latest_payment_date);
    let paidBeforeDue = false;
    if (paid > 0 && payDay && dueDay) {
      paidBeforeDue = payDay.getTime() <= dueDay.getTime();
      // If the payment demonstrably preceded the due date, we have a hard
      // proof of "advance" — treat as future even if the machine clock is
      // wrong or the due date is exactly today.
      if (paidBeforeDue && !future) {
        warnings.push(
          `advance override: payment ${payDay.toISOString().slice(0, 10)} ` +
            `predates due ${dueDay.toISOString().slice(0, 10)} but now-check said past`,
        );
        future = true;
      }
    }

    let status: PlanStatus = "Upcoming";
    if (due > 0 && paid >= due) status = "Paid";
    else if (paid > 0 && paid < due) status = "Partial";
    else if (due > 0 && !future && dueDateValid) status = "Overdue";

    // Hard invariant: future-dated rows can never be Overdue.
    if (future && status === "Overdue") status = "Upcoming";

    return { row: l, paid, due, status, future, dueDateValid, paidBeforeDue, warnings };
  });
}

export function overdueEntries<Row extends ScheduleRow>(
  alloc: AllocEntry<Row>[],
): AllocEntry<Row>[] {
  return alloc.filter(
    (a) => !a.future && (a.status === "Overdue" || (a.status === "Partial" && a.paid < a.due)),
  );
}

export function overdueSummary<Row extends ScheduleRow>(alloc: AllocEntry<Row>[]) {
  const entries = overdueEntries(alloc);
  return {
    count: entries.length,
    amount: entries.reduce((s, a) => s + (a.due - a.paid), 0),
  };
}

/* ------------------------------------------------------------------ *
 * Structured client-side logging
 *
 * Fires one grouped console entry per Payment Plan render describing how
 * every row was classified (paid / partial-advance / partial-overdue /
 * upcoming / overdue). Also appends a compact trace record to
 * `window.__paymentPlanTrace` (ring buffer of 50) so support can copy the
 * last N classifications without re-opening devtools before the bug.
 *
 * Gated to avoid noise:
 *   · always on when `import.meta.env.DEV` is true
 *   · always on when `localStorage.debug === "paymentPlan"` (or contains it)
 * Silent otherwise.
 * ------------------------------------------------------------------ */

export interface AllocLogRow {
  idx: number;
  particulars: string;
  due_date: string | null;
  latest_payment_date: string | null;
  due: number;
  paid: number;
  status: PlanStatus;
  future: boolean;
  dueDateValid: boolean;
  paidBeforeDue: boolean;
  warnings: string[];
  /** Human-readable classification, e.g. "advance-partial", "overdue". */
  classification:
    | "paid"
    | "advance-partial"
    | "advance-upcoming"
    | "past-partial-overdue"
    | "overdue"
    | "upcoming";
}

export interface AllocLogEntry {
  ts: string;
  bookingId?: string | null;
  totalReceived: number;
  contract?: number | null;
  now: string;
  overdueCount: number;
  overdueAmount: number;
  advanceCount: number;
  warningCount: number;
  rows: AllocLogRow[];
}

function classify<Row extends ScheduleRow>(a: AllocEntry<Row>): AllocLogRow["classification"] {
  if (a.status === "Paid") return "paid";
  if (a.status === "Partial") return a.future ? "advance-partial" : "past-partial-overdue";
  if (a.status === "Overdue") return "overdue";
  // Upcoming — split future vs past for traceability (past-Upcoming means due=0).
  return a.future ? "advance-upcoming" : "upcoming";
}

function loggingEnabled(): boolean {
  try {
    const env: any = (import.meta as any)?.env;
    if (env?.DEV) return true;
    if (typeof localStorage !== "undefined") {
      const flag = localStorage.getItem("debug") ?? localStorage.getItem("debug.paymentPlan");
      if (flag && /paymentPlan|1|true|all/i.test(flag)) return true;
    }
  } catch {
    /* SSR or restricted storage */
  }
  return false;
}

export function buildAllocLogEntry<Row extends ScheduleRow>(
  alloc: AllocEntry<Row>[],
  meta: { bookingId?: string | null; totalReceived: number; contract?: number | null; now?: Date },
): AllocLogEntry {
  const now = meta.now ?? new Date();
  const rows: AllocLogRow[] = alloc.map((a, idx) => ({
    idx,
    particulars: String((a.row as any).particulars ?? ""),
    due_date: (a.row as any).due_date ? String((a.row as any).due_date) : null,
    latest_payment_date: (a.row as any).latest_payment_date
      ? String((a.row as any).latest_payment_date)
      : null,
    due: a.due,
    paid: a.paid,
    status: a.status,
    future: a.future,
    dueDateValid: a.dueDateValid,
    paidBeforeDue: a.paidBeforeDue,
    warnings: a.warnings,
    classification: classify(a),
  }));
  const summary = overdueSummary(alloc);
  return {
    ts: new Date().toISOString(),
    bookingId: meta.bookingId ?? null,
    totalReceived: meta.totalReceived,
    contract: meta.contract ?? null,
    now: now.toISOString(),
    overdueCount: summary.count,
    overdueAmount: summary.amount,
    advanceCount: rows.filter((r) => r.classification === "advance-partial").length,
    warningCount: rows.reduce((s, r) => s + r.warnings.length, 0),
    rows,
  };
}

const TRACE_KEY = "__paymentPlanTrace";
const TRACE_MAX = 50;

export function logAllocation<Row extends ScheduleRow>(
  alloc: AllocEntry<Row>[],
  meta: { bookingId?: string | null; totalReceived: number; contract?: number | null; now?: Date },
): AllocLogEntry {
  const entry = buildAllocLogEntry(alloc, meta);

  // Ring buffer on window so it survives across renders and is copy-pastable.
  try {
    if (typeof window !== "undefined") {
      const w = window as any;
      const buf: AllocLogEntry[] = Array.isArray(w[TRACE_KEY]) ? w[TRACE_KEY] : [];
      buf.push(entry);
      while (buf.length > TRACE_MAX) buf.shift();
      w[TRACE_KEY] = buf;
    }
  } catch {
    /* noop */
  }

  if (!loggingEnabled()) return entry;

  try {
    const advance = entry.rows.filter((r) => r.classification === "advance-partial");

    console.groupCollapsed(
      `%c[PaymentPlan]%c ${entry.bookingId ?? "(no id)"} · received ${entry.totalReceived} · overdue ${entry.overdueCount}/${entry.overdueAmount} · advance ${entry.advanceCount}`,
      "color:#059669;font-weight:700",
      "color:inherit",
    );

    console.table(entry.rows);
    if (advance.length) {
      console.info(
        "Advance-classified rows (future-dated partial payments — excluded from overdue KPIs):",
        advance,
      );
    }

    console.groupEnd();
  } catch {
    /* noop */
  }

  return entry;
}
