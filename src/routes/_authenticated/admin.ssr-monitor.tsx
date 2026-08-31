import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Activity, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { TableRowsSkeleton } from "@/components/ui/skeletons";
import { EmptyState } from "@/components/EmptyState";
import { callRpc } from "@/integrations/supabase/approvedRpc";

export const Route = createFileRoute("/_authenticated/admin/ssr-monitor")({
  ssr: false,
  component: SsrMonitorPage,
});

type Stats = {
  last_5m: number;
  last_1h: number;
  last_24h: number;
  per_minute_60: { bucket: string; count: number }[];
  recent: {
    id: string;
    occurred_at: string;
    kind: "catastrophic" | "thrown";
    method: string | null;
    path: string | null;
    error_id: string | null;
    message: string | null;
    user_agent: string | null;
  }[];
  config: {
    threshold_per_5min: number;
    cooldown_minutes: number;
    last_alerted_at: string | null;
  };
} | null;

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function Sparkline({ buckets }: { buckets: { bucket: string; count: number }[] }) {
  // Pad to 60 minutes ending now.
  const series = useMemo(() => {
    const map = new Map<string, number>();
    buckets.forEach((b) => map.set(new Date(b.bucket).toISOString().slice(0, 16), b.count));
    const now = new Date();
    now.setSeconds(0, 0);
    const arr: { t: string; c: number }[] = [];
    for (let i = 59; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 60_000);
      const k = d.toISOString().slice(0, 16);
      arr.push({ t: k, c: map.get(k) ?? 0 });
    }
    return arr;
  }, [buckets]);
  const max = Math.max(1, ...series.map((s) => s.c));
  return (
    <div className="flex items-end gap-[2px] h-16 w-full">
      {series.map((s, i) => (
        <div
          key={i}
          title={`${s.t}Z — ${s.c}`}
          className={s.c > 0 ? "bg-destructive/80" : "bg-muted"}
          style={{
            height: `${Math.max(2, (s.c / max) * 100)}%`,
            width: "calc((100% - 118px) / 60)",
          }}
        />
      ))}
    </div>
  );
}

function SsrMonitorPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [threshold, setThreshold] = useState<number | "">("");
  const [cooldown, setCooldown] = useState<number | "">("");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["ssr-error-stats"],
    queryFn: async () => {
      const { data, error } = await callRpc("get_ssr_error_stats");
      if (error) throw error;
      return data as unknown as Stats;
    },
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (data?.config) {
      setThreshold((t) => (t === "" ? data.config.threshold_per_5min : t));
      setCooldown((c) => (c === "" ? data.config.cooldown_minutes : c));
    }
  }, [data?.config]);

  const saveConfig = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("ssr_alert_config")
        .update({
          threshold_per_5min: Number(threshold),
          cooldown_minutes: Number(cooldown),
          updated_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Alert settings saved");
      qc.invalidateQueries({ queryKey: ["ssr-error-stats"] });
    },
    onError: (e) => toast.error("Failed to save", { description: String((e as Error).message) }),
  });

  if (!isAdmin) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Admin only</AlertTitle>
          <AlertDescription>This page is restricted to admin users.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const spike = !!data && data.last_5m >= data.config.threshold_per_5min;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5" /> SSR Fallback Monitor
          </h1>
          <p className="text-sm text-muted-foreground">
            Tracks every render of the "page didn't load" fallback so spikes are visible
            immediately.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {spike && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Spike detected</AlertTitle>
          <AlertDescription>
            {data!.last_5m} fallback renders in the last 5 minutes (threshold{" "}
            {data!.config.threshold_per_5min}). Inspect recent events below.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Last 5 min" value={data?.last_5m} highlight={spike} />
        <StatCard label="Last 1 hour" value={data?.last_1h} />
        <StatCard label="Last 24 hours" value={data?.last_24h} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Last 60 minutes</CardTitle>
        </CardHeader>
        <CardContent>{data && <Sparkline buckets={data.per_minute_60} />}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alert settings</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div>
            <Label htmlFor="thr">Threshold (per 5 min)</Label>
            <Input
              id="thr"
              type="number"
              min={1}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor="cd">Cooldown (minutes)</Label>
            <Input
              id="cd"
              type="number"
              min={1}
              value={cooldown}
              onChange={(e) => setCooldown(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </div>
          <div>
            <Button onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending}>
              Save settings
            </Button>
            {data?.config.last_alerted_at && (
              <p className="text-xs text-muted-foreground mt-2">
                Last alert: {fmtTime(data.config.last_alerted_at)}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent events (50)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Kind</th>
                  <th className="py-2 pr-3">Method</th>
                  <th className="py-2 pr-3">Path</th>
                  <th className="py-2 pr-3">Ref</th>
                  <th className="py-2 pr-3">Message</th>
                </tr>
              </thead>
              <tbody>
                <TableRowsSkeleton rows={5} columns={6} />
              </tbody>
            </table>
          ) : !data?.recent.length ? (
            <EmptyState
              icon={Activity}
              compact
              title="All quiet"
              description="No fallback renders recorded yet — SSR has been healthy."
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Kind</th>
                  <th className="py-2 pr-3">Method</th>
                  <th className="py-2 pr-3">Path</th>
                  <th className="py-2 pr-3">Ref</th>
                  <th className="py-2 pr-3">Message</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtTime(r.occurred_at)}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={r.kind === "catastrophic" ? "destructive" : "secondary"}>
                        {r.kind}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">{r.method ?? "—"}</td>
                    <td
                      className="py-2 pr-3 font-mono text-xs max-w-[28ch] truncate"
                      title={r.path ?? ""}
                    >
                      {r.path ?? "—"}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{r.error_id ?? "—"}</td>
                    <td className="py-2 pr-3 max-w-[40ch] truncate" title={r.message ?? ""}>
                      {r.message ?? "—"}
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

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | undefined;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-destructive" : undefined}>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`text-3xl font-semibold mt-1 ${highlight ? "text-destructive" : ""}`}>
          {value ?? "—"}
        </div>
      </CardContent>
    </Card>
  );
}
