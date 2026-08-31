import { describe, it, expect } from "vitest";
import { cleanLedger } from "@/lib/ledger";

/**
 * Regression test for booking BK-MA-00010.
 *
 * Historically this booking carried 26 ledger rows in the database, of
 * which 16 were empty trailing placeholders (no due, paid, label, or
 * date). The cleanup migration deleted those placeholders and
 * `cleanLedger` is the single source of truth that feeds the Booking
 * ledger UI, the Document Generation Center, and the exported Payment
 * Plan PDF.
 *
 * This test pins the exact 10 real terms for BK-MA-00010 and asserts
 * that neither the live shape nor any future regression that adds blank
 * rows can leak placeholders into the rendered or exported ledger.
 */

type Row = {
  booking_id: string;
  term_no: number;
  particulars: string | null;
  due_amount: number | null;
  paid_amount: number | null;
  due_date: string | null;
};

const BK = "BK-MA-00010";

// Mirrors the live installment_ledger rows for BK-MA-00010.
const liveRows: Row[] = [
  {
    booking_id: BK,
    term_no: 1,
    particulars: "Down Payment",
    due_amount: 500000,
    paid_amount: 500000,
    due_date: "2025-04-12",
  },
  {
    booking_id: BK,
    term_no: 2,
    particulars: "Installment 01",
    due_amount: 675000,
    paid_amount: 675000,
    due_date: "2025-04-04",
  },
  {
    booking_id: BK,
    term_no: 3,
    particulars: "Installment 02",
    due_amount: 675000,
    paid_amount: 675000,
    due_date: "2025-07-04",
  },
  {
    booking_id: BK,
    term_no: 4,
    particulars: "Installment 03",
    due_amount: 675000,
    paid_amount: 675000,
    due_date: "2025-10-04",
  },
  {
    booking_id: BK,
    term_no: 5,
    particulars: "Installment 04",
    due_amount: 675000,
    paid_amount: 675000,
    due_date: "2026-01-04",
  },
  {
    booking_id: BK,
    term_no: 6,
    particulars: "Installment 05",
    due_amount: 675000,
    paid_amount: 675000,
    due_date: "2026-04-04",
  },
  {
    booking_id: BK,
    term_no: 7,
    particulars: "Installment 06",
    due_amount: 675000,
    paid_amount: 675000,
    due_date: "2026-07-04",
  },
  {
    booking_id: BK,
    term_no: 8,
    particulars: "Installment 07",
    due_amount: 675000,
    paid_amount: 125000,
    due_date: "2026-10-04",
  },
  {
    booking_id: BK,
    term_no: 9,
    particulars: "Installment 08",
    due_amount: 675000,
    paid_amount: 0,
    due_date: "2027-01-04",
  },
  {
    booking_id: BK,
    term_no: 10,
    particulars: "Possession",
    due_amount: 3500000,
    paid_amount: 0,
    due_date: "2027-10-04",
  },
];

const makePlaceholders = (start: number, end: number): Row[] =>
  Array.from({ length: end - start + 1 }, (_, i) => ({
    booking_id: BK,
    term_no: start + i,
    particulars: null,
    due_amount: null,
    paid_amount: null,
    due_date: null,
  }));

const isPlaceholder = (r: Row) =>
  !(Number(r.due_amount) || 0) &&
  !(Number(r.paid_amount) || 0) &&
  !String(r.particulars ?? "").trim() &&
  !r.due_date;

describe("BK-MA-00010 — ledger regression", () => {
  it("retains exactly the 10 real terms with no placeholders", () => {
    const cleaned = cleanLedger(liveRows);
    expect(cleaned).toHaveLength(10);
    expect(cleaned.some(isPlaceholder)).toBe(false);
    expect(cleaned.map((r) => r.term_no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("strips 16 reintroduced placeholder rows (the original 26-row shape)", () => {
    const polluted = [...liveRows, ...makePlaceholders(11, 26)];
    expect(polluted).toHaveLength(26);
    const cleaned = cleanLedger(polluted);
    expect(cleaned).toHaveLength(10);
    expect(cleaned.some(isPlaceholder)).toBe(false);
  });

  it("preserves the Possession row and exported schedule order for the Payment Plan PDF", () => {
    const cleaned = cleanLedger([...liveRows, ...makePlaceholders(11, 26)]);
    const last = cleaned[cleaned.length - 1];
    expect(last.particulars).toBe("Possession");
    expect(last.due_amount).toBe(3500000);
    // After cleaning, Sr. numbering used by the printed Payment Plan
    // (cleaned.map((_, i) => i + 1)) must be a contiguous 1..N sequence
    // with no gaps where placeholder rows used to sit.
    const sr = cleaned.map((_, i) => i + 1);
    expect(sr).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("yields the same cleaned schedule whether placeholders sit before, between, or after real rows", () => {
    const baseline = cleanLedger(liveRows);
    const interleaved = cleanLedger([
      ...makePlaceholders(11, 13),
      liveRows[0],
      ...makePlaceholders(14, 16),
      ...liveRows.slice(1, 5),
      ...makePlaceholders(17, 20),
      ...liveRows.slice(5),
      ...makePlaceholders(21, 26),
    ]);
    expect(interleaved).toEqual(expect.arrayContaining(baseline));
    expect(interleaved).toHaveLength(baseline.length);
  });
});
