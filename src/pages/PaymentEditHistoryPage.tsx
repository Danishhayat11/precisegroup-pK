import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { fmtDate } from "@/lib/format";
import { Link } from "@/lib/router-compat";

export default function PaymentEditHistoryPage() {
  const [q, setQ] = useState("");
  const { data = [], isLoading } = useQuery({
    queryKey: ["payment-edit-history-all"],
    queryFn: async () => {
      const { data } = await supabase
        .from("payment_edit_history")
        .select(
          "id,receipt_no,booking_id,field_changed,old_value,new_value,reason,edited_at,edited_by",
        )
        .order("edited_at", { ascending: false })
        .limit(2000);
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return data;
    return data.filter((r: any) =>
      [r.receipt_no, r.booking_id, r.field_changed, r.reason, r.old_value, r.new_value].some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(s),
      ),
    );
  }, [q, data]);

  return (
    <div>
      <PageHeader
        title="Payment Edit History"
        description="Every admin change to a posted payment, with reason."
      />
      <div className="mb-3 flex items-center gap-3">
        <Input
          placeholder="Search receipt, booking, field, reason…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-md"
        />
        <span className="text-xs text-muted-foreground">{filtered.length} entries</span>
      </div>
      <div className="card-elevated overflow-hidden">
        <div className="overflow-x-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground bg-card sticky top-0">
              <tr>
                <th className="text-left px-4 py-2">When</th>
                <th className="text-left px-4 py-2">Receipt</th>
                <th className="text-left px-4 py-2">Booking</th>
                <th className="text-left px-4 py-2">Field</th>
                <th className="text-left px-4 py-2">Old</th>
                <th className="text-left px-4 py-2">New</th>
                <th className="text-left px-4 py-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                    No edits recorded yet.
                  </td>
                </tr>
              )}
              {filtered.map((r: any) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDate(r.edited_at)}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-primary">{r.receipt_no}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {r.booking_id ? (
                      <Link
                        className="text-primary hover:underline"
                        to={`/bookings/${r.booking_id}`}
                      >
                        {r.booking_id}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 font-medium">{r.field_changed}</td>
                  <td
                    className="px-4 py-2 max-w-[200px] truncate line-through text-muted-foreground"
                    title={String(r.old_value ?? "")}
                  >
                    {String(r.old_value ?? "—")}
                  </td>
                  <td
                    className="px-4 py-2 max-w-[200px] truncate"
                    title={String(r.new_value ?? "")}
                  >
                    {String(r.new_value ?? "—")}
                  </td>
                  <td className="px-4 py-2 italic text-muted-foreground max-w-[280px]">
                    {r.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
