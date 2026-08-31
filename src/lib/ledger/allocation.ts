/**
 * Payment Allocation Engine (FIFO, no-skip)
 *
 * Given a set of installments (in due-date order) and one or more incoming
 * receipts, allocate each receipt to the OLDEST unpaid installment first,
 * cascading forward. Any residual after all installments are cleared is
 * returned as `advance` — callers can post it against future installments
 * as they are created.
 *
 * Pure function. No DB access, no side effects. The database `payment_
 * allocations` table is the persistent counterpart; this engine tells the
 * server what rows to write.
 */

import type { InstallmentRow } from "./types";

export interface AllocationInput {
  receipt_no: string;
  amount: number;
  payment_date?: string;
}

export interface AllocationLine {
  receipt_no: string;
  installment_id: string;
  amount: number;
}

export interface AllocationResult {
  lines: AllocationLine[];
  /** Amount left over after every installment was fully paid. */
  advance: number;
  /** Per-installment map of already-satisfied + newly-allocated totals. */
  paidByInstallment: Record<string, number>;
}

/**
 * Sort installments the way real-world business rules demand:
 *   1. by due_date ascending (nulls last)
 *   2. by term_no ascending
 *   3. by id — final tiebreaker for deterministic output
 */
export function sortInstallmentsForAllocation<T extends InstallmentRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const da = a.due_date ?? "9999-12-31";
    const db = b.due_date ?? "9999-12-31";
    if (da !== db) return da < db ? -1 : 1;
    const ta = a.term_no ?? Number.MAX_SAFE_INTEGER;
    const tb = b.term_no ?? Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

export function allocateReceipts(
  installments: InstallmentRow[],
  receipts: AllocationInput[],
): AllocationResult {
  const ordered = sortInstallmentsForAllocation(installments);
  const paidByInstallment: Record<string, number> = {};
  for (const inst of ordered) {
    paidByInstallment[inst.id] = round2((inst.paid_amount ?? 0) + (inst.credited_amount ?? 0));
  }

  const lines: AllocationLine[] = [];
  let advance = 0;

  const sortedReceipts = [...receipts].sort((a, b) => {
    const ad = a.payment_date ?? "";
    const bd = b.payment_date ?? "";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.receipt_no.localeCompare(b.receipt_no);
  });

  for (const receipt of sortedReceipts) {
    let remaining = round2(receipt.amount);
    if (remaining <= 0) continue;

    for (const inst of ordered) {
      if (remaining <= 0) break;
      const already = paidByInstallment[inst.id];
      const owing = round2(inst.due_amount - already);
      if (owing <= 0) continue;

      const applied = round2(Math.min(owing, remaining));
      if (applied <= 0) continue;

      lines.push({
        receipt_no: receipt.receipt_no,
        installment_id: inst.id,
        amount: applied,
      });
      paidByInstallment[inst.id] = round2(already + applied);
      remaining = round2(remaining - applied);
    }

    if (remaining > 0) advance = round2(advance + remaining);
  }

  return { lines, advance, paidByInstallment };
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
