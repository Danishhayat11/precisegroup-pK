/**
 * Summary Engine — derives every headline figure from ledger transactions.
 *
 * All amounts are computed dynamically from the ledger. Nothing is stored.
 */

import type { BookingLedgerSummary, InstallmentProjection, LedgerTxn } from "./types";

export interface SummaryInput {
  transactions: LedgerTxn[];
  installments: InstallmentProjection[];
  possession_amount?: number;
  today?: Date;
}

export function buildBookingSummary({
  transactions,
  installments,
  possession_amount = 0,
  today = new Date(),
}: SummaryInput): BookingLedgerSummary {
  const now = startOfDay(today).getTime();

  let total_charges = 0;
  let total_credits = 0;
  let total_received = 0;
  let additional_charges = 0;

  for (const t of transactions) {
    total_charges += t.debit;
    total_credits += t.credit;
    if (t.txn_type === "PAYMENT_RECEIVED" || t.txn_type === "MAINTENANCE_PAYMENT") {
      // Rule: Only non-adjustment credits count as total_received
      const isAdjustment =
        t.meta?.payment_mode === "Adjustment/Asset" || t.meta?.payment_mode === "Adjustment";
      if (!isAdjustment) {
        total_received += t.credit;
      } else {
        // Business Rule: Total Received = Cash + Adjustment Approved - Commission Paid.
        // We include realized value of adjustments in the total received figure.
        total_received += Number(t.meta?.realized_value) || 0;
      }
    }
    if (
      t.txn_type === "MAINTENANCE_CHARGE" ||
      t.txn_type === "POSSESSION_CHARGE" ||
      t.txn_type === "UTILITY_CHARGE" ||
      t.txn_type === "CUSTOM_CHARGE" ||
      t.txn_type === "PENALTY"
    ) {
      additional_charges += t.debit;
    }
  }

  let current_due = 0;
  let future_due = 0;
  let overdue_amount = 0;
  let overdue_count = 0;

  for (const inst of installments) {
    if (inst.status === "PAID" || inst.status === "WAIVED" || inst.status === "CANCELLED") continue;
    const remaining = inst.remaining;
    if (remaining <= 0) continue;

    const dueTs = inst.due_date ? new Date(inst.due_date + "T00:00:00").getTime() : now;
    if (dueTs < now) {
      overdue_amount = r(overdue_amount + remaining);
      overdue_count += 1;
    } else if (dueTs === now) {
      current_due = r(current_due + remaining);
    } else {
      future_due = r(future_due + remaining);
    }
  }

  const outstanding_balance = r(total_charges - total_credits);
  const total_contract_value = r(installments.reduce((acc, i) => acc + (i.due_amount ?? 0), 0));
  const grand_outstanding = r(outstanding_balance + possession_amount);

  return {
    total_contract_value,
    total_received: r(total_received),
    total_credits: r(total_credits),
    outstanding_balance,
    current_due,
    future_due,
    overdue_amount,
    overdue_count,
    additional_charges: r(additional_charges),
    possession_balance: r(possession_amount),
    grand_outstanding,
  };
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function r(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
