/**
 * /site/contact — luxury light-theme enquiry page with a validated
 * lead-capture form and elegant direct-contact aside.
 *
 * The form is client-only: it validates in-browser and shows a success
 * state. Wire to a `createServerFn` (Supabase / email) when the CRM is
 * ready — no visual change required.
 */
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useState, type FormEvent } from "react";
import { Phone, Mail, MapPin, Loader2, CheckCircle2, ArrowUpRight } from "lucide-react";
import { Section, Kicker } from "@/components/site/SiteChrome";
import { useStableReducedMotion } from "@/components/site/useStableReducedMotion";

import { pageSeo, breadcrumbList, SITE_BASE_URL } from "@/lib/site-seo";

const CONTACT_URL = `${SITE_BASE_URL}/site/contact`;

export const Route = createFileRoute("/site/contact")({
  head: () => ({
    ...pageSeo({
      path: "/site/contact",
      title: "Contact Precise Realtors & Builders — Islamabad",
      description:
        "Speak with Precise Realtors & Builders in Islamabad about acquisition, private sales, construction or property management.",
    }),
    scripts: [
      {
        // Reference the canonical agent entity anchored on /site instead of
        // duplicating it, so Google consolidates signals under one @id.
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "RealEstateAgent",
          "@id": `${SITE_BASE_URL}/site#agent`,
          url: CONTACT_URL,
          contactPoint: {
            "@type": "ContactPoint",
            contactType: "sales",
            areaServed: "PK",
            availableLanguage: ["en", "ur"],
          },
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify(
          breadcrumbList([
            { name: "Home", path: "/site" },
            { name: "Contact", path: "/site/contact" },
          ]),
        ),
      },
    ],
  }),

  component: ContactPage,
});

const INTERESTS: readonly string[] = [
  "Buying a residence or plot",
  "Renting a property",
  "Building a home",
  "Commercial development",
  "Property management",
  "Investment advisory",
];

function ContactPage() {
  const reduce = useStableReducedMotion();
  const [status, setStatus] = useState<"idle" | "submitting" | "sent">("idle");
  const [values, setValues] = useState({
    name: "",
    email: "",
    phone: "",
    interest: INTERESTS[0]!,
    message: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof values, string>>>({});

  function validate() {
    const e: typeof errors = {};
    if (values.name.trim().length < 2) e.name = "Please enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) e.email = "Enter a valid email address.";
    if (values.phone && values.phone.replace(/\D/g, "").length < 7)
      e.phone = "Enter a valid phone number.";
    if (values.message.trim().length < 10)
      e.message = "Tell us a little more — at least 10 characters.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (!validate()) return;
    setStatus("submitting");
    await new Promise((r) => setTimeout(r, 700));
    setStatus("sent");
  }

  return (
    <>
      <Section className="pt-10 sm:pt-16 pb-10">
        <div className="max-w-3xl stack-tight">
          <Kicker>Contact</Kicker>
          <h1>
            Begin the
            <span className="block italic text-foreground font-normal">conversation.</span>
          </h1>
          <p className="lead mt-4">
            Send a note below or call the office directly. Every enquiry receives a personal reply
            from one of our partners within one business day.
          </p>
        </div>
      </Section>

      <Section className="pb-24">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          {/* -------- form -------- */}
          <motion.div
            initial={reduce ? {} : { opacity: 0, y: 12 }}
            animate={reduce ? {} : { opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="relative overflow-hidden rounded-2xl border border-foreground/10 bg-card p-6 shadow-[0_2px_20px_-6px_rgba(18,20,26,0.08)] sm:p-10"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -top-32 -right-24 h-72 w-72 rounded-full bg-foreground/10 blur-3xl"
            />

            {status === "sent" ? (
              <div className="relative py-12 text-center">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-foreground/12 text-foreground">
                  <CheckCircle2 className="h-7 w-7" />
                </div>
                <h2 className="mt-6">Message received.</h2>
                <p className="lead mx-auto mt-3 max-w-md">
                  Thank you {values.name.split(" ")[0] || "for reaching out"} — a partner will
                  respond personally within one business day.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setStatus("idle");
                    setValues({
                      name: "",
                      email: "",
                      phone: "",
                      interest: INTERESTS[0]!,
                      message: "",
                    });
                  }}
                  className="mt-8 inline-flex items-center gap-1.5 text-[12.5px] font-semibold uppercase tracking-[0.16em] text-foreground hover:text-foreground"
                >
                  Send another
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <form onSubmit={onSubmit} noValidate className="relative grid gap-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Full name" error={errors.name}>
                    <input
                      className={fieldClass(!!errors.name)}
                      value={values.name}
                      onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
                      autoComplete="name"
                      required
                    />
                  </Field>
                  <Field label="Email" error={errors.email}>
                    <input
                      type="email"
                      className={fieldClass(!!errors.email)}
                      value={values.email}
                      onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
                      autoComplete="email"
                      required
                    />
                  </Field>
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Phone (optional)" error={errors.phone}>
                    <input
                      type="tel"
                      className={fieldClass(!!errors.phone)}
                      value={values.phone}
                      onChange={(e) => setValues((v) => ({ ...v, phone: e.target.value }))}
                      autoComplete="tel"
                      inputMode="tel"
                    />
                  </Field>
                  <Field label="I'm interested in">
                    <div className="relative">
                      <select
                        className={fieldClass(false) + " appearance-none pr-10"}
                        value={values.interest}
                        onChange={(e) => setValues((v) => ({ ...v, interest: e.target.value }))}
                      >
                        {INTERESTS.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                      <span
                        aria-hidden
                        className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/70"
                      >
                        ▾
                      </span>
                    </div>
                  </Field>
                </div>
                <Field label="Tell us about your project" error={errors.message}>
                  <textarea
                    rows={5}
                    className={fieldClass(!!errors.message) + " resize-none"}
                    value={values.message}
                    onChange={(e) => setValues((v) => ({ ...v, message: e.target.value }))}
                    placeholder="Location, budget, timeline — anything else we should know…"
                  />
                </Field>

                <div className="flex flex-col-reverse items-stretch justify-between gap-3 pt-2 sm:flex-row sm:items-center">
                  <p className="text-[12px] text-muted-foreground">
                    Your details stay with us. Reply within one business day.
                  </p>
                  <button
                    type="submit"
                    disabled={status === "submitting"}
                    className="group inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 text-[12.5px] font-semibold uppercase tracking-[0.16em] text-primary-foreground transition-all hover:-translate-y-0.5 hover:bg-primary/85 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
                  >
                    {status === "submitting" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                      </>
                    ) : (
                      <>
                        Send message{" "}
                        <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </motion.div>

          {/* -------- direct contact -------- */}
          <motion.section
            aria-labelledby="site-contact-direct-heading"
            initial={reduce ? {} : { opacity: 0, y: 12 }}
            animate={reduce ? {} : { opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 }}
            className="flex flex-col gap-6 rounded-2xl border border-foreground/10 bg-background p-6 shadow-[0_2px_10px_-4px_rgba(18,20,26,0.06)] sm:p-8"
          >
            <div className="stack-tight">
              <Kicker>Studio</Kicker>
              <h2 id="site-contact-direct-heading">Prefer to talk?</h2>
              <p className="text-muted-foreground leading-relaxed">
                Our office is open Monday to Saturday, 10am – 7pm PKT.
              </p>
            </div>

            <ul className="grid gap-1">
              <ContactRow
                icon={Phone}
                label="Call us"
                primary="+92 344 5533767"
                href="tel:+923445533767"
              />
              <ContactRow
                icon={Phone}
                label="Alt line"
                primary="+92 334 5533767"
                href="tel:+923345533767"
              />
              <ContactRow
                icon={Mail}
                label="Email"
                primary="danishhayat706@gmail.com"
                href="mailto:danishhayat706@gmail.com"
              />
              <ContactRow
                icon={MapPin}
                label="Office"
                primary="Plot #04, First Floor, Manal Arcade"
                secondary="B-1 Markaz, B-17 Islamabad"
              />
            </ul>

            <div className="mt-auto rounded-xl border border-foreground/15 bg-foreground/[0.06] p-5 text-[12.5px] leading-[1.75] text-foreground">
              <strong className="site-callout mb-1 block text-[15px] text-foreground">
                Discretion, by default.
              </strong>
              Family-office and off-market enquiries are handled by the partners directly and never
              leave the room.
            </div>
          </motion.section>
        </div>
      </Section>
    </>
  );
}

/* ---------- field primitives ---------- */

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </span>
      {children}
      {error ? <span className="mt-1.5 block text-[12px] text-destructive">{error}</span> : null}
    </label>
  );
}

function fieldClass(invalid: boolean) {
  return [
    "w-full rounded-xl border bg-card px-4 py-3 text-[14px] text-foreground placeholder:text-muted-foreground/70",
    "outline-none transition-colors",
    invalid
      ? "border-destructive/50 focus:border-destructive"
      : "border-foreground/12 focus:border-foreground/40",
    "focus:ring-4 focus:ring-foreground/12",
  ].join(" ");
}

function ContactRow({
  icon: Icon,
  label,
  primary,
  secondary,
  href,
}: {
  icon: React.ComponentType<{
    className?: string;
    "aria-hidden"?: boolean | "true" | "false";
    focusable?: boolean | "false";
  }>;
  label: string;
  primary: string;
  secondary?: string;
  href?: string;
}) {
  const accessibleName = `${label}: ${primary}${secondary ? `, ${secondary}` : ""}`;
  const content = (
    <>
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-foreground/10 bg-card text-foreground">
        <Icon className="h-4.5 w-4.5" aria-hidden="true" focusable="false" />
      </div>
      <div className="min-w-0">
        <div
          aria-hidden="true"
          className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground"
        >
          {label}
        </div>
        <div aria-hidden="true" className="mt-0.5 truncate text-[14px] font-medium text-foreground">
          {primary}
        </div>
        {secondary ? (
          <div aria-hidden="true" className="text-[12.5px] text-muted-foreground">
            {secondary}
          </div>
        ) : null}
      </div>
    </>
  );
  const cls =
    "-m-2 flex items-center gap-3 rounded-xl border border-transparent p-2 transition-colors hover:border-foreground/10 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  return (
    <li>
      {href ? (
        <a href={href} className={cls} aria-label={accessibleName}>
          {content}
        </a>
      ) : (
        <div className={cls} role="group" aria-label={accessibleName}>
          {content}
        </div>
      )}
    </li>
  );
}
