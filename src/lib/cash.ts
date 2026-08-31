/**
 * Single source of truth for "Cash Received" math.
 *
 * RULE (enforced in DB via constraint `payments_adjustment_excludes_cash`):
 *   - Cash + Bank Transfer  → count toward Cash Received.
 *   - Adjustment / Asset    → NEVER count toward Cash Received.
 *
 * Use these helpers in Dashboard, Booking details, Ledger, and Reports so the
 * separation can never drift.
 */

export const ADJUSTMENT_MODES = new Set(["Adjustment/Asset", "Adjustment"]);

export type PaymentRow = {
  payment_mode?: string | null;
  amount?: number | string | null;
  safe_cash_amount?: number | string | null;
  cash_bank_include?: boolean | null;
  non_cash_adjustment?: boolean | null;
};

export const isAdjustment = (p: PaymentRow) => ADJUSTMENT_MODES.has(String(p.payment_mode ?? ""));

/** Amount that counts toward Cash Received. 0 for adjustment rows. */
export const cashAmount = (p: PaymentRow): number =>
  isAdjustment(p) ? 0 : Number(p.safe_cash_amount ?? p.amount ?? 0);

/** Amount that counts toward Adjustment totals. 0 for cash/bank rows. */
export const adjustmentAmount = (p: PaymentRow): number =>
  isAdjustment(p) ? Number(p.amount ?? 0) : 0;

export const sumCash = (rows: PaymentRow[]): number => rows.reduce((s, p) => s + cashAmount(p), 0);

export const sumAdjustments = (rows: PaymentRow[]): number =>
  rows.reduce((s, p) => s + adjustmentAmount(p), 0);

export type CashIntegrityIssue = {
  row: PaymentRow;
  reason: string;
};

/**
 * Detects any payment row that violates the Cash vs Adjustment separation.
 * Returns an empty array when the dataset is clean.
 */
export function validateCashIntegrity(rows: PaymentRow[]): CashIntegrityIssue[] {
  const issues: CashIntegrityIssue[] = [];
  for (const p of rows) {
    const adj = isAdjustment(p);
    const safe = Number(p.safe_cash_amount ?? 0);
    const amt = Number(p.amount ?? 0);
    if (adj) {
      if (safe !== 0)
        issues.push({ row: p, reason: "Adjustment row has non-zero safe_cash_amount" });
      if (p.cash_bank_include === true)
        issues.push({ row: p, reason: "Adjustment row flagged as cash_bank_include" });
      if (p.non_cash_adjustment === false)
        issues.push({ row: p, reason: "Adjustment row not flagged non_cash_adjustment" });
    } else {
      if (safe !== amt) issues.push({ row: p, reason: "Cash/Bank row safe_cash_amount ≠ amount" });
      if (p.cash_bank_include === false)
        issues.push({ row: p, reason: "Cash/Bank row excluded from cash_bank_include" });
      if (p.non_cash_adjustment === true)
        issues.push({ row: p, reason: "Cash/Bank row flagged non_cash_adjustment" });
    }
  }
  return issues;
}
