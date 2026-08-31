import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, Column } from "@/components/DataTable";
import { StatusBadge, statusTone } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { fmtPKR } from "@/lib/format";
import { useActiveProject } from "@/lib/activeProject";
import { NewUnitDialog } from "@/components/NewUnitDialog";
import { EditUnitDialog, type EditableUnit } from "@/components/EditUnitDialog";
import { Reveal } from "@/components/motion";

export default function Units() {
  const { activeCode, activeProject } = useActiveProject();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { companyId } = useAuth();

  const { data: rows = [], isLoading } = useQuery({
    // Refetch whenever the active project changes so the list reslices to that
    // project's units only (or all units when nothing is active).
    queryKey: ["units", activeCode ?? "all"],
    queryFn: async () => {
      let q = supabase.from("units").select("*").order("unit_id");
      if (activeCode) q = q.eq("project_code", activeCode);
      return (await q).data ?? [];
    },
  });

  // Duplicate active-booking detection (still evaluated per scoped list)
  const linkedCount: Record<string, number> = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach((u: any) => {
      if (u.linked_booking_id) m[u.unit_id] = (m[u.unit_id] ?? 0) + 1;
    });
    return m;
  }, [rows]);

  const [editUnit, setEditUnit] = useState<EditableUnit | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteUnit, setDeleteUnit] = useState<EditableUnit | null>(null);
  const [deleting, setDeleting] = useState(false);

  const openEdit = (row: any) => {
    setEditUnit({
      unit_id: row.unit_id,
      project_code: row.project_code,
      project_name: row.project_name ?? null,
      unit_no: row.unit_no ?? null,
      unit_type: row.unit_type ?? null,
      floor: row.floor ?? null,
      size_sqft: row.size_sqft ?? null,
      base_rate: row.base_rate ?? null,
      status: row.status ?? null,
      notes: row.notes ?? null,
      linked_booking_id: row.linked_booking_id ?? null,
    });
    setEditOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteUnit) return;
    setDeleting(true);
    const { error } = await supabase
      .from("units")
      .delete()
      .eq("unit_id", deleteUnit.unit_id)
      .eq("company_id", companyId!);
    setDeleting(false);
    if (error) {
      toast({
        variant: "destructive",
        title: "Could not delete unit",
        description: error.message.includes("foreign key")
          ? "This unit is referenced by a booking or payment. Remove those first."
          : error.message,
      });
      return;
    }
    toast({ title: "Unit deleted", description: deleteUnit.unit_id });
    await qc.invalidateQueries({ queryKey: ["units"] });
    setDeleteUnit(null);
  };

  const columns: Column<any>[] = [
    {
      key: "id",
      header: "Unit",
      cell: (r) => <span className="font-mono text-primary">{r.unit_id}</span>,
    },
    { key: "proj", header: "Project", cell: (r) => r.project_name },
    { key: "type", header: "Type", cell: (r) => r.unit_type },
    { key: "floor", header: "Floor", cell: (r) => r.floor },
    { key: "size", header: "Size (sqft)", align: "right", cell: (r) => fmtPKR(r.size_sqft) },
    { key: "rate", header: "Base Rate", align: "right", cell: (r) => fmtPKR(r.base_rate) },
    { key: "std", header: "Standard Value", align: "right", cell: (r) => fmtPKR(r.standard_value) },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge label={r.status} tone={statusTone(r.status)} />,
    },
    {
      key: "booking",
      header: "Linked Booking",
      cell: (r) =>
        r.linked_booking_id ? (
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs">{r.linked_booking_id}</span>
            {linkedCount[r.unit_id] > 1 && <StatusBadge label="Duplicate" tone="danger" />}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            className="min-h-11 min-w-11"
            variant="ghost"
            size="icon"
            aria-label={`Edit unit ${r.unit_id}`}
            onClick={(e) => {
              e.stopPropagation();
              openEdit(r);
            }}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            className="min-h-11 min-w-11"
            variant="ghost"
            size="icon"
            aria-label={`Delete unit ${r.unit_id}`}
            onClick={(e) => {
              e.stopPropagation();
              setDeleteUnit({
                unit_id: r.unit_id,
                project_code: r.project_code,
                project_name: r.project_name ?? null,
                unit_no: r.unit_no ?? null,
                unit_type: r.unit_type ?? null,
                floor: r.floor ?? null,
                size_sqft: r.size_sqft ?? null,
                base_rate: r.base_rate ?? null,
                status: r.status ?? null,
                notes: r.notes ?? null,
                linked_booking_id: r.linked_booking_id ?? null,
              });
            }}
          >
            <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
          </Button>
        </div>
      ),
    },
  ];

  const scope = activeProject
    ? `${activeProject.project_code} · ${activeProject.project_name}`
    : "All projects";

  return (
    <div>
      {/* Heading fades/slides in first; the table follows a beat later
          so the eye lands on context before the data grid. */}
      <Reveal>
        <PageHeader
          title="Units"
          description={`${scope} · ${rows.length} units · ${rows.filter((u: any) => u.status === "Available").length} available`}
          actions={<NewUnitDialog />}
        />
      </Reveal>
      <Reveal delay={0.08}>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.unit_id}
          searchKeys={[
            "unit_id",
            "unit_no",
            "project_name",
            "unit_type",
            "floor",
            "linked_booking_id",
          ]}
          loading={isLoading}
          animateRows
          emptyTitle="No units yet"
          emptyDescription={
            activeProject
              ? `Add the first unit in ${activeProject.project_name} to start assigning bookings.`
              : "Units imported from the master file, or added via New unit, will appear here."
          }
          emptyAction={<NewUnitDialog />}
        />
      </Reveal>

      <EditUnitDialog
        unit={editUnit}
        open={editOpen}
        onOpenChange={(v) => {
          setEditOpen(v);
          if (!v) setEditUnit(null);
        }}
      />

      <AlertDialog
        open={!!deleteUnit}
        onOpenChange={(v) => {
          if (!v && !deleting) setDeleteUnit(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this unit?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteUnit ? (
                <>
                  <span className="font-mono">{deleteUnit.unit_id}</span>
                  {deleteUnit.project_name ? ` in ${deleteUnit.project_name}` : ""}
                  {" will be permanently removed. "}
                  {deleteUnit.linked_booking_id ? (
                    <>
                      This unit is linked to booking{" "}
                      <span className="font-mono">{deleteUnit.linked_booking_id}</span>. Delete may
                      fail if references exist.
                    </>
                  ) : (
                    "This action cannot be undone."
                  )}
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete unit"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
