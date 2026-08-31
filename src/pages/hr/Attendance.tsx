import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarCheck, ClipboardList, Save } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtDate } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { withCompany } from "@/lib/companyScope";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileAttendanceList } from "@/components/hr/MobileAttendanceList";

// ---- Domain ------------------------------------------------------------
// Statuses mirror the CHECK constraint on `public.hr_attendance` — any new
// value must land in a follow-up migration first.
const STATUSES = ["Present", "Absent", "Leave", "Half Day", "Late"] as const;
type AttendanceStatus = (typeof STATUSES)[number];

const STATUS_TONE: Record<AttendanceStatus, "success" | "warning" | "muted" | "danger"> = {
  Present: "success",
  Late: "warning",
  "Half Day": "warning",
  Leave: "muted",
  Absent: "danger",
};

type Employee = {
  id: string;
  employee_id: string;
  full_name: string;
  designation: string | null;
  department: string;
  status: string;
};

type AttendanceRow = {
  id: string;
  employee_id: string;
  attendance_date: string;
  status: AttendanceStatus;
  check_in: string | null;
  check_out: string | null;
  notes: string | null;
};

// Local state for the "mark today" grid. Kept as strings so the time
// inputs can be freely edited before commit.
type MarkRow = {
  employeeId: string;
  status: AttendanceStatus;
  checkIn: string;
  checkOut: string;
  notes: string;
  dirty: boolean;
  existingId?: string;
};

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function Attendance() {
  const qc = useQueryClient();
  const { companyId } = useAuth();
  const isMobile = useIsMobile();
  const [date, setDate] = useState<string>(todayISO());

  // Active employees drive the marking grid; resigned/terminated staff still
  // appear in historical records but shouldn't get new attendance rows.
  const { data: employees = [], isLoading: loadingEmployees } = useQuery({
    queryKey: ["hr-employees-for-attendance"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_employees" as any)
        .select("id, employee_id, full_name, designation, department, status")
        .in("status", ["Active", "On Leave"])
        .order("employee_id", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Employee[];
    },
  });

  const { data: dayRows = [], isLoading: loadingDay } = useQuery({
    queryKey: ["hr-attendance-day", date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_attendance" as any)
        .select("*")
        .eq("attendance_date", date);
      if (error) throw error;
      return (data ?? []) as unknown as AttendanceRow[];
    },
  });

  const { data: recent = [], isLoading: loadingRecent } = useQuery({
    queryKey: ["hr-attendance-recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_attendance" as any)
        .select("*, hr_employees(full_name, employee_id, department)")
        .order("attendance_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // Build the marking grid from employees + existing rows for the date.
  const [rows, setRows] = useState<MarkRow[]>([]);
  useEffect(() => {
    const byEmp = new Map(dayRows.map((r) => [r.employee_id, r]));
    setRows(
      employees.map((e) => {
        const existing = byEmp.get(e.id);
        return {
          employeeId: e.id,
          status: (existing?.status ?? "Present") as AttendanceStatus,
          checkIn: existing?.check_in?.slice(0, 5) ?? "",
          checkOut: existing?.check_out?.slice(0, 5) ?? "",
          notes: existing?.notes ?? "",
          dirty: false,
          existingId: existing?.id,
        };
      }),
    );
  }, [employees, dayRows]);

  const dirtyCount = useMemo(() => rows.filter((r) => r.dirty).length, [rows]);

  function updateRow(id: string, patch: Partial<MarkRow>) {
    setRows((rs) => rs.map((r) => (r.employeeId === id ? { ...r, ...patch, dirty: true } : r)));
  }

  function markAll(status: AttendanceStatus) {
    setRows((rs) => rs.map((r) => ({ ...r, status, dirty: true })));
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const dirty = rows.filter((r) => r.dirty);
      if (dirty.length === 0) return;
      const payload = dirty.map((r) => ({
        employee_id: r.employeeId,
        attendance_date: date,
        status: r.status,
        check_in: r.checkIn || null,
        check_out: r.checkOut || null,
        notes: r.notes.trim() || null,
      }));
      const { error } = await supabase
        .from("hr_attendance" as any)
        .upsert(withCompany(payload, companyId!), { onConflict: "employee_id,attendance_date" });
      if (error) throw error;
      return dirty.length;
    },
    onSuccess: (n) => {
      if (n) toast.success(`Saved ${n} attendance ${n === 1 ? "record" : "records"}`);
      qc.invalidateQueries({ queryKey: ["hr-attendance-day", date] });
      qc.invalidateQueries({ queryKey: ["hr-attendance-recent"] });
    },
    onError: (err: any) => toast.error(err?.message ?? "Could not save attendance"),
  });

  const summary = useMemo(() => {
    const counts: Record<AttendanceStatus, number> = {
      Present: 0,
      Absent: 0,
      Leave: 0,
      "Half Day": 0,
      Late: 0,
    };
    for (const r of rows) counts[r.status] += 1;
    return counts;
  }, [rows]);

  // ---- Recent-records table -------------------------------------------
  const recentColumns: Column<any>[] = [
    { key: "date", header: "Date", cell: (r) => fmtDate(r.attendance_date) },
    {
      key: "eid",
      header: "Employee ID",
      cell: (r) => (
        <span className="font-mono text-xs text-primary">{r.hr_employees?.employee_id ?? "—"}</span>
      ),
    },
    {
      key: "name",
      header: "Name",
      cell: (r) => (
        <span className="font-medium capitalize">{r.hr_employees?.full_name ?? "—"}</span>
      ),
    },
    { key: "dept", header: "Department", cell: (r) => r.hr_employees?.department ?? "—" },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <StatusBadge label={r.status} tone={STATUS_TONE[r.status as AttendanceStatus] ?? "muted"} />
      ),
    },
    { key: "in", header: "In", cell: (r) => r.check_in?.slice(0, 5) ?? "—" },
    { key: "out", header: "Out", cell: (r) => r.check_out?.slice(0, 5) ?? "—" },
    { key: "notes", header: "Notes", cell: (r) => r.notes ?? "—" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Attendance"
        description="Mark daily attendance for active employees and review recent history."
      />

      {isMobile ? <MobileAttendanceList employees={employees} loading={loadingEmployees} /> : null}

      <Card className={"p-4 space-y-4" + (isMobile ? " hidden" : "")}>
        <div className="flex flex-wrap items-end gap-3 justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="att-date" className="text-xs font-medium">
                Date
              </Label>
              <Input
                id="att-date"
                type="date"
                value={date}
                max={todayISO()}
                onChange={(e) => setDate(e.target.value)}
                className="w-44"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <CalendarCheck className="h-4 w-4" aria-hidden="true" />
              <span>{rows.length} employees</span>
              <span>·</span>
              <span>P {summary.Present}</span>
              <span>A {summary.Absent}</span>
              <span>L {summary.Leave}</span>
              <span>H {summary["Half Day"]}</span>
              <span>Late {summary.Late}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={() => markAll("Present")}
            >
              Mark all Present
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={() => markAll("Absent")}
            >
              Mark all Absent
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={dirtyCount === 0 || saveMutation.isPending}
              className="min-h-11"
            >
              <Save className="h-4 w-4 mr-2" aria-hidden="true" />
              {saveMutation.isPending
                ? "Saving…"
                : dirtyCount > 0
                  ? `Save (${dirtyCount})`
                  : "Saved"}
            </Button>
          </div>
        </div>

        {loadingEmployees || loadingDay ? (
          <p className="text-sm text-muted-foreground">Loading employees…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active employees. Add one under HR &amp; Payroll → Employees to start marking
            attendance.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Employee</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">In</th>
                  <th className="text-left px-3 py-2">Out</th>
                  <th className="text-left px-3 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const emp = employees.find((e) => e.id === r.employeeId);
                  if (!emp) return null;
                  return (
                    <tr key={r.employeeId} className={r.dirty ? "bg-primary/5" : ""}>
                      <td className="px-3 py-2">
                        <div className="font-medium capitalize">{emp.full_name}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">
                          {emp.employee_id} · {emp.department}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          value={r.status}
                          onValueChange={(v) =>
                            updateRow(r.employeeId, { status: v as AttendanceStatus })
                          }
                        >
                          <SelectTrigger className="min-h-11 w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUSES.map((s) => (
                              <SelectItem key={s} value={s}>
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="time"
                          value={r.checkIn}
                          onChange={(e) => updateRow(r.employeeId, { checkIn: e.target.value })}
                          className="w-28"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="time"
                          value={r.checkOut}
                          onChange={(e) => updateRow(r.employeeId, { checkOut: e.target.value })}
                          className="w-28"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={r.notes}
                          onChange={(e) => updateRow(r.employeeId, { notes: e.target.value })}
                          placeholder="Optional"
                          maxLength={200}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Recent attendance</h2>
          <span className="text-xs text-muted-foreground">Last 100 records</span>
        </div>
        <DataTable
          rows={recent}
          columns={recentColumns}
          rowKey={(r) => r.id}
          loading={loadingRecent}
          searchKeys={["status"]}
          emptyTitle="No attendance recorded yet"
          emptyDescription="Mark today's attendance above to build up history."
        />
      </Card>
    </div>
  );
}
