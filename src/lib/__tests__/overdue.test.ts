import { describe, it, expect } from "vitest";
import {
  recomputeOverdueForBooking,
  recomputeOverdueByBooking,
  findOverdueCacheDrift,
  isOverdueRow,
  isInstallmentRow,
  type LedgerRow,
  type CachedBooking,
} from "@/lib/overdue";

/**
 * These tests guard the invariant that the cached overdue values on
 * `bookings` (current_overdue_count, total_overdue_amount, remaining_balance)
 * always match a fresh recomputation from `installment_ledger` rows after
 * arbitrary inserts, updates and deletes.
 *
 * The pure recompute function here mirrors the SQL function
 * `public.recompute_booking_overdue()`. Both the dashboard KPI section
 * (live ledger scan) and the database trigger derive their numbers from
 * the same rules, so by exercising this function we cover both code paths.
 */

const TODAY = "2026-06-29";

function row(partial: Partial<LedgerRow> & { booking_id: string }): LedgerRow {
  return {
    particulars: "Installment 01",
    due_date: "2026-01-01",
    due_amount: 100_000,
    paid_amount: 0,
    ...partial,
  };
}

function applyCache(rows: LedgerRow[], bookingIds: string[]): CachedBooking[] {
  // Simulates the trigger writing the cache after every mutation.
  const live = recomputeOverdueByBooking(rows, TODAY);
  return bookingIds.map((id) => {
    const stats = live.get(id);
    return {
      booking_id: id,
      current_overdue_count: stats?.current_overdue_count ?? 0,
      total_overdue_amount: stats?.total_overdue_amount ?? 0,
      remaining_balance: stats?.remaining_balance ?? 0,
    };
  });
}

describe("overdue recomputation — row predicates", () => {
  it("ignores down payments and possession rows for overdue counting", () => {
    expect(isInstallmentRow(row({ booking_id: "B", particulars: "Down Payment" }))).toBe(false);
    expect(isInstallmentRow(row({ booking_id: "B", particulars: "POSSESSION amount" }))).toBe(
      false,
    );
    expect(isInstallmentRow(row({ booking_id: "B", particulars: "Installment 03" }))).toBe(true);
    expect(isInstallmentRow(row({ booking_id: "B", particulars: null }))).toBe(true);
  });

  it("treats a row as overdue only when due_date < today AND remaining > 0", () => {
    expect(
      isOverdueRow(
        row({ booking_id: "B", due_date: "2026-01-01", due_amount: 100, paid_amount: 0 }),
        TODAY,
      ),
    ).toBe(true);
    expect(
      isOverdueRow(
        row({ booking_id: "B", due_date: TODAY, due_amount: 100, paid_amount: 0 }),
        TODAY,
      ),
    ).toBe(false);
    expect(
      isOverdueRow(
        row({ booking_id: "B", due_date: "2026-12-31", due_amount: 100, paid_amount: 0 }),
        TODAY,
      ),
    ).toBe(false);
    expect(
      isOverdueRow(
        row({ booking_id: "B", due_date: "2026-01-01", due_amount: 100, paid_amount: 100 }),
        TODAY,
      ),
    ).toBe(false);
    expect(
      isOverdueRow(
        row({ booking_id: "B", due_date: null, due_amount: 100, paid_amount: 0 }),
        TODAY,
      ),
    ).toBe(false);
  });
});

describe("overdue recomputation — per-booking math", () => {
  it("sums remaining for overdue installments only and caps at total_remaining", () => {
    const rows: LedgerRow[] = [
      row({
        booking_id: "BK-1",
        particulars: "Down Payment",
        due_date: "2025-01-01",
        due_amount: 500_000,
        paid_amount: 500_000,
      }),
      row({
        booking_id: "BK-1",
        particulars: "Installment 01",
        due_date: "2025-02-01",
        due_amount: 100_000,
        paid_amount: 25_000,
      }), // overdue 75k
      row({
        booking_id: "BK-1",
        particulars: "Installment 02",
        due_date: "2025-03-01",
        due_amount: 100_000,
        paid_amount: 0,
      }), // overdue 100k
      row({
        booking_id: "BK-1",
        particulars: "Installment 03",
        due_date: "2027-01-01",
        due_amount: 100_000,
        paid_amount: 0,
      }), // future
      row({
        booking_id: "BK-1",
        particulars: "Possession",
        due_date: "2025-04-01",
        due_amount: 1_000_000,
        paid_amount: 0,
      }), // possession ignored for count/amount
    ];
    const stats = recomputeOverdueForBooking(rows, TODAY);
    expect(stats.current_overdue_count).toBe(2);
    expect(stats.total_overdue_amount).toBe(175_000);
    expect(stats.remaining_balance).toBe(75_000 + 100_000 + 100_000 + 1_000_000);
  });

  it("caps total_overdue_amount at remaining_balance when paid > due elsewhere", () => {
    const rows: LedgerRow[] = [
      row({
        booking_id: "BK-2",
        particulars: "Installment 01",
        due_date: "2025-01-01",
        due_amount: 100_000,
        paid_amount: 0,
      }),
      // Overpayment on another row reduces total_remaining but the SQL clamps amount.
      row({
        booking_id: "BK-2",
        particulars: "Installment 02",
        due_date: "2027-01-01",
        due_amount: 50_000,
        paid_amount: 50_000,
      }),
    ];
    const stats = recomputeOverdueForBooking(rows, TODAY);
    expect(stats.current_overdue_count).toBe(1);
    expect(stats.remaining_balance).toBe(100_000);
    expect(stats.total_overdue_amount).toBe(100_000);
  });
});

describe("cache vs live invariant — mutations", () => {
  const seed: LedgerRow[] = [
    row({
      booking_id: "BK-A",
      particulars: "Down Payment",
      due_date: "2025-01-01",
      due_amount: 200_000,
      paid_amount: 200_000,
    }),
    row({
      booking_id: "BK-A",
      particulars: "Installment 01",
      due_date: "2025-02-01",
      due_amount: 100_000,
      paid_amount: 0,
    }),
    row({
      booking_id: "BK-A",
      particulars: "Installment 02",
      due_date: "2025-03-01",
      due_amount: 100_000,
      paid_amount: 0,
    }),
    row({
      booking_id: "BK-B",
      particulars: "Installment 01",
      due_date: "2025-02-01",
      due_amount: 50_000,
      paid_amount: 50_000,
    }),
    row({
      booking_id: "BK-C",
      particulars: "Installment 01",
      due_date: "2027-01-01",
      due_amount: 75_000,
      paid_amount: 0,
    }),
  ];
  const bookingIds = ["BK-A", "BK-B", "BK-C", "BK-D"]; // BK-D has no ledger rows

  it("seed cache matches live recomputation", () => {
    const cache = applyCache(seed, bookingIds);
    expect(findOverdueCacheDrift(cache, seed, TODAY)).toEqual([]);
  });

  it("INSERT — adding a new overdue installment keeps cache in sync after retrigger", () => {
    const next = [
      ...seed,
      row({
        booking_id: "BK-B",
        particulars: "Installment 02",
        due_date: "2025-05-01",
        due_amount: 60_000,
        paid_amount: 0,
      }),
    ];
    const cache = applyCache(next, bookingIds);
    expect(findOverdueCacheDrift(cache, next, TODAY)).toEqual([]);
    const bkb = cache.find((b) => b.booking_id === "BK-B")!;
    expect(bkb.current_overdue_count).toBe(1);
    expect(bkb.total_overdue_amount).toBe(60_000);
  });

  it("INSERT without retrigger — drift is reported for the affected booking", () => {
    const staleCache = applyCache(seed, bookingIds);
    const next = [
      ...seed,
      row({
        booking_id: "BK-C",
        particulars: "Installment 00",
        due_date: "2025-01-01",
        due_amount: 90_000,
        paid_amount: 0,
      }),
    ];
    const drift = findOverdueCacheDrift(staleCache, next, TODAY);
    const bkc = drift.filter((d) => d.booking_id === "BK-C");
    expect(bkc.map((d) => d.field).sort()).toEqual([
      "current_overdue_count",
      "remaining_balance",
      "total_overdue_amount",
    ]);
  });

  it("UPDATE — paying off an overdue installment drops the count and amount", () => {
    const next = seed.map((r) =>
      r.booking_id === "BK-A" && r.particulars === "Installment 01"
        ? { ...r, paid_amount: 100_000 }
        : r,
    );
    const cache = applyCache(next, bookingIds);
    expect(findOverdueCacheDrift(cache, next, TODAY)).toEqual([]);
    const bka = cache.find((b) => b.booking_id === "BK-A")!;
    expect(bka.current_overdue_count).toBe(1);
    expect(bka.total_overdue_amount).toBe(100_000);
    expect(bka.remaining_balance).toBe(100_000);
  });

  it("UPDATE — partial payment reduces remaining without dropping count", () => {
    const next = seed.map((r) =>
      r.booking_id === "BK-A" && r.particulars === "Installment 01"
        ? { ...r, paid_amount: 40_000 }
        : r,
    );
    const cache = applyCache(next, bookingIds);
    expect(findOverdueCacheDrift(cache, next, TODAY)).toEqual([]);
    const bka = cache.find((b) => b.booking_id === "BK-A")!;
    expect(bka.current_overdue_count).toBe(2);
    expect(bka.total_overdue_amount).toBe(60_000 + 100_000);
  });

  it("UPDATE — pushing due_date into the future removes it from overdue", () => {
    const next = seed.map((r) =>
      r.booking_id === "BK-A" && r.particulars === "Installment 02"
        ? { ...r, due_date: "2027-09-01" }
        : r,
    );
    const cache = applyCache(next, bookingIds);
    expect(findOverdueCacheDrift(cache, next, TODAY)).toEqual([]);
    const bka = cache.find((b) => b.booking_id === "BK-A")!;
    expect(bka.current_overdue_count).toBe(1);
    expect(bka.total_overdue_amount).toBe(100_000);
  });

  it("DELETE — removing an overdue row updates the cache", () => {
    const next = seed.filter(
      (r) => !(r.booking_id === "BK-A" && r.particulars === "Installment 02"),
    );
    const cache = applyCache(next, bookingIds);
    expect(findOverdueCacheDrift(cache, next, TODAY)).toEqual([]);
    const bka = cache.find((b) => b.booking_id === "BK-A")!;
    expect(bka.current_overdue_count).toBe(1);
    expect(bka.total_overdue_amount).toBe(100_000);
  });

  it("DELETE — removing every ledger row for a booking zeros the overdue cache", () => {
    const next = seed.filter((r) => r.booking_id !== "BK-A");
    const cache = applyCache(next, bookingIds);
    // BK-D still has no rows; BK-A now has none either — both should be zeroed.
    const drift = findOverdueCacheDrift(cache, next, TODAY);
    expect(drift).toEqual([]);
    const bka = cache.find((b) => b.booking_id === "BK-A")!;
    expect(bka.current_overdue_count).toBe(0);
    expect(bka.total_overdue_amount).toBe(0);
  });

  it("randomised mutations — cache always matches live after each step", () => {
    let rows: LedgerRow[] = [...seed];
    let cache = applyCache(rows, bookingIds);
    const rng = (() => {
      let s = 1337;
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0xffffffff;
      };
    })();
    const pick = <T>(arr: T[]) => arr[Math.floor(rng() * arr.length)];

    for (let step = 0; step < 50; step++) {
      const op = pick(["insert", "update", "delete"] as const);
      if (op === "insert") {
        const bid = pick(["BK-A", "BK-B", "BK-C", "BK-D"]);
        rows = [
          ...rows,
          row({
            booking_id: bid,
            particulars: pick(["Installment 99", "Down Payment", "Possession"]),
            due_date: pick(["2024-12-01", "2025-06-01", "2027-12-01"]),
            due_amount: Math.floor(rng() * 200_000),
            paid_amount: Math.floor(rng() * 200_000),
          }),
        ];
      } else if (op === "update" && rows.length > 0) {
        const idx = Math.floor(rng() * rows.length);
        rows = rows.map((r, i) =>
          i === idx ? { ...r, paid_amount: Math.floor(rng() * 200_000) } : r,
        );
      } else if (op === "delete" && rows.length > 0) {
        const idx = Math.floor(rng() * rows.length);
        rows = rows.filter((_, i) => i !== idx);
      }
      cache = applyCache(rows, bookingIds);
      const drift = findOverdueCacheDrift(cache, rows, TODAY);
      if (drift.length > 0) {
        throw new Error(`Drift after step ${step} (${op}): ${JSON.stringify(drift)}`);
      }
    }
  });
});

describe("findOverdueCacheDrift — reports stale fields precisely", () => {
  it("flags only the fields that disagree", () => {
    const rows: LedgerRow[] = [
      row({
        booking_id: "BK-X",
        particulars: "Installment 01",
        due_date: "2025-01-01",
        due_amount: 100_000,
        paid_amount: 0,
      }),
    ];
    const stale: CachedBooking[] = [
      {
        booking_id: "BK-X",
        current_overdue_count: 0,
        total_overdue_amount: 100_000,
        remaining_balance: 100_000,
      },
    ];
    const drift = findOverdueCacheDrift(stale, rows, TODAY);
    expect(drift).toEqual([
      { booking_id: "BK-X", field: "current_overdue_count", cached: 0, live: 1 },
    ]);
  });
});
