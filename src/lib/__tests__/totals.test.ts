import { describe, expect, it } from "vitest";
import {
  computeTotalReceived,
  sumAdjApproved,
  sumAdjRealised,
  sumCashRecovered,
  sumCommissionPaid,
} from "../totals";

describe("computeTotalReceived — Cash + Asset Realized − Commission identity", () => {
  it("matches the formula on a simple mocked set", () => {
    const bookings = [
      { dealer_commission_amount: 50_000 },
      { dealer_commission_amount: 25_000 },
      { dealer_commission_amount: 0 },
    ];
    const payments = [{ safe_cash_amount: 1_000_000 }, { safe_cash_amount: 250_000 }];
    const adjustments = [
      { approved_value: 500_000, realized_value: 400_000 },
      { approved_value: 150_000, realized_value: 100_000 },
    ];

    const r = computeTotalReceived({ bookings, payments, adjustments });

    expect(r.cashRecovered).toBe(1_250_000);
    expect(r.adjRealised).toBe(500_000);
    expect(r.adjApproved).toBe(650_000);
    expect(r.commissionPaid).toBe(75_000);
    expect(r.totalReceived).toBe(1_250_000 + 650_000 - 75_000);
    expect(r.totalReceived).toBe(r.cashRecovered + r.adjApproved - r.commissionPaid);
  });

  it("returns 0s for empty inputs", () => {
    const r = computeTotalReceived({ bookings: [], payments: [], adjustments: [] });
    expect(r).toEqual({
      cashRecovered: 0,
      adjRealised: 0,
      adjApproved: 0,
      commissionPaid: 0,
      totalReceived: 0,
    });
  });

  it("coerces string/null/undefined/NaN amounts to 0", () => {
    const r = computeTotalReceived({
      bookings: [
        { dealer_commission_amount: "10000" as any },
        { dealer_commission_amount: null },
        { dealer_commission_amount: undefined },
        { dealer_commission_amount: "not-a-number" as any },
      ],
      payments: [{ safe_cash_amount: "500000" as any }, { safe_cash_amount: null }],
      adjustments: [
        { approved_value: "200000" as any, realized_value: "150000" as any },
        { approved_value: undefined, realized_value: undefined },
      ],
    });
    expect(r.cashRecovered).toBe(500_000);
    expect(r.adjRealised).toBe(150_000);
    expect(r.adjApproved).toBe(200_000);
    expect(r.commissionPaid).toBe(10_000);
    expect(r.totalReceived).toBe(500_000 + 200_000 - 10_000);
  });

  it("can produce a negative Total Received when deductions exceed cash", () => {
    const r = computeTotalReceived({
      bookings: [{ dealer_commission_amount: 1_000_000 }],
      payments: [{ safe_cash_amount: 100_000 }],
      adjustments: [{ approved_value: 200_000, realized_value: 50_000 }],
    });
    expect(r.totalReceived).toBe(100_000 + 200_000 - 1_000_000);
    expect(r.totalReceived).toBe(r.cashRecovered + r.adjApproved - r.commissionPaid);
  });

  it("identity holds across 200 randomised fuzz inputs", () => {
    const rand = (max: number) => Math.floor(Math.random() * max);
    for (let i = 0; i < 200; i++) {
      const bookings = Array.from({ length: rand(20) }, () => ({
        dealer_commission_amount: rand(500_000),
      }));
      const payments = Array.from({ length: rand(50) }, () => ({
        safe_cash_amount: rand(2_000_000),
      }));
      const adjustments = Array.from({ length: rand(30) }, () => {
        const approved = rand(1_000_000);
        return { approved_value: approved, realized_value: rand(approved + 1) };
      });

      const r = computeTotalReceived({ bookings, payments, adjustments });
      expect(r.cashRecovered).toBe(sumCashRecovered(payments));
      expect(r.adjRealised).toBe(sumAdjRealised(adjustments));
      expect(r.adjApproved).toBe(sumAdjApproved(adjustments));
      expect(r.commissionPaid).toBe(sumCommissionPaid(bookings));
      expect(r.totalReceived).toBe(r.cashRecovered + r.adjApproved - r.commissionPaid);
    }
  });
});
