import { fmtDate, fmtPKR } from "@/lib/format";

// ---- Status derivation ---------------------------------------------------
// Buckets a ledger row into one of the five business statuses using
// (paid_amount, due_amount, due_date, today). Order matters: PAID wins
// before PARTIAL, OVERDUE wins before DUE SOON so a past-due row that's
// also within 7 days doesn't get downgraded.
export type LedgerStatus = "PAID" | "OVERDUE" | "PARTIAL" | "DUE SOON" | "UPCOMING";

export function deriveStatus(
  due: number,
  paid: number,
  dueDate: string | null,
  today: Date,
): LedgerStatus {
  if (due > 0 && paid >= due) return "PAID";
  const d = dueDate ? new Date(dueDate) : null;
  // Snapshot today's midnight ms without mutating the caller's Date.
  const todayMs = new Date(today).setHours(0, 0, 0, 0);
  const dueMs = d ? new Date(d).setHours(0, 0, 0, 0) : null;
  const past = dueMs !== null ? dueMs < todayMs : false;
  if (past && paid < due) return "OVERDUE";
  if (paid > 0 && paid < due) return "PARTIAL";
  if (dueMs !== null && dueMs - todayMs <= 7 * 86400000 && dueMs >= todayMs) return "DUE SOON";
  return "UPCOMING";
}

// ---- WhatsApp reminder ---------------------------------------------------
// Normalises a Pakistani mobile like "0301-1234567" / "+92 301 1234567"
// into wa.me-safe digits (no plus, no separators). Returns null when the
// number is missing or obviously invalid so the button stays disabled
// rather than opening a broken chat.
export function normalisePkPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.startsWith("92") && digits.length >= 11) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `92${digits.slice(1)}`;
  if (digits.length === 10) return `92${digits}`;
  return digits;
}

export function buildReminderMessage(args: {
  clientName?: string | null;
  bookingId: string;
  unitId?: string | null;
  particulars?: string | null;
  dueDate?: string | null;
  amount: number;
  daysOverdue: number;
}): string {
  const name = (args.clientName ?? "").replace(/\s+/g, " ").trim() || "Sir/Madam";
  const unit = (args.unitId ?? "").toString().trim();
  const bookingLabel = unit ? `${args.bookingId} (Unit ${unit})` : args.bookingId;
  const line1 = `Assalam-o-Alaikum ${name},`;
  const line2 = `This is a friendly reminder from Precise Realtors & Builders regarding your booking ${bookingLabel}.`;
  const line3 = `Installment: ${args.particulars ?? "Installment"} due ${fmtDate(args.dueDate)}.`;
  const line4 = `Amount outstanding: ${fmtPKR(args.amount)} (${args.daysOverdue} day${args.daysOverdue === 1 ? "" : "s"} overdue).`;
  const line5 = `Kindly clear at your earliest convenience. Reply here if you need account details or a receipt.`;
  return [line1, "", line2, line3, line4, "", line5].join("\n");
}
