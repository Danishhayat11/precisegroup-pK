/**
 * Plan projection layer.
 *
 * Reads raw booking + installment_ledger + payments + adjustments and produces
 * a display-ready installment schedule (with virtual 3A Paid / 3B Balance Due
 * rows for partial installments) plus a summary DTO consumed by the on-screen
 * plan and the A4 print/PDF layouts.
 *
 * Read-only in Phase 1 — no writes. Status is derived from paid_amount vs
 * due_amount vs due_date; admin overrides come in Phase 2.
 */

export type PlanRowStatus = "PAID" | "PARTIAL" | "UNPAID" | "OVERDUE" | "UPCOMING";

export interface RawLedgerRow {
  ledger_id?: string | null;
  term_no?: number | null;
  particulars?: string | null;
  due_date?: string | null;
  due_amount?: number | string | null;
  paid_amount?: number | string | null;
  status?: string | null;
}

export interface RawPayment {
  payment_date?: string | null;
  received_amount?: number | string | null;
}

export interface PlanRow {
  key: string;
  seq: string; // "1", "2", "3A", "3B" …
  particulars: string;
  dueDate: string | null;
  dueAmount: number;
  paidAmount: number;
  remaining: number;
  status: PlanRowStatus;
  isSplitPaidPart: boolean;
  isSplitBalancePart: boolean;
  daysOverdue: number;
}

export interface PlanSummary {
  contractValue: number;
  cashReceived: number;
  remainingBalance: number;
  overdueCount: number;
  overdueAmount: number;
  upcomingCount: number;
  upcomingAmount: number;
  possessionBalance: number;
  installmentsPaid: number;
  installmentsTotal: number;
}

export interface PlanProjection {
  rows: PlanRow[];
  summary: PlanSummary;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const todayISO = (): string => new Date().toISOString().slice(0, 10);

const isInstallmentRow = (particulars: string): boolean =>
  !/down\s*payment|possession|advance|booking\s*amount/i.test(particulars);

const isPossessionRow = (particulars: string): boolean => /possession/i.test(particulars);

export function projectPlan(
  booking: Record<string, unknown> | null | undefined,
  rawLedger: RawLedgerRow[],
): PlanProjection {
  const today = todayISO();

  // Filter completely empty rows (matches existing BookingDetail logic).
  const ledger = (rawLedger ?? []).filter((l) => {
    const due = num(l.due_amount);
    const paid = num(l.paid_amount);
    const label = String(l.particulars ?? "").trim();
    return due > 0 || paid > 0 || label.length > 0 || !!l.due_date;
  });

  const rows: PlanRow[] = [];
  let installmentsPaid = 0;
  let installmentsTotal = 0;
  let overdueCount = 0;
  let overdueAmount = 0;
  let upcomingCount = 0;
  let upcomingAmount = 0;
  let possessionBalance = 0;

  ledger.forEach((l, idx) => {
    const due = num(l.due_amount);
    const paid = num(l.paid_amount);
    const remaining = Math.max(due - paid, 0);
    const label = String(l.particulars ?? "").trim() || `Installment ${idx + 1}`;
    const seqBase =
      l.term_no != null && l.term_no !== undefined ? String(l.term_no) : String(idx + 1);
    const dueDate = l.due_date ?? null;
    const inst = isInstallmentRow(label);

    if (inst) installmentsTotal += 1;

    const isOverdue = inst && !!dueDate && dueDate < today && remaining > 0;
    const days =
      isOverdue && dueDate
        ? Math.floor((Date.now() - new Date(dueDate).getTime()) / 86_400_000)
        : 0;

    let status: PlanRowStatus;
    if (remaining <= 0 && due > 0) {
      status = "PAID";
      if (inst) installmentsPaid += 1;
    } else if (paid > 0 && remaining > 0) {
      status = "PARTIAL";
    } else if (isOverdue) {
      status = "OVERDUE";
    } else if (inst && dueDate && dueDate > today) {
      status = "UPCOMING";
    } else {
      status = "UNPAID";
    }

    if (status === "OVERDUE") {
      overdueCount += 1;
      overdueAmount += remaining;
    } else if (status === "UPCOMING" || (status === "UNPAID" && dueDate && dueDate >= today)) {
      upcomingCount += 1;
      upcomingAmount += remaining;
    }
    if (isPossessionRow(label)) possessionBalance += remaining;

    // Split partial installments into two virtual rows (3A Paid / 3B Balance Due).
    if (status === "PARTIAL") {
      rows.push({
        key: `${seqBase}-A-${idx}`,
        seq: `${seqBase}A`,
        particulars: `${label} — Paid`,
        dueDate,
        dueAmount: paid,
        paidAmount: paid,
        remaining: 0,
        status: "PAID",
        isSplitPaidPart: true,
        isSplitBalancePart: false,
        daysOverdue: 0,
      });
      rows.push({
        key: `${seqBase}-B-${idx}`,
        seq: `${seqBase}B`,
        particulars: `${label} — Balance Due`,
        dueDate,
        dueAmount: remaining,
        paidAmount: 0,
        remaining,
        status: isOverdue ? "OVERDUE" : "UNPAID",
        isSplitPaidPart: false,
        isSplitBalancePart: true,
        daysOverdue: days,
      });
    } else {
      rows.push({
        key: `${seqBase}-${idx}`,
        seq: seqBase,
        particulars: label,
        dueDate,
        dueAmount: due,
        paidAmount: paid,
        remaining,
        status,
        isSplitPaidPart: false,
        isSplitBalancePart: false,
        daysOverdue: days,
      });
    }
  });

  const contractValue = num(booking?.["total_contract_value"]);
  const cashReceived = num(booking?.["cash_received"]);
  const remainingBalance =
    num(booking?.["remaining_balance"]) || Math.max(contractValue - cashReceived, 0);

  return {
    rows,
    summary: {
      contractValue,
      cashReceived,
      remainingBalance,
      overdueCount,
      overdueAmount,
      upcomingCount,
      upcomingAmount,
      possessionBalance,
      installmentsPaid,
      installmentsTotal,
    },
  };
}

export const statusLabel: Record<PlanRowStatus, string> = {
  PAID: "PAID",
  PARTIAL: "PARTIAL",
  UNPAID: "UNPAID",
  OVERDUE: "OVERDUE",
  UPCOMING: "UPCOMING",
};
