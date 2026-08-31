import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { toast } from "@/hooks/use-toast";
import { fmtPKR } from "@/lib/format";
import { callRpc } from "@/integrations/supabase/approvedRpc";

/**
 * Booking summary used inside the Adjustment form. Only the fields we
 * actually read from the UI are declared — everything else is ignored so
 * callers (Adjustments page, Booking Detail) can pass a plain booking row.
 */
type BookingLite = {
  booking_id: string;
  client_name: string | null;
  client_ref: string | null;
  unit_id: string | null;
  project_name?: string | null;
  total_contract_value?: number | null;
  down_payment?: number | null;
  adjustment_credit?: number | null;
  cash_received?: number | null;
  remaining_balance?: number | null;
};

type Adjustment = {
  adjustment_id: string;
  booking_id: string | null;
  client_name: string | null;
  approved_value: number | null;
  realized_value: number | null;
  status: string;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Compute the client's cash-remaining balance the way the ERP does.
 * Formula (per spec):
 *   remaining = Sale Price − Down Payment − Approved Adjustment Credit
 *               − Cash Installments Received
 *
 * The booking row already stores `remaining_balance` computed by the SQL
 * `recalculate_ledger_for_booking()` (which subtracts effective = cash + adj
 * from the contract). We reuse that when it is present so the number here
 * always matches what the rest of the app shows. When the booking hasn't
 * been recomputed yet we fall back to the raw formula.
 */
function computeCashRemaining(b: BookingLite): number {
  if (b.remaining_balance != null) return Math.max(num(b.remaining_balance), 0);
  const sale = num(b.total_contract_value);
  const down = num(b.down_payment);
  const adj = num(b.adjustment_credit);
  const cash = num(b.cash_received);
  return Math.max(sale - down - adj - cash, 0);
}

// ---------------------------------------------------------------------------
// Create / Edit adjustment
// ---------------------------------------------------------------------------

export function AdjustmentFormDialog({
  open,
  onOpenChange,
  booking,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Optional pre-selected booking (e.g. launched from Booking Detail). */
  booking?: BookingLite;
  onSaved?: (adjustmentId: string) => void;
}) {
  const qc = useQueryClient();
  const [bookingId, setBookingId] = useState<string>(booking?.booking_id ?? "");
  const [assetDescription, setAssetDescription] = useState("");
  const [approvedValue, setApprovedValue] = useState<string>("");
  const [approvalDate, setApprovalDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [approvedBy, setApprovedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedSummary, setSavedSummary] = useState<{
    adjustmentId: string;
    clientName: string;
    approved: number;
    newBalance: number;
  } | null>(null);

  // Reset form whenever the dialog re-opens.
  useEffect(() => {
    if (!open) return;
    setBookingId(booking?.booking_id ?? "");
    setAssetDescription("");
    setApprovedValue("");
    setApprovalDate(new Date().toISOString().slice(0, 10));
    setApprovedBy("");
    setNotes("");
    setErrors({});
    setSavedSummary(null);
  }, [open, booking?.booking_id]);

  // Booking list (only needed when not pre-selected).
  const { data: bookingOptions = [] } = useQuery<BookingLite[]>({
    queryKey: ["adj-booking-options"],
    enabled: open && !booking,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select(
          "booking_id, client_name, client_ref, unit_id, project_name, total_contract_value, down_payment, adjustment_credit, cash_received, remaining_balance",
        )
        .order("booking_id", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as BookingLite[];
    },
  });

  // Resolve the "current" booking (pre-selected, or picked from dropdown).
  const currentBooking: BookingLite | undefined = useMemo(() => {
    if (booking && bookingId === booking.booking_id) return booking;
    return bookingOptions.find((b) => b.booking_id === bookingId);
  }, [booking, bookingId, bookingOptions]);

  const currentRemaining = currentBooking ? computeCashRemaining(currentBooking) : 0;
  const approvedNum = num(approvedValue);
  const previewNewBalance = Math.max(currentRemaining - approvedNum, 0);

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!bookingId) e.bookingId = "Booking is required";
    if (assetDescription.trim().length < 3) {
      e.assetDescription = "Describe the asset (min 3 characters)";
    }
    if (!Number.isFinite(approvedNum) || approvedNum <= 0) {
      e.approvedValue = "Enter a positive amount";
    } else if (currentBooking && approvedNum > currentRemaining) {
      e.approvedValue = `Approved value cannot exceed the client's cash-remaining balance (${fmtPKR(currentRemaining)})`;
    }
    if (!approvalDate) e.approvalDate = "Approval date is required";
    if (approvedBy.trim().length < 2) e.approvedBy = "Enter the approver's name";
    return e;
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      // Auto-generate ADJ-###### id server-side.
      const { data: idRow, error: idErr } = await callRpc("next_adjustment_id" as any, {} as any);
      if (idErr) throw idErr;
      const nextId = String(idRow ?? "");
      if (!nextId) throw new Error("Could not allocate adjustment id");

      const payload = {
        adjustment_id: nextId,
        booking_id: bookingId,
        client_ref: currentBooking?.client_ref ?? null,
        client_name: currentBooking?.client_name ?? null,
        unit_id: currentBooking?.unit_id ?? null,
        asset_description: assetDescription.trim(),
        approved_value: approvedNum,
        approval_date: approvalDate,
        approved_by: approvedBy.trim(),
        note: notes.trim() || null,
        status: "PENDING" as const,
      };
      const { error } = await supabase.from("adjustments").insert(payload as any);
      if (error) throw error;
      return { adjustmentId: nextId };
    },
    onSuccess: ({ adjustmentId }) => {
      qc.invalidateQueries({ queryKey: ["adj"] });
      qc.invalidateQueries({ queryKey: ["booking", bookingId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setSavedSummary({
        adjustmentId,
        clientName: currentBooking?.client_name ?? bookingId,
        approved: approvedNum,
        newBalance: previewNewBalance,
      });
      onSaved?.(adjustmentId);
    },
    onError: (e: any) =>
      toast({
        variant: "destructive",
        title: "Could not save adjustment",
        description: e?.message ?? "Please try again.",
      }),
  });

  function handleSave() {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    saveMut.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Adjustment / Asset Credit</DialogTitle>
          <DialogDescription>
            Record an asset credit given to a client against a booking. The approved value reduces
            the client's cash-remaining balance.
          </DialogDescription>
        </DialogHeader>

        {savedSummary ? (
          <div className="rounded-lg border border-success/40 bg-success/5 p-4 text-sm space-y-1.5">
            <div className="font-semibold text-foreground">
              Adjustment {savedSummary.adjustmentId} recorded.
            </div>
            <div className="text-muted-foreground">
              Client{" "}
              <span className="font-medium text-foreground capitalize">
                {savedSummary.clientName}
              </span>{" "}
              balance reduced by{" "}
              <span className="font-medium text-foreground">{fmtPKR(savedSummary.approved)}</span>.
            </div>
            <div className="text-muted-foreground">
              New cash-remaining balance:{" "}
              <span className="font-medium text-foreground">{fmtPKR(savedSummary.newBalance)}</span>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Booking selector — only shown when not pre-selected. */}
            {!booking ? (
              <div className="space-y-1.5">
                <Label>Booking</Label>
                <Select value={bookingId} onValueChange={setBookingId}>
                  <SelectTrigger
                    aria-invalid={!!errors.bookingId}
                    aria-describedby={errors.bookingId ? "adj-booking-err" : undefined}
                  >
                    <SelectValue placeholder="Select booking…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {bookingOptions.map((b) => (
                      <SelectItem key={b.booking_id} value={b.booking_id}>
                        <span className="font-mono text-xs">{b.booking_id}</span> ·{" "}
                        <span className="capitalize">{b.client_name}</span> ·{" "}
                        <span className="font-mono text-xs">{b.unit_id}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.bookingId ? (
                  <div id="adj-booking-err" className="text-xs text-destructive">
                    {errors.bookingId}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <div className="font-mono">{booking.booking_id}</div>
                <div className="capitalize text-foreground/80">{booking.client_name}</div>
                <div className="text-muted-foreground">
                  Unit {booking.unit_id ?? "—"} · {booking.project_name ?? ""}
                </div>
              </div>
            )}

            {currentBooking ? (
              <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground grid grid-cols-2 gap-y-1">
                <div>Sale price</div>
                <div className="text-right tabular-nums text-foreground">
                  {fmtPKR(currentBooking.total_contract_value ?? 0)}
                </div>
                <div>Down payment</div>
                <div className="text-right tabular-nums text-foreground">
                  {fmtPKR(currentBooking.down_payment ?? 0)}
                </div>
                <div>Existing adjustments</div>
                <div className="text-right tabular-nums text-foreground">
                  {fmtPKR(currentBooking.adjustment_credit ?? 0)}
                </div>
                <div>Cash received</div>
                <div className="text-right tabular-nums text-foreground">
                  {fmtPKR(currentBooking.cash_received ?? 0)}
                </div>
                <div className="font-medium text-foreground">Cash-remaining</div>
                <div className="text-right tabular-nums font-medium text-foreground">
                  {fmtPKR(currentRemaining)}
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label>Asset description</Label>
              <Input
                placeholder="e.g. Honda Civic 2020, Registration ABC-123"
                value={assetDescription}
                onChange={(e) => setAssetDescription(e.target.value)}
                aria-invalid={!!errors.assetDescription}
                aria-describedby={errors.assetDescription ? "adj-asset-err" : undefined}
              />
              {errors.assetDescription ? (
                <div id="adj-asset-err" className="text-xs text-destructive">
                  {errors.assetDescription}
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Approved value (PKR)</Label>
                <Input
                  type="number"
                  min={0}
                  inputMode="decimal"
                  value={approvedValue}
                  onChange={(e) => setApprovedValue(e.target.value)}
                  aria-invalid={!!errors.approvedValue}
                  aria-describedby={errors.approvedValue ? "adj-value-err" : undefined}
                />
                {errors.approvedValue ? (
                  <div id="adj-value-err" className="text-xs text-destructive">
                    {errors.approvedValue}
                  </div>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label>Approval date</Label>
                <Input
                  type="date"
                  value={approvalDate}
                  onChange={(e) => setApprovalDate(e.target.value)}
                  aria-invalid={!!errors.approvalDate}
                  aria-describedby={errors.approvalDate ? "adj-date-err" : undefined}
                />
                {errors.approvalDate ? (
                  <div id="adj-date-err" className="text-xs text-destructive">
                    {errors.approvalDate}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Approved by</Label>
              <Input
                placeholder="Approver name"
                value={approvedBy}
                onChange={(e) => setApprovedBy(e.target.value)}
                aria-invalid={!!errors.approvedBy}
                aria-describedby={errors.approvedBy ? "adj-approver-err" : undefined}
              />
              {errors.approvedBy ? (
                <div id="adj-approver-err" className="text-xs text-destructive">
                  {errors.approvedBy}
                </div>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            {currentBooking && approvedNum > 0 && !errors.approvedValue ? (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
                Client balance will decrease from{" "}
                <span className="font-medium">{fmtPKR(currentRemaining)}</span> to{" "}
                <span className="font-medium">{fmtPKR(previewNewBalance)}</span>.
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {savedSummary ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={saveMut.isPending}
              >
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saveMut.isPending}>
                {saveMut.isPending ? "Saving…" : "Save adjustment"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Mark as Realized
// ---------------------------------------------------------------------------

export function RealizeAdjustmentDialog({
  open,
  onOpenChange,
  adjustment,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  adjustment: Adjustment | null;
}) {
  const qc = useQueryClient();
  const [realizedValue, setRealizedValue] = useState<string>("");
  const [realizationDate, setRealizationDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setRealizedValue("");
    setRealizationDate(new Date().toISOString().slice(0, 10));
    setNotes("");
    setErrors({});
  }, [open]);

  const approved = num(adjustment?.approved_value);
  const realized = num(realizedValue);
  const diff = realized - approved;

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!adjustment) throw new Error("No adjustment selected");
      const { error } = await supabase
        .from("adjustments")
        .update({
          realized_value: realized,
          realization_date: realizationDate,
          status: "REALIZED",
          note: notes.trim() ? notes.trim() : undefined,
        } as any)
        .eq("adjustment_id", adjustment.adjustment_id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["adj"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast({
        title: `Marked ${adjustment?.adjustment_id} as realized`,
        description:
          diff < 0
            ? `Company loss of ${fmtPKR(Math.abs(diff))}`
            : diff > 0
              ? `Company gain of ${fmtPKR(diff)}`
              : "No loss or gain on this adjustment.",
      });
      onOpenChange(false);
    },
    onError: (e: any) =>
      toast({
        variant: "destructive",
        title: "Could not save realization",
        description: e?.message ?? "Please try again.",
      }),
  });

  function handleSave() {
    const e: Record<string, string> = {};
    if (!Number.isFinite(realized) || realized <= 0) {
      e.realizedValue = "Enter a positive realized value";
    }
    if (!realizationDate) e.realizationDate = "Realization date is required";
    setErrors(e);
    if (Object.keys(e).length) return;
    saveMut.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark asset as realized</DialogTitle>
          <DialogDescription>
            Record what the company actually received for the asset after taking possession.
          </DialogDescription>
        </DialogHeader>

        {adjustment ? (
          <div className="space-y-4">
            <div className="rounded-md bg-muted/40 p-3 text-xs">
              <div className="grid grid-cols-2 gap-y-1">
                <div className="text-muted-foreground">Adjustment</div>
                <div className="text-right font-mono">{adjustment.adjustment_id}</div>
                <div className="text-muted-foreground">Approved value</div>
                <div className="text-right tabular-nums">{fmtPKR(approved)}</div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Realized value (PKR)</Label>
              <Input
                type="number"
                min={0}
                inputMode="decimal"
                value={realizedValue}
                onChange={(e) => setRealizedValue(e.target.value)}
              />
              {errors.realizedValue ? (
                <div className="text-xs text-destructive">{errors.realizedValue}</div>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label>Realization date</Label>
              <Input
                type="date"
                value={realizationDate}
                onChange={(e) => setRealizationDate(e.target.value)}
              />
              {errors.realizationDate ? (
                <div className="text-xs text-destructive">{errors.realizationDate}</div>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label>Realization notes (optional)</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            {realized > 0 ? (
              <div
                className={`rounded-md border p-3 text-xs ${
                  diff < 0
                    ? "border-destructive/40 bg-destructive/5 text-destructive"
                    : diff > 0
                      ? "border-success/40 bg-success/5 text-success"
                      : "border-border bg-muted/40 text-muted-foreground"
                }`}
              >
                <div className="flex justify-between">
                  <span>Approved</span>
                  <span className="tabular-nums">{fmtPKR(approved)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Realized</span>
                  <span className="tabular-nums">{fmtPKR(realized)}</span>
                </div>
                <div className="flex justify-between font-medium mt-1">
                  <span>{diff < 0 ? "Company loss" : diff > 0 ? "Company gain" : "Even"}</span>
                  <span className="tabular-nums">{fmtPKR(Math.abs(diff))}</span>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saveMut.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saveMut.isPending}>
            {saveMut.isPending ? "Saving…" : "Save realization"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Waive
// ---------------------------------------------------------------------------

export function WaiveAdjustmentDialog({
  open,
  onOpenChange,
  adjustment,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  adjustment: Adjustment | null;
}) {
  const qc = useQueryClient();
  const approved = num(adjustment?.approved_value);

  const waiveMut = useMutation({
    mutationFn: async () => {
      if (!adjustment) throw new Error("No adjustment selected");
      const { error } = await supabase
        .from("adjustments")
        .update({ status: "WAIVED" } as any)
        .eq("adjustment_id", adjustment.adjustment_id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["adj"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast({
        title: `Waived ${adjustment?.adjustment_id}`,
        description: `${adjustment?.client_name ?? "Client"} balance increased by ${fmtPKR(approved)}.`,
      });
      onOpenChange(false);
    },
    onError: (e: any) =>
      toast({
        variant: "destructive",
        title: "Could not waive adjustment",
        description: e?.message ?? "Please try again.",
      }),
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Waive this adjustment?</AlertDialogTitle>
          <AlertDialogDescription>
            Waiving this adjustment will increase{" "}
            <span className="font-medium capitalize text-foreground">
              {adjustment?.client_name ?? "the client"}
            </span>
            ’s balance by <span className="font-medium text-foreground">{fmtPKR(approved)}</span>.
            The installment ledger will be recomputed automatically. Are you sure?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={waiveMut.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              waiveMut.mutate();
            }}
            disabled={waiveMut.isPending}
          >
            {waiveMut.isPending ? "Waiving…" : "Waive adjustment"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
