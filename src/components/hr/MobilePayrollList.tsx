import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Share2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/lib/auth";
import { fmtPKR, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

// Mobile payroll card list used inside the payroll-run detail sheet.
// One card per payslip, with a big "Mark as Paid" primary action.
// Parent still owns the run header (period, totals, status).

type Payslip = {
  id: string;
  employee_id: string;
  basic_salary: number;
  allowances: number;
  gross_salary: number;
  working_days: number;
  present_days: number;
  absent_days: number;
  leave_days: number;
  half_days: number;
  late_days: number;
  deduction: number;
  net_salary: number;
  paid_at: string | null;
  hr_employees?: {
    full_name?: string | null;
    employee_id?: string | null;
    department?: string | null;
    designation?: string | null;
    bank_name?: string | null;
    bank_account?: string | null;
  } | null;
};

export function MobilePayrollList({
  runId,
  slips,
  onOpenPayslip,
}: {
  runId: string;
  slips: Payslip[];
  onOpenPayslip: (p: Payslip) => void;
}) {
  const qc = useQueryClient();
  const { companyId } = useAuth();

  const markPaid = useMutation({
    mutationFn: async ({ id, paid }: { id: string; paid: boolean }) => {
      const { error } = await supabase
        .from("hr_payslips" as any)
        .update({ paid_at: paid ? new Date().toISOString() : null })
        .eq("id", id)
        .eq("company_id", companyId!);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.paid ? "Marked as paid" : "Marked as unpaid");
      qc.invalidateQueries({ queryKey: ["hr-payslips", runId] });
      qc.invalidateQueries({ queryKey: ["hr-payroll-runs"] });
    },
    onError: (err: any) => toast.error(err?.message ?? "Could not update payslip"),
  });

  const markAllPaid = useMutation({
    mutationFn: async () => {
      const ids = slips.filter((s) => !s.paid_at).map((s) => s.id);
      if (ids.length === 0) return 0;
      const { error } = await supabase
        .from("hr_payslips" as any)
        .update({ paid_at: new Date().toISOString() })
        .in("id", ids)
        .eq("company_id", companyId!);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (n) => {
      if (n) toast.success(`Processed ${n} payslip${n === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["hr-payslips", runId] });
      qc.invalidateQueries({ queryKey: ["hr-payroll-runs"] });
    },
    onError: (err: any) => toast.error(err?.message ?? "Could not process payroll"),
  });

  const unpaidCount = slips.filter((s) => !s.paid_at).length;

  return (
    <div className="md:hidden">
      <div className="mb-3 flex items-center justify-end">
        <Button
          type="button"
          onClick={() => markAllPaid.mutate()}
          disabled={unpaidCount === 0 || markAllPaid.isPending}
          // Orange call-to-action per spec — falls back to warning token so
          // the iOS theme override keeps it consistent.
          className="min-h-11 bg-warning text-warning-foreground hover:bg-warning/90"
        >
          <CheckCircle2 className="h-4 w-4 mr-2" aria-hidden="true" />
          {markAllPaid.isPending
            ? "Processing…"
            : unpaidCount > 0
              ? `Process All Payroll (${unpaidCount})`
              : "All Paid"}
        </Button>
      </div>

      {slips.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No payslips in this run.
        </Card>
      ) : (
        <div className="space-y-2">
          {slips.map((p) => {
            const name = p.hr_employees?.full_name ?? "—";
            const eid = p.hr_employees?.employee_id ?? "—";
            const paid = !!p.paid_at;
            return (
              <Card key={p.id} className={cn("p-3", paid && "opacity-90")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold capitalize truncate">{name}</div>
                    <div className="text-[11px] font-mono text-muted-foreground">
                      {eid} · {p.hr_employees?.department ?? "—"}
                    </div>
                  </div>
                  {paid && <StatusBadge label="Paid" tone="success" />}
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                  <Stat label="Gross" value={fmtPKR(p.gross_salary)} />
                  <Stat
                    label="Deduct"
                    value={p.deduction > 0 ? `-${fmtPKR(p.deduction)}` : "—"}
                    tone={p.deduction > 0 ? "danger" : "muted"}
                  />
                  <Stat label="Days" value={`${p.present_days}/${p.absent_days}/${p.leave_days}`} />
                </div>

                <div className="mt-3 rounded-lg bg-muted/40 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Net Payable
                  </div>
                  <div className="text-2xl font-bold text-success tabular-nums">
                    {fmtPKR(p.net_salary)}
                  </div>
                  {paid && p.paid_at && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Paid on {fmtDate(p.paid_at)}
                    </div>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => onOpenPayslip(p)}
                  >
                    <Share2 className="h-4 w-4 mr-2" aria-hidden="true" />
                    Payslip
                  </Button>
                  <Button
                    type="button"
                    onClick={() => markPaid.mutate({ id: p.id, paid: !paid })}
                    disabled={markPaid.isPending}
                    className={cn(
                      "min-h-11",
                      paid
                        ? "bg-muted text-foreground hover:bg-muted/80"
                        : "bg-success text-success-foreground hover:bg-success/90",
                    )}
                  >
                    {paid ? "Undo Paid" : "Mark as Paid"}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" | "muted" }) {
  return (
    <div className="rounded-md border border-border/60 p-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-xs font-medium tabular-nums",
          tone === "danger" && "text-destructive",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}
