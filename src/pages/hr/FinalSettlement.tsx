import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Calculator, Eye, Pencil, Trash2, CheckCircle2, DoorOpen } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { fmtDate, fmtPKR } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { withCompany } from "@/lib/companyScope";

// ---- Domain -------------------------------------------------------------
type SettlementStatus = "Draft" | "Finalized" | "Paid";
type ExitReason = "Resigned" | "Terminated";

const STATUS_TONE: Record<SettlementStatus, "success" | "warning" | "muted"> = {
  Draft: "muted",
  Finalized: "warning",
  Paid: "success",
};

type Employee = {
  id: string;
  employee_id: string;
  full_name: string;
  department: string;
  designation: string | null;
  join_date: string | null;
  basic_salary: number | null;
  allowances: number | null;
  status: "Active" | "On Leave" | "Resigned" | "Terminated";
};

type Settlement = {
  id: string;
  employee_id: string;
  settlement_date: string;
  last_working_date: string | null;
  reason: ExitReason;
  years_of_service: number;
  basic_salary: number;
  allowances: number;
  unpaid_salary: number;
  leave_encashment: number;
  gratuity: number;
  bonus: number;
  other_additions: number;
  deductions: number;
  net_payable: number;
  status: SettlementStatus;
  notes: string | null;
  created_at: string;
  hr_employees?: {
    employee_id: string;
    full_name: string;
    department: string;
    designation: string | null;
  } | null;
};

// ---- Helpers ------------------------------------------------------------
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function yearsBetween(fromISO: string | null, toISO: string): number {
  if (!fromISO) return 0;
  const from = new Date(fromISO);
  const to = new Date(toISO);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  const ms = to.getTime() - from.getTime();
  const years = ms / (1000 * 60 * 60 * 24 * 365.25);
  return Math.max(0, Math.round(years * 100) / 100);
}

/** Gratuity policy: last-drawn basic × completed years of service. */
function computeGratuity(basic: number, years: number): number {
  const completed = Math.floor(years);
  return Math.round(basic * completed);
}

function toNum(v: string | number | null | undefined): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[, ]+/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// ---- Page ---------------------------------------------------------------
export default function FinalSettlement() {
  const qc = useQueryClient();
  const { companyId } = useAuth();
  const [generating, setGenerating] = useState<Employee | null>(null);
  const [viewing, setViewing] = useState<Settlement | null>(null);
  const [editing, setEditing] = useState<Settlement | null>(null);
  const [deleting, setDeleting] = useState<Settlement | null>(null);

  const { data: employees = [] } = useQuery({
    queryKey: ["hr-employees", "exiting"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_employees" as any)
        .select(
          "id,employee_id,full_name,department,designation,join_date,basic_salary,allowances,status",
        )
        .in("status", ["Resigned", "Terminated"])
        .order("employee_id", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Employee[];
    },
  });

  const { data: settlements = [], isLoading } = useQuery({
    queryKey: ["hr-final-settlements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_final_settlements" as any)
        .select("*, hr_employees:employee_id (employee_id, full_name, department, designation)")
        .order("settlement_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Settlement[];
    },
  });

  const settledIds = useMemo(() => new Set(settlements.map((s) => s.employee_id)), [settlements]);

  const pendingEmployees = useMemo(
    () => employees.filter((e) => !settledIds.has(e.id)),
    [employees, settledIds],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["hr-final-settlements"] });
    qc.invalidateQueries({ queryKey: ["hr-employees"] });
  };

  const saveMutation = useMutation({
    mutationFn: async (
      payload: Omit<Settlement, "id" | "created_at" | "hr_employees"> & { id?: string },
    ) => {
      const { id, ...rest } = payload;
      if (id) {
        const { error } = await supabase
          .from("hr_final_settlements" as any)
          .update(rest)
          .eq("id", id)
          .eq("company_id", companyId!);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("hr_final_settlements" as any)
          .insert(withCompany(rest, companyId!));
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Settlement saved");
      invalidate();
      setGenerating(null);
      setEditing(null);
    },
    onError: (err: any) => toast.error(err?.message ?? "Could not save settlement"),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: SettlementStatus }) => {
      const { error } = await supabase
        .from("hr_final_settlements" as any)
        .update({ status })
        .eq("id", id)
        .eq("company_id", companyId!);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(`Marked ${v.status}`);
      invalidate();
    },
    onError: (err: any) => toast.error(err?.message ?? "Could not update status"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("hr_final_settlements" as any)
        .delete()
        .eq("id", id)
        .eq("company_id", companyId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Settlement deleted");
      invalidate();
      setDeleting(null);
    },
    onError: (err: any) => toast.error(err?.message ?? "Could not delete"),
  });

  const totalPayable = useMemo(
    () => settlements.reduce((sum, s) => sum + Number(s.net_payable ?? 0), 0),
    [settlements],
  );
  const paidCount = settlements.filter((s) => s.status === "Paid").length;

  const columns: Column<Settlement>[] = [
    {
      key: "eid",
      header: "Employee ID",
      cell: (r) => (
        <span className="font-mono text-xs text-primary">{r.hr_employees?.employee_id ?? "—"}</span>
      ),
    },
    {
      key: "name",
      header: "Employee",
      cell: (r) => (
        <div>
          <div className="font-medium capitalize">{r.hr_employees?.full_name ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{r.hr_employees?.department ?? "—"}</div>
        </div>
      ),
    },
    { key: "reason", header: "Reason", cell: (r) => r.reason },
    { key: "lwd", header: "Last Working", cell: (r) => fmtDate(r.last_working_date) },
    {
      key: "yos",
      header: "Years",
      align: "right",
      cell: (r) => <span className="tabular-nums">{Number(r.years_of_service).toFixed(2)}</span>,
    },
    {
      key: "net",
      header: "Net Payable",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums font-medium">{fmtPKR(Number(r.net_payable))}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge label={r.status} tone={STATUS_TONE[r.status]} />,
    },
    {
      key: "act",
      header: "Actions",
      cell: (r) => (
        <div className="flex items-center gap-1 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="h-8 min-h-11 min-w-11 text-xs"
            onClick={() => setViewing(r)}
            aria-label="View"
            title="View"
          >
            <Eye className="h-3.5 w-3.5" />
            <span className="ml-1 hidden sm:inline">View</span>
          </Button>
          {r.status !== "Paid" && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 min-h-11 min-w-11 text-xs"
              onClick={() => setEditing(r)}
              aria-label="Edit"
              title="Edit"
            >
              <Pencil className="h-3.5 w-3.5" />
              <span className="ml-1 hidden sm:inline">Edit</span>
            </Button>
          )}
          {r.status === "Draft" && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 min-h-11 min-w-11 text-xs"
              onClick={() => statusMutation.mutate({ id: r.id, status: "Finalized" })}
              disabled={statusMutation.isPending}
              aria-label="Finalize"
              title="Finalize"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span className="ml-1 hidden sm:inline">Finalize</span>
            </Button>
          )}
          {r.status === "Finalized" && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 min-h-11 min-w-11 text-xs"
              onClick={() => statusMutation.mutate({ id: r.id, status: "Paid" })}
              disabled={statusMutation.isPending}
              aria-label="Mark Paid"
              title="Mark Paid"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span className="ml-1 hidden sm:inline">Mark Paid</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 min-h-11 min-w-11 text-xs text-destructive hover:text-destructive"
            onClick={() => setDeleting(r)}
            aria-label="Delete"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="ml-1 hidden sm:inline">Delete</span>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Final Settlement"
        description={`${settlements.length} settlement${settlements.length === 1 ? "" : "s"} · ${paidCount} paid · ${fmtPKR(totalPayable)} total`}
      />

      {/* Pending exits — generate a settlement for each */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Pending settlements</h3>
            <p className="text-xs text-muted-foreground">
              Resigned or terminated employees without a settlement record.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">{pendingEmployees.length} pending</span>
        </div>

        {pendingEmployees.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No pending settlements. Change an employee's status to <em>Resigned</em> or{" "}
            <em>Terminated</em> in HR → Employees.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {pendingEmployees.map((e) => (
              <div key={e.id} className="border rounded-lg p-3 flex flex-col gap-2 bg-card">
                <div>
                  <div className="font-medium capitalize">{e.full_name}</div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">{e.employee_id}</span> · {e.department}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Basic {fmtPKR(e.basic_salary)} · Joined {fmtDate(e.join_date)}
                </div>
                <StatusBadge
                  label={e.status}
                  tone={e.status === "Terminated" ? "danger" : "muted"}
                />
                <Button size="sm" className="min-h-11 mt-1" onClick={() => setGenerating(e)}>
                  <Calculator className="h-4 w-4 mr-1" aria-hidden="true" />
                  Generate Settlement
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-0 overflow-hidden">
        <DataTable
          rows={settlements}
          columns={columns}
          rowKey={(r) => r.id}
          loading={isLoading}
          searchKeys={["reason", "status"]}
          emptyTitle="No settlements yet"
          emptyDescription="Generate a settlement for a resigned or terminated employee to record their full and final payout."
        />
      </Card>

      {generating && (
        <SettlementDialog
          mode="create"
          employee={generating}
          submitting={saveMutation.isPending}
          onClose={() => setGenerating(null)}
          onSubmit={(payload) => saveMutation.mutate(payload)}
        />
      )}

      {editing && (
        <SettlementDialog
          mode="edit"
          settlement={editing}
          submitting={saveMutation.isPending}
          onClose={() => setEditing(null)}
          onSubmit={(payload) => saveMutation.mutate({ ...payload, id: editing.id })}
        />
      )}

      {viewing && <SettlementDetail settlement={viewing} onClose={() => setViewing(null)} />}

      <AlertDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete settlement?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the settlement record for{" "}
              <span className="font-medium">{deleting?.hr_employees?.full_name}</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleting) deleteMutation.mutate(deleting.id);
              }}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// -------------------------------------------------------------------------
// Settlement form dialog — used for both create (from an Employee row) and
// edit (from an existing settlement).
// -------------------------------------------------------------------------

type FormState = {
  reason: ExitReason;
  settlement_date: string;
  last_working_date: string;
  years_of_service: string;
  basic_salary: string;
  allowances: string;
  unpaid_salary: string;
  leave_encashment: string;
  gratuity: string;
  bonus: string;
  other_additions: string;
  deductions: string;
  status: SettlementStatus;
  notes: string;
};

function initialFromEmployee(e: Employee): FormState {
  const today = todayISO();
  const yos = yearsBetween(e.join_date, today);
  const basic = Number(e.basic_salary ?? 0);
  return {
    reason: e.status === "Terminated" ? "Terminated" : "Resigned",
    settlement_date: today,
    last_working_date: today,
    years_of_service: String(yos),
    basic_salary: String(basic),
    allowances: String(Number(e.allowances ?? 0)),
    unpaid_salary: "0",
    leave_encashment: "0",
    gratuity: String(computeGratuity(basic, yos)),
    bonus: "0",
    other_additions: "0",
    deductions: "0",
    status: "Draft",
    notes: "",
  };
}

function initialFromSettlement(s: Settlement): FormState {
  return {
    reason: s.reason,
    settlement_date: s.settlement_date,
    last_working_date: s.last_working_date ?? "",
    years_of_service: String(s.years_of_service),
    basic_salary: String(s.basic_salary),
    allowances: String(s.allowances),
    unpaid_salary: String(s.unpaid_salary),
    leave_encashment: String(s.leave_encashment),
    gratuity: String(s.gratuity),
    bonus: String(s.bonus),
    other_additions: String(s.other_additions),
    deductions: String(s.deductions),
    status: s.status,
    notes: s.notes ?? "",
  };
}

function SettlementDialog(props: {
  mode: "create" | "edit";
  employee?: Employee;
  settlement?: Settlement;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    employee_id: string;
    settlement_date: string;
    last_working_date: string | null;
    reason: ExitReason;
    years_of_service: number;
    basic_salary: number;
    allowances: number;
    unpaid_salary: number;
    leave_encashment: number;
    gratuity: number;
    bonus: number;
    other_additions: number;
    deductions: number;
    net_payable: number;
    status: SettlementStatus;
    notes: string | null;
  }) => void;
}) {
  const { mode, employee, settlement, submitting, onClose, onSubmit } = props;
  const employeeInfo =
    mode === "create"
      ? { name: employee!.full_name, code: employee!.employee_id, dept: employee!.department }
      : {
          name: settlement!.hr_employees?.full_name ?? "—",
          code: settlement!.hr_employees?.employee_id ?? "—",
          dept: settlement!.hr_employees?.department ?? "—",
        };

  const [form, setForm] = useState<FormState>(() =>
    mode === "create" ? initialFromEmployee(employee!) : initialFromSettlement(settlement!),
  );

  useEffect(() => {
    setForm(
      mode === "create" ? initialFromEmployee(employee!) : initialFromSettlement(settlement!),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.id, settlement?.id]);

  // Recompute gratuity when basic / years change (only in create mode; in
  // edit mode the user's saved values are respected).
  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (mode === "create" && (k === "basic_salary" || k === "years_of_service")) {
        const basic = toNum(k === "basic_salary" ? (v as string) : f.basic_salary);
        const yos = toNum(k === "years_of_service" ? (v as string) : f.years_of_service);
        next.gratuity = String(computeGratuity(basic, yos));
      }
      return next;
    });
  }

  const additions =
    toNum(form.unpaid_salary) +
    toNum(form.leave_encashment) +
    toNum(form.gratuity) +
    toNum(form.bonus) +
    toNum(form.other_additions);
  const deductions = toNum(form.deductions);
  const netPayable = Math.max(0, Math.round((additions - deductions) * 100) / 100);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const employeeId = mode === "create" ? employee!.id : settlement!.employee_id;
    onSubmit({
      employee_id: employeeId,
      settlement_date: form.settlement_date || todayISO(),
      last_working_date: form.last_working_date || null,
      reason: form.reason,
      years_of_service: toNum(form.years_of_service),
      basic_salary: toNum(form.basic_salary),
      allowances: toNum(form.allowances),
      unpaid_salary: toNum(form.unpaid_salary),
      leave_encashment: toNum(form.leave_encashment),
      gratuity: toNum(form.gratuity),
      bonus: toNum(form.bonus),
      other_additions: toNum(form.other_additions),
      deductions: toNum(form.deductions),
      net_payable: netPayable,
      status: form.status,
      notes: form.notes.trim() || null,
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DoorOpen className="h-4 w-4" aria-hidden="true" />
            {mode === "create" ? "Generate Settlement" : "Edit Settlement"}
            <span className="ml-2 font-mono text-xs text-muted-foreground">
              · {employeeInfo.code}
            </span>
          </DialogTitle>
          <DialogDescription>
            {employeeInfo.name} · {employeeInfo.dept}. Gratuity defaults to last-drawn basic ×
            completed years of service.
          </DialogDescription>
        </DialogHeader>

        <form className="grid grid-cols-1 sm:grid-cols-2 gap-3" onSubmit={handleSubmit} noValidate>
          <Field label="Reason">
            <Select value={form.reason} onValueChange={(v) => set("reason", v as ExitReason)}>
              <SelectTrigger className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Resigned">Resigned</SelectItem>
                <SelectItem value="Terminated">Terminated</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onValueChange={(v) => set("status", v as SettlementStatus)}>
              <SelectTrigger className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Draft">Draft</SelectItem>
                <SelectItem value="Finalized">Finalized</SelectItem>
                <SelectItem value="Paid">Paid</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Last Working Date">
            <Input
              type="date"
              value={form.last_working_date}
              onChange={(e) => set("last_working_date", e.target.value)}
            />
          </Field>
          <Field label="Settlement Date">
            <Input
              type="date"
              value={form.settlement_date}
              onChange={(e) => set("settlement_date", e.target.value)}
            />
          </Field>

          <Field label="Basic Salary (PKR)">
            <Input
              inputMode="decimal"
              value={form.basic_salary}
              onChange={(e) => set("basic_salary", e.target.value)}
            />
          </Field>
          <Field label="Allowances (PKR)">
            <Input
              inputMode="decimal"
              value={form.allowances}
              onChange={(e) => set("allowances", e.target.value)}
            />
          </Field>

          <Field label="Years of Service">
            <Input
              inputMode="decimal"
              value={form.years_of_service}
              onChange={(e) => set("years_of_service", e.target.value)}
            />
          </Field>
          <Field label="Gratuity (PKR)">
            <Input
              inputMode="decimal"
              value={form.gratuity}
              onChange={(e) => set("gratuity", e.target.value)}
            />
          </Field>

          <Field label="Unpaid Salary (PKR)">
            <Input
              inputMode="decimal"
              value={form.unpaid_salary}
              onChange={(e) => set("unpaid_salary", e.target.value)}
            />
          </Field>
          <Field label="Leave Encashment (PKR)">
            <Input
              inputMode="decimal"
              value={form.leave_encashment}
              onChange={(e) => set("leave_encashment", e.target.value)}
            />
          </Field>

          <Field label="Bonus (PKR)">
            <Input
              inputMode="decimal"
              value={form.bonus}
              onChange={(e) => set("bonus", e.target.value)}
            />
          </Field>
          <Field label="Other Additions (PKR)">
            <Input
              inputMode="decimal"
              value={form.other_additions}
              onChange={(e) => set("other_additions", e.target.value)}
            />
          </Field>

          <Field label="Deductions (PKR)">
            <Input
              inputMode="decimal"
              value={form.deductions}
              onChange={(e) => set("deductions", e.target.value)}
            />
          </Field>
          <Field label="Net Payable (PKR)">
            <Input value={fmtPKR(netPayable)} readOnly className="bg-muted font-medium" />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Notes">
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                maxLength={1000}
              />
            </Field>
          </div>

          <DialogFooter className="sm:col-span-2 mt-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="min-h-11" disabled={submitting}>
              {submitting ? "Saving…" : mode === "create" ? "Create Settlement" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

// -------------------------------------------------------------------------
// Read-only detail view
// -------------------------------------------------------------------------

function SettlementDetail({
  settlement,
  onClose,
}: {
  settlement: Settlement;
  onClose: () => void;
}) {
  const rows: Array<[string, string, "add" | "sub" | "info"]> = [
    ["Basic Salary", fmtPKR(settlement.basic_salary), "info"],
    ["Allowances", fmtPKR(settlement.allowances), "info"],
    ["Unpaid Salary", fmtPKR(settlement.unpaid_salary), "add"],
    ["Leave Encashment", fmtPKR(settlement.leave_encashment), "add"],
    ["Gratuity", fmtPKR(settlement.gratuity), "add"],
    ["Bonus", fmtPKR(settlement.bonus), "add"],
    ["Other Additions", fmtPKR(settlement.other_additions), "add"],
    ["Deductions", `− ${fmtPKR(settlement.deductions)}`, "sub"],
  ];

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settlement · {settlement.hr_employees?.employee_id}</DialogTitle>
          <DialogDescription>
            {settlement.hr_employees?.full_name} · {settlement.reason} · Last worked{" "}
            {fmtDate(settlement.last_working_date)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1 text-sm">
          {rows.map(([label, value, tone]) => (
            <div key={label} className="flex justify-between py-1 border-b last:border-b-0">
              <span
                className={
                  tone === "sub"
                    ? "text-destructive"
                    : tone === "add"
                      ? "text-foreground"
                      : "text-muted-foreground"
                }
              >
                {label}
              </span>
              <span className="tabular-nums font-mono text-xs">{value}</span>
            </div>
          ))}
          <div className="flex justify-between py-2 mt-2 border-t-2 border-primary/40 font-medium">
            <span>Net Payable</span>
            <span className="tabular-nums text-primary">{fmtPKR(settlement.net_payable)}</span>
          </div>
        </div>

        <div className="mt-3 text-xs text-muted-foreground space-y-1">
          <div>
            Years of service:{" "}
            <span className="tabular-nums">{Number(settlement.years_of_service).toFixed(2)}</span>
          </div>
          <div>
            Status: <StatusBadge label={settlement.status} tone={STATUS_TONE[settlement.status]} />
          </div>
          {settlement.notes && (
            <div className="pt-2">
              <div className="text-foreground font-medium mb-1">Notes</div>
              <p className="whitespace-pre-wrap">{settlement.notes}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
