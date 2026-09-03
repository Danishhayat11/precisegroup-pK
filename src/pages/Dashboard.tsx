/* allow-raw-color-file: cash-integrity and diagnostic banners use amber/emerald/red palette pending status-token migration
 * Tracked debt: migrate to semantic status tokens (bg-success, bg-warning,
 * bg-destructive, bg-info) in follow-up. Guardrail (scripts/ci/no-hex-in-
 * marketing-shell.mjs) blocks NEW drift while this marker documents the
 * legacy status-color usage in-file. */
import { useMemo, useState, useEffect, useRef, Fragment } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import {
  logDashboardEvent,
  reportDashboardError,
  trackPaymentsLatency,
} from "@/lib/dashboardDiagnostics";
import { PageHeader } from "@/components/PageHeader";
import { CashIntegrityBanner } from "@/components/CashIntegrityBanner";
import { DashboardHero } from "@/components/DashboardHero";

import { Reveal } from "@/components/motion";
// DashboardBrief overlay removed per user request — the greeting hero,
// project switcher, 8-KPI grid, and overdue-clients table below already
// cover every metric the brief was duplicating.
import { DashboardActiveProjectCard } from "@/components/DashboardActiveProjectCard";
import { BuilderMetricsFeed } from "@/components/BuilderMetricsFeed";
import { useAuth } from "@/lib/auth";
import { useActiveProject } from "@/lib/activeProject";

import { fmtPKR, compact } from "@/lib/format";
import { Link } from "@/lib/router-compat";
import {
  ArrowUpRight,
  Banknote,
  Wallet,
  AlertTriangle,
  Building2,
  Repeat2,
  CheckCircle2,
  Coins,
  MessageCircle,
  Eye,
  CalendarRange,
  X,
  Download,
  Columns3,
  Settings2,
  RotateCcw,
  Filter,
  Sparkles,
  Loader2,
  Link2,
  Bookmark,
  Plus,
  Trash2,
  Pencil,
  Info,
  Ban,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  FileText,
  FileSpreadsheet,
  ChevronRight,
  Clock,
  Receipt,
  FolderOpen,
  Activity,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { aiDraftMessage, type AISnapshot } from "@/components/DashboardAI";
import { ShareFallbackDialog } from "@/components/ShareFallbackDialog";
import { UrlSanitizerDisclosure } from "@/components/UrlSanitizerDisclosure";
import DashboardDiagnosticsPanel from "@/components/DashboardDiagnosticsPanel";

import { RealtimeStatusIndicator, type RealtimeStatus } from "@/components/RealtimeStatusIndicator";
import { tryCopyToClipboard } from "@/lib/shareLink";
import {
  computePendingRows,
  buildPendingDrill,
  buildCancelledDrill,
  totalPending,
  totalCancelled,
} from "@/lib/pending";
import { DashboardSkeleton } from "@/components/ui/skeletons";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBoundary } from "react-error-boundary";

import { computeTotalReceived } from "@/lib/totals";
import { buildCsvMetadataHeader } from "@/lib/csvExportMetadata";
import { CsvExportMetadataPreview } from "@/components/CsvExportMetadataPreview";
import { useCsvExportConfirm } from "@/components/CsvExportConfirmDialog";

/** Tiny inline sparkline (no extra dep). */
function Sparkline({
  data,
  stroke = "currentColor",
  fill,
}: {
  data: number[];
  stroke?: string;
  fill?: string;
}) {
  if (!data || data.length < 2) return <div className="h-10" />;
  const w = 140,
    h = 36,
    pad = 2;
  const min = Math.min(...data),
    max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / (data.length - 1);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const path = `M ${pts.join(" L ")}`;
  const area = `${path} L ${w - pad},${h - pad} L ${pad},${h - pad} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full h-10"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {fill && <path d={area} fill={fill} opacity={0.25} />}
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Interactive filter chip group with animated active pill (shared layoutId). */
type ChipOpt = { key: string; label: string; count: number; tone?: "destructive" | "warning" };
function FilterChipGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ChipOpt[];
}) {
  const groupId = `chips-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="flex items-center gap-2" role="group" aria-label={`${label} filter`}>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        <AnimatePresence initial={false}>
          {options.map((o, i) => {
            const active = value === o.key;
            const toneActive =
              o.tone === "destructive"
                ? "text-destructive"
                : o.tone === "warning"
                  ? "text-warning"
                  : "text-primary";
            const toneBg =
              o.tone === "destructive"
                ? "bg-destructive/12 ring-destructive/30"
                : o.tone === "warning"
                  ? "bg-warning/12 ring-warning/30"
                  : "bg-primary/12 ring-primary/30";
            return (
              <motion.button
                key={o.key}
                type="button"
                onClick={() => onChange(o.key)}
                layout
                initial={{ opacity: 0, y: 4, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.94 }}
                transition={{ type: "spring", stiffness: 460, damping: 28, delay: i * 0.025 }}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.94 }}
                aria-pressed={active}
                className={`relative inline-flex items-center gap-1.5 rounded-full px-3 py-1 min-h-[44px] lg:min-h-0 text-xs font-medium ring-1 transition-all duration-200 hover:scale-105 active:scale-95 ${
                  active
                    ? `${toneBg} ${toneActive}`
                    : "ring-border bg-background/60 text-muted-foreground hover:text-foreground hover:bg-muted/60"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId={groupId}
                    className={`absolute inset-0 rounded-full ring-1 ${toneBg}`}
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    aria-hidden
                  />
                )}
                <motion.span
                  className="relative z-10"
                  animate={{ color: "currentColor", scale: active ? 1.02 : 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 24 }}
                >
                  {o.label}
                </motion.span>
                <span
                  className={`relative z-10 tabular-nums rounded-full px-1.5 py-0.5 text-[10px] transition-colors duration-200 ${active ? "bg-background/60" : "bg-muted text-muted-foreground"}`}
                >
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={o.count}
                      initial={{ y: 6, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: -6, opacity: 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      className="inline-block"
                    >
                      {o.count}
                    </motion.span>
                  </AnimatePresence>
                </span>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Expanded drawer revealing payment schedule + recent activity for an overdue booking. */
function OverdueRowDrawer({
  booking,
  payments,
  ledger,
  adjustments,
  fmtPKR,
  fmtDate,
}: {
  booking: any;
  payments: any[];
  ledger: any[];
  adjustments: any[];
  fmtPKR: (n: number) => string;
  fmtDate: (d: Date) => string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const sched = [...ledger]
    .filter((l) => l.booking_id === booking.booking_id)
    .sort((a, b) => String(a.due_date || "").localeCompare(String(b.due_date || "")));
  const bookingPayments = [...payments]
    .filter((p) => p.booking_id === booking.booking_id)
    .sort((a, b) => String(b.payment_date || "").localeCompare(String(a.payment_date || "")));
  const bookingAdj = [...adjustments]
    .filter((a) => a.booking_id === booking.booking_id)
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  const lastPay = bookingPayments[0];
  // `safe_cash_amount` already captures the full cash + bank receipt; there is no separate `bank_amount` column.
  const totalPaid = bookingPayments.reduce((s, p) => s + (Number(p.safe_cash_amount) || 0), 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="px-5 py-4 bg-gradient-to-b from-muted/40 to-transparent"
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Payment schedule */}
        <div className="lg:col-span-2 rounded-lg ring-1 ring-border bg-background/70 backdrop-blur-sm overflow-hidden">
          <h3 className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 text-xs font-semibold uppercase tracking-wider text-muted-foreground m-0">
            <Clock className="h-3.5 w-3.5" /> Payment Schedule
            <span className="ml-auto text-[10px] font-normal text-muted-foreground">
              {sched.length} installments
            </span>
          </h3>
          <div className="max-h-72 overflow-y-auto">
            {sched.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground text-center">No ledger rows.</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-muted/20 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-3 py-1.5">Due Date</th>
                    <th className="text-left font-medium px-3 py-1.5">Inst.</th>
                    <th className="text-right font-medium px-3 py-1.5">Due</th>
                    <th className="text-right font-medium px-3 py-1.5">Paid</th>
                    <th className="text-right font-medium px-3 py-1.5">Outstanding</th>
                    <th className="text-left font-medium px-3 py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sched.map((l, i) => {
                    const due = Number(l.due_amount) || 0;
                    const paid = Number(l.paid_amount) || 0;
                    const out = Math.max(due - paid, 0);
                    const isOver = l.due_date && l.due_date < today && out > 0;
                    const isPaid = out <= 0 && due > 0;
                    const isUpcoming = l.due_date && l.due_date >= today && out > 0;
                    return (
                      <motion.tr
                        key={`${l.id ?? `${l.booking_id}-${l.term_no ?? i}`}`}
                        initial={{ opacity: 0, x: -4 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.18, delay: Math.min(i * 0.012, 0.15) }}
                        className={`border-t hover:bg-muted/30 transition-colors ${isOver ? "bg-destructive/[0.04]" : ""}`}
                      >
                        <td className="px-3 py-1.5 tabular-nums">
                          {l.due_date ? fmtDate(new Date(l.due_date)) : "—"}
                        </td>
                        <td className="px-3 py-1.5">{l.term_no ?? "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmtPKR(due)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-success/90">
                          {fmtPKR(paid)}
                        </td>
                        <td
                          className={`px-3 py-1.5 text-right tabular-nums font-medium ${isOver ? "text-destructive" : ""}`}
                        >
                          {fmtPKR(out)}
                        </td>
                        <td className="px-3 py-1.5">
                          {isOver ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive ring-1 ring-destructive/30 px-1.5 py-0.5 text-[10px] font-semibold">
                              OVERDUE
                            </span>
                          ) : isPaid ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 text-success ring-1 ring-success/30 px-1.5 py-0.5 text-[10px] font-semibold">
                              PAID
                            </span>
                          ) : isUpcoming ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground ring-1 ring-border px-1.5 py-0.5 text-[10px] font-semibold">
                              UPCOMING
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Side: activity + artifacts */}
        <div className="space-y-3">
          <div className="rounded-lg ring-1 ring-border bg-background/70 backdrop-blur-sm p-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 m-0">
              <Activity className="h-3.5 w-3.5" /> Last Activity
            </h3>
            {lastPay ? (
              <div className="text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date</span>
                  <span className="tabular-nums font-medium">
                    {fmtDate(new Date(lastPay.payment_date))}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Receipt</span>
                  <span className="font-mono text-[11px]">{lastPay.receipt_no ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Mode</span>
                  <span>{lastPay.payment_mode ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="tabular-nums font-semibold text-success">
                    {fmtPKR(Number(lastPay.safe_cash_amount) || Number(lastPay.amount) || 0)}
                  </span>
                </div>
                <div className="flex justify-between pt-1 border-t mt-1.5">
                  <span className="text-muted-foreground">Total paid (all time)</span>
                  <span className="tabular-nums font-semibold">{fmtPKR(totalPaid)}</span>
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">No payments recorded yet.</div>
            )}
          </div>

          <div className="rounded-lg ring-1 ring-border bg-background/70 backdrop-blur-sm p-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 m-0">
              <Receipt className="h-3.5 w-3.5" /> Recent Payments
              <span className="ml-auto text-[10px] font-normal">{bookingPayments.length}</span>
            </h3>
            {bookingPayments.length === 0 ? (
              <div className="text-xs text-muted-foreground">None.</div>
            ) : (
              <ul className="space-y-1 max-h-32 overflow-y-auto text-xs">
                {bookingPayments.slice(0, 5).map((p) => (
                  <li
                    key={p.id ?? p.receipt_no}
                    className="flex items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-muted/40 transition-colors"
                  >
                    <span className="tabular-nums text-muted-foreground">
                      {fmtDate(new Date(p.payment_date))}
                    </span>
                    <span className="font-mono text-[10px] truncate">{p.receipt_no ?? "—"}</span>
                    <span className="tabular-nums font-medium">
                      {fmtPKR(Number(p.safe_cash_amount) || Number(p.amount) || 0)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {bookingAdj.length > 0 && (
            <div className="rounded-lg ring-1 ring-border bg-background/70 backdrop-blur-sm p-3">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 m-0">
                <Repeat2 className="h-3.5 w-3.5" /> Adjustments
                <span className="ml-auto text-[10px] font-normal">{bookingAdj.length}</span>
              </h3>
              <ul className="space-y-1 max-h-28 overflow-y-auto text-xs">
                {bookingAdj.slice(0, 4).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground truncate">
                      {a.asset_description ?? a.note ?? "Adjustment"}
                    </span>
                    <span className="tabular-nums font-medium">
                      {fmtPKR(Number(a.approved_value) || 0)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-lg ring-1 ring-border bg-background/70 backdrop-blur-sm p-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 m-0">
              <FolderOpen className="h-3.5 w-3.5" /> Artifacts
            </h3>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <Link
                to={`/bookings/${booking.booking_id}`}
                className="inline-flex items-center gap-1.5 rounded-md ring-1 ring-border px-2 py-1.5 hover:bg-muted/50 transition-colors"
              >
                <Eye className="h-3 w-3" /> Booking
              </Link>
              <Link
                to={`/payments?booking=${booking.booking_id}`}
                className="inline-flex items-center gap-1.5 rounded-md ring-1 ring-border px-2 py-1.5 hover:bg-muted/50 transition-colors"
              >
                <Banknote className="h-3 w-3" /> Payments
              </Link>
              <Link
                to={`/ledger?booking=${booking.booking_id}`}
                className="inline-flex items-center gap-1.5 rounded-md ring-1 ring-border px-2 py-1.5 hover:bg-muted/50 transition-colors"
              >
                <Clock className="h-3 w-3" /> Ledger
              </Link>
              <Link
                to={`/documents?booking=${booking.booking_id}`}
                className="inline-flex items-center gap-1.5 rounded-md ring-1 ring-border px-2 py-1.5 hover:bg-muted/50 transition-colors"
              >
                <FileText className="h-3 w-3" /> Documents
              </Link>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** Animated count-up number with easing — respects prefers-reduced-motion. */
function CountUp({
  value,
  duration = 1400,
  prefix = "",
  format,
}: {
  value: number;
  duration?: number;
  prefix?: string;
  format?: (n: number) => string;
}) {
  const [n, setN] = useState(0);
  const fmt = format ?? ((v: number) => compact(v));
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setN(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return (
    <span aria-hidden="true">
      {prefix}
      {fmt(n)}
    </span>
  );
}

/**
 * Throttled sr-only announcement for an aria-live="polite" region.
 * Only re-renders its text when the underlying numeric value actually changes,
 * and coalesces rapid changes within `delay` ms so screen readers do not queue
 * a long backlog of intermediate values.
 */
function LiveAnnouncement({
  value,
  label,
  delay = 600,
}: {
  value: number;
  label: string;
  delay?: number;
}) {
  const [announced, setAnnounced] = useState(() => `${label}: PKR ${fmtPKR(value)}`);
  const lastValueRef = useRef(value);
  const lastLabelRef = useRef(label);
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (lastValueRef.current === value && lastLabelRef.current === label) return;
    lastValueRef.current = value;
    lastLabelRef.current = label;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setAnnounced(`${label}: PKR ${fmtPKR(value)}`);
      timerRef.current = null;
    }, delay);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [value, label, delay]);
  return (
    <span className="sr-only" aria-live="polite">
      {announced}
    </span>
  );
}

const WA_TEMPLATE_KEY = "precise.waTemplate";
const DEFAULT_WA_TEMPLATE = `Dear {name},

This is a reminder from Precise Realtors & Builders regarding your unit {unit}.

You currently have {overdue_count} overdue installment(s) with a total outstanding amount of PKR {amount}.

Kindly arrange the payment at your earliest convenience to avoid further action.

Thank you.`;

function renderTemplate(
  tpl: string,
  vars: { name: string; unit: string; overdue_count: number | string; amount: string },
) {
  return tpl
    .replace(/\{name\}/g, vars.name)
    .replace(/\{unit\}/g, vars.unit)
    .replace(/\{overdue_count\}/g, String(vars.overdue_count))
    .replace(/\{amount\}/g, vars.amount);
}

const DEFAULT_COUNTRY_CODE = "92"; // Pakistan

/**
 * Normalize a phone number for wa.me:
 * - trims whitespace
 * - strips all non-digits (spaces, dashes, parens, +)
 * - converts leading "00" international prefix to bare digits
 * - replaces leading "0" (local trunk) with the default country code
 * - prepends the default country code for 10-digit local numbers
 * - leaves already-internationalized numbers (starting with country code) intact
 * Returns "" when the result is not a plausible E.164 number (7–15 digits).
 */
function toWaPhone(mobile: unknown): string {
  if (mobile == null) return "";
  let raw = String(mobile).trim().replace(/[^\d]/g, "");
  if (!raw) return "";
  if (raw.startsWith("00")) raw = raw.slice(2);
  if (raw.startsWith(DEFAULT_COUNTRY_CODE)) {
    // already internationalized
  } else if (raw.startsWith("0")) {
    raw = DEFAULT_COUNTRY_CODE + raw.slice(1);
  } else if (raw.length === 10) {
    raw = DEFAULT_COUNTRY_CODE + raw;
  }
  if (raw.length < 7 || raw.length > 15) return "";
  return raw;
}

type RangePreset = "all" | "30d" | "90d" | "ytd" | "12m" | "custom";

function presetRange(p: RangePreset): { from: string; to: string } {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const d = new Date(today);
  if (p === "30d") d.setDate(d.getDate() - 30);
  else if (p === "90d") d.setDate(d.getDate() - 90);
  else if (p === "12m") d.setMonth(d.getMonth() - 12);
  else if (p === "ytd") return { from: `${today.getFullYear()}-01-01`, to };
  else return { from: "", to: "" };
  return { from: d.toISOString().slice(0, 10), to };
}

export default function Dashboard() {
  const { refetch } = useQuery({ queryKey: ["dashboard"], queryFn: async () => ({}) }); // dummy for ErrorBoundary reset

  return (
    <ErrorBoundary
      fallbackRender={({
        error,
        resetErrorBoundary,
      }: {
        error: any;
        resetErrorBoundary: () => void;
      }) => (
        <div className="p-8">
          <EmptyState
            icon={AlertTriangle}
            title="Dashboard Error"
            description={
              (error as any)?.message ??
              "An unexpected error occurred while rendering the dashboard."
            }
            action={
              <Button onClick={resetErrorBoundary} variant="outline" className="mt-4">
                <RotateCcw className="mr-2 h-4 w-4" /> Try Again
              </Button>
            }
          />
        </div>
      )}
      onReset={() => refetch()}
    >
      <DashboardInner />
    </ErrorBoundary>
  );
}

function DashboardInner() {
  const { requestExport: requestCsvExport, dialog: csvConfirmDialog } = useCsvExportConfirm();

  // Hydrate from persisted snapshot for instant first paint on 4G revisits.
  type DashSnapshotData = {
    bookings: any[];
    payments: any[];
    ledger: any[];
    adjustments: any[];
    units: any[];
    projects: any[];
    transactions: any[];
  };
  const dashSnapshot = useMemo<{ t: number; d: DashSnapshotData } | undefined>(() => {
    try {
      const raw = localStorage.getItem("dash.snapshot.v1");
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as { t: number; d: DashSnapshotData };
      if (!parsed?.d || typeof parsed.t !== "number") return undefined;
      if (Date.now() - parsed.t > 10 * 60_000) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }, []);

  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const startedAt = performance.now();
      logDashboardEvent("fetch_start");
      try {
        let paymentsMs = 0;
        const paymentsPromise = (async () => {
          const t0 = performance.now();
          const rows = await fetchAllRows<any>("payments", "*", "receipt_no");
          paymentsMs = Math.round(performance.now() - t0);
          return rows;
        })();
        const [bookings, payments, ledger, adj, units, projects, txns] = await Promise.all([
          fetchAllRows<any>("bookings", "*", "booking_id"),
          paymentsPromise,
          fetchAllRows<any>("installment_ledger", "*", "ledger_id"),
          fetchAllRows<any>("adjustments", "*", "adjustment_id"),
          fetchAllRows<any>("units", "status,project_code,unit_id", "unit_id"),
          fetchAllRows<any>("projects", "project_code,project_name", "project_code"),
          fetchAllRows<any>("ledger_transactions", "*", "id"),
        ]);
        const durationMs = Math.round(performance.now() - startedAt);
        logDashboardEvent("fetch_success", {
          durationMs,
          sourceDurationsMs: { payments: paymentsMs },
          counts: {
            bookings: bookings?.length ?? 0,
            payments: payments?.length ?? 0,
            ledger: ledger?.length ?? 0,
            adjustments: adj?.length ?? 0,
            units: units?.length ?? 0,
            projects: projects?.length ?? 0,
            transactions: txns?.length ?? 0,
          },
        });
        trackPaymentsLatency(paymentsMs, {
          rows: payments?.length ?? 0,
          totalFetchMs: durationMs,
        });
        const payload = {
          bookings: bookings ?? [],
          payments: payments ?? [],
          ledger: ledger ?? [],
          adjustments: adj ?? [],
          units: units ?? [],
          projects: projects ?? [],
          transactions: txns ?? [],
        };
        // Persist last successful snapshot for instant re-hydration on
        // subsequent mobile visits (survives full reload / 4G cold start).
        try {
          localStorage.setItem("dash.snapshot.v1", JSON.stringify({ t: Date.now(), d: payload }));
        } catch (err) {
          console.error("[localStorage] write error", err);
        }
        return payload;
      } catch (err) {
        const errorMsg = (err as any)?.message ?? String(err);
        reportDashboardError("fetch_error", err, {
          durationMs: Math.round(performance.now() - startedAt),
        });
        toast.error("Dashboard failed to load", {
          description: errorMsg,
          action: {
            label: "Retry",
            onClick: () => refetch(),
          },
        });
        throw err;
      }
    },
    retry: 1,
    // Serve cached snapshot instantly, then refresh in the background.
    // Extended staleTime cuts redundant fetches during quick tab hops.
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
    initialData: dashSnapshot?.d,
    initialDataUpdatedAt: dashSnapshot?.t,
  });

  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
    status,
    fetchStatus,
    failureCount,
    dataUpdatedAt,
  } = query;

  // Hydration + data lifecycle breadcrumbs.
  const mountedAtRef = useRef<number>(0);
  useEffect(() => {
    mountedAtRef.current = performance.now();
    logDashboardEvent("mount");
    return () => logDashboardEvent("unmount");
  }, []);
  useEffect(() => {
    if (data && mountedAtRef.current) {
      logDashboardEvent("hydrated", {
        msSinceMount: Math.round(performance.now() - mountedAtRef.current),
      });
    }
  }, [data]);
  useEffect(() => {
    if (isError && error) reportDashboardError("query_error_surface", error);
  }, [isError, error]);

  // ---- Loading-state transition tracing --------------------------------
  // Emits a single `loading_state` diagnostic whenever any of the observable
  // gating inputs change (Query status, fetchStatus, failure count, data
  // presence). Each entry captures the *from → to* transition plus which
  // UI branch the render will pick (error screen, loading screen, ready),
  // so we can trace stuck spinners or premature ready-states end to end.
  const transitionRef = useRef<{
    status: string;
    fetchStatus: string;
    failureCount: number;
    hasData: boolean;
    gate: string;
    at: number;
  } | null>(null);
  const currentGate: "error" | "loading" | "ready" = isError
    ? "error"
    : isLoading || !data
      ? "loading"
      : "ready";
  useEffect(() => {
    const now = performance.now();
    const prev = transitionRef.current;
    const hasData = !!data;
    const next = { status, fetchStatus, failureCount, hasData, gate: currentGate, at: now };
    const changed =
      !prev ||
      prev.status !== next.status ||
      prev.fetchStatus !== next.fetchStatus ||
      prev.failureCount !== next.failureCount ||
      prev.hasData !== next.hasData ||
      prev.gate !== next.gate;
    if (!changed) return;
    const msSinceMount = mountedAtRef.current ? Math.round(now - mountedAtRef.current) : null;
    const msSincePrev = prev ? Math.round(now - prev.at) : null;
    // Human-friendly transition label for grep-ability in logs.
    let phase = "initial";
    if (prev) {
      if (prev.failureCount < next.failureCount) phase = "retry";
      else if (next.gate === "ready" && prev.gate !== "ready") phase = "success";
      else if (next.gate === "error" && prev.gate !== "error") phase = "error_surfaced";
      else if (next.gate === "loading" && prev.gate === "ready") phase = "refetch";
      else phase = "transition";
    }
    logDashboardEvent(
      "loading_state",
      {
        phase,
        from: prev
          ? {
              status: prev.status,
              fetchStatus: prev.fetchStatus,
              failureCount: prev.failureCount,
              hasData: prev.hasData,
              gate: prev.gate,
            }
          : null,
        to: {
          status: next.status,
          fetchStatus: next.fetchStatus,
          failureCount: next.failureCount,
          hasData: next.hasData,
          gate: next.gate,
        },
        isFetching,
        errorMessage: isError ? ((error as Error | null)?.message ?? String(error)) : null,
        dataUpdatedAt: dataUpdatedAt || null,
        msSinceMount,
        msSincePrev,
      },
      next.gate === "error" ? "error" : next.gate === "loading" ? "info" : "info",
    );
    transitionRef.current = next;
  }, [
    status,
    fetchStatus,
    failureCount,
    data,
    currentGate,
    isError,
    isFetching,
    error,
    dataUpdatedAt,
  ]);

  // Wrap refetch so manual retries from the error UI are logged with intent
  // and outcome, not just as the resulting state transition.
  const retryFromErrorUI = () => {
    logDashboardEvent("retry_click", {
      previousFailureCount: failureCount,
      previousError: (error as Error | null)?.message ?? (error ? String(error) : null),
    });
    refetch()
      .then((res) =>
        logDashboardEvent("retry_result", {
          outcome: res.status,
          failureCount: res.failureCount ?? null,
        }),
      )
      .catch((err) =>
        reportDashboardError("retry_error", err, {
          previousFailureCount: failureCount,
        }),
      );
  };

  const [preset, setPreset] = useState<RangePreset>("all");

  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [granularity, setGranularity] = useState<"day" | "week" | "month">("month");
  const { activeCode, setActiveCode } = useActiveProject();
  const [projectFilter, setProjectFilterState] = useState<string>(activeCode ?? "all");

  const qc = useQueryClient();
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("connecting");
  const [subscribeAttempt, setSubscribeAttempt] = useState(0);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  useEffect(() => {
    // Reconnect / rapid-switch safety. Three things go wrong with the
    // naive "subscribe on mount, remove on cleanup" pattern when a
    // user hammers the project switcher:
    //
    //   1. Rapid deps flips create N in-flight subscribes. React runs
    //      cleanup synchronously, but `removeChannel` is async — the
    //      server-side unsubscribe can lag behind the next subscribe
    //      and leave two channels registered for a beat, doubling
    //      invalidations.
    //   2. `.subscribe((status) => …)` fires the callback AFTER the
    //      effect is torn down (WebSocket ACK arrives late), which
    //      calls `setRealtimeStatus` on a stale channel and flashes
    //      "connected" over the correct "connecting" state of the
    //      NEW channel.
    //   3. React StrictMode double-invokes effects in dev, so the
    //      first mount already creates two channels for the same
    //      topic unless the sweep below catches it.
    //
    // Guards below (cancel flag, debounced create, orphan sweep,
    // explicit unsubscribe before remove) address each one.
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    };
    const scoped =
      activeCode && projectFilter !== "all"
        ? { filter: `project_code=eq.${activeCode}` as const }
        : {};
    const topic = `dashboard-live:${activeCode ?? "all"}`;

    // Short debounce: coalesces a burst of project switches (user
    // clicking through the switcher, or the "All → A → B" pattern
    // when a project autoselects) into a single subscribe. Also
    // avoids the classic StrictMode duplicate-subscribe race.
    const timer = setTimeout(() => {
      if (cancelled) return;

      // Orphan sweep. If a previous cleanup's `removeChannel` promise
      // hasn't resolved server-side yet, or an earlier subscribe was
      // never cleaned up (StrictMode, hot reload, exception during
      // teardown), residual `dashboard-live:*` channels linger in
      // `supabase.getChannels()`. Remove ALL of them before we create
      // ours — including any that match our target topic, which
      // guarantees we never end up with two channels for the same
      // topic firing the same invalidation twice.
      for (const c of supabase.getChannels()) {
        if (c.topic.includes("dashboard-live:")) {
          supabase.removeChannel(c);
        }
      }

      setRealtimeStatus("connecting");

      channel = supabase
        .channel(topic)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "bookings", ...scoped },
          invalidate,
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "units", ...scoped },
          invalidate,
        )
        .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, invalidate)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "ledger_transactions" },
          invalidate,
        )
        .on("postgres_changes", { event: "*", schema: "public", table: "adjustments" }, invalidate)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "installment_ledger" },
          invalidate,
        )
        // Realtime-js retries CLOSED/TIMED_OUT automatically with
        // backoff, so those are transient "reconnecting". Only
        // CHANNEL_ERROR is terminal (server rejected the sub, RLS
        // mismatch, invalid filter). Guard with `cancelled` so a
        // late-arriving ACK from a stale channel can't clobber the
        // status of the new one.
        .subscribe((status) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") setRealtimeStatus("connected");
          else if (status === "CHANNEL_ERROR") setRealtimeStatus("error");
          else if (status === "TIMED_OUT" || status === "CLOSED") setRealtimeStatus("reconnecting");
        });
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (channel) {
        // `unsubscribe()` sends the phx_leave frame immediately;
        // `removeChannel` then tears down the local ref. Doing both
        // (in this order) is the pattern the supabase-js docs use for
        // deterministic teardown — `removeChannel` alone can leave
        // the channel in a "leaving" limbo for a tick.
        try {
          channel.unsubscribe();
        } catch {
          // unsubscribe throws if the channel never made it past
          // "joining" — safe to ignore; removeChannel still cleans up.
        }
        supabase.removeChannel(channel);
      }
    };
  }, [qc, activeCode, projectFilter, subscribeAttempt]);

  // Keep the dashboard filter in sync with the app-wide active project so
  // switching from the header immediately reslices bookings/payments/etc.
  useEffect(() => {
    if (activeCode && activeCode !== projectFilter) setProjectFilterState(activeCode);
  }, [activeCode]); // eslint-disable-line react-hooks/exhaustive-deps
  const setProjectFilter = (code: string) => {
    setProjectFilterState(code);
    if (code !== "all") setActiveCode(code);
  };
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");

  // Manual-copy fallback for blocked clipboard access
  const [shareFallback, setShareFallback] = useState<{
    open: boolean;
    link: string | null;
    desc?: string;
  }>({ open: false, link: null });

  // Overdue CSV column chooser
  const OVERDUE_COLS: { key: string; label: string; get: (b: any) => string | number }[] = [
    { key: "client_name", label: "Client Name", get: (b) => b.client_name ?? "" },
    { key: "unit_id", label: "Unit", get: (b) => b.unit_id ?? "" },
    { key: "project_code", label: "Project", get: (b) => b.project_code ?? "" },
    { key: "mobile", label: "Mobile", get: (b) => b.mobile ?? "" },
    { key: "overdue_count", label: "Overdue Installments", get: (b) => b._ov },
    { key: "overdue_amount", label: "Overdue Amount (PKR)", get: (b) => b._amt },
    { key: "risk", label: "Risk Level", get: (b) => b._risk },
    { key: "booking_id", label: "Booking ID", get: (b) => b.booking_id ?? "" },
    { key: "booking_date", label: "Booking Date", get: (b) => b.booking_date ?? "" },
    {
      key: "sold_unit_value",
      label: "Sold Unit Value (PKR)",
      get: (b) => Number(b.sold_unit_value) || 0,
    },
  ];
  const [overdueCols, setOverdueCols] = useState<string[]>([
    "client_name",
    "unit_id",
    "mobile",
    "overdue_count",
    "overdue_amount",
    "risk",
    "booking_id",
  ]);
  const toggleOverdueCol = (k: string) =>
    setOverdueCols((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  // WhatsApp template (persisted to localStorage)
  const [waTemplate, setWaTemplate] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_WA_TEMPLATE;
    return localStorage.getItem(WA_TEMPLATE_KEY) || DEFAULT_WA_TEMPLATE;
  });
  const [waOpen, setWaOpen] = useState(false);
  const [waTarget, setWaTarget] = useState<{
    phone: string;
    name: string;
    unit: string;
    overdue_count: number;
    amount: string;
  } | null>(null);
  const [waMessage, setWaMessage] = useState("");
  const [tplOpen, setTplOpen] = useState(false);
  const [tplDraft, setTplDraft] = useState(waTemplate);
  const DRILL_KEYS = useMemo(
    () =>
      [
        "sell",
        "cash",
        "adj_approved",
        "adj_realised",
        "commission",
        "received",
        "pending",
        "overdue",
        "cancelled",
      ] as const,
    [],
  );
  // Defensive URL param reader — never throws even if window.location is malformed.
  const readUrlParam = (key: string): string | null => {
    if (typeof window === "undefined") return null;
    try {
      return new URLSearchParams(window.location.search).get(key);
    } catch {
      return null;
    }
  };
  const [drillKey, setDrillKey] = useState<
    | null
    | "sell"
    | "cash"
    | "adj_approved"
    | "adj_realised"
    | "commission"
    | "received"
    | "pending"
    | "overdue"
    | "cancelled"
  >(() => {
    const v = readUrlParam("kpi");
    if (v && (DRILL_KEYS as readonly string[]).includes(v)) return v as any;
    // If a shared link sets tab=kpi without an explicit KPI, default to "overdue".
    const t = readUrlParam("tab");
    if (t === "kpi") return "overdue";
    try {
      if (typeof window !== "undefined" && localStorage.getItem("dash.tab") === "kpi")
        return "overdue";
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
    return null;
  });
  // Active table tab — derived from drillKey but persisted explicitly so a
  // shared link with ?tab=kpi reopens the KPI sheet view.
  const activeTab: "overdue" | "kpi" = drillKey !== null ? "kpi" : "overdue";
  useEffect(() => {
    try {
      localStorage.setItem("dash.tab", activeTab);
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
  }, [activeTab]);

  const [riskFilter, setRiskFilter] = useState<"ALL" | "HIGH" | "MEDIUM">(() => {
    if (typeof window === "undefined") return "ALL";
    const url = readUrlParam("risk");
    if (url === "HIGH" || url === "MEDIUM" || url === "ALL") return url;
    try {
      const v = localStorage.getItem("dash.overdue.risk");
      if (v === "HIGH" || v === "MEDIUM" || v === "ALL") return v;
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
    return "ALL";
  });
  const [ageFilter, setAgeFilter] = useState<"ALL" | "1-30" | "31-60" | "61-90" | "90+">(() => {
    if (typeof window === "undefined") return "ALL";
    const url = readUrlParam("age");
    if (url === "1-30" || url === "31-60" || url === "61-90" || url === "90+" || url === "ALL")
      return url;
    try {
      const v = localStorage.getItem("dash.overdue.age");
      if (v === "1-30" || v === "31-60" || v === "61-90" || v === "90+" || v === "ALL") return v;
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
    return "ALL";
  });
  useEffect(() => {
    try {
      localStorage.setItem("dash.overdue.risk", riskFilter);
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
  }, [riskFilter]);
  useEffect(() => {
    try {
      localStorage.setItem("dash.overdue.age", ageFilter);
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
  }, [ageFilter]);
  // Inline banner state for params that were reset on load (mirrors the toast).
  const [resetParams, setResetParams] = useState<string[]>([]);
  // Full change details + a screen-reader-friendly sentence describing the recovery.
  const [resetChanges, setResetChanges] = useState<
    Array<{ key: string; from: string; to: string }>
  >([]);
  const [resetLandingSr, setResetLandingSr] = useState<string>("");
  // Disclosure focus + announcement state lives inside UrlSanitizerDisclosure.
  // Focus-management for the assertive banner. When stale params are
  // sanitized we move keyboard focus into the banner so screen-reader +
  // keyboard users land on the recovery message and can act on it (read the
  // details disclosure, copy reset details, dismiss). Previous focus is
  // captured so dismissing returns the user to where they were.
  const resetHeadingRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const hadResetParamsRef = useRef<boolean>(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hasParams = resetParams.length > 0;
    if (hasParams && !hadResetParamsRef.current) {
      // 0 → >0 transition: capture current focus, then move it to the heading.
      const active = document.activeElement;
      previouslyFocusedRef.current =
        active instanceof HTMLElement && active !== document.body ? active : null;
      // Defer so the banner is mounted (AnimatePresence) before focusing.
      const id = window.requestAnimationFrame(() => {
        resetHeadingRef.current?.focus();
      });
      hadResetParamsRef.current = true;
      return () => window.cancelAnimationFrame(id);
    }
    if (!hasParams && hadResetParamsRef.current) {
      // >0 → 0 transition (dismiss): restore prior focus if still in the DOM.
      const prev = previouslyFocusedRef.current;
      if (prev && document.contains(prev)) {
        try {
          prev.focus();
        } catch {
          /* noop */
        }
      }
      previouslyFocusedRef.current = null;
      hadResetParamsRef.current = false;
      // The disclosure component unmounts with the banner so its open/announcement
      // state resets automatically; nothing to clear here.
    }
  }, [resetParams.length]);
  // One-shot URL sanitizer: strip any dashboard params whose values are unrecognized,
  // redirect tab/kpi to the safest default, and surface a toast so the user knows.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      const sp = url.searchParams;
      const isInt = (s: string | null) =>
        !!s && Number.isFinite(Number(s)) && Number(s) > 0 && Number.isInteger(Number(s));
      const isSize = (s: string | null) => !!s && [10, 25, 50, 100].includes(Number(s));
      const OVERDUE_SORT_KEYS_LOCAL = ["client_name", "unit_id", "_ov", "_amt", "_risk"];
      const validators: Record<string, (v: string | null) => boolean> = {
        tab: (v) => v === "overdue" || v === "kpi",
        kpi: (v) => !!v && (DRILL_KEYS as readonly string[]).includes(v),
        risk: (v) => v === "HIGH" || v === "MEDIUM" || v === "ALL",
        age: (v) => v === "1-30" || v === "31-60" || v === "61-90" || v === "90+" || v === "ALL",
        osort: (v) => {
          if (!v) return false;
          const [k, d] = v.split(".");
          return OVERDUE_SORT_KEYS_LOCAL.includes(k) && (d === "asc" || d === "desc");
        },
        osize: isSize,
        opage: isInt,
        ksort: (v) => {
          if (!v) return false;
          const [i, d] = v.split(".");
          const n = Number(i);
          return (
            Number.isFinite(n) &&
            Number.isInteger(n) &&
            n >= 0 &&
            n <= 32 &&
            (d === "asc" || d === "desc")
          );
        },
        ksize: isSize,
        kpage: isInt,
        kq: (v) => typeof v === "string" && v.length > 0 && v.length <= 128,
        oq: (v) => typeof v === "string" && v.length > 0 && v.length <= 128,
        preset: (v) => !!v && v.length > 0 && v.length <= 64,
        oexp: (v) => !!v && v.length > 0 && v.length <= 64,
        kexp: (v) =>
          !!v &&
          Number.isFinite(Number(v)) &&
          Number.isInteger(Number(v)) &&
          Number(v) >= 0 &&
          Number(v) <= 100000,
      };
      const KPI_SUB = ["ksort", "ksize", "kpage", "kexp", "kq"] as const;
      type Change = { key: string; from: string; to: string };
      const changes: Change[] = [];
      const truncate = (s: string) => (s.length > 24 ? s.slice(0, 21) + "…" : s);
      // 1) Snapshot intent BEFORE stripping (valid sub, invalid kpi, any sub present).
      const hadValidKpiSub = KPI_SUB.some((k) => sp.has(k) && validators[k](sp.get(k)));
      const hadAnyKpiSub = KPI_SUB.some((k) => sp.has(k));
      const hadInvalidKpi = sp.has("kpi") && !validators.kpi(sp.get("kpi"));
      // Preserve raw kexp so we can clamp instead of strip when out of bounds.
      const rawKexp = sp.get("kexp");
      const kexpInvalid = sp.has("kexp") && !validators.kexp(rawKexp);

      // 2) Strip every individually-invalid param. kexp is clamped below.
      for (const key of Object.keys(validators)) {
        if (key === "kexp") continue;
        if (sp.has(key) && !validators[key](sp.get(key))) {
          changes.push({ key, from: truncate(sp.get(key) ?? ""), to: "removed" });
          sp.delete(key);
        }
      }
      // 3) Recover kpi=overdue when intent is clear.
      if (
        !sp.has("kpi") &&
        (sp.get("tab") === "kpi" || hadValidKpiSub || hadInvalidKpi || hadAnyKpiSub)
      ) {
        sp.set("kpi", "overdue");
        const existing = changes.find((c) => c.key === "kpi");
        if (existing) existing.to = "overdue";
        else changes.push({ key: "kpi", from: "(missing)", to: "overdue" });
      }

      // 4) Keep tab and kpi in sync.
      if (sp.has("kpi") && !sp.has("tab")) sp.set("tab", "kpi");
      // 5) Clamp invalid kexp to nearest valid index when kpi survives.
      if (sp.has("kpi") && kexpInvalid) {
        const n = Number(rawKexp);
        const clamped = Number.isFinite(n) && n > 100000 ? 100000 : 0;
        sp.set("kexp", String(clamped));
        changes.push({ key: "kexp", from: truncate(rawKexp ?? ""), to: `row #${clamped + 1}` });
      }
      // Otherwise drop sub-params if kpi could not be recovered.
      if (!sp.has("kpi")) {
        for (const k of KPI_SUB) {
          if (sp.has(k)) {
            changes.push({ key: k, from: truncate(sp.get(k) ?? ""), to: "removed" });
            sp.delete(k);
          }
        }
      }

      if (changes.length > 0) {
        const next = url.pathname + (url.search ? url.search : "") + url.hash;
        window.history.replaceState(null, "", next);
        const keys = Array.from(new Set(changes.map((c) => c.key)));
        setResetParams(keys);
        setResetChanges(changes);

        const KPI_LABELS: Record<string, string> = {
          sell: "Total Sell Value",
          cash: "Cash Recovered",
          adj_approved: "Total Adjustment Approved",
          adj_realised: "Total Adjustment Realised",
          commission: "Commission Paid",
          received: "Total Received",
          pending: "Total Pending Balance",
          overdue: "Current Overdue Amount",
          cancelled: "Total Cancelled",
        };
        const PARAM_LABELS_SR: Record<string, string> = {
          tab: "Active tab",
          kpi: "KPI selection",
          risk: "Risk filter",
          age: "Overdue age filter",
          osort: "Overdue sort",
          osize: "Overdue page size",
          opage: "Overdue page",
          oq: "Overdue search",
          oexp: "Overdue expanded row",
          ksort: "KPI sort",
          ksize: "KPI page size",
          kpage: "KPI page",
          kq: "KPI search",
          kexp: "KPI expanded row",
          preset: "Saved preset",
        };

        // Group by outcome so the user sees what was thrown away vs. fixed.
        const removed = changes.filter((c) => c.to === "removed");
        const adjusted = changes.filter((c) => c.to !== "removed");
        const fmtKV = (c: Change) => `${c.key}="${c.from}"`;
        const fmtAdj = (c: Change) => `${c.key}="${c.from}" → ${c.to}`;

        const parts: string[] = [];
        if (removed.length) parts.push(`Invalid (removed): ${removed.map(fmtKV).join(", ")}`);
        if (adjusted.length) parts.push(`Adjusted: ${adjusted.map(fmtAdj).join(", ")}`);

        // Explicit confirmation of where the user landed.
        const finalTab = sp.get("tab") === "kpi" ? "kpi" : "overdue";
        const finalKpi = sp.get("kpi");
        const landing =
          finalTab === "kpi" && finalKpi
            ? `Landing on: KPI tab → “${KPI_LABELS[finalKpi] ?? finalKpi}”`
            : `Landing on: Overdue tab`;
        parts.push(landing);

        // Screen-reader narrative: full sentences, no symbols, includes original
        // values and replacements so AT users get the same detail sighted users see.
        const srSentences = changes.map((c) => {
          const label = PARAM_LABELS_SR[c.key] ?? c.key;
          const from = c.from ? `"${c.from}"` : "(missing)";
          return c.to === "removed"
            ? `${label} ${from} was invalid and removed.`
            : `${label} ${from} was invalid and replaced with "${c.to}".`;
        });
        const landingSr =
          finalTab === "kpi" && finalKpi
            ? `Now landing on the KPI tab, ${KPI_LABELS[finalKpi] ?? finalKpi}.`
            : `Now landing on the Overdue tab.`;
        const srNarrative = `${srSentences.join(" ")} ${landingSr}`.trim();
        setResetLandingSr(srNarrative);

        // Plain-text report users can paste into a bug ticket / chat with support.
        const reportLines = [
          `Dashboard URL sanitization report`,
          `Time: ${new Date().toISOString()}`,
          `URL: ${window.location.href}`,
          ``,
        ];
        if (removed.length) {
          reportLines.push(`Invalid (removed):`);
          removed.forEach((c) =>
            reportLines.push(`  - ${c.key} = "${c.from}"  [${PARAM_LABELS_SR[c.key] ?? c.key}]`),
          );
        }
        if (adjusted.length) {
          if (removed.length) reportLines.push(``);
          reportLines.push(`Adjusted:`);
          adjusted.forEach((c) =>
            reportLines.push(
              `  - ${c.key}: "${c.from}" -> "${c.to}"  [${PARAM_LABELS_SR[c.key] ?? c.key}]`,
            ),
          );
        }
        reportLines.push(``, landing.replace(/[“”]/g, '"'));
        const reportText = reportLines.join("\n");

        toast.warning("Some link parameters were invalid", {
          description: (
            <>
              <span aria-hidden="true">{parts.join(" · ")}</span>
              <span className="sr-only">{srNarrative}</span>
            </>
          ),
          duration: 12000,
          action: {
            label: "Copy reset details",
            onClick: async () => {
              const ok = await tryCopyToClipboard(reportText);
              if (ok) toast.success("Reset details copied to clipboard");
              else toast.error("Couldn't copy — open the banner to copy manually");
            },
          },
        });

        // Persist this sanitization event for cross-session history export.
        try {
          import("@/lib/sanitizerHistory")
            .then(({ appendSanitizerHistoryEntry }) => {
              appendSanitizerHistoryEntry({
                at: new Date().toISOString(),
                url: window.location.href,
                changes: changes.map((c) => ({ key: c.key, from: c.from, to: c.to })),
                finalTab,
                finalKpi: finalKpi ?? null,
                kpiLabel: finalKpi ? (KPI_LABELS[finalKpi] ?? finalKpi) : null,
              });
            })
            .catch(() => {
              /* non-fatal */
            });
        } catch {
          /* non-fatal */
        }
      }
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
  }, [DRILL_KEYS]);

  // URL sync effect lives after overdueSort/page/pageSize declarations below.
  // Named filter presets (Risk + Overdue Age) — persisted in localStorage
  type FilterPreset = { name: string; risk: typeof riskFilter; age: typeof ageFilter };
  const FILTER_PRESETS_KEY = "dash.overdue.presets";
  const [filterPresets, setFilterPresets] = useState<FilterPreset[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(FILTER_PRESETS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((p) => p && typeof p.name === "string") : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(FILTER_PRESETS_KEY, JSON.stringify(filterPresets));
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
  }, [filterPresets]);
  const LAST_PRESET_KEY = "dash.overdue.lastPreset";
  const applyFilterPreset = (p: FilterPreset) => {
    setRiskFilter(p.risk);
    setAgeFilter(p.age);
    setOverduePage(1);
    try {
      localStorage.setItem(LAST_PRESET_KEY, p.name);
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
    toast.success(`Applied preset: ${p.name}`);
  };
  const saveCurrentFilterPreset = () => {
    const name = (
      typeof window !== "undefined"
        ? window.prompt("Name this filter preset:", `Risk ${riskFilter} · Age ${ageFilter}`)
        : null
    )?.trim();
    if (!name) return;
    setFilterPresets((prev) => {
      const without = prev.filter((p) => p.name.toLowerCase() !== name.toLowerCase());
      return [...without, { name, risk: riskFilter, age: ageFilter }];
    });
    try {
      localStorage.setItem(LAST_PRESET_KEY, name);
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
    toast.success(`Saved preset: ${name}`);
  };
  const deleteFilterPreset = (name: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete preset "${name}"? This cannot be undone.`)
    )
      return;
    setFilterPresets((prev) => prev.filter((p) => p.name !== name));
    try {
      if (localStorage.getItem(LAST_PRESET_KEY) === name) localStorage.removeItem(LAST_PRESET_KEY);
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
    toast.success(`Deleted preset: ${name}`);
  };
  const clearAllFilterPresets = () => {
    if (filterPresets.length === 0) {
      toast.info("No presets to clear.");
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Delete all ${filterPresets.length} saved filter preset(s)? This cannot be undone.`,
      )
    )
      return;
    setFilterPresets([]);
    try {
      localStorage.removeItem(FILTER_PRESETS_KEY);
      localStorage.removeItem(LAST_PRESET_KEY);
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
    toast.success("Cleared all filter presets");
  };
  const renameFilterPreset = (oldName: string) => {
    const next = (
      typeof window !== "undefined" ? window.prompt("Rename preset:", oldName) : null
    )?.trim();
    if (!next || next === oldName) return;
    setFilterPresets((prev) => {
      if (prev.some((p) => p.name.toLowerCase() === next.toLowerCase() && p.name !== oldName)) {
        toast.error(`A preset named "${next}" already exists.`);
        return prev;
      }
      return prev.map((p) => (p.name === oldName ? { ...p, name: next } : p));
    });
    try {
      if (localStorage.getItem(LAST_PRESET_KEY) === oldName)
        localStorage.setItem(LAST_PRESET_KEY, next);
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
    toast.success(`Renamed to: ${next}`);
  };
  // Derived: which saved preset (if any) matches the current Risk+Age selection
  const activePresetName = useMemo(
    () => filterPresets.find((p) => p.risk === riskFilter && p.age === ageFilter)?.name ?? null,
    [filterPresets, riskFilter, ageFilter],
  );
  // On mount: if URL has ?preset=, apply that saved preset (URL risk/age still win if also set)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const sp = new URLSearchParams(window.location.search);
      const name = sp.get("preset");
      if (!name) return;
      const p = filterPresets.find((x) => x.name === name);
      if (!p) return;
      if (!sp.has("risk")) setRiskFilter(p.risk);
      if (!sp.has("age")) setAgeFilter(p.age);
      try {
        localStorage.setItem(LAST_PRESET_KEY, p.name);
      } catch (err) {
        console.error("[localStorage] write error", err);
      }
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Auto-apply the last-used preset on mount if no risk/age URL params override it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.has("risk") || sp.has("age")) return; // URL wins
      const name = localStorage.getItem(LAST_PRESET_KEY);
      if (!name) return;
      const preset = filterPresets.find((p) => p.name === name);
      if (!preset) return;
      if (preset.risk === riskFilter && preset.age === ageFilter) return; // already matches
      setRiskFilter(preset.risk);
      setAgeFilter(preset.age);
      setOverduePage(1);
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [expandedId, setExpandedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const urlV = new URLSearchParams(window.location.search).get("oexp");
      if (urlV) return urlV;
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
    return localStorage.getItem("dash.overdue.expandedId") || null;
  });
  useEffect(() => {
    try {
      if (expandedId) localStorage.setItem("dash.overdue.expandedId", expandedId);
      else localStorage.removeItem("dash.overdue.expandedId");
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
  }, [expandedId]);

  const OVERDUE_PAGE_SIZES = [10, 25, 50, 100] as const;
  const [overduePageSize, setOverduePageSize] = useState<number>(() => {
    if (typeof window === "undefined") return 25;
    const urlV = Number(new URLSearchParams(window.location.search).get("osize"));
    if ((OVERDUE_PAGE_SIZES as readonly number[]).includes(urlV)) return urlV;
    const v = Number(localStorage.getItem("dash.overdue.pageSize"));
    return (OVERDUE_PAGE_SIZES as readonly number[]).includes(v) ? v : 25;
  });
  const [overduePage, setOverduePage] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    const urlV = Number(new URLSearchParams(window.location.search).get("opage"));
    if (Number.isFinite(urlV) && urlV > 0) return urlV;
    const v = Number(localStorage.getItem("dash.overdue.page"));
    return Number.isFinite(v) && v > 0 ? v : 1;
  });
  useEffect(() => {
    try {
      localStorage.setItem("dash.overdue.pageSize", String(overduePageSize));
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
  }, [overduePageSize]);
  useEffect(() => {
    try {
      localStorage.setItem("dash.overdue.page", String(overduePage));
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
  }, [overduePage]);

  type OverdueSortKey = "client_name" | "unit_id" | "_ov" | "_amt" | "_risk";
  const OVERDUE_SORT_KEYS: OverdueSortKey[] = ["client_name", "unit_id", "_ov", "_amt", "_risk"];
  const [overdueSort, setOverdueSort] = useState<{ key: OverdueSortKey; dir: "asc" | "desc" }>(
    () => {
      const def = { key: "_amt" as OverdueSortKey, dir: "desc" as const };
      if (typeof window === "undefined") return def;
      try {
        const urlRaw = new URLSearchParams(window.location.search).get("osort");
        if (urlRaw) {
          const [k, d] = urlRaw.split(".");
          if (OVERDUE_SORT_KEYS.includes(k as OverdueSortKey) && (d === "asc" || d === "desc")) {
            return { key: k as OverdueSortKey, dir: d };
          }
        }
        const raw = localStorage.getItem("dash.overdue.sort");
        if (raw) {
          const p = JSON.parse(raw);
          if (p && OVERDUE_SORT_KEYS.includes(p.key) && (p.dir === "asc" || p.dir === "desc"))
            return p;
        }
      } catch (err) {
        console.error("[localStorage] write error", err);
      }
      return def;
    },
  );
  useEffect(() => {
    try {
      localStorage.setItem("dash.overdue.sort", JSON.stringify(overdueSort));
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
  }, [overdueSort]);
  // Free-text search across overdue rows — persisted in URL (oq) + localStorage
  const [overdueQuery, setOverdueQuery] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      const urlV = new URLSearchParams(window.location.search).get("oq");
      if (urlV != null) return urlV.slice(0, 128);
      return (localStorage.getItem("dash.overdue.query") || "").slice(0, 128);
    } catch {
      return "";
    }
  });
  useEffect(() => {
    try {
      if (overdueQuery) localStorage.setItem("dash.overdue.query", overdueQuery);
      else localStorage.removeItem("dash.overdue.query");
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
  }, [overdueQuery]);
  // Reflect overdue filters/sort/pagination + active KPI in the URL so the page is shareable
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      const set = (k: string, v: string | null) => {
        if (v == null || v === "") url.searchParams.delete(k);
        else url.searchParams.set(k, v);
      };
      set("risk", riskFilter === "ALL" ? null : riskFilter);
      set("age", ageFilter === "ALL" ? null : ageFilter);
      set("kpi", drillKey);
      const sortDefault = overdueSort.key === "_amt" && overdueSort.dir === "desc";
      set("osort", sortDefault ? null : `${overdueSort.key}.${overdueSort.dir}`);
      set("osize", overduePageSize === 25 ? null : String(overduePageSize));
      set("opage", overduePage === 1 ? null : String(overduePage));
      set("preset", activePresetName);
      set("oexp", expandedId);
      set("oq", overdueQuery.trim() ? overdueQuery.trim().slice(0, 128) : null);
      set("tab", activeTab === "overdue" ? null : "kpi");

      const next = url.pathname + (url.search ? url.search : "") + url.hash;
      const current = window.location.pathname + window.location.search + window.location.hash;
      if (next !== current) window.history.replaceState(null, "", next);
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
  }, [
    riskFilter,
    ageFilter,
    drillKey,
    overdueSort,
    overduePageSize,
    overduePage,
    activePresetName,
    expandedId,
    overdueQuery,
    activeTab,
  ]);
  const resetTableView = () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Reset table view? This clears saved sorting, pagination, expansion, and search for both Overdue and KPI tables and removes them from the URL.",
      )
    )
      return;
    setOverdueSort({ key: "_amt", dir: "desc" });
    setOverduePageSize(25);
    setOverduePage(1);
    setOverdueQuery("");
    setExpandedId(null);
    try {
      localStorage.removeItem("dash.overdue.sort");
      localStorage.removeItem("dash.overdue.pageSize");
      localStorage.removeItem("dash.overdue.page");
      localStorage.removeItem("dash.overdue.query");
      localStorage.removeItem("dash.overdue.expandedId");
      localStorage.removeItem("dash.kpi.pageSize");
      // Clear all per-KPI sort / page / expanded / query keys
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (
          k &&
          (k.startsWith("dash.kpi.sort.") ||
            k.startsWith("dash.kpi.page.") ||
            k.startsWith("dash.kpi.expanded.") ||
            k.startsWith("dash.kpi.query."))
        ) {
          toRemove.push(k);
        }
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
    // Strip table-related URL params so a refresh stays at defaults
    try {
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        ["osort", "osize", "opage", "oexp", "oq", "ksort", "ksize", "kpage", "kexp", "kq"].forEach(
          (k) => url.searchParams.delete(k),
        );
        const next = url.pathname + (url.search ? url.search : "") + url.hash;
        const cur = window.location.pathname + window.location.search + window.location.hash;
        if (next !== cur) window.history.replaceState(null, "", next);
      }
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
    toast.success("Table view reset — URL and saved state cleared");
  };

  // ---- Named Table View presets (Overdue + KPI) ----
  type OverdueViewPreset = {
    scope: "overdue";
    name: string;
    sort: { key: OverdueSortKey; dir: "asc" | "desc" };
    pageSize: number;
    page: number;
  };
  type KpiViewPreset = {
    scope: "kpi";
    name: string;
    kpiKey: DrillKey;
    sort: { idx: number; dir: "asc" | "desc" } | null;
    pageSize: number;
    page: number;
  };
  type TableViewPreset = OverdueViewPreset | KpiViewPreset;
  const TABLE_VIEWS_KEY = "dash.tableViews";
  const [tableViews, setTableViews] = useState<TableViewPreset[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(TABLE_VIEWS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr)
        ? arr.filter(
            (v) => v && (v.scope === "overdue" || v.scope === "kpi") && typeof v.name === "string",
          )
        : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(TABLE_VIEWS_KEY, JSON.stringify(tableViews));
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
  }, [tableViews]);

  const saveOverdueView = () => {
    const name = (
      typeof window !== "undefined"
        ? window.prompt(
            "Name this Overdue view:",
            `Overdue · ${overdueSort.key}.${overdueSort.dir} · size ${overduePageSize}`,
          )
        : null
    )?.trim();
    if (!name) return;
    const preset: OverdueViewPreset = {
      scope: "overdue",
      name,
      sort: overdueSort,
      pageSize: overduePageSize,
      page: overduePage,
    };
    setTableViews((prev) => [
      ...prev.filter(
        (p) => !(p.scope === "overdue" && p.name.toLowerCase() === name.toLowerCase()),
      ),
      preset,
    ]);
    toast.success(`Saved Overdue view: ${name}`);
  };
  const saveKpiView = () => {
    if (!drillKey) {
      toast.error("Open a KPI drill-down first to save its view.");
      return;
    }
    try {
      const sp = new URLSearchParams(window.location.search);
      const sortRaw = sp.get("ksort");
      let sort: KpiViewPreset["sort"] = null;
      if (sortRaw) {
        const [iStr, d] = sortRaw.split(".");
        const idx = Number(iStr);
        if (Number.isFinite(idx) && (d === "asc" || d === "desc"))
          sort = { idx, dir: d as "asc" | "desc" };
      }
      const pageSize =
        Number(sp.get("ksize")) || Number(localStorage.getItem("dash.kpi.pageSize")) || 25;
      const page =
        Number(sp.get("kpage")) || Number(localStorage.getItem(`dash.kpi.page.${drillKey}`)) || 1;
      const name = window
        .prompt("Name this KPI view:", `KPI ${drillKey} · size ${pageSize}`)
        ?.trim();
      if (!name) return;
      const preset: KpiViewPreset = { scope: "kpi", name, kpiKey: drillKey, sort, pageSize, page };
      setTableViews((prev) => [
        ...prev.filter((p) => !(p.scope === "kpi" && p.name.toLowerCase() === name.toLowerCase())),
        preset,
      ]);
      toast.success(`Saved KPI view: ${name}`);
    } catch {
      toast.error("Could not save KPI view");
    }
  };
  const applyTableView = (v: TableViewPreset) => {
    if (v.scope === "overdue") {
      setOverdueSort(v.sort);
      setOverduePageSize(v.pageSize);
      setOverduePage(v.page);
      toast.success(`Applied view: ${v.name}`);
      return;
    }
    // KPI: write URL params then open drilldown so its effects pick them up
    try {
      const url = new URL(window.location.href);
      if (v.sort) url.searchParams.set("ksort", `${v.sort.idx}.${v.sort.dir}`);
      else url.searchParams.delete("ksort");
      url.searchParams.set("ksize", String(v.pageSize));
      url.searchParams.set("kpage", String(v.page));
      url.searchParams.set("kpi", v.kpiKey);
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      try {
        localStorage.setItem("dash.kpi.pageSize", String(v.pageSize));
        localStorage.setItem(`dash.kpi.page.${v.kpiKey}`, String(v.page));
        if (v.sort)
          localStorage.setItem(`dash.kpi.sort.${v.kpiKey}`, `${v.sort.idx}.${v.sort.dir}`);
      } catch (err) {
        console.error("[localStorage] write error", err);
      }
      setDrillKey(v.kpiKey);
      toast.success(`Applied view: ${v.name}`);
    } catch {
      toast.error("Could not apply KPI view");
    }
  };
  const deleteTableView = (scope: "overdue" | "kpi", name: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete view "${name}"? This cannot be undone.`)
    )
      return;
    setTableViews((prev) => prev.filter((p) => !(p.scope === scope && p.name === name)));
    toast.success(`Deleted view: ${name}`);
  };

  const toggleOverdueSort = (key: OverdueSortKey) => {
    setOverduePage(1);
    setOverdueSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "_ov" || key === "_amt" ? "desc" : "asc" },
    );
  };

  const openWa = (b: any) => {
    const phone = toWaPhone(b.mobile);
    const vars = {
      phone,
      name: b.client_name ?? "",
      unit: b.unit_id ?? "",
      overdue_count: b._ov,
      amount: fmtPKR(Number(b._amt) || 0),
    };
    setWaTarget(vars);
    setWaMessage(renderTemplate(waTemplate, vars));
    setWaOpen(true);
  };

  const sendWa = () => {
    if (!waTarget?.phone) {
      toast.error("No phone number on file for this client.");
      return;
    }
    const url = `https://wa.me/${waTarget.phone}?text=${encodeURIComponent(waMessage)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setWaOpen(false);
  };

  const saveTemplate = () => {
    setWaTemplate(tplDraft);
    try {
      localStorage.setItem(WA_TEMPLATE_KEY, tplDraft);
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
    toast.success("WhatsApp template saved");
    setTplOpen(false);
  };

  const applyPreset = (p: RangePreset) => {
    setPreset(p);
    if (p === "custom") return;
    const r = presetRange(p);
    setFrom(r.from);
    setTo(r.to);
  };

  const clearFilter = () => {
    setPreset("all");
    setFrom("");
    setTo("");
    setProjectFilter("all");
    setUnitFilter("all");
    setClientFilter("all");
  };

  // ---- Debounced filter inputs -----------------------------------------
  // Rapid taps on chip groups (preset ranges, project/unit/client selects)
  // re-run the heavy `filtered` memo — and every downstream KPI / chart /
  // drill — on every change. On 4G, the resulting main-thread bursts pushed
  // p95 render past 2s. We debounce the filter tuple by 220ms so a burst of
  // taps collapses into a single recompute, keeping loading under the 2s
  // target without changing what the user sees at rest.
  const useDebouncedValue = <T,>(value: T, delay = 220): T => {
    const [v, setV] = useState(value);
    useEffect(() => {
      const id = setTimeout(() => setV(value), delay);
      return () => clearTimeout(id);
    }, [value, delay]);
    return v;
  };
  const dFrom = useDebouncedValue(from);
  const dTo = useDebouncedValue(to);
  const dProjectFilter = useDebouncedValue(projectFilter);
  const dUnitFilter = useDebouncedValue(unitFilter);
  const dClientFilter = useDebouncedValue(clientFilter);

  const inRange = (d?: string | null) => {
    if (!d) return !dFrom && !dTo;
    if (dFrom && d < dFrom) return false;
    if (dTo && d > dTo) return false;
    return true;
  };

  const projectOptions = useMemo(() => {
    if (!data?.projects) return [] as { code: string; name: string }[];
    return data.projects.map((p: any) => ({
      code: p.project_code as string,
      name: p.project_name as string,
    }));
  }, [data?.projects]);

  const unitOptions = useMemo(() => {
    if (!data?.bookings) return [] as string[];
    const set = new Set<string>();
    for (const b of data.bookings as any[]) {
      if (!b.unit_id) continue;
      if (dProjectFilter !== "all" && b.project_code !== dProjectFilter) continue;
      set.add(b.unit_id);
    }
    return Array.from(set).sort();
  }, [data?.bookings, dProjectFilter]);

  const clientOptions = useMemo(() => {
    if (!data?.bookings) return [] as string[];
    const set = new Set<string>();
    for (const b of data.bookings as any[]) {
      if (!b.client_name) continue;
      if (dProjectFilter !== "all" && b.project_code !== dProjectFilter) continue;
      if (dUnitFilter !== "all" && b.unit_id !== dUnitFilter) continue;
      set.add(b.client_name);
    }
    return Array.from(set).sort();
  }, [data?.bookings, dProjectFilter, dUnitFilter]);

  const filtered = useMemo(() => {
    const empty = {
      bookings: [] as any[],
      payments: [] as any[],
      ledger: [] as any[],
      adjustments: [] as any[],
      units: [] as any[],
      projects: [] as any[],
      transactions: [] as any[],
    };
    if (!data) return empty as any;

    // Safety: ensure every array exists
    const bookingsRaw = data.bookings || [];
    const paymentsRaw = data.payments || [];
    const ledgerRaw = data.ledger || [];
    const adjustmentsRaw = data.adjustments || [];
    const unitsRaw = data.units || [];
    const projectsRaw = data.projects || [];
    const transactionsRaw = data.transactions || [];

    let projectBookings = bookingsRaw;
    if (dProjectFilter !== "all")
      projectBookings = projectBookings.filter((b: any) => b.project_code === dProjectFilter);
    if (dUnitFilter !== "all")
      projectBookings = projectBookings.filter((b: any) => b.unit_id === dUnitFilter);
    if (dClientFilter !== "all")
      projectBookings = projectBookings.filter((b: any) => b.client_name === dClientFilter);

    const bookingIds = new Set(projectBookings.map((b: any) => b.booking_id));
    const scopeByBooking =
      dProjectFilter !== "all" || dUnitFilter !== "all" || dClientFilter !== "all";

    let bookings =
      !dFrom && !dTo
        ? projectBookings
        : projectBookings.filter((b: any) => inRange(b.booking_date));

    let payments =
      !dFrom && !dTo ? paymentsRaw : paymentsRaw.filter((p: any) => inRange(p.payment_date));
    if (scopeByBooking) payments = payments.filter((p: any) => bookingIds.has(p.booking_id));

    let ledger = !dFrom && !dTo ? ledgerRaw : ledgerRaw.filter((l: any) => inRange(l.due_date));
    if (scopeByBooking) ledger = ledger.filter((l: any) => bookingIds.has(l.booking_id));

    // Also filter adjustments by date range using adjustment_date
    let adjustments =
      !dFrom && !dTo
        ? adjustmentsRaw
        : adjustmentsRaw.filter((a: any) => inRange(a.adjustment_date));
    adjustments = adjustments.filter((a: any) => bookingIds.has(a.booking_id));

    const units =
      dProjectFilter === "all"
        ? unitsRaw
        : unitsRaw.filter((u: any) => u.project_code === dProjectFilter);

    const transactions = scopeByBooking
      ? transactionsRaw.filter((t: any) => bookingIds.has(t.booking_id))
      : transactionsRaw;

    return {
      bookings,
      payments,
      ledger,
      adjustments,
      units,
      projects: projectsRaw,
      transactions,
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, dFrom, dTo, dProjectFilter, dUnitFilter, dClientFilter]);

  const today = new Date().toISOString().slice(0, 10);
  const totalSellValue = filtered.bookings.reduce(
    (s: number, b: any) => s + (Number(b.sold_unit_value) || 0),
    0,
  );
  const totalContract = filtered.bookings.reduce(
    (s: number, b: any) => s + (Number(b.total_contract_value) || 0),
    0,
  );
  // Cash, Adj. Realised, Commission, and Total Received all flow through a
  // shared pure helper so the KPI tile and its unit tests stay in lock-step.
  const __totals = computeTotalReceived({
    bookings: filtered.bookings,
    payments: filtered.payments,
    adjustments: filtered.adjustments,
  });
  const cashRecovered = __totals.cashRecovered;
  const adjRealised = __totals.adjRealised;
  const totalCommission = __totals.commissionPaid;
  const totalReceived = __totals.totalReceived;
  const adjApproved = __totals.adjApproved;

  // IMPORTANT: The KPI totalReceived and the drill-down total must use the same formula.
  // We double-check the components here to ensure the "drill" view doesn't drift.
  const drillReceivedTotal = Math.round((cashRecovered - adjApproved) * 100) / 100;

  // Adjustment Allowed (approved by company) — REDUCES client balance.
  // Company Loss on adjustments = Allowed − Realised (asset booked at allowed value but only this much was recovered).
  const adjCompanyLoss = Math.max(adjApproved - adjRealised, 0);
  // Net Cash After Commission — what stayed with the company in cash.
  const netCashAfterCommission = cashRecovered - totalCommission;
  // Pending Balance (client-side) & Cancelled Bookings:
  // If a booking is Cancelled, its remaining unpaid balance is subtracted from active Pending Balance.
  // Cancelled uncollected balances are tracked separately in totalCancelledBalance.
  const pendingRows = computePendingRows(
    filtered.bookings,
    filtered.payments,
    filtered.adjustments,
  );
  const pendingBalance = totalPending(pendingRows);
  const totalCancelledBalance = totalCancelled(pendingRows);
  const cancelledBookings = filtered.bookings.filter(
    (b: any) =>
      String(b.booking_status ?? b.status ?? "")
        .trim()
        .toLowerCase() === "cancelled",
  );
  const activeBookingIds = new Set(
    filtered.bookings
      .filter(
        (b: any) =>
          String(b.booking_status ?? b.status ?? "")
            .trim()
            .toLowerCase() !== "cancelled",
      )
      .map((b: any) => b.booking_id),
  );

  const overdueRows = filtered.ledger.filter((l: any) => {
    if (!activeBookingIds.has(l.booking_id)) return false; // Cancelled bookings are excluded from overdue
    const isInstallment = !/down payment|possession/i.test(l.particulars ?? "");
    const due = Number(l.due_amount) || 0;
    const paid = Number(l.paid_amount) || 0;
    return isInstallment && l.due_date && l.due_date < today && due - paid > 0;
  });
  const overdueValue = overdueRows.reduce(
    (s: number, l: any) =>
      s + Math.max((Number(l.due_amount) || 0) - (Number(l.paid_amount) || 0), 0),
    0,
  );

  const recoveryPct = totalSellValue > 0 ? Math.round((totalReceived / totalSellValue) * 100) : 0;

  // ---- Hero band inputs ----
  const { user: heroAuthUser } = useAuth();
  const heroUserName = (() => {
    const md: any = (heroAuthUser as any)?.user_metadata ?? {};
    const name: string =
      md.full_name ||
      md.name ||
      (heroAuthUser?.email ? String(heroAuthUser.email).split("@")[0] : "there");
    return name.charAt(0).toUpperCase() + name.slice(1);
  })();

  // Unit status donut must reflect the active project too. `filtered.units`
  // is scoped to the current projectFilter (see the `filtered` memo above),
  // so switching the header project immediately reslices this widget.
  const unitStatus = (filtered?.units ?? []).reduce((acc: Record<string, number>, u: any) => {
    if (!u) return acc;
    acc[u.status ?? "Unknown"] = (acc[u.status ?? "Unknown"] ?? 0) + 1;
    return acc;
  }, {});

  const byProject = (filtered?.projects ?? []).map((p: any) => {
    const sold = (filtered?.bookings ?? [])
      .filter((b: any) => b && b.project_code === p.project_code)
      .reduce((s: number, b: any) => s + (Number(b.sold_unit_value) || 0), 0);
    return { name: p.project_name, sold };
  });

  // ---------- KPI trend (granular) ----------
  const trendData = (() => {
    const allDates: string[] = [
      ...(filtered?.bookings ?? []).map((b: any) => b?.booking_date).filter(Boolean),
      ...(filtered?.payments ?? []).map((p: any) => p?.payment_date).filter(Boolean),
    ];
    if (allDates.length === 0)
      return [] as { bucket: string; sell: number; cash: number; pending: number }[];
    const minD = from || allDates.reduce((a, b) => (a < b ? a : b));
    const maxD = to || allDates.reduce((a, b) => (a > b ? a : b));

    // bucket key + label per granularity
    const startOfWeek = (d: Date) => {
      const x = new Date(d);
      const dow = x.getDay();
      x.setDate(x.getDate() - dow);
      return x;
    };
    const fmtISO = (d: Date) => d.toISOString().slice(0, 10);
    const keyOf = (iso: string): string => {
      if (granularity === "month") return iso.slice(0, 7);
      if (granularity === "day") return iso;
      return fmtISO(startOfWeek(new Date(iso))); // week start (Sun)
    };
    const labelOf = (key: string): string => {
      // Parse as LOCAL time to avoid off-by-one shifts for users behind UTC.
      // `new Date("YYYY-MM-DD")` parses as UTC midnight and can render as the
      // previous day/month once toLocaleString applies the local timezone.
      if (granularity === "month") {
        const [y, m] = key.split("-").map(Number);
        const d = new Date(y, (m || 1) - 1, 1);
        return d.toLocaleString("en", { month: "short", year: "2-digit" });
      }
      const [y, m, day] = key.split("-").map(Number);
      const d = new Date(y, (m || 1) - 1, day || 1);
      return d.toLocaleString("en", { day: "2-digit", month: "short" });
    };

    // build bucket list spanning [minD, maxD]
    const buckets: { key: string; label: string }[] = [];
    const start = new Date(minD);
    const end = new Date(maxD);
    if (granularity === "month") {
      start.setDate(1);
      end.setDate(1);
      for (let c = new Date(start); c <= end; c.setMonth(c.getMonth() + 1)) {
        const k = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, "0")}`;
        buckets.push({ key: k, label: labelOf(k) });
      }
    } else if (granularity === "week") {
      for (let c = startOfWeek(start); c <= end; c.setDate(c.getDate() + 7)) {
        const k = fmtISO(c);
        buckets.push({ key: k, label: labelOf(k) });
      }
    } else {
      for (let c = new Date(start); c <= end; c.setDate(c.getDate() + 1)) {
        const k = fmtISO(c);
        buckets.push({ key: k, label: labelOf(k) });
      }
    }

    const sellBy: Record<string, number> = {};
    const cashBy: Record<string, number> = {};
    for (const b of filtered.bookings) {
      if (!b.booking_date) continue;
      const k = keyOf(b.booking_date);
      sellBy[k] = (sellBy[k] ?? 0) + (Number(b.sold_unit_value) || 0);
    }
    for (const p of filtered.payments) {
      if (!p.payment_date) continue;
      const k = keyOf(p.payment_date);
      cashBy[k] = (cashBy[k] ?? 0) + (Number(p.safe_cash_amount) || 0);
    }
    let cumSell = 0,
      cumCash = 0;
    return buckets.map((b) => {
      const sell = sellBy[b.key] ?? 0;
      const cash = cashBy[b.key] ?? 0;
      cumSell += sell;
      cumCash += cash;
      return { bucket: b.label, sell, cash, pending: Math.max(cumSell - cumCash, 0) };
    });
  })();

  // Overdue clients table — HIGH (3+) / MEDIUM (1-2). Skip LOW / zero and exclude cancelled bookings.
  const today_ = new Date().toISOString().slice(0, 10);
  const maxAgeByBooking = (() => {
    const m = new Map<string, number>();
    for (const l of (filtered?.ledger ?? []) as any[]) {
      if (!l || !activeBookingIds.has(l.booking_id)) continue;
      const due = Number(l.due_amount) || 0;
      const paid = Number(l.paid_amount) || 0;
      if (!l.due_date || l.due_date >= today_ || due - paid <= 0) continue;
      const days = Math.floor((Date.parse(today_) - Date.parse(l.due_date)) / 86400000);
      const prev = m.get(l.booking_id) ?? 0;
      if (days > prev) m.set(l.booking_id, days);
    }
    return m;
  })();
  const ageBucket = (d: number) =>
    d <= 30 ? "1-30" : d <= 60 ? "31-60" : d <= 90 ? "61-90" : "90+";
  const overdueAll = [...(filtered?.bookings ?? [])]
    .filter(
      (b: any) =>
        String(b.booking_status ?? b.status ?? "")
          .trim()
          .toLowerCase() !== "cancelled",
    )
    .map((b: any) => ({
      ...b,
      _ov: Number(b.current_overdue_count || 0),
      _amt: Number(b.total_overdue_amount || 0),
    }))
    .filter((b: any) => b._ov > 0)
    .map((b: any) => {
      const _age = maxAgeByBooking.get(b.booking_id) ?? 0;
      return { ...b, _risk: b._ov >= 3 ? "HIGH" : "MEDIUM", _age, _ageBucket: ageBucket(_age) };
    })
    .sort((a: any, b: any) => {
      const k = overdueSort.key;
      const m = overdueSort.dir === "asc" ? 1 : -1;
      if (k === "_risk") {
        const rank = (r: string) => (r === "HIGH" ? 1 : r === "MEDIUM" ? 0 : -1);
        return (rank(a._risk) - rank(b._risk)) * m;
      }
      const av = (a as any)[k];
      const bv = (b as any)[k];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * m;
      return (
        String(av ?? "").localeCompare(String(bv ?? ""), undefined, {
          numeric: true,
          sensitivity: "base",
        }) * m
      );
    });
  const oqNorm = overdueQuery.trim().toLowerCase();
  const overdueClients = overdueAll.filter((b: any) => {
    if (riskFilter !== "ALL" && b._risk !== riskFilter) return false;
    if (ageFilter !== "ALL" && b._ageBucket !== ageFilter) return false;
    if (oqNorm) {
      const hay =
        `${b.client_name ?? ""} ${b.unit_id ?? ""} ${b.booking_id ?? ""} ${b.project_code ?? ""}`.toLowerCase();
      if (!hay.includes(oqNorm)) return false;
    }
    return true;
  });
  const overdueTotalPages = Math.max(1, Math.ceil(overdueClients.length / overduePageSize));
  const overduePageSafe = Math.min(Math.max(1, overduePage), overdueTotalPages);
  useEffect(() => {
    if (overduePage !== overduePageSafe) setOverduePage(overduePageSafe);
  }, [overduePageSafe, overduePage]);
  const overduePageStart = (overduePageSafe - 1) * overduePageSize;
  const overduePageEnd = Math.min(overduePageStart + overduePageSize, overdueClients.length);
  const pagedOverdueClients = overdueClients.slice(overduePageStart, overduePageEnd);
  const riskCounts = {
    ALL: overdueAll.length,
    HIGH: overdueAll.filter((b) => b._risk === "HIGH").length,
    MEDIUM: overdueAll.filter((b) => b._risk === "MEDIUM").length,
  };
  const ageCounts: Record<string, number> = {
    ALL: overdueAll.length,
    "1-30": 0,
    "31-60": 0,
    "61-90": 0,
    "90+": 0,
  };
  for (const b of overdueAll) ageCounts[b._ageBucket]++;

  const kpis = [
    {
      key: "sell",
      label: "Total Sell Value",
      val: fmtPKR(totalSellValue),
      sub: `${(filtered?.bookings ?? []).length} bookings`,
      icon: Building2,
    },
    {
      key: "cash",
      label: "Cash Recovered",
      val: fmtPKR(cashRecovered),
      sub: "Cash / bank only — excludes adjustments",
      icon: Banknote,
    },
    {
      key: "adj_approved",
      label: "Total Adjustment Approved",
      val: fmtPKR(adjApproved),
      sub: `${filtered.adjustments.length} adjustments approved`,
      icon: Repeat2,
    },
    {
      key: "adj_realised",
      label: "Total Adjustment Realised",
      val: fmtPKR(adjRealised),
      sub: "Assets realised by company",
      icon: Coins,
    },
    {
      key: "commission",
      label: "Commission Paid",
      val: fmtPKR(totalCommission),
      sub: "Dealer commission paid out",
      icon: Banknote,
    },
    {
      key: "received",
      label: "Total Received (Fixed)",
      val: fmtPKR(totalReceived),
      sub: `Cash + Realised - Comm · ${recoveryPct}% of sell value`,
      icon: CheckCircle2,
    },
    {
      key: "pending",
      label: "Total Pending Balance",
      val: fmtPKR(pendingBalance),
      sub: "Active bookings unpaid balance",
      icon: Wallet,
    },
    {
      key: "overdue",
      label: "Current Overdue Amount",
      val: fmtPKR(overdueValue),
      sub: `${(overdueRows ?? []).length} overdue installments`,
      icon: AlertTriangle,
    },
    {
      key: "cancelled",
      label: "Total Cancelled",
      val: fmtPKR(totalCancelledBalance),
      sub: `${cancelledBookings.length} cancelled · removed from pending`,
      icon: Ban,
    },
  ] as const;
  type KpiKey = (typeof kpis)[number]["key"];
  void adjCompanyLoss;
  void netCashAfterCommission;
  void totalContract; // retained for future use

  const rangeLabel =
    !from && !to ? "All time" : `${from ? fmtDate(from) : "—"} → ${to ? fmtDate(to) : "—"}`;
  const presets: { key: RangePreset; label: string }[] = [
    { key: "all", label: "All time" },
    { key: "30d", label: "Last 30d" },
    { key: "90d", label: "Last 90d" },
    { key: "ytd", label: "YTD" },
    { key: "12m", label: "Last 12m" },
  ];

  const COLORS = [
    "hsl(var(--primary))",
    "hsl(var(--success))",
    "hsl(var(--warning))",
    "hsl(var(--destructive))",
    "hsl(var(--adjustment))",
    "hsl(var(--muted-foreground))",
  ];

  // ---------- CSV export ----------
  const csvCell = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const downloadCsv = (
    filename: string,
    headers: string[],
    rows: (string | number)[][],
    metaLines: string[] = [],
  ) => {
    const bodyLines = [
      headers.map(csvCell).join(","),
      ...rows.map((r) => r.map(csvCell).join(",")),
    ];
    const all = metaLines.length > 0 ? [...metaLines, "", ...bodyLines] : bodyLines;
    const blob = new Blob(["\ufeff" + all.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  const rangeSuffix = `${from || "all"}_${to || "all"}`;
  const activeFilters = () => ({
    Range: rangeLabel,
    Project:
      projectFilter !== "all"
        ? (projectOptions.find((p) => p.code === projectFilter)?.name ?? projectFilter)
        : null,
    Unit: unitFilter !== "all" ? unitFilter : null,
    Client: clientFilter !== "all" ? clientFilter : null,
  });
  const exportTrendCsv = () => {
    const trendColumns = [
      { key: "period", label: "Period" },
      { key: "sell", label: "Total Sell Value (PKR)" },
      { key: "cash", label: "Cash Recovered (PKR)" },
      { key: "pending", label: "Pending Balance Cumulative (PKR)" },
    ];
    const meta = buildCsvMetadataHeader({
      source: "Dashboard — KPI Trend",
      extra: { Granularity: granularity },
      filters: activeFilters(),
      sort: { key: "Period", dir: "asc" },
      counts: { shown: trendData.length },
      columns: trendColumns,
    });
    downloadCsv(
      `kpi-trend_${granularity}_${rangeSuffix}.csv`,
      trendColumns.map((c) => c.label),
      trendData.map((d) => [d.bucket, d.sell, d.cash, d.pending]),
      meta,
    );
  };
  const exportOverdueCsv = () => {
    const picked = overdueCols
      .map((k) => OVERDUE_COLS.find((c) => c.key === k))
      .filter((c): c is (typeof OVERDUE_COLS)[number] => Boolean(c));
    if (picked.length === 0) return;
    const headerLines = buildCsvMetadataHeader({
      source: "Overdue Clients",
      filters: { ...activeFilters(), Risk: riskFilter, Age: ageFilter },
      sort: { key: overdueSort.key, dir: overdueSort.dir },
      page: { page: overduePageSafe, totalPages: overdueTotalPages, pageSize: overduePageSize },
      counts: {
        shown: (pagedOverdueClients ?? []).length,
        filtered: (overdueClients ?? []).length,
        total: (overdueAll ?? []).length,
      },
      columns: picked.map((c) => ({ key: c.key, label: c.label })),
    });
    const body = [
      picked.map((c) => csvCell(c.label)).join(","),
      ...pagedOverdueClients.map((b: any) => picked.map((c) => csvCell(c.get(b))).join(",")),
    ];
    const blob = new Blob(["\ufeff" + [...headerLines, "", ...body].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `overdue-clients_p${overduePageSafe}_${rangeSuffix}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // ---------- Full-dashboard export (CSV + PDF) ----------
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState<null | "pdf" | "csv">(null);
  const FORMULA_PREF_KEY = "dashboard.export.includeFormulaRef";
  const [includeFormulaRef, setIncludeFormulaRef] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = window.localStorage.getItem(FORMULA_PREF_KEY);
    return v === null ? true : v === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(FORMULA_PREF_KEY, includeFormulaRef ? "1" : "0");
  }, [includeFormulaRef]);

  if (isError) {
    // Static error panel — DashboardErrorBoundary already handles live-region
    // announcement. This uses role=group so the assertive sr-only region
    // below (see line ~1777) stays as the FIRST alert-role node in source
    // order, which dashboardUrl.liveRegion.test locates via indexOf.
    return (
      <div
        role="group"
        aria-labelledby="dashboard-load-error"
        className="flex flex-col items-start gap-3 p-6"
      >
        <div id="dashboard-load-error" className="text-destructive font-medium">
          Failed to load dashboard data.
        </div>
        <div className="text-xs text-muted-foreground max-w-xl break-words">
          {(error as Error)?.message ?? "Unknown error"}
        </div>
        <button
          type="button"
          onClick={retryFromErrorUI}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          <Loader2 className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Retry
        </button>
      </div>
    );
  }

  if (isLoading || !data || !filtered) {
    return <DashboardSkeleton />;
  }

  // "Settled" = the initial load is done AND no background refetch is in
  // flight. `initialData` (stale snapshot) makes `isLoading` flip false
  // immediately, so a snapshot with zero rows would otherwise flash the
  // "No KPIs yet" / "No overdue clients" empty states for a moment before
  // the fresh fetch lands. Gate every empty state on `settled` and render
  // lightweight placeholders while the refetch is still running.
  const settled = !isFetching;

  const exportDashboardCsv = () => {
    setExporting("csv");
    try {
      const ts = new Date().toISOString().slice(0, 10);
      const filterLine = [
        `Range: ${rangeLabel}`,
        projectFilter !== "all"
          ? `Project: ${projectOptions.find((p) => p.code === projectFilter)?.name ?? projectFilter}`
          : null,
        unitFilter !== "all" ? `Unit: ${unitFilter}` : null,
        clientFilter !== "all" ? `Client: ${clientFilter}` : null,
      ]
        .filter(Boolean)
        .join(" | ");

      const sections: string[] = [];
      sections.push(`Precise Realtors — Dashboard Export`);
      sections.push(`Generated: ${new Date().toLocaleString()}`);
      sections.push(filterLine);
      sections.push("");

      // KPIs
      sections.push("KPI SUMMARY");
      sections.push(["Metric", "Value (PKR)"].map(csvCell).join(","));
      const kpiRows: [string, number][] = [
        ["Total Sell Value", totalSellValue],
        ["Cash Recovered", cashRecovered],
        ["Total Adjustment Approved", adjApproved],
        ["Total Adjustment Realised", adjRealised],
        ["Adjustment Company Loss", adjCompanyLoss],
        ["Total Received", totalReceived],
        ["Total Pending Balance", pendingBalance],
        ["Current Overdue Amount", overdueValue],
      ];
      kpiRows.forEach(([k, v]) => sections.push([csvCell(k), csvCell(v)].join(",")));
      sections.push("");

      // Formula reference — documents how derived KPIs are computed (user-toggleable)
      if (includeFormulaRef) {
        sections.push("FORMULA REFERENCE");
        sections.push(["Metric", "Formula"].map(csvCell).join(","));
        [
          ["Total Received", "Cash Recovered + Asset Realized \u2212 Commission Paid"],
          ["Cash Recovered", "Sum of cash receipts (excludes adjustments)"],
          ["Total Adjustment Realised", "Sum of approved adjustments marked realised"],
          ["Commission Paid", "Sum of commission payouts in range"],
          [
            "Total Pending Balance",
            "max(Sell Value \u2212 (Cash + Approved Adjustments), 0) per booking",
          ],
        ].forEach(([k, v]) => sections.push([csvCell(k), csvCell(v)].join(",")));
        sections.push("");
      }

      // Overdue clients — preserve user column order, current sort, and active risk/age filters
      const picked = overdueCols
        .map((k) => OVERDUE_COLS.find((c) => c.key === k))
        .filter((c): c is (typeof OVERDUE_COLS)[number] => Boolean(c));
      if (picked.length > 0 && overdueClients.length > 0) {
        sections.push("OVERDUE CLIENTS");
        sections.push(`Filters: Risk=${riskFilter} | Age=${ageFilter}`);
        sections.push(
          `Sort: Overdue Amount (PKR) descending  ·  Showing ${overdueClients.length} of ${overdueAll.length}`,
        );
        sections.push(picked.map((c) => csvCell(c.label)).join(","));
        overdueClients.forEach((b: any) => {
          sections.push(picked.map((c) => csvCell(c.get(b))).join(","));
        });
        sections.push("");
      }

      const blob = new Blob(["\ufeff" + sections.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dashboard_${rangeSuffix}_${ts}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Dashboard exported as CSV");
    } catch (e: any) {
      toast.error(`CSV export failed: ${e?.message ?? e}`);
    } finally {
      setExporting(null);
    }
  };

  const exportDashboardPdf = async () => {
    if (!dashboardRef.current) return;
    setExporting("pdf");
    const t = toast.loading("Rendering dashboard PDF…");
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const node = dashboardRef.current;
      const canvas = await html2canvas(node, {
        scale: 2,
        backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
        useCORS: true,
        logging: false,
        windowWidth: node.scrollWidth,
      });
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
      const formulaNote =
        "Total Received = Cash + Asset Realized \u2212 Commission Paid  ·  Pending = max(Sell \u2212 (Cash + Approved Adj), 0)";
      pdf.setProperties({
        title: `Precise Realtors Dashboard — ${rangeLabel}`,
        subject: includeFormulaRef ? formulaNote : `Precise Realtors Dashboard — ${rangeLabel}`,
        author: "Precise Realtors & Builders",
        keywords: includeFormulaRef
          ? "dashboard, KPI, Total Received = Cash + Asset Realized \u2212 Commission Paid"
          : "dashboard, KPI",
        creator: "Precise ERP",
      });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 24;
      const footerH = 18;
      const imgW = pageW - margin * 2;
      const imgH = (canvas.height * imgW) / canvas.width;

      let heightLeft = imgH;
      let position = margin;
      pdf.addImage(imgData, "JPEG", margin, position, imgW, imgH, undefined, "FAST");
      heightLeft -= pageH - margin * 2 - footerH;
      while (heightLeft > 0) {
        pdf.addPage();
        position = margin - (imgH - heightLeft);
        pdf.addImage(imgData, "JPEG", margin, position, imgW, imgH, undefined, "FAST");
        heightLeft -= pageH - margin * 2 - footerH;
      }
      if (includeFormulaRef) {
        const { stampFormulaFooter } = await import("@/lib/pdfFooter");
        stampFormulaFooter(pdf, formulaNote, { margin });
      }
      const ts = new Date().toISOString().slice(0, 10);
      pdf.save(`dashboard_${rangeSuffix}_${ts}.pdf`);
      toast.success("Dashboard exported as PDF", { id: t });
    } catch (e: any) {
      toast.error(`PDF export failed: ${e?.message ?? e}`, { id: t });
    } finally {
      setExporting(null);
    }
  };

  // ---------- AI snapshot (compact, numeric-only) ----------
  const aiSnapshot: AISnapshot = {
    rangeLabel,
    filters: {
      project:
        projectFilter !== "all"
          ? (projectOptions.find((p) => p.code === projectFilter)?.name ?? projectFilter)
          : undefined,
      unit: unitFilter !== "all" ? unitFilter : undefined,
      client: clientFilter !== "all" ? clientFilter : undefined,
    },
    kpis: {
      totalSellValue,
      cashRecovered,
      adjApproved,
      adjRealised,
      adjCompanyLoss,
      totalCommission,
      netCashAfterCommission,
      totalReceived,
      pendingBalance,
      overdueValue,
      overdueInstallments: (overdueRows ?? []).length,
      recoveryPct,
      bookings: (filtered?.bookings ?? []).length,
    },
    trendTail: trendData.slice(-12),
    overdueTop: overdueClients.slice(0, 10).map((b: any) => ({
      name: b.client_name,
      unit: b.unit_id,
      installments: b._ov,
      amount: b._amt,
      risk: b._risk,
    })),
    totalsByProject: byProject,
  };

  const PARAM_LABELS: Record<string, string> = {
    tab: "Active tab",
    kpi: "KPI selection",
    risk: "Risk filter",
    age: "Overdue age filter",
    osort: "Overdue sort",
    osize: "Overdue page size",
    opage: "Overdue page",
    oq: "Overdue search",
    oexp: "Overdue expanded row",
    ksort: "KPI sort",
    ksize: "KPI page size",
    kpage: "KPI page",
    kq: "KPI search",
    kexp: "KPI expanded row",
    preset: "Saved preset",
  };

  return (
    <div ref={dashboardRef}>
      <DashboardDiagnosticsPanel />
      {/* Live region is always mounted so SR announces the message when it appears,
          not when the region itself enters the DOM (which is unreliable across AT). */}
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        aria-relevant="additions text"
        className="sr-only"
      >
        {resetParams.length > 0 ? resetLandingSr : ""}
      </div>
      {/* Polite status mirror — captured by automated a11y tests and by SRs
          that don't surface assertive alerts (e.g. some VoiceOver setups). */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="url-sanitizer-status"
        className="sr-only"
      >
        {resetParams.length > 0
          ? `Invalid link parameters were reset. ${resetChanges
              .map((c) => {
                const label = PARAM_LABELS[c.key] ?? c.key;
                const from = c.from ? `"${c.from}"` : "(missing)";
                return c.to === "removed"
                  ? `${label} ${from} removed`
                  : `${label} ${from} replaced with "${c.to}"`;
              })
              .join("; ")}.${resetLandingSr ? ` ${resetLandingSr}` : ""}`
          : ""}
      </div>
      <AnimatePresence>
        {resetParams.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="mb-4 overflow-hidden"
            aria-labelledby="reset-params-heading"
          >
            {/*
              URL-sanitizer banner
              --------------------
              Uses shadcn <Alert variant="warning"> which already renders
              role="alert". We downgrade to role="status" + aria-live="polite"
              because the message is informational (invalid params were
              silently reset) — polite avoids interrupting whatever the
              screen-reader user is doing. Colors come from the semantic
              --warning token (WCAG AA in both themes); no raw amber-*.
              The heading uses role="heading" aria-level={2} + a focus ring
              so `resetHeadingRef.focus()` moves user focus into the alert
              on mount for the "landing on sanitized URL" narrative.
            */}
            <Alert
              variant="warning"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-labelledby="reset-params-heading"
              className="flex items-start gap-3 shadow-sm [&>svg]:static [&>svg]:mt-0.5 [&>svg~*]:pl-0"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div
                  id="reset-params-heading"
                  ref={resetHeadingRef}
                  tabIndex={-1}
                  role="heading"
                  aria-level={2}
                  className="font-semibold leading-snug rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-warning focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  Some link parameters were invalid and reset to safe defaults.
                </div>
                {/* Visual chip list — concise param keys. Hidden from SR because the
                    sr-only narrative below conveys the same info in readable form. */}
                <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-hidden="true">
                  {resetParams.map((p) => (
                    <li
                      key={p}
                      className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-background/80 px-1.5 py-0.5 text-[11px] font-mono"
                    >
                      <span className="text-warning font-semibold">{p}</span>
                      <span className="text-muted-foreground">— {PARAM_LABELS[p] ?? p}</span>
                    </li>
                  ))}
                </ul>
                {/* Visible disclosure for sighted users — same data the SR list below conveys.
                    Extracted to UrlSanitizerDisclosure so its focus/announcement
                    behavior is unit-testable in isolation. */}
                <UrlSanitizerDisclosure changes={resetChanges} paramLabels={PARAM_LABELS} />
                {/* Screen-reader-only itemized list: param label, original value, outcome. */}
                <ul className="sr-only">
                  {resetChanges.map((c, i) => {
                    const label = PARAM_LABELS[c.key] ?? c.key;
                    const from = c.from ? `"${c.from}"` : "(missing)";
                    return (
                      <li key={`${c.key}-${i}`}>
                        {c.to === "removed"
                          ? `${label} ${from} was invalid and removed.`
                          : `${label} ${from} was invalid and replaced with "${c.to}".`}
                      </li>
                    );
                  })}
                </ul>
                {resetLandingSr && <p className="sr-only">{resetLandingSr}</p>}
              </div>
              <div className="ml-2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={async () => {
                    const lines = [
                      `Dashboard URL sanitization report`,
                      `Time: ${new Date().toISOString()}`,
                      `URL: ${typeof window !== "undefined" ? window.location.href : ""}`,
                      ``,
                    ];
                    const removed = resetChanges.filter((c) => c.to === "removed");
                    const adjusted = resetChanges.filter((c) => c.to !== "removed");
                    if (removed.length) {
                      lines.push(`Invalid (removed):`);
                      removed.forEach((c) =>
                        lines.push(`  - ${c.key} = "${c.from}"  [${PARAM_LABELS[c.key] ?? c.key}]`),
                      );
                    }
                    if (adjusted.length) {
                      if (removed.length) lines.push(``);
                      lines.push(`Adjusted:`);
                      adjusted.forEach((c) =>
                        lines.push(
                          `  - ${c.key}: "${c.from}" -> "${c.to}"  [${PARAM_LABELS[c.key] ?? c.key}]`,
                        ),
                      );
                    }
                    if (resetLandingSr) lines.push(``, resetLandingSr);
                    const ok = await tryCopyToClipboard(lines.join("\n"));
                    if (ok) toast.success("Reset details copied to clipboard");
                    else toast.error("Couldn't copy to clipboard");
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-3 text-[11px] font-medium text-warning hover:bg-warning/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning"
                >
                  Copy reset details
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setResetParams([]);
                    setResetChanges([]);
                    setResetLandingSr("");
                  }}
                  aria-label="Dismiss invalid link parameters notice"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-warning hover:bg-warning/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </Alert>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DashboardBrief removed — its metrics are covered by the KPI grid
          below, and duplicating them here caused the "Overdue Amount"
          card (and siblings) to render twice on /dashboard. */}

      <DashboardHero
        userName={heroUserName}
        overdueCount={overdueRows.length}
        overdueValue={Number(overdueValue) || 0}
      />

      <Reveal amount={0.15}>
        <DashboardActiveProjectCard />
      </Reveal>

      <BuilderMetricsFeed />

      <Reveal amount={0.2} className="mb-4">
        <CashIntegrityBanner />
      </Reveal>

      <Reveal
        amount={0.2}
        as="section"
        className="rounded-2xl md:rounded-3xl border border-white/30 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-2xl p-4 md:p-5 mb-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-wrap items-center gap-3 transition-all duration-200 hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)]"
      >
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <CalendarRange className="h-4 w-4 text-primary" />
          Period:
        </div>
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={preset === p.key ? "default" : "outline"}
              className="min-h-[44px] lg:h-8 lg:min-h-0 text-xs"
              onClick={() => applyPreset(p.key)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <Input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPreset("custom");
            }}
            className="min-h-[44px] lg:h-8 lg:min-h-0 w-[150px] text-xs"
            aria-label="From date"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPreset("custom");
            }}
            className="min-h-[44px] lg:h-8 lg:min-h-0 w-[150px] text-xs"
            aria-label="To date"
          />
          {(from ||
            to ||
            projectFilter !== "all" ||
            unitFilter !== "all" ||
            clientFilter !== "all") && (
            <Button
              size="sm"
              variant="ghost"
              className="min-h-[44px] min-w-[44px] lg:h-8 lg:min-h-0 lg:min-w-0 px-2"
              onClick={clearFilter}
              title="Clear all filters"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="min-h-[44px] lg:h-8 lg:min-h-0 gap-1.5 text-xs font-medium"
                disabled={exporting !== null}
                title="Export current dashboard view"
                aria-label="Export dashboard"
              >
                {exporting !== null ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Current view · {rangeLabel}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={exportDashboardPdf} disabled={exporting !== null}>
                <FileText className="h-4 w-4 mr-2 text-destructive" />
                <div className="flex flex-col">
                  <span className="text-sm">Download as PDF</span>
                  <span className="text-[10px] text-muted-foreground">
                    Full visual snapshot · A4
                  </span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportDashboardCsv} disabled={exporting !== null}>
                <FileSpreadsheet className="h-4 w-4 mr-2 text-success" />
                <div className="flex flex-col">
                  <span className="text-sm">Download as CSV</span>
                  <span className="text-[10px] text-muted-foreground">KPIs + overdue clients</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Report options
              </DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={includeFormulaRef}
                onCheckedChange={(v) => setIncludeFormulaRef(Boolean(v))}
                onSelect={(e) => e.preventDefault()}
                aria-label="Include formula reference section in exports"
              >
                <div className="flex flex-col">
                  <span className="text-sm">Include formula reference</span>
                  <span className="text-[10px] text-muted-foreground">
                    Adds the Total Received formula to PDF footer & CSV section
                  </span>
                </div>
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="basis-full flex flex-wrap items-center gap-3 pt-2 mt-1 border-t border-border/40">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Filter className="h-4 w-4 text-accent" />
            Scope:
          </div>
          <Select
            value={projectFilter}
            onValueChange={(v) => {
              setProjectFilter(v);
              setUnitFilter("all");
              setClientFilter("all");
            }}
          >
            <SelectTrigger
              aria-label="Filter by project"
              className="min-h-[44px] lg:h-8 lg:min-h-0 w-[180px] text-xs"
            >
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projectOptions.map((p) => (
                <SelectItem key={p.code} value={p.code}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={unitFilter}
            onValueChange={(v) => {
              setUnitFilter(v);
              setClientFilter("all");
            }}
          >
            <SelectTrigger
              aria-label="Filter by unit"
              className="min-h-[44px] lg:h-8 lg:min-h-0 w-[160px] text-xs"
            >
              <SelectValue placeholder="Unit" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All units</SelectItem>
              {unitOptions.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger
              aria-label="Filter by client"
              className="min-h-[44px] lg:h-8 lg:min-h-0 w-[200px] text-xs"
            >
              <SelectValue placeholder="Client" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clientOptions.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="basis-full flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            Showing: <span className="font-medium text-foreground">{rangeLabel}</span>
            {projectFilter !== "all" && (
              <>
                {" "}
                · Project:{" "}
                <span className="font-medium text-foreground">
                  {projectOptions.find((p) => p.code === projectFilter)?.name ?? projectFilter}
                </span>
              </>
            )}
            {unitFilter !== "all" && (
              <>
                {" "}
                · Unit: <span className="font-medium text-foreground">{unitFilter}</span>
              </>
            )}
            {clientFilter !== "all" && (
              <>
                {" "}
                · Client: <span className="font-medium text-foreground">{clientFilter}</span>
              </>
            )}{" "}
            · Bookings by booking date, payments by payment date, ledger/overdue by due date.
          </span>
          {/* Live-updates health. Dot-only when connected; expands to a
              pill when reconnecting / offline so the user knows the KPIs
              below may be stale. Retry rebuilds the realtime channel
              without reloading the page. */}
          <RealtimeStatusIndicator
            status={realtimeStatus}
            onRetry={
              realtimeStatus === "error"
                ? () => {
                    qc.invalidateQueries({ queryKey: ["dashboard"] });
                    setSubscribeAttempt((n) => n + 1);
                  }
                : undefined
            }
            className="ml-auto"
          />
        </div>
      </Reveal>

      {/* ───────────────── KPI bento (iOS-luxury) ───────────────── */}
      <h2 className="sr-only">KPI Summary</h2>
      {filtered.bookings.length === 0 && settled ? (
        <div className="mb-6 rounded-3xl border border-dashed border-white/40 dark:border-white/10 bg-white/40 dark:bg-white/5 backdrop-blur-2xl p-8 md:p-12 text-center transition-all duration-300 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="mx-auto mb-3 grid h-10 w-10 md:h-12 md:w-12 place-items-center rounded-full bg-emerald-500/10 border border-emerald-500/20 shadow-sm">
            <Building2
              className="h-5 w-5 md:h-6 md:w-6 text-emerald-600 dark:text-emerald-400"
              aria-hidden
            />
          </div>
          <div className="text-sm md:text-base font-bold text-foreground tracking-tight">
            No KPIs yet
          </div>
          <p className="mx-auto mt-2 max-w-[260px] md:max-w-md text-xs md:text-sm text-muted-foreground leading-relaxed">
            Add your first booking to see cash, adjustments, and overdue metrics here.
          </p>
          <Link
            to="/bookings?new=1"
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-foreground text-background px-6 text-xs md:text-sm font-semibold shadow-[0_4px_14px_0_rgb(0,0,0,0.1)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.15)] hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            New Booking
          </Link>
        </div>
      ) : null}
      {filtered.bookings.length === 0 && !settled ? (
        <div
          role="status"
          aria-label="Loading KPIs"
          className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3 md:gap-4 mb-6"
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 rounded-2xl bg-muted/60 animate-pulse" />
          ))}
        </div>
      ) : null}
      <Reveal
        amount={0.15}
        className={`grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3 md:gap-4 mb-6 ${(filtered?.bookings ?? []).length === 0 ? "hidden" : ""}`}
      >
        {kpis.map((k, i) => {
          // per-tile accent: gold for hero metric, sage for positive cash, navy default, rust for overdue
          const accents = [
            { ring: "ring-gold/30", icon: "bg-gold/15 text-gold", dot: "bg-gold", bar: "bg-gold" }, // Sell Value
            { ring: "ring-sage/25", icon: "bg-sage/15 text-sage", dot: "bg-sage", bar: "bg-sage" }, // Cash Recovered
            {
              ring: "ring-adjustment/25",
              icon: "bg-adjustment/10 text-adjustment",
              dot: "bg-adjustment",
              bar: "bg-adjustment",
            }, // Adj Approved
            {
              ring: "ring-primary/20",
              icon: "bg-primary/10 text-primary",
              dot: "bg-primary",
              bar: "bg-primary",
            }, // Adj Realised
            { ring: "ring-sage/30", icon: "bg-sage/15 text-sage", dot: "bg-sage", bar: "bg-sage" }, // Total Received
            {
              ring: "ring-warning/30",
              icon: "bg-warning/15 text-warning",
              dot: "bg-warning",
              bar: "bg-warning",
            }, // Pending
            { ring: "ring-rust/30", icon: "bg-rust/15 text-rust", dot: "bg-rust", bar: "bg-rust" }, // Overdue
            {
              ring: "ring-destructive/30",
              icon: "bg-destructive/15 text-destructive",
              dot: "bg-destructive",
              bar: "bg-destructive",
            }, // Cancelled
          ][i] ?? {
            ring: "ring-border",
            icon: "bg-muted text-muted-foreground",
            dot: "bg-muted-foreground",
            bar: "bg-muted-foreground",
          };
          // soft progress relative to total sell value (anchor)
          const numeric = Number(String(k.val ?? 0).replace(/[^\d.-]/g, "")) || 0;
          const pct =
            totalSellValue > 0 ? Math.min(100, Math.round((numeric / totalSellValue) * 100)) : 0;
          const isHero = i === 0;
          // Defining formula for each monetary KPI, surfaced as a hover tooltip
          // (sighted users) and an aria-describedby sr-only span (AT/keyboard).
          // U+2212 MINUS, U+00B7 MIDDLE DOT — keep characters identical for the
          // tooltip regression test in src/pages/__tests__/total-received-tooltip.test.ts.
          const KPI_FORMULAS: Record<string, { short: string; spoken: string }> = {
            cash: {
              short: "Sum of cash / bank receipts (excludes adjustments)",
              spoken: "Sum of cash and bank receipts, excluding adjustments",
            },
            adj_realised: {
              short: "Sum of approved adjustments marked realised by the company",
              spoken: "Sum of approved adjustments marked realised by the company",
            },
            commission: {
              short: "Sum of dealer commission payouts",
              spoken: "Sum of dealer commission payouts",
            },
            received: {
              short: "Cash/Bank + Asset Realized − Commission Paid",
              spoken: "Cash/Bank plus Asset Realized minus Commission Paid",
            },
            pending: {
              short: "Active bookings unpaid balance (excludes cancelled balances)",
              spoken: "Active bookings unpaid balance, excluding cancelled balances",
            },
            cancelled: {
              short: "Total uncollected balance of cancelled bookings removed from pending",
              spoken: "Total uncollected balance of cancelled bookings removed from pending",
            },
          };
          const formula = KPI_FORMULAS[k.key];
          const formulaId = formula ? `kpi-${k.key}-formula` : undefined;

          return (
            <motion.button
              type="button"
              key={k.label}
              onClick={() => setDrillKey(k.key as any)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              whileHover={{ y: -2, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } }}
              whileTap={{ scale: 0.99, transition: { duration: 0.12, ease: [0.22, 1, 0.36, 1] } }}
              aria-label={`Open drill-down for ${k.label}`}
              aria-describedby={formulaId}
              className={`group relative overflow-hidden rounded-2xl md:rounded-3xl bg-white/60 dark:bg-white/5 backdrop-blur-2xl border border-white/40 dark:border-white/10 p-4 md:p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.05)] hover:shadow-[0_12px_32px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.6)] hover:border-primary/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] text-left cursor-pointer min-w-0 ${isHero ? "xl:col-span-2" : ""}`}
            >
              <div
                aria-hidden
                className={`pointer-events-none absolute -top-12 -right-10 h-32 w-32 rounded-full ${accents.dot} opacity-[0.08] blur-2xl group-hover:opacity-[0.16] transition-opacity duration-500`}
              />
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${accents.dot}`} aria-hidden />
                    <div className="text-[11px] md:text-[10px] text-muted-foreground font-semibold uppercase tracking-[0.14em] md:tracking-[0.18em] leading-tight truncate max-w-[120px]">
                      {k.label}
                    </div>
                    {formula && formulaId && (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              aria-hidden
                              className="inline-flex items-center justify-center text-muted-foreground group-hover:text-foreground transition-colors"
                            >
                              <Info className="h-3 w-3" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            className="max-w-[260px] text-xs font-medium tabular-nums leading-snug"
                          >
                            {formula.short}
                          </TooltipContent>
                        </Tooltip>
                        <span id={formulaId} className="sr-only">
                          Formula: {formula.spoken}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div
                  className={`shrink-0 hidden md:grid place-items-center h-9 w-9 rounded-full ${accents.icon} border border-white/20 dark:border-white/5 shadow-sm`}
                >
                  <k.icon className="h-4 w-4" />
                </div>
              </div>
              <div
                className="relative mt-2 md:mt-3 font-display font-semibold tabular-nums text-ink leading-[1.1] tracking-tight break-words text-[22px]"
                style={{
                  fontSize: undefined,
                }}
              >
                <span className="text-[11px] font-semibold text-muted-foreground mr-1.5 align-baseline">
                  PKR
                </span>
                <span
                  className={`md:inline ${isHero ? "md:text-[clamp(1.75rem,2.6vw,2.5rem)]" : "md:text-[clamp(1.25rem,1.8vw,1.75rem)]"}`}
                >
                  {k.val}
                </span>
              </div>
              <div className="relative mt-3 h-1.5 w-full rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ delay: 0.2 + i * 0.05, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                  className={`h-full ${accents.bar} rounded-full`}
                />
              </div>
              <div className="relative text-[11px] text-muted-foreground mt-2.5 leading-snug">
                {k.sub}
              </div>
            </motion.button>
          );
        })}
      </Reveal>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.15, margin: "-40px 0px" }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-2xl md:rounded-3xl bg-white/60 dark:bg-white/5 backdrop-blur-3xl border border-white/30 dark:border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.04)] overflow-hidden transition-all duration-300"
      >
        <div
          aria-hidden
          className="h-[2px] w-full bg-gradient-to-r from-rust/0 via-rust/60 to-rust/0"
        />
        <div className="flex items-center justify-between p-5 pb-3">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-2 font-display m-0">
              <span className="grid place-items-center h-7 w-7 rounded-full bg-rust/15 text-rust border border-rust/20 shadow-xs">
                <AlertTriangle className="h-3.5 w-3.5" />
              </span>
              Clients Requiring Immediate Action
            </h2>
            <div className="text-xs text-muted-foreground mt-0.5">
              HIGH = 3+ overdue installments · MEDIUM = 1–2 overdue · sorted by amount.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div
              role="tablist"
              aria-label="Table view"
              className="inline-flex items-center rounded-full bg-black/5 dark:bg-white/10 p-1 border border-border/30 backdrop-blur-md"
            >
              {(
                [
                  { id: "overdue", label: "Overdue" },
                  { id: "kpi", label: "KPI Details" },
                ] as const
              ).map((t) => {
                const active = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    role="tab"
                    type="button"
                    aria-selected={active}
                    onClick={() => {
                      if (t.id === "kpi") {
                        if (drillKey === null) setDrillKey("overdue");
                      } else {
                        setDrillKey(null);
                      }
                    }}
                    className={`px-3.5 min-h-[44px] lg:h-7 lg:min-h-0 text-[11px] font-semibold tracking-wide uppercase rounded-full transition-all duration-200 ${active ? "bg-white dark:bg-white/20 text-foreground shadow-sm ring-1 ring-border/50" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-[44px] lg:h-8 lg:min-h-0 text-xs"
                  title="Choose CSV columns"
                >
                  <Columns3 className="h-3.5 w-3.5 mr-1" /> Columns
                  <span className="ml-1 text-muted-foreground">
                    ({overdueCols.length}/{OVERDUE_COLS.length})
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-60 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold">CSV Columns</div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="text-[11px] text-primary hover:underline"
                      onClick={() => setOverdueCols(OVERDUE_COLS.map((c) => c.key))}
                    >
                      All
                    </button>
                    <span className="text-[11px] text-muted-foreground">·</span>
                    <button
                      type="button"
                      className="text-[11px] text-muted-foreground hover:underline"
                      onClick={() => setOverdueCols([])}
                    >
                      None
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {OVERDUE_COLS.map((c) => (
                    <label
                      key={c.key}
                      className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5"
                    >
                      <Checkbox
                        checked={overdueCols.includes(c.key)}
                        onCheckedChange={() => toggleOverdueCol(c.key)}
                      />
                      <span>{c.label}</span>
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Button
              size="sm"
              variant="outline"
              className="min-h-[44px] lg:h-8 lg:min-h-0 text-xs"
              onClick={() => {
                setTplDraft(waTemplate);
                setTplOpen(true);
              }}
              title="Edit WhatsApp message template"
            >
              <Settings2 className="h-3.5 w-3.5 mr-1" /> Template
            </Button>
            {(() => {
              const overdueCsvInput = () => {
                const picked = overdueCols
                  .map((k) => OVERDUE_COLS.find((c) => c.key === k))
                  .filter((c): c is (typeof OVERDUE_COLS)[number] => Boolean(c));
                return {
                  source: "Overdue Clients",
                  filters: { ...activeFilters(), Risk: riskFilter, Age: ageFilter },
                  sort: { key: overdueSort.key, dir: overdueSort.dir },
                  page: {
                    page: overduePageSafe,
                    totalPages: overdueTotalPages,
                    pageSize: overduePageSize,
                  },
                  counts: {
                    shown: pagedOverdueClients.length,
                    filtered: overdueClients.length,
                    total: overdueAll.length,
                  },
                  columns: picked.map((c) => ({ key: c.key, label: c.label })),
                };
              };
              return (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-[44px] lg:h-8 lg:min-h-0 text-xs"
                    onClick={() =>
                      requestCsvExport({
                        label: "the Overdue Clients CSV",
                        input: overdueCsvInput,
                        onConfirm: exportOverdueCsv,
                      })
                    }
                    disabled={overdueClients.length === 0 || overdueCols.length === 0}
                  >
                    <Download className="h-3.5 w-3.5 mr-1" /> CSV
                  </Button>
                  <CsvExportMetadataPreview
                    label="the Overdue Clients CSV"
                    input={overdueCsvInput}
                  />
                </>
              );
            })()}

            <Link
              to="/bookings"
              className="text-xs text-primary hover:underline inline-flex items-center gap-1 min-h-[44px] lg:min-h-0"
            >
              View all bookings <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
        <div className="px-5 pb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <FilterChipGroup
            label="Risk"
            value={riskFilter}
            onChange={(v) => setRiskFilter(v as any)}
            options={[
              { key: "ALL", label: "All", count: riskCounts.ALL },
              { key: "HIGH", label: "High", count: riskCounts.HIGH, tone: "destructive" },
              { key: "MEDIUM", label: "Medium", count: riskCounts.MEDIUM, tone: "warning" },
            ]}
          />
          <FilterChipGroup
            label="Overdue age"
            value={ageFilter}
            onChange={(v) => setAgeFilter(v as any)}
            options={[
              { key: "ALL", label: "All", count: ageCounts.ALL },
              { key: "1-30", label: "1–30d", count: ageCounts["1-30"] },
              { key: "31-60", label: "31–60d", count: ageCounts["31-60"] },
              { key: "61-90", label: "61–90d", count: ageCounts["61-90"], tone: "warning" },
              { key: "90+", label: "90d+", count: ageCounts["90+"], tone: "destructive" },
            ]}
          />
          <div className="flex items-center gap-1.5">
            <label
              htmlFor="overdue-search"
              className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold"
            >
              Search
            </label>
            <div className="relative">
              <input
                id="overdue-search"
                type="search"
                value={overdueQuery}
                onChange={(e) => {
                  setOverdueQuery(e.target.value.slice(0, 128));
                  setOverduePage(1);
                }}
                placeholder="Client, unit, booking…"
                aria-label="Search overdue clients by name, unit, booking, or project"
                className="min-h-11 lg:h-7 lg:min-h-0 w-full sm:w-48 rounded-md bg-muted/60 ring-1 ring-border px-2.5 pr-7 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              {overdueQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setOverdueQuery("");
                    setOverduePage(1);
                  }}
                  aria-label="Clear overdue search"
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-background/60"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          <AnimatePresence>
            {(riskFilter !== "ALL" || ageFilter !== "ALL") && (
              <motion.button
                key="clear"
                type="button"
                initial={{ opacity: 0, x: -6, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -6, scale: 0.95 }}
                transition={{ type: "spring", stiffness: 380, damping: 26 }}
                onClick={() => {
                  setRiskFilter("ALL");
                  setAgeFilter("ALL");
                  setOverduePage(1);
                  try {
                    localStorage.setItem("dash.overdue.risk", "ALL");
                    localStorage.setItem("dash.overdue.age", "ALL");
                    localStorage.setItem("dash.overdue.page", "1");
                  } catch (err) {
                    console.error("[localStorage] write error", err);
                  }
                  toast.success("Filters cleared");
                }}
                aria-label="Clear risk and overdue age filters"
                title="Reset Risk and Overdue Age to defaults"
                className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 hover:bg-muted px-2.5 py-1 text-xs font-medium ring-1 ring-border transition-colors"
              >
                <X className="h-3.5 w-3.5" />
                Clear filters
              </motion.button>
            )}
          </AnimatePresence>
          <button
            type="button"
            onClick={async () => {
              let link = "";
              try {
                const url = new URL(window.location.href);
                url.searchParams.delete("risk");
                url.searchParams.delete("age");
                url.searchParams.delete("preset");
                if (riskFilter !== "ALL") url.searchParams.set("risk", riskFilter);
                if (ageFilter !== "ALL") url.searchParams.set("age", ageFilter);
                if (activePresetName) url.searchParams.set("preset", activePresetName);
                link = url.toString();
              } catch {
                toast.error("Could not build share link");
                return;
              }
              const desc = activePresetName
                ? `preset="${activePresetName}" · risk=${riskFilter} · age=${ageFilter}`
                : `risk=${riskFilter} · age=${ageFilter}`;
              const ok = await tryCopyToClipboard(link);
              if (ok) {
                toast.success("Shareable link copied", { description: desc });
              } else {
                setShareFallback({
                  open: true,
                  link,
                  desc: "Clipboard access was blocked. Select the link and copy it manually.",
                });
              }
            }}
            aria-label="Copy shareable link with current Risk and Overdue Age filters"
            title="Copy shareable link with current filters"
            className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 hover:bg-muted px-2.5 min-h-11 lg:min-h-0 py-2 lg:py-1 text-xs font-medium ring-1 ring-border transition-colors"
          >
            <Link2 className="h-3.5 w-3.5" />
            Share link
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Filter presets"
                title="Save and switch between named filter presets"
                className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 hover:bg-muted px-2.5 min-h-11 lg:min-h-0 py-2 lg:py-1 text-xs font-medium ring-1 ring-border transition-colors"
              >
                <Bookmark className="h-3.5 w-3.5" />
                Presets
                {filterPresets.length > 0 && (
                  <span className="text-muted-foreground">· {filterPresets.length}</span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Saved presets
              </DropdownMenuLabel>
              {filterPresets.length === 0 ? (
                <div className="px-2 py-2 text-xs text-muted-foreground">No presets yet.</div>
              ) : (
                filterPresets.map((p) => {
                  const active = p.risk === riskFilter && p.age === ageFilter;
                  return (
                    <div key={p.name} className="flex items-center gap-1 pr-1">
                      <DropdownMenuItem
                        onClick={() => applyFilterPreset(p)}
                        className="flex-1 cursor-pointer"
                      >
                        <div className="flex flex-col">
                          <span className={`text-xs font-medium ${active ? "text-primary" : ""}`}>
                            {p.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            Risk {p.risk} · Age {p.age}
                          </span>
                        </div>
                      </DropdownMenuItem>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          renameFilterPreset(p.name);
                        }}
                        aria-label={`Rename preset ${p.name}`}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-primary"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deleteFilterPreset(p.name);
                        }}
                        aria-label={`Delete preset ${p.name}`}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={saveCurrentFilterPreset} className="cursor-pointer">
                <Plus className="h-3.5 w-3.5 mr-2" />
                <span className="text-xs">Save current as preset…</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setRiskFilter("ALL");
                  setAgeFilter("ALL");
                  try {
                    localStorage.removeItem(LAST_PRESET_KEY);
                  } catch (err) {
                    console.error("[localStorage] write error", err);
                  }
                  toast.success("Preset reset — back to defaults (Risk: ALL · Age: ALL)");
                }}
                className="cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-2" />
                <span className="text-xs">Reset preset (defaults)</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={clearAllFilterPresets}
                className="cursor-pointer text-destructive focus:text-destructive"
                disabled={filterPresets.length === 0}
              >
                <X className="h-3.5 w-3.5 mr-2" />
                <span className="text-xs">Clear all presets</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            onClick={resetTableView}
            aria-label="Reset table view: clear saved sorting and pagination for Overdue and KPI tables"
            title="Clear saved sorting and pagination (Overdue + KPI) and restore defaults"
            className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 hover:bg-muted px-2.5 min-h-11 lg:min-h-0 py-2 lg:py-1 text-xs font-medium ring-1 ring-border transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset table view
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Saved table view presets for Overdue and KPI tables"
                title="Saved table views (sort, page, pageSize)"
                className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 hover:bg-muted px-2.5 min-h-11 lg:min-h-0 py-2 lg:py-1 text-xs font-medium ring-1 ring-border transition-colors"
              >
                <Bookmark className="h-3.5 w-3.5" />
                Table views
                {tableViews.length > 0 && (
                  <span className="ml-1 rounded bg-background/60 px-1 text-[10px] tabular-nums ring-1 ring-border">
                    {tableViews.length}
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Overdue views
              </DropdownMenuLabel>
              {tableViews.filter((v) => v.scope === "overdue").length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No saved Overdue views.
                </div>
              ) : (
                tableViews
                  .filter((v) => v.scope === "overdue")
                  .map((v) => (
                    <div key={`o-${v.name}`} className="flex items-center gap-1 pr-1">
                      <DropdownMenuItem
                        onClick={() => applyTableView(v)}
                        className="flex-1 cursor-pointer"
                      >
                        <div className="flex flex-col">
                          <span className="text-xs font-medium">{v.name}</span>
                          <span className="text-[10px] text-muted-foreground">
                            sort {(v as OverdueViewPreset).sort.key}.
                            {(v as OverdueViewPreset).sort.dir} · size{" "}
                            {(v as OverdueViewPreset).pageSize} · pg {(v as OverdueViewPreset).page}
                          </span>
                        </div>
                      </DropdownMenuItem>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deleteTableView("overdue", v.name);
                        }}
                        aria-label={`Delete view ${v.name}`}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
              )}
              <DropdownMenuItem onClick={saveOverdueView} className="cursor-pointer">
                <Plus className="h-3.5 w-3.5 mr-2" />
                <span className="text-xs">Save current Overdue view…</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                KPI views
              </DropdownMenuLabel>
              {tableViews.filter((v) => v.scope === "kpi").length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">No saved KPI views.</div>
              ) : (
                tableViews
                  .filter((v) => v.scope === "kpi")
                  .map((v) => (
                    <div key={`k-${v.name}`} className="flex items-center gap-1 pr-1">
                      <DropdownMenuItem
                        onClick={() => applyTableView(v)}
                        className="flex-1 cursor-pointer"
                      >
                        <div className="flex flex-col">
                          <span className="text-xs font-medium">{v.name}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {(v as KpiViewPreset).kpiKey} ·{" "}
                            {(v as KpiViewPreset).sort
                              ? `sort ${(v as KpiViewPreset).sort!.idx}.${(v as KpiViewPreset).sort!.dir}`
                              : "no sort"}{" "}
                            · size {(v as KpiViewPreset).pageSize} · pg {(v as KpiViewPreset).page}
                          </span>
                        </div>
                      </DropdownMenuItem>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deleteTableView("kpi", v.name);
                        }}
                        aria-label={`Delete view ${v.name}`}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
              )}
              <DropdownMenuItem
                onClick={saveKpiView}
                className="cursor-pointer"
                disabled={!drillKey}
              >
                <Plus className="h-3.5 w-3.5 mr-2" />
                <span className="text-xs">Save current KPI view…</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="ml-auto text-xs text-muted-foreground tabular-nums">
            {overdueClients.length === 0 ? (
              <>
                Showing <span className="font-semibold text-foreground">0</span> of{" "}
                {overdueAll.length}
              </>
            ) : (
              <>
                Showing{" "}
                <span className="font-semibold text-foreground">
                  {overduePageStart + 1}–{overduePageEnd}
                </span>{" "}
                of {overdueClients.length}
                {overdueClients.length !== overdueAll.length && (
                  <span className="text-muted-foreground">
                    {" "}
                    (filtered from {overdueAll.length})
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        {/* Mobile-only card list (replaces table on <md screens) */}
        <div className="md:hidden divide-y divide-border">
          {overdueClients.length === 0 ? (
            settled ? (
              <div className="p-6 text-center">
                <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-success/10">
                  <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
                </div>
                <div className="text-sm font-semibold text-foreground">No overdue clients</div>
                <p className="mx-auto mt-1 max-w-[240px] text-xs text-muted-foreground leading-snug">
                  Every client is current on their payment plan.
                </p>
              </div>
            ) : (
              <div role="status" aria-label="Loading overdue clients" className="p-4 space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-20 rounded-xl bg-muted/60 animate-pulse" />
                ))}
              </div>
            )
          ) : (
            pagedOverdueClients.map((b: any) => {
              const hasPhone = !!toWaPhone(b.mobile);
              const isHigh = b._risk === "HIGH";
              return (
                <div key={b.booking_id} className="p-4 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to={`/bookings/${b.booking_id}`}
                      className="font-semibold text-[15px] leading-tight capitalize truncate"
                    >
                      {b.client_name}
                    </Link>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${isHigh ? "bg-destructive/10 text-destructive ring-destructive/30" : "bg-warning/10 text-warning ring-warning/30"}`}
                    >
                      {b._risk}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-mono">Unit {b.unit_id}</span>
                    <span className="tabular-nums">{b._ov} overdue</span>
                  </div>
                  <div className="text-destructive font-bold text-[17px] tabular-nums">
                    {fmtPKR(b._amt)}
                  </div>
                  <div className="text-[12px] text-muted-foreground leading-snug">
                    Next action:{" "}
                    {isHigh
                      ? "Call client today and issue reminder."
                      : "Send reminder within 48 hours."}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    {hasPhone ? (
                      <button
                        type="button"
                        onClick={() => openWa(b)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-success/10 text-success ring-1 ring-success/30 px-3 min-h-11 text-xs font-semibold"
                      >
                        <MessageCircle className="h-4 w-4" /> WhatsApp
                      </button>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">No phone on file</span>
                    )}
                    <Link
                      to={`/bookings/${b.booking_id}`}
                      className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary/10 text-primary ring-1 ring-primary/30 px-3 min-h-11 text-xs font-semibold"
                    >
                      <Eye className="h-4 w-4" /> View
                    </Link>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="hidden md:block overflow-x-auto">
          <motion.div layout transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  {(
                    [
                      {
                        k: "client_name" as const,
                        label: "Client Name",
                        align: "left",
                        px: "px-5",
                      },
                      { k: "unit_id" as const, label: "Unit", align: "left", px: "px-3" },
                      {
                        k: "_ov" as const,
                        label: "Overdue Installments",
                        align: "right",
                        px: "px-3",
                      },
                      {
                        k: "_amt" as const,
                        label: "Overdue Amount (PKR)",
                        align: "right",
                        px: "px-3",
                      },
                      { k: "_risk" as const, label: "Risk Level", align: "left", px: "px-3" },
                    ] as { k: OverdueSortKey; label: string; align: "left" | "right"; px: string }[]
                  ).map((c) => {
                    const active = overdueSort.key === c.k;
                    const arrow = active ? (overdueSort.dir === "asc" ? "▲" : "▼") : "";
                    return (
                      <th
                        key={c.k}
                        scope="col"
                        aria-sort={
                          active ? (overdueSort.dir === "asc" ? "ascending" : "descending") : "none"
                        }
                        className={`${c.align === "right" ? "text-right" : "text-left"} font-medium ${c.px} py-2.5`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleOverdueSort(c.k)}
                          aria-label={`Sort by ${c.label}${active ? (overdueSort.dir === "asc" ? " (ascending)" : " (descending)") : ""}`}
                          className={`inline-flex items-center gap-1 min-h-11 lg:min-h-0 hover:text-foreground transition-colors ${active ? "text-foreground" : ""} ${c.align === "right" ? "flex-row-reverse" : ""}`}
                        >
                          <span>{c.label}</span>
                          <span aria-hidden className="text-[10px] tabular-nums w-2 inline-block">
                            {arrow}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                  <th className="text-left font-medium px-3 py-2.5">WhatsApp</th>
                  <th className="text-left font-medium px-5 py-2.5">View</th>
                </tr>
              </thead>
              <tbody>
                {overdueClients.length === 0 ? (
                  settled ? (
                    <tr>
                      <td colSpan={7} className="p-0">
                        <EmptyState
                          icon={CheckCircle2}
                          title="No overdue clients"
                          description="Every client is current on their payment plan. Nice work."
                        />
                      </td>
                    </tr>
                  ) : (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={`overdue-skel-${i}`} aria-hidden="true">
                        {Array.from({ length: 7 }).map((__, j) => (
                          <td key={j} className="px-3 py-3">
                            <div className="h-4 rounded bg-muted/60 animate-pulse" />
                          </td>
                        ))}
                      </tr>
                    ))
                  )
                ) : (
                  <AnimatePresence initial={false}>
                    {pagedOverdueClients.map((b: any, i: number) => {
                      const isHigh = b._risk === "HIGH";
                      const hasPhone = !!toWaPhone(b.mobile);
                      const isOpen = expandedId === b.booking_id;
                      return (
                        <Fragment key={b.booking_id}>
                          <motion.tr
                            layout
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{
                              duration: 0.28,
                              delay: Math.min(i * 0.02, 0.2),
                              ease: [0.22, 1, 0.36, 1],
                            }}
                            whileHover={{ scale: 1.003 }}
                            onClick={() => setExpandedId(isOpen ? null : b.booking_id)}
                            className={`group relative border-t cursor-pointer transition-all duration-300 ease-out
                          ${isOpen ? "bg-muted/30" : ""}
                          hover:bg-gradient-to-r ${isHigh ? "hover:from-destructive/[0.06] hover:to-transparent" : "hover:from-warning/[0.06] hover:to-transparent"}
                          hover:shadow-[inset_3px_0_0_0_var(--tw-shadow-color)] ${isHigh ? "hover:shadow-destructive/60" : "hover:shadow-warning/60"}`}
                          >
                            <td className="px-5 py-2.5 capitalize font-medium">
                              <span className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedId(isOpen ? null : b.booking_id);
                                  }}
                                  aria-expanded={isOpen}
                                  aria-controls={`overdue-drawer-${b.booking_id}`}
                                  aria-label={
                                    isOpen
                                      ? `Collapse details for ${b.client_name}`
                                      : `Expand details for ${b.client_name}`
                                  }
                                  className="inline-flex min-h-11 min-w-11 lg:h-5 lg:w-5 lg:min-h-0 lg:min-w-0 items-center justify-center rounded text-muted-foreground group-hover:text-foreground group-hover:bg-muted/60 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                                >
                                  <motion.span
                                    animate={{ rotate: isOpen ? 90 : 0 }}
                                    transition={{ type: "spring", stiffness: 400, damping: 26 }}
                                    aria-hidden
                                    className="inline-flex"
                                  >
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  </motion.span>
                                </button>
                                <Link
                                  to={`/bookings/${b.booking_id}`}
                                  onClick={(e: any) => e.stopPropagation()}
                                  className="relative inline-block transition-colors duration-200 group-hover:text-primary after:content-[''] after:absolute after:left-0 after:-bottom-0.5 after:h-px after:w-full after:bg-primary after:scale-x-0 after:origin-left after:transition-transform after:duration-300 group-hover:after:scale-x-100"
                                >
                                  {b.client_name}
                                </Link>
                              </span>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-xs transition-colors duration-200 group-hover:text-foreground">
                              {b.unit_id}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                              <motion.span
                                key={`ov-${b._ov}`}
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.25 }}
                                className="inline-block"
                              >
                                {b._ov}
                              </motion.span>
                            </td>
                            <td
                              className={`px-3 py-2.5 text-right tabular-nums font-semibold transition-colors duration-300 ${isHigh ? "text-destructive" : "text-warning"}`}
                            >
                              <motion.span
                                key={`amt-${b._amt}`}
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.25 }}
                                className="inline-block"
                              >
                                {fmtPKR(b._amt)}
                              </motion.span>
                            </td>
                            <td className="px-3 py-2.5">
                              <AnimatePresence mode="wait" initial={false}>
                                <motion.span
                                  key={b._risk}
                                  layout
                                  initial={{ opacity: 0, scale: 0.85, y: -2 }}
                                  animate={{ opacity: 1, scale: 1, y: 0 }}
                                  exit={{ opacity: 0, scale: 0.85, y: 2 }}
                                  transition={{ type: "spring", stiffness: 380, damping: 26 }}
                                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 transition-all duration-300 group-hover:ring-2 ${
                                    isHigh
                                      ? "bg-destructive/10 text-destructive ring-destructive/30 group-hover:bg-destructive/15 group-hover:shadow-[0_0_0_4px_hsl(var(--destructive)/0.08)]"
                                      : "bg-warning/10 text-warning ring-warning/30 group-hover:bg-warning/15 group-hover:shadow-[0_0_0_4px_hsl(var(--warning)/0.08)]"
                                  }`}
                                >
                                  <motion.span
                                    className={`h-1.5 w-1.5 rounded-full ${isHigh ? "bg-destructive" : "bg-warning"}`}
                                    animate={
                                      isHigh
                                        ? { scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }
                                        : { scale: 1, opacity: 1 }
                                    }
                                    transition={
                                      isHigh
                                        ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" }
                                        : { duration: 0.2 }
                                    }
                                  />
                                  {b._risk}
                                </motion.span>
                              </AnimatePresence>
                            </td>
                            <td className="px-3 py-2.5">
                              {hasPhone ? (
                                <motion.button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openWa(b);
                                  }}
                                  whileHover={{ scale: 1.05, y: -1 }}
                                  whileTap={{ scale: 0.96 }}
                                  transition={{ type: "spring", stiffness: 420, damping: 22 }}
                                  className="inline-flex items-center gap-1.5 rounded-md bg-success/10 text-success ring-1 ring-success/30 hover:bg-success/20 hover:shadow-md hover:shadow-success/20 px-2.5 py-1 text-xs font-medium transition-colors duration-200"
                                  title={`Send WhatsApp to ${b.mobile}`}
                                >
                                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                                </motion.button>
                              ) : (
                                <span className="text-xs text-muted-foreground">No phone</span>
                              )}
                            </td>
                            <td className="px-5 py-2.5">
                              <Link
                                to={`/bookings/${b.booking_id}`}
                                onClick={(e: any) => e.stopPropagation()}
                                className="group/btn inline-flex items-center gap-1.5 rounded-md bg-primary/10 text-primary ring-1 ring-primary/30 hover:bg-primary/20 hover:shadow-md hover:shadow-primary/20 px-2.5 py-1 text-xs font-medium transition-all duration-200 hover:-translate-y-px"
                              >
                                <Eye className="h-3.5 w-3.5 transition-transform duration-200 group-hover/btn:scale-110" />{" "}
                                View
                              </Link>
                            </td>
                          </motion.tr>
                          <AnimatePresence initial={false}>
                            {isOpen && (
                              <motion.tr
                                key={`${b.booking_id}-drawer`}
                                id={`overdue-drawer-${b.booking_id}`}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.18 }}
                                className="border-t bg-muted/10"
                              >
                                <td colSpan={7} className="p-0">
                                  <OverdueRowDrawer
                                    booking={b}
                                    payments={filtered.payments}
                                    ledger={filtered.ledger}
                                    adjustments={filtered.adjustments}
                                    fmtPKR={fmtPKR}
                                    fmtDate={fmtDate}
                                  />
                                </td>
                              </motion.tr>
                            )}
                          </AnimatePresence>
                        </Fragment>
                      );
                    })}
                  </AnimatePresence>
                )}
              </tbody>
            </table>
          </motion.div>
        </div>
        {overdueClients.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t bg-muted/20 text-xs">
            <div className="flex items-center gap-2">
              <label htmlFor="overdue-page-size" className="text-muted-foreground">
                Rows per page
              </label>
              <select
                id="overdue-page-size"
                value={overduePageSize}
                onChange={(e) => {
                  setOverduePageSize(Number(e.target.value));
                  setOverduePage(1);
                }}
                className="rounded-md border bg-background px-2 py-1 text-xs ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {OVERDUE_PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setOverduePage(1)}
                disabled={overduePageSafe === 1}
                className="px-2 py-1 rounded ring-1 ring-border bg-background hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
              >
                « First
              </button>
              <button
                type="button"
                onClick={() => setOverduePage((p) => Math.max(1, p - 1))}
                disabled={overduePageSafe === 1}
                className="px-2 py-1 rounded ring-1 ring-border bg-background hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ‹ Prev
              </button>
              <span className="px-2 tabular-nums text-muted-foreground">
                Page <span className="font-semibold text-foreground">{overduePageSafe}</span> of{" "}
                {overdueTotalPages}
              </span>
              <button
                type="button"
                onClick={() => setOverduePage((p) => Math.min(overdueTotalPages, p + 1))}
                disabled={overduePageSafe === overdueTotalPages}
                className="px-2 py-1 rounded ring-1 ring-border bg-background hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next ›
              </button>
              <button
                type="button"
                onClick={() => setOverduePage(overdueTotalPages)}
                disabled={overduePageSafe === overdueTotalPages}
                className="px-2 py-1 rounded ring-1 ring-border bg-background hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Last »
              </button>
            </div>
          </div>
        )}
      </motion.div>

      <h2 className="sr-only">Unit Inventory Status</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
        {Object.entries(unitStatus).map(([k, v]) => (
          <div key={k} className="card-elevated p-4">
            <div className="text-xs text-muted-foreground">Units · {k}</div>
            <div className="text-xl font-semibold mt-1">{v as number}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 text-right text-[11px] text-muted-foreground">
        Last updated: {fmtDate(new Date())} ·{" "}
        {new Date().toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}
      </div>

      {/* Per-message WhatsApp preview/edit */}
      <Dialog open={waOpen} onOpenChange={setWaOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Send WhatsApp reminder</DialogTitle>
            <DialogDescription>
              {waTarget ? (
                <>
                  To <span className="font-medium text-foreground capitalize">{waTarget.name}</span>{" "}
                  · Unit <span className="font-mono">{waTarget.unit}</span> ·{" "}
                  {waTarget.phone ? `+${waTarget.phone}` : "no phone"}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Message</label>
            <Textarea
              value={waMessage}
              onChange={(e) => setWaMessage(e.target.value)}
              rows={10}
              className="font-mono text-xs"
            />
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => waTarget && setWaMessage(renderTemplate(waTemplate, waTarget))}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" /> Reset from template
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!waTarget) return;
                  try {
                    toast.message("Drafting with AI…");
                    const text = await aiDraftMessage(aiSnapshot, {
                      name: waTarget.name,
                      unit: waTarget.unit,
                      installments: Number(waTarget.overdue_count) || 0,
                      amount: Number(String(waTarget.amount).replace(/[^\d.-]/g, "")) || 0,
                    });
                    if (text) setWaMessage(text);
                  } catch (e: any) {
                    toast.error(e?.message ?? "AI draft failed");
                  }
                }}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Sparkles className="h-3 w-3" /> Draft with AI
              </button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setWaOpen(false)}>
              Cancel
            </Button>
            <Button onClick={sendWa} disabled={!waTarget?.phone || !waMessage.trim()}>
              <MessageCircle className="h-4 w-4 mr-1.5" /> Open WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Default template editor */}
      <Dialog open={tplOpen} onOpenChange={setTplOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>WhatsApp message template</DialogTitle>
            <DialogDescription>
              Saved locally on this device. Available placeholders:{" "}
              <code className="text-foreground">{"{name}"}</code>,{" "}
              <code className="text-foreground">{"{unit}"}</code>,{" "}
              <code className="text-foreground">{"{overdue_count}"}</code>,{" "}
              <code className="text-foreground">{"{amount}"}</code>.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={tplDraft}
            onChange={(e) => setTplDraft(e.target.value)}
            rows={12}
            className="font-mono text-xs"
          />
          <DialogFooter className="flex sm:justify-between gap-2">
            <Button
              variant="ghost"
              onClick={() => setTplDraft(DEFAULT_WA_TEMPLATE)}
              className="text-xs"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restore default
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setTplOpen(false)}>
                Cancel
              </Button>
              <Button onClick={saveTemplate}>Save template</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <KpiDrillDown
        open={drillKey !== null}
        kpiKey={drillKey}
        onClose={() => {
          setDrillKey(null);
          if (typeof window !== "undefined") {
            try {
              const url = new URL(window.location.href);
              url.searchParams.delete("kpi");
              url.searchParams.delete("ksort");
              url.searchParams.delete("ksize");
              url.searchParams.delete("kpage");
              url.searchParams.delete("kexp");
              url.searchParams.delete("kq");
              url.searchParams.set("tab", "overdue");
              window.history.replaceState(
                null,
                "",
                url.pathname + (url.search ? url.search : "") + url.hash,
              );
            } catch (err) {
              console.error("[localStorage] write error", err);
            }
          }
        }}
        data={filtered}
        overdueRows={overdueRows}
        kpis={kpis as any}
      />

      <ShareFallbackDialog
        open={shareFallback.open}
        link={shareFallback.link}
        description={shareFallback.desc}
        onOpenChange={(o) => setShareFallback((s) => ({ ...s, open: o }))}
      />
      {csvConfirmDialog}
    </div>
  );
}

type DrillKey =
  | "sell"
  | "cash"
  | "adj_approved"
  | "adj_realised"
  | "commission"
  | "received"
  | "pending"
  | "overdue"
  | "cancelled";

function KpiDrillDown({
  open,
  kpiKey,
  onClose,
  data,
  overdueRows,
  kpis,
}: {
  open: boolean;
  kpiKey: DrillKey | null;
  onClose: () => void;
  data: { bookings: any[]; payments: any[]; adjustments: any[] };
  overdueRows: any[];
  kpis: { key: DrillKey; label: string; val: string; sub: string }[];
}) {
  const meta = kpis.find((k) => k.key === kpiKey);
  const [shareFallback, setShareFallback] = useState<{
    open: boolean;
    link: string | null;
    desc?: string;
  }>({ open: false, link: null });

  const KPI_PAGE_SIZES = [10, 25, 50, 100] as const;
  const [pageSize, setPageSize] = useState<number>(() => {
    if (typeof window === "undefined") return 25;
    const urlV = Number(new URLSearchParams(window.location.search).get("ksize"));
    if ((KPI_PAGE_SIZES as readonly number[]).includes(urlV)) return urlV;
    const v = Number(localStorage.getItem("dash.kpi.pageSize"));
    return (KPI_PAGE_SIZES as readonly number[]).includes(v) ? v : 25;
  });
  const [page, setPage] = useState<number>(() => {
    if (typeof window === "undefined" || !kpiKey) return 1;
    const urlV = Number(new URLSearchParams(window.location.search).get("kpage"));
    if (Number.isFinite(urlV) && urlV > 0) return urlV;
    const v = Number(localStorage.getItem(`dash.kpi.page.${kpiKey}`));
    return Number.isFinite(v) && v > 0 ? v : 1;
  });
  useEffect(() => {
    try {
      localStorage.setItem("dash.kpi.pageSize", String(pageSize));
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
  }, [pageSize]);
  useEffect(() => {
    if (!kpiKey) return;
    try {
      const urlV = Number(new URLSearchParams(window.location.search).get("kpage"));
      if (Number.isFinite(urlV) && urlV > 0) {
        setPage(urlV);
        return;
      }
      const v = Number(localStorage.getItem(`dash.kpi.page.${kpiKey}`));
      setPage(Number.isFinite(v) && v > 0 ? v : 1);
    } catch {
      setPage(1);
    }
  }, [kpiKey]);
  useEffect(() => {
    if (kpiKey) {
      try {
        localStorage.setItem(`dash.kpi.page.${kpiKey}`, String(page));
      } catch (err) {
        console.error("[localStorage] write error", err);
      }
    }
  }, [page, kpiKey]);

  const [sort, setSort] = useState<{ idx: number; dir: "asc" | "desc" } | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = new URLSearchParams(window.location.search).get("ksort");
    if (raw) {
      const [iStr, d] = raw.split(".");
      const idx = Number(iStr);
      if (Number.isFinite(idx) && (d === "asc" || d === "desc")) return { idx, dir: d };
    }
    return null;
  });
  useEffect(() => {
    if (!kpiKey) {
      setSort(null);
      return;
    }
    try {
      const urlRaw = new URLSearchParams(window.location.search).get("ksort");
      if (urlRaw) {
        const [iStr, d] = urlRaw.split(".");
        const idx = Number(iStr);
        if (Number.isFinite(idx) && (d === "asc" || d === "desc")) {
          setSort({ idx, dir: d });
          return;
        }
      }
      const raw = localStorage.getItem(`dash.kpi.sort.${kpiKey}`);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && Number.isFinite(p.idx) && (p.dir === "asc" || p.dir === "desc")) {
          setSort(p);
          return;
        }
      }
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
    setSort(null);
  }, [kpiKey]);
  useEffect(() => {
    if (!kpiKey) return;
    try {
      if (sort) localStorage.setItem(`dash.kpi.sort.${kpiKey}`, JSON.stringify(sort));
      else localStorage.removeItem(`dash.kpi.sort.${kpiKey}`);
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
  }, [sort, kpiKey]);
  // Per-KPI free-text search — persisted in URL (kq) + localStorage
  const [query, setQuery] = useState<string>("");
  useEffect(() => {
    if (!kpiKey) {
      setQuery("");
      return;
    }
    try {
      const urlV = new URLSearchParams(window.location.search).get("kq");
      if (urlV != null) {
        setQuery(urlV.slice(0, 128));
        return;
      }
      const v = localStorage.getItem(`dash.kpi.query.${kpiKey}`) || "";
      setQuery(v.slice(0, 128));
    } catch {
      setQuery("");
    }
  }, [kpiKey]);
  useEffect(() => {
    if (!kpiKey) return;
    try {
      if (query) localStorage.setItem(`dash.kpi.query.${kpiKey}`, query);
      else localStorage.removeItem(`dash.kpi.query.${kpiKey}`);
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
  }, [query, kpiKey]);
  // Reflect KPI sort/pagination/search in the URL (cleared when the drill-down closes)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      const set = (k: string, v: string | null) => {
        if (v == null || v === "") url.searchParams.delete(k);
        else url.searchParams.set(k, v);
      };
      if (!kpiKey) {
        set("ksort", null);
        set("ksize", null);
        set("kpage", null);
        set("kq", null);
      } else {
        set("ksort", sort ? `${sort.idx}.${sort.dir}` : null);
        set("ksize", pageSize === 25 ? null : String(pageSize));
        set("kpage", page === 1 ? null : String(page));
        set("kq", query.trim() ? query.trim().slice(0, 128) : null);
      }
      const next = url.pathname + (url.search ? url.search : "") + url.hash;
      const current = window.location.pathname + window.location.search + window.location.hash;
      if (next !== current) window.history.replaceState(null, "", next);
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
  }, [kpiKey, sort, pageSize, page, query]);
  const toggleSort = (idx: number, align?: "left" | "right") => {
    setPage(1);
    setSort((s) =>
      s && s.idx === idx
        ? { idx, dir: s.dir === "asc" ? "desc" : "asc" }
        : { idx, dir: align === "right" ? "desc" : "asc" },
    );
  };

  // Persisted expanded row (per-KPI) — stored by absolute index into sortedItems
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  useEffect(() => {
    if (!kpiKey) {
      setExpandedRow(null);
      return;
    }
    try {
      const sp = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
      const urlV = sp?.get("kexp");
      const urlN = urlV == null ? NaN : Number(urlV);
      if (Number.isFinite(urlN) && urlN >= 0) {
        setExpandedRow(urlN);
        return;
      }
      const raw = localStorage.getItem(`dash.kpi.expanded.${kpiKey}`);
      const n = raw == null ? NaN : Number(raw);
      setExpandedRow(Number.isFinite(n) && n >= 0 ? n : null);
    } catch {
      setExpandedRow(null);
    }
  }, [kpiKey]);
  useEffect(() => {
    if (!kpiKey) return;
    try {
      if (expandedRow == null) localStorage.removeItem(`dash.kpi.expanded.${kpiKey}`);
      else localStorage.setItem(`dash.kpi.expanded.${kpiKey}`, String(expandedRow));
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        if (expandedRow == null) url.searchParams.delete("kexp");
        else url.searchParams.set("kexp", String(expandedRow));
        const next = url.pathname + (url.search ? url.search : "") + url.hash;
        const cur = window.location.pathname + window.location.search + window.location.hash;
        if (next !== cur) window.history.replaceState(null, "", next);
      }
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
  }, [expandedRow, kpiKey]);
  const toggleExpand = (absIdx: number) =>
    setExpandedRow((cur) => (cur === absIdx ? null : absIdx));

  type RowsShape = {
    columns: { label: string; align?: "left" | "right" }[];
    items: any[][];
    total: number;
    totalLabel: string;
  };
  const rows: RowsShape = useMemo<RowsShape>(() => {
    if (!kpiKey)
      return {
        columns: [] as { label: string; align?: "left" | "right" }[],
        items: [] as any[][],
        total: 0,
        totalLabel: "",
      };
    // NOTE: `data` here is the parent's project-scoped `filtered` slice,
    // so drill tables automatically re-slice when the header switches
    // the active project.
    switch (kpiKey) {
      case "sell": {
        const items = [...data.bookings]
          .sort((a, b) => (Number(b.sold_unit_value) || 0) - (Number(a.sold_unit_value) || 0))
          .map((b) => [
            b.client_name,
            b.unit_id,
            b.project_code ?? "—",
            fmtPKR(Number(b.sold_unit_value) || 0),
            b.booking_date ? fmtDate(new Date(b.booking_date)) : "—",
          ]);
        const total = data.bookings.reduce((s, b) => s + (Number(b.sold_unit_value) || 0), 0);
        return {
          columns: [
            { label: "Client" },
            { label: "Unit" },
            { label: "Project" },
            { label: "Sell Value (PKR)", align: "right" as const },
            { label: "Booking Date" },
          ],
          items,
          total,
          totalLabel: "Total Sell Value",
        };
      }
      case "cash": {
        const list = data.payments.filter((p: any) => (Number(p.safe_cash_amount) || 0) > 0);
        const items = list
          .sort((a: any, b: any) => (b.payment_date || "").localeCompare(a.payment_date || ""))
          .map((p: any) => [
            p.payment_date ? fmtDate(new Date(p.payment_date)) : "—",
            p.booking_id ?? "—",
            p.payment_mode ?? "—",
            p.bank_name ?? "—",
            fmtPKR(Number(p.safe_cash_amount) || 0),
          ]);
        const total = list.reduce((s: number, p: any) => s + (Number(p.safe_cash_amount) || 0), 0);
        return {
          columns: [
            { label: "Date" },
            { label: "Booking" },
            { label: "Mode" },
            { label: "Bank" },
            { label: "Amount (PKR)", align: "right" as const },
          ],
          items,
          total,
          totalLabel: "Cash / Bank Received",
        };
      }
      case "adj_approved": {
        const items = [...data.adjustments]
          .sort(
            (a: any, b: any) => (Number(b.approved_value) || 0) - (Number(a.approved_value) || 0),
          )
          .map((a: any) => [
            a.adjustment_date ? fmtDate(new Date(a.adjustment_date)) : "—",
            a.booking_id ?? "—",
            a.asset_type ?? "—",
            fmtPKR(Number(a.approved_value) || 0),
            fmtPKR(Number(a.realized_value) || 0),
          ]);
        const total = data.adjustments.reduce(
          (s: number, a: any) => s + (Number(a.approved_value) || 0),
          0,
        );
        return {
          columns: [
            { label: "Date" },
            { label: "Booking" },
            { label: "Asset" },
            { label: "Approved (PKR)", align: "right" as const },
            { label: "Realised (PKR)", align: "right" as const },
          ],
          items,
          total,
          totalLabel: "Total Approved",
        };
      }
      case "adj_realised": {
        const list = data.adjustments.filter((a: any) => (Number(a.realized_value) || 0) > 0);
        const items = list
          .sort(
            (a: any, b: any) => (Number(b.realized_value) || 0) - (Number(a.realized_value) || 0),
          )
          .map((a: any) => [
            a.adjustment_date ? fmtDate(new Date(a.adjustment_date)) : "—",
            a.booking_id ?? "—",
            a.asset_type ?? "—",
            fmtPKR(Number(a.realized_value) || 0),
          ]);
        const total = list.reduce((s: number, a: any) => s + (Number(a.realized_value) || 0), 0);
        return {
          columns: [
            { label: "Date" },
            { label: "Booking" },
            { label: "Asset" },
            { label: "Realised (PKR)", align: "right" as const },
          ],
          items,
          total,
          totalLabel: "Total Realised",
        };
      }
      case "commission": {
        const list = data.bookings.filter(
          (b: any) => (Number(b.dealer_commission_amount) || 0) > 0,
        );
        const items = list
          .sort(
            (a: any, b: any) =>
              (Number(b.dealer_commission_amount) || 0) - (Number(a.dealer_commission_amount) || 0),
          )
          .map((b: any) => [
            b.booking_date ? fmtDate(new Date(b.booking_date)) : "—",
            b.booking_id ?? "—",
            b.client_name ?? "—",
            b.dealer_name ?? "—",
            fmtPKR(Number(b.dealer_commission_amount) || 0),
          ]);
        const total = list.reduce(
          (s: number, b: any) => s + (Number(b.dealer_commission_amount) || 0),
          0,
        );
        return {
          columns: [
            { label: "Booking Date" },
            { label: "Booking" },
            { label: "Client" },
            { label: "Dealer" },
            { label: "Commission (PKR)", align: "right" as const },
          ],
          items,
          total,
          totalLabel: "Total Commission Paid",
        };
      }
      case "received": {
        const cashItems = data.payments
          .filter((p: any) => (Number(p.safe_cash_amount) || 0) > 0)
          .map((p: any) => [
            p.payment_date ? fmtDate(new Date(p.payment_date)) : "—",
            "Cash/Bank",
            p.booking_id ?? "—",
            p.payment_mode ?? "—",
            fmtPKR(Number(p.safe_cash_amount) || 0),
          ]);
        const adjItems = data.adjustments
          .filter((a: any) => (Number(a.realized_value) || 0) > 0)
          .map((a: any) => [
            a.adjustment_date ? fmtDate(new Date(a.adjustment_date)) : "—",
            "Adj. Realised",
            a.booking_id ?? "—",
            a.asset_type ?? "—",
            fmtPKR(Number(a.realized_value) || 0),
          ]);
        const items = [...cashItems, ...adjItems].sort((a, b) =>
          String(b[0]).localeCompare(String(a[0])),
        );
        const total =
          Math.round(
            (data.payments.reduce((s: number, p: any) => s + (Number(p.safe_cash_amount) || 0), 0) +
              data.adjustments.reduce(
                (s: number, a: any) => s + (Number(a.realized_value) || 0),
                0,
              )) *
              100,
          ) / 100;
        return {
          columns: [
            { label: "Date" },
            { label: "Source" },
            { label: "Booking" },
            { label: "Detail" },
            { label: "Amount (PKR)", align: "right" as const },
          ],
          items,
          total,
          totalLabel: "Cash + Realised Assets",
        };
      }
      case "pending": {
        const d = buildPendingDrill(data as any);
        return {
          columns: d.columns as any,
          items: d.items as any[][],
          total: d.total,
          totalLabel: d.totalLabel,
        };
      }

      case "cancelled": {
        const d = buildCancelledDrill(data as any);
        return {
          columns: d.columns as any,
          items: d.items as any[][],
          total: d.total,
          totalLabel: d.totalLabel,
        };
      }

      case "overdue": {
        const items = [...overdueRows]
          .sort(
            (a, b) =>
              Number(b.due_amount) -
              Number(b.paid_amount) -
              (Number(a.due_amount) - Number(a.paid_amount)),
          )
          .map((l) => {
            const out = Math.max((Number(l.due_amount) || 0) - (Number(l.paid_amount) || 0), 0);
            return [
              l.due_date ? fmtDate(new Date(l.due_date)) : "—",
              l.booking_id ?? "—",
              l.installment_no ?? "—",
              fmtPKR(Number(l.due_amount) || 0),
              fmtPKR(Number(l.paid_amount) || 0),
              fmtPKR(out),
            ];
          });
        const total = overdueRows.reduce(
          (s, l) => s + Math.max((Number(l.due_amount) || 0) - (Number(l.paid_amount) || 0), 0),
          0,
        );
        return {
          columns: [
            { label: "Due" },
            { label: "Booking" },
            { label: "Inst #" },
            { label: "Due (PKR)", align: "right" as const },
            { label: "Paid (PKR)", align: "right" as const },
            { label: "Outstanding (PKR)", align: "right" as const },
          ],
          items,
          total,
          totalLabel: "Total Overdue",
        };
      }
    }
  }, [kpiKey, data, overdueRows]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows.items;
    return rows.items.filter((row) =>
      row.some((c) =>
        String(c ?? "")
          .toLowerCase()
          .includes(q),
      ),
    );
  }, [rows, query]);
  const sortedItems = useMemo(() => {
    if (!sort) return filteredItems;
    const i = sort.idx;
    const m = sort.dir === "asc" ? 1 : -1;
    const align = rows.columns[i]?.align;
    const num = (v: any) => {
      const n = parseFloat(String(v ?? "").replace(/[^\d.\-]/g, ""));
      return Number.isFinite(n) ? n : NaN;
    };
    return [...filteredItems].sort((a, b) => {
      const av = a[i];
      const bv = b[i];
      if (align === "right") {
        const an = num(av);
        const bn = num(bv);
        if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * m;
      }
      return (
        String(av ?? "").localeCompare(String(bv ?? ""), undefined, {
          numeric: true,
          sensitivity: "base",
        }) * m
      );
    });
  }, [filteredItems, rows.columns, sort]);

  // Validate the restored expanded-row index against the live dataset. A shared
  // link may point at a row that no longer exists (data changed, search filter
  // hides it). In that case, clear the stale selection, jump to the first row
  // when available, and tell the user why.
  const validatedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!kpiKey) {
      validatedKeyRef.current = null;
      return;
    }
    // Only run once per (kpi + dataset size) — avoids loops while user edits.
    const stamp = `${kpiKey}:${sortedItems.length}`;
    if (validatedKeyRef.current === stamp) return;
    if (expandedRow == null) {
      validatedKeyRef.current = stamp;
      return;
    }
    if (expandedRow >= sortedItems.length) {
      validatedKeyRef.current = stamp;
      if (sortedItems.length === 0) {
        setExpandedRow(null);
        toast.info("That record is no longer available", {
          description: `The ${meta?.label ?? "selected"} list has no matching rows right now.`,
        });
      } else {
        setExpandedRow(0);
        setPage(1);
        toast.info("Shared record not found — showing the first available", {
          description: `Row #${expandedRow + 1} is out of range; opened row #1 of ${sortedItems.length} instead.`,
        });
      }
    } else {
      validatedKeyRef.current = stamp;
    }
  }, [kpiKey, sortedItems.length, expandedRow, meta?.label]);

  const fileBase = useMemo(() => {
    const label = (meta?.label ?? "drilldown")
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
    const ts = new Date().toISOString().slice(0, 10);
    return `dashboard_${label}_${ts}`;
  }, [meta?.label]);

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const pageSafe = Math.min(Math.max(1, page), totalPages);
  const pageStart = (pageSafe - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, sortedItems.length);
  const pagedItems = sortedItems.slice(pageStart, pageEnd);

  const exportCsv = () => {
    try {
      const esc = (v: any) => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const sortColLabel = sort ? (rows.columns[sort.idx]?.label ?? `col${sort.idx}`) : null;
      const metaLines = buildCsvMetadataHeader({
        source: `Dashboard Drilldown — ${meta?.label ?? "Drilldown"}`,
        sort: sortColLabel ? { key: sortColLabel, dir: sort!.dir } : null,
        page: { page: pageSafe, totalPages, pageSize },
        counts: { shown: pagedItems.length, total: sortedItems.length },
        columns: rows.columns.map((c: any) => ({ key: (c as any).key ?? c.label, label: c.label })),
      });
      const header = rows.columns.map((c) => esc(c.label)).join(",");
      const body = pagedItems.map((r) => r.map(esc).join(",")).join("\n");
      const totalRow = rows.columns
        .map((_, i) =>
          esc(i === 0 ? rows.totalLabel : i === rows.columns.length - 1 ? fmtPKR(rows.total) : ""),
        )
        .join(",");
      const csv = [...metaLines, "", header, body, totalRow].filter(Boolean).join("\n");
      const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileBase}_p${pageSafe}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported page ${pageSafe} as CSV`);
    } catch (e: any) {
      toast.error(`CSV export failed: ${e?.message ?? e}`);
    }
  };

  const exportPdf = async () => {
    const t = toast.loading("Rendering PDF…");
    try {
      const { default: jsPDF } = await import("jspdf");
      const autoTableMod: any = await import("jspdf-autotable");
      const autoTable = autoTableMod.default ?? autoTableMod.autoTable ?? autoTableMod;
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text(meta?.label ?? "Detail", 40, 40);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(110);
      if (meta?.sub) doc.text(meta.sub, 40, 56);
      doc.text(
        `${rows.totalLabel}: PKR ${fmtPKR(rows.total)}  ·  ${sortedItems.length} records`,
        40,
        70,
      );
      autoTable(doc, {
        startY: 84,
        head: [rows.columns.map((c) => c.label)],
        body: sortedItems.map((r) => r.map((c) => String(c ?? ""))),
        styles: { fontSize: 8, cellPadding: 4 },
        headStyles: { fillColor: [30, 41, 59], textColor: 255 },
        columnStyles: Object.fromEntries(
          rows.columns.map((c, i) => [i, { halign: c.align === "right" ? "right" : "left" }]),
        ),
        margin: { left: 40, right: 40 },
      });
      doc.save(`${fileBase}.pdf`);
      toast.success("Exported as PDF", { id: t });
    } catch (e: any) {
      toast.error(`PDF export failed: ${e?.message ?? e}`, { id: t });
    }
  };

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-display text-2xl">{meta?.label ?? "Detail"}</SheetTitle>
            <SheetDescription>{meta?.sub}</SheetDescription>
          </SheetHeader>

          <div className="mt-5 rounded-3xl bg-muted/40 ring-1 ring-border p-6 flex items-baseline justify-between transition-all duration-200">
            <h3 className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-semibold m-0">
              {rows.totalLabel}
            </h3>
            <div className="font-display text-2xl font-semibold tabular-nums">
              <span className="text-[11px] font-semibold text-muted-foreground mr-1.5">PKR</span>
              {fmtPKR(rows.total)}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] text-muted-foreground">
              {query.trim() ? (
                <>
                  Showing{" "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {sortedItems.length}
                  </span>{" "}
                  of {rows.items.length}
                </>
              ) : (
                <>
                  {rows.items.length} {rows.items.length === 1 ? "record" : "records"}
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value.slice(0, 128));
                    setPage(1);
                  }}
                  placeholder="Search rows…"
                  aria-label="Search rows in this KPI detail table"
                  className="min-h-11 lg:h-7 lg:min-h-0 w-full sm:w-44 rounded-md bg-muted/60 ring-1 ring-border px-2.5 pr-7 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setPage(1);
                    }}
                    aria-label="Clear search"
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-background/60"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={exportCsv}
                disabled={rows.items.length === 0}
                className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 hover:bg-muted px-2.5 py-1 text-xs font-medium ring-1 ring-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="h-3.5 w-3.5" /> CSV
              </button>
              <button
                type="button"
                onClick={exportPdf}
                disabled={rows.items.length === 0}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 px-2.5 py-1 text-xs font-medium ring-1 ring-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="h-3.5 w-3.5" /> PDF
              </button>
              <button
                type="button"
                onClick={async () => {
                  let link = "";
                  try {
                    const url = new URL(window.location.href);
                    url.searchParams.set("tab", "kpi");
                    if (kpiKey) url.searchParams.set("kpi", kpiKey);
                    if (sort) url.searchParams.set("ksort", `${sort.idx}.${sort.dir}`);
                    else url.searchParams.delete("ksort");
                    url.searchParams.set("ksize", String(pageSize));
                    url.searchParams.set("kpage", String(page));
                    if (query.trim()) url.searchParams.set("kq", query.trim().slice(0, 128));
                    else url.searchParams.delete("kq");
                    if (expandedRow != null) url.searchParams.set("kexp", String(expandedRow));
                    else url.searchParams.delete("kexp");
                    link = url.toString();
                  } catch (e: any) {
                    toast.error("Could not build share link", {
                      description: e?.message ?? String(e),
                    });
                    return;
                  }
                  const desc = `${meta?.label ?? "KPI"} drill-down · current view`;
                  const ok = await tryCopyToClipboard(link);
                  if (ok) {
                    toast.success("Share link copied", { description: desc });
                  } else {
                    setShareFallback({
                      open: true,
                      link,
                      desc: "Clipboard access was blocked. Select the link and copy it manually.",
                    });
                  }
                }}
                aria-label="Copy a shareable link to this exact KPI drill-down view"
                title="Copy share link to this KPI view"
                className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 hover:bg-muted px-2.5 py-1 text-xs font-medium ring-1 ring-border transition-colors"
              >
                <Link2 className="h-3.5 w-3.5" /> Share link
              </button>
            </div>
          </div>

          {(() => {
            const totalPages = Math.max(1, Math.ceil(sortedItems.length / pageSize));
            const pageSafe = Math.min(Math.max(1, page), totalPages);
            const start = (pageSafe - 1) * pageSize;
            const end = Math.min(start + pageSize, sortedItems.length);
            const paged = sortedItems.slice(start, end);
            return (
              <>
                <div className="mt-2 rounded-3xl ring-1 ring-border overflow-hidden transition-all duration-200">
                  <div className="max-h-[60vh] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/60 text-xs text-muted-foreground sticky top-0">
                        <tr>
                          {rows.columns.map((c, i) => {
                            const active = sort?.idx === i;
                            const arrow = active ? (sort!.dir === "asc" ? "▲" : "▼") : "";
                            return (
                              <th
                                key={c.label}
                                scope="col"
                                aria-sort={
                                  active
                                    ? sort!.dir === "asc"
                                      ? "ascending"
                                      : "descending"
                                    : "none"
                                }
                                className={`px-3 py-2 font-medium ${c.align === "right" ? "text-right" : "text-left"}`}
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleSort(i, c.align)}
                                  aria-label={`Sort by ${c.label}${active ? (sort!.dir === "asc" ? " (ascending)" : " (descending)") : ""}`}
                                  className={`inline-flex items-center gap-1 min-h-11 lg:min-h-0 hover:text-foreground transition-colors ${active ? "text-foreground" : ""} ${c.align === "right" ? "flex-row-reverse" : ""}`}
                                >
                                  <span>{c.label}</span>
                                  <span
                                    aria-hidden
                                    className="text-[10px] tabular-nums w-2 inline-block"
                                  >
                                    {arrow}
                                  </span>
                                </button>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedItems.length === 0 ? (
                          <tr>
                            <td colSpan={rows.columns.length} className="p-0">
                              <EmptyState
                                icon={Filter}
                                title="No records match your filters"
                                description="Try widening the date range or clearing a filter to see results."
                                compact
                              />
                            </td>
                          </tr>
                        ) : (
                          paged.map((r, i) => {
                            const absIdx = start + i;
                            const isOpen = expandedRow === absIdx;
                            return (
                              <Fragment key={absIdx}>
                                <tr
                                  onClick={() => toggleExpand(absIdx)}
                                  aria-expanded={isOpen}
                                  className={`border-t cursor-pointer transition-all duration-200 ${isOpen ? "bg-primary/5 shadow-inner" : "hover:bg-muted/30"}`}
                                >
                                  {r.map((cell: any, j: number) => {
                                    const val = cell ?? "—";
                                    return (
                                      <td
                                        key={j}
                                        className={`px-3 py-2 ${rows.columns[j].align === "right" ? "text-right tabular-nums font-medium" : ""}`}
                                      >
                                        {j === 0 ? (
                                          <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
                                            <ChevronRight
                                              className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                                            />
                                            <span className="truncate">{val}</span>
                                          </span>
                                        ) : (
                                          <div
                                            className="truncate max-w-[120px] sm:max-w-[200px]"
                                            title={String(val)}
                                          >
                                            {val}
                                          </div>
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                                {isOpen && (
                                  <tr className="bg-muted/20 border-t">
                                    <td colSpan={rows.columns.length} className="px-4 py-3">
                                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                                        {rows.columns.map((c, j) => (
                                          <div key={c.label} className="min-w-0">
                                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                                              {c.label}
                                            </div>
                                            <div
                                              className={`mt-0.5 truncate ${c.align === "right" ? "tabular-nums font-medium" : ""}`}
                                            >
                                              {r[j] ?? "—"}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                {rows.items.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2">
                      <label htmlFor="kpi-page-size" className="text-muted-foreground">
                        Rows per page
                      </label>
                      <select
                        id="kpi-page-size"
                        value={pageSize}
                        onChange={(e) => {
                          setPageSize(Number(e.target.value));
                          setPage(1);
                        }}
                        className="rounded-md border bg-background px-2 py-1 text-xs ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary/40"
                      >
                        {KPI_PAGE_SIZES.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                      <span className="text-muted-foreground tabular-nums">
                        Showing {start + 1}–{end} of {rows.items.length}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPage(1)}
                        disabled={pageSafe === 1}
                        className="h-8 lg:h-8 min-h-[44px] lg:min-h-0 min-w-[44px] lg:min-w-0 px-2.5 rounded-lg ring-1 ring-border bg-background hover:bg-muted/50 transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 font-medium"
                      >
                        « First
                      </button>
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={pageSafe === 1}
                        className="h-8 lg:h-8 min-h-[44px] lg:min-h-0 min-w-[44px] lg:min-w-0 px-2.5 rounded-lg ring-1 ring-border bg-background hover:bg-muted/50 transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 font-medium"
                      >
                        ‹ Prev
                      </button>
                      <div className="h-8 lg:h-8 min-h-[44px] lg:min-h-0 min-w-[44px] lg:min-w-0 flex items-center justify-center px-3 rounded-lg bg-muted/30 text-xs tabular-nums text-muted-foreground font-medium ring-1 ring-border/50">
                        Page <span className="mx-1 font-bold text-foreground">{pageSafe}</span> of{" "}
                        <span className="ml-1">{totalPages}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={pageSafe === totalPages}
                        className="h-8 lg:h-8 min-h-[44px] lg:min-h-0 min-w-[44px] lg:min-w-0 px-2.5 rounded-lg ring-1 ring-border bg-background hover:bg-muted/50 transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 font-medium"
                      >
                        Next ›
                      </button>
                      <button
                        type="button"
                        onClick={() => setPage(totalPages)}
                        disabled={pageSafe === totalPages}
                        className="h-8 lg:h-8 min-h-[44px] lg:min-h-0 min-w-[44px] lg:min-w-0 px-2.5 rounded-lg ring-1 ring-border bg-background hover:bg-muted/50 transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 font-medium"
                      >
                        Last »
                      </button>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
      <ShareFallbackDialog
        open={shareFallback.open}
        link={shareFallback.link}
        description={shareFallback.desc}
        onOpenChange={(o) => setShareFallback((s) => ({ ...s, open: o }))}
      />
    </>
  );
}
