import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toPng } from "html-to-image";
import { X, Loader2, MessageCircle, Wrench, Share2, Check, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmtPKR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StatusBadge, statusTone } from "@/components/StatusBadge";

type ChargeStatus = "Paid" | "Overdue" | "Due Soon" | "Upcoming" | "Partial" | "Waived";
type PayMode = "Cash" | "Cheque" | "Online Transfer" | "Bank Draft";

const PAY_MODES: PayMode[] = ["Cash", "Cheque", "Online Transfer", "Bank Draft"];

type Charge = {
  id: string;
  charge_id: string;
  unit_id: string;
  booking_id: string | null;
  project_code: string;
  project_name: string | null;
  client_name: string | null;
  charge_name: string;
  period: string;
  amount_due: number;
  late_fee: number;
  total_due: number;
  due_date: string;
  paid_amount: number;
  balance: number;
  status: ChargeStatus;
  waived: boolean;
};

type Payment = {
  id: string;
  receipt_no: string;
  amount_paid: number;
  payment_date: string;
  payment_mode: PayMode;
  reference_no: string | null;
};

// Status tone is derived via the shared statusTone() heuristic so this
// list stays visually in sync with Bookings, Payments, Ledger, etc.

export function MobileMaintenance() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [collect, setCollect] = useState<Charge | null>(null);

  const chargesQ = useQuery({
    queryKey: ["mx-charges-mobile"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_charges")
        .select("*")
        .order("due_date", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Charge[];
    },
  });

  const rows = chargesQ.data ?? [];
  const thisMonth = new Date().toISOString().slice(0, 7);
  const summary = useMemo(() => {
    const monthRows = rows.filter((r) => r.due_date?.startsWith(thisMonth));
    const collected = monthRows.reduce((s, r) => s + Number(r.paid_amount), 0);
    const outstanding = rows.filter((r) => !r.waived).reduce((s, r) => s + Number(r.balance), 0);
    const overdueCount = rows.filter((r) => r.status === "Overdue").length;
    return { collected, outstanding, overdueCount };
  }, [rows, thisMonth]);

  return (
    <div className="pb-24">
      <div className="px-4 pt-3 pb-3">
        <h1 className="text-2xl font-bold">Maintenance</h1>
        <p className="text-sm text-muted-foreground">Charges, collections & reminders</p>
      </div>

      {/* Summary chips */}
      <div className="px-4 pb-4">
        <div className="grid grid-cols-3 gap-2">
          <StatChip
            label="Collected"
            value={`PKR ${fmtPKR(summary.collected)}`}
            tone="text-emerald-600"
          />
          <StatChip
            label="Outstanding"
            value={`PKR ${fmtPKR(summary.outstanding)}`}
            tone="text-amber-600"
          />
          <StatChip label="Overdue" value={String(summary.overdueCount)} tone="text-red-600" />
        </div>
      </div>

      {/* List */}
      <div className="px-4 space-y-2">
        {chargesQ.isLoading ? (
          <div className="grid place-items-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border bg-card p-8 text-center">
            <Wrench className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
            <p className="font-medium">No maintenance charges</p>
            <p className="text-sm text-muted-foreground">
              Set up schedules on desktop to generate charges.
            </p>
          </div>
        ) : (
          rows.map((c) => {
            const overdue = c.status === "Overdue";
            return (
              <div
                key={c.id}
                className={cn(
                  "rounded-2xl border bg-card p-3",
                  overdue && "border-l-4 border-l-destructive",
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold">{c.unit_id}</span>
                      <StatusBadge label={c.status} tone={statusTone(c.status)} />
                    </div>
                    <p className="text-sm truncate text-muted-foreground">{c.client_name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {c.period} · Due {c.due_date}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold tabular-nums">PKR {fmtPKR(c.total_due)}</div>
                    {c.balance > 0 && (
                      <div className="text-xs text-muted-foreground">Bal {fmtPKR(c.balance)}</div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  {c.balance > 0 && (
                    <Button size="sm" className="flex-1 min-h-11" onClick={() => setCollect(c)}>
                      Collect
                    </Button>
                  )}
                  {overdue && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 min-h-11 border-emerald-500/40 text-emerald-700"
                      onClick={() => void sendWhatsAppReminder(c)}
                      aria-label={`Send WhatsApp reminder to ${c.client_name ?? "client"}`}
                    >
                      <MessageCircle className="h-4 w-4 mr-1.5" /> WhatsApp
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {collect && (
        <MobileCollectSheet
          charge={collect}
          isAdmin={isAdmin}
          onClose={() => setCollect(null)}
          onCollected={() => qc.invalidateQueries({ queryKey: ["mx-charges-mobile"] })}
        />
      )}
    </div>
  );
}

function StatChip({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-bold tabular-nums mt-1 truncate", tone)}>{value}</div>
    </div>
  );
}

async function sendWhatsAppReminder(c: Charge) {
  let mobile: string | null = null;
  if (c.booking_id) {
    const { data } = await supabase
      .from("bookings")
      .select("mobile")
      .eq("booking_id", c.booking_id)
      .maybeSingle();
    mobile = (data as { mobile: string | null } | null)?.mobile ?? null;
  }
  const msg = `Assalam o Alaikum ${c.client_name ?? "Client"} sahib,

Gentle reminder: maintenance charges for Unit ${c.unit_id}, ${c.project_name ?? c.project_code} for ${c.period} amounting to PKR ${fmtPKR(Number(c.total_due))} were due on ${c.due_date}.

Kindly arrange payment at your earliest convenience.

Regards,
Precise Realtors & Builders`;
  const cleaned = (mobile ?? "").replace(/[^\d]/g, "");
  const base = cleaned ? `https://wa.me/${cleaned}` : "https://wa.me/";
  window.open(`${base}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
}

function MobileCollectSheet({
  charge,
  onClose,
  onCollected,
  isAdmin,
}: {
  charge: Charge;
  onClose: () => void;
  onCollected: () => void;
  isAdmin: boolean;
}) {
  const [amount, setAmount] = useState(String(Number(charge.balance) || charge.total_due));
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState<PayMode>("Cash");
  const [ref, setRef] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Payment | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);

  const mut = useMutation({
    mutationFn: async () => {
      setErr(null);
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Amount must be greater than zero");
      if (mode !== "Cash" && !ref.trim()) throw new Error("Reference No is required for this mode");
      const { data, error } = await supabase
        .from("maintenance_payments")
        .insert({
          charge_id: charge.charge_id,
          unit_id: charge.unit_id,
          client_name: charge.client_name,
          amount_paid: amt,
          payment_date: payDate,
          payment_mode: mode,
          reference_no: ref.trim() || null,
          notes: notes.trim() || null,
          late_fee_waived: false,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as Payment;
    },
    onSuccess: (p) => {
      toast.success(`Receipt ${p.receipt_no} saved`);
      setReceipt(p);
      onCollected();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const shareReceipt = async () => {
    if (!receiptRef.current) return;
    try {
      const dataUrl = await toPng(receiptRef.current, {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `receipt-${receipt?.receipt_no ?? "maintenance"}.png`, {
        type: "image/png",
      });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Maintenance Receipt" });
      } else {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = file.name;
        a.click();
        toast.success("Receipt downloaded — share it via WhatsApp");
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") toast.error("Couldn't share receipt");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full bg-background rounded-t-3xl max-h-[92vh] flex flex-col animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={receipt ? "Payment receipt" : "Collect maintenance payment"}
      >
        <div className="flex items-center justify-between px-4 h-14 border-b">
          <h2 className="font-semibold">{receipt ? "Payment Recorded" : "Collect Payment"}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="min-h-11 min-w-11 -mr-2 grid place-items-center"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {receipt ? (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <div
                ref={receiptRef}
                className="bg-card text-card-foreground rounded-2xl border p-5 space-y-3 max-w-sm mx-auto"
              >
                <div className="grid place-items-center">
                  <div className="h-14 w-14 rounded-full bg-emerald-100 grid place-items-center">
                    <Check className="h-7 w-7 text-emerald-600" strokeWidth={3} />
                  </div>
                </div>
                <div className="text-center">
                  <h3 className="text-lg font-bold">Maintenance Receipt</h3>
                  <p className="text-xs text-slate-500">Precise Realtors &amp; Builders</p>
                </div>
                <div className="border-t pt-3 space-y-1.5 text-sm">
                  <RRow label="Receipt No" value={receipt.receipt_no} mono />
                  <RRow label="Date" value={receipt.payment_date} />
                  <RRow label="Unit" value={charge.unit_id} />
                  <RRow label="Client" value={charge.client_name ?? "—"} />
                  <RRow label="Period" value={charge.period} />
                  <RRow label="Mode" value={receipt.payment_mode} />
                  {receipt.reference_no && (
                    <RRow label="Reference" value={receipt.reference_no} mono />
                  )}
                </div>
                <div className="border-t pt-3 flex items-center justify-between">
                  <span className="text-sm text-slate-500">Amount Paid</span>
                  <span className="text-xl font-bold tabular-nums">
                    PKR {fmtPKR(receipt.amount_paid)}
                  </span>
                </div>
                <p className="text-[10px] text-center text-slate-400 pt-2">
                  Thank you for your payment.
                </p>
              </div>
            </div>
            <div
              className="px-4 pt-3 pb-4 border-t space-y-2"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
            >
              <Button
                className="w-full h-14 text-base font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={shareReceipt}
              >
                <Share2 className="h-5 w-5 mr-2" /> Share on WhatsApp
              </Button>
              <Button variant="outline" className="w-full h-12" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              <div className="rounded-2xl border bg-muted/30 p-3 space-y-1 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Unit</span>
                  <span className="font-medium">{charge.unit_id}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Client</span>
                  <span className="font-medium truncate ml-2">{charge.client_name ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Period</span>
                  <span className="font-medium">{charge.period}</span>
                </div>
                <div className="flex items-center justify-between border-t pt-2 mt-2">
                  <span className="text-muted-foreground">Balance</span>
                  <span className="font-bold tabular-nums">
                    PKR {fmtPKR(charge.balance || charge.total_due)}
                  </span>
                </div>
              </div>

              {err && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  <AlertCircle className="h-4 w-4 mt-0.5" />
                  <span>{err}</span>
                </div>
              )}

              <div>
                <Label htmlFor="amt">Amount (PKR)</Label>
                <Input
                  id="amt"
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-12 text-lg font-semibold"
                />
              </div>

              <div>
                <Label>Payment Mode</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {PAY_MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={cn(
                        "h-12 rounded-xl border text-sm font-medium transition",
                        mode === m ? "border-primary bg-primary/5" : "bg-card",
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="pd">Payment Date</Label>
                  <Input
                    id="pd"
                    type="date"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="rf">Reference{mode !== "Cash" ? "*" : ""}</Label>
                  <Input id="rf" value={ref} onChange={(e) => setRef(e.target.value)} />
                </div>
              </div>

              <div>
                <Label htmlFor="nt">Notes</Label>
                <Textarea
                  id="nt"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            <div
              className="px-4 pt-3 border-t"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
            >
              <Button
                className="w-full h-14 text-base font-semibold"
                disabled={mut.isPending}
                onClick={() => mut.mutate()}
              >
                {mut.isPending ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Saving…
                  </>
                ) : (
                  "Confirm Payment"
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <span className={cn("text-sm text-right truncate", mono && "font-mono")}>{value}</span>
    </div>
  );
}
