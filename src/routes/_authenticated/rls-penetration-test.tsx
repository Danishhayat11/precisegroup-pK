import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { AdminRequiredMessage } from "@/lib/adminGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2, XCircle, Loader2, ShieldCheck, ShieldAlert } from "lucide-react";
import { runRlsPenetrationTest, type RlsPentestReport } from "@/lib/rlsPenetrationTest.functions";

export const Route = createFileRoute("/_authenticated/rls-penetration-test")({
  ssr: false,
  component: Page,
});

function short(v: string | null) {
  return v ? v.slice(0, 8) : "-";
}

function Page() {
  const { isAdmin, loading } = useAuth();
  const runTest = useServerFn(runRlsPenetrationTest);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<RlsPentestReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loading) return null;
  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="RLS Penetration Test" description="Restricted area" />
        <AdminRequiredMessage action="Running the RLS penetration test" />
      </div>
    );
  }

  const onRun = async () => {
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      setReport(await runTest());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="RLS Penetration Test"
        description="Seeds a probe row in the OTHER tenant and attempts SELECT / UPDATE / DELETE from your session to confirm RLS blocks every operation."
      />

      <Card>
        <CardHeader>
          <CardTitle>Automated attack</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Uses admin credentials to plant a marker CRM lead in the other test tenant, then tries
            three cross-tenant operations using your authenticated session (RLS applies). The probe
            is deleted afterwards no matter what happens.
          </p>
          <Button onClick={onRun} disabled={running}>
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running…
              </>
            ) : (
              <>
                <ShieldCheck className="mr-2 h-4 w-4" /> Run RLS penetration test
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Test failed to run</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {report && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {report.overallBlocked ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-success" />
                  <span>All cross-tenant operations blocked</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="h-5 w-5 text-destructive" />
                  <span>RLS FAILED — data leak detected</span>
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-1 text-sm">
              <div>
                Caller company: <code className="font-mono">{short(report.callerCompanyId)}</code>
              </div>
              <div>
                Target (other) company:{" "}
                <code className="font-mono">{short(report.otherCompanyId)}</code>
              </div>
              <div>
                Probe table: <code className="font-mono">{report.probeTable}</code>
              </div>
              <div>
                Probe row id: <code className="font-mono">{short(report.probeId)}</code>
              </div>
              <div>
                Probe row intact after attack:{" "}
                {report.probeIntactAfter ? (
                  <Badge variant="secondary">unchanged</Badge>
                ) : (
                  <Badge variant="destructive">TAMPERED / DELETED</Badge>
                )}
              </div>
              <div>Ran at: {new Date(report.ranAt).toLocaleString()}</div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2">Operation</th>
                    <th className="px-3 py-2">Table</th>
                    <th className="px-3 py-2 text-right">Rows returned</th>
                    <th className="px-3 py-2">Error</th>
                    <th className="px-3 py-2">Result</th>
                    <th className="px-3 py-2">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {report.attempts.map((a) => (
                    <tr key={a.operation} className="border-t align-top">
                      <td className="px-3 py-2 font-mono">{a.operation}</td>
                      <td className="px-3 py-2 font-mono text-xs">{a.table}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{a.rows_returned}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {a.error_code ?? "-"}
                        {a.error_message ? (
                          <div className="text-muted-foreground">{a.error_message}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        {a.blocked ? (
                          <Badge variant="secondary" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" /> BLOCKED
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1">
                            <XCircle className="h-3 w-3" /> LEAK
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{a.note}</td>
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
