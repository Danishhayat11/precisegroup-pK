import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, X, Palmtree, CalendarDays } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { withCompany } from "@/lib/companyScope";
import { cn } from "@/lib/utils";

// Mobile attendance list: one row per active employee showing the month's
// P / A / L counts, with a bottom-sheet 4-button pad to mark today.
// Parent screen (Attendance.tsx) still owns date navigation and history.

type Employee = {
  id: string;
  employee_id: string;
  full_name: string;
  designation: string | null;
  department: string;
};

type AttendanceStatus = "Present" | "Absent" | "Leave" | "Holiday" | "Half Day" | "Late";

// "Holiday" is a UI-only shortcut; the DB CHECK constraint stores it as
// Leave with a note so we don't need a schema change. The other three map
// directly to their DB values.
const STATUS_TO_DB: Record<AttendanceStatus, { status: string; notes?: string }> = {
  Present: { status: "Present" },
  Absent: { status: "Absent" },
  Leave: { status: "Leave" },
  Holiday: { status: "Leave", notes: "Holiday" },
  "Half Day": { status: "Half Day" },
  Late: { status: "Late" },
};

function firstOfMonthISO(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function endOfMonthISO(date = new Date()): string {
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function MobileAttendanceList({
  employees,
  loading,
}: {
  employees: Employee[];
  loading?: boolean;
}) {
  const qc = useQueryClient();
  const { companyId } = useAuth();
  const [sheetEmp, setSheetEmp] = useState<Employee | null>(null);

  // Fetch this month's attendance so each row can show P/A/L totals.
  const monthStart = firstOfMonthISO();
  const monthEnd = endOfMonthISO();
  const { data: monthRows = [], isLoading: loadingMonth } = useQuery({
    queryKey: ["hr-attendance-month", monthStart, monthEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_attendance" as any)
        .select("employee_id, attendance_date, status")
        .gte("attendance_date", monthStart)
        .lte("attendance_date", monthEnd);
      if (error) throw error;
      return (data ?? []) as unknown as {
        employee_id: string;
        attendance_date: string;
        status: string;
      }[];
    },
  });

  const summaries = useMemo(() => {
    const map = new Map<
      string,
      { present: number; absent: number; leave: number; today: string | null }
    >();
    for (const e of employees) map.set(e.id, { present: 0, absent: 0, leave: 0, today: null });
    for (const r of monthRows) {
      const s = map.get(r.employee_id);
      if (!s) continue;
      if (r.status === "Present" || r.status === "Late") s.present += 1;
      else if (r.status === "Absent") s.absent += 1;
      else if (r.status === "Leave" || r.status === "Half Day") s.leave += 1;
      if (r.attendance_date === todayISO()) s.today = r.status;
    }
    return map;
  }, [employees, monthRows]);

  const markMutation = useMutation({
    mutationFn: async ({ empId, status }: { empId: string; status: AttendanceStatus }) => {
      const mapped = STATUS_TO_DB[status];
      const { error } = await supabase.from("hr_attendance" as any).upsert(
        withCompany(
          {
            employee_id: empId,
            attendance_date: todayISO(),
            status: mapped.status,
            notes: mapped.notes ?? null,
          },
          companyId!,
        ),
        { onConflict: "employee_id,attendance_date" },
      );
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      const label = vars.status;
      toast.success(`Marked ${label} for today`);
      qc.invalidateQueries({ queryKey: ["hr-attendance-month"] });
      qc.invalidateQueries({ queryKey: ["hr-attendance-day"] });
      qc.invalidateQueries({ queryKey: ["hr-attendance-recent"] });
      setSheetEmp(null);
    },
    onError: (err: any) => toast.error(err?.message ?? "Could not mark attendance"),
  });

  if (loading || loadingMonth) {
    return (
      <div className="space-y-2 md:hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-3 h-16 animate-pulse bg-muted/40" />
        ))}
      </div>
    );
  }

  if (employees.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground md:hidden">
        No active employees to mark.
      </Card>
    );
  }

  return (
    <div className="md:hidden">
      <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
        Marking today · {todayISO()}
      </div>

      <div className="space-y-2">
        {employees.map((e) => {
          const s = summaries.get(e.id) ?? { present: 0, absent: 0, leave: 0, today: null };
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => setSheetEmp(e)}
              className="w-full text-left"
              aria-label={`Mark attendance for ${e.full_name}`}
            >
              <Card className="p-3 min-h-16 flex items-center gap-3 active:bg-muted/50">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold capitalize truncate">{e.full_name}</div>
                  <div className="text-[11px] font-mono text-muted-foreground truncate">
                    {e.employee_id} · {e.department}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Chip label={`P:${s.present}`} tone="success" />
                  <Chip label={`A:${s.absent}`} tone="danger" />
                  <Chip label={`L:${s.leave}`} tone="warning" />
                </div>
                {s.today && (
                  <span className="shrink-0 ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    ✓
                  </span>
                )}
              </Card>
            </button>
          );
        })}
      </div>

      <Sheet
        open={!!sheetEmp}
        onOpenChange={(o) => {
          if (!o) setSheetEmp(null);
        }}
      >
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader>
            <SheetTitle className="text-left">
              {sheetEmp ? (
                <>
                  <span className="capitalize">{sheetEmp.full_name}</span>
                  <span className="block text-xs font-mono text-muted-foreground mt-0.5">
                    {sheetEmp.employee_id} · Today
                  </span>
                </>
              ) : (
                "Mark attendance"
              )}
            </SheetTitle>
          </SheetHeader>

          <div className="grid grid-cols-2 gap-3 mt-4 pb-2">
            <SheetAction
              label="Present"
              icon={<Check className="h-6 w-6" aria-hidden="true" />}
              tone="success"
              disabled={markMutation.isPending}
              onClick={() =>
                sheetEmp && markMutation.mutate({ empId: sheetEmp.id, status: "Present" })
              }
            />
            <SheetAction
              label="Absent"
              icon={<X className="h-6 w-6" aria-hidden="true" />}
              tone="danger"
              disabled={markMutation.isPending}
              onClick={() =>
                sheetEmp && markMutation.mutate({ empId: sheetEmp.id, status: "Absent" })
              }
            />
            <SheetAction
              label="Leave"
              icon={
                <span className="text-lg font-bold" aria-hidden="true">
                  L
                </span>
              }
              tone="warning"
              disabled={markMutation.isPending}
              onClick={() =>
                sheetEmp && markMutation.mutate({ empId: sheetEmp.id, status: "Leave" })
              }
            />
            <SheetAction
              label="Holiday"
              icon={<Palmtree className="h-6 w-6" aria-hidden="true" />}
              tone="muted"
              disabled={markMutation.isPending}
              onClick={() =>
                sheetEmp && markMutation.mutate({ empId: sheetEmp.id, status: "Holiday" })
              }
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Chip({ label, tone }: { label: string; tone: "success" | "danger" | "warning" }) {
  const cls =
    tone === "success"
      ? "bg-success/15 text-success"
      : tone === "danger"
        ? "bg-destructive/15 text-destructive"
        : "bg-warning/15 text-warning";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums",
        cls,
      )}
    >
      {label}
    </span>
  );
}

function SheetAction({
  label,
  icon,
  tone,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  tone: "success" | "danger" | "warning" | "muted";
  onClick: () => void;
  disabled?: boolean;
}) {
  const cls =
    tone === "success"
      ? "bg-success text-success-foreground hover:bg-success/90"
      : tone === "danger"
        ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
        : tone === "warning"
          ? "bg-warning text-warning-foreground hover:bg-warning/90"
          : "bg-muted text-foreground hover:bg-muted/80";
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-24 flex flex-col items-center justify-center gap-1.5 text-base font-semibold",
        cls,
      )}
    >
      {icon}
      {label}
    </Button>
  );
}
