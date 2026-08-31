import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { AdminRequiredMessage } from "@/lib/adminGate";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, RefreshCw } from "lucide-react";
import {
  getProjectPartitionHealth,
  type HealthCell,
  type PartitionHealthGroup,
} from "@/lib/projectPartitionHealth.functions";

import { escapeCsvCell } from "@/lib/csv";

function toCsvCell(v: HealthCell): string {
  // Shared escaper — RFC 4180 quoting + formula-injection neutralization.
  return escapeCsvCell(v);
}

function downloadCsv(group: PartitionHealthGroup) {
  const header = group.columns.map((c) => toCsvCell(c.label)).join(",");
  const body = group.rows
    .map((r) => group.columns.map((c) => toCsvCell(r[c.key] ?? null)).join(","))
    .join("\n");
  const csv = `${header}\n${body}\n`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `partition-health-${group.key}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function GroupCard({ group }: { group: PartitionHealthGroup }) {
  const count = group.rows.length;
  const tone = count === 0 ? "secondary" : "destructive";
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            {group.title}
            <Badge variant={tone as "secondary" | "destructive"}>
              {count} {count === 1 ? "row" : "rows"}
            </Badge>
          </CardTitle>
          <CardDescription>{group.description}</CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={count === 0}
          onClick={() => downloadCsv(group)}
        >
          <Download className="mr-2 h-4 w-4" />
          CSV
        </Button>
      </CardHeader>
      <CardContent>
        {count === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to fix here.</p>
        ) : (
          <div className="max-h-96 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {group.columns.map((c) => (
                    <TableHead key={c.key}>{c.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.rows.map((r, i) => (
                  <TableRow key={i}>
                    {group.columns.map((c) => (
                      <TableCell key={c.key} className="whitespace-nowrap">
                        {r[c.key] === null || r[c.key] === undefined ? "—" : String(r[c.key])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PartitionHealthPage() {
  const fetchReport = useServerFn(getProjectPartitionHealth);
  const query = useQuery({
    queryKey: ["project-partition-health"],
    queryFn: () => fetchReport(),
    staleTime: 60_000,
  });

  const totalIssues = useMemo(
    () => (query.data?.groups ?? []).reduce((sum, g) => sum + g.rows.length, 0),
    [query.data],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Project Partition · Data Health"
        description="Phase 0 (read-only). Everything below must be resolved before the schema hard-partitions clients, units, bookings, ledgers, and payments per project."
      />

      <div className="flex items-center justify-between gap-4">
        <div className="text-sm text-muted-foreground">
          {query.isLoading
            ? "Scanning database…"
            : query.error
              ? `Error: ${(query.error as Error).message}`
              : `${totalIssues} row${totalIssues === 1 ? "" : "s"} need attention across ${query.data?.groups.length ?? 0} groups. Report generated ${
                  query.data ? new Date(query.data.generated_at).toLocaleString() : ""
                }.`}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
          Rescan
        </Button>
      </div>

      <div className="grid gap-4">
        {(query.data?.groups ?? []).map((g) => (
          <GroupCard key={g.key} group={g} />
        ))}
      </div>
    </div>
  );
}

function Guarded() {
  const { isAdmin, loading } = useAuth();
  if (loading) return null;
  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="Project Partition · Data Health" description="Restricted area" />
        <AdminRequiredMessage action="Viewing the Project Partition health report" />
      </div>
    );
  }
  return <PartitionHealthPage />;
}

export const Route = createFileRoute("/_authenticated/projects/health")({
  component: Guarded,
  errorComponent: makeRouteErrorComponent("Project Partition Health"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "Project Partition Health",
    backTo: "/",
  }),
});
