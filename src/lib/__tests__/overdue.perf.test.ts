import { describe, it, expect } from "vitest";
import {
  recomputeOverdueByBooking,
  findOverdueCacheDrift,
  type LedgerRow,
  type CachedBooking,
} from "@/lib/overdue";

/**
 * Performance guard: many overdue recomputations in a tight loop must
 * stay well under a generous budget AND produce the same drift-free
 * cache invariant the fuzz test in overdue.test.ts proves on a small
 * dataset. If recomputation regresses (e.g. O(N^2) per booking), this
 * test catches it without relying on Vitest's per-test timeout.
 */

const TODAY = "2026-06-29";

function makeLedger(bookings: number, rowsPerBooking: number, seed: number): LedgerRow[] {
  // Deterministic LCG so the dataset is identical across runs.
  let s = seed >>> 0;
  const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff;
  const particularsPool = [
    "Down Payment",
    "Possession",
    "Installment 01",
    "Installment 02",
    "Installment 03",
  ];
  const datePool = ["2024-09-01", "2025-01-01", "2025-06-15", "2026-03-01", "2027-12-01"];
  const rows: LedgerRow[] = [];
  for (let b = 0; b < bookings; b++) {
    const bid = `BK-${b.toString().padStart(5, "0")}`;
    for (let r = 0; r < rowsPerBooking; r++) {
      const due = Math.floor(rand() * 200_000);
      const paid = Math.floor(rand() * due);
      rows.push({
        booking_id: bid,
        particulars: particularsPool[Math.floor(rand() * particularsPool.length)],
        due_date: datePool[Math.floor(rand() * datePool.length)],
        due_amount: due,
        paid_amount: paid,
      });
    }
  }
  return rows;
}

function buildCache(rows: LedgerRow[], bookingIds: string[]): CachedBooking[] {
  const live = recomputeOverdueByBooking(rows, TODAY);
  return bookingIds.map((id) => {
    const s = live.get(id);
    return {
      booking_id: id,
      current_overdue_count: s?.current_overdue_count ?? 0,
      total_overdue_amount: s?.total_overdue_amount ?? 0,
      remaining_balance: s?.remaining_balance ?? 0,
    };
  });
}

describe("overdue recomputation — performance & invariant at scale", () => {
  it("runs 200 recomputations on 500 bookings × 12 rows with zero drift, under budget", () => {
    const BOOKINGS = 500;
    const ROWS_PER = 12;
    const ITERATIONS = 200;
    const BUDGET_MS = 4_000; // generous; typical run is well under 1s

    const rows = makeLedger(BOOKINGS, ROWS_PER, 4242);
    const bookingIds = Array.from(
      { length: BOOKINGS },
      (_, i) => `BK-${i.toString().padStart(5, "0")}`,
    );

    const start = performance.now();
    let totalDrift = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      const cache = buildCache(rows, bookingIds);
      totalDrift += findOverdueCacheDrift(cache, rows, TODAY).length;
    }
    const elapsed = performance.now() - start;

    expect(totalDrift).toBe(0);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it("stays drift-free across 500 randomised mutation steps on a large dataset", () => {
    const BOOKINGS = 300;
    const ROWS_PER = 8;
    const STEPS = 500;
    const BUDGET_MS = 4_000;

    let rows = makeLedger(BOOKINGS, ROWS_PER, 9001);
    const bookingIds = Array.from(
      { length: BOOKINGS },
      (_, i) => `BK-${i.toString().padStart(5, "0")}`,
    );

    let s = 1234567 >>> 0;
    const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff;
    const pickOp = () => (rand() < 0.4 ? "insert" : rand() < 0.7 ? "update" : "delete");
    const pickBooking = () => bookingIds[Math.floor(rand() * bookingIds.length)];

    const start = performance.now();
    for (let step = 0; step < STEPS; step++) {
      const op = pickOp();
      if (op === "insert") {
        rows = [
          ...rows,
          {
            booking_id: pickBooking(),
            particulars: rand() < 0.5 ? "Installment 99" : "Down Payment",
            due_date: rand() < 0.5 ? "2024-12-01" : "2027-06-01",
            due_amount: Math.floor(rand() * 200_000),
            paid_amount: Math.floor(rand() * 200_000),
          },
        ];
      } else if (op === "update" && rows.length > 0) {
        const idx = Math.floor(rand() * rows.length);
        rows = rows.map((r, i) =>
          i === idx ? { ...r, paid_amount: Math.floor(rand() * 200_000) } : r,
        );
      } else if (op === "delete" && rows.length > 0) {
        const idx = Math.floor(rand() * rows.length);
        rows = rows.filter((_, i) => i !== idx);
      }
      const cache = buildCache(rows, bookingIds);
      const drift = findOverdueCacheDrift(cache, rows, TODAY);
      if (drift.length > 0) {
        throw new Error(`Drift after step ${step} (${op}): ${JSON.stringify(drift.slice(0, 3))}`);
      }
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
