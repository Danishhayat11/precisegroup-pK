import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { AdminRequiredMessage } from "@/lib/adminGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Trash2, CheckCircle2, AlertTriangle, Zap } from "lucide-react";
import {
  cleanupTestTenant,
  TEST_TENANT_DEFAULT_ID,
  type TenantCleanupReport,
} from "@/lib/cleanupTestTenant.functions";

export const Route = createFileRoute("/_authenticated/admin/cleanup-test-tenant")({
  ssr: false,
  component: Page,
});

function Page() {
  const { isAdmin, loading } = useAuth();
  const run = useServerFn(cleanupTestTenant);
  const [companyId, setCompanyId] = useState(TEST_TENANT_DEFAULT_ID);
  const [confirm, setConfirm] = useState("");
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<TenantCleanupReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loading) return null;
  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="Cleanup Test Tenant" description="Restricted area" />
        <AdminRequiredMessage action="Cleaning up test tenant data" />
      </div>
    );
  }

  const executeCleanup = async (targetId: string, confirmText: string) => {
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      setReport(await run({ data: { companyId: targetId, confirm: confirmText } }));
      setConfirm("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const onRun = () => executeCleanup(companyId, confirm);

  // One-click path skips the manual "type DELETE" gate but is still guarded
  // by an AlertDialog confirmation and always targets the default test
  // tenant #2 — never a company chosen from the address bar.
  const onQuickClean = () => executeCleanup(TEST_TENANT_DEFAULT_ID, "DELETE");

  const canRun = confirm === "DELETE" && companyId.length === 36 && !running;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cleanup Test Tenant"
        description="Permanently deletes a test tenant's data, invitations, profiles, and auth users. Use only after isolation verification is complete."
      />

      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Irreversible</AlertTitle>
        <AlertDescription>
          Every row for this company across bookings, payments, leads, HR, maintenance, projects,
          and units will be deleted, along with the company's profiles, roles, pending invitations,
          and auth accounts. The primary company and your own current company are always refused.
        </AlertDescription>
      </Alert>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-destructive" />
            One-click cleanup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Immediately deletes the isolation-test tenant{" "}
            <code className="font-mono">{TEST_TENANT_DEFAULT_ID}</code>: its company row, every
            tenant-scoped data row, the pending invitation, and the invited test user's profile,
            roles, and auth account.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={running}>
                {running ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting…
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete test tenant #2 now
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete test tenant #2?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes the second company (
                  <code className="font-mono">{TEST_TENANT_DEFAULT_ID}</code>), its pending
                  invitation, the invited test user, and every bookings / payments / HR /
                  maintenance / project row scoped to that tenant. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onQuickClean}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Yes, delete everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Advanced — pick a different tenant</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="cid">Company ID</Label>
            <Input
              id="cid"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value.trim())}
              className="font-mono"
              placeholder="00000000-0000-0000-0000-000000000002"
            />
            <p className="text-xs text-muted-foreground">
              Default is the isolation-test tenant #2.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="confirm">
              Type <code className="font-mono">DELETE</code> to confirm
            </Label>
            <Input
              id="confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="DELETE"
            />
          </div>

          <Button variant="destructive" onClick={onRun} disabled={!canRun}>
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting…
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" /> Delete test tenant
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Cleanup failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {report && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" />
              Deleted {report.companyName}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-1">
              <div>
                Company: <code className="font-mono">{report.companyId}</code>
              </div>
              <div>Auth users deleted: {report.usersDeleted}</div>
              <div>Invitations deleted: {report.invitationsDeleted}</div>
              <div>Ran at: {new Date(report.ranAt).toLocaleString()}</div>
            </div>

            {Object.keys(report.deletedCounts).length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-3 py-2">Table</th>
                      <th className="px-3 py-2 text-right">Rows deleted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(report.deletedCounts)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([tbl, n]) => (
                        <tr key={tbl} className="border-t">
                          <td className="px-3 py-2 font-mono text-xs">{tbl}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{n}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Badge variant="secondary">No tenant-scoped rows found</Badge>
            )}

            {report.authDeleteFailures.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>
                  {report.authDeleteFailures.length} auth account(s) could not be deleted
                </AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 space-y-1 text-xs">
                    {report.authDeleteFailures.map((f) => (
                      <li key={f.userId} className="font-mono">
                        {f.userId}: {f.error}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
