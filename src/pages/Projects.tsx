import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, Column } from "@/components/DataTable";
import { fmtDate } from "@/lib/format";
import { StatusBadge, statusTone } from "@/components/StatusBadge";
import { NewProjectDialog } from "@/components/NewProjectDialog";

export default function Projects() {
  const { data: rows = [], isPending } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => (await supabase.from("projects").select("*")).data ?? [],
  });
  const { data: units = [] } = useQuery({
    queryKey: ["units-for-projects"],
    queryFn: async () => (await supabase.from("units").select("project_code,status")).data ?? [],
  });
  const enriched = rows.map((p: any) => {
    const u = units.filter((x: any) => x.project_code === p.project_code);
    return { ...p, _total: u.length, _booked: u.filter((x: any) => x.status === "Booked").length };
  });

  const columns: Column<any>[] = [
    {
      key: "code",
      header: "Code",
      cell: (r) => <span className="font-mono text-primary">{r.project_code}</span>,
    },
    {
      key: "name",
      header: "Project",
      cell: (r) => <span className="font-medium">{r.project_name}</span>,
    },
    {
      key: "type",
      header: "Type",
      cell: (r) =>
        r.project_type ? (
          <StatusBadge
            label={r.project_type}
            tone={
              r.project_type === "Commercial"
                ? "info"
                : r.project_type === "Mixed-Use"
                  ? "warning"
                  : "success"
            }
          />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: "loc", header: "Location", cell: (r) => r.location },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge label={r.status} tone={statusTone(r.status)} />,
    },
    { key: "start", header: "Start", cell: (r) => fmtDate(r.start_date) },
    { key: "end", header: "Completion", cell: (r) => fmtDate(r.expected_completion_date) },
    {
      key: "units",
      header: "Occupancy / Sold",
      align: "right",
      cell: (r) => {
        const pct = r._total > 0 ? Math.round((r._booked / r._total) * 100) : 0;
        return (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <span className="tabular-nums font-medium text-xs">
                {r._booked} / {r._total}
              </span>
              <span className="text-[11px] font-semibold text-primary px-1.5 py-0.5 rounded bg-primary/10">
                {pct}%
              </span>
            </div>
            {r._total > 0 && (
              <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
        );
      },
    },
  ];
  return (
    <div>
      <PageHeader
        title="Projects"
        description={`${rows.length} projects`}
        actions={<NewProjectDialog />}
      />
      <DataTable
        rows={enriched}
        columns={columns}
        rowKey={(r) => r.project_code}
        searchKeys={["project_code", "project_name", "location", "project_type"]}
        loading={isPending}
        emptyTitle="No projects yet"
        emptyDescription="Create your first project to organize units, bookings, and construction costs."
        emptyAction={<NewProjectDialog />}
      />
    </div>
  );
}
