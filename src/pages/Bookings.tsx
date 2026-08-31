import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "@/lib/router-compat";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge, statusTone } from "@/components/StatusBadge";
import { fmtPKR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TableRowsSkeleton } from "@/components/ui/skeletons";
import { Stagger, StaggerItem } from "@/components/motion";
import { EmptyState } from "@/components/EmptyState";
import { Briefcase } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Eye,
  Pencil,
  Receipt,
  BookOpen,
  FilePlus2,
  MessageCircle,
  Plus,
  Search,
  SlidersHorizontal,
  X,
  Printer,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Download,
  Loader2,
} from "lucide-react";

import { BookingForm } from "@/components/BookingForm";
import { PaymentHistoryButton } from "@/components/PaymentHistoryDialog";
import { useActiveProject } from "@/lib/activeProject";
import { usePIIGuardedQuery, AccessDenied } from "@/lib/access";

const STATUSES = ["All", "Active", "Completed", "Cancelled", "Transferred"];
const RISKS = ["All", "HIGH", "MEDIUM", "LOW"];

function buildWaUrl(b: any) {
  const raw = String(b.mobile ?? "").replace(/[^\d]/g, "");
  if (!raw) return "";
  const phone = raw.startsWith("0")
    ? "92" + raw.slice(1)
    : raw.startsWith("92")
      ? raw
      : raw.length === 10
        ? "92" + raw
        : raw;
  const overdue = Number(b.current_overdue_count || 0);
  const amount = Number(b.total_overdue_amount || 0);
  const msg =
    overdue > 0
      ? `Dear ${b.client_name},\n\nReminder from Precise Realtors & Builders regarding unit ${b.unit_id} (booking ${b.booking_id}).\n\nYou have ${overdue} overdue installment(s) totalling PKR ${fmtPKR(amount)}. Kindly arrange payment at your earliest convenience.\n\nThank you.`
      : `Dear ${b.client_name},\n\nGreetings from Precise Realtors & Builders regarding your booking ${b.booking_id} for unit ${b.unit_id}.\n\nThank you.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

export default function Bookings() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeCode } = useActiveProject();
  const [status, setStatus] = useState("All");
  const [risk, setRisk] = useState("All");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [unitQ, setUnitQ] = useState("");
  const [dealer, setDealer] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [advOpen, setAdvOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  // Per-card pending state for the two side-effectful actions on mobile
  // cards: viewing the Ledger (route navigation, which may block briefly
  // while the target route loads) and opening WhatsApp (window.open →
  // handed off to the OS/browser). Keyed by booking_id + action so only
  // the tapped card spins, not every card sharing the same button.
  const [actionPending, setActionPending] = useState<{ id: string; kind: "ledger" | "wa" } | null>(
    null,
  );
  const [leadPrefill, setLeadPrefill] = useState<{
    leadId: string;
    initial: {
      client_name?: string;
      cnic?: string;
      mobile?: string;
      project_code?: string;
      unit_type?: any;
    };
  } | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    // `?new=1` — deep-link from empty states (e.g. Dashboard's "New Booking"
    // CTA) to open the create dialog on arrival. Consume the param so a
    // refresh doesn't reopen it.
    if (searchParams.get("new") === "1") {
      const next = new URLSearchParams(searchParams);
      next.delete("new");
      setSearchParams(next);
      setCreateOpen(true);
      return;
    }
    const leadId = searchParams.get("fromLead");
    if (!leadId) return;
    // Consume the param so a refresh doesn't reopen the dialog.
    const next = new URLSearchParams(searchParams);
    next.delete("fromLead");
    setSearchParams(next);

    let cancelled = false;
    (async () => {
      let initial: any = {};
      // Try sessionStorage first (avoids extra fetch).
      try {
        const raw = sessionStorage.getItem("crm_convert_lead");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.id === leadId) {
            initial = {
              client_name: parsed.full_name ?? "",
              cnic: parsed.cnic ?? "",
              mobile: parsed.mobile ?? "",
              project_code: parsed.project_code ?? undefined,
              unit_type: parsed.unit_type ?? undefined,
            };
          }
          sessionStorage.removeItem("crm_convert_lead");
        }
      } catch {
        /* ignore */
      }

      if (!initial.client_name) {
        const { data } = await supabase
          .from("crm_leads")
          .select("*")
          .eq("id", leadId)
          .maybeSingle();
        if (data) {
          initial = {
            client_name: data.full_name ?? "",
            cnic: data.cnic ?? "",
            mobile: data.mobile ?? "",
            project_code: data.interested_project_code ?? undefined,
            unit_type: data.interested_unit_type ?? undefined,
          };
        }
      }
      if (cancelled) return;
      setLeadPrefill({ leadId, initial });
      setCreateOpen(true);
    })();
    return () => {
      cancelled = true;
    };
    // We only want this to run when the URL param changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);
  type SortKey =
    | "booking_id"
    | "client_name"
    | "unit_id"
    | "unit_type"
    | "total_contract_value"
    | "cash_received"
    | "current_overdue_count"
    | "booking_status"
    | "risk_level";
  const [sortKey, setSortKey] = useState<SortKey>("booking_id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  };

  const {
    data: rows = [],
    isLoading,
    accessDenied,
  } = usePIIGuardedQuery<any[]>({
    queryKey: ["bookings", activeCode ?? "all"],
    queryFn: async () => {
      let q = supabase.from("bookings").select("*").order("booking_date", { ascending: false });
      if (activeCode) q = q.eq("project_code", activeCode);
      return (await q).data ?? [];
    },
  });

  const { data: docIndex = {} } = usePIIGuardedQuery({
    queryKey: ["booking-doc-counts"],
    queryFn: async () => {
      const { data } = await supabase.from("booking_documents").select("booking_id,label");
      const idx: Record<string, { count: number; hasAgreement: boolean; hasCnic: boolean }> = {};
      (data ?? []).forEach((d: any) => {
        const r = (idx[d.booking_id] ||= { count: 0, hasAgreement: false, hasCnic: false });
        r.count += 1;
        if (d.label === "Agreement to Sell / Booking Form") r.hasAgreement = true;
        if (d.label === "Client CNIC Copy") r.hasCnic = true;
      });
      return idx;
    },
  });

  const dealers = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((b: any) => {
      if (b.dealer_name) s.add(String(b.dealer_name));
    });
    return ["All", ...Array.from(s).sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    const lq = search.trim().toLowerCase();
    const uq = unitQ.trim().toLowerCase();
    const rangeInvalid =
      dateFrom && dateTo && new Date(dateFrom).getTime() > new Date(dateTo).getTime();
    const from = !rangeInvalid && dateFrom ? new Date(dateFrom).getTime() : null;
    const to = !rangeInvalid && dateTo ? new Date(dateTo).getTime() + 86_399_999 : null;
    return rows.filter((b: any) => {
      if (status !== "All" && (b.booking_status ?? "") !== status) return false;
      if (risk !== "All" && (b.risk_level ?? "") !== risk) return false;
      if (
        overdueOnly &&
        (!(Number(b.current_overdue_count) > 0) ||
          String(b.booking_status ?? "").toLowerCase() === "cancelled")
      )
        return false;
      if (dealer !== "All" && (b.dealer_name ?? "") !== dealer) return false;
      if (
        uq &&
        !String(b.unit_id ?? "")
          .toLowerCase()
          .includes(uq)
      )
        return false;
      if (from || to) {
        const t = b.booking_date ? new Date(b.booking_date).getTime() : NaN;
        if (Number.isNaN(t)) return false;
        if (from && t < from) return false;
        if (to && t > to) return false;
      }
      if (!lq) return true;
      return [b.client_name, b.cnic, b.booking_id, b.unit_id].some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(lq),
      );
    });
  }, [rows, status, risk, overdueOnly, search, unitQ, dealer, dateFrom, dateTo]);

  // Units that appear in more than one active booking — flagged in the UI so
  // an operator can spot accidental double bookings without running a report.
  const duplicateUnits = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of rows as any[]) {
      if (!b.unit_id) continue;
      if ((b.booking_status ?? "Active") !== "Active") continue;
      counts.set(b.unit_id, (counts.get(b.unit_id) ?? 0) + 1);
    }
    const set = new Set<string>();
    counts.forEach((n, id) => {
      if (n > 1) set.add(id);
    });
    return set;
  }, [rows]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const numeric: SortKey[] = ["total_contract_value", "cash_received", "current_overdue_count"];
    const arr = [...filtered];
    arr.sort((a: any, b: any) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (numeric.includes(sortKey)) return ((Number(av) || 0) - (Number(bv) || 0)) * dir;
      return (
        String(av ?? "").localeCompare(String(bv ?? ""), undefined, {
          numeric: true,
          sensitivity: "base",
        }) * dir
      );
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const advActive =
    (unitQ ? 1 : 0) + (dealer !== "All" ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0);

  const dateRangeError =
    dateFrom && dateTo && new Date(dateFrom).getTime() > new Date(dateTo).getTime()
      ? "“From” date must be on or before “To” date."
      : "";

  const clearAdvanced = () => {
    setUnitQ("");
    setDealer("All");
    setDateFrom("");
    setDateTo("");
  };

  // CSV export of the currently visible rows — respects every active
  // filter (search, status, risk, overdue, unit, dealer, date range) and
  // the current sort column/direction, because it serializes `sorted`
  // (the same array the table renders) not `rows`. Uses RFC-4180 quoting
  // so client names / CNICs containing commas or quotes round-trip
  // cleanly in Excel and Google Sheets.
  const exportCsv = () => {
    const cols: Array<{ label: string; get: (b: any) => unknown }> = [
      { label: "Booking ID", get: (b) => b.booking_id },
      { label: "Booking Date", get: (b) => b.booking_date ?? "" },
      { label: "Project", get: (b) => b.project_name ?? b.project_code ?? "" },
      { label: "Client", get: (b) => b.client_name ?? "" },
      { label: "CNIC", get: (b) => b.cnic ?? "" },
      { label: "Mobile", get: (b) => b.mobile ?? "" },
      { label: "Unit ID", get: (b) => b.unit_id ?? "" },
      { label: "Unit Type", get: (b) => b.unit_type ?? "" },
      { label: "Floor", get: (b) => b.floor ?? "" },
      { label: "Size (Sqft)", get: (b) => Number(b.size_sqft ?? 0) },
      { label: "Sold Rate", get: (b) => Number(b.sold_rate ?? 0) },
      { label: "Contract Value", get: (b) => Number(b.total_contract_value ?? 0) },
      { label: "Down Payment", get: (b) => Number(b.down_payment ?? 0) },
      { label: "Cash Received", get: (b) => Number(b.cash_received ?? 0) },
      { label: "Remaining Balance", get: (b) => Number(b.remaining_balance ?? 0) },
      { label: "Overdue Count", get: (b) => Number(b.current_overdue_count ?? 0) },
      { label: "Overdue Amount", get: (b) => Number(b.total_overdue_amount ?? 0) },
      { label: "Status", get: (b) => b.booking_status ?? "" },
      { label: "Risk", get: (b) => b.risk_level ?? "" },
      { label: "Dealer", get: (b) => b.dealer_name ?? "" },
    ];
    // RFC-4180: wrap in quotes when the value contains ", , CR, or LF;
    // escape embedded quotes by doubling them. Booleans/numbers/nulls
    // stringify to their obvious value; null/undefined → empty string.
    const esc = (v: unknown): string => {
      if (v === null || v === undefined) return "";
      const s = typeof v === "number" && !Number.isFinite(v) ? "" : String(v);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.map((c) => esc(c.label)).join(",")];
    for (const b of sorted) lines.push(cols.map((c) => esc(c.get(b))).join(","));
    // Prepend a UTF-8 BOM so Excel opens Urdu / accented client names correctly.
    const csv = "\ufeff" + lines.join("\r\n") + "\r\n";

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const scope = activeCode ? `-${activeCode}` : "";
    const filterTag =
      status !== "All"
        ? `-${status.toLowerCase()}`
        : overdueOnly
          ? "-overdue"
          : risk !== "All"
            ? `-risk-${risk.toLowerCase()}`
            : "";
    const filename = `bookings${scope}${filterTag}-${stamp}.csv`;

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Let the click settle before revoking so Firefox doesn't cancel the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (accessDenied) {
    return (
      <div>
        <PageHeader title="Bookings" description="Restricted view" />
        <AccessDenied
          title="Booking records are restricted"
          description="Bookings expose client names, CNIC, and financial details — visible only to admin, manager, and staff roles."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Bookings"
        description={`${rows.length} bookings · Manal Arcade`}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New booking
          </Button>
        }
      />

      <Stagger className="space-y-4" gap={0.08}>
        <StaggerItem>
          {/* Filter bar */}
          <div className="p-3.5 rounded-2xl border border-border/60 bg-card/75 backdrop-blur-xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-wrap items-center gap-3">
            <div className="relative w-full md:flex-1 md:min-w-[220px] md:max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by Booking ID, Client, Unit ID, or CNIC…"
                className="pl-9.5 pr-10 bg-background/50 border border-border/60 h-9.5 rounded-xl"
                aria-label="Search bookings"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger aria-label="Filter by status" className="h-9 w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground">Risk</Label>
              <Select value={risk} onValueChange={setRisk}>
                <SelectTrigger aria-label="Filter by risk level" className="h-9 w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RISKS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Popover open={advOpen} onOpenChange={setAdvOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5 ml-auto">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Advanced
                  {advActive > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold">
                      {advActive}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Advanced filters</div>
                  {advActive > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={clearAdvanced}
                    >
                      <X className="h-3 w-3 mr-1" /> Clear
                    </Button>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Unit number</Label>
                  <Input
                    value={unitQ}
                    onChange={(e) => setUnitQ(e.target.value)}
                    placeholder="e.g. MA-203"
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Salesperson / dealer</Label>
                  <Select value={dealer} onValueChange={setDealer}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {dealers.map((d) => (
                        <SelectItem key={d} value={d}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Booking from</Label>
                    <Input
                      type="date"
                      value={dateFrom}
                      max={dateTo || undefined}
                      onChange={(e) => setDateFrom(e.target.value)}
                      aria-invalid={!!dateRangeError}
                      className={cn(
                        "h-9",
                        dateRangeError && "border-destructive focus-visible:ring-destructive",
                      )}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Booking to</Label>
                    <Input
                      type="date"
                      value={dateTo}
                      min={dateFrom || undefined}
                      onChange={(e) => setDateTo(e.target.value)}
                      aria-invalid={!!dateRangeError}
                      className={cn(
                        "h-9",
                        dateRangeError && "border-destructive focus-visible:ring-destructive",
                      )}
                    />
                  </div>
                </div>
                {dateRangeError && (
                  <p role="alert" className="text-xs text-destructive">
                    {dateRangeError}
                  </p>
                )}
              </PopoverContent>
            </Popover>

            <div className="flex items-center gap-2">
              <Switch id="overdue-only" checked={overdueOnly} onCheckedChange={setOverdueOnly} />
              <Label htmlFor="overdue-only" className="text-xs">
                Overdue only
              </Label>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 min-h-11 min-w-11"
              onClick={exportCsv}
              disabled={sorted.length === 0}
              title={
                sorted.length === 0
                  ? "No rows to export"
                  : `Export ${sorted.length} bookings to CSV`
              }
              aria-label={`Export ${sorted.length} bookings to CSV`}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Export CSV
            </Button>
            <div className="text-xs text-muted-foreground tabular-nums">
              {sorted.length} of {rows.length}
            </div>
          </div>
        </StaggerItem>

        <StaggerItem>
          {/* Mobile card list (hidden on md+) */}
          <div className="md:hidden flex flex-col gap-2">
            {isLoading ? (
              <>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-lg bg-card p-3 flex flex-col gap-2 animate-pulse"
                    style={{ border: "1px solid var(--border)" }}
                    aria-hidden
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="h-3.5 w-24 rounded bg-muted" />
                      <div className="h-5 w-16 rounded-full bg-muted" />
                    </div>
                    <div className="h-4 w-2/3 rounded bg-muted" />
                    <div className="h-3 w-1/2 rounded bg-muted" />
                    <div className="h-3 w-1/3 rounded bg-muted" />
                    <div className="flex items-center gap-2 pt-1">
                      <div className="h-11 flex-1 rounded-md bg-muted" />
                      <div className="h-11 flex-1 rounded-md bg-muted" />
                      <div className="h-11 w-11 rounded-md bg-muted" />
                    </div>
                  </div>
                ))}
                <span className="sr-only" role="status">
                  Loading bookings…
                </span>
              </>
            ) : sorted.length === 0 ? (
              <EmptyState
                icon={Briefcase}
                title={rows.length === 0 ? "No bookings yet" : "No bookings match"}
                description={
                  rows.length === 0
                    ? "Record your first booking to start tracking clients, units, and payments."
                    : "Try clearing filters or search terms above."
                }
                action={
                  rows.length === 0 ? (
                    <Button onClick={() => setCreateOpen(true)}>
                      <Plus className="h-4 w-4 mr-1" /> New booking
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              sorted.map((b: any) => {
                const wa = buildWaUrl(b);
                const overdue = Number(b.current_overdue_count) || 0;
                // Highlight the matched substring in mobile card fields so users
                // can see why a row was returned. Escape regex metacharacters in
                // the query — client_name/unit_id can contain "." and "-".
                const q = search.trim();
                const highlight = (value: string | null | undefined) => {
                  const text = value ?? "—";
                  if (!q) return text;
                  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                  const re = new RegExp(`(${esc})`, "ig");
                  const parts = text.split(re);
                  return parts.map((part, i) =>
                    part.toLowerCase() === q.toLowerCase() ? (
                      <mark key={i} className="bg-warning/25 text-foreground rounded px-0.5">
                        {part}
                      </mark>
                    ) : (
                      <span key={i}>{part}</span>
                    ),
                  );
                };
                return (
                  <div
                    key={b.booking_id}
                    className="rounded-lg bg-card p-3 flex flex-col gap-2"
                    style={{ border: "1px solid var(--border)" }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        to={`/bookings/${b.booking_id}`}
                        className="font-mono text-[13px] font-bold text-primary truncate"
                      >
                        {highlight(b.booking_id)}
                      </Link>
                      <StatusBadge label={b.booking_status} tone={statusTone(b.booking_status)} />
                    </div>
                    <div className="text-[16px] font-bold capitalize leading-tight truncate">
                      {highlight(b.client_name)}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 truncate">
                      <span className="font-mono">{highlight(b.unit_id)}</span>
                      <span aria-hidden>·</span>
                      <span className="truncate">{b.project_name ?? b.project_code ?? "—"}</span>
                    </div>

                    <div className="text-xs">
                      <span className="text-muted-foreground">Sale Price </span>
                      <span className="font-bold text-foreground tabular-nums">
                        {fmtPKR(b.total_contract_value)}
                      </span>
                    </div>
                    {overdue > 0 && (
                      <div className="text-xs font-semibold text-destructive tabular-nums">
                        Overdue {overdue} installment{overdue === 1 ? "" : "s"}
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 min-h-11"
                        onClick={() => setEditing(b)}
                        aria-label={`Edit booking ${b.booking_id}`}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 min-h-11"
                        disabled={
                          actionPending?.id === b.booking_id && actionPending?.kind === "ledger"
                        }
                        onClick={() => {
                          setActionPending({ id: b.booking_id, kind: "ledger" });
                          navigate(`/ledger?booking=${encodeURIComponent(b.booking_id)}`);
                          // Route change unmounts this card, but keep a fallback
                          // clear so a same-page cancel (back gesture) doesn't
                          // leave the spinner running forever.
                          window.setTimeout(() => {
                            setActionPending((cur) =>
                              cur && cur.id === b.booking_id && cur.kind === "ledger" ? null : cur,
                            );
                          }, 2500);
                        }}
                        aria-label={`View ledger for ${b.client_name}`}
                      >
                        {actionPending?.id === b.booking_id && actionPending?.kind === "ledger" ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" aria-hidden="true" />
                        ) : (
                          <BookOpen className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                        )}
                        Ledger
                      </Button>
                      {wa ? (
                        <button
                          type="button"
                          disabled={
                            actionPending?.id === b.booking_id && actionPending?.kind === "wa"
                          }
                          onClick={() => {
                            setActionPending({ id: b.booking_id, kind: "wa" });
                            // Hand off to the OS — window.open may open a new tab
                            // or launch the WhatsApp app on mobile. Clear the
                            // spinner shortly after so the button re-enables.
                            window.open(wa, "_blank", "noopener,noreferrer");
                            window.setTimeout(() => {
                              setActionPending((cur) =>
                                cur && cur.id === b.booking_id && cur.kind === "wa" ? null : cur,
                              );
                            }, 1200);
                          }}
                          className="inline-flex items-center justify-center rounded-xl bg-success/15 text-success ring-1 ring-success/30 h-10 w-10 shrink-0 hover:bg-success/25 transition-all duration-200 active:scale-95 disabled:opacity-60"
                          aria-label={`WhatsApp ${b.client_name}`}
                        >
                          {actionPending?.id === b.booking_id && actionPending?.kind === "wa" ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <MessageCircle className="h-4 w-4" aria-hidden="true" />
                          )}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled
                          className="inline-flex items-center justify-center rounded-xl bg-muted/60 text-muted-foreground h-10 w-10 shrink-0 opacity-60"
                          aria-label="No mobile number on file"
                          title="No mobile number on file"
                        >
                          <MessageCircle className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block soft-surface soft-surface-hover overflow-hidden">
            <div
              tabIndex={0}
              role="region"
              aria-label="Bookings table"
              className="overflow-x-auto max-h-[68vh] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <table className="w-full text-sm table-sticky">
                <thead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground bg-card/80 backdrop-blur-md sticky top-0 z-10 shadow-[inset_0_-1px_0_rgba(255,255,255,0.1)]">
                  {(() => {
                    const SortableTh = ({
                      k,
                      label,
                      align = "left",
                    }: {
                      k: SortKey;
                      label: string;
                      align?: "left" | "right";
                    }) => {
                      const active = sortKey === k;
                      const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
                      return (
                        <th
                          className={cn(
                            "font-medium px-4 py-2.5 border-b",
                            align === "right" ? "text-right" : "text-left",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => toggleSort(k)}
                            aria-sort={
                              active ? (sortDir === "asc" ? "ascending" : "descending") : "none"
                            }
                            className={cn(
                              "inline-flex items-center gap-1 hover:text-foreground transition-colors",
                              align === "right" && "flex-row-reverse",
                              active && "text-foreground",
                            )}
                          >
                            {label}
                            <Icon className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </th>
                      );
                    };
                    return (
                      <tr>
                        <SortableTh k="booking_id" label="Booking ID" />
                        <SortableTh k="client_name" label="Client" />
                        <SortableTh k="unit_id" label="Unit" />
                        <SortableTh k="unit_type" label="Type" />
                        <SortableTh k="total_contract_value" label="Contract Value" align="right" />
                        <SortableTh k="cash_received" label="Cash Received" align="right" />
                        <SortableTh k="current_overdue_count" label="Overdue" align="right" />
                        <SortableTh k="booking_status" label="Status" />
                        <SortableTh k="risk_level" label="Risk" />
                        <th className="text-left font-medium px-4 py-2.5 border-b">Docs</th>
                        <th className="text-left font-medium px-4 py-2.5 border-b">Actions</th>
                      </tr>
                    );
                  })()}
                </thead>
                <tbody>
                  {isLoading ? (
                    <TableRowsSkeleton rows={6} columns={11} />
                  ) : sorted.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="p-0">
                        <EmptyState
                          icon={Briefcase}
                          title={rows.length === 0 ? "No bookings yet" : "No bookings match"}
                          description={
                            rows.length === 0
                              ? "Record your first booking to start tracking clients, units, and payments."
                              : "Try clearing filters or search terms above."
                          }
                          action={
                            rows.length === 0 ? (
                              <Button onClick={() => setCreateOpen(true)}>
                                <Plus className="h-4 w-4 mr-1" /> New booking
                              </Button>
                            ) : undefined
                          }
                        />
                      </td>
                    </tr>
                  ) : (
                    sorted.map((b: any) => {
                      const wa = buildWaUrl(b);
                      const di = (docIndex as any)[b.booking_id] ?? {
                        count: 0,
                        hasAgreement: false,
                        hasCnic: false,
                      };
                      const docTone =
                        di.hasAgreement && di.hasCnic
                          ? "bg-success/15 text-success border-success/30"
                          : !di.hasAgreement
                            ? "bg-destructive/15 text-destructive border-destructive/30"
                            : "bg-muted text-muted-foreground border-border";
                      const docTitle = !di.hasAgreement
                        ? "Missing Agreement to Sell"
                        : !di.hasCnic
                          ? "Missing CNIC copy"
                          : "Agreement + CNIC on file";
                      return (
                        <tr
                          key={b.booking_id}
                          className="border-t hover:bg-muted/50 transition-colors"
                        >
                          <td className="px-4 py-2.5">
                            <Link
                              to={`/bookings/${b.booking_id}`}
                              className="font-mono text-xs text-primary hover:underline"
                            >
                              {b.booking_id}
                            </Link>
                          </td>
                          <td className="px-4 py-2.5 capitalize font-medium">{b.client_name}</td>
                          <td className="px-4 py-2.5 font-mono text-xs">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>{b.unit_id}</span>
                              {b.unit_id && duplicateUnits.has(b.unit_id) && (
                                <span
                                  title="This unit appears in more than one active booking"
                                  className="inline-flex items-center h-5 px-1.5 rounded-full border border-warning/30 bg-warning/15 text-warning text-[10px] font-semibold uppercase tracking-wide"
                                >
                                  Duplicate
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            {b.unit_type ?? "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {fmtPKR(b.total_contract_value)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {fmtPKR(b.cash_received)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {Number(b.current_overdue_count) > 0 ? (
                              <span className="text-destructive font-semibold">
                                {b.current_overdue_count}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <StatusBadge
                                label={b.booking_status}
                                tone={statusTone(b.booking_status)}
                              />
                              {Number(b.current_overdue_count) > 0 &&
                                (b.booking_status ?? "Active") === "Active" && (
                                  <span className="inline-flex items-center h-5 px-1.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide bg-destructive/15 text-destructive border-destructive/30">
                                    Overdue
                                  </span>
                                )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusBadge label={b.risk_level} tone={statusTone(b.risk_level)} />
                          </td>

                          <td className="px-4 py-2.5">
                            <button
                              type="button"
                              title={docTitle}
                              onClick={() => navigate(`/bookings/${b.booking_id}#documents`)}
                              className={cn(
                                "inline-flex items-center gap-1 px-2 h-6 rounded-full border text-[11px] font-medium tabular-nums",
                                docTone,
                              )}
                            >
                              <FilePlus2 className="h-3 w-3" /> {di.count}
                            </button>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 min-h-11 min-w-11"
                                title="View"
                                aria-label={`View booking ${b.booking_id}`}
                                onClick={() => navigate(`/bookings/${b.booking_id}`)}
                              >
                                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 min-h-11 min-w-11"
                                title="Edit"
                                aria-label={`Edit booking ${b.booking_id}`}
                                onClick={() => setEditing(b)}
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                              <PaymentHistoryButton
                                bookingId={b.booking_id}
                                iconOnly
                                variant="ghost"
                                className="h-7 w-7"
                              />
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 min-h-11 min-w-11"
                                title="Payments"
                                aria-label={`Payments for booking ${b.booking_id}`}
                                onClick={() => navigate(`/payments?booking=${b.booking_id}`)}
                              >
                                <Receipt className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 min-h-11 min-w-11"
                                title="Ledger"
                                aria-label={`Ledger for booking ${b.booking_id}`}
                                onClick={() => navigate(`/ledger?booking=${b.booking_id}`)}
                              >
                                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 min-h-11 min-w-11"
                                title="Documents"
                                aria-label={`Documents for booking ${b.booking_id}`}
                                onClick={() => navigate(`/documents?booking=${b.booking_id}`)}
                              >
                                <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </StaggerItem>
      </Stagger>

      {/* Create dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setLeadPrefill(null);
        }}
      >
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto max-md:max-w-full max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:rounded-none max-md:p-4">
          <DialogHeader>
            <DialogTitle>{leadPrefill ? "Convert lead to booking" : "New booking"}</DialogTitle>
            <DialogDescription>
              {leadPrefill
                ? `Pre-filled from lead "${leadPrefill.initial.client_name ?? ""}" — complete the remaining fields.`
                : "Manal Arcade — fill in client and payment plan details."}
            </DialogDescription>
          </DialogHeader>
          <BookingForm
            initial={leadPrefill?.initial as any}
            onCancel={() => {
              setCreateOpen(false);
              setLeadPrefill(null);
            }}
            onSaved={async (id) => {
              // Mark originating lead as Booking Done.
              if (leadPrefill?.leadId) {
                try {
                  await supabase
                    .from("crm_leads")
                    .update({ stage: "Booking Done", converted_booking_id: id })
                    .eq("id", leadPrefill.leadId);
                  qc.invalidateQueries({ queryKey: ["crm_leads"] });
                  qc.invalidateQueries({ queryKey: ["crm-followup-count"] });
                } catch {
                  /* non-fatal */
                }
              }
              setCreateOpen(false);
              setLeadPrefill(null);
              qc.invalidateQueries({ queryKey: ["bookings"] });
              toast.success("Booking created", {
                description: `${id} saved successfully.`,
                action: { label: "Open", onClick: () => navigate(`/bookings/${id}`) },
              });
              navigate(`/bookings/${id}`);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto max-md:max-w-full max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:rounded-none max-md:p-4">
          <DialogHeader>
            <DialogTitle>Edit booking {editing?.booking_id}</DialogTitle>
            <DialogDescription>
              {editing?.client_name} · {editing?.unit_id}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <BookingForm
              initial={editing}
              onCancel={() => setEditing(null)}
              onSaved={(id) => {
                const bookingId = id ?? editing?.booking_id;
                setEditing(null);
                qc.invalidateQueries({ queryKey: ["bookings"] });
                toast.success("Booking updated", {
                  description: `${bookingId} changes saved.`,
                  action: bookingId
                    ? { label: "Open", onClick: () => navigate(`/bookings/${bookingId}`) }
                    : undefined,
                });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
