import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ShieldAlert, Activity } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { AdminRequiredMessage } from "@/lib/adminGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TableRowsSkeleton } from "@/components/ui/skeletons";
import { EmptyState } from "@/components/EmptyState";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";
import { getRpcDenialMetricsForAdmin } from "@/lib/adminRpcDenialMetrics.functions";

export const Route = createFileRoute("/_authenticated/admin/rpc-denials")({
  ssr: false,
  component: RpcDenialsMetricsPage,
  errorComponent: makeRouteErrorComponent("RPC Denial Metrics"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "RPC Denial Metrics",
    backTo: "/admin",
  }),
  head: () => ({
    meta: [
      { title: "RPC Denial Metrics · Admin Controls" },
      {
        name: "description",
        content: "Aggregated counts of revoked-RPC denials by function name and error code.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const WINDOWS = [1, 7, 30, 90] as const;

function RpcDenialsMetricsPage() {
  const { isSuperAdmin, loading } = useAuth();
  const fetchMetrics = useServerFn(getRpcDenialMetricsForAdmin);
  const [windowDays, setWindowDays] = useState<number>(7);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "rpc-denials", windowDays],
    queryFn: () => fetchMetrics({ data: { windowDays } }),
    enabled: !loading && isSuperAdmin,
    retry: false,
  });

  if (loading) return null;
  if (!isSuperAdmin) {
    return (
      <div className="space-y-4">
        <PageHeader title="RPC Denial Metrics" description="Restricted area" />
        <AdminRequiredMessage action="Viewing revoked-RPC metrics (super_admin role required)" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="RPC Denial Metrics"
        description="Aggregated counts of blocked SECURITY DEFINER calls, grouped by function name and error code. Use this to spot which permissions are failing most and where."
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
              {data.total.toLocaleString()} denial{data.total === 1 ? "" : "s"} since{" "}
              {new Date(data.since).toLocaleString()}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="min-h-11"
          >
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {isError && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" aria-hidden />
          <AlertTitle>Couldn't load metrics</AlertTitle>
          <AlertDescription>
            {(error as Error | undefined)?.message ?? "Unknown error"}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" aria-hidden />
              Top RPCs
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {isLoading ? (
              <table className="w-full text-sm">
                <tbody>
                  <TableRowsSkeleton rows={4} columns={2} />
                </tbody>
              </table>
            ) : !data || data.by_rpc.length === 0 ? (
              <EmptyState
                icon={Activity}
                compact
                title="No denials in this window"
                description="No revoked-RPC calls were blocked in the selected time range."
              />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3">RPC name</th>
                    <th className="py-2 pr-3 text-right">Denials</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_rpc.map((r) => (
                    <tr key={r.rpc_name} className="border-t">
                      <td className="py-2 pr-3 font-mono text-xs">{r.rpc_name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" aria-hidden />
              By error code
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {isLoading ? (
              <table className="w-full text-sm">
                <tbody>
                  <TableRowsSkeleton rows={4} columns={2} />
                </tbody>
              </table>
            ) : !data || data.by_error_code.length === 0 ? (
              <EmptyState
                icon={Activity}
                compact
                title="No denials in this window"
                description="Nothing to aggregate."
              />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3">Error code</th>
                    <th className="py-2 pr-3 text-right">Denials</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_error_code.map((r) => (
                    <tr key={String(r.error_code ?? "∅")} className="border-t">
                      <td className="py-2 pr-3 font-mono text-xs">
                        {r.error_code ?? (
                          <span className="italic text-muted-foreground">(none)</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" aria-hidden />
            Breakdown by RPC × error code
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <table className="w-full text-sm">
              <tbody>
                <TableRowsSkeleton rows={6} columns={5} />
              </tbody>
            </table>
          ) : !data || data.by_rpc_and_code.length === 0 ? (
            <EmptyState
              icon={Activity}
              compact
              title="No denials in this window"
              description="Everything looks healthy — no permissions were blocked."
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">RPC name</th>
                  <th className="py-2 pr-3">Error code</th>
                  <th className="py-2 pr-3 text-right">Denials</th>
                  <th className="py-2 pr-3 text-right">Distinct users</th>
                  <th className="py-2 pr-3">Last occurred</th>
                </tr>
              </thead>
              <tbody>
                {data.by_rpc_and_code.map((row) => (
                  <tr key={`${row.rpc_name}::${row.error_code ?? "∅"}`} className="border-t">
                    <td className="py-2 pr-3 font-mono text-xs">{row.rpc_name}</td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {row.error_code ?? (
                        <span className="italic text-muted-foreground">(none)</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.count}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.distinct_users}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {new Date(row.last_occurred_at).toLocaleString()}
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
