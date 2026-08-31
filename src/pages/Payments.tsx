import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "@/lib/router-compat";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { CashIntegrityBanner } from "@/components/CashIntegrityBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, fmtPKR } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  CalendarIcon,
  FileText,
  Plus,
  Search,
  MessageSquare,
  Pencil,
  Lock,
  Layers,
  Printer,
} from "lucide-react";
import { PaymentBreakdown } from "@/components/PaymentBreakdown";
import { cn } from "@/lib/utils";
import { PaymentForm, PAYMENT_TYPES } from "@/components/PaymentForm";
import { PaymentReceipt } from "@/components/PaymentReceipt";
import { PaymentCommentsPanel } from "@/components/PaymentCommentsPanel";
import { PaymentEditHistory } from "@/components/PaymentEditHistory";
import { MobilePaymentWizard } from "@/components/MobilePaymentWizard";
import { useAuth } from "@/lib/auth";
import { AdminRequiredMessage } from "@/lib/adminGate";
import { useActiveProject } from "@/lib/activeProject";
import { usePIIGuardedQuery, AccessDenied } from "@/lib/access";
import { TableRowsSkeleton } from "@/components/ui/skeletons";
import { EmptyState } from "@/components/EmptyState";
import { Receipt as ReceiptIcon } from "lucide-react";

export default function Payments() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const { activeCode, activeProject } = useActiveProject();
  const [params] = useSearchParams();
  const bookingFilter = params.get("booking") ?? "";

  const [search, setSearch] = useState("");
  const [type, setType] = useState("All");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [mobileWizardOpen, setMobileWizardOpen] = useState(false);
  const [receiptNo, setReceiptNo] = useState<string | null>(null);
  const [breakdownNo, setBreakdownNo] = useState<string | null>(null);
  const [commentTarget, setCommentTarget] = useState<{
    receipt_no?: string;
    booking_id?: string;
    defaultKind?: "comment" | "edit_request";
  } | null>(null);
  const [editRow, setEditRow] = useState<any | null>(null);
  const [showEditGate, setShowEditGate] = useState<any | null>(null);

  const { data: openCounts = {} } = usePIIGuardedQuery({
    queryKey: ["payment-comments-open-map"],
    queryFn: async () => {
      const { data } = await supabase
        .from("payment_comments" as any)
        .select("payment_receipt_no")
        .eq("status", "open")
        .not("payment_receipt_no", "is", null);
      const map: Record<string, number> = {};
      for (const r of (data ?? []) as any[]) {
        map[r.payment_receipt_no] = (map[r.payment_receipt_no] ?? 0) + 1;
      }
      return map;
    },
    staleTime: 30_000,
  });

  const {
    data: rows = [],
    accessDenied,
    isPending,
  } = usePIIGuardedQuery<any[]>({
    queryKey: ["payments", activeCode ?? "all"],
    queryFn: async () => {
      let q = supabase.from("payments").select("*").order("payment_date", { ascending: false });
      // Payments store the project by name (text). Scope by activeProject.
      if (activeProject?.project_name) q = q.eq("project", activeProject.project_name);
      return (await q).data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const lq = search.trim().toLowerCase();
    return rows.filter((p: any) => {
      if (bookingFilter && p.booking_id !== bookingFilter) return false;
      if (type !== "All" && (p.payment_mode ?? "") !== type) return false;
      if (from && (p.payment_date ?? "") < from) return false;
      if (to && (p.payment_date ?? "") > to) return false;
      if (!lq) return true;
      return [p.receipt_no, p.booking_id, p.client_name, p.unit_no, p.cheque_txn_no].some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(lq),
      );
    });
  }, [rows, search, type, from, to, bookingFilter]);

  const totals = useMemo(() => {
    let cash = 0,
      bank = 0,
      adj = 0;
    for (const p of filtered as any[]) {
      const amt = Number(p.amount || 0);
      if (p.payment_mode === "Cash") cash += amt;
      else if (p.payment_mode === "Bank Transfer") bank += amt;
      else if (p.payment_mode === "Adjustment/Asset" || p.payment_mode === "Adjustment") adj += amt;
    }
    return { cash, bank, adj, grand: cash + bank + adj };
  }, [filtered]);

  const DateBtn = ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
  }) => (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-9 justify-start text-left font-normal min-w-[140px]",
            !value && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="h-4 w-4 mr-2" />
          {value ? format(new Date(value), "dd-MMM-yyyy") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value ? new Date(value) : undefined}
          onSelect={(d) => onChange(d ? format(d, "yyyy-MM-dd") : "")}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );

  const typeBadgeTone = (m: string) =>
    m === "Cash" ? "success" : m === "Bank Transfer" ? "info" : "adjustment";

  if (accessDenied) {
    return (
      <div>
        <PageHeader title="Payments" description="Restricted view" />
        <AccessDenied
          title="Payment records are restricted"
          description="Payment receipts, allocations, and client references are only visible to admin, manager, and staff roles."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Payments"
        description={`${rows.length} receipts · Cash & Bank kept separate from Adjustment/Asset`}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Record payment
          </Button>
        }
      />

      <div className="mb-4">
        <CashIntegrityBanner />
      </div>

      {/* Mobile: search only */}
      <div className="md:hidden mb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search receipts, clients, units…"
            className="pl-9 h-11"
          />
        </div>
      </div>

      {/* Filter bar — desktop/tablet */}
      <div className="p-3.5 mb-4 hidden md:flex flex-wrap items-center gap-3 rounded-2xl border border-border/60 bg-card/75 backdrop-blur-xl shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Receipt, Booking ID, Client, Unit…"
            className="pl-9.5 bg-background/50 border border-border/60 h-9.5 rounded-xl"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All</SelectItem>
              {PAYMENT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">From</Label>
          <DateBtn value={from} onChange={setFrom} placeholder="From date" />
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">To</Label>
          <DateBtn value={to} onChange={setTo} placeholder="To date" />
        </div>
        {(from || to || type !== "All" || search || bookingFilter) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setType("All");
              setFrom("");
              setTo("");
            }}
          >
            Clear
          </Button>
        )}
        <div className="text-xs text-muted-foreground tabular-nums ml-auto">
          {filtered.length} of {rows.length}
        </div>
      </div>

      {/* Mobile card list */}
      <div
        className="md:hidden space-y-2"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 56px + 56px + 24px)" }}
      >
        {isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl border p-4 h-32 bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border">
            <EmptyState
              icon={ReceiptIcon}
              title={rows.length === 0 ? "No payments yet" : "No matching payments"}
              description={
                rows.length === 0
                  ? "Tap Receive Payment to record your first receipt."
                  : "Try clearing the search."
              }
            />
          </div>
        ) : (
          filtered.map((p: any) => (
            <div key={p.receipt_no} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-mono">{p.receipt_no}</span>
                <span>{fmtDate(p.payment_date)}</span>
              </div>
              <div className="mt-1.5 flex items-baseline justify-between gap-2">
                <span className="font-semibold text-base truncate">{p.client_name ?? "—"}</span>
                <span className="text-xs font-mono text-muted-foreground shrink-0">
                  {p.unit_no ?? "—"}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <StatusBadge label={p.payment_head ?? "—"} tone="info" />
                <StatusBadge
                  label={p.payment_mode ?? "—"}
                  tone={typeBadgeTone(p.payment_mode) as any}
                />
              </div>
              <div className="mt-3 text-2xl font-bold tabular-nums text-success">
                PKR {fmtPKR(p.amount)}
              </div>
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 w-9 p-0"
                  aria-label="Print receipt"
                  onClick={() => setReceiptNo(p.receipt_no)}
                >
                  <Printer className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Table — desktop/tablet */}
      <div className="card-elevated overflow-hidden hidden md:block">
        <div className="overflow-x-auto max-h-[60vh]">
          <table className="w-full text-sm table-sticky">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-2.5 border-b">ID</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Date</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Client</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Unit</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Type</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Head</th>
                <th className="text-right font-medium px-4 py-2.5 border-b">Amount (PKR)</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Reference</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Receipt</th>
                <th className="text-left font-medium px-4 py-2.5 border-b">Comments</th>
                <th className="text-right font-medium px-4 py-2.5 border-b">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isPending ? (
                <TableRowsSkeleton rows={6} columns={11} />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-0">
                    <EmptyState
                      icon={ReceiptIcon}
                      title={
                        rows.length === 0 ? "No payments yet" : "No payments match these filters"
                      }
                      description={
                        rows.length === 0
                          ? "Click New Payment to record your first receipt."
                          : "Try a different date range, mode, or clear the search."
                      }
                      action={
                        rows.length === 0 && isAdmin ? (
                          <Button size="sm" onClick={() => setCreateOpen(true)}>
                            <Plus className="h-4 w-4 mr-1" /> New Payment
                          </Button>
                        ) : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                filtered.map((p: any) => {
                  const openCount = openCounts[p.receipt_no] ?? 0;
                  return (
                    <tr key={p.receipt_no} className="border-t hover:bg-muted/30">
                      <td className="px-4 py-2.5 font-mono text-xs text-primary">
                        <div>{p.receipt_no}</div>
                        <PaymentEditHistory receiptNo={p.receipt_no} />
                      </td>
                      <td className="px-4 py-2.5">{fmtDate(p.payment_date)}</td>
                      <td className="px-4 py-2.5 capitalize">{p.client_name ?? "—"}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{p.unit_no ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <StatusBadge
                          label={p.payment_mode ?? "—"}
                          tone={typeBadgeTone(p.payment_mode) as any}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-xs">{p.payment_head ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                        {fmtPKR(p.amount)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {p.cheque_txn_no ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7"
                            onClick={() => setBreakdownNo(p.receipt_no)}
                            title="Receipt-style breakdown of allocations and notes"
                          >
                            <Layers className="h-3.5 w-3.5 mr-1" /> Breakdown
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7"
                            onClick={() => setReceiptNo(p.receipt_no)}
                            title="Printable receipt"
                          >
                            <FileText className="h-3.5 w-3.5 mr-1" /> View
                          </Button>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 relative"
                          onClick={() => setCommentTarget({ receipt_no: p.receipt_no })}
                        >
                          <MessageSquare className="h-3.5 w-3.5 mr-1" />
                          {openCount > 0 ? (
                            <span className="text-warning font-medium">{openCount} open</span>
                          ) : (
                            "Comment"
                          )}
                        </Button>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {isAdmin ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7"
                            onClick={() => setEditRow(p)}
                          >
                            <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-muted-foreground"
                            title="Admins only — click to leave an edit request"
                            onClick={() => setShowEditGate(p)}
                          >
                            <Lock className="h-3.5 w-3.5 mr-1" /> Request edit
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {/* Summary footer — Cash / Bank / Adjustment shown SEPARATELY */}
            <tfoot className="bg-muted/40 text-sm font-semibold border-t-2 border-primary/30">
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-3 text-right text-xs uppercase tracking-wide text-muted-foreground"
                >
                  Totals (filtered)
                </td>
                <td className="px-4 py-3 text-right tabular-nums" colSpan={5}>
                  <div className="grid grid-cols-4 gap-4 text-xs">
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">Cash</div>
                      <div className="text-success">{fmtPKR(totals.cash)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">Bank</div>
                      <div className="text-info">{fmtPKR(totals.bank)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">Adjustment</div>
                      <div className="text-adjustment">{fmtPKR(totals.adj)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">Grand</div>
                      <div className="text-primary">{fmtPKR(totals.grand)}</div>
                    </div>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>
              Cash and Bank Transfer count toward Cash Received. Adjustment/Asset is tracked
              separately.
            </DialogDescription>
          </DialogHeader>
          <PaymentForm
            initial={bookingFilter ? { booking_id: bookingFilter } : undefined}
            onCancel={() => setCreateOpen(false)}
            onSaved={(no) => {
              setCreateOpen(false);
              qc.invalidateQueries({ queryKey: ["payments"] });
              setReceiptNo(no);
            }}
          />
        </DialogContent>
      </Dialog>

      <PaymentReceipt
        open={!!receiptNo}
        onOpenChange={(o) => !o && setReceiptNo(null)}
        receiptNo={receiptNo}
      />
      <PaymentBreakdown
        open={!!breakdownNo}
        onOpenChange={(o) => !o && setBreakdownNo(null)}
        receiptNo={breakdownNo}
      />

      {/* Admin edit dialog */}
      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit payment {editRow?.receipt_no}</DialogTitle>
            <DialogDescription>
              Admin-only. Changes are logged and immediately recompute the ledger.
            </DialogDescription>
          </DialogHeader>
          {editRow && (
            <PaymentForm
              initial={editRow}
              onCancel={() => setEditRow(null)}
              onSaved={() => {
                setEditRow(null);
                qc.invalidateQueries({ queryKey: ["payments"] });
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Staff "Request edit" — friendly gate that opens the comment thread */}
      <Dialog open={!!showEditGate} onOpenChange={(o) => !o && setShowEditGate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request edit · {showEditGate?.receipt_no}</DialogTitle>
          </DialogHeader>
          <AdminRequiredMessage
            action="Editing an existing payment"
            onRequestEdit={() => {
              setCommentTarget({
                receipt_no: showEditGate.receipt_no,
                defaultKind: "edit_request",
              });
              setShowEditGate(null);
            }}
          />
        </DialogContent>
      </Dialog>

      <PaymentCommentsPanel
        open={!!commentTarget}
        onOpenChange={(o) => !o && setCommentTarget(null)}
        target={{ receipt_no: commentTarget?.receipt_no, booking_id: commentTarget?.booking_id }}
        defaultKind={commentTarget?.defaultKind ?? "comment"}
      />

      {/* Mobile FAB — pinned above bottom tab bar */}
      <div
        className="fixed left-0 right-0 z-40 md:hidden px-4 pointer-events-none"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 56px + 8px)" }}
      >
        <Button
          className="w-full h-13 text-base font-semibold shadow-[0_10px_25px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.3)] rounded-full bg-success text-success-foreground hover:bg-success/90 pointer-events-auto transition-all duration-300 active:scale-[0.97]"
          onClick={() => setMobileWizardOpen(true)}
        >
          <Plus className="h-5 w-5 mr-2" /> Receive Payment
        </Button>
      </div>

      <MobilePaymentWizard
        open={mobileWizardOpen}
        onClose={() => setMobileWizardOpen(false)}
        initialBookingId={bookingFilter || undefined}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["payments"] });
        }}
        onPrint={(no) => {
          setMobileWizardOpen(false);
          setReceiptNo(no);
        }}
      />
    </div>
  );
}
