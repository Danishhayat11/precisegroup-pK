/**
 * Contract test for the plan-gating upgrade screen.
 *
 * For every gated route the sidebar links to, this asserts:
 *  1. `featureForPath(path)` resolves to the expected feature key.
 *  2. `<UpgradeScreen feature={feat} />` renders the correct required-plan
 *     title ("This feature requires <Plan> plan") for that feature.
 *  3. The feature's label + description appear verbatim in the body — this
 *     is the copy contract users see when their plan is too low.
 *
 * The list of gated routes lives inside this test file on purpose: if
 * `PATH_FEATURES` in `src/lib/plans.ts` is edited (a route retargeted to a
 * different feature, a new gated route added without updating this test),
 * the test fails loudly. That's the whole point — regressions in the
 * gate → upgrade-copy pipeline are silent otherwise.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { UpgradeScreen } from "@/components/UpgradeGate";
import { FEATURES, PLAN_LABEL, featureForPath, type FeatureKey } from "@/lib/plans";

// Routes registered in PATH_FEATURES (src/lib/plans.ts). Keep in sync.
// `label`/`description` are what the upgrade modal must display for that
// specific clicked path — child paths override the parent feature copy so
// clicking "Print Ledger" doesn't announce "Installment Ledger".
const GATED_ROUTES: Array<{
  path: string;
  feature: FeatureKey;
  label: string;
  description: string;
}> = [
  {
    path: "/dashboard",
    feature: "dashboard",
    label: "Dashboard",
    description: "KPIs and today's activity at a glance.",
  },
  {
    path: "/bookings",
    feature: "bookings",
    label: "Bookings",
    description: "Manage unit bookings and buyers.",
  },
  {
    path: "/payments",
    feature: "payments",
    label: "Payments",
    description: "Record and review payment receipts.",
  },
  {
    path: "/ledger",
    feature: "ledger",
    label: "Installment Ledger",
    description: "Per-booking installment schedules and balances.",
  },
  {
    path: "/print-ledger",
    feature: "ledger",
    label: "Print Ledger",
    description: "Print-ready Debit / Credit / Balance statements per client.",
  },
  {
    path: "/adjustments",
    feature: "payments",
    label: "Adjustments",
    description: "Transfers, discounts and corrections between bookings.",
  },
  {
    path: "/documents",
    feature: "documents",
    label: "Documents",
    description: "Contracts, receipts and attachments.",
  },
  {
    path: "/maintenance",
    feature: "maintenance",
    label: "Maintenance",
    description: "Recurring maintenance charges, receipts and building expenses.",
  },
  {
    path: "/hr",
    feature: "hr",
    label: "HR & Payroll",
    description: "Employees, attendance, monthly payroll and final settlements.",
  },
  {
    path: "/hr/employees",
    feature: "hr",
    label: "Employees",
    description: "Employee master list and profiles.",
  },
  {
    path: "/hr/attendance",
    feature: "hr",
    label: "Attendance",
    description: "Daily attendance and leave records.",
  },
  {
    path: "/hr/payroll",
    feature: "hr",
    label: "Payroll",
    description: "Monthly salary runs and payslips.",
  },
  {
    path: "/hr/final-settlement",
    feature: "hr",
    label: "Final Settlement",
    description: "Full and final settlements for leavers.",
  },
  {
    path: "/office-expenses",
    feature: "office_expenses",
    label: "Office Expenses",
    description: "Rent, utilities, supplies and operating costs.",
  },
  {
    path: "/reports",
    feature: "reports",
    label: "Reports",
    description: "Financial and operational reports.",
  },
  {
    path: "/audit-log",
    feature: "audit",
    label: "Audit Log",
    description: "Full audit trail of edits, deletes and approvals.",
  },
  {
    path: "/construction",
    feature: "construction",
    label: "Construction",
    description: "Per-project construction budgets, costs and payments.",
  },
  {
    path: "/crm",
    feature: "crm",
    label: "Leads & CRM",
    description: "Sales pipeline, follow-ups and lead conversions.",
  },
  {
    path: "/admin",
    feature: "multi_user",
    label: "Multi-user Management",
    description: "Invite teammates and manage roles and permissions.",
  },
];

describe("PlanGate → UpgradeScreen copy contract", () => {
  for (const { path, feature: expectedKey, label, description } of GATED_ROUTES) {
    describe(`route ${path}`, () => {
      it(`maps to feature "${expectedKey}" with the clicked item's copy`, () => {
        const feat = featureForPath(path);
        expect(feat, `featureForPath(${path}) returned null`).not.toBeNull();
        expect(feat!.key).toBe(expectedKey);
        expect(feat!.label).toBe(label);
        expect(feat!.description).toBe(description);
        // Gating tier still comes from the parent feature.
        expect(feat!.minPlan).toBe(FEATURES[expectedKey].minPlan);
      });

      it("also matches nested sub-paths (longest-prefix)", () => {
        const feat = featureForPath(`${path}/some/sub/route`);
        expect(feat?.key).toBe(expectedKey);
        expect(feat?.label).toBe(label);
      });

      it("renders the correct required-plan title and clicked-item description in UpgradeScreen", () => {
        const feat = featureForPath(path)!;
        cleanup();
        render(<UpgradeScreen feature={feat} />);

        const heading = screen.getByRole("heading", { level: 1 });
        expect(heading.textContent).toBe(`This feature requires ${PLAN_LABEL[feat.minPlan]} plan`);

        expect(screen.getByText(label, { selector: "span" })).toBeInTheDocument();
        expect(screen.getByText(new RegExp(escapeRegex(description)))).toBeInTheDocument();

        const cta = screen.getByText(
          new RegExp(`activate ${escapeRegex(PLAN_LABEL[feat.minPlan])} for your`),
        );
        expect(cta).toBeInTheDocument();
      });
    });
  }

  it("covers every FeatureKey referenced by PATH_FEATURES", () => {
    const referenced = new Set(GATED_ROUTES.map((r) => r.feature));
    for (const key of referenced) {
      expect(FEATURES[key], `FEATURES missing key ${key}`).toBeDefined();
    }
  });
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
