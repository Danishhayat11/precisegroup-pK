import { useMemo, useState } from "react";
import { usePIIGuardedQuery, AccessDenied } from "@/lib/access";
import { Link } from "@tanstack/react-router";
import { Printer, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fmtPKR } from "@/lib/format";

type BookingRow = {
  booking_id: string;
  client_name: string | null;
  cnic: string | null;
  mobile: string | null;
  unit_id: string | null;
  project_name: string | null;
  total_contract_value: number | null;
  cash_received: number | null;
  remaining_balance: number | null;
};

/**
 * Index of every booking's printable client ledger. One row per booking
 * (a client can hold several units) with search + a "Print Ledger" action
 * that opens the printer-optimized detail route.
 */
export default function PrintLedgerIndex() {
  const [q, setQ] = useState("");

  const {
    data: rows = [],
    isLoading,
    accessDenied,
  } = usePIIGuardedQuery<BookingRow[]>({
    queryKey: ["print-ledger-index"],
    queryFn: async () => {
      const { data } = await supabase
        .from("bookings")
        .select(
          "booking_id, client_name, cnic, mobile, unit_id, project_name, total_contract_value, cash_received, remaining_balance",
        )
        .order("client_name", { ascending: true });
      return (data ?? []) as BookingRow[];
    },
  });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.booking_id, r.client_name, r.cnic, r.mobile, r.unit_id, r.project_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  }, [rows, q]);

  if (accessDenied)
    return (
      <div>
        <PageHeader title="Client Payment Ledgers" description="Restricted view" />
        <AccessDenied
          title="Client ledgers are restricted"
          description="Only admin, manager, and staff roles can access printable client payment ledgers."
        />
      </div>
    );

  return (
    <div>
      <PageHeader
        title="Client Payment Ledgers"
        description="Per-booking payment ledger, print-ready for A4 (Date · Description · Debit · Credit · Balance)."
      />

      <div className="mt-4 mb-6 flex items-center gap-2">
        <div className="relative w-full max-w-md">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by client, CNIC, mobile, unit, or booking ID"
            className="pl-9"
            aria-label="Search bookings"
          />
        </div>
        <span className="text-sm text-muted-foreground tabular-nums">
          {isLoading ? "Loading…" : `${filtered.length} of ${rows.length}`}
        </span>
      </div>

      <div className="rounded-xl border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">Booking</th>
                <th className="px-4 py-3 font-semibold">Client</th>
                <th className="px-4 py-3 font-semibold">Unit</th>
                <th className="px-4 py-3 text-right font-semibold">Sale Price</th>
                <th className="px-4 py-3 text-right font-semibold">Received</th>
                <th className="px-4 py-3 text-right font-semibold">Balance</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.booking_id} className="border-b last:border-b-0 hover:bg-accent/30">
                  <td className="px-4 py-3 font-mono text-xs">{r.booking_id}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium capitalize">{r.client_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {[r.cnic, r.mobile].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    <div>{r.unit_id ?? "—"}</div>
                    <div>{r.project_name ?? ""}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {fmtPKR(r.total_contract_value)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtPKR(r.cash_received)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">
                    {fmtPKR(r.remaining_balance)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link
                        to="/print-ledger/$bookingId"
                        params={{ bookingId: r.booking_id }}
                        aria-label={`Open printable ledger for ${r.client_name ?? r.booking_id}`}
                      >
                        <Printer className="h-3.5 w-3.5" aria-hidden />
                        Print Ledger
                      </Link>
                    </Button>
                  </td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No bookings match “{q}”.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
