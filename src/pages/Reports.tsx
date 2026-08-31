import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  FileText,
  Wallet,
  AlertTriangle,
  Clock,
  Scale,
  TrendingUp,
  ChevronRight,
  Contrast,
} from "lucide-react";
import { DashboardSkeleton } from "@/components/ui/skeletons";
import { fetchAllRows } from "@/lib/fetchAll";
import { PageHeader } from "@/components/PageHeader";
import { CashIntegrityBanner } from "@/components/CashIntegrityBanner";
import { fmtPKR } from "@/lib/format";
import { PaymentHistoryButton } from "@/components/PaymentHistoryDialog";
import { useActiveProject } from "@/lib/activeProject";

export default function Reports() {
  const { activeCode, activeProject } = useActiveProject();
  const projectName = activeProject?.project_name ?? null;

  const { data } = useQuery({
    queryKey: ["reports", activeCode ?? "all"],
    queryFn: async () => {
      const [bookings, payments, ledger, dealers] = await Promise.all([
        fetchAllRows<any>("bookings", "*", "booking_id"),
        fetchAllRows<any>("payments", "*", "receipt_no"),
        fetchAllRows<any>("installment_ledger", "*", "ledger_id"),
        fetchAllRows<any>("dealers", "*", "name"),
      ]);
      // Scope every stream to the active project so every report card,
      // aging bucket, dealer roll-up, and per-client row reflects only that
      // project's data.
      const b = activeCode ? bookings.filter((r: any) => r.project_code === activeCode) : bookings;
      const allowedBookingIds = new Set(b.map((r: any) => r.booking_id));
      const p = projectName
        ? payments.filter(
          (r: any) => r.project === projectName || allowedBookingIds.has(r.booking_id),
        )
        : payments;
      const l = projectName
        ? ledger.filter(
          (r: any) => r.project === projectName || allowedBookingIds.has(r.booking_id),
        )
        : ledger;
      return { bookings: b, payments: p, ledger: l, dealers };
    },
  });
  if (!data) return <DashboardSkeleton />;

  const dealerCommission = (data.dealers ?? []).map((d: any) => {
    const total = data.bookings
      .filter((b: any) => b.dealer_name === d.name)
      .reduce((s: number, b: any) => s + (Number(b.dealer_commission_amount) || 0), 0);
    return { name: d.name, total };
  });

  const today = new Date().toISOString().slice(0, 10);
  const aging = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  const cancelledBookingIds = new Set(
    data.bookings
      .filter(
        (b: any) =>
          String(b.booking_status ?? b.status ?? "")
            .trim()
            .toLowerCase() === "cancelled",
      )
      .map((b: any) => b.booking_id),
  );
  data.ledger.forEach((l: any) => {
    if (cancelledBookingIds.has(l.booking_id)) return;
    const rem = Math.max((Number(l.due_amount) || 0) - (Number(l.paid_amount) || 0), 0);
    if (!l.due_date || l.due_date >= today || rem <= 0) return;
    if (/down payment|possession/i.test(l.particulars ?? "")) return;
    const days = Math.floor((Date.now() - new Date(l.due_date).getTime()) / 86400000);
    if (days <= 30) aging["0-30"] += rem;
    else if (days <= 60) aging["31-60"] += rem;
    else if (days <= 90) aging["61-90"] += rem;
    else aging["90+"] += rem;
  });

  return (
    <div>
      <PageHeader
        title="Reports"
        description={`${activeProject ? `${activeProject.project_code} · ${activeProject.project_name}` : "All projects"} · rolled up from live data`}
      />
      <div className="mb-4">
        <CashIntegrityBanner />
      </div>
      {/* Drill-down report links */}
      <div className="mb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <ReportLink
          to="/reports/bookings"
          icon={FileText}
          title="Booking Summary"
          desc="All bookings with sale, payments, balance."
        />
        <ReportLink
          to="/reports/payments"
          icon={Wallet}
          title="Payment Collection"
          desc="Payments grouped by month with subtotals."
        />
        <ReportLink
          to="/reports/outstanding"
          icon={AlertTriangle}
          title="Outstanding Balance"
          desc="Bookings with balance greater than zero."
        />
        <ReportLink
          to="/reports/overdue"
          icon={Clock}
          title="Overdue Installments"
          desc="Every overdue installment by days overdue."
        />
        <ReportLink
          to="/reports/adjustments"
          icon={Scale}
          title="Adjustment Register"
          desc="All adjustments with realized loss/gain."
        />
        <ReportLink
          to="/reports/cashflow"
          icon={TrendingUp}
          title="Cash Flow Summary"
          desc="Monthly cash inflow with running total."
        />
        <ReportLink
          to="/site/palette"
          icon={Contrast}
          title="WCAG Contrast"
          desc="Live AA/AAA contrast readouts for every token pair."
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ReportCard
          title="Aging — overdue receivable"
          rows={Object.entries(aging).map(([k, v]) => ({
            label: `${k} days`,
            value: fmtPKR(v as number),
          }))}
        />
        <ReportCard
          title="Dealer commission"
          rows={dealerCommission.map((d: any) => ({ label: d.name, value: fmtPKR(d.total) }))}
        />
        <ReportCard
          title="Payment collection by head"
          rows={Object.entries(
            data.payments.reduce((acc: Record<string, number>, p: any) => {
              const h = p.payment_head ?? "Other";
              acc[h] = (acc[h] ?? 0) + (Number(p.safe_cash_amount) || 0);
              return acc;
            }, {}),
          ).map(([k, v]) => ({ label: k, value: fmtPKR(v as number) }))}
        />
        <ReportCard
          title="Project-wise sales"
          rows={Object.entries(
            data.bookings.reduce((acc: Record<string, number>, b: any) => {
              const p = b.project_name ?? "—";
              acc[p] = (acc[p] ?? 0) + (Number(b.total_contract_value) || 0);
              return acc;
            }, {}),
          ).map(([k, v]) => ({ label: k, value: fmtPKR(v as number) }))}
        />
      </div>

      {/* Per-client statements */}
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/80 backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] mt-5">
        <div className="p-4 border-b border-border/40 text-sm font-semibold flex items-center justify-between">
          <span>Per-Client Statements</span>
          <span className="text-xs text-muted-foreground font-normal tabular-nums font-mono">
            {data.bookings.length} records
          </span>
        </div>
        <div className="overflow-x-auto max-h-[60vh]">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground bg-muted/40 backdrop-blur-md sticky top-0 border-b border-border/40">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Booking</th>
                <th className="text-left px-4 py-3 font-medium">Client</th>
                <th className="text-left px-4 py-3 font-medium">Unit</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Contract</th>
                <th className="text-right px-4 py-3 font-medium">Received</th>
                <th className="text-right px-4 py-3 font-medium">Balance</th>
                <th className="text-right px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {data.bookings
                .slice()
                .sort((a: any, b: any) =>
                  String(a.client_name || "").localeCompare(String(b.client_name || "")),
                )
                .map((b: any) => (
                  <tr key={b.booking_id} className="hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-xs text-primary font-medium">{b.booking_id}</td>
                    <td className="px-4 py-2.5 capitalize font-medium">{b.client_name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{b.unit_id}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide ${String(b.booking_status ?? "").toLowerCase() === "cancelled"
                            ? "bg-destructive/10 text-destructive border border-destructive/20"
                            : String(b.booking_status ?? "").toLowerCase() === "active"
                              ? "bg-success/10 text-success border border-success/20"
                              : "bg-muted text-muted-foreground border border-border"
                          }`}
                      >
                        {b.booking_status || "Active"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-mono text-xs">
                      {fmtPKR(b.total_contract_value)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-mono text-xs text-success font-medium">
                      {fmtPKR(b.cash_received)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-mono text-xs font-semibold">
                      {fmtPKR(b.remaining_balance)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <PaymentHistoryButton
                        bookingId={b.booking_id}
                        label="Print Statement"
                      />
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

function ReportCard({ title, rows }: { title: string; rows: { label: string; value: string }[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/80 backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
      <div className="p-4 border-b border-border/40 text-sm font-semibold text-foreground flex items-center justify-between">
        <span>{title}</span>
        <span className="text-xs text-muted-foreground font-normal">{rows.length} rows</span>
      </div>
      <div className="divide-y divide-border/30">
        {rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No data</div>
        ) : (
          rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-muted/40 transition-colors">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="tabular-nums font-semibold font-mono text-foreground">{r.value}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ReportLink({
  to,
  icon: Icon,
  title,
  desc,
}: {
  to: string;
  icon: any;
  title: string;
  desc: string;
}) {
  return (
    <Link
      to={to}
      className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card/70 backdrop-blur-xl p-4.5 shadow-[0_4px_20px_rgb(0,0,0,0.03)] hover:shadow-[0_12px_30px_rgb(0,0,0,0.08)] hover:border-primary/40 hover:-translate-y-0.5 transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] flex items-start gap-3.5"
    >
      <div className="rounded-xl bg-primary/10 text-primary p-2.5 shrink-0 transition-transform duration-200 group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-foreground flex items-center justify-between">
          <span>{title}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground/60 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-primary" />
        </div>
        <div className="text-xs text-muted-foreground mt-1 leading-snug">{desc}</div>
      </div>
    </Link>
  );
}
