import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Check, Copy, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/token-reference")({
  head: () => ({
    meta: [
      { title: "Design Token Reference" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "googlebot", content: "noindex, nofollow" },
      {
        name: "description",
        content:
          "Visual reference for every design token in the system with click-to-copy CSS variable names.",
      },
    ],
  }),
  component: TokenReference,
});

type ColorToken = {
  name: string;
  usage: string;
  /** Text token paired with this surface for on-surface preview. */
  pairFg?: string;
};
type SizeToken = { name: string; usage: string; kind: "radius" | "space" | "text" };

const surfaces: ColorToken[] = [
  { name: "background", usage: "App canvas", pairFg: "foreground" },
  { name: "foreground", usage: "Body text on canvas" },
  { name: "card", usage: "Card surface", pairFg: "card-foreground" },
  { name: "card-foreground", usage: "Text on cards" },
  { name: "popover", usage: "Menus, tooltips", pairFg: "popover-foreground" },
  { name: "popover-foreground", usage: "Text in popovers" },
  { name: "muted", usage: "Subtle fill", pairFg: "muted-foreground" },
  { name: "muted-foreground", usage: "Secondary text, axis labels" },
];

const brand: ColorToken[] = [
  { name: "primary", usage: "Primary CTA fill", pairFg: "primary-foreground" },
  { name: "primary-foreground", usage: "Text on primary" },
  { name: "secondary", usage: "Secondary fill", pairFg: "secondary-foreground" },
  { name: "secondary-foreground", usage: "Text on secondary" },
  { name: "accent", usage: "Hover / soft accent", pairFg: "accent-foreground" },
  { name: "accent-foreground", usage: "Text on accent" },
  { name: "gold", usage: "Editorial highlight", pairFg: "gold-foreground" },
  { name: "adjustment", usage: "Mid-tone accent", pairFg: "adjustment-foreground" },
];

const semantic: ColorToken[] = [
  { name: "destructive", usage: "Errors, destructive actions", pairFg: "destructive-foreground" },
  { name: "success", usage: "Confirmations, positive states", pairFg: "success-foreground" },
  { name: "warning", usage: "Cautions, pending states", pairFg: "warning-foreground" },
  { name: "info", usage: "Neutral informational states", pairFg: "info-foreground" },
];

const structure: ColorToken[] = [
  { name: "border", usage: "Component borders (Radix, inputs)" },
  { name: "input", usage: "Input borders" },
  { name: "ring", usage: "Focus ring, reference lines" },
  { name: "hairline", usage: "Card / table separators, chart gridlines" },
  { name: "hairline-strong", usage: "Emphasized separators, chart cursors" },
];

const charts: ColorToken[] = [
  { name: "chart-1", usage: "Series 1 · deep navy" },
  { name: "chart-2", usage: "Series 2 · navy hero" },
  { name: "chart-3", usage: "Series 3 · steel-blue accent" },
  { name: "chart-4", usage: "Series 4 · mist steel" },
  { name: "chart-5", usage: "Series 5 · pale mist" },
];

const sidebar: ColorToken[] = [
  { name: "sidebar", usage: "Sidebar surface", pairFg: "sidebar-foreground" },
  { name: "sidebar-foreground", usage: "Sidebar labels" },
  { name: "sidebar-primary", usage: "Sidebar active fill", pairFg: "sidebar-primary-foreground" },
  { name: "sidebar-accent", usage: "Sidebar hover tint", pairFg: "sidebar-accent-foreground" },
  { name: "sidebar-border", usage: "Sidebar dividers" },
  { name: "sidebar-ring", usage: "Sidebar focus ring" },
];

const radii: SizeToken[] = [
  { name: "radius-xs", usage: "Chips, tight controls", kind: "radius" },
  { name: "radius-sm", usage: "Inputs, small buttons", kind: "radius" },
  { name: "radius-md", usage: "Default cards", kind: "radius" },
  { name: "radius-lg", usage: "Panels, dialogs", kind: "radius" },
  { name: "radius-xl", usage: "Feature cards", kind: "radius" },
  { name: "radius-2xl", usage: "Hero surfaces", kind: "radius" },
  { name: "radius-3xl", usage: "Marketing sections", kind: "radius" },
  { name: "radius-full", usage: "Pills, avatars", kind: "radius" },
];

const spacing: SizeToken[] = [
  { name: "space-1", usage: "4px", kind: "space" },
  { name: "space-2", usage: "8px", kind: "space" },
  { name: "space-3", usage: "12px", kind: "space" },
  { name: "space-4", usage: "16px", kind: "space" },
  { name: "space-6", usage: "24px", kind: "space" },
  { name: "space-8", usage: "32px", kind: "space" },
  { name: "space-12", usage: "48px", kind: "space" },
  { name: "space-16", usage: "64px", kind: "space" },
];

const text: SizeToken[] = [
  { name: "text-2xs", usage: "Labels, kbd", kind: "text" },
  { name: "text-xs", usage: "Meta, captions", kind: "text" },
  { name: "text-sm", usage: "Secondary body", kind: "text" },
  { name: "text-base", usage: "Body copy", kind: "text" },
  { name: "text-lg", usage: "Subheads", kind: "text" },
  { name: "text-xl", usage: "Section titles", kind: "text" },
  { name: "text-2xl", usage: "Card headers", kind: "text" },
  { name: "text-3xl", usage: "Page titles", kind: "text" },
  { name: "text-4xl", usage: "Hero headings", kind: "text" },
];

function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${value}`}
      className="group inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-[11px] text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span>{value}</span>
      {copied ? (
        <Check className="size-3 text-success" />
      ) : (
        <Copy className="size-3 text-muted-foreground group-hover:text-accent-foreground" />
      )}
    </button>
  );
}

function ColorSwatch({ token }: { token: ColorToken }) {
  const cssVar = `var(--${token.name})`;
  const fgVar = token.pairFg ? `var(--${token.pairFg})` : "var(--foreground)";
  const isFgToken = token.name.endsWith("foreground");

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div
        className="flex h-20 items-center justify-center px-3 text-sm font-medium"
        style={{
          background: isFgToken ? "var(--card)" : cssVar,
          color: isFgToken ? cssVar : fgVar,
        }}
      >
        {isFgToken ? "Aa · text sample" : "Aa"}
      </div>
      <div className="space-y-2 p-3">
        <div className="text-xs text-muted-foreground">{token.usage}</div>
        <div className="flex flex-wrap gap-1.5">
          <CopyChip value={`--${token.name}`} />
          <CopyChip value={`var(--${token.name})`} />
        </div>
      </div>
    </div>
  );
}

function SizeRow({ token }: { token: SizeToken }) {
  const cssVar = `var(--${token.name})`;
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-3">
      <div className="flex-1">
        <div className="text-sm font-medium">--{token.name}</div>
        <div className="text-xs text-muted-foreground">{token.usage}</div>
      </div>
      <div className="flex min-w-[120px] items-center justify-center">
        {token.kind === "radius" && (
          <div
            className="size-14 border border-border bg-primary/15"
            style={{ borderRadius: cssVar }}
          />
        )}
        {token.kind === "space" && (
          <div className="h-3 rounded-sm bg-primary/70" style={{ width: cssVar }} />
        )}
        {token.kind === "text" && (
          <span className="font-semibold text-foreground" style={{ fontSize: cssVar }}>
            Ag
          </span>
        )}
      </div>
      <CopyChip value={`var(--${token.name})`} />
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function filterTokens<T extends { name: string; usage: string }>(list: T[], q: string): T[] {
  if (!q.trim()) return list;
  const needle = q.trim().toLowerCase();
  return list.filter(
    (t) => t.name.toLowerCase().includes(needle) || t.usage.toLowerCase().includes(needle),
  );
}

function TokenReference() {
  const [q, setQ] = useState("");
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );

  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    setDark(next);
  };

  const sections = useMemo(
    () => ({
      surfaces: filterTokens(surfaces, q),
      brand: filterTokens(brand, q),
      semantic: filterTokens(semantic, q),
      structure: filterTokens(structure, q),
      charts: filterTokens(charts, q),
      sidebar: filterTokens(sidebar, q),
      radii: filterTokens(radii, q),
      spacing: filterTokens(spacing, q),
      text: filterTokens(text, q),
    }),
    [q],
  );

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4 md:px-6">
          <div className="mr-auto">
            <h1 className="text-lg font-semibold">Design Token Reference</h1>
            <p className="text-xs text-muted-foreground">
              Click any chip to copy the CSS variable.
            </p>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter tokens…"
              className="w-56 pl-8"
              aria-label="Filter tokens"
            />
          </div>
          <Button size="sm" variant="outline" onClick={toggle}>
            {dark ? "Light preview" : "Dark preview"}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6">
        <Section
          title="Surfaces"
          description="Canvas and container fills paired with their text tokens."
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {sections.surfaces.map((t) => (
              <ColorSwatch key={t.name} token={t} />
            ))}
          </div>
        </Section>

        <Section
          title="Brand & interaction"
          description="Primary, secondary, and accent pairs for CTAs and hover states."
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {sections.brand.map((t) => (
              <ColorSwatch key={t.name} token={t} />
            ))}
          </div>
        </Section>

        <Section
          title="Semantic status"
          description="Feedback colors for error / success / warning / info states."
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {sections.semantic.map((t) => (
              <ColorSwatch key={t.name} token={t} />
            ))}
          </div>
        </Section>

        <Section title="Structure" description="Borders, focus ring, and chart-friendly hairlines.">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {sections.structure.map((t) => (
              <ColorSwatch key={t.name} token={t} />
            ))}
          </div>
        </Section>

        <Section title="Chart series" description="Navy → mist ramp for multi-series charts.">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {sections.charts.map((t) => (
              <ColorSwatch key={t.name} token={t} />
            ))}
          </div>
        </Section>

        <Section title="Sidebar" description="Dedicated palette for the app sidebar.">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {sections.sidebar.map((t) => (
              <ColorSwatch key={t.name} token={t} />
            ))}
          </div>
        </Section>

        <Section title="Radius scale" description="Corner rounding across components.">
          <div className="grid gap-2 md:grid-cols-2">
            {sections.radii.map((t) => (
              <SizeRow key={t.name} token={t} />
            ))}
          </div>
        </Section>

        <Section title="Spacing scale" description="Layout rhythm units.">
          <div className="grid gap-2 md:grid-cols-2">
            {sections.spacing.map((t) => (
              <SizeRow key={t.name} token={t} />
            ))}
          </div>
        </Section>

        <Section title="Type scale" description="Fluid font-size ramp.">
          <div className="grid gap-2 md:grid-cols-2">
            {sections.text.map((t) => (
              <SizeRow key={t.name} token={t} />
            ))}
          </div>
        </Section>
      </main>
    </div>
  );
}
