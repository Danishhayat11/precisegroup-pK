import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { AdminRequiredMessage } from "@/lib/adminGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw,
  PlayCircle,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  FlaskConical,
  Trash2,
} from "lucide-react";
import {
  getTenantAuditIdentity,
  runTenantRlsProbes,
  runTenantIsolationTest,
  cleanupIsolationTestTenant,
  sweepIsolationArtifacts,
  type RlsProbeResult,
  type TenantAuditReport,
  type IsolationTestResult,
  type CleanupTestTenantResult,
} from "@/lib/tenantAudit.functions";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/admin/tenant-audit")({
  ssr: false,
  component: TenantAuditPage,
  errorComponent: makeRouteErrorComponent("Tenant Audit"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Tenant Audit",
    backTo: "/admin",
  }),
});

function KV({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-sm break-all" : "text-sm"}>{value ?? "—"}</span>
    </div>
  );
}

function probeVerdict(p: RlsProbeResult): {
  label: string;
  variant: "secondary" | "destructive" | "outline";
  Icon: typeof ShieldCheck;
} {
  if (p.cross_read_count && p.cross_read_count > 0) {
    return { label: "Cross-tenant leak", variant: "destructive", Icon: ShieldAlert };
  }
  if (p.insert_status === "leaked") {
    return { label: "Insert leak", variant: "destructive", Icon: ShieldAlert };
  }
  if (p.mine_error) {
    return { label: "Read error", variant: "destructive", Icon: ShieldAlert };
  }
  if (p.insert_status === "blocked_by_rls" && (p.cross_read_count ?? 0) === 0) {
    return { label: "RLS enforced", variant: "secondary", Icon: ShieldCheck };
  }
  return { label: "Inconclusive", variant: "outline", Icon: ShieldQuestion };
}

function TenantAuditPage() {
  const { isAdmin, loading } = useAuth();
  const fetchIdentity = useServerFn(getTenantAuditIdentity);
  const runProbes = useServerFn(runTenantRlsProbes);
  const runIsolation = useServerFn(runTenantIsolationTest);
  const runCleanup = useServerFn(cleanupIsolationTestTenant);
  const sweep = useServerFn(sweepIsolationArtifacts);
  const [report, setReport] = useState<TenantAuditReport | null>(null);
  const [isolation, setIsolation] = useState<IsolationTestResult | null>(null);
  const [cleanup, setCleanup] = useState<CleanupTestTenantResult | null>(null);

  const identityQ = useQuery({
    queryKey: ["tenant-audit-identity"],
    queryFn: () => fetchIdentity(),
    enabled: isAdmin,
    staleTime: 30_000,
  });

  // Best-effort artifact sweep: on mount (catch orphans from previous crashed
  // runs), on unmount / tab close, and after every isolation-test attempt.
  const fireSweep = () => {
    if (!isAdmin) return;
    void sweep({ data: undefined }).catch(() => {});
  };
  useEffect(() => {
    if (!isAdmin) return;
    fireSweep();
    const onPageHide = () => fireSweep();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      fireSweep();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const probeM = useMutation({
    mutationFn: () => runProbes({ data: undefined }),
    onSuccess: (r) => setReport(r),
  });

  const isolationM = useMutation({
    mutationFn: async () => {
      try {
        return await runIsolation({ data: undefined });
      } finally {
        fireSweep();
      }
    },
    onSuccess: (r) => setIsolation(r),
  });

  const cleanupM = useMutation({
    mutationFn: () => runCleanup({ data: undefined }),
    onSuccess: (r) => setCleanup(r),
  });

  if (loading) return null;
  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="Tenant Audit" description="Restricted area" />
        <AdminRequiredMessage action="Viewing the tenant audit screen" />
      </div>
    );
  }

  const identity = report?.identity ?? identityQ.data ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tenant Audit"
        description="Verify who you are to the backend and prove RLS is scoping reads and writes to your company."
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Current identity</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => identityQ.refetch()}
            disabled={identityQ.isFetching}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${identityQ.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {identityQ.error ? (
            <div className="col-span-full text-sm text-destructive">
              {(identityQ.error as Error).message}
            </div>
          ) : null}
          <KV label="User ID" value={identity?.user_id} mono />
          <KV label="Email" value={identity?.email} />
          <KV label="Full name" value={identity?.full_name} />
          <KV label="Company ID" value={identity?.company_id} mono />
          <KV label="Company name" value={identity?.company_name} />
          <KV label="JWT claims.company_id" value={identity?.claims_company_id} mono />
          <div className="col-span-full">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Roles</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(identity?.roles ?? []).length === 0 ? (
                <span className="text-sm text-muted-foreground">No roles assigned</span>
              ) : (
                identity!.roles.map((r) => (
                  <Badge key={r} variant="secondary">
                    {r}
                  </Badge>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">RLS verification probes</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              For each tenant table: counts the rows you can see, attempts a cross-tenant read
              (expected 0), and attempts an insert with a foreign company_id (expected: blocked by
              RLS). Any successful cross-tenant read or insert is a policy failure.
            </p>
          </div>
          <Button onClick={() => probeM.mutate()} disabled={probeM.isPending} size="sm">
            <PlayCircle className={`mr-2 h-4 w-4 ${probeM.isPending ? "animate-pulse" : ""}`} />
            {probeM.isPending ? "Running…" : "Run probes"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {probeM.error ? (
            <div className="text-sm text-destructive">{(probeM.error as Error).message}</div>
          ) : null}

          {report ? (
            <div className="text-xs text-muted-foreground">
              Ran at {new Date(report.ran_at).toLocaleString()} · Foreign probe company:{" "}
              <span className="font-mono">{report.foreign_company_id}</span>
              {report.foreign_company_name ? ` (${report.foreign_company_name})` : ""}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              No probe results yet. Click <b>Run probes</b> to verify RLS.
            </div>
          )}

          {report ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2">Table</th>
                    <th className="px-3 py-2 text-right">Rows I see</th>
                    <th className="px-3 py-2 text-right">Cross-tenant read</th>
                    <th className="px-3 py-2">Cross-tenant insert</th>
                    <th className="px-3 py-2">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {report.probes.map((p) => {
                    const v = probeVerdict(p);
                    return (
                      <tr key={p.table} className="border-t align-top">
                        <td className="px-3 py-2 font-mono text-xs">{p.table}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {p.mine_error ? (
                            <span className="text-destructive text-xs">{p.mine_error}</span>
                          ) : (
                            (p.mine_count ?? "—")
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {p.cross_read_error ? (
                            <span className="text-destructive text-xs">{p.cross_read_error}</span>
                          ) : (
                            (p.cross_read_count ?? "—")
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <div className="font-medium capitalize">
                            {p.insert_status.replace(/_/g, " ")}
                          </div>
                          {p.insert_detail ? (
                            <div className="text-muted-foreground break-all">{p.insert_detail}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={v.variant} className="gap-1">
                            <v.Icon className="h-3 w-3" />
                            {v.label}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Automated isolation test</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Creates a uniquely-named marker lead inside a scratch <b>tenant #1</b> (via the admin
              key) and then queries the API as <b>you</b> (tenant #2, RLS enforced). The marker must
              be invisible by name and by id. The marker is deleted after the check.
            </p>
          </div>
          <Button onClick={() => isolationM.mutate()} disabled={isolationM.isPending} size="sm">
            <FlaskConical
              className={`mr-2 h-4 w-4 ${isolationM.isPending ? "animate-pulse" : ""}`}
            />
            {isolationM.isPending ? "Running…" : "Run isolation test"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {isolationM.error ? (
            <div className="text-sm text-destructive">{(isolationM.error as Error).message}</div>
          ) : null}

          {!isolation ? (
            <div className="text-sm text-muted-foreground">No isolation test has been run yet.</div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {isolation.passed ? (
                  <Badge variant="secondary" className="gap-1">
                    <ShieldCheck className="h-3 w-3" /> Passed — tenant #2 cannot see tenant #1's
                    row
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <ShieldAlert className="h-3 w-3" /> FAILED — marker was visible across tenants
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  Ran at {new Date(isolation.ran_at).toLocaleString()}
                </span>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded border p-3 space-y-1">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Tenant #1 (marker written here)
                  </div>
                  <div className="font-mono text-xs break-all">{isolation.tenant1_company_id}</div>
                  <div className="text-sm">{isolation.tenant1_company_name}</div>
                </div>
                <div className="rounded border p-3 space-y-1">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Tenant #2 (you / API caller)
                  </div>
                  <div className="font-mono text-xs break-all">{isolation.tenant2_company_id}</div>
                  <div className="text-sm">{isolation.tenant2_company_name ?? "—"}</div>
                </div>
              </div>

              <div className="rounded border p-3 text-sm space-y-1">
                <div>
                  Marker name: <span className="font-mono text-xs">{isolation.marker_name}</span>
                </div>
                <div>
                  Marker id: <span className="font-mono text-xs">{isolation.marker_id}</span>
                </div>
                <div>
                  Visible to tenant #2 by name:{" "}
                  <span
                    className={
                      isolation.visible_by_name_count === 0
                        ? "text-success"
                        : "text-destructive font-medium"
                    }
                  >
                    {isolation.visible_by_name_count} row(s) — expected 0
                  </span>
                </div>
                <div>
                  Visible to tenant #2 by id:{" "}
                  <span
                    className={
                      !isolation.visible_by_id ? "text-success" : "text-destructive font-medium"
                    }
                  >
                    {isolation.visible_by_id ? "YES" : "no"} — expected no
                  </span>
                </div>
                <div>
                  Cleanup:{" "}
                  {isolation.cleaned_up ? (
                    <span className="text-success">marker deleted</span>
                  ) : (
                    <span className="text-destructive">
                      failed — {isolation.cleanup_error ?? "unknown error"} (marker id above may
                      need manual removal)
                    </span>
                  )}
                </div>
              </div>

              {isolation.notes.length > 0 ? (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Details</summary>
                  <ul className="mt-1 list-disc pl-5">
                    {isolation.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Delete isolation test tenant</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Removes the scratch tenant (
              <code className="font-mono">__rls_isolation_scratch__</code>) created by the isolation
              probes, along with every tenant-scoped row, its profiles, invitations, and the
              associated auth users. Refuses to touch the primary/seed tenant or your own current
              company.
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (
                confirm(
                  "Delete the scratch test tenant, its users, and all invitation artifacts? This cannot be undone.",
                )
              ) {
                cleanupM.mutate();
              }
            }}
            disabled={cleanupM.isPending}
          >
            <Trash2 className={`mr-2 h-4 w-4 ${cleanupM.isPending ? "animate-pulse" : ""}`} />
            {cleanupM.isPending ? "Deleting…" : "Delete test tenant"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {cleanupM.error ? (
            <div className="text-sm text-destructive">{(cleanupM.error as Error).message}</div>
          ) : null}

          {!cleanup ? (
            <div className="text-sm text-muted-foreground">No cleanup has been run yet.</div>
          ) : !cleanup.found ? (
            <div className="text-sm text-muted-foreground">
              {cleanup.notes[0] ?? "Nothing to clean up."}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="gap-1">
                  <ShieldCheck className="h-3 w-3" /> Deleted
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Ran at {new Date(cleanup.ran_at).toLocaleString()}
                </span>
              </div>

              <div className="rounded border p-3 text-sm space-y-1">
                <div>
                  Tenant: <span className="font-mono text-xs">{cleanup.company_id}</span>
                  {cleanup.company_name ? ` (${cleanup.company_name})` : ""}
                </div>
                <div>
                  Profiles removed: <span className="tabular-nums">{cleanup.user_ids.length}</span>
                </div>
                <div>
                  Auth users deleted:{" "}
                  <span
                    className={
                      cleanup.auth_user_errors.length === 0
                        ? "text-success"
                        : "text-destructive font-medium"
                    }
                  >
                    {cleanup.auth_users_deleted}
                    {cleanup.auth_user_errors.length > 0
                      ? ` (${cleanup.auth_user_errors.length} error(s))`
                      : ""}
                  </span>
                </div>
                <div>
                  Invitations removed:{" "}
                  <span className="tabular-nums">{cleanup.invitation_ids.length}</span>
                </div>
              </div>

              {Object.keys(cleanup.deleted_counts).length > 0 ? (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Deleted row counts by table</summary>
                  <ul className="mt-1 grid gap-0.5 pl-5 md:grid-cols-2">
                    {Object.entries(cleanup.deleted_counts)
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([t, n]) => (
                        <li key={t} className="font-mono">
                          {t}: {n}
                        </li>
                      ))}
                  </ul>
                </details>
              ) : null}

              {cleanup.auth_user_errors.length > 0 ? (
                <details className="text-xs text-destructive" open>
                  <summary className="cursor-pointer">Auth user errors</summary>
                  <ul className="mt-1 list-disc pl-5">
                    {cleanup.auth_user_errors.map((e) => (
                      <li key={e.user_id}>
                        <span className="font-mono">{e.user_id}</span> — {e.error}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
