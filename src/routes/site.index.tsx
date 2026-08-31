/* allow-raw-color-file: hero overlays and gold hairlines use scoped editorial palette values that mirror the design-tokens defined at [data-theme="editorial"]; kept inline for LCP-critical hero to avoid an extra style pass. */
/**
 * /site — Precise Realtors & Builders (Pvt.) Ltd. — Islamabad.
 *
 * Internal and Public Marketing Showcase:
 *   - CEO / Founder: Engr. Mushtaq Ahmad
 *   - Team: Engr. Danish Hayat (Engineering & Business Operations),
 *           Saeed ullah (Sales & Client Relations)
 *   - Office: Plot #04, First Floor, Manal Arcade, B-1 Markaz, B-17
 *     Islamabad · +92 344 5533767 · mushtaq@precisegroup.pk
 *   - Core Services: Property Acquisition, Investment Advisory, Property
 *     Management, Architecture & Design, Legal Consultation, Market
 *     Research, Marketing
 *   - Signature projects: Manal Arcade (commercial, B-17), Manal Heights
 *     (residential)
 *   - Featured listings across B-17 Islamabad / MPCHS / FMC
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowUpRight, MapPin, BedDouble, Bath, Ruler, Phone, Mail } from "lucide-react";
import { Section, Kicker } from "@/components/site/SiteChrome";
import { useStableReducedMotion } from "@/components/site/useStableReducedMotion";

import heroTower from "@/assets/site/hero-tower.webp";
import projArcade from "@/assets/site/project-arcade.webp";
import projTower from "@/assets/site/project-tower.webp";
import projVilla from "@/assets/site/project-villa.webp";
import projCommercial from "@/assets/site/project-commercial.webp";
import projTownhouse from "@/assets/site/project-townhouse.webp";
import projPenthouse from "@/assets/site/project-penthouse.webp";
import manalHeightsFacade from "@/assets/site/manal-heights-facade.jpg";
import manalHeightsPoster from "@/assets/site/manal-heights-actual-poster.jpg";
import teamMushtaqAsset from "@/assets/site/team-mushtaq.jpg.asset.json";
const teamMushtaq = teamMushtaqAsset.url;
// Responsive AVIF/WebP variants for Mushtaq's headshot, cropped 4:5 from a
// 1600×2000 master and served via <picture>. Standard widths 320/480/640/800
// cover 1× rendering; 1000/1200/1600 keep the portrait crisp on 2×–3× retina
// displays (400px CSS slot × 3 = 1200) without paying the ~420 KB source-JPG
// cost until it's actually needed.
import teamMushtaq320Avif from "@/assets/site/team-mushtaq-320.avif?url";
import teamMushtaq480Avif from "@/assets/site/team-mushtaq-480.avif?url";
import teamMushtaq640Avif from "@/assets/site/team-mushtaq-640.avif?url";
import teamMushtaq800Avif from "@/assets/site/team-mushtaq-800.avif?url";
import teamMushtaq1000Avif from "@/assets/site/team-mushtaq-1000.avif?url";
import teamMushtaq1200Avif from "@/assets/site/team-mushtaq-1200.avif?url";
import teamMushtaq1600Avif from "@/assets/site/team-mushtaq-1600.avif?url";
import teamMushtaq320Webp from "@/assets/site/team-mushtaq-320.webp?url";
import teamMushtaq480Webp from "@/assets/site/team-mushtaq-480.webp?url";
import teamMushtaq640Webp from "@/assets/site/team-mushtaq-640.webp?url";
import teamMushtaq800Webp from "@/assets/site/team-mushtaq-800.webp?url";
import teamMushtaq1000Webp from "@/assets/site/team-mushtaq-1000.webp?url";
import teamMushtaq1200Webp from "@/assets/site/team-mushtaq-1200.webp?url";
import teamMushtaq1600Webp from "@/assets/site/team-mushtaq-1600.webp?url";
const teamMushtaqAvifSrcSet = `${teamMushtaq320Avif} 320w, ${teamMushtaq480Avif} 480w, ${teamMushtaq640Avif} 640w, ${teamMushtaq800Avif} 800w, ${teamMushtaq1000Avif} 1000w, ${teamMushtaq1200Avif} 1200w, ${teamMushtaq1600Avif} 1600w`;
const teamMushtaqWebpSrcSet = `${teamMushtaq320Webp} 320w, ${teamMushtaq480Webp} 480w, ${teamMushtaq640Webp} 640w, ${teamMushtaq800Webp} 800w, ${teamMushtaq1000Webp} 1000w, ${teamMushtaq1200Webp} 1200w, ${teamMushtaq1600Webp} 1600w`;
import teamDanish from "@/assets/site/team-danish.jpg";
// Responsive AVIF/WebP variants for Danish's headshot. Rebuilt from the
// 1600×2000 source across 7 widths (320…1600) with AVIF crf 32 + WebP q 72
// so the browser can pick the smallest sufficient variant at every DPR.
// Widths match Mushtaq's set to keep the SLOT_SIZES negotiation identical
// across all three leadership cards and prevent up-scaling on 3× displays.
import teamDanish320Avif from "@/assets/site/team-danish-320.avif?url";
import teamDanish480Avif from "@/assets/site/team-danish-480.avif?url";
import teamDanish640Avif from "@/assets/site/team-danish-640.avif?url";
import teamDanish800Avif from "@/assets/site/team-danish-800.avif?url";
import teamDanish1000Avif from "@/assets/site/team-danish-1000.avif?url";
import teamDanish1200Avif from "@/assets/site/team-danish-1200.avif?url";
import teamDanish1600Avif from "@/assets/site/team-danish-1600.avif?url";
import teamDanish320Webp from "@/assets/site/team-danish-320.webp?url";
import teamDanish480Webp from "@/assets/site/team-danish-480.webp?url";
import teamDanish640Webp from "@/assets/site/team-danish-640.webp?url";
import teamDanish800Webp from "@/assets/site/team-danish-800.webp?url";
import teamDanish1000Webp from "@/assets/site/team-danish-1000.webp?url";
import teamDanish1200Webp from "@/assets/site/team-danish-1200.webp?url";
import teamDanish1600Webp from "@/assets/site/team-danish-1600.webp?url";
const teamDanishAvifSrcSet = `${teamDanish320Avif} 320w, ${teamDanish480Avif} 480w, ${teamDanish640Avif} 640w, ${teamDanish800Avif} 800w, ${teamDanish1000Avif} 1000w, ${teamDanish1200Avif} 1200w, ${teamDanish1600Avif} 1600w`;
const teamDanishWebpSrcSet = `${teamDanish320Webp} 320w, ${teamDanish480Webp} 480w, ${teamDanish640Webp} 640w, ${teamDanish800Webp} 800w, ${teamDanish1000Webp} 1000w, ${teamDanish1200Webp} 1200w, ${teamDanish1600Webp} 1600w`;
import teamSaeed from "@/assets/site/team-saeed.jpg";
// Responsive AVIF/WebP variants for Saeed's headshot. Source is a 1024×1280
// editorial portrait; served via <picture> so browsers pick the smallest
// sufficient variant (AVIF ~23 KB at 800w vs 130 KB source JPG).
import teamSaeed320Avif from "@/assets/site/team-saeed-320.avif?url";
import teamSaeed480Avif from "@/assets/site/team-saeed-480.avif?url";
import teamSaeed640Avif from "@/assets/site/team-saeed-640.avif?url";
import teamSaeed800Avif from "@/assets/site/team-saeed-800.avif?url";
import teamSaeed320Webp from "@/assets/site/team-saeed-320.webp?url";
import teamSaeed480Webp from "@/assets/site/team-saeed-480.webp?url";
import teamSaeed640Webp from "@/assets/site/team-saeed-640.webp?url";
import teamSaeed800Webp from "@/assets/site/team-saeed-800.webp?url";
const teamSaeedAvifSrcSet = `${teamSaeed320Avif} 320w, ${teamSaeed480Avif} 480w, ${teamSaeed640Avif} 640w, ${teamSaeed800Avif} 800w`;
const teamSaeedWebpSrcSet = `${teamSaeed320Webp} 320w, ${teamSaeed480Webp} 480w, ${teamSaeed640Webp} 640w, ${teamSaeed800Webp} 800w`;
import { TeamHeadshot } from "@/components/site/TeamHeadshot";
import { teamLqip } from "@/assets/site/lqip";
import { useMemo, useState } from "react";
import { TeamHeadshotHealthPanel } from "@/components/site/TeamHeadshotHealthPanel";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicMarketingControls } from "@/lib/marketingControls.functions";
import { TeamModal } from "@/components/site/TeamModal";
import { ProjectDetailModal } from "@/components/site/ProjectDetailModal";
import { CinematicVideoShowcase } from "@/components/site/CinematicVideoShowcase";

import { pageSeo, breadcrumbList, SITE_BASE_URL } from "@/lib/site-seo";

const SITE_URL = `${SITE_BASE_URL}/site`;

const SEO_TITLE = "Precise Realtors & Builders — Real Estate in Islamabad";
const SEO_DESCRIPTION =
  "Trusted real estate, investment advisory, and construction in Islamabad. Led by Engr. Mushtaq Ahmad — signature projects Manal Arcade and Manal Heights.";

export const Route = createFileRoute("/site/")({
  head: () => {
    const seo = pageSeo({ path: "/site", title: SEO_TITLE, description: SEO_DESCRIPTION });
    return {
      meta: [...seo.meta, { name: "robots", content: "index, follow" }],
      links: [
        ...seo.links,
        { rel: "preload", as: "image", href: heroTower, type: "image/webp", fetchPriority: "high" },
      ],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "RealEstateAgent",
            "@id": `${SITE_URL}#agent`,
            name: "Precise Realtors & Builders",
            url: SITE_URL,
            image: `${SITE_BASE_URL}/og-cover.jpg`,
            logo: `${SITE_BASE_URL}/favicon-512.png`,
            telephone: "+92 344 5533767",
            email: "mushtaq@precisegroup.pk",
            address: {
              "@type": "PostalAddress",
              streetAddress: "Plot #04, First Floor, Manal Arcade, B-1 Markaz",
              addressLocality: "B-17 Islamabad",
              addressRegion: "Islamabad Capital Territory",
              addressCountry: "PK",
            },
            areaServed: [
              { "@type": "City", name: "Islamabad" },
              { "@type": "Country", name: "Pakistan" },
            ],
            founder: { "@type": "Person", name: "Engr. Mushtaq Ahmad" },
            knowsAbout: [
              "Property acquisition",
              "Investment advisory",
              "Property management",
              "Architecture & design",
              "Legal consultation",
              "Market research",
              "Marketing",
            ],
          }),
        },
        {
          type: "application/ld+json",
          children: JSON.stringify(breadcrumbList([{ name: "Home", path: "/site" }])),
        },
      ],
    };
  },

  component: HomePage,
});

/* ─────────────────────────── Content model ─────────────────────────── */

const SERVICES = [
  {
    title: "Property Acquisition",
    body: "Strategic identification and secure acquisition of prime real estate assets, backed by market analysis and legal due diligence.",
  },
  {
    title: "Investment Advisory",
    body: "Data-driven real estate investment guidance informed by market research and risk-aware analysis for long-term capital growth.",
  },
  {
    title: "Property Management",
    body: "Full-scale operational oversight, tenant relations and maintenance standards for residential and commercial holdings.",
  },
  {
    title: "Architecture & Design",
    body: "Functional, sustainable architectural design that balances innovation, precision and long-term usability.",
  },
  {
    title: "Legal Consultation",
    body: "Comprehensive due diligence, title verification and contract review — every transaction secured and compliant.",
  },
  {
    title: "Market Research",
    body: "Deep, data-driven insights across Islamabad's premier corridors to inform every buying, selling and investment decision.",
  },
  {
    title: "Marketing",
    body: "Targeted property marketing and digital outreach to enhance visibility and attract qualified buyers.",
  },
] as const;

type Listing = {
  name: string;
  location: string;
  price: string;
  beds: number;
  baths: number;
  areaSqft: number;
  image: string;
  badge?: string;
};

const SIGNATURE = [
  {
    name: "Manal Heights",
    kind: "Mixed-Use Tower · Shops & Luxury Suites",
    location: "NUST Service Road, H-13 Islamabad",
    year: "2026",
    image: manalHeightsPoster,
    summary:
      "Signature mixed-use development on NUST Service Road: double-height shopping atrium, corporate offices & semi-furnished luxury apartments.",
  },
  {
    name: "Manal Arcade",
    kind: "Commercial · Landmark",
    location: "B-1 Markaz, B-17 Islamabad",
    year: "2024",
    image: projArcade,
    summary:
      "A landmark commercial arcade organised around a light-filled retail spine — anchor tenants signed pre-completion.",
  },
] as const;

const LISTINGS: readonly Listing[] = [
  {
    name: "30×60 Corner House",
    location: "Block C1, B-17 Islamabad",
    price: "Price on request",
    beds: 4,
    baths: 5,
    areaSqft: 1980,
    image: projVilla,
    badge: "For Sale",
  },
  {
    name: "5 Marla Modern Corner Home",
    location: "Block F, MPCHS, B-17",
    price: "Price on request",
    beds: 3,
    baths: 4,
    areaSqft: 1125,
    image: projTownhouse,
    badge: "One unit",
  },
  {
    name: "30×60 Spanish-Style Villa",
    location: "FMC Islamabad",
    price: "Price on request",
    beds: 5,
    baths: 5,
    areaSqft: 1980,
    image: projPenthouse,
    badge: "Featured",
  },
  {
    name: "7 Marla Corner House",
    location: "B-17 Multi Gardens",
    price: "Price on request",
    beds: 4,
    baths: 4,
    areaSqft: 1580,
    image: projCommercial,
  },
  {
    name: "Luxury Home",
    location: "B-17 Islamabad",
    price: "Price on request",
    beds: 5,
    baths: 6,
    areaSqft: 2600,
    image: projArcade,
  },
  {
    name: "Brand New Corner House",
    location: "Plot 3137, B-17",
    price: "Price on request",
    beds: 4,
    baths: 4,
    areaSqft: 1780,
    image: projTower,
  },
];

/* ────────────────────────────── Component ──────────────────────────── */

function HomePage() {
  const reduce = useStableReducedMotion();
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  const fetchControls = useServerFn(getPublicMarketingControls);
  const { data: controls } = useQuery({
    queryKey: ["marketing-controls"],
    queryFn: () => fetchControls(),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const featuredListingsEnabled = Array.isArray(controls)
    ? (controls.find((c: Record<string, unknown>) => c.section_key === "featured_listings")
        ?.is_enabled ?? true)
    : true;

  const leadershipEnabled = Array.isArray(controls)
    ? (controls.find((c: Record<string, unknown>) => c.section_key === "leadership")?.is_enabled ??
      true)
    : true;

  // One-shot startup health check + on-page warning panel. HEADs every
  // AVIF/WebP/JPG URL used by the leadership grid so a CDN 404 (stale
  // asset pointer, deleted variant, cache misconfig) is surfaced in the
  // console, the `team-headshot:error` event stream, and the small
  // <TeamHeadshotHealthPanel /> rendered below (DEV + ?debug=headshots).
  const headshotGroups = useMemo(
    () => [
      {
        name: "Engr. Mushtaq Ahmad",
        fallback: teamMushtaq,
        avifSrcSet: teamMushtaqAvifSrcSet,
        webpSrcSet: teamMushtaqWebpSrcSet,
      },
      {
        name: "Engr. Danish Hayat",
        fallback: teamDanish,
        avifSrcSet: teamDanishAvifSrcSet,
        webpSrcSet: teamDanishWebpSrcSet,
      },
      {
        name: "Saeed ullah",
        fallback: teamSaeed,
        avifSrcSet: teamSaeedAvifSrcSet,
        webpSrcSet: teamSaeedWebpSrcSet,
      },
    ],
    [],
  );

  const fade = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 18 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, margin: "-80px" },
        transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
      };

  return (
    <>
      <TeamHeadshotHealthPanel groups={headshotGroups} />
      {/* ================= CINEMATIC HERO ================= */}
      <section className="relative -mt-28 min-h-[100svh] w-full overflow-hidden">
        <div aria-hidden className="absolute inset-0 z-0">
          {/* LCP candidate: paired with the `heroTower` preload in head().links.
             `loading="eager"` is set explicitly (not just left as the default)
             so a future refactor cannot silently regress LCP by adding
             `lazy` here. `fetchPriority="high"` outranks every other request
             the browser starts on first paint. Every other <img> on the
             marketing site opts into `loading="lazy"` (see audit table). */}
          <motion.img
            src={heroTower}
            alt=""
            width={1920}
            height={1200}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            className="h-full w-full object-cover"
            initial={reduce ? { scale: 1.02 } : { scale: 1.08 }}
            animate={reduce ? { scale: 1.02 } : { scale: 1.0 }}
            transition={{ duration: 18, ease: "easeOut" }}
            style={{ filter: "brightness(0.94) saturate(1.05)" }}
          />

          {/* Layered editorial scrim — porcelain wash into the fold plus
             a warm left-side gradient that lifts the display headline
             off the architectural photography. */}
          {/* allow-raw-color: hero scrim overlays warm porcelain over dark architectural photography; theme-agnostic by design */}
          <div className="absolute inset-0 bg-gradient-to-b from-white/10 via-white/40 to-[rgba(250,248,244,1)]" />
          {/* allow-raw-color: hero scrim overlays warm porcelain over dark architectural photography; theme-agnostic by design */}
          <div className="absolute inset-0 bg-gradient-to-r from-white/80 via-white/20 to-transparent" />
          {/* allow-raw-color: subtle bronze light-rake on the right edge to warm the hero */}
          <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(ellipse_at_top_right,_rgba(199,148,72,0.22),_transparent_65%)]" />
        </div>

        <div className="relative z-10 mx-auto flex min-h-[100svh] w-full max-w-7xl flex-col justify-center px-6 pt-40 pb-24 sm:px-10 sm:pt-44">
          <motion.div
            initial={reduce ? {} : { opacity: 0, y: 16 }}
            animate={reduce ? {} : { opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-4xl"
          >
            <span className="lg-pill site-kicker mb-8 text-foreground">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-[var(--gold)] shadow-[0_0_10px_rgba(201,169,97,0.9)]"
              />
              Established Excellence · Islamabad
            </span>
            <h1 className="site-h1 text-foreground">
              Defining the
              <br />
              <span className="italic text-muted-foreground">Standard.</span>
            </h1>
            <div className="mt-14 flex flex-col gap-10 md:flex-row md:items-center md:gap-14">
              <p className="site-lead max-w-md">
                Precise Realtors &amp; Builders delivers integrated property solutions through
                professional advisory, bespoke construction and architectural mastery — led by{" "}
                <span className="font-medium text-foreground">Engr. Mushtaq Ahmad</span>.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  to="/site/projects"
                  className="lg-btn-primary lg-shine text-[11px] uppercase tracking-[0.22em]"
                >
                  View Projects
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
                <Link
                  to="/site/services"
                  className="lg-btn-ghost text-[11px] uppercase tracking-[0.22em]"
                >
                  Our Services
                </Link>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ================= TRUST STRIP ================= */}
      <Section className="-mt-16 relative z-20">
        <dl className="lg-pane grid grid-cols-2 gap-y-8 gap-x-4 px-6 py-10 md:grid-cols-4 md:px-10">
          {[
            { k: "12+", v: "Years operating" },
            { k: "07", v: "Integrated services" },
            { k: "B-17", v: "Islamabad focus" },
            { k: "2", v: "Signature projects" },
          ].map((m, i) => (
            <div
              key={m.v}
              className={`px-4 text-center ${i > 0 ? "md:border-l md:border-foreground/10" : ""}`}
            >
              <dt className="site-display bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-4xl text-transparent sm:text-5xl">
                {m.k}
              </dt>
              <dd className="site-kicker mt-3 text-muted-foreground">{m.v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {/* ================= SERVICES — 01…07 hairline grid ================= */}
      <Section
        id="services"
        aria-labelledby="services-heading"
        className="pt-28 pb-24 sm:pt-32 sm:pb-28"
      >
        <div className="mb-16 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <Kicker>01 &mdash; Practice</Kicker>
            <h2 id="services-heading" className="site-h2 mt-5 text-foreground">
              Integrated property <span className="italic">solutions.</span>
            </h2>
            <p className="site-lead mt-5">
              Seven disciplines under one accountable partner — from acquisition and design to legal
              review and long-term management.
            </p>
          </div>
          <span className="site-display text-6xl text-[var(--gold)] sm:text-7xl" aria-hidden>
            07
          </span>
        </div>

        <motion.div {...fade} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICES.map((s, i) => (
            <article key={s.title} className="lg-tile group flex flex-col">
              <p className="mb-10 text-xs font-semibold tracking-[0.24em] text-[var(--gold)]">
                {String(i + 1).padStart(2, "0")} &mdash;
              </p>
              <h3 className="site-h3 mb-4 text-foreground">{s.title}</h3>
              <p className="text-sm font-light leading-relaxed text-muted-foreground">{s.body}</p>
              <div className="mt-8 h-px w-8 bg-[var(--gold)] transition-all duration-500 group-hover:w-full" />
            </article>
          ))}
        </motion.div>
      </Section>

      {/* ================= CINEMATIC 3D VIDEO & DRONE TOURS ================= */}
      <CinematicVideoShowcase onSelectProject={(id) => setSelectedProject(id)} />

      {/* ================= SIGNATURE PROJECTS ================= */}
      <Section
        id="projects"
        aria-labelledby="projects-heading"
        className="pt-16 pb-24 sm:pt-24 sm:pb-28"
      >
        <div className="mb-14 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <Kicker>02 &mdash; Signature Projects</Kicker>
            <h2 id="projects-heading" className="site-h2 mt-5 text-foreground">
              Landmarks in <span className="italic">B-17.</span>
            </h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Click any project to view architectural gallery &amp; floorplans
          </p>
        </div>

        <div className="grid gap-14 md:grid-cols-2 md:gap-10 lg:gap-16">
          {SIGNATURE.map((p, i) => {
            const projectKey = p.name.toLowerCase().includes("heights")
              ? "manal-heights"
              : p.name.toLowerCase().includes("arcade")
                ? "manal-arcade"
                : "sky-penthouse";
            return (
              <motion.article
                key={p.name}
                {...fade}
                transition={{ ...(fade.transition ?? {}), delay: i * 0.08 }}
                className="cursor-pointer group"
                onClick={() => setSelectedProject(projectKey)}
              >
                <div className="lg-media relative aspect-[4/5] bg-muted overflow-hidden">
                  <img
                    src={p.image}
                    alt={`${p.name} — ${p.kind} — ${p.location}`}
                    loading="lazy"
                    decoding="async"
                    width={800}
                    height={1000}
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.05]"
                  />
                  <span className="lg-pill absolute left-4 top-4 text-[10px] uppercase tracking-[0.24em]">
                    {p.kind.split(" · ")[0]}
                  </span>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 flex items-end p-6">
                    <span className="px-4 py-2 rounded-xl bg-card text-foreground font-semibold text-xs shadow-lg inline-flex items-center gap-2">
                      <span>Open Architectural Gallery</span>
                      <ArrowUpRight className="h-4 w-4" />
                    </span>
                  </div>
                </div>

                <div className="mt-6 flex items-start justify-between gap-6">
                  <div>
                    <p className="text-[10.5px] font-semibold uppercase tracking-[0.28em] text-[var(--gold)]">
                      {p.kind}
                    </p>
                    <h3 className="site-h3 mt-3 text-foreground group-hover:text-primary transition-colors">
                      {p.name}
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {p.location} · {p.year}
                    </p>
                  </div>
                </div>
                <p className="mt-4 max-w-md text-[15px] font-light leading-relaxed text-muted-foreground">
                  {p.summary}
                </p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedProject(projectKey);
                  }}
                  className="mt-6 inline-flex min-h-11 items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-foreground transition-colors hover:text-[var(--gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  View Details &amp; Gallery
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              </motion.article>
            );
          })}
        </div>
      </Section>

      {/* ================= FEATURED LISTINGS ================= */}
      {featuredListingsEnabled && (
        <Section
          id="listings"
          aria-labelledby="listings-heading"
          className="border-t border-foreground/[0.10] pt-20 pb-24 sm:pt-24 sm:pb-28"
        >
          <div className="mb-14 flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div className="max-w-2xl">
              <Kicker>03 &mdash; Latest Listings</Kicker>
              <h2 id="listings-heading" className="site-h2 mt-5 text-foreground">
                Curated homes, <span className="italic">clean titles.</span>
              </h2>
            </div>
            <Link
              to="/site/projects"
              className="inline-flex min-h-11 items-center gap-2 self-start text-[11px] font-bold uppercase tracking-[0.22em] text-foreground transition-colors hover:text-[var(--gold)]"
            >
              View portfolio
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {LISTINGS.map((l, i) => {
              const projectId =
                i === 0
                  ? "margalla-villa"
                  : i === 1
                    ? "faisal-hills-townhouse"
                    : i === 2
                      ? "sky-penthouse"
                      : "manal-arcade";

              return (
                <motion.article
                  key={l.name}
                  {...fade}
                  transition={{ ...(fade.transition ?? {}), delay: (i % 3) * 0.06 }}
                  className="lg-tile group flex flex-col p-4 sm:p-5 cursor-pointer"
                  onClick={() => setSelectedProject(projectId)}
                >
                  <div className="lg-media relative aspect-[4/3] bg-muted overflow-hidden">
                    <img
                      src={l.image}
                      alt={`${l.name} — ${l.location}`}
                      loading="lazy"
                      decoding="async"
                      width={800}
                      height={600}
                      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.06]"
                    />
                    {l.badge ? (
                      <span className="lg-pill absolute left-3 top-3 text-[10px] uppercase tracking-[0.22em]">
                        {l.badge}
                      </span>
                    ) : null}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 flex items-end p-4">
                      <span className="text-white text-xs font-semibold inline-flex items-center gap-1">
                        <span>Open Details</span>
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </div>
                  <div className="mt-5 px-1">
                    <h3 className="site-h3 text-foreground group-hover:text-primary transition-colors">
                      {l.name}
                    </h3>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" aria-hidden />
                      {l.location}
                    </p>
                    <div className="mt-4 flex items-center gap-5 border-t border-foreground/[0.10] pt-4 text-[12px] font-medium text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <BedDouble className="h-3.5 w-3.5" aria-hidden /> {l.beds}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Bath className="h-3.5 w-3.5" aria-hidden /> {l.baths}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Ruler className="h-3.5 w-3.5" aria-hidden /> {l.areaSqft.toLocaleString()}{" "}
                        sqft
                      </span>
                    </div>
                    <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--gold)]">
                      {l.price}
                    </p>
                  </div>
                </motion.article>
              );
            })}
          </div>
        </Section>
      )}

      {/* ================= LEADERSHIP ================= */}
      {leadershipEnabled && (
        <Section
          id="leadership"
          aria-labelledby="leadership-heading"
          className="border-t border-foreground/[0.10] pt-20 pb-24 sm:pt-24 sm:pb-28"
        >
          <div className="mb-14 max-w-2xl">
            <Kicker>04 &mdash; Leadership</Kicker>
            <h2 id="leadership-heading" className="site-h2 mt-5 text-foreground">
              Precision in every pillar.
            </h2>

            <p className="site-lead mt-5">
              Our leadership combines engineering discipline with market expertise to secure and
              grow your real estate legacy. Click any executive to view their full credentials.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                id: "mushtaq",
                name: "Engr. Mushtaq Ahmad",
                role: "Founder & CEO",
                headshot: headshotGroups[0],
                priority: true,
                objectPosition: "center 25%" as const,
              },
              {
                id: "danish",
                name: "Engr. Danish Hayat",
                role: "Head of Engineering & Ops",
                headshot: headshotGroups[1],
                priority: true,
                objectPosition: "center 28%" as const,
              },
              {
                id: "saeed",
                name: "Saeed ullah",
                role: "Head of Sales & Relations",
                headshot: headshotGroups[2],
                priority: true,
                objectPosition: "center 32%" as const,
              },
            ].map((m, i) => (
              <motion.article
                key={m.name}
                {...fade}
                transition={{ ...(fade.transition ?? {}), delay: i * 0.08 }}
                className="group cursor-pointer"
                onClick={() => setSelectedMember(m.id)}
              >
                <div className="lg-media relative aspect-[4/5] bg-muted overflow-hidden">
                  <TeamHeadshot
                    name={m.name}
                    alt={`Portrait of ${m.name}, ${m.role} at Precise Realtors & Builders`}
                    fallback={m.headshot.fallback}
                    avifSrcSet={m.headshot.avifSrcSet}
                    webpSrcSet={m.headshot.webpSrcSet}
                    lqip={teamLqip[m.name as keyof typeof teamLqip]}
                    priority={m.priority}
                    objectPosition={m.objectPosition}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 flex flex-col justify-end p-6">
                    <span className="px-3.5 py-1.5 rounded-xl bg-card text-foreground font-semibold text-xs shadow-lg inline-flex items-center gap-1.5 self-start">
                      <span>View Executive Profile</span>
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </div>

                <div className="mt-6">
                  <h3 className="site-h3 text-foreground group-hover:text-primary transition-colors">
                    {m.name}
                  </h3>
                  <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--gold)]">
                    {m.role}
                  </p>
                </div>
              </motion.article>
            ))}
          </div>
        </Section>
      )}

      {/* Team Profile Modal */}
      <TeamModal
        memberId={selectedMember}
        open={!!selectedMember}
        onOpenChange={(open) => !open && setSelectedMember(null)}
      />

      {/* Project Details Modal */}
      <ProjectDetailModal
        projectId={selectedProject}
        open={!!selectedProject}
        onOpenChange={(open) => !open && setSelectedProject(null)}
      />

      <Section className="border-t border-foreground/[0.10] pt-20 pb-24 sm:pt-24 sm:pb-28">
        <motion.div
          {...fade}
          className="grid gap-10 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:items-end md:gap-14"
        >
          <div>
            <Kicker>05 &mdash; Enquire</Kicker>
            <h2 className="site-h2 mt-5 text-foreground">
              Let's build your <span className="italic">legacy together.</span>
            </h2>
            <p className="site-lead mt-5">
              Whether you're acquiring, selling, developing or managing property in Islamabad — we
              bring engineering discipline and legal clarity to every conversation.
            </p>
          </div>
          <div className="space-y-5 text-[13.5px] text-foreground">
            <div className="flex items-start gap-3">
              <MapPin className="mt-1 h-4 w-4 shrink-0 text-[var(--gold)]" aria-hidden />
              <span>
                Plot #04, First Floor,
                <br />
                Manal Arcade, B-1 Markaz,
                <br />
                B-17 Islamabad
              </span>
            </div>
            <div className="flex items-start gap-3">
              <Phone className="mt-1 h-4 w-4 shrink-0 text-[var(--gold)]" aria-hidden />
              <a href="tel:+923445533767" className="hover:text-[var(--gold)] transition-colors">
                +92 344 5533767
              </a>
            </div>
            <div className="flex items-start gap-3">
              <Mail className="mt-1 h-4 w-4 shrink-0 text-[var(--gold)]" aria-hidden />
              <a
                href="mailto:mushtaq@precisegroup.pk"
                className="hover:text-[var(--gold)] transition-colors"
              >
                mushtaq@precisegroup.pk
              </a>
            </div>
            <Link
              to="/site/contact"
              className="lg-btn-primary lg-shine mt-4 text-[11px] uppercase tracking-[0.22em]"
            >
              Book a consultation
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </motion.div>
      </Section>
    </>
  );
}
