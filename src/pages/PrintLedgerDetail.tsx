/* allow-raw-color-file: A4 print ledger requires guaranteed black-on-white contrast for printer output; theme tokens deliberately bypassed */
import { useMemo, useRef, useState } from "react";
import { usePIIGuardedQuery, AccessDenied } from "@/lib/access";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Printer, Download, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { fmtPKR, fmtDate } from "@/lib/format";
import { PrintFrame, PRINT_CSS } from "@/lib/letterhead";
import { exportToPdf } from "@/lib/export";
import { toast } from "sonner";

type Booking = {
  booking_id: string;
  client_name: string | null;
  cnic: string | null;
  mobile: string | null;
  address: string | null;
  unit_id: string | null;
  project_name: string | null;
  project_code: string | null;
  size_sqft: number | null;
  total_contract_value: number | null;
  cash_received: number | null;
  remaining_balance: number | null;
  booking_date: string | null;
};

type LedgerRow = {
  ledger_id: string;
  term_no: number | null;
  particulars: string | null;
  due_date: string | null;
  due_amount: number | string | null;
  paid_amount: number | string | null;
  paid_date: string | null;
};

type PaymentRow = {
  receipt_no: string;
  payment_date: string | null;
  amount: number | string | null;
  payment_head: string | null;
  payment_mode: string | null;
};

type Txn = {
  key: string;
  date: string | null;
  description: string;
  debit: number;
  credit: number;
};

/**
 * Single printable client-ledger page. All non-print chrome (sidebar,
 * top bar, action buttons) is masked by global `@media print` rules in
 * styles.css — only `.print-area` is visible on paper.
 */
export default function PrintLedgerDetail() {
  const { bookingId } = useParams({ from: "/_authenticated/print-ledger/$bookingId" });
  const docRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    if (!docRef.current) return;
    setIsExporting(true);
    try {
      await exportToPdf(docRef.current, `Ledger_${bookingId}.pdf`);
      toast.success("PDF exported successfully");
    } catch (error) {
      console.error("PDF export failed:", error);
      toast.error("Failed to export PDF");
    } finally {
      setIsExporting(false);
    }
  };

  const { data: booking, accessDenied } = usePIIGuardedQuery<Booking | null>({
    queryKey: ["print-ledger-booking", bookingId],
    queryFn: async () => {
      const { data } = await supabase
        .from("bookings")
        .select(
          "booking_id, client_name, cnic, mobile, address, unit_id, project_name, project_code, size_sqft, total_contract_value, cash_received, remaining_balance, booking_date",
        )
        .eq("booking_id", bookingId)
        .maybeSingle();
      return (data ?? null) as Booking | null;
    },
  });

  const { data: schedule = [] } = usePIIGuardedQuery<LedgerRow[]>({
    queryKey: ["print-ledger-schedule", bookingId],
    queryFn: async () => {
      const { data } = await supabase
        .from("installment_ledger")
        .select("ledger_id, term_no, particulars, due_date, due_amount, paid_amount, paid_date")
        .eq("booking_id", bookingId)
        .order("due_date", { ascending: true });
      return (data ?? []) as LedgerRow[];
    },
  });

  const { data: payments = [] } = usePIIGuardedQuery<PaymentRow[]>({
    queryKey: ["print-ledger-payments", bookingId],
    queryFn: async () => {
      const { data } = await supabase
        .from("payments")
        .select("receipt_no, payment_date, amount, payment_head, payment_mode")
        .eq("booking_id", bookingId)
        .order("payment_date", { ascending: true });
      return (data ?? []) as PaymentRow[];
    },
  });

  /**
   * Merge scheduled installments (debits) and actual receipts (credits)
   * into a single date-ordered ledger with a running balance. Debits
   * increase what the client owes; credits reduce it.
   */
  const { txns, totals } = useMemo(() => {
    const rows: Txn[] = [];

    for (const s of schedule) {
      const due = Number(s.due_amount) || 0;
      if (due > 0) {
        rows.push({
          key: `sch-${s.ledger_id}`,
          date: s.due_date,
          description:
            s.particulars ??
            (s.term_no != null
              ? `Installment ${String(s.term_no).padStart(2, "0")}`
              : "Scheduled amount"),
          debit: due,
          credit: 0,
        });
      }
    }

    for (const p of payments) {
      const amt = Number(p.amount) || 0;
      if (amt !== 0) {
        rows.push({
          key: `pay-${p.receipt_no}`,
          date: p.payment_date,
          description: `Receipt ${p.receipt_no}${p.payment_head ? ` — ${p.payment_head}` : ""}${
            p.payment_mode ? ` (${p.payment_mode})` : ""
          }`,
          debit: 0,
          credit: amt,
        });
      }
    }

    rows.sort((a, b) => {
      const ad = a.date ?? "9999-99-99";
      const bd = b.date ?? "9999-99-99";
      if (ad !== bd) return ad < bd ? -1 : 1;
      // Debits (invoicing) before credits on the same day, so the running
      // balance shows the obligation before the receipt clears it.
      return b.debit - a.debit;
    });

    let debitTotal = 0;
    let creditTotal = 0;
    const withBalance = rows.map((r) => {
      debitTotal += r.debit;
      creditTotal += r.credit;
      return { ...r, balance: debitTotal - creditTotal };
    });

    return {
      txns: withBalance,
      totals: {
        debit: debitTotal,
        credit: creditTotal,
        outstanding: debitTotal - creditTotal,
      },
    };
  }, [schedule, payments]);

  const contract = Number(booking?.total_contract_value ?? 0);
  const received = Number(booking?.cash_received ?? totals.credit);
  const outstanding = Number(
    booking?.remaining_balance ?? Math.max(contract - received, totals.outstanding),
  );

  if (accessDenied)
    return (
      <AccessDenied
        title="Client ledger restricted"
        description="Only admin, manager, and staff roles can view printable client ledgers."
      />
    );

  return (
    <div>
      {/* Web-only action bar — hidden on print via global rules. */}
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button asChild size="sm" variant="ghost">
          <Link to="/print-ledger">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back to ledgers
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={isExporting}
            aria-label="Download PDF"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-1.5" />
            )}
            Download PDF
          </Button>
          <Button size="sm" onClick={() => window.print()} aria-label="Print this ledger">
            <Printer className="h-4 w-4" aria-hidden />
            Print Ledger
          </Button>
        </div>
      </div>

      {/* Shared print CSS — running header/footer + A4 sheet chrome. */}
      <style>{PRINT_CSS}</style>
      {/* .print-area = everything below is what lands on paper. */}
      <div
        ref={docRef}
        className="print-area doc-sheet mx-auto w-full max-w-[210mm] rounded-none border border-black bg-white p-[12.7mm] font-serif text-black shadow-sm print:border-0 print:shadow-none print:p-0"
      >
        <PrintFrame
          docTitle="Installment Ledger Statement"
          bookingId={booking?.booking_id ?? bookingId}
        >
          {/* Full letterhead — page 1 only (natural top-of-flow) */}
          <header className="mb-6 border-b-2 border-black pb-4 keep-together">
            <div className="flex items-start justify-between gap-6">
              <div>
                <h1 className="text-2xl font-bold uppercase tracking-wider">
                  Precise Realtors &amp; Builders (Pvt.) Ltd.
                </h1>
                <p className="text-xs uppercase tracking-widest">
                  {/heights/i.test(String(booking?.project_name || ""))
                    ? "Manal Heights"
                    : "Manal Arcade"}{" "}
                  · Payment Ledger Statement
                </p>
              </div>
              <div className="text-right text-xs">
                <div className="font-semibold">Booking ID</div>
                <div className="font-mono">{booking?.booking_id ?? bookingId}</div>
                <div className="mt-1 font-semibold">Statement Date</div>
                <div>{fmtDate(new Date().toISOString().slice(0, 10))}</div>
              </div>
            </div>
          </header>

          {/* Client + unit block */}
          <section className="mb-6 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <ClientField label="Client Name" value={booking?.client_name} uppercase />
            <ClientField label="Project" value={booking?.project_name} />
            <ClientField label="CNIC" value={booking?.cnic} mono />
            <ClientField label="Unit" value={booking?.unit_id} />
            <ClientField label="Mobile" value={booking?.mobile} mono />
            <ClientField
              label="Covered Area"
              value={booking?.size_sqft != null ? `${booking.size_sqft} sq.ft.` : null}
            />
            <ClientField label="Address" value={booking?.address} className="col-span-2" />
          </section>

          {/* Ledger table */}
          <section>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-widest">Transaction Ledger</h2>
            <table className="w-full border-collapse text-[10.5pt]">
              <thead>
                <tr className="border-y-2 border-black bg-neutral-100 text-left">
                  <th className="w-[14%] border border-black px-2 py-1.5 font-bold">Date</th>
                  <th className="border border-black px-2 py-1.5 font-bold">Description</th>
                  <th className="w-[14%] border border-black px-2 py-1.5 text-right font-bold">
                    Debit
                  </th>
                  <th className="w-[14%] border border-black px-2 py-1.5 text-right font-bold">
                    Credit
                  </th>
                  <th className="w-[16%] border border-black px-2 py-1.5 text-right font-bold">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => (
                  <tr key={t.key} className="align-top">
                    <td className="border border-black px-2 py-1 tabular-nums">
                      {fmtDate(t.date ?? "")}
                    </td>
                    <td className="border border-black px-2 py-1">{t.description}</td>
                    <td className="border border-black px-2 py-1 text-right tabular-nums">
                      {t.debit ? fmtPKR(t.debit) : ""}
                    </td>
                    <td className="border border-black px-2 py-1 text-right tabular-nums">
                      {t.credit ? fmtPKR(t.credit) : ""}
                    </td>
                    <td className="border border-black px-2 py-1 text-right tabular-nums font-medium">
                      {fmtPKR(t.balance)}
                    </td>
                  </tr>
                ))}
                {txns.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="border border-black px-2 py-6 text-center text-xs italic"
                    >
                      No ledger entries recorded for this booking.
                    </td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-black bg-neutral-100 font-bold">
                  <td className="border border-black px-2 py-1.5" colSpan={2}>
                    Totals
                  </td>
                  <td className="border border-black px-2 py-1.5 text-right tabular-nums">
                    {fmtPKR(totals.debit)}
                  </td>
                  <td className="border border-black px-2 py-1.5 text-right tabular-nums">
                    {fmtPKR(totals.credit)}
                  </td>
                  <td className="border border-black px-2 py-1.5 text-right tabular-nums">
                    {fmtPKR(totals.outstanding)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </section>

          {/* Summary footer */}
          <section className="mt-6 grid grid-cols-3 gap-4 border-t-2 border-black pt-4 text-sm">
            <SummaryBox label="Total Sale Price" value={fmtPKR(contract)} />
            <SummaryBox label="Total Paid" value={fmtPKR(received)} />
            <SummaryBox label="Total Outstanding" value={fmtPKR(outstanding)} emphasis />
          </section>

          <footer className="mt-8 border-t border-black pt-3 text-center text-[9pt] italic">
            Precise Realtors &amp; Builders (Pvt.) Ltd ·{" "}
            {/heights/i.test(String(booking?.project_name || ""))
              ? "Manal Heights, B-17 Multi Gardens, Islamabad"
              : "Manal Arcade, B-1 Markaz, B-17 Islamabad"}{" "}
            · Statement computer-generated on {fmtDate(new Date().toISOString().slice(0, 10))}
          </footer>
        </PrintFrame>
      </div>
    </div>
  );
}

function ClientField({
  label,
  value,
  mono,
  uppercase,
  className = "",
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  uppercase?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-[9pt] font-semibold uppercase tracking-widest text-neutral-700">
        {label}
      </div>
      <div
        className={[
          "border-b border-black pb-0.5",
          mono ? "font-mono" : "",
          uppercase ? "uppercase" : "",
        ].join(" ")}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}

function SummaryBox({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={[
        "border border-black px-3 py-2",
        emphasis ? "bg-neutral-900 text-white" : "", // allow-raw-color: print receipt requires guaranteed black/white contrast for A4 output
      ].join(" ")}
    >
      <div className="text-[9pt] font-semibold uppercase tracking-widest">{label}</div>
      <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}
