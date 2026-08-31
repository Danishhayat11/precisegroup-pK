/**
 * PricingSection — 3-tier pricing block for the ERP surface.
 *
 * Uses semantic design tokens (primary/muted/card) so it inherits the
 * iOS palette applied globally via `[data-theme="ios"]`. No hard-coded
 * colors.
 */
import { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PRICING_TIERS, formatPKR, type BillingPeriod } from "@/lib/pricing-tiers";

export function PricingSection({
  onSelect,
}: {
  onSelect?: (tierId: string, period: BillingPeriod) => void;
}) {
  const [period, setPeriod] = useState<BillingPeriod>("monthly");

  return (
    <section aria-labelledby="pricing-heading" className="space-y-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
          Pricing
        </span>
        <h1 id="pricing-heading" className="max-w-2xl">
          Simple pricing that grows with your team.
        </h1>
        <p className="lead max-w-xl">
          Every plan includes the full ERP core. Switch between monthly and yearly billing — save
          two months when paid annually.
        </p>
        <BillingToggle period={period} onChange={setPeriod} />
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {PRICING_TIERS.map((tier) => {
          const price = period === "monthly" ? tier.monthly : tier.yearly;
          const featured = tier.featured;
          return (
            <Card
              key={tier.id}
              className={
                "relative flex flex-col p-6 transition-shadow " +
                (featured
                  ? "border-primary/60 shadow-lg ring-1 ring-primary/40"
                  : "hover:shadow-md")
              }
            >
              {featured && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary-foreground shadow">
                  Recommended
                </span>
              )}

              <header className="space-y-1">
                <h2 className="text-xl font-semibold">{tier.name}</h2>
                <p className="text-sm text-muted-foreground">{tier.tagline}</p>
              </header>

              <div className="mt-6 flex items-baseline gap-1.5">
                <span className="text-4xl font-semibold tracking-tight">{formatPKR(price)}</span>
                <span className="text-sm text-muted-foreground">/ month</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {period === "yearly"
                  ? `Billed ${formatPKR(tier.yearly * 12)} yearly`
                  : "Billed monthly, cancel anytime"}
              </p>

              <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <span
                      aria-hidden
                      className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </span>
                    <span className="text-foreground">{f}</span>
                  </li>
                ))}
              </ul>

              <Button
                className="mt-6 w-full"
                variant={featured ? "default" : "outline"}
                onClick={() => onSelect?.(tier.id, period)}
              >
                {tier.cta}
              </Button>
            </Card>
          );
        })}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        All prices in PKR and exclusive of applicable taxes. Need something custom?{" "}
        <a href="/site/contact" className="underline underline-offset-2">
          Talk to us
        </a>
        .
      </p>
    </section>
  );
}

function BillingToggle({
  period,
  onChange,
}: {
  period: BillingPeriod;
  onChange: (p: BillingPeriod) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Billing period"
      className="inline-flex items-center rounded-full border border-border bg-muted/40 p-1 text-sm"
    >
      {(["monthly", "yearly"] as const).map((p) => {
        const active = period === p;
        return (
          <button
            key={p}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(p)}
            className={
              "min-h-11 rounded-full px-4 py-1.5 font-medium capitalize transition-colors " +
              (active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {p}
            {p === "yearly" && (
              <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                -17%
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
