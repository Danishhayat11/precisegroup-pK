/**
 * Shared pricing tier data for the /pricing (ERP) and /site/pricing
 * (marketing) pages. Prices are in PKR / month, billed annually or
 * monthly. Yearly totals apply a 2-month discount (16.67%) — hence the
 * `yearly` figure is the effective monthly rate when paid annually.
 */
export type BillingPeriod = "monthly" | "yearly";

export type PricingTier = {
  id: "starter" | "pro" | "enterprise";
  name: string;
  tagline: string;
  monthly: number;
  yearly: number;
  cta: string;
  featured?: boolean;
  features: string[];
};

export const PRICING_TIERS: PricingTier[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "For small teams getting organised.",
    monthly: 9900,
    yearly: 8250,
    cta: "Start free trial",
    features: [
      "Up to 3 team members",
      "50 active bookings",
      "Payment ledger & receipts",
      "Basic reports (PDF export)",
      "Email support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For growing agencies and builders.",
    monthly: 24900,
    yearly: 20750,
    cta: "Choose Pro",
    featured: true,
    features: [
      "Up to 15 team members",
      "Unlimited bookings & clients",
      "Full HR, payroll & attendance",
      "Advanced reports & dashboards",
      "CRM pipeline & follow-ups",
      "Priority support (24h SLA)",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "For multi-project developers.",
    monthly: 59900,
    yearly: 49900,
    cta: "Talk to sales",
    features: [
      "Unlimited team members",
      "Multi-tenant workspaces",
      "Custom roles & permissions",
      "Dedicated onboarding manager",
      "SSO & audit log exports",
      "99.9% uptime SLA",
    ],
  },
];

export function formatPKR(n: number): string {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 0,
  }).format(n);
}
