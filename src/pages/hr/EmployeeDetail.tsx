import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, notFound } from "@tanstack/react-router";
import { ArrowLeft, Mail, Phone, MapPin, Building2, Calendar, Wallet } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router-compat";
import { fmtDate, fmtPKR } from "@/lib/format";
import { EmployeeAvatar } from "./EmployeePhoto";

const routeApi = getRouteApi("/_authenticated/hr/employees/$id");

type Employee = {
  id: string;
  employee_id: string;
  full_name: string;
  father_name: string | null;
  cnic: string | null;
  mobile: string | null;
  address: string | null;
  designation: string | null;
  department: string;
  join_date: string | null;
  basic_salary: number | null;
  allowances: number | null;
  total_salary: number | null;
  bank_account: string | null;
  bank_name: string | null;
  emergency_contact: string | null;
  emergency_mobile: string | null;
  status: "Active" | "On Leave" | "Resigned" | "Terminated";
  photo_path: string | null;
};

type Attendance = {
  id: string;
  attendance_date: string;
  status: "Present" | "Absent" | "Leave" | "Half Day" | "Late";
  check_in: string | null;
  check_out: string | null;
  notes: string | null;
};

type Payslip = {
  id: string;
  run_id: string;
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
  created_at: string;
  hr_payroll_runs?: {
    period_month: string;
    status: "Draft" | "Finalized";
  } | null;
};

type Settlement = {
  id: string;
  settlement_date: string;
  last_working_date: string | null;
  reason: "Resigned" | "Terminated";
  years_of_service: number;
  gratuity: number;
  leave_encashment: number;
  unpaid_salary: number;
  bonus: number;
  other_additions: number;
  deductions: number;
  net_payable: number;
  status: "Draft" | "Finalized" | "Paid";
  notes: string | null;
};

const ATT_TONE: Record<Attendance["status"], "success" | "danger" | "warning" | "muted"> = {
  Present: "success",
  Absent: "danger",
  Leave: "warning",
  "Half Day": "warning",
  Late: "muted",
};

const STATUS_TONE: Record<Employee["status"], "success" | "warning" | "muted" | "danger"> = {
  Active: "success",
  "On Leave": "warning",
  Resigned: "muted",
  Terminated: "danger",
};

export default function EmployeeDetail() {
  const { id } = routeApi.useParams();

  const employeeQ = useQuery({
    queryKey: ["hr-employee", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_employees" as any)
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw notFound();
      return data as unknown as Employee;
    },
  });

  const attendanceQ = useQuery({
    queryKey: ["hr-attendance", "by-employee", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_attendance" as any)
        .select("*")
        .eq("employee_id", id)
        .order("attendance_date", { ascending: false })
        .limit(90);
      if (error) throw error;
      return (data ?? []) as unknown as Attendance[];
    },
  });

  const payslipsQ = useQuery({
    queryKey: ["hr-payslips", "by-employee", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_payslips" as any)
        .select("*, hr_payroll_runs:run_id (period_month, status)")
        .eq("employee_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Payslip[];
    },
  });

  const settlementsQ = useQuery({
    queryKey: ["hr-final-settlements", "by-employee", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hr_final_settlements" as any)
        .select("*")
        .eq("employee_id", id)
        .order("settlement_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Settlement[];
    },
  });

  const emp = employeeQ.data;

  const attendanceStats = useMemo(() => {
    const rows = attendanceQ.data ?? [];
    const acc = { Present: 0, Absent: 0, Leave: 0, "Half Day": 0, Late: 0 } as Record<
      Attendance["status"],
      number
    >;
    rows.forEach((r) => {
      acc[r.status] += 1;
    });
    return acc;
  }, [attendanceQ.data]);

  const totalEarned = useMemo(
    () => (payslipsQ.data ?? []).reduce((s, p) => s + Number(p.net_salary ?? 0), 0),
    [payslipsQ.data],
  );

  const attendanceCols: Column<Attendance>[] = [
    {
      key: "d",
      header: "Date",
      cell: (r) => fmtDate(r.attendance_date),
      sortValue: (r) => r.attendance_date,
    },
    {
      key: "s",
      header: "Status",
      cell: (r) => <StatusBadge label={r.status} tone={ATT_TONE[r.status]} />,
      sortValue: (r) => r.status,
    },
    { key: "in", header: "Check-in", cell: (r) => r.check_in ?? "—" },
    { key: "out", header: "Check-out", cell: (r) => r.check_out ?? "—" },
    { key: "n", header: "Notes", cell: (r) => r.notes ?? "—" },
  ];

  const payslipCols: Column<Payslip>[] = [
    {
      key: "p",
      header: "Period",
      cell: (r) => r.hr_payroll_runs?.period_month ?? "—",
      sortValue: (r) => r.hr_payroll_runs?.period_month ?? "",
    },
    {
      key: "rs",
      header: "Run",
      cell: (r) => (
        <StatusBadge
          label={r.hr_payroll_runs?.status ?? "—"}
          tone={r.hr_payroll_runs?.status === "Finalized" ? "success" : "muted"}
        />
      ),
    },
    {
      key: "wd",
      header: "Working",
      align: "right",
      cell: (r) => r.working_days,
      sortValue: (r) => r.working_days,
    },
    {
      key: "pd",
      header: "Present",
      align: "right",
      cell: (r) => r.present_days,
      sortValue: (r) => r.present_days,
    },
    {
      key: "ad",
      header: "Absent",
      align: "right",
      cell: (r) => r.absent_days,
      sortValue: (r) => r.absent_days,
    },
    {
      key: "gr",
      header: "Gross",
      align: "right",
      cell: (r) => <span className="tabular-nums">{fmtPKR(r.gross_salary)}</span>,
      sortValue: (r) => Number(r.gross_salary),
    },
    {
      key: "dd",
      header: "Deduction",
      align: "right",
      cell: (r) => <span className="tabular-nums">{fmtPKR(r.deduction)}</span>,
      sortValue: (r) => Number(r.deduction),
    },
    {
      key: "net",
      header: "Net",
      align: "right",
      cell: (r) => <span className="tabular-nums font-medium">{fmtPKR(r.net_salary)}</span>,
      sortValue: (r) => Number(r.net_salary),
    },
  ];

  const settlementCols: Column<Settlement>[] = [
    {
      key: "d",
      header: "Settlement Date",
      cell: (r) => fmtDate(r.settlement_date),
      sortValue: (r) => r.settlement_date,
    },
    { key: "lwd", header: "Last Working", cell: (r) => fmtDate(r.last_working_date) },
    { key: "r", header: "Reason", cell: (r) => r.reason },
    {
      key: "yos",
      header: "Years",
      align: "right",
      cell: (r) => <span className="tabular-nums">{Number(r.years_of_service).toFixed(2)}</span>,
      sortValue: (r) => Number(r.years_of_service),
    },
    {
      key: "g",
      header: "Gratuity",
      align: "right",
      cell: (r) => <span className="tabular-nums">{fmtPKR(r.gratuity)}</span>,
      sortValue: (r) => Number(r.gratuity),
    },
    {
      key: "net",
      header: "Net Payable",
      align: "right",
      cell: (r) => <span className="tabular-nums font-medium">{fmtPKR(r.net_payable)}</span>,
      sortValue: (r) => Number(r.net_payable),
    },
    {
      key: "s",
      header: "Status",
      cell: (r) => (
        <StatusBadge
          label={r.status}
          tone={r.status === "Paid" ? "success" : r.status === "Finalized" ? "warning" : "muted"}
        />
      ),
    },
  ];

  if (employeeQ.isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Loading…" description="Fetching employee profile." />
      </div>
    );
  }

  if (!emp) {
    return (
      <div className="space-y-4">
        <PageHeader title="Employee not found" description="This record no longer exists." />
        <Button asChild variant="outline" className="min-h-11">
          <Link to="/hr/employees">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Employees
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="min-h-11 min-w-11">
          <Link to="/hr/employees">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <EmployeeAvatar photoPath={emp.photo_path} name={emp.full_name} size={72} />
        <PageHeader
          title={emp.full_name}
          description={`${emp.employee_id} · ${emp.designation ?? "—"} · ${emp.department} · ${emp.status}`}
        />
      </div>

      {/* Profile grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-4 space-y-3">
          <h3 className="text-sm font-medium">Contact</h3>
          <InfoRow icon={<Phone className="h-4 w-4" />} label="Mobile" value={emp.mobile} />
          <InfoRow
            icon={<Mail className="h-4 w-4" />}
            label="Emergency"
            value={emp.emergency_contact}
            sub={emp.emergency_mobile}
          />
          <InfoRow icon={<MapPin className="h-4 w-4" />} label="Address" value={emp.address} />
          <InfoRow icon={<Building2 className="h-4 w-4" />} label="CNIC" value={emp.cnic} />
        </Card>

        <Card className="p-4 space-y-3">
          <h3 className="text-sm font-medium">Employment</h3>
          <InfoRow
            icon={<Calendar className="h-4 w-4" />}
            label="Join Date"
            value={fmtDate(emp.join_date)}
          />
          <InfoRow
            icon={<Building2 className="h-4 w-4" />}
            label="Department"
            value={emp.department}
          />
          <InfoRow
            icon={<Building2 className="h-4 w-4" />}
            label="Designation"
            value={emp.designation}
          />
          <InfoRow
            icon={<Building2 className="h-4 w-4" />}
            label="Father Name"
            value={emp.father_name}
          />
        </Card>

        <Card className="p-4 space-y-3">
          <h3 className="text-sm font-medium">Compensation</h3>
          <InfoRow
            icon={<Wallet className="h-4 w-4" />}
            label="Basic Salary"
            value={fmtPKR(emp.basic_salary)}
          />
          <InfoRow
            icon={<Wallet className="h-4 w-4" />}
            label="Allowances"
            value={fmtPKR(emp.allowances)}
          />
          <InfoRow
            icon={<Wallet className="h-4 w-4" />}
            label="Total Salary"
            value={fmtPKR(emp.total_salary)}
          />
          <InfoRow
            icon={<Wallet className="h-4 w-4" />}
            label="Bank"
            value={emp.bank_name}
            sub={emp.bank_account}
          />
        </Card>
      </div>

      {/* Attendance history */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold">Attendance history</h2>
          <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
            <span>
              Present: <b>{attendanceStats.Present}</b>
            </span>
            <span>
              Absent: <b>{attendanceStats.Absent}</b>
            </span>
            <span>
              Leave: <b>{attendanceStats.Leave}</b>
            </span>
            <span>
              Half Day: <b>{attendanceStats["Half Day"]}</b>
            </span>
            <span>
              Late: <b>{attendanceStats.Late}</b>
            </span>
          </div>
        </div>
        <DataTable
          rows={attendanceQ.data ?? []}
          columns={attendanceCols}
          rowKey={(r) => r.id}
          loading={attendanceQ.isLoading}
          sortable
          initialSort={{ key: "d", dir: "desc" }}
          pageSize={10}
          emptyTitle="No attendance yet"
          emptyDescription="Mark attendance for this employee from the Attendance page."
        />
      </section>

      {/* Payroll history */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold">Payroll history</h2>
          <div className="text-xs text-muted-foreground">
            Total earned: <b className="text-foreground">{fmtPKR(totalEarned)}</b>
          </div>
        </div>
        <DataTable
          rows={payslipsQ.data ?? []}
          columns={payslipCols}
          rowKey={(r) => r.id}
          loading={payslipsQ.isLoading}
          sortable
          initialSort={{ key: "p", dir: "desc" }}
          pageSize={10}
          emptyTitle="No payslips yet"
          emptyDescription="Generate a payroll run to create payslips for this employee."
        />
      </section>

      {/* Final settlement history */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Final settlement</h2>
        <DataTable
          rows={settlementsQ.data ?? []}
          columns={settlementCols}
          rowKey={(r) => r.id}
          loading={settlementsQ.isLoading}
          sortable
          initialSort={{ key: "d", dir: "desc" }}
          emptyTitle="No settlement recorded"
          emptyDescription="A settlement is generated when the employee is marked Resigned or Terminated."
        />
      </section>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="mt-0.5 text-muted-foreground shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="truncate">{value ?? "—"}</div>
        {sub ? <div className="text-xs text-muted-foreground truncate">{sub}</div> : null}
      </div>
    </div>
  );
}
