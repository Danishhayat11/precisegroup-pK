import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ShieldAlert, ShieldCheck, RotateCw } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { AdminRequiredMessage } from "@/lib/adminGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TableRowsSkeleton } from "@/components/ui/skeletons";
import { EmptyState } from "@/components/EmptyState";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";
import { getSuperAdminAuthAuditLog } from "@/lib/adminSuperAdminAuthAudit.functions";

export const Route = createFileRoute("/_authenticated/admin/super-admin-auth-audit")({
  ssr: false,
  component: SuperAdminAuthAuditPage,
  errorComponent: makeRouteErrorComponent("Super Admin Auth Audit"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Super Admin Auth Audit",
    backTo: "/admin",
  }),
  head: () => ({
    meta: [
      { title: "Super Admin Auth Audit · Admin Controls" },
      {
        name: "description",
        content:
          "Recent Super Admin authorization denials with filters by function, tenant, and actor.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const WINDOWS = [1, 7, 30, 90] as const;
const ALL_FNS = "__all__";

function SuperAdminAuthAuditPage() {
  const { isSuperAdmin, loading } = useAuth();
  const fetchLog = useServerFn(getSuperAdminAuthAuditLog);

  const [windowDays, setWindowDays] = useState<number>(7);
  const [fnName, setFnName] = useState<string>(ALL_FNS);
  const [companyId, setCompanyId] = useState<string>("");
  const [actorId, setActorId] = useState<string>("");
  const [actorEmail, setActorEmail] = useState<string>("");
  const [applied, setApplied] = useState({
    fnName: ALL_FNS,
    companyId: "",
    actorId: "",
    actorEmail: "",
  });

  const uuidLike = (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());
  const companyIdValid = applied.companyId === "" || uuidLike(applied.companyId);
  const actorIdValid = applied.actorId === "" || uuidLike(applied.actorId);
  const filtersValid = companyIdValid && actorIdValid;

  const requestArgs = useMemo(
    () => ({
      windowDays,
      fnName: applied.fnName !== ALL_FNS ? applied.fnName : undefined,
      companyId:
        applied.companyId && uuidLike(applied.companyId) ? applied.companyId.trim() : undefined,
      actorId: applied.actorId && uuidLike(applied.actorId) ? applied.actorId.trim() : undefined,
      actorEmail: applied.actorEmail.trim() || undefined,
    }),
    [windowDays, applied],
  );

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "sa-auth-audit", requestArgs],
    queryFn: () => fetchLog({ data: requestArgs }),
    enabled: !loading && isSuperAdmin && filtersValid,
    retry: false,
  });

  if (loading) return null;
  if (!isSuperAdmin) {
    return (
      <div className="space-y-4">
        <PageHeader title="Super Admin Auth Audit" description="Restricted area" />
        <AdminRequiredMessage action="Viewing Super Admin authorization audit (super_admin role required)" />
      </div>
    );
  }

  const applyFilters = () =>
    setApplied({
      fnName,
      companyId: companyId.trim(),
      actorId: actorId.trim(),
      actorEmail: actorEmail.trim(),
    });
  const resetFilters = () => {
    setFnName(ALL_FNS);
    setCompanyId("");
    setActorId("");
    setActorEmail("");
    setApplied({ fnName: ALL_FNS, companyId: "", actorId: "", actorEmail: "" });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Super Admin Auth Audit"
        description="Recent Super Admin authorization denials tagged super_admin.<fnName>. Filter by function, tenant (company_id), and actor (user id or email) to trace 401/403 root cause."
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground mr-2">Window:</span>
        {WINDOWS.map((w) => (
          <Button
            key={w}
            variant={w === windowDays ? "default" : "outline"}
            size="sm"
            onClick={() => setWindowDays(w)}
            className="min-h-11"
          >
            {w === 1 ? "24h" : `${w}d`}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-3">
          {data && (
            <span className="text-sm text-muted-foreground">
              {data.total.toLocaleString()} match{data.total === 1 ? "" : "es"}
              {data.truncated ? " (truncated)" : ""} since {new Date(data.since).toLocaleString()}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="min-h-11"
          >
            <RotateCw className="h-4 w-4 mr-1" aria-hidden />
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label htmlFor="sa-fn">Function</Label>
              <Select value={fnName} onValueChange={setFnName}>
                <SelectTrigger id="sa-fn" className="min-h-11">
                  <SelectValue placeholder="All functions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FNS}>All functions</SelectItem>
                  {(data?.distinct_fn_names ?? []).map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sa-tenant">Tenant (company_id)</Label>
              <Input
                id="sa-tenant"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                placeholder="uuid"
                className="min-h-11 font-mono text-xs"
                aria-invalid={!!companyId && !uuidLike(companyId)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sa-actor-id">Actor (user_id)</Label>
              <Input
                id="sa-actor-id"
                value={actorId}
                onChange={(e) => setActorId(e.target.value)}
                placeholder="uuid"
                className="min-h-11 font-mono text-xs"
                aria-invalid={!!actorId && !uuidLike(actorId)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sa-actor-email">Actor email (contains)</Label>
              <Input
                id="sa-actor-email"
                type="search"
                value={actorEmail}
                onChange={(e) => setActorEmail(e.target.value)}
                placeholder="name@example.com"
                className="min-h-11"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-4">
            <Button
              size="sm"
              onClick={applyFilters}
              className="min-h-11"
              disabled={(!!companyId && !uuidLike(companyId)) || (!!actorId && !uuidLike(actorId))}
            >
              Apply filters
            </Button>
            <Button size="sm" variant="outline" onClick={resetFilters} className="min-h-11">
              Reset
            </Button>
            {(!companyIdValid || !actorIdValid) && (
              <span className="text-xs text-destructive">
                Enter a valid UUID or clear the field.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {isError && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" aria-hidden />
          <AlertTitle>Couldn't load audit feed</AlertTitle>
          <AlertDescription>
            {(error as Error | undefined)?.message ?? "Unknown error"}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Denial events</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <table className="w-full text-sm">
              <tbody>
                <TableRowsSkeleton rows={8} columns={6} />
              </tbody>
            </table>
          ) : !data || data.rows.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              compact
              title="No denials match"
              description="No Super Admin authorization failures were logged for the selected window and filters."
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Function</th>
                  <th className="py-2 pr-3">Actor</th>
                  <th className="py-2 pr-3">Tenant</th>
                  <th className="py-2 pr-3">Error code</th>
                  <th className="py-2 pr-3">Message</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">
                      {new Date(r.occurred_at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      <div>{r.fn_name}</div>
                      <div className="text-muted-foreground">{r.rpc_name}</div>
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      <div>
                        {r.actor_email ?? (
                          <span className="italic text-muted-foreground">(no profile email)</span>
                        )}
                      </div>
                      <div className="font-mono text-muted-foreground">{r.user_id}</div>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {r.company_id ?? <span className="italic text-muted-foreground">(none)</span>}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {r.error_code ?? <span className="italic text-muted-foreground">(none)</span>}
                    </td>
                    <td className="py-2 pr-3 text-xs max-w-md">
                      <div className="break-words">
                        {r.error_message ?? (
                          <span className="italic text-muted-foreground">(none)</span>
                        )}
                      </div>
                      {r.page_path && (
                        <div className="text-muted-foreground">path: {r.page_path}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
