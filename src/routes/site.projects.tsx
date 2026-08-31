/* allow-raw-color-file: overlays white text/borders on dark hero photography; theme-agnostic by design */
/**
 * /site/projects — full portfolio grid with category + budget + bed filters.
 *
 * Every project uses a real high-resolution photograph (bundled asset,
 * Vite-hashed) rather than a generated gradient — this page's job is to
 * showcase architectural craft, so the imagery is the product.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import { ArrowUpRight, BedDouble, Bath, Ruler, MapPin, Search } from "lucide-react";
import { Section, Kicker } from "@/components/site/SiteChrome";
import { useStableReducedMotion } from "@/components/site/useStableReducedMotion";

import projVilla from "@/assets/site/project-villa.webp";
import projTower from "@/assets/site/project-tower.webp";
import projCommercial from "@/assets/site/project-commercial.webp";
import projTownhouse from "@/assets/site/project-townhouse.webp";
import projPenthouse from "@/assets/site/project-penthouse.webp";
import projBoutique from "@/assets/site/project-boutique.webp";
import projArcade from "@/assets/site/project-arcade.webp";
import luxuryVillaMargalla from "@/assets/site/luxury-villa-margalla.jpg";
import commercialTowerNexus from "@/assets/site/commercial-tower-nexus.jpg";
import luxuryPenthouseSky from "@/assets/site/luxury-penthouse-sky.jpg";
import manalHeightsFacade from "@/assets/site/manal-heights-facade.jpg";
import { ProjectDetailModal } from "@/components/site/ProjectDetailModal";

import { pageSeo, breadcrumbList } from "@/lib/site-seo";

export const Route = createFileRoute("/site/projects")({
  head: () => ({
    // projVilla is a Vite-bundled relative asset URL; social crawlers require
    // absolute URLs, so pageSeo falls back to the site-wide og-cover. Swap in
    // an absolute portfolio hero URL when one's hosted at a stable path.
    ...pageSeo({
      path: "/site/projects",
      title: "Portfolio: Luxury Residences & Developments — Precise",
      description:
        "Curated luxury villas, penthouses, residences and commercial developments in Islamabad and Pakistan's premier addresses.",
      imageAlt: "Precise Realtors & Builders — luxury villa and residence portfolio",
    }),
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify(
          breadcrumbList([
            { name: "Home", path: "/site" },
            { name: "Portfolio", path: "/site/projects" },
          ]),
        ),
      },
    ],
  }),

  component: ProjectsPage,
});

type Category = "All" | "Residences" | "Villas" | "Penthouses" | "Commercial" | "Mixed-Use";
type Budget = "Any" | "Under 5 Cr" | "5 – 10 Cr" | "10 Cr +";

type Project = {
  id: string;
  name: string;
  location: string;
  category: Exclude<Category, "All">;
  year: string;
  price: string;
  priceValueCr: number | null; // null = on request
  beds: number;
  baths: number;
  areaSqft: number;
  image: string;
  summary: string;
};

const PROJECTS: readonly Project[] = [
  {
    id: "manal-heights",
    name: "Manal Heights — H-13 Islamabad",
    location: "NUST Service Road, H-13 Islamabad",
    category: "Mixed-Use",
    year: "2026",
    price: "PKR 95 Lacs – 2.85 Cr",
    priceValueCr: 1.85,
    beds: 2,
    baths: 2,
    areaSqft: 1850,
    image: manalHeightsFacade,
    summary:
      "Prime investment mixed-use tower on NUST Service Road: semi-furnished luxury apartments, shopping atrium & corporate offices with high ROI and student/faculty rental yields.",
  },
  {
    id: "manal-arcade",
    name: "Manal Arcade & Commercial Hub",
    location: "B-1 Markaz, B-17 Islamabad",
    category: "Commercial",
    year: "2024",
    price: "PKR 1.85 Cr – 6.5 Cr",
    priceValueCr: 4.5,
    beds: 0,
    baths: 0,
    areaSqft: 24500,
    image: commercialTowerNexus,
    summary:
      "Landmark commercial arcade organised around a light-filled retail spine. Anchor tenants signed pre-completion with high rental yields.",
  },
  {
    id: "sky-penthouse",
    name: "The Sky Penthouse Collection",
    location: "Sector B-17 Luxury Heights",
    category: "Penthouses",
    year: "2026",
    price: "PKR 3.45 Cr – 5.20 Cr",
    priceValueCr: 4.2,
    beds: 4,
    baths: 5,
    areaSqft: 3800,
    image: luxuryPenthouseSky,
    summary:
      "Duplex high-altitude observation penthouses with 20ft double-height living salons, private elevators, and panoramic Margalla mountain vistas.",
  },
  {
    id: "margalla-villa",
    name: "Margalla Hills Signature Villa",
    location: "Block B, Multi Gardens B-17",
    category: "Villas",
    year: "2024",
    price: "PKR 7.85 Cr",
    priceValueCr: 7.85,
    beds: 5,
    baths: 6,
    areaSqft: 4500,
    image: luxuryVillaMargalla,
    summary:
      "Ultra-modern 1-Kanal designer residence with infinity plunge pool, Italian marble flooring, and panoramic sunset Margalla views.",
  },
  {
    id: "faisal-hills-townhouse",
    name: "Executive Designer Townhouse",
    location: "Executive Block, Faisal Hills",
    category: "Residences",
    year: "2024",
    price: "PKR 3.95 Cr",
    priceValueCr: 3.95,
    beds: 4,
    baths: 5,
    areaSqft: 2700,
    image: projTownhouse,
    summary:
      "Limited availability 10-Marla luxury modern family home with internal daylight courtyard, rooftop lounge, and covered garage.",
  },
  {
    id: "spanish-villa",
    name: "30×60 Spanish-Style Villa",
    location: "FMC Islamabad",
    category: "Villas",
    year: "2024",
    price: "PKR 4.60 Cr",
    priceValueCr: 4.6,
    beds: 5,
    baths: 5,
    areaSqft: 1980,
    image: projPenthouse,
    summary:
      "Elite Spanish-style luxury home in FMC — where architectural style meets structural substance.",
  },
  {
    id: "multi-gardens-corner",
    name: "7 Marla Corner House",
    location: "B-17 Multi Gardens",
    category: "Residences",
    year: "2023",
    price: "Price on request",
    priceValueCr: null,
    beds: 4,
    baths: 4,
    areaSqft: 1580,
    image: projCommercial,
    summary:
      "Double-storey designer home in one of Islamabad's most in-demand sectors — B-17 Multi Gardens.",
  },
  {
    id: "luxury-estate-b17",
    name: "Luxury Designer Estate",
    location: "B-17 Islamabad",
    category: "Residences",
    year: "2024",
    price: "Price on request",
    priceValueCr: null,
    beds: 5,
    baths: 6,
    areaSqft: 2600,
    image: projBoutique,
    summary:
      "A bold statement of status — commanding elevation with the finest interior finishes throughout.",
  },
  {
    id: "modern-corner-villa",
    name: "Brand New Corner House",
    location: "Plot 3137, Block F, B-17",
    category: "Residences",
    year: "2024",
    price: "Price on request",
    priceValueCr: null,
    beds: 4,
    baths: 4,
    areaSqft: 1780,
    image: projArcade,
    summary:
      "Presented by Precise Realtors & Builders — a prime 30×60 corner property with modern architectural finish.",
  },
] as const;

const CATEGORIES: readonly Category[] = [
  "All",
  "Residences",
  "Villas",
  "Penthouses",
  "Commercial",
  "Mixed-Use",
] as const;
const BUDGETS: readonly Budget[] = ["Any", "Under 5 Cr", "5 – 10 Cr", "10 Cr +"] as const;

function priceMatches(p: Project, b: Budget): boolean {
  if (b === "Any") return true;
  if (p.priceValueCr === null) return false;
  if (b === "Under 5 Cr") return p.priceValueCr < 5;
  if (b === "5 – 10 Cr") return p.priceValueCr >= 5 && p.priceValueCr <= 10;
  return p.priceValueCr > 10;
}

function ProjectsPage() {
  const reduce = useStableReducedMotion();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [cat, setCat] = useState<Category>("All");
  const [budget, setBudget] = useState<Budget>("Any");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PROJECTS.filter((p) => {
      if (cat !== "All" && p.category !== cat) return false;
      if (!priceMatches(p, budget)) return false;
      if (q && !`${p.name} ${p.location}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [cat, budget, query]);

  return (
    <>
      <Section className="pt-10 sm:pt-16 pb-12">
        <div className="max-w-3xl stack-tight">
          <Kicker>Portfolio</Kicker>
          <h1>
            Places worth
            <span className="block italic text-foreground font-normal">arriving at.</span>
          </h1>
          <p className="lead mt-4">
            A cross-section of our currently represented residences, villas, penthouses and
            commercial developments. Click any project to open detailed floorplans, specs, and
            gallery.
          </p>
        </div>
      </Section>

      {/* -------------------- Filter bar -------------------- */}
      <Section className="pb-8">
        <div className="grid gap-4 rounded-2xl border border-foreground/10 bg-card/85 p-4 backdrop-blur-md shadow-[0_2px_10px_-4px_rgba(18,20,26,0.06)] md:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label className="relative flex items-center">
            <Search
              className="pointer-events-none absolute left-4 h-4 w-4 text-muted-foreground/70"
              aria-hidden
            />
            <input
              type="search"
              inputMode="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or address"
              aria-label="Search projects"
              className="h-12 w-full rounded-full border border-foreground/10 bg-card pl-11 pr-4 text-[13.5px] text-foreground placeholder:text-muted-foreground/70 focus:border-foreground/40 focus:outline-none focus:ring-2 focus:ring-foreground/20"
            />
          </label>
          <FilterGroup label="Category" value={cat} options={CATEGORIES} onChange={setCat} />
          <FilterGroup label="Budget" value={budget} options={BUDGETS} onChange={setBudget} />
        </div>
        <p className="mt-4 text-[12px] uppercase tracking-[0.22em] text-muted-foreground">
          {visible.length} of {PROJECTS.length} shown · Click any card to view architectural details
        </p>
      </Section>

      {/* -------------------- Grid -------------------- */}
      <Section className="pb-24">
        <h2 className="sr-only">Current developments</h2>
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {visible.map((p, i) => (
              <motion.li
                key={p.name}
                layout
                initial={reduce ? {} : { opacity: 0, y: 16 }}
                animate={reduce ? {} : { opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                transition={{ duration: 0.5, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
                onClick={() => setSelectedProject(p.id)}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-card shadow-[0_2px_10px_-4px_rgba(18,20,26,0.08)] transition-all duration-500 hover:-translate-y-1 hover:border-foreground/25 hover:shadow-[0_30px_60px_-30px_rgba(18,20,26,0.35)] cursor-pointer"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-brand-ink">
                  <img
                    src={p.image}
                    alt={`${p.name} — ${p.location}`}
                    width={1200}
                    height={900}
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.05]"
                  />
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-gradient-to-t from-brand-ink/70 via-brand-ink/10 to-transparent"
                  />
                  <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-card/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white backdrop-blur-md">
                    {" "}
                    {/* allow-raw-color: overlays white text/borders on dark hero photography; theme-agnostic by design */}
                    {p.category}
                  </span>
                  <span className="absolute right-4 top-4 rounded-full border border-white/25 bg-card/10 px-2.5 py-1 text-[10.5px] font-medium tabular-nums text-white backdrop-blur-md">
                    {" "}
                    {/* allow-raw-color: overlays white text/borders on dark hero photography; theme-agnostic by design */}
                    {p.year}
                  </span>
                  <div className="absolute inset-x-4 bottom-4 text-white">
                    {" "}
                    {/* allow-raw-color: overlays white text/borders on dark hero photography; theme-agnostic by design */}
                    <h3 className="text-lg font-semibold leading-tight tracking-tight text-white group-hover:text-amber-300 transition-colors">
                      {" "}
                      {/* allow-raw-color: overlays white text/borders on dark hero photography; theme-agnostic by design */}
                      {p.name}
                    </h3>
                    <p className="mt-1 inline-flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.18em] text-white/80">
                      {" "}
                      {/* allow-raw-color: overlays white text/borders on dark hero photography; theme-agnostic by design */}
                      <MapPin className="h-3 w-3" /> {p.location}
                    </p>
                  </div>
                </div>

                <div className="flex flex-1 flex-col gap-4 p-5">
                  <p className="text-[13.5px] leading-[1.75] text-muted-foreground">{p.summary}</p>
                  <div className="mt-auto flex items-center justify-between gap-4 border-t border-foreground/8 pt-4 text-[12.5px] text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                      {p.beds > 0 ? (
                        <span className="inline-flex items-center gap-1.5">
                          <BedDouble className="h-3.5 w-3.5 text-foreground" /> {p.beds}
                        </span>
                      ) : null}
                      {p.baths > 0 ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Bath className="h-3.5 w-3.5 text-foreground" /> {p.baths}
                        </span>
                      ) : null}
                      <span className="inline-flex items-center gap-1.5 tabular-nums">
                        <Ruler className="h-3.5 w-3.5 text-foreground" />{" "}
                        {p.areaSqft.toLocaleString()} sqft
                      </span>
                    </div>
                    <span className="font-[DM_Serif_Display] text-[15px] italic text-foreground">
                      {p.price}
                    </span>
                  </div>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>

        {/* Project Details Modal */}
        <ProjectDetailModal
          projectId={selectedProject}
          open={!!selectedProject}
          onOpenChange={(open) => !open && setSelectedProject(null)}
        />

        {visible.length === 0 ? (
          <div className="mt-16 rounded-2xl border border-dashed border-foreground/15 bg-card/60 p-10 text-center">
            <p className="text-2xl italic text-foreground">Nothing matches those filters — yet.</p>
            <p className="mt-2 text-muted-foreground">
              Reset a filter, or tell us what you're looking for and we'll source it.
            </p>
            <button
              type="button"
              onClick={() => {
                setCat("All");
                setBudget("Any");
                setQuery("");
              }}
              className="mt-6 inline-flex items-center gap-2 rounded-full border border-foreground/15 bg-card px-5 py-2.5 text-[12px] font-semibold uppercase tracking-[0.16em] text-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
            >
              Reset filters
            </button>
          </div>
        ) : null}

        <div className="mt-16 text-center">
          <Link
            to="/site/contact"
            className="group inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3.5 text-[12.5px] font-semibold uppercase tracking-[0.16em] text-primary-foreground transition-all hover:-translate-y-0.5 hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Request a private tour
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>
      </Section>
    </>
  );
}

function FilterGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="hidden text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground sm:inline">
        {label}
      </span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          aria-label={label}
          className="h-12 appearance-none rounded-full border border-foreground/10 bg-card pl-4 pr-9 text-[13px] font-medium text-foreground focus:border-foreground/40 focus:outline-none focus:ring-2 focus:ring-foreground/20"
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <span
          aria-hidden
          className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/70"
        >
          ▾
        </span>
      </div>
    </label>
  );
}
