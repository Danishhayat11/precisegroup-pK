/**
 * Projection — build display-ready installments + running balances from the ledger.
 *
 * Pure function; feeds the existing UI/print/PDF layer without changing them.
 */

import {
  allocateReceipts,
  sortInstallmentsForAllocation,
  type AllocationInput,
} from "./allocation";
import { daysOverdue, deriveStatus, type StatusInput } from "./statusEngine";
import type { InstallmentProjection, InstallmentRow, LedgerTxn } from "./types";

export interface ProjectionInput {
  installments: InstallmentRow[];
  transactions: LedgerTxn[];
  today?: Date;
  waivedIds?: Set<string>;
  cancelledIds?: Set<string>;
  refundedIds?: Set<string>;
}

/**
 * Build the projection: apply FIFO allocation of any unallocated receipts,
 * derive statuses, and compute a per-installment running balance.
 */
export function projectInstallments({
  installments,
  transactions,
  today = new Date(),
  waivedIds,
  cancelledIds,
  refundedIds,
}: ProjectionInput): InstallmentProjection[] {
  const receipts: AllocationInput[] = transactions
    .filter((t) => t.txn_type === "PAYMENT_RECEIVED" && t.credit > 0)
    .map((t) => ({
      receipt_no: t.reference_id ?? t.id,
      amount: t.credit,
      payment_date: t.txn_date,
    }));

  // Start from the DB-recorded paid_amount as the baseline (already-allocated
  // rows), then let the allocation engine top up any residual receipts.
  const baseline = sortInstallmentsForAllocation(installments);
  const { paidByInstallment } = allocateReceipts(baseline, receipts);

  const ordered = sortInstallmentsForAllocation(installments);
  let runningBalance = 0;

  return ordered.map((inst) => {
    const paid = paidByInstallment[inst.id] ?? inst.paid_amount ?? 0;
    const merged: StatusInput = {
      ...inst,
      paid_amount: paid,
      is_waived: waivedIds?.has(inst.id) ?? false,
      is_cancelled: cancelledIds?.has(inst.id) ?? false,
      is_refunded: refundedIds?.has(inst.id) ?? false,
    };
    const status = deriveStatus(merged, today);
    const remaining = round2(Math.max(0, inst.due_amount - paid));
    runningBalance = round2(runningBalance + inst.due_amount - paid);
    return {
      ...inst,
      paid_amount: paid,
      status,
      remaining,
      days_overdue: status === "OVERDUE" ? daysOverdue(inst.due_date, today) : 0,
      running_balance: runningBalance,
    };
  });
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
