import { createFileRoute, Link } from "@tanstack/react-router";
import { pageSeo, breadcrumbList, SITE_BASE_URL } from "@/lib/site-seo";

// SEO_TITLE ≤60 chars for full SERP display; SEO_DESCRIPTION 50–160 chars.
// The longer article headline (TITLE) stays in JSON-LD + on-page H1.
const TITLE = "Property Management Software vs Real Estate ERP Software";
const SEO_TITLE = "Property Management vs Real Estate ERP — Precise";
const SEO_DESCRIPTION =
  "Property management software vs a real-estate ERP: how integrated bookings, installments, documents, and accounting differ from point tools.";
const RESOURCE_PATH = "/resources/property-management-vs-erp";
const URL_ABS = `${SITE_BASE_URL}${RESOURCE_PATH}`;
const OG_IMAGE = `${SITE_BASE_URL}/og-cover.jpg`;

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "What is the difference between property management software and a real estate ERP?",
    a: "Property management software handles day-to-day rental operations — leases, maintenance, owner statements. A real estate ERP covers the entire sales-and-development business: bookings, installment plans, payments, adjustments, commissions, legal documents, and cross-project reporting.",
  },
  {
    q: "Do property developers in Pakistan need an ERP or is property management enough?",
    a: "Developers selling units on multi-year installment plans need an ERP. Property management tools don't model booking, installment ledgers, adjustments, or the legal-document workflow that developer sales require.",
  },
  {
    q: "Can a real estate ERP handle both sales and rentals?",
    a: "Yes. A full ERP models sellable inventory and rental units, and treats leases as an optional module alongside its core sales, installment, and accounting engine.",
  },
  {
    q: "What is installment tracking in real estate ERP software?",
    a: "The ERP models each unit's full payment plan — down payment, monthly installments, balloon, possession — reconciles every payment against a term, and flags overdue clients with risk levels rather than a simple 'rent due' flag.",
  },
  {
    q: "Does Precise ERP replace QuickBooks or Xero?",
    a: "Precise ERP handles the real-estate-specific ledgers (cash, bank, adjustment, commission) and can either replace a general accounting package for a pure real-estate operator or export summarized entries to QuickBooks or Xero.",
  },
];

export const Route = createFileRoute("/resources/property-management-vs-erp")({
  component: PropertyManagementVsErp,
  head: () => ({
    ...pageSeo({
      path: RESOURCE_PATH,
      title: SEO_TITLE,
      description: SEO_DESCRIPTION,
      ogType: "article",
      imageAlt: "Property management software vs real-estate ERP comparison",
    }),
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: TITLE,
          description: SEO_DESCRIPTION,
          image: OG_IMAGE,
          author: { "@type": "Organization", name: "Precise Realtors & Builders" },
          publisher: { "@type": "Organization", name: "Precise Realtors & Builders" },
          mainEntityOfPage: URL_ABS,
          inLanguage: "en-PK",
          about: [
            { "@type": "Thing", name: "Property management software" },
            { "@type": "Thing", name: "Real estate ERP software" },
          ],
          keywords: [
            "property management software",
            "real estate ERP software",
            "installment tracking",
            "document generation",
            "real estate accounting",
          ],
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify(
          breadcrumbList([
            { name: "Home", path: "/site" },
            { name: "Resources", path: "/resources" },
            { name: TITLE, path: RESOURCE_PATH },
          ]),
        ),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQ.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }),
      },
    ],
  }),
});

export { FAQ };

function PropertyManagementVsErp() {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <article className="mx-auto max-w-3xl px-6 py-16">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted-foreground">
          <Link to="/site" className="hover:text-foreground">
            Precise ERP
          </Link>
          <span className="mx-2">/</span>
          <span>Resources</span>
          <span className="mx-2">/</span>
          <span className="text-foreground">Property Management Software vs ERP</span>
        </nav>

        <header className="mb-10 stack-tight">
          <h1>Property Management Software vs Real Estate ERP Software</h1>
          <p className="lead mt-4">
            A practical comparison for developers, builders, and real-estate operators deciding
            whether basic property management software is enough — or whether a full real estate ERP
            is the right next step for installment tracking, document generation, and accounting.
          </p>
        </header>

        <section className="prose prose-slate max-w-none">
          <h2>The short answer</h2>
          <p>
            <strong>Property management software</strong> is built for day-to-day asset and tenant
            operations: leases, maintenance tickets, owner statements, occupancy.{" "}
            <strong>Real estate ERP software</strong> covers the entire business — sales bookings,
            structured installment plans, payments and bank reconciliation, adjustments,
            commissions, legal documents, and consolidated reporting across projects.
          </p>
          <p>
            For developers selling units on multi-year installment plans (the Pakistani, Gulf, and
            South-Asian developer model in particular), a property management tool will not cover
            the most important workflows of the business. That is where a real estate ERP comes in.
          </p>

          <h2>Feature comparison</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-3 border-b border-border">Capability</th>
                  <th className="text-left p-3 border-b border-border">
                    Property Management Software
                  </th>
                  <th className="text-left p-3 border-b border-border">
                    Real Estate ERP (e.g. Precise ERP)
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    "Unit & inventory management",
                    "Yes — rental units",
                    "Yes — sellable units, blocks, projects",
                  ],
                  ["Lease & tenant management", "Core feature", "Optional / add-on"],
                  ["Sales bookings & allotments", "No", "Core feature"],
                  [
                    "Installment plan tracking",
                    "Limited",
                    "Full schedule, overdue detection, risk scoring",
                  ],
                  [
                    "Payment receipts & ledgers",
                    "Basic rent receipts",
                    "Cash, bank, adjustment, commission ledgers",
                  ],
                  [
                    "Adjustments / asset-in-kind",
                    "Not supported",
                    "Allowed vs realised tracked separately",
                  ],
                  [
                    "Legal documents",
                    "Lease templates",
                    "Allotment, possession, demand notice, agreement to sell",
                  ],
                  ["Bank reconciliation", "Limited", "Built-in"],
                  ["Commission tracking", "Rare", "Per-booking, per-dealer"],
                  ["Multi-project consolidation", "Per-property", "Cross-project KPIs & reporting"],
                  [
                    "Document vault & audit log",
                    "File uploads",
                    "Labelled, audited, notice tracking (TCS / courier)",
                  ],
                ].map(([cap, pms, erp]) => (
                  <tr key={cap} className="border-b border-border last:border-0">
                    <td className="p-3 font-medium">{cap}</td>
                    <td className="p-3 text-muted-foreground">{pms}</td>
                    <td className="p-3">{erp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>Where property management software is enough</h2>
          <ul>
            <li>
              You own a portfolio of rental properties and your revenue is rent, not unit sales.
            </li>
            <li>You need tenant communication, maintenance dispatch, and owner statements.</li>
            <li>
              Your accounting is straightforward and handled in a general-purpose package like
              QuickBooks or Xero.
            </li>
          </ul>
          <p>
            Tools in this category — Yardi Breeze, Buildium, AppFolio, DoorLoop — do this well. If
            that describes your business, you do not need an ERP.
          </p>

          <h2>Where you outgrow it</h2>
          <p>
            You outgrow property management software the moment your business is actually{" "}
            <em>selling</em> units rather than renting them, especially on installment plans. The
            workflows that break first:
          </p>
          <ul>
            <li>
              <strong>Installment tracking.</strong> A real-estate ERP models the full payment plan
              (down payment, monthly instalments, balloon, possession), reconciles every payment
              against a term, and flags overdue clients with risk levels — not just "rent due this
              month".
            </li>
            <li>
              <strong>Document generation.</strong> Allotment letters, payment plans, provisional
              and final possession letters, demand notices, transfer forms, and agreement to sell —
              generated from booking data, on letterhead, with legal clauses. Property management
              tools cover leases, not sales documents.
            </li>
            <li>
              <strong>Cash integrity.</strong> "Cash received" must exclude asset-in-kind
              adjustments; commission paid to dealers must net out of recovery numbers. Property
              management software usually doesn't model these distinctions, so the reports lie.
            </li>
            <li>
              <strong>Cross-project KPIs.</strong> Total sell value, cash recovered, adjustment
              allowed vs realised, pending balance, and current overdue — sliced by project, unit,
              client, and date range.
            </li>
          </ul>

          <h2>What to look for in a real estate ERP</h2>
          <ol>
            <li>
              Booking module with auto-calculated sold value, down payment, and installment base.
            </li>
            <li>Installment ledger that distinguishes real terms from placeholder rows.</li>
            <li>Payments module that separates cash, bank, adjustment, and commission.</li>
            <li>Document vault with labels, audit trail, and notice-delivery tracking.</li>
            <li>
              Generation of all standard legal documents from booking data, branded letterhead,
              A4-clean print output.
            </li>
            <li>Overdue dashboard with risk scoring and one-click WhatsApp reminders.</li>
            <li>Role-based access (admin, accounts, sales) backed by row-level security.</li>
          </ol>

          <h2>Conclusion</h2>
          <p>
            Property management software and real estate ERP software solve different problems. If
            you collect rent, the former is fine. If you sell units on installments, generate legal
            notices, track adjustments, and pay commissions, you need an ERP. Precise ERP is built
            around exactly that workflow.
          </p>
        </section>

        <section className="mt-16">
          <h2>Frequently asked questions</h2>
          <dl className="mt-6 space-y-6">
            {FAQ.map((f) => (
              <div key={f.q}>
                <dt className="font-semibold text-foreground">{f.q}</dt>
                <dd className="mt-2 text-muted-foreground">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <footer className="mt-12 pt-6 border-t border-border text-sm text-muted-foreground">
          Published by Precise Realtors &amp; Builders.
        </footer>
      </article>
    </main>
  );
}
