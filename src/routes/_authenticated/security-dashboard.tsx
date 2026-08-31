import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Search,
  LayoutDashboard,
  FileWarning,
  Server,
  Settings as SettingsIcon,
  Bell,
  ExternalLink,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/_authenticated/security-dashboard")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Security Findings — Precise ERP" },
      {
        name: "description",
        content:
          "Cybersecurity findings dashboard with severity, status, and remediation tracking.",
      },
      { property: "og:title", content: "Security Findings Dashboard" },
      {
        property: "og:description",
        content: "Track vulnerabilities, remediation, and resolution progress.",
      },
    ],
  }),
  component: SecurityDashboard,
});

type Severity = "Critical" | "High" | "Medium" | "Low";
type Status = "Pending" | "In Progress" | "Resolved";

interface Finding {
  id: string;
  severity: Severity;
  name: string;
  asset: string;
  status: Status;
  timestamp: string;
  description: string;
  remediation: string[];
  cve?: string;
}

const FINDINGS: Finding[] = [
  {
    id: "SEC-1042",
    severity: "Critical",
    name: "Exposed API Key in Public Repository",
    asset: "github.com/acme/frontend",
    status: "Pending",
    timestamp: "2026-07-02T09:14:00Z",
    description:
      "A production API key was detected in a public commit, granting elevated access to billing endpoints.",
    remediation: [
      "Rotate the exposed key immediately in the provider console.",
      "Purge the secret from git history using git filter-repo.",
      "Add pre-commit hooks (gitleaks) to block secret commits.",
      "Audit access logs for suspicious usage over the last 30 days.",
    ],
    cve: "CWE-798",
  },
  {
    id: "SEC-1041",
    severity: "Critical",
    name: "SQL Injection in Search Endpoint",
    asset: "api.acme.io/v1/search",
    status: "In Progress",
    timestamp: "2026-07-01T18:02:00Z",
    description: "User-supplied query parameter is concatenated directly into a SQL statement.",
    remediation: [
      "Replace string concatenation with parameterized queries.",
      "Add input validation with a strict allowlist.",
      "Deploy a WAF rule blocking known SQLi patterns as a stopgap.",
    ],
    cve: "CVE-2026-14421",
  },
  {
    id: "SEC-1039",
    severity: "High",
    name: "Outdated TLS 1.0 on Load Balancer",
    asset: "lb-prod-eu-west-1",
    status: "Pending",
    timestamp: "2026-07-01T11:47:00Z",
    description:
      "The public load balancer still accepts TLS 1.0 connections, which are deprecated.",
    remediation: [
      "Disable TLS 1.0 and 1.1 on the load balancer.",
      "Require TLS 1.2 minimum with modern cipher suites.",
      "Re-test with SSL Labs to confirm A+ rating.",
    ],
  },
  {
    id: "SEC-1038",
    severity: "High",
    name: "Missing CSRF Protection on Admin Forms",
    asset: "admin.acme.io",
    status: "In Progress",
    timestamp: "2026-06-30T15:22:00Z",
    description: "Several state-changing admin forms lack CSRF tokens, allowing forged requests.",
    remediation: [
      "Enable framework CSRF middleware globally.",
      "Verify all POST/PUT/DELETE forms include a valid token.",
      "Add regression tests covering CSRF rejection.",
    ],
  },
  {
    id: "SEC-1035",
    severity: "Medium",
    name: "Weak Password Policy",
    asset: "auth.acme.io",
    status: "Pending",
    timestamp: "2026-06-29T08:11:00Z",
    description: "Password minimum length is 6 characters and there is no complexity requirement.",
    remediation: [
      "Set minimum length to 12 characters.",
      "Reject passwords found in known breach lists.",
      "Encourage passphrases and enforce MFA for admins.",
    ],
  },
  {
    id: "SEC-1033",
    severity: "Medium",
    name: "Verbose Error Messages Leaking Stack Traces",
    asset: "api.acme.io",
    status: "Resolved",
    timestamp: "2026-06-28T13:41:00Z",
    description: "500 responses returned full stack traces to clients in production.",
    remediation: [
      "Disable debug mode in production configuration.",
      "Return generic error messages with a correlation ID.",
      "Ship detailed traces to internal logging only.",
    ],
  },
  {
    id: "SEC-1030",
    severity: "Low",
    name: "Missing Security Headers",
    asset: "www.acme.io",
    status: "Resolved",
    timestamp: "2026-06-27T10:05:00Z",
    description: "Response missing Content-Security-Policy and X-Content-Type-Options headers.",
    remediation: [
      "Add CSP with strict default-src 'self'.",
      "Add X-Content-Type-Options: nosniff.",
      "Add Referrer-Policy: strict-origin-when-cross-origin.",
    ],
  },
  {
    id: "SEC-1029",
    severity: "Low",
    name: "Cookie Missing Secure Flag",
    asset: "app.acme.io",
    status: "Resolved",
    timestamp: "2026-06-26T16:33:00Z",
    description: "Session cookie is issued without the Secure attribute.",
    remediation: [
      "Set Secure and HttpOnly on all session cookies.",
      "Set SameSite=Lax or Strict as appropriate.",
    ],
  },
  {
    id: "SEC-1025",
    severity: "Critical",
    name: "Publicly Accessible S3 Bucket",
    asset: "s3://acme-backups",
    status: "Resolved",
    timestamp: "2026-06-24T21:18:00Z",
    description: "Nightly database backups were stored in a bucket with public list access.",
    remediation: [
      "Enable Block Public Access at the account level.",
      "Rotate any credentials that may have been exposed.",
      "Enable server-side encryption and access logging.",
    ],
  },
  {
    id: "SEC-1022",
    severity: "High",
    name: "Dependency With Known RCE",
    asset: "services/payments (Node)",
    status: "In Progress",
    timestamp: "2026-06-23T07:59:00Z",
    description: "lodash 4.17.15 is affected by a prototype pollution RCE.",
    remediation: [
      "Upgrade to lodash >= 4.17.21.",
      "Run npm audit fix and rebuild the container.",
      "Enable Dependabot for automated PRs.",
    ],
    cve: "CVE-2020-8203",
  },
];

const SEVERITY_STYLES: Record<Severity, string> = {
  // Bumped bg + text opacity for WCAG AA on the dark dashboard shell
  // (was 4.03 : 1 for destructive on card/15, now clears 4.5 : 1).
  Critical: "bg-destructive/25 text-destructive-foreground border-destructive/50",
  High: "bg-warning/25 text-warning-foreground border-warning/50",
  Medium: "bg-warning/20 text-warning-foreground border-warning/40",
  Low: "bg-info/20 text-info-foreground border-info/40",
};

const STATUS_STYLES: Record<Status, string> = {
  Pending: "bg-destructive/20 text-destructive-foreground border-destructive/40",
  "In Progress": "bg-warning/20 text-warning-foreground border-warning/40",
  Resolved: "bg-success/20 text-success-foreground border-success/40",
};

function formatTs(ts: string) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AppSidebar() {
  const items = [
    { title: "Overview", icon: LayoutDashboard, active: true },
    { title: "Findings", icon: FileWarning },
    { title: "Assets", icon: Server },
    { title: "Alerts", icon: Bell },
    { title: "Settings", icon: SettingsIcon },
  ];
  return (
    <Sidebar collapsible="icon" className="border-r border-border/5">
      <SidebarHeader className="px-3 py-4">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-success to-info text-foreground">
            <Shield className="h-5 w-5" />
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <div className="truncate text-sm font-semibold">Sentinel</div>
            <div className="truncate text-xs text-muted-foreground">Security Console</div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton isActive={item.active}>
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number | string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "red" | "amber" | "emerald" | "cyan";
}) {
  const tones = {
    red: "from-destructive/20 to-destructive/0 text-destructive border-destructive/20",
    amber: "from-warning/20 to-warning/0 text-warning border-warning/20",
    emerald: "from-success/20 to-success/0 text-success border-success/20",
    cyan: "from-info/20 to-info/0 text-info border-info/20",
  }[tone];
  return (
    <Card className="relative overflow-hidden border-border/5 bg-card/60 backdrop-blur">
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${tones} opacity-60`}
      />
      <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </CardTitle>
        <div
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-md border bg-background/40 ${tones}`}
        >
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent className="relative">
        <div className="text-3xl font-bold tracking-tight">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

function Doughnut({
  resolved,
  total,
  size = 140,
}: {
  resolved: number;
  total: number;
  size?: number;
}) {
  const pct = total === 0 ? 0 : resolved / total;
  const r = 54;
  const c = 2 * Math.PI * r;
  const dash = c * pct;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={r} fill="none" stroke="hsl(0 0% 100% / 0.06)" strokeWidth="14" />
        <circle
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke="url(#grad)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          strokeDashoffset={c / 4}
          transform="rotate(-90 70 70)"
        />
        <defs>
          <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(var(--success))" />
            <stop offset="100%" stopColor="hsl(var(--info))" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="text-2xl font-bold">{Math.round(pct * 100)}%</div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Resolved
          </div>
        </div>
      </div>
    </div>
  );
}

function SecurityDashboard() {
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [selected, setSelected] = useState<Finding | null>(null);

  const filtered = useMemo(() => {
    return FINDINGS.filter((f) => {
      const q = query.trim().toLowerCase();
      const matchesQ =
        !q ||
        f.name.toLowerCase().includes(q) ||
        f.asset.toLowerCase().includes(q) ||
        f.id.toLowerCase().includes(q);
      const matchesSev = severity === "all" || f.severity === severity;
      const matchesStatus = status === "all" || f.status === status;
      return matchesQ && matchesSev && matchesStatus;
    });
  }, [query, severity, status]);

  const total = FINDINGS.length;
  const critical = FINDINGS.filter(
    (f) => f.severity === "Critical" || f.severity === "High",
  ).length;
  const resolved = FINDINGS.filter((f) => f.status === "Resolved").length;
  const pending = FINDINGS.filter(
    (f) => f.status === "Pending" || f.status === "In Progress",
  ).length;

  return (
    <div className="dark min-h-dvh bg-card text-muted-foreground">
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="bg-card">
          <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border/5 bg-card/80 px-4 backdrop-blur">
            <SidebarTrigger className="text-muted-foreground" />
            <Separator orientation="vertical" className="h-6 bg-card/10" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-semibold text-foreground">Security Findings</h1>
              <p className="truncate text-xs text-muted-foreground">
                Live overview of vulnerabilities across your infrastructure
              </p>
            </div>
            <Badge
              variant="outline"
              className="hidden shrink-0 border-success/30 bg-success/10 text-success sm:inline-flex"
            >
              <span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
              Monitoring
            </Badge>
          </header>

          <section aria-label="Security findings overview" className="space-y-6 p-4 md:p-6">
            {/* KPI row */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Total Findings"
                value={total}
                hint="Across all assets"
                icon={FileWarning}
                tone="cyan"
              />
              <KpiCard
                label="High / Critical"
                value={critical}
                hint="Require urgent attention"
                icon={AlertTriangle}
                tone="red"
              />
              <KpiCard
                label="Resolved"
                value={resolved}
                hint="Closed in last 30 days"
                icon={CheckCircle2}
                tone="emerald"
              />
              <KpiCard
                label="Pending Actions"
                value={pending}
                hint="Open or in progress"
                icon={Clock}
                tone="amber"
              />
            </div>

            {/* Progress + Doughnut */}
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="border-border/5 bg-card/60 lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Remediation Progress</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Overall resolution rate</span>
                      <span className="font-semibold">
                        {resolved} / {total}
                      </span>
                    </div>
                    <Progress
                      value={(resolved / total) * 100}
                      aria-label={`Resolved ${resolved} of ${total} findings`}
                      className="h-2 bg-card/5 [&>div]:bg-gradient-to-r [&>div]:from-success [&>div]:to-info"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {(["Critical", "High", "Medium", "Low"] as Severity[]).map((s) => {
                      const count = FINDINGS.filter((f) => f.severity === s).length;
                      return (
                        <div
                          key={s}
                          className="rounded-lg border border-border/5 bg-background/30 p-3"
                        >
                          <div className="text-xs text-muted-foreground">{s}</div>
                          <div className="mt-1 text-xl font-semibold">{count}</div>
                          <div
                            className={`mt-2 h-1 rounded-full ${
                              s === "Critical"
                                ? "bg-destructive"
                                : s === "High"
                                  ? "bg-warning"
                                  : s === "Medium"
                                    ? "bg-warning"
                                    : "bg-info"
                            }`}
                          />
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
              <Card className="border-border/5 bg-card/60">
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Threat Posture</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-4">
                  <Doughnut resolved={resolved} total={total} />
                  <div className="grid w-full grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-success" />
                      <span className="text-muted-foreground">Resolved</span>
                      <span className="ml-auto font-semibold">{resolved}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-card/20" />
                      <span className="text-muted-foreground">Open</span>
                      <span className="ml-auto font-semibold">{pending}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Filters + Table */}
            <Card className="border-border/5 bg-card/60">
              <CardHeader className="gap-3">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap sm:justify-between">
                  <div className="min-w-0">
                    <CardTitle className="text-sm font-medium">Scan Results</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {filtered.length} of {total} findings
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search findings, assets, or IDs..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      className="border-border/10 bg-background/40 pl-9 text-sm"
                    />
                  </div>
                  <Select value={severity} onValueChange={setSeverity}>
                    <SelectTrigger
                      aria-label="Filter by severity"
                      className="w-full border-border/10 bg-background/40 sm:w-[160px]"
                    >
                      <SelectValue placeholder="Severity" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All severities</SelectItem>
                      <SelectItem value="Critical">Critical</SelectItem>
                      <SelectItem value="High">High</SelectItem>
                      <SelectItem value="Medium">Medium</SelectItem>
                      <SelectItem value="Low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger
                      aria-label="Filter by status"
                      className="w-full border-border/10 bg-background/40 sm:w-[160px]"
                    >
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                      <SelectItem value="In Progress">In Progress</SelectItem>
                      <SelectItem value="Resolved">Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/5 hover:bg-transparent">
                        <TableHead className="w-[110px]">Severity</TableHead>
                        <TableHead>Finding</TableHead>
                        <TableHead className="hidden md:table-cell">Asset</TableHead>
                        <TableHead className="w-[130px]">Status</TableHead>
                        <TableHead className="hidden w-[160px] lg:table-cell">Detected</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={5}
                            className="py-10 text-center text-sm text-muted-foreground"
                          >
                            No findings match your filters.
                          </TableCell>
                        </TableRow>
                      )}
                      {filtered.map((f) => (
                        <TableRow
                          key={f.id}
                          onClick={() => setSelected(f)}
                          className="cursor-pointer border-border/5 transition-colors hover:bg-card/5"
                        >
                          <TableCell>
                            <Badge variant="outline" className={SEVERITY_STYLES[f.severity]}>
                              {f.severity}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="min-w-0">
                              <div className="truncate font-medium">{f.name}</div>
                              <div className="truncate text-xs text-muted-foreground">
                                {f.id}
                                {f.cve ? ` · ${f.cve}` : ""}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                            {f.asset}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={STATUS_STYLES[f.status]}>
                              {f.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                            {formatTs(f.timestamp)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </section>
        </SidebarInset>
      </SidebarProvider>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full border-border/10 bg-card text-muted-foreground sm:max-w-lg">
          {selected && (
            <>
              <SheetHeader className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={SEVERITY_STYLES[selected.severity]}>
                    {selected.severity}
                  </Badge>
                  <Badge variant="outline" className={STATUS_STYLES[selected.status]}>
                    {selected.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {selected.id}
                    {selected.cve ? ` · ${selected.cve}` : ""}
                  </span>
                </div>
                <SheetTitle className="text-left text-lg">{selected.name}</SheetTitle>
                <SheetDescription className="text-left">{selected.description}</SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                <div className="rounded-lg border border-border/10 bg-background/40 p-3">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Affected asset
                  </div>
                  <div className="mt-1 flex items-center gap-2 font-mono text-sm">
                    <Server className="h-3.5 w-3.5 text-info" />
                    {selected.asset}
                  </div>
                  <div className="mt-3 text-[10px] uppercase tracking-widest text-muted-foreground">
                    Detected
                  </div>
                  <div className="mt-1 text-sm">{formatTs(selected.timestamp)}</div>
                </div>

                <div>
                  <h4 className="mb-3 text-sm font-semibold">Remediation Steps</h4>
                  <ol className="space-y-2">
                    {selected.remediation.map((step, i) => (
                      <li
                        key={i}
                        className="flex gap-3 rounded-lg border border-border/5 bg-card/[0.02] p-3 text-sm"
                      >
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-success to-info text-xs font-bold text-foreground">
                          {i + 1}
                        </span>
                        <span className="min-w-0">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="flex gap-2">
                  <Button className="flex-1 bg-success text-foreground hover:bg-success">
                    Mark as Resolved
                  </Button>
                  <Button variant="outline" className="border-border/10 bg-transparent">
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                    Runbook
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
