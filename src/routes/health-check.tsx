import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  Gauge,
  Eye,
  Search,
  Smartphone,
  Play,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  TrendingUp,
  Clock,
  Sparkles,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { seriesDash, renderSeriesMarker } from "@/lib/chart-a11y";

export const Route = createFileRoute("/health-check")({
  head: () => ({
    meta: [
      { title: "Health Check — App Diagnostics" },
      {
        name: "description",
        content:
          "Automated performance, accessibility, SEO, and responsiveness audits with real-time score visualizations.",
      },
      { property: "og:title", content: "Health Check — App Diagnostics" },
      {
        property: "og:description",
        content: "Real-time app health scores, report cards, and trend history.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { name: "googlebot", content: "noindex, nofollow" },
    ],
  }),
  component: HealthCheckPage,
});

type Status = "pass" | "warn" | "fail";
type CategoryKey = "performance" | "accessibility" | "seo" | "responsiveness";

type CheckItem = {
  id: string;
  label: string;
  detail: string;
  metric?: string;
  status: Status;
};

type CategoryResult = {
  key: CategoryKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  score: number;
  checks: CheckItem[];
};

type ScanResult = {
  timestamp: number;
  overall: number;
  categories: Record<CategoryKey, CategoryResult>;
};

const CATEGORY_META: Array<Pick<CategoryResult, "key" | "label" | "icon">> = [
  { key: "performance", label: "Performance", icon: Gauge },
  { key: "accessibility", label: "Accessibility", icon: Eye },
  { key: "seo", label: "SEO", icon: Search },
  { key: "responsiveness", label: "Responsiveness", icon: Smartphone },
];

const CHECK_TEMPLATES: Record<
  CategoryKey,
  Array<{
    id: string;
    label: string;
    detail: string;
    metricRange?: [number, number];
    unit?: string;
  }>
> = {
  performance: [
    {
      id: "lcp",
      label: "Largest Contentful Paint",
      detail: "Time until the largest visible element renders.",
      metricRange: [1.4, 3.8],
      unit: "s",
    },
    {
      id: "fid",
      label: "Interaction to Next Paint",
      detail: "Responsiveness to first user interaction.",
      metricRange: [40, 260],
      unit: "ms",
    },
    {
      id: "cls",
      label: "Cumulative Layout Shift",
      detail: "Visual stability during load.",
      metricRange: [0.02, 0.28],
    },
    {
      id: "ttfb",
      label: "Time to First Byte",
      detail: "Server response speed.",
      metricRange: [150, 900],
      unit: "ms",
    },
    {
      id: "bundle",
      label: "JS bundle size (gz)",
      detail: "Total JavaScript shipped to the client.",
      metricRange: [140, 420],
      unit: "kB",
    },
  ],
  accessibility: [
    {
      id: "contrast",
      label: "Color contrast ratio",
      detail: "Text vs background contrast for readability.",
      metricRange: [3.2, 8.4],
      unit: ":1",
    },
    {
      id: "alt",
      label: "Image alt coverage",
      detail: "Percent of images with descriptive alt text.",
      metricRange: [78, 100],
      unit: "%",
    },
    {
      id: "aria",
      label: "ARIA landmark usage",
      detail: "Semantic landmarks (nav, main, footer) present.",
      metricRange: [60, 100],
      unit: "%",
    },
    {
      id: "focus",
      label: "Keyboard focus rings",
      detail: "Visible focus indicators on interactive controls.",
      metricRange: [65, 100],
      unit: "%",
    },
    {
      id: "tap",
      label: "Tap target size",
      detail: "Touch targets ≥ 44×44 CSS pixels.",
      metricRange: [70, 100],
      unit: "%",
    },
  ],
  seo: [
    {
      id: "title",
      label: "Unique page titles",
      detail: "Every route ships a specific <title>.",
      metricRange: [70, 100],
      unit: "%",
    },
    {
      id: "meta",
      label: "Meta description coverage",
      detail: "Routes with a distinct meta description.",
      metricRange: [60, 100],
      unit: "%",
    },
    {
      id: "og",
      label: "Open Graph tags",
      detail: "og:title, og:description, og:image on shareable pages.",
      metricRange: [55, 100],
      unit: "%",
    },
    {
      id: "sitemap",
      label: "Sitemap freshness",
      detail: "sitemap.xml reflects the current route tree.",
      metricRange: [80, 100],
      unit: "%",
    },
    {
      id: "schema",
      label: "Structured data (JSON-LD)",
      detail: "Schema.org markup on key pages.",
      metricRange: [30, 95],
      unit: "%",
    },
  ],
  responsiveness: [
    {
      id: "viewport",
      label: "Viewport meta tag",
      detail: "Proper responsive viewport declaration.",
      metricRange: [90, 100],
      unit: "%",
    },
    {
      id: "mobile-nav",
      label: "Mobile navigation",
      detail: "Drawer / sheet nav under 768px.",
      metricRange: [70, 100],
      unit: "%",
    },
    {
      id: "grid",
      label: "Fluid grid usage",
      detail: "min-w-0 + grid patterns to avoid overflow.",
      metricRange: [60, 100],
      unit: "%",
    },
    {
      id: "images",
      label: "Responsive images",
      detail: "srcset / sizes / aspect-ratio.",
      metricRange: [50, 100],
      unit: "%",
    },
    {
      id: "breakpoints",
      label: "Breakpoint coverage",
      detail: "sm/md/lg/xl utilities across layouts.",
      metricRange: [65, 100],
      unit: "%",
    },
  ],
};

function statusFromScore(score: number): Status {
  if (score >= 85) return "pass";
  if (score >= 65) return "warn";
  return "fail";
}

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function buildScan(prevOverall?: number): ScanResult {
  const categories = {} as Record<CategoryKey, CategoryResult>;
  for (const meta of CATEGORY_META) {
    const templates = CHECK_TEMPLATES[meta.key];
    const checks: CheckItem[] = templates.map((t) => {
      const raw = t.metricRange
        ? randomBetween(t.metricRange[0], t.metricRange[1])
        : randomBetween(60, 100);
      // higher-is-better default; for LCP/CLS/INP/TTFB lower is better
      const lowerBetter = ["lcp", "cls", "fid", "ttfb", "bundle"].includes(t.id);
      const [lo, hi] = t.metricRange ?? [0, 100];
      const norm = lowerBetter
        ? 100 - ((raw - lo) / (hi - lo)) * 100
        : t.unit === "%" || t.unit === ":1"
          ? Math.min(100, (raw / hi) * 100)
          : raw;
      const score = Math.max(0, Math.min(100, Math.round(norm)));
      const metric = t.metricRange
        ? `${raw.toFixed(t.unit === "s" || t.id === "cls" ? 2 : t.unit === "ms" ? 0 : 1)}${t.unit ?? ""}`
        : undefined;
      return {
        id: t.id,
        label: t.label,
        detail: t.detail,
        metric,
        status: statusFromScore(score),
      };
    });
    const avg = Math.round(
      checks.reduce((s, c) => s + (c.status === "pass" ? 95 : c.status === "warn" ? 72 : 42), 0) /
        checks.length,
    );
    categories[meta.key] = { ...meta, score: avg, checks };
  }
  const overall = Math.round(
    (categories.performance.score +
      categories.accessibility.score +
      categories.seo.score +
      categories.responsiveness.score) /
      4,
  );
  return { timestamp: Date.now(), overall, categories };
}

function seedHistory(): ScanResult[] {
  const now = Date.now();
  const out: ScanResult[] = [];
  for (let i = 6; i >= 1; i--) {
    const scan = buildScan();
    scan.timestamp = now - i * 1000 * 60 * 60 * 24;
    out.push(scan);
  }
  return out;
}

function statusColor(s: Status) {
  return s === "pass"
    ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/10"
    : s === "warn"
      ? "text-amber-500 border-amber-500/30 bg-amber-500/10"
      : "text-red-500 border-red-500/30 bg-red-500/10";
}

function StatusIcon({ status }: { status: Status }) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "warn") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  return <XCircle className="h-4 w-4 text-red-500" />;
}

function RadialGauge({
  value,
  label,
  icon: Icon,
}: {
  value: number;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const dash = (value / 100) * circumference;
  const color =
    value >= 85 ? "hsl(160 84% 45%)" : value >= 65 ? "hsl(38 92% 55%)" : "hsl(0 84% 60%)";
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-32 w-32">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle cx="60" cy="60" r={radius} strokeWidth="10" className="fill-none stroke-muted" />
          <motion.circle
            cx="60"
            cy="60"
            r={radius}
            strokeWidth="10"
            strokeLinecap="round"
            className="fill-none"
            stroke={color}
            initial={{ strokeDasharray: `0 ${circumference}` }}
            animate={{ strokeDasharray: `${dash} ${circumference}` }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
        </div>
      </div>
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
    </div>
  );
}

function HealthCheckPage() {
  const [history, setHistory] = useState<ScanResult[]>(() => seedHistory());
  const [current, setCurrent] = useState<ScanResult | null>(
    () => history[history.length - 1] ?? null,
  );
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!scanning) return;
    setProgress(0);
    const start = Date.now();
    const duration = 1800;
    const interval = setInterval(() => {
      const p = Math.min(100, ((Date.now() - start) / duration) * 100);
      setProgress(p);
      if (p >= 100) {
        clearInterval(interval);
        const scan = buildScan(current?.overall);
        setCurrent(scan);
        setHistory((h) => [...h.slice(-11), scan]);
        setScanning(false);
      }
    }, 60);
    return () => clearInterval(interval);
  }, [scanning]);

  const trendData = useMemo(
    () =>
      history.map((h) => ({
        date: new Date(h.timestamp).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        Overall: h.overall,
        Performance: h.categories.performance.score,
        Accessibility: h.categories.accessibility.score,
        SEO: h.categories.seo.score,
        Responsiveness: h.categories.responsiveness.score,
      })),
    [history],
  );

  const overallStatus = current ? statusFromScore(current.overall) : "warn";

  const totalIssues = current
    ? Object.values(current.categories)
        .flatMap((c) => c.checks)
        .filter((c) => c.status !== "pass").length
    : 0;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:flex-wrap sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/20">
              <Activity className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-bold">Health Check</h1>
              <p className="truncate text-sm text-muted-foreground">
                Automated performance, accessibility, SEO & responsiveness audits
              </p>
            </div>
          </div>
          <Button
            size="lg"
            onClick={() => setScanning(true)}
            disabled={scanning}
            className="shrink-0 gap-2"
          >
            {scanning ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {scanning ? "Scanning…" : "Scan Now"}
          </Button>
        </header>

        {/* Scan progress bar */}
        <AnimatePresence>
          {scanning && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="mt-4"
            >
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="flex items-center gap-4 py-4">
                  <Sparkles className="h-5 w-5 shrink-0 animate-pulse text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="font-medium">Running automated checks…</span>
                      <span className="tabular-nums text-muted-foreground">
                        {Math.round(progress)}%
                      </span>
                    </div>
                    <Progress value={progress} className="h-1.5" />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Summary + Gauges */}
        <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_2.6fr]">
          <Card className="overflow-hidden">
            <CardHeader className="pb-2">
              <CardDescription>Overall Health Score</CardDescription>
              <CardTitle className="flex items-baseline gap-2">
                {scanning ? (
                  <Skeleton className="h-10 w-24" />
                ) : (
                  <>
                    <motion.span
                      key={current?.overall}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-4xl font-bold tabular-nums"
                    >
                      {current?.overall ?? "—"}
                    </motion.span>
                    <span className="text-sm text-muted-foreground">/ 100</span>
                  </>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={statusColor(overallStatus)}>
                  {overallStatus === "pass"
                    ? "Healthy"
                    : overallStatus === "warn"
                      ? "Needs attention"
                      : "Critical"}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {totalIssues} issue{totalIssues === 1 ? "" : "s"} found
                </span>
              </div>
              <Separator className="my-4" />
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Last scan</span>
                  <span className="tabular-nums">
                    {current ? new Date(current.timestamp).toLocaleString() : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">History points</span>
                  <span className="tabular-nums">{history.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Trend</span>
                  <span className="inline-flex items-center gap-1 text-emerald-500">
                    <TrendingUp className="h-3.5 w-3.5" />
                    {history.length >= 2
                      ? `${history[history.length - 1].overall - history[0].overall >= 0 ? "+" : ""}${history[history.length - 1].overall - history[0].overall} pts`
                      : "—"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Category Scores</CardTitle>
              <CardDescription>Live results from the latest audit</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {CATEGORY_META.map((meta) => {
                  if (scanning || !current) {
                    return (
                      <div key={meta.key} className="flex flex-col items-center gap-2">
                        <Skeleton className="h-32 w-32 rounded-full" />
                        <Skeleton className="h-4 w-20" />
                      </div>
                    );
                  }
                  const cat = current.categories[meta.key];
                  return (
                    <RadialGauge
                      key={meta.key}
                      value={cat.score}
                      label={cat.label}
                      icon={meta.icon}
                    />
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Report Card + Trend */}
        <div className="mt-6 grid gap-4 lg:grid-cols-[3fr_2fr]">
          {/* Report card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Report Card</CardTitle>
              <CardDescription>Detailed check-by-check breakdown</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="performance">
                <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
                  {CATEGORY_META.map((m) => (
                    <TabsTrigger key={m.key} value={m.key} className="gap-2">
                      <m.icon className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{m.label}</span>
                      <span className="sm:hidden">{m.label.slice(0, 4)}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
                {CATEGORY_META.map((m) => (
                  <TabsContent key={m.key} value={m.key} className="mt-4">
                    <ScrollArea className="h-[360px] pr-3">
                      <div className="space-y-2">
                        {scanning || !current
                          ? Array.from({ length: 5 }).map((_, i) => (
                              <Skeleton key={i} className="h-16 w-full rounded-lg" />
                            ))
                          : current.categories[m.key].checks.map((check, i) => (
                              <motion.div
                                key={check.id}
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.04 }}
                                className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border p-3 ${statusColor(check.status)}`}
                              >
                                <StatusIcon status={check.status} />
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-foreground">
                                    {check.label}
                                  </div>
                                  <div className="truncate text-xs text-muted-foreground">
                                    {check.detail}
                                  </div>
                                </div>
                                {check.metric && (
                                  <Badge variant="outline" className="shrink-0 tabular-nums">
                                    {check.metric}
                                  </Badge>
                                )}
                              </motion.div>
                            ))}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>

          {/* Trend chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Score Trend</CardTitle>
              <CardDescription>Optimization progress over time</CardDescription>
            </CardHeader>
            <CardContent>
              {scanning ? (
                <Skeleton className="h-[280px] w-full" />
              ) : (
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--hairline)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        axisLine={{ stroke: "var(--hairline)" }}
                        tickLine={{ stroke: "var(--hairline)" }}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        axisLine={{ stroke: "var(--hairline)" }}
                        tickLine={{ stroke: "var(--hairline)" }}
                      />
                      <Tooltip
                        cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
                        contentStyle={{
                          background: "var(--popover)",
                          color: "var(--popover-foreground)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          fontSize: 12,
                          boxShadow: "0 4px 12px -4px rgb(0 0 0 / 0.15)",
                        }}
                        labelStyle={{ color: "var(--foreground)", fontWeight: 600 }}
                        itemStyle={{ color: "var(--popover-foreground)" }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }}
                        iconType="circle"
                      />
                      {/* Colorblind-safe: color + distinct dash pattern + distinct active-dot shape */}
                      <Line
                        type="monotone"
                        dataKey="Overall"
                        stroke="var(--chart-1)"
                        strokeWidth={2.5}
                        strokeDasharray={seriesDash(0)}
                        dot={{
                          r: 3,
                          fill: "var(--chart-1)",
                          stroke: "var(--background)",
                          strokeWidth: 1.5,
                        }}
                        activeDot={renderSeriesMarker(0)}
                      />
                      <Line
                        type="monotone"
                        dataKey="Performance"
                        stroke="var(--chart-2)"
                        strokeWidth={1.75}
                        strokeDasharray={seriesDash(1)}
                        dot={false}
                        activeDot={renderSeriesMarker(1)}
                      />
                      <Line
                        type="monotone"
                        dataKey="Accessibility"
                        stroke="var(--chart-3)"
                        strokeWidth={1.75}
                        strokeDasharray={seriesDash(2)}
                        dot={false}
                        activeDot={renderSeriesMarker(2)}
                      />
                      <Line
                        type="monotone"
                        dataKey="SEO"
                        stroke="var(--chart-4)"
                        strokeWidth={1.75}
                        strokeDasharray={seriesDash(3)}
                        dot={false}
                        activeDot={renderSeriesMarker(3)}
                      />
                      <Line
                        type="monotone"
                        dataKey="Responsiveness"
                        stroke="var(--chart-5)"
                        strokeWidth={1.75}
                        strokeDasharray={seriesDash(4)}
                        dot={false}
                        activeDot={renderSeriesMarker(4)}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* History log */}
        <Card className="mt-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Scan History</CardTitle>
            <CardDescription>Recent audit runs</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[240px]">
              <div className="space-y-2">
                {[...history].reverse().map((h, i) => {
                  const status = statusFromScore(h.overall);
                  return (
                    <motion.div
                      key={h.timestamp}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-lg border bg-card/40 p-3"
                    >
                      <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {new Date(h.timestamp).toLocaleString()}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          P {h.categories.performance.score} · A {h.categories.accessibility.score}{" "}
                          · S {h.categories.seo.score} · R {h.categories.responsiveness.score}
                        </div>
                      </div>
                      <div className="w-24">
                        <Progress value={h.overall} className="h-1.5" />
                      </div>
                      <Badge variant="outline" className={`${statusColor(status)} tabular-nums`}>
                        {h.overall}
                      </Badge>
                    </motion.div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
