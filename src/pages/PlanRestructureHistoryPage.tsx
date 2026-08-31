import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { fmtDate, fmtPKR } from "@/lib/format";
import { Link } from "@/lib/router-compat";

export default function PlanRestructureHistoryPage() {
  const [q, setQ] = useState("");
  const { data = [], isLoading } = useQuery({
    queryKey: ["plan-restructure-history"],
    queryFn: async () => {
      const { data } = await supabase
        .from("plan_restructure_history")
        .select("id,booking_id,reason,restructured_at,restructured_by,before,after")
        .order("restructured_at", { ascending: false });
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return data;
    return data.filter((r: any) =>
      [r.booking_id, r.reason].some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(s),
      ),
    );
  }, [q, data]);

  return (
    <div>
      <PageHeader
        title="Plan Restructure History"
        description="Every admin plan change with a full before / after snapshot."
      />
      <div className="mb-3 flex items-center gap-3">
        <Input
          placeholder="Search booking or reason…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-md"
        />
        <span className="text-xs text-muted-foreground">{filtered.length} entries</span>
      </div>

      <div className="space-y-3">
        {isLoading && <div className="text-muted-foreground">Loading…</div>}
        {!isLoading && filtered.length === 0 && (
          <div className="card-elevated p-6 text-center text-muted-foreground">
            No restructures recorded yet.
          </div>
        )}
        {filtered.map((r: any) => {
          const bBefore = r.before?.booking ?? {};
          const bAfter = r.after?.booking ?? {};
          const before = r.before?.schedule ?? [];
          const after = r.after?.schedule ?? [];
          return (
            <div key={r.id} className="card-elevated p-4">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <div className="font-semibold">
                    <Link className="text-primary hover:underline" to={`/bookings/${r.booking_id}`}>
                      {r.booking_id}
                    </Link>
                    <span className="text-muted-foreground text-sm ml-2">
                      {fmtDate(r.restructured_at)}
                    </span>
                  </div>
                  <div className="text-xs italic text-muted-foreground mt-1">
                    Reason: “{r.reason}”
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>
                    Contract:{" "}
                    <b className="tabular-nums">
                      {fmtPKR(bAfter.total_contract_value ?? bBefore.total_contract_value)}
                    </b>
                  </div>
                  <div>
                    {before.length} → {after.length} rows
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <MiniPlan title="BEFORE" b={bBefore} schedule={before} />
                <MiniPlan title="AFTER" b={bAfter} schedule={after} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniPlan({ title, b, schedule }: { title: string; b: any; schedule: any[] }) {
  return (
    <div className="rounded-md border">
      <div className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground border-b bg-muted/30">
        {title}
      </div>
      <div className="px-3 py-1.5 text-[11px]">
        {b?.no_of_installments ?? "—"} × {fmtPKR(b?.installment_amount)} ·{" "}
        {b?.installment_frequency ?? "—"}
      </div>
      <div className="max-h-56 overflow-y-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-card text-muted-foreground">
            <tr>
              <th className="text-left px-2 py-1">Particulars</th>
              <th className="text-left px-2 py-1">Due</th>
              <th className="text-right px-2 py-1">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(schedule ?? []).map((row: any, i: number) => (
              <tr key={i} className="border-t">
                <td className="px-2 py-1">{row.particulars}</td>
                <td className="px-2 py-1">{fmtDate(row.due_date)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{fmtPKR(row.due_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
