import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState, version as reactVersion } from "react";
import rechartsPkg from "recharts/package.json";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Area,
  AreaChart,
  Pie,
  PieChart,
  Cell,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  ChartPatternDefs,
  seriesPatternFill,
  seriesDash,
  renderSeriesMarker,
  SERIES_COLORS,
} from "@/lib/chart-a11y";
import {
  Sun,
  Moon,
  ImageDown,
  FileDown,
  Loader2,
  Smartphone,
  Tablet,
  Monitor,
  Maximize2,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Clipboard,
  ClipboardCheck,
  Save,
  Trash2,
  GitCompare,
} from "lucide-react";
import { auditChartContrast, type ContrastCheck } from "@/lib/contrast-audit";
import { buildFailuresPayload } from "@/lib/chartQaFailuresPayload";
import { buildJsonExportMetadata, type CsvMetadataInput } from "@/lib/csvExportMetadata";
import { useCsvExportConfirm } from "@/components/CsvExportConfirmDialog";

export const Route = createFileRoute("/chart-preview")({
  head: () => ({
    meta: [
      { title: "Chart Theme Preview — Design QA" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "googlebot", content: "noindex, nofollow" },
      {
        name: "description",
        content:
          "Internal QA surface for chart tooltips, legends, gridlines, and toolbars in light and dark modes.",
      },
    ],
  }),
  component: ChartPreview,
});

const seriesKeys = ["s1", "s2", "s3", "s4", "s5"] as const;

const chartConfig = {
  s1: { label: "Overall", color: "var(--chart-1)" },
  s2: { label: "Performance", color: "var(--chart-2)" },
  s3: { label: "Accessibility", color: "var(--chart-3)" },
  s4: { label: "SEO", color: "var(--chart-4)" },
  s5: { label: "Responsiveness", color: "var(--chart-5)" },
} satisfies ChartConfig;

const trend = [
  { month: "Jan", s1: 62, s2: 40, s3: 74, s4: 55, s5: 48 },
  { month: "Feb", s1: 68, s2: 45, s3: 71, s4: 58, s5: 52 },
  { month: "Mar", s1: 74, s2: 52, s3: 78, s4: 62, s5: 55 },
  { month: "Apr", s1: 71, s2: 58, s3: 76, s4: 66, s5: 60 },
  { month: "May", s1: 82, s2: 61, s3: 82, s4: 70, s5: 64 },
  { month: "Jun", s1: 88, s2: 67, s3: 85, s4: 74, s5: 69 },
];

const pieData = seriesKeys.map((k, i) => ({
  name: chartConfig[k].label,
  value: [42, 26, 15, 10, 7][i],
  fill: SERIES_COLORS[i],
}));

/** Panel that forces a specific theme regardless of app-wide setting, so
 *  both palettes render on the same page for direct comparison. */
function ThemedPanel({ mode, children }: { mode: "light" | "dark"; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<null | "png" | "pdf">(null);

  const capture = async () => {
    // Dynamic imports keep the bundle lean for users who never export.
    const [{ default: html2canvas }] = await Promise.all([import("html2canvas")]);
    const node = ref.current!;
    // html2canvas walks computed styles — set an explicit background so
    // dark panels don't render on a transparent canvas.
    const bg = getComputedStyle(node).backgroundColor || "#ffffff";
    return html2canvas(node, {
      backgroundColor: bg,
      scale: window.devicePixelRatio > 1 ? 2 : 1.5,
      useCORS: true,
      logging: false,
    });
  };

  const download = (dataUrl: string, filename: string) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const exportPng = async () => {
    setBusy("png");
    try {
      const canvas = await capture();
      download(canvas.toDataURL("image/png"), `chart-qa-${mode}.png`);
    } finally {
      setBusy(null);
    }
  };

  const exportPdf = async () => {
    setBusy("pdf");
    try {
      const canvas = await capture();
      const { jsPDF } = await import("jspdf");
      const img = canvas.toDataURL("image/png");
      // Fit to a landscape or portrait letter page based on aspect ratio.
      const landscape = canvas.width >= canvas.height;
      const pdf = new jsPDF({
        orientation: landscape ? "landscape" : "portrait",
        unit: "pt",
        format: "letter",
      });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 24;
      const maxW = pageW - margin * 2;
      const maxH = pageH - margin * 2;
      const ratio = Math.min(maxW / canvas.width, maxH / canvas.height);
      const w = canvas.width * ratio;
      const h = canvas.height * ratio;
      pdf.addImage(img, "PNG", (pageW - w) / 2, (pageH - h) / 2, w, h);
      pdf.save(`chart-qa-${mode}.pdf`);
    } finally {
      setBusy(null);
    }
  };

  // Live contrast audit — re-runs whenever the token stack under this panel
  // changes (mode flip, theme edits, remount).
  const [audit, setAudit] = useState<ContrastCheck[]>([]);
  useLayoutEffect(() => {
    if (!ref.current) return;
    // Defer one frame so any CSS variable inheritance settles first.
    const id = requestAnimationFrame(() => {
      if (ref.current) setAudit(auditChartContrast(ref.current));
    });
    return () => cancelAnimationFrame(id);
  }, [mode]);
  const failures = audit.filter((c) => !c.ok);

  return (
    <div
      ref={ref}
      data-theme-panel={mode}
      className={mode === "dark" ? "dark" : ""}
      style={{
        colorScheme: mode,
        background: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      <div className="rounded-xl border border-border p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            {mode === "dark" ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
            {mode} mode
          </div>
          <div
            className="flex items-center gap-1"
            // Excluded from the capture so buttons don't appear in the export.
            data-html2canvas-ignore="true"
          >
            <Button
              size="sm"
              variant="outline"
              onClick={exportPng}
              disabled={busy !== null}
              aria-label={`Export ${mode} panel as PNG`}
            >
              {busy === "png" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ImageDown className="size-3.5" />
              )}
              <span className="ml-1.5 hidden sm:inline">PNG</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={exportPdf}
              disabled={busy !== null}
              aria-label={`Export ${mode} panel as PDF`}
            >
              {busy === "pdf" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <FileDown className="size-3.5" />
              )}
              <span className="ml-1.5 hidden sm:inline">PDF</span>
            </Button>
          </div>
        </div>

        {/* Contrast audit — inline per-panel so it inherits the correct theme */}
        <div
          role="status"
          aria-live="polite"
          className={
            "rounded-lg border px-3 py-2 text-xs " +
            (failures.length === 0
              ? "border-success/40 bg-success/10 text-foreground"
              : "border-destructive/50 bg-destructive/10 text-foreground")
          }
        >
          <div className="flex items-center gap-2 font-medium">
            {failures.length === 0 ? (
              <ShieldCheck className="size-3.5 text-success" />
            ) : (
              <ShieldAlert className="size-3.5 text-destructive" />
            )}
            Contrast audit ·{" "}
            {failures.length === 0
              ? `all ${audit.length} pairs meet WCAG AA`
              : `${failures.length} of ${audit.length} pairs below AA`}
          </div>
          <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
            {audit.map((c) => (
              <li key={c.label} className="flex items-center gap-2">
                {c.ok ? (
                  <CheckCircle2 className="size-3 shrink-0 text-success" />
                ) : (
                  <AlertTriangle className="size-3 shrink-0 text-destructive" />
                )}
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block size-3 rounded border border-border align-middle"
                    style={{ background: c.bg }}
                  />
                  <span
                    aria-hidden
                    className="inline-block size-3 rounded border border-border align-middle"
                    style={{ background: c.fg }}
                  />
                </span>
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                <span
                  className={
                    "font-mono tabular-nums " +
                    (c.ok ? "text-muted-foreground" : "text-destructive")
                  }
                >
                  {c.ratio.toFixed(2)}:1
                </span>
              </li>
            ))}
          </ul>
        </div>

        {children}
      </div>
    </div>
  );
}

type ChartType = "bar" | "line" | "area" | "donut";

const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: "bar", label: "Bars" },
  { id: "line", label: "Lines" },
  { id: "area", label: "Area" },
  { id: "donut", label: "Donut" },
];

/** Per-card legend state: hidden set + hovered key + toggle. */
function useLegendState() {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  const toggle = (k: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  return { hidden, hovered, setHovered, toggle };
}

const dimFor = (hovered: string | null, k: string, base = 1) =>
  hovered == null || hovered === k ? base : base * 0.2;

type LegendItem = { key: string; label: string; color: string };

/** Standalone, keyboard-accessible legend rendered outside the chart so it
 *  can drive series visibility + hover highlight in a testable way. */
function InteractiveLegend({
  items,
  hidden,
  hovered,
  onToggle,
  onHover,
}: {
  items: LegendItem[];
  hidden: Set<string>;
  hovered: string | null;
  onToggle: (k: string) => void;
  onHover: (k: string | null) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Toggle series visibility"
      data-legend-root=""
      className="mt-2 flex flex-wrap items-center justify-center gap-1.5 pt-2"
    >
      {items.map((it) => {
        const isHidden = hidden.has(it.key);
        const isHovered = hovered === it.key;
        return (
          <button
            key={it.key}
            type="button"
            role="switch"
            aria-checked={!isHidden}
            aria-label={`${it.label} — ${isHidden ? "show" : "hide"} series`}
            data-legend-item=""
            data-series-key={it.key}
            data-hovered={isHovered ? "true" : "false"}
            onClick={() => onToggle(it.key)}
            onMouseEnter={() => onHover(it.key)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(it.key)}
            onBlur={() => onHover(null)}
            className={
              "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
              (isHidden ? "opacity-50 line-through " : "") +
              (isHovered ? "ring-1 ring-ring" : "")
            }
          >
            <span
              aria-hidden
              data-legend-swatch=""
              className="h-2.5 w-2.5 shrink-0 rounded-[2px] border border-border/60"
              style={{ background: it.color }}
            />
            <span>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const cartesianItems: LegendItem[] = seriesKeys.map((k, i) => ({
  key: k,
  label: chartConfig[k].label as string,
  color: SERIES_COLORS[i],
}));

function BarCard() {
  const l = useLegendState();
  return (
    <Card data-chart-card="bar">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Stacked Bars · patterns + tooltip</CardTitle>
        <CardDescription>Hover for tooltip · legend toggles visibility</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[220px] w-full">
          <BarChart data={trend} syncId="qa-cycle">
            <ChartPatternDefs />
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--hairline)" />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={28}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <ChartTooltip cursor={{ fill: "var(--accent)" }} content={<ChartTooltipContent />} />
            {seriesKeys.map((k, i) =>
              l.hidden.has(k) ? null : (
                <Bar
                  key={k}
                  dataKey={k}
                  stackId="stack"
                  fill={seriesPatternFill(i)}
                  fillOpacity={dimFor(l.hovered, k, 1)}
                  radius={[2, 2, 0, 0]}
                />
              ),
            )}
          </BarChart>
        </ChartContainer>
        <InteractiveLegend
          items={cartesianItems}
          hidden={l.hidden}
          hovered={l.hovered}
          onToggle={l.toggle}
          onHover={l.setHovered}
        />
      </CardContent>
    </Card>
  );
}

function LineCard() {
  const l = useLegendState();
  return (
    <Card data-chart-card="line">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Multi-line · dashes, markers, reference</CardTitle>
        <CardDescription>Reference line uses --ring · gridlines use --hairline</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[220px] w-full">
          <LineChart data={trend} syncId="qa-cycle">
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--hairline)" />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={28}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <ReferenceLine y={75} stroke="#ccc" strokeDasharray="4 4" />
            <ChartTooltip
              cursor={{ stroke: "var(--hairline-strong)", strokeWidth: 1 }}
              content={<ChartTooltipContent />}
            />
            {seriesKeys.map((k, i) =>
              l.hidden.has(k) ? null : (
                <Line
                  key={k}
                  dataKey={k}
                  stroke={`var(--color-${k})`}
                  strokeWidth={i === 0 ? 2.5 : 1.75}
                  strokeDasharray={seriesDash(i)}
                  strokeOpacity={dimFor(l.hovered, k, 1)}
                  dot={false}
                  activeDot={renderSeriesMarker(i)}
                />
              ),
            )}
          </LineChart>
        </ChartContainer>
        <InteractiveLegend
          items={cartesianItems}
          hidden={l.hidden}
          hovered={l.hovered}
          onToggle={l.toggle}
          onHover={l.setHovered}
        />
      </CardContent>
    </Card>
  );
}

function AreaCard() {
  const l = useLegendState();
  const areaKeys = seriesKeys.slice(0, 3);
  const items: LegendItem[] = areaKeys.map((k, i) => ({
    key: k,
    label: chartConfig[k].label as string,
    color: SERIES_COLORS[i],
  }));
  return (
    <Card data-chart-card="area">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Stacked area · translucent fills</CardTitle>
        <CardDescription>Verifies fill/stroke pair in both themes</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[220px] w-full">
          <AreaChart data={trend} syncId="qa-cycle">
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--hairline)" />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={28}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <ChartTooltip
              cursor={{ stroke: "var(--hairline-strong)", strokeWidth: 1 }}
              content={<ChartTooltipContent />}
            />
            {areaKeys.map((k, i) =>
              l.hidden.has(k) ? null : (
                <Area
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stackId="1"
                  stroke={`var(--color-${k})`}
                  fill={`var(--color-${k})`}
                  fillOpacity={dimFor(l.hovered, k, 0.35 - i * 0.08)}
                  strokeOpacity={dimFor(l.hovered, k, 1)}
                />
              ),
            )}
          </AreaChart>
        </ChartContainer>
        <InteractiveLegend
          items={items}
          hidden={l.hidden}
          hovered={l.hovered}
          onToggle={l.toggle}
          onHover={l.setHovered}
        />
      </CardContent>
    </Card>
  );
}

function DonutCard() {
  const l = useLegendState();
  const items: LegendItem[] = pieData.map((d, i) => ({
    key: seriesKeys[i],
    label: d.name,
    color: d.fill,
  }));
  const visible = pieData
    .map((d, i) => ({ d, key: seriesKeys[i] }))
    .filter((row) => !l.hidden.has(row.key));
  return (
    <Card data-chart-card="donut">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Donut · legend swatches</CardTitle>
        <CardDescription>Confirms legend chip colors match slices</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[220px] w-full">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
            <Pie
              data={visible.map((r) => r.d)}
              dataKey="value"
              nameKey="name"
              innerRadius={45}
              outerRadius={72}
              stroke="var(--background)"
              strokeWidth={2}
            >
              {visible.map((r) => (
                <Cell key={r.d.name} fill={r.d.fill} fillOpacity={dimFor(l.hovered, r.key, 1)} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <InteractiveLegend
          items={items}
          hidden={l.hidden}
          hovered={l.hovered}
          onToggle={l.toggle}
          onHover={l.setHovered}
        />
      </CardContent>
    </Card>
  );
}

function ChartGrid({ enabled }: { enabled: Set<ChartType> }) {
  const cards: React.ReactNode[] = [];
  if (enabled.has("bar")) cards.push(<BarCard key="bar" />);
  if (enabled.has("line")) cards.push(<LineCard key="line" />);
  if (enabled.has("area")) cards.push(<AreaCard key="area" />);
  if (enabled.has("donut")) cards.push(<DonutCard key="donut" />);

  if (cards.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No chart types selected. Enable one above to preview.
      </div>
    );
  }
  return (
    <div className={cards.length === 1 ? "grid gap-4" : "grid gap-4 md:grid-cols-2"}>{cards}</div>
  );
}

type TesterFinding = { panel: "light" | "dark"; ok: boolean; detail: string };

/** Dispatches synthetic hover on the light panel's first cartesian chart.
 *  Recharts' syncId propagates activeIndex to the dark panel. */
function triggerHoverAt(
  surfaceRef: React.RefObject<HTMLDivElement | null>,
  i: number,
  total: number,
) {
  const root = surfaceRef.current;
  if (!root) return;
  const wrapper = root.querySelector<HTMLElement>('[data-theme-panel="light"] .recharts-wrapper');
  if (!wrapper) return;
  const rect = wrapper.getBoundingClientRect();
  const x = rect.left + (rect.width * (i + 0.5)) / total;
  const y = rect.top + rect.height / 2;
  for (const type of ["mouseover", "mousemove"] as const) {
    wrapper.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        view: window,
      }),
    );
  }
}

function tooltipTextFor(
  surfaceRef: React.RefObject<HTMLDivElement | null>,
  mode: "light" | "dark",
): string | null {
  const panel = surfaceRef.current?.querySelector(`[data-theme-panel="${mode}"]`);
  if (!panel) return null;
  const wrappers = Array.from(panel.querySelectorAll<HTMLElement>(".recharts-tooltip-wrapper"));
  const visible = wrappers.find(
    (w) => w.style.visibility !== "hidden" && w.getBoundingClientRect().width > 0,
  );
  if (!visible) return null;
  return (visible.innerText || "").replace(/\s+/g, " ").trim();
}

function measureTooltipAt(
  surfaceRef: React.RefObject<HTMLDivElement | null>,
  i: number,
): TesterFinding[] {
  const expectedLabels = seriesKeys.map((k) => chartConfig[k].label as string);
  const expectedValues = seriesKeys.map((k) => trend[i][k]);
  const out: TesterFinding[] = [];
  (["light", "dark"] as const).forEach((mode) => {
    const text = tooltipTextFor(surfaceRef, mode);
    if (text == null) {
      out.push({ panel: mode, ok: false, detail: "no tooltip rendered" });
      return;
    }
    const missing = expectedLabels.filter((l) => !text.includes(l));
    const missingVals = expectedValues.filter((v) => !new RegExp(`\\b${v}\\b`).test(text));
    const positions = expectedLabels.map((l) => text.indexOf(l));
    const ordered = positions.every((p, idx) => idx === 0 || (p > 0 && p > positions[idx - 1]));
    let detail: string;
    if (missing.length) detail = `missing series: ${missing.join(", ")}`;
    else if (missingVals.length) detail = `values missing: ${missingVals.join(", ")}`;
    else if (!ordered) detail = "series order differs from config";
    else detail = `${expectedLabels.length} series · values + order match`;
    out.push({
      panel: mode,
      ok: missing.length === 0 && missingVals.length === 0 && ordered,
      detail,
    });
  });
  return out;
}

const waitMs = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/** Cycle every step, collect only failing findings with observed tooltip text. */
async function sweepTesterFailures(surfaceRef: React.RefObject<HTMLDivElement | null>) {
  type Failure = {
    step: number;
    month: string;
    panel: "light" | "dark";
    detail: string;
    expected: { series: string; value: number }[];
    observedTooltipText: string | null;
  };
  const failures: Failure[] = [];
  for (let i = 0; i < trend.length; i++) {
    triggerHoverAt(surfaceRef, i, trend.length);
    await waitMs(80);
    const results = measureTooltipAt(surfaceRef, i);
    for (const r of results) {
      if (r.ok) continue;
      failures.push({
        step: i,
        month: trend[i].month,
        panel: r.panel,
        detail: r.detail,
        expected: seriesKeys.map((k) => ({
          series: chartConfig[k].label as string,
          value: trend[i][k],
        })),
        observedTooltipText: tooltipTextFor(surfaceRef, r.panel),
      });
    }
  }
  return failures;
}

export type SweepStepResult = {
  step: number;
  month: string;
  light: { ok: boolean; detail: string };
  dark: { ok: boolean; detail: string };
};
export type SweepFullSummary = {
  completedAt: string;
  durationMs: number;
  totalSteps: number;
  lightPass: number;
  darkPass: number;
  lightFail: number;
  darkFail: number;
  steps: SweepStepResult[];
};

/** Full-sweep variant: every step, both panels, pass/fail with detail. */
async function sweepFullSummary(
  surfaceRef: React.RefObject<HTMLDivElement | null>,
): Promise<SweepFullSummary> {
  const startedAt = performance.now();
  const steps: SweepStepResult[] = [];
  for (let i = 0; i < trend.length; i++) {
    triggerHoverAt(surfaceRef, i, trend.length);
    await waitMs(90);
    const results = measureTooltipAt(surfaceRef, i);
    const light = results.find((r) => r.panel === "light") ?? { ok: false, detail: "no result" };
    const dark = results.find((r) => r.panel === "dark") ?? { ok: false, detail: "no result" };
    steps.push({
      step: i,
      month: trend[i].month,
      light: { ok: light.ok, detail: light.detail },
      dark: { ok: dark.ok, detail: dark.detail },
    });
  }
  const lightPass = steps.filter((s) => s.light.ok).length;
  const darkPass = steps.filter((s) => s.dark.ok).length;
  return {
    completedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startedAt),
    totalSteps: trend.length,
    lightPass,
    darkPass,
    lightFail: trend.length - lightPass,
    darkFail: trend.length - darkPass,
    steps,
  };
}

/** Snapshot of environment fields useful for reproducing a QA finding.
 *  Included in the QA JSON export and the PDF's failure JSON block. */
export type QaEnvironment = ReturnType<typeof collectQaEnvironment>;
function collectQaEnvironment(appTheme: "light" | "dark") {
  const env = import.meta.env as Record<string, string | undefined>;
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const loc = typeof window !== "undefined" ? window.location : undefined;
  const screen = typeof window !== "undefined" ? window.screen : undefined;
  const prefersDark =
    typeof window !== "undefined" && "matchMedia" in window
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : null;
  return {
    capturedAt: new Date().toISOString(),
    app: {
      url: loc?.href ?? null,
      origin: loc?.origin ?? null,
      pathname: loc?.pathname ?? null,
      hash: loc?.hash ?? null,
      theme: appTheme,
      mode: env.MODE ?? null,
      dev: env.DEV === "true" || (import.meta.env.DEV as boolean),
      version: env.VITE_APP_VERSION ?? null,
      buildId: env.VITE_BUILD_ID ?? env.VITE_COMMIT_SHA ?? null,
    },
    device: {
      devicePixelRatio: typeof window !== "undefined" ? (window.devicePixelRatio ?? 1) : null,
      innerWidth: typeof window !== "undefined" ? window.innerWidth : null,
      innerHeight: typeof window !== "undefined" ? window.innerHeight : null,
      screenWidth: screen?.width ?? null,
      screenHeight: screen?.height ?? null,
      colorDepth: screen?.colorDepth ?? null,
      prefersColorScheme: prefersDark == null ? null : prefersDark ? "dark" : "light",
      userAgent: nav?.userAgent ?? null,
      platform:
        (nav as unknown as { userAgentData?: { platform?: string } })?.userAgentData?.platform ??
        nav?.platform ??
        null,
      language: nav?.language ?? null,
    },
    libraries: {
      recharts: (rechartsPkg as { version?: string }).version ?? null,
      react: reactVersion,
    },
  };
}

/** Drives synchronized hover across both themed panels and validates the
 *  resulting tooltip content — series presence, values, and ordering. */
function InteractionTester({
  surfaceRef,
  hasCartesian,
  viewportLabel,
  enabledTypes,
}: {
  surfaceRef: React.RefObject<HTMLDivElement | null>;
  hasCartesian: boolean;
  viewportLabel: string;
  enabledTypes: string[];
}) {
  const total = trend.length;
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [findings, setFindings] = useState<TesterFinding[]>([]);

  const trigger = (i: number) => triggerHoverAt(surfaceRef, i, total);
  const measureAt = (i: number) => measureTooltipAt(surfaceRef, i);
  const measure = (i: number) => setFindings(measureAt(i));

  // --- Run full interaction test ------------------------------------------
  type StepResult = {
    step: number;
    month: string;
    light: { ok: boolean; detail: string };
    dark: { ok: boolean; detail: string };
  };
  type SweepSummary = {
    completedAt: string;
    durationMs: number;
    totalSteps: number;
    lightPass: number;
    darkPass: number;
    lightFail: number;
    darkFail: number;
    steps: StepResult[];
  };
  const [sweepState, setSweepState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [sweepProgress, setSweepProgress] = useState(0);
  const [sweepSummary, setSweepSummary] = useState<SweepSummary | null>(null);

  // --- Saved runs (localStorage, cap 10, with compare) --------------------
  type SavedRun = {
    id: string;
    savedAt: string;
    viewportLabel: string;
    enabledTypes: string[];
    summary: SweepSummary;
  };
  const SAVED_RUNS_KEY = "chart-qa:saved-runs";
  const SAVED_RUNS_CAP = 10;
  const [savedRuns, setSavedRuns] = useState<SavedRun[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_RUNS_KEY);
      if (raw) setSavedRuns(JSON.parse(raw) as SavedRun[]);
    } catch (e) {
      console.warn("failed to load saved runs", e);
    }
  }, []);
  const persistRuns = (next: SavedRun[]) => {
    setSavedRuns(next);
    try {
      window.localStorage.setItem(SAVED_RUNS_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn("failed to persist saved runs", e);
    }
  };
  const saveCurrentRun = () => {
    if (!sweepSummary) return;
    const run: SavedRun = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      savedAt: new Date().toISOString(),
      viewportLabel,
      enabledTypes,
      summary: sweepSummary,
    };
    persistRuns([run, ...savedRuns].slice(0, SAVED_RUNS_CAP));
  };
  const deleteRun = (id: string) => {
    persistRuns(savedRuns.filter((r) => r.id !== id));
    setCompareIds((ids) => ids.filter((x) => x !== id));
  };
  const clearRuns = () => {
    persistRuns([]);
    setCompareIds([]);
  };
  const toggleCompare = (id: string) => {
    setCompareIds((ids) => {
      if (ids.includes(id)) return ids.filter((x) => x !== id);
      const next = [...ids, id];
      return next.length > 2 ? next.slice(next.length - 2) : next;
    });
  };

  const runFullTest = async () => {
    setPlaying(false);
    setSweepState("running");
    setSweepProgress(0);
    setSweepSummary(null);
    const startedAt = performance.now();
    try {
      const startStep = step;
      const steps: StepResult[] = [];
      for (let i = 0; i < total; i++) {
        setStep(i);
        setSweepProgress(i + 1);
        trigger(i);
        // Two frames of settle time so recharts commits the active tooltip.
        await wait(90);
        const results = measureAt(i);
        const light = results.find((r) => r.panel === "light") ?? {
          ok: false,
          detail: "no result",
        };
        const dark = results.find((r) => r.panel === "dark") ?? { ok: false, detail: "no result" };
        steps.push({
          step: i,
          month: trend[i].month,
          light: { ok: light.ok, detail: light.detail },
          dark: { ok: dark.ok, detail: dark.detail },
        });
      }
      // Restore the step the user was on and refresh live findings.
      setStep(startStep);
      trigger(startStep);
      await wait(60);
      setFindings(measureAt(startStep));

      const lightPass = steps.filter((s) => s.light.ok).length;
      const darkPass = steps.filter((s) => s.dark.ok).length;
      setSweepSummary({
        completedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - startedAt),
        totalSteps: total,
        lightPass,
        darkPass,
        lightFail: total - lightPass,
        darkFail: total - darkPass,
        steps,
      });
      setSweepState("done");
    } catch (err) {
      console.error("runFullTest failed", err);
      setSweepState("error");
    }
  };

  // --- Copy failures: sweep every step, collect only failing entries ------
  const [copyState, setCopyState] = useState<"idle" | "running" | "copied" | "clean" | "error">(
    "idle",
  );
  const [copyCount, setCopyCount] = useState(0);
  const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

  const copyFailures = async () => {
    setCopyState("running");
    setPlaying(false);
    try {
      type Failure = {
        step: number;
        month: string;
        panel: "light" | "dark";
        detail: string;
        expected: { series: string; value: number }[];
        observedTooltipText: string | null;
      };
      const failures: Failure[] = [];
      const startStep = step;
      for (let i = 0; i < total; i++) {
        setStep(i);
        trigger(i);
        // Let recharts settle before reading the DOM.
        await wait(80);
        const results = measureAt(i);
        for (const r of results) {
          if (r.ok) continue;
          const panelEl = surfaceRef.current?.querySelector(`[data-theme-panel="${r.panel}"]`);
          const visible = panelEl
            ? Array.from(panelEl.querySelectorAll<HTMLElement>(".recharts-tooltip-wrapper")).find(
                (w) => w.style.visibility !== "hidden" && w.getBoundingClientRect().width > 0,
              )
            : null;
          failures.push({
            step: i,
            month: trend[i].month,
            panel: r.panel,
            detail: r.detail,
            expected: seriesKeys.map((k) => ({
              series: chartConfig[k].label as string,
              value: trend[i][k],
            })),
            observedTooltipText: visible
              ? (visible.innerText || "").replace(/\s+/g, " ").trim()
              : null,
          });
        }
      }
      // Restore prior step + refresh visible findings.
      setStep(startStep);
      trigger(startStep);
      await wait(60);
      setFindings(measureAt(startStep));

      const payload = {
        tool: "chart-preview interaction tester",
        capturedAt: new Date().toISOString(),
        route: "/chart-preview",
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        viewport:
          typeof window !== "undefined"
            ? { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio }
            : null,
        expectedSeriesOrder: seriesKeys.map((k) => chartConfig[k].label as string),
        totalSteps: total,
        failureCount: failures.length,
        failures,
      };
      const json = JSON.stringify(payload, null, 2);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
      } else {
        // Fallback for insecure contexts
        const ta = document.createElement("textarea");
        ta.value = json;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setCopyCount(failures.length);
      setCopyState(failures.length === 0 ? "clean" : "copied");
    } catch (err) {
      console.error("copyFailures failed", err);
      setCopyState("error");
    } finally {
      window.setTimeout(() => setCopyState("idle"), 2400);
    }
  };

  // Fire the hover, then measure after recharts re-renders the tooltip.
  useEffect(() => {
    if (!hasCartesian) {
      setFindings([]);
      return;
    }
    trigger(step);
    const id = window.setTimeout(() => measure(step), 60);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, hasCartesian]);

  // Auto-cycle
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % total), 900);
    return () => window.clearInterval(id);
  }, [playing, total]);

  // Keyboard: ←/→ step, space toggles play, R resets
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setStep((s) => (s + 1) % total);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setStep((s) => (s - 1 + total) % total);
      } else if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key.toLowerCase() === "r") {
        setPlaying(false);
        setStep(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total]);

  const label = trend[step].month;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          Interaction tester{" "}
          <span className="ml-1 font-normal text-muted-foreground">
            step {step + 1}/{total} · {label}
          </span>
        </CardTitle>
        <CardDescription>
          Cycles hover across cartesian charts and validates tooltip series, values, and order in
          both themes. Keys: ← → step · space play/pause · R reset.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Interaction tester controls"
        >
          <Button
            size="sm"
            variant="outline"
            onClick={() => setStep((s) => (s - 1 + total) % total)}
            aria-label="Previous data point"
            disabled={!hasCartesian}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            size="sm"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause cycle" : "Play cycle"}
            disabled={!hasCartesian}
          >
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            <span className="ml-1.5">{playing ? "Pause" : "Play"}</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setStep((s) => (s + 1) % total)}
            aria-label="Next data point"
            disabled={!hasCartesian}
          >
            <ChevronRight className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setPlaying(false);
              setStep(0);
            }}
            aria-label="Reset tester"
            disabled={!hasCartesian}
          >
            <RotateCcw className="size-3.5" />
            <span className="ml-1.5">Reset</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={copyFailures}
            disabled={!hasCartesian || copyState === "running"}
            aria-label="Sweep every step and copy failures as JSON"
            title="Cycles all steps, collects tooltip/order mismatches, and copies structured JSON to your clipboard"
          >
            {copyState === "running" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : copyState === "copied" || copyState === "clean" ? (
              <ClipboardCheck className="size-3.5" />
            ) : (
              <Clipboard className="size-3.5" />
            )}
            <span className="ml-1.5">
              {copyState === "running"
                ? "Sweeping…"
                : copyState === "copied"
                  ? `Copied ${copyCount}`
                  : copyState === "clean"
                    ? "No failures"
                    : copyState === "error"
                      ? "Copy failed"
                      : "Copy failures"}
            </span>
          </Button>
          <Button
            size="sm"
            onClick={runFullTest}
            disabled={!hasCartesian || sweepState === "running"}
            aria-label="Run full interaction test across all steps"
            title="Cycles all steps in order and shows a per-panel pass/fail summary"
          >
            {sweepState === "running" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="size-3.5" />
            )}
            <span className="ml-1.5">
              {sweepState === "running"
                ? `Testing ${sweepProgress}/${total}`
                : sweepState === "error"
                  ? "Retry full test"
                  : sweepSummary
                    ? "Re-run full test"
                    : "Run full interaction test"}
            </span>
          </Button>
          <div className="ml-auto flex items-center gap-1" aria-hidden>
            {trend.map((row, i) => (
              <button
                key={row.month}
                type="button"
                onClick={() => setStep(i)}
                className={
                  "h-1.5 w-6 rounded-full transition " +
                  (i === step ? "bg-primary" : "bg-muted hover:bg-muted-foreground/40")
                }
                title={row.month}
                aria-label={`Jump to ${row.month}`}
              />
            ))}
          </div>
        </div>

        {!hasCartesian ? (
          <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
            Enable a bar, line, or area chart to run the tester.
          </div>
        ) : (
          <ul role="status" aria-live="polite" className="grid gap-1.5 sm:grid-cols-2">
            {(["light", "dark"] as const).map((mode) => {
              const f = findings.find((x) => x.panel === mode);
              const ok = f?.ok ?? false;
              return (
                <li
                  key={mode}
                  className={
                    "flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs " +
                    (f == null
                      ? "border-border bg-muted/40 text-muted-foreground"
                      : ok
                        ? "border-success/40 bg-success/10"
                        : "border-destructive/50 bg-destructive/10")
                  }
                >
                  {mode === "dark" ? (
                    <Moon className="mt-0.5 size-3.5 shrink-0" />
                  ) : (
                    <Sun className="mt-0.5 size-3.5 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium capitalize">
                      {mode} · {f == null ? "measuring…" : ok ? "pass" : "fail"}
                    </div>
                    <div className="text-muted-foreground truncate">
                      {f?.detail ?? "waiting for tooltip"}
                    </div>
                  </div>
                  {f != null &&
                    (ok ? (
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                    ))}
                </li>
              );
            })}
          </ul>
        )}

        {/* Progress bar while a full sweep is running */}
        {sweepState === "running" && (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={sweepProgress}
            aria-label="Full interaction test progress"
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-[width] duration-150"
              style={{ width: `${(sweepProgress / total) * 100}%` }}
            />
          </div>
        )}

        {/* Final full-sweep summary */}
        {sweepSummary && sweepState !== "running" && (
          <section
            aria-label="Full interaction test summary"
            className="rounded-lg border border-border bg-card/40 p-3 text-xs"
          >
            <header className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-medium">Full test summary</span>
              <span className="text-muted-foreground">
                {sweepSummary.totalSteps} steps · {sweepSummary.durationMs} ms ·{" "}
                {new Date(sweepSummary.completedAt).toLocaleTimeString()}
              </span>
              {(() => {
                const overallOk = sweepSummary.lightFail === 0 && sweepSummary.darkFail === 0;
                return (
                  <span
                    className={
                      "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium " +
                      (overallOk
                        ? "bg-success/15 text-success"
                        : "bg-destructive/15 text-destructive")
                    }
                  >
                    {overallOk ? (
                      <CheckCircle2 className="size-3" />
                    ) : (
                      <AlertTriangle className="size-3" />
                    )}
                    {overallOk ? "All checks passed" : "Failures detected"}
                  </span>
                );
              })()}
            </header>

            <div className="grid gap-2 sm:grid-cols-2">
              {(["light", "dark"] as const).map((mode) => {
                const pass = mode === "light" ? sweepSummary.lightPass : sweepSummary.darkPass;
                const fail = mode === "light" ? sweepSummary.lightFail : sweepSummary.darkFail;
                const failingSteps = sweepSummary.steps.filter((s) => !s[mode].ok);
                return (
                  <div
                    key={mode}
                    className={
                      "rounded-md border px-2.5 py-2 " +
                      (fail === 0
                        ? "border-success/40 bg-success/10"
                        : "border-destructive/50 bg-destructive/10")
                    }
                  >
                    <div className="flex items-center gap-2 font-medium">
                      {mode === "dark" ? (
                        <Moon className="size-3.5" />
                      ) : (
                        <Sun className="size-3.5" />
                      )}
                      <span className="capitalize">{mode}</span>
                      <span
                        className={
                          "ml-auto tabular-nums " +
                          (fail === 0 ? "text-success" : "text-destructive")
                        }
                      >
                        {pass}/{sweepSummary.totalSteps} pass
                      </span>
                    </div>
                    {fail === 0 ? (
                      <div className="mt-1 text-muted-foreground">
                        Every step produced the expected tooltip content and order.
                      </div>
                    ) : (
                      <ul className="mt-1 space-y-0.5">
                        {failingSteps.map((s) => (
                          <li key={s.step} className="flex items-start gap-1.5">
                            <AlertTriangle className="mt-0.5 size-3 shrink-0 text-destructive" />
                            <span className="min-w-0 flex-1">
                              <span className="font-mono">
                                step {s.step + 1} · {s.month}
                              </span>{" "}
                              <span className="text-muted-foreground">— {s[mode].detail}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Saved runs + compare */}
        {(sweepSummary || savedRuns.length > 0) && (
          <section
            aria-label="Saved interaction test runs"
            className="rounded-lg border border-border bg-card/40 p-3 text-xs"
          >
            <header className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-medium">Saved runs</span>
              <span className="text-muted-foreground">
                {savedRuns.length}/{SAVED_RUNS_CAP}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={saveCurrentRun}
                  disabled={!sweepSummary}
                  title={
                    sweepSummary
                      ? "Save the most recent full test summary (keeps the last 10)"
                      : "Run the full interaction test first to save a run"
                  }
                >
                  <Save className="size-3.5" />
                  <span className="ml-1.5">Save this run</span>
                </Button>
                {savedRuns.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearRuns}
                    title="Delete all saved runs"
                  >
                    <Trash2 className="size-3.5" />
                    <span className="ml-1.5">Clear</span>
                  </Button>
                )}
              </div>
            </header>

            {savedRuns.length === 0 ? (
              <p className="text-muted-foreground">
                Save runs to compare tooltip pass/fail across viewports and chart types.
              </p>
            ) : (
              <>
                <p className="mb-1.5 text-[11px] text-muted-foreground">
                  Tick two runs to compare. History keeps the last {SAVED_RUNS_CAP}.
                </p>
                <ul className="divide-y divide-border rounded-md border border-border/60">
                  {savedRuns.map((r) => {
                    const s = r.summary;
                    const ok = s.lightFail === 0 && s.darkFail === 0;
                    const checked = compareIds.includes(r.id);
                    const disable = !checked && compareIds.length >= 2;
                    return (
                      <li key={r.id} className="flex items-center gap-2 px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disable}
                          onChange={() => toggleCompare(r.id)}
                          aria-label={`Select run from ${new Date(r.savedAt).toLocaleString()}`}
                          className="size-3 accent-primary disabled:opacity-40"
                        />
                        <span
                          className={
                            "inline-flex size-4 items-center justify-center rounded-full " +
                            (ok
                              ? "bg-success/20 text-success"
                              : "bg-destructive/20 text-destructive")
                          }
                          aria-hidden
                        >
                          {ok ? (
                            <CheckCircle2 className="size-3" />
                          ) : (
                            <AlertTriangle className="size-3" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-mono">{new Date(r.savedAt).toLocaleString()}</span>{" "}
                          <span className="text-muted-foreground">
                            · {r.viewportLabel} ·{" "}
                            {r.enabledTypes.length > 0 ? r.enabledTypes.join(", ") : "no charts"}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          L {s.lightPass}/{s.totalSteps} · D {s.darkPass}/{s.totalSteps}
                        </span>
                        <button
                          type="button"
                          onClick={() => deleteRun(r.id)}
                          aria-label="Delete saved run"
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {/* Compare panel: two runs side by side + failure diff */}
                {compareIds.length === 2 &&
                  (() => {
                    const a = savedRuns.find((r) => r.id === compareIds[0]);
                    const b = savedRuns.find((r) => r.id === compareIds[1]);
                    if (!a || !b) return null;
                    const keyOf = (step: number, mode: "light" | "dark", detail: string) =>
                      `${mode}:${step}:${detail}`;
                    const failsOf = (r: SavedRun) => {
                      const set = new Set<string>();
                      const map = new Map<
                        string,
                        { step: number; month: string; mode: "light" | "dark"; detail: string }
                      >();
                      for (const s of r.summary.steps) {
                        (["light", "dark"] as const).forEach((mode) => {
                          if (!s[mode].ok) {
                            const k = keyOf(s.step, mode, s[mode].detail);
                            set.add(k);
                            map.set(k, {
                              step: s.step,
                              month: s.month,
                              mode,
                              detail: s[mode].detail,
                            });
                          }
                        });
                      }
                      return { set, map };
                    };
                    const fa = failsOf(a);
                    const fb = failsOf(b);
                    const added = [...fb.set]
                      .filter((k) => !fa.set.has(k))
                      .map((k) => fb.map.get(k)!);
                    const removed = [...fa.set]
                      .filter((k) => !fb.set.has(k))
                      .map((k) => fa.map.get(k)!);
                    const shared = [...fa.set]
                      .filter((k) => fb.set.has(k))
                      .map((k) => fa.map.get(k)!);
                    const Row = ({
                      title,
                      items,
                      tone,
                    }: {
                      title: string;
                      items: {
                        step: number;
                        month: string;
                        mode: "light" | "dark";
                        detail: string;
                      }[];
                      tone: "added" | "removed" | "shared";
                    }) => (
                      <div>
                        <div
                          className={
                            "mb-1 font-medium " +
                            (tone === "added"
                              ? "text-destructive"
                              : tone === "removed"
                                ? "text-success"
                                : "text-muted-foreground")
                          }
                        >
                          {title} ({items.length})
                        </div>
                        {items.length === 0 ? (
                          <div className="text-muted-foreground">—</div>
                        ) : (
                          <ul className="space-y-0.5">
                            {items.map((f, i) => (
                              <li key={i} className="font-mono text-[11px]">
                                [{f.mode[0].toUpperCase()}] step {f.step + 1} · {f.month}{" "}
                                <span className="text-muted-foreground">— {f.detail}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                    return (
                      <div className="mt-3 rounded-md border border-border bg-background/60 p-2.5">
                        <div className="mb-2 flex items-center gap-2 font-medium">
                          <GitCompare className="size-3.5" />
                          Comparing runs
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {[a, b].map((r, idx) => (
                            <div
                              key={r.id}
                              className="rounded-md border border-border/60 bg-card/60 p-2"
                            >
                              <div className="text-[11px] text-muted-foreground">
                                Run {idx === 0 ? "A" : "B"}
                              </div>
                              <div className="font-mono">
                                {new Date(r.savedAt).toLocaleString()}
                              </div>
                              <div className="text-muted-foreground">
                                {r.viewportLabel} ·{" "}
                                {r.enabledTypes.length > 0
                                  ? r.enabledTypes.join(", ")
                                  : "no charts"}
                              </div>
                              <div className="mt-1 tabular-nums">
                                Light {r.summary.lightPass}/{r.summary.totalSteps} · Dark{" "}
                                {r.summary.darkPass}/{r.summary.totalSteps} · {r.summary.durationMs}{" "}
                                ms
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-3">
                          <Row title="New failures in B" items={added} tone="added" />
                          <Row title="Fixed in B" items={removed} tone="removed" />
                          <Row title="Still failing" items={shared} tone="shared" />
                        </div>
                      </div>
                    );
                  })()}
              </>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------
// Legend interaction tester
// -----------------------------------------------------------------------

type LegendCheckKind =
  | "label"
  | "swatch"
  | "focus"
  | "hover"
  | "toggle-hide"
  | "toggle-show"
  | "keyboard-role";

type LegendCheck = {
  panel: "light" | "dark";
  card: string;
  key: string;
  kind: LegendCheckKind;
  ok: boolean;
  detail: string;
};

/** Count series-drawing groups in a card so we can prove a click actually
 *  hides / restores the series in the chart, not just the legend chip. */
function countSeriesElements(card: Element): number {
  return card.querySelectorAll(
    ".recharts-bar, .recharts-line, .recharts-area, .recharts-pie-sector",
  ).length;
}

async function runLegendSweep(
  surfaceRef: React.RefObject<HTMLDivElement | null>,
): Promise<LegendCheck[]> {
  const findings: LegendCheck[] = [];
  const root = surfaceRef.current;
  if (!root) return findings;
  for (const mode of ["light", "dark"] as const) {
    const panelEl = root.querySelector(`[data-theme-panel="${mode}"]`);
    if (!panelEl) continue;
    const cards = Array.from(panelEl.querySelectorAll<HTMLElement>("[data-chart-card]"));
    for (const card of cards) {
      const cardType = card.getAttribute("data-chart-card") || "?";
      const items = Array.from(card.querySelectorAll<HTMLButtonElement>("[data-legend-item]"));
      // Basic role/keyboard reachability check (once per card).
      findings.push({
        panel: mode,
        card: cardType,
        key: "*",
        kind: "keyboard-role",
        ok:
          items.length > 0 &&
          items.every((b) => b.getAttribute("role") === "switch" && b.tabIndex >= 0),
        detail:
          items.length === 0
            ? "no legend items rendered"
            : `${items.length} switch(es), all tabbable`,
      });

      for (const btn of items) {
        const key = btn.getAttribute("data-series-key") || "?";
        const expectedLabel =
          (chartConfig[key as keyof typeof chartConfig]?.label as string) ?? key;
        const actualLabel = (btn.textContent || "").trim();

        // Label ordering / text
        findings.push({
          panel: mode,
          card: cardType,
          key,
          kind: "label",
          ok: actualLabel === expectedLabel,
          detail:
            actualLabel === expectedLabel
              ? `"${actualLabel}"`
              : `expected "${expectedLabel}", got "${actualLabel}"`,
        });

        // Swatch color is set (not transparent)
        const swatch = btn.querySelector<HTMLElement>("[data-legend-swatch]");
        const bg = swatch ? getComputedStyle(swatch).backgroundColor : "";
        const swatchOk = !!bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
        findings.push({
          panel: mode,
          card: cardType,
          key,
          kind: "swatch",
          ok: swatchOk,
          detail: swatchOk ? bg : "swatch missing or transparent",
        });

        // Focus → item should reflect keyboard reachability & hover state.
        btn.focus();
        await waitMs(0);
        const focusOk = document.activeElement === btn;
        findings.push({
          panel: mode,
          card: cardType,
          key,
          kind: "focus",
          ok: focusOk,
          detail: focusOk ? "received focus" : "focus() did not land",
        });

        // Hover — dataset flag should flip to true; wait a tick for react.
        btn.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        await waitMs(20);
        const hoverOk = btn.getAttribute("data-hovered") === "true";
        findings.push({
          panel: mode,
          card: cardType,
          key,
          kind: "hover",
          ok: hoverOk,
          detail: `data-hovered=${btn.getAttribute("data-hovered")}`,
        });

        // Click to hide → aria-checked flips + chart series count drops 1.
        const before = countSeriesElements(card);
        btn.click();
        await waitMs(80);
        const afterHide = countSeriesElements(card);
        const hideAria = btn.getAttribute("aria-checked");
        const hideOk = hideAria === "false" && afterHide === before - 1;
        findings.push({
          panel: mode,
          card: cardType,
          key,
          kind: "toggle-hide",
          ok: hideOk,
          detail: `aria-checked=${hideAria}, series ${before}→${afterHide}`,
        });

        // Click to show → restore.
        btn.click();
        await waitMs(80);
        const afterShow = countSeriesElements(card);
        const showAria = btn.getAttribute("aria-checked");
        const showOk = showAria === "true" && afterShow === before;
        findings.push({
          panel: mode,
          card: cardType,
          key,
          kind: "toggle-show",
          ok: showOk,
          detail: `aria-checked=${showAria}, series restored to ${afterShow}`,
        });

        // Cleanup hover / focus so subsequent items measure cleanly.
        btn.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
        btn.blur();
        await waitMs(0);
      }
    }
  }
  return findings;
}

function LegendTester({
  surfaceRef,
  hasAnyChart,
}: {
  surfaceRef: React.RefObject<HTMLDivElement | null>;
  hasAnyChart: boolean;
}) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [findings, setFindings] = useState<LegendCheck[]>([]);
  const [copyFlash, setCopyFlash] = useState<"idle" | "copied" | "error">("idle");

  const run = async () => {
    setState("running");
    try {
      const results = await runLegendSweep(surfaceRef);
      setFindings(results);
      setState("done");
    } catch (err) {
      console.error("LegendTester run failed", err);
      setState("error");
    }
  };

  const copyJson = async () => {
    try {
      const failures = findings.filter((f) => !f.ok);
      const payload = {
        tool: "chart-preview legend tester",
        capturedAt: new Date().toISOString(),
        totalChecks: findings.length,
        failureCount: failures.length,
        failures,
      };
      const json = JSON.stringify(payload, null, 2);
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(json);
      setCopyFlash("copied");
    } catch (err) {
      console.error("copy failed", err);
      setCopyFlash("error");
    } finally {
      window.setTimeout(() => setCopyFlash("idle"), 1800);
    }
  };

  // Group failing findings by panel for the summary lists.
  const failing = findings.filter((f) => !f.ok);
  const byPanel = (mode: "light" | "dark") => failing.filter((f) => f.panel === mode);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Legend interaction tester</CardTitle>
        <CardDescription>
          Exercises focus, hover, and click on every legend switch in both themes to validate
          labels, swatch colors, keyboard reachability, and that toggling a series really adds or
          removes it from the chart.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Legend tester controls"
        >
          <Button size="sm" onClick={run} disabled={!hasAnyChart || state === "running"}>
            {state === "running" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            <span className="ml-1.5">
              {state === "running" ? "Running…" : findings.length ? "Re-run" : "Run tests"}
            </span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={copyJson}
            disabled={findings.length === 0}
            aria-label="Copy legend failures as JSON"
          >
            {copyFlash === "copied" ? (
              <ClipboardCheck className="size-3.5" />
            ) : (
              <Clipboard className="size-3.5" />
            )}
            <span className="ml-1.5">
              {copyFlash === "copied"
                ? `Copied ${failing.length}`
                : copyFlash === "error"
                  ? "Copy failed"
                  : "Copy failures"}
            </span>
          </Button>
          {findings.length > 0 && (
            <div className="ml-auto text-xs text-muted-foreground">
              {findings.length - failing.length}/{findings.length} passed
            </div>
          )}
        </div>

        {!hasAnyChart ? (
          <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
            Enable at least one chart to run the legend tester.
          </div>
        ) : findings.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
            Not run yet. Click <span className="font-medium">Run tests</span> to sweep every legend
            switch.
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {(["light", "dark"] as const).map((mode) => {
              const panelFails = byPanel(mode);
              const totalInPanel = findings.filter((f) => f.panel === mode).length;
              return (
                <div
                  key={mode}
                  className={
                    "rounded-md border px-3 py-2 text-xs " +
                    (panelFails.length === 0
                      ? "border-success/40 bg-success/10"
                      : "border-destructive/50 bg-destructive/10")
                  }
                >
                  <div className="flex items-center gap-2 font-medium">
                    {mode === "dark" ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
                    <span className="capitalize">{mode}</span>
                    {panelFails.length === 0 ? (
                      <span className="ml-auto inline-flex items-center gap-1 text-success">
                        <CheckCircle2 className="size-3" />
                        {totalInPanel} passed
                      </span>
                    ) : (
                      <span className="ml-auto inline-flex items-center gap-1 text-destructive">
                        <AlertTriangle className="size-3" />
                        {panelFails.length} of {totalInPanel} failed
                      </span>
                    )}
                  </div>
                  {panelFails.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {panelFails.slice(0, 8).map((f, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <AlertTriangle className="mt-0.5 size-3 shrink-0 text-destructive" />
                          <span className="min-w-0 flex-1">
                            <span className="font-mono">
                              {f.card}·{f.key}·{f.kind}
                            </span>{" "}
                            <span className="text-muted-foreground">— {f.detail}</span>
                          </span>
                        </li>
                      ))}
                      {panelFails.length > 8 && (
                        <li className="text-muted-foreground">
                          +{panelFails.length - 8} more · use Copy failures for full list
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChartPreview() {
  // Snapshot the app-wide theme once so toggling this page's local previews
  // doesn't fight the global setting when the user leaves.
  const [appDark, setAppDark] = useState(false);
  useEffect(() => {
    setAppDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleApp = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    setAppDark(next);
  };

  const [enabled, setEnabled] = useState<Set<ChartType>>(
    () => new Set<ChartType>(CHART_TYPES.map((t) => t.id)),
  );
  const toggleType = (id: ChartType) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allOn = enabled.size === CHART_TYPES.length;

  // --- Responsive workspace ------------------------------------------------
  // A viewport picker constrains the preview area to a fixed pixel width so
  // charts can be QA'd at common breakpoints without resizing the browser.
  const BREAKPOINTS = [
    { id: "mobile", label: "375", width: 375, Icon: Smartphone },
    { id: "mobile-lg", label: "640", width: 640, Icon: Smartphone },
    { id: "tablet", label: "768", width: 768, Icon: Tablet },
    { id: "laptop", label: "1024", width: 1024, Icon: Monitor },
    { id: "full", label: "Full", width: null as number | null, Icon: Maximize2 },
  ] as const;
  const [vp, setVp] = useState<(typeof BREAKPOINTS)[number]["id"]>("full");
  const current = BREAKPOINTS.find((b) => b.id === vp)!;

  // Auto-run layout checks against whatever's inside the preview surface.
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [issues, setIssues] = useState<{ label: string; ok: boolean; hint?: string }[]>([]);
  useLayoutEffect(() => {
    const node = surfaceRef.current;
    if (!node) return;
    const run = () => {
      const checks: { label: string; ok: boolean; hint?: string }[] = [];
      const surfaces = Array.from(node.querySelectorAll(".recharts-surface")) as SVGElement[];
      const narrowest = surfaces.reduce(
        (min, s) => Math.min(min, s.getBoundingClientRect().width),
        Infinity,
      );
      checks.push({
        label: "Chart plot ≥ 280px wide",
        ok: !isFinite(narrowest) || narrowest >= 280,
        hint: isFinite(narrowest) ? `narrowest: ${Math.round(narrowest)}px` : undefined,
      });

      // Legend rows shouldn't overflow horizontally at this width.
      const legends = Array.from(
        node.querySelectorAll<HTMLElement>('[class*="ChartLegend"], .recharts-legend-wrapper'),
      );
      const legendOverflow = legends.some((el) => el.scrollWidth > el.clientWidth + 1);
      checks.push({
        label: "Legend fits without horizontal scroll",
        ok: !legendOverflow,
        hint: legendOverflow ? "reduce series or wrap items" : undefined,
      });

      // X-axis tick label overlap: check any two adjacent ticks aren't tighter
      // than their combined half-widths.
      let axisCollision = false;
      surfaces.forEach((svg) => {
        const ticks = Array.from(
          svg.querySelectorAll<SVGGElement>(".recharts-xAxis .recharts-cartesian-axis-tick text"),
        );
        const boxes = ticks.map((t) => t.getBoundingClientRect()).sort((a, b) => a.left - b.left);
        for (let i = 1; i < boxes.length; i++) {
          if (boxes[i].left < boxes[i - 1].right + 2) {
            axisCollision = true;
            break;
          }
        }
      });
      checks.push({
        label: "X-axis tick labels don't overlap",
        ok: !axisCollision,
        hint: axisCollision ? "rotate ticks or thin values" : undefined,
      });

      // Card headers/titles should not be truncated below readable width.
      const headers = Array.from(
        node.querySelectorAll<HTMLElement>("[data-slot='card-title'], .text-sm"),
      );
      const truncated = headers.some(
        (h) => h.scrollWidth > h.clientWidth + 1 && h.textContent && h.textContent.length > 6,
      );
      checks.push({
        label: "Card titles fit without clipping",
        ok: !truncated,
      });

      setIssues(checks);
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(node);
    return () => ro.disconnect();
  }, [vp, enabled, appDark]);

  const hasCartesian = enabled.has("bar") || enabled.has("line") || enabled.has("area");

  // --- QA PDF export -------------------------------------------------------
  const [pdfState, setPdfState] = useState<"idle" | "running" | "done" | "error">("idle");
  const { requestExport: requestJsonExport, dialog: jsonConfirmDialog } = useCsvExportConfirm();

  // Shared helper: write a JSON payload to a downloadable file.
  const emitJsonFile = (payload: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  const INCLUDE_SUMMARY_KEY = "chart-qa:include-sweep-summary";
  const INCLUDE_FAILURE_JSON_KEY = "chart-qa:include-failure-json";
  const INCLUDE_ENV_KEY = "chart-qa:include-env-block";
  const LEGACY_INCLUDE_KEY = "chart-qa:include-interaction-results";

  // SSR-safe defaults. Real values are loaded from localStorage after mount
  // to avoid a hydration mismatch (server has no localStorage). A ref gates
  // the persist effects so the SSR-default doesn't clobber a stored value
  // during the first post-hydration render.
  const [includeSweepSummary, setIncludeSweepSummary] = useState(false);
  const [includeFailureJson, setIncludeFailureJson] = useState(false);
  const [includeEnvBlock, setIncludeEnvBlock] = useState(true);
  const prefsLoaded = useRef(false);
  useEffect(() => {
    try {
      const legacy = window.localStorage.getItem(LEGACY_INCLUDE_KEY);
      const rawSummary = window.localStorage.getItem(INCLUDE_SUMMARY_KEY);
      const rawJson = window.localStorage.getItem(INCLUDE_FAILURE_JSON_KEY);
      const rawEnv = window.localStorage.getItem(INCLUDE_ENV_KEY);
      // Migrate the legacy combined key only when the specific key is unset.
      if (rawSummary != null) setIncludeSweepSummary(rawSummary === "true");
      else if (legacy != null) setIncludeSweepSummary(legacy === "true");
      if (rawJson != null) setIncludeFailureJson(rawJson === "true");
      else if (legacy != null) setIncludeFailureJson(legacy === "true");
      // Env-block default is on; env pref is independent of the legacy key.
      if (rawEnv != null) setIncludeEnvBlock(rawEnv === "true");
    } catch (e) {
      console.warn("failed to load QA prefs", e);
    } finally {
      prefsLoaded.current = true;
    }
  }, []);
  const persistPref = (key: string, value: boolean) => {
    if (!prefsLoaded.current) return; // don't overwrite stored value with SSR default
    try {
      window.localStorage.setItem(key, value ? "true" : "false");
    } catch (e) {
      console.warn(`failed to persist ${key}`, e);
    }
  };
  useEffect(() => persistPref(INCLUDE_SUMMARY_KEY, includeSweepSummary), [includeSweepSummary]);
  useEffect(() => persistPref(INCLUDE_FAILURE_JSON_KEY, includeFailureJson), [includeFailureJson]);
  useEffect(() => persistPref(INCLUDE_ENV_KEY, includeEnvBlock), [includeEnvBlock]);

  const downloadQaPdf = async () => {
    setPdfState("running");
    try {
      const [{ jsPDF }, html2canvasMod] = await Promise.all([
        import("jspdf"),
        import("html2canvas"),
      ]);
      const html2canvas = html2canvasMod.default;

      // 1. Snapshot layout checklist (already in state)
      const layout = issues.map((i) => ({ label: i.label, ok: i.ok, hint: i.hint ?? null }));

      // 2. Contrast audit per themed panel (recompute from live DOM)
      const contrast: Record<"light" | "dark", ContrastCheck[]> = { light: [], dark: [] };
      (["light", "dark"] as const).forEach((mode) => {
        const el = surfaceRef.current?.querySelector<HTMLElement>(`[data-theme-panel="${mode}"]`);
        if (el) contrast[mode] = auditChartContrast(el);
      });

      // 3. Interaction tester failures (sweep all steps if cartesian charts are on)
      const testerFailures = hasCartesian ? await sweepTesterFailures(surfaceRef) : [];
      // 3a. Optional: full-sweep runs when either the summary or JSON is requested
      const needsFullSweep = (includeSweepSummary || includeFailureJson) && hasCartesian;
      const fullSweep = needsFullSweep ? await sweepFullSummary(surfaceRef) : null;

      // 3b. Capture visual evidence screenshots for every failure.
      //     - One panel screenshot per themed panel that has any contrast failure.
      //     - One panel screenshot per failing tester step (with tooltip re-hovered).
      const panelEl = (mode: "light" | "dark") =>
        surfaceRef.current?.querySelector<HTMLElement>(`[data-theme-panel="${mode}"]`) ?? null;
      const snap = async (el: HTMLElement) => {
        try {
          const canvas = await html2canvas(el, {
            backgroundColor: null,
            scale: Math.min(2, window.devicePixelRatio || 1),
            logging: false,
            useCORS: true,
          });
          return {
            dataUrl: canvas.toDataURL("image/png"),
            width: canvas.width,
            height: canvas.height,
          };
        } catch (e) {
          console.warn("snap failed", e);
          return null;
        }
      };
      type Shot = { dataUrl: string; width: number; height: number };
      const contrastShots: Partial<Record<"light" | "dark", Shot>> = {};
      for (const mode of ["light", "dark"] as const) {
        if (contrast[mode].some((c) => !c.ok)) {
          const el = panelEl(mode);
          if (el) {
            const shot = await snap(el);
            if (shot) contrastShots[mode] = shot;
          }
        }
      }
      const testerShots: (Shot | null)[] = [];
      for (const f of testerFailures) {
        triggerHoverAt(surfaceRef, f.step, trend.length);
        await waitMs(90);
        const el = panelEl(f.panel);
        testerShots.push(el ? await snap(el) : null);
      }

      // --- Compose PDF ----------------------------------------------------
      const pdf = new jsPDF({ unit: "pt", format: "letter" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 48;
      const maxW = pageW - margin * 2;
      let y = margin;

      const ensureRoom = (needed: number) => {
        if (y + needed > pageH - margin) {
          pdf.addPage();
          y = margin;
        }
      };
      const line = (
        text: string,
        opts?: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number },
      ) => {
        const size = opts?.size ?? 10;
        pdf.setFont("helvetica", opts?.bold ? "bold" : "normal");
        pdf.setFontSize(size);
        pdf.setTextColor(...(opts?.color ?? [20, 20, 20]));
        const indent = opts?.indent ?? 0;
        const wrapped = pdf.splitTextToSize(text, maxW - indent);
        for (const chunk of wrapped as string[]) {
          ensureRoom(size + 4);
          pdf.text(chunk, margin + indent, y);
          y += size + 4;
        }
      };
      const rule = () => {
        ensureRoom(12);
        pdf.setDrawColor(220);
        pdf.line(margin, y, pageW - margin, y);
        y += 10;
      };
      const heading = (text: string) => {
        y += 8;
        ensureRoom(20);
        line(text, { size: 14, bold: true });
        rule();
      };
      const embedShot = (shot: Shot, caption?: string, maxHeight = 260) => {
        const targetW = Math.min(maxW, shot.width * 0.75);
        const scale = targetW / shot.width;
        let drawW = targetW;
        let drawH = shot.height * scale;
        if (drawH > maxHeight) {
          const s2 = maxHeight / drawH;
          drawH = maxHeight;
          drawW = drawW * s2;
        }
        ensureRoom(drawH + (caption ? 14 : 4) + 6);
        if (caption) {
          pdf.setFont("helvetica", "italic");
          pdf.setFontSize(8);
          pdf.setTextColor(110, 110, 110);
          pdf.text(caption, margin, y);
          y += 10;
        }
        try {
          pdf.addImage(shot.dataUrl, "PNG", margin, y, drawW, drawH, undefined, "FAST");
        } catch (e) {
          console.warn("addImage failed", e);
        }
        y += drawH + 6;
      };

      // Header
      line("Chart Theme Preview — QA Report", { size: 18, bold: true });
      line(new Date().toLocaleString(), { size: 9, color: [110, 110, 110] });
      line(
        `Viewport: ${current.width ? `${current.width}px` : "full width"} · Chart types: ${
          Array.from(enabled).join(", ") || "none"
        } · App theme: ${appDark ? "dark" : "light"}`,
        { size: 9, color: [110, 110, 110] },
      );
      {
        const env = collectQaEnvironment(appDark ? "dark" : "light");
        line(
          `URL: ${env.app.url ?? "unknown"}${
            env.app.version ? ` · v${env.app.version}` : ""
          }${env.app.buildId ? ` · build ${env.app.buildId}` : ""}${
            env.app.mode ? ` · mode ${env.app.mode}` : ""
          }`,
          { size: 9, color: [110, 110, 110] },
        );
        line(
          `Recharts ${env.libraries.recharts ?? "?"} · React ${env.libraries.react} · DPR ${env.device.devicePixelRatio ?? "?"} · Window ${env.device.innerWidth ?? "?"}×${env.device.innerHeight ?? "?"} · UA: ${env.device.userAgent ?? "unknown"}`,
          { size: 9, color: [110, 110, 110] },
        );
      }

      // Summary
      const layoutFails = layout.filter((l) => !l.ok).length;
      const contrastFails =
        contrast.light.filter((c) => !c.ok).length + contrast.dark.filter((c) => !c.ok).length;
      heading("Summary");
      line(`Layout checklist: ${layoutFails === 0 ? "PASS" : `${layoutFails} issue(s)`}`, {
        color: layoutFails === 0 ? [30, 130, 60] : [180, 40, 40],
      });
      line(
        `Contrast audit: ${contrastFails === 0 ? "PASS (all pairs ≥ WCAG AA)" : `${contrastFails} pair(s) below AA`}`,
        { color: contrastFails === 0 ? [30, 130, 60] : [180, 40, 40] },
      );
      line(
        hasCartesian
          ? `Interaction tester: ${testerFailures.length === 0 ? "PASS across all steps" : `${testerFailures.length} failing panel(s)`}`
          : "Interaction tester: skipped (no cartesian chart enabled)",
        {
          color: !hasCartesian
            ? [110, 110, 110]
            : testerFailures.length === 0
              ? [30, 130, 60]
              : [180, 40, 40],
        },
      );

      // Layout checklist
      heading("Layout checklist");
      if (layout.length === 0) {
        line("No checks captured.", { color: [110, 110, 110] });
      } else {
        for (const item of layout) {
          const mark = item.ok ? "PASS" : "FAIL";
          line(`[${mark}] ${item.label}${item.hint ? ` — ${item.hint}` : ""}`, {
            color: item.ok ? [30, 130, 60] : [180, 40, 40],
          });
        }
      }

      // Contrast audit
      heading("Contrast audit");
      (["light", "dark"] as const).forEach((mode) => {
        line(`${mode.toUpperCase()} panel`, { size: 11, bold: true });
        const rows = contrast[mode];
        if (rows.length === 0) {
          line("No contrast data collected.", { color: [110, 110, 110], indent: 12 });
        } else {
          for (const r of rows) {
            const mark = r.ok ? "PASS" : "FAIL";
            line(
              `[${mark}] ${r.label} — ${r.ratio.toFixed(2)}:1 (required ${r.required.toFixed(1)}:1)`,
              { color: r.ok ? [30, 130, 60] : [180, 40, 40], indent: 12 },
            );
          }
        }
        const shot = contrastShots[mode];
        if (shot) {
          y += 2;
          embedShot(shot, `Screenshot — ${mode} panel (contrast failures highlighted above)`);
        }
        y += 4;
      });

      // Interaction tester
      heading("Interaction tester findings");
      if (!hasCartesian) {
        line("Skipped — no bar, line, or area chart was enabled during capture.", {
          color: [110, 110, 110],
        });
      } else if (testerFailures.length === 0) {
        line(
          `All ${trend.length} step(s) × 2 panel(s) passed. Expected series order: ${seriesKeys
            .map((k) => chartConfig[k].label)
            .join(", ")}.`,
          { color: [30, 130, 60] },
        );
      } else {
        line(`Expected series order: ${seriesKeys.map((k) => chartConfig[k].label).join(", ")}`, {
          size: 9,
          color: [110, 110, 110],
        });
        y += 4;
        testerFailures.forEach((f, idx) => {
          line(`Step ${f.step + 1} · ${f.month} · ${f.panel.toUpperCase()}`, { bold: true });
          line(f.detail, { color: [180, 40, 40], indent: 12 });
          const expected = f.expected.map((e) => `${e.series}=${e.value}`).join(", ");
          line(`Expected: ${expected}`, { size: 9, color: [80, 80, 80], indent: 12 });
          line(
            `Observed tooltip: ${f.observedTooltipText ? `"${f.observedTooltipText}"` : "(none rendered)"}`,
            { size: 9, color: [80, 80, 80], indent: 12 },
          );
          const shot = testerShots[idx];
          if (shot) {
            embedShot(shot, `Screenshot — ${f.panel} panel at step ${f.step + 1} (${f.month})`);
          }
          y += 4;
        });
      }

      // Full-sweep summary (opt-in)
      if (fullSweep && includeSweepSummary) {
        heading("Interaction results — full sweep");
        line(
          `Completed ${new Date(fullSweep.completedAt).toLocaleString()} · ${fullSweep.durationMs} ms · ${fullSweep.totalSteps} step(s)`,
          { size: 9, color: [110, 110, 110] },
        );
        const overallPass = fullSweep.lightFail === 0 && fullSweep.darkFail === 0;
        line(
          `Overall: ${overallPass ? "PASS" : "FAIL"} — Light ${fullSweep.lightPass}/${fullSweep.totalSteps} · Dark ${fullSweep.darkPass}/${fullSweep.totalSteps}`,
          { bold: true, color: overallPass ? [30, 130, 60] : [180, 40, 40] },
        );
        y += 4;
        line("Per-step results", { size: 11, bold: true });
        for (const s of fullSweep.steps) {
          const bothOk = s.light.ok && s.dark.ok;
          const mark = bothOk ? "PASS" : "FAIL";
          line(
            `[${mark}] Step ${s.step + 1} · ${s.month} — light: ${s.light.ok ? "ok" : s.light.detail} · dark: ${s.dark.ok ? "ok" : s.dark.detail}`,
            { color: bothOk ? [30, 130, 60] : [180, 40, 40], indent: 12 },
          );
        }
      }

      // Failure JSON block (opt-in, independent of the summary above)
      if (includeFailureJson) {
        heading("Failure JSON");
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9);
        pdf.setTextColor(90, 90, 90);
        const envLabel = includeEnvBlock
          ? "Environment block: included (environment field present below)"
          : "Environment block: omitted (environment field excluded \u2014 toggle \u201CInclude environment block\u201D to add it)";
        ensureRoom(14);
        pdf.text(envLabel, margin, y);
        y += 14;
        const failuresJson = JSON.stringify(
          buildFailuresPayload({
            generatedAt: new Date().toISOString(),
            viewport: current.width ? `${current.width}px` : "full width",
            enabledChartTypes: Array.from(enabled),
            appTheme: appDark ? "dark" : "light",
            includeEnvBlock,
            collectEnvironment: () => collectQaEnvironment(appDark ? "dark" : "light"),
            expectedSeriesOrder: seriesKeys.map((k) => chartConfig[k].label as string),
            fullSweep,
            failures: testerFailures,
          }),
          null,
          2,
        );
        pdf.setFont("courier", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(30, 30, 30);
        const jsonWrapped = pdf.splitTextToSize(failuresJson, maxW) as string[];
        for (const chunk of jsonWrapped) {
          ensureRoom(10);
          pdf.text(chunk, margin, y);
          y += 10;
        }
      }

      // Footer page numbers

      const pages = pdf.getNumberOfPages();
      for (let p = 1; p <= pages; p++) {
        pdf.setPage(p);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(140);
        pdf.text(`Chart QA · page ${p} of ${pages}`, margin, pageH - 20);
      }

      pdf.save("chart-qa-report.pdf");

      // Sidecar: also emit the failure JSON as a standalone .json file so
      // it can be attached to bug reports without extracting it from the PDF.
      // Gated behind the same "Confirm export settings" dialog as every other
      // JSON download so reviewers see filters/columns/rows before it writes.
      if (includeFailureJson) {
        const sidecar = buildFailuresPayload({
          generatedAt: new Date().toISOString(),
          viewport: current.width ? `${current.width}px` : "full width",
          enabledChartTypes: Array.from(enabled),
          appTheme: appDark ? "dark" : "light",
          includeEnvBlock,
          collectEnvironment: () => collectQaEnvironment(appDark ? "dark" : "light"),
          expectedSeriesOrder: seriesKeys.map((k) => chartConfig[k].label as string),
          fullSweep,
          failures: testerFailures,
        });
        const sidecarMeta: CsvMetadataInput = {
          source: "Chart QA — Interaction Failures",
          extra: {
            viewport: current.width ? `${current.width}px` : "full width",
            appTheme: appDark ? "dark" : "light",
            fullSweep: String(fullSweep),
          },
          counts: { shown: testerFailures.length, total: testerFailures.length },
          columns: [
            { key: "chartType", label: "Chart Type" },
            { key: "viewport", label: "Viewport" },
            { key: "seriesKey", label: "Series Key" },
            { key: "expectedIndex", label: "Expected Index" },
            { key: "actualIndex", label: "Actual Index" },
            { key: "reason", label: "Reason" },
          ],
        };
        // Wrap the schema-validated payload in a metadata envelope so JSON
        // consumers get the same _meta.columns contract as CSV downloads.
        const enveloped = { _meta: buildJsonExportMetadata(sidecarMeta), ...sidecar };
        requestJsonExport({
          label: "the Chart QA failures sidecar JSON",
          input: sidecarMeta,
          onConfirm: () => emitJsonFile(enveloped, "chart-qa-failures.json"),
        });
      }

      setPdfState("done");
    } catch (err) {
      console.error("downloadQaPdf failed", err);
      setPdfState("error");
    } finally {
      window.setTimeout(() => setPdfState("idle"), 2400);
    }
  };

  // --- QA JSON export ------------------------------------------------------
  const [jsonState, setJsonState] = useState<"idle" | "running" | "done" | "error">("idle");
  const downloadQaJson = async () => {
    setJsonState("running");
    try {
      const layout = issues.map((i) => ({ label: i.label, ok: i.ok, hint: i.hint ?? null }));
      const contrast: Record<"light" | "dark", ContrastCheck[]> = { light: [], dark: [] };
      (["light", "dark"] as const).forEach((mode) => {
        const el = surfaceRef.current?.querySelector<HTMLElement>(`[data-theme-panel="${mode}"]`);
        if (el) contrast[mode] = auditChartContrast(el);
      });
      const testerFailures = hasCartesian ? await sweepTesterFailures(surfaceRef) : [];

      const layoutFails = layout.filter((l) => !l.ok).length;
      const contrastFails =
        contrast.light.filter((c) => !c.ok).length + contrast.dark.filter((c) => !c.ok).length;

      const metaInput: CsvMetadataInput = {
        source: "Chart QA — Report",
        extra: {
          viewport: current.width ? `${current.width}px` : "full width",
          appTheme: appDark ? "dark" : "light",
        },
        counts: {
          shown: layout.length + contrast.light.length + contrast.dark.length,
          total: layout.length + contrast.light.length + contrast.dark.length,
        },
        columns: [
          { key: "section", label: "Section" },
          { key: "label", label: "Check Label" },
          { key: "mode", label: "Theme Mode" },
          { key: "ok", label: "Passed" },
          { key: "hint", label: "Hint" },
        ],
      };

      const report = {
        _meta: buildJsonExportMetadata(metaInput),
        generatedAt: new Date().toISOString(),
        viewport: {
          id: vp,
          width: current.width ?? null,
          label: current.width ? `${current.width}px` : "full width",
        },
        enabledChartTypes: Array.from(enabled),
        appTheme: appDark ? "dark" : "light",
        environment: collectQaEnvironment(appDark ? "dark" : "light"),
        summary: {
          layout: { total: layout.length, failed: layoutFails, pass: layoutFails === 0 },
          contrast: {
            total: contrast.light.length + contrast.dark.length,
            failed: contrastFails,
            pass: contrastFails === 0,
          },
          interaction: hasCartesian
            ? {
                skipped: false,
                failed: testerFailures.length,
                pass: testerFailures.length === 0,
              }
            : { skipped: true, failed: 0, pass: null },
        },
        layoutChecklist: layout,
        contrastAudit: contrast,
        interactionFailures: {
          expectedSeriesOrder: seriesKeys.map((k) => chartConfig[k].label as string),
          failures: testerFailures,
        },
      };

      // Show the same "Confirm export settings" preview used by CSV/JSON
      // downloads elsewhere. Download only starts on explicit confirm.
      setJsonState("idle");
      requestJsonExport({
        label: "the Chart QA Report JSON",
        input: metaInput,
        onConfirm: () => {
          setJsonState("running");
          try {
            emitJsonFile(report, "chart-qa-report.json");
            setJsonState("done");
          } catch (err) {
            console.error("downloadQaJson (confirm) failed", err);
            setJsonState("error");
          } finally {
            window.setTimeout(() => setJsonState("idle"), 2400);
          }
        },
      });
    } catch (err) {
      console.error("downloadQaJson failed", err);
      setJsonState("error");
      window.setTimeout(() => setJsonState("idle"), 2400);
    }
  };

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-6">
          <div>
            <h1 className="text-lg font-semibold">Chart Theme Preview</h1>
            <p className="text-xs text-muted-foreground">
              Side-by-side light and dark rendering for tooltips, legends, gridlines, and axes.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Chart-type filter */}
            <div
              role="group"
              aria-label="Chart type filter"
              className="flex items-center gap-1 rounded-md border border-border bg-card p-1"
            >
              {CHART_TYPES.map((t) => {
                const on = enabled.has(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleType(t.id)}
                    aria-pressed={on}
                    className={
                      "rounded px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                      (on
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")
                    }
                  >
                    {t.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() =>
                  setEnabled(
                    allOn ? new Set<ChartType>() : new Set<ChartType>(CHART_TYPES.map((c) => c.id)),
                  )
                }
                className="ml-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {allOn ? "None" : "All"}
              </button>
            </div>

            {/* Viewport width picker */}
            <div
              role="group"
              aria-label="Preview viewport width"
              className="flex items-center gap-1 rounded-md border border-border bg-card p-1"
            >
              {BREAKPOINTS.map((b) => {
                const on = vp === b.id;
                const Icon = b.Icon;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setVp(b.id)}
                    aria-pressed={on}
                    title={b.width ? `${b.width}px` : "Full width"}
                    className={
                      "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                      (on
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")
                    }
                  >
                    <Icon className="size-3.5" />
                    <span className="hidden md:inline">{b.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex max-w-[260px] flex-col gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px]">
              <label
                className="flex flex-col gap-0.5 text-muted-foreground has-[:checked]:text-foreground"
                title="Append per-step pass/fail for light and dark themes, run duration, and overall counts"
              >
                <span className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={includeSweepSummary}
                    onChange={(e) => setIncludeSweepSummary(e.target.checked)}
                    className="size-3 accent-primary"
                  />
                  Include full-sweep summary
                </span>
                <span className="pl-[18px] text-[10px] leading-snug text-muted-foreground">
                  Per-step PASS/FAIL for light &amp; dark, run duration, and overall counts.
                </span>
              </label>
              <label
                className="flex flex-col gap-0.5 text-muted-foreground has-[:checked]:text-foreground"
                title="Append a raw JSON block (environment, full sweep, failures) for bug reports"
              >
                <span className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={includeFailureJson}
                    onChange={(e) => setIncludeFailureJson(e.target.checked)}
                    className="size-3 accent-primary"
                  />
                  Include failure JSON
                </span>
                <span className="pl-[18px] text-[10px] leading-snug text-muted-foreground">
                  Raw JSON block (environment, full sweep, failures) ready to paste into a bug
                  report.
                </span>
              </label>
              <label
                className={
                  "ml-[18px] flex flex-col gap-0.5 border-l border-border/60 pl-2 " +
                  (includeFailureJson
                    ? "text-muted-foreground has-[:checked]:text-foreground"
                    : "pointer-events-none opacity-50")
                }
                title="Only takes effect when Include failure JSON is enabled"
              >
                <span className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={includeEnvBlock}
                    disabled={!includeFailureJson}
                    onChange={(e) => setIncludeEnvBlock(e.target.checked)}
                    className="size-3 accent-primary"
                  />
                  Include environment block
                </span>
                <span className="pl-[18px] text-[10px] leading-snug text-muted-foreground">
                  Only controls whether the <code>environment</code> field is included in the PDF
                  failure JSON block and <code>chart-qa-failures.json</code>. Has no effect unless
                  Include failure JSON is enabled.
                </span>
              </label>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={downloadQaPdf}
              disabled={pdfState === "running"}
              aria-label="Download QA report PDF"
              title="Compile layout checklist, contrast audit, and interaction tester findings for both themes into one PDF"
            >
              {pdfState === "running" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : pdfState === "done" ? (
                <ClipboardCheck className="size-4" />
              ) : (
                <FileDown className="size-4" />
              )}
              <span className="ml-2 hidden sm:inline">
                {pdfState === "running"
                  ? "Building…"
                  : pdfState === "done"
                    ? "Downloaded"
                    : pdfState === "error"
                      ? "Failed"
                      : "QA PDF"}
              </span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={downloadQaJson}
              disabled={jsonState === "running"}
              aria-label="Download QA report JSON"
              title="Export the same checklist, contrast, and interaction failures data used in the PDF as structured JSON"
            >
              {jsonState === "running" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : jsonState === "done" ? (
                <ClipboardCheck className="size-4" />
              ) : (
                <FileDown className="size-4" />
              )}
              <span className="ml-2 hidden sm:inline">
                {jsonState === "running"
                  ? "Building…"
                  : jsonState === "done"
                    ? "Downloaded"
                    : jsonState === "error"
                      ? "Failed"
                      : "QA JSON"}
              </span>
            </Button>

            <Button size="sm" variant="outline" onClick={toggleApp} aria-label="Toggle app theme">
              {appDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
              <span className="ml-2 hidden sm:inline">App theme: {appDark ? "Dark" : "Light"}</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6">
        {/* Layout checklist */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Layout checklist{" "}
              <span className="ml-1 font-normal text-muted-foreground">
                @ {current.width ? `${current.width}px` : "full width"}
              </span>
            </CardTitle>
            <CardDescription>Auto-runs against the rendered preview below.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {issues.length === 0 ? (
                <li className="text-xs text-muted-foreground">Measuring…</li>
              ) : (
                issues.map((c) => (
                  <li key={c.label} className="flex items-start gap-2 text-xs">
                    {c.ok ? (
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                    )}
                    <span className={c.ok ? "text-foreground" : "text-foreground"}>
                      {c.label}
                      {c.hint ? (
                        <span className="ml-1 text-muted-foreground">— {c.hint}</span>
                      ) : null}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </CardContent>
        </Card>

        {/* Hover / keyboard interaction tester */}
        <InteractionTester
          surfaceRef={surfaceRef}
          hasCartesian={hasCartesian}
          viewportLabel={current.width ? `${current.width}px` : "full width"}
          enabledTypes={Array.from(enabled)}
        />

        {/* Legend hover / keyboard / visibility tester */}
        <LegendTester surfaceRef={surfaceRef} hasAnyChart={enabled.size > 0} />

        {/* Constrained-width preview surface */}
        <div
          className="mx-auto space-y-6 transition-[max-width] duration-200"
          style={{ maxWidth: current.width ? `${current.width}px` : "100%" }}
        >
          <div ref={surfaceRef} className="space-y-6">
            <ThemedPanel mode="light">
              <ChartGrid enabled={enabled} />
            </ThemedPanel>
            <ThemedPanel mode="dark">
              <ChartGrid enabled={enabled} />
            </ThemedPanel>
          </div>
        </div>
      </main>
      {jsonConfirmDialog}
    </div>
  );
}
