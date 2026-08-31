/**
 * SiteChrome — shared header + footer for the /site marketing surface.
 *
 * Palette: warm off-white with deep charcoal ink and champagne gold accents.
 * Header goes from fully transparent over the hero to a hairline-bordered
 * frosted-glass bar once the user scrolls. DM Serif Display sets the tone
 * with a serif wordmark, Inter carries navigation and body copy.
 */
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Menu, X, ArrowUpRight, Phone, Mail, MapPin, Instagram, Linkedin } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useStableReducedMotion } from "@/components/site/useStableReducedMotion";

const NAV: ReadonlyArray<{
  to: "/site" | "/site/services" | "/site/projects" | "/site/pricing" | "/site/contact";
  label: string;
  exact?: boolean;
}> = [
  { to: "/site", label: "Home", exact: true },
  { to: "/site/services", label: "Services" },
  { to: "/site/projects", label: "Portfolio" },
  { to: "/site/pricing", label: "Pricing" },
  { to: "/site/contact", label: "Contact" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll while the mobile sheet is open so it can't scroll
  // behind the panel on iOS.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 pt-3 sm:pt-5 transition-all duration-300 ${scrolled ? "sm:pt-3" : ""}`}
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 sm:px-5">
        <div
          className={`lg-nav flex flex-1 items-center gap-2 pl-3 pr-2 py-2 sm:pl-5 sm:pr-3 transition-all duration-300 ${scrolled ? "scale-[0.98]" : ""}`}
        >
          {/* Wordmark ------------------------------------------------------- */}
          <Link
            to="/site"
            className="group inline-flex min-w-0 min-h-[44px] items-center gap-2.5 rounded-full text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/60"
            aria-label="Precise Realtors & Builders — home"
          >
            <span
              aria-hidden
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-foreground"
              style={{
                background:
                  "linear-gradient(180deg, rgba(255,220,150,0.95), rgba(201,169,97,0.85))",
                boxShadow:
                  "0 1px 0 rgba(255,255,255,0.9) inset, 0 6px 16px -6px rgba(201,169,97,0.55)",
              }}
            >
              <span className="text-[15px] font-semibold italic leading-none">P</span>
            </span>
            <span className="hidden sm:flex min-w-0 flex-col leading-tight">
              <span className="truncate text-[16px] font-semibold tracking-tight">Precise</span>
              <span className="truncate text-[8.5px] font-medium uppercase tracking-[0.28em] text-muted-foreground">
                Realtors &amp; Builders
              </span>
            </span>
          </Link>

          {/* Primary nav ---------------------------------------------------- */}
          <nav aria-label="Primary" className="ml-auto hidden lg:flex items-center gap-0.5">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                activeOptions={{ exact: n.exact ?? false }}
                className="group relative inline-flex min-h-[40px] items-center justify-center rounded-full px-4 text-[13px] font-medium text-muted-foreground transition-all hover:text-foreground hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/50"
                activeProps={{
                  className: "text-foreground bg-card/70",
                  style: {
                    boxShadow:
                      "0 1px 0 rgba(255,255,255,0.9) inset, 0 4px 10px -6px rgba(24,24,27,0.2)",
                  },
                }}
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto lg:ml-2 flex items-center gap-1.5">
            <ThemeToggle />
            <Link
              to="/login"
              className="group inline-flex min-h-[40px] items-center justify-center rounded-full px-4 text-[13px] font-medium text-muted-foreground transition-all hover:text-foreground hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/50"
            >
              Sign In
            </Link>
            <Link
              to="/site/contact"
              className="lg-btn-primary lg-shine hidden lg:inline-flex text-[11px] uppercase tracking-[0.18em] py-2.5 px-5"
            >
              Enquire
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>

            {/* Mobile/tablet toggle -------------------------------------------- */}
            <button
              type="button"
              aria-expanded={open}
              aria-controls="site-mobile-nav"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((v) => !v)}
              className="lg:hidden grid h-11 w-11 place-items-center rounded-full border border-foreground/12 bg-card/70 text-foreground backdrop-blur transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/50"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {open ? <MobileSheet onClose={() => setOpen(false)} /> : null}
      </AnimatePresence>
    </header>
  );
}

function MobileSheet({ onClose }: { onClose: () => void }) {
  const reduce = useStableReducedMotion();
  const sheetRef = useRef<HTMLDivElement | null>(null);

  // Escape closes the sheet. Registered on `window` so the handler fires
  // regardless of which focusable currently owns the caret — including
  // the trigger button (which lives outside the sheet).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // On open: move focus into the sheet so screen readers announce the
  // dialog contents and Tab starts inside. On close (unmount), restore
  // focus to the trigger button so keyboard users don't get dumped on
  // <body> after Escape — WCAG 2.4.3 focus-order compliance.
  useEffect(() => {
    const triggerBefore = document.activeElement as HTMLElement | null;
    const first = sheetRef.current?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
    return () => {
      // Prefer the recorded trigger; fall back to the aria-controls owner
      // in case the tree re-keyed during the sheet's lifetime.
      const fallback = document.querySelector<HTMLElement>('[aria-controls="site-mobile-nav"]');
      (triggerBefore ?? fallback)?.focus();
    };
  }, []);

  // Focus trap: cycle Tab / Shift+Tab within the sheet. Uses key capture on
  // the container instead of sentinel nodes so keyboard behaviour degrades
  // to native tab order if this handler ever fails to attach.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const container = sheetRef.current;
    if (!container) return;
    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <motion.div
      ref={sheetRef}
      id="site-mobile-nav"
      role="dialog"
      aria-modal="true"
      aria-label="Site navigation"
      onKeyDown={onKeyDown}
      className="lg:hidden fixed inset-x-0 top-24 z-40 mx-3 mt-2 rounded-2xl border border-foreground/10 bg-card/95 backdrop-blur-xl shadow-[0_30px_60px_-30px_rgba(18,20,26,0.35)]"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.95 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      <ul className="flex flex-col p-2">
        {NAV.map((n, i) => (
          <li key={n.to}>
            <Link
              to={n.to}
              onClick={onClose}
              activeOptions={{ exact: n.exact ?? false }}
              className="flex items-center justify-between rounded-xl px-4 py-3.5 text-[15px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              activeProps={{ className: "bg-muted text-foreground" }}
            >
              <span>{n.label}</span>
              <span aria-hidden className="text-foreground text-[11px] tracking-widest">
                0{i + 1}
              </span>
            </Link>
          </li>
        ))}
        <li className="mt-2 border-t border-foreground/10 pt-2">
          <Link
            to="/site/contact"
            onClick={onClose}
            className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-[13px] font-medium uppercase tracking-[0.18em] text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            Enquire
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </li>
      </ul>
    </motion.div>
  );
}

export function SiteFooter() {
  return (
    <footer className="relative border-t border-foreground/[0.08] bg-card text-muted-foreground">
      <div className="mx-auto max-w-7xl px-5 sm:px-10 pt-16 pb-10 grid gap-12 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <div className="inline-flex items-center gap-3 text-foreground">
            <span
              aria-hidden
              className="grid h-11 w-11 place-items-center rounded-full border border-foreground/25 bg-card text-foreground"
            >
              <span className="text-[17px] font-semibold italic leading-none">P</span>
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-[18px] font-semibold tracking-tight">Precise</span>
              <span className="text-[9.5px] font-medium uppercase tracking-[0.28em] text-muted-foreground">
                Realtors &amp; Builders
              </span>
            </span>
          </div>
          <p className="mt-5 max-w-md text-[13.5px] leading-relaxed text-muted-foreground">
            Precision. Trust. Craft. Real estate advisory, construction, architecture and property
            management — delivered in Islamabad with the discipline of an engineering firm.
          </p>
          <div className="mt-6 flex items-center gap-2">
            <a
              href="https://www.instagram.com/precisegroup.pk"
              target="_blank"
              aria-label="Follow Precise Realtors & Builders on Instagram"
              rel="noopener noreferrer"
              className="grid h-12 w-12 place-items-center rounded-full border border-foreground/12 text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Instagram className="h-4 w-4" aria-hidden="true" focusable="false" />
              <span className="sr-only">Instagram</span>
            </a>
            <a
              href="#"
              aria-label="Connect with Precise Realtors & Builders on LinkedIn"
              rel="noopener noreferrer"
              className="grid h-12 w-12 place-items-center rounded-full border border-foreground/12 text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Linkedin className="h-4 w-4" aria-hidden="true" focusable="false" />
              <span className="sr-only">LinkedIn</span>
            </a>
          </div>
        </div>
        <div>
          <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-muted-foreground mb-4">
            Explore
          </h4>
          <ul className="space-y-1 text-[13.5px]">
            {NAV.map((n) => (
              <li key={n.to}>
                <Link
                  to={n.to}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center rounded-sm px-2 py-2.5 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-muted-foreground mb-4">
            Studio
          </h4>
          <address className="not-italic space-y-2.5 text-[13.5px]">
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 mt-0.5 text-foreground shrink-0" />
              <span>
                Plot #04, First Floor,
                <br />
                Manal Arcade, B-1 Markaz,
                <br />
                B-17 Islamabad
              </span>
            </div>
            <div className="flex items-start gap-2">
              <Phone className="h-4 w-4 mt-0.5 text-foreground shrink-0" />
              <a
                href="tel:+923445533767"
                className="inline-flex min-h-12 items-center rounded-sm py-2 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                +92 344 5533767
              </a>
            </div>
            <div className="flex items-start gap-2">
              <Mail className="h-4 w-4 mt-0.5 text-foreground shrink-0" />
              <a
                href="mailto:mushtaq@precisegroup.pk"
                className="inline-flex min-h-12 items-center rounded-sm py-2 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                mushtaq@precisegroup.pk
              </a>
            </div>
          </address>
        </div>
        <div>
          <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-muted-foreground mb-4">
            Studio hours
          </h4>
          <ul className="space-y-2.5 text-[13.5px]">
            <li className="flex items-baseline justify-between gap-4">
              <span>Mon &ndash; Fri</span>
              <span className="tabular-nums text-muted-foreground">09:00 &ndash; 19:00</span>
            </li>
            <li className="flex items-baseline justify-between gap-4">
              <span>Saturday</span>
              <span className="tabular-nums text-muted-foreground">10:00 &ndash; 15:00</span>
            </li>
            <li className="flex items-baseline justify-between gap-4">
              <span>Sunday</span>
              <span className="text-muted-foreground">By appointment</span>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-foreground/[0.08]">
        <div className="mx-auto max-w-7xl px-5 sm:px-10 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
          <span>
            © {new Date().getFullYear()} Precise Realtors &amp; Builders. All rights reserved.
          </span>
          <span className="tracking-[0.2em] uppercase">Precision · Trust · Craft</span>
        </div>
      </div>
    </footer>
  );
}

/** Section wrapper — consistent max width + generous vertical rhythm. */
export function Section({
  children,
  className = "",
  as: As = "section",
  id,
  "aria-labelledby": labelledBy,
}: {
  children: React.ReactNode;
  className?: string;
  as?: keyof HTMLElementTagNameMap;
  id?: string;
  "aria-labelledby"?: string;
}) {
  const Cmp = As as React.ElementType;
  return (
    <Cmp
      id={id}
      aria-labelledby={labelledBy}
      className={`mx-auto max-w-7xl px-5 sm:px-10 ${className}`}
    >
      {children}
    </Cmp>
  );
}

/** Small kicker label above section headings — champagne accent + hairline. */
export function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span className="site-kicker inline-flex items-center gap-2.5 text-foreground">
      <span aria-hidden className="h-px w-8 bg-foreground" />
      {children}
    </span>
  );
}
