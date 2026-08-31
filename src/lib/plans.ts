/**
 * Subscription-plan feature gating.
 *
 * Every company has a `plan` on the `companies` row (see enum
 * `public.company_plan`). Nav and routes are gated against these tiers.
 *
 * Tiers (ordered):
 *   starter       -> Bookings, Payments, Ledger, Documents, Dashboard, Maintenance (view only)
 *   professional  -> + HR & Payroll, Office Expenses, Reports, Audit
 *   builder       -> + Construction, Leads & CRM, Advanced Reports,
 *                    Multi-user Management, API access
 */

export type Plan = "starter" | "professional" | "builder";

export const PLAN_ORDER: Plan[] = ["starter", "professional", "builder"];

export const PLAN_LABEL: Record<Plan, string> = {
  starter: "Starter",
  professional: "Professional",
  builder: "Builder",
};

/**
 * WhatsApp number shown on the upgrade CTA. Change here to update every
 * upgrade prompt in the app.
 */
export const UPGRADE_WHATSAPP = "+92 337 0129621";
const UPGRADE_WHATSAPP_DIGITS = UPGRADE_WHATSAPP.replace(/[^\d]/g, "");
export const UPGRADE_WHATSAPP_LINK = `https://wa.me/${UPGRADE_WHATSAPP_DIGITS}`;

/**
 * Build a wa.me link with a prefilled message that names the exact
 * feature the user tried to open and the plan they need. Keeps our
 * inbox triageable — the message body is the only signal we get on the
 * receiving end that a specific gated click drove the conversation.
 *
 * `feature` is the resolved FeatureMeta from `featureForPath()`, so its
 * `label` already reflects the clicked nav item (e.g. "Print Ledger")
 * rather than the parent feature ("Installment Ledger").
 */
export function buildUpgradeWhatsappLink(
  feature: FeatureMeta,
  opts: { currentPlan?: Plan | null; companyName?: string | null } = {},
): string {
  const required = PLAN_LABEL[feature.minPlan];
  const current = opts.currentPlan ? PLAN_LABEL[opts.currentPlan] : "no plan";
  const lines = [
    `Hi Precise team — I'd like to upgrade to the ${required} plan.`,
    ``,
    `Feature: ${feature.label}`,
    `Required plan: ${required}`,
    `Current plan: ${current}`,
  ];
  if (opts.companyName) lines.push(`Workspace: ${opts.companyName}`);
  lines.push(``, `Please help me activate it. Thanks!`);
  const text = encodeURIComponent(lines.join("\n"));
  return `https://wa.me/${UPGRADE_WHATSAPP_DIGITS}?text=${text}`;
}

export function planRank(p: Plan | null | undefined): number {
  return p ? PLAN_ORDER.indexOf(p) : -1;
}

export function planAtLeast(current: Plan | null | undefined, required: Plan): boolean {
  return planRank(current) >= planRank(required);
}

// ---- Feature registry ---------------------------------------------------

export type FeatureKey =
  | "dashboard"
  | "bookings"
  | "payments"
  | "ledger"
  | "documents"
  | "maintenance"
  | "hr"
  | "office_expenses"
  | "reports"
  | "audit"
  | "construction"
  | "crm"
  | "advanced_reports"
  | "multi_user"
  | "api_access";

export type FeatureMeta = {
  key: FeatureKey;
  label: string;
  minPlan: Plan;
  /** One-line description shown on the upgrade prompt. */
  description: string;
};

export const FEATURES: Record<FeatureKey, FeatureMeta> = {
  dashboard: {
    key: "dashboard",
    label: "Dashboard",
    minPlan: "starter",
    description: "KPIs and today's activity at a glance.",
  },
  bookings: {
    key: "bookings",
    label: "Bookings",
    minPlan: "starter",
    description: "Manage unit bookings and buyers.",
  },
  payments: {
    key: "payments",
    label: "Payments",
    minPlan: "starter",
    description: "Record and review payment receipts.",
  },
  ledger: {
    key: "ledger",
    label: "Installment Ledger",
    minPlan: "starter",
    description: "Per-booking installment schedules and balances.",
  },
  documents: {
    key: "documents",
    label: "Documents",
    minPlan: "starter",
    description: "Contracts, receipts and attachments.",
  },
  maintenance: {
    key: "maintenance",
    label: "Maintenance",
    minPlan: "starter",
    description: "Recurring maintenance charges, receipts and building expenses.",
  },
  hr: {
    key: "hr",
    label: "HR & Payroll",
    minPlan: "professional",
    description: "Employees, attendance, monthly payroll and final settlements.",
  },
  office_expenses: {
    key: "office_expenses",
    label: "Office Expenses",
    minPlan: "professional",
    description: "Rent, utilities, supplies and operating costs.",
  },
  reports: {
    key: "reports",
    label: "Reports",
    minPlan: "professional",
    description: "Financial and operational reports.",
  },
  audit: {
    key: "audit",
    label: "Audit Log",
    minPlan: "professional",
    description: "Full audit trail of edits, deletes and approvals.",
  },
  construction: {
    key: "construction",
    label: "Construction",
    minPlan: "builder",
    description: "Per-project construction budgets, costs and payments.",
  },
  crm: {
    key: "crm",
    label: "Leads & CRM",
    minPlan: "builder",
    description: "Sales pipeline, follow-ups and lead conversions.",
  },
  advanced_reports: {
    key: "advanced_reports",
    label: "Advanced Reports",
    minPlan: "builder",
    description: "Cross-project analytics and cohort reporting.",
  },
  multi_user: {
    key: "multi_user",
    label: "Multi-user Management",
    minPlan: "builder",
    description: "Invite teammates and manage roles and permissions.",
  },
  api_access: {
    key: "api_access",
    label: "API Access",
    minPlan: "builder",
    description: "Programmatic API access and integration keys.",
  },
};

/**
 * Path → feature. Longest-prefix match. Anything not listed is treated as
 * always-allowed (utility pages: /settings, /health, /login, etc.).
 *
 * `copy` overrides the label/description shown in the upgrade modal so
 * that clicking e.g. "Print Ledger" or "Payroll" surfaces THAT item's
 * name instead of the parent feature ("Installment Ledger", "HR &
 * Payroll"). Gating (minPlan) still comes from the parent feature.
 */
type PathCopy = { label: string; description: string };
const PATH_FEATURES: Array<[string, FeatureKey, PathCopy?]> = [
  ["/dashboard", "dashboard"],
  ["/bookings", "bookings"],
  ["/payments", "payments"],
  ["/ledger", "ledger"],
  [
    "/print-ledger",
    "ledger",
    {
      label: "Print Ledger",
      description: "Print-ready Debit / Credit / Balance statements per client.",
    },
  ],
  [
    "/adjustments",
    "payments",
    {
      label: "Adjustments",
      description: "Transfers, discounts and corrections between bookings.",
    },
  ],
  ["/documents", "documents"],
  ["/maintenance", "maintenance"],
  ["/hr", "hr"],
  [
    "/hr/employees",
    "hr",
    {
      label: "Employees",
      description: "Employee master list and profiles.",
    },
  ],
  [
    "/hr/attendance",
    "hr",
    {
      label: "Attendance",
      description: "Daily attendance and leave records.",
    },
  ],
  [
    "/hr/payroll",
    "hr",
    {
      label: "Payroll",
      description: "Monthly salary runs and payslips.",
    },
  ],
  [
    "/hr/final-settlement",
    "hr",
    {
      label: "Final Settlement",
      description: "Full and final settlements for leavers.",
    },
  ],
  ["/office-expenses", "office_expenses"],
  ["/reports", "reports"],
  ["/audit-log", "audit"],
  ["/construction", "construction"],
  ["/crm", "crm"],
  ["/admin", "multi_user"],
];

export function featureForPath(pathname: string): FeatureMeta | null {
  // Longest-prefix wins so "/print-ledger" doesn't match "/ledger" oddly,
  // and "/hr/payroll" wins over "/hr".
  const sorted = [...PATH_FEATURES].sort((a, b) => b[0].length - a[0].length);
  for (const [prefix, key, copy] of sorted) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      const base = FEATURES[key];
      return copy ? { ...base, label: copy.label, description: copy.description } : base;
    }
  }
  return null;
}

export function canAccessPath(plan: Plan | null | undefined, pathname: string): boolean {
  const feat = featureForPath(pathname);
  if (!feat) return true;
  return planAtLeast(plan, feat.minPlan);
}
