import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Edit2, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { callRpc } from "@/integrations/supabase/approvedRpc";

const PAYMENT_HEADS = ["Downpayment", "Installment", "Possession", "Other"];
const PAYMENT_MODES = ["Cash", "Online", "Cheque", "PayOrder", "Adjustment/Asset"];


export function EditPaymentDialog({ payment, bookingId }: { payment: any; bookingId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(payment.amount?.toString() || "");
  const [date, setDate] = useState(payment.payment_date?.substring(0, 10) || "");
  const [head, setHead] = useState(payment.payment_head || "Installment");
  const [mode, setMode] = useState(payment.payment_mode || "Cash");
  const [account, setAccount] = useState(payment.account || "");
  const [txnNo, setTxnNo] = useState(payment.cheque_txn_no || "");
  const [reason, setReason] = useState("");

  const editMut = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw new Error("A reason for editing is required.");

      const patch = {
        amount: Number(amount),
        payment_date: date,
        payment_head: head,
        payment_mode: mode,
        account: account,
        cheque_txn_no: txnNo,
      };

      const { error } = await callRpc("admin_edit_payment", {
        _receipt_no: payment.receipt_no,
        _patch: patch,
        _reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Payment edited successfully" });
      qc.invalidateQueries({ queryKey: ["booking", bookingId] });
      setOpen(false);
      setReason(""); // reset
    },
    onError: (e: Error) => {
      toast({ variant: "destructive", title: "Edit failed", description: e.message });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button // allow-small-tap: inline table action
          variant="outline"
          size="icon"
          className="h-7 w-7 rounded-full bg-secondary text-secondary-foreground hover:bg-secondary/80"
          title="Edit Payment"
          aria-label="Edit Payment"
        >
          <Edit2 className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Edit Payment {payment.receipt_no}</DialogTitle>
          <DialogDescription>
            Update payment details. You must provide a reason for the audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Payment Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Payment Head</Label>
              <Select value={head} onValueChange={setHead}>
                <SelectTrigger>
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
            <div className="space-y-2">
              <Label>Payment Mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Account</Label>
              <Input
                placeholder="e.g. HBL"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Instrument/Txn No</Label>
              <Input
                placeholder="e.g. CHQ-123"
                value={txnNo}
                onChange={(e) => setTxnNo(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2 border-t pt-4">
            <Label>
              Reason for Edit <span className="text-red-500">*</span>
            </Label>
            <Input
              placeholder="e.g. Corrected typo in amount"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => editMut.mutate()} disabled={editMut.isPending || !reason.trim()}>
            {editMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
