/**
 * Ledger Engine — shared types
 *
 * The ledger engine is a PURE calculation layer. It never touches the
 * database or React; every function takes plain arrays in and returns
 * plain values out. This keeps it trivially testable and re-usable by
 * server functions, reports, PDF renderer, print engine, and UI.
 */

export type LedgerTxnType =
  | "INSTALLMENT_DUE"
  | "PAYMENT_RECEIVED"
  | "PAYMENT_ALLOCATION"
  | "ADJUSTMENT_CREDIT"
  | "ADJUSTMENT_DEBIT"
  | "MAINTENANCE_CHARGE"
  | "MAINTENANCE_PAYMENT"
  | "WAIVER"
  | "REFUND"
  | "REVERSAL"
  | "CORRECTION"
  | "PENALTY"
  | "DISCOUNT"
  | "POSSESSION_CHARGE"
  | "UTILITY_CHARGE"
  | "CUSTOM_CHARGE"
  | "JOURNAL";

export interface LedgerTxn {
  id: string;
  booking_id: string | null;
  txn_date: string; // ISO date (YYYY-MM-DD)
  posted_at: string; // ISO timestamp
  txn_type: LedgerTxnType;
  debit: number;
  credit: number;
  reference_type: string | null;
  reference_id: string | null;
  voucher_no: string | null;
  description: string | null;
  meta?: Record<string, unknown> | null;
}

export type InstallmentStatus =
  | "PAID"
  | "PARTIAL"
  | "OVERDUE"
  | "UPCOMING"
  | "WAIVED"
  | "REFUNDED"
  | "CANCELLED";

export interface InstallmentRow {
  /** Stable id of the installment (ledger_id in the DB). */
  id: string;
  booking_id: string;
  term_no: number | null;
  particulars: string;
  due_date: string | null; // ISO date
  due_amount: number;
  /** Sum of receipts allocated to this installment. */
  paid_amount: number;
  /** Sum of adjustments/waivers applied to this installment. */
  credited_amount?: number;
}

export interface InstallmentProjection extends InstallmentRow {
  status: InstallmentStatus;
  remaining: number;
  days_overdue: number;
  running_balance: number;
}

export interface BookingLedgerSummary {
  total_contract_value: number;
  total_received: number;
  total_credits: number;
  outstanding_balance: number;
  current_due: number;
  future_due: number;
  overdue_amount: number;
  overdue_count: number;
  additional_charges: number;
  possession_balance: number;
  grand_outstanding: number;
}
