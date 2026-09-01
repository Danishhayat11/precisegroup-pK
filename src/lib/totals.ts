// Pure aggregation helpers used by the Dashboard KPIs. Kept here so the
// Total Received identity (Cash − Adjustment Approved − Commission) can be
// verified by automated tests independent of the React component.
//
// Business rule: Total Received = Cash/Bank + Adjustment Approved - Commission Paid.
// Adj. Realised remains as a separate KPI for reporting only.

export type BookingLike = { dealer_commission_amount?: number | string | null };
export type PaymentLike = { safe_cash_amount?: number | string | null };
export type AdjustmentLike = {
  approved_value?: number | string | null;
  realized_value?: number | string | null;
};

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

export function sumCashRecovered(payments: PaymentLike[]): number {
  return payments.reduce((s, p) => s + n(p.safe_cash_amount), 0);
}

export function sumAdjRealised(adjustments: AdjustmentLike[]): number {
  return adjustments.reduce((s, a) => s + n(a.realized_value), 0);
}

export function sumAdjApproved(adjustments: AdjustmentLike[]): number {
  return adjustments.reduce((s, a) => s + n(a.approved_value), 0);
}

export function sumCommissionPaid(bookings: BookingLike[]): number {
  return bookings.reduce((s, b) => s + n(b.dealer_commission_amount), 0);
}

/**
 * Total Received (Net Company View) = Cash/Bank + Adjustment Approved − Commission Paid.
 */
export function computeTotalReceived(input: {
  bookings: BookingLike[];
  payments: PaymentLike[];
  adjustments: AdjustmentLike[];
}): {
  cashRecovered: number;
  adjRealised: number;
  adjApproved: number;
  commissionPaid: number;
  totalReceived: number;
} {
  const cashRecovered = sumCashRecovered(input.payments);
  const adjRealised = sumAdjRealised(input.adjustments);
  const adjApproved = sumAdjApproved(input.adjustments);
  const commissionPaid = sumCommissionPaid(input.bookings);

  // Business Rule: Total Received = Cash/Bank + Adjustment Approved − Commission Paid.
  // We use strict 2-decimal rounding to prevent floating-point drift.
  const val = cashRecovered + adjApproved - commissionPaid;
  const totalReceived = Math.round((val + Number.EPSILON) * 100) / 100;

  return {
    cashRecovered,
    adjRealised,
    adjApproved,
    commissionPaid,
    totalReceived,
  };
}
