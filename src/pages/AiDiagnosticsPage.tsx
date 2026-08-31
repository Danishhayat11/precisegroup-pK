import { useEffect, useMemo, useRef, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  buildJsonExportMetadata,
  prefixCsvWithMetadata,
  type CsvMetadataInput,
  JSON_ENVELOPE_SCHEMA,
  JSON_ENVELOPE_VERSION,
} from "@/lib/csvExportMetadata";
import { applyAiDiagnosticsFilters } from "./aiDiagnosticsQuery";
import { useAiDiagnosticsSort, SORT_STORAGE_KEY } from "./aiDiagnosticsSort";
import {
  isGatewayErrorRow as isGatewayErrorRowFn,
  buildGatewayErrorPayload as buildGatewayErrorPayloadFn,
  type GatewayPayloadFormat,
} from "./aiDiagnosticsGatewayPayload";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Loader2,
  ChevronLeft,
  ChevronRight,
  X,
  ArrowDown,
  ArrowUp,
  Maximize2,
  Download,
  Link2,
  Check,
  Eye,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SortableColumnHeader } from "@/components/ai-diagnostics/SortableColumnHeader";
import { FilterPresetsMenu } from "@/components/ai-diagnostics/FilterPresetsMenu";
import { ExportColumnsMenu } from "@/components/ai-diagnostics/ExportColumnsMenu";
import {
  BackgroundExportsPanel,
  type ExportJob,
} from "@/components/ai-diagnostics/BackgroundExportsPanel";
import type { PresetFilterState } from "./aiDiagnosticsPresets";
import { toSearchPatch } from "./aiDiagnosticsPresets";
import { callRpc } from "@/integrations/supabase/approvedRpc";
import {
  getFilteredExportColumns,
  loadSelectedColumnKeys,
  type ExportColumnKey,
} from "./aiDiagnosticsExportColumns";

interface Row {
  id: string;
  created_at: string;
  request_id: string;
  round: number;
  tool_name: string | null;
  tool_args: unknown;
  tool_result: unknown;
  success: boolean;
  error_message: string | null;
  duration_ms: number | null;
  gateway_status: number | null;
  gateway_model: string | null;
  retry_strategy: string | null;
  in_flight: boolean | null;
  completed_at: string | null;
}

type StatusFilter = "all" | "success" | "tool-error" | "gateway-error" | "all-errors" | "in-flight";
type RetryFilter = "all" | "primary" | "sanitized" | "safe-default" | "non-primary";
type SortKey = "time" | "status" | "tool";
type SortDir = "asc" | "desc";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

/**
 * Developer-only diagnostics view for the AI assistant.
 *
 * Reads the append-only `ai_tool_call_log` table (admin-gated by RLS) and
 * shows the most recent tool calls, their arguments, results, and gateway
 * status. Rows on the current page are grouped by `request_id` for display.
 *
 * Filtering, searching, sorting and pagination all run SERVER-SIDE via
 * PostgREST — the browser only ever holds one page of rows, so the view
 * stays fast even when the log has millions of entries.
 */
const routeApi = getRouteApi("/_authenticated/admin/ai-diagnostics");

export default function AiDiagnosticsPage() {
  // URL-backed state. `validateSearch` in the route file drops any unknown
  // keys and coerces types, so `sp` is always well-formed here.
  const sp = routeApi.useSearch();
  const navigate = routeApi.useNavigate();

  // Merge a partial update into the URL. Empty / default values are stripped
  // via `undefined` so shared links stay short and readable.
  const patchSearch = (patch: Record<string, string | number | undefined>) => {
    void navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => {
        const next: Record<string, unknown> = { ...prev, ...patch };
        for (const k of Object.keys(next)) {
          if (next[k] === undefined) delete next[k];
        }
        return next;
      }) as never,
      replace: true,
    });
  };

  const [rows, setRows] = useState<Row[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Debug mode -------------------------------------------------------
  // When on, every table load ALSO runs an `EXPLAIN (ANALYZE, BUFFERS)` on
  // the equivalent Postgres query (via the admin-only `explain_ai_tool_
  // call_log` RPC) and renders the plan below the toolbar. Off by default;
  // the toggle is admin-only in practice because the RPC checks the role
  // itself and returns an "admin role required" error otherwise.
  const [debugMode, setDebugMode] = useState(false);
  const [debugPlan, setDebugPlan] = useState<string | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);
  const [debugTookMs, setDebugTookMs] = useState<number | null>(null);

  // Filters
  const search = sp.q ?? "";
  const setSearch = (v: string) => patchSearch({ q: v.trim() ? v : undefined });
  const status: StatusFilter = sp.status ?? "all";
  const setStatus = (v: StatusFilter) => patchSearch({ status: v === "all" ? undefined : v });
  const retry: RetryFilter = sp.retry ?? "all";
  const setRetry = (v: RetryFilter) => patchSearch({ retry: v === "all" ? undefined : v });
  const toolName = sp.tool ?? "all";
  const setToolName = (v: string) => patchSearch({ tool: v === "all" ? undefined : v });

  // Pagination (row-level — server does the slicing).
  const page = sp.page ?? 1;
  const setPage = (updater: number | ((prev: number) => number)) => {
    const next = typeof updater === "function" ? updater(page) : updater;
    patchSearch({ page: next <= 1 ? undefined : next });
  };
  const pageSize = sp.size ?? 25;
  const setPageSize = (n: number) => patchSearch({ size: n === 25 ? undefined : n });

  // Sort — URL is source of truth, localStorage fallback, mount-time
  // hydration. See useAiDiagnosticsSort for the full contract; the
  // logic lives outside the component so integration tests can drive
  // the exact same code path without mounting the whole page.
  const { sortKey, sortDir, setSort } = useAiDiagnosticsSort({
    urlSort: sp.sort,
    urlDir: sp.dir,
    patchSearch: (p) => patchSearch(p as Record<string, string | undefined>),
  });
  const setSortKey = (v: SortKey) => setSort(v, sortDir);
  const setSortDir = (updater: SortDir | ((prev: SortDir) => SortDir)) => {
    const next = typeof updater === "function" ? updater(sortDir) : updater;
    setSort(sortKey, next);
  };

  /*
    Refs used by the global keyboard-shortcut handler further down.
    The handler is bound once (deps: sort state only) so it reads the
    LATEST reset callbacks + gating flags through these refs instead
    of re-subscribing on every render — otherwise Shift+X / Shift+A
    would capture a stale closure and either no-op after the first
    reset or bypass the "has anything to reset?" guard.
  */
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const resetFiltersRef = useRef<() => void>(() => {});
  const resetAllRef = useRef<() => void>(() => {});
  const activeFilterCountRef = useRef(0);
  const hasAnyNonDefaultRef = useRef(false);

  /*
    Keyboard shortcuts for sort controls (no mouse required):
      • Shift+S — focus the sort-field dropdown
      • Shift+D — toggle sort direction (asc ↔ desc)
    Guarded so shortcuts NEVER fire while the user is typing in a
    text input, textarea, contentEditable element, or has a modifier
    other than Shift held (Ctrl/Meta/Alt keep their browser meaning).
    Bound to `window` in a capture-free listener so any focus location
    on the page triggers the shortcut, without stealing keystrokes
    from form controls.
  */
  useEffect(() => {
    function isTypingTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      if (tag === "TEXTAREA" || tag === "SELECT") return true;
      if (tag === "INPUT") {
        const type = (el as HTMLInputElement).type;
        // Allow shortcuts even when a button/checkbox has focus.
        return type !== "button" && type !== "checkbox" && type !== "radio";
      }
      return false;
    }
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!e.shiftKey) return;
      if (isTypingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        const el = document.getElementById("ai-diagnostics-sort-key");
        if (el instanceof HTMLElement) {
          e.preventDefault();
          el.focus();
        }
      } else if (k === "d") {
        e.preventDefault();
        setSort(sortKey, sortDir === "asc" ? "desc" : "asc");
      } else if (k === "x") {
        // Shift+X → Reset filters. No-op when nothing to reset so the
        // shortcut never surprises users with an empty announcement.
        // Sort field/direction + page size are intentionally preserved
        // (same contract as clicking the button), so this shortcut
        // composes cleanly with Shift+S / Shift+D above.
        if (activeFilterCountRef.current > 0) {
          e.preventDefault();
          resetFiltersRef.current();
          // Focus-safe fallback: if the Reset button itself was
          // focused (e.g. user Tabbed to it and hit Shift+X), it's
          // about to unmount — hand focus back to the search input
          // so keyboard flow continues instead of dropping to <body>.
          const active = document.activeElement;
          if (
            active instanceof HTMLElement &&
            active.closest('[data-ai-diagnostics-reset="filters"]')
          ) {
            searchInputRef.current?.focus();
          }
        }
      } else if (k === "a") {
        // Shift+A → Reset all (filters + sort + page size + page).
        // Gated on hasAnyNonDefault so it stays silent when everything
        // is already at defaults.
        if (hasAnyNonDefaultRef.current) {
          e.preventDefault();
          resetAllRef.current();
          const active = document.activeElement;
          if (
            active instanceof HTMLElement &&
            active.closest('[data-ai-diagnostics-reset="all"]')
          ) {
            searchInputRef.current?.focus();
          }
        }
      } else if (k === "c") {
        // Shift+C → Copy link to the current filtered view. Locates
        // the shipped button by data attribute (no ref plumbing across
        // the toolbar/CopyButton boundary) and drives its click
        // handler, so the shortcut goes through the exact same code
        // path as a mouse click — including the success/error/fallback
        // announcements. Focus is moved to the button first so the
        // "Copied!" state has a visible focus ring the user can see
        // (and so the aria-describedby fallback-panel wiring points at
        // the same element the keyboard is on).
        const btn = document.querySelector<HTMLButtonElement>(
          '[data-ai-diagnostics-action="copy-link"]',
        );
        if (btn) {
          e.preventDefault();
          btn.focus();
          btn.click();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sortKey, sortDir, setSort]);

  // Debounced search — no query per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  /**
   * Build a PostgREST query that mirrors the CURRENT search + filters +
   * sort. Shared by `load()` (adds `.range()` for one page) and the
   * "Download filtered CSV" action (pages through the whole matching
   * set). Keeping this in one place guarantees the export sees exactly
   * the same rows the visible table is filtering on.
   */
  const buildFilteredQuery = (opts: { withCount: boolean }) => {
    const q = supabase
      .from("ai_tool_call_log")
      .select(
        "id, created_at, request_id, round, tool_name, tool_args, tool_result, success, error_message, duration_ms, gateway_status, gateway_model, retry_strategy, in_flight, completed_at",
        opts.withCount ? { count: "exact" } : undefined,
      );
    return applyAiDiagnosticsFilters(q, {
      status,
      retry,
      toolName,
      search: debouncedSearch,
      sortKey,
      sortDir,
    });
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await buildFilteredQuery({ withCount: true }).range(from, to);

    if (error) {
      setError(error.message);
      setRows([]);
      setTotalRows(0);
    } else {
      setRows((data as Row[]) ?? []);
      setTotalRows(count ?? 0);
    }
    setLoading(false);
  };

  /**
   * Ask Postgres for the `EXPLAIN (ANALYZE, BUFFERS)` plan for the
   * equivalent query, using the same filter/sort inputs the live table
   * is running. Called on toggle-on and whenever the inputs change while
   * debug mode is active. All parameters are sanitised and executed via
   * an admin-gated `SECURITY DEFINER` RPC — the client cannot inject
   * arbitrary SQL because it only passes named parameters.
   */
  const loadPlan = async () => {
    setDebugLoading(true);
    setDebugError(null);
    const startedAt = performance.now();
    const from = (page - 1) * pageSize;
    const { data, error } = await callRpc(
      "explain_ai_tool_call_log" as never,
      {
        p_status: status,
        p_retry: retry,
        p_tool_name: toolName,
        p_search: debouncedSearch.trim(),
        p_sort_key: sortKey,
        p_sort_dir: sortDir,
        p_limit: pageSize,
        p_offset: from,
      } as never,
    );
    setDebugTookMs(performance.now() - startedAt);
    if (error) {
      setDebugError(error.message);
      setDebugPlan(null);
    } else {
      // RPC returns SETOF text; PostgREST hands it back as an array of
      // strings OR an array of `{ explain_ai_tool_call_log: string }`
      // rows depending on version — normalise both shapes.
      const lines = Array.isArray(data)
        ? (data as Array<string | Record<string, string>>).map((r) =>
            typeof r === "string" ? r : (Object.values(r)[0] ?? ""),
          )
        : [];
      setDebugPlan(lines.join("\n"));
    }
    setDebugLoading(false);
  };

  // Re-fetch whenever any server-side input changes. `debouncedSearch` is
  // used instead of `search` so keystrokes don't stampede the API.
  useEffect(() => {
    void load();
    if (debugMode) void loadPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, status, retry, toolName, sortKey, sortDir, page, pageSize, debugMode]);

  // Reset to page 1 whenever any filter changes — otherwise a user can end
  // up on page 5 of an empty result set. Skipped on the initial mount so a
  // shared `?page=N` URL isn't clobbered back to page 1 before the first
  // load (matches the page-size tests' contract that mount preserves the
  // URL page).
  const filterMountRef = useRef(true);
  useEffect(() => {
    if (filterMountRef.current) {
      filterMountRef.current = false;
      return;
    }
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, status, retry, toolName, pageSize, sortKey, sortDir]);

  // Tool dropdown options: derived from the current page's rows PLUS the
  // currently selected tool (so the selected value never disappears from
  // the list even if it's absent from this page).
  const toolOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.tool_name) set.add(r.tool_name);
    if (toolName !== "all") set.add(toolName);
    return Array.from(set).sort();
  }, [rows, toolName]);

  // Group the CURRENT PAGE of rows by request_id for display only.
  // With server-side pagination a request may straddle two pages; that's
  // acceptable for a triage log and keeps the query cheap.
  const pagedGroups = useMemo(() => {
    const map = new Map<string, Row[]>();
    const order: string[] = [];
    for (const r of rows) {
      if (!map.has(r.request_id)) {
        map.set(r.request_id, []);
        order.push(r.request_id);
      }
      map.get(r.request_id)!.push(r);
    }
    return order.map((reqId) => {
      const list = map
        .get(reqId)!
        .sort((a, b) =>
          a.round === b.round ? a.created_at.localeCompare(b.created_at) : a.round - b.round,
        );
      return {
        reqId,
        list,
        startedAt: list.reduce(
          (min, r) => (r.created_at < min ? r.created_at : min),
          list[0].created_at,
        ),
        anyFailure: list.some((r) => !r.success),
      };
    });
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;

  const activeFilterCount =
    (search.trim() ? 1 : 0) +
    (status !== "all" ? 1 : 0) +
    (retry !== "all" ? 1 : 0) +
    (toolName !== "all" ? 1 : 0);

  /**
   * Reset every FILTER-shaped URL param to its default and jump back to
   * page 1, in a single URL update so the browser only records one
   * history entry (Back returns to the pre-reset view, not to each
   * cleared field). Sort field/direction and page size are view
   * preferences, not filters — we intentionally preserve them so a user
   * who set "50 rows, sort by tool" doesn't lose that on reset.
   */
  /*
    Reset announcements — a polite aria-live region below the toolbar
    reads out what just happened whenever the user resets. The message
    is stored with a nonce counter so repeated resets re-announce even
    when the resulting text is identical (screen readers ignore an
    aria-live update whose textContent didn't change; briefly clearing
    to "" and setting the message in the next microtask forces a fresh
    announcement).
  */
  const [resetAnnouncement, setResetAnnouncement] = useState("");
  const announceReset = (msg: string) => {
    setResetAnnouncement("");
    // Next microtask: react commits the empty string, THEN we set the
    // real message — guaranteeing an aria-live delta even on repeats.
    Promise.resolve().then(() => setResetAnnouncement(msg));
  };

  const resetFilters = () => {
    patchSearch({
      q: undefined,
      status: undefined,
      retry: undefined,
      tool: undefined,
      page: undefined,
    });
    announceReset("Filters reset, returned to page 1.");
  };

  /**
   * "Reset all" — nuclear option. Clears every URL-persisted knob
   * (filters + sort + page size + pagination) in a SINGLE
   * `patchSearch` call so the browser records exactly one history
   * entry (Back returns to the pre-reset view). Also wipes the sort
   * preference from localStorage — otherwise the mount-time hydrator
   * in `useAiDiagnosticsSort` would immediately re-populate the URL
   * from storage and the reset would appear to "not stick" after a
   * refresh.
   */
  const resetAll = () => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(SORT_STORAGE_KEY);
      } catch {
        /* storage disabled — URL update below still wins */
      }
    }
    patchSearch({
      q: undefined,
      status: undefined,
      retry: undefined,
      tool: undefined,
      page: undefined,
      sort: undefined,
      dir: undefined,
      size: undefined,
      limit: undefined,
    });
    announceReset(
      "All settings reset: filters cleared, sort set to Time descending, page size 25, page 1.",
    );
  };

  // "Reset all" is meaningful only when SOMETHING deviates from the
  // defaults across all reset-eligible URL keys. Recomputed from the
  // same URL state everything else reads so it stays in sync without a
  // separate source of truth.
  const hasAnyNonDefault =
    activeFilterCount > 0 ||
    sortKey !== "time" ||
    sortDir !== "desc" ||
    pageSize !== 25 ||
    page !== 1;

  // Keep the shortcut-handler refs pointing at the LATEST closures /
  // gating flags so Shift+X and Shift+A stay accurate as URL state
  // changes, without rebinding the window listener on every render.
  resetFiltersRef.current = resetFilters;
  resetAllRef.current = resetAll;
  activeFilterCountRef.current = activeFilterCount;
  hasAnyNonDefaultRef.current = hasAnyNonDefault;

  // Export the CURRENTLY VISIBLE rows — i.e. the rows returned by the
  // current server query for this page. Flat one-row-per-tool-call so a
  // spreadsheet can pivot / group as needed.
  const pagedRows = useMemo(() => pagedGroups.flatMap((g) => g.list), [pagedGroups]);

  /**
   * Local aliases over the extracted helpers so the rest of the page
   * (and the drawer/export dialog wiring) can keep passing plain `Row`s
   * without repeating the shared payload-format union everywhere.
   */
  const isGatewayErrorRow = (r: Row) => isGatewayErrorRowFn(r);
  const buildGatewayErrorPayload = (r: Row, format: GatewayPayloadFormat = "object"): unknown =>
    buildGatewayErrorPayloadFn(r, format);

  /*
   * When on, `gateway_error_payload` is rendered as a pretty-printed
   * (2-space indented) JSON *string* in both CSV and JSON exports so a
   * reviewer opening the file in Excel / a text editor sees the payload
   * on multiple lines instead of one long minified blob. Off keeps the
   * historical shape (compact string in CSV, nested object in JSON) for
   * pipelines that already parse the field programmatically.
   */
  const [prettyGatewayPayload, setPrettyGatewayPayload] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedColumnKeys, setSelectedColumnKeys] = useState<ExportColumnKey[]>(() =>
    loadSelectedColumnKeys(),
  );
  // Column defs, filtered to the user's selection, in canonical order.
  // Recomputed only when the selection changes so CSV/JSON writers can
  // rely on referential stability across a single export call.
  const selectedColumns = useMemo(
    () => getFilteredExportColumns(selectedColumnKeys),
    [selectedColumnKeys],
  );

  const buildExportMeta = (): CsvMetadataInput => ({
    source: "AI Diagnostics",
    generatedAt: new Date(),
    filters: {
      Search: search || undefined,
      Status: status,
      Retry: retry,
      Tool: toolName,
    },
    sort: { key: sortKey, dir: sortDir },
    page: { page: currentPage, totalPages, pageSize },
    counts: {
      shown: pagedRows.length,
      total: totalRows,
    },
    columns: selectedColumns.map((c) => ({ key: c.key, label: c.label })),
  });

  const triggerDownload = (filename: string, mime: string, body: string) => {
    const blob = new Blob([body], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Small delay before revoking so the browser has time to start the
    // download in strict Blob-URL implementations (Safari).
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const escapeCsvCell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const timestampSuffix = () =>
    new Date().toISOString().replace(/[:.]/g, "-").replace(/T/, "_").slice(0, 19);

  /**
   * Build an export filename that encodes the active filters + a UTC
   * timestamp so downloaded files stay self-describing (and don't
   * clobber each other in the user's Downloads folder).
   *
   * Shape: `ai-diagnostics[-filtered]_<slug>_<timestamp>.<ext>`
   * where <slug> is a `-`-joined list of non-default filters
   * (e.g. `status-error_retry-yes_tool-web_q-invoice`). Defaults ("all",
   * empty search) are omitted; the whole slug is omitted when nothing is
   * active so filenames stay short.
   */
  const buildExportFilename = (
    ext: "csv" | "json" | "xlsx",
    scope: "page" | "filtered",
  ): string => {
    const slugPart = (label: string, value: string) => {
      const cleaned = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 24);
      return cleaned ? `${label}-${cleaned}` : "";
    };
    const parts: string[] = [];
    if (status && status !== "all") parts.push(slugPart("status", String(status)));
    if (retry && retry !== "all") parts.push(slugPart("retry", String(retry)));
    if (toolName && toolName !== "all" && toolName !== "")
      parts.push(slugPart("tool", String(toolName)));
    const q = (search ?? "").trim();
    if (q) parts.push(slugPart("q", q));
    const filterSlug = parts.filter(Boolean).join("_");
    const base = scope === "filtered" ? "ai-diagnostics-filtered" : "ai-diagnostics";
    const middle = filterSlug ? `_${filterSlug}` : "";
    return `${base}${middle}_${timestampSuffix()}.${ext}`;
  };

  const handleExportCsv = () => {
    try {
      const meta = buildExportMeta();
      const header = (meta.columns as Array<{ key: string; label: string }>)
        .map((c) => escapeCsvCell(c.label))
        .join(",");
      const body = pagedRows.map((r) => rowToCsvCells(r).join(",")).join("\n");
      const csv = prefixCsvWithMetadata(`${header}\n${body}`, meta);
      triggerDownload(buildExportFilename("csv", "page"), "text/csv", csv);
      toast.success(
        `Exported ${pagedRows.length} row${pagedRows.length === 1 ? "" : "s"} as CSV (current page).`,
        {
          description: `Schema ${JSON_ENVELOPE_SCHEMA} · v${JSON_ENVELOPE_VERSION}`,
        },
      );
    } catch (e) {
      toast.error(`CSV export failed: ${e instanceof Error ? e.message : String(e)}`, {
        description: "Your filters and current page are preserved — retry to try again.",
        duration: 10000,
        action: {
          label: "Retry",
          onClick: () => {
            handleExportCsv();
          },
        },
      });
    }
  };

  const handleExportJson = () => {
    try {
      const meta = buildExportMeta();
      const payload = {
        _meta: buildJsonExportMetadata(meta),
        rows: pagedRows.map((r) => rowToJsonObject(r)),
      };
      triggerDownload(
        buildExportFilename("json", "page"),
        "application/json",
        JSON.stringify(payload, null, 2),
      );
      toast.success(
        `Exported ${pagedRows.length} row${pagedRows.length === 1 ? "" : "s"} as JSON (current page).`,
        {
          description: `Schema ${JSON_ENVELOPE_SCHEMA} · v${JSON_ENVELOPE_VERSION}`,
        },
      );
    } catch (e) {
      toast.error(`JSON export failed: ${e instanceof Error ? e.message : String(e)}`, {
        description: "Your filters and current page are preserved — retry to try again.",
        duration: 10000,
        action: {
          label: "Retry",
          onClick: () => {
            handleExportJson();
          },
        },
      });
    }
  };

  // Serialise one Row → CSV cell array from the shared column registry
  // (see aiDiagnosticsExportColumns.ts) so CSV headers, CSV cells, JSON
  // keys, and metadata `columns` all reflect the user's selection and
  // stay in canonical order — no chance of drift between them.
  const rowToCsvCells = (r: Row) =>
    selectedColumns
      .map((c) => c.csvValue(r, buildGatewayErrorPayload, prettyGatewayPayload))
      .map(escapeCsvCell);

  // JSON counterpart: emits ONLY the selected columns as an object,
  // preserving canonical key order for downstream diffing.
  const rowToJsonObject = (r: Row): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const c of selectedColumns) {
      out[c.key] = c.jsonValue(r, buildGatewayErrorPayload, prettyGatewayPayload);
    }
    return out;
  };

  /**
   * "Download filtered CSV" — exports EVERY row matching the current
   * search + filters + sort, not just the visible page. Pages through
   * PostgREST in fixed-size chunks so a huge result set doesn't blow up
   * a single request, and caps at `FILTERED_EXPORT_MAX` to keep the
   * browser responsive. When the cap is hit the metadata `Notes` field
   * records that the export was truncated so a downstream reader knows.
   */
  const FILTERED_EXPORT_CHUNK = 1000;
  const FILTERED_EXPORT_MAX = 50_000;
  const [exportingFiltered, setExportingFiltered] = useState(false);
  /**
   * Persistent, user-dismissible banner surfaced above the table when a
   * filtered export was truncated at `FILTERED_EXPORT_MAX`. The toast is
   * transient — this banner keeps the truncation fact on screen so a
   * user who missed the toast still sees why their file is short.
   */
  const [truncationNotice, setTruncationNotice] = useState<{
    kind: "csv" | "json";
    exported: number;
    matched: number;
    cap: number;
  } | null>(null);

  /**
   * Cancellation sentinel used by the filtered exports. Each chunked
   * export loop checks `cancelFilteredRef.current` between PostgREST
   * pages, so hitting Cancel bails out at the next chunk boundary
   * without leaving stale download blobs or half-written CSV bodies.
   * A ref (not state) so the loop reads the latest value inside the
   * async closure without re-rendering per chunk.
   */
  const cancelFilteredRef = useRef<{ csv: boolean; json: boolean; xlsx: boolean }>({
    csv: false,
    json: false,
    xlsx: false,
  });
  class FilteredExportCancelled extends Error {
    constructor() {
      super("cancelled");
      this.name = "FilteredExportCancelled";
    }
  }

  /**
   * Background export jobs — one entry per active or recently-finished
   * filtered export. The `BackgroundExportsPanel` renders this list so
   * the user can start an export, keep interacting with the page, and
   * come back to the same tab for the download when it's done. Blob URLs
   * are held on the job so re-download works without re-running the query.
   */
  const [bgJobs, setBgJobs] = useState<ExportJob[]>([]);
  const patchJob = (id: string, patch: Partial<ExportJob>) => {
    setBgJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  };
  const pushJob = (job: ExportJob) => setBgJobs((prev) => [...prev, job]);
  const dismissJob = (id: string) => {
    setBgJobs((prev) => {
      const target = prev.find((j) => j.id === id);
      if (target?.blobUrl) URL.revokeObjectURL(target.blobUrl);
      return prev.filter((j) => j.id !== id);
    });
  };
  /**
   * Yield to the browser so it can paint / handle input between CPU-bound
   * phases (row serialisation, XLSX workbook build). setTimeout(0) is
   * enough here; requestIdleCallback isn't universally available and
   * we don't want the yields to be starved on a busy tab.
   */
  const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));
  const newJobId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const handleExportFilteredCsv = async () => {
    cancelFilteredRef.current.csv = false;
    setExportingFiltered(true);
    setError(null);
    setTruncationNotice(null);
    const jobId = newJobId();
    const startedAt = Date.now();
    pushJob({
      id: jobId,
      kind: "csv",
      label: "Filtered diagnostics export",
      status: "running",
      phase: "fetching",
      matched: null,
      exported: 0,
      cap: FILTERED_EXPORT_MAX,
      startedAt,
      onCancel: () => {
        cancelFilteredRef.current.csv = true;
      },
    });
    const toastId = toast.loading("Filtered CSV export running in background…", {
      action: {
        label: "Cancel",
        onClick: () => {
          cancelFilteredRef.current.csv = true;
        },
      },
      duration: Infinity,
    });
    try {
      const collected: Row[] = [];
      let matchedTotal = 0;
      let truncated = false;
      for (let offset = 0; offset < FILTERED_EXPORT_MAX; offset += FILTERED_EXPORT_CHUNK) {
        if (cancelFilteredRef.current.csv) throw new FilteredExportCancelled();
        const from = offset;
        const to = Math.min(offset + FILTERED_EXPORT_CHUNK, FILTERED_EXPORT_MAX) - 1;
        const withCount = offset === 0;
        const { data, error: err, count } = await buildFilteredQuery({ withCount }).range(from, to);
        if (err) throw err;
        if (cancelFilteredRef.current.csv) throw new FilteredExportCancelled();
        if (withCount) {
          matchedTotal = count ?? 0;
          patchJob(jobId, { matched: matchedTotal });
        }
        const batch = (data as Row[]) ?? [];
        collected.push(...batch);
        patchJob(jobId, { exported: collected.length });
        // Yield BEFORE the next fetch so the panel/toast repaint reflects progress.
        await yieldToUi();
        if (batch.length < FILTERED_EXPORT_CHUNK) break;
      }
      if (matchedTotal > collected.length) truncated = true;

      // ---- Build CSV in yielding chunks so long serialisations don't jank the UI.
      patchJob(jobId, { phase: "building" });
      await yieldToUi();
      const meta: CsvMetadataInput = {
        source: "AI Diagnostics (filtered)",
        generatedAt: new Date(),
        filters: {
          Search: search || undefined,
          Status: status,
          Retry: retry,
          Tool: toolName,
        },
        sort: { key: sortKey, dir: sortDir },
        page: null,
        counts: { shown: collected.length, filtered: matchedTotal, total: matchedTotal },
        extra: truncated
          ? { Notes: `Truncated at ${FILTERED_EXPORT_MAX} rows of ${matchedTotal} matched` }
          : undefined,
        columns: buildExportMeta().columns ?? [],
      };
      const header = (meta.columns as Array<{ key: string; label: string }>)
        .map((c) => escapeCsvCell(c.label))
        .join(",");
      const SERIALISE_CHUNK = 500;
      const lines: string[] = [header];
      for (let i = 0; i < collected.length; i += SERIALISE_CHUNK) {
        if (cancelFilteredRef.current.csv) throw new FilteredExportCancelled();
        const slice = collected.slice(i, i + SERIALISE_CHUNK);
        for (const r of slice) lines.push(rowToCsvCells(r).join(","));
        await yieldToUi();
      }
      const csv = prefixCsvWithMetadata(lines.join("\n"), meta);
      patchJob(jobId, { phase: "finalising" });
      await yieldToUi();

      const filename = buildExportFilename("csv", "filtered");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      // Auto-trigger the download once — the blob URL stays alive on the
      // job so the user can re-download from the panel until they dismiss it.
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();

      patchJob(jobId, {
        status: "done",
        phase: "done",
        blobUrl: url,
        filename,
        finishedAt: Date.now(),
      });

      if (truncated) {
        setTruncationNotice({
          kind: "csv",
          exported: collected.length,
          matched: matchedTotal,
          cap: FILTERED_EXPORT_MAX,
        });
        toast.warning(`CSV export truncated at ${FILTERED_EXPORT_MAX.toLocaleString()} rows`, {
          id: toastId,
          description: `Only ${collected.length.toLocaleString()} of ${matchedTotal.toLocaleString()} matching rows were exported. Narrow your filters to export the rest.`,
          duration: 10000,
        });
      } else {
        toast.success(
          `Exported ${collected.length.toLocaleString()} filtered row${collected.length === 1 ? "" : "s"} as CSV.`,
          {
            id: toastId,
            description: `Schema ${JSON_ENVELOPE_SCHEMA} · v${JSON_ENVELOPE_VERSION} — re-download from the Background exports panel.`,
          },
        );
      }
    } catch (e) {
      if (e instanceof FilteredExportCancelled) {
        patchJob(jobId, { status: "cancelled", finishedAt: Date.now() });
        toast.warning("Filtered CSV export cancelled.", {
          id: toastId,
          description: "No file was downloaded. Adjust filters and try again.",
          duration: 6000,
        });
      } else {
        const msg = e instanceof Error ? e.message : "Failed to export filtered results.";
        patchJob(jobId, { status: "error", error: msg, finishedAt: Date.now() });
        setError(`Filtered CSV export failed: ${msg}`);
        toast.error(`Filtered CSV export failed: ${msg}`, {
          id: toastId,
          description:
            "Check your filters and try again. If this keeps happening, refresh the page.",
          duration: 10000,
          action: {
            label: "Retry",
            onClick: () => {
              void handleExportFilteredCsv();
            },
          },
        });
      }
    } finally {
      cancelFilteredRef.current.csv = false;
      setExportingFiltered(false);
    }
  };

  /**
   * "Download filtered JSON" — JSON counterpart to `handleExportFilteredCsv`.
   * Streams every row matching the current search + filters + sort through
   * PostgREST in `FILTERED_EXPORT_CHUNK` pages, capped at `FILTERED_EXPORT_MAX`
   * for browser safety. Emits `{ _meta, rows }` with the same shape as the
   * paged JSON export so downstream tooling can parse both interchangeably;
   * `_meta.page` is `null` (spans all pages) and truncation is recorded in
   * `_meta.extra.Notes` when the cap is hit.
   */
  const [exportingFilteredJson, setExportingFilteredJson] = useState(false);
  const handleExportFilteredJson = async () => {
    cancelFilteredRef.current.json = false;
    setExportingFilteredJson(true);
    setError(null);
    setTruncationNotice(null);
    const jobId = newJobId();
    pushJob({
      id: jobId,
      kind: "json",
      label: "Filtered diagnostics export",
      status: "running",
      phase: "fetching",
      matched: null,
      exported: 0,
      cap: FILTERED_EXPORT_MAX,
      startedAt: Date.now(),
      onCancel: () => {
        cancelFilteredRef.current.json = true;
      },
    });
    const toastId = toast.loading("Filtered JSON export running in background…", {
      action: {
        label: "Cancel",
        onClick: () => {
          cancelFilteredRef.current.json = true;
        },
      },
      duration: Infinity,
    });
    try {
      const collected: Row[] = [];
      let matchedTotal = 0;
      let truncated = false;
      for (let offset = 0; offset < FILTERED_EXPORT_MAX; offset += FILTERED_EXPORT_CHUNK) {
        if (cancelFilteredRef.current.json) throw new FilteredExportCancelled();
        const from = offset;
        const to = Math.min(offset + FILTERED_EXPORT_CHUNK, FILTERED_EXPORT_MAX) - 1;
        const withCount = offset === 0;
        const { data, error: err, count } = await buildFilteredQuery({ withCount }).range(from, to);
        if (err) throw err;
        if (cancelFilteredRef.current.json) throw new FilteredExportCancelled();
        if (withCount) {
          matchedTotal = count ?? 0;
          patchJob(jobId, { matched: matchedTotal });
        }
        const batch = (data as Row[]) ?? [];
        collected.push(...batch);
        patchJob(jobId, { exported: collected.length });
        await yieldToUi();
        if (batch.length < FILTERED_EXPORT_CHUNK) break;
      }
      if (matchedTotal > collected.length) truncated = true;

      patchJob(jobId, { phase: "building" });
      await yieldToUi();
      const meta: CsvMetadataInput = {
        source: "AI Diagnostics (filtered)",
        generatedAt: new Date(),
        filters: {
          Search: search || undefined,
          Status: status,
          Retry: retry,
          Tool: toolName,
        },
        sort: { key: sortKey, dir: sortDir },
        page: null,
        counts: { shown: collected.length, filtered: matchedTotal, total: matchedTotal },
        extra: truncated
          ? { Notes: `Truncated at ${FILTERED_EXPORT_MAX} rows of ${matchedTotal} matched` }
          : undefined,
        columns: buildExportMeta().columns ?? [],
      };
      // Convert rows in yielding slices so JSON.stringify of tens of
      // thousands of nested payloads doesn't monopolise the main thread.
      const SERIALISE_CHUNK = 500;
      const jsonRows: Array<Record<string, unknown>> = [];
      for (let i = 0; i < collected.length; i += SERIALISE_CHUNK) {
        if (cancelFilteredRef.current.json) throw new FilteredExportCancelled();
        const slice = collected.slice(i, i + SERIALISE_CHUNK);
        for (const r of slice) jsonRows.push(rowToJsonObject(r));
        await yieldToUi();
      }
      const payload = { _meta: buildJsonExportMetadata(meta), rows: jsonRows };
      patchJob(jobId, { phase: "finalising" });
      await yieldToUi();
      const body = JSON.stringify(payload, null, 2);
      const filename = buildExportFilename("json", "filtered");
      const blob = new Blob([body], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      patchJob(jobId, {
        status: "done",
        phase: "done",
        blobUrl: url,
        filename,
        finishedAt: Date.now(),
      });
      if (truncated) {
        setTruncationNotice({
          kind: "json",
          exported: collected.length,
          matched: matchedTotal,
          cap: FILTERED_EXPORT_MAX,
        });
        toast.warning(`JSON export truncated at ${FILTERED_EXPORT_MAX.toLocaleString()} rows`, {
          id: toastId,
          description: `Only ${collected.length.toLocaleString()} of ${matchedTotal.toLocaleString()} matching rows were exported. Narrow your filters to export the rest.`,
          duration: 10000,
        });
      } else {
        toast.success(
          `Exported ${collected.length.toLocaleString()} filtered row${collected.length === 1 ? "" : "s"} as JSON.`,
          {
            id: toastId,
            description: `Schema ${JSON_ENVELOPE_SCHEMA} · v${JSON_ENVELOPE_VERSION} — re-download from the Background exports panel.`,
          },
        );
      }
    } catch (e) {
      if (e instanceof FilteredExportCancelled) {
        patchJob(jobId, { status: "cancelled", finishedAt: Date.now() });
        toast.warning("Filtered JSON export cancelled.", {
          id: toastId,
          description: "No file was downloaded. Adjust filters and try again.",
          duration: 6000,
        });
      } else {
        const msg = e instanceof Error ? e.message : "Failed to export filtered results.";
        patchJob(jobId, { status: "error", error: msg, finishedAt: Date.now() });
        setError(`Filtered JSON export failed: ${msg}`);
        toast.error(`Filtered JSON export failed: ${msg}`, {
          id: toastId,
          description:
            "Check your filters and try again. If this keeps happening, refresh the page.",
          duration: 10000,
          action: {
            label: "Retry",
            onClick: () => {
              void handleExportFilteredJson();
            },
          },
        });
      }
    } finally {
      cancelFilteredRef.current.json = false;
      setExportingFilteredJson(false);
    }
  };

  /**
   * "Download filtered XLSX" — Excel counterpart to the filtered CSV/JSON
   * exports. Uses the same chunked PostgREST fetch (with mid-loop cancel
   * checks) so cancellation, truncation semantics and toast plumbing are
   * identical; the ExcelJS workbook builder is lazy-loaded inside the
   * handler so the ~800KB dependency never ships to readers who don't
   * export.
   */
  const [exportingFilteredXlsx, setExportingFilteredXlsx] = useState(false);
  const handleExportFilteredXlsx = async () => {
    cancelFilteredRef.current.xlsx = false;
    setExportingFilteredXlsx(true);
    setError(null);
    setTruncationNotice(null);
    const jobId = newJobId();
    pushJob({
      id: jobId,
      kind: "xlsx",
      label: "Filtered diagnostics export",
      status: "running",
      phase: "fetching",
      matched: null,
      exported: 0,
      cap: FILTERED_EXPORT_MAX,
      startedAt: Date.now(),
      onCancel: () => {
        cancelFilteredRef.current.xlsx = true;
      },
    });
    const toastId = toast.loading("Filtered XLSX export running in background…", {
      action: {
        label: "Cancel",
        onClick: () => {
          cancelFilteredRef.current.xlsx = true;
        },
      },
      duration: Infinity,
    });
    try {
      const collected: Row[] = [];
      let matchedTotal = 0;
      let truncated = false;
      for (let offset = 0; offset < FILTERED_EXPORT_MAX; offset += FILTERED_EXPORT_CHUNK) {
        if (cancelFilteredRef.current.xlsx) throw new FilteredExportCancelled();
        const from = offset;
        const to = Math.min(offset + FILTERED_EXPORT_CHUNK, FILTERED_EXPORT_MAX) - 1;
        const withCount = offset === 0;
        const { data, error: err, count } = await buildFilteredQuery({ withCount }).range(from, to);
        if (err) throw err;
        if (cancelFilteredRef.current.xlsx) throw new FilteredExportCancelled();
        if (withCount) {
          matchedTotal = count ?? 0;
          patchJob(jobId, { matched: matchedTotal });
        }
        const batch = (data as Row[]) ?? [];
        collected.push(...batch);
        patchJob(jobId, { exported: collected.length });
        await yieldToUi();
        if (batch.length < FILTERED_EXPORT_CHUNK) break;
      }
      if (matchedTotal > collected.length) truncated = true;

      patchJob(jobId, { phase: "building" });
      await yieldToUi();
      const meta: CsvMetadataInput = {
        source: "AI Diagnostics (filtered)",
        generatedAt: new Date(),
        filters: {
          Search: search || undefined,
          Status: status,
          Retry: retry,
          Tool: toolName,
        },
        sort: { key: sortKey, dir: sortDir },
        page: null,
        counts: { shown: collected.length, filtered: matchedTotal, total: matchedTotal },
        extra: truncated
          ? { Notes: `Truncated at ${FILTERED_EXPORT_MAX} rows of ${matchedTotal} matched` }
          : undefined,
        columns: selectedColumns.map((c) => ({ key: c.key, label: c.label })),
      };
      // Lazy-load ExcelJS so it never enters the initial page bundle.
      const { buildDiagnosticsXlsxBlob } = await import("./aiDiagnosticsXlsxExport");
      if (cancelFilteredRef.current.xlsx) throw new FilteredExportCancelled();
      const blob = await buildDiagnosticsXlsxBlob({
        rows: collected,
        columns: selectedColumns,
        meta,
        prettyGatewayPayload,
        buildGatewayErrorPayload,
      });
      if (cancelFilteredRef.current.xlsx) throw new FilteredExportCancelled();
      patchJob(jobId, { phase: "finalising" });
      await yieldToUi();

      const filename = buildExportFilename("xlsx", "filtered");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      patchJob(jobId, {
        status: "done",
        phase: "done",
        blobUrl: url,
        filename,
        finishedAt: Date.now(),
      });

      if (truncated) {
        setTruncationNotice({
          kind: "csv",
          exported: collected.length,
          matched: matchedTotal,
          cap: FILTERED_EXPORT_MAX,
        });
        toast.warning(`XLSX export truncated at ${FILTERED_EXPORT_MAX.toLocaleString()} rows`, {
          id: toastId,
          description: `Only ${collected.length.toLocaleString()} of ${matchedTotal.toLocaleString()} matching rows were exported. Narrow your filters to export the rest.`,
          duration: 10000,
        });
      } else {
        toast.success(
          `Exported ${collected.length.toLocaleString()} filtered row${collected.length === 1 ? "" : "s"} as XLSX.`,
          {
            id: toastId,
            description: `Schema ${JSON_ENVELOPE_SCHEMA} · v${JSON_ENVELOPE_VERSION} — re-download from the Background exports panel.`,
          },
        );
      }
    } catch (e) {
      if (e instanceof FilteredExportCancelled) {
        patchJob(jobId, { status: "cancelled", finishedAt: Date.now() });
        toast.warning("Filtered XLSX export cancelled.", {
          id: toastId,
          description: "No file was downloaded. Adjust filters and try again.",
          duration: 6000,
        });
      } else {
        const msg = e instanceof Error ? e.message : "Failed to export filtered results.";
        patchJob(jobId, { status: "error", error: msg, finishedAt: Date.now() });
        setError(`Filtered XLSX export failed: ${msg}`);
        toast.error(`Filtered XLSX export failed: ${msg}`, {
          id: toastId,
          description:
            "Check your filters and try again. If this keeps happening, refresh the page.",
          duration: 10000,
          action: {
            label: "Retry",
            onClick: () => {
              void handleExportFilteredXlsx();
            },
          },
        });
      }
    } finally {
      cancelFilteredRef.current.xlsx = false;
      setExportingFilteredXlsx(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="AI Diagnostics"
        description="Recent tool calls, arguments, and gateway responses from the assistant. Admin-only."
      />

      <Card>
        <CardHeader className="pb-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm">
              Search & filters
              {activeFilterCount > 0 && (
                <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-xs text-primary">
                  {activeFilterCount} active
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={load}
                disabled={loading}
                className="min-h-11 min-w-11"
                aria-label="Refresh diagnostics"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                <span className="ml-2 hidden sm:inline">Refresh</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCsv}
                disabled={pagedRows.length === 0}
                className="min-h-11 min-w-11"
                aria-label="Export current page as CSV"
                title="Export current page as CSV"
              >
                <Download className="h-4 w-4" />
                <span className="ml-2 hidden sm:inline">CSV</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportFilteredCsv}
                disabled={loading || exportingFiltered || totalRows === 0}
                className="min-h-11 min-w-11"
                aria-label="Download filtered CSV (all matching rows across pages)"
                title="Download filtered CSV — all rows matching the current search & filters"
              >
                {exportingFiltered ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span className="ml-2 hidden sm:inline">Filtered CSV</span>
              </Button>
              {exportingFiltered && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    cancelFilteredRef.current.csv = true;
                  }}
                  className="min-h-11 min-w-11 text-destructive hover:text-destructive"
                  aria-label="Cancel filtered CSV export"
                  title="Stop the in-progress filtered CSV download"
                >
                  <X className="h-4 w-4" />
                  <span className="ml-1 hidden sm:inline">Cancel</span>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportJson}
                disabled={pagedRows.length === 0}
                className="min-h-11 min-w-11"
                aria-label="Export current page as JSON"
                title="Export current page as JSON"
              >
                <Download className="h-4 w-4" />
                <span className="ml-2 hidden sm:inline">JSON</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportFilteredJson}
                disabled={loading || exportingFilteredJson || totalRows === 0}
                className="min-h-11 min-w-11"
                aria-label="Download filtered JSON (all matching rows across pages)"
                title="Download filtered JSON — all rows matching the current search & filters"
              >
                {exportingFilteredJson ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span className="ml-2 hidden sm:inline">Filtered JSON</span>
              </Button>
              {exportingFilteredJson && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    cancelFilteredRef.current.json = true;
                  }}
                  className="min-h-11 min-w-11 text-destructive hover:text-destructive"
                  aria-label="Cancel filtered JSON export"
                  title="Stop the in-progress filtered JSON download"
                >
                  <X className="h-4 w-4" />
                  <span className="ml-1 hidden sm:inline">Cancel</span>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportFilteredXlsx}
                disabled={loading || exportingFilteredXlsx || totalRows === 0}
                className="min-h-11 min-w-11"
                aria-label="Download filtered XLSX (all matching rows across pages, opens in Excel)"
                title="Download filtered XLSX — all rows matching the current search & filters as an Excel workbook (Diagnostics + Metadata sheets)"
              >
                {exportingFilteredXlsx ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span className="ml-2 hidden sm:inline">Filtered XLSX</span>
              </Button>
              {exportingFilteredXlsx && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    cancelFilteredRef.current.xlsx = true;
                  }}
                  className="min-h-11 min-w-11 text-destructive hover:text-destructive"
                  aria-label="Cancel filtered XLSX export"
                  title="Stop the in-progress filtered XLSX download"
                >
                  <X className="h-4 w-4" />
                  <span className="ml-1 hidden sm:inline">Cancel</span>
                </Button>
              )}
              <div className="flex items-center gap-2 pl-2 ml-1 border-l">
                <Switch
                  id="pretty-gateway-payload"
                  checked={prettyGatewayPayload}
                  onCheckedChange={setPrettyGatewayPayload}
                  aria-describedby="pretty-gateway-payload-hint"
                />
                <Label
                  htmlFor="pretty-gateway-payload"
                  className="text-xs font-normal cursor-pointer whitespace-nowrap"
                  title="When on, the gateway_error_payload field is emitted as a pretty-printed multi-line JSON string in CSV cells and JSON exports for easier review."
                >
                  Pretty payload
                </Label>
                <span id="pretty-gateway-payload-hint" className="sr-only">
                  When on, the gateway error payload column is emitted as a pretty-printed
                  multi-line JSON string in both CSV and JSON exports. When off, CSV uses compact
                  JSON and JSON uses a nested object.
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPreviewOpen(true)}
                disabled={pagedRows.length === 0}
                className="min-h-11 min-w-11"
                aria-label="Preview export headers and a sample row before downloading"
                title="Preview export — see the exact CSV headers and a sample row (including gateway_error_payload) before downloading"
              >
                <Eye className="h-4 w-4" />
                <span className="ml-2 hidden sm:inline">Preview</span>
              </Button>
              <ExportColumnsMenu selected={selectedColumnKeys} onChange={setSelectedColumnKeys} />
              <span
                className="ml-1 rounded border border-border/60 bg-muted/40 px-2 py-1 text-[10px] font-mono text-muted-foreground whitespace-nowrap"
                title={`All exports include this envelope so downstream tooling can verify file compatibility. Schema: ${JSON_ENVELOPE_SCHEMA}. Version: ${JSON_ENVELOPE_VERSION}.`}
                aria-label={`Export envelope: schema ${JSON_ENVELOPE_SCHEMA}, version ${JSON_ENVELOPE_VERSION}`}
              >
                <span className="hidden sm:inline">schema </span>
                {JSON_ENVELOPE_SCHEMA.split(".").pop()}
                <span className="mx-1">·</span>v{JSON_ENVELOPE_VERSION}
              </span>
            </div>
          </div>

          {/*
            Filter/search toolbar. `role="toolbar"` + aria-label groups
            these controls for AT, and every control uses the natural
            DOM tab order (no `tabIndex` overrides) so keyboard flow
            is: Search → Status/Retry → Tool → Reset → Copy link →
            Debug toggle. Focus-visible rings are strengthened with an
            offset so they stand out against adjacent controls.
          */}
          <div
            role="toolbar"
            aria-label="Diagnostics filters"
            aria-orientation="horizontal"
            className="flex flex-wrap items-center gap-2"
          >
            <Input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tool, error, retry, model…"
              className="h-9 w-full sm:w-72 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="Search diagnostics (Shift+X clears filters, Shift+A resets all)"
            />

            {/*
              Combined Status / Retry-strategy dropdown.

              These two filters were previously two separate <select>s.
              They're semantically related (both scope which requests
              show up) but visually competed for space. Consolidating
              them into a single control with <optgroup> sections gives
              users one place to look while still setting the same
              underlying `status` / `retry` URL params — the query
              layer, tests, and URL persistence are unchanged.

              Selection is mutually exclusive across groups by design:
              picking a Status option clears any active Retry filter
              (and vice versa). Users who need to AND both filters can
              still set them via URL params — activeFilterCount + the
              "Clear filters" chip surfaces that combined state.
            */}
            <select
              value={
                retry !== "all" ? `retry:${retry}` : status !== "all" ? `status:${status}` : "all"
              }
              onChange={(e) => {
                const v = e.target.value;
                if (v === "all") {
                  setStatus("all");
                  setRetry("all");
                } else if (v.startsWith("status:")) {
                  setStatus(v.slice("status:".length) as StatusFilter);
                  setRetry("all");
                } else if (v.startsWith("retry:")) {
                  setRetry(v.slice("retry:".length) as RetryFilter);
                  setStatus("all");
                }
              }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="Filter by status or retry strategy"
            >
              <option value="all">All statuses & retries</option>
              <optgroup label="Status">
                <option value="status:success">Success only</option>
                <option value="status:all-errors">All failures (tool + gateway)</option>
                <option value="status:tool-error">Tool errors (non-gateway)</option>
                <option value="status:gateway-error">Gateway errors (HTTP ≥ 400)</option>
                <option value="status:in-flight">In-flight (still running)</option>
              </optgroup>
              <optgroup label="Retry strategy">
                <option value="retry:primary">Primary</option>
                <option value="retry:sanitized">Sanitized</option>
                <option value="retry:safe-default">Safe default</option>
                <option value="retry:non-primary">Any retry (non-primary)</option>
              </optgroup>
            </select>
            <select
              value={toolName}
              onChange={(e) => setToolName(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm max-w-[16rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="Filter by tool"
            >
              <option value="all">Any tool</option>
              {toolOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                data-ai-diagnostics-reset="filters"
                className="min-h-9"
                aria-keyshortcuts="Shift+X"
                aria-label={`Reset ${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"} and return to page 1 (Shift+X)`}
                title="Reset filters and return to page 1 (Shift+X)"
              >
                <X className="h-4 w-4" aria-hidden />
                <span className="ml-1">Reset filters</span>
              </Button>
            )}
            {hasAnyNonDefault && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetAll}
                data-ai-diagnostics-reset="all"
                className="min-h-9"
                aria-keyshortcuts="Shift+A"
                aria-label="Reset ALL — clear search, filters, sort, page size, and pagination back to defaults in one step (Shift+A)"
                title="Reset everything: filters, sort, page size, pagination (Shift+A)"
              >
                <X className="h-4 w-4" aria-hidden />
                <span className="ml-1">Reset all</span>
              </Button>
            )}
            {/* Polite live region — announces reset results (fired by
                either Reset button, via mouse OR keyboard activation).
                Empty text between announcements keeps the region
                silent when idle. */}
            <span
              id="ai-diagnostics-reset-live"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="sr-only"
            >
              {resetAnnouncement}
            </span>
            <CopyLinkButton />
            <FilterPresetsMenu
              currentState={
                {
                  q: search || undefined,
                  status: status !== "all" ? status : undefined,
                  retry: retry !== "all" ? retry : undefined,
                  tool: toolName !== "all" ? toolName : undefined,
                  sort: sortKey !== "time" ? sortKey : undefined,
                  dir: sortDir !== "desc" ? sortDir : undefined,
                  size: pageSize !== 25 ? pageSize : undefined,
                } satisfies PresetFilterState
              }
              onApply={(preset) => {
                patchSearch(toSearchPatch(preset));
              }}
            />
            <div className="ml-auto flex items-center gap-2">
              <Switch
                id="ai-diagnostics-debug-toggle"
                checked={debugMode}
                onCheckedChange={setDebugMode}
                aria-label="Toggle query-plan debug mode"
              />
              <Label htmlFor="ai-diagnostics-debug-toggle" className="text-xs cursor-pointer">
                Debug (EXPLAIN)
              </Label>
            </div>
          </div>
        </CardHeader>
      </Card>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs underline underline-offset-2 shrink-0"
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}

      {truncationNotice && (
        <div
          role="status"
          className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
            <div>
              <div className="font-medium">
                Filtered {truncationNotice.kind.toUpperCase()} export truncated at{" "}
                {truncationNotice.cap.toLocaleString()} rows
              </div>
              <div className="text-xs opacity-90">
                Downloaded {truncationNotice.exported.toLocaleString()} of{" "}
                {truncationNotice.matched.toLocaleString()} matching rows. Narrow your search or
                filters to export the remaining{" "}
                {(truncationNotice.matched - truncationNotice.exported).toLocaleString()} row
                {truncationNotice.matched - truncationNotice.exported === 1 ? "" : "s"}.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setTruncationNotice(null)}
            className="text-xs underline underline-offset-2 shrink-0"
            aria-label="Dismiss truncation notice"
          >
            Dismiss
          </button>
        </div>
      )}

      {debugMode && (
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-sm flex items-center gap-2">
              Query plan
              <span className="text-xs font-normal text-muted-foreground">
                EXPLAIN (ANALYZE, BUFFERS) on the current filters + sort
              </span>
            </CardTitle>
            <div className="flex items-center gap-2">
              {debugTookMs != null && !debugLoading && (
                <span className="text-xs text-muted-foreground">
                  RPC {debugTookMs.toFixed(0)}ms
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={loadPlan}
                disabled={debugLoading}
                aria-label="Re-run EXPLAIN"
              >
                {debugLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                <span className="ml-2">Re-run</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (debugPlan) void navigator.clipboard.writeText(debugPlan);
                  toast.success("Query plan copied to clipboard");
                }}
                disabled={!debugPlan}
                aria-label="Copy query plan to clipboard"
              >
                Copy
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {debugError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {debugError}
              </div>
            ) : debugPlan ? (
              <pre className="max-h-[420px] overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed font-mono whitespace-pre">
                {debugPlan}
              </pre>
            ) : (
              <div className="text-xs text-muted-foreground">
                {debugLoading ? "Running EXPLAIN…" : "No plan yet."}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {totalRows === 0
            ? "No matching rows"
            : `Showing ${pageStart + 1}–${Math.min(pageStart + pageSize, totalRows)} of ${totalRows.toLocaleString()} row${totalRows === 1 ? "" : "s"}`}
          {pagedGroups.length > 0 && (
            <span className="ml-1 text-muted-foreground/70">
              ({pagedGroups.length} request group{pagedGroups.length === 1 ? "" : "s"} on this page)
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {/*
            Sort controls: grouped for AT so both the field <select> and the
            direction toggle are announced as one composite control ("Sort
            controls, 2 items"). Native keyboard support:
              • Tab / Shift+Tab moves between the two controls.
              • <select> supports Up/Down/Home/End/typeahead natively.
              • The toggle <button> fires on Space/Enter natively; we also
                bind Left/Right arrows to flip direction while it has focus,
                so a keyboard user can sweep across the whole cluster with
                arrow keys once focus lands anywhere inside.
            Every direction/field change is mirrored into an sr-only
            aria-live region below so screen readers announce the new
            sort without the user re-reading the toolbar.
          */}
          <div
            role="group"
            aria-labelledby="ai-diagnostics-sort-group-label"
            className="flex items-center gap-2"
          >
            <span id="ai-diagnostics-sort-group-label" className="sr-only">
              Sort controls
            </span>
            <label htmlFor="ai-diagnostics-sort-key" className="flex items-center gap-1">
              <span className="sr-only">Sort results by field</span>
              <select
                id="ai-diagnostics-sort-key"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Sort results by field (shortcut: Shift+S)"
                aria-keyshortcuts="Shift+S"
                aria-describedby="ai-diagnostics-sort-live ai-diagnostics-sort-hint"
              >
                <option value="time">Sort: Time</option>
                <option value="status">Sort: Status</option>
                <option value="tool">Sort: Tool name</option>
              </select>
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  setSortDir(e.key === "ArrowLeft" ? "asc" : "desc");
                }
              }}
              className="min-h-11 min-w-11 lg:h-8 lg:w-8 lg:min-h-8 lg:min-w-8 p-0 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Sort direction: currently ${sortDir === "asc" ? "ascending" : "descending"}. Press Enter or Space to toggle; Left arrow for ascending, Right arrow for descending. Shortcut anywhere on the page: Shift+D.`}
              aria-pressed={sortDir === "asc"}
              aria-keyshortcuts="ArrowLeft ArrowRight Enter Space Shift+D"
              aria-describedby="ai-diagnostics-sort-live ai-diagnostics-sort-hint"
              title={
                sortDir === "asc"
                  ? "Ascending (click to switch to descending)"
                  : "Descending (click to switch to ascending)"
              }
            >
              {sortDir === "asc" ? (
                <ArrowUp className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ArrowDown className="h-3.5 w-3.5" aria-hidden />
              )}
              <span className="sr-only">{sortDir === "asc" ? "Ascending" : "Descending"}</span>
            </Button>
            {/*
              Polite live region — updates whenever `sortKey` or `sortDir`
              changes, so any input path (dropdown, toggle, header buttons,
              even URL edit) yields the same audible confirmation.
            */}
            {/*
              Polite live region — updates whenever `sortKey` or `sortDir`
              changes, so every input path (dropdown, direction toggle,
              column-header click/keyboard, Shift+S/Shift+D shortcut,
              even a URL edit) yields the same audible confirmation
              naming BOTH the active column AND the direction.
            */}
            <span
              id="ai-diagnostics-sort-live"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="sr-only"
            >
              Sort updated:{" "}
              {sortKey === "time" ? "Time" : sortKey === "status" ? "Status" : "Tool name"} column,{" "}
              {sortDir === "asc" ? "ascending" : "descending"} order.
            </span>
            {/* Visible shortcut hint — kbd elements double as the AT
                description target via aria-describedby above. */}
            <span
              id="ai-diagnostics-sort-hint"
              className="hidden lg:inline text-[10px] text-muted-foreground select-none"
            >
              <kbd className="rounded border border-input bg-muted px-1 py-0.5 font-mono text-[10px]">
                Shift+S
              </kbd>
              <span className="mx-1">focus</span>
              <kbd className="rounded border border-input bg-muted px-1 py-0.5 font-mono text-[10px]">
                Shift+D
              </kbd>
              <span className="ml-1">toggle</span>
            </span>
          </div>
          <label className="flex items-center gap-1">
            <span className="sr-only">Requests per page</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              aria-label="Requests per page"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="min-h-9 min-w-9"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="tabular-nums">
            {currentPage} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="min-h-9 min-w-9"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!loading && totalRows === 0 && (
        <div className="rounded-md border bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
          {activeFilterCount === 0
            ? "No tool calls logged yet. Ask the assistant something and refresh."
            : "No rows match the current filters."}
        </div>
      )}

      {/*
        Clickable column-header bar. The results list below is a stack of
        grouped Cards (not an HTML <table>), so we render a header row that
        matches the field shown in each row: Time (created_at), Status
        (success), Tool name. Clicking a header:
          • flips asc/desc when it's already the active sort,
          • otherwise switches to that column with a sensible default dir
            (desc for Time = newest first; asc for text columns).
        Mirrors the "Sort by" dropdown above, kept as a redundant control
        for keyboard/AT users who prefer a native <select>.
      */}
      <div
        role="row"
        className="hidden sm:flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground border-b"
      >
        {[
          { key: "time" as const, label: "Time", defaultDir: "desc" as const, className: "w-40" },
          {
            key: "status" as const,
            label: "Status",
            defaultDir: "asc" as const,
            className: "w-24",
          },
          {
            key: "tool" as const,
            label: "Tool name",
            defaultDir: "asc" as const,
            className: "flex-1",
          },
        ].map(({ key, label, defaultDir, className }) => (
          <SortableColumnHeader
            key={key}
            columnKey={key}
            label={label}
            active={sortKey === key}
            sortDir={sortDir}
            defaultDir={defaultDir}
            className={className}
            onToggle={(nextDir) => setSort(key, nextDir)}
          />
        ))}
      </div>

      <div className="space-y-3">
        {pagedGroups.map((g) => (
          <RequestGroup
            key={g.reqId}
            reqId={g.reqId}
            list={g.list}
            startedAt={g.startedAt}
            anyFailure={g.anyFailure}
            drawerOpen={sp.req === g.reqId}
            onDrawerOpenChange={(open) => patchSearch({ req: open ? g.reqId : undefined })}
          />
        ))}
      </div>
      <ExportPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        columns={buildExportMeta().columns as Array<{ key: string; label: string }>}
        sampleRow={pagedRows.find(isGatewayErrorRow) ?? pagedRows[0] ?? null}
        prettyGatewayPayload={prettyGatewayPayload}
        buildGatewayErrorPayload={buildGatewayErrorPayload}
        escapeCsvCell={escapeCsvCell}
        rowToCsvCells={rowToCsvCells}
        onExportCsv={() => {
          setPreviewOpen(false);
          handleExportCsv();
        }}
        onExportJson={() => {
          setPreviewOpen(false);
          handleExportJson();
        }}
      />
      <BackgroundExportsPanel jobs={bgJobs} onDismiss={dismissJob} />
    </div>
  );
}

function RequestGroup({
  reqId,
  list,
  startedAt,
  anyFailure,
  drawerOpen,
  onDrawerOpenChange,
}: {
  reqId: string;
  list: Row[];
  startedAt: string;
  anyFailure: boolean;
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
}) {
  // The card body auto-expands when a request has failures OR when the
  // drawer for this request is opened from a shared URL, so a copy-pasted
  // link never lands the reader on a collapsed group.
  const [open, setOpen] = useState(anyFailure || drawerOpen);
  useEffect(() => {
    if (drawerOpen) setOpen(true);
  }, [drawerOpen]);
  const toolNames = list.map((r) => r.tool_name ?? "—").filter((n) => n !== "_final_reply");
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex w-full items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex flex-1 items-center justify-between gap-3 text-left min-h-11"
            aria-expanded={open}
          >
            <div className="flex items-center gap-2 flex-wrap">
              {anyFailure ? (
                <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
              )}
              <span className="font-mono text-xs text-muted-foreground">{reqId.slice(0, 8)}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(startedAt).toLocaleString()}
              </span>
              <span className="text-xs text-foreground">
                {list.length} entr{list.length === 1 ? "y" : "ies"} ·{" "}
                {toolNames.join(" › ") || "no tools"}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">{open ? "Hide" : "Show"}</span>
          </button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDrawerOpenChange(true)}
            className="min-h-11 min-w-11"
            aria-label={`Open details for request ${reqId.slice(0, 8)}`}
          >
            <Maximize2 className="h-4 w-4" />
            <span className="ml-1 hidden sm:inline">Details</span>
          </Button>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-2">
          {list.map((r) => (
            <ToolCallRow key={r.id} row={r} />
          ))}
        </CardContent>
      )}
      <RequestDetailsDrawer
        open={drawerOpen}
        onOpenChange={onDrawerOpenChange}
        reqId={reqId}
        list={list}
        startedAt={startedAt}
        anyFailure={anyFailure}
      />
    </Card>
  );
}

function RequestDetailsDrawer({
  open,
  onOpenChange,
  reqId,
  list,
  startedAt,
  anyFailure,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  reqId: string;
  list: Row[];
  startedAt: string;
  anyFailure: boolean;
}) {
  // Gateway-error rows: HTTP >= 400 or a failure that carries an
  // error_message with no successful result payload. Highlighted at the
  // top of the drawer so triage doesn't require scrolling through
  // successful rounds first.
  const gatewayErrors = list.filter(
    (r) => (r.gateway_status != null && r.gateway_status >= 400) || (!r.success && r.error_message),
  );
  const totalDuration = list.reduce((s, r) => s + (r.duration_ms ?? 0), 0);

  /*
   * In-drawer full-text search across every tool call's tool_name,
   * error_message, arguments and results. We pre-serialise args/result
   * JSON ONCE per row (memoised on `list`) so each keystroke is a
   * cheap `.includes()` scan even when the drawer holds dozens of
   * rows with kilobyte payloads.
   *
   * The gateway-error triage strip at the top intentionally stays
   * unfiltered — its whole purpose is "what went wrong here?", which
   * you shouldn't have to type a query to see.
   */
  const [drawerQuery, setDrawerQuery] = useState("");
  const serialised = useMemo(
    () =>
      list.map((r) => ({
        row: r,
        argsJson:
          r.tool_args !== null && r.tool_args !== undefined
            ? JSON.stringify(r.tool_args, null, 2)
            : "",
        resultJson:
          r.tool_result !== null && r.tool_result !== undefined
            ? JSON.stringify(r.tool_result, null, 2)
            : "",
      })),
    [list],
  );
  const trimmedQ = drawerQuery.trim();
  const needle = trimmedQ.toLowerCase();
  const visibleRows = useMemo(() => {
    if (!needle) return serialised;
    return serialised.filter(({ row, argsJson, resultJson }) => {
      const hay =
        (row.tool_name ?? "").toLowerCase() +
        "\n" +
        (row.error_message ?? "").toLowerCase() +
        "\n" +
        argsJson.toLowerCase() +
        "\n" +
        resultJson.toLowerCase();
      return hay.includes(needle);
    });
  }, [serialised, needle]);

  /**
   * When enabled, only tool calls that failed (unsuccessful, non-2xx
   * gateway status, or carrying an error message) are auto-expanded;
   * everything else collapses so the drawer surfaces just the noise.
   */
  const [errorsOnly, setErrorsOnly] = useState(false);
  const isRowFailing = (r: Row) =>
    r.success === false ||
    (r.gateway_status != null && (r.gateway_status < 200 || r.gateway_status >= 300)) ||
    !!r.error_message;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {anyFailure ? (
              <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
            )}
            <span className="font-mono text-sm">{reqId}</span>
          </SheetTitle>
          <SheetDescription>
            {new Date(startedAt).toLocaleString()} · {list.length} entr
            {list.length === 1 ? "y" : "ies"} · {totalDuration} ms total
          </SheetDescription>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ExportDetailsButton
              reqId={reqId}
              list={list}
              startedAt={startedAt}
              anyFailure={anyFailure}
              gatewayErrors={gatewayErrors}
              totalDuration={totalDuration}
            />
            <DownloadPayloadButton reqId={reqId} list={list} gatewayErrors={gatewayErrors} />
            <CopyButton
              idleLabel="Copy all"
              ariaIdleLabel={`Copy all ${list.length} tool call${list.length === 1 ? "" : "s"} (arguments and results${gatewayErrors.length ? `, plus ${gatewayErrors.length} gateway payload${gatewayErrors.length === 1 ? "" : "s"}` : ""}) for request ${reqId.slice(0, 8)} as a single JSON blob`}
              className="min-h-11 min-w-11 lg:min-h-8 lg:min-w-0 lg:h-8"
              getText={() =>
                JSON.stringify(
                  {
                    request_id: reqId,
                    tool_calls: list.map((r) => ({
                      id: r.id,
                      round: r.round,
                      tool: r.tool_name,
                      success: r.success,
                      error_message: r.error_message,
                      duration_ms: r.duration_ms,
                      arguments: r.tool_args,
                      result: r.tool_result,
                    })),
                    ...(gatewayErrors.length > 0
                      ? {
                          gateway_errors: gatewayErrors.map((r) => ({
                            id: r.id,
                            round: r.round,
                            tool: r.tool_name,
                            gateway_status: r.gateway_status,
                            gateway_model: r.gateway_model,
                            retry_strategy: r.retry_strategy,
                            error_message: r.error_message,
                            arguments: r.tool_args,
                            result: r.tool_result,
                          })),
                        }
                      : {}),
                  },
                  null,
                  2,
                )
              }
            />
            <div className="ml-auto flex items-center gap-2">
              <Switch
                id={`drawer-errors-only-${reqId}`}
                checked={errorsOnly}
                onCheckedChange={setErrorsOnly}
                aria-describedby={`drawer-errors-only-hint-${reqId}`}
              />
              <Label
                htmlFor={`drawer-errors-only-${reqId}`}
                className="text-xs font-normal cursor-pointer"
              >
                Auto-expand errors only
              </Label>
              <span id={`drawer-errors-only-hint-${reqId}`} className="sr-only">
                When on, only tool calls that failed or returned a non-2xx status are expanded.
              </span>
            </div>
          </div>
        </SheetHeader>

        {/* Drawer-local search bar. Autofocus is intentional — opening the
            drawer to hunt a specific value is the common flow. */}
        <div className="mt-4 flex items-center gap-2">
          <label htmlFor={`drawer-search-${reqId}`} className="sr-only">
            Search within this request's tool calls
          </label>
          <Input
            id={`drawer-search-${reqId}`}
            type="search"
            value={drawerQuery}
            onChange={(e) => setDrawerQuery(e.target.value)}
            placeholder="Search tool name, error, arguments, results…"
            className="h-8 text-xs"
            aria-describedby={`drawer-search-count-${reqId}`}
          />
          {trimmedQ && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDrawerQuery("")}
              className="min-h-11 min-w-11 lg:min-h-8 lg:min-w-0 lg:h-8"
              aria-label="Clear drawer search"
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>
        <div
          id={`drawer-search-count-${reqId}`}
          role="status"
          aria-live="polite"
          className="mt-1 text-[11px] text-muted-foreground"
        >
          {trimmedQ
            ? `${visibleRows.length} of ${list.length} tool call${list.length === 1 ? "" : "s"} match “${trimmedQ}”`
            : `${list.length} tool call${list.length === 1 ? "" : "s"}`}
        </div>

        {gatewayErrors.length > 0 && (
          <section className="mt-4 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-destructive">
              Gateway error payloads ({gatewayErrors.length})
            </h3>
            {gatewayErrors.map((r) => (
              <div
                key={`err-${r.id}`}
                className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs space-y-2"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono font-medium">{r.tool_name ?? "(gateway)"}</span>
                  <span className="text-muted-foreground">round {r.round}</span>
                  {r.gateway_status != null && (
                    <span className="text-destructive">HTTP {r.gateway_status}</span>
                  )}
                  {r.gateway_model && (
                    <span className="text-muted-foreground">{r.gateway_model}</span>
                  )}
                  {r.retry_strategy && (
                    <span className="rounded bg-warning/15 px-1.5 py-0.5 text-warning">
                      retry: {r.retry_strategy}
                    </span>
                  )}
                  <span className="ml-auto">
                    <CopyButton
                      idleLabel="Copy payload"
                      ariaIdleLabel={`Copy full gateway error payload for ${r.tool_name ?? "gateway"} round ${r.round}`}
                      className="min-h-11 min-w-11 lg:min-h-8 lg:min-w-0 lg:h-8"
                      getText={() =>
                        JSON.stringify(
                          {
                            tool: r.tool_name,
                            round: r.round,
                            gateway_status: r.gateway_status,
                            gateway_model: r.gateway_model,
                            retry_strategy: r.retry_strategy,
                            error_message: r.error_message,
                            tool_args: r.tool_args,
                            tool_result: r.tool_result,
                          },
                          null,
                          2,
                        )
                      }
                    />
                  </span>
                </div>
                {r.error_message && (
                  <pre className="whitespace-pre-wrap break-words rounded bg-destructive/10 p-2 text-destructive">
                    {highlightText(r.error_message, trimmedQ)}
                  </pre>
                )}
                {r.tool_result !== null && r.tool_result !== undefined && (
                  <pre className="whitespace-pre-wrap break-words rounded bg-background p-2 font-mono">
                    {highlightText(JSON.stringify(r.tool_result, null, 2), trimmedQ)}
                  </pre>
                )}
              </div>
            ))}
          </section>
        )}

        <section className="mt-4 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {trimmedQ
              ? `Matching tool calls (${visibleRows.length})`
              : `All tool calls (${list.length})`}
          </h3>
          {visibleRows.length === 0 && trimmedQ ? (
            <div className="rounded-md border bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
              No tool calls contain “{trimmedQ}”.
            </div>
          ) : (
            visibleRows.map(({ row }) => (
              <ToolCallRow
                key={row.id}
                row={row}
                expanded={errorsOnly ? isRowFailing(row) : true}
                highlight={trimmedQ}
              />
            ))
          )}
        </section>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Splits `text` into React nodes, wrapping every case-insensitive
 * occurrence of `query` in a `<mark>` tag styled with a warning tint.
 * `query` is escaped so regex metacharacters (`.`, `*`, `[`, etc.)
 * search as literals — matching the drawer's `.includes()` semantics.
 * When `query` is empty the raw text is returned verbatim.
 */
function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const esc = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp(esc, "gi");
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = rx.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(
      <mark key={`m${i++}`} className="rounded bg-warning/40 text-foreground px-0.5">
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
    // Zero-length match guard (would infinite-loop; can't happen with our
    // escape, but future-proof).
    if (m[0].length === 0) rx.lastIndex++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/**
 * Rendering + copy threshold for tool argument/result payloads. Serialised
 * JSON larger than this (~50 KB) is truncated on-screen and copied as a
 * truncation-marker string by default so the drawer stays responsive; a
 * secondary "Copy full" button materialises the full payload on demand.
 * The threshold is intentionally generous — typical tool calls fit well
 * under it — and only kicks in for the rare multi-megabyte outlier that
 * would otherwise stall paint / clipboard writes.
 */
const PAYLOAD_TRUNCATE_BYTES = 50 * 1024;

function PayloadBlock({
  label,
  value,
  rowLabel,
  highlight,
  preCap,
  detailsOpen,
}: {
  label: string;
  value: unknown;
  rowLabel: string;
  highlight: string;
  preCap: string;
  detailsOpen: { open?: boolean };
}) {
  // Serialise once per render — reused for size check, display, and copy.
  const full = useMemo(() => JSON.stringify(value, null, 2), [value]);
  const oversized = full.length > PAYLOAD_TRUNCATE_BYTES;
  const shown = oversized
    ? full.slice(0, PAYLOAD_TRUNCATE_BYTES) +
      `\n\n… [truncated ${(full.length - PAYLOAD_TRUNCATE_BYTES).toLocaleString()} more characters — use “Copy full” to copy the entire payload]`
    : full;
  const sizeKb = (full.length / 1024).toFixed(1);

  return (
    <details {...detailsOpen}>
      <summary className="cursor-pointer text-muted-foreground flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span>{label}</span>
          {oversized && (
            <span
              className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning"
              title={`Payload is ${sizeKb} KB; preview is truncated to ${(PAYLOAD_TRUNCATE_BYTES / 1024).toFixed(0)} KB`}
            >
              large · {sizeKb} KB
            </span>
          )}
        </span>
        <span className="flex items-center gap-1">
          <CopyButton
            idleLabel={oversized ? "Copy preview" : "Copy"}
            ariaIdleLabel={
              oversized
                ? `Copy truncated ${label.toLowerCase()} preview for ${rowLabel} (${(PAYLOAD_TRUNCATE_BYTES / 1024).toFixed(0)} KB of ${sizeKb} KB)`
                : `Copy ${label.toLowerCase()} for ${rowLabel}`
            }
            className="min-h-11 min-w-11 lg:min-h-7 lg:min-w-0 lg:h-7 px-2"
            getText={() => shown}
          />
          {oversized && (
            <CopyButton
              idleLabel="Copy full"
              ariaIdleLabel={`Copy full ${label.toLowerCase()} (${sizeKb} KB) for ${rowLabel}`}
              className="min-h-11 min-w-11 lg:min-h-7 lg:min-w-0 lg:h-7 px-2"
              getText={() => full}
            />
          )}
        </span>
      </summary>
      <pre
        className={`mt-1 ${preCap} whitespace-pre-wrap break-words rounded bg-background p-2 font-mono`}
      >
        {highlightText(shown, highlight)}
      </pre>
    </details>
  );
}

function ToolCallRow({
  row,
  expanded = false,
  highlight = "",
}: {
  row: Row;
  expanded?: boolean;
  highlight?: string;
}) {
  // In the drawer we want full payloads visible without an inner scroll — the
  // drawer itself scrolls. Inline rows keep the compact 16rem cap.
  const preCap = expanded ? "" : "max-h-64 overflow-auto";
  const detailsOpen = expanded ? { open: true } : {};
  return (
    <div className="rounded-md border bg-muted/20 p-3 text-xs space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono font-medium text-foreground">
          {row.tool_name ?? "(gateway)"}
        </span>
        <span className="text-muted-foreground">round {row.round}</span>
        {row.duration_ms != null && (
          <span className="text-muted-foreground">{row.duration_ms} ms</span>
        )}
        {row.gateway_status != null && (
          <span
            className={row.gateway_status >= 400 ? "text-destructive" : "text-muted-foreground"}
          >
            HTTP {row.gateway_status}
          </span>
        )}
        {row.retry_strategy && row.retry_strategy !== "primary" && (
          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-warning">
            retry: {row.retry_strategy}
          </span>
        )}
        {row.in_flight ? (
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-primary inline-flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            running
          </span>
        ) : (
          !row.success && (
            <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive">failed</span>
          )
        )}
      </div>
      {row.error_message && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-[11px] uppercase tracking-wide">
              Error message
            </span>
            <CopyButton
              idleLabel="Copy"
              ariaIdleLabel={`Copy error message for ${row.tool_name ?? "gateway"} round ${row.round}`}
              className="min-h-11 min-w-11 lg:min-h-7 lg:min-w-0 lg:h-7 px-2"
              getText={() => row.error_message ?? ""}
            />
          </div>
          <pre className="whitespace-pre-wrap break-words rounded bg-destructive/10 p-2 text-destructive">
            {highlightText(row.error_message, highlight)}
          </pre>
        </div>
      )}
      {row.tool_args !== null && row.tool_args !== undefined && (
        <PayloadBlock
          label="Arguments"
          value={row.tool_args}
          rowLabel={`${row.tool_name ?? "gateway"} round ${row.round}`}
          highlight={highlight}
          preCap={preCap}
          detailsOpen={detailsOpen}
        />
      )}
      {row.tool_result !== null && row.tool_result !== undefined && (
        <PayloadBlock
          label="Result"
          value={row.tool_result}
          rowLabel={`${row.tool_name ?? "gateway"} round ${row.round}`}
          highlight={highlight}
          preCap={preCap}
          detailsOpen={detailsOpen}
        />
      )}
    </div>
  );
}

/**
 * Copy an arbitrary text payload to the clipboard using the async
 * Clipboard API, with a legacy `execCommand` fallback for insecure
 * origins / sandboxed iframes. Resolves `true` on success.
 */
/**
 * Result of a copy attempt. Callers get either `{ ok: true }` or a
 * specific failure `reason` plus a user-facing `message` they can
 * surface directly in the UI — no toast plumbing required.
 *
 * Reasons are intentionally coarse:
 *   • `insecure`   — page is served over http:// (or a sandboxed
 *                    iframe); the Async Clipboard API is disabled by
 *                    the browser regardless of user intent.
 *   • `unsupported`— neither `navigator.clipboard.writeText` nor
 *                    the legacy `document.execCommand('copy')`
 *                    fallback works in this environment.
 *   • `denied`     — user (or an enterprise policy) rejected the
 *                    clipboard-write permission prompt. Distinct from
 *                    `unsupported` because retrying may succeed if the
 *                    user changes their site setting.
 *   • `unknown`    — anything else the API threw. We keep the
 *                    original message so the sr-only announcement
 *                    still tells the user something actionable.
 */
type CopyReason = "insecure" | "unsupported" | "denied" | "unknown";
type CopyResult = { ok: true } | { ok: false; reason: CopyReason; message: string };

function copyReasonMessage(reason: CopyReason, detail?: string): string {
  switch (reason) {
    case "insecure":
      return "Clipboard access isn't available on insecure (HTTP) pages. Use the text field below to copy manually.";
    case "unsupported":
      return "Your browser doesn't allow clipboard access from this page. Use the text field below to copy manually.";
    case "denied":
      return "Clipboard permission was denied. Allow clipboard access in your browser's site settings, or use the text field below to copy manually.";
    case "unknown":
    default:
      return detail
        ? `Copy failed: ${detail}. Use the text field below to copy manually.`
        : "Copy failed. Use the text field below to copy manually.";
  }
}

async function copyToClipboard(text: string): Promise<CopyResult> {
  if (typeof window === "undefined") {
    return { ok: false, reason: "unsupported", message: copyReasonMessage("unsupported") };
  }

  // Async Clipboard API is only exposed in secure contexts (https:,
  // localhost, or file:). Detect up-front so the failure message is
  // specific ("insecure page") instead of a generic permission error.
  const secure = window.isSecureContext !== false;
  const hasAsync = !!navigator.clipboard?.writeText;

  if (hasAsync && secure) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    } catch (err) {
      // A DOMException with name === "NotAllowedError" is the standard
      // signal for a denied permission prompt or a blocked call from an
      // untrusted event (e.g. permission previously revoked).
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        return { ok: false, reason: "denied", message: copyReasonMessage("denied") };
      }
      // Fall through to the legacy execCommand path — some browsers
      // (older Safari, embedded WebViews) reject the async API but
      // still honour the synchronous fallback.
    }
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) return { ok: true };
  } catch {
    /* fall through to reason classification below */
  }

  // Classify the failure so the UI can pick the clearest message.
  if (!secure) {
    return { ok: false, reason: "insecure", message: copyReasonMessage("insecure") };
  }
  if (!hasAsync) {
    return { ok: false, reason: "unsupported", message: copyReasonMessage("unsupported") };
  }
  return { ok: false, reason: "unknown", message: copyReasonMessage("unknown") };
}

/**
 * Shared copy button with `idle → copied → idle` and `idle → error → idle`
 * transitions, a matching icon swap, and a polite sr-only announcement.
 *
 * `getText` is a lazy getter so callers can compose the payload at click
 * time (e.g. re-serialise the freshest row snapshot) without re-rendering
 * to update a captured string.
 */
function CopyButton({
  getText,
  idleLabel,
  copiedLabel = "Copied!",
  errorLabel = "Retry",
  ariaIdleLabel,
  className = "min-h-9",
  size = "sm",
  variant = "ghost",
  showTextLabel = true,
  dataAction,
  keyshortcut,
}: {
  getText: () => string;
  idleLabel: string;
  copiedLabel?: string;
  errorLabel?: string;
  ariaIdleLabel: string;
  className?: string;
  size?: "sm" | "default";
  variant?: "ghost" | "outline";
  showTextLabel?: boolean;
  /** Optional data-ai-diagnostics-action tag so a global keyboard
   *  shortcut can locate this exact button (e.g. Shift+C for
   *  "Copy link") without threading refs through every ancestor. */
  dataAction?: string;
  /** Human-readable shortcut string surfaced via aria-keyshortcuts +
   *  tooltip so both AT and sighted users discover the shortcut. */
  keyshortcut?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  /*
    On failure we retain BOTH the classified reason (drives which
    fallback UI to render) and the payload that failed to copy (fed
    into a manual-copy textarea so the user has a way out even when
    the browser refuses clipboard access outright — e.g. insecure
    origin, hardened enterprise policy, denied permission prompt).
    Cleared on any successful copy or on the auto-return to idle.
  */
  const [errorReason, setErrorReason] = useState<CopyReason | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [pendingText, setPendingText] = useState<string>("");
  /*
    After a successful copy we stash the exact string that landed on
    the clipboard so a small confirmation panel can show it back to
    the user — makes it obvious *what* was copied (matters for the
    "Copy link" case where the URL carries filter/sort state and the
    user needs to confirm it's the right filtered view).
  */
  const [copiedText, setCopiedText] = useState<string>("");
  const fallbackRef = useRef<HTMLInputElement | null>(null);

  const onClick = async (e: React.MouseEvent) => {
    // Some parents (<summary>, <button>) would otherwise toggle / navigate.
    e.preventDefault();
    e.stopPropagation();
    const text = getText();
    const result = await copyToClipboard(text);
    if (result.ok) {
      setStatus("copied");
      setErrorReason(null);
      setErrorMessage("");
      setPendingText("");
      setCopiedText(text);
      // Clear both the label AND the confirmation panel together so
      // the UI doesn't leave a stale "Copied: …" strip visible after
      // the button has already returned to idle.
      window.setTimeout(() => {
        setStatus("idle");
        setCopiedText("");
      }, 2500);
      return;
    }
    setStatus("error");
    setErrorReason(result.reason);
    setErrorMessage(result.message);
    setPendingText(text);
    // Focus + select the manual-copy field on the next paint so
    // keyboard users can immediately press Ctrl/Cmd+C. Skipped for
    // `unknown` because retry is often the right first action there.
    if (result.reason !== "unknown") {
      window.setTimeout(() => {
        const el = fallbackRef.current;
        if (el) {
          el.focus();
          el.select();
        }
      }, 0);
    }
    // Keep the visible error state longer than the copied state so the
    // user has time to read the message and use the fallback field.
    window.setTimeout(() => {
      setStatus("idle");
      // Error message + fallback stay visible after the button label
      // resets — dismissed only by a successful retry (above) or when
      // the component unmounts.
    }, 2000);
  };

  const ariaLabel =
    status === "copied"
      ? `${ariaIdleLabel} — copied to clipboard`
      : status === "error"
        ? `${ariaIdleLabel} — copy failed, press again`
        : ariaIdleLabel;

  const showFallback = errorReason !== null && pendingText.length > 0;
  const fallbackId = `copy-fallback-${idleLabel.replace(/\W+/g, "-").toLowerCase()}`;

  // Truncate the confirmation text for display — long URLs / JSON
  // blobs would otherwise blow out the toolbar layout. Head + tail
  // preserved so users see the origin AND the query-tail (where the
  // meaningful filter/sort params live).
  const truncateForConfirm = (text: string, max = 72): string => {
    if (text.length <= max) return text;
    const head = Math.ceil((max - 1) / 2);
    const tail = Math.floor((max - 1) / 2);
    return `${text.slice(0, head)}…${text.slice(-tail)}`;
  };
  const showCopiedConfirm = status === "copied" && copiedText.length > 0;
  const truncatedCopied = showCopiedConfirm ? truncateForConfirm(copiedText) : "";
  const confirmId = `copy-confirm-${idleLabel.replace(/\W+/g, "-").toLowerCase()}`;

  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={onClick}
        className={className}
        aria-label={keyshortcut ? `${ariaLabel} (${keyshortcut})` : ariaLabel}
        title={keyshortcut ? `${ariaLabel} (${keyshortcut})` : ariaLabel}
        aria-keyshortcuts={keyshortcut}
        aria-describedby={showFallback ? fallbackId : showCopiedConfirm ? confirmId : undefined}
        data-ai-diagnostics-action={dataAction}
      >
        {status === "copied" ? (
          <Check className="h-4 w-4 text-success" aria-hidden />
        ) : status === "error" ? (
          <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
        ) : (
          <Link2 className="h-4 w-4" aria-hidden />
        )}
        {showTextLabel && (
          <span className="ml-1">
            {status === "copied" ? copiedLabel : status === "error" ? errorLabel : idleLabel}
          </span>
        )}
        {/*
          Polite live region — announces the FULL error message on
          failure and the FULL copied value on success so screen
          readers can confirm both what happened and what landed on
          the clipboard.
        */}
        <span role="status" aria-live="polite" className="sr-only">
          {status === "copied"
            ? `${ariaIdleLabel}: copied to clipboard — ${copiedText}`
            : status === "error"
              ? `${ariaIdleLabel}: ${errorMessage}`
              : ""}
        </span>
      </Button>
      {showCopiedConfirm && (
        <div
          id={confirmId}
          className="flex items-center gap-2 rounded-md border border-success/40 bg-success/5 px-2 py-1 text-xs text-foreground"
          data-testid="copy-confirmation"
        >
          <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
          <span className="shrink-0 font-medium text-success">Copied:</span>
          {/*
            `title` carries the full untruncated text so a hover
            reveals the exact string that hit the clipboard.
            `dir="ltr"` keeps URL characters left-to-right even when
            the surrounding UI is RTL.
          */}
          <span
            dir="ltr"
            title={copiedText}
            className="truncate font-mono text-[11px] text-muted-foreground"
            data-testid="copy-confirmation-text"
          >
            {truncatedCopied}
          </span>
        </div>
      )}
      {showFallback && (
        <div
          id={fallbackId}
          role="alert"
          className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive"
        >
          <p className="font-medium">{errorMessage}</p>
          {/*
            Read-only text field pre-selected on render so the user
            can Ctrl/Cmd+C immediately. Wider than the button so long
            URLs / JSON payloads are usable without horizontal scroll.
          */}
          <input
            ref={fallbackRef}
            type="text"
            readOnly
            value={pendingText}
            onFocus={(ev) => ev.currentTarget.select()}
            aria-label={`${ariaIdleLabel} — select all and press Ctrl or Cmd + C to copy manually`}
            className="w-full min-w-[16rem] rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      )}
    </span>
  );
}

/**
 * Copies the current diagnostics URL (full location.href) with every
 * search / filter / sort / pagination param. Reads `window.location.href`
 * at click time so the very latest URL wins even if a patch just fired.
 */
function CopyLinkButton() {
  return (
    <CopyButton
      idleLabel="Copy link"
      ariaIdleLabel="Copy link to this filtered view"
      getText={() => (typeof window === "undefined" ? "" : window.location.href)}
      dataAction="copy-link"
      keyshortcut="Shift+C"
    />
  );
}

/**
 * Downloads the full contents of one request group — every tool call
 * plus the pre-computed gateway-error subset — as a single JSON file.
 *
 * File shape mirrors the JSON envelope used elsewhere in the app: a
 * `meta` block (schema version, request id, timing, counts) plus a
 * `tool_calls[]` array of raw rows and a `gateway_errors[]` array
 * containing the same rows that appear in the drawer's triage strip.
 * Keeping both makes the file self-contained — an engineer opening
 * `req-abc12345.json` in a diff tool doesn't have to reconstruct
 * which rows were flagged as gateway errors.
 *
 * Filename: `ai-diagnostics-req-<first-8-of-reqId>-<yyyymmdd-hhmmss>Z.json`,
 * timestamped in UTC so parallel downloads never collide.
 */
function ExportDetailsButton({
  reqId,
  list,
  startedAt,
  anyFailure,
  gatewayErrors,
  totalDuration,
}: {
  reqId: string;
  list: Row[];
  startedAt: string;
  anyFailure: boolean;
  gatewayErrors: Row[];
  totalDuration: number;
}) {
  const [status, setStatus] = useState<"idle" | "downloaded" | "error">("idle");

  const onClick = () => {
    try {
      const now = new Date();
      const payload = {
        meta: {
          schema: "lovable.ai-diagnostics.request-details",
          version: 1,
          exported_at: now.toISOString(),
          request_id: reqId,
          started_at: startedAt,
          any_failure: anyFailure,
          total_duration_ms: totalDuration,
          tool_call_count: list.length,
          gateway_error_count: gatewayErrors.length,
        },
        tool_calls: list,
        gateway_errors: gatewayErrors,
      };
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const stamp = now
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d+Z$/, "Z");
      const a = document.createElement("a");
      a.href = url;
      a.download = `ai-diagnostics-req-${reqId.slice(0, 8)}-${stamp}.json`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke on next tick so Safari has time to start the download.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("downloaded");
      window.setTimeout(() => setStatus("idle"), 1500);
    } catch {
      setStatus("error");
      window.setTimeout(() => setStatus("idle"), 2000);
    }
  };

  const label =
    status === "downloaded" ? "Downloaded" : status === "error" ? "Retry export" : "Export details";
  const ariaLabel =
    status === "downloaded"
      ? `Request ${reqId.slice(0, 8)} details downloaded as JSON`
      : status === "error"
        ? `Export failed for request ${reqId.slice(0, 8)} — press again`
        : `Export request ${reqId.slice(0, 8)} details (${list.length} tool call${list.length === 1 ? "" : "s"}, ${gatewayErrors.length} gateway error${gatewayErrors.length === 1 ? "" : "s"}) as a JSON file`;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      className="min-h-11 min-w-11 lg:min-h-8 lg:min-w-0 lg:h-8"
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {status === "downloaded" ? (
        <Check className="h-4 w-4 text-success" aria-hidden />
      ) : (
        <Download className="h-4 w-4" aria-hidden />
      )}
      <span className="ml-1">{label}</span>
      <span role="status" aria-live="polite" className="sr-only">
        {status === "downloaded"
          ? "Request details downloaded."
          : status === "error"
            ? "Export failed."
            : ""}
      </span>
    </Button>
  );
}

/**
 * Downloads the current drawer's raw payload — `gateway_errors` and
 * `tool_calls` arrays only — as a pretty-printed JSON file. Complements
 * `ExportDetailsButton` (which wraps the same rows in a `meta` envelope)
 * for consumers that want the drawer contents verbatim.
 */
function DownloadPayloadButton({
  reqId,
  list,
  gatewayErrors,
}: {
  reqId: string;
  list: Row[];
  gatewayErrors: Row[];
}) {
  const [status, setStatus] = useState<"idle" | "downloaded" | "error">("idle");

  const onClick = () => {
    try {
      const payload = {
        gateway_errors: gatewayErrors,
        tool_calls: list,
      };
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const stamp = new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d+Z$/, "Z");
      const a = document.createElement("a");
      a.href = url;
      a.download = `ai-diagnostics-payload-${reqId.slice(0, 8)}-${stamp}.json`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("downloaded");
      window.setTimeout(() => setStatus("idle"), 1500);
    } catch {
      setStatus("error");
      window.setTimeout(() => setStatus("idle"), 2000);
    }
  };

  const label =
    status === "downloaded"
      ? "Downloaded"
      : status === "error"
        ? "Retry download"
        : "Download JSON";
  const ariaLabel =
    status === "downloaded"
      ? `Drawer payload for request ${reqId.slice(0, 8)} downloaded as JSON`
      : status === "error"
        ? `Download failed for request ${reqId.slice(0, 8)} — press again`
        : `Download drawer payload for request ${reqId.slice(0, 8)} (${gatewayErrors.length} gateway error${gatewayErrors.length === 1 ? "" : "s"}, ${list.length} tool call${list.length === 1 ? "" : "s"}) as pretty-printed JSON`;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      className="min-h-11 min-w-11 lg:min-h-8 lg:min-w-0 lg:h-8"
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {status === "downloaded" ? (
        <Check className="h-4 w-4 text-success" aria-hidden />
      ) : (
        <Download className="h-4 w-4" aria-hidden />
      )}
      <span className="ml-1">{label}</span>
      <span role="status" aria-live="polite" className="sr-only">
        {status === "downloaded"
          ? "Drawer payload downloaded."
          : status === "error"
            ? "Download failed."
            : ""}
      </span>
    </Button>
  );
}

/**
 * Modal showing the exact CSV header line and one sample CSV row, plus
 * the equivalent JSON row shape, so a user can verify column order and
 * how `gateway_error_payload` will render (object vs pretty string)
 * BEFORE triggering a download. The sample row is the first
 * gateway-error row on the current page when one exists (so the payload
 * column is populated), otherwise the first paged row.
 */
function ExportPreviewDialog({
  open,
  onOpenChange,
  columns,
  sampleRow,
  prettyGatewayPayload,
  buildGatewayErrorPayload,
  escapeCsvCell,
  rowToCsvCells,
  onExportCsv,
  onExportJson,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  columns: Array<{ key: string; label: string }>;
  sampleRow: Row | null;
  prettyGatewayPayload: boolean;
  buildGatewayErrorPayload: (r: Row, format?: "object" | "compact" | "pretty") => unknown;
  escapeCsvCell: (v: unknown) => string;
  rowToCsvCells: (r: Row) => string[];
  onExportCsv: () => void;
  onExportJson: () => void;
}) {
  const headerLine = columns.map((c) => escapeCsvCell(c.label)).join(",");
  const sampleCsv = sampleRow ? rowToCsvCells(sampleRow).join(",") : "";
  const sampleJson = sampleRow
    ? JSON.stringify(
        {
          ...sampleRow,
          gateway_error_payload: buildGatewayErrorPayload(
            sampleRow,
            prettyGatewayPayload ? "pretty" : "object",
          ),
        },
        null,
        2,
      )
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Export preview</DialogTitle>
          <DialogDescription>
            Exact CSV headers and a sample row from the current page.{" "}
            <span className="font-medium">
              Pretty payload is {prettyGatewayPayload ? "on" : "off"}
            </span>{" "}
            — toggle it in the toolbar to change how{" "}
            <code className="font-mono">gateway_error_payload</code> is rendered.
          </DialogDescription>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-mono text-muted-foreground">
            <span className="rounded border border-border/60 bg-muted/40 px-2 py-0.5">
              schema: {JSON_ENVELOPE_SCHEMA}
            </span>
            <span className="rounded border border-border/60 bg-muted/40 px-2 py-0.5">
              version: {JSON_ENVELOPE_VERSION}
            </span>
          </div>
        </DialogHeader>

        {!sampleRow ? (
          <p className="text-sm text-muted-foreground">No rows on the current page to preview.</p>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            <section className="space-y-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                CSV headers ({columns.length})
              </h3>
              <pre className="rounded-md bg-muted p-3 text-xs font-mono whitespace-pre-wrap break-all">
                {headerLine}
              </pre>
            </section>

            <section className="space-y-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Sample CSV row
                {sampleRow && (sampleRow.gateway_status ?? 0) >= 400 && (
                  <span className="ml-2 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] text-destructive">
                    gateway-error row
                  </span>
                )}
              </h3>
              <pre className="rounded-md bg-muted p-3 text-xs font-mono whitespace-pre-wrap break-all max-h-64 overflow-auto">
                {sampleCsv}
              </pre>
            </section>

            <section className="space-y-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Sample JSON row
              </h3>
              <pre className="rounded-md bg-muted p-3 text-xs font-mono whitespace-pre-wrap max-h-64 overflow-auto">
                {sampleJson}
              </pre>
            </section>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button variant="outline" onClick={onExportCsv} disabled={!sampleRow}>
            <Download className="h-4 w-4 mr-2" />
            Download CSV
          </Button>
          <Button onClick={onExportJson} disabled={!sampleRow}>
            <Download className="h-4 w-4 mr-2" />
            Download JSON
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
