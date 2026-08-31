import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import {
  Loader2,
  ChevronLeft,
  Check,
  Printer,
  Search,
  X,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { fmtPKR } from "@/lib/format";
import { usePIIGuardedQuery } from "@/lib/access";
import { useAuth } from "@/lib/auth";
import { withCompany } from "@/lib/companyScope";
import { PAYMENT_HEADS, PAYMENT_TYPES, PAYMENT_ACCOUNTS } from "@/components/PaymentForm";
import { toast } from "sonner";
import { useFocusTrap } from "@/hooks/use-focus-trap";

/**
 * Full-screen 3-step wizard used on mobile to record a payment.
 * Desktop keeps the existing PaymentForm dialog.
 *
 * Steps:
 *   1. Select Booking (searchable list)
 *   2. Payment Details (head, mode, amount, ref)
 *   3. Confirm & Save (summary)
 * After save: success screen with Print + Done actions.
 */
export function MobilePaymentWizard({
  open,
  onClose,
  onSaved,
  onPrint,
  initialBookingId,
  initialAmount,
  initialHead,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onPrint: (receiptNo: string) => void;
  initialBookingId?: string;
  initialAmount?: number;
  initialHead?: (typeof PAYMENT_HEADS)[number];
}) {
  const { companyId } = useAuth();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [bookingId, setBookingId] = useState(initialBookingId ?? "");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<(typeof PAYMENT_TYPES)[number]>("Cash");
  const [head, setHead] = useState<(typeof PAYMENT_HEADS)[number]>(initialHead ?? "Installment");
  const [amountStr, setAmountStr] = useState(
    initialAmount && initialAmount > 0 ? String(Math.round(initialAmount)) : "",
  );
  const [account, setAccount] = useState<string>("Cash in Hand");
  const [ref, setRef] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedReceipt, setSavedReceipt] = useState<{ no: string; amount: number } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [receiptNo, setReceiptNo] = useState("");
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef, open, onClose);

  // Reset when opened
  useEffect(() => {
    if (open) {
      // Skip booking-select step when a booking is pre-selected.
      setStep(initialBookingId ? 1 : 0);
      setBookingId(initialBookingId ?? "");
      setQ("");
      setMode("Cash");
      setHead(initialHead ?? "Installment");
      setAmountStr(initialAmount && initialAmount > 0 ? String(Math.round(initialAmount)) : "");
      setAccount("Cash in Hand");
      setRef("");
      setRemarks("");
      setSavedReceipt(null);
      setSaveError(null);
    }
  }, [open, initialBookingId, initialAmount, initialHead]);

  // Allocate next PAY-##### id
  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from("payments")
        .select("receipt_no")
        .like("receipt_no", "PAY-%");
      const maxN = (data ?? []).reduce((m, r: any) => {
        const n = Number(String(r.receipt_no).replace("PAY-", ""));
        return Number.isFinite(n) && n > m ? n : m;
      }, 0);
      setReceiptNo(`PAY-${String(maxN + 1).padStart(5, "0")}`);
    })();
  }, [open]);

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

  const filteredBookings = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return bookings.slice(0, 50);
    return bookings
      .filter((b: any) =>
        [b.booking_id, b.client_name, b.unit_id].some((v) =>
          String(v ?? "")
            .toLowerCase()
            .includes(s),
        ),
      )
      .slice(0, 50);
  }, [bookings, q]);

  const selected = useMemo(
    () => bookings.find((b: any) => b.booking_id === bookingId),
    [bookings, bookingId],
  );

  const amount = Number(amountStr.replace(/[^0-9.]/g, "")) || 0;
  const needsRef = mode === "Bank Transfer";

  const canNext0 = !!selected;
  const canNext1 = amount > 0 && !!head && !!mode && (!needsRef || ref.trim().length > 0);

  const validationHint =
    step === 0
      ? canNext0
        ? ""
        : "Select a booking to continue."
      : step === 1
        ? canNext1
          ? ""
          : amount <= 0
            ? "Enter an amount greater than zero."
            : !head
              ? "Choose a payment head."
              : !mode
                ? "Choose a payment mode."
                : needsRef && !ref.trim()
                  ? "Enter a reference number for bank transfers."
                  : ""
        : "";

  const doSave = async () => {
    if (!selected || !companyId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const isAdjustment = mode === "Adjustment/Asset";
      const payload: any = {
        receipt_no: receiptNo,
        booking_id: selected.booking_id,
        client_name: selected.client_name ?? null,
        unit_no: selected.unit_id ?? null,
        project: selected.project_name ?? null,
        payment_date: format(new Date(), "yyyy-MM-dd"),
        payment_mode: mode,
        payment_head: head,
        amount,
        safe_cash_amount: isAdjustment ? 0 : amount,
        cash_bank_include: !isAdjustment,
        non_cash_adjustment: isAdjustment,
        account: account || null,
        cheque_txn_no: ref.trim() || null,
        posted_by: null,
        received_from: selected.client_name ?? null,
        remarks: remarks.trim() || `${head} against ${selected.booking_id}`,
        status: "Posted",
      };
      const { error } = await supabase.from("payments").insert(withCompany(payload, companyId));
      if (error) throw error;
      setSavedReceipt({ no: receiptNo, amount });
      toast.success("Payment recorded", {
        description: `Receipt ${receiptNo} · PKR ${fmtPKR(amount)}`,
      });
      onSaved();
    } catch (e: any) {
      const msg = e?.message ?? "Please try again.";
      setSaveError(msg);
      toast.error("Couldn't record payment", {
        description: msg,
        action: { label: "Retry", onClick: () => void doSave() },
      });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  // Success screen
  if (savedReceipt) {
    return (
      <div
        ref={trapRef}
        className="fixed inset-0 z-50 bg-background flex flex-col animate-fade-in"
        role="dialog"
        aria-modal="true"
        aria-label="Payment recorded"
      >
        <div
          className="flex-1 flex flex-col items-center justify-center px-6 text-center"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="h-24 w-24 rounded-full grid place-items-center mb-6 animate-scale-in bg-success/15">
            <Check className="h-12 w-12 text-success" strokeWidth={3} aria-hidden="true" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Payment Recorded</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Receipt {savedReceipt.no} for PKR {fmtPKR(savedReceipt.amount)} has been saved.
          </p>
          <div className="w-full max-w-sm rounded-2xl border p-5 space-y-3 bg-card">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Receipt No
              </span>
              <span className="font-mono font-medium">{savedReceipt.no}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Amount</span>
              <span className="tabular-nums font-bold text-success">
                PKR {fmtPKR(savedReceipt.amount)}
              </span>
            </div>
          </div>
        </div>
        <div
          className="px-4 pt-3 pb-4 space-y-2 border-t bg-background"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
        >
          <Button
            className="w-full h-14 text-base font-semibold"
            onClick={() => onPrint(savedReceipt.no)}
          >
            <Printer className="h-5 w-5 mr-2" /> Print Receipt
          </Button>
          <Button variant="outline" className="w-full h-12" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={trapRef}
      className="fixed inset-0 z-50 bg-background flex flex-col animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-pay-wizard-title"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b">
        {step > 0 ? (
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
            onClick={() => setStep((s) => (s - 1) as any)}
            aria-label={`Back to ${step === 1 ? "Select Booking" : "Payment Details"}`}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
            onClick={onClose}
            aria-label="Close payment form"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
        )}
        <div id="mobile-pay-wizard-title" className="text-sm font-semibold">
          {step === 0 ? "Select Booking" : step === 1 ? "Payment Details" : "Confirm & Save"}
        </div>
        <div className="w-10" aria-hidden="true" />
      </div>

      {/* Progress dots */}
      <div
        className="flex items-center justify-center gap-2 py-3"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={3}
        aria-valuenow={step + 1}
        aria-label={`Step ${step + 1} of 3`}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden="true"
            className={cn("h-2 rounded-full transition-all", i === step ? "w-6" : "w-2")}
            style={{
              background: i <= step ? "hsl(var(--primary))" : "hsl(var(--muted))",
            }}
          />
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {step === 0 && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by client, booking or unit…"
                className="pl-9 h-11"
              />
            </div>
            <div className="space-y-2">
              {filteredBookings.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No bookings found</p>
              ) : (
                filteredBookings.map((b: any) => {
                  const active = b.booking_id === bookingId;
                  return (
                    <button
                      key={b.booking_id}
                      type="button"
                      onClick={() => setBookingId(b.booking_id)}
                      className={cn(
                        "w-full text-left rounded-xl border p-3 transition-colors",
                        active ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold truncate">{b.client_name ?? "—"}</span>
                        {active && <Check className="h-4 w-4 text-primary shrink-0" />}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 font-mono">
                        {b.booking_id} · {b.unit_id ?? "—"}
                      </div>
                      <div className="text-xs mt-1">
                        Balance:{" "}
                        <span className="tabular-nums font-medium">
                          PKR {fmtPKR(Number(b.remaining_balance ?? 0))}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {step === 1 && selected && (
          <div className="space-y-4">
            <div className="rounded-xl bg-muted/40 p-3 text-sm">
              <div className="font-semibold">{selected.client_name}</div>
              <div className="text-xs text-muted-foreground font-mono">
                {selected.booking_id} · {selected.unit_id ?? "—"}
              </div>
              <div className="text-xs mt-1">
                Balance:{" "}
                <span className="tabular-nums font-medium">
                  PKR {fmtPKR(Number(selected.remaining_balance ?? 0))}
                </span>
              </div>
            </div>

            <div>
              <Label>Payment Head</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {PAYMENT_HEADS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setHead(h)}
                    className={cn(
                      "min-h-11 rounded-lg border px-3 text-sm",
                      head === h ? "border-primary bg-primary/10 font-medium" : "",
                    )}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label>Mode</Label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {PAYMENT_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMode(t)}
                    className={cn(
                      "min-h-11 rounded-lg border px-2 text-xs",
                      mode === t ? "border-primary bg-primary/10 font-medium" : "",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="mpw-amount">Amount (PKR)</Label>
              <Input
                id="mpw-amount"
                inputMode="numeric"
                value={amountStr}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9]/g, "");
                  setAmountStr(raw ? fmtPKR(Number(raw)) : "");
                }}
                placeholder="0"
                className="h-12 text-lg tabular-nums font-semibold"
              />
            </div>

            <div>
              <Label htmlFor="mpw-account">Account</Label>
              <select
                id="mpw-account"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm"
              >
                {PAYMENT_ACCOUNTS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="mpw-ref">
                Reference / Cheque No {needsRef && <span className="text-destructive">*</span>}
              </Label>
              <Input
                id="mpw-ref"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder={needsRef ? "Required for bank transfers" : "Optional"}
                className="h-11"
              />
            </div>

            <div>
              <Label htmlFor="mpw-remarks">Remarks</Label>
              <Textarea
                id="mpw-remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder={`${head} against ${selected.booking_id}`}
                rows={2}
              />
            </div>
          </div>
        )}

        {step === 2 && selected && (
          <div className="space-y-3">
            <div className="rounded-xl border p-4 space-y-3">
              <Row label="Receipt No" value={<span className="font-mono">{receiptNo}</span>} />
              <Row label="Client" value={selected.client_name} />
              <Row
                label="Booking"
                value={<span className="font-mono text-xs">{selected.booking_id}</span>}
              />
              <Row
                label="Unit"
                value={<span className="font-mono text-xs">{selected.unit_id ?? "—"}</span>}
              />
              <Row label="Head" value={head} />
              <Row label="Mode" value={mode} />
              <Row label="Account" value={account} />
              {ref && (
                <Row label="Reference" value={<span className="font-mono text-xs">{ref}</span>} />
              )}
              <div className="border-t pt-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Amount</span>
                <span className="text-xl font-bold tabular-nums text-success">
                  PKR {fmtPKR(amount)}
                </span>
              </div>
            </div>
            {saveError ? (
              <div
                role="alert"
                aria-live="assertive"
                className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 flex items-start gap-2"
              >
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-destructive">Payment didn't save</p>
                  <p className="text-xs text-destructive/80 break-words">{saveError}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Your selected booking and details are kept — tap Retry to try again.
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center">
                Please review — this will post to the ledger.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Footer action */}
      <div
        className="px-4 pt-3 border-t bg-background"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
      >
        {step === 0 && (
          <Button
            className="w-full h-14 text-base font-semibold"
            disabled={!canNext0}
            aria-describedby="wizard-validation-hint"
            onClick={() => setStep(1)}
          >
            Continue
          </Button>
        )}
        {step === 1 && (
          <Button
            className="w-full h-14 text-base font-semibold"
            disabled={!canNext1}
            aria-describedby="wizard-validation-hint"
            onClick={() => setStep(2)}
          >
            Review
          </Button>
        )}
        {/* Polite live region for step-validation messages (screen readers). */}
        <p id="wizard-validation-hint" role="status" aria-live="polite" className="sr-only">
          {validationHint}
        </p>
        {step === 2 && (
          <Button
            className={cn(
              "w-full h-14 text-base font-semibold",
              saveError
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-success text-success-foreground hover:bg-success/90",
            )}
            disabled={saving}
            onClick={doSave}
            aria-label={saveError ? "Retry saving payment" : "Confirm and save payment"}
          >
            {saving ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Saving…
              </>
            ) : saveError ? (
              <>
                <RefreshCw className="h-5 w-5 mr-2" /> Retry
              </>
            ) : (
              "Confirm & Save"
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm text-right truncate">{value}</span>
    </div>
  );
}
