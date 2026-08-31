import { describe, it, expect } from "vitest";
import { cleanLedger } from "@/lib/ledger";

/**
 * Asserts the shared ledger cleaner removes every empty placeholder row
 * across multiple bookings before they reach the UI, the Booking ledger
 * print preview, or the exported Payment Plan PDF.
 *
 * `cleanLedger` is the single source of truth used by BookingDetail.tsx,
 * Documents.tsx and DocumentView.tsx, so guarding it here covers all
 * three render paths.
 */

type Row = {
  booking_id: string;
  term_no: number;
  particulars: string | null;
  due_amount: number | null;
  paid_amount: number | null;
  due_date: string | null;
};

const realRows: Row[] = [
  {
    booking_id: "BK-MA-00010",
    term_no: 1,
    particulars: "Down Payment",
    due_amount: 500000,
    paid_amount: 500000,
    due_date: "2025-04-12",
  },
  {
    booking_id: "BK-MA-00010",
    term_no: 2,
    particulars: "Installment 01",
    due_amount: 675000,
    paid_amount: 675000,
    due_date: "2025-04-04",
  },
  {
    booking_id: "BK-MA-00010",
    term_no: 10,
    particulars: "Possession",
    due_amount: 3500000,
    paid_amount: 0,
    due_date: "2027-10-04",
  },
  {
    booking_id: "BK-MA-00011",
    term_no: 1,
    particulars: "Down Payment",
    due_amount: 800000,
    paid_amount: 800000,
    due_date: "2025-06-01",
  },
  {
    booking_id: "BK-MA-00012",
    term_no: 1,
    particulars: "Down Payment",
    due_amount: 1200000,
    paid_amount: 0,
    due_date: "2026-01-15",
  },
];

const emptyRows: Row[] = [11, 12, 13, 14, 15].map((n) => ({
  booking_id: "BK-MA-00010",
  term_no: n,
  particulars: null,
  due_amount: null,
  paid_amount: null,
  due_date: null,
}));

const isEmpty = (r: Row) =>
  !(Number(r.due_amount) || 0) &&
  !(Number(r.paid_amount) || 0) &&
  !String(r.particulars ?? "").trim() &&
  !r.due_date;

describe("cleanLedger — installment ledger placeholders", () => {
  it("removes every empty placeholder row from a mixed ledger", () => {
    const cleaned = cleanLedger([...realRows, ...emptyRows]);
    expect(cleaned).toHaveLength(realRows.length);
    expect(cleaned.some(isEmpty)).toBe(false);
  });

  it("keeps only real terms across multiple bookings", () => {
    const cleaned = cleanLedger([...realRows, ...emptyRows]);
    const perBooking = cleaned.reduce<Record<string, number>>((acc, r) => {
      acc[r.booking_id] = (acc[r.booking_id] ?? 0) + 1;
      return acc;
    }, {});
    expect(perBooking).toEqual({ "BK-MA-00010": 3, "BK-MA-00011": 1, "BK-MA-00012": 1 });
  });

  it("handles null/undefined input safely", () => {
    expect(cleanLedger(null)).toEqual([]);
    expect(cleanLedger(undefined)).toEqual([]);
    expect(cleanLedger([])).toEqual([]);
  });

  it("preserves rows that have any of due/paid/label/date", () => {
    const partials: Row[] = [
      {
        booking_id: "B",
        term_no: 1,
        particulars: "Label only",
        due_amount: null,
        paid_amount: null,
        due_date: null,
      },
      {
        booking_id: "B",
        term_no: 2,
        particulars: null,
        due_amount: 100,
        paid_amount: null,
        due_date: null,
      },
      {
        booking_id: "B",
        term_no: 3,
        particulars: null,
        due_amount: null,
        paid_amount: 100,
        due_date: null,
      },
      {
        booking_id: "B",
        term_no: 4,
        particulars: null,
        due_amount: null,
        paid_amount: null,
        due_date: "2026-01-01",
      },
    ];
    expect(cleanLedger(partials)).toHaveLength(4);
  });
});
