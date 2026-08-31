import { AlertTriangle, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { validateCashIntegrity, type PaymentRow } from "@/lib/cash";
import { usePIIGuardedQuery } from "@/lib/access";

/**
 * Runs the Cash-vs-Adjustment integrity validator against ALL payment rows
 * and surfaces a banner if any row violates the separation rule.
 *
 * The DB also enforces this via the `payments_adjustment_excludes_cash`
 * CHECK constraint — this banner is a belt-and-suspenders surface so legacy
 * or imported rows can't silently mis-report Cash Received anywhere in the app.
 */
export function CashIntegrityBanner({ compact = false }: { compact?: boolean }) {
  const { data: issues = [], isLoading } = usePIIGuardedQuery<
    ReturnType<typeof validateCashIntegrity>
  >({
    queryKey: ["cash-integrity-check"],
    queryFn: async () => {
      const { data } = await supabase
        .from("payments")
        .select(
          "receipt_no,payment_mode,amount,safe_cash_amount,cash_bank_include,non_cash_adjustment",
        );
      return validateCashIntegrity((data ?? []) as PaymentRow[]);
    },
    staleTime: 60_000,
  });

  if (isLoading) return null;

  if (issues.length === 0) {
    if (compact) return null;
    return (
      <div className="flex items-center gap-2.5 rounded-2xl border border-success/30 bg-success/10 dark:bg-success/15 backdrop-blur-xl px-4 py-2.5 text-xs text-success shadow-xs">
        <ShieldCheck className="h-4 w-4 shrink-0" />
        <span className="font-medium">Cash Received excludes Adjustment/Asset — verified across 0 integrity issues.</span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/10 dark:bg-destructive/15 backdrop-blur-xl px-4 py-3 text-xs text-destructive shadow-xs">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Cash integrity check failed: {issues.length} payment row(s) violate the Cash vs Adjustment
        rule.
      </div>
      <ul className="mt-1.5 list-disc pl-5 space-y-0.5 font-medium">
        {issues.slice(0, 5).map((i, idx) => (
          <li key={idx}>
            <span className="font-mono font-bold">{(i.row as any).receipt_no ?? "—"}</span> · {i.reason}
          </li>
        ))}
        {issues.length > 5 && <li>…and {issues.length - 5} more</li>}
      </ul>
    </div>
  );
}
