/**
 * /site/pricing — plans & pricing on the marketing surface.
 * Editorial luxury aesthetic: Playfair display, champagne gold accents,
 * ivory paper background. Matches SiteChrome's Section/Kicker rhythm.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowUpRight, Check } from "lucide-react";
import { Section, Kicker } from "@/components/site/SiteChrome";
import { useStableReducedMotion } from "@/components/site/useStableReducedMotion";
import { pageSeo, breadcrumbList } from "@/lib/site-seo";
import { PRICING_TIERS, formatPKR, type BillingPeriod } from "@/lib/pricing-tiers";

export const Route = createFileRoute("/site/pricing")({
  head: () => ({
    ...pageSeo({
      path: "/site/pricing",
      title: "Pricing — Precise Realtors & Builders ERP",
      description:
        "Transparent monthly and yearly plans for the Precise real-estate ERP — Starter, Pro and Enterprise tiers with a two-month annual discount.",
    }),
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify(
          breadcrumbList([
            { name: "Home", path: "/site" },
            { name: "Pricing", path: "/site/pricing" },
          ]),
        ),
      },
    ],
  }),
  component: PricingPage,
});

function PricingPage() {
  const reduce = useStableReducedMotion();
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const fade = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 24 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, margin: "-80px" },
        transition: { duration: 0.7, ease: [0.2, 0.7, 0.2, 1] as [number, number, number, number] },
      };

  return (
    <>
      {/* Hero */}
      <Section className="pt-36 pb-16 sm:pt-44 sm:pb-20">
        <motion.div {...fade} className="max-w-3xl">
          <Kicker>Pricing</Kicker>
          <h1 className="site-h1 mt-6 text-foreground">
            One platform. <span className="italic text-[var(--gold)]">Three ways</span> to run your
            practice.
          </h1>
          <p className="site-lead mt-6 max-w-2xl">
            Every plan includes the full Precise ERP — bookings, ledger, HR, reports. Choose the
            tier that matches your team, and switch any time. Yearly billing saves two months.
          </p>

          <div className="mt-10">
            <BillingToggle period={period} onChange={setPeriod} />
          </div>
        </motion.div>
      </Section>

      {/* Tiers */}
      <Section className="pb-24 sm:pb-32">
        <div className="grid gap-6 md:grid-cols-3 md:gap-7">
          {PRICING_TIERS.map((tier, idx) => {
            const price = period === "monthly" ? tier.monthly : tier.yearly;
            const featured = tier.featured;
            return (
              <motion.article
                key={tier.id}
                {...fade}
                transition={
                  reduce
                    ? undefined
                    : {
                        duration: 0.7,
                        delay: idx * 0.08,
                        ease: [0.2, 0.7, 0.2, 1] as [number, number, number, number],
                      }
                }
                className={
                  "relative flex flex-col rounded-2xl border p-7 sm:p-8 transition-shadow " +
                  (featured
                    ? "border-[var(--gold)]/60 bg-background shadow-[0_30px_80px_-40px_rgba(142,90,29,0.35)]"
                    : "border-foreground/[0.10] bg-background/60")
                }
              >
                {featured && (
                  <span
                    className="absolute -top-3 left-7 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--gold-foreground)]"
                    style={{
                      background:
                        "linear-gradient(180deg, rgba(201,169,97,0.98), rgba(142,90,29,0.98))",
                      boxShadow: "0 10px 24px -12px rgba(142,90,29,0.55)",
                    }}
                  >
                    Recommended
                  </span>
                )}

                <header>
                  <h2 className="site-h3 text-foreground">{tier.name}</h2>
                  <p className="mt-2 text-sm font-light leading-relaxed text-muted-foreground">
                    {tier.tagline}
                  </p>
                </header>

                <div className="mt-8 flex items-baseline gap-2">
                  <span
                    className="text-4xl font-semibold tracking-tight text-foreground"
                    style={{ fontFamily: '"Playfair Display", serif' }}
                  >
                    {formatPKR(price)}
                  </span>
                  <span className="text-sm text-muted-foreground">/ month</span>
                </div>
                <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  {period === "yearly"
                    ? `Billed ${formatPKR(tier.yearly * 12)} yearly`
                    : "Billed monthly · cancel anytime"}
                </p>

                <ul className="mt-8 flex-1 space-y-3 text-[14px]">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[color:var(--gold-foreground)]"
                        style={{
                          background:
                            "linear-gradient(180deg, rgba(201,169,97,0.95), rgba(142,90,29,0.95))",
                        }}
                      >
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                      <span className="font-light leading-relaxed text-foreground">{f}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-9">
                  {tier.id === "enterprise" ? (
                    <Link
                      to="/site/contact"
                      className={
                        featured
                          ? "lg-btn-primary lg-shine w-full text-[11px] uppercase tracking-[0.22em]"
                          : "lg-pill w-full justify-center text-[11px] uppercase tracking-[0.22em]"
                      }
                    >
                      {tier.cta}
                      <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  ) : (
                    <Link
                      to="/signup"
                      search={{ plan: tier.id, period } as never}
                      className={
                        featured
                          ? "lg-btn-primary lg-shine w-full text-[11px] uppercase tracking-[0.22em]"
                          : "lg-pill w-full justify-center text-[11px] uppercase tracking-[0.22em]"
                      }
                    >
                      {tier.cta}
                      <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  )}
                </div>
              </motion.article>
            );
          })}
        </div>

        <p className="mt-10 text-center text-xs text-muted-foreground">
          All prices in PKR, exclusive of applicable taxes. Need a custom arrangement?{" "}
          <Link to="/site/contact" className="underline underline-offset-2 hover:text-foreground">
            Talk to our team
          </Link>
          .
        </p>
      </Section>
    </>
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
      className="inline-flex items-center rounded-full border border-foreground/15 bg-background/70 p-1 text-[12px] backdrop-blur"
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
              "min-h-11 rounded-full px-5 py-2 font-medium uppercase tracking-[0.2em] transition-colors " +
              (active
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {p}
            {p === "yearly" && (
              <span className="ml-2 rounded-full bg-[var(--gold)]/15 px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.14em] text-[var(--gold)]">
                −17%
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
