import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { AdminRequiredMessage } from "@/lib/adminGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw } from "lucide-react";
import { listTenantScopeLogs, listTenantScopeCompanies } from "@/lib/tenantScopeLogs.functions";

export const Route = createFileRoute("/_authenticated/admin/tenant-scope-logs")({
  ssr: false,
  component: TenantScopeLogsPage,
});

const RANGES: { label: string; minutes: number }[] = [
  { label: "Last 15 min", minutes: 15 },
  { label: "Last 1 hour", minutes: 60 },
  { label: "Last 6 hours", minutes: 60 * 6 },
  { label: "Last 24 hours", minutes: 60 * 24 },
  { label: "Last 7 days", minutes: 60 * 24 * 7 },
];

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
function short(v: string | null) {
  return v ? v.slice(0, 8) : "-";
}

function TenantScopeLogsPage() {
  const { isAdmin, loading } = useAuth();
  const fetchLogs = useServerFn(listTenantScopeLogs);
  const fetchCompanies = useServerFn(listTenantScopeCompanies);

  const [companyId, setCompanyId] = useState<string>("all");
  const [rangeMin, setRangeMin] = useState<number>(60);
  const [statusFilter, setStatusFilter] = useState<"all" | "ok" | "err">("all");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");

  const { fromIso, toIso } = useMemo(() => {
    if (customFrom || customTo) {
      return {
        fromIso: customFrom ? new Date(customFrom).toISOString() : null,
        toIso: customTo ? new Date(customTo).toISOString() : null,
      };
    }
    return {
      fromIso: new Date(Date.now() - rangeMin * 60_000).toISOString(),
      toIso: null as string | null,
    };
  }, [rangeMin, customFrom, customTo]);

  const companiesQ = useQuery({
    queryKey: ["tenant-scope-companies"],
    queryFn: () => fetchCompanies(),
    enabled: isAdmin,
    staleTime: 5 * 60_000,
  });

  const logsQ = useQuery({
    queryKey: ["tenant-scope-logs", companyId, fromIso, toIso, statusFilter],
    queryFn: () =>
      fetchLogs({
        data: {
          companyId: companyId === "all" ? null : companyId,
          fromIso,
          toIso,
          status: statusFilter === "all" ? null : statusFilter,
          limit: 500,
        },
      }),
    enabled: isAdmin,
  });

  if (loading) return null;
  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="Tenant Scope Logs" description="Restricted area" />
        <AdminRequiredMessage action="Viewing tenant scope logs" />
      </div>
    );
  }

  const rows = logsQ.data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tenant Scope Logs"
        description="Per-request audit trail of user_id + current_company_id for every server call."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-5">
          <div className="space-y-1">
            <Label>Company</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All companies</SelectItem>
                {(companiesQ.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name ?? short(c.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Quick range</Label>
            <Select
              value={String(rangeMin)}
              onValueChange={(v) => {
                setRangeMin(Number(v));
                setCustomFrom("");
                setCustomTo("");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => (
                  <SelectItem key={r.minutes} value={String(r.minutes)}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as "all" | "ok" | "err")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="ok">ok</SelectItem>
                <SelectItem value="err">err</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>From (custom)</Label>
            <Input
              type="datetime-local"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>To (custom)</Label>
            <Input
              type="datetime-local"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button onClick={() => logsQ.refetch()} variant="outline" size="sm">
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
        <span className="text-sm text-muted-foreground">
          {logsQ.isFetching ? "Loading…" : `${rows.length} row${rows.length === 1 ? "" : "s"}`}
        </span>
        {logsQ.error ? (
          <span className="text-sm text-destructive">{(logsQ.error as Error).message}</span>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Function</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">ms</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">{fmt(r.occurred_at)}</td>
                  <td className="px-3 py-2 font-mono text-xs" title={r.company_id ?? ""}>
                    {short(r.company_id)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs" title={r.user_id ?? ""}>
                    {short(r.user_id)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs break-all">{r.fn_path ?? "-"}</td>
                  <td className="px-3 py-2">
                    <Badge variant={r.status === "ok" ? "secondary" : "destructive"}>
                      {r.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.duration_ms ?? "-"}</td>
                </tr>
              ))}
              {rows.length === 0 && !logsQ.isFetching ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    No log entries match the filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
