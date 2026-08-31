import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle } from "lucide-react";
import { Link } from "@/lib/router-compat";
import { usePIIGuardedQuery } from "@/lib/access";

export function OverdueAlertBar() {
  const { data } = usePIIGuardedQuery<any[]>({
    queryKey: ["overdue-alert-count"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("booking_id,current_overdue_count,booking_status")
        .gt("current_overdue_count", 0)
        .neq("booking_status", "Cancelled");
      if (error) throw error;
      return (data ?? []).filter(
        (b: any) => String(b.booking_status ?? "").toLowerCase() !== "cancelled",
      );
    },
    refetchInterval: 60_000,
  });

  const count = data?.length ?? 0;
  if (!count) return null;

  return (
    <Link
      to="/bookings"
      className="block bg-destructive/90 text-white backdrop-blur-md px-4 py-2.5 min-h-[40px] text-xs font-semibold hover:bg-destructive transition-all border-b border-destructive/30 shadow-xs"
    >
      <div className="max-w-[1600px] mx-auto flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 animate-pulse" />
        <span>
          <strong>{count}</strong> client{count === 1 ? "" : "s"} {count === 1 ? "has" : "have"}{" "}
          overdue installments — click to review
        </span>
      </div>
    </Link>
  );
}
