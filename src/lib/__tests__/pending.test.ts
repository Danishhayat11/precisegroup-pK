import { describe, it, expect } from "vitest";
import { computePendingRows, totalPending } from "../pending";

describe("computePendingRows — edge scenarios", () => {
  it("single booking with no payments or adjustments → pending = sell", () => {
    const rows = computePendingRows([{ booking_id: "B1", sold_unit_value: 1_000_000 }], [], []);
    expect(rows).toEqual([
      {
        booking_id: "B1",
        sell: 1_000_000,
        cash: 0,
        adj: 0,
        recv: 0,
        pending: 1_000_000,
        isCancelled: false,
        cancelledAmount: 0,
      },
    ]);
    expect(totalPending(rows)).toBe(1_000_000);
  });

  it("sums multiple receipts against the same booking", () => {
    const rows = computePendingRows(
      [{ booking_id: "B1", sold_unit_value: 10_000_000 }],
      [
        { booking_id: "B1", safe_cash_amount: 2_000_000 },
        { booking_id: "B1", safe_cash_amount: 1_500_000 },
        { booking_id: "B1", safe_cash_amount: 500_000 },
      ],
      [],
    );
    expect(rows[0].cash).toBe(4_000_000);
    expect(rows[0].pending).toBe(6_000_000);
  });

  it("sums multiple approved adjustments against the same booking", () => {
    const rows = computePendingRows(
      [{ booking_id: "B1", sold_unit_value: 10_000_000 }],
      [],
      [
        { booking_id: "B1", approved_value: 1_000_000 },
        { booking_id: "B1", approved_value: 2_500_000 },
      ],
    );
    expect(rows[0].adj).toBe(3_500_000);
    expect(rows[0].pending).toBe(6_500_000);
  });

  it("zeroes out when receipts fully cover the sell value", () => {
    const rows = computePendingRows(
      [{ booking_id: "B1", sold_unit_value: 5_000_000 }],
      [
        { booking_id: "B1", safe_cash_amount: 3_000_000 },
        { booking_id: "B1", safe_cash_amount: 2_000_000 },
      ],
      [],
    );
    expect(rows[0].pending).toBe(0);
    expect(totalPending(rows)).toBe(0);
  });

  it("zeroes out when approved adjustments fully cover the sell value", () => {
    const rows = computePendingRows(
      [{ booking_id: "B1", sold_unit_value: 5_000_000 }],
      [],
      [
        { booking_id: "B1", approved_value: 2_000_000 },
        { booking_id: "B1", approved_value: 3_000_000 },
      ],
    );
    expect(rows[0].pending).toBe(0);
  });

  it("zeroes out when cash + adjustments together fully cover sell", () => {
    const rows = computePendingRows(
      [{ booking_id: "B1", sold_unit_value: 10_000_000 }],
      [{ booking_id: "B1", safe_cash_amount: 4_000_000 }],
      [{ booking_id: "B1", approved_value: 6_000_000 }],
    );
    expect(rows[0].recv).toBe(10_000_000);
    expect(rows[0].pending).toBe(0);
  });

  it("never returns negative pending when receipts exceed sell value (overpayment)", () => {
    const rows = computePendingRows(
      [{ booking_id: "B1", sold_unit_value: 1_000_000 }],
      [{ booking_id: "B1", safe_cash_amount: 1_500_000 }],
      [{ booking_id: "B1", approved_value: 200_000 }],
    );
    expect(rows[0].pending).toBe(0);
  });

  it("attributes receipts only to their own booking", () => {
    const rows = computePendingRows(
      [
        { booking_id: "B1", sold_unit_value: 5_000_000 },
        { booking_id: "B2", sold_unit_value: 5_000_000 },
      ],
      [
        { booking_id: "B1", safe_cash_amount: 5_000_000 },
        { booking_id: "B2", safe_cash_amount: 1_000_000 },
      ],
      [],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.booking_id, r]));
    expect(byId.B1.pending).toBe(0);
    expect(byId.B2.pending).toBe(4_000_000);
    expect(totalPending(rows)).toBe(4_000_000);
  });

  it("ignores payments/adjustments with missing booking_id", () => {
    const rows = computePendingRows(
      [{ booking_id: "B1", sold_unit_value: 1_000_000 }],
      [
        { booking_id: null, safe_cash_amount: 500_000 },
        { booking_id: undefined, safe_cash_amount: 200_000 },
      ],
      [{ booking_id: null, approved_value: 300_000 }],
    );
    expect(rows[0].cash).toBe(0);
    expect(rows[0].adj).toBe(0);
    expect(rows[0].pending).toBe(1_000_000);
  });

  it("coerces null/undefined/string numeric fields safely", () => {
    const rows = computePendingRows(
      [
        { booking_id: "B1", sold_unit_value: null },
        { booking_id: "B2", sold_unit_value: undefined },
        { booking_id: "B3", sold_unit_value: 1_000_000 },
      ],
      [
        { booking_id: "B3", safe_cash_amount: null as any },
        { booking_id: "B3", safe_cash_amount: "400000" as any },
      ],
      [{ booking_id: "B3", approved_value: "100000" as any }],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.booking_id, r]));
    expect(byId.B1.pending).toBe(0);
    expect(byId.B2.pending).toBe(0);
    expect(byId.B3.cash).toBe(400_000);
    expect(byId.B3.adj).toBe(100_000);
    expect(byId.B3.pending).toBe(500_000);
  });

  it("full coverage across many bookings zeroes the grand total", () => {
    const bookings = Array.from({ length: 25 }, (_, i) => ({
      booking_id: `B${i}`,
      sold_unit_value: (i + 1) * 100_000,
    }));
    const payments = bookings.flatMap((b) => [
      { booking_id: b.booking_id, safe_cash_amount: (b.sold_unit_value as number) / 2 },
      { booking_id: b.booking_id, safe_cash_amount: (b.sold_unit_value as number) / 4 },
    ]);
    const adjustments = bookings.map((b) => ({
      booking_id: b.booking_id,
      approved_value: (b.sold_unit_value as number) / 4,
    }));
    const rows = computePendingRows(bookings, payments, adjustments);
    expect(rows.every((r) => r.pending === 0)).toBe(true);
    expect(totalPending(rows)).toBe(0);
  });

  it("a booking with no receipts coexists with fully-paid bookings", () => {
    const rows = computePendingRows(
      [
        { booking_id: "PAID", sold_unit_value: 2_000_000 },
        { booking_id: "OPEN", sold_unit_value: 3_000_000 },
      ],
      [{ booking_id: "PAID", safe_cash_amount: 2_000_000 }],
      [],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.booking_id, r]));
    expect(byId.PAID.pending).toBe(0);
    expect(byId.OPEN.pending).toBe(3_000_000);
    expect(totalPending(rows)).toBe(3_000_000);
  });

  it("subtracts remaining balance of cancelled bookings from pending (user scenario: 100 total, 20 paid, cancelled -> 80 removed from pending, total pending 420)", () => {
    const rows = computePendingRows(
      [
        { booking_id: "B_CANCELLED", sold_unit_value: 100, booking_status: "Cancelled" },
        { booking_id: "B_ACTIVE", sold_unit_value: 420, booking_status: "Active" },
      ],
      [{ booking_id: "B_CANCELLED", safe_cash_amount: 20 }],
      [],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.booking_id, r]));
    expect(byId.B_CANCELLED.sell).toBe(100);
    expect(byId.B_CANCELLED.cash).toBe(20);
    expect(byId.B_CANCELLED.recv).toBe(20);
    expect(byId.B_CANCELLED.pending).toBe(0); // 80 is NOT pending because it is cancelled
    expect(byId.B_CANCELLED.cancelledAmount).toBe(80);
    expect(byId.B_CANCELLED.isCancelled).toBe(true);

    expect(byId.B_ACTIVE.pending).toBe(420);
    expect(totalPending(rows)).toBe(420);
  });
});
