import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "@/lib/router-compat";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge, statusTone } from "@/components/StatusBadge";
import { fmtDate, fmtPKR, maskCNIC } from "@/lib/format";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Printer, Calculator, Plus, ArrowRightLeft, Loader2, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import BookingDocumentEditor from "@/components/BookingDocumentEditor";
import DocumentVault from "@/components/DocumentVault";
import { PaymentHistoryButton } from "@/components/PaymentHistoryDialog";
import { preparePrint } from "@/lib/printFlow";
import { toast } from "@/hooks/use-toast";
import { AdminOnly } from "@/lib/adminGate";
import { RestructurePlanButton } from "@/components/RestructurePlanDialog";
import { AdjustmentFormDialog } from "@/components/AdjustmentForm";
import { usePIIGuardedQuery, AccessDenied } from "@/lib/access";
import { callRpc } from "@/integrations/supabase/approvedRpc";
import { EditPaymentDialog } from "@/components/EditPaymentDialog";
export default function BookingDetail() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const [adjOpen, setAdjOpen] = useState(false);
  const recalc = useMutation({
    mutationFn: async () => {
      const { error } = await callRpc("recalculate_ledger_for_booking", { _booking_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: `Recalculated ${id}` });
      qc.invalidateQueries({ queryKey: ["booking", id] });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Recalculate failed", description: e.message }),
  });
  const { data, isLoading, accessDenied } = usePIIGuardedQuery<{
    booking: any;
    ledger: any[];
    payments: any[];
    adjustments: any[];
  }>({
    queryKey: ["booking", id],
    queryFn: async () => {
      const [b, ledger, pays, adj] = await Promise.all([
        supabase.from("bookings").select("*").eq("booking_id", id).maybeSingle(),
        supabase.from("installment_ledger").select("*").eq("booking_id", id).order("term_no"),
        supabase.from("payments").select("*").eq("booking_id", id).order("payment_date"),
        supabase.from("adjustments").select("*").eq("booking_id", id),
      ]);
      return {
        booking: b.data,
        ledger: ledger.data ?? [],
        payments: pays.data ?? [],
        adjustments: adj.data ?? [],
      };
    },
  });

  if (accessDenied)
    return (
      <AccessDenied
        title="Booking detail restricted"
        description="Client PII and ledger data are only visible to admin, manager, and staff roles."
      />
    );
  if (isLoading || !data) return <div className="text-muted-foreground">Loading booking…</div>;
  if (!data.booking)
    return (
      <div className="card-elevated p-10 text-center">
        <div className="text-lg font-semibold">Booking not found</div>
        <Link to="/bookings" className="text-primary text-sm hover:underline mt-2 inline-block">
          ← Back to bookings
        </Link>
      </div>
    );
  const b = data.booking;

  const today = new Date().toISOString().slice(0, 10);
  const ledgerWithStatus = data.ledger
    .filter((l: any) => {
      const due = Number(l.due_amount) || 0;
      const paid = Number(l.paid_amount) || 0;
      const label = String(l.particulars ?? "").trim();
      // Drop completely empty rows (no due, no paid, no label, no due date).
      return due > 0 || paid > 0 || label.length > 0 || !!l.due_date;
    })
    .map((l: any) => {
      const due = Number(l.due_amount) || 0;
      const paid = Number(l.paid_amount) || 0;
      const remaining = Math.max(due - paid, 0);
      const isInstallment = !/down payment|possession/i.test(l.particulars ?? "");
      let status: string = l.status ?? "Pending";
      if (remaining <= 0) status = "Paid";
      else if (paid > 0 && remaining > 0) status = "Partial";
      else if (isInstallment && l.due_date && l.due_date < today) status = "Overdue";
      else status = "Pending";
      const days =
        isInstallment && l.due_date && l.due_date < today && remaining > 0
          ? Math.floor((Date.now() - new Date(l.due_date).getTime()) / 86400000)
          : 0;
      return { ...l, _status: status, _remaining: remaining, _days: days };
    });

  return (
    <div>
      <Link
        to="/bookings"
        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-3"
      >
        <ChevronLeft className="h-3 w-3" /> All bookings
      </Link>
      <PageHeader
        title={b.client_name ?? ""}
        description={`${b.booking_id} · ${b.unit_id} · ${b.project_name}`}
        actions={
          <>
            <StatusBadge label={`Risk ${b.risk_level}`} tone={statusTone(b.risk_level)} />
            <StatusBadge label={b.booking_status ?? ""} tone={statusTone(b.booking_status)} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => recalc.mutate()}
              disabled={recalc.isPending}
            >
              <Calculator className={`h-4 w-4 mr-1 ${recalc.isPending ? "animate-pulse" : ""}`} />
              {recalc.isPending ? "Recalculating…" : "Recalculate"}
            </Button>
            <AdminOnly>
              <RestructurePlanButton booking={b} ledger={data.ledger} />
            </AdminOnly>
            <Button variant="outline" size="sm" onClick={() => setAdjOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Adjustment
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/plans/${b.booking_id}`}>
                <Printer className="h-4 w-4 mr-1" />
                Installment Plan
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void preparePrint({ title: `Booking ${b.booking_id}` })}
            >
              <Printer className="h-4 w-4 mr-1" />
              Print
            </Button>
          </>
        }
      />

      <AdjustmentFormDialog
        open={adjOpen}
        onOpenChange={setAdjOpen}
        booking={{
          booking_id: b.booking_id,
          client_name: b.client_name,
          client_ref: b.client_ref,
          unit_id: b.unit_id,
          project_name: b.project_name,
          total_contract_value: b.total_contract_value,
          down_payment: b.down_payment,
          adjustment_credit: b.adjustment_credit,
          cash_received: b.cash_received,
          remaining_balance: b.remaining_balance,
        }}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { l: "Contract Value", v: fmtPKR(b.total_contract_value) },
          { l: "Down Payment", v: fmtPKR(b.down_payment) },
          { l: "Adjustment Credit", v: fmtPKR(b.adjustment_credit) },
          { l: "Cash Received", v: fmtPKR(b.cash_received) },
          { l: "Remaining Balance", v: fmtPKR(b.remaining_balance), tone: "danger" as const },
          { l: "Overdue Count", v: String(b.current_overdue_count ?? 0) },
          { l: "Overdue Amount", v: fmtPKR(b.total_overdue_amount) },
          { l: "Possession Due", v: fmtDate(b.possession_due_date) },
        ].map((k) => (
          <div key={k.l} className="card-elevated p-4">
            <div className="text-xs text-muted-foreground">{k.l}</div>
            <div
              className={`text-lg font-semibold mt-1 tabular-nums ${k.tone === "danger" ? "text-destructive" : ""}`}
            >
              {k.v}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="card-elevated p-5 lg:col-span-1">
          <div className="text-sm font-semibold mb-3">Client</div>
          <dl className="space-y-1.5 text-sm">
            <Row k="Name" v={<span className="capitalize">{b.client_name}</span>} />
            <Row k="S/O / W/O" v={b.so_wo} />
            <Row k="CNIC" v={<span className="font-mono">{maskCNIC(b.cnic)}</span>} />
            <Row k="Mobile" v={<span className="font-mono">{b.mobile}</span>} />
            <Row k="Address" v={b.address} />
          </dl>
        </div>
        <div className="card-elevated p-5">
          <div className="text-sm font-semibold mb-3">Unit & Pricing</div>
          <dl className="space-y-1.5 text-sm">
            <Row k="Unit" v={<span className="font-mono">{b.unit_id}</span>} />
            <Row k="Type / Floor" v={`${b.unit_type ?? "—"} · ${b.floor ?? "—"}`} />
            <Row k="Size (sqft)" v={fmtPKR(b.size_sqft)} />
            <Row k="Sold Rate / sqft" v={fmtPKR(b.sold_rate)} />
            <Row k="Sold Value" v={fmtPKR(b.sold_unit_value)} />
            <Row k="Price Loss vs Standard" v={fmtPKR(b.price_loss)} />
          </dl>
        </div>
        <div className="card-elevated p-5">
          <div className="text-sm font-semibold mb-3">Plan & Commission</div>
          <dl className="space-y-1.5 text-sm">
            <Row k="No. of Installments" v={b.no_of_installments} />
            <Row k="Frequency" v={b.installment_frequency} />
            <Row k="Installment Amount" v={fmtPKR(b.installment_amount)} />
            <Row k="Possession Amount" v={fmtPKR(b.possession_amount)} />
            <Row k="Dealer" v={b.dealer_name} />
            <Row k="Commission" v={fmtPKR(b.dealer_commission_amount)} />
          </dl>
        </div>
      </div>

      <div className="card-elevated overflow-hidden mb-6">
        <div className="p-4 border-b text-sm font-semibold">
          Installment Ledger ({ledgerWithStatus.length} terms)
        </div>
        <div className="overflow-x-auto max-h-[55vh]">
          <table className="w-full text-sm table-sticky">
            <thead className="text-xs text-muted-foreground bg-card">
              <tr>
                <th className="text-left px-4 py-2 font-medium">#</th>
                <th className="text-left px-4 py-2 font-medium">Particulars</th>
                <th className="text-left px-4 py-2 font-medium">Due Date</th>
                <th className="text-right px-4 py-2 font-medium">Due</th>
                <th className="text-right px-4 py-2 font-medium">Paid</th>
                <th className="text-right px-4 py-2 font-medium">Remaining</th>
                <th className="text-left px-4 py-2 font-medium">Paid Date</th>
                <th className="text-right px-4 py-2 font-medium">Days Late</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {ledgerWithStatus.map((l: any) => (
                <tr
                  key={l.ledger_id}
                  className={`border-t ${l._status === "Overdue" ? "bg-destructive/5" : ""}`}
                >
                  <td className="px-4 py-2 text-muted-foreground">{l.term_no}</td>
                  <td className="px-4 py-2">{l.particulars}</td>
                  <td className="px-4 py-2">{fmtDate(l.due_date)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtPKR(l.due_amount)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtPKR(l.paid_amount)}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium">
                    {fmtPKR(l._remaining)}
                  </td>
                  <td className="px-4 py-2">{fmtDate(l.paid_date)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{l._days || "—"}</td>
                  <td className="px-4 py-2">
                    <StatusBadge label={l._status} tone={statusTone(l._status)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card-elevated overflow-hidden">
        <div className="p-4 border-b text-sm font-semibold flex items-center justify-between">
          <span>Payment History ({data.payments.length})</span>
          <PaymentHistoryButton bookingId={b.booking_id} />
        </div>
        <div className="overflow-x-auto max-h-[40vh]">
          <table className="w-full text-sm table-sticky">
            <thead className="text-xs text-muted-foreground bg-card">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Receipt</th>
                <th className="text-left px-4 py-2 font-medium">Date</th>
                <th className="text-left px-4 py-2 font-medium">Head</th>
                <th className="text-left px-4 py-2 font-medium">Mode</th>
                <th className="text-left px-4 py-2 font-medium">Account</th>
                <th className="text-right px-4 py-2 font-medium">Amount</th>
                <th className="text-right px-4 py-2 font-medium">Safe Cash</th>
                <th className="text-right px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p: any) => (
                <tr key={p.receipt_no} className="border-t">
                  <td className="px-4 py-2 font-mono text-xs text-primary">{p.receipt_no}</td>
                  <td className="px-4 py-2">{fmtDate(p.payment_date)}</td>
                  <td className="px-4 py-2">{p.payment_head}</td>
                  <td className="px-4 py-2">
                    <StatusBadge
                      label={p.payment_mode}
                      tone={p.payment_mode === "Adjustment" ? "adjustment" : "info"}
                    />
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{p.account}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtPKR(p.amount)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {fmtPKR(p.safe_cash_amount)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <AdminOnly>
                      <div className="flex items-center justify-end gap-2">
                        <ReallocatePaymentDropdown payment={p} ledger={ledgerWithStatus} bookingId={b.booking_id} />
                        <EditPaymentDialog payment={p} bookingId={b.booking_id} />
                        <DeletePaymentDialog payment={p} bookingId={b.booking_id} />
                      </div>
                    </AdminOnly>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6">
        <DocumentVault bookingId={b.booking_id} />
      </div>

      <div className="mt-6">
        <BookingDocumentEditor booking={b} payments={data.payments} ledger={ledgerWithStatus} />
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex justify-between gap-3 border-b border-dashed border-border/70 pb-1.5">
      <dt className="text-muted-foreground text-xs">{k}</dt>
      <dd className="text-right">{v ?? "—"}</dd>
    </div>
  );
}

function ReallocatePaymentDropdown({ payment, ledger, bookingId }: { payment: any; ledger: any[]; bookingId: string }) {
  const qc = useQueryClient();
  const [moving, setMoving] = useState(false);

  // Allow selecting ANY ledger term (even if fully paid) so they can easily fix misallocations
  const targets = ledger;

  if (targets.length === 0) return null;

  const handleMove = async (targetRow: any) => {
    setMoving(true);
    try {
      let headLabel = "Installment";
      if (/possession/i.test(targetRow.particulars ?? "")) headLabel = "Possession";
      if (/down/i.test(targetRow.particulars ?? "")) headLabel = "Downpayment";
      
      const patch = {
        payment_date: payment.payment_date,
        payment_mode: payment.payment_mode,
        payment_head: headLabel,
        amount: payment.amount,
        account: payment.account || "",
        cheque_txn_no: payment.cheque_txn_no || "",
        posted_by: payment.posted_by || "",
        received_from: payment.received_from || "",
        remarks: `Moved to ${headLabel} via Quick Action`,
      };

      const { error } = await callRpc("admin_edit_payment", {
        _receipt_no: payment.receipt_no,
        _patch: patch,
        _reason: `Quick-moved to ${targetRow.particulars || headLabel}`,
        _allocations: [
          {
            ledger_id: targetRow.ledger_id,
            head_label: headLabel,
            amount: payment.amount,
          },
        ],
      });

      if (error) throw error;
      toast({ title: `Payment moved to ${headLabel}` });
      qc.invalidateQueries({ queryKey: ["booking", bookingId] });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Move failed", description: e.message });
    } finally {
      setMoving(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs rounded-full bg-secondary text-secondary-foreground hover:bg-secondary/80"
          disabled={moving}
          title="Reallocate Payment"
        >
          {moving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />}
          Reallocate
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 max-h-64 overflow-y-auto">
        {targets.map((t: any) => (
          <DropdownMenuItem key={t.ledger_id} onClick={() => handleMove(t)}>
            To: {t.particulars || "Unnamed Term"} 
            {t._remaining > 0 ? ` (Due: ${fmtPKR(t._remaining)})` : ""}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DeletePaymentDialog({ payment, bookingId }: { payment: any; bookingId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const { error } = await callRpc("admin_delete_payment", {
        _receipt_no: payment.receipt_no,
        _reason: "Deleted by Super Admin via Quick Action",
      });

      if (error) throw error;
      toast({ title: "Payment deleted successfully" });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["booking", bookingId] });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Delete failed", description: e.message });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="destructive"
          size="sm"
          className="h-7 w-7 p-0 rounded-full"
          title="Delete Payment"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Payment</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to completely delete receipt {payment.receipt_no} for {fmtPKR(payment.amount)}? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
            Confirm Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
