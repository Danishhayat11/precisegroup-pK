import { MoreVertical, Pencil, Receipt, DoorOpen, Eye } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link } from "@/lib/router-compat";
import { fmtPKR } from "@/lib/format";
import { cn } from "@/lib/utils";

// Mobile employees card list. Renders under `md`, replacing the DataTable.
// Kept presentation-only: parent still owns queries, mutations, and dialogs.

type Employee = {
  id: string;
  employee_id: string;
  full_name: string;
  designation: string | null;
  department: string;
  basic_salary: number | null;
  allowances: number | null;
  total_salary: number | null;
  status: string;
  photo_path: string | null;
};

const STATUS_TONE: Record<string, "success" | "warning" | "muted" | "danger"> = {
  Active: "success",
  "On Leave": "warning",
  Resigned: "muted",
  Terminated: "danger",
};

// Stable colored initials — hash the department string into a token palette.
// Tokens (not raw hex) keeps this compatible with the iOS theme layer.
const DEPT_TONES = [
  "bg-primary/15 text-primary",
  "bg-success/15 text-success",
  "bg-warning/15 text-warning",
  "bg-accent/15 text-accent-foreground",
  "bg-destructive/15 text-destructive",
  "bg-secondary text-secondary-foreground",
] as const;

function deptTone(dept: string): string {
  let h = 0;
  for (let i = 0; i < dept.length; i++) h = (h * 31 + dept.charCodeAt(i)) | 0;
  return DEPT_TONES[Math.abs(h) % DEPT_TONES.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function MobileEmployeesList<E extends Employee>({
  employees,
  loading,
  onView,
  onEdit,
}: {
  employees: E[];
  loading?: boolean;
  onView: (e: E) => void;
  onEdit: (e: E) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2 md:hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-3 animate-pulse">
            <div className="flex gap-3">
              <div className="h-12 w-12 rounded-full bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-1/2 rounded bg-muted" />
                <div className="h-3 w-1/3 rounded bg-muted" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (employees.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground md:hidden">
        No employees to show.
      </Card>
    );
  }

  return (
    <div className="space-y-2 md:hidden">
      {employees.map((e) => {
        const tone = deptTone(e.department);
        const salary = Number(
          e.total_salary ?? Number(e.basic_salary ?? 0) + Number(e.allowances ?? 0),
        );
        return (
          <Card key={e.id} className="p-3">
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "h-12 w-12 shrink-0 rounded-full grid place-items-center text-sm font-semibold",
                  tone,
                )}
                aria-hidden="true"
              >
                {initials(e.full_name)}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold capitalize truncate">{e.full_name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {e.designation ?? "—"}
                    </div>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="min-h-11 min-w-11 -mr-2 -mt-1 shrink-0"
                        aria-label={`Actions for ${e.full_name}`}
                      >
                        <MoreVertical className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onView(e)}>
                        <Eye className="h-4 w-4 mr-2" aria-hidden="true" /> View
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onEdit(e)}>
                        <Pencil className="h-4 w-4 mr-2" aria-hidden="true" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/hr/payroll">
                          <Receipt className="h-4 w-4 mr-2" aria-hidden="true" /> Payslip
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/hr/final-settlement">
                          <DoorOpen className="h-4 w-4 mr-2" aria-hidden="true" /> Settlement
                        </Link>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                      tone,
                    )}
                  >
                    {e.department}
                  </span>
                  <StatusBadge label={e.status} tone={STATUS_TONE[e.status] ?? "muted"} />
                </div>

                <div className="mt-2 text-xs text-muted-foreground">
                  Salary:{" "}
                  <span className="text-foreground font-medium tabular-nums">{fmtPKR(salary)}</span>
                  /month
                </div>

                <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {e.employee_id}
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
