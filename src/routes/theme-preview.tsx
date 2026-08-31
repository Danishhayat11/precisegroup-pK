import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartPatternDefs,
  seriesPatternFill,
  seriesDash,
  renderSeriesMarker,
} from "@/lib/chart-a11y";
import { Info, Search, Sparkles } from "lucide-react";

export const Route = createFileRoute("/theme-preview")({
  head: () => ({
    meta: [
      { title: "Theme Preview — Design QA" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "googlebot", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Internal design QA surface showing all components in light and dark modes.",
      },
    ],
  }),
  component: ThemePreviewPage,
});

const chartData = [
  { month: "Jan", s1: 42, s2: 28, s3: 18, s4: 12, s5: 8 },
  { month: "Feb", s1: 58, s2: 41, s3: 26, s4: 18, s5: 11 },
  { month: "Mar", s1: 51, s2: 47, s3: 33, s4: 22, s5: 14 },
  { month: "Apr", s1: 73, s2: 55, s3: 41, s4: 29, s5: 19 },
  { month: "May", s1: 66, s2: 62, s3: 48, s4: 34, s5: 22 },
  { month: "Jun", s1: 84, s2: 71, s3: 55, s4: 41, s5: 27 },
];

// Every series consumes the palette in ramp order (chart-1 → chart-5).
// ChartContainer emits `--color-<key>` CSS vars from these; bars, lines,
// legend swatches, and tooltip dots all read from the same source.
const chartConfig = {
  s1: { label: "Series 1", color: "var(--chart-1)" },
  s2: { label: "Series 2", color: "var(--chart-2)" },
  s3: { label: "Series 3", color: "var(--chart-3)" },
  s4: { label: "Series 4", color: "var(--chart-4)" },
  s5: { label: "Series 5", color: "var(--chart-5)" },
} as const;

const seriesKeys = ["s1", "s2", "s3", "s4", "s5"] as const;

function Panel({ mode, children }: { mode: "light" | "dark"; children: React.ReactNode }) {
  return (
    <section
      className={`${mode === "dark" ? "dark" : ""} rounded-xl border border-border bg-background text-foreground shadow-sm overflow-hidden`}
    >
      <header className="flex items-center justify-between border-b border-border bg-muted/40 px-5 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${mode === "dark" ? "bg-primary" : "bg-primary"}`}
          />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
            {mode} mode
          </h2>
        </div>
        <Badge variant="outline" className="font-mono text-[10px]">
          {mode === "dark" ? ".dark" : ":root"}
        </Badge>
      </header>
      <div className="space-y-8 p-6">{children}</div>
    </section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h3>
      <div>{children}</div>
    </div>
  );
}

function PreviewSurface({ mode }: { mode: "light" | "dark" }) {
  return (
    <Panel mode={mode}>
      {/* Navigation */}
      <Block title="Navigation">
        <div className="flex flex-col gap-3">
          <nav className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Precise</span>
            </div>
            <div className="hidden gap-1 md:flex">
              {["Dashboard", "Bookings", "Ledger", "Reports"].map((t, i) => (
                <button
                  key={t}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    i === 0
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <Avatar className="h-7 w-7">
              <AvatarFallback className="text-[10px]">PR</AvatarFallback>
            </Avatar>
          </nav>
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="pt-3 text-xs text-muted-foreground">
              Active tab surface with muted body copy.
            </TabsContent>
          </Tabs>
        </div>
      </Block>

      {/* Buttons */}
      <Block title="Buttons & States">
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
          <Button variant="destructive">Destructive</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button className="min-h-11 min-w-11" size="icon" aria-label="Search">
            <Search className="h-4 w-4" />
          </Button>
        </div>
      </Block>

      {/* Cards */}
      <Block title="Cards">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Receivable</CardDescription>
              <CardTitle className="text-2xl tabular-nums">PKR 12.4M</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="secondary">+4.2%</Badge>
                <span className="text-muted-foreground">vs last month</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Overdue</CardDescription>
              <CardTitle className="text-2xl tabular-nums text-destructive">PKR 1.8M</CardTitle>
            </CardHeader>
            <CardContent>
              <Progress value={64} />
              <p className="mt-2 text-xs text-muted-foreground">64% of ledger past due</p>
            </CardContent>
          </Card>
        </div>
      </Block>

      {/* Forms */}
      <Block title="Forms">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`name-${mode}`}>Full name</Label>
            <Input id={`name-${mode}`} placeholder="Jane Doe" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`unit-${mode}`}>Unit type</Label>
            <Select>
              <SelectTrigger id={`unit-${mode}`}>
                <SelectValue placeholder="Select unit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="apt">Apartment</SelectItem>
                <SelectItem value="shop">Shop</SelectItem>
                <SelectItem value="office">Office</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor={`note-${mode}`}>Notes</Label>
            <Textarea id={`note-${mode}`} placeholder="Add remarks..." />
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox defaultChecked /> Verified
            </label>
            <RadioGroup defaultValue="a" className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="a" /> Cash
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="b" /> Cheque
              </label>
            </RadioGroup>
            <label className="flex items-center gap-2 text-sm">
              <Switch defaultChecked /> Notify
            </label>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Risk tolerance</Label>
            <Slider defaultValue={[42]} max={100} step={1} />
          </div>
        </div>
      </Block>

      {/* Alerts */}
      <Block title="Alerts & Badges">
        <div className="space-y-3">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Reconciliation complete</AlertTitle>
            <AlertDescription>412 rows matched, 3 quarantined for review.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <Info className="h-4 w-4" />
            <AlertTitle>Payment overdue</AlertTitle>
            <AlertDescription>Two installments missed the 15-day grace window.</AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
          </div>
        </div>
      </Block>

      {/* Table */}
      <Block title="Table">
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Booking</TableHead>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { id: "MA-018", c: "Ali Raza", d: "420,000", s: "Paid", v: "secondary" as const },
                {
                  id: "MA-024",
                  c: "Sana Malik",
                  d: "1,120,000",
                  s: "Overdue",
                  v: "destructive" as const,
                },
                {
                  id: "MA-031",
                  c: "Bilal Khan",
                  d: "88,500",
                  s: "Upcoming",
                  v: "outline" as const,
                },
              ].map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.id}</TableCell>
                  <TableCell>{r.c}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.d}</TableCell>
                  <TableCell>
                    <Badge variant={r.v}>{r.s}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Block>

      {/* Charts */}
      <Block title="Charts">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Collections</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-[220px] w-full">
                <BarChart data={chartData}>
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
                  <ChartTooltip
                    cursor={{ fill: "var(--accent)" }}
                    content={<ChartTooltipContent />}
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  {/* Colorblind-safe: per-series SVG pattern layered on the token color */}
                  {seriesKeys.map((k, i) => (
                    <Bar
                      key={k}
                      dataKey={k}
                      stackId="stack"
                      fill={seriesPatternFill(i)}
                      radius={[2, 2, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Trend (hover for tooltip)</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-[220px] w-full">
                <LineChart data={chartData}>
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
                  <ChartLegend content={<ChartLegendContent />} />
                  {/* Colorblind-safe: color + distinct dash + distinct active-dot marker */}
                  {seriesKeys.map((k, i) => (
                    <Line
                      key={k}
                      dataKey={k}
                      stroke={`var(--color-${k})`}
                      strokeWidth={i === 0 ? 2.5 : 1.75}
                      strokeDasharray={seriesDash(i)}
                      dot={false}
                      activeDot={renderSeriesMarker(i)}
                    />
                  ))}
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>
      </Block>

      {/* Palette */}
      <Block title="Semantic Tokens">
        <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
          {[
            ["background", "bg-background text-foreground border border-border"],
            ["card", "bg-card text-card-foreground border border-border"],
            ["primary", "bg-primary text-primary-foreground"],
            ["secondary", "bg-secondary text-secondary-foreground"],
            ["muted", "bg-muted text-muted-foreground"],
            ["accent", "bg-accent text-accent-foreground"],
            ["destructive", "bg-destructive text-destructive-foreground"],
            ["border", "bg-transparent border-2 border-border text-foreground"],
            ["ring", "bg-transparent ring-2 ring-ring text-foreground"],
            ["chart-1", "text-primary-foreground"],
            ["chart-3", "text-primary-foreground"],
            ["chart-5", "text-foreground"],
          ].map(([name, cls]) => (
            <div
              key={name}
              className={`flex h-14 items-center justify-center rounded-md text-[10px] font-mono ${cls}`}
              style={name.startsWith("chart-") ? { background: `var(--${name})` } : undefined}
            >
              {name}
            </div>
          ))}
        </div>
      </Block>

      <Separator />
      <p className="text-[11px] text-muted-foreground">
        All surfaces derive from semantic tokens — edit{" "}
        <code className="font-mono">src/styles.css</code> to shift the whole theme.
      </p>
    </Panel>
  );
}

function ThemePreviewPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-[1600px] px-6 py-10">
        <header className="mb-8 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Design QA
          </p>
          <h1 className="font-semibold tracking-tight">Theme Preview</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Side-by-side render of every core component in light and dark modes. Use this to verify
            contrast, focus rings, hairlines, and chart palettes stay coherent after any token
            change.
          </p>
        </header>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <PreviewSurface mode="light" />
          <PreviewSurface mode="dark" />
        </div>
      </div>
    </div>
  );
}
