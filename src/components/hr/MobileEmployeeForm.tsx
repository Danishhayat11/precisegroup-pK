import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtPKR } from "@/lib/format";
import { EmployeePhotoPicker } from "@/pages/hr/EmployeePhoto";

// Mobile add/edit form: renders a full-height tabbed layout with a sticky
// footer Save button. Reuses the same validation schema and payload shape
// as the desktop dialog so business logic stays in one place.

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

export const mobileEmployeeSchema = z.object({
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

export type MobileEmployeeFormState = {
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

function toNum(s: string): number {
  const n = Number(String(s).replace(/[, ]+/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function MobileEmployeeForm({
  mode,
  initial,
  employeeId,
  submitting,
  onSubmit,
}: {
  mode: "add" | "edit";
  initial: MobileEmployeeFormState;
  employeeId?: string;
  submitting: boolean;
  onSubmit: (payload: z.infer<typeof mobileEmployeeSchema>) => void;
}) {
  const [form, setForm] = useState<MobileEmployeeFormState>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof MobileEmployeeFormState, string>>>({});
  const [tab, setTab] = useState<"personal" | "job" | "salary" | "bank">("personal");

  useEffect(() => {
    setForm(initial);
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  const totalSalary = toNum(form.basic_salary) + toNum(form.allowances);

  function set<K extends keyof MobileEmployeeFormState>(k: K, v: MobileEmployeeFormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  }

  // Tabs whose fields have an error — parent switches to first invalid tab.
  function firstErrorTab(next: Partial<Record<keyof MobileEmployeeFormState, string>>): typeof tab {
    if (
      ["full_name", "father_name", "cnic", "mobile", "address"].some(
        (k) => next[k as keyof MobileEmployeeFormState],
      )
    )
      return "personal";
    if (
      ["designation", "department", "join_date", "status"].some(
        (k) => next[k as keyof MobileEmployeeFormState],
      )
    )
      return "job";
    if (["basic_salary", "allowances"].some((k) => next[k as keyof MobileEmployeeFormState]))
      return "salary";
    if (
      ["bank_account", "bank_name", "emergency_contact", "emergency_mobile"].some(
        (k) => next[k as keyof MobileEmployeeFormState],
      )
    )
      return "bank";
    return "personal";
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = mobileEmployeeSchema.safeParse(form);
    if (!parsed.success) {
      const next: Partial<Record<keyof MobileEmployeeFormState, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof MobileEmployeeFormState | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      setTab(firstErrorTab(next));
      toast.error(parsed.error.issues[0]?.message ?? "Please fix the highlighted fields");
      return;
    }
    onSubmit(parsed.data);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-4">
        {mode === "edit" && employeeId && (
          <div className="text-[11px] text-muted-foreground font-mono mb-2">· {employeeId}</div>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="w-full grid grid-cols-4 mb-3 sticky top-0 z-10">
            <TabsTrigger value="personal" className="min-h-11">
              Personal
            </TabsTrigger>
            <TabsTrigger value="job" className="min-h-11">
              Job
            </TabsTrigger>
            <TabsTrigger value="salary" className="min-h-11">
              Salary
            </TabsTrigger>
            <TabsTrigger value="bank" className="min-h-11">
              Bank
            </TabsTrigger>
          </TabsList>

          <TabsContent value="personal" className="space-y-3 mt-0">
            <Field label="Photo">
              <EmployeePhotoPicker
                value={form.photo_path}
                onChange={(path) => set("photo_path", path)}
                name={form.full_name}
              />
            </Field>
            <Field label="Full Name" required error={errors.full_name}>
              <Input
                value={form.full_name}
                onChange={(e) => set("full_name", e.target.value)}
                maxLength={120}
              />
            </Field>
            <Field label="Father Name" error={errors.father_name}>
              <Input
                value={form.father_name}
                onChange={(e) => set("father_name", e.target.value)}
                maxLength={120}
              />
            </Field>
            <Field label="CNIC" error={errors.cnic}>
              <Input
                value={form.cnic}
                onChange={(e) => set("cnic", e.target.value)}
                placeholder="35202-1234567-1"
                maxLength={15}
                inputMode="numeric"
              />
            </Field>
            <Field label="Mobile" error={errors.mobile}>
              <Input
                value={form.mobile}
                onChange={(e) => set("mobile", e.target.value)}
                placeholder="0301-1234567"
                maxLength={20}
                inputMode="tel"
              />
            </Field>
            <Field label="Address" error={errors.address}>
              <Textarea
                rows={3}
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                maxLength={500}
              />
            </Field>
          </TabsContent>

          <TabsContent value="job" className="space-y-3 mt-0">
            <Field label="Designation" error={errors.designation}>
              <Input
                value={form.designation}
                onChange={(e) => set("designation", e.target.value)}
                maxLength={120}
              />
            </Field>
            <Field label="Department" error={errors.department}>
              <Select
                value={form.department}
                onValueChange={(v) => set("department", v as Department)}
              >
                <SelectTrigger className="min-h-11">
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
                type="date"
                value={form.join_date}
                onChange={(e) => set("join_date", e.target.value)}
              />
            </Field>
            <Field label="Status" error={errors.status}>
              <Select value={form.status} onValueChange={(v) => set("status", v as EmployeeStatus)}>
                <SelectTrigger className="min-h-11">
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
          </TabsContent>

          <TabsContent value="salary" className="space-y-3 mt-0">
            <Field label="Basic Salary (PKR)" error={errors.basic_salary}>
              <Input
                inputMode="decimal"
                value={form.basic_salary}
                onChange={(e) => set("basic_salary", e.target.value)}
              />
            </Field>
            <Field label="Allowances (PKR)" error={errors.allowances}>
              <Input
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
          </TabsContent>

          <TabsContent value="bank" className="space-y-3 mt-0">
            <Field label="Bank Name" error={errors.bank_name}>
              <Input
                value={form.bank_name}
                onChange={(e) => set("bank_name", e.target.value)}
                maxLength={120}
              />
            </Field>
            <Field label="Bank Account" error={errors.bank_account}>
              <Input
                value={form.bank_account}
                onChange={(e) => set("bank_account", e.target.value)}
                maxLength={60}
              />
            </Field>
            <Field label="Emergency Contact" error={errors.emergency_contact}>
              <Input
                value={form.emergency_contact}
                onChange={(e) => set("emergency_contact", e.target.value)}
                maxLength={120}
              />
            </Field>
            <Field label="Emergency Mobile" error={errors.emergency_mobile}>
              <Input
                value={form.emergency_mobile}
                onChange={(e) => set("emergency_mobile", e.target.value)}
                maxLength={20}
                inputMode="tel"
              />
            </Field>
          </TabsContent>
        </Tabs>
      </div>

      {/* Sticky save footer — always in view on mobile */}
      <div
        className="sticky bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur px-4 py-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <Button type="submit" disabled={submitting} className="w-full min-h-11">
          {submitting ? "Saving…" : mode === "add" ? "Save Employee" : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
