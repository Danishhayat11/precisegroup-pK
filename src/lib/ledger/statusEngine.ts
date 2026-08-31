/**
 * Status Engine — derives installment status from data, never from stored flags.
 *
 * Status is a PURE function of (due_amount, paid_amount, due_date, today,
 * lifecycle flags). Never persist status; always recompute.
 */

import type { InstallmentRow, InstallmentStatus } from "./types";

export interface StatusInput extends InstallmentRow {
  is_waived?: boolean;
  is_cancelled?: boolean;
  is_refunded?: boolean;
}

export function deriveStatus(row: StatusInput, today: Date = new Date()): InstallmentStatus {
  if (row.is_cancelled) return "CANCELLED";
  if (row.is_refunded) return "REFUNDED";
  if (row.is_waived) return "WAIVED";

  const paid = round2((row.paid_amount ?? 0) + (row.credited_amount ?? 0));
  const due = round2(row.due_amount ?? 0);

  if (due <= 0 && paid <= 0) return "UPCOMING";
  if (paid >= due) return "PAID";

  const dueDate = row.due_date ? new Date(row.due_date + "T00:00:00") : null;
  const isOverdue = dueDate ? dueDate.getTime() < startOfDay(today).getTime() : false;

  if (paid > 0) return isOverdue ? "OVERDUE" : "PARTIAL";
  return isOverdue ? "OVERDUE" : "UPCOMING";
}

export function daysOverdue(dueDate: string | null, today: Date = new Date()): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate + "T00:00:00").getTime();
  const now = startOfDay(today).getTime();
  if (due >= now) return 0;
  return Math.floor((now - due) / 86_400_000);
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
