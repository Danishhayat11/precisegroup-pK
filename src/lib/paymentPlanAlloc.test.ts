import { describe, it, expect } from "vitest";
import {
  allocatePaymentPlan,
  overdueEntries,
  overdueSummary,
  type ScheduleRow,
} from "@/lib/paymentPlanAlloc";

const NOW = new Date("2026-07-13T00:00:00Z");
const past = (d: string) => d; // for readability
const future = (d: string) => d;

const row = (over: Partial<ScheduleRow>): ScheduleRow => ({
  due_amount: 0,
  paid_amount: 0,
  particulars: "",
  ...over,
});

describe("allocatePaymentPlan — future-dated partial invariant", () => {
  it("marks a future-dated partial as Partial + future=true (never Overdue)", () => {
    const schedule: ScheduleRow[] = [
      row({ particulars: "Down Payment", due_date: past("2024-01-01"), due_amount: 100 }),
      row({ particulars: "Installment 01", due_date: past("2024-06-01"), due_amount: 100 }),
      // Future-dated installment gets a partial from the FIFO cascade.
      row({ particulars: "Installment 02", due_date: future("2027-01-01"), due_amount: 100 }),
      row({ particulars: "Installment 03", due_date: future("2027-06-01"), due_amount: 100 }),
    ];
    // 100 + 100 + 50 = 250 received. Row 3 gets partial (50/100), future.
    const alloc = allocatePaymentPlan(schedule, 250, NOW);
    expect(alloc[0].status).toBe("Paid");
    expect(alloc[1].status).toBe("Paid");
    expect(alloc[2].status).toBe("Partial");
    expect(alloc[2].future).toBe(true);
    expect(alloc[3].status).toBe("Upcoming");
    // Invariant: no future row is Overdue.
    for (const a of alloc) expect(a.future && a.status === "Overdue").toBe(false);
  });

  it("excludes future-dated partials from overdue KPIs", () => {
    const schedule: ScheduleRow[] = [
      row({ due_date: past("2024-01-01"), due_amount: 100 }),
      row({ due_date: future("2027-01-01"), due_amount: 100 }),
    ];
    const alloc = allocatePaymentPlan(schedule, 130, NOW);
    // row 1 fully paid, row 2 partial 30/100 (future → Advance)
    const { count, amount } = overdueSummary(alloc);
    expect(count).toBe(0);
    expect(amount).toBe(0);
    expect(overdueEntries(alloc)).toHaveLength(0);
  });

  it("still counts a PAST-due partial as overdue", () => {
    const schedule: ScheduleRow[] = [
      row({ due_date: past("2024-01-01"), due_amount: 100 }),
      row({ due_date: past("2024-06-01"), due_amount: 100 }),
    ];
    const alloc = allocatePaymentPlan(schedule, 130, NOW);
    expect(alloc[1].status).toBe("Partial");
    expect(alloc[1].future).toBe(false);
    const { count, amount } = overdueSummary(alloc);
    expect(count).toBe(1);
    expect(amount).toBe(70);
  });

  it("treats a fully unpaid future row as Upcoming, not Overdue", () => {
    const schedule: ScheduleRow[] = [row({ due_date: future("2027-01-01"), due_amount: 100 })];
    const alloc = allocatePaymentPlan(schedule, 0, NOW);
    expect(alloc[0].status).toBe("Upcoming");
    expect(overdueSummary(alloc).count).toBe(0);
  });

  it("treats a fully unpaid past row as Overdue", () => {
    const schedule: ScheduleRow[] = [row({ due_date: past("2024-01-01"), due_amount: 100 })];
    const alloc = allocatePaymentPlan(schedule, 0, NOW);
    expect(alloc[0].status).toBe("Overdue");
    expect(overdueSummary(alloc)).toEqual({ count: 1, amount: 100 });
  });

  it("treats due_date === today as future (not overdue)", () => {
    const today = new Date(NOW);
    const iso = today.toISOString().slice(0, 10);
    const schedule: ScheduleRow[] = [row({ due_date: iso, due_amount: 100 })];
    const alloc = allocatePaymentPlan(schedule, 0, NOW);
    expect(alloc[0].future).toBe(true);
    expect(alloc[0].status).toBe("Upcoming");
  });

  it("cascade: overpayment beyond down payment flows into future installments as advance", () => {
    // Mirrors the real Manal Heights scenario: DP + 7 installments cleared,
    // 8th installment (future-dated) receives partial 50k / 700k advance.
    const schedule: ScheduleRow[] = [
      row({ particulars: "Down Payment", due_date: past("2024-08-27"), due_amount: 3_432_000 }),
      ...Array.from({ length: 7 }, (_, i) =>
        row({
          particulars: `Installment ${i + 1}`,
          due_date: past("2025-01-01"),
          due_amount: 700_000,
        }),
      ),
      row({ particulars: "Installment 8", due_date: future("2026-08-27"), due_amount: 700_000 }),
      row({ particulars: "Installment 9", due_date: future("2026-11-27"), due_amount: 700_000 }),
    ];
    const totalReceived = 3_432_000 + 7 * 700_000 + 50_000; // 8,382,000
    const alloc = allocatePaymentPlan(schedule, totalReceived, NOW);
    expect(alloc.slice(0, 8).every((a) => a.status === "Paid")).toBe(true);
    expect(alloc[8].status).toBe("Partial");
    expect(alloc[8].future).toBe(true);
    expect(alloc[8].paid).toBe(50_000);
    expect(alloc[9].status).toBe("Upcoming");
    expect(overdueSummary(alloc)).toEqual({ count: 0, amount: 0 });
  });
});

describe("allocatePaymentPlan — date-source validation", () => {
  it("compares at calendar-day granularity, ignoring time-of-day/timezone drift", () => {
    // Due date parsed as UTC midnight vs a local `now` a few hours later on
    // the same calendar day must still be treated as future.
    const schedule: ScheduleRow[] = [
      row({ due_date: "2026-07-13", due_amount: 100 }), // same calendar day as NOW
    ];
    const now = new Date("2026-07-13T18:00:00+05:00"); // late in the day, PKT
    const alloc = allocatePaymentPlan(schedule, 0, now);
    expect(alloc[0].future).toBe(true);
    expect(alloc[0].status).toBe("Upcoming");
    expect(alloc[0].dueDateValid).toBe(true);
  });

  it("flags unparseable due_date and does not classify it as Overdue", () => {
    const schedule: ScheduleRow[] = [row({ due_date: "not-a-date", due_amount: 100 })];
    const alloc = allocatePaymentPlan(schedule, 0, NOW);
    expect(alloc[0].dueDateValid).toBe(false);
    expect(alloc[0].warnings.join(" ")).toMatch(/unparseable due_date/);
    // With no valid due date we can't prove it's overdue → stays Upcoming.
    expect(alloc[0].status).toBe("Upcoming");
  });

  it("payment timestamp cross-check confirms advance and emits paidBeforeDue=true", () => {
    const schedule: ScheduleRow[] = [
      row({
        due_date: "2027-01-01",
        due_amount: 100,
        latest_payment_date: "2026-06-01",
      }),
    ];
    const alloc = allocatePaymentPlan(schedule, 40, NOW);
    expect(alloc[0].future).toBe(true);
    expect(alloc[0].paidBeforeDue).toBe(true);
    expect(alloc[0].status).toBe("Partial");
    expect(overdueSummary(alloc).count).toBe(0);
  });

  it("payment predating due date overrides a wrong clock (advance override)", () => {
    // Simulate a machine clock that reports "now" as after the due date,
    // but the actual payment timestamp predates the due date. The override
    // should promote the row back to future and emit a warning.
    const schedule: ScheduleRow[] = [
      row({
        due_date: "2026-06-01", // "past" per NOW=2026-07-13
        due_amount: 100,
        latest_payment_date: "2026-05-15", // payment made before due date
      }),
    ];
    const alloc = allocatePaymentPlan(schedule, 40, NOW);
    expect(alloc[0].future).toBe(true); // overridden to true
    expect(alloc[0].paidBeforeDue).toBe(true);
    expect(alloc[0].status).toBe("Partial");
    expect(alloc[0].warnings.join(" ")).toMatch(/advance override/);
    expect(overdueSummary(alloc).count).toBe(0);
  });

  it("does NOT override when the payment was made AFTER the due date", () => {
    const schedule: ScheduleRow[] = [
      row({
        due_date: "2026-01-01",
        due_amount: 100,
        latest_payment_date: "2026-06-01", // paid late
      }),
    ];
    const alloc = allocatePaymentPlan(schedule, 40, NOW);
    expect(alloc[0].future).toBe(false);
    expect(alloc[0].paidBeforeDue).toBe(false);
    expect(alloc[0].status).toBe("Partial");
    expect(overdueSummary(alloc).count).toBe(1);
  });
});
