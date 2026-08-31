import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Search,
  X,
  Check,
  Clock,
  Loader2,
  FileText,
  Inbox,
  AlertTriangle,
  SearchX,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { MobilePaymentWizard } from "@/components/MobilePaymentWizard";

import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";

import { fmtDate, fmtPKR } from "@/lib/format";
import { deriveStatus, type LedgerStatus } from "@/lib/ledgerStatus";

const STATUS_TONE: Record<LedgerStatus, "success" | "danger" | "warning" | "adjustment" | "muted"> =
  {
    PAID: "success",
    OVERDUE: "danger",
    "DUE SOON": "warning",
    PARTIAL: "adjustment",
    UPCOMING: "muted",
  };

type Booking = {
  booking_id: string;
  client_name?: string | null;
  unit_id?: string | null;
  total_contract_value?: number | null;
};

type LedgerRow = {
  ledger_id: string;
  booking_id: string;
  term_no?: number | null;
  due_date?: string | null;
  due_amount?: number | null;
  paid_amount?: number | null;
  particulars?: string | null;
};

/**
 * Mobile-first Installment Ledger.
 *
 * Two states:
 *   1. Search state — large centered search box + 5 recent-booking chips.
 *   2. Booking state — sticky client-summary card, per-installment cards,
 *      fixed footer summary, "Pay Now" opens a bottom sheet wizard
 *      pre-filled with the installment amount.
 */
export function MobileLedger({
  bookings,
  allRows,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  selectedBookingId,
  onSelectBooking,
}: {
  bookings: Booking[];
  allRows: LedgerRow[];
  isLoading: boolean;
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  selectedBookingId: string;
  onSelectBooking: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [payFor, setPayFor] = useState<{ bookingId: string; amount: number } | null>(null);
  const [navigating, setNavigating] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Invalidate ledger + booking summaries so the installment list, sticky
  // totals, and overdue banner all refetch immediately after a payment.
  const refreshLedger = () => {
    void queryClient.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey?.[0];
        return (
          k === "ledger-all" ||
          k === "ledger-bookings" ||
          k === "payments" ||
          k === "booking-payments"
        );
      },
    });
  };

  const selected = useMemo(
    () => bookings.find((b) => b.booking_id === selectedBookingId) ?? null,
    [bookings, selectedBookingId],
  );

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return bookings
      .filter(
        (b) =>
          b.booking_id.toLowerCase().includes(q) ||
          (b.client_name ?? "").toLowerCase().includes(q) ||
          (b.unit_id ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [bookings, search]);

  const recentChips = useMemo(() => bookings.slice(0, 5), [bookings]);

  const rows = useMemo(() => {
    if (!selectedBookingId) return [];
    return allRows.filter((r) => r.booking_id === selectedBookingId);
  }, [allRows, selectedBookingId]);

  const enriched = useMemo(() => {
    const today = new Date();
    return rows.map((r) => {
      const due = Number(r.due_amount) || 0;
      const paid = Number(r.paid_amount) || 0;
      const balance = Math.max(due - paid, 0);
      const status = deriveStatus(due, paid, r.due_date ?? null, today);
      return { ...r, _balance: balance, _status: status };
    });
  }, [rows]);

  const totals = useMemo(() => {
    let schedule = 0,
      paid = 0,
      overdueCount = 0,
      overdueAmount = 0;
    for (const r of enriched) {
      schedule += Number(r.due_amount) || 0;
      paid += Number(r.paid_amount) || 0;
      if (r._status === "OVERDUE") {
        overdueCount += 1;
        overdueAmount += r._balance;
      }
    }
    const balance = Math.max(schedule - paid, 0);
    const pct = schedule > 0 ? Math.min(100, Math.round((paid / schedule) * 100)) : 0;
    return { schedule, paid, balance, overdueCount, overdueAmount, pct };
  }, [enriched]);

  // ── SEARCH STATE ────────────────────────────────────────────────
  if (!selected) {
    return (
      <section
        aria-labelledby="ledger-search-heading"
        className="min-h-[70vh] flex flex-col items-center px-4 pt-16 pb-24"
      >
        <div className="w-full max-w-md">
          <h2 id="ledger-search-heading" className="text-center text-xl font-bold mb-2">
            Installment Ledger
          </h2>
          <p className="text-center text-sm text-muted-foreground mb-6">
            Look up a booking to view its schedule.
          </p>
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Enter Booking ID or Client Name"
              className="h-14 pl-11 text-base rounded-2xl"
              aria-label="Search booking"
              autoFocus
            />
          </div>

          {isError ? (
            <Card className="mt-4 p-6 text-center border-destructive/40 bg-destructive/5">
              <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2" aria-hidden="true" />
              <div className="text-sm font-semibold">Couldn't load bookings</div>
              <p className="text-xs text-muted-foreground mt-1">
                {errorMessage ?? "Check your connection and try again."}
              </p>
              {onRetry ? (
                <Button size="sm" variant="outline" className="mt-3 min-h-11" onClick={onRetry}>
                  Retry
                </Button>
              ) : null}
            </Card>
          ) : matches.length > 0 ? (
            <Card className="mt-3 divide-y" role="list" aria-label="Matching bookings">
              {matches.map((b) => (
                <button
                  key={b.booking_id}
                  type="button"
                  role="listitem"
                  onClick={() => {
                    onSelectBooking(b.booking_id);
                    setSearch("");
                  }}
                  className="w-full text-left px-4 py-3 min-h-11 hover:bg-muted/50 active:bg-muted transition-colors"
                >
                  <div className="text-sm font-semibold capitalize truncate">
                    {b.client_name ?? "—"}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">
                    {b.booking_id} · {b.unit_id ?? "—"}
                  </div>
                </button>
              ))}
            </Card>
          ) : search.trim() ? (
            <Card className="mt-3 p-6 text-center">
              <SearchX className="h-8 w-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
              <div className="text-sm font-semibold">No bookings found</div>
              <p className="text-xs text-muted-foreground mt-1">
                Nothing matches "{search.trim()}". Try a different ID, client name, or unit.
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="mt-3 min-h-11"
                onClick={() => setSearch("")}
              >
                Clear search
              </Button>
            </Card>
          ) : isLoading ? (
            <div className="mt-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading bookings…
            </div>
          ) : recentChips.length === 0 ? (
            <Card className="mt-8 p-6 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
              <div className="text-sm font-semibold">No bookings yet</div>
              <p className="text-xs text-muted-foreground mt-1">
                Create a booking to start tracking installments here.
              </p>
            </Card>
          ) : (
            <>
              <div
                className="mt-8 mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                id="recent-bookings-label"
              >
                Recent bookings
              </div>
              <div
                className="flex flex-wrap gap-2"
                role="list"
                aria-labelledby="recent-bookings-label"
              >
                {recentChips.map((b) => (
                  <button
                    key={b.booking_id}
                    type="button"
                    role="listitem"
                    onClick={() => onSelectBooking(b.booking_id)}
                    className="min-h-11 px-4 rounded-full border border-border bg-card text-sm font-medium hover:bg-muted transition-colors max-w-full truncate"
                    aria-label={`Open booking ${b.client_name ?? b.booking_id} ${b.unit_id ?? b.booking_id}`}
                  >
                    <span className="capitalize">{b.client_name ?? b.booking_id}</span>
                    <span className="text-muted-foreground font-mono ml-2 text-xs">
                      {b.unit_id ?? b.booking_id}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    );
  }

  // ── BOOKING STATE ───────────────────────────────────────────────
  const total = Number(selected.total_contract_value) || totals.schedule;
  const overdueTone = totals.overdueCount > 0;

  return (
    <section
      className="pb-28"
      aria-label={`Installment schedule for ${selected.client_name ?? selected.booking_id}`}
    >
      {/* Sticky client summary */}
      <div
        className="sticky top-0 z-20 -mx-4 px-4 py-3 bg-background/95 backdrop-blur border-b border-border"
        role="region"
        aria-label="Booking summary"
      >
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            disabled={navigating}
            onClick={() => {
              const id = (selected.booking_id ?? "").trim();
              if (!id) {
                track("ledger_summary_open_booking_failed", {
                  reason: "missing_booking_id",
                  client_name: selected.client_name ?? null,
                  unit_id: selected.unit_id ?? null,
                });
                toast.error("Booking unavailable", {
                  description:
                    "This booking has no valid ID to open. Try picking it again from search.",
                });
                return;
              }
              track("ledger_summary_open_booking", {
                booking_id: id,
                client_name: selected.client_name ?? null,
                unit_id: selected.unit_id ?? null,
                source: "mobile_ledger_summary_card",
              });
              setNavigating(true);
              void Promise.resolve(navigate({ to: "/bookings/$id", params: { id } })).finally(() =>
                setNavigating(false),
              );
            }}
            className="min-w-0 flex-1 text-left rounded-md -mx-1 px-1 py-1 hover:bg-muted/50 active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background min-h-11 disabled:opacity-70 disabled:cursor-progress cursor-pointer"
            aria-label={
              navigating
                ? `Opening booking details for ${selected.client_name ?? selected.booking_id}`
                : `Open booking details for ${selected.client_name ?? "unnamed client"}, booking ${selected.booking_id}${selected.unit_id ? `, unit ${selected.unit_id}` : ""}`
            }
            aria-busy={navigating}
            aria-live="polite"
          >
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <div className="text-base font-bold capitalize truncate">
                  {selected.client_name ?? "—"}
                </div>
                <div className="text-xs text-muted-foreground font-mono truncate mt-0.5">
                  {selected.booking_id} · {selected.unit_id ?? "—"}
                </div>
              </div>
              {navigating ? (
                <Loader2
                  className="h-4 w-4 text-muted-foreground shrink-0 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <ChevronRight
                  className="h-4 w-4 text-muted-foreground shrink-0"
                  aria-hidden="true"
                />
              )}
            </div>
          </button>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 min-h-11 min-w-11"
            onClick={() => onSelectBooking("")}
            aria-label="Change booking"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <SummaryChip label="Total" value={fmtPKR(total)} />
          <SummaryChip label="Paid" value={fmtPKR(totals.paid)} tone="success" />
          <SummaryChip
            label="Due"
            value={fmtPKR(totals.balance)}
            tone={overdueTone ? "danger" : "default"}
          />
        </div>

        <div className="mt-3">
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-success transition-[width] duration-500"
              style={{ width: `${totals.pct}%` }}
              aria-label={`${totals.pct}% collected`}
              role="progressbar"
              aria-valuenow={totals.pct}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground text-right tabular-nums">
            {totals.pct}% collected
          </div>
        </div>
      </div>

      {/* Installment list */}
      <div className="mt-4 space-y-2" role="list" aria-label="Installments">
        {isError ? (
          <Card className="p-6 text-center border-destructive/40 bg-destructive/5">
            <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2" aria-hidden="true" />
            <div className="text-sm font-semibold">Couldn't load installments</div>
            <p className="text-xs text-muted-foreground mt-1">
              {errorMessage ?? "Something went wrong loading this booking's schedule."}
            </p>
            {onRetry ? (
              <Button size="sm" variant="outline" className="mt-3 min-h-11" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
          </Card>
        ) : isLoading ? (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading installments…
          </div>
        ) : enriched.length === 0 ? (
          <Card className="p-0">
            <EmptyState
              icon={FileText}
              title="No installments for this booking"
              description="No scheduled installments were found. Add a payment plan or verify the booking setup, then pull to refresh."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  onClick={() => onSelectBooking("")}
                >
                  <X className="h-4 w-4 mr-1" aria-hidden="true" /> Choose another booking
                </Button>
              }
            />
          </Card>
        ) : (
          enriched.map((r) => {
            const isOverdue = r._status === "OVERDUE";
            const isPaid = r._status === "PAID";
            return (
              <Card
                key={r.ledger_id}
                role="listitem"
                className={cn(
                  "p-3 flex items-center gap-3",
                  isOverdue && "border-l-4 border-l-destructive bg-destructive/5",
                )}
                aria-label={`Installment ${r.term_no ?? ""}, ${fmtPKR(r.due_amount)}, ${r._status.toLowerCase()}${
                  r.due_date ? `, due ${fmtDate(r.due_date)}` : ""
                }`}
              >
                {/* Left: installment no + due date */}
                <div className="w-14 shrink-0 text-center" aria-hidden="true">
                  <div className="text-2xl font-bold text-muted-foreground tabular-nums leading-none">
                    {r.term_no ?? "—"}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {r.due_date ? fmtDate(r.due_date) : "—"}
                  </div>
                </div>

                {/* Center: amount + status */}
                <div className="min-w-0 flex-1">
                  <div className="text-base font-bold tabular-nums" aria-hidden="true">
                    {fmtPKR(r.due_amount)}
                  </div>
                  <div className="mt-1" role="status" aria-label={`Status: ${r._status}`}>
                    <StatusBadge label={r._status} tone={STATUS_TONE[r._status as LedgerStatus]} />
                  </div>
                </div>

                {/* Right: action */}
                <div className="shrink-0">
                  {isOverdue ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="min-h-11 min-w-11 h-11 px-4 font-semibold"
                      onClick={() =>
                        setPayFor({
                          bookingId: r.booking_id,
                          amount: r._balance || Number(r.due_amount) || 0,
                        })
                      }
                      aria-label={`Pay now: installment ${r.term_no ?? ""}, amount ${fmtPKR(
                        r._balance || Number(r.due_amount) || 0,
                      )}${r.due_date ? `, due ${fmtDate(r.due_date)}` : ""} — opens payment form`}
                    >
                      Pay Now
                    </Button>
                  ) : isPaid ? (
                    <div
                      className="h-11 w-11 rounded-full bg-success/15 grid place-items-center"
                      role="img"
                      aria-label={`Installment ${r.term_no ?? ""} paid`}
                    >
                      <Check className="h-5 w-5 text-success" aria-hidden="true" />
                    </div>
                  ) : (
                    <div
                      className="h-11 w-11 rounded-full bg-muted grid place-items-center"
                      role="img"
                      aria-label={`Installment ${r.term_no ?? ""} upcoming${
                        r.due_date ? `, due ${fmtDate(r.due_date)}` : ""
                      }`}
                    >
                      <Clock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    </div>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Fixed summary above tab bar */}
      <div
        className="fixed inset-x-0 bottom-16 z-30 px-4 pointer-events-none"
        role="region"
        aria-label="Outstanding balance summary"
      >
        <div
          className={cn(
            "mx-auto max-w-md rounded-xl shadow-lg border px-4 py-3 text-sm font-semibold flex items-center justify-between",
            overdueTone
              ? "bg-destructive text-destructive-foreground border-destructive"
              : "bg-card text-foreground border-border",
          )}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={`${totals.overdueCount} overdue installment${
            totals.overdueCount === 1 ? "" : "s"
          }, ${fmtPKR(totals.overdueAmount)} outstanding`}
        >
          <span aria-hidden="true">{totals.overdueCount} overdue</span>
          <span aria-hidden="true" className="tabular-nums">
            PKR {fmtPKR(totals.overdueAmount).replace(/^PKR\s*/, "")} outstanding
          </span>
        </div>
      </div>

      {/* Pay Now — full-screen wizard slides up */}
      {payFor ? (
        <MobilePaymentWizard
          open={!!payFor}
          onClose={() => setPayFor(null)}
          onSaved={refreshLedger}
          onPrint={() => setPayFor(null)}
          initialBookingId={payFor.bookingId}
          initialAmount={payFor.amount}
          initialHead="Installment"
        />
      ) : null}
    </section>
  );
}

function SummaryChip({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "danger";
}) {
  return (
    <div className="rounded-lg bg-muted/50 px-2 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-xs font-bold tabular-nums truncate",
          tone === "success" && "text-success",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </div>
    </div>
  );
}
