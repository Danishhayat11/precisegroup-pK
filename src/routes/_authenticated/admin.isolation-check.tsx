import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { AdminRequiredMessage } from "@/lib/adminGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FlaskConical,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Download,
  Copy,
  History,
  Trash2,
  ArrowLeftRight,
  FileText,
  FileSpreadsheet,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "sonner";
import {
  runIsolationCheck,
  listIsolationCompanies,
  sweepIsolationArtifacts,
  type ControlResult,
  type IsolationCheckReport,
  type IsolationCompanyOption,
  type SweepIsolationResult,
} from "@/lib/tenantAudit.functions";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/admin/isolation-check")({
  ssr: false,
  component: IsolationCheckPage,
  errorComponent: makeRouteErrorComponent("Isolation Check"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Isolation Check",
    backTo: "/admin",
  }),
});

// -----------------------------------------------------------------------------
// Regression history: compact JSON summary per run, persisted in localStorage.
// -----------------------------------------------------------------------------

type IsolationHistoryEntry = {
  ran_at: string;
  passed: boolean;
  total: number;
  passed_count: number;
  failed_count: number;
  failed_controls: string[];
  tenant1_company_id: string;
  tenant2_company_id: string;
  by_control: Record<string, { passed: boolean; actual: string; error: string | null }>;
};

const HISTORY_KEY = "lovable.isolationCheck.history.v1";
const MAX_HISTORY = 50;

function loadHistory(): IsolationHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as IsolationHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: IsolationHistoryEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded — best-effort only.
  }
}

function buildHistoryEntry(r: IsolationCheckReport): IsolationHistoryEntry {
  const total = r.controls.length;
  const passed_count = r.controls.filter((c) => c.passed).length;
  return {
    ran_at: r.ran_at,
    passed: r.passed,
    total,
    passed_count,
    failed_count: total - passed_count,
    failed_controls: r.controls.filter((c) => !c.passed).map((c) => c.key),
    tenant1_company_id: r.tenant1_company_id,
    tenant2_company_id: r.tenant2_company_id,
    by_control: Object.fromEntries(
      r.controls.map((c) => [c.key, { passed: c.passed, actual: c.actual, error: c.error }]),
    ),
  };
}

function tableCountsFromReport(r: IsolationCheckReport) {
  const counts: Record<string, number> = {};
  for (const c of r.controls) {
    const t = c.query?.table;
    if (!t) continue;
    counts[t] = (counts[t] ?? 0) + 1;
  }
  return counts;
}

function downloadBlob(filename: string, mime: string, contents: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function tsSlug(iso: string) {
  return iso.replace(/[:.]/g, "-");
}

// -----------------------------------------------------------------------------
// Shared run metadata used by JSON / CSV / PDF exports so every artifact is
// self-contained (timestamp, caller identity + role, tenants, SQL/RLS notes).
// -----------------------------------------------------------------------------

type CallerContext = {
  email: string | null;
  user_id: string | null;
  roles: string[];
  company_id: string | null;
  company_name: string | null;
  is_admin: boolean;
};

type RunMetadata = {
  ran_at: string;
  exported_at: string;
  passed: boolean;
  pass_total: string;
  caller: CallerContext;
  tenant1: { id: string; name: string; source: string };
  tenant2: { id: string; name: string | null; source: string; caller_is_tenant2: boolean };
  ephemeral_admin_email: string | null;
  ephemeral_cleanup_error: string | null;
  cleanup_error: string | null;
  notes: string[];
  rls_notes: string[];
};

function collectRlsNotes(r: IsolationCheckReport): string[] {
  const out: string[] = [];
  for (const c of r.controls) {
    if (c.rls_error) {
      const code = c.rls_error.code ?? "—";
      const tag = c.rls_error.is_rls_block ? "RLS block" : "PG error";
      out.push(`[${tag} ${code}] ${c.tenant}/${c.key}: ${c.rls_error.message}`);
    } else if (!c.passed && c.query) {
      out.push(`[silent-filter] ${c.tenant}/${c.key}: expected=${c.expected} actual=${c.actual}`);
    }
  }
  return out;
}

function buildRunMetadata(r: IsolationCheckReport, caller: CallerContext): RunMetadata {
  const total = r.controls.length;
  const pass = r.controls.filter((c) => c.passed).length;
  return {
    ran_at: r.ran_at,
    exported_at: new Date().toISOString(),
    passed: r.passed,
    pass_total: `${pass}/${total}`,
    caller,
    tenant1: {
      id: r.tenant1_company_id,
      name: r.tenant1_company_name,
      source: r.tenant1_source,
    },
    tenant2: {
      id: r.tenant2_company_id,
      name: r.tenant2_company_name,
      source: r.tenant2_source,
      caller_is_tenant2: r.caller_is_tenant2,
    },
    ephemeral_admin_email: r.ephemeral_user_email,
    ephemeral_cleanup_error: r.ephemeral_user_cleanup_error,
    cleanup_error: r.cleanup_error,
    notes: r.notes,
    rls_notes: collectRlsNotes(r),
  };
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(r: IsolationCheckReport, meta: RunMetadata): string {
  const lines: string[] = [];
  // Metadata header block — comment-prefixed so spreadsheets treat it as notes
  // when imported, but stays inline for self-contained audit trail.
  const pushMeta = (k: string, v: unknown) => lines.push(`# ${k},${csvEscape(v)}`);
  pushMeta("exported_at", meta.exported_at);
  pushMeta("ran_at", meta.ran_at);
  pushMeta("passed", meta.passed);
  pushMeta("pass_total", meta.pass_total);
  pushMeta("caller_email", meta.caller.email);
  pushMeta("caller_user_id", meta.caller.user_id);
  pushMeta("caller_roles", meta.caller.roles.join("|"));
  pushMeta("caller_is_admin", meta.caller.is_admin);
  pushMeta("caller_company_id", meta.caller.company_id);
  pushMeta("caller_company_name", meta.caller.company_name);
  pushMeta("tenant1_id", meta.tenant1.id);
  pushMeta("tenant1_name", meta.tenant1.name);
  pushMeta("tenant1_source", meta.tenant1.source);
  pushMeta("tenant2_id", meta.tenant2.id);
  pushMeta("tenant2_name", meta.tenant2.name);
  pushMeta("tenant2_source", meta.tenant2.source);
  pushMeta("caller_is_tenant2", meta.tenant2.caller_is_tenant2);
  pushMeta("ephemeral_admin_email", meta.ephemeral_admin_email);
  pushMeta("ephemeral_cleanup_error", meta.ephemeral_cleanup_error);
  pushMeta("cleanup_error", meta.cleanup_error);
  for (const n of meta.notes) pushMeta("note", n);
  for (const n of meta.rls_notes) pushMeta("rls_note", n);
  lines.push("");
  // Data rows
  const headers = [
    "tenant",
    "kind",
    "control_key",
    "label",
    "expected",
    "actual",
    "passed",
    "error",
    "client",
    "op",
    "table",
    "sql",
    "filters",
    "payload",
    "rls_code",
    "rls_message",
    "rls_is_block",
    "rls_details",
    "rls_hint",
  ];
  lines.push(headers.join(","));
  for (const c of r.controls) {
    lines.push(
      [
        c.tenant,
        c.kind,
        c.key,
        c.label,
        c.expected,
        c.actual,
        c.passed,
        c.error ?? "",
        c.query?.client ?? "",
        c.query?.op ?? "",
        c.query?.table ?? "",
        c.query?.sql ?? "",
        c.query ? JSON.stringify(c.query.filters) : "",
        c.query ? JSON.stringify(c.query.payload) : "",
        c.rls_error?.code ?? "",
        c.rls_error?.message ?? "",
        c.rls_error?.is_rls_block ?? "",
        c.rls_error?.details ?? "",
        c.rls_error?.hint ?? "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\n");
}

function buildPdf(r: IsolationCheckReport, meta: RunMetadata): Blob {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const marginX = 32;
  let y = 40;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Tenant Isolation Check Report", marginX, y);
  y += 20;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(meta.passed ? 20 : 180, meta.passed ? 120 : 30, 40);
  doc.text(`Status: ${meta.passed ? "PASS" : "FAIL"} (${meta.pass_total})`, marginX, y);
  doc.setTextColor(30, 30, 30);
  y += 16;

  // Metadata table
  autoTable(doc, {
    startY: y,
    theme: "plain",
    styles: { fontSize: 8, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 130 } },
    body: [
      ["Exported at", meta.exported_at],
      ["Ran at", meta.ran_at],
      ["Caller", `${meta.caller.email ?? "—"}  (${meta.caller.user_id ?? "—"})`],
      ["Caller roles", meta.caller.roles.join(", ") || "—"],
      ["Caller is admin", String(meta.caller.is_admin)],
      ["Caller company", `${meta.caller.company_name ?? "—"} · ${meta.caller.company_id ?? "—"}`],
      ["Tenant #1", `${meta.tenant1.name} · ${meta.tenant1.id} · source=${meta.tenant1.source}`],
      [
        "Tenant #2",
        `${meta.tenant2.name ?? "—"} · ${meta.tenant2.id} · source=${meta.tenant2.source} · caller_is_tenant2=${meta.tenant2.caller_is_tenant2}`,
      ],
      ["Ephemeral admin", meta.ephemeral_admin_email ?? "—"],
      ["Ephemeral cleanup error", meta.ephemeral_cleanup_error ?? "—"],
      ["Cleanup error", meta.cleanup_error ?? "—"],
    ],
  });
  // @ts-expect-error jspdf-autotable augments the doc with lastAutoTable
  y = (doc.lastAutoTable?.finalY ?? y) + 14;

  if (meta.notes.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Advisory notes", marginX, y);
    y += 4;
    autoTable(doc, {
      startY: y + 4,
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 3 },
      head: [["#", "Note"]],
      body: meta.notes.map((n, i) => [String(i + 1), n]),
    });
    // @ts-expect-error see above
    y = (doc.lastAutoTable?.finalY ?? y) + 14;
  }

  if (meta.rls_notes.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("SQL / RLS notes", marginX, y);
    autoTable(doc, {
      startY: y + 4,
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 3 },
      head: [["#", "Detail"]],
      body: meta.rls_notes.map((n, i) => [String(i + 1), n]),
    });
    // @ts-expect-error see above
    y = (doc.lastAutoTable?.finalY ?? y) + 14;
  }

  // Controls table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Controls", marginX, y);
  autoTable(doc, {
    startY: y + 4,
    theme: "striped",
    styles: { fontSize: 7, cellPadding: 2, overflow: "linebreak" },
    headStyles: { fillColor: [40, 40, 40] },
    head: [["Tenant", "Kind", "Control", "Expected", "Actual", "Result", "SQL", "RLS error"]],
    body: r.controls.map((c) => [
      c.tenant,
      c.kind,
      `${c.key}\n${c.label}`,
      c.expected,
      c.actual,
      c.passed ? "PASS" : `FAIL${c.error ? `\n${c.error}` : ""}`,
      c.query ? `[${c.query.client}] ${c.query.sql}` : "—",
      c.rls_error
        ? `${c.rls_error.is_rls_block ? "RLS " : ""}${c.rls_error.code ?? ""} ${c.rls_error.message}`
        : "—",
    ]),
    columnStyles: {
      0: { cellWidth: 45 },
      1: { cellWidth: 45 },
      2: { cellWidth: 110 },
      3: { cellWidth: 90 },
      4: { cellWidth: 90 },
      5: { cellWidth: 60 },
      6: { cellWidth: 200 },
      7: { cellWidth: 130 },
    },
  });

  // Footer with page numbers
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `Isolation report · exported ${meta.exported_at} · page ${i}/${pageCount}`,
      marginX,
      doc.internal.pageSize.getHeight() - 16,
    );
  }
  return doc.output("blob");
}

function downloadPdfBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ControlRow({ c }: { c: ControlResult }) {
  const [open, setOpen] = useState(!c.passed);
  const hasDetail = c.query != null || c.rls_error != null;
  return (
    <>
      <tr className="border-t align-top">
        <td className="px-3 py-2">
          {hasDetail ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={open ? "Collapse details" : "Expand details"}
            >
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : null}
        </td>
        <td className="px-3 py-2">
          <Badge variant={c.kind === "positive" ? "secondary" : "outline"}>{c.kind}</Badge>
        </td>
        <td className="px-3 py-2">{c.label}</td>
        <td className="px-3 py-2 font-mono text-xs">{c.expected}</td>
        <td className="px-3 py-2 font-mono text-xs break-all">{c.actual}</td>
        <td className="px-3 py-2">
          {c.passed ? (
            <Badge variant="secondary" className="gap-1">
              <ShieldCheck className="h-3 w-3" /> pass
            </Badge>
          ) : (
            <div className="space-y-1">
              <Badge variant="destructive" className="gap-1">
                <ShieldAlert className="h-3 w-3" /> FAIL
              </Badge>
              {c.error ? <div className="text-xs text-destructive break-all">{c.error}</div> : null}
            </div>
          )}
        </td>
      </tr>
      {open && hasDetail ? (
        <tr className="border-t bg-muted/30">
          <td></td>
          <td colSpan={5} className="px-3 py-3 space-y-3">
            {c.query ? (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  Exact query · <span className="font-mono normal-case">{c.query.client}</span>
                </div>
                <pre className="text-xs font-mono bg-background border rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                  {c.query.sql}
                </pre>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 text-[11px]">
                  <div>
                    <span className="text-muted-foreground">op:</span>{" "}
                    <span className="font-mono">{c.query.op}</span>{" "}
                    <span className="text-muted-foreground ml-2">table:</span>{" "}
                    <span className="font-mono">public.{c.query.table}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">columns:</span>{" "}
                    <span className="font-mono">{c.query.columns || "—"}</span>
                    {c.query.head ? <span className="ml-2 text-muted-foreground">head</span> : null}
                    {c.query.count !== "none" ? (
                      <span className="ml-2 text-muted-foreground">count={c.query.count}</span>
                    ) : null}
                  </div>
                  {Object.keys(c.query.filters).length > 0 ? (
                    <div className="md:col-span-2">
                      <span className="text-muted-foreground">filters:</span>{" "}
                      <span className="font-mono break-all">{JSON.stringify(c.query.filters)}</span>
                    </div>
                  ) : null}
                  {Object.keys(c.query.payload).length > 0 ? (
                    <div className="md:col-span-2">
                      <span className="text-muted-foreground">payload:</span>{" "}
                      <span className="font-mono break-all">{JSON.stringify(c.query.payload)}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            {c.rls_error ? (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-2">
                  Postgres / PostgREST error
                  {c.rls_error.is_rls_block ? (
                    <Badge variant="secondary" className="gap-1">
                      <ShieldCheck className="h-3 w-3" /> RLS policy block (42501)
                    </Badge>
                  ) : (
                    <Badge variant="outline">non-RLS error</Badge>
                  )}
                </div>
                <div className="text-xs font-mono bg-background border rounded p-2 space-y-1 break-all">
                  <div>
                    <span className="text-muted-foreground">code:</span> {c.rls_error.code ?? "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">message:</span> {c.rls_error.message}
                  </div>
                  {c.rls_error.details ? (
                    <div>
                      <span className="text-muted-foreground">details:</span> {c.rls_error.details}
                    </div>
                  ) : null}
                  {c.rls_error.hint ? (
                    <div>
                      <span className="text-muted-foreground">hint:</span> {c.rls_error.hint}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : c.query ? (
              <div className="text-xs text-muted-foreground">
                No Postgres error returned — request succeeded (RLS may have filtered rows
                silently).
              </div>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function TenantControls({
  title,
  subtitle,
  controls,
}: {
  title: string;
  subtitle: string;
  controls: ControlResult[];
}) {
  const passed = controls.every((c) => c.passed);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        </div>
        {passed ? (
          <Badge variant="secondary" className="gap-1">
            <ShieldCheck className="h-3 w-3" /> All passed
          </Badge>
        ) : (
          <Badge variant="destructive" className="gap-1">
            <ShieldAlert className="h-3 w-3" /> Failure
          </Badge>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 w-8"></th>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Control</th>
              <th className="px-3 py-2">Expected</th>
              <th className="px-3 py-2">Actual</th>
              <th className="px-3 py-2">Result</th>
            </tr>
          </thead>
          <tbody>
            {controls.map((c) => (
              <ControlRow key={c.key} c={c} />
            ))}
          </tbody>
        </table>
        <div className="px-3 py-2 text-[11px] text-muted-foreground border-t">
          Click the ▸ to expand a row and inspect the exact query and any Postgres/RLS error
          returned.
        </div>
      </CardContent>
    </Card>
  );
}

function IsolationCheckPage() {
  const { isAdmin, loading, user, roles, companyId, companyName } = useAuth();
  const caller: CallerContext = {
    email: user?.email ?? null,
    user_id: user?.id ?? null,
    roles: roles as string[],
    company_id: companyId,
    company_name: companyName,
    is_admin: isAdmin,
  };
  const runCheck = useServerFn(runIsolationCheck);
  const sweep = useServerFn(sweepIsolationArtifacts);
  const [lastSweep, setLastSweep] = useState<SweepIsolationResult | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const runningRef = useRef(false);

  const doSweep = async (reason: "mount" | "post-run" | "unload" | "manual") => {
    if (!isAdmin) return;
    try {
      setSweeping(true);
      const res = await sweep({ data: undefined });
      setLastSweep(res);
      // Suppress console noise for the routine mount/unload passes.
      if (reason === "manual" && (res.markers_deleted || res.auth_users_deleted)) {
        // no-op; UI updates via state
      }
    } catch {
      // Best-effort; failures surface via lastSweep === null and the manual button.
    } finally {
      setSweeping(false);
    }
  };

  const [history, setHistory] = useState<IsolationHistoryEntry[]>(() => loadHistory());
  const [tenant1Id, setTenant1Id] = useState<string>("__auto__");
  const [tenant2Id, setTenant2Id] = useState<string>("__auto__");

  const listCompanies = useServerFn(listIsolationCompanies);
  const companiesQ = useQuery<IsolationCompanyOption[]>({
    queryKey: ["isolation-companies"],
    queryFn: () => listCompanies({ data: undefined }),
    enabled: !!isAdmin,
    staleTime: 30_000,
  });
  const companies = companiesQ.data ?? [];

  const runM = useMutation<IsolationCheckReport>({
    mutationFn: async () => {
      runningRef.current = true;
      try {
        const res = await runCheck({
          data: {
            tenant1_id: tenant1Id === "__auto__" ? null : tenant1Id,
            tenant2_id: tenant2Id === "__auto__" ? null : tenant2Id,
          },
        });
        // Persist a compact history entry per run for regression tracking.
        const entry = buildHistoryEntry(res);
        setHistory((prev) => {
          const next = [entry, ...prev].slice(0, MAX_HISTORY);
          saveHistory(next);
          return next;
        });
        return res;
      } finally {
        runningRef.current = false;
        // Always sweep after a run, regardless of success/failure.
        void doSweep("post-run");
      }
    },
  });

  const swapTenants = () => {
    setTenant1Id((prev) => {
      const other = tenant2Id;
      setTenant2Id(prev);
      return other;
    });
  };

  // On mount: sweep any orphans left by a previous crashed/abandoned run.
  // On unmount and on tab close: fire a best-effort sweep so nothing lingers.
  useEffect(() => {
    if (!isAdmin) return;
    void doSweep("mount");
    const onPageHide = () => {
      // Fire-and-forget; the server handler completes independently of the
      // response reaching this (soon-to-be-gone) tab.
      void sweep({ data: undefined }).catch(() => {});
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      void sweep({ data: undefined }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  if (loading) return null;
  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="Isolation Check" description="Restricted area" />
        <AdminRequiredMessage action="Running the tenant isolation check" />
      </div>
    );
  }

  const report = runM.data ?? null;
  const t1 = report?.controls.filter((c) => c.tenant === "tenant1") ?? [];
  const t2 = report?.controls.filter((c) => c.tenant === "tenant2") ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Isolation Check"
        description="Runs positive and negative controls in tenant #1 and tenant #2 and reports pass/fail for each."
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4" /> Tenant switcher
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Pick any two tenants to probe. Leave either on <b>Auto</b> to use the defaults (scratch
            tenant for #1, your own tenant for #2). When tenant #2 isn't your own tenant, the
            current-user RLS probes are skipped and the ephemeral signed-in admin (created inside
            tenant #2) handles the live-RLS checks.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_auto_1fr] items-end">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Tenant #1 (foreign)</label>
            <Select value={tenant1Id} onValueChange={setTenant1Id}>
              <SelectTrigger>
                <SelectValue placeholder="Select tenant #1" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto__">Auto — scratch tenant</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id} disabled={c.id === tenant2Id}>
                    {c.name ?? "(unnamed)"}
                    {c.is_scratch ? " · scratch" : ""}
                    {c.is_active === false ? " · inactive" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="mb-0.5 min-h-11 min-w-11"
            onClick={swapTenants}
            aria-label="Swap tenants"
            disabled={runM.isPending}
          >
            <ArrowLeftRight className="h-4 w-4" />
          </Button>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Tenant #2 (self)</label>
            <Select value={tenant2Id} onValueChange={setTenant2Id}>
              <SelectTrigger>
                <SelectValue placeholder="Select tenant #2" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto__">Auto — your tenant</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id} disabled={c.id === tenant1Id}>
                    {c.name ?? "(unnamed)"}
                    {c.is_scratch ? " · scratch" : ""}
                    {c.is_active === false ? " · inactive" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {companiesQ.error ? (
            <div className="md:col-span-3 text-xs text-destructive">
              Failed to load tenants: {(companiesQ.error as Error).message}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="text-sm text-muted-foreground">
            Seeds a marker row in each tenant and asserts: own rows are visible, foreign rows are
            not, and cross-tenant writes are blocked. Markers are deleted afterward.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => runM.mutate()} disabled={runM.isPending}>
              <FlaskConical className={`mr-2 h-4 w-4 ${runM.isPending ? "animate-pulse" : ""}`} />
              {runM.isPending ? "Running…" : "Run isolation check"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!report}
              onClick={() => {
                if (!report) return;
                const meta = buildRunMetadata(report, caller);
                const payload = {
                  schema_version: 2,
                  metadata: meta,
                  summary: buildHistoryEntry(report),
                  table_counts: tableCountsFromReport(report),
                  report,
                };
                downloadBlob(
                  `isolation-check-${tsSlug(report.ran_at)}.json`,
                  "application/json",
                  JSON.stringify(payload, null, 2),
                );
              }}
            >
              <Download className="mr-2 h-4 w-4" /> Export JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!report}
              onClick={() => {
                if (!report) return;
                const meta = buildRunMetadata(report, caller);
                downloadBlob(
                  `isolation-check-${tsSlug(report.ran_at)}.csv`,
                  "text/csv;charset=utf-8",
                  buildCsv(report, meta),
                );
              }}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!report}
              onClick={() => {
                if (!report) return;
                const meta = buildRunMetadata(report, caller);
                try {
                  downloadPdfBlob(
                    `isolation-check-${tsSlug(report.ran_at)}.pdf`,
                    buildPdf(report, meta),
                  );
                } catch (e) {
                  toast.error(`PDF export failed: ${(e as Error).message}`);
                }
              }}
            >
              <FileText className="mr-2 h-4 w-4" /> Export PDF
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!report}
              onClick={async () => {
                if (!report) return;
                const meta = buildRunMetadata(report, caller);
                const payload = {
                  schema_version: 2,
                  metadata: meta,
                  summary: buildHistoryEntry(report),
                  table_counts: tableCountsFromReport(report),
                  report,
                };
                try {
                  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                  toast.success("Report JSON copied to clipboard");
                } catch {
                  toast.error("Clipboard blocked — use Export JSON");
                }
              }}
            >
              <Copy className="mr-2 h-4 w-4" /> Copy
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4" /> Run history
              <span className="text-xs text-muted-foreground font-normal">
                {history.length}/{MAX_HISTORY} runs stored locally
              </span>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Compact per-run pass/fail summary saved in this browser. Export the full JSON to track
              regressions across environments or commit them to a repo.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={history.length === 0}
              onClick={() => {
                const payload = {
                  schema_version: 1,
                  exported_at: new Date().toISOString(),
                  count: history.length,
                  runs: history,
                };
                downloadBlob(
                  `isolation-check-history-${tsSlug(new Date().toISOString())}.json`,
                  "application/json",
                  JSON.stringify(payload, null, 2),
                );
              }}
            >
              <Download className="mr-2 h-4 w-4" /> Export history
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={history.length === 0}
              onClick={() => {
                if (!window.confirm("Clear locally stored run history?")) return;
                setHistory([]);
                saveHistory([]);
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Clear
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {history.length === 0 ? (
            <div className="px-4 py-4 text-xs text-muted-foreground">No runs recorded yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Pass / Total</th>
                  <th className="px-3 py-2">Failed controls</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={`${h.ran_at}-${i}`} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">
                      {new Date(h.ran_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      {h.passed ? (
                        <Badge variant="secondary" className="gap-1">
                          <ShieldCheck className="h-3 w-3" /> pass
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1">
                          <ShieldAlert className="h-3 w-3" /> fail
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {h.passed_count} / {h.total}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs break-all">
                      {h.failed_controls.length === 0 ? "—" : h.failed_controls.join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="text-xs text-muted-foreground flex-1 min-w-[240px]">
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              <Sparkles className="h-3.5 w-3.5" /> Automatic cleanup
            </div>
            <div className="mt-0.5">
              Sweeps marker leads (<code className="font-mono">__iso_*</code>,{" "}
              <code className="font-mono">__isolation_probe_*</code>) and ephemeral admin users (
              <code className="font-mono">iso-admin-*@isolation.test</code>) on page open, after
              each run, on navigation away, and on tab close.
              {lastSweep ? (
                <span>
                  {" "}
                  Last pass at {new Date(lastSweep.ran_at).toLocaleTimeString()}:{" "}
                  <span
                    className={
                      lastSweep.markers_deleted + lastSweep.auth_users_deleted > 0
                        ? "text-foreground font-medium"
                        : "text-success"
                    }
                  >
                    {lastSweep.markers_deleted} marker(s), {lastSweep.auth_users_deleted} user(s)
                    removed
                  </span>
                  {lastSweep.errors.length + lastSweep.auth_user_errors.length > 0 ? (
                    <span className="text-destructive">
                      {" "}
                      · {lastSweep.errors.length + lastSweep.auth_user_errors.length} error(s)
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => doSweep("manual")} disabled={sweeping}>
            <Sparkles className={`mr-2 h-4 w-4 ${sweeping ? "animate-pulse" : ""}`} />
            {sweeping ? "Sweeping…" : "Sweep now"}
          </Button>
        </CardContent>
      </Card>

      {runM.error ? (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">
            {(runM.error as Error).message}
          </CardContent>
        </Card>
      ) : null}

      {report ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {report.passed ? (
                  <Badge variant="secondary" className="gap-1">
                    <ShieldCheck className="h-3 w-3" /> Isolation verified
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <ShieldAlert className="h-3 w-3" /> Isolation FAILED
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground font-normal">
                  {new Date(report.ran_at).toLocaleString()}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <div className="rounded border p-3 space-y-1">
                <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  Tenant #1
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {report.tenant1_source === "scratch" ? "auto · scratch" : "override"}
                  </Badge>
                </div>
                <div className="font-mono text-xs break-all">{report.tenant1_company_id}</div>
                <div className="text-sm">{report.tenant1_company_name}</div>
                <div className="text-xs text-muted-foreground">
                  marker id: <span className="font-mono">{report.marker1_id ?? "—"}</span>
                </div>
              </div>
              <div className="rounded border p-3 space-y-1">
                <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  Tenant #2
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {report.tenant2_source === "caller" ? "auto · your tenant" : "override"}
                  </Badge>
                  {!report.caller_is_tenant2 ? (
                    <Badge variant="outline" className="text-[10px] font-normal">
                      caller ≠ tenant #2
                    </Badge>
                  ) : null}
                </div>
                <div className="font-mono text-xs break-all">{report.tenant2_company_id}</div>
                <div className="text-sm">{report.tenant2_company_name ?? "—"}</div>
                <div className="text-xs text-muted-foreground">
                  marker id: <span className="font-mono">{report.marker2_id ?? "—"}</span>
                </div>
                {report.ephemeral_user_email ? (
                  <div className="text-xs text-muted-foreground pt-1 border-t mt-1">
                    ephemeral admin:{" "}
                    <span className="font-mono">{report.ephemeral_user_email}</span>
                    {report.ephemeral_user_cleanup_error ? (
                      <span className="text-destructive">
                        {" "}
                        · cleanup failed: {report.ephemeral_user_cleanup_error}
                      </span>
                    ) : (
                      <span> · deleted after probe</span>
                    )}
                  </div>
                ) : null}
              </div>
              {report.notes.length > 0 ? (
                <div className="md:col-span-2 text-xs text-muted-foreground border rounded p-2 bg-muted/30 space-y-1">
                  {report.notes.map((n, i) => (
                    <div key={i}>· {n}</div>
                  ))}
                </div>
              ) : null}
              {report.cleanup_error ? (
                <div className="md:col-span-2 text-xs text-destructive">
                  Cleanup error: {report.cleanup_error}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <TenantControls
            title="Tenant #1 controls"
            subtitle="Authoritative checks against the raw table (admin key) verifying the marker sits under tenant #1 and never under tenant #2."
            controls={t1}
          />
          <TenantControls
            title="Tenant #2 controls (live API + RLS)"
            subtitle="Runs as the current user AND as a freshly-provisioned tenant #2 admin who signs in with a real JWT. Own marker must be readable; tenant #1's marker must be invisible to reads and unaffected by updates; cross-tenant writes must be blocked."
            controls={t2}
          />
        </>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No check has run yet. Click <b>Run isolation check</b>.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
