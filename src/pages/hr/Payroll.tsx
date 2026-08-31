import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Calculator, FileText, Trash2, CheckCircle2, Loader2 } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobilePayrollList } from "@/components/hr/MobilePayrollList";
import { MobilePayslipSheet } from "@/components/hr/MobilePayslip";

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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
type RunStatus = "Draft" | "Finalized";

const STATUS_TONE: Record<RunStatus, "success" | "muted"> = {
  Finalized: "success",
  Draft: "muted",
};

type Employee = {
  id: string;
  employee_id: string;
  full_name: string;
  department: string;
  basic_salary: number;
  allowances: number;
  status: string;
};

type Attendance = {
  employee_id: string;
  attendance_date: string;
  status: "Present" | "Absent" | "Leave" | "Half Day" | "Late";
};

type PayslipDraft = {
  employee_id: string;
  full_name: string;
  employee_ref: string;
  basic_salary: number;
  allowances: number;
  gross_salary: number;
  working_days: number;
  present_days: number;
  absent_days: number;
  leave_days: number;
  half_days: number;
  late_days: number;
  deduction: number;
  net_salary: number;
};

type Run = {
  id: string;
  period_month: string;
  status: RunStatus;
  notes: string | null;
  created_at: string;
};

// ---- Helpers ------------------------------------------------------------
function currentMonthISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(monthISO: string): { start: string; end: string; days: number } {
  const [y, m] = monthISO.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0)); // last day
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end), days: end.getUTCDate() };
}

function monthLabel(dateISO: string): string {
  const d = new Date(dateISO + (dateISO.length === 7 ? "-01" : ""));
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

/**
 * Compute payslip figures from employees + attendance for the month.
 *
 * Rules (kept intentionally simple so the workflow is auditable end-to-end):
 * - `working_days` = calendar days in the month.
 * - Unmarked days count as Present — we shouldn't deduct salary just because
 *   attendance wasn't recorded that day. Explicit Absent / Half Day rows are
 *   the only things that create a deduction.
 * - `per_day` = gross / working_days.
 * - deduction = absent × per_day + half × (per_day / 2).
 * - Leave and Late are informational only (paid).
 */
function computePayslips(
  employees: Employee[],
  attendance: Attendance[],
  workingDays: number,
): PayslipDraft[] {
  const byEmp = new Map<string, Attendance[]>();
  for (const a of attendance) {
    const arr = byEmp.get(a.employee_id) ?? [];
    arr.push(a);
    byEmp.set(a.employee_id, arr);
  }

  return employees.map((e) => {
    const rows = byEmp.get(e.id) ?? [];
    let absent = 0,
      leave = 0,
      half = 0,
      late = 0,
      presentExplicit = 0;
    for (const r of rows) {
      switch (r.status) {
        case "Absent":
          absent += 1;
          break;
        case "Leave":
          leave += 1;
          break;
        case "Half Day":
          half += 1;
          break;
        case "Late":
          late += 1;
          presentExplicit += 1;
          break;
        case "Present":
          presentExplicit += 1;
          break;
      }
    }
    // Days with no attendance row assumed present.
    const unmarked = Math.max(0, workingDays - (presentExplicit + absent + leave + half));
    const present = presentExplicit + unmarked;

    const basic = Number(e.basic_salary ?? 0);
    const allow = Number(e.allowances ?? 0);
    const gross = basic + allow;
    const perDay = workingDays > 0 ? gross / workingDays : 0;
    const deduction = absent * perDay + half * (perDay / 2);
    const net = Math.max(0, gross - deduction);

    return {
      employee_id: e.id,
      full_name: e.full_name,
      employee_ref: e.employee_id,
      basic_salary: basic,
      allowances: allow,
      gross_salary: gross,
      working_days: workingDays,
      present_days: present,
      absent_days: absent,
      leave_days: leave,
      half_days: half,
      late_days: late,
      deduction: Math.round(deduction * 100) / 100,
      net_salary: Math.round(net * 100) / 100,
    };
  });
}

// ---- Page ---------------------------------------------------------------
export default function Payroll() {
  const qc = useQueryClient();
  const { companyId } = useAuth();
  const [generateOpen, setGenerateOpen] = useState(false);
  const [viewingRun, setViewingRun] = useState<Run | null>(null);
  const [deleting, setDeleting] = useState<Run | null>(null);

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["hr-payroll-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_payroll_runs" as any)
        .select("*, hr_payslips(net_salary, gross_salary)")
        .order("period_month", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("hr_payroll_runs" as any)
        .delete()
        .eq("id", id)
        .eq("company_id", companyId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payroll run deleted");
      qc.invalidateQueries({ queryKey: ["hr-payroll-runs"] });
      setDeleting(null);
    },
    onError: (err: any) => toast.error(err?.message ?? "Could not delete run"),
  });

  const columns: Column<any>[] = [
    {
      key: "period",
      header: "Period",
      cell: (r) => <span className="font-medium">{monthLabel(r.period_month)}</span>,
    },
    {
      key: "count",
      header: "Employees",
      align: "right",
      cell: (r) => <span className="tabular-nums">{r.hr_payslips?.length ?? 0}</span>,
    },
    {
      key: "gross",
      header: "Total Gross",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">
          {fmtPKR(
            (r.hr_payslips ?? []).reduce((s: number, p: any) => s + Number(p.gross_salary ?? 0), 0),
          )}
        </span>
      ),
    },
    {
      key: "net",
      header: "Total Net",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums font-medium">
          {fmtPKR(
            (r.hr_payslips ?? []).reduce((s: number, p: any) => s + Number(p.net_salary ?? 0), 0),
          )}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <StatusBadge label={r.status} tone={STATUS_TONE[r.status as RunStatus] ?? "muted"} />
      ),
    },
    { key: "created", header: "Generated", cell: (r) => fmtDate(r.created_at) },
    {
      key: "act",
      header: "Actions",
      cell: (r) => (
        <div className="flex items-center gap-1 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="h-8 min-h-11 min-w-11 text-xs"
            onClick={() => setViewingRun(r)}
            aria-label="View payslips"
          >
            <FileText className="h-3.5 w-3.5" />
            <span className="ml-1 hidden sm:inline">View</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 min-h-11 min-w-11 text-xs text-destructive hover:text-destructive"
            onClick={() => setDeleting(r)}
            aria-label="Delete run"
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
        title="Payroll"
        description="Generate monthly payroll runs from employee salaries and attendance."
        actions={
          <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
            <DialogTrigger asChild>
              <Button className="min-h-11 min-w-11 bg-warning text-warning-foreground hover:bg-warning/90">
                <Calculator className="h-4 w-4 mr-2" aria-hidden="true" />
                Process All Payroll
              </Button>
            </DialogTrigger>
            <GenerateRunDialog
              existingMonths={runs.map((r: any) => r.period_month)}
              onDone={() => {
                setGenerateOpen(false);
                qc.invalidateQueries({ queryKey: ["hr-payroll-runs"] });
              }}
            />
          </Dialog>
        }
      />

      <Card className="p-0 overflow-hidden">
        <DataTable
          rows={runs}
          columns={columns}
          rowKey={(r) => r.id}
          loading={isLoading}
          searchKeys={["status"]}
          emptyTitle="No payroll runs yet"
          emptyDescription="Generate your first monthly run to compute salaries from employee records and attendance."
          emptyAction={
            <Button className="min-h-11 min-w-11" onClick={() => setGenerateOpen(true)}>
              <Calculator className="h-4 w-4 mr-2" aria-hidden="true" />
              Generate Payroll Run
            </Button>
          }
        />
      </Card>

      {viewingRun && <RunDetailDialog run={viewingRun} onClose={() => setViewingRun(null)} />}

      <AlertDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete payroll run?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the {deleting && monthLabel(deleting.period_month)} run and
              all of its payslips. This cannot be undone.
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

// ---- Generate dialog ----------------------------------------------------
function GenerateRunDialog({
  existingMonths,
  onDone,
}: {
  existingMonths: string[];
  onDone: () => void;
}) {
  const [month, setMonth] = useState<string>(currentMonthISO());
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<RunStatus>("Draft");
  const [drafts, setDrafts] = useState<PayslipDraft[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const { companyId } = useAuth();

  const { start, end, days } = useMemo(() => monthBounds(month), [month]);
  const collision = existingMonths.some((m) => m.slice(0, 7) === month);

  async function preview() {
    setPreviewing(true);
    try {
      const [empRes, attRes] = await Promise.all([
        supabase
          .from("hr_employees" as any)
          .select("id, employee_id, full_name, department, basic_salary, allowances, status")
          .in("status", ["Active", "On Leave"])
          .order("employee_id", { ascending: true }),
        supabase
          .from("hr_attendance" as any)
          .select("employee_id, attendance_date, status")
          .gte("attendance_date", start)
          .lte("attendance_date", end),
      ]);
      if (empRes.error) throw empRes.error;
      if (attRes.error) throw attRes.error;
      const employees = (empRes.data ?? []) as unknown as Employee[];
      const attendance = (attRes.data ?? []) as unknown as Attendance[];
      if (employees.length === 0) {
        toast.error("No active employees to run payroll for");
        setDrafts([]);
        return;
      }
      setDrafts(computePayslips(employees, attendance, days));
    } catch (err: any) {
      toast.error(err?.message ?? "Could not compute payroll");
    } finally {
      setPreviewing(false);
    }
  }

  const totals = useMemo(() => {
    if (!drafts) return { gross: 0, deduction: 0, net: 0 };
    return drafts.reduce(
      (s, d) => ({
        gross: s.gross + d.gross_salary,
        deduction: s.deduction + d.deduction,
        net: s.net + d.net_salary,
      }),
      { gross: 0, deduction: 0, net: 0 },
    );
  }, [drafts]);

  const [saving, setSaving] = useState(false);
  async function save() {
    if (saving) return;
    if (!drafts || drafts.length === 0) return;
    if (collision) {
      toast.error(`A run already exists for ${monthLabel(month)}`);
      return;
    }
    setSaving(true);
    try {
      const { data: run, error: runErr } = await supabase
        .from("hr_payroll_runs" as any)
        .insert(
          withCompany(
            {
              period_month: month,
              status,
              working_days: days,
              notes: notes.trim() || null,
              total_gross: totals.gross,
              total_deduction: totals.deduction,
              total_net: totals.net,
            },
            companyId!,
          ) as any,
        )
        .select("id")
        .single();
      if (runErr) throw runErr;
      const runId = (run as any).id as string;

      const payload = drafts.map((d) => ({
        run_id: runId,
        employee_id: d.employee_id,
        basic_salary: d.basic_salary,
        allowances: d.allowances,
        gross_salary: d.gross_salary,
        working_days: d.working_days,
        present_days: d.present_days,
        absent_days: d.absent_days,
        leave_days: d.leave_days,
        half_days: d.half_days,
        late_days: d.late_days,
        deduction: d.deduction,
        net_salary: d.net_salary,
      }));
      const { error: slipErr } = await supabase
        .from("hr_payslips" as any)
        .insert(withCompany(payload, companyId!));
      if (slipErr) {
        // Roll back the run so we don't leave an empty header.
        await supabase
          .from("hr_payroll_runs" as any)
          .delete()
          .eq("id", runId)
          .eq("company_id", companyId!);
        throw slipErr;
      }
      toast.success(`Payroll run created for ${monthLabel(month)}`);
      onDone();
    } catch (err: any) {
      toast.error(err?.message ?? "Could not save payroll run");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Generate Payroll Run</DialogTitle>
        <DialogDescription>
          Pick a month, preview the computed payslips, then save. Salaries are calculated from Basic
          + Allowances minus deductions for Absent and Half Day attendance in the selected month.
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Month</Label>
          <Input
            type="month"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setDrafts(null);
            }}
            className="min-h-11"
          />
          {collision && (
            <p className="text-[11px] text-destructive">
              A payroll run already exists for this month. Delete it first to regenerate.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Status</Label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as RunStatus)}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="Draft">Draft</option>
            <option value="Finalized">Finalized</option>
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-1">
          <Label className="text-xs font-medium">Working days</Label>
          <Input readOnly value={days} className="bg-muted/40 font-medium tabular-nums" />
        </div>
        <div className="sm:col-span-3 space-y-1.5">
          <Label className="text-xs font-medium">Notes</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={preview} disabled={previewing} className="min-h-11">
          <Calculator className="h-4 w-4 mr-2" aria-hidden="true" />
          {previewing ? "Computing…" : drafts ? "Recompute" : "Preview payslips"}
        </Button>
        {drafts && drafts.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {drafts.length} employees · Gross{" "}
            <span className="font-medium text-foreground">{fmtPKR(totals.gross)}</span>
            {" · "}Deductions{" "}
            <span className="font-medium text-foreground">{fmtPKR(totals.deduction)}</span>
            {" · "}Net <span className="font-medium text-foreground">{fmtPKR(totals.net)}</span>
          </div>
        )}
      </div>

      {drafts && drafts.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Employee</th>
                <th className="text-right px-3 py-2">Basic</th>
                <th className="text-right px-3 py-2">Allow.</th>
                <th className="text-right px-3 py-2">Gross</th>
                <th className="text-right px-3 py-2">P</th>
                <th className="text-right px-3 py-2">A</th>
                <th className="text-right px-3 py-2">L</th>
                <th className="text-right px-3 py-2">½</th>
                <th className="text-right px-3 py-2">Deduct</th>
                <th className="text-right px-3 py-2">Net</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.employee_id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-medium capitalize">{d.full_name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">
                      {d.employee_ref}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPKR(d.basic_salary)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPKR(d.allowances)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPKR(d.gross_salary)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.present_days}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.absent_days}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.leave_days}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.half_days}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-destructive">
                    {d.deduction > 0 ? `-${fmtPKR(d.deduction)}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {fmtPKR(d.net_salary)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DialogFooter>
        <Button
          onClick={save}
          disabled={!drafts || drafts.length === 0 || collision || saving}
          className="min-h-11"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-4 w-4 mr-2" aria-hidden="true" />
          )}
          {saving ? "Saving…" : "Save Payroll Run"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ---- Run detail dialog --------------------------------------------------
function RunDetailDialog({ run, onClose }: { run: Run; onClose: () => void }) {
  const isMobile = useIsMobile();
  const [payslipOpen, setPayslipOpen] = useState(false);
  const [activeSlip, setActiveSlip] = useState<any>(null);

  const { data: slips = [], isLoading } = useQuery({
    queryKey: ["hr-payslips", run.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_payslips" as any)
        .select(
          "*, hr_employees(full_name, employee_id, department, designation, bank_name, bank_account)",
        )
        .eq("run_id", run.id)
        .order("employee_id", { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const totals = slips.reduce(
    (s, p) => ({
      gross: s.gross + Number(p.gross_salary ?? 0),
      deduction: s.deduction + Number(p.deduction ?? 0),
      net: s.net + Number(p.net_salary ?? 0),
    }),
    { gross: 0, deduction: 0, net: 0 },
  );

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        className={
          isMobile
            ? "max-w-full h-[100dvh] p-0 gap-0 overflow-y-auto"
            : "max-w-4xl max-h-[85vh] overflow-y-auto"
        }
      >
        <DialogHeader className={isMobile ? "px-4 pt-4" : ""}>
          <DialogTitle>
            Payroll — {monthLabel(run.period_month)}{" "}
            <span className="ml-2">
              <StatusBadge label={run.status} tone={STATUS_TONE[run.status] ?? "muted"} />
            </span>
          </DialogTitle>
          <DialogDescription>
            {slips.length} payslips · Gross {fmtPKR(totals.gross)} · Deductions{" "}
            {fmtPKR(totals.deduction)} · Net{" "}
            <span className="font-medium">{fmtPKR(totals.net)}</span>
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className={"text-sm text-muted-foreground" + (isMobile ? " px-4" : "")}>
            Loading payslips…
          </p>
        ) : isMobile ? (
          <div className="px-4">
            <MobilePayrollList
              runId={run.id}
              slips={slips}
              onOpenPayslip={(p) => {
                setActiveSlip(p);
                setPayslipOpen(true);
              }}
            />
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Employee</th>
                  <th className="text-left px-3 py-2">Department</th>
                  <th className="text-right px-3 py-2">Basic</th>
                  <th className="text-right px-3 py-2">Allow.</th>
                  <th className="text-right px-3 py-2">Gross</th>
                  <th className="text-right px-3 py-2">Days (P/A/L/½)</th>
                  <th className="text-right px-3 py-2">Deduct</th>
                  <th className="text-right px-3 py-2">Net</th>
                </tr>
              </thead>
              <tbody>
                {slips.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <div className="font-medium capitalize">
                        {p.hr_employees?.full_name ?? "—"}
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono">
                        {p.hr_employees?.employee_id ?? "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2">{p.hr_employees?.department ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPKR(p.basic_salary)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPKR(p.allowances)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPKR(p.gross_salary)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs">
                      {p.present_days}/{p.absent_days}/{p.leave_days}/{p.half_days}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-destructive">
                      {Number(p.deduction) > 0 ? `-${fmtPKR(p.deduction)}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {fmtPKR(p.net_salary)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {run.notes && (
          <p
            className={
              "text-xs text-muted-foreground border-l-2 border-border pl-3" +
              (isMobile ? " mx-4" : "")
            }
          >
            {run.notes}
          </p>
        )}

        <DialogFooter className={isMobile ? "px-4 pb-4" : ""}>
          <Button variant="outline" onClick={onClose} className="min-h-11">
            Close
          </Button>
        </DialogFooter>

        <MobilePayslipSheet
          open={payslipOpen}
          onOpenChange={setPayslipOpen}
          payslip={activeSlip}
          periodLabel={monthLabel(run.period_month)}
        />
      </DialogContent>
    </Dialog>
  );
}
