import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { UserPlus, Eye, Pencil, Receipt, DoorOpen, Trash2, Download } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileEmployeesList } from "@/components/hr/MobileEmployeesList";
import { MobileEmployeeForm } from "@/components/hr/MobileEmployeeForm";

import { downloadCsv, toCsv } from "@/lib/csv";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmployeeBulkImportDialog } from "./EmployeeBulkImport";
import { EmployeeAvatar, EmployeePhotoPicker } from "./EmployeePhoto";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Link } from "@/lib/router-compat";
import { useAuth } from "@/lib/auth";
import { withCompany } from "@/lib/companyScope";

// ---- Domain constants ---------------------------------------------------
// Values here must match the CHECK constraints on `public.hr_employees`.
const DEPARTMENTS = [
  "Management",
  "Sales",
  "Accounts",
  "Admin",
  "Security",
  "Housekeeping",
  "Site Staff",
  "Project Engineer",
  "Site Engineer",
  "Other",
] as const;
type Department = (typeof DEPARTMENTS)[number];

const STATUSES = ["Active", "On Leave", "Resigned", "Terminated"] as const;
type EmployeeStatus = (typeof STATUSES)[number];

const STATUS_TONE: Record<EmployeeStatus, "success" | "warning" | "muted" | "danger"> = {
  Active: "success",
  "On Leave": "warning",
  Resigned: "muted",
  Terminated: "danger",
};

type Employee = {
  id: string;
  employee_id: string;
  full_name: string;
  father_name: string | null;
  cnic: string | null;
  mobile: string | null;
  address: string | null;
  designation: string | null;
  department: Department;
  join_date: string | null;
  basic_salary: number | null;
  allowances: number | null;
  total_salary: number | null;
  bank_account: string | null;
  bank_name: string | null;
  emergency_contact: string | null;
  emergency_mobile: string | null;
  status: EmployeeStatus;
  photo_path: string | null;
};

// ---- Form schema --------------------------------------------------------
// Zod is the single source of validation truth for both Add and Edit. All
// text fields stay as strings in state so users can freely edit numeric
// inputs; coercion + trim happens inside the schema on submit.
const optionalStr = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length ? v : null));

const moneyStr = z
  .string()
  .trim()
  .transform((v) => v.replace(/[, ]+/g, ""))
  .refine((v) => v === "" || /^\d+(\.\d{1,2})?$/.test(v), "Enter a valid amount")
  .transform((v) => (v === "" ? 0 : Number(v)))
  .refine((n) => n >= 0 && n <= 9_999_999_999.99, "Amount out of range");

const cnicSchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length ? v : null))
  .refine((v) => v === null || /^\d{5}-\d{7}-\d$/.test(v), "CNIC must look like 35202-1234567-1");

const mobileSchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length ? v : null))
  .refine((v) => v === null || /^[0-9+\-\s()]{7,20}$/.test(v), "Enter a valid phone number");

const employeeSchema = z.object({
  full_name: z.string().trim().min(1, "Full Name is required").max(120),
  father_name: optionalStr(120),
  cnic: cnicSchema,
  mobile: mobileSchema,
  address: optionalStr(500),
  designation: optionalStr(120),
  department: z.enum(DEPARTMENTS),
  join_date: z
    .string()
    .optional()
    .transform((v) => (v && v.length ? v : null))
    .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Invalid date"),
  basic_salary: moneyStr,
  allowances: moneyStr,
  bank_account: optionalStr(60),
  bank_name: optionalStr(120),
  emergency_contact: optionalStr(120),
  emergency_mobile: mobileSchema,
  status: z.enum(STATUSES),
  photo_path: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v && v.length ? v : null)),
});

type FormState = {
  full_name: string;
  father_name: string;
  cnic: string;
  mobile: string;
  address: string;
  designation: string;
  department: Department;
  join_date: string;
  basic_salary: string;
  allowances: string;
  bank_account: string;
  bank_name: string;
  emergency_contact: string;
  emergency_mobile: string;
  status: EmployeeStatus;
  photo_path: string | null;
};

const EMPTY_FORM: FormState = {
  full_name: "",
  father_name: "",
  cnic: "",
  mobile: "",
  address: "",
  designation: "",
  department: "Management",
  join_date: "",
  basic_salary: "0",
  allowances: "0",
  bank_account: "",
  bank_name: "",
  emergency_contact: "",
  emergency_mobile: "",
  status: "Active",
  photo_path: null,
};

function rowToForm(r: Employee): FormState {
  return {
    full_name: r.full_name ?? "",
    father_name: r.father_name ?? "",
    cnic: r.cnic ?? "",
    mobile: r.mobile ?? "",
    address: r.address ?? "",
    designation: r.designation ?? "",
    department: r.department,
    join_date: r.join_date ?? "",
    basic_salary: String(r.basic_salary ?? 0),
    allowances: String(r.allowances ?? 0),
    bank_account: r.bank_account ?? "",
    bank_name: r.bank_name ?? "",
    emergency_contact: r.emergency_contact ?? "",
    emergency_mobile: r.emergency_mobile ?? "",
    status: r.status,
    photo_path: r.photo_path ?? null,
  };
}

function toNum(s: string): number {
  const n = Number(String(s).replace(/[, ]+/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

const PAGE_SIZE = 10;

// Maps DataTable column keys to hr_employees column names for ORDER BY.
const SORT_COLUMN: Record<string, string> = {
  eid: "employee_id",
  name: "full_name",
  desg: "designation",
  dept: "department",
  join: "join_date",
  basic: "basic_salary",
  status: "status",
};

type ServerSort = { key: string; dir: "asc" | "desc" } | null;

// Escape %, _, and , so they can't slip into a PostgREST `.or()` filter.
function escapeIlike(v: string): string {
  return v.replace(/[\\%_,()]/g, "\\$&");
}

export default function Employees() {
  const qc = useQueryClient();
  const { companyId } = useAuth();
  const isMobile = useIsMobile();
  const [addOpen, setAddOpen] = useState(false);
  const [viewing, setViewing] = useState<Employee | null>(null);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [deleting, setDeleting] = useState<Employee | null>(null);
  const [deptFilter, setDeptFilter] = useState<"all" | Department>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | EmployeeStatus>("all");

  // Server-mode DataTable state — parent owns these because the query below
  // needs them to build `.range()`, `.order()`, and `.or()` filters.
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<ServerSort>({ key: "eid", dir: "asc" });

  // 200ms debounce keeps typing snappy without firing a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 200);
    return () => clearTimeout(t);
  }, [search]);

  // Any filter/search/sort change resets to page 1 — otherwise a shrinking
  // result set can leave the pager stranded on an empty page.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, deptFilter, statusFilter, sort]);

  const pageQuery = useQuery({
    queryKey: ["hr-employees", "page", { debouncedSearch, deptFilter, statusFilter, sort, page }],
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let q = supabase
        .from("hr_employees" as any)
        .select("*", { count: "exact" })
        .range(from, to);

      if (deptFilter !== "all") q = q.eq("department", deptFilter);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (debouncedSearch) {
        const s = `%${escapeIlike(debouncedSearch)}%`;
        q = q.or(
          [
            `employee_id.ilike.${s}`,
            `full_name.ilike.${s}`,
            `designation.ilike.${s}`,
            `department.ilike.${s}`,
            `mobile.ilike.${s}`,
            `cnic.ilike.${s}`,
            `father_name.ilike.${s}`,
          ].join(","),
        );
      }
      const sortCol = sort ? SORT_COLUMN[sort.key] : "employee_id";
      const ascending = sort ? sort.dir === "asc" : true;
      q = q.order(sortCol ?? "employee_id", { ascending, nullsFirst: false });

      const { data, error, count } = await q;
      if (error) throw error;
      return {
        rows: (data ?? []) as unknown as Employee[],
        total: count ?? 0,
      };
    },
    placeholderData: (prev) => prev, // keep last page visible while refetching
  });

  const rows = pageQuery.data?.rows ?? [];
  const totalCount = pageQuery.data?.total ?? 0;

  // Two lightweight counters for the header — a full count and an
  // active-only count — computed with HEAD requests so they scale with
  // the table.
  const summaryQuery = useQuery({
    queryKey: ["hr-employees", "summary"],
    queryFn: async () => {
      const [all, active] = await Promise.all([
        supabase.from("hr_employees" as any).select("*", { count: "exact", head: true }),
        supabase
          .from("hr_employees" as any)
          .select("*", { count: "exact", head: true })
          .eq("status", "Active"),
      ]);
      if (all.error) throw all.error;
      if (active.error) throw active.error;
      return { total: all.count ?? 0, active: active.count ?? 0 };
    },
  });

  // "Current page" export uses the rows already in the browser; "all
  // filtered rows" runs a separate unpaginated fetch honouring the same
  // filters so we never hand the user a stale export.
  const exportCsv = async (scope: "all" | "page") => {
    let rowsOut: Employee[];
    if (scope === "page") {
      rowsOut = rows;
    } else {
      let q = supabase.from("hr_employees" as any).select("*");
      if (deptFilter !== "all") q = q.eq("department", deptFilter);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (debouncedSearch) {
        const s = `%${escapeIlike(debouncedSearch)}%`;
        q = q.or(
          [
            `employee_id.ilike.${s}`,
            `full_name.ilike.${s}`,
            `designation.ilike.${s}`,
            `department.ilike.${s}`,
            `mobile.ilike.${s}`,
            `cnic.ilike.${s}`,
            `father_name.ilike.${s}`,
          ].join(","),
        );
      }
      const sortCol = sort ? SORT_COLUMN[sort.key] : "employee_id";
      const ascending = sort ? sort.dir === "asc" : true;
      q = q.order(sortCol ?? "employee_id", { ascending, nullsFirst: false });
      const { data, error } = await q;
      if (error) {
        toast.error(error.message);
        return;
      }
      rowsOut = (data ?? []) as unknown as Employee[];
    }
    if (rowsOut.length === 0) {
      toast.info("Nothing to export in the current view");
      return;
    }
    const csv = toCsv(rowsOut, [
      { header: "Employee ID", value: (r) => r.employee_id },
      { header: "Full Name", value: (r) => r.full_name },
      { header: "Father Name", value: (r) => r.father_name ?? "" },
      { header: "CNIC", value: (r) => r.cnic ?? "" },
      { header: "Mobile", value: (r) => r.mobile ?? "" },
      { header: "Designation", value: (r) => r.designation ?? "" },
      { header: "Department", value: (r) => r.department },
      { header: "Join Date", value: (r) => r.join_date ?? "" },
      { header: "Basic Salary (PKR)", value: (r) => Number(r.basic_salary ?? 0) },
      { header: "Allowances (PKR)", value: (r) => Number(r.allowances ?? 0) },
      { header: "Total Salary (PKR)", value: (r) => Number(r.total_salary ?? 0) },
      { header: "Bank Name", value: (r) => r.bank_name ?? "" },
      { header: "Bank Account", value: (r) => r.bank_account ?? "" },
      { header: "Status", value: (r) => r.status },
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`employees-${scope}-${stamp}.csv`, csv);
    toast.success(`Exported ${rowsOut.length} employee${rowsOut.length === 1 ? "" : "s"}`);
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: ["hr-employees"] });

  const addMutation = useMutation({
    mutationFn: async (payload: z.infer<typeof employeeSchema>) => {
      // Trigger `hr_employees_assign_id` fills `employee_id` — omit it here.
      const { error } = await supabase.from("hr_employees" as any).insert(
        withCompany(
          {
            ...payload,
            total_salary: payload.basic_salary + payload.allowances,
          },
          companyId!,
        ),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Employee added");
      invalidate();
      setAddOpen(false);
    },
    onError: (err: any) => toast.error(err?.message ?? "Could not add employee"),
  });

  const editMutation = useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: z.infer<typeof employeeSchema>;
    }) => {
      const { error } = await supabase
        .from("hr_employees" as any)
        .update({ ...payload, total_salary: payload.basic_salary + payload.allowances })
        .eq("id", id)
        .eq("company_id", companyId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Employee updated");
      invalidate();
      setEditing(null);
    },
    onError: (err: any) => toast.error(err?.message ?? "Could not update employee"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("hr_employees" as any)
        .delete()
        .eq("id", id)
        .eq("company_id", companyId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Employee deleted");
      invalidate();
      setDeleting(null);
    },
    onError: (err: any) => toast.error(err?.message ?? "Could not delete employee"),
  });

  const columns: Column<Employee>[] = [
    {
      key: "eid",
      header: "Employee ID",
      cell: (r) => <span className="font-mono text-xs text-primary">{r.employee_id}</span>,
      sortValue: (r) => r.employee_id ?? "",
    },
    {
      key: "name",
      header: "Full Name",
      cell: (r) => (
        <div className="flex items-center gap-2 min-w-0">
          <EmployeeAvatar photoPath={r.photo_path} name={r.full_name} size={28} />
          <span className="font-medium capitalize truncate">{r.full_name}</span>
        </div>
      ),
      sortValue: (r) => r.full_name?.toLowerCase() ?? "",
    },
    {
      key: "desg",
      header: "Designation",
      cell: (r) => r.designation ?? "—",
      sortValue: (r) => r.designation?.toLowerCase() ?? "",
    },
    {
      key: "dept",
      header: "Department",
      cell: (r) => r.department,
      sortValue: (r) => r.department,
    },
    {
      key: "join",
      header: "Join Date",
      cell: (r) => fmtDate(r.join_date),
      sortValue: (r) => r.join_date ?? "",
    },
    {
      key: "basic",
      header: "Basic Salary (PKR)",
      align: "right",
      cell: (r) => <span className="tabular-nums">{fmtPKR(r.basic_salary)}</span>,
      sortValue: (r) => Number(r.basic_salary ?? 0),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge label={r.status} tone={STATUS_TONE[r.status] ?? "muted"} />,
      sortValue: (r) => r.status,
    },
    {
      key: "act",
      header: "Actions",
      cell: (r) => (
        <div className="flex items-center gap-1 flex-wrap">
          <RowActionLink
            label="View"
            icon={<Eye className="h-3.5 w-3.5" />}
            to={`/hr/employees/${r.id}`}
          />
          <RowAction
            label="Edit"
            icon={<Pencil className="h-3.5 w-3.5" />}
            onClick={() => setEditing(r)}
          />
          <RowActionLink
            label="Payslip"
            icon={<Receipt className="h-3.5 w-3.5" />}
            to="/hr/payroll"
          />
          <RowActionLink
            label="Final Settlement"
            icon={<DoorOpen className="h-3.5 w-3.5" />}
            to="/hr/final-settlement"
          />
          <RowAction
            label="Delete"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={() => setDeleting(r)}
            tone="danger"
          />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Employees"
        description={`${summaryQuery.data?.total ?? totalCount} total · ${summaryQuery.data?.active ?? 0} active`}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="min-h-11 min-w-11">
                  <Download className="h-4 w-4 mr-2" aria-hidden="true" />
                  Export CSV
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => exportCsv("all")}>
                  Filtered rows (all pages)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportCsv("page")}>
                  Current page only
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <EmployeeBulkImportDialog />

            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button className="min-h-11 min-w-11">
                  <UserPlus className="h-4 w-4 mr-2" aria-hidden="true" />
                  Add Employee
                </Button>
              </DialogTrigger>
              {isMobile ? (
                <DialogContent className="max-w-full h-[100dvh] sm:h-auto p-0 gap-0 sm:max-w-lg">
                  <DialogHeader className="px-4 pt-4">
                    <DialogTitle>Add Employee</DialogTitle>
                    <DialogDescription className="text-xs">
                      Employee ID is generated automatically.
                    </DialogDescription>
                  </DialogHeader>
                  <MobileEmployeeForm
                    mode="add"
                    initial={EMPTY_FORM as any}
                    submitting={addMutation.isPending}
                    onSubmit={(payload) => addMutation.mutate(payload)}
                  />
                </DialogContent>
              ) : (
                <EmployeeFormDialog
                  mode="add"
                  initial={EMPTY_FORM}
                  submitting={addMutation.isPending}
                  onSubmit={(payload) => addMutation.mutate(payload)}
                />
              )}
            </Dialog>
          </div>
        }
      />

      <MobileEmployeesList
        employees={rows}
        loading={pageQuery.isLoading}
        onView={(e) => setViewing(e)}
        onEdit={(e) => setEditing(e)}
      />

      <Card className="p-0 overflow-hidden hidden md:block">
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          loading={pageQuery.isLoading}
          sortable
          pageSize={PAGE_SIZE}
          searchPlaceholder="Search by name, employee ID, department, mobile, CNIC, or father's name…"
          serverMode={{
            totalCount,
            page,
            onPageChange: setPage,
            search,
            onSearchChange: setSearch,
            sort,
            onSortChange: setSort,
          }}
          toolbar={
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={deptFilter} onValueChange={(v) => setDeptFilter(v as any)}>
                <SelectTrigger className="h-9 min-h-11 w-[170px]" aria-label="Filter by department">
                  <SelectValue placeholder="Department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {DEPARTMENTS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                <SelectTrigger className="h-9 min-h-11 w-[140px]" aria-label="Filter by status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(deptFilter !== "all" || statusFilter !== "all") && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 min-h-11 min-w-11 text-xs"
                  onClick={() => {
                    setDeptFilter("all");
                    setStatusFilter("all");
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
          }
          emptyTitle={
            search || deptFilter !== "all" || statusFilter !== "all"
              ? "No employees match"
              : "No employees yet"
          }
          emptyDescription={
            search || deptFilter !== "all" || statusFilter !== "all"
              ? "Adjust your search or filters to see more results."
              : "Add your first employee to start tracking payroll, attendance, and settlements."
          }
          emptyAction={
            <Button className="min-h-11 min-w-11" onClick={() => setAddOpen(true)}>
              <UserPlus className="h-4 w-4 mr-2" aria-hidden="true" />
              Add Employee
            </Button>
          }
        />
      </Card>

      {viewing && (
        <EmployeeDetail
          employee={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(viewing);
            setViewing(null);
          }}
        />
      )}

      {editing && (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        >
          {isMobile ? (
            <DialogContent className="max-w-full h-[100dvh] sm:h-auto p-0 gap-0 sm:max-w-lg">
              <DialogHeader className="px-4 pt-4">
                <DialogTitle>Edit Employee</DialogTitle>
                <DialogDescription className="text-xs font-mono">
                  · {editing.employee_id}
                </DialogDescription>
              </DialogHeader>
              <MobileEmployeeForm
                mode="edit"
                initial={rowToForm(editing) as any}
                employeeId={editing.employee_id}
                submitting={editMutation.isPending}
                onSubmit={(payload) => editMutation.mutate({ id: editing.id, payload })}
              />
            </DialogContent>
          ) : (
            <EmployeeFormDialog
              mode="edit"
              initial={rowToForm(editing)}
              employeeId={editing.employee_id}
              submitting={editMutation.isPending}
              onSubmit={(payload) => editMutation.mutate({ id: editing.id, payload })}
            />
          )}
        </Dialog>
      )}

      <AlertDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete employee?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes <span className="font-medium">{deleting?.full_name}</span> (
              <span className="font-mono">{deleting?.employee_id}</span>) from the HR register.
              Attendance and payroll history stay intact but will no longer link to a live employee
              record.
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
// Row-action helpers
// -------------------------------------------------------------------------

function RowAction({
  label,
  icon,
  onClick,
  tone,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  tone?: "danger";
}) {
  return (
    <Button
      type="button"
      variant={tone === "danger" ? "outline" : "outline"}
      size="sm"
      className={
        "h-8 min-h-11 min-w-11 text-xs " +
        (tone === "danger" ? "text-destructive hover:text-destructive" : "")
      }
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {icon}
      <span className="ml-1 hidden sm:inline">{label}</span>
    </Button>
  );
}

function RowActionLink({ label, icon, to }: { label: string; icon: ReactNode; to: string }) {
  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      className="h-8 min-h-11 min-w-11 text-xs"
      aria-label={label}
      title={label}
    >
      <Link to={to}>
        {icon}
        <span className="ml-1 hidden sm:inline">{label}</span>
      </Link>
    </Button>
  );
}

// -------------------------------------------------------------------------
// Add/Edit Employee dialog — one controlled form for both flows. Total
// Salary is a read-only derived field so it can't drift from basic +
// allowances. All validation runs through `employeeSchema` on submit.
// -------------------------------------------------------------------------

function EmployeeFormDialog({
  mode,
  initial,
  employeeId,
  submitting,
  onSubmit,
}: {
  mode: "add" | "edit";
  initial: FormState;
  employeeId?: string;
  submitting: boolean;
  onSubmit: (payload: z.infer<typeof employeeSchema>) => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  // Reset when opened on a different record.
  useEffect(() => {
    setForm(initial);
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  const totalSalary = toNum(form.basic_salary) + toNum(form.allowances);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = employeeSchema.safeParse(form);
    if (!parsed.success) {
      const next: Partial<Record<keyof FormState, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FormState | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      toast.error(parsed.error.issues[0]?.message ?? "Please fix the highlighted fields");
      return;
    }
    onSubmit(parsed.data);
  }

  return (
    <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>
          {mode === "add" ? "Add Employee" : `Edit Employee`}
          {mode === "edit" && employeeId && (
            <span className="ml-2 font-mono text-xs text-muted-foreground">· {employeeId}</span>
          )}
        </DialogTitle>
        <DialogDescription>
          {mode === "add"
            ? "Employee ID is generated automatically (e.g. EMP-001)."
            : "Update the employee's profile. Employee ID cannot be changed."}{" "}
          Fields marked <span className="text-destructive">*</span> are required.
        </DialogDescription>
      </DialogHeader>

      <form className="grid grid-cols-1 sm:grid-cols-2 gap-3" onSubmit={handleSubmit} noValidate>
        <Field label="Photo" span={2}>
          <EmployeePhotoPicker
            value={form.photo_path}
            onChange={(path) => set("photo_path", path)}
            name={form.full_name}
          />
        </Field>
        <Field label="Full Name" required error={errors.full_name}>
          <Input
            aria-invalid={!!errors.full_name}
            value={form.full_name}
            onChange={(e) => set("full_name", e.target.value)}
            maxLength={120}
          />
        </Field>
        <Field label="Father Name" error={errors.father_name}>
          <Input
            aria-invalid={!!errors.father_name}
            value={form.father_name}
            onChange={(e) => set("father_name", e.target.value)}
            maxLength={120}
          />
        </Field>
        <Field label="CNIC" error={errors.cnic}>
          <Input
            aria-invalid={!!errors.cnic}
            value={form.cnic}
            onChange={(e) => set("cnic", e.target.value)}
            placeholder="35202-1234567-1"
            maxLength={15}
          />
        </Field>
        <Field label="Mobile" error={errors.mobile}>
          <Input
            aria-invalid={!!errors.mobile}
            value={form.mobile}
            onChange={(e) => set("mobile", e.target.value)}
            placeholder="0301-1234567"
            maxLength={20}
          />
        </Field>
        <Field label="Address" span={2} error={errors.address}>
          <Textarea
            aria-invalid={!!errors.address}
            rows={2}
            value={form.address}
            onChange={(e) => set("address", e.target.value)}
            maxLength={500}
          />
        </Field>
        <Field label="Designation" error={errors.designation}>
          <Input
            aria-invalid={!!errors.designation}
            value={form.designation}
            onChange={(e) => set("designation", e.target.value)}
            maxLength={120}
          />
        </Field>
        <Field label="Department" error={errors.department}>
          <Select value={form.department} onValueChange={(v) => set("department", v as Department)}>
            <SelectTrigger aria-invalid={!!errors.department} className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEPARTMENTS.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Join Date" error={errors.join_date}>
          <Input
            aria-invalid={!!errors.join_date}
            type="date"
            value={form.join_date}
            onChange={(e) => set("join_date", e.target.value)}
          />
        </Field>
        <Field label="Basic Salary (PKR)" error={errors.basic_salary}>
          <Input
            aria-invalid={!!errors.basic_salary}
            inputMode="decimal"
            value={form.basic_salary}
            onChange={(e) => set("basic_salary", e.target.value)}
          />
        </Field>
        <Field label="Allowances (PKR)" error={errors.allowances}>
          <Input
            aria-invalid={!!errors.allowances}
            inputMode="decimal"
            value={form.allowances}
            onChange={(e) => set("allowances", e.target.value)}
          />
        </Field>
        <Field label="Total Salary (PKR)">
          <Input
            readOnly
            value={fmtPKR(totalSalary)}
            aria-live="polite"
            className="bg-muted/40 font-medium tabular-nums"
          />
        </Field>
        <Field label="Status" error={errors.status}>
          <Select value={form.status} onValueChange={(v) => set("status", v as EmployeeStatus)}>
            <SelectTrigger aria-invalid={!!errors.status} className="min-h-11">
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
        </Field>
        <Field label="Bank Account" error={errors.bank_account}>
          <Input
            aria-invalid={!!errors.bank_account}
            value={form.bank_account}
            onChange={(e) => set("bank_account", e.target.value)}
            maxLength={60}
          />
        </Field>
        <Field label="Bank Name" error={errors.bank_name}>
          <Input
            aria-invalid={!!errors.bank_name}
            value={form.bank_name}
            onChange={(e) => set("bank_name", e.target.value)}
            maxLength={120}
          />
        </Field>
        <Field label="Emergency Contact" error={errors.emergency_contact}>
          <Input
            aria-invalid={!!errors.emergency_contact}
            value={form.emergency_contact}
            onChange={(e) => set("emergency_contact", e.target.value)}
            maxLength={120}
          />
        </Field>
        <Field label="Emergency Mobile" error={errors.emergency_mobile}>
          <Input
            aria-invalid={!!errors.emergency_mobile}
            value={form.emergency_mobile}
            onChange={(e) => set("emergency_mobile", e.target.value)}
            maxLength={20}
          />
        </Field>

        <DialogFooter className="sm:col-span-2 mt-2">
          <Button type="submit" className="min-h-11 min-w-11" disabled={submitting}>
            {submitting ? "Saving…" : mode === "add" ? "Save Employee" : "Save Changes"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function Field({
  label,
  required,
  span = 1,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  span?: 1 | 2;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className={span === 2 ? "sm:col-span-2 space-y-1.5" : "space-y-1.5"}>
      <Label className="text-xs font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

// -------------------------------------------------------------------------
// Detail dialog (View action)
// -------------------------------------------------------------------------

function EmployeeDetail({
  employee,
  onClose,
  onEdit,
}: {
  employee: Employee;
  onClose: () => void;
  onEdit: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {employee.full_name}{" "}
            <span className="font-mono text-xs text-muted-foreground">
              · {employee.employee_id}
            </span>
          </DialogTitle>
          <DialogDescription>
            {employee.designation ?? "—"} · {employee.department}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center pb-2">
          <EmployeeAvatar photoPath={employee.photo_path} name={employee.full_name} size={96} />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <DetailRow label="Status">
            <StatusBadge label={employee.status} tone={STATUS_TONE[employee.status] ?? "muted"} />
          </DetailRow>
          <DetailRow label="Join Date">{fmtDate(employee.join_date)}</DetailRow>
          <DetailRow label="CNIC">{employee.cnic ?? "—"}</DetailRow>
          <DetailRow label="Mobile">{employee.mobile ?? "—"}</DetailRow>
          <DetailRow label="Basic Salary">{fmtPKR(employee.basic_salary)}</DetailRow>
          <DetailRow label="Allowances">{fmtPKR(employee.allowances)}</DetailRow>
          <DetailRow label="Total Salary">{fmtPKR(employee.total_salary)}</DetailRow>
          <DetailRow label="Bank">{employee.bank_name ?? "—"}</DetailRow>
          <DetailRow label="Account #">{employee.bank_account ?? "—"}</DetailRow>
          <DetailRow label="Emergency">{employee.emergency_contact ?? "—"}</DetailRow>
          <DetailRow label="Emergency #">{employee.emergency_mobile ?? "—"}</DetailRow>
          <DetailRow label="Address" span={2}>
            {employee.address ?? "—"}
          </DetailRow>
        </dl>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="min-h-11 min-w-11">
            Close
          </Button>
          <Button onClick={onEdit} className="min-h-11 min-w-11">
            <Pencil className="h-4 w-4 mr-2" aria-hidden="true" />
            Edit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({
  label,
  span = 1,
  children,
}: {
  label: string;
  span?: 1 | 2;
  children: ReactNode;
}) {
  return (
    <div className={span === 2 ? "col-span-2" : ""}>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
