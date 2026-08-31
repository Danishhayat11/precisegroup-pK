/**
 * PaymentHistoryDialog — on-screen filter panel + quick stats + launches
 * PrintPreviewModal containing the printable PaymentHistoryDoc.
 *
 * Usage:
 *   <PaymentHistoryButton bookingId="BK-MA-00010" />
 *
 * Loads booking + payments + adjustments by id, shows a small filter
 * panel (date range, toggles, quick stats), and then opens the standard
 * PrintPreviewModal for the actual print/PDF.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { DialogSkeleton } from "@/components/ui/skeletons";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Printer } from "lucide-react";
import PrintPreviewModal from "@/components/PrintPreviewModal";
import PaymentHistoryDoc, { type PaymentHistoryFilters } from "@/components/PaymentHistoryDoc";
import type { LetterheadStyle } from "@/lib/letterhead";
import { resolveLetterhead, persistLetterhead, clearClientLetterhead } from "@/lib/letterheadPrefs";
import { fmtPKR } from "@/lib/format";
import { format, parseISO, differenceInDays } from "date-fns";
import { usePIIGuardedQuery } from "@/lib/access";

const FMT = (d?: string | Date | null) =>
  d ? format(typeof d === "string" ? parseISO(d) : d, "dd-MM-yyyy") : "—";

export function PaymentHistoryButton({
  bookingId,
  variant = "outline",
  size = "sm",
  label = "Print Payment History",
  iconOnly = false,
  className,
}: {
  bookingId: string;
  variant?: any;
  size?: any;
  label?: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        size={iconOnly ? "icon" : size}
        className={className}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Printer className={iconOnly ? "h-3.5 w-3.5" : "h-4 w-4 mr-1"} />
        {!iconOnly && label}
      </Button>
      {open && <PaymentHistoryDialog bookingId={bookingId} open={open} onOpenChange={setOpen} />}
    </>
  );
}

export default function PaymentHistoryDialog({
  bookingId,
  open,
  onOpenChange,
}: {
  bookingId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showAdjustments, setShowAdjustments] = useState(true);
  const [showRemarks, setShowRemarks] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [letterhead, setLetterheadState] = useState<LetterheadStyle>(
    () => resolveLetterhead(null).style,
  );
  const [letterheadSource, setLetterheadSource] = useState<"client" | "global" | "default">(
    "default",
  );

  const { data, isLoading } = usePIIGuardedQuery({
    queryKey: ["payment-history", bookingId],
    enabled: !!bookingId && open,
    queryFn: async () => {
      const [b, pays, adj, led] = await Promise.all([
        supabase.from("bookings").select("*").eq("booking_id", bookingId).maybeSingle(),
        supabase.from("payments").select("*").eq("booking_id", bookingId).order("payment_date"),
        supabase.from("adjustments").select("*").eq("booking_id", bookingId),
        supabase
          .from("installment_ledger")
          .select("*")
          .eq("booking_id", bookingId)
          .order("due_date"),
      ]);
      return {
        booking: b.data,
        payments: pays.data ?? [],
        adjustments: adj.data ?? [],
        ledger: led.data ?? [],
      };
    },
  });

  // Per-client preference key — prefer client_ref, fall back to booking_id so
  // every booking still gets its own remembered letterhead.
  const clientKey = (data?.booking?.client_ref as string | undefined) || bookingId || null;

  // When booking loads (or when switching to a different client), apply the
  // fallback chain: per-client → last-used global → hard default ("B").
  useEffect(() => {
    if (!open) return;
    const { style, source } = resolveLetterhead(clientKey);
    setLetterheadState(style);
    setLetterheadSource(source);
  }, [open, clientKey]);

  const setLetterhead = (v: LetterheadStyle) => {
    setLetterheadState(v);
    setLetterheadSource("client");
    persistLetterhead(clientKey, v);
  };

  const resetLetterhead = () => {
    clearClientLetterhead(clientKey);
    const { style, source } = resolveLetterhead(clientKey);
    setLetterheadState(style);
    setLetterheadSource(source);
  };

  const filters: PaymentHistoryFilters = useMemo(
    () => ({ dateFrom, dateTo, showAdjustments, showRemarks }),
    [dateFrom, dateTo, showAdjustments, showRemarks],
  );

  const stats = useMemo(() => {
    const pays = (data?.payments || []) as any[];
    const cash = pays
      .filter((p) => !p.non_cash_adjustment)
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const last = pays
      .filter((p) => p.payment_date)
      .sort((a, b) => (b.payment_date || "").localeCompare(a.payment_date || ""))[0];
    const days = last?.payment_date
      ? differenceInDays(new Date(), new Date(last.payment_date))
      : null;
    return { count: pays.length, cash, last: last?.payment_date, days };
  }, [data]);

  return (
    <>
      <Dialog open={open && !previewOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Payment History — {bookingId}</DialogTitle>
            <DialogDescription>
              {data?.booking
                ? `${data.booking.client_name} · ${data.booking.unit_id}`
                : "Loading client…"}
            </DialogDescription>
          </DialogHeader>

          {isLoading || !data?.booking ? (
            <DialogSkeleton />
          ) : (
            <>
              {/* Quick stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
                <Stat label="Total Payments" value={String(stats.count)} />
                <Stat label="Cash + Bank" value={`PKR ${fmtPKR(stats.cash)}`} />
                <Stat label="Last Payment" value={stats.last ? FMT(stats.last) : "—"} />
                <Stat
                  label="Days Since Last"
                  value={stats.days != null ? `${stats.days} days` : "—"}
                />
              </div>
              {stats.days != null && stats.days > 180 ? (
                <Badge variant="destructive" className="mb-2">
                  No payment in 6+ months
                </Badge>
              ) : stats.days != null && stats.days > 90 ? (
                <Badge className="mb-2 bg-orange-500 hover:bg-orange-500/90">
                  No payment in 90+ days
                </Badge>
              ) : null}

              {/* Filters */}
              <div className="rounded-md border p-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="pay-hist-from" className="text-xs">
                      From
                    </Label>
                    <Input
                      id="pay-hist-from"
                      type="date"
                      value={dateFrom}
                      max={dateTo || undefined}
                      onChange={(e) => setDateFrom(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pay-hist-to" className="text-xs">
                      To
                    </Label>
                    <Input
                      id="pay-hist-to"
                      type="date"
                      value={dateTo}
                      min={dateFrom || undefined}
                      onChange={(e) => setDateTo(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="show-adj"
                      checked={showAdjustments}
                      onCheckedChange={setShowAdjustments}
                    />
                    <Label htmlFor="show-adj" className="text-xs">
                      Show adjustment payments
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="show-rem" checked={showRemarks} onCheckedChange={setShowRemarks} />
                    <Label htmlFor="show-rem" className="text-xs">
                      Show remarks column
                    </Label>
                  </div>
                </div>
                <div className="flex items-center gap-3 pt-1 border-t">
                  <Label className="text-xs">Letterhead</Label>
                  <div
                    className="inline-flex rounded-md border overflow-hidden"
                    role="group"
                    aria-label="Letterhead style"
                  >
                    <button
                      type="button"
                      onClick={() => setLetterhead("A")}
                      className={`px-3 py-1 text-xs ${letterhead === "A" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                    >
                      Style A — Notices
                    </button>
                    <button
                      type="button"
                      onClick={() => setLetterhead("B")}
                      className={`px-3 py-1 text-xs border-l ${letterhead === "B" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                    >
                      Style B — Transactional
                    </button>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {letterheadSource === "client"
                      ? "Saved for this client"
                      : letterheadSource === "global"
                        ? "Using last-used letterhead (no client preference yet)"
                        : "Using default letterhead"}
                  </span>
                  {letterheadSource === "client" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      onClick={resetLetterhead}
                      title="Clear this client's saved letterhead and fall back to the last-used global setting"
                    >
                      Reset to global
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => setPreviewOpen(true)} disabled={!data?.booking}>
              <Printer className="h-4 w-4 mr-1" /> Open Print Preview
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {data?.booking && (
        <PrintPreviewModal
          open={previewOpen}
          onOpenChange={(o) => {
            setPreviewOpen(o);
            if (!o) onOpenChange(false);
          }}
          title={`Payment History — ${data.booking.booking_id} — ${data.booking.client_name}`}
          mode="react"
          style={letterhead}
        >
          <PaymentHistoryDoc
            booking={data.booking}
            payments={data.payments as any[]}
            adjustments={data.adjustments as any[]}
            ledger={data.ledger as any[]}
            filters={filters}
          />
        </PrintPreviewModal>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-2.5 py-1.5">
      <div className="text-[10px] uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
