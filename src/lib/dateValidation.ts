// src/lib/dateValidation.ts
// Robust date parsing + anomaly detection for Excel uploads.
// All parsers return a canonical ISO date (YYYY-MM-DD) or null.

export type DateIssue =
  | "unparseable"
  | "out_of_range"
  | "future_beyond_horizon"
  | "before_epoch"
  | "cross_field_inconsistent";

export interface ParsedDate {
  iso: string | null;
  raw: unknown;
  issue?: DateIssue;
  detail?: string;
}

const EPOCH_MIN = new Date("2000-01-01").getTime();
// horizon = today + 30 years — anything past that is almost certainly bad data
const HORIZON_MS = 30 * 365.25 * 24 * 3600 * 1000;

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
function toIso(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

/** Parse Excel serial date (days since 1899-12-30, matches SheetJS `w`). */
export function parseExcelSerial(n: number): Date | null {
  if (!Number.isFinite(n) || n < 1 || n > 200000) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000); // 25569 = 1970-01-01 offset
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d;
}

/** Parse arbitrary date string forms commonly seen in ERP workbooks. */
export function parseDateString(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  // ISO YYYY-MM-DD / YYYY/MM/DD
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return safeDate(+m[1], +m[2] - 1, +m[3]);

  // DD-MMM-YYYY / DD MMM YYYY / DD/MMM/YYYY
  m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,4})[-\s/](\d{2,4})$/);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo == null) return null;
    return safeDate(normalizeYear(+m[3]), mo, +m[1]);
  }

  // DD-MM-YYYY / DD/MM/YYYY  (assume day-first — PK/UK convention used in these workbooks)
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const d = +m[1],
      mo = +m[2];
    if (d > 31 || mo > 12) return null;
    return safeDate(normalizeYear(+m[3]), mo - 1, d);
  }

  // fallback to native
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}

function normalizeYear(y: number): number {
  if (y < 100) return y >= 50 ? 1900 + y : 2000 + y;
  return y;
}

function safeDate(y: number, m: number, d: number): Date | null {
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return null;
  return dt;
}

/** Main entry — parse any cell value and classify. */
export function validateDate(raw: unknown): ParsedDate {
  if (raw == null || raw === "") return { iso: null, raw };

  let d: Date | null = null;
  if (raw instanceof Date) d = isNaN(raw.getTime()) ? null : raw;
  else if (typeof raw === "number") d = parseExcelSerial(raw);
  else if (typeof raw === "string") d = parseDateString(raw);

  if (!d)
    return { iso: null, raw, issue: "unparseable", detail: `Could not parse "${String(raw)}"` };

  const ms = d.getTime();
  if (ms < EPOCH_MIN)
    return { iso: null, raw, issue: "before_epoch", detail: d.toISOString().slice(0, 10) };
  if (ms > Date.now() + HORIZON_MS)
    return { iso: null, raw, issue: "future_beyond_horizon", detail: d.toISOString().slice(0, 10) };

  return { iso: toIso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), raw };
}

/** Cross-field rules for a booking-like row. */
export interface CrossFieldContext {
  booking_date?: unknown;
  first_installment_due?: unknown;
  possession_due_date?: unknown;
  payment_date?: unknown;
  due_date?: unknown;
  paid_date?: unknown;
}

export function crossFieldIssues(row: CrossFieldContext): string[] {
  const issues: string[] = [];
  const bk = validateDate(row.booking_date).iso;
  const fi = validateDate(row.first_installment_due).iso;
  const pd = validateDate(row.possession_due_date).iso;
  const pay = validateDate(row.payment_date).iso;
  const due = validateDate(row.due_date).iso;
  const paid = validateDate(row.paid_date).iso;

  if (bk && fi && fi < bk) issues.push("first_installment_due < booking_date");
  if (bk && pd && pd < bk) issues.push("possession_due_date < booking_date");
  if (bk && pay && pay < bk) issues.push("payment_date < booking_date");
  if (due && paid && paid < due) issues.push("paid_date < due_date");
  return issues;
}
