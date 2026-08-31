import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, FileDown, AlertCircle, CheckCircle2, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { downloadCsv } from "@/lib/csv";
import { useAuth } from "@/lib/auth";
import { withCompany } from "@/lib/companyScope";

// Must match CHECK constraints on public.hr_employees.
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
const STATUSES = ["Active", "On Leave", "Resigned", "Terminated"] as const;

type Department = (typeof DEPARTMENTS)[number];
type EmployeeStatus = (typeof STATUSES)[number];

// Canonical CSV header order. Header matching is case-insensitive on import.
const HEADERS = [
  "Full Name",
  "Father Name",
  "CNIC",
  "Mobile",
  "Address",
  "Designation",
  "Department",
  "Join Date",
  "Basic Salary",
  "Allowances",
  "Bank Name",
  "Bank Account",
  "Emergency Contact",
  "Emergency Mobile",
  "Status",
] as const;

type ParsedRow = {
  rowNumber: number; // 1-based, excluding header
  raw: Record<string, string>;
  payload: {
    full_name: string;
    father_name: string | null;
    cnic: string | null;
    mobile: string | null;
    address: string | null;
    designation: string | null;
    department: Department;
    join_date: string | null;
    basic_salary: number;
    allowances: number;
    total_salary: number;
    bank_name: string | null;
    bank_account: string | null;
    emergency_contact: string | null;
    emergency_mobile: string | null;
    status: EmployeeStatus;
  } | null;
  errors: string[];
};

// RFC-4180-ish CSV parser: quoted fields, "" escapes, CRLF/LF.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      /* swallow, handled with \n */
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  // Trailing field / row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function normOptional(
  v: string | undefined,
  max: number,
): { value: string | null; error?: string } {
  const s = (v ?? "").trim();
  if (s === "") return { value: null };
  if (s.length > max) return { value: null, error: `exceeds ${max} chars` };
  return { value: s };
}

function parseMoney(v: string | undefined): { value: number; error?: string } {
  const s = (v ?? "").trim().replace(/[, ]+/g, "");
  if (s === "") return { value: 0 };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { value: 0, error: "invalid amount" };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 9_999_999_999.99)
    return { value: 0, error: "amount out of range" };
  return { value: n };
}

function validateRow(raw: Record<string, string>, rowNumber: number): ParsedRow {
  const errors: string[] = [];

  const full_name = (raw["Full Name"] ?? "").trim();
  if (!full_name) errors.push("Full Name is required");
  else if (full_name.length > 120) errors.push("Full Name exceeds 120 chars");

  const father = normOptional(raw["Father Name"], 120);
  if (father.error) errors.push(`Father Name ${father.error}`);
  const address = normOptional(raw["Address"], 500);
  if (address.error) errors.push(`Address ${address.error}`);
  const designation = normOptional(raw["Designation"], 120);
  if (designation.error) errors.push(`Designation ${designation.error}`);
  const bank_name = normOptional(raw["Bank Name"], 120);
  if (bank_name.error) errors.push(`Bank Name ${bank_name.error}`);
  const bank_account = normOptional(raw["Bank Account"], 60);
  if (bank_account.error) errors.push(`Bank Account ${bank_account.error}`);
  const emergency_contact = normOptional(raw["Emergency Contact"], 120);
  if (emergency_contact.error) errors.push(`Emergency Contact ${emergency_contact.error}`);

  const cnicRaw = (raw["CNIC"] ?? "").trim();
  let cnic: string | null = null;
  if (cnicRaw) {
    if (!/^\d{5}-\d{7}-\d$/.test(cnicRaw)) errors.push("CNIC must look like 35202-1234567-1");
    else cnic = cnicRaw;
  }

  const validatePhone = (label: string, v: string | undefined): string | null => {
    const s = (v ?? "").trim();
    if (!s) return null;
    if (!/^[0-9+\-\s()]{7,20}$/.test(s)) {
      errors.push(`${label} is not a valid phone`);
      return null;
    }
    return s;
  };
  const mobile = validatePhone("Mobile", raw["Mobile"]);
  const emergency_mobile = validatePhone("Emergency Mobile", raw["Emergency Mobile"]);

  const deptRaw = (raw["Department"] ?? "").trim();
  const department = (DEPARTMENTS as readonly string[]).includes(deptRaw)
    ? (deptRaw as Department)
    : (() => {
        errors.push(`Department must be one of: ${DEPARTMENTS.join(", ")}`);
        return "Management" as Department;
      })();

  const statusRaw = (raw["Status"] ?? "").trim() || "Active";
  const status = (STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as EmployeeStatus)
    : (() => {
        errors.push(`Status must be one of: ${STATUSES.join(", ")}`);
        return "Active" as EmployeeStatus;
      })();

  const joinRaw = (raw["Join Date"] ?? "").trim();
  let join_date: string | null = null;
  if (joinRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(joinRaw)) errors.push("Join Date must be YYYY-MM-DD");
    else join_date = joinRaw;
  }

  const basic = parseMoney(raw["Basic Salary"]);
  if (basic.error) errors.push(`Basic Salary ${basic.error}`);
  const allow = parseMoney(raw["Allowances"]);
  if (allow.error) errors.push(`Allowances ${allow.error}`);

  const payload =
    errors.length === 0
      ? {
          full_name,
          father_name: father.value,
          cnic,
          mobile,
          address: address.value,
          designation: designation.value,
          department,
          join_date,
          basic_salary: basic.value,
          allowances: allow.value,
          total_salary: basic.value + allow.value,
          bank_name: bank_name.value,
          bank_account: bank_account.value,
          emergency_contact: emergency_contact.value,
          emergency_mobile,
          status,
        }
      : null;

  return { rowNumber, raw, payload, errors };
}

const TEMPLATE_ROW: Record<string, string> = {
  "Full Name": "Ali Raza",
  "Father Name": "Muhammad Raza",
  CNIC: "35202-1234567-1",
  Mobile: "0300-1234567",
  Address: "Model Town, Lahore",
  Designation: "Sales Executive",
  Department: "Sales",
  "Join Date": "2025-01-15",
  "Basic Salary": "60000",
  Allowances: "10000",
  "Bank Name": "HBL",
  "Bank Account": "0123456789",
  "Emergency Contact": "Fatima Raza",
  "Emergency Mobile": "0301-7654321",
  Status: "Active",
};

function downloadTemplate() {
  const head = HEADERS.join(",");
  const sample = HEADERS.map((h) => {
    const v = TEMPLATE_ROW[h] ?? "";
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(",");
  downloadCsv("employees-template.csv", `${head}\r\n${sample}`);
}

export function EmployeeBulkImportDialog() {
  const qc = useQueryClient();
  const { companyId } = useAuth();
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [headerWarnings, setHeaderWarnings] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const stats = useMemo(
    () => ({
      total: parsed.length,
      valid: parsed.filter((r) => r.errors.length === 0).length,
      invalid: parsed.filter((r) => r.errors.length > 0).length,
    }),
    [parsed],
  );

  const reset = () => {
    setParsed([]);
    setFileName(null);
    setHeaderWarnings([]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      const rows = parsed.filter((r) => r.errors.length === 0).map((r) => r.payload!);
      if (rows.length === 0) throw new Error("No valid rows to import");
      // employee_id is filled by the hr_employees_assign_id trigger.
      const { error } = await supabase
        .from("hr_employees" as any)
        .insert(withCompany(rows, companyId!));
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (n) => {
      toast.success(`Imported ${n} employee${n === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["hr-employees"] });
      reset();
      setOpen(false);
    },
    onError: (err: any) => toast.error(err?.message ?? "Import failed"),
  });

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) {
        setParsed([]);
        setHeaderWarnings(["CSV is empty"]);
        return;
      }
      const header = rows[0].map((h) => h.trim());
      const headerNorm = header.map((h) => h.toLowerCase());
      const warnings: string[] = [];
      const missing = HEADERS.filter(
        (h) =>
          !headerNorm.includes(h.toLowerCase()) &&
          h !== "Father Name" &&
          h !== "Address" &&
          h !== "Bank Name" &&
          h !== "Bank Account" &&
          h !== "Emergency Contact" &&
          h !== "Emergency Mobile" &&
          h !== "Status" &&
          h !== "CNIC" &&
          h !== "Mobile" &&
          h !== "Designation" &&
          h !== "Join Date",
      );
      // Only Full Name, Department, Basic Salary, Allowances are strictly required headers.
      const REQUIRED_HEADERS = ["Full Name", "Department", "Basic Salary", "Allowances"];
      const missingReq = REQUIRED_HEADERS.filter((h) => !headerNorm.includes(h.toLowerCase()));
      if (missingReq.length > 0)
        warnings.push(`Missing required columns: ${missingReq.join(", ")}`);
      const unknown = header.filter(
        (h) =>
          h &&
          !(HEADERS as readonly string[]).map((s) => s.toLowerCase()).includes(h.toLowerCase()),
      );
      if (unknown.length > 0) warnings.push(`Unknown columns ignored: ${unknown.join(", ")}`);
      setHeaderWarnings(warnings);
      void missing;

      const dataRows = rows.slice(1);
      const parsedRows: ParsedRow[] = dataRows.map((cols, idx) => {
        const raw: Record<string, string> = {};
        header.forEach((h, i) => {
          const canonical = (HEADERS as readonly string[]).find(
            (s) => s.toLowerCase() === h.toLowerCase(),
          );
          if (canonical) raw[canonical] = cols[i] ?? "";
        });
        return validateRow(raw, idx + 1);
      });
      setParsed(parsedRows);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to read CSV");
      setParsed([]);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="min-h-11 min-w-11">
          <Upload className="h-4 w-4 mr-2" aria-hidden="true" />
          Bulk Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Bulk import employees</DialogTitle>
          <DialogDescription>
            Upload a CSV to preview and validate rows before saving. Department and Status must
            match the allowed values. Employee IDs are auto-generated.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 flex-wrap">
          <Button type="button" variant="outline" className="min-h-11" onClick={downloadTemplate}>
            <FileDown className="h-4 w-4 mr-2" aria-hidden="true" />
            Download template
          </Button>
          <label className="inline-flex">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={onFileChange}
            />
            <Button type="button" className="min-h-11" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" aria-hidden="true" />
              {fileName ? "Choose different file" : "Choose CSV file"}
            </Button>
          </label>
          {fileName && (
            <span className="text-sm text-muted-foreground truncate max-w-[240px]" title={fileName}>
              {fileName}
            </span>
          )}
          {parsed.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11 min-w-11 ml-auto"
              onClick={reset}
            >
              <X className="h-4 w-4 mr-1" aria-hidden="true" /> Clear
            </Button>
          )}
        </div>

        {headerWarnings.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
              <ul className="space-y-1">
                {headerWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {parsed.length > 0 && (
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">{stats.total} rows</span>
            <span className="inline-flex items-center gap-1 text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {stats.valid} valid
            </span>
            <span className="inline-flex items-center gap-1 text-destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" /> {stats.invalid} invalid
            </span>
          </div>
        )}

        {parsed.length > 0 && (
          <Card className="overflow-auto flex-1 min-h-[200px]">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr className="text-left">
                  <th className="px-2 py-2 w-10">#</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Full Name</th>
                  <th className="px-2 py-2">Department</th>
                  <th className="px-2 py-2">Employee Status</th>
                  <th className="px-2 py-2 text-right">Basic</th>
                  <th className="px-2 py-2 text-right">Allow.</th>
                  <th className="px-2 py-2 text-right">Total</th>
                  <th className="px-2 py-2">Issues</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((r) => {
                  const ok = r.errors.length === 0;
                  return (
                    <tr key={r.rowNumber} className={ok ? "" : "bg-destructive/5"}>
                      <td className="px-2 py-1.5 text-muted-foreground">{r.rowNumber}</td>
                      <td className="px-2 py-1.5">
                        {ok ? (
                          <CheckCircle2 className="h-4 w-4 text-success" aria-label="Valid" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-destructive" aria-label="Invalid" />
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {r.raw["Full Name"] || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        {r.raw["Department"] || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        {r.raw["Status"] || <span className="text-muted-foreground">Active</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {r.raw["Basic Salary"] || "0"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {r.raw["Allowances"] || "0"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {ok ? r.payload!.total_salary.toLocaleString() : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-destructive">
                        {r.errors.join("; ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}

        {parsed.length === 0 && !headerWarnings.length && (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Choose a CSV file to preview rows here. Required columns:{" "}
            <span className="font-medium">Full Name, Department, Basic Salary, Allowances</span>.
          </div>
        )}

        <DialogFooter className="mt-auto">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => {
              reset();
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="min-h-11"
            disabled={stats.valid === 0 || importMutation.isPending}
            onClick={() => importMutation.mutate()}
          >
            {importMutation.isPending
              ? "Importing…"
              : `Import ${stats.valid} valid row${stats.valid === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
