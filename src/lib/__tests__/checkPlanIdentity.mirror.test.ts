/**
 * Regression tests: `checkPlanIdentity` must NOT double-count
 * `adjustment_credit` when the concession is already mirrored inside
 * `down_payment` (the legacy-booking convention on BK-MA-00014 / 00015).
 *
 * Historical bug: the identity summed `down_payment + adjustment_credit +
 * installments + possession`, so mirrored adjustments produced a false
 * `Plan ≠ Contract` critical finding on the Data Health dashboard.
 *
 * Contract enforced here:
 *   planSum === down_payment + installment_amount * no_of_installments
 *                             + possession_amount
 * `adjustment_credit` is validated separately by the ledger engine and
 * must never enter the plan-identity sum.
 */
import { describe, it, expect } from "vitest";
import { checkPlanIdentity } from "@/lib/fifoEngine";

describe("checkPlanIdentity — adjustment_credit mirrored in down_payment", () => {
  // Contract = 3,000,000
  // Adjustment of 100k already folded into down_payment (500k includes it).
  const mirrored = {
    down_payment: 500_000,
    adjustment_credit: 100_000, // mirrored inside down_payment
    installment_amount: 200_000,
    no_of_installments: 10,
    possession_amount: 500_000,
    total_contract_value: 3_000_000,
  };

  it("does not double-count adjustment_credit in planSum", () => {
    const r = checkPlanIdentity(mirrored);
    expect(r.planSum).toBe(500_000 + 200_000 * 10 + 500_000); // 3,000,000
    expect(r.contract).toBe(3_000_000);
    expect(r.diff).toBe(0);
    expect(r.matches).toBe(true);
  });

  it("is invariant to the value of adjustment_credit", () => {
    const base = checkPlanIdentity({ ...mirrored, adjustment_credit: 0 });
    for (const adj of [1, 50_000, 100_000, 999_999, 5_000_000]) {
      const r = checkPlanIdentity({ ...mirrored, adjustment_credit: adj });
      expect(r.planSum).toBe(base.planSum);
      expect(r.diff).toBe(base.diff);
      expect(r.matches).toBe(base.matches);
    }
  });

  it("handles null/undefined adjustment_credit identically to 0", () => {
    const zero = checkPlanIdentity({ ...mirrored, adjustment_credit: 0 });
    const nul = checkPlanIdentity({ ...mirrored, adjustment_credit: null });
    const undef = checkPlanIdentity({ ...mirrored, adjustment_credit: undefined });
    expect(nul).toEqual(zero);
    expect(undef).toEqual(zero);
  });

  it("still flags a real plan/contract mismatch (regression guard)", () => {
    const r = checkPlanIdentity({
      ...mirrored,
      adjustment_credit: 100_000,
      possession_amount: 400_000, // short by 100k
    });
    expect(r.matches).toBe(false);
    expect(r.diff).toBe(-100_000);
  });

  it("BK-MA-00014-style fixture: mirrored adjustment does not trip identity", () => {
    // Snapshot mirrors the reconciled BK-MA-00014 shape after the fix.
    const bk14 = {
      down_payment: 1_500_000, // includes 500k adjustment concession
      adjustment_credit: 500_000, // mirrored — must be excluded
      installment_amount: 250_000,
      no_of_installments: 12,
      possession_amount: 1_500_000,
      total_contract_value: 6_000_000,
    };
    const r = checkPlanIdentity(bk14);
    expect(r.planSum).toBe(1_500_000 + 250_000 * 12 + 1_500_000);
    expect(r.matches).toBe(true);
  });
});

describe("audit-loop integration — mirrored adjustment produces no plan_identity finding", () => {
  // Mirrors the exact loop shape used by src/lib/dataAudit.ts:
  //   const ident = checkPlanIdentity(b);
  //   if (!ident.matches) push({ id: `${b.booking_id}:plan_identity`, ... });
  // Kept inline (rather than importing runDataAudit) so the test stays a
  // pure unit — runDataAudit fetches from the live backend.
  function auditPlanIdentity(
    bookings: Parameters<typeof checkPlanIdentity>[0][] & { booking_id?: string }[],
  ) {
    const findings: { id: string; type: string }[] = [];
    for (const b of bookings) {
      const ident = checkPlanIdentity(b);
      if (!ident.matches) {
        findings.push({
          id: `${(b as { booking_id?: string }).booking_id ?? "?"}:plan_identity`,
          type: "Plan ≠ Contract",
        });
      }
    }
    return findings;
  }

  it("does not emit a plan_identity finding when adjustment is mirrored in down_payment", () => {
    const findings = auditPlanIdentity([
      {
        booking_id: "BK-MA-TEST-MIRROR",
        down_payment: 500_000,
        adjustment_credit: 100_000,
        installment_amount: 200_000,
        no_of_installments: 10,
        possession_amount: 500_000,
        total_contract_value: 3_000_000,
      } as never,
    ]);
    expect(findings.filter((f) => f.id.endsWith(":plan_identity"))).toHaveLength(0);
  });

  it("still emits a plan_identity finding for a genuine mismatch", () => {
    const findings = auditPlanIdentity([
      {
        booking_id: "BK-MA-TEST-BROKEN",
        down_payment: 500_000,
        adjustment_credit: 0,
        installment_amount: 200_000,
        no_of_installments: 10,
        possession_amount: 400_000, // 100k short
        total_contract_value: 3_000_000,
      } as never,
    ]);
    expect(findings.map((f) => f.id)).toContain("BK-MA-TEST-BROKEN:plan_identity");
  });
});
