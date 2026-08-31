import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate } from "@/lib/format";
import { ChevronRight, History } from "lucide-react";

interface Props {
  receiptNo: string;
}

export function PaymentEditHistory({ receiptNo }: Props) {
  const [open, setOpen] = useState(false);
  const { data = [] } = useQuery({
    queryKey: ["payment-edit-history", receiptNo],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase
        .from("payment_edit_history")
        .select("id,field_changed,old_value,new_value,reason,edited_at,edited_by")
        .eq("receipt_no", receiptNo)
        .order("edited_at", { ascending: false });
      return data ?? [];
    },
  });
  const { data: count } = useQuery({
    queryKey: ["payment-edit-history-count", receiptNo],
    queryFn: async () => {
      const { count } = await supabase
        .from("payment_edit_history")
        .select("id", { count: "exact", head: true })
        .eq("receipt_no", receiptNo);
      return count ?? 0;
    },
  });
  if (!count) return null;
  return (
    <div className="text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
      >
        <History className="h-3 w-3" />
        <span>History ({count})</span>
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="mt-2 pl-4 border-l-2 border-border space-y-2">
          {data.map((h: any) => (
            <div key={h.id} className="text-[11px] leading-snug">
              <div className="text-muted-foreground">
                {fmtDate(h.edited_at)} · <b className="text-foreground">{h.field_changed}</b>{" "}
                changed from <span className="line-through">{String(h.old_value ?? "—")}</span> →{" "}
                <span className="font-medium">{String(h.new_value ?? "—")}</span>
              </div>
              {h.reason && <div className="text-muted-foreground italic">Reason: “{h.reason}”</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
