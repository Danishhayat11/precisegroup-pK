/**
 * Data health page. Severity chips and surface tints use semantic status
 * tokens (bg-success / bg-warning / bg-destructive / bg-info) mapped to the
 * theme in src/styles.css so light and dark modes stay consistent.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/router-compat";
import { fmtPKR } from "@/lib/format";
import { useSystemDate, setSystemDateOverride, invalidateSystemDate } from "@/lib/systemDate";
import {
  runDataAudit,
  type AuditIssue,
  type AuditReport,
  type BookingBreakdown,
  type Severity,
} from "@/lib/dataAudit";
import { buildCsvMetadataHeader } from "@/lib/csvExportMetadata";
import { CsvExportMetadataPreview } from "@/components/CsvExportMetadataPreview";
import { useCsvExportConfirm } from "@/components/CsvExportConfirmDialog";
import { usePIIGuardedQuery } from "@/lib/access";

import { useBackgroundJob, runChunked } from "@/lib/backgroundJob";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import {
  AlertOctagon,
  AlertTriangle,
  Info,
  CheckCircle2,
  RefreshCw,
  FileDown,
  CalendarClock,
  ExternalLink,
  Eye,
  Calculator,
  ClipboardCheck,
  X,
  Loader2,
  Columns3,
  Search,
  GripVertical,
  GitCompare,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  loadIssueVisibleCols,
  sanitizeIssueVisibleCols,
  serializeIssueVisibleCols,
} from "@/pages/dataHealth/issueColsLoader";
import { IssueDiffDrawer } from "@/pages/dataHealth/IssueDiffDrawer";
import {
  commitSnapshot,
  loadPreviousSnapshot,
  type IssueSnapshot,
} from "@/pages/dataHealth/snapshotStore";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { callRpc } from "@/integrations/supabase/approvedRpc";

/**
 * CSV column registry — single source of truth for the CSV export and the
 * column-picker UI. Each entry maps a stable key to a header label and a
 * value-getter from a BookingBreakdown row. Add/remove entries here to
 * change what's available in the picker.
 */
type CsvCol = {
  key: string;
  label: string;
  group: "Identity" | "Money" | "Balance" | "Plan" | "Risk" | "Rules";
  get: (b: BookingBreakdown) => string | number | null | undefined;
};
const yn = (ok: boolean) => (ok ? "PASS" : "FAIL");
const csvDay = (value: string | null | undefined) => String(value ?? "").slice(0, 10);
const CSV_COLUMNS: CsvCol[] = [
  { key: "booking_id", label: "Booking ID", group: "Identity", get: (b) => b.booking_id },
  {
    key: "booking_date",
    label: "Booking Date",
    group: "Identity",
    get: (b) => csvDay(b.booking_date),
  },
  { key: "client", label: "Client", group: "Identity", get: (b) => b.client_name },
  { key: "status", label: "Status", group: "Identity", get: (b) => b.status },
  { key: "contract", label: "Contract", group: "Money", get: (b) => Math.round(b.contract_value) },
  { key: "cash", label: "Cash Received", group: "Money", get: (b) => Math.round(b.cash_received) },
  {
    key: "adj",
    label: "Adjustment Credit",
    group: "Money",
    get: (b) => Math.round(b.adjustment_credit),
  },
  {
    key: "effective",
    label: "Effective Received",
    group: "Money",
    get: (b) => Math.round(b.effective_received),
  },
  {
    key: "live_bal",
    label: "Live Balance",
    group: "Balance",
    get: (b) => Math.round(b.live_balance),
  },
  {
    key: "cached_bal",
    label: "Cached Balance",
    group: "Balance",
    get: (b) => Math.round(b.cached_balance),
  },
  {
    key: "live_od_amt",
    label: "Live Overdue Amount",
    group: "Balance",
    get: (b) => Math.round(b.live_overdue_amount),
  },
  {
    key: "cached_od_amt",
    label: "Cached Overdue Amount",
    group: "Balance",
    get: (b) => Math.round(b.cached_overdue_amount),
  },
  {
    key: "live_od_cnt",
    label: "Live Overdue Count",
    group: "Balance",
    get: (b) => b.live_overdue_count,
  },
  {
    key: "cached_od_cnt",
    label: "Cached Overdue Count",
    group: "Balance",
    get: (b) => b.cached_overdue_count,
  },
  { key: "plan_sum", label: "Plan Sum", group: "Plan", get: (b) => Math.round(b.plan_sum) },
  {
    key: "plan_diff",
    label: "Plan vs Contract Diff",
    group: "Plan",
    get: (b) => Math.round(b.plan_vs_contract_diff),
  },
  { key: "risk_cached", label: "Risk (Cached)", group: "Risk", get: (b) => b.risk_level_cached },
  {
    key: "risk_expected",
    label: "Risk (Expected)",
    group: "Risk",
    get: (b) => b.risk_level_expected,
  },
  { key: "issue_count", label: "Issue Count", group: "Risk", get: (b) => b.issue_count },
  {
    key: "failing_rules",
    label: "Failing Rules",
    group: "Risk",
    get: (b) => {
      const f: string[] = [];
      if (!b.rules.rule5_plan_identity.ok) f.push("R5");
      if (!b.rules.rule6_overdue_le_balance.ok) f.push("R6");
      if (!b.rules.risk_level.ok) f.push("Risk");
      if (!b.rules.completed_zero_balance.ok) f.push("Completed=0");
      if (!b.rules.no_negative_balance.ok) f.push("NoNegative");
      if (!b.rules.cached_balance_matches_live.ok) f.push("Balance=Live");
      if (!b.rules.cached_overdue_matches_live.ok) f.push("Overdue=Live");
      return f.join("|") || "—";
    },
  },
  {
    key: "any_failing",
    label: "Any Rule Failing",
    group: "Risk",
    get: (b) => (Object.values(b.rules).some((r) => !r.ok) ? "YES" : "NO"),
  },
  {
    key: "r5",
    label: "R5 Plan=Contract",
    group: "Rules",
    get: (b) => yn(b.rules.rule5_plan_identity.ok),
  },
  {
    key: "r5_detail",
    label: "R5 Detail",
    group: "Rules",
    get: (b) => b.rules.rule5_plan_identity.detail,
  },
  {
    key: "r6",
    label: "R6 Overdue<=Balance",
    group: "Rules",
    get: (b) => yn(b.rules.rule6_overdue_le_balance.ok),
  },
  {
    key: "r6_detail",
    label: "R6 Detail",
    group: "Rules",
    get: (b) => b.rules.rule6_overdue_le_balance.detail,
  },
  { key: "risk_ok", label: "Risk Level OK", group: "Rules", get: (b) => yn(b.rules.risk_level.ok) },
  {
    key: "risk_detail",
    label: "Risk Detail",
    group: "Rules",
    get: (b) => b.rules.risk_level.detail,
  },
  {
    key: "comp_ok",
    label: "Completed=>Balance 0",
    group: "Rules",
    get: (b) => yn(b.rules.completed_zero_balance.ok),
  },
  {
    key: "comp_detail",
    label: "Completed Detail",
    group: "Rules",
    get: (b) => b.rules.completed_zero_balance.detail,
  },
  {
    key: "neg_ok",
    label: "No Negative Row",
    group: "Rules",
    get: (b) => yn(b.rules.no_negative_balance.ok),
  },
  {
    key: "neg_detail",
    label: "Negative Detail",
    group: "Rules",
    get: (b) => b.rules.no_negative_balance.detail,
  },
  {
    key: "bal_match",
    label: "Cached Balance=Live",
    group: "Rules",
    get: (b) => yn(b.rules.cached_balance_matches_live.ok),
  },
  {
    key: "bal_match_detail",
    label: "Balance Match Detail",
    group: "Rules",
    get: (b) => b.rules.cached_balance_matches_live.detail,
  },
  {
    key: "od_match",
    label: "Cached Overdue=Live",
    group: "Rules",
    get: (b) => yn(b.rules.cached_overdue_matches_live.ok),
  },
  {
    key: "od_match_detail",
    label: "Overdue Match Detail",
    group: "Rules",
    get: (b) => b.rules.cached_overdue_matches_live.detail,
  },
];
const CSV_ALL_KEYS = CSV_COLUMNS.map((c) => c.key);

// On-screen columns for the Issues table.
const ISSUE_COLS: Array<{ key: string; label: string }> = [
  { key: "severity", label: "Severity" },
  { key: "booking", label: "Booking" },
  { key: "type", label: "Issue Type" },
  { key: "description", label: "Description" },
  { key: "detected", label: "Detected" },
  { key: "action", label: "Action" },
];
const ISSUE_ALL_KEYS = ISSUE_COLS.map((c) => c.key);
const ISSUE_VIS_KEY = "datahealth.issuesVisibleCols";

const SEV_META: Record<Severity, { label: string; cls: string; Icon: any; tone: string }> = {
  CRITICAL: {
    label: "Critical",
    cls: "text-destructive border-destructive/40 bg-destructive/10 dark:bg-destructive/20",
    Icon: AlertOctagon,
    tone: "🔴",
  },
  WARNING: {
    label: "Warning",
    cls: "text-warning border-warning/40 bg-warning/10 dark:bg-warning/20",
    Icon: AlertTriangle,
    tone: "🟠",
  },
  INFO: {
    label: "Info",
    cls: "text-info border-info/40 bg-info/10 dark:bg-info/20",
    Icon: Info,
    tone: "🔵",
  },
};

export default function DataHealth() {
  const qc = useQueryClient();
  const systemDate = useSystemDate();
  const { requestExport: requestCsvExport, dialog: csvConfirmDialog } = useCsvExportConfirm();

  const [override, setOverride] = useState<string>("");
  const [filter, setFilter] = useState<"" | Severity>("");
  const [search, setSearch] = useState("");
  // When true, reviewed issues are mixed back into the list (default: hidden).
  // Persisted in localStorage so the choice survives refreshes and navigations.
  const SHOW_REVIEWED_KEY = "datahealth.showReviewed";
  const [showReviewed, setShowReviewedState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(SHOW_REVIEWED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const setShowReviewed = (v: boolean | ((p: boolean) => boolean)) => {
    setShowReviewedState((prev) => {
      const next = typeof v === "function" ? (v as (p: boolean) => boolean)(prev) : v;
      try {
        window.localStorage.setItem(SHOW_REVIEWED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // Persisted on-screen column visibility for the Issues table.
  type IssueFallback = "corrupted" | "invalid" | "empty" | "unsupported";
  const issueVisibleFallbackReason = useRef<IssueFallback | null>(null);
  const [issueVisibleCols, setIssueVisibleColsState] = useState<Set<string>>(() => {
    const storage = typeof window === "undefined" ? null : window.localStorage;
    const { cols, reason } = loadIssueVisibleCols(ISSUE_ALL_KEYS, storage);
    issueVisibleFallbackReason.current = reason;
    return cols;
  });
  useEffect(() => {
    const reason = issueVisibleFallbackReason.current;
    if (!reason) return;
    issueVisibleFallbackReason.current = null;
    const description =
      reason === "corrupted"
        ? "Saved Issues columns were unreadable — restored defaults."
        : reason === "invalid"
          ? "Saved Issues columns were in an unexpected format — restored defaults."
          : reason === "unsupported"
            ? "Saved Issues columns came from a newer version — restored defaults."
            : "Saved Issues columns were empty — restored defaults.";
    toast({ title: "Issues columns reset", description });
  }, []);

  const persistIssueVisible = (next: Set<string>) => {
    // Guardrail: run the shared sanitizer so the picker and the export code
    // paths apply identical rules (strip unknown keys, require ≥1 remaining).
    // An empty selection would render a column-less table AND cause the next
    // load to treat storage as "no preference" and silently fall back to
    // ISSUE_ALL_KEYS, hiding the failed save — so we refuse the write.
    const { cols: sanitized, valid } = sanitizeIssueVisibleCols(next, ISSUE_ALL_KEYS);
    if (!valid) {
      toast({
        variant: "destructive",
        title: "At least one column required",
        description: "Keep one Issues column visible — selection not saved.",
      });
      return;
    }
    setIssueVisibleColsState(new Set(sanitized));
    try {
      localStorage.setItem(ISSUE_VIS_KEY, serializeIssueVisibleCols(sanitized));
    } catch {
      /* ignore */
    }
  };
  const toggleIssueCol = (key: string) => {
    const next = new Set(issueVisibleCols);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    persistIssueVisible(next); // guardrail enforced inside
  };
  const isIssueColVis = (k: string) => issueVisibleCols.has(k);

  // Persisted on-screen column visibility for the CSV preview table.
  // Distinct from the CSV export selection: lets the user hide noisy
  // columns in the preview without changing what gets downloaded.
  const PREVIEW_VIS_KEY = "datahealth.csvPreviewVisibleCols";
  const [previewHiddenCols, setPreviewHiddenColsState] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem(PREVIEW_VIS_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw) as string[];
      return new Set(parsed.filter((k) => CSV_ALL_KEYS.includes(k)));
    } catch {
      return new Set();
    }
  });
  const persistPreviewHidden = (next: Set<string>) => {
    setPreviewHiddenColsState(new Set(next));
    try {
      localStorage.setItem(PREVIEW_VIS_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  };
  const togglePreviewCol = (key: string, totalSelected: number) => {
    const next = new Set(previewHiddenCols);
    if (next.has(key)) {
      next.delete(key);
    } else {
      // Keep at least one preview column visible.
      if (totalSelected - next.size <= 1) return;
      next.add(key);
    }
    persistPreviewHidden(next);
  };
  const isPreviewColVis = (k: string) => !previewHiddenCols.has(k);

  // Failing-only toggle for the on-page matrix + drift detail panel.
  // Persisted under its own key so it doesn't affect the issues list above.
  const FAILING_ONLY_KEY = "datahealth.failingOnly";
  const [failingOnly, setFailingOnlyState] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(FAILING_ONLY_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const setFailingOnly = (v: boolean | ((p: boolean) => boolean)) => {
    setFailingOnlyState((prev) => {
      const next = typeof v === "function" ? (v as (p: boolean) => boolean)(prev) : v;
      try {
        window.localStorage.setItem(FAILING_ONLY_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // CSV column selection — persists across refreshes. Defaults to all columns.
  const CSV_COLS_KEY = "datahealth.csvColumns";
  const [csvCols, setCsvColsState] = useState<string[]>(() => {
    if (typeof window === "undefined") return CSV_ALL_KEYS;
    try {
      const raw = window.localStorage.getItem(CSV_COLS_KEY);
      if (!raw) return CSV_ALL_KEYS;
      const parsed = JSON.parse(raw) as string[];
      const filtered = parsed.filter((k) => CSV_ALL_KEYS.includes(k));
      return filtered.length > 0 ? filtered : CSV_ALL_KEYS;
    } catch {
      return CSV_ALL_KEYS;
    }
  });
  const setCsvCols = (keys: string[]) => {
    setCsvColsState(keys);
    try {
      window.localStorage.setItem(CSV_COLS_KEY, JSON.stringify(keys));
    } catch {
      /* ignore */
    }
  };
  // Preserve user-defined order: keep existing selections in their current
  // position; new additions are appended in registry order at the end.
  const applySelection = (next: Set<string>) => {
    const kept = csvCols.filter((k) => next.has(k));
    const added = CSV_ALL_KEYS.filter((k) => next.has(k) && !csvCols.includes(k));
    setCsvCols([...kept, ...added]);
  };
  const toggleCsvCol = (key: string, on: boolean) => {
    const set = new Set(csvCols);
    if (on) set.add(key);
    else set.delete(key);
    applySelection(set);
  };
  const moveCsvCol = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= csvCols.length || to >= csvCols.length) return;
    const next = csvCols.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setCsvCols(next);
  };
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Keyboard navigation helpers for the column picker popover.
  const focusColByKey = (key: string) => {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-csv-col="${CSS.escape(key)}"]`);
      el?.focus();
    });
  };
  const focusColByIndex = (i: number) => {
    const list = Array.from(document.querySelectorAll<HTMLElement>("[data-csv-col]"));
    if (list.length === 0) return;
    const clamped = Math.max(0, Math.min(list.length - 1, i));
    list[clamped]?.focus();
  };
  const handleColKeyDown = (e: React.KeyboardEvent, key: string) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const list = Array.from(document.querySelectorAll<HTMLElement>("[data-csv-col]"));
      const cur = list.findIndex((el) => el.getAttribute("data-csv-col") === key);
      const next = e.key === "ArrowDown" ? cur + 1 : cur - 1;
      if (next >= 0 && next < list.length) list[next].focus();
    } else if (e.key === "Enter") {
      // Radix Checkbox toggles on Space natively; add Enter for parity.
      e.preventDefault();
      toggleCsvCol(key, !csvCols.includes(key));
    } else if (e.key === "Home") {
      e.preventDefault();
      focusColByIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      const list = document.querySelectorAll<HTMLElement>("[data-csv-col]");
      focusColByIndex(list.length - 1);
    }
  };
  const focusOrderByKey = (key: string) => {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-csv-order="${CSS.escape(key)}"]`);
      el?.focus();
    });
  };
  const handleOrderKeyDown = (e: React.KeyboardEvent, key: string, idx: number) => {
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      moveCsvCol(idx, idx + (e.key === "ArrowDown" ? 1 : -1));
      focusOrderByKey(key);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const list = Array.from(document.querySelectorAll<HTMLElement>("[data-csv-order]"));
      const cur = list.findIndex((el) => el.getAttribute("data-csv-order") === key);
      const next = e.key === "ArrowDown" ? cur + 1 : cur - 1;
      if (next >= 0 && next < list.length) list[next].focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const list = document.querySelectorAll<HTMLElement>("[data-csv-order]");
      (list[e.key === "Home" ? 0 : list.length - 1] as HTMLElement | undefined)?.focus();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      const list = Array.from(document.querySelectorAll<HTMLElement>("[data-csv-order]"));
      const cur = list.findIndex((el) => el.getAttribute("data-csv-order") === key);
      toggleCsvCol(key, false);
      const fallback = list[cur + 1] ?? list[cur - 1];
      requestAnimationFrame(() => (fallback as HTMLElement | undefined)?.focus());
    }
  };

  // Search filter for the column picker popover (persisted across sessions).
  const CSV_COL_SEARCH_KEY = "datahealth.csvColSearch";
  const [csvColSearch, setCsvColSearchState] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return localStorage.getItem(CSV_COL_SEARCH_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const setCsvColSearch = (v: string) => {
    setCsvColSearchState(v);
    try {
      localStorage.setItem(CSV_COL_SEARCH_KEY, v);
    } catch (err) {
      console.error("[localStorage] write error", err);
    }
  };
  const csvColMatches = (c: CsvCol) => {
    const q = csvColSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      c.label.toLowerCase().includes(q) ||
      c.key.toLowerCase().includes(q) ||
      c.group.toLowerCase().includes(q)
    );
  };
  // CSV date-range filter (booking_date). Persisted as ISO yyyy-mm-dd strings;
  // empty string = unbounded on that side. Empty + empty = no date filter.
  const CSV_FROM_KEY = "datahealth.csvFrom";
  const CSV_TO_KEY = "datahealth.csvTo";
  const [csvFrom, setCsvFromState] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(CSV_FROM_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [csvTo, setCsvToState] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(CSV_TO_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const setCsvFrom = (v: string) => {
    setCsvFromState(v);
    try {
      window.localStorage.setItem(CSV_FROM_KEY, v);
    } catch {
      /* ignore */
    }
  };
  const setCsvTo = (v: string) => {
    setCsvToState(v);
    try {
      window.localStorage.setItem(CSV_TO_KEY, v);
    } catch {
      /* ignore */
    }
  };

  // Server-backed reviewed set: persists across refreshes, devices, and users.
  const reviewedQuery = usePIIGuardedQuery({
    queryKey: ["audit-reviewed"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("audit_reviewed_issues")
        .select("issue_id");
      if (error) throw error;
      return new Set<string>((data ?? []).map((r: any) => r.issue_id as string));
    },
    staleTime: 60_000,
  });
  const reviewed: Set<string> = reviewedQuery.data ?? new Set<string>();

  const markReviewed = useMutation({
    mutationFn: async (issue: AuditIssue) => {
      const { error } = await (supabase as any)
        .from("audit_reviewed_issues")
        .upsert(
          { issue_id: issue.id, booking_id: issue.booking_id ?? null, issue_type: issue.type },
          { onConflict: "issue_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audit-reviewed"] }),
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not mark reviewed", description: e.message }),
  });

  const clearAllReviewed = useMutation({
    mutationFn: async () => {
      const ids = [...reviewed];
      if (ids.length === 0) return;
      const { error } = await (supabase as any)
        .from("audit_reviewed_issues")
        .delete()
        .in("issue_id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Reviewed marks cleared" });
      qc.invalidateQueries({ queryKey: ["audit-reviewed"] });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not clear reviewed", description: e.message }),
  });

  const job = useBackgroundJob();

  const audit = usePIIGuardedQuery({
    queryKey: ["data-audit", systemDate],
    // Default refetches (focus / mount / realtime) still run quickly without
    // touching the job banner; the explicit "Run Full Audit" button uses
    // `runAuditJob` to surface progress + cancel.
    queryFn: ({ signal }) => runDataAudit(systemDate, { signal }),
    staleTime: 30_000,
  });

  const runAuditJob = async () => {
    await job.start("Running full data audit", async ({ signal, progress }) => {
      const report = await runDataAudit(systemDate, {
        signal,
        onProgress: (p) => progress(p.stage, p.current, p.total),
      });
      qc.setQueryData(["data-audit", systemDate], report);
      return report;
    });
  };

  const report: AuditReport | undefined = audit.data;

  // Per-browser snapshot rotation. Each time a fresh report loads we push
  // the previous "current" into the "previous" slot so a row-level diff
  // drawer can compare this run against the last-seen one.
  const [previousSnapshot, setPreviousSnapshot] = useState<IssueSnapshot | null>(() =>
    loadPreviousSnapshot(),
  );
  useEffect(() => {
    if (!report) return;
    const prev = commitSnapshot(report);
    setPreviousSnapshot(prev);
  }, [report]);

  const [diffOpen, setDiffOpen] = useState(false);
  const [diffIssue, setDiffIssue] = useState<AuditIssue | null>(null);
  const openDiff = (issue: AuditIssue) => {
    setDiffIssue(issue);
    setDiffOpen(true);
  };

  // Auto re-audit: subscribe to realtime changes on bookings & payments so the
  // issue list refreshes whenever a record is created, updated, or deleted —
  // no need to manually click "Run Full Audit". Debounced to coalesce bursts.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const scheduleRefresh = (table: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["data-audit"] });
        toast({
          title: "Data Health refreshed",
          description: `Detected ${table} change — re-running audit.`,
        });
      }, 800);
    };
    const channel = supabase
      .channel("data-health-auto-audit")
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () =>
        scheduleRefresh("payment"),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () =>
        scheduleRefresh("booking"),
      )
      .subscribe();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const visible = useMemo(() => {
    const all = report?.issues ?? [];
    return all.filter((i) => {
      if (filter && i.severity !== filter) return false;
      if (!showReviewed && reviewed.has(i.id)) return false;
      if (search) {
        const s = search.toLowerCase();
        return (
          (i.booking_id ?? "").toLowerCase().includes(s) ||
          (i.client_name ?? "").toLowerCase().includes(s) ||
          i.type.toLowerCase().includes(s) ||
          i.description.toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [report, filter, search, reviewed, showReviewed]);

  const runRecomputeAll = async () => {
    await job
      .start("Recomputing all bookings (FIFO)", async ({ signal, progress }) => {
        progress("Loading booking list…", 0, 1);
        const { data, error } = await supabase.from("bookings").select("booking_id");
        if (error) throw error;
        const ids = (data ?? []).map((r: any) => r.booking_id as string);
        progress(`Recomputing 0/${ids.length}`, 0, ids.length);
        await runChunked(
          ids,
          async (id) => {
            const { error: rpcErr } = await callRpc("recalculate_ledger_for_booking", {
              _booking_id: id,
            });
            if (rpcErr) throw rpcErr;
          },
          {
            concurrency: 4,
            signal,
            onProgress: (done, total, last) =>
              progress(`Recomputed ${done}/${total} · ${last}`, done, total),
          },
        );
        toast({ title: `Recomputed ${ids.length} bookings` });
        await audit.refetch();
      })
      .catch((e: any) =>
        toast({ variant: "destructive", title: "Recompute failed", description: e?.message }),
      );
  };

  const runRecalcOne = async (bookingId: string) => {
    await job
      .start(`Recalculating ${bookingId}`, async ({ progress }) => {
        progress("Calling FIFO engine…", 0, 1);
        const { error } = await callRpc("recalculate_ledger_for_booking", {
          _booking_id: bookingId,
        });
        if (error) throw error;
        progress("Refreshing audit…", 1, 1);
        toast({ title: `Recalculated ${bookingId}` });
        qc.invalidateQueries({ queryKey: ["booking", bookingId] });
        await audit.refetch();
      })
      .catch((e: any) =>
        toast({ variant: "destructive", title: "Recalculate failed", description: e?.message }),
      );
  };

  const applyOverride = async () => {
    await setSystemDateOverride(override || null);
    toast({ title: override ? `System date set to ${override}` : "System date override cleared" });
    setOverride("");
    invalidateSystemDate();
    await qc.invalidateQueries({ queryKey: ["system-date"] });
    audit.refetch();
  };

  const exportPdf = async (opts: { driftedOnly?: boolean } = {}) => {
    if (!report) return;
    const driftedOnly = !!opts.driftedOnly;
    // Pre-filter breakdowns + issues when "failing only" is requested.
    const allDrifted = report.bookingBreakdowns.filter((br) =>
      Object.values(br.rules).some((r) => !r.ok),
    );
    const breakdowns = driftedOnly ? allDrifted : report.bookingBreakdowns;
    const driftedIds = new Set(allDrifted.map((b) => b.booking_id));
    const issues = driftedOnly
      ? report.issues.filter((i) => i.booking_id && driftedIds.has(i.booking_id))
      : report.issues;

    if (driftedOnly && breakdowns.length === 0) {
      toast({
        title: "Nothing to export",
        description: "No bookings currently fail any rule — all clean.",
      });
      return;
    }

    toast({ title: driftedOnly ? "Rendering failing-only PDF…" : "Rendering PDF…" });
    try {
      const { default: jsPDF } = await import("jspdf");
      const autoTableMod: any = await import("jspdf-autotable");
      const autoTable = autoTableMod.default ?? autoTableMod.autoTable ?? autoTableMod;
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();

      // ── Cover summary ────────────────────────────────────────────────
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text(
        driftedOnly
          ? "Data Health Audit Report — Failing Bookings Only"
          : "Data Health Audit Report",
        40,
        48,
      );
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(110);
      doc.text(
        `Generated ${new Date(report.scannedAt).toLocaleString()}  ·  System date: ${systemDate}`,
        40,
        66,
      );
      const t2 = report.totals;
      doc.setTextColor(0);
      if (driftedOnly) {
        doc.text(
          `Scope: ${breakdowns.length} of ${t2.totalBookings} bookings with at least one failing rule  ·  ${issues.length} related issues`,
          40,
          84,
        );
      } else {
        doc.text(
          `Critical: ${t2.critical}   Warnings: ${t2.warning}   Info: ${t2.info}   Clean: ${t2.cleanBookings}/${t2.totalBookings}`,
          40,
          84,
        );
      }

      // ── Section 1: Legend & Methodology ──────────────────────────────
      autoTable(doc, {
        startY: 104,
        head: [["Symbol / Column", "Meaning", "How it's computed"]],
        body: [
          [
            "✓",
            "Rule passes for this booking",
            "All inputs satisfy the invariant under the active system date.",
          ],
          [
            "✗",
            "Rule fails — drift detected",
            "Expected value differs from actual; see Drift Detail page.",
          ],
          [
            "Contract",
            "Total contract value",
            "bookings.total_contract_value (sold price + adjustments − discounts).",
          ],
          [
            "Cash",
            "Cash + bank receipts",
            "Σ payments.amount where cash_bank_include = true AND status ≠ 'Cancelled'.",
          ],
          [
            "Adj",
            "Approved adjustment credit",
            "bookings.adjustment_credit (non-cash credits already approved).",
          ],
          [
            "Effective",
            "Money applied to the plan",
            "Cash + Adj — the FIFO walk consumes this against installments in due order.",
          ],
          [
            "Live Bal",
            "Live remaining balance",
            "max(0, Contract − Effective) recomputed at scan time.",
          ],
          [
            "Cached Bal",
            "Stored remaining balance",
            "bookings.remaining_balance written by the last recalculate_ledger_for_booking().",
          ],
          [
            "Live OD (n)",
            "Live overdue amount (count)",
            "Σ running_balance on ledger rows where due_date < system_date AND running_balance > 0, capped at Live Bal.",
          ],
          [
            "Cached OD (n)",
            "Stored overdue amount (count)",
            "bookings.total_overdue_amount and current_overdue_count from the last recalc.",
          ],
          [
            "R5 — Plan = Contract",
            "Σ installments + down + possession equals Contract",
            "|Σ(due_amount) + down_payment + possession_amount − Contract| ≤ PKR 1.",
          ],
          [
            "R6 — Overdue ≤ Balance",
            "Cached overdue never exceeds remaining balance",
            "cached_total_overdue_amount ≤ cached_remaining_balance + PKR 1.",
          ],
          [
            "Risk — Risk level",
            "Risk badge matches overdue age",
            "HIGH if oldest_overdue_date ≤ today−60; MEDIUM if ≤ today−30; otherwise LOW.",
          ],
          [
            "Cmp=0 — Completed ⇒ Balance 0",
            "Completed bookings carry zero balance",
            "booking_status='Completed' ⇒ remaining_balance ≤ PKR 1.",
          ],
          [
            "Neg≥0 — No negative row",
            "No ledger row has a negative running balance",
            "min(running_balance) ≥ 0 across all installment rows for the booking.",
          ],
          [
            "Bal= — Cached Balance = Live",
            "Stored balance matches live recompute",
            "|cached_remaining_balance − live_balance| ≤ PKR 1.",
          ],
          [
            "OD= — Cached Overdue = Live",
            "Stored overdue matches live recompute",
            "|cached_total_overdue_amount − live_overdue_amount| ≤ PKR 1 AND cached_count = live_count.",
          ],
        ],
        styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak", valign: "top" },
        headStyles: { fillColor: [30, 41, 59], textColor: 255 },
        columnStyles: {
          0: { cellWidth: 150, fontStyle: "bold" },
          1: { cellWidth: 230 },
          2: { cellWidth: "auto" },
        },
        margin: { left: 40, right: 40 },
        didDrawPage: () => {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(12);
          doc.setTextColor(0);
          doc.text("Legend & Methodology", 40, 96);
        },
      });

      // ── Section 1b: Rule Failure Summary ─────────────────────────────
      const ruleDefs: Array<{ key: keyof BookingBreakdown["rules"]; label: string }> = [
        { key: "rule5_plan_identity", label: "R5 — Plan = Contract" },
        { key: "rule6_overdue_le_balance", label: "R6 — Overdue ≤ Balance" },
        { key: "risk_level", label: "Risk — Risk level matches age" },
        { key: "completed_zero_balance", label: "Cmp=0 — Completed ⇒ Balance 0" },
        { key: "no_negative_balance", label: "Neg≥0 — No negative ledger row" },
        { key: "cached_balance_matches_live", label: "Bal= — Cached Balance = Live" },
        { key: "cached_overdue_matches_live", label: "OD= — Cached Overdue = Live" },
      ];
      const denom = breakdowns.length || 1;
      const ruleRows = ruleDefs.map((rd) => {
        const failing = breakdowns.filter((b) => !b.rules[rd.key].ok);
        const ids = failing.map((b) => b.booking_id).sort();
        const pct = ((failing.length / denom) * 100).toFixed(1);
        return [rd.label, String(failing.length), `${pct}%`, ids.length ? ids.join(", ") : "—"];
      });
      const totalFailing = breakdowns.filter((b) =>
        Object.values(b.rules).some((r) => !r.ok),
      ).length;
      doc.addPage();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(0);
      doc.text("Rule Failure Summary", 40, 48);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(110);
      doc.text(
        `${totalFailing} of ${breakdowns.length} ${driftedOnly ? "failing " : ""}bookings have at least one failing rule. Counts below are bookings failing each rule (a booking may appear in multiple rows).`,
        40,
        64,
        { maxWidth: pageW - 80 },
      );
      doc.setTextColor(0);
      autoTable(doc, {
        startY: 84,
        head: [["Rule", "Bookings failing", "% of scope", "Booking IDs"]],
        body: ruleRows,
        styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak", valign: "top" },
        headStyles: { fillColor: [30, 41, 59], textColor: 255 },
        columnStyles: {
          0: { cellWidth: 200, fontStyle: "bold" },
          1: { cellWidth: 90, halign: "right" },
          2: { cellWidth: 70, halign: "right" },
          3: { cellWidth: "auto" },
        },
        margin: { left: 40, right: 40 },
      });

      // ── Section 2: Issue list ────────────────────────────────────────
      // Honors the on-screen Issues column visibility so the PDF matches what
      // the user sees. The non-printable "Action" column is always omitted.
      doc.addPage();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(driftedOnly ? "Detected Issues (failing bookings only)" : "Detected Issues", 40, 48);
      const issuePdfDefs: Array<{
        key: string;
        head: string;
        width: number;
        get: (i: AuditIssue) => string;
      }> = [
        { key: "severity", head: "Sev", width: 50, get: (i) => i.severity },
        { key: "booking", head: "Booking", width: 90, get: (i) => i.booking_id ?? "—" },
        { key: "booking", head: "Client", width: 140, get: (i) => i.client_name ?? "—" },
        { key: "type", head: "Type", width: 140, get: (i) => i.type },
        { key: "description", head: "Description", width: 0, get: (i) => i.description },
        {
          key: "detected",
          head: "Detected",
          width: 70,
          get: (i) => new Date(i.detected_at).toLocaleTimeString(),
        },
      ];
      const { cols: issueExportCols, valid: issueExportValid } = sanitizeIssueVisibleCols(
        issueVisibleCols,
        ISSUE_ALL_KEYS,
      );
      if (!issueExportValid) {
        toast({
          variant: "destructive",
          title: "Pick at least one Issues column",
          description: "Use the Issues Columns picker to choose fields.",
        });
        return;
      }
      const issueDefs = issuePdfDefs.filter((d) => issueExportCols.has(d.key));
      const issueColumnStyles: Record<number, { cellWidth: number }> = {};
      issueDefs.forEach((d, idx) => {
        if (d.width > 0) issueColumnStyles[idx] = { cellWidth: d.width };
      });
      autoTable(doc, {
        startY: 56,
        head: [issueDefs.map((d) => d.head)],
        body: issues.map((i) => issueDefs.map((d) => d.get(i))),
        styles: { fontSize: 8, cellPadding: 4 },
        headStyles: { fillColor: [30, 41, 59], textColor: 255 },
        columnStyles: issueColumnStyles,
        margin: { left: 40, right: 40 },
      });

      // ── Section 2: Per-booking rule breakdown ────────────────────────
      doc.addPage();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text(
        driftedOnly ? "Per-Booking Rule Breakdown — Failing Only" : "Per-Booking Rule Breakdown",
        40,
        48,
      );
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(110);
      doc.text(
        driftedOnly
          ? `Showing ${breakdowns.length} booking${breakdowns.length === 1 ? "" : "s"} with at least one ✗ rule. Live values recomputed at scan time.`
          : "Live values recomputed at scan time; ✓ = rule passes, ✗ = drift vs cached/contract.",
        40,
        64,
      );
      doc.setTextColor(0);

      // Use the same column picker selection as the CSV export so PDF + CSV
      // ship identical fields. Falls back to all columns when none chosen.
      const pdfSelected: CsvCol[] =
        csvCols.length > 0
          ? (csvCols.map((k) => CSV_COLUMNS.find((c) => c.key === k)).filter(Boolean) as CsvCol[])
          : CSV_COLUMNS;
      const moneyKeys = new Set([
        "contract",
        "cash",
        "adj",
        "effective",
        "live_bal",
        "cached_bal",
        "live_od_amt",
        "cached_od_amt",
        "plan_sum",
        "plan_diff",
      ]);
      const ruleOkKeys = new Set([
        "r5",
        "r6",
        "risk_ok",
        "comp_ok",
        "neg_ok",
        "bal_match",
        "od_match",
      ]);
      const fmtCell = (col: CsvCol, br: BookingBreakdown) => {
        const raw = col.get(br);
        if (raw === null || raw === undefined || raw === "") return "—";
        if (col.key === "any_failing") return raw === "YES" ? "✗" : "✓";
        if (ruleOkKeys.has(col.key)) return raw === "Y" ? "✓" : raw === "N" ? "✗" : String(raw);
        if (moneyKeys.has(col.key)) return fmtPKR(Number(raw));
        return String(raw);
      };
      const head = [pdfSelected.map((c) => c.label)];
      const body = breakdowns
        .slice()
        .sort((a, b) => b.issue_count - a.issue_count || a.booking_id.localeCompare(b.booking_id))
        .map((br) => pdfSelected.map((c) => fmtCell(c, br)));

      const tickColIdxs = new Set<number>();
      pdfSelected.forEach((c, idx) => {
        if (ruleOkKeys.has(c.key) || c.key === "any_failing") tickColIdxs.add(idx);
      });
      const issueColIdx = pdfSelected.findIndex((c) => c.key === "issue_count");

      autoTable(doc, {
        startY: 76,
        head,
        body,
        styles: { fontSize: 7, cellPadding: 3, overflow: "linebreak" },
        headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 7 },
        margin: { left: 20, right: 20 },
        didParseCell: (data: any) => {
          if (data.section !== "body") return;
          if (tickColIdxs.has(data.column.index)) {
            const v = String(data.cell.raw ?? "");
            if (v === "✗") {
              data.cell.styles.textColor = [185, 28, 28];
              data.cell.styles.fontStyle = "bold";
            } else if (v === "✓") {
              data.cell.styles.textColor = [22, 101, 52];
            }
          }
          if (
            issueColIdx >= 0 &&
            data.column.index === issueColIdx &&
            Number(data.cell.raw ?? 0) > 0
          ) {
            data.cell.styles.fillColor = [254, 242, 242];
            data.cell.styles.fontStyle = "bold";
          }
        },
      });

      // ── Section 3: Detail cards for bookings with any failing rule ───
      // In driftedOnly mode, `breakdowns` is already the failing set.
      const drifted = driftedOnly
        ? breakdowns
        : breakdowns.filter((br) => Object.values(br.rules).some((r) => !r.ok));
      if (drifted.length) {
        doc.addPage();
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.text(
          `Drift Detail — ${drifted.length} booking${drifted.length === 1 ? "" : "s"}`,
          40,
          48,
        );
        let y = 70;
        const lineH = 12;
        const ensure = (need: number) => {
          if (y + need > doc.internal.pageSize.getHeight() - 40) {
            doc.addPage();
            y = 50;
          }
        };
        for (const br of drifted) {
          ensure(lineH * 10);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          doc.setTextColor(0);
          doc.text(`${br.booking_id} — ${br.client_name ?? "—"}`, 40, y);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          y += lineH;
          doc.setTextColor(80);
          doc.text(
            `Contract ${fmtPKR(br.contract_value)} · Cash ${fmtPKR(br.cash_received)} · Adj ${fmtPKR(br.adjustment_credit)} · Live Bal ${fmtPKR(br.live_balance)} · Live Overdue ${fmtPKR(br.live_overdue_amount)} (${br.live_overdue_count})`,
            40,
            y,
          );
          y += lineH;
          doc.setTextColor(0);
          const labels: Array<[string, { ok: boolean; detail: string }]> = [
            ["Rule 5 (plan = contract)", br.rules.rule5_plan_identity],
            ["Rule 6 (overdue ≤ balance)", br.rules.rule6_overdue_le_balance],
            ["Risk level", br.rules.risk_level],
            ["Completed ⇒ balance 0", br.rules.completed_zero_balance],
            ["No negative ledger row", br.rules.no_negative_balance],
            ["Cached balance = live", br.rules.cached_balance_matches_live],
            ["Cached overdue = live", br.rules.cached_overdue_matches_live],
          ];
          // In driftedOnly mode keep only the failing rules so the page stays focused.
          const rowsToShow = driftedOnly ? labels.filter(([, rule]) => !rule.ok) : labels;
          for (const [label, rule] of rowsToShow) {
            ensure(lineH);
            if (rule.ok) doc.setTextColor(22, 101, 52);
            else doc.setTextColor(185, 28, 28);
            doc.text(rule.ok ? "✓" : "✗", 44, y);
            doc.setTextColor(0);
            const txt = doc.splitTextToSize(`${label} — ${rule.detail}`, pageW - 100) as string[];
            doc.text(txt, 60, y);
            y += lineH * Math.max(1, txt.length);
          }
          y += lineH / 2;
        }
      }

      // ── Footer page numbers ─────────────────────────────────────────
      const total = doc.getNumberOfPages();
      for (let p = 1; p <= total; p++) {
        doc.setPage(p);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(140);
        doc.text(`Page ${p} of ${total}`, pageW - 80, doc.internal.pageSize.getHeight() - 20);
      }

      const suffix = driftedOnly ? "-failing-only" : "";
      doc.save(`data-health-${systemDate}${suffix}.pdf`);
      toast({
        title: driftedOnly ? "Failing-only PDF exported" : "Audit PDF exported",
        description: `${breakdowns.length} bookings · ${issues.length} issues`,
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Export failed", description: e?.message });
    }
  };

  // Shared resolver used by both the CSV download and the preview modal so
  // what the user previews is exactly what gets written to disk.
  const resolveCsv = (
    opts: { driftedOnly?: boolean } = {},
  ):
    | { ok: true; rows: BookingBreakdown[]; selected: CsvCol[]; fname: string }
    | { ok: false; title: string; description: string; variant?: "destructive" } => {
    if (!report) return { ok: false, title: "No audit data", description: "Run an audit first." };
    const driftedOnly = !!opts.driftedOnly;
    const from = csvFrom.trim();
    const to = csvTo.trim();
    if (from && to && from > to) {
      return {
        ok: false,
        variant: "destructive",
        title: "Invalid date range",
        description: "“From” must be on or before “To”.",
      };
    }
    const inRange = (b: BookingBreakdown) => {
      if (!from && !to) return true;
      const d = csvDay(b.booking_date);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    };
    const allDrifted = report.bookingBreakdowns.filter((b) =>
      Object.values(b.rules).some((r) => !r.ok),
    );
    let rows = driftedOnly ? allDrifted : report.bookingBreakdowns;
    rows = rows.filter(inRange);
    if (rows.length === 0) {
      const why = driftedOnly
        ? from || to
          ? "No failing bookings booked in that window."
          : "No bookings currently fail any rule."
        : "No bookings booked in that window.";
      return { ok: false, title: "Nothing to export", description: why };
    }
    const selected =
      csvCols.length > 0
        ? (csvCols.map((k) => CSV_COLUMNS.find((c) => c.key === k)).filter(Boolean) as CsvCol[])
        : CSV_COLUMNS;
    if (selected.length === 0) {
      return {
        ok: false,
        title: "Pick at least one column",
        description: "Use the Columns picker to choose CSV fields.",
      };
    }
    const stamp = new Date(report.scannedAt).toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const rangeSlug = from || to ? `-${from || "min"}_to_${to || "max"}` : "";
    const fname = `data-health-breakdown${driftedOnly ? "-failing-only" : ""}${rangeSlug}-${stamp}.csv`;
    return { ok: true, rows, selected, fname };
  };

  const exportCsv = (opts: { driftedOnly?: boolean } = {}) => {
    const res = resolveCsv(opts);
    if (!res.ok) {
      toast({ variant: res.variant, title: res.title, description: res.description });
      return;
    }
    const { rows, selected, fname } = res;
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const meta = buildCsvMetadataHeader({
      source: `Data Health — Booking Breakdown${opts.driftedOnly ? " (failing only)" : ""}`,
      filters: {
        From: csvFrom || null,
        To: csvTo || null,
        Mode: opts.driftedOnly ? "failing only" : "all",
      },
      sort: { key: "booking_date", dir: "asc" },
      counts: { shown: rows.length, total: report?.bookingBreakdowns?.length ?? undefined },
      columns: selected.map((c) => ({ key: c.key, label: c.label })),
    });
    const lines = [selected.map((c) => esc(c.label)).join(",")];
    for (const b of rows) {
      lines.push(selected.map((c) => esc(c.get(b))).join(","));
    }
    const csv = "\uFEFF" + [...meta, "", ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({
      title: "CSV exported",
      description: `${rows.length} bookings · ${selected.length}/${CSV_COLUMNS.length} columns · ${fname}`,
    });
  };

  // Issues CSV — mirrors the on-screen Issues table. Uses the same row set
  // currently visible (severity filter + search + reviewed toggle) and the
  // same column selection from the Issues "Columns" picker, so PDF + CSV +
  // table all show the same fields. "Action" is non-printable and excluded.
  const exportIssuesCsv = () => {
    if (!report) {
      toast({
        variant: "destructive",
        title: "No audit yet",
        description: "Run an audit before exporting.",
      });
      return;
    }
    const rows = visible;
    if (rows.length === 0) {
      toast({ title: "Nothing to export", description: "No issues match the current filter." });
      return;
    }
    const defs: Array<{ key: string; label: string; get: (i: AuditIssue) => string | number }> = [
      { key: "severity", label: "Severity", get: (i) => i.severity },
      { key: "booking", label: "Booking", get: (i) => i.booking_id ?? "" },
      { key: "booking", label: "Client", get: (i) => i.client_name ?? "" },
      { key: "type", label: "Issue Type", get: (i) => i.type },
      { key: "description", label: "Description", get: (i) => i.description },
      { key: "detected", label: "Detected", get: (i) => new Date(i.detected_at).toISOString() },
    ];
    const { cols: issueCsvCols, valid: issueCsvValid } = sanitizeIssueVisibleCols(
      issueVisibleCols,
      ISSUE_ALL_KEYS,
    );
    if (!issueCsvValid) {
      toast({
        variant: "destructive",
        title: "Pick at least one column",
        description: "Use the Issues Columns picker to choose fields.",
      });
      return;
    }
    const selected = defs.filter((d) => issueCsvCols.has(d.key));
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const meta = buildCsvMetadataHeader({
      source: "Data Health — Issues",
      filters: {
        Severity: filter || null,
        Search: search || null,
        "Include reviewed": showReviewed ? "yes" : "no",
      },
      sort: { key: "detected_at", dir: "desc" },
      counts: { shown: rows.length, total: report?.issues?.length ?? undefined },
      columns: selected.map((c) => ({ key: c.key, label: c.label })),
    });
    const lines = [selected.map((c) => esc(c.label)).join(",")];
    for (const i of rows) lines.push(selected.map((c) => esc(c.get(i))).join(","));
    const csv = "\uFEFF" + [...meta, "", ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date(report.scannedAt).toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const fname = `data-health-issues-${stamp}.csv`;
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({
      title: "Issues CSV exported",
      description: `${rows.length} issues · ${selected.length} columns · ${fname}`,
    });
  };

  // CSV preview modal — shows the first rows and headers in a scrollable table
  // before any download happens. The preview uses the exact same resolver as
  // the download, so what the user sees is what gets written.
  const [previewState, setPreviewState] = useState<
    | { open: false }
    | {
        open: true;
        driftedOnly: boolean;
        rows: BookingBreakdown[];
        selected: CsvCol[];
        fname: string;
      }
  >({ open: false });
  const PREVIEW_LIMIT = 10;
  const openPreview = (driftedOnly: boolean) => {
    const res = resolveCsv({ driftedOnly });
    if (!res.ok) {
      toast({ variant: res.variant, title: res.title, description: res.description });
      return;
    }
    setPreviewState({
      open: true,
      driftedOnly,
      rows: res.rows,
      selected: res.selected,
      fname: res.fname,
    });
  };

  // Summary counts exclude reviewed issues by default. Toggling "show reviewed"
  // (or clearing reviewed marks) flips back to the raw scan totals. Because
  // `reviewed` comes from a React Query cache that markReviewed invalidates
  // on success, these counts recompute the moment an issue is marked.
  const effectiveTotals = useMemo(() => {
    if (!report) return undefined;
    if (showReviewed || reviewed.size === 0) return report.totals;
    let critical = 0,
      warning = 0,
      info = 0;
    const stillDirty = new Set<string>();
    for (const i of report.issues) {
      if (reviewed.has(i.id)) continue;
      if (i.severity === "CRITICAL") critical += 1;
      else if (i.severity === "WARNING") warning += 1;
      else info += 1;
      if (i.booking_id) stillDirty.add(i.booking_id);
    }
    const cleanBookings = Math.max(0, report.totals.totalBookings - stillDirty.size);
    return { critical, warning, info, cleanBookings, totalBookings: report.totals.totalBookings };
  }, [report, reviewed, showReviewed]);

  const totals = effectiveTotals;
  const isFetching = audit.isFetching;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Health"
        description="Continuous audit of every booking against strict accounting rules."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={runAuditJob} disabled={job.running}>
              <RefreshCw
                className={`h-4 w-4 mr-2 ${isFetching || (job.running && job.label.includes("audit")) ? "animate-spin" : ""}`}
              />{" "}
              Run Full Audit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportPdf()}
              disabled={!report || job.running}
            >
              <FileDown className="h-4 w-4 mr-2" /> Export Audit Report
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportPdf({ driftedOnly: true })}
              disabled={!report || job.running}
              title="Export only bookings that fail at least one rule (issue list, breakdown matrix, and drift detail are all filtered)"
            >
              <FileDown className="h-4 w-4 mr-2" /> Export Failing Only
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!report || job.running}
                  title="Choose which fields appear in both the PDF matrix and the CSV export"
                >
                  <Columns3 className="h-4 w-4 mr-2" /> PDF/CSV Columns ({csvCols.length}/
                  {CSV_COLUMNS.length}){csvFrom || csvTo ? " · 📅" : ""}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[420px] max-h-[70vh] overflow-y-auto p-0">
                <div className="sticky top-0 z-10 border-b bg-popover px-3 py-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">CSV columns</div>
                    <div className="flex items-center gap-1">
                      {(() => {
                        const filtered = CSV_COLUMNS.filter(csvColMatches);
                        const filteredKeys = filtered.map((c) => c.key);
                        const scope = csvColSearch.trim() ? filteredKeys : CSV_ALL_KEYS;
                        return (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs min-h-11 min-w-11"
                              disabled={scope.length === 0}
                              onClick={() => {
                                const set = new Set(csvCols);
                                scope.forEach((k) => set.add(k));
                                applySelection(set);
                              }}
                              title={
                                csvColSearch.trim()
                                  ? "Select all matching columns"
                                  : "Select all columns"
                              }
                            >
                              All
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs min-h-11 min-w-11"
                              disabled={scope.length === 0}
                              onClick={() => {
                                const set = new Set(csvCols);
                                scope.forEach((k) => set.delete(k));
                                applySelection(set);
                              }}
                              title={
                                csvColSearch.trim() ? "Clear matching columns" : "Clear all columns"
                              }
                            >
                              None
                            </Button>
                          </>
                        );
                      })()}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive min-h-11 min-w-11"
                        title="Clear saved search, scan window, and column selection — restores defaults"
                        disabled={
                          !csvColSearch &&
                          !csvFrom &&
                          !csvTo &&
                          csvCols.length === CSV_ALL_KEYS.length &&
                          csvCols.every((k, i) => k === CSV_ALL_KEYS[i])
                        }
                        onClick={() => {
                          setCsvColSearch("");
                          setCsvFrom("");
                          setCsvTo("");
                          setCsvCols(CSV_ALL_KEYS);
                          try {
                            localStorage.removeItem(CSV_COL_SEARCH_KEY);
                            localStorage.removeItem(CSV_FROM_KEY);
                            localStorage.removeItem(CSV_TO_KEY);
                            localStorage.removeItem(CSV_COLS_KEY);
                          } catch (err) {
                            console.error("[localStorage] write error", err);
                          }
                        }}
                      >
                        Reset
                      </Button>
                    </div>
                  </div>

                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      value={csvColSearch}
                      onChange={(e) => setCsvColSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          focusColByIndex(0);
                        } else if (e.key === "Escape" && csvColSearch) {
                          e.preventDefault();
                          setCsvColSearch("");
                        }
                      }}
                      placeholder="Search columns… (↓ to list)"
                      className="h-8 pl-7 pr-7 text-sm min-h-11"
                      aria-label="Search columns"
                    />
                    {csvColSearch && (
                      <button
                        type="button"
                        onClick={() => setCsvColSearch("")}
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted"
                        aria-label="Clear search"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {csvColSearch.trim() && (
                    <div className="text-[11px] text-muted-foreground">
                      {CSV_COLUMNS.filter(csvColMatches).length} of {CSV_COLUMNS.length} columns
                      match
                    </div>
                  )}
                </div>
                <div className="p-3 space-y-3">
                  <div className="rounded-md border bg-muted/20 p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Scan window
                      </div>
                      {(csvFrom || csvTo) && (
                        <button
                          type="button"
                          className="text-[11px] text-primary hover:underline"
                          onClick={() => {
                            setCsvFrom("");
                            setCsvTo("");
                          }}
                        >
                          Clear range
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs text-muted-foreground space-y-1">
                        <span>From</span>
                        <Input
                          type="date"
                          value={csvFrom}
                          max={csvTo || undefined}
                          onChange={(e) => setCsvFrom(e.target.value)}
                          className="h-8 min-h-11"
                        />
                      </label>
                      <label className="text-xs text-muted-foreground space-y-1">
                        <span>To</span>
                        <Input
                          type="date"
                          value={csvTo}
                          min={csvFrom || undefined}
                          onChange={(e) => setCsvTo(e.target.value)}
                          className="h-8 min-h-11"
                        />
                      </label>
                    </div>
                    {(() => {
                      if (!report) return null;
                      const from = csvFrom.trim(),
                        to = csvTo.trim();
                      if (!from && !to) {
                        return (
                          <div className="text-[11px] text-muted-foreground">
                            No date filter — all {report.bookingBreakdowns.length} bookings
                            included.
                          </div>
                        );
                      }
                      if (from && to && from > to) {
                        return (
                          <div className="text-[11px] text-destructive">
                            “From” must be on or before “To”.
                          </div>
                        );
                      }
                      const matched = report.bookingBreakdowns.filter((b) => {
                        const d = csvDay(b.booking_date);
                        if (!d) return false;
                        if (from && d < from) return false;
                        if (to && d > to) return false;
                        return true;
                      }).length;
                      return (
                        <div className="text-[11px] text-muted-foreground">
                          {matched} of {report.bookingBreakdowns.length} bookings match this window.
                        </div>
                      );
                    })()}
                  </div>

                  {csvCols.length > 0 && !csvColSearch.trim() && (
                    <div className="rounded-md border bg-muted/20 p-2 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Selected order ({csvCols.length})
                        </div>
                        <div className="text-[11px] text-muted-foreground">Drag to reorder</div>
                      </div>
                      <ul
                        role="listbox"
                        className="max-h-56 overflow-y-auto space-y-1"
                        aria-label="Selected columns — drag, or use Alt+↑/↓ to reorder, Delete to remove"
                      >
                        {csvCols.map((key, idx) => {
                          const col = CSV_COLUMNS.find((c) => c.key === key);
                          if (!col) return null;
                          const isDragged = dragIndex === idx;
                          const isOver =
                            dragOverIndex === idx && dragIndex !== null && dragIndex !== idx;
                          return (
                            <li
                              key={key}
                              draggable
                              onDragStart={(e) => {
                                setDragIndex(idx);
                                e.dataTransfer.effectAllowed = "move";
                                try {
                                  e.dataTransfer.setData("text/plain", key);
                                } catch {
                                  /* ignore */
                                }
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                                if (dragOverIndex !== idx) setDragOverIndex(idx);
                              }}
                              onDragLeave={() => {
                                if (dragOverIndex === idx) setDragOverIndex(null);
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                if (dragIndex !== null) moveCsvCol(dragIndex, idx);
                                setDragIndex(null);
                                setDragOverIndex(null);
                              }}
                              onDragEnd={() => {
                                setDragIndex(null);
                                setDragOverIndex(null);
                              }}
                              tabIndex={0}
                              data-csv-order={key}
                              role="option"
                              aria-label={`${col.label}, position ${idx + 1} of ${csvCols.length}. Alt+Arrow to reorder, Delete to remove.`}
                              onKeyDown={(e) => handleOrderKeyDown(e, key, idx)}
                              className={
                                "flex items-center gap-2 rounded border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/60 " +
                                (isDragged ? "opacity-50 " : "") +
                                (isOver
                                  ? "border-primary ring-1 ring-primary/40 "
                                  : "border-transparent ")
                              }
                            >
                              <GripVertical
                                className="h-3.5 w-3.5 text-muted-foreground cursor-grab shrink-0"
                                aria-hidden
                              />
                              <span className="w-5 text-right text-[11px] text-muted-foreground tabular-nums">
                                {idx + 1}
                              </span>
                              <span className="truncate flex-1">{col.label}</span>
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                {col.group}
                              </span>
                              <div className="flex items-center gap-0.5">
                                <button
                                  type="button"
                                  className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                                  onClick={() => moveCsvCol(idx, idx - 1)}
                                  disabled={idx === 0}
                                  aria-label={`Move ${col.label} up`}
                                  title="Move up"
                                >
                                  ▲
                                </button>
                                <button
                                  type="button"
                                  className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                                  onClick={() => moveCsvCol(idx, idx + 1)}
                                  disabled={idx === csvCols.length - 1}
                                  aria-label={`Move ${col.label} down`}
                                  title="Move down"
                                >
                                  ▼
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                      <div className="flex items-center justify-end">
                        <button
                          type="button"
                          className="text-[11px] text-primary hover:underline"
                          onClick={() =>
                            setCsvCols(CSV_ALL_KEYS.filter((k) => csvCols.includes(k)))
                          }
                          title="Restore the default registry order"
                        >
                          Reset to default order
                        </button>
                      </div>
                    </div>
                  )}

                  {(["Identity", "Money", "Balance", "Plan", "Risk", "Rules"] as const).map(
                    (group) => {
                      const cols = CSV_COLUMNS.filter((c) => c.group === group && csvColMatches(c));
                      if (cols.length === 0) return null;
                      const groupKeys = cols.map((c) => c.key);
                      const groupAllOn = groupKeys.every((k) => csvCols.includes(k));
                      return (
                        <div key={group}>
                          <div className="mb-1 flex items-center justify-between">
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {group}
                            </div>
                            <button
                              type="button"
                              className="text-[11px] text-primary hover:underline"
                              onClick={() => {
                                const set = new Set(csvCols);
                                if (groupAllOn) groupKeys.forEach((k) => set.delete(k));
                                else groupKeys.forEach((k) => set.add(k));
                                applySelection(set);
                              }}
                            >
                              {groupAllOn ? "Clear group" : "Select group"}
                            </button>
                          </div>
                          <div className="grid grid-cols-1 gap-1">
                            {cols.map((c) => (
                              <label
                                key={c.key}
                                className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted/40 focus-within:bg-muted/60 cursor-pointer"
                              >
                                <Checkbox
                                  data-csv-col={c.key}
                                  checked={csvCols.includes(c.key)}
                                  onCheckedChange={(v) => toggleCsvCol(c.key, !!v)}
                                  onKeyDown={(e) => handleColKeyDown(e, c.key)}
                                  aria-label={`${c.label} (${c.group})`}
                                />
                                <span>{c.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    },
                  )}
                  {csvColSearch.trim() && CSV_COLUMNS.filter(csvColMatches).length === 0 && (
                    <div className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
                      No columns match “{csvColSearch}”.
                    </div>
                  )}
                </div>
                <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 border-t bg-popover px-3 py-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!report || job.running || csvCols.length === 0}
                    onClick={() => openPreview(false)}
                    title="Preview the first rows before downloading"
                  >
                    <Eye className="h-4 w-4 mr-2" /> Preview
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!report || job.running || csvCols.length === 0}
                    onClick={() => openPreview(true)}
                    title="Preview failing-only rows before downloading"
                  >
                    <Eye className="h-4 w-4 mr-2" /> Preview failing
                  </Button>
                  <div className="mx-1 h-5 w-px bg-border" aria-hidden />
                  {(() => {
                    const bookingsCsvInput = (driftedOnly: boolean) => () => {
                      const selected =
                        csvCols.length > 0
                          ? (csvCols
                              .map((k) => CSV_COLUMNS.find((c) => c.key === k))
                              .filter(Boolean) as CsvCol[])
                          : CSV_COLUMNS;
                      return {
                        source: `Data Health — Booking Breakdown${driftedOnly ? " (failing only)" : ""}`,
                        filters: {
                          From: csvFrom || null,
                          To: csvTo || null,
                          Mode: driftedOnly ? "failing only" : "all",
                        },
                        sort: { key: "booking_date", dir: "asc" as const },
                        counts: { total: report?.bookingBreakdowns?.length ?? undefined },
                        columns: selected.map((c) => ({ key: c.key, label: c.label })),
                      };
                    };
                    return (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!report || job.running || csvCols.length === 0}
                          onClick={() =>
                            requestCsvExport({
                              label: "the failing-only Bookings CSV",
                              input: bookingsCsvInput(true),
                              onConfirm: () => exportCsv({ driftedOnly: true }),
                            })
                          }
                        >
                          <FileDown className="h-4 w-4 mr-2" /> Failing only
                        </Button>
                        <Button
                          size="sm"
                          disabled={!report || job.running || csvCols.length === 0}
                          onClick={() =>
                            requestCsvExport({
                              label: "the Bookings CSV",
                              input: bookingsCsvInput(false),
                              onConfirm: () => exportCsv(),
                            })
                          }
                        >
                          <FileDown className="h-4 w-4 mr-2" /> Download CSV
                        </Button>
                        <CsvExportMetadataPreview
                          label="the Bookings CSV"
                          input={bookingsCsvInput(false)}
                        />
                      </>
                    );
                  })()}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        }
      />

      <Dialog
        open={previewState.open}
        onOpenChange={(o) => {
          if (!o) setPreviewState({ open: false });
        }}
      >
        <DialogContent className="max-w-5xl">
          {previewState.open &&
            (() => {
              const { rows, selected, fname, driftedOnly } = previewState;
              const shown = rows.slice(0, PREVIEW_LIMIT);
              const hidden = Math.max(0, rows.length - shown.length);
              const visibleSelected = selected.filter((c) => isPreviewColVis(c.key));
              return (
                <>
                  <DialogHeader>
                    <DialogTitle>CSV preview {driftedOnly ? "· failing only" : ""}</DialogTitle>
                    <DialogDescription>
                      Showing first {shown.length} of {rows.length} row
                      {rows.length === 1 ? "" : "s"} · {visibleSelected.length}/{selected.length}{" "}
                      preview columns ({selected.length}/{CSV_COLUMNS.length} in CSV) ·{" "}
                      <span className="font-mono">{fname}</span>
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground">
                      Hide columns from this preview only — does not affect the downloaded CSV.
                    </div>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs min-h-11 min-w-11"
                          title="Show/hide preview columns"
                        >
                          <Columns3 className="h-3.5 w-3.5 mr-1" />
                          Preview columns ({visibleSelected.length}/{selected.length})
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-64 p-0">
                        <div className="sticky top-0 z-10 border-b bg-popover px-3 py-2 flex items-center justify-between">
                          <div className="text-sm font-medium">Preview columns</div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs min-h-11 min-w-11"
                              onClick={() => persistPreviewHidden(new Set())}
                            >
                              All
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs min-h-11 min-w-11"
                              onClick={() => {
                                try {
                                  localStorage.removeItem(PREVIEW_VIS_KEY);
                                } catch {
                                  /* ignore */
                                }
                                setPreviewHiddenColsState(new Set());
                              }}
                              title="Reset to default (all visible) and clear saved layout"
                            >
                              Reset
                            </Button>
                          </div>
                        </div>
                        <div className="p-2 space-y-1 max-h-72 overflow-y-auto">
                          {selected.map((c) => (
                            <label
                              key={c.key}
                              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted cursor-pointer text-sm"
                            >
                              <Checkbox
                                checked={isPreviewColVis(c.key)}
                                onCheckedChange={() => togglePreviewCol(c.key, selected.length)}
                              />
                              <span>{c.label}</span>
                            </label>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="rounded-md border max-h-[60vh] overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-muted/60 backdrop-blur">
                        <TableRow>
                          {visibleSelected.map((c) => (
                            <TableHead key={c.key} className="whitespace-nowrap text-xs">
                              {c.label}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {shown.map((b, i) => (
                          <TableRow key={(b.booking_id ?? "") + i}>
                            {visibleSelected.map((c) => {
                              const v = c.get(b);
                              const s = v === null || v === undefined ? "" : String(v);
                              return (
                                <TableCell
                                  key={c.key}
                                  className="whitespace-nowrap text-xs font-mono"
                                  title={s}
                                >
                                  {s.length > 80
                                    ? s.slice(0, 80) + "…"
                                    : s || <span className="text-muted-foreground">—</span>}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {hidden > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {hidden} more row{hidden === 1 ? "" : "s"} will be included in the download.
                    </div>
                  )}
                  <DialogFooter className="gap-2 sm:gap-2">
                    <Button variant="outline" onClick={() => setPreviewState({ open: false })}>
                      Close
                    </Button>
                    <CsvExportMetadataPreview
                      label={`the ${driftedOnly ? "failing-only " : ""}Bookings CSV`}
                      input={{
                        source: `Data Health — Booking Breakdown${driftedOnly ? " (failing only)" : ""}`,
                        filters: {
                          From: csvFrom || null,
                          To: csvTo || null,
                          Mode: driftedOnly ? "failing only" : "all",
                        },
                        sort: { key: "booking_date", dir: "asc" },
                        counts: {
                          shown: rows.length,
                          total: report?.bookingBreakdowns?.length ?? undefined,
                        },
                        columns: selected.map((c) => ({ key: c.key, label: c.label })),
                      }}
                    />
                    <Button
                      onClick={() => {
                        const input = {
                          source: `Data Health — Booking Breakdown${driftedOnly ? " (failing only)" : ""}`,
                          filters: {
                            From: csvFrom || null,
                            To: csvTo || null,
                            Mode: driftedOnly ? "failing only" : "all",
                          },
                          sort: { key: "booking_date", dir: "asc" as const },
                          counts: {
                            shown: rows.length,
                            total: report?.bookingBreakdowns?.length ?? undefined,
                          },
                          columns: selected.map((c) => ({ key: c.key, label: c.label })),
                        };
                        requestCsvExport({
                          label: `the ${driftedOnly ? "failing-only " : ""}Bookings CSV`,
                          input,
                          onConfirm: () => {
                            exportCsv({ driftedOnly });
                            setPreviewState({ open: false });
                          },
                        });
                      }}
                    >
                      <FileDown className="h-4 w-4 mr-2" /> Download CSV
                    </Button>
                  </DialogFooter>
                </>
              );
            })()}
        </DialogContent>
      </Dialog>

      <JobProgressBanner job={job} />

      {/* System date control */}
      <div className="rounded-lg border bg-card p-4 flex flex-wrap items-end gap-4">
        <div>
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" />
            System Date
          </div>
          <div className="text-lg font-semibold tabular-nums">{systemDate}</div>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">
              Override (YYYY-MM-DD)
            </label>
            <Input
              type="date"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
              className="h-9 w-44"
            />
          </div>
          <Button size="sm" onClick={applyOverride}>
            Apply
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await setSystemDateOverride(null);
              setOverride("");
              audit.refetch();
            }}
          >
            Clear
          </Button>
        </div>
        <div className="ml-auto">
          <Button size="sm" variant="default" onClick={runRecomputeAll} disabled={job.running}>
            <Calculator className="h-4 w-4 mr-2" />
            {job.running && job.label.startsWith("Recomputing all")
              ? "Recomputing…"
              : "Recompute all bookings (FIFO)"}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard
          label="Critical Issues"
          value={totals?.critical ?? 0}
          sev="CRITICAL"
          onClick={() => setFilter(filter === "CRITICAL" ? "" : "CRITICAL")}
          active={filter === "CRITICAL"}
          note="Invariant violations — fix immediately"
        />
        <SummaryCard
          label="Warnings"
          value={totals?.warning ?? 0}
          sev="WARNING"
          onClick={() => setFilter(filter === "WARNING" ? "" : "WARNING")}
          active={filter === "WARNING"}
          note="Inconsistencies that need review"
        />
        <SummaryCard
          label="Info"
          value={totals?.info ?? 0}
          sev="INFO"
          onClick={() => setFilter(filter === "INFO" ? "" : "INFO")}
          active={filter === "INFO"}
          note="Minor items (placeholders, refs)"
        />
        <CleanCard total={totals?.totalBookings ?? 0} clean={totals?.cleanBookings ?? 0} />
      </div>

      {/* Filters + table */}
      <div className="rounded-lg border bg-card">
        <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="text-sm font-medium">Issues ({visible.length})</div>
            {filter && (
              <Badge variant="outline" className="text-xs">
                Filter: {SEV_META[filter].label}{" "}
                <button className="ml-1.5" onClick={() => setFilter("")}>
                  ✕
                </button>
              </Badge>
            )}
            {reviewed.size > 0 && (
              <Badge variant="outline" className="text-xs">
                {reviewed.size} reviewed{showReviewed ? " (shown)" : " (hidden)"}
                <button className="ml-1.5 underline" onClick={() => setShowReviewed((v) => !v)}>
                  {showReviewed ? "hide" : "show"}
                </button>
                <ConfirmDeleteDialog
                  trigger={
                    <button className="ml-1.5 underline" disabled={clearAllReviewed.isPending}>
                      clear all
                    </button>
                  }
                  title="Clear all reviewed marks?"
                  description={`Are you sure? This cannot be undone. ${reviewed.size} reviewed issue${reviewed.size === 1 ? "" : "s"} will be un-marked.`}
                  confirmLabel="Clear reviewed marks"
                  onConfirm={() => clearAllReviewed.mutateAsync()}
                />
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs min-h-11 min-w-11"
                  title="Show/hide table columns"
                >
                  <Columns3 className="h-3.5 w-3.5 mr-1" />
                  Columns ({issueVisibleCols.size}/{ISSUE_ALL_KEYS.length})
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-60 p-0">
                <div className="sticky top-0 z-10 border-b bg-popover px-3 py-2 flex items-center justify-between">
                  <div className="text-sm font-medium">Visible columns</div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs min-h-11 min-w-11"
                      onClick={() => persistIssueVisible(new Set(ISSUE_ALL_KEYS))}
                    >
                      All
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs min-h-11 min-w-11"
                      onClick={() => {
                        try {
                          localStorage.removeItem(ISSUE_VIS_KEY);
                        } catch {
                          /* ignore */
                        }
                        setIssueVisibleColsState(new Set(ISSUE_ALL_KEYS));
                      }}
                      title="Reset to default (all visible) and clear saved layout"
                    >
                      Reset
                    </Button>
                  </div>
                </div>
                <div className="p-2 space-y-1 max-h-72 overflow-y-auto">
                  {ISSUE_COLS.map((c) => (
                    <label
                      key={c.key}
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted cursor-pointer text-sm"
                    >
                      <Checkbox
                        checked={isIssueColVis(c.key)}
                        onCheckedChange={() => toggleIssueCol(c.key)}
                      />
                      <span>{c.label}</span>
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            {(() => {
              const issuesCsvInput = () => {
                const issueDefs = [
                  { key: "severity", label: "Severity" },
                  { key: "booking", label: "Booking" },
                  { key: "booking", label: "Client" },
                  { key: "type", label: "Issue Type" },
                  { key: "description", label: "Description" },
                  { key: "detected", label: "Detected" },
                ];
                const { cols } = sanitizeIssueVisibleCols(issueVisibleCols, ISSUE_ALL_KEYS);
                const selected = issueDefs.filter((d) => cols.has(d.key));
                return {
                  source: "Data Health — Issues",
                  filters: {
                    Severity: filter || null,
                    Search: search || null,
                    "Include reviewed": showReviewed ? "yes" : "no",
                  },
                  sort: { key: "detected_at", dir: "desc" as const },
                  counts: { shown: visible.length, total: report?.issues?.length ?? undefined },
                  columns: selected.map((c) => ({ key: c.key, label: c.label })),
                };
              };
              return (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs min-h-11 min-w-11"
                    onClick={() =>
                      requestCsvExport({
                        label: "the Issues CSV",
                        input: issuesCsvInput,
                        onConfirm: exportIssuesCsv,
                      })
                    }
                    disabled={!report || visible.length === 0}
                    title="Download the currently filtered issues using the same column selection as the table"
                  >
                    <FileDown className="h-3.5 w-3.5 mr-1" />
                    Export CSV
                  </Button>
                  <CsvExportMetadataPreview label="the Issues CSV" input={issuesCsvInput} />
                </>
              );
            })()}

            <Input
              placeholder="Search booking / client / issue…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-64 min-h-11"
            />
          </div>
        </div>

        {audit.isLoading ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Scanning bookings…
          </div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <CheckCircle2 className="h-10 w-10 mx-auto text-success mb-2" />
            <div className="text-sm font-medium">All clean</div>
            <div className="text-xs text-muted-foreground">
              No issues found with the current filter.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  {isIssueColVis("severity") && (
                    <th className="text-left px-3 py-2 w-24">Severity</th>
                  )}
                  {isIssueColVis("booking") && (
                    <th className="text-left px-3 py-2 w-32">Booking</th>
                  )}
                  {isIssueColVis("type") && (
                    <th className="text-left px-3 py-2 w-44">Issue Type</th>
                  )}
                  {isIssueColVis("description") && (
                    <th className="text-left px-3 py-2">Description</th>
                  )}
                  {isIssueColVis("detected") && (
                    <th className="text-left px-3 py-2 w-32">Detected</th>
                  )}
                  {isIssueColVis("action") && <th className="text-right px-3 py-2 w-56">Action</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((i) => (
                  <IssueRow
                    key={i.id}
                    issue={i}
                    visibleCols={issueVisibleCols}
                    onRecalc={(b) => runRecalcOne(b)}
                    onReviewed={() => markReviewed.mutate(i)}
                    onDiff={openDiff}
                    pending={job.running && job.label === `Recalculating ${i.booking_id}`}
                    alreadyReviewed={reviewed.has(i.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <BreakdownPanel
        breakdowns={report?.bookingBreakdowns ?? []}
        failingOnly={failingOnly}
        setFailingOnly={setFailingOnly}
        selectedCsvCols={csvCols}
      />

      <IssueDiffDrawer
        open={diffOpen}
        onOpenChange={setDiffOpen}
        issue={diffIssue}
        previousSnapshot={previousSnapshot}
        currentScannedAt={report?.scannedAt ?? null}
      />
      {csvConfirmDialog}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sev,
  onClick,
  active,
  note,
}: {
  label: string;
  value: number;
  sev: Severity;
  onClick: () => void;
  active: boolean;
  note: string;
}) {
  const meta = SEV_META[sev];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-lg border p-4 transition-colors ${meta.cls} ${active ? "ring-2 ring-offset-1 ring-current/40" : ""}`}
    >
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide font-semibold">
        <meta.Icon className="h-4 w-4" /> {label}
      </div>
      <div className="text-3xl font-bold tabular-nums mt-1">{value}</div>
      <div className="text-[11px] opacity-80 mt-1">{note}</div>
    </button>
  );
}

function CleanCard({ total, clean }: { total: number; clean: number }) {
  const pct = total ? Math.round((clean / total) * 100) : 100;
  return (
    <div className="rounded-lg border p-4 border-success/40 bg-success/10 dark:bg-success/20 text-success">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide font-semibold">
        <CheckCircle2 className="h-4 w-4" /> Bookings Clean
      </div>
      <div className="text-3xl font-bold tabular-nums mt-1">
        {clean} <span className="text-base font-medium opacity-70">/ {total}</span>
      </div>
      <div className="text-[11px] opacity-80 mt-1">{pct}% verified fully consistent</div>
    </div>
  );
}

function IssueRow({
  issue,
  visibleCols,
  onRecalc,
  onReviewed,
  onDiff,
  pending,
  alreadyReviewed = false,
}: {
  issue: AuditIssue;
  visibleCols: Set<string>;
  onRecalc: (b: string) => void;
  onReviewed: (id: string) => void;
  onDiff: (issue: AuditIssue) => void;
  pending: boolean;
  alreadyReviewed?: boolean;
}) {
  const meta = SEV_META[issue.severity];
  const vis = (k: string) => visibleCols.has(k);
  return (
    <tr className="border-t hover:bg-muted/30">
      {vis("severity") && (
        <td className="px-3 py-2">
          <span
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold border ${meta.cls}`}
          >
            <meta.Icon className="h-3 w-3" /> {meta.label}
          </span>
        </td>
      )}
      {vis("booking") && (
        <td className="px-3 py-2">
          {issue.booking_id ? (
            <Link
              to={`/bookings/${issue.booking_id}`}
              className="font-mono text-xs text-primary hover:underline inline-flex items-center gap-1"
            >
              {issue.booking_id} <ExternalLink className="h-3 w-3" />
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
          {issue.client_name && (
            <div className="text-[11px] text-muted-foreground capitalize truncate max-w-[160px]">
              {issue.client_name}
            </div>
          )}
        </td>
      )}
      {vis("type") && <td className="px-3 py-2 font-medium">{issue.type}</td>}
      {vis("description") && (
        <td className="px-3 py-2 text-muted-foreground">{issue.description}</td>
      )}
      {vis("detected") && (
        <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
          {new Date(issue.detected_at).toLocaleTimeString()}
        </td>
      )}
      {vis("action") && (
        <td className="px-3 py-2 text-right">
          <div className="inline-flex gap-1">
            {issue.booking_id && (
              <>
                <Button asChild size="sm" variant="ghost" className="h-7 px-2 min-h-11 min-w-11">
                  <Link to={`/bookings/${issue.booking_id}`}>
                    <Eye className="h-3.5 w-3.5 mr-1" />
                    View
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 min-h-11 min-w-11"
                  disabled={pending}
                  onClick={() => onRecalc(issue.booking_id!)}
                >
                  <Calculator className={`h-3.5 w-3.5 mr-1 ${pending ? "animate-pulse" : ""}`} />
                  Recalc
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 min-h-11 min-w-11"
              disabled={alreadyReviewed}
              onClick={() => onReviewed(issue.id)}
            >
              <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
              {alreadyReviewed ? "Reviewed" : "Mark Reviewed"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 min-h-11 min-w-11"
              onClick={() => onDiff(issue)}
              title="Compare this issue against the previous audit run"
            >
              <GitCompare className="h-3.5 w-3.5 mr-1" />
              View diff
            </Button>
          </div>
        </td>
      )}
    </tr>
  );
}

function JobProgressBanner({ job }: { job: ReturnType<typeof useBackgroundJob> }) {
  if (!job.running && !job.error && job.stage !== "Cancelled") return null;
  const pct =
    job.total > 0
      ? Math.min(100, Math.round((job.current / job.total) * 100))
      : job.running
        ? undefined
        : 100;
  const elapsed = job.startedAt ? Math.max(0, Math.round((Date.now() - job.startedAt) / 1000)) : 0;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-lg border p-3 flex items-center gap-3 text-sm ${
        job.error
          ? "border-destructive/40 bg-destructive/10 dark:bg-destructive/20 text-destructive"
          : "border-primary/30 bg-primary/5"
      }`}
    >
      {job.running ? (
        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
      ) : (
        <CheckCircle2 className="h-4 w-4 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium truncate">{job.label}</div>
          <div className="text-xs text-muted-foreground tabular-nums shrink-0">
            {job.total > 0 ? `${job.current}/${job.total}` : ""}
            {job.running ? ` · ${elapsed}s` : ""}
          </div>
        </div>
        <div className="text-xs text-muted-foreground truncate mt-0.5">
          {job.error ?? job.stage}
        </div>
        {pct != null && <Progress value={pct} className="h-1.5 mt-2" />}
      </div>
      {job.running ? (
        <Button size="sm" variant="ghost" className="h-7 min-h-11 min-w-11" onClick={job.cancel}>
          <X className="h-3.5 w-3.5 mr-1" />
          Cancel
        </Button>
      ) : (
        <Button size="sm" variant="ghost" className="h-7 min-h-11 min-w-11" onClick={job.reset}>
          Dismiss
        </Button>
      )}
    </div>
  );
}

const BREAKDOWN_RULE_DEFS: Array<{
  key: keyof BookingBreakdown["rules"];
  label: string;
  tip: string;
}> = [
  { key: "rule5_plan_identity", label: "R5", tip: "Plan = Contract" },
  { key: "rule6_overdue_le_balance", label: "R6", tip: "Overdue ≤ Balance" },
  { key: "risk_level", label: "Risk", tip: "Risk level matches age" },
  { key: "completed_zero_balance", label: "Cmp=0", tip: "Completed ⇒ Balance 0" },
  { key: "no_negative_balance", label: "Neg≥0", tip: "No negative ledger row" },
  { key: "cached_balance_matches_live", label: "Bal=", tip: "Cached Balance = Live" },
  { key: "cached_overdue_matches_live", label: "OD=", tip: "Cached Overdue = Live" },
];

// On-screen columns for the parity/breakdown matrix. Rule columns are
// handled separately via BREAKDOWN_RULE_DEFS (a single toggle below).
const BREAKDOWN_BASE_COLS: Array<{ key: string; label: string }> = [
  { key: "booking", label: "Booking" },
  { key: "client", label: "Client" },
  { key: "contract", label: "Contract" },
  { key: "cash", label: "Cash" },
  { key: "adj", label: "Adj" },
  { key: "live_bal", label: "Live Bal" },
  { key: "cached_bal", label: "Cached Bal" },
  { key: "live_od", label: "Live OD (n)" },
  { key: "cached_od", label: "Cached OD (n)" },
];
const BREAKDOWN_ALL_KEYS = [...BREAKDOWN_BASE_COLS.map((c) => c.key), "rules"];
const BREAKDOWN_VIS_KEY = "datahealth.breakdownVisibleCols";

function BreakdownPanel({
  breakdowns,
  failingOnly,
  setFailingOnly,
  selectedCsvCols,
}: {
  breakdowns: BookingBreakdown[];
  failingOnly: boolean;
  setFailingOnly: (v: boolean) => void;
  selectedCsvCols: string[];
}) {
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  const isFailing = (b: BookingBreakdown) => Object.values(b.rules).some((r) => !r.ok);
  const rows = useMemo(
    () => (failingOnly ? breakdowns.filter(isFailing) : breakdowns),
    [breakdowns, failingOnly],
  );
  const totalFailing = useMemo(() => breakdowns.filter(isFailing).length, [breakdowns]);

  // Visibility is driven by the shared PDF/CSV Columns picker so the same
  // selection controls the on-screen table and the exports. Empty = all.
  const csvSet = useMemo(
    () => new Set(selectedCsvCols.length > 0 ? selectedCsvCols : CSV_ALL_KEYS),
    [selectedCsvCols],
  );
  // Map on-screen breakdown columns → underlying CSV keys.
  const BREAKDOWN_TO_CSV: Record<string, string[]> = {
    booking: ["booking_id"],
    client: ["client"],
    contract: ["contract"],
    cash: ["cash"],
    adj: ["adj"],
    live_bal: ["live_bal"],
    cached_bal: ["cached_bal"],
    live_od: ["live_od_amt", "live_od_cnt"],
    cached_od: ["cached_od_amt", "cached_od_cnt"],
  };
  const isVis = (k: string) => (BREAKDOWN_TO_CSV[k] ?? []).some((c) => csvSet.has(c));
  // Per-rule on/off mirrors the rule columns in CSV_COLUMNS.
  const RULE_CSV_KEY: Record<string, string> = {
    rule5_plan_identity: "r5",
    rule6_overdue_le_balance: "r6",
    risk_level: "risk_ok",
    completed_zero_balance: "comp_ok",
    no_negative_balance: "neg_ok",
    cached_balance_matches_live: "bal_match",
    cached_overdue_matches_live: "od_match",
  };
  const isRuleVis = (rk: string) => csvSet.has(RULE_CSV_KEY[rk] ?? "");
  const visibleRules = BREAKDOWN_RULE_DEFS.filter((rd) => isRuleVis(rd.key as string));
  const visibleBaseCount = BREAKDOWN_BASE_COLS.filter((c) => isVis(c.key)).length;

  return (
    <div className="rounded-lg border bg-card">
      <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="text-sm font-medium">
            Per-booking Matrix &amp; Drift Detail ({rows.length})
          </div>
          <Badge variant="outline" className="text-xs">
            {totalFailing} failing / {breakdowns.length} total
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant="outline"
            className="text-[11px] font-normal text-muted-foreground"
            title="On-screen columns are synced with the PDF/CSV Columns picker above. Change the selection there to show or hide columns here."
          >
            <Columns3 className="h-3 w-3 mr-1" />
            Columns: {visibleBaseCount}/{BREAKDOWN_BASE_COLS.length}
            {visibleRules.length > 0
              ? ` · Rules ${visibleRules.length}/${BREAKDOWN_RULE_DEFS.length}`
              : " · Rules off"}
            <span className="ml-1 opacity-70">(synced with PDF/CSV picker)</span>
          </Badge>
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            {/* allow-small-tap: native checkbox inside a full-width <label> that expands the tap area */}
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={failingOnly}
              onChange={(e) => setFailingOnly(e.target.checked)}
            />
            Failing only
          </label>
        </div>
      </div>

      {breakdowns.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
          Run a full audit to populate the breakdown.
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <CheckCircle2 className="h-8 w-8 mx-auto text-success mb-2" />
          <div className="text-sm font-medium">No failing bookings</div>
          <div className="text-xs text-muted-foreground">
            Uncheck "Failing only" to see all bookings.
          </div>
        </div>
      ) : (
        <>
          {/* Matrix */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 uppercase tracking-wide text-muted-foreground">
                <tr>
                  {isVis("booking") && <th className="text-left px-3 py-2">Booking</th>}
                  {isVis("client") && <th className="text-left px-3 py-2">Client</th>}
                  {isVis("contract") && <th className="text-right px-3 py-2">Contract</th>}
                  {isVis("cash") && <th className="text-right px-3 py-2">Cash</th>}
                  {isVis("adj") && <th className="text-right px-3 py-2">Adj</th>}
                  {isVis("live_bal") && <th className="text-right px-3 py-2">Live Bal</th>}
                  {isVis("cached_bal") && <th className="text-right px-3 py-2">Cached Bal</th>}
                  {isVis("live_od") && <th className="text-right px-3 py-2">Live OD (n)</th>}
                  {isVis("cached_od") && <th className="text-right px-3 py-2">Cached OD (n)</th>}
                  {visibleRules.map((rd) => (
                    <th key={rd.key} className="text-center px-2 py-2" title={rd.tip}>
                      {rd.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.booking_id} className="border-t hover:bg-muted/30">
                    {isVis("booking") && (
                      <td className="px-3 py-2">
                        <Link
                          to={`/bookings/${b.booking_id}`}
                          className="font-mono text-primary hover:underline"
                        >
                          {b.booking_id}
                        </Link>
                      </td>
                    )}
                    {isVis("client") && (
                      <td className="px-3 py-2 capitalize truncate max-w-[160px]">
                        {b.client_name ?? "—"}
                      </td>
                    )}
                    {isVis("contract") && (
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(b.contract_value)}</td>
                    )}
                    {isVis("cash") && (
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(b.cash_received)}</td>
                    )}
                    {isVis("adj") && (
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmt(b.adjustment_credit)}
                      </td>
                    )}
                    {isVis("live_bal") && (
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(b.live_balance)}</td>
                    )}
                    {isVis("cached_bal") && (
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(b.cached_balance)}</td>
                    )}
                    {isVis("live_od") && (
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmt(b.live_overdue_amount)} ({b.live_overdue_count})
                      </td>
                    )}
                    {isVis("cached_od") && (
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmt(b.cached_overdue_amount)} ({b.cached_overdue_count})
                      </td>
                    )}
                    {visibleRules.map((rd) => {
                      const ok = b.rules[rd.key].ok;
                      return (
                        <td
                          key={rd.key}
                          className="px-2 py-2 text-center"
                          title={b.rules[rd.key].detail}
                        >
                          <span className={ok ? "text-success" : "text-destructive font-bold"}>
                            {ok ? "✓" : "✗"}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Drift detail */}
          <div className="border-t px-4 py-3 bg-muted/20">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Drift Detail {failingOnly ? "(failing rules only)" : ""}
            </div>
            <div className="space-y-3">
              {rows
                .filter((b) => isFailing(b))
                .map((b) => (
                  <div key={b.booking_id} className="rounded border bg-card p-3">
                    <div className="flex items-center justify-between mb-2">
                      <Link
                        to={`/bookings/${b.booking_id}`}
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {b.booking_id}{" "}
                        <span className="text-muted-foreground capitalize">
                          · {b.client_name ?? "—"}
                        </span>
                      </Link>
                      <Badge variant="destructive" className="text-[10px]">
                        {Object.values(b.rules).filter((r) => !r.ok).length} failing rule(s)
                      </Badge>
                    </div>
                    <ul className="space-y-1 text-xs">
                      {BREAKDOWN_RULE_DEFS.filter((rd) => !b.rules[rd.key].ok).map((rd) => (
                        <li key={rd.key} className="flex gap-2">
                          <span className="text-destructive font-bold shrink-0">✗</span>
                          <span className="font-medium shrink-0 w-20">{rd.label}</span>
                          <span className="text-muted-foreground">{b.rules[rd.key].detail}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              {rows.filter((b) => isFailing(b)).length === 0 && (
                <div className="text-xs text-muted-foreground italic">
                  No failing rules in the current view.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
