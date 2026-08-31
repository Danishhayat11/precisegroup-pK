import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown, MessageCircle, X, FileText, Loader2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { MobileLedger } from "@/components/MobileLedger";

import { cn } from "@/lib/utils";
import { fmtDate, fmtPKR } from "@/lib/format";
import { Link } from "@/lib/router-compat";
import { useActiveProject } from "@/lib/activeProject";
import { usePIIGuardedQuery, AccessDenied } from "@/lib/access";
import {
  deriveStatus,
  normalisePkPhone,
  buildReminderMessage,
  type LedgerStatus,
} from "@/lib/ledgerStatus";

const STATUS_TONE: Record<LedgerStatus, "success" | "danger" | "warning" | "adjustment" | "muted"> =
  {
    PAID: "success",
    OVERDUE: "danger",
    "DUE SOON": "warning",
    PARTIAL: "adjustment",
    UPCOMING: "muted",
  };

// ---- Page ---------------------------------------------------------------
export default function Ledger() {
  const { activeCode, activeProject } = useActiveProject();
  const [bookingId, setBookingId] = useState<string>("");
  const [bookingPickerOpen, setBookingPickerOpen] = useState(false);

  // All ledger rows in the current project scope. We still fetch the
  // full set so the "no selection" view remains a project-wide overview
  // and the booking picker has options to choose from.
  const {
    data: rows = [],
    accessDenied,
    isLoading: rowsLoading,
    isFetching: rowsFetching,
    isError: rowsError,
    error: rowsErrorObj,
    refetch: refetchRows,
  } = usePIIGuardedQuery<any[]>({
    queryKey: ["ledger-all", activeCode ?? "all"],
    queryFn: async () => {
      let q = supabase.from("installment_ledger").select("*").order("due_date");
      if (activeProject?.project_name) q = q.eq("project", activeProject.project_name);
      return (await q).data ?? [];
    },
  });

  // Minimal booking list for the picker + summary card. Scoped by the
  // active project so the picker mirrors what the ledger is showing.
  // `mobile` is fetched for the WhatsApp reminder deep-link.
  const {
    data: bookings = [],
    isLoading: bookingsLoading,
    isError: bookingsError,
    error: bookingsErrorObj,
    refetch: refetchBookings,
  } = usePIIGuardedQuery<any[]>({
    queryKey: ["ledger-bookings", activeCode ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("bookings")
        .select(
          "booking_id, client_name, unit_id, mobile, total_contract_value, down_payment, installment_amount, no_of_installments, project_code, project_name",
        )
        .order("booking_id", { ascending: false });
      if (activeCode) q = q.eq("project_code", activeCode);
      return (await q).data ?? [];
    },
  });

  const selectedBooking = useMemo(
    () => bookings.find((b: any) => b.booking_id === bookingId) ?? null,
    [bookings, bookingId],
  );

  // Rows to render: filtered to the selected booking when one is picked.
  const scopedRows = useMemo(
    () => (bookingId ? rows.filter((r: any) => r.booking_id === bookingId) : rows),
    [rows, bookingId],
  );

  const today = new Date();
  const enriched = useMemo(
    () =>
      scopedRows.map((l: any) => {
        const due = Number(l.due_amount) || 0;
        const paid = Number(l.paid_amount) || 0;
        const balance = Math.max(due - paid, 0);
        const status = deriveStatus(due, paid, l.due_date ?? null, new Date(today));
        const days =
          status === "OVERDUE" && l.due_date
            ? Math.max(0, Math.floor((Date.now() - new Date(l.due_date).getTime()) / 86400000))
            : 0;
        return { ...l, _status: status, _balance: balance, _days: days };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopedRows],
  );

  // Bottom summary: schedule = sum of due_amount, paid = sum of
  // paid_amount, overdue = sum of remaining ONLY on OVERDUE rows,
  // balance = schedule - paid.
  const totals = useMemo(() => {
    let schedule = 0,
      paid = 0,
      overdue = 0;
    for (const r of enriched) {
      schedule += Number(r.due_amount) || 0;
      paid += Number(r.paid_amount) || 0;
      if (r._status === "OVERDUE") overdue += r._balance;
    }
    return { schedule, paid, overdue, balance: Math.max(schedule - paid, 0) };
  }, [enriched]);

  // Header-card counters (only shown when a booking is selected).
  const bookingTotals = useMemo(() => {
    if (!selectedBooking) return null;
    const totalPaidCount = enriched.filter((r) => r._status === "PAID").length;
    const totalPaidAmount = enriched.reduce((s, r) => s + (Number(r.paid_amount) || 0), 0);
    const totalSchedule = enriched.reduce((s, r) => s + (Number(r.due_amount) || 0), 0);
    return {
      totalInstallments: enriched.length,
      paidCount: totalPaidCount,
      remainingCount: enriched.length - totalPaidCount,
      totalPaid: totalPaidAmount,
      totalRemaining: Math.max(totalSchedule - totalPaidAmount, 0),
    };
  }, [enriched, selectedBooking]);

  const columns: Column<any>[] = [
    {
      key: "no",
      header: "Installment No",
      cell: (r) => <span className="font-mono text-xs">{r.term_no ?? "—"}</span>,
    },
    { key: "due", header: "Due Date", cell: (r) => fmtDate(r.due_date) },
    {
      key: "amt",
      header: "Amount Due",
      align: "right",
      cell: (r) => <span className="tabular-nums">{fmtPKR(r.due_amount)}</span>,
    },
    { key: "pdate", header: "Paid Date", cell: (r) => (r.paid_date ? fmtDate(r.paid_date) : "—") },
    {
      key: "paid",
      header: "Amount Paid",
      align: "right",
      cell: (r) => <span className="tabular-nums">{fmtPKR(r.paid_amount)}</span>,
    },
    {
      key: "bal",
      header: "Balance",
      align: "right",
      cell: (r) => <span className="tabular-nums font-medium">{fmtPKR(r._balance)}</span>,
    },
    {
      key: "st",
      header: "Status",
      cell: (r) => <StatusBadge label={r._status} tone={STATUS_TONE[r._status as LedgerStatus]} />,
    },
    {
      key: "days",
      header: "Days Overdue",
      align: "right",
      cell: (r) =>
        r._days > 0 ? <span className="tabular-nums text-destructive">{r._days}</span> : "—",
    },
    // When no booking is picked, keep quick nav to each row's booking.
    ...(bookingId
      ? []
      : [
          {
            key: "bk",
            header: "Booking",
            cell: (r: any) => (
              <Link
                to={`/bookings/${r.booking_id}`}
                className="font-mono text-xs text-primary hover:underline"
              >
                {r.booking_id}
              </Link>
            ),
          } as Column<any>,
        ]),
    {
      key: "act",
      header: "",
      cell: (r) => {
        if (r._status !== "OVERDUE") return null;
        const booking = bookings.find((b: any) => b.booking_id === r.booking_id);
        const phone = normalisePkPhone(booking?.mobile);
        const message = buildReminderMessage({
          clientName: booking?.client_name ?? r.client_name,
          bookingId: r.booking_id,
          unitId: booking?.unit_id ?? r.unit_id,
          particulars: r.particulars,
          dueDate: r.due_date,
          amount: r._balance,
          daysOverdue: r._days,
        });
        const href = phone
          ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
          : `https://wa.me/?text=${encodeURIComponent(message)}`;
        return (
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 min-h-11 min-w-11 text-xs"
            aria-label={`Send WhatsApp reminder for ${r.booking_id}`}
            disabled={!phone}
            title={phone ? "Send WhatsApp reminder" : "No mobile number on booking"}
          >
            <a href={href} target="_blank" rel="noreferrer noopener">
              <MessageCircle className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              WhatsApp
            </a>
          </Button>
        );
      },
    },
  ];

  const scope = activeProject
    ? `${activeProject.project_code} · ${activeProject.project_name}`
    : "All bookings";

  if (accessDenied)
    return (
      <div>
        <PageHeader title="Installment Ledger" description="Restricted view" />
        <AccessDenied
          title="Ledger records are restricted"
          description="Installment ledger data is only visible to admin, manager, and staff roles."
        />
      </div>
    );

  return (
    <div className="space-y-4">
      {/* Mobile-perfected view */}
      <div className="md:hidden -mt-2">
        <MobileLedger
          bookings={bookings}
          allRows={rows}
          isLoading={bookingId ? rowsLoading : bookingsLoading}
          isError={bookingId ? rowsError : bookingsError}
          errorMessage={
            bookingId
              ? (rowsErrorObj as Error | null)?.message
              : (bookingsErrorObj as Error | null)?.message
          }
          onRetry={() => {
            void refetchBookings();
            if (bookingId) void refetchRows();
          }}
          selectedBookingId={bookingId}
          onSelectBooking={setBookingId}
        />
      </div>

      {/* Desktop / tablet view */}
      <div className="hidden md:block space-y-4">
        <PageHeader
          title="Installment Ledger"
          description={`${scope} · ${enriched.length} ledger entr${enriched.length === 1 ? "y" : "ies"}`}
        />

        {/* Booking picker */}
        <div className="p-3.5 flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-border/60 bg-card/75 backdrop-blur-xl shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <span className="text-xs font-semibold text-muted-foreground shrink-0 sm:min-w-32">
            Filter by Booking
          </span>
          <Popover open={bookingPickerOpen} onOpenChange={setBookingPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={bookingPickerOpen}
                aria-label="Select booking"
                className="justify-between h-9 min-h-11 min-w-11 font-normal w-full sm:w-[420px]"
              >
                <span className="truncate">
                  {selectedBooking
                    ? `${selectedBooking.client_name} · ${selectedBooking.booking_id} · ${selectedBooking.unit_id}`
                    : "Search booking by ID, client or unit…"}
                </span>
                <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[420px] pointer-events-auto" align="start">
              <Command>
                <CommandInput placeholder="Search by client, booking, unit…" />
                <CommandList>
                  <CommandEmpty>No bookings found.</CommandEmpty>
                  <CommandGroup>
                    {bookings.map((b: any) => (
                      <CommandItem
                        key={b.booking_id}
                        value={`${b.client_name} ${b.booking_id} ${b.unit_id}`}
                        onSelect={() => {
                          setBookingId(b.booking_id);
                          setBookingPickerOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "h-4 w-4 mr-2",
                            bookingId === b.booking_id ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="capitalize flex-1 truncate">{b.client_name}</span>
                        <span className="font-mono text-xs text-muted-foreground ml-2">
                          {b.booking_id}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground ml-2">
                          {b.unit_id}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {bookingId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 min-h-11 min-w-11"
              onClick={() => setBookingId("")}
              aria-label="Clear booking filter"
            >
              <X className="h-4 w-4 mr-1" aria-hidden="true" />
              Clear
            </Button>
          )}
        </div>

        {/* Booking summary header card */}
        {selectedBooking && bookingTotals && (
          <Card className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-sm">
              <SummaryCell
                label="Client Name"
                value={<span className="capitalize">{selectedBooking.client_name}</span>}
              />
              <SummaryCell
                label="Unit"
                value={<span className="font-mono">{selectedBooking.unit_id}</span>}
              />
              <SummaryCell
                label="Total Sale Price"
                value={fmtPKR(selectedBooking.total_contract_value)}
              />
              <SummaryCell label="Down Payment" value={fmtPKR(selectedBooking.down_payment)} />
              <SummaryCell
                label="Installment Amount"
                value={fmtPKR(selectedBooking.installment_amount)}
              />
              <SummaryCell
                label="Total Installments"
                value={<span className="tabular-nums">{bookingTotals.totalInstallments}</span>}
              />
              <SummaryCell
                label="Paid Count"
                value={<span className="tabular-nums text-success">{bookingTotals.paidCount}</span>}
              />
              <SummaryCell
                label="Remaining Count"
                value={<span className="tabular-nums">{bookingTotals.remainingCount}</span>}
              />
              <SummaryCell
                label="Total Paid"
                value={
                  <span className="tabular-nums text-success">
                    {fmtPKR(bookingTotals.totalPaid)}
                  </span>
                }
              />
              <SummaryCell
                label="Total Remaining"
                value={
                  <span className="tabular-nums font-semibold">
                    {fmtPKR(bookingTotals.totalRemaining)}
                  </span>
                }
              />
            </div>
          </Card>
        )}

        {rowsLoading ? (
          <Card className="p-4">
            <div
              role="status"
              aria-live="polite"
              className="flex flex-col items-center justify-center gap-3 py-14 text-sm text-muted-foreground"
            >
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              <span>Loading ledger entries…</span>
            </div>
          </Card>
        ) : enriched.length === 0 ? (
          <Card className="p-0">
            <EmptyState
              icon={FileText}
              title={
                selectedBooking
                  ? "No ledger entries for this booking yet"
                  : rows.length === 0
                    ? "No ledger entries"
                    : "No matching ledger entries"
              }
              description={
                selectedBooking
                  ? "This booking has no scheduled installments recorded. Add a payment plan or verify the booking setup to see entries here."
                  : rows.length === 0
                    ? "Once bookings have installment schedules, their rows will appear here."
                    : "Try clearing the booking filter above."
              }
              action={
                selectedBooking ? (
                  <Button variant="outline" size="sm" onClick={() => setBookingId("")}>
                    <X className="h-4 w-4 mr-1" aria-hidden="true" /> Clear booking filter
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <DataTable
            rows={enriched}
            columns={columns}
            rowKey={(r) => r.ledger_id}
            searchKeys={["booking_id", "client_name", "particulars", "ledger_id"]}
          />
        )}
        {rowsFetching && !rowsLoading ? (
          <p className="text-[11px] text-muted-foreground -mt-2 pl-1" aria-live="polite">
            Refreshing…
          </p>
        ) : null}

        {/* Footer totals */}
        <Card className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <SummaryCell
              label="Total Schedule"
              value={<span className="tabular-nums">{fmtPKR(totals.schedule)}</span>}
            />
            <SummaryCell
              label="Total Paid"
              value={<span className="tabular-nums text-success">{fmtPKR(totals.paid)}</span>}
            />
            <SummaryCell
              label="Total Overdue"
              value={
                <span className="tabular-nums text-destructive">{fmtPKR(totals.overdue)}</span>
              }
            />
            <SummaryCell
              label="Balance Due"
              value={<span className="tabular-nums font-semibold">{fmtPKR(totals.balance)}</span>}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate">{value}</div>
    </div>
  );
}
