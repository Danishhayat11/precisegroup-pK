/**
 * Top-nav notifications bell — surfaces three counts on a 60s cadence:
 *  - Overdue installments (all plans)
 *  - Today's follow-up leads (Builder only, since CRM is Builder-tier)
 *  - Pending payroll runs (Professional+)
 *
 * Each row navigates to its section. Company scoping is enforced by RLS
 * on the underlying tables; we still gate the visible rows on the plan
 * so users on a lower tier never see counts for features they can't open.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { planAtLeast } from "@/lib/plans";
import { useNavigate } from "@/lib/router-compat";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell, AlertTriangle, PhoneCall, Wallet, ChevronRight } from "lucide-react";

type Counts = {
  overdue: number;
  followups: number;
  payroll: number;
};

export function NotificationsBell() {
  const { companyId, plan, loading } = useAuth();
  const navigate = useNavigate();

  const showFollowups = planAtLeast(plan, "builder");
  const showPayroll = planAtLeast(plan, "professional");

  const {
    data: counts,
    refetch,
    isFetching,
  } = useQuery<Counts>({
    enabled: !loading && !!companyId,
    queryKey: ["notif-counts", companyId, showFollowups, showPayroll],
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      // Overdue = ledger rows still owing money past due date. The table
      // has no `id` column (PK is `ledger_id`) and no `balance` column
      // (running_balance). Prior version selected `id`/`balance` and
      // silently 400'd, so the badge count stayed at 0.
      const overdueQ = supabase
        .from("installment_ledger")
        .select("ledger_id", { count: "exact", head: true })
        .in("status", ["Overdue", "Partially Paid Overdue"]);
      const followupsQ = showFollowups
        ? supabase
            .from("crm_leads")
            .select("id", { count: "exact", head: true })
            .eq("follow_up_date", today)
        : Promise.resolve({ count: 0, error: null } as any);
      const payrollQ = showPayroll
        ? (
            supabase
              .from("hr_payroll_runs" as any)
              .select("id", { count: "exact", head: true }) as any
          ).eq("status", "Draft")
        : Promise.resolve({ count: 0, error: null } as any);

      const [o, f, p] = await Promise.all([overdueQ, followupsQ, payrollQ]);
      if ((o as any).error) throw (o as any).error;
      if ((f as any).error) throw (f as any).error;
      if ((p as any).error) throw (p as any).error;
      return {
        overdue: (o as any).count ?? 0,
        followups: (f as any).count ?? 0,
        payroll: (p as any).count ?? 0,
      };
    },
  });

  const total = useMemo(() => {
    if (!counts) return 0;
    return counts.overdue + counts.followups + counts.payroll;
  }, [counts]);

  const rows: Array<{
    label: string;
    count: number;
    icon: any;
    onClick: () => void;
    visible: boolean;
  }> = [
    {
      label: "Overdue installments",
      count: counts?.overdue ?? 0,
      icon: AlertTriangle,
      visible: true,
      onClick: () => navigate("/ledger?status=OVERDUE"),
    },
    {
      label: "Today's follow-ups",
      count: counts?.followups ?? 0,
      icon: PhoneCall,
      visible: showFollowups,
      onClick: () => navigate("/crm?due=today"),
    },
    {
      label: "Pending payroll",
      count: counts?.payroll ?? 0,
      icon: Wallet,
      visible: showPayroll,
      onClick: () => navigate("/hr/payroll?status=Draft"),
    },
  ];
  const visibleRows = rows.filter((r) => r.visible);

  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Refetch the moment the dropdown opens so the badge and rows
        // reflect the latest backend totals — the 60s cadence + focus
        // refetch can still be up to a minute stale when the user taps.
        if (next) refetch();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 min-h-11 min-w-11"
          aria-label={total > 0 ? `${total} notifications` : "Notifications"}
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {total > 0 && (
            <span
              aria-hidden="true"
              className="absolute top-1.5 right-1.5 grid place-items-center min-w-4 h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold"
            >
              {total > 99 ? "99+" : total}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="px-4 py-3 border-b">
          <div className="font-semibold text-sm">Notifications</div>
          <div className="text-xs text-muted-foreground">
            {isFetching
              ? "Refreshing…"
              : total > 0
                ? `${total} item${total === 1 ? "" : "s"} need${total === 1 ? "s" : ""} attention`
                : "You're all caught up"}
          </div>
        </div>
        <ul className="divide-y">
          {visibleRows.map((r) => (
            <li key={r.label}>
              <button
                type="button"
                onClick={r.onClick}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors min-h-11"
              >
                <div className="h-8 w-8 rounded-lg bg-muted grid place-items-center shrink-0">
                  <r.icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{r.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.count === 0
                      ? "None right now"
                      : `${r.count} item${r.count === 1 ? "" : "s"}`}
                  </div>
                </div>
                {r.count > 0 && (
                  <span className="inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full bg-destructive/10 text-destructive text-xs font-semibold">
                    {r.count > 99 ? "99+" : r.count}
                  </span>
                )}
                <ChevronRight
                  className="h-4 w-4 text-muted-foreground shrink-0"
                  aria-hidden="true"
                />
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export default NotificationsBell;
