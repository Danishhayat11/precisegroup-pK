import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { escapeCsvCell } from "@/lib/csv";
import { useAuth } from "@/lib/auth";
import { useCurrentCompany } from "@/hooks/useCurrentCompany";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader } from "@/components/PageHeader";
import { AdminRequiredMessage } from "@/lib/adminGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";
import {
  runTenantIsolationTest,
  shareIsolationReport,
  type IsolationReport,
  type ShareIsolationReportResult,
} from "@/lib/tenantIsolationTest.functions";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Download,
  FileText,
  RefreshCw,
  FileJson,
  Link2,
  Copy,
} from "lucide-react";
import { TenantSwitcher } from "@/components/TenantSwitcher";
import { toast } from "sonner";

// Shared shape so CSV and PDF exports stay in lock-step: identical metadata
// order, identical column names, identical units, identical row order.
const CHECK_COLUMNS = [
  "Check",
  "Tenant #1 (row count)",
  "Tenant #2 (row count)",
  "Result",
  "Note",
  "Probe kind",
  "Expected",
  "Actual",
  "Probe error",
  "Raw probe response (JSON)",
] as const;

function buildMetadataRows(report: IsolationReport, generatedAt: string): Array<[string, string]> {
  return [
    ["Generated (ISO 8601 UTC)", generatedAt],
    [
      "Direction",
      report.direction === "1->2" ? "tenant #1 -> tenant #2" : "tenant #2 -> tenant #1",
    ],
    ["Caller company_id", report.callerCompanyId],
    ["Other company_id", report.otherCompanyId],
    ["Tenant #1 company_id", report.tenant1CompanyId],
    ["Tenant #2 company_id", report.tenant2CompanyId],
    ["Marker", report.marker],
    ["Overall result", report.overallPassed ? "PASS" : "FAIL"],
    ["Cleanup", report.cleanedUp ? "Marker deleted" : "Not run"],
  ];
}

function buildCheckRows(report: IsolationReport): string[][] {
  return report.checks.map((c) => [
    c.table,
    String(c.tenant1Count),
    String(c.tenant2Count),
    c.passed ? "PASS" : "FAIL",
    c.note ?? "",
    c.raw?.kind ?? "",
    c.raw?.expected ?? "",
    c.raw?.actual ?? "",
    c.raw?.error ?? "",
    c.raw?.probe_response_json ?? "",
  ]);
}

function toCsv(report: IsolationReport, generatedAt: string): string {
  const rows: string[][] = [
    ["Tenant Isolation Report"],
    ...buildMetadataRows(report, generatedAt).map(([k, v]) => [k, v]),
    [],
    [...CHECK_COLUMNS],
    ...buildCheckRows(report),
  ];
  // Delegate to the shared escaper so formula-injection neutralization
  // (leading =, +, -, @, TAB, CR) applies to every emitted cell.
  return rows.map((r) => r.map((v) => escapeCsvCell(v)).join(",")).join("\n");
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportPdf(report: IsolationReport, generatedAt: string) {
  const [{ jsPDF }, autoTable] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable").then((m) => m.default),
  ]);
  // Landscape so the raw probe columns don't force horrific wrapping.
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const ts = generatedAt.replace(/[:.]/g, "-");

  doc.setFontSize(16);
  doc.text("Tenant Isolation Report", 40, 50);

  autoTable(doc, {
    startY: 68,
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 180 } },
    body: buildMetadataRows(report, generatedAt),
  });
  // @ts-expect-error jspdf-autotable augments the doc with lastAutoTable
  const afterMeta = (doc.lastAutoTable?.finalY ?? 68) + 16;

  autoTable(doc, {
    startY: afterMeta,
    head: [[...CHECK_COLUMNS]],
    body: buildCheckRows(report),
    styles: { fontSize: 7, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: [30, 41, 59], fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 90 }, // Check
      1: { cellWidth: 45 }, // T#1
      2: { cellWidth: 45 }, // T#2
      3: { cellWidth: 35 }, // Result
      4: { cellWidth: 120 }, // Note
      5: { cellWidth: 45 }, // Probe kind
      6: { cellWidth: 110 }, // Expected
      7: { cellWidth: 90 }, // Actual
      8: { cellWidth: 70 }, // Probe error
      9: { cellWidth: 150 }, // Raw JSON
    },
  });

  doc.save(`tenant-isolation-${ts}.pdf`);
}

function Page() {
  const { isAdmin, loading } = useAuth();
  const runTest = useServerFn(runTenantIsolationTest);
  const shareReport = useServerFn(shareIsolationReport);
  const { companyId } = useCurrentCompany();
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<IsolationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [share, setShare] = useState<ShareIsolationReportResult | null>(null);

  const TENANT_1_ID = "00000000-0000-0000-0000-000000000001";
  const TENANT_2_ID = "00000000-0000-0000-0000-000000000002";
  const isTenant2 = companyId === TENANT_2_ID;
  const isTenant1 = companyId === TENANT_1_ID;

  if (loading) return null;
  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="Tenant Isolation Test" description="Restricted area" />
        <AdminRequiredMessage action="Running the tenant isolation test" />
      </div>
    );
  }

  const onRun = async () => {
    setRunning(true);
    setError(null);
    setReport(null);
    setShare(null);
    try {
      const result = await runTest();
      setReport(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const onShare = async () => {
    if (!report) return;
    setSharing(true);
    try {
      const res = await shareReport({ data: { report } });
      setShare(res);
      try {
        await navigator.clipboard.writeText(res.url);
        toast.success("Shareable link created and copied to clipboard");
      } catch {
        toast.success("Shareable link created");
      }
    } catch (e) {
      toast.error(`Share failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tenant Isolation Test"
        description="Creates a marker record in your tenant and verifies it is invisible to the second test tenant."
      />

      <TenantSwitcher />

      {isTenant2 && !report && (
        <Alert className="border-primary">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <AlertTitle>Mirror test ready</AlertTitle>
          <AlertDescription>
            You are signed in as <strong>tenant #2</strong>. Running the test now will plant a
            marker in tenant #2 and verify it stays invisible to tenant #1 — the mirror of the
            tenant #1 → #2 direction.
          </AlertDescription>
        </Alert>
      )}
      {isTenant1 && !report && (
        <Alert>
          <AlertTitle>Tenant #1 session</AlertTitle>
          <AlertDescription>
            Running the test now checks the tenant #1 → #2 direction. Sign in as a tenant #2 admin
            to run the mirror check.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>End-to-end check</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Inserts a marker CRM lead into your company, then confirms via database-level checks
            that (a) it exists only under your company_id, (b) tenant #2's row counts stay separate,
            and (c) RLS blocks your session from reading any tenant #2 rows. The marker is deleted
            at the end.
          </p>
          <Button onClick={onRun} disabled={running}>
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running…
              </>
            ) : (
              "Run isolation test"
            )}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {report && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {report.overallPassed ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-success" />
                  <span>Isolation verified</span>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-destructive" />
                  <span>Isolation FAILED — investigate immediately</span>
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={onRun} disabled={running}>
                {running ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running…
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" /> Run isolation test
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const generatedAt = new Date().toISOString();
                  const ts = generatedAt.replace(/[:.]/g, "-");
                  downloadBlob(
                    `tenant-isolation-${ts}.csv`,
                    new Blob([toCsv(report, generatedAt)], { type: "text/csv;charset=utf-8" }),
                  );
                }}
              >
                <Download className="mr-2 h-4 w-4" /> Export CSV
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const generatedAt = new Date().toISOString();
                  const ts = generatedAt.replace(/[:.]/g, "-");
                  const payload = {
                    schema_version: 1,
                    generated_at: generatedAt,
                    report,
                  };
                  downloadBlob(
                    `tenant-isolation-${ts}.json`,
                    new Blob([JSON.stringify(payload, null, 2)], {
                      type: "application/json",
                    }),
                  );
                }}
              >
                <FileJson className="mr-2 h-4 w-4" /> Export JSON
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void exportPdf(report, new Date().toISOString());
                }}
              >
                <FileText className="mr-2 h-4 w-4" /> Export PDF
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onShare}
                disabled={sharing}
              >
                {sharing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating link…
                  </>
                ) : (
                  <>
                    <Link2 className="mr-2 h-4 w-4" /> Create shareable link
                  </>
                )}
              </Button>
            </div>

            {share && (
              <div className="rounded border bg-muted/30 p-3 space-y-2 text-sm">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                  <Link2 className="h-3.5 w-3.5" /> Shareable download link
                  <Badge variant="outline" className="text-[10px] font-normal">
                    expires {new Date(share.expires_at).toLocaleString()}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={share.url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 min-w-0 rounded border bg-background px-2 py-1 font-mono text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-11 min-w-11"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(share.url);
                        toast.success("Link copied to clipboard");
                      } catch {
                        toast.error("Clipboard blocked — select and copy manually");
                      }
                    }}
                    aria-label="Copy shareable link"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Anyone with this link can download the report JSON from another browser or session
                  until it expires. Delete the file from storage to revoke early.
                </p>
              </div>
            )}

            <div className="grid gap-1 text-sm">
              <div>
                <span className="text-muted-foreground">Direction:</span>{" "}
                <code>
                  {report.direction === "1->2" ? "tenant #1 → tenant #2" : "tenant #2 → tenant #1"}
                </code>
              </div>
              <div>
                <span className="text-muted-foreground">Caller (yours):</span>{" "}
                <code>{report.callerCompanyId}</code>
              </div>
              <div>
                <span className="text-muted-foreground">Other tenant:</span>{" "}
                <code>{report.otherCompanyId}</code>
              </div>
              <div>
                <span className="text-muted-foreground">Marker:</span> <code>{report.marker}</code>
              </div>
              <div>
                <span className="text-muted-foreground">Cleanup:</span>{" "}
                {report.cleanedUp ? "marker row deleted" : "not run"}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-4">Check</th>
                    <th className="py-2 pr-4">Tenant #1</th>
                    <th className="py-2 pr-4">Tenant #2</th>
                    <th className="py-2 pr-4">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {report.checks.map((c, i) => (
                    <tr key={i} className="border-b last:border-b-0 align-top">
                      <td className="py-2 pr-4">
                        <div className="font-medium">{c.table}</div>
                        {c.note && <div className="text-xs text-muted-foreground">{c.note}</div>}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">{c.tenant1Count}</td>
                      <td className="py-2 pr-4 tabular-nums">{c.tenant2Count}</td>
                      <td className="py-2 pr-4">
                        {c.passed ? (
                          <Badge variant="secondary" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Pass
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1">
                            <XCircle className="h-3 w-3" /> Fail
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/tenant-isolation-test")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Tenant Isolation Test"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Tenant Isolation Test",
    backTo: "/",
  }),
});
