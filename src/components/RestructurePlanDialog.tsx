import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { fmtPKR, fmtDate } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertTriangle, Check, Plus, Trash2 } from "lucide-react";
import { addMonths, addQuarters, addWeeks, format, parseISO } from "date-fns";
import { callRpc } from "@/integrations/supabase/approvedRpc";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  booking: any;
  ledger: any[];
}

type NewRow = { term_no: number | null; particulars: string; due_date: string; due_amount: number };

const FREQUENCIES = ["Monthly", "Quarterly", "Semi-Annual", "Annual"] as const;

function addByFreq(d: Date, freq: string, n: number): Date {
  if (freq === "Monthly") return addMonths(d, n);
  if (freq === "Quarterly") return addQuarters(d, n);
  if (freq === "Semi-Annual") return addMonths(d, n * 6);
  if (freq === "Annual") return addMonths(d, n * 12);
  return addWeeks(d, n);
}

export function RestructurePlanDialog({ open, onOpenChange, booking, ledger }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const contract = Number(booking?.total_contract_value ?? 0);

  const paidRows = useMemo(
    () => (ledger ?? []).filter((r: any) => Number(r.paid_amount) > 0),
    [ledger],
  );
  const paidSum = paidRows.reduce((s, r: any) => s + Number(r.due_amount || 0), 0);

  // Editable "new plan" fields (only future / unpaid schedule)
  const [noInst, setNoInst] = useState<number>(Number(booking?.no_of_installments ?? 12));
  const [freq, setFreq] = useState<string>(String(booking?.installment_frequency ?? "Quarterly"));
  const [firstDue, setFirstDue] = useState<string>(
    booking?.first_installment_due
      ? format(parseISO(booking.first_installment_due), "yyyy-MM-dd")
      : format(new Date(), "yyyy-MM-dd"),
  );
  const [instAmt, setInstAmt] = useState<number>(Number(booking?.installment_amount ?? 0));
  const [possAmt, setPossAmt] = useState<number>(Number(booking?.possession_amount ?? 0));
  const [possDue, setPossDue] = useState<string>(
    booking?.possession_due_date ? format(parseISO(booking.possession_due_date), "yyyy-MM-dd") : "",
  );
  const [reason, setReason] = useState("");

  // Manual override rows (optional): if set, replaces the generated list
  const [manual, setManual] = useState<NewRow[] | null>(null);

  const generated: NewRow[] = useMemo(() => {
    const out: NewRow[] = [];
    const start = firstDue ? parseISO(firstDue) : new Date();
    for (let i = 0; i < noInst; i++) {
      out.push({
        term_no: i + 1,
        particulars: `Installment ${String(i + 1).padStart(2, "0")}`,
        due_date: format(addByFreq(start, freq, i), "yyyy-MM-dd"),
        due_amount: instAmt,
      });
    }
    if (possAmt > 0) {
      out.push({
        term_no: noInst + 1,
        particulars: "Possession",
        due_date: possDue || format(addByFreq(start, freq, noInst), "yyyy-MM-dd"),
        due_amount: possAmt,
      });
    }
    return out;
  }, [noInst, freq, firstDue, instAmt, possAmt, possDue]);

  const rows = manual ?? generated;
  const newPlanTotal = rows.reduce((s, r) => s + Number(r.due_amount || 0), 0);
  const planIdentityTotal = paidSum + newPlanTotal;
  const matches = Math.abs(planIdentityTotal - contract) < 1;

  const [confirmOpen, setConfirmOpen] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await callRpc("admin_restructure_plan", {
        _booking_id: booking.booking_id,
        _new_schedule: rows.map((r) => ({
          term_no: r.term_no,
          particulars: r.particulars,
          due_date: r.due_date,
          due_amount: r.due_amount,
        })),
        _plan_meta: {
          no_of_installments: noInst,
          installment_amount: instAmt,
          installment_frequency: freq,
          first_installment_due: firstDue,
          possession_amount: possAmt,
          possession_due_date: possDue || null,
        },
        _reason: reason.trim(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({
        title: "Plan restructured",
        description: "New schedule saved and ledger recalculated.",
      });
      qc.invalidateQueries({ queryKey: ["booking", booking.booking_id] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      onOpenChange(false);
      setConfirmOpen(false);
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Restructure failed", description: e.message }),
  });

  const canSave = matches && reason.trim().length > 0 && rows.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Restructure payment plan · {booking?.booking_id}</DialogTitle>
          <DialogDescription>
            Only future/unpaid installments are regenerated. Historical payment records are never
            changed.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* CURRENT PLAN */}
          <div className="rounded-md border p-4 bg-muted/30">
            <div className="text-sm font-semibold mb-2">CURRENT PLAN</div>
            <dl className="text-sm space-y-1.5">
              <KV k="No. of Installments" v={booking?.no_of_installments} />
              <KV k="Installment Amount" v={fmtPKR(booking?.installment_amount)} />
              <KV k="Frequency" v={booking?.installment_frequency} />
              <KV k="First Installment" v={fmtDate(booking?.first_installment_due)} />
              <KV k="Possession Amount" v={fmtPKR(booking?.possession_amount)} />
              <KV k="Possession Due" v={fmtDate(booking?.possession_due_date)} />
              <KV k="Contract Value" v={fmtPKR(contract)} />
              <KV
                k="Already-paid rows preserved"
                v={`${paidRows.length} rows · ${fmtPKR(paidSum)}`}
              />
            </dl>
          </div>

          {/* NEW PLAN */}
          <div className="rounded-md border p-4">
            <div className="text-sm font-semibold mb-2">NEW PLAN (editable)</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <Label className="text-xs">No. of Installments</Label>
                <Input
                  type="number"
                  value={noInst}
                  onChange={(e) => {
                    setNoInst(Number(e.target.value || 0));
                    setManual(null);
                  }}
                />
              </div>
              <div>
                <Label className="text-xs">Installment Amount</Label>
                <Input
                  type="number"
                  value={instAmt}
                  onChange={(e) => {
                    setInstAmt(Number(e.target.value || 0));
                    setManual(null);
                  }}
                />
              </div>
              <div>
                <Label className="text-xs">Frequency</Label>
                <Select
                  value={freq}
                  onValueChange={(v) => {
                    setFreq(v);
                    setManual(null);
                  }}
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
                <Label className="text-xs">First Installment</Label>
                <Input
                  type="date"
                  value={firstDue}
                  onChange={(e) => {
                    setFirstDue(e.target.value);
                    setManual(null);
                  }}
                />
              </div>
              <div>
                <Label className="text-xs">Possession Amount</Label>
                <Input
                  type="number"
                  value={possAmt}
                  onChange={(e) => {
                    setPossAmt(Number(e.target.value || 0));
                    setManual(null);
                  }}
                />
              </div>
              <div>
                <Label className="text-xs">Possession Due</Label>
                <Input
                  type="date"
                  value={possDue}
                  onChange={(e) => {
                    setPossDue(e.target.value);
                    setManual(null);
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-md border overflow-hidden mt-2">
          <div className="p-3 border-b bg-muted/30 flex items-center justify-between text-xs">
            <span className="font-medium">Generated new schedule ({rows.length} rows)</span>
            {manual && (
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => setManual(null)}
              >
                Reset to auto-generated
              </button>
            )}
          </div>
          <div className="overflow-x-auto max-h-64">
            <table className="w-full text-xs">
              <thead className="bg-card text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left px-3 py-1.5">#</th>
                  <th className="text-left px-3 py-1.5">Particulars</th>
                  <th className="text-left px-3 py-1.5">Due date</th>
                  <th className="text-right px-3 py-1.5">Due amount</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-1.5">{r.term_no ?? i + 1}</td>
                    <td className="px-3 py-1.5">
                      <Input
                        className="h-7 text-xs"
                        value={r.particulars}
                        onChange={(e) =>
                          setManual([
                            ...rows.map((x, j) =>
                              j === i ? { ...x, particulars: e.target.value } : x,
                            ),
                          ])
                        }
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        type="date"
                        className="h-7 text-xs"
                        value={r.due_date}
                        onChange={(e) =>
                          setManual([
                            ...rows.map((x, j) =>
                              j === i ? { ...x, due_date: e.target.value } : x,
                            ),
                          ])
                        }
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Input
                        type="number"
                        className="h-7 text-xs text-right"
                        value={r.due_amount}
                        onChange={(e) =>
                          setManual([
                            ...rows.map((x, j) =>
                              j === i ? { ...x, due_amount: Number(e.target.value || 0) } : x,
                            ),
                          ])
                        }
                      />
                    </td>
                    <td className="px-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 min-h-11 min-w-11"
                        aria-label="Remove row"
                        onClick={() => setManual(rows.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="h-3 w-3 text-destructive" aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-2 border-t">
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setManual([
                  ...rows,
                  { term_no: rows.length + 1, particulars: "", due_date: "", due_amount: 0 },
                ])
              }
            >
              <Plus className="h-4 w-4 mr-1" /> Add row
            </Button>
          </div>
        </div>

        <div
          className={`rounded-md p-3 text-sm flex items-center justify-between tabular-nums
          ${matches ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}
        >
          <span>
            Paid preserved: <b>{fmtPKR(paidSum)}</b> + New plan total: <b>{fmtPKR(newPlanTotal)}</b>{" "}
            = <b>{fmtPKR(planIdentityTotal)}</b>
          </span>
          <span className="flex items-center gap-1.5">
            {matches ? (
              <>
                <Check className="h-4 w-4" /> Matches Contract Value {fmtPKR(contract)}
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4" /> Must equal Contract Value {fmtPKR(contract)}
              </>
            )}
          </span>
        </div>

        <div>
          <Label>Reason for Restructuring *</Label>
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Client requested extension, added 4 quarters."
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={() => setConfirmOpen(true)}>
            Restructure Plan
          </Button>
        </DialogFooter>

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm restructure</DialogTitle>
              <DialogDescription>
                You are restructuring <b>{booking?.client_name}</b>'s plan for{" "}
                <b>{booking?.unit_id}</b>. This will regenerate their installment schedule.
                <br />
                Existing payment records are not affected.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Confirm Restructure
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function KV({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex justify-between gap-3 border-b border-dashed pb-1">
      <dt className="text-muted-foreground text-xs">{k}</dt>
      <dd className="text-right tabular-nums">{v ?? "—"}</dd>
    </div>
  );
}

/** Small trigger button — visible only to admins. */
export function RestructurePlanButton({ booking, ledger }: { booking: any; ledger: any[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Restructure Plan
      </Button>
      {open && (
        <RestructurePlanDialog
          open={open}
          onOpenChange={setOpen}
          booking={booking}
          ledger={ledger}
        />
      )}
    </>
  );
}
