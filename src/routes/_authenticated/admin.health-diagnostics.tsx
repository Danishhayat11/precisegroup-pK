import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { runHealthCheck } from "@/lib/healthCheck.functions";
import {
  Activity,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  Database,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/health-diagnostics")({
  component: HealthDiagnosticsPage,
});

function HealthDiagnosticsPage() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const router = useRouter();
  const healthFn = useServerFn(runHealthCheck);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["health-diagnostics", isRefreshing],
    queryFn: () => healthFn({ data: { refresh: isRefreshing } }),
    refetchInterval: 30000, // Refresh every 30s
    retry: (failureCount, error: any) => {
      if (error?.message === "Unauthorized") return false;
      return failureCount < 3;
    },
  });

  useEffect(() => {
    if (error && (error as any).message === "Unauthorized") {
      void router.navigate({
        to: "/login" as any,
        search: { next: window.location.pathname } as any,
      });
    }
  }, [error, router]);

  const handleManualRefresh = async (fullRefresh: boolean) => {
    setIsRefreshing(fullRefresh);
    await refetch();
    setIsRefreshing(false);
  };

  return (
    <div className="flex-1 space-y-8 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">System Health & Diagnostics</h2>
          <p className="text-muted-foreground">
            Real-time status of PostgREST schema cache and core database connectivity.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" onClick={() => handleManualRefresh(false)} disabled={isLoading}>
            <Search className="mr-2 h-4 w-4" />
            Check Status
          </Button>
          <Button
            variant="default"
            onClick={() => handleManualRefresh(true)}
            disabled={isLoading}
            className="bg-brand-gold text-brand-gold-foreground hover:bg-brand-gold/90"
          >
            <RefreshCw
              className={cn("mr-2 h-4 w-4", isLoading && isRefreshing && "animate-spin")}
            />
            Force Schema Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <HealthCard
          title="Overall Status"
          value={data?.status === "ok" ? "Healthy" : data ? "Unhealthy" : "Checking..."}
          icon={Activity}
          status={data?.status}
          description={data?.message || "Validating system endpoints"}
        />
        <HealthCard
          title="Last Checked"
          value={data?.timestamp ? new Date(data.timestamp).toLocaleTimeString() : "--:--"}
          icon={Clock}
          description="Updated every 30 seconds"
        />
        <HealthCard
          title="Schema Cache"
          value={data?.refreshed ? "Just Refreshed" : "Live"}
          icon={Database}
          description={
            data?.metrics?.refresh_duration_ms
              ? `Refresh took ${data.metrics.refresh_duration_ms}ms`
              : "Schema is synchronized"
          }
        />
        <HealthCard
          title="Table Read"
          value={
            data?.metrics?.row_count !== undefined ? `${data.metrics.row_count} controls` : "--"
          }
          icon={Search}
          description={
            data?.metrics?.read_duration_ms
              ? `Read latency: ${data.metrics.read_duration_ms}ms`
              : "Validating table accessibility"
          }
        />
      </div>

      {data?.status === "error" && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6">
          <div className="flex items-start space-x-4">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <div className="space-y-1">
              <h3 className="font-semibold text-destructive">Diagnostic Failure: {data.phase}</h3>
              <p className="text-sm text-destructive/90">{data.message}</p>
              {data.error && (
                <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs font-mono text-destructive">
                  {data.error}
                </pre>
              )}
              {data.hint && (
                <p className="mt-2 text-xs italic text-muted-foreground">Hint: {data.hint}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {data?.status === "ok" && (
        <div className="rounded-lg border border-success/50 bg-success/10 p-6">
          <div className="flex items-start space-x-4">
            <CheckCircle2 className="h-6 w-6 text-success" />
            <div className="space-y-1">
              <h3 className="font-semibold text-success">All Systems Operational</h3>
              <p className="text-sm text-success/90">
                The database is reachable, and the PostgREST schema cache is current.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-4 text-xs text-muted-foreground">
                <div>
                  <span className="font-medium">Total Latency:</span>{" "}
                  {data.metrics?.total_duration_ms}ms
                </div>
                <div>
                  <span className="font-medium">Exact Row Count:</span> {data.metrics?.exact_count}
                </div>
                <div>
                  <span className="font-medium">Trace ID:</span>{" "}
                  <code className="bg-muted px-1">{(data as any).traceId}</code>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="flex flex-col space-y-1.5 p-6 pb-2">
          <h3 className="text-lg font-semibold leading-none tracking-tight">Recent Logs</h3>
          <p className="text-sm text-muted-foreground">
            Detailed telemetry for the latest health check run.
          </p>
        </div>
        <div className="p-6 pt-0">
          <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs font-mono">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

function HealthCard({
  title,
  value,
  icon: Icon,
  status,
  description,
}: {
  title: string;
  value: string;
  icon: any;
  status?: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
        <h3 className="text-sm font-medium tracking-tight">{title}</h3>
        <Icon
          className={cn(
            "h-4 w-4",
            status === "ok"
              ? "text-success"
              : status === "error"
                ? "text-destructive"
                : "text-muted-foreground",
          )}
        />
      </div>
      <div className="p-6 pt-0">
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
    </div>
  );
}
