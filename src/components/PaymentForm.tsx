import { useEffect, useId, useMemo, useState } from "react";
import { z } from "zod";
import { format } from "date-fns";
import { CalendarIcon, Loader2, Check, ChevronsUpDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { usePIIGuardedQuery } from "@/lib/access";
import {
  AllocationBuilder,
  validateAllocations,
  type Allocation,
} from "@/components/AllocationBuilder";
import { useActiveProject } from "@/lib/activeProject";
import { useAuth } from "@/lib/auth";
import { withCompany, assertCompanyId } from "@/lib/companyScope";
import { fmtPKR } from "@/lib/format";
import { callRpc } from "@/integrations/supabase/approvedRpc";

export const PAYMENT_TYPES = [
  "Cash",
  "Cheque",
  "Online Transfer",
  "Bank Transfer",
  "Adjustment/Asset",
] as const;
export const PAYMENT_HEADS = [
  "Down Payment",
  "Installment",
  "Possession",
  "Advance",
  "Extra Payment",
] as const;
// Fixed account list surfaced in the Account dropdown. "Other" reveals a
// free-text input so bespoke accounts still round-trip through the same
// column without expanding the enum every time treasury opens a new one.
export const PAYMENT_ACCOUNTS = [
  "Cash in Hand",
  "Bank - HBL",
  "Bank - Meezan",
  "Bank - UBL",
  "Bank - Allied",
  "Other",
] as const;

// Modes that require a cheque / transaction reference before the payment
// can be saved. Cash never requires one; Adjustment/Asset is a non-cash
// paper credit and also doesn't need a bank reference. Cheque, Online
// Transfer, and Bank Transfer all need an identifiable reference so the
// treasury team can reconcile against bank statements.
const MODES_REQUIRING_REF = new Set<string>(["Cheque", "Online Transfer", "Bank Transfer"]);

// Display helper — comma-grouped PKR digits with no currency symbol.
// The stored value stays a plain `number`; only the input's rendered
// text carries the grouping.
const formatAmount = (n: number) => (n > 0 ? fmtPKR(Math.round(n * 100) / 100) : "");

const schema = z
  .object({
    receipt_no: z.string().regex(/^PAY-\d{5}$/),
    booking_id: z.string().min(1, "Booking is required"),
    payment_date: z.string().min(1, "Date is required"),
    payment_mode: z.enum(PAYMENT_TYPES),
    amount: z.number().positive("Amount must be greater than 0"),
    payment_head: z.enum(PAYMENT_HEADS),
    account: z.string().trim().max(120).optional().or(z.literal("")),
    cheque_txn_no: z.string().trim().max(60).optional().or(z.literal("")),
    posted_by: z.string().trim().max(120).optional().or(z.literal("")),
    received_from: z.string().trim().max(120).optional().or(z.literal("")),
    remarks: z.string().trim().max(500).optional().or(z.literal("")),
  })
  .superRefine((val, ctx) => {
    if (MODES_REQUIRING_REF.has(val.payment_mode) && !(val.cheque_txn_no ?? "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cheque_txn_no"],
        message: `Cheque / transaction number is required for ${val.payment_mode}`,
      });
    }
  });

export type PaymentFormValue = z.infer<typeof schema>;

async function nextPaymentId() {
  const { data } = await supabase.from("payments").select("receipt_no").like("receipt_no", "PAY-%");
  const maxN = (data ?? []).reduce((m, r) => {
    const n = Number(String(r.receipt_no).replace("PAY-", ""));
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `PAY-${String(maxN + 1).padStart(5, "0")}`;
}

interface PaymentFormProps {
  initial?: Partial<PaymentFormValue> & { booking_id?: string };
  onSaved: (receiptNo: string) => void;
  onCancel: () => void;
}

export function PaymentForm({ initial, onSaved, onCancel }: PaymentFormProps) {
  const { toast } = useToast();
  const { companyId } = useAuth();
  const isEdit = Boolean(initial?.receipt_no);
  const [form, setForm] = useState<PaymentFormValue>({
    receipt_no: initial?.receipt_no ?? "",
    booking_id: initial?.booking_id ?? "",
    payment_date: initial?.payment_date ?? format(new Date(), "yyyy-MM-dd"),
    payment_mode: (initial?.payment_mode as any) ?? "Cash",
    amount: Number(initial?.amount ?? 0),
    payment_head: (initial?.payment_head as any) ?? "Installment",
    account: initial?.account ?? "",
    cheque_txn_no: initial?.cheque_txn_no ?? "",
    posted_by: initial?.posted_by ?? "",
    received_from: (initial as any)?.received_from ?? "",
    remarks: initial?.remarks ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
  const [bookingOpen, setBookingOpen] = useState(false);
  const [splitOn, setSplitOn] = useState(false);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [editReason, setEditReason] = useState("");
  const [reconcileIssues, setReconcileIssues] = useState<
    Array<{ code: string; ledger_id: string | null; message: string }>
  >([]);
  // Auto-fill guards. We only overwrite `received_from` / `remarks`
  // when the user hasn't manually edited them — the moment they type,
  // `<field>Dirty` flips to true and the auto-fill effect stops
  // clobbering their input. Edits preload as "dirty" so we never
  // rewrite what the user (or a prior admin edit) already saved.
  const [receivedFromDirty, setReceivedFromDirty] = useState(
    Boolean((initial as any)?.received_from),
  );
  const [remarksDirty, setRemarksDirty] = useState(Boolean(initial?.remarks));
  // Track the last free-text account so switching Account → "Other"
  // reveals an input pre-filled with what was already there.
  const [customAccount, setCustomAccount] = useState(
    initial?.account && !(PAYMENT_ACCOUNTS as readonly string[]).includes(initial.account)
      ? initial.account
      : "",
  );

  // Safeguard: this list is INTENTIONALLY unscoped by the top-bar's
  // active project. A payment belongs to whichever booking the user
  // picked, not to whatever project happens to be selected in the top
  // bar right now. Scoping the query by `activeCode` would make the
  // currently-selected booking disappear from the list the moment the
  // user switches the top bar, which is exactly the bug we're guarding
  // against. Do NOT add activeCode to the queryKey or the select
  // filter.
  const { data: bookings = [] } = usePIIGuardedQuery<any[]>({
    queryKey: ["bookings-min", "all-projects"],
    queryFn: async () =>
      (
        await supabase
          .from("bookings")
          .select(
            "booking_id,client_name,unit_id,project_code,project_name,booking_date,remaining_balance",
          )
          .order("client_name")
      ).data ?? [],
  });

  // Read active project ONLY to render an advisory notice when the top
  // bar has drifted away from the booking's project. We never use it
  // to filter bookings or to stamp the payment's project — the
  // booking's own `project_code` is the source of truth.
  const { activeCode: topBarActiveCode, activeProject: topBarActiveProject } = useActiveProject();

  useEffect(() => {
    if (!isEdit && !form.receipt_no) {
      nextPaymentId().then((id) => setForm((f) => ({ ...f, receipt_no: id })));
    }
  }, [isEdit, form.receipt_no]);

  // Load existing allocations in edit mode
  useEffect(() => {
    if (!isEdit || !form.receipt_no) return;
    (async () => {
      const { data } = await supabase
        .from("payment_allocations")
        .select("ledger_id,head_label,amount")
        .eq("receipt_no", form.receipt_no);
      if (data && data.length > 0) {
        setSplitOn(true);
        setAllocations(
          data.map((a: any) => ({
            ledger_id: a.ledger_id,
            head_label: a.head_label ?? "",
            amount: Number(a.amount),
          })),
        );
      }
    })();
  }, [isEdit, form.receipt_no]);

  const selectedBooking = useMemo(
    () => bookings.find((b: any) => b.booking_id === form.booking_id),
    [bookings, form.booking_id],
  );

  // The booking's own project — this is the "locked" project for this
  // payment. It does NOT change when the top-bar active project
  // changes. Project display fields and reconciliation scope must derive
  // from here.
  const bookingProjectCode: string | null = (selectedBooking as any)?.project_code ?? null;
  const bookingProjectName: string | null = (selectedBooking as any)?.project_name ?? null;
  const projectDrift =
    !!selectedBooking &&
    !!bookingProjectCode &&
    !!topBarActiveCode &&
    topBarActiveCode !== bookingProjectCode;

  // Auto-fill "Received From" with the selected booking's client name,
  // unless the user has already typed their own value.
  useEffect(() => {
    if (receivedFromDirty) return;
    const clientName = (selectedBooking as any)?.client_name ?? "";
    setForm((f) => (f.received_from === clientName ? f : { ...f, received_from: clientName }));
  }, [selectedBooking, receivedFromDirty]);

  // Auto-fill the Purpose / Memo (`remarks`) as
  // "<Payment Head> against <BookingID>" whenever booking or head
  // changes — but respect any manual edit the user has made.
  useEffect(() => {
    if (remarksDirty) return;
    if (!form.booking_id) return;
    const memo = `${form.payment_head} against ${form.booking_id}`;
    setForm((f) => (f.remarks === memo ? f : { ...f, remarks: memo }));
  }, [form.booking_id, form.payment_head, remarksDirty]);

  const set = <K extends keyof PaymentFormValue>(k: K, v: PaymentFormValue[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k as string]: "" }));
  };

  const handleSave = async () => {
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      parsed.error.issues.forEach((i) => {
        errs[i.path.join(".")] = i.message;
      });
      setErrors(errs);
      toast({ variant: "destructive", title: "Please fix the highlighted fields" });
      return;
    }
    // Date guard: payment_date must be on/after the booking's booking_date.
    const bDate = (selectedBooking as any)?.booking_date as string | undefined;
    if (bDate && form.payment_date < bDate) {
      setErrors((e) => ({
        ...e,
        payment_date: `Payment date cannot be before booking date (${bDate})`,
      }));
      toast({
        variant: "destructive",
        title: "Invalid payment date",
        description: `Booking started on ${bDate}.`,
      });
      return;
    }
    // Overpayment guard: amount cannot exceed outstanding due (allow own prior amount in edit).
    // Use a 2 PKR tolerance to handle cumulative floating point or calculation drifts.
    // We allow payments even if outstanding is 0 if it's an "Advance" or "Extra Payment".
    if (form.payment_mode !== "Adjustment/Asset") {
      const outstanding = Number((selectedBooking as any)?.remaining_balance ?? 0);
      const prior = isEdit ? Number(initial?.amount ?? 0) : 0;
      const maxAllowed = outstanding + prior;
      const isAdvance = form.payment_head === "Advance" || form.payment_head === "Extra Payment";

      // If not an advance, block if it exceeds balance by more than tolerance.
      // If outstanding is already 0, we only block if it's NOT an advance.
      if (!isAdvance && form.amount > maxAllowed + 2.0) {
        setErrors((e) => ({ ...e, amount: `Exceeds outstanding due (PKR ${fmtPKR(maxAllowed)})` }));
        toast({
          variant: "destructive",
          title: "Amount exceeds balance",
          description: `Total amount exceeds the outstanding PKR ${fmtPKR(maxAllowed)}. Use 'Advance' or 'Extra Payment' to record surplus funds.`,
        });
        return;
      }
    }

    if (splitOn) {
      const err = validateAllocations(allocations, form.amount);
      if (err) {
        toast({ variant: "destructive", title: "Allocations don't match", description: err });
        return;
      }
    }
    // Ledger balance integrity is enforced by server-side reconciliation
    // below; duplicate-installment guard is handled by FIFO allocation.
    if (isEdit && editReason.trim().length === 0) {
      toast({
        variant: "destructive",
        title: "Reason required",
        description: "Please enter a reason for this edit.",
      });
      return;
    }

    setSaving(true);
    setReconcileIssues([]);

    // Server-side reconciliation against the live ledger before we persist anything.
    if (splitOn && allocations.length) {
      const { data: verdict, error: rErr } = await callRpc("reconcile_payment_allocations", {
        _receipt_no: (isEdit ? form.receipt_no : null) as any,
        _booking_id: form.booking_id,
        _amount: form.amount,
        _allocations: allocations.map((a) => ({
          ledger_id: a.ledger_id,
          head_label: a.head_label,
          amount: a.amount,
        })) as any,
      });
      if (rErr) {
        setSaving(false);
        toast({
          variant: "destructive",
          title: "Reconciliation failed",
          description: rErr.message,
        });
        return;
      }
      const v = verdict as {
        ok: boolean;
        issues?: Array<{ code: string; ledger_id: string | null; message: string }>;
      } | null;
      if (v && !v.ok) {
        setReconcileIssues(v.issues ?? []);
        setSaving(false);
        toast({
          variant: "destructive",
          title: "Ledger reconciliation failed",
          description: `${v.issues?.length ?? 0} issue${(v.issues?.length ?? 0) === 1 ? "" : "s"} — please review below.`,
        });
        return;
      }
    }

    const isAdjustment = form.payment_mode === "Adjustment/Asset";
    const safe_cash_amount = isAdjustment ? 0 : form.amount;

    try {
      if (isEdit) {
        // Admin-only edit path via RPC (enforces reason + logs history + recalcs ledger)
        const patch: Record<string, any> = {
          payment_date: form.payment_date,
          payment_mode: form.payment_mode,
          payment_head: form.payment_head,
          amount: form.amount,
          // Account is stored regardless of mode now — treasury tracks
          // cash-in-hand transactions the same way as bank ones.
          account: form.account || "",
          cheque_txn_no: form.cheque_txn_no || "",
          posted_by: form.posted_by || "",
          received_from: form.received_from || "",
          remarks: form.remarks || "",
        };
        const { error } = await callRpc("admin_edit_payment", {
          _receipt_no: form.receipt_no,
          _patch: patch,
          _reason: editReason.trim(),
          _allocations: splitOn
            ? allocations.map((a) => ({
                ledger_id: a.ledger_id,
                head_label: a.head_label,
                amount: a.amount,
              }))
            : [],
        });
        if (error) throw error;
        // If split was turned off, drop allocations explicitly
        if (!splitOn) {
          await supabase.from("payment_allocations").delete().eq("receipt_no", form.receipt_no);
        }
      } else {
        // Safeguard: every project-bearing payment value is derived from the
        // selected booking, never from `topBarActiveCode` /
        // `topBarActiveProject`. Switching the top bar mid-form must
        // never influence what gets written here.
        const payload: any = {
          receipt_no: form.receipt_no,
          booking_id: form.booking_id,
          client_name: selectedBooking?.client_name ?? null,
          unit_no: selectedBooking?.unit_id ?? null,
          project: bookingProjectName ?? (selectedBooking as any)?.project ?? null,
          payment_date: form.payment_date,
          payment_mode: form.payment_mode,
          payment_head: form.payment_head,
          amount: form.amount,
          safe_cash_amount,
          cash_bank_include: !isAdjustment,
          non_cash_adjustment: isAdjustment,
          account: form.account || null,
          cheque_txn_no: form.cheque_txn_no || null,
          posted_by: form.posted_by || null,
          received_from: form.received_from || null,
          remarks: form.remarks || null,
          status: "Posted",
        };
        const { error } = await supabase.from("payments").insert(withCompany(payload, companyId!));
        if (error) throw error;
        if (splitOn && allocations.length) {
          const { error: aErr } = await supabase.from("payment_allocations").insert(
            withCompany(
              allocations.map((a) => ({
                receipt_no: form.receipt_no,
                ledger_id: a.ledger_id,
                head_label: a.head_label,
                amount: a.amount,
              })),
              companyId!,
            ) as any,
          );
          if (aErr) throw aErr;
        }
      }
      setSaving(false);
      toast({
        title: isEdit ? "Payment updated" : "Payment recorded",
        description: form.receipt_no,
      });
      // Ask for push notification permission on the first payment mark (idempotent).
      if (!isEdit) {
        void import("@/pwa/push-client")
          .then((m) => m.enablePushOnFirstPaymentMark())
          .catch(() => {});
      }
      onSaved(form.receipt_no);
    } catch (e: any) {
      setSaving(false);
      toast({ variant: "destructive", title: "Save failed", description: e.message });
    }
  };

  const Err = ({ k }: { k: string }) =>
    errors[k] ? <p className="text-[11px] text-destructive mt-1">{errors[k]}</p> : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label htmlFor={fid("receipt")}>Payment ID</Label>
          <Input
            id={fid("receipt")}
            value={form.receipt_no}
            readOnly
            className="bg-muted/60 font-mono"
          />
        </div>
        <div>
          <Label htmlFor={fid("date")}>Payment Date *</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                id={fid("date")}
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal h-9",
                  !form.payment_date && "text-muted-foreground",
                )}
              >
                <CalendarIcon className="h-4 w-4 mr-2" aria-hidden="true" />
                {form.payment_date
                  ? format(new Date(form.payment_date), "dd-MMM-yyyy")
                  : "Pick date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={form.payment_date ? new Date(form.payment_date) : undefined}
                onSelect={(d) => set("payment_date", d ? format(d, "yyyy-MM-dd") : "")}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          <Err k="payment_date" />
        </div>
        <div>
          <Label htmlFor={fid("booking")}>Booking *</Label>
          <Popover open={bookingOpen} onOpenChange={setBookingOpen}>
            <PopoverTrigger asChild>
              <Button
                id={fid("booking")}
                variant="outline"
                role="combobox"
                aria-expanded={bookingOpen}
                aria-label="Select booking"
                className="w-full justify-between h-9 font-normal"
              >
                <span className="truncate">
                  {selectedBooking
                    ? `${selectedBooking.client_name} · ${selectedBooking.booking_id} · ${selectedBooking.unit_id}`
                    : "Select booking…"}
                </span>
                <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[420px] pointer-events-auto" align="start">
              <Command>
                <CommandInput placeholder="Search by client, booking, unit…" />
                <CommandList>
                  <CommandEmpty>No bookings found.</CommandEmpty>
                  <CommandGroup>
                    {bookings.map((b: any) => (
                      <CommandItem
                        key={b.booking_id}
                        value={`${b.client_name} ${b.booking_id} ${b.unit_id}`}
                        onSelect={() => {
                          set("booking_id", b.booking_id);
                          setBookingOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "h-4 w-4 mr-2",
                            form.booking_id === b.booking_id ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="capitalize flex-1 truncate">{b.client_name}</span>
                        <span className="font-mono text-xs text-muted-foreground ml-2">
                          {b.booking_id}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground ml-2">
                          {b.unit_id}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <Err k="booking_id" />
          {selectedBooking && bookingProjectCode && (
            <p className="text-[11px] text-muted-foreground mt-1">
              This payment is locked to project{" "}
              <span className="font-mono">{bookingProjectCode}</span>
              {bookingProjectName ? ` · ${bookingProjectName}` : ""} (from the selected booking).
            </p>
          )}
          {projectDrift && (
            <p
              role="status"
              className="text-[11px] text-amber-700 mt-1"
              data-testid="payment-form-project-drift-notice"
            >
              Top bar is on <span className="font-mono">{topBarActiveCode}</span>
              {topBarActiveProject?.project_name ? ` (${topBarActiveProject.project_name})` : ""},
              but this payment stays with the booking's project{" "}
              <span className="font-mono">{bookingProjectCode}</span>. Switching the top bar will
              not change or clear this form.
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label htmlFor={fid("mode")}>Payment Type *</Label>
          <Select value={form.payment_mode} onValueChange={(v) => set("payment_mode", v as any)}>
            <SelectTrigger id={fid("mode")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.payment_mode === "Adjustment/Asset" && (
            <p className="text-[11px] text-adjustment mt-1">
              Adjustment/Asset entries are excluded from Cash Received totals.
            </p>
          )}
        </div>
        <div>
          <Label htmlFor={fid("amount")}>Amount (PKR) *</Label>
          <Input
            id={fid("amount")}
            inputMode="numeric"
            // Comma-grouped display; we strip non-digits on every
            // keystroke and store the plain number. Keeps the input
            // controlled without dragging Intl through the reducer.
            value={formatAmount(form.amount)}
            onChange={(e) => {
              const digits = e.target.value.replace(/[^\d]/g, "");
              set("amount", digits ? Number(digits) : 0);
            }}
            placeholder="0"
          />
          <Err k="amount" />
        </div>
        <div>
          <Label htmlFor={fid("head")}>Payment Head *</Label>
          <Select value={form.payment_head} onValueChange={(v) => set("payment_head", v as any)}>
            <SelectTrigger id={fid("head")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_HEADS.map((h) => (
                <SelectItem key={h} value={h}>
                  {h}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* SPLIT ALLOCATION toggle */}
      {form.booking_id && form.amount > 0 && (
        <div className="rounded-md border p-3 bg-card">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="split-toggle" className="font-medium">
                Split this payment across multiple heads
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Off: FIFO auto-allocates against the oldest unpaid rows. On: pick exactly where each
                rupee goes.
              </p>
            </div>
            <Switch id="split-toggle" checked={splitOn} onCheckedChange={setSplitOn} />
          </div>
          {splitOn && (
            <div className="mt-3">
              <AllocationBuilder
                bookingId={form.booking_id}
                totalAmount={form.amount}
                value={allocations}
                onChange={(next) => {
                  setAllocations(next);
                  setReconcileIssues([]);
                }}
                excludeReceiptNo={isEdit ? form.receipt_no : undefined}
              />
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label htmlFor={fid("account")}>Account</Label>
          <Select
            value={
              form.account && (PAYMENT_ACCOUNTS as readonly string[]).includes(form.account)
                ? form.account
                : form.account
                  ? "Other"
                  : ""
            }
            onValueChange={(v) => {
              if (v === "Other") {
                // Restore any previously typed custom value so
                // switching Other → Bank → Other doesn't wipe it.
                set("account", customAccount || "Other");
              } else {
                set("account", v);
              }
            }}
          >
            <SelectTrigger id={fid("account")}>
              <SelectValue placeholder="Select account" />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_ACCOUNTS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.account &&
            !(PAYMENT_ACCOUNTS as readonly string[]).slice(0, -1).includes(form.account) && (
              <Input
                className="mt-2"
                placeholder="Custom account name"
                value={form.account === "Other" ? "" : form.account}
                onChange={(e) => {
                  const v = e.target.value;
                  setCustomAccount(v);
                  set("account", v || "Other");
                }}
              />
            )}
        </div>
        {MODES_REQUIRING_REF.has(form.payment_mode) && (
          <div>
            <Label htmlFor={fid("cheque")}>
              Cheque / Transaction Number
              {MODES_REQUIRING_REF.has(form.payment_mode) ? " *" : ""}
            </Label>
            <Input
              id={fid("cheque")}
              value={form.cheque_txn_no ?? ""}
              onChange={(e) => set("cheque_txn_no", e.target.value)}
              placeholder={
                MODES_REQUIRING_REF.has(form.payment_mode) ? "Required for this mode" : ""
              }
            />
            <Err k="cheque_txn_no" />
          </div>
        )}
        <div>
          <Label htmlFor={fid("posted")}>Received By</Label>
          <Input
            id={fid("posted")}
            value={form.posted_by ?? ""}
            onChange={(e) => set("posted_by", e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor={fid("received-from")}>Received From</Label>
          <Input
            id={fid("received-from")}
            value={form.received_from ?? ""}
            onChange={(e) => {
              setReceivedFromDirty(true);
              set("received_from", e.target.value);
            }}
            placeholder={
              selectedBooking
                ? `Defaults to ${(selectedBooking as any).client_name}`
                : "Payer's name"
            }
          />
          {!receivedFromDirty && form.received_from && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Auto-filled from booking; edit to override.
            </p>
          )}
        </div>
        <div>
          <Label htmlFor={fid("memo")}>Purpose / Memo</Label>
          <Input
            id={fid("memo")}
            value={form.remarks ?? ""}
            onChange={(e) => {
              setRemarksDirty(true);
              set("remarks", e.target.value);
            }}
            placeholder="Auto-fills once booking + head are set"
          />
          {!remarksDirty && form.remarks && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Auto-filled from Payment Head + Booking; edit to override.
            </p>
          )}
        </div>
      </div>

      {isEdit && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <Label htmlFor={fid("reason")} className="text-amber-900 font-medium">
            Reason for edit *
          </Label>
          <Textarea
            id={fid("reason")}
            rows={2}
            value={editReason}
            onChange={(e) => setEditReason(e.target.value)}
            placeholder="e.g. Client bank slip confirmed lower amount"
            className="mt-1 bg-background/60"
          />
          <p className="text-[11px] text-amber-900/80 mt-1">
            Required. This reason is recorded in the edit history along with each field that
            changed.
          </p>
        </div>
      )}

      {reconcileIssues.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2 animate-fade-in"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-destructive">
              Ledger reconciliation failed — {reconcileIssues.length} issue
              {reconcileIssues.length === 1 ? "" : "s"} must be resolved before saving.
            </div>
            <Button size="sm" variant="ghost" onClick={() => setReconcileIssues([])}>
              Dismiss
            </Button>
          </div>
          <ul className="text-[12px] text-destructive/90 space-y-1 list-disc pl-5">
            {reconcileIssues.map((iss, i) => (
              <li key={i}>
                <span className="font-mono text-[10px] uppercase tracking-wide mr-1 opacity-70">
                  {iss.code}
                </span>
                {iss.message}
                {iss.ledger_id && (
                  <span className="ml-1 font-mono text-[10px] opacity-70">({iss.ledger_id})</span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            Adjust the split above (or reload the booking if another user just posted a payment) and
            try again.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t">
        {isEdit && (
          <Button
            variant="destructive"
            onClick={async () => {
              const reason = window.prompt("Reason to delete this payment (required):", "");
              if (!reason || !reason.trim()) return;
              if (
                !window.confirm(
                  `Delete ${form.receipt_no}? This will remove its allocations and recompute the ledger.`,
                )
              )
                return;
              setSaving(true);
              const { error } = await callRpc("admin_delete_payment", {
                _receipt_no: form.receipt_no,
                _reason: reason.trim(),
              });
              setSaving(false);
              if (error) {
                toast({
                  variant: "destructive",
                  title: "Delete failed",
                  description: error.message,
                });
                return;
              }
              toast({ title: "Payment deleted", description: form.receipt_no });
              onSaved(form.receipt_no);
            }}
            disabled={saving}
          >
            Delete
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          {isEdit ? "Save changes" : "Record payment"}
        </Button>
      </div>
    </div>
  );
}
