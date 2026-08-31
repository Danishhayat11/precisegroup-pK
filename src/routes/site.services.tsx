/**
 * /site/services — full services overview.
 * Uses a two-column layout on desktop: sticky rail with intro on the left,
 * long list of practices on the right. Each row expands the summary shown on
 * the home page with concrete deliverables.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  Home,
  Building,
  Compass,
  ShieldCheck,
  Scale,
  LineChart,
  Megaphone,
} from "lucide-react";
import { Section, Kicker } from "@/components/site/SiteChrome";
import { useStableReducedMotion } from "@/components/site/useStableReducedMotion";

import { pageSeo, breadcrumbList } from "@/lib/site-seo";

export const Route = createFileRoute("/site/services")({
  head: () => ({
    ...pageSeo({
      path: "/site/services",
      title: "Real Estate & Construction Services in Islamabad — Precise",
      description:
        "Plot & home sales, rentals, residential and commercial construction, and investment advisory in Islamabad — one accountable team.",
    }),
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: [
            "Property Acquisition",
            "Investment Advisory",
            "Property Management",
            "Architecture & Design",
            "Legal Consultation",
            "Market Research",
            "Marketing",
          ].map((name, i) => ({
            "@type": "ListItem",
            position: i + 1,
            item: {
              "@type": "Service",
              name,
              provider: { "@type": "RealEstateAgent", name: "Precise Realtors & Builders" },
              areaServed: { "@type": "City", name: "Islamabad" },
            },
          })),
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify(
          breadcrumbList([
            { name: "Home", path: "/site" },
            { name: "Services", path: "/site/services" },
          ]),
        ),
      },
    ],
  }),

  component: ServicesPage,
});

const SERVICES = [
  {
    icon: Home,
    title: "Property Acquisition",
    lead: "Prime assets, secured with market analysis and due diligence.",
    body: "Strategic identification and secure acquisition of prime real estate assets across Islamabad's premier corridors — B-17, MPCHS, FMC. Every deal comes with a legal title report, comparable pricing memo and negotiated terms.",
    deliverables: [
      "Title & mutation review",
      "Comparable price memo",
      "Negotiation on your behalf",
      "Registry support",
    ],
  },
  {
    icon: Compass,
    title: "Investment Advisory",
    lead: "Data-driven guidance for long-term capital growth.",
    body: "Strategic real-estate investment guidance informed by ground-level market research and risk-aware analysis. We model yield, tax drag and liquidity under three scenarios before you commit capital.",
    deliverables: [
      "Feasibility study",
      "Yield & IRR model",
      "Exit strategy memo",
      "Quarterly portfolio review",
    ],
  },
  {
    icon: ShieldCheck,
    title: "Property Management",
    lead: "Operational oversight for residential and commercial holdings.",
    body: "Professional property management supporting maintenance standards, tenant relations and consistent rental performance. Owners receive a monthly ledger with receipts attached — no phone calls needed.",
    deliverables: [
      "Live owner dashboard",
      "Rent collection & disbursement",
      "Preventive maintenance",
      "Annual compliance filing",
    ],
  },
  {
    icon: Building,
    title: "Architecture & Design",
    lead: "Functional, sustainable design led by our engineering team.",
    body: "Bespoke architectural solutions that balance innovation, precision and long-term usability — for residential and commercial developments. Led by Engr. Danish Hayat, our engineering and operations lead.",
    deliverables: [
      "Architectural + structural drawings",
      "3D visualisation",
      "Interior specification",
      "Site supervision",
    ],
  },
  {
    icon: Scale,
    title: "Legal Consultation",
    lead: "Secure, compliant transactions supported by legal review.",
    body: "Comprehensive due diligence, title verification and contract review — every transaction remains secure, compliant and defensible. We coordinate directly with your legal advisors when needed.",
    deliverables: [
      "Title verification",
      "Contract review",
      "Regulatory compliance",
      "Dispute pre-emption",
    ],
  },
  {
    icon: LineChart,
    title: "Market Research",
    lead: "Data-driven intelligence for smart buying and selling.",
    body: "Deep real-estate market research provides the data-driven intelligence you need for informed buying, selling and investment decisions across Islamabad's key corridors.",
    deliverables: [
      "Sector price index",
      "Absorption analysis",
      "Developer benchmarking",
      "Custom research briefs",
    ],
  },
  {
    icon: Megaphone,
    title: "Marketing",
    lead: "Targeted outreach to attract qualified buyers.",
    body: "We implement targeted property marketing strategies and digital outreach to enhance visibility, attract qualified buyers and support effective market positioning across print, digital and social channels.",
    deliverables: [
      "Listing photography",
      "Digital advertising",
      "Social media campaigns",
      "Buyer qualification",
    ],
  },
] as const;

function ServicesPage() {
  const reduce = useStableReducedMotion();
  return (
    <>
      <Section className="pt-10 sm:pt-16 pb-14">
        <div className="max-w-3xl stack-tight">
          <Kicker>Practices</Kicker>
          <h1 className="site-h1 text-foreground">
            Seven practices.
            <span className="block italic text-muted-foreground font-normal">
              One accountable team.
            </span>
          </h1>
          <p className="site-lead mt-4">
            Every engagement — from a single plot advisory to a forty-storey build — moves through
            the same documented process. Below is what that looks like at each stage.
          </p>
        </div>
      </Section>

      <Section className="pb-24">
        <ul className="grid gap-5">
          {SERVICES.map((s, i) => (
            <motion.li
              key={s.title}
              initial={reduce ? {} : { opacity: 0, y: 16 }}
              whileInView={reduce ? {} : { opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.55, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
              className="group relative overflow-hidden rounded-2xl border border-foreground/10 bg-card p-6 shadow-[0_2px_10px_-4px_rgba(18,20,26,0.06)] transition-all hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-[0_20px_40px_-24px_rgba(18,20,26,0.18)] sm:p-8"
            >
              <div className="grid gap-6 md:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)] md:items-start">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-foreground/15 bg-foreground/8 text-foreground transition-colors group-hover:border-foreground/25">
                  <s.icon className="h-5.5 w-5.5" />
                </div>
                <div className="min-w-0">
                  <h2>{s.title}</h2>
                  <p className="mt-1.5 italic text-foreground">{s.lead}</p>
                  <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed">{s.body}</p>
                </div>
                <div className="md:border-l md:border-foreground/10 md:pl-6">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Deliverables
                  </h3>
                  <ul className="space-y-2">
                    {s.deliverables.map((d) => (
                      <li key={d} className="flex items-start gap-2.5 text-[13px] text-foreground">
                        <span
                          aria-hidden
                          className="mt-2 h-1 w-1 shrink-0 rounded-full bg-foreground"
                        />
                        <span>{d}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </motion.li>
          ))}
        </ul>

        <div className="mt-16 text-center">
          <Link
            to="/site/contact"
            className="group inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3.5 text-[12.5px] font-semibold uppercase tracking-[0.16em] text-primary-foreground transition-all hover:-translate-y-0.5 hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Discuss your project
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>
      </Section>
    </>
  );
}
