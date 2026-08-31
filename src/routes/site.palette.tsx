/**
 * /site/palette — Side-by-side light + dark palette preview.
 *
 * Renders the marketing site's semantic tokens twice: the editorial
 * (light) scope on the left, the shared `.dark` scope on the right.
 * Because the /site layout strips `.dark` from `<html>` (see
 * useForceLightThemeOnSite), we apply `.dark` on an INNER container
 * — Tailwind v4 resolves tokens via CSS custom properties, so a
 * scoped `.dark` block cascades correctly to its descendants without
 * touching the surrounding editorial theme.
 *
 * Each side shows every token pair a marketing surface actually uses
 * (background/foreground, card, muted, primary CTA, gold accent,
 * border, destructive, success) plus a live-computed WCAG ratio so
 * the user can eyeball contrast + harmony at a glance.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { pageSeo } from "@/lib/site-seo";

export const Route = createFileRoute("/site/palette")({
  head: () => ({
    ...pageSeo({
      path: "/site/palette",
      title: "Design Palette — Precise",
      description: "Visual identity and design system for Precise Realtors & Builders.",
    }),
    meta: [{ name: "robots", content: "noindex, nofollow" }],
  }),
  component: PalettePreview,
});

/** Tokens rendered on each side. Ordered so the reviewer scans
 *  canvas → ink → primary → accent → utility semantics. */
type TokenPair = {
  label: string;
  role: "surface" | "ink-on" | "primary" | "accent" | "border" | "success" | "warning" | "danger";
  /** CSS variable that supplies the FG color. */
  fgVar: string;
  /** CSS variable that supplies the BG color, or "canvas" to use --background. */
  bgVar: string;
  /** Sample copy to render in the pair. */
  sample: string;
  /** True if this pair is only expected to meet UI-component contrast (3:1). */
  uiOnly?: boolean;
};

const PAIRS: TokenPair[] = [
  {
    label: "Body text on canvas",
    role: "ink-on",
    fgVar: "--foreground",
    bgVar: "--background",
    sample: "Defining the standard for Islamabad property.",
  },
  {
    label: "Body text on card",
    role: "ink-on",
    fgVar: "--foreground",
    bgVar: "--card",
    sample: "Card body copy — 15px Inter.",
  },
  {
    label: "Muted on canvas",
    role: "ink-on",
    fgVar: "--muted-foreground",
    bgVar: "--background",
    sample: "Secondary text · 14px",
  },
  {
    label: "Muted on card",
    role: "ink-on",
    fgVar: "--muted-foreground",
    bgVar: "--card",
    sample: "Card metadata · 13px",
  },
  {
    label: "Primary CTA",
    role: "primary",
    fgVar: "--primary-foreground",
    bgVar: "--primary",
    sample: "Enquire →",
  },
  {
    label: "Gold accent",
    role: "accent",
    fgVar: "--gold",
    bgVar: "--background",
    sample: "01 — Signature Practice",
  },
  {
    label: "Hairline border",
    role: "border",
    fgVar: "--border",
    bgVar: "--background",
    sample: "1px hairline sample",
    uiOnly: true,
  },
  {
    label: "Destructive text",
    role: "danger",
    fgVar: "--destructive",
    bgVar: "--card",
    sample: "Missing field · required",
  },
  {
    label: "Success text",
    role: "success",
    fgVar: "--success",
    bgVar: "--card",
    sample: "Verified · clean title",
  },
];

// ─── WCAG helpers ────────────────────────────────────────────────
function srgbLin(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(rgb: { r: number; g: number; b: number }) {
  return 0.2126 * srgbLin(rgb.r) + 0.7152 * srgbLin(rgb.g) + 0.0722 * srgbLin(rgb.b);
}
function contrast(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
  const L1 = Math.max(luminance(a), luminance(b));
  const L2 = Math.min(luminance(a), luminance(b));
  return (L1 + 0.05) / (L2 + 0.05);
}
function verdict(ratio: number, uiOnly?: boolean) {
  if (uiOnly) {
    if (ratio >= 3) return { tier: "AA", tone: "pass" as const };
    return { tier: "Fail", tone: "fail" as const };
  }
  if (ratio >= 7) return { tier: "AAA", tone: "aaa" as const };
  if (ratio >= 4.5) return { tier: "AA", tone: "pass" as const };
  if (ratio >= 3) return { tier: "AA-large", tone: "warn" as const };
  return { tier: "Fail", tone: "fail" as const };
}

/** Parse ANY CSS color (hsl/rgb/hex/color-mix) via canvas. Runs on
 *  the client after mount so SSR stays untouched. */
function useResolvedPairs(scopeRef: React.RefObject<HTMLDivElement | null>, deps: unknown[]) {
  const [rows, setRows] = useState<
    Array<{ pair: TokenPair; fg: string; bg: string; ratio: number }>
  >([]);

  useEffect(() => {
    const el = scopeRef.current;
    if (!el) return;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const toRgb = (css: string) => {
      try {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = "rgba(0,0,0,0)";
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
      } catch {
        return null;
      }
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b };
    };
    const cs = getComputedStyle(el);
    const resolveVar = (name: string) =>
      name === "canvas"
        ? cs.getPropertyValue("--background").trim()
        : cs.getPropertyValue(name).trim();
    const next = PAIRS.map((pair) => {
      const fgCss = resolveVar(pair.fgVar);
      const bgCss = resolveVar(pair.bgVar);
      const fg = toRgb(fgCss) ?? { r: 0, g: 0, b: 0 };
      const bg = toRgb(bgCss) ?? { r: 255, g: 255, b: 255 };
      return {
        pair,
        fg: `rgb(${fg.r},${fg.g},${fg.b})`,
        bg: `rgb(${bg.r},${bg.g},${bg.b})`,
        ratio: contrast(fg, bg),
      };
    });
    setRows(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return rows;
}

function PaletteColumn({
  scope,
  title,
  subtitle,
}: {
  scope: "light" | "dark";
  title: string;
  subtitle: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rows = useResolvedPairs(ref, [scope]);

  return (
    <div
      ref={ref}
      className={`${scope === "dark" ? "dark" : ""} rounded-2xl border p-6 sm:p-8`}
      style={{ background: "var(--background)", color: "var(--foreground)" }}
    >
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <p
            className="text-[10.5px] font-semibold uppercase tracking-[0.28em]"
            style={{ color: "var(--gold)" }}
          >
            {subtitle}
          </p>
          <h2
            className="mt-2 text-3xl font-bold tracking-tight"
            style={{ letterSpacing: "-0.02em", color: "var(--foreground)" }}
          >
            {title}
          </h2>
        </div>
        <span
          className="rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em]"
          style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}
        >
          {scope}
        </span>
      </header>

      {/* Sample chrome: kicker, headline, body, muted, CTA */}
      <section className="mb-8 space-y-4 border-b pb-8" style={{ borderColor: "var(--border)" }}>
        <p
          className="text-[10.5px] font-semibold uppercase tracking-[0.28em]"
          style={{ color: "var(--gold)" }}
        >
          01 — Signature Practice
        </p>
        <h3
          className="text-4xl font-bold leading-[1.05] tracking-tight"
          style={{ letterSpacing: "-0.03em", color: "var(--foreground)" }}
        >
          Defining the <em className="font-normal italic">standard.</em>
        </h3>
        <p
          className="max-w-md text-[15px] leading-relaxed"
          style={{ color: "var(--muted-foreground)" }}
        >
          Precise Realtors &amp; Builders delivers integrated property solutions through
          professional advisory, bespoke construction and architectural mastery.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-[12px] font-bold uppercase tracking-[0.22em]"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            Enquire
          </button>
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-full border px-5 text-[12px] font-bold uppercase tracking-[0.22em]"
            style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
          >
            View portfolio
          </button>
        </div>
      </section>

      {/* Token contrast table */}
      <section>
        <h4
          className="mb-4 text-[11px] font-semibold uppercase tracking-[0.24em]"
          style={{ color: "var(--muted-foreground)" }}
        >
          Token pairs · live WCAG ratio
        </h4>
        <ul className="space-y-2 text-[13px]">
          {rows.map(({ pair, fg, bg, ratio }) => {
            const v = verdict(ratio, pair.uiOnly);
            const chipBg =
              v.tone === "aaa"
                ? "hsl(150 55% 30%)"
                : v.tone === "pass"
                  ? "hsl(150 45% 38%)"
                  : v.tone === "warn"
                    ? "hsl(35 85% 42%)"
                    : "hsl(0 70% 46%)";
            return (
              <li
                key={pair.label}
                className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border px-3 py-2.5"
                style={{ borderColor: "var(--border)", background: bg }}
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px]" style={{ color: fg }}>
                    {pair.sample}
                  </p>
                  <p
                    className="mt-0.5 truncate text-[11px]"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    {pair.label} · <span className="tabular-nums">{fg}</span> on{" "}
                    <span className="tabular-nums">{bg}</span>
                  </p>
                </div>
                <span
                  className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums text-foreground-inverse"
                  style={{ background: chipBg }} // allow-raw-color: WCAG ratio chip renders on a computed ratio-tier color (green/amber/red) that has no semantic token equivalent
                  title={
                    pair.uiOnly ? "UI component target: 3:1" : "Text target: 4.5:1 (AA), 7:1 (AAA)"
                  }
                >
                  {ratio.toFixed(2)}:1 · {v.tier}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function PalettePreview() {
  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 sm:px-6 lg:px-8">
      <header className="pb-10">
        <p
          className="text-[10.5px] font-semibold uppercase tracking-[0.28em]"
          style={{ color: "var(--gold)" }}
        >
          Design QA
        </p>
        <h1
          className="mt-3 text-4xl font-bold tracking-tight text-foreground sm:text-5xl"
          style={{ letterSpacing: "-0.03em" }}
        >
          Palette preview
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Side-by-side render of the editorial (light) and shared dark palettes. Each token pair
          carries a live WCAG contrast readout — AAA ≥ 7:1, AA ≥ 4.5:1 for body text (3:1 for large
          text and UI components).
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <PaletteColumn scope="light" title="Editorial · light" subtitle="Marketing default" />
        <PaletteColumn scope="dark" title="Site · dark" subtitle="Toggled variant" />
      </div>
    </div>
  );
}
