import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtDate } from "@/lib/format";
import { Plus } from "lucide-react";
import { useActiveProject } from "@/lib/activeProject";
import { usePIIGuardedQuery, AccessDenied } from "@/lib/access";

type InspectionRow = {
  id: string;
  project_code: string | null;
  unit_id: string | null;
  inspection_date: string | null;
  inspector_name: string | null;
  status: string;
  notes: string | null;
};

function statusToneFor(status: string): any {
  const s = String(status ?? "").toUpperCase();
  if (s === "PASSED" || s === "COMPLETED") return "success";
  if (s === "FAILED") return "destructive";
  if (s === "SCHEDULED" || s === "PENDING") return "warning";
  return "default";
}

export default function Inspections() {
  const { activeCode, activeProject } = useActiveProject();

  const [createOpen, setCreateOpen] = useState(false);

  const { data: rows = [], accessDenied } = usePIIGuardedQuery<InspectionRow[]>({
    queryKey: ["inspections", activeCode ?? "all"],
    queryFn: async () => {
      let query = supabase
        .from("inspections" as any)
        .select("id, project_code, unit_id, inspection_date, inspector_name, status, notes")
        .order("inspection_date", { ascending: false, nullsFirst: false }) as any;

      if (activeCode) {
        query = query.eq("project_code", activeCode);
      }

      const { data } = await query;
      return (data ?? []) as InspectionRow[];
    },
  });

  const summary = useMemo(() => {
    let passed = 0;
    let failed = 0;
    let scheduled = 0;
    for (const r of rows) {
      const s = String(r.status ?? "").toUpperCase();
      if (s === "PASSED" || s === "COMPLETED") passed++;
      else if (s === "FAILED") failed++;
      else if (s === "SCHEDULED" || s === "PENDING") scheduled++;
    }
    return { passed, failed, scheduled, total: rows.length };
  }, [rows]);

  const columns: Column<InspectionRow>[] = [
    {
      key: "id",
      header: "ID",
      cell: (r) => (
        <span className="font-mono text-xs text-primary truncate max-w-[80px] block">{r.id}</span>
      ),
    },
    {
      key: "unit",
      header: "Unit",
      cell: (r) => <span className="font-mono text-xs">{r.unit_id ?? "—"}</span>,
    },
    {
      key: "date",
      header: "Date",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">{fmtDate(r.inspection_date)}</span>
      ),
    },
    {
      key: "inspector",
      header: "Inspector",
      cell: (r) => <span className="capitalize">{r.inspector_name ?? "—"}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge label={String(r.status)} tone={statusToneFor(r.status)} />,
    },
    {
      key: "notes",
      header: "Notes",
      cell: (r) => (
        <span className="text-xs text-muted-foreground truncate max-w-[200px] block">
          {r.notes ?? "—"}
        </span>
      ),
    },
  ];

  const scope = activeProject
    ? `${activeProject.project_code} · ${activeProject.project_name}`
    : "All projects";

  if (accessDenied) {
    return (
      <div>
        <PageHeader title="Inspections" description="Restricted view" />
        <AccessDenied
          title="Inspections are restricted"
          description="Inspection data is only visible to authorized personnel."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Inspections"
        description={`${scope} · ${summary.total} entries`}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            New Inspection
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">Total Inspections</div>
          <div className="text-lg font-semibold mt-1 tabular-nums">{summary.total}</div>
        </div>
        <div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">Passed</div>
          <div className="text-lg font-semibold mt-1 tabular-nums text-success">
            {summary.passed}
          </div>
        </div>
        <div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">Failed</div>
          <div className="text-lg font-semibold mt-1 tabular-nums text-destructive">
            {summary.failed}
          </div>
        </div>
        <div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">Scheduled</div>
          <div className="text-lg font-semibold mt-1 tabular-nums text-warning">
            {summary.scheduled}
          </div>
        </div>
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        searchKeys={["id", "unit_id", "inspector_name", "notes"]}
      />

      <InspectionFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        activeCode={activeCode}
      />
    </div>
  );
}

function InspectionFormDialog({
  open,
  onOpenChange,
  activeCode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeCode: string | null;
}) {
  const qc = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);

    try {
      const fd = new FormData(e.currentTarget);

      const { error } = await supabase.from("inspections" as any).insert({
        project_code: activeCode ?? undefined,
        unit_id: fd.get("unit_id")?.toString() || null,
        inspection_date:
          fd.get("inspection_date")?.toString() || new Date().toISOString().slice(0, 10),
        inspector_name: fd.get("inspector_name")?.toString() || null,
        status: fd.get("status")?.toString() || "SCHEDULED",
        notes: fd.get("notes")?.toString() || null,
      });

      if (error) throw error;

      await qc.invalidateQueries({ queryKey: ["inspections"] });
      onOpenChange(false);
    } catch (err: any) {
      alert(err.message || "Failed to create inspection");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Inspection</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="unit_id">Unit ID (Optional)</Label>
              <Input id="unit_id" name="unit_id" placeholder="e.g. A-101" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inspection_date">Date</Label>
              <Input
                id="inspection_date"
                name="inspection_date"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="inspector_name">Inspector Name</Label>
              <Input id="inspector_name" name="inspector_name" required placeholder="John Doe" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <select
                id="status"
                name="status"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                defaultValue="SCHEDULED"
              >
                <option value="SCHEDULED">Scheduled</option>
                <option value="PASSED">Passed</option>
                <option value="FAILED">Failed</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" name="notes" placeholder="Any additional notes..." />
          </div>

          <DialogFooter className="pt-4">
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Save Inspection"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
