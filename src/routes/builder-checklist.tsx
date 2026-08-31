import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  LayoutDashboard,
  Smartphone,
  Palette,
  Accessibility,
  Loader2,
  PackagePlus,
  Wand2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Search,
  RefreshCw,
  Menu,
  Zap,
  ShieldAlert,
  Type,
  MessageSquare,
  Globe,
  ImageOff,
  ClipboardCheck,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

export const Route = createFileRoute("/builder-checklist")({
  head: () => ({
    meta: [
      { title: "Builder Checklist — Production Readiness Audit" },
      {
        name: "description",
        content:
          "Audit responsive layouts, theming, accessibility, and loading states with one-click fix previews.",
      },
      { property: "og:title", content: "Builder Checklist — Production Readiness Audit" },
      {
        property: "og:description",
        content: "A developer-tool style dashboard for shipping polished, scalable web apps.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { name: "googlebot", content: "noindex, nofollow" },
    ],
  }),
  component: BuilderChecklistPage,
});

type Status = "pass" | "warn" | "fail";
type PillarKey = "responsive" | "theming" | "a11y" | "loading";
type SectionKey = "overview" | PillarKey | "missing" | "preview";

type CheckItem = {
  id: string;
  title: string;
  detail: string;
  status: Status;
  fixId?: FixId;
};

type Pillar = {
  key: PillarKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: CheckItem[];
};

type MissingItem = {
  id: string;
  title: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  fixId: FixId;
  done: boolean;
};

type FixId = "hover" | "empty" | "validation" | "skeleton" | "focus";

const INITIAL_PILLARS: Pillar[] = [
  {
    key: "responsive",
    label: "Responsive",
    icon: Smartphone,
    items: [
      {
        id: "viewport",
        title: "Viewport meta tag",
        detail: "width=device-width, initial-scale=1 present in root head.",
        status: "pass",
      },
      {
        id: "grid",
        title: "Fluid grid usage",
        detail: "Uses min-w-0 + grid patterns to prevent overflow.",
        status: "pass",
        fixId: "hover",
      },
      {
        id: "mobile-nav",
        title: "Mobile navigation drawer",
        detail: "Off-canvas Sheet under 768px.",
        status: "warn",
        fixId: "hover",
      },
      {
        id: "tap",
        title: "Tap target sizes",
        detail: "All interactive elements ≥ 44×44 CSS px.",
        status: "warn",
        fixId: "focus",
      },
      {
        id: "breakpoints",
        title: "Breakpoint coverage",
        detail: "sm/md/lg/xl utilities applied consistently.",
        status: "pass",
      },
    ],
  },
  {
    key: "theming",
    label: "Theming",
    icon: Palette,
    items: [
      {
        id: "toggle",
        title: "Dark/light toggle wired",
        detail: "Theme switch persists across sessions.",
        status: "warn",
      },
      {
        id: "tokens",
        title: "Semantic tokens only",
        detail: "No hardcoded colors in components.",
        status: "pass",
      },
      {
        id: "contrast",
        title: "Contrast in both modes",
        detail: "Body text meets WCAG AA in dark and light.",
        status: "pass",
      },
      {
        id: "system",
        title: "prefers-color-scheme respected",
        detail: "Defaults to OS preference on first visit.",
        status: "fail",
      },
    ],
  },
  {
    key: "a11y",
    label: "Accessible Navigation",
    icon: Accessibility,
    items: [
      {
        id: "skip",
        title: "Skip-to-content link",
        detail: "Visible on keyboard focus.",
        status: "fail",
      },
      {
        id: "labels",
        title: "Icon-only buttons labeled",
        detail: "aria-label on every icon-only control.",
        status: "warn",
        fixId: "focus",
      },
      {
        id: "focus-ring",
        title: "Focus-visible rings",
        detail: "Clear focus indicator on all interactive elements.",
        status: "pass",
        fixId: "focus",
      },
      {
        id: "traps",
        title: "No keyboard traps",
        detail: "Every modal can be dismissed with Esc.",
        status: "pass",
      },
    ],
  },
  {
    key: "loading",
    label: "Loading States",
    icon: Loader2,
    items: [
      {
        id: "skeleton",
        title: "Skeleton loaders present",
        detail: "Async views render placeholders while fetching.",
        status: "warn",
        fixId: "skeleton",
      },
      {
        id: "suspense",
        title: "Suspense boundaries",
        detail: "Route-level Suspense wraps async components.",
        status: "pass",
      },
      {
        id: "error",
        title: "Error boundaries",
        detail: "Graceful fallback for render errors.",
        status: "warn",
      },
      {
        id: "empty",
        title: "Empty-state illustrations",
        detail: "Meaningful empty states, not just blank panels.",
        status: "fail",
        fixId: "empty",
      },
    ],
  },
];

const MISSING_ESSENTIALS: MissingItem[] = [
  {
    id: "err",
    title: "Error boundary pages",
    detail: "Custom 404 & 500 fallbacks with recovery actions.",
    icon: ShieldAlert,
    fixId: "empty",
    done: false,
  },
  {
    id: "ds",
    title: "Unified design system",
    detail: "Consistent spacing scale and typographic rhythm.",
    icon: Type,
    fixId: "hover",
    done: false,
  },
  {
    id: "toast",
    title: "Toast / snackbar feedback",
    detail: "Global sonner layer for async confirmations.",
    icon: MessageSquare,
    fixId: "hover",
    done: true,
  },
  {
    id: "seo",
    title: "Per-route SEO metadata",
    detail: "Unique title, description, og:image per route.",
    icon: Globe,
    fixId: "hover",
    done: false,
  },
  {
    id: "illus",
    title: "Empty-state illustrations",
    detail: "Custom art for zero-data views.",
    icon: ImageOff,
    fixId: "empty",
    done: false,
  },
  {
    id: "form",
    title: "Form validation patterns",
    detail: "Inline errors with clear recovery guidance.",
    icon: ClipboardCheck,
    fixId: "validation",
    done: false,
  },
];

const FIXES: Record<FixId, { title: string; description: string }> = {
  hover: {
    title: "Improved hover effects",
    description: "Subtle elevation + accent glow on interactive cards.",
  },
  empty: {
    title: "Empty state illustration",
    description: "Meaningful placeholder that guides the next action.",
  },
  validation: {
    title: "Form validation pattern",
    description: "Inline errors with helpful recovery copy.",
  },
  skeleton: {
    title: "Skeleton loader timing",
    description: "Consistent shimmer while data resolves.",
  },
  focus: {
    title: "Focus ring polish",
    description: "Visible ring for keyboard navigation across all controls.",
  },
};

function statusChip(s: Status) {
  return s === "pass"
    ? "text-emerald-300 border-emerald-400/30 bg-emerald-400/10"
    : s === "warn"
      ? "text-amber-300 border-amber-400/30 bg-amber-400/10"
      : "text-rose-300 border-rose-400/30 bg-rose-400/10";
}
function StatusIcon({ s }: { s: Status }) {
  if (s === "pass") return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (s === "warn") return <AlertTriangle className="h-4 w-4 text-amber-400" />;
  return <XCircle className="h-4 w-4 text-rose-400" />;
}

const NAV: Array<{
  key: SectionKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: string;
}> = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, group: "Audit" },
  { key: "responsive", label: "Responsive", icon: Smartphone, group: "Pillars" },
  { key: "theming", label: "Theming", icon: Palette, group: "Pillars" },
  { key: "a11y", label: "Accessible Nav", icon: Accessibility, group: "Pillars" },
  { key: "loading", label: "Loading States", icon: Loader2, group: "Pillars" },
  { key: "missing", label: "Missing Essentials", icon: PackagePlus, group: "Enhance" },
  { key: "preview", label: "One-Click Fix Preview", icon: Wand2, group: "Enhance" },
];

function BuilderChecklistPage() {
  const [section, setSection] = useState<SectionKey>("overview");
  const [pillars, setPillars] = useState(INITIAL_PILLARS);
  const [missing, setMissing] = useState(MISSING_ESSENTIALS);
  const [rescanning, setRescanning] = useState(false);
  const [search, setSearch] = useState("");
  const [fixOpen, setFixOpen] = useState<FixId | null>(null);
  const [showAfter, setShowAfter] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [lastScan, setLastScan] = useState<Date>(new Date());

  const scores = useMemo(() => {
    const s: Record<PillarKey, { pass: number; total: number; pct: number }> = {} as never;
    for (const p of pillars) {
      const pass = p.items.filter((i) => i.status === "pass").length;
      const warn = p.items.filter((i) => i.status === "warn").length;
      s[p.key] = {
        pass,
        total: p.items.length,
        pct: Math.round(((pass + warn * 0.5) / p.items.length) * 100),
      };
    }
    return s;
  }, [pillars]);

  const overall = Math.round(
    (scores.responsive.pct + scores.theming.pct + scores.a11y.pct + scores.loading.pct) / 4,
  );

  const handleRescan = () => {
    setRescanning(true);
    setTimeout(() => {
      setRescanning(false);
      setLastScan(new Date());
      toast.success("Audit complete", { description: `${overall}% production ready` });
    }, 1200);
  };

  const openFix = (id: FixId) => {
    setFixOpen(id);
    setShowAfter(false);
    setSection("preview");
    setSheetOpen(false);
  };

  const applyFix = (fixId: FixId) => {
    setPillars((prev) =>
      prev.map((p) => ({
        ...p,
        items: p.items.map((i) =>
          i.fixId === fixId && i.status !== "pass" ? { ...i, status: "pass" as Status } : i,
        ),
      })),
    );
    setMissing((prev) => prev.map((m) => (m.fixId === fixId ? { ...m, done: true } : m)));
    toast.success("Fix applied", { description: FIXES[fixId].title });
  };

  const markDone = (id: string) => {
    setMissing((prev) => prev.map((m) => (m.id === id ? { ...m, done: !m.done } : m)));
  };

  return (
    <div
      className="min-h-dvh bg-slate-950 text-slate-100"
      style={{
        backgroundImage:
          "radial-gradient(1200px 600px at 0% -10%, oklch(0.28 0.09 250 / 0.35), transparent 60%), radial-gradient(900px 500px at 100% 0%, oklch(0.35 0.15 245 / 0.25), transparent 60%)",
      }}
    >
      <div className="mx-auto flex min-h-dvh max-w-[1500px]">
        {/* Sidebar (desktop) */}
        <aside className="hidden w-[260px] shrink-0 border-r border-slate-800/80 bg-slate-950/60 backdrop-blur lg:block">
          <SidebarInner
            section={section}
            setSection={setSection}
            overall={overall}
            rescanning={rescanning}
          />
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1">
          <h1 className="sr-only">Production Readiness Checklist</h1>

          {/* Top bar */}
          <header className="sticky top-0 z-20 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-800/80 bg-slate-950/70 px-4 py-3 backdrop-blur sm:flex sm:flex-wrap sm:justify-between sm:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-slate-300 hover:bg-slate-800 lg:hidden min-h-11 min-w-11"
                    aria-label="Open navigation"
                  >
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="w-[280px] border-slate-800 bg-slate-950 p-0 text-slate-100"
                >
                  <SheetHeader className="sr-only">
                    <SheetTitle>Navigation</SheetTitle>
                  </SheetHeader>
                  <SidebarInner
                    section={section}
                    setSection={(k) => {
                      setSection(k);
                      setSheetOpen(false);
                    }}
                    overall={overall}
                    rescanning={rescanning}
                  />
                </SheetContent>
              </Sheet>
              <div className="relative min-w-0 flex-1 sm:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search checks…"
                  className="border-slate-800 bg-slate-900/60 pl-9 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:ring-sky-500/60"
                />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <div className="hidden items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs sm:flex">
                <span className="text-slate-400">Readiness</span>
                <span className="tabular-nums font-semibold text-sky-400">{overall}%</span>
              </div>
              <Button
                onClick={handleRescan}
                disabled={rescanning}
                className="gap-2 bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-[0_0_24px_-4px_oklch(0.68_0.19_245/0.6)] hover:from-sky-400 hover:to-blue-500"
              >
                {rescanning ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                {rescanning ? "Scanning…" : "Re-scan"}
              </Button>
            </div>
          </header>

          <div className="px-4 py-6 sm:px-6 lg:px-8">
            {/* Hero */}
            <div className="mb-6 grid gap-4 md:grid-cols-[1.4fr_2fr]">
              <Card className="overflow-hidden border-slate-800 bg-slate-900/60 backdrop-blur">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-400/50 to-transparent" />
                <CardHeader className="pb-2">
                  <CardDescription className="text-slate-400">
                    Overall production readiness
                  </CardDescription>
                  <CardTitle className="flex items-baseline gap-2 text-slate-100">
                    <motion.span
                      key={overall}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-5xl font-bold tabular-nums text-sky-300"
                    >
                      {overall}
                    </motion.span>
                    <span className="text-sm text-slate-500">/ 100</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Progress
                    value={overall}
                    className="h-2 bg-slate-800 [&>*]:bg-gradient-to-r [&>*]:from-sky-400 [&>*]:to-blue-500"
                  />
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/40 px-2 py-1.5">
                      <span className="text-slate-400">Last audit</span>
                      <span className="tabular-nums text-slate-200">
                        {lastScan.toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/40 px-2 py-1.5">
                      <span className="text-slate-400">Fixes queued</span>
                      <span className="tabular-nums text-sky-400">
                        {missing.filter((m) => !m.done).length}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {pillars.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setSection(p.key)}
                    className={`group relative overflow-hidden rounded-xl border p-4 text-left transition ${
                      section === p.key
                        ? "border-sky-500/50 bg-sky-500/5"
                        : "border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p.icon className="h-4 w-4 text-sky-400" />
                      <span className="text-xs tabular-nums text-slate-400">
                        {scores[p.key].pass}/{scores[p.key].total}
                      </span>
                    </div>
                    <div className="mt-3 text-2xl font-bold tabular-nums text-slate-100">
                      {scores[p.key].pct}%
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-400">{p.label}</div>
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-800">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${scores[p.key].pct}%` }}
                        transition={{ duration: 0.6, ease: "easeOut" }}
                        className="h-full bg-gradient-to-r from-sky-400 to-blue-500"
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Section content */}
            <AnimatePresence mode="wait">
              <motion.div
                key={section + String(rescanning)}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
              >
                {rescanning ? (
                  <div className="grid gap-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full rounded-xl bg-slate-800/60" />
                    ))}
                  </div>
                ) : section === "overview" ? (
                  <OverviewSection pillars={pillars} openFix={openFix} search={search} />
                ) : section === "missing" ? (
                  <MissingSection
                    items={missing}
                    onToggle={markDone}
                    onPreview={openFix}
                    search={search}
                  />
                ) : section === "preview" ? (
                  <PreviewSection
                    fixId={fixOpen}
                    setFixId={setFixOpen}
                    showAfter={showAfter}
                    setShowAfter={setShowAfter}
                    onApply={applyFix}
                  />
                ) : (
                  <PillarSection
                    pillar={pillars.find((p) => p.key === section)!}
                    openFix={openFix}
                    search={search}
                  />
                )}
              </motion.div>
            </AnimatePresence>

            <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-4 text-xs text-slate-500">
              <span>Builder Checklist · scoped production audit</span>
              <span className="tabular-nums">Last scan · {lastScan.toLocaleString()}</span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}

/* ------------------------- Sidebar ------------------------- */
function SidebarInner({
  section,
  setSection,
  overall,
  rescanning,
}: {
  section: SectionKey;
  setSection: (k: SectionKey) => void;
  overall: number;
  rescanning: boolean;
}) {
  const groups = Array.from(new Set(NAV.map((n) => n.group)));
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-800/80 p-5">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 shadow-[0_0_20px_-4px_oklch(0.68_0.19_245/0.7)]">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-100">Builder Checklist</div>
            <div className="truncate text-[11px] text-slate-500">Production audit</div>
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>Readiness</span>
            <span className="tabular-nums text-sky-400">{overall}%</span>
          </div>
          <Progress
            value={rescanning ? undefined : overall}
            className="mt-2 h-1.5 bg-slate-800 [&>*]:bg-gradient-to-r [&>*]:from-sky-400 [&>*]:to-blue-500"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        <nav className="p-3">
          {groups.map((g) => (
            <div key={g} className="mb-4">
              <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {g}
              </div>
              <div className="space-y-0.5">
                {NAV.filter((n) => n.group === g).map((item) => {
                  const active = section === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => setSection(item.key)}
                      className={`relative grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition ${
                        active
                          ? "bg-sky-500/10 text-sky-200"
                          : "text-slate-300 hover:bg-slate-800/60 hover:text-slate-100"
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="sidebar-active"
                          className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-sky-400"
                        />
                      )}
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                      {active && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-sky-400" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </ScrollArea>
      <div className="border-t border-slate-800/80 p-4 text-[11px] text-slate-500">
        Deep-slate · Electric blue · v1.0
      </div>
    </div>
  );
}

/* ------------------------- Overview ------------------------- */
function OverviewSection({
  pillars,
  openFix,
  search,
}: {
  pillars: Pillar[];
  openFix: (id: FixId) => void;
  search: string;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {pillars.map((p) => {
        const items = p.items.filter((i) => i.title.toLowerCase().includes(search.toLowerCase()));
        return (
          <Card key={p.key} className="border-slate-800 bg-slate-900/60 backdrop-blur">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex min-w-0 items-center gap-2">
                <p.icon className="h-4 w-4 shrink-0 text-sky-400" />
                <CardTitle className="truncate text-sm text-slate-100">{p.label}</CardTitle>
              </div>
              <Badge variant="outline" className="border-slate-700 bg-slate-950/40 text-slate-300">
                {items.length} check{items.length === 1 ? "" : "s"}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                {items.slice(0, 4).map((it) => (
                  <button
                    key={it.id}
                    onClick={() => it.fixId && openFix(it.fixId)}
                    disabled={!it.fixId}
                    className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2.5 py-2 text-left transition ${statusChip(it.status)} ${it.fixId ? "hover:brightness-125" : "cursor-default"}`}
                  >
                    <StatusIcon s={it.status} />
                    <span className="truncate text-sm text-slate-100">{it.title}</span>
                    {it.fixId && <Wand2 className="h-3.5 w-3.5 shrink-0 opacity-70" />}
                  </button>
                ))}
                {items.length === 0 && (
                  <div className="rounded-md border border-dashed border-slate-800 p-3 text-center text-xs text-slate-500">
                    No matches
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ------------------------- Pillar ------------------------- */
function PillarSection({
  pillar,
  openFix,
  search,
}: {
  pillar: Pillar;
  openFix: (id: FixId) => void;
  search: string;
}) {
  const items = pillar.items.filter((i) => i.title.toLowerCase().includes(search.toLowerCase()));
  return (
    <Card className="border-slate-800 bg-slate-900/60 backdrop-blur">
      <CardHeader>
        <div className="flex items-center gap-2">
          <pillar.icon className="h-5 w-5 text-sky-400" />
          <CardTitle className="text-slate-100">{pillar.label}</CardTitle>
        </div>
        <CardDescription className="text-slate-400">
          Checks scoped to this pillar. Rows with a wand can be previewed and applied.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {items.map((it, i) => (
            <motion.div
              key={it.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border p-3 ${statusChip(it.status)}`}
            >
              <StatusIcon s={it.status} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-100">{it.title}</div>
                <div className="truncate text-xs text-slate-400">{it.detail}</div>
              </div>
              {it.fixId ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openFix(it.fixId!)}
                  className="shrink-0 gap-1 text-sky-300 hover:bg-sky-500/10 hover:text-sky-200"
                >
                  <Wand2 className="h-3.5 w-3.5" /> Preview fix
                </Button>
              ) : (
                <Badge variant="outline" className="shrink-0 border-slate-700 text-slate-400">
                  Manual
                </Badge>
              )}
            </motion.div>
          ))}
          {items.length === 0 && (
            <div className="rounded-md border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">
              No checks match your search.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------- Missing Essentials ------------------------- */
function MissingSection({
  items,
  onToggle,
  onPreview,
  search,
}: {
  items: MissingItem[];
  onToggle: (id: string) => void;
  onPreview: (id: FixId) => void;
  search: string;
}) {
  const filtered = items.filter((i) => i.title.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {filtered.map((m, i) => (
        <motion.div
          key={m.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04 }}
        >
          <Card
            className={`relative h-full overflow-hidden border-slate-800 bg-slate-900/60 backdrop-blur transition hover:border-sky-500/40 ${m.done ? "opacity-70" : ""}`}
          >
            <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-sky-500/10 blur-3xl" />
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div className="grid h-10 w-10 place-items-center rounded-lg border border-slate-800 bg-slate-950/60">
                  <m.icon className="h-4.5 w-4.5 text-sky-400" />
                </div>
                {m.done ? (
                  <Badge className="border-emerald-400/40 bg-emerald-400/10 text-emerald-300">
                    Done
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-slate-700 text-slate-400">
                    Todo
                  </Badge>
                )}
              </div>
              <CardTitle className="mt-3 text-base text-slate-100">{m.title}</CardTitle>
              <CardDescription className="text-slate-400">{m.detail}</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onPreview(m.fixId)}
                className="gap-1 text-sky-300 hover:bg-sky-500/10 hover:text-sky-200"
              >
                <Wand2 className="h-3.5 w-3.5" /> Preview
              </Button>
              <Button
                size="sm"
                onClick={() => onToggle(m.id)}
                className={
                  m.done
                    ? "bg-slate-800 text-slate-200 hover:bg-slate-700"
                    : "bg-gradient-to-r from-sky-500 to-blue-600 text-white hover:from-sky-400 hover:to-blue-500"
                }
              >
                {m.done ? "Undo" : "Mark done"}
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      ))}
      {filtered.length === 0 && (
        <div className="col-span-full rounded-md border border-dashed border-slate-800 p-8 text-center text-sm text-slate-500">
          No essentials match your search.
        </div>
      )}
    </div>
  );
}

/* ------------------------- Fix Preview ------------------------- */
function PreviewSection({
  fixId,
  setFixId,
  showAfter,
  setShowAfter,
  onApply,
}: {
  fixId: FixId | null;
  setFixId: (id: FixId) => void;
  showAfter: boolean;
  setShowAfter: (v: boolean) => void;
  onApply: (id: FixId) => void;
}) {
  const activeId = fixId ?? "hover";
  const fix = FIXES[activeId];
  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      {/* Fix picker */}
      <Card className="border-slate-800 bg-slate-900/60 backdrop-blur">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-100">Choose a fix</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {(Object.keys(FIXES) as FixId[]).map((id) => (
            <button
              key={id}
              onClick={() => {
                setFixId(id);
                setShowAfter(false);
              }}
              className={`grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition ${
                activeId === id
                  ? "bg-sky-500/10 text-sky-200"
                  : "text-slate-300 hover:bg-slate-800/60"
              }`}
            >
              <Wand2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{FIXES[id].title}</span>
            </button>
          ))}
        </CardContent>
      </Card>

      {/* Preview panel */}
      <Card className="border-slate-800 bg-slate-900/60 backdrop-blur">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="truncate text-slate-100">{fix.title}</CardTitle>
              <CardDescription className="text-slate-400">{fix.description}</CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="flex rounded-md border border-slate-800 bg-slate-950/60 p-0.5 text-xs">
                <button
                  onClick={() => setShowAfter(false)}
                  className={`rounded px-3 py-1 transition ${!showAfter ? "bg-slate-800 text-slate-100" : "text-slate-400"}`}
                >
                  Before
                </button>
                <button
                  onClick={() => setShowAfter(true)}
                  className={`rounded px-3 py-1 transition ${showAfter ? "bg-sky-500/20 text-sky-200" : "text-slate-400"}`}
                >
                  After
                </button>
              </div>
              <Button
                onClick={() => onApply(activeId)}
                className="gap-2 bg-gradient-to-r from-sky-500 to-blue-600 text-white hover:from-sky-400 hover:to-blue-500"
              >
                <Zap className="h-4 w-4" /> Apply fix
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-2">
            <PreviewFrame label="Before" active={!showAfter}>
              <FixMock id={activeId} after={false} />
            </PreviewFrame>
            <PreviewFrame label="After" active={showAfter} accent>
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeId + String(showAfter)}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.25 }}
                >
                  <FixMock id={activeId} after />
                </motion.div>
              </AnimatePresence>
            </PreviewFrame>
          </div>
          <Separator className="my-6 bg-slate-800" />
          <div className="grid gap-2 text-xs text-slate-400 sm:grid-cols-3">
            <InfoStat label="Impact" value="High" tone="sky" />
            <InfoStat label="Effort" value="Low" tone="emerald" />
            <InfoStat label="Scope" value="Global tokens" tone="slate" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PreviewFrame({
  label,
  active,
  accent,
  children,
}: {
  label: string;
  active: boolean;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border p-5 transition ${active ? (accent ? "border-sky-500/50 bg-sky-500/5 shadow-[0_0_40px_-10px_oklch(0.68_0.19_245/0.5)]" : "border-slate-700 bg-slate-950/40") : "border-slate-800 bg-slate-950/20 opacity-70"}`}
    >
      <div className="mb-3 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
        <span>{label}</span>
        {accent && <span className="text-sky-400">Proposed</span>}
      </div>
      <div className="min-h-[180px]">{children}</div>
    </div>
  );
}

function InfoStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "sky" | "emerald" | "slate";
}) {
  const cls =
    tone === "sky"
      ? "text-sky-300 border-sky-400/30 bg-sky-400/10"
      : tone === "emerald"
        ? "text-emerald-300 border-emerald-400/30 bg-emerald-400/10"
        : "text-slate-300 border-slate-700 bg-slate-800/40";
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2">
      <span className="text-slate-400">{label}</span>
      <Badge variant="outline" className={cls}>
        {value}
      </Badge>
    </div>
  );
}

/* ------------------------- Fix mockups ------------------------- */
function FixMock({ id, after }: { id: FixId; after: boolean }) {
  if (id === "hover") {
    return (
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <div
            key={i}
            className={`rounded-lg border p-4 transition ${
              after
                ? "border-sky-500/30 bg-slate-900 hover:-translate-y-0.5 hover:border-sky-400/60 hover:shadow-[0_10px_40px_-10px_oklch(0.68_0.19_245/0.6)]"
                : "border-slate-800 bg-slate-900 hover:bg-slate-800"
            }`}
          >
            <div className="text-sm font-medium text-slate-100">Card {i + 1}</div>
            <div className="mt-1 text-xs text-slate-400">Hover me</div>
          </div>
        ))}
      </div>
    );
  }
  if (id === "empty") {
    return after ? (
      <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-sky-500/10 ring-1 ring-sky-500/30">
          <PackagePlus className="h-7 w-7 text-sky-400" />
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-100">No items yet</div>
          <div className="text-xs text-slate-400">Create your first record to see it here.</div>
        </div>
        <Button
          size="sm"
          className="bg-gradient-to-r from-sky-500 to-blue-600 text-white hover:from-sky-400 hover:to-blue-500"
        >
          Create item
        </Button>
      </div>
    ) : (
      <div className="grid h-full min-h-[140px] place-items-center text-xs text-slate-600">
        No data.
      </div>
    );
  }
  if (id === "validation") {
    return (
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-slate-400">Email</label>
          <Input
            value="jane@"
            readOnly
            className={`border ${after ? "border-rose-500/60" : "border-slate-800"} bg-slate-950 text-slate-100`}
          />
          {after && (
            <div className="mt-1 text-xs text-rose-400">
              Enter a full address, e.g. jane@company.com
            </div>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-400">Password</label>
          <Input
            type="password"
            value="123"
            readOnly
            className={`border ${after ? "border-amber-500/60" : "border-slate-800"} bg-slate-950 text-slate-100`}
          />
          {after && (
            <div className="mt-1 text-xs text-amber-400">
              Use at least 8 characters with a number.
            </div>
          )}
        </div>
      </div>
    );
  }
  if (id === "skeleton") {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-950/40 p-3"
          >
            <Skeleton
              className={`h-9 w-9 rounded-full bg-slate-800/70 ${after ? "animate-pulse" : ""}`}
            />
            <div className="flex-1 space-y-2">
              <Skeleton className={`h-3 w-3/4 bg-slate-800/70 ${after ? "animate-pulse" : ""}`} />
              <Skeleton className={`h-3 w-1/2 bg-slate-800/70 ${after ? "animate-pulse" : ""}`} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  // focus
  return (
    <div className="flex flex-wrap gap-3">
      <Button
        className={
          after
            ? "focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
            : "focus:outline-none"
        }
      >
        Primary
      </Button>
      <Button
        variant="outline"
        className={`border-slate-700 text-slate-200 ${after ? "focus-visible:ring-2 focus-visible:ring-sky-400" : "focus:outline-none"}`}
      >
        Secondary
      </Button>
      <Button
        variant="ghost"
        className={`text-slate-300 ${after ? "focus-visible:ring-2 focus-visible:ring-sky-400" : "focus:outline-none"}`}
      >
        Ghost
      </Button>
      <div className="mt-2 w-full text-xs text-slate-500">
        Tab through the buttons to see the focus ring.
      </div>
    </div>
  );
}
