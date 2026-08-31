import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { format } from "date-fns";
import { CalendarIcon, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { toast as sonner } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { fmtPKR } from "@/lib/format";
import { useActiveProject } from "@/lib/activeProject";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { withCompany, assertCompanyId } from "@/lib/companyScope";

// Spec types
const UNIT_TYPES = ["Apartment", "Shop", "Office"] as const;
const FLOORS = ["LG", "Ground", "1st", "2nd", "3rd", "4th", "5th"] as const;
const FREQUENCIES = ["Quarterly", "Monthly", "Half-Yearly", "Yearly"] as const;
const STATUSES = ["Active", "Completed", "Cancelled", "Transferred"] as const;

const cnicRegex = /^\d{5}-\d{7}-\d$/;
const mobileRegex = /^03\d{2}-\d{7}$/;
const bookingIdRegex = /^BK-[A-Z0-9]{1,10}-\d{5}$/;
const clientRefRegex = /^CL-\d{5}$/;
const MIN_CONTRACT_VALUE = 100_000;
const TODAY_STR = format(new Date(), "yyyy-MM-dd");

// Human labels for every schema key so validation summaries name the
// actual field the user sees, not the raw snake_case column name.
const FIELD_LABELS: Record<string, string> = {
  booking_id: "Booking ID",
  client_ref: "Client Ref",
  booking_date: "Booking Date",
  project_code: "Project",
  project_name: "Project",
  unit_id: "Unit ID",
  unit_type: "Unit Type",
  floor: "Floor",
  size_sqft: "Size (Sqft)",
  client_name: "Client Name",
  so_wo: "Father / Husband Name",
  cnic: "CNIC",
  mobile: "Mobile / WhatsApp",
  address: "Address",
  dealer_name: "Dealer Name",
  dealer_commission_pct: "Commission %",
  dealer_commission_fixed: "Commission Fixed",
  sold_rate: "Sold Rate / Sqft",
  down_payment: "Down Payment",
  adjustment_credit: "Adjustment Allowed",
  possession_amount: "Possession Amount",
  no_of_installments: "# of Installments",
  installment_frequency: "Frequency",
  installment_amount: "Installment Amount",
  first_installment_due: "First Installment Due",
  booking_status: "Status",
  notes: "Notes",
};
const labelFor = (k: string) => FIELD_LABELS[k] ?? k;

// Format a raw digit stream into CNIC XXXXX-XXXXXXX-X as the user types.
export function formatCNIC(input: string): string {
  const d = String(input || "")
    .replace(/\D/g, "")
    .slice(0, 13);
  if (d.length <= 5) return d;
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}

// Format a raw digit stream into Pakistan mobile 03XX-XXXXXXX as user types.
// Normalizes pasted international formats: "+92 3XX XXXXXXX", "0092...",
// and "923XX..." all collapse to the local 11-digit "03XX-XXXXXXX" mask.
export function formatMobile(input: string): string {
  let d = String(input || "").replace(/\D/g, "");
  if (d.startsWith("0092")) d = d.slice(4);
  else if (d.startsWith("92") && d.length >= 12) d = d.slice(2);
  if (d.length > 0 && d[0] !== "0") d = "0" + d;
  d = d.slice(0, 11);
  if (d.length <= 4) return d;
  return `${d.slice(0, 4)}-${d.slice(4)}`;
}

const bookingSchema = z.object({
  booking_id: z.string().regex(bookingIdRegex, "Booking ID must be BK-{PROJECT}-XXXXX"),
  client_ref: z.string().regex(clientRefRegex, "Client Ref must be CL-XXXXX"),
  booking_date: z
    .string()
    .min(1, "Booking date is required")
    .refine((v) => v <= TODAY_STR, "Booking date cannot be in the future"),
  project_code: z.string().trim().min(1, "Project is required").max(10),
  project_name: z.string().trim().min(1, "Project is required").max(120),
  unit_id: z.string().trim().min(1, "Unit is required").max(40),
  unit_type: z.enum(UNIT_TYPES),
  floor: z.enum(FLOORS),
  size_sqft: z
    .number({ message: "Size must be a number" })
    .positive("Size must be greater than 0")
    .max(1_000_000, "Size looks unrealistic"),
  client_name: z.string().trim().min(3, "Client name must be at least 3 characters").max(120),
  so_wo: z.string().trim().min(1, "S/O — W/O is required").max(120),
  cnic: z.string().regex(cnicRegex, "CNIC must be XXXXX-XXXXXXX-X"),
  mobile: z.string().regex(mobileRegex, "Mobile must be 03XX-XXXXXXX"),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  dealer_name: z.string().trim().min(1, "Dealer name is required").max(120),
  dealer_commission_pct: z.number().min(0, "Cannot be negative").max(100, "Cannot exceed 100%"),
  dealer_commission_fixed: z
    .number()
    .min(0, "Cannot be negative")
    .max(1_000_000_000, "Amount looks unrealistic"),
  sold_rate: z
    .number({ message: "Sold rate must be a number" })
    .positive("Sold rate must be greater than 0")
    .max(10_000_000, "Sold rate looks unrealistic"),
  down_payment: z
    .number()
    .min(0, "Cannot be negative")
    .max(10_000_000_000, "Amount looks unrealistic"),
  adjustment_credit: z
    .number()
    .min(0, "Cannot be negative")
    .max(10_000_000_000, "Amount looks unrealistic"),
  possession_amount: z
    .number()
    .min(0, "Cannot be negative")
    .max(10_000_000_000, "Amount looks unrealistic"),
  no_of_installments: z
    .number()
    .int("Must be a whole number")
    .min(0, "Cannot be negative")
    .max(600, "Max 600 installments"),
  installment_frequency: z.enum(FREQUENCIES),
  installment_amount: z
    .number()
    .min(0, "Cannot be negative")
    .max(10_000_000_000, "Amount looks unrealistic"),
  first_installment_due: z.string().optional().or(z.literal("")),
  booking_status: z.enum(STATUSES),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type BookingFormValue = z.infer<typeof bookingSchema>;

interface BookingFormProps {
  initial?: Partial<BookingFormValue> & { adjustment_realized?: number };
  onSaved: (id: string) => void;
  onCancel: () => void;
}

const defaultsFor = (
  initial?: Partial<BookingFormValue>,
  fallbackProject?: { project_code: string; project_name: string } | null,
): BookingFormValue => ({
  booking_id: initial?.booking_id ?? "",
  client_ref: initial?.client_ref ?? "",

  booking_date: initial?.booking_date ?? format(new Date(), "yyyy-MM-dd"),
  project_code: initial?.project_code ?? fallbackProject?.project_code ?? "",
  project_name: initial?.project_name ?? fallbackProject?.project_name ?? "",
  unit_id: initial?.unit_id ?? "",
  unit_type: (initial?.unit_type as any) ?? "Apartment",
  floor: (initial?.floor as any) ?? "Ground",
  size_sqft: Number(initial?.size_sqft ?? 0),
  client_name: initial?.client_name ?? "",
  so_wo: initial?.so_wo ?? "",
  cnic: initial?.cnic ? formatCNIC(initial.cnic) : "",
  mobile: initial?.mobile ? formatMobile(initial.mobile) : "",

  address: initial?.address ?? "",
  dealer_name: initial?.dealer_name ?? "",
  dealer_commission_pct: Number(initial?.dealer_commission_pct ?? 0),
  dealer_commission_fixed: Number(initial?.dealer_commission_fixed ?? 0),
  sold_rate: Number(initial?.sold_rate ?? 0),
  down_payment: Number(initial?.down_payment ?? 0),
  adjustment_credit: Number(initial?.adjustment_credit ?? 0),
  possession_amount: Number(initial?.possession_amount ?? 0),
  no_of_installments: Number(initial?.no_of_installments ?? 0),
  installment_frequency: (initial?.installment_frequency as any) ?? "Quarterly",
  installment_amount: Number(initial?.installment_amount ?? 0),
  first_installment_due: initial?.first_installment_due ?? "",
  booking_status: (initial?.booking_status as any) ?? "Active",
  notes: initial?.notes ?? "",
});

async function nextBookingId(projectCode: string) {
  const code = (projectCode || "").toUpperCase();
  if (!code) return "";
  const prefix = `BK-${code}-`;
  const { data } = await supabase
    .from("bookings")
    .select("booking_id")
    .like("booking_id", `${prefix}%`);
  const maxN = (data ?? []).reduce((m, r) => {
    const n = Number(String(r.booking_id).replace(prefix, ""));
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `${prefix}${String(maxN + 1).padStart(5, "0")}`;
}

async function nextClientRef() {
  // Client refs are keyed by public.clients.client_ref, while bookings only
  // reference that key. Generate from BOTH tables so a client row that exists
  // before its booking (or a previously failed booking retry) cannot collide
  // with a fresh booking attempt.
  const [{ data: bookingRefs }, { data: clientRefs }] = await Promise.all([
    supabase.from("bookings").select("client_ref").like("client_ref", "CL-%"),
    supabase.from("clients").select("client_ref").like("client_ref", "CL-%"),
  ]);
  const maxN = [...(bookingRefs ?? []), ...(clientRefs ?? [])].reduce((m, r: any) => {
    const n = Number(String(r.client_ref ?? "").replace("CL-", ""));
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `CL-${String(maxN + 1).padStart(5, "0")}`;
}

async function ensureClientForBooking(
  row: {
    client_ref: string;
    name: string;
    so_wo: string | null;
    cnic: string | null;
    mobile: string | null;
    address: string | null;
  },
  companyId: string,
): Promise<{ error: null; client_ref: string } | { error: { message: string } }> {
  // clients.client_ref is a GLOBAL primary key across tenants, but RLS only
  // exposes our own tenant's rows. So a CL-XXXXX generated from our visible
  // rows can still collide with a row owned by another workspace — we won't
  // find it via update either. On 23505 we bump the numeric suffix and retry
  // until we land on a free ref. First try the same-tenant update path in
  // case *we* already reserved this ref in a prior failed attempt.
  let currentRef = row.client_ref;
  for (let attempt = 0; attempt < 25; attempt++) {
    const insert = await supabase
      .from("clients")
      .insert(withCompany({ ...row, client_ref: currentRef }, companyId));
    if (!insert.error) return { error: null, client_ref: currentRef };

    const code = (insert.error as { code?: string }).code ?? "";
    if (code !== "23505") return { error: insert.error };

    // Same-tenant row exists? Update it and we're done.
    const update = await supabase
      .from("clients")
      .update({
        name: row.name,
        so_wo: row.so_wo,
        cnic: row.cnic,
        mobile: row.mobile,
        address: row.address,
      })
      .eq("client_ref", currentRef)
      .eq("company_id", companyId)
      .select("client_ref")
      .maybeSingle();
    if (update.error) return { error: update.error };
    if (update.data?.client_ref) return { error: null, client_ref: currentRef };

    // Cross-tenant collision — bump the ref and try again.
    const n = Number(currentRef.replace("CL-", "")) || 0;
    currentRef = `CL-${String(n + 1).padStart(5, "0")}`;
  }
  return {
    error: { message: "Could not allocate a free Client Ref after 25 attempts. Please try again." },
  };
}

export function BookingForm({ initial, onSaved, onCancel }: BookingFormProps) {
  const { toast } = useToast();
  const { companyId } = useAuth();
  const isEdit = Boolean(initial?.booking_id);
  const { projects, activeProject } = useActiveProject();
  const [form, setForm] = useState<BookingFormValue>(defaultsFor(initial, activeProject));
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Top-of-form banner. Populated whenever save is blocked so the user
  // sees a single summary above the inline field errors — the inline
  // messages tell them *what to fix*, the banner tells them *why the
  // save didn't go through* (useful when the failing field is scrolled
  // off-screen in a long form).
  const [formError, setFormError] = useState<{ title: string; detail?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [installmentDirty, setInstallmentDirty] = useState(isEdit);

  // Available units for the currently selected project — excludes any unit
  // already tied to another booking. In edit mode we also keep the current
  // unit visible so the picker isn't empty when editing an existing booking.
  const { data: availableUnits = [] } = useQuery({
    queryKey: ["available-units", form.project_code, initial?.unit_id ?? ""],
    enabled: Boolean(form.project_code),
    queryFn: async () => {
      const { data } = await supabase
        .from("units")
        .select("unit_id, unit_type, floor, size_sqft, base_rate, status, linked_booking_id")
        .eq("project_code", form.project_code)
        .order("unit_id", { ascending: true });
      const rows = (data ?? []) as any[];
      return rows.filter(
        (u) =>
          u.unit_id === initial?.unit_id ||
          !u.linked_booking_id ||
          String(u.status ?? "").toLowerCase() === "available",
      );
    },
  });

  // Once projects load, seed the form's project on new bookings so the
  // fallback active-project name/code shows up in the picker.
  useEffect(() => {
    if (isEdit || !activeProject) return;
    setForm((f) =>
      f.project_code
        ? f
        : {
            ...f,
            project_code: activeProject.project_code,
            project_name: activeProject.project_name,
          },
    );
  }, [isEdit, activeProject]);

  // Auto-assign new booking ID whenever the chosen project changes.
  useEffect(() => {
    if (isEdit || !form.project_code) return;
    const prefix = `BK-${form.project_code}-`;
    if (form.booking_id.startsWith(prefix)) return;
    nextBookingId(form.project_code).then((id) =>
      setForm((f) => (f.project_code === form.project_code ? { ...f, booking_id: id } : f)),
    );
  }, [isEdit, form.project_code, form.booking_id]);

  // Auto-assign client ref once for new bookings.
  useEffect(() => {
    if (isEdit || form.client_ref) return;
    nextClientRef().then((ref) => setForm((f) => (f.client_ref ? f : { ...f, client_ref: ref })));
  }, [isEdit, form.client_ref]);

  // Auto-calculated values
  const calc = useMemo(() => {
    const soldUnitValue = form.sold_rate * form.size_sqft;
    const totalDownPayment = form.down_payment + form.adjustment_credit;
    const installmentBase = Math.max(soldUnitValue - totalDownPayment - form.possession_amount, 0);
    const suggestedInstallment =
      form.no_of_installments > 0 ? Math.round(installmentBase / form.no_of_installments) : 0;
    const planTotal =
      totalDownPayment + form.installment_amount * form.no_of_installments + form.possession_amount;
    // Tolerance = no_of_installments (PKR): a uniform installment can only
    // reconstruct `installmentBase` exactly when N divides it. Rounding the
    // per-installment value to whole rupees introduces at most 0.5 PKR of drift
    // per row, so total drift ≤ N/2. Using N (not <1) prevents a spurious
    // "plan does not add up" block for legitimate non-divisible plans
    // (e.g. base = 2,000,000 / N = 7 → 285,714 × 7 = 1,999,998, drift = 2 PKR).
    const planMatches = Math.abs(planTotal - soldUnitValue) <= Math.max(form.no_of_installments, 1);
    const dealerCommissionAmount =
      soldUnitValue * (form.dealer_commission_pct / 100) + form.dealer_commission_fixed;
    return {
      soldUnitValue,
      totalDownPayment,
      installmentBase,
      suggestedInstallment,
      planTotal,
      planMatches,
      dealerCommissionAmount,
    };
  }, [form]);

  // Default installment amount = suggested, until user overrides it
  useEffect(() => {
    if (!installmentDirty)
      setForm((f) => ({ ...f, installment_amount: calc.suggestedInstallment }));
  }, [calc.suggestedInstallment, installmentDirty]);

  const set = <K extends keyof BookingFormValue>(k: K, v: BookingFormValue[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k as string]: "" }));
    // Any edit clears the top-of-form banner — the next Save attempt will
    // repopulate it if problems remain.
    setFormError(null);
  };
  const setNum = (k: keyof BookingFormValue) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(k, Number(e.target.value || 0) as any);

  // Live validity — same schema + cross-field rules as handleSave, so the
  // mobile submit button (which is the primary way users complete this form
  // on-device) stays disabled until every field is valid. Keeps the CTA from
  // firing a doomed request over a slow 4G connection.
  const isFormValid = useMemo(() => {
    if (!bookingSchema.safeParse(form).success) return false;
    if (calc.soldUnitValue > 0 && calc.soldUnitValue < MIN_CONTRACT_VALUE) return false;
    if (form.down_payment > calc.soldUnitValue && calc.soldUnitValue > 0) return false;
    if (form.no_of_installments > 0 && form.installment_amount <= 0) return false;
    if (form.no_of_installments === 0 && form.installment_amount > 0) return false;
    if (form.adjustment_credit > calc.soldUnitValue && calc.soldUnitValue > 0) return false;
    return true;
  }, [form, calc.soldUnitValue]);

  const handleSave = async () => {
    const parsed = bookingSchema.safeParse(form);
    const crossErrs: Record<string, string> = {};
    if (calc.soldUnitValue > 0 && calc.soldUnitValue < MIN_CONTRACT_VALUE) {
      crossErrs.sold_rate = `Sale price must be at least ${fmtPKR(MIN_CONTRACT_VALUE)}`;
    }
    if (form.down_payment > calc.soldUnitValue && calc.soldUnitValue > 0) {
      crossErrs.down_payment = "Down payment cannot exceed sale price";
    }
    if (form.no_of_installments > 0 && form.installment_amount <= 0) {
      crossErrs.installment_amount = "Installment amount is required when installments > 0";
    }
    if (form.no_of_installments === 0 && form.installment_amount > 0) {
      crossErrs.no_of_installments = "Set number of installments for this installment amount";
    }
    if (form.adjustment_credit > calc.soldUnitValue && calc.soldUnitValue > 0) {
      crossErrs.adjustment_credit = "Adjustment credit cannot exceed sale price";
    }

    if (!parsed.success || Object.keys(crossErrs).length > 0) {
      const errs: Record<string, string> = { ...crossErrs };
      if (!parsed.success)
        parsed.error.issues.forEach((i) => {
          errs[i.path.join(".")] = i.message;
        });

      setErrors(errs);
      const failed = Object.keys(errs).filter((k) => errs[k]);
      const names = failed.map(labelFor);
      const preview = names.slice(0, 3).join(", ");
      const extra = names.length > 3 ? ` +${names.length - 3} more` : "";
      const detail = `${failed.length} field${failed.length === 1 ? "" : "s"} need attention: ${preview}${extra}.`;
      setFormError({ title: "Please fix the highlighted fields", detail });
      toast({
        variant: "destructive",
        title: "Please fix the highlighted fields",
        description: detail,
      });
      // Move focus + scroll the first invalid field into view once React has
      // painted the new `aria-invalid` attributes. rAF gives us the post-
      // render DOM; `scrollIntoView` with `block: "center"` keeps the field
      // above the mobile keyboard, and `preventScroll` on focus stops the
      // browser from also snapping to the top-left of the input.
      requestAnimationFrame(() => {
        const first = document.querySelector<HTMLElement>('[aria-invalid="true"]');
        if (first) {
          first.scrollIntoView({ behavior: "smooth", block: "center" });
          try {
            first.focus({ preventScroll: true });
          } catch {
            first.focus();
          }
        }
      });
      return;
    }
    if (!calc.planMatches) {
      const detail = `Difference: ${fmtPKR(calc.planTotal - calc.soldUnitValue)}. Check installment amount or possession amount.`;
      setFormError({ title: "Payment plan does not add up to contract value", detail });
      toast({
        variant: "destructive",
        title: "Payment plan does not add up to contract value",
        description: detail,
      });
      return;
    }
    setFormError(null);
    setSaving(true);
    const payload = {
      booking_id: form.booking_id,
      client_ref: form.client_ref,
      booking_date: form.booking_date,
      project_code: form.project_code,
      project_name: form.project_name,
      unit_id: form.unit_id,

      unit_type: form.unit_type,
      floor: form.floor,
      size_sqft: form.size_sqft,
      client_name: form.client_name,
      so_wo: form.so_wo || null,
      cnic: form.cnic || null,
      mobile: form.mobile || null,
      address: form.address || null,
      dealer_name: form.dealer_name || null,
      dealer_commission_pct: form.dealer_commission_pct,
      dealer_commission_fixed: form.dealer_commission_fixed,
      dealer_commission_amount: calc.dealerCommissionAmount,
      sold_rate: form.sold_rate,
      sold_unit_value: calc.soldUnitValue,
      total_contract_value: calc.soldUnitValue,
      down_payment: form.down_payment,
      adjustment_credit: form.adjustment_credit,
      possession_amount: form.possession_amount,
      no_of_installments: form.no_of_installments,
      installment_frequency: form.installment_frequency,
      installment_amount: form.installment_amount,
      first_installment_due: form.first_installment_due || null,
      booking_status: form.booking_status,
      notes: form.notes || null,
    };

    // Ensure the referenced client row exists (upsert on client_ref).
    // The bookings.client_ref FK requires a matching public.clients row —
    // without this the insert fails with bookings_client_ref_fkey.
    const clientRow = {
      client_ref: form.client_ref,
      name: form.client_name,
      so_wo: form.so_wo || null,
      cnic: form.cnic || null,
      mobile: form.mobile || null,
      address: form.address || null,
    };
    const clientRes = await ensureClientForBooking(clientRow, companyId!);
    if (clientRes.error) {
      setSaving(false);
      setFormError({ title: "Could not save client record", detail: clientRes.error.message });
      sonner.error("Could not save client record", { description: clientRes.error.message });
      return;
    }
    // If ensureClientForBooking had to bump the ref (cross-tenant collision),
    // both the payload and the visible form need to track the ref actually saved.
    if (clientRes.client_ref !== form.client_ref) {
      payload.client_ref = clientRes.client_ref;
      setForm((f) => ({ ...f, client_ref: clientRes.client_ref }));
    }

    const { error } = isEdit
      ? await supabase
          .from("bookings")
          .update(payload)
          .eq("booking_id", form.booking_id)
          .eq("company_id", companyId!)
      : await supabase.from("bookings").insert(withCompany(payload, companyId!));

    setSaving(false);
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      const rawMsg = error.message ?? "Unknown database error";
      // Shared sonner helper: destructive toast with a one-tap Retry that
      // just re-fires handleSave. Kept below the inline banner so users on
      // mobile see both the transient toast and the persistent detail.
      const notifyError = (title: string, description: string) => {
        sonner.error(title, {
          description,
          action: {
            label: "Retry",
            onClick: () => {
              void handleSave();
            },
          },
          duration: 8000,
        });
      };
      // Postgres unique_violation (23505) from the partial unique index
      // `bookings_unit_active_uniq` — enforced atomically at the DB layer
      // so concurrent saves on the same unit can't both succeed.
      if (code === "23505" && /bookings_unit_active_uniq|unit_id/i.test(rawMsg)) {
        const msg = "This unit was just booked by someone else. Please pick a different unit.";
        setErrors((e) => ({ ...e, unit_id: msg }));
        setFormError({
          title: "Unit already booked",
          detail: `Unit ${form.unit_id} now has an active/completed booking.`,
        });
        notifyError("Unit already booked", msg);
        return;
      }
      // Duplicate primary key on booking_id — extremely rare (auto-issued)
      // but map it to a clear message rather than the raw Postgres text.
      if (code === "23505" && /booking_id|bookings_pkey/i.test(rawMsg)) {
        const msg = "This Booking ID was just taken. Reopen the form to get a fresh ID.";
        setFormError({ title: "Duplicate Booking ID", detail: msg });
        notifyError("Duplicate Booking ID", msg);
        return;
      }
      // Any other Postgres error (NOT NULL, FK, RLS, network). Show both a
      // toast and a persistent inline banner so the user can copy the exact
      // message when reporting the issue.
      const title =
        code === "23502"
          ? "Missing required field"
          : code === "23503"
            ? "Related record not found"
            : code === "42501"
              ? "You don't have permission to save this booking"
              : isEdit
                ? "Couldn't save changes"
                : "Couldn't create booking";
      setFormError({ title, detail: rawMsg });
      notifyError(title, rawMsg);
      return;
    }
    setFormError(null);
    toast({ title: isEdit ? "Booking updated" : "Booking created", description: form.booking_id });
    onSaved(form.booking_id);
  };

  const Err = ({ k }: { k: string }) =>
    errors[k] ? <p className="text-[11px] text-destructive mt-1">{errors[k]}</p> : null;

  const DatePick = ({
    value,
    onChange,
    placeholder,
    disableFuture,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
    disableFuture?: boolean;
  }) => (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal h-9",
            !value && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="h-4 w-4 mr-2" />
          {value ? format(new Date(value), "dd-MMM-yyyy") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value ? new Date(value) : undefined}
          onSelect={(d) => onChange(d ? format(d, "yyyy-MM-dd") : "")}
          disabled={disableFuture ? { after: new Date() } : undefined}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="space-y-6">
      {formError && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="booking-form-error"
        >
          <p className="font-medium">{formError.title}</p>
          {formError.detail && <p className="mt-0.5 text-[12px] opacity-90">{formError.detail}</p>}
        </div>
      )}
      {/* Identity */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <Label>Booking ID</Label>
          <Input
            value={form.booking_id}
            readOnly
            aria-readonly="true"
            className="bg-muted/60 font-mono"
          />
        </div>
        <div>
          <Label>Client Ref</Label>
          <Input
            value={form.client_ref}
            readOnly
            aria-readonly="true"
            className="bg-muted/60 font-mono"
          />
        </div>
        <div>
          <Label>Booking Date *</Label>
          <DatePick
            value={form.booking_date}
            onChange={(v) => set("booking_date", v)}
            placeholder="Select date"
            disableFuture
          />
          <Err k="booking_date" />
        </div>
        <div>
          <Label>Project *</Label>
          {isEdit ? (
            <Input value={form.project_name} readOnly className="bg-muted/60" />
          ) : (
            <Select
              value={form.project_code}
              onValueChange={(code) => {
                const p = projects.find((x) => x.project_code === code);
                if (!p) return;
                // Changing project resets booking_id + unit_id so their
                // effects can regenerate/pick a fresh value under the new project.
                setForm((f) => ({
                  ...f,
                  project_code: p.project_code,
                  project_name: p.project_name,
                  booking_id: "",
                  unit_id: "",
                }));
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.project_code} value={p.project_code}>
                    {p.project_name} ({p.project_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Err k="project_code" />
        </div>
      </section>

      {/* Unit */}
      <section>
        <h3 className="text-sm font-semibold text-primary mb-2">Unit</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <Label>Unit ID *</Label>
            <Select
              value={form.unit_id}
              onValueChange={(id) => {
                const u = (availableUnits as any[]).find((x) => x.unit_id === id);
                if (!u) {
                  set("unit_id", id);
                  return;
                }
                setForm((f) => ({
                  ...f,
                  unit_id: u.unit_id,
                  unit_type: (UNIT_TYPES as readonly string[]).includes(u.unit_type)
                    ? u.unit_type
                    : f.unit_type,
                  floor: (FLOORS as readonly string[]).includes(u.floor) ? u.floor : f.floor,
                  size_sqft: Number(u.size_sqft ?? f.size_sqft),
                  sold_rate: f.sold_rate || Number(u.base_rate ?? 0),
                }));
                setErrors((e) => ({ ...e, unit_id: "" }));
              }}
              disabled={!form.project_code}
            >
              <SelectTrigger className="font-mono">
                <SelectValue
                  placeholder={form.project_code ? "Select available unit" : "Pick a project first"}
                />
              </SelectTrigger>
              <SelectContent>
                {(availableUnits as any[]).length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    No available units in this project.
                  </div>
                ) : (
                  (availableUnits as any[]).map((u) => (
                    <SelectItem key={u.unit_id} value={u.unit_id}>
                      {u.unit_id} — {u.unit_type} · {u.floor} · {u.size_sqft} sqft
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Err k="unit_id" />
          </div>
          <div>
            <Label>Unit Type *</Label>
            <Select value={form.unit_type} onValueChange={(v) => set("unit_type", v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNIT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Floor *</Label>
            <Select value={form.floor} onValueChange={(v) => set("floor", v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FLOORS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Size (Sqft) *</Label>
            <Input
              type="number"
              min={0}
              value={form.size_sqft || ""}
              onChange={setNum("size_sqft")}
              aria-invalid={!!errors.size_sqft}
            />
            <Err k="size_sqft" />
          </div>
        </div>
      </section>

      {/* Client */}
      <section>
        <h3 className="text-sm font-semibold text-primary mb-2">Client</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Client Name *</Label>
            <Input
              value={form.client_name}
              onChange={(e) => set("client_name", e.target.value)}
              aria-invalid={!!errors.client_name}
            />
            <Err k="client_name" />
          </div>
          <div>
            <Label>Father / Husband Name</Label>
            <Input value={form.so_wo ?? ""} onChange={(e) => set("so_wo", e.target.value)} />
          </div>
          <div>
            <Label>CNIC *</Label>
            <Input
              value={form.cnic}
              aria-invalid={!!errors.cnic}
              onChange={(e) => set("cnic", formatCNIC(e.target.value))}
              onPaste={(e) => {
                e.preventDefault();
                set("cnic", formatCNIC(e.clipboardData.getData("text")));
              }}
              placeholder="XXXXX-XXXXXXX-X"
              inputMode="numeric"
              pattern="\d{5}-\d{7}-\d{1}"
              autoComplete="off"
              maxLength={15}
              className="font-mono tracking-wider"
            />
            <Err k="cnic" />
          </div>
          <div>
            <Label>Mobile / WhatsApp *</Label>
            <Input
              type="tel"
              value={form.mobile ?? ""}
              aria-invalid={!!errors.mobile}
              onChange={(e) => set("mobile", formatMobile(e.target.value))}
              onPaste={(e) => {
                e.preventDefault();
                set("mobile", formatMobile(e.clipboardData.getData("text")));
              }}
              placeholder="03XX-XXXXXXX"
              inputMode="tel"
              pattern="03\d{2}-\d{7}"
              autoComplete="tel-national"
              maxLength={12}
              className="font-mono tracking-wider"
            />
            <Err k="mobile" />
          </div>

          <div className="md:col-span-2">
            <Label>Address</Label>
            <Textarea
              rows={2}
              value={form.address ?? ""}
              onChange={(e) => set("address", e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Dealer */}
      <section>
        <h3 className="text-sm font-semibold text-primary mb-2">Dealer</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-1">
            <Label>Dealer Name</Label>
            <Input
              value={form.dealer_name ?? ""}
              onChange={(e) => set("dealer_name", e.target.value)}
              placeholder="Direct / Company"
            />
          </div>
          <div>
            <Label>Commission %</Label>
            <Input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={form.dealer_commission_pct || ""}
              onChange={setNum("dealer_commission_pct")}
            />
          </div>
          <div>
            <Label>Commission Fixed (PKR)</Label>
            <Input
              type="number"
              min={0}
              value={form.dealer_commission_fixed || ""}
              onChange={setNum("dealer_commission_fixed")}
            />
          </div>
          <div>
            <Label>Commission Amount</Label>
            <Input
              readOnly
              value={fmtPKR(calc.dealerCommissionAmount)}
              className="bg-muted/60 tabular-nums"
            />
          </div>
        </div>
      </section>

      {/* Pricing & Plan */}
      <section>
        <h3 className="text-sm font-semibold text-primary mb-2">Pricing & Payment Plan</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <Label>Sold Rate / Sqft (PKR)</Label>
            <Input
              type="number"
              min={0}
              value={form.sold_rate || ""}
              onChange={setNum("sold_rate")}
              aria-invalid={!!errors.sold_rate}
            />
            {calc.soldUnitValue > 0 && (
              <p className="text-[11px] font-semibold text-foreground mt-1 tabular-nums">
                Sale Price: {fmtPKR(calc.soldUnitValue)}
              </p>
            )}
            <Err k="sold_rate" />
          </div>
          <div>
            <Label>Sold Unit Value (Sale Price)</Label>
            <Input
              readOnly
              value={fmtPKR(calc.soldUnitValue)}
              className="bg-muted/60 tabular-nums"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Minimum {fmtPKR(MIN_CONTRACT_VALUE)}
            </p>
          </div>
          <div>
            <Label>Down Payment Cash (PKR)</Label>
            <Input
              type="number"
              min={0}
              value={form.down_payment || ""}
              onChange={setNum("down_payment")}
              aria-invalid={!!errors.down_payment}
            />
            <Err k="down_payment" />
          </div>

          <div>
            <Label>Adjustment Allowed (PKR)</Label>
            <Input
              type="number"
              min={0}
              value={form.adjustment_credit || ""}
              onChange={setNum("adjustment_credit")}
              aria-invalid={!!errors.adjustment_credit}
            />
            <Err k="adjustment_credit" />
          </div>

          <div>
            <Label>Total Down Payment</Label>
            <Input
              readOnly
              value={fmtPKR(calc.totalDownPayment)}
              className="bg-muted/60 tabular-nums"
            />
          </div>
          <div>
            <Label>Adj. Asset Realized (rolled-up)</Label>
            <Input
              readOnly
              value={fmtPKR(initial?.adjustment_realized ?? 0)}
              className="bg-muted/60 tabular-nums"
            />
          </div>
          <div>
            <Label>Possession Amount (PKR)</Label>
            <Input
              type="number"
              min={0}
              value={form.possession_amount || ""}
              onChange={setNum("possession_amount")}
              aria-invalid={!!errors.possession_amount}
            />
            <Err k="possession_amount" />
          </div>

          <div>
            <Label>Installment Base</Label>
            <Input
              readOnly
              value={fmtPKR(calc.installmentBase)}
              className="bg-muted/60 tabular-nums"
            />
          </div>
          <div>
            <Label># of Installments</Label>
            <Input
              type="number"
              min={0}
              value={form.no_of_installments || ""}
              onChange={setNum("no_of_installments")}
              aria-invalid={!!errors.no_of_installments}
            />
            <Err k="no_of_installments" />
          </div>

          <div>
            <Label>Frequency</Label>
            <Select
              value={form.installment_frequency}
              onValueChange={(v) => set("installment_frequency", v as any)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Suggested Installment</Label>
            <Input
              readOnly
              value={fmtPKR(calc.suggestedInstallment)}
              className="bg-muted/60 tabular-nums"
            />
          </div>
          <div>
            <Label>Installment Amount (editable)</Label>
            <Input
              type="number"
              min={0}
              value={form.installment_amount || ""}
              onChange={(e) => {
                setInstallmentDirty(true);
                set("installment_amount", Number(e.target.value || 0));
              }}
              aria-invalid={!!errors.installment_amount}
            />
            {form.no_of_installments > 0 && form.installment_amount > 0 && (
              <p className="text-[11px] font-semibold text-primary mt-1 tabular-nums">
                {form.installment_frequency} installment: {fmtPKR(form.installment_amount)} ×{" "}
                {form.no_of_installments}
              </p>
            )}
            <Err k="installment_amount" />
          </div>

          <div>
            <Label>First Installment Due</Label>
            <DatePick
              value={form.first_installment_due ?? ""}
              onChange={(v) => set("first_installment_due", v)}
              placeholder="Select date"
            />
          </div>
          <div className="md:col-span-2">
            <Label>Payment Plan Total</Label>
            <Input
              readOnly
              value={fmtPKR(calc.planTotal)}
              className={cn(
                "bg-muted/60 tabular-nums",
                !calc.planMatches && "ring-2 ring-destructive",
              )}
            />
            {!calc.planMatches && (
              <p className="text-[11px] text-destructive mt-1">
                Plan total must equal Sold Unit Value ({fmtPKR(calc.soldUnitValue)}). Difference:{" "}
                {fmtPKR(calc.planTotal - calc.soldUnitValue)}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Status & Notes */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label>Status</Label>
          <Select
            value={form.booking_status}
            onValueChange={(v) => set("booking_status", v as any)}
          >
            <SelectTrigger>
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
        </div>
        <div className="md:col-span-2">
          <Label>Notes</Label>
          <Textarea
            rows={2}
            value={form.notes ?? ""}
            onChange={(e) => set("notes", e.target.value)}
          />
        </div>
      </section>

      <div
        className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3 border-t sticky bottom-0 bg-background z-10 -mx-4 px-4 sm:mx-0 sm:px-0"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" }}
      >
        <Button
          variant="ghost"
          onClick={onCancel}
          disabled={saving}
          className="w-full sm:w-auto min-h-11"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving || !isFormValid}
          aria-disabled={saving || !isFormValid}
          title={!isFormValid ? "Fix the highlighted fields to continue" : undefined}
          className="w-full sm:w-auto min-h-11"
        >
          {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          {isEdit ? "Save changes" : "Create booking"}
        </Button>
      </div>
    </div>
  );
}
