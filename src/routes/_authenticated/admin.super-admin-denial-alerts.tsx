import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Shield, ShieldAlert, ShieldCheck, RotateCw, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { AdminRequiredMessage } from "@/lib/adminGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import {
  listSuperAdminDenialAlerts,
  resolveSuperAdminDenialAlert,
  type SuperAdminDenialAlertRow,
} from "@/lib/adminSuperAdminDenialAlerts.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/super-admin-denial-alerts")({
  ssr: false,
  component: SuperAdminDenialAlertsPage,
  errorComponent: makeRouteErrorComponent("Super Admin Denial Alerts"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Super Admin Denial Alerts",
    backTo: "/admin",
  }),
  head: () => ({
    meta: [
      { title: "Super Admin Denial Alerts · Admin Controls" },
      {
        name: "description",
        content:
          "Server-side alerts for repeated Super Admin authorization denials clustering on the same actor or tenant.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function SuperAdminDenialAlertsPage() {
  const { isSuperAdmin, loading } = useAuth();
  const qc = useQueryClient();
  const fetchAlerts = useServerFn(listSuperAdminDenialAlerts);
  const resolveFn = useServerFn(resolveSuperAdminDenialAlert);

  const [status, setStatus] = useState<"unresolved" | "resolved" | "all">("unresolved");
  const [alertType, setAlertType] = useState<"all" | "actor" | "company">("all");
  const [windowDays, setWindowDays] = useState<number>(30);

  const queryKey = ["admin", "sa-denial-alerts", status, alertType, windowDays];

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      fetchAlerts({
        data: {
          status,
          windowDays,
          alertType: alertType === "all" ? undefined : alertType,
        },
      }),
    enabled: !loading && isSuperAdmin,
    retry: false,
  });

  const resolveMutation = useMutation({
    mutationFn: (input: { alert_id: string; notes?: string }) => resolveFn({ data: input }),
    onSuccess: () => {
      toast.success("Alert resolved");
      qc.invalidateQueries({ queryKey: ["admin", "sa-denial-alerts"] });
    },
    onError: (err: Error) => toast.error(err.message ?? "Failed to resolve"),
  });

  if (loading) return null;
  if (!isSuperAdmin) {
    return (
      <div className="space-y-4">
        <PageHeader title="Super Admin Denial Alerts" description="Restricted area" />
        <AdminRequiredMessage action="Viewing Super Admin denial alerts (super_admin role required)" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Super Admin Denial Alerts"
        description="Fires when repeated Super Admin authorization denials cluster on the same actor or tenant within a short time window. Thresholds: 5 denials / 10 min per actor, 10 denials / 10 min per tenant. Cooldown 30 min per subject."
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Status:</span>
          <Select value={status} onValueChange={(v: any) => setStatus(v)}>
            <SelectTrigger className="min-h-11 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unresolved">Unresolved</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Type:</span>
          <Select value={alertType} onValueChange={(v: any) => setAlertType(v)}>
            <SelectTrigger className="min-h-11 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="actor">Actor</SelectItem>
              <SelectItem value="company">Tenant</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Window:</span>
          {[1, 7, 30, 90].map((w) => (
            <Button
              key={w}
              variant={w === windowDays ? "default" : "outline"}
              size="sm"
              className="min-h-11"
              onClick={() => setWindowDays(w)}
            >
              {w === 1 ? "24h" : `${w}d`}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {data && (
            <Badge variant={data.unresolved_count > 0 ? "destructive" : "secondary"}>
              {data.unresolved_count} unresolved
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            className="min-h-11"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RotateCw className="h-4 w-4 mr-1" aria-hidden />
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {isError && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" aria-hidden />
          <AlertTitle>Couldn't load alerts</AlertTitle>
          <AlertDescription>
            {(error as Error | undefined)?.message ?? "Unknown error"}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" aria-hidden />
            Denial alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <table className="w-full text-sm">
              <tbody>
                <TableRowsSkeleton rows={6} columns={5} />
              </tbody>
            </table>
          ) : !data || data.rows.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              compact
              title="No alerts match"
              description="No repeated-denial alerts were fired for the selected filters."
            />
          ) : (
            <ul className="space-y-3">
              {data.rows.map((r) => (
                <AlertRow
                  key={r.id}
                  row={r}
                  onResolve={(notes) => resolveMutation.mutate({ alert_id: r.id, notes })}
                  resolving={
                    resolveMutation.isPending && resolveMutation.variables?.alert_id === r.id
                  }
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AlertRow({
  row,
  onResolve,
  resolving,
}: {
  row: SuperAdminDenialAlertRow;
  onResolve: (notes?: string) => void;
  resolving: boolean;
}) {
  const [notes, setNotes] = useState("");
  const [showResolve, setShowResolve] = useState(false);
  const isResolved = !!row.resolved_at;

  return (
    <li className="border rounded-md p-3">
      <div className="flex flex-wrap items-start gap-3 justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant={row.alert_type === "actor" ? "default" : "secondary"}>
              {row.alert_type === "actor" ? "Actor" : "Tenant"}
            </Badge>
            <Badge variant="destructive">
              {row.denial_count} denials in {row.window_minutes}m
            </Badge>
            <span className="text-xs text-muted-foreground">threshold {row.threshold}</span>
            {isResolved && (
              <Badge variant="outline" className="border-success text-success">
                Resolved
              </Badge>
            )}
          </div>
          <div className="text-sm">
            <span className="font-medium">{row.subject_display ?? "(unknown)"}</span>{" "}
            <span className="font-mono text-xs text-muted-foreground">{row.subject_id}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Window: {new Date(row.window_start).toLocaleString()} →{" "}
            {new Date(row.window_end).toLocaleString()} · fired{" "}
            {new Date(row.created_at).toLocaleString()}
          </div>
          {row.sample_rpc_names.length > 0 && (
            <div className="text-xs">
              <span className="text-muted-foreground">RPCs: </span>
              <span className="font-mono">{row.sample_rpc_names.join(", ")}</span>
            </div>
          )}
          {row.sample_correlation_ids.length > 0 && (
            <div className="text-xs">
              <span className="text-muted-foreground">Correlation IDs: </span>
              <span className="font-mono">
                {row.sample_correlation_ids.slice(0, 5).join(", ")}
                {row.sample_correlation_ids.length > 5 ? " …" : ""}
              </span>
            </div>
          )}
          {isResolved && (
            <div className="text-xs text-muted-foreground">
              Resolved by {row.resolved_by_email ?? row.resolved_by} on{" "}
              {row.resolved_at ? new Date(row.resolved_at).toLocaleString() : ""}
              {row.resolution_notes ? ` — ${row.resolution_notes}` : ""}
            </div>
          )}
        </div>
        {!isResolved && (
          <div className="flex flex-col items-end gap-2">
            {!showResolve ? (
              <Button size="sm" className="min-h-11" onClick={() => setShowResolve(true)}>
                <CheckCircle2 className="h-4 w-4 mr-1" aria-hidden />
                Resolve
              </Button>
            ) : (
              <div className="flex flex-col items-end gap-2 w-72">
                <Textarea
                  placeholder="Optional notes (root cause, action taken)…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => {
                      setShowResolve(false);
                      setNotes("");
                    }}
                    disabled={resolving}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="min-h-11"
                    disabled={resolving}
                    onClick={() => onResolve(notes.trim() || undefined)}
                  >
                    {resolving ? "Resolving…" : "Confirm"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
