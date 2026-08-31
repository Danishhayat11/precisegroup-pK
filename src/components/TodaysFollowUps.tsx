import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@/lib/router-compat";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarClock, ArrowRight, Phone } from "lucide-react";
import { fmtDate } from "@/lib/format";
import type { Lead } from "@/pages/LeadsCRM";

const todayISO = () => new Date().toISOString().slice(0, 10);

export function TodaysFollowUps() {
  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["crm_leads", "follow-ups-today"],
    queryFn: async () => {
      const today = todayISO();
      const { data, error } = await supabase
        .from("crm_leads")
        .select("*")
        .lte("follow_up_date", today)
        .not("follow_up_date", "is", null)
        .not("stage", "in", '("Booking Done","Lost")')
        .order("follow_up_date", { ascending: true })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as Lead[];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (isLoading || leads.length === 0) return null;

  return (
    <Card className="p-4 mb-4 border-l-4 border-l-destructive">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-destructive" aria-hidden="true" />
          Today&rsquo;s Follow-ups
          <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
            {leads.length}
          </Badge>
        </h2>
        <Button asChild variant="ghost" size="sm">
          <Link to="/crm">
            View pipeline <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
      <ul className="divide-y">
        {leads.map((l) => {
          const overdue = l.follow_up_date && l.follow_up_date < todayISO();
          return (
            <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium truncate">{l.full_name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {l.stage} · {l.source}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className={overdue ? "text-destructive font-medium text-xs" : "text-xs"}>
                  {l.follow_up_date ? fmtDate(l.follow_up_date) : "—"}
                  {overdue && <span className="ml-1">(overdue)</span>}
                </div>
                <div className="text-[11px] text-muted-foreground tabular-nums flex items-center gap-1 justify-end">
                  <Phone className="h-3 w-3" aria-hidden="true" />
                  <a href={`tel:${l.mobile}`} className="hover:underline">
                    {l.mobile}
                  </a>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export default TodaysFollowUps;
