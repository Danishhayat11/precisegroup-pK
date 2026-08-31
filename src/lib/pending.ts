// Pure helpers for Pending Balance computation and Cancelled Bookings handling.
// Mirrors Dashboard KPI formula:
//   For Active bookings: pending(booking) = max(sold_unit_value - (sum cash/bank receipts + sum approved adjustments), 0)
//   For Cancelled bookings: pending is 0 (excluded from total pending); cancelled balance = max(sold_unit_value - received, 0).

export type PendingBooking = {
  booking_id: string;
  sold_unit_value?: number | null;
  booking_status?: string | null;
  status?: string | null;
};
export type PendingPayment = { booking_id?: string | null; safe_cash_amount?: number | null };
export type PendingAdjustment = { booking_id?: string | null; approved_value?: number | null };

export type PendingRow = {
  booking_id: string;
  sell: number;
  cash: number;
  adj: number;
  recv: number;
  pending: number;
  isCancelled: boolean;
  cancelledAmount: number;
};

export function computePendingRows(
  bookings: PendingBooking[],
  payments: PendingPayment[],
  adjustments: PendingAdjustment[],
): PendingRow[] {
  const cashByBooking = new Map<string, number>();
  for (const p of payments) {
    const id = p.booking_id;
    if (!id) continue;
    cashByBooking.set(id, (cashByBooking.get(id) || 0) + (Number(p.safe_cash_amount) || 0));
  }
  const adjByBooking = new Map<string, number>();
  for (const a of adjustments) {
    const id = a.booking_id;
    if (!id) continue;
    adjByBooking.set(id, (adjByBooking.get(id) || 0) + (Number(a.approved_value) || 0));
  }
  return bookings.map((b) => {
    const sell = Number(b.sold_unit_value) || 0;
    const cash = cashByBooking.get(b.booking_id) || 0;
    const adj = adjByBooking.get(b.booking_id) || 0;
    const recv = cash + adj;
    const rawStatus = String(b.booking_status ?? b.status ?? "")
      .trim()
      .toLowerCase();
    const isCancelled = rawStatus === "cancelled";
    const uncollected = Math.max(sell - recv, 0);
    // When a booking is cancelled, its remaining unpaid balance is not expected to be collected.
    // It is subtracted from Total Pending (set to 0 for active collection) and tracked in cancelledAmount.
    const pending = isCancelled ? 0 : uncollected;
    const cancelledAmount = isCancelled ? uncollected : 0;
    return {
      booking_id: b.booking_id,
      sell,
      cash,
      adj,
      recv,
      pending,
      isCancelled,
      cancelledAmount,
    };
  });
}

export function totalPending(rows: PendingRow[]): number {
  return rows.reduce((s, r) => s + r.pending, 0);
}

export function totalCancelled(rows: PendingRow[]): number {
  return rows.reduce((s, r) => s + r.cancelledAmount, 0);
}

export type DrillColumn = { label: string; align?: "left" | "right" };
export type PendingDrill = {
  columns: DrillColumn[];
  items: string[][];
  total: number;
  totalLabel: string;
};

import { fmtPKR } from "@/lib/format";

export const PENDING_DRILL_COLUMNS: DrillColumn[] = [
  { label: "Client" },
  { label: "Unit" },
  { label: "Sell (PKR)", align: "right" },
  { label: "Cash/Bank (PKR)", align: "right" },
  { label: "Adj. Allowed (PKR)", align: "right" },
  { label: "Received (PKR)", align: "right" },
  { label: "Pending (PKR)", align: "right" },
];

export function buildPendingDrill(data: {
  bookings: (PendingBooking & { client_name?: string | null; unit_id?: string | null })[];
  payments: PendingPayment[];
  adjustments: PendingAdjustment[];
}): PendingDrill {
  const bookingById = new Map(data.bookings.map((b) => [b.booking_id, b]));
  const rowsOut = computePendingRows(data.bookings, data.payments, data.adjustments)
    .filter((x) => x.pending > 0)
    .sort((a, b) => b.pending - a.pending);
  const items = rowsOut.map((x) => {
    const b: any = bookingById.get(x.booking_id) || {};
    return [
      b.client_name ?? "—",
      b.unit_id ?? "—",
      fmtPKR(x.sell),
      fmtPKR(x.cash),
      fmtPKR(x.adj),
      fmtPKR(x.recv),
      fmtPKR(x.pending),
    ];
  });
  return {
    columns: PENDING_DRILL_COLUMNS,
    items,
    total: rowsOut.reduce((s, x) => s + x.pending, 0),
    totalLabel: "Total Pending",
  };
}

export const CANCELLED_DRILL_COLUMNS: DrillColumn[] = [
  { label: "Client" },
  { label: "Unit" },
  { label: "Original Sell (PKR)", align: "right" },
  { label: "Received Before Cancel (PKR)", align: "right" },
  { label: "Cancelled Balance (PKR)", align: "right" },
  { label: "Status" },
];

export function buildCancelledDrill(data: {
  bookings: (PendingBooking & { client_name?: string | null; unit_id?: string | null })[];
  payments: PendingPayment[];
  adjustments: PendingAdjustment[];
}): PendingDrill {
  const bookingById = new Map(data.bookings.map((b) => [b.booking_id, b]));
  const rowsOut = computePendingRows(data.bookings, data.payments, data.adjustments)
    .filter((x) => x.isCancelled)
    .sort((a, b) => b.cancelledAmount - a.cancelledAmount);
  const items = rowsOut.map((x) => {
    const b: any = bookingById.get(x.booking_id) || {};
    return [
      b.client_name ?? "—",
      b.unit_id ?? "—",
      fmtPKR(x.sell),
      fmtPKR(x.recv),
      fmtPKR(x.cancelledAmount),
      b.booking_status ?? "Cancelled",
    ];
  });
  return {
    columns: CANCELLED_DRILL_COLUMNS,
    items,
    total: rowsOut.reduce((s, x) => s + x.cancelledAmount, 0),
    totalLabel: "Total Cancelled Balance",
  };
}
