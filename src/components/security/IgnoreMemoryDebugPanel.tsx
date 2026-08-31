/**
 * IgnoreMemoryDebugPanel — read-only diagnostics view for the local
 * security-memory mirror. For every ignore entry it shows the finding id,
 * justification, timestamp, and whether the entry is currently ACTIVE
 * against the surfaced scan (rule matched a finding and skipped it),
 * INERT (nothing in the current scan matches — safe but stale), or
 * SHADOWED (a matching finding is still present because the caller did
 * not apply the skip filter yet).
 *
 * Purpose: after a page refresh, glance at this panel to confirm which
 * security-memory rules are doing the skipping right now.
 */
import { Fragment as FragmentWithKey, useMemo, useState } from "react";
import {
  ShieldQuestion,
  Search,
  ArrowDownUp,
  RefreshCw,
  Download,
  Sparkles,
  Copy,
  Check,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SecurityFinding } from "@/lib/security/findings";
import { getIgnoredMemory, pruneIgnoredNotIn } from "@/lib/security/testFindings";

type Severity = SecurityFinding["level"] | "none";
type SortKey = "id" | "ignoredAt" | "state" | "severity";
type SearchField = "any" | "id" | "justification" | "scanner" | "name";

const SKIP_REASON_LABEL: Record<EntryState, string> = {
  active: "Skipped (rule fired)",
  shadowed: "Surfaced (skip off)",
  inert: "No match (stale)",
};

type EntryState = "active" | "inert" | "shadowed";

const STATE_BADGE: Record<EntryState, string> = {
  active: "border-emerald-400/40 bg-emerald-400/15 text-emerald-200",
  shadowed: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  inert: "border-slate-400/40 bg-slate-400/10 text-slate-200",
};

const STATE_HELP: Record<EntryState, string> = {
  active: "Rule matched a merged finding and is being skipped from the surfaced scan.",
  shadowed:
    "A matching finding is still present in the surfaced scan — skip filter is not applied yet.",
  inert: "No finding matches this rule in the current scan (safe, but stale).",
};

/**
 * @param mergedFindings The findings after merge + ignore-overlay (pre-skip).
 * @param surfacedFindings The findings actually shown to the user (post-skip).
 */
export function IgnoreMemoryDebugPanel({
  mergedFindings,
  surfacedFindings,
  className,
  refreshKey,
  onRefresh,
}: {
  mergedFindings: readonly SecurityFinding[];
  surfacedFindings: readonly SecurityFinding[];
  className?: string;
  /** Bump to force re-read of localStorage after a seeder mutation. */
  refreshKey?: number;
  /** Called when the reviewer clicks "Refresh debug view" — parent should
   *  re-run its merged / surfaced computation so both sides stay in sync
   *  with the latest localStorage state. */
  onRefresh?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [searchField, setSearchField] = useState<SearchField>("any");
  const [stateFilter, setStateFilter] = useState<"all" | EntryState>("all");
  const [severityFilter, setSeverityFilter] = useState<"all" | Severity>("all");
  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "ok" | "err">("idle");
  const [autoExpandSkipped, setAutoExpandSkipped] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("security-review:debug-auto-expand-skipped") === "1";
    } catch {
      return false;
    }
  });

  const toggleAutoExpandSkipped = () => {
    setAutoExpandSkipped((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("security-review:debug-auto-expand-skipped", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const filtersActive =
    query.trim().length > 0 ||
    searchField !== "any" ||
    stateFilter !== "all" ||
    severityFilter !== "all";

  const clearFilters = () => {
    setQuery("");
    setSearchField("any");
    setStateFilter("all");
    setSeverityFilter("all");
  };

  const handleRefresh = () => {
    onRefresh?.();
    setRefreshedAt(new Date().toLocaleTimeString());
  };

  const buildDebugPayload = () => ({
    generatedAt: new Date().toISOString(),
    description:
      "Snapshot of the local security-memory mirror grouped by match state. `active` entries were skipped from the surfaced scan; `shadowed` entries matched a finding but the skip filter was off; `inert` entries have no matching finding.",
    counts: {
      active: allRows.filter((r) => r.state === "active").length,
      shadowed: allRows.filter((r) => r.state === "shadowed").length,
      inert: allRows.filter((r) => r.state === "inert").length,
    },
    entries: allRows.map((r) => ({
      id: r.id,
      state: r.state,
      severity: r.severity,
      justification: r.justification,
      ignoredAt: r.ignoredAt,
      match: r.match
        ? {
            id: r.match.id,
            scanner: r.match.scanner,
            name: r.match.name,
            level: r.match.level,
            status: r.match.status,
          }
        : null,
      skipRule: "finding.id === security-memory[id]",
      skipped:
        r.state === "active"
          ? "yes — applyIgnoreSkip dropped the matching finding"
          : r.state === "shadowed"
            ? "no — matching finding surfaced because skip filter is off"
            : "n/a — no finding matches this rule in the current scan",
    })),
  });

  const handleExport = () => {
    const payload = buildDebugPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `security-ignore-debug-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  /** Mirror the 5-step evaluation trace rendered in each row's collapsible
   *  <details> section, in a machine-readable shape suitable for JSON export. */
  const buildTracePayload = () => ({
    generatedAt: new Date().toISOString(),
    description:
      "Step-by-step evaluation trace for every security-memory ignore rule, matching the 5 steps rendered in each row's collapsible section: load → scan → compare → skip filter → result.",
    counts: {
      active: allRows.filter((r) => r.state === "active").length,
      shadowed: allRows.filter((r) => r.state === "shadowed").length,
      inert: allRows.filter((r) => r.state === "inert").length,
    },
    entries: allRows.map((r) => {
      const outcome =
        r.state === "active" ? "skipped" : r.state === "shadowed" ? "surfaced" : "no-op";
      return {
        id: r.id,
        state: r.state,
        outcome,
        severity: r.severity,
        justification: r.justification,
        ignoredAt: r.ignoredAt,
        match: r.match
          ? {
              id: r.match.id,
              scanner: r.match.scanner,
              name: r.match.name,
              level: r.match.level,
              status: r.match.status,
            }
          : null,
        steps: [
          {
            step: 1,
            phase: "load",
            call: "getIgnoredMemory()",
            input: `security-memory[${r.id}]`,
            result: "present",
            status: "ok",
          },
          {
            step: 2,
            phase: "scan",
            call: `merged.findings.find(f => f.id === "${r.id}")`,
            result: r.match ? "hit" : "no-hit",
            status: r.match ? "ok" : "miss",
            hit: r.match
              ? { id: r.match.id, scanner: r.match.scanner, level: r.match.level }
              : null,
          },
          {
            step: 3,
            phase: "compare",
            rule: "finding.id === security-memory[id]",
            left: r.match?.id ?? null,
            right: r.id,
            result: r.match ? true : null,
            status: r.match ? "ok" : "n/a",
          },
          {
            step: 4,
            phase: "skip-filter",
            call: "applyIgnoreSkip(merged)",
            filterOn: r.state === "active",
            action:
              r.state === "active"
                ? `drop finding ${r.match?.id ?? ""}`
                : r.state === "shadowed"
                  ? `keep finding ${r.match?.id ?? ""}`
                  : "nothing to drop",
            status: r.state === "active" ? "ok" : r.state === "shadowed" ? "off" : "n/a",
          },
          {
            step: 5,
            phase: "result",
            outcome,
            surfacedContainsMatch: r.state === "shadowed",
            ruleState: r.state.toUpperCase(),
            summary:
              r.state === "active"
                ? `surfacedFindings excludes ${r.match?.id ?? ""} — rule is ACTIVE`
                : r.state === "shadowed"
                  ? `surfacedFindings still contains ${r.match?.id ?? ""} — rule is SHADOWED`
                  : "no finding to act on — rule is INERT",
          },
        ],
      };
    }),
  });

  const handleExportTrace = () => {
    const payload = buildTracePayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `security-ignore-trace-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    const text = JSON.stringify(buildDebugPayload(), null, 2);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setCopyState("ok");
    } catch {
      setCopyState("err");
    }
    setTimeout(() => setCopyState("idle"), 1500);
  };

  const handlePruneInert = () => {
    // Keep every id that still corresponds to a merged finding
    // (i.e. active + shadowed). Everything else is inert and gets dropped.
    const keep = mergedFindings.map((f) => f.id);
    pruneIgnoredNotIn(keep);
    onRefresh?.();
    setRefreshedAt(new Date().toLocaleTimeString());
  };

  const allRows = useMemo(() => {
    void refreshKey;
    const memory = getIgnoredMemory();
    const mergedById = new Map(mergedFindings.map((f) => [f.id, f]));
    const surfacedIds = new Set(surfacedFindings.map((f) => f.id));
    return Object.entries(memory).map(([id, { justification, ignoredAt }]) => {
      const match = mergedById.get(id);
      let state: EntryState;
      if (!match) state = "inert";
      else if (surfacedIds.has(id)) state = "shadowed";
      else state = "active";
      const severity: Severity = match?.level ?? "none";
      return { id, justification, ignoredAt, state, match, severity };
    });
  }, [mergedFindings, surfacedFindings, refreshKey]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = allRows.filter((r) => {
      if (stateFilter !== "all" && r.state !== stateFilter) return false;
      if (severityFilter !== "all" && r.severity !== severityFilter) return false;
      if (!q) return true;
      const id = r.id.toLowerCase();
      const just = r.justification.toLowerCase();
      const name = r.match?.name.toLowerCase() ?? "";
      const scanner = r.match?.scanner.toLowerCase() ?? "";
      switch (searchField) {
        case "id":
          return id.includes(q);
        case "justification":
          return just.includes(q);
        case "scanner":
          return scanner.includes(q);
        case "name":
          return name.includes(q);
        case "any":
        default:
          return id.includes(q) || just.includes(q) || name.includes(q) || scanner.includes(q);
      }
    });
    const stateOrder: Record<EntryState, number> = { active: 0, shadowed: 1, inert: 2 };
    const sevOrder: Record<Severity, number> = { error: 0, warn: 1, info: 2, none: 3 };
    const cmp = (a: (typeof filtered)[number], b: (typeof filtered)[number]) => {
      switch (sortKey) {
        case "ignoredAt":
          return a.ignoredAt.localeCompare(b.ignoredAt);
        case "state":
          return stateOrder[a.state] - stateOrder[b.state];
        case "severity":
          return sevOrder[a.severity] - sevOrder[b.severity];
        case "id":
        default:
          return a.id.localeCompare(b.id);
      }
    };
    const sorted = [...filtered].sort(cmp);
    return sortDir === "asc" ? sorted : sorted.reverse();
  }, [allRows, query, searchField, stateFilter, severityFilter, sortKey, sortDir]);

  const counts = useMemo(() => {
    const acc: Record<EntryState, number> = { active: 0, shadowed: 0, inert: 0 };
    for (const r of allRows) acc[r.state] += 1;
    return acc;
  }, [allRows]);

  return (
    <Card
      className={cn("border-primary/20 bg-card/60 backdrop-blur", className)}
      data-testid="ignore-memory-debug-panel"
    >
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 font-serif text-base">
            <ShieldQuestion className="h-4 w-4 text-primary" aria-hidden />
            security-memory · active ignores
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {(["active", "shadowed", "inert"] as const).map((s) => {
              const selected = stateFilter === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStateFilter(selected ? "all" : s)}
                  aria-pressed={selected}
                  title={selected ? `Showing only ${s} — click to clear` : `Show only ${s} entries`}
                  data-testid={`ignore-memory-debug-count-${s}`}
                  className={cn(
                    "rounded-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                    selected ? "ring-2 ring-primary/60" : "opacity-80 hover:opacity-100",
                  )}
                >
                  <Badge variant="outline" className={cn("text-[10px]", STATE_BADGE[s])}>
                    {counts[s]} {s}
                  </Badge>
                </button>
              );
            })}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Snapshot of every rule currently recorded in the local
          <span className="mx-1 font-mono">security-memory</span>
          mirror. <em>Active</em> = matched a merged finding and was skipped from the surfaced scan.{" "}
          <em>Shadowed</em> = still visible because the skip filter is off. <em>Inert</em> = no
          finding matches.
        </p>

        <div
          role="search"
          aria-label="Search and filter security-memory entries"
          className="mt-1 rounded-md border border-primary/15 bg-muted/10 p-2"
          data-testid="ignore-memory-debug-filter-panel"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Search & filter
            </span>
            <span
              className="font-mono text-[10px] text-muted-foreground"
              data-testid="ignore-memory-debug-result-count"
              aria-live="polite"
            >
              Showing {rows.length} of {allRows.length}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-1 min-w-[240px] items-center gap-1">
              <select
                value={searchField}
                onChange={(e) => setSearchField(e.target.value as SearchField)}
                className="h-8 rounded-md border border-input bg-background px-1.5 text-[11px]"
                aria-label="Search field"
                data-testid="ignore-memory-debug-search-field"
              >
                <option value="any">Any field</option>
                <option value="id">Id</option>
                <option value="justification">Justification</option>
                <option value="scanner">Scanner</option>
                <option value="name">Finding name</option>
              </select>
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={
                    searchField === "any"
                      ? "Search id, name, scanner, justification…"
                      : `Search ${searchField}…`
                  }
                  className="h-8 pl-8 text-xs"
                  aria-label="Search text"
                  data-testid="ignore-memory-debug-search"
                />
              </div>
            </div>
            <div
              className="flex items-center gap-1"
              role="tablist"
              aria-label="Filter by state / skip reason"
            >
              {(["all", "active", "shadowed", "inert"] as const).map((k) => (
                <Button
                  key={k}
                  role="tab"
                  aria-selected={stateFilter === k}
                  variant={stateFilter === k ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setStateFilter(k)}
                  data-testid={`ignore-memory-debug-state-${k}`}
                  title={
                    k === "all" ? "Show entries in every state" : `${k} — ${SKIP_REASON_LABEL[k]}`
                  }
                >
                  {k === "all"
                    ? "all"
                    : `${k} · ${SKIP_REASON_LABEL[k].split(" ")[0].toLowerCase()}`}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-1" role="tablist" aria-label="Filter by severity">
              {(["all", "error", "warn", "info", "none"] as const).map((k) => (
                <Button
                  key={k}
                  role="tab"
                  aria-selected={severityFilter === k}
                  variant={severityFilter === k ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setSeverityFilter(k)}
                  data-testid={`ignore-memory-debug-sev-${k}`}
                >
                  {k}
                </Button>
              ))}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={clearFilters}
              disabled={!filtersActive}
              data-testid="ignore-memory-debug-clear-filters"
              title={filtersActive ? "Reset all search and filter controls" : "No active filters"}
            >
              <X className="mr-1 h-3 w-3" aria-hidden />
              Clear filters
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <div className="ml-auto flex items-center gap-1">
            <label
              className="flex items-center gap-1 rounded-md border border-input bg-background px-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              title="When on, the Rule evaluation trace section starts expanded for skipped (active) entries only. You can still collapse it manually."
            >
              <input
                type="checkbox"
                className="h-3 w-3 accent-primary"
                checked={autoExpandSkipped}
                onChange={toggleAutoExpandSkipped}
                data-testid="ignore-memory-debug-auto-expand-skipped"
                aria-label="Auto-expand trace for skipped entries"
              />
              <span>Auto-expand skipped trace</span>
            </label>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={handleRefresh}
              data-testid="ignore-memory-debug-refresh"
              title="Re-run the pre-skip and post-skip evaluation from the latest localStorage state"
            >
              <RefreshCw className="mr-1 h-3 w-3" aria-hidden />
              Refresh debug view
            </Button>
            {refreshedAt ? (
              <span
                className="font-mono text-[10px] text-muted-foreground"
                data-testid="ignore-memory-debug-refreshed-at"
              >
                {refreshedAt}
              </span>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={handleExport}
              disabled={allRows.length === 0}
              data-testid="ignore-memory-debug-export"
              title={
                allRows.length === 0
                  ? "No ignore entries to export"
                  : "Download the current active/shadowed/inert breakdown as JSON"
              }
            >
              <Download className="mr-1 h-3 w-3" aria-hidden />
              Export debug details
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={handleExportTrace}
              disabled={allRows.length === 0}
              data-testid="ignore-memory-debug-export-trace"
              title={
                allRows.length === 0
                  ? "No ignore entries to export"
                  : "Download the full step-by-step rule evaluation trace (load → scan → compare → skip filter → result) for every entry as JSON"
              }
            >
              <Download className="mr-1 h-3 w-3" aria-hidden />
              Export trace JSON
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={handleCopy}
              disabled={allRows.length === 0}
              data-testid="ignore-memory-debug-copy"
              aria-live="polite"
              title={
                allRows.length === 0
                  ? "No ignore entries to copy"
                  : "Copy the full match-and-skip evaluation for every entry to the clipboard as JSON"
              }
            >
              {copyState === "ok" ? (
                <>
                  <Check className="mr-1 h-3 w-3 text-emerald-400" aria-hidden />
                  Copied
                </>
              ) : copyState === "err" ? (
                <>
                  <Copy className="mr-1 h-3 w-3 text-destructive" aria-hidden />
                  Copy failed
                </>
              ) : (
                <>
                  <Copy className="mr-1 h-3 w-3" aria-hidden />
                  Copy debug JSON
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={handlePruneInert}
              disabled={counts.inert === 0}
              data-testid="ignore-memory-debug-prune-inert"
              title={
                counts.inert === 0
                  ? "No inert entries to prune"
                  : `Delete the ${counts.inert} inert entr${counts.inert === 1 ? "y" : "ies"} from security-memory (active/shadowed rules stay)`
              }
            >
              <Sparkles className="mr-1 h-3 w-3" aria-hidden />
              Prune inert ({counts.inert})
            </Button>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="h-7 rounded-md border border-input bg-background px-1.5 text-[11px]"
              aria-label="Sort by"
              data-testid="ignore-memory-debug-sort-key"
            >
              <option value="id">Sort: id</option>
              <option value="ignoredAt">Sort: ignoredAt</option>
              <option value="state">Sort: state</option>
              <option value="severity">Sort: severity</option>
            </select>
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7 min-h-11 min-w-11"
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              aria-label={`Sort ${sortDir === "asc" ? "descending" : "ascending"}`}
              data-testid="ignore-memory-debug-sort-dir"
              title={sortDir === "asc" ? "Ascending — click to flip" : "Descending — click to flip"}
            >
              <ArrowDownUp className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Top summary widget — totals across the merged/surfaced scan
            plus a per-reason breakdown of every security-memory entry. */}
        <section
          aria-label="Security-memory summary"
          className="mb-3 rounded-md border border-primary/15 bg-muted/10 p-2.5"
          data-testid="ignore-memory-debug-summary"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Summary
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {allRows.length} ignore {allRows.length === 1 ? "rule" : "rules"} ·{" "}
              {mergedFindings.length} merged findings
            </span>
          </div>
          <dl
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
            data-testid="ignore-memory-debug-summary-totals"
          >
            <div
              className="rounded border border-primary/15 bg-background/60 px-2 py-1.5"
              data-testid="ignore-memory-debug-summary-surfaced"
              title="Findings the reviewer currently sees (post-skip)."
            >
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Surfaced
              </dt>
              <dd className="font-mono text-lg leading-tight text-foreground">
                {surfacedFindings.length}
              </dd>
            </div>
            <div
              className="rounded border border-emerald-400/30 bg-emerald-400/[0.06] px-2 py-1.5"
              data-testid="ignore-memory-debug-summary-skipped"
              title="Ignore rules that matched a merged finding and were dropped from the surfaced scan."
            >
              <dt className="text-[10px] uppercase tracking-wide text-emerald-300/80">Skipped</dt>
              <dd className="font-mono text-lg leading-tight text-emerald-100">{counts.active}</dd>
            </div>
            <div
              className="rounded border border-amber-400/30 bg-amber-400/[0.06] px-2 py-1.5"
              data-testid="ignore-memory-debug-summary-shadowed"
              title="Ignore rules whose matching finding is still visible because the skip filter is off."
            >
              <dt className="text-[10px] uppercase tracking-wide text-amber-300/80">Shadowed</dt>
              <dd className="font-mono text-lg leading-tight text-amber-100">{counts.shadowed}</dd>
            </div>
            <div
              className="rounded border border-slate-400/25 bg-slate-500/[0.06] px-2 py-1.5"
              data-testid="ignore-memory-debug-summary-no-match"
              title="Ignore rules with no matching finding in the current scan (stale)."
            >
              <dt className="text-[10px] uppercase tracking-wide text-slate-300/80">No match</dt>
              <dd className="font-mono text-lg leading-tight text-slate-100">{counts.inert}</dd>
            </div>
          </dl>
          <div className="mt-2" data-testid="ignore-memory-debug-summary-breakdown">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Breakdown by reason
            </p>
            {allRows.length === 0 ? (
              <p className="text-[11px] italic text-muted-foreground">
                No ignore rules recorded yet.
              </p>
            ) : (
              <>
                <div
                  className="flex h-2 w-full overflow-hidden rounded bg-muted/40"
                  role="img"
                  aria-label={`Skipped ${counts.active}, shadowed ${counts.shadowed}, no match ${counts.inert}`}
                >
                  {counts.active > 0 && (
                    <div
                      className="h-full bg-emerald-400/70"
                      style={{ width: `${(counts.active / allRows.length) * 100}%` }}
                    />
                  )}
                  {counts.shadowed > 0 && (
                    <div
                      className="h-full bg-amber-400/70"
                      style={{ width: `${(counts.shadowed / allRows.length) * 100}%` }}
                    />
                  )}
                  {counts.inert > 0 && (
                    <div
                      className="h-full bg-slate-400/60"
                      style={{ width: `${(counts.inert / allRows.length) * 100}%` }}
                    />
                  )}
                </div>
                <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                  {(["active", "shadowed", "inert"] as const).map((s) => {
                    const n = counts[s];
                    const pct = allRows.length === 0 ? 0 : Math.round((n / allRows.length) * 100);
                    const swatch =
                      s === "active"
                        ? "bg-emerald-400/70"
                        : s === "shadowed"
                          ? "bg-amber-400/70"
                          : "bg-slate-400/60";
                    return (
                      <li
                        key={s}
                        className="flex items-center gap-1.5"
                        data-testid={`ignore-memory-debug-summary-reason-${s}`}
                      >
                        <span
                          className={cn("inline-block h-2 w-2 rounded-sm", swatch)}
                          aria-hidden
                        />
                        <span className="text-muted-foreground">{SKIP_REASON_LABEL[s]}</span>
                        <span className="font-mono text-foreground">{n}</span>
                        <span className="font-mono text-muted-foreground">({pct}%)</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </section>

        {rows.length === 0 ? (
          <p
            className="rounded-md border border-dashed border-primary/15 bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground"
            data-testid="ignore-memory-debug-empty"
          >
            {allRows.length === 0
              ? "No ignore entries recorded yet. Ignore a finding with a justification and export decisions to seed one."
              : "No entries match the current filters."}
          </p>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {rows.map((r) => {
              const rowAccent =
                r.state === "active"
                  ? "border-l-4 border-l-emerald-400/70 bg-emerald-400/[0.04]"
                  : r.state === "shadowed"
                    ? "border-l-4 border-l-amber-400/70 bg-amber-400/[0.04]"
                    : "border-l-4 border-l-slate-500/50 bg-slate-500/[0.03]";
              const reasonBadge =
                r.state === "active"
                  ? {
                      label: "SKIPPED",
                      cls: "border-emerald-400/50 bg-emerald-400/20 text-emerald-100",
                    }
                  : r.state === "shadowed"
                    ? {
                        label: "SURFACED",
                        cls: "border-amber-400/50 bg-amber-400/15 text-amber-100",
                      }
                    : {
                        label: "NO MATCH",
                        cls: "border-slate-400/40 bg-slate-500/15 text-slate-200",
                      };
              return (
                <li
                  key={r.id}
                  data-testid="ignore-memory-debug-row"
                  data-state={r.state}
                  className={cn("rounded-md border border-primary/10 px-2.5 py-2", rowAccent)}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="truncate font-mono">{r.id}</span>
                    <div className="flex items-center gap-1">
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] uppercase tracking-wide", reasonBadge.cls)}
                        data-testid="ignore-memory-debug-reason-badge"
                        title={STATE_HELP[r.state]}
                      >
                        {reasonBadge.label}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] uppercase tracking-wide", STATE_BADGE[r.state])}
                        title={STATE_HELP[r.state]}
                      >
                        {r.state}
                      </Badge>
                    </div>
                  </div>

                  {/* Inline matched-condition note — the exact equality that fired. */}
                  <div
                    className={cn(
                      "mt-1.5 rounded border px-2 py-1 font-mono text-[10.5px] leading-snug",
                      r.state === "active" &&
                        "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
                      r.state === "shadowed" &&
                        "border-amber-400/30 bg-amber-400/10 text-amber-100",
                      r.state === "inert" && "border-slate-400/25 bg-slate-500/10 text-slate-200",
                    )}
                    data-testid="ignore-memory-debug-condition"
                  >
                    {r.match ? (
                      <>
                        <span className="opacity-70">matched: </span>
                        <code>finding.id</code>
                        <span className="mx-1 opacity-70">(</span>
                        <mark className="rounded bg-emerald-400/25 px-1 text-emerald-50">
                          {r.match.id}
                        </mark>
                        <span className="mx-1 opacity-70">)</span>
                        <span className="mx-1">===</span>
                        <code>security-memory[id]</code>
                        <span className="mx-1 opacity-70">(</span>
                        <mark className="rounded bg-emerald-400/25 px-1 text-emerald-50">
                          {r.id}
                        </mark>
                        <span className="mx-1 opacity-70">)</span>
                        {r.state === "active" ? (
                          <span className="ml-1 opacity-90">
                            → <strong>skipped</strong> by <code>applyIgnoreSkip</code>
                          </span>
                        ) : (
                          <span className="ml-1 opacity-90">
                            → matched, but skip filter is <strong>off</strong>
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="opacity-70">no match: </span>
                        <code>security-memory[id]</code>
                        <span className="mx-1 opacity-70">(</span>
                        <mark className="rounded bg-slate-400/25 px-1 text-slate-50">{r.id}</mark>
                        <span className="mx-1 opacity-70">)</span>
                        <span className="mx-1">∉</span>
                        <code>merged.findings[*].id</code>
                        <span className="ml-1 opacity-90">
                          → rule is <strong>inert</strong>
                        </span>
                      </>
                    )}
                  </div>

                  <p className="mt-1 line-clamp-2 text-muted-foreground">{r.justification}</p>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    ignoredAt: {r.ignoredAt}
                  </p>

                  {/* Match diagnostics — exact fields that hit the skip rule. */}
                  <dl
                    className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 rounded border border-primary/10 bg-muted/20 px-2 py-1.5 font-mono text-[10.5px]"
                    data-testid="ignore-memory-debug-match"
                  >
                    <dt className="text-muted-foreground">rule</dt>
                    <dd>
                      <code>finding.id === security-memory[id]</code>
                    </dd>
                    <dt className="text-muted-foreground">memory.id</dt>
                    <dd className="truncate">{r.id}</dd>
                    {r.match ? (
                      <>
                        <dt className="text-muted-foreground">finding.id</dt>
                        <dd className="truncate">
                          <span className="text-emerald-300">{r.match.id}</span>
                          <span className="ml-1 text-muted-foreground">(match)</span>
                        </dd>
                        <dt className="text-muted-foreground">finding.scanner</dt>
                        <dd className="truncate">{r.match.scanner}</dd>
                        <dt className="text-muted-foreground">finding.name</dt>
                        <dd className="truncate font-sans">{r.match.name}</dd>
                        <dt className="text-muted-foreground">finding.level</dt>
                        <dd>{r.match.level}</dd>
                      </>
                    ) : (
                      <>
                        <dt className="text-muted-foreground">finding.id</dt>
                        <dd className="text-slate-300">— (no matching finding in current scan)</dd>
                      </>
                    )}
                    <dt className="text-muted-foreground">skipped?</dt>
                    <dd>
                      {r.state === "active" ? (
                        <span className="text-emerald-300">
                          yes — <code>applyIgnoreSkip</code> dropped it because{" "}
                          <code>security-memory[{r.id}]</code> is set
                        </span>
                      ) : r.state === "shadowed" ? (
                        <span className="text-amber-300">
                          no — skip filter not applied (turn on <em>Simulate next scan</em>)
                        </span>
                      ) : (
                        <span className="text-slate-300">
                          n/a — rule matches nothing in the current scan
                        </span>
                      )}
                    </dd>
                  </dl>

                  {/* Step-by-step rule evaluation trace for a simulated scan.
                      The `key` includes the auto-expand setting so toggling it
                      remounts the <details>; a ref opens it once so the user
                      can still collapse it manually without React reopening. */}
                  <details
                    key={`trace-${r.id}-${autoExpandSkipped ? "auto" : "manual"}`}
                    ref={(el) => {
                      if (el && autoExpandSkipped && r.state === "active") {
                        el.open = true;
                      }
                    }}
                    className="mt-2 rounded border border-primary/10 bg-muted/10 open:bg-muted/20"
                    data-testid="ignore-memory-debug-trace"
                    data-auto-expanded={
                      autoExpandSkipped && r.state === "active" ? "true" : "false"
                    }
                  >
                    <summary className="cursor-pointer select-none px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                      Rule evaluation trace
                      <span className="ml-1 opacity-70">
                        ·{" "}
                        {r.state === "active"
                          ? "skipped"
                          : r.state === "shadowed"
                            ? "surfaced"
                            : "no-op"}
                      </span>
                    </summary>
                    <ol className="list-decimal space-y-1 px-6 py-2 font-mono text-[10.5px] leading-snug marker:text-muted-foreground">
                      <li>
                        <span className="opacity-70">load: </span>
                        <code>getIgnoredMemory()</code> → <code>security-memory[{r.id}]</code>{" "}
                        <span className="text-emerald-300">✓ present</span>
                      </li>
                      <li>
                        <span className="opacity-70">scan: </span>
                        <code>merged.findings.find(f =&gt; f.id === "{r.id}")</code> →{" "}
                        {r.match ? (
                          <span className="text-emerald-300">
                            ✓ hit ({r.match.scanner}/{r.match.level})
                          </span>
                        ) : (
                          <span className="text-slate-300">✗ no hit</span>
                        )}
                      </li>
                      <li>
                        <span className="opacity-70">compare: </span>
                        <code>finding.id</code>{" "}
                        {r.match ? (
                          <>
                            (
                            <mark className="rounded bg-emerald-400/25 px-1 text-emerald-50">
                              {r.match.id}
                            </mark>
                            )
                          </>
                        ) : (
                          <span className="opacity-70">(—)</span>
                        )}{" "}
                        === <code>security-memory[id]</code> (
                        <mark className="rounded bg-emerald-400/25 px-1 text-emerald-50">
                          {r.id}
                        </mark>
                        ) →{" "}
                        {r.match ? (
                          <span className="text-emerald-300">true</span>
                        ) : (
                          <span className="text-slate-300">n/a</span>
                        )}
                      </li>
                      <li>
                        <span className="opacity-70">skip filter: </span>
                        <code>applyIgnoreSkip(merged)</code> →{" "}
                        {r.state === "active" ? (
                          <span className="text-emerald-300">
                            on · drop finding <code>{r.match?.id}</code>
                          </span>
                        ) : r.state === "shadowed" ? (
                          <span className="text-amber-300">
                            off · keep finding <code>{r.match?.id}</code>
                          </span>
                        ) : (
                          <span className="text-slate-300">n/a · nothing to drop</span>
                        )}
                      </li>
                      <li>
                        <span className="opacity-70">result: </span>
                        {r.state === "active" ? (
                          <span className="text-emerald-200">
                            surfacedFindings excludes <code>{r.match?.id}</code> —{" "}
                            <strong>rule is ACTIVE</strong>
                          </span>
                        ) : r.state === "shadowed" ? (
                          <span className="text-amber-200">
                            surfacedFindings still contains <code>{r.match?.id}</code> —{" "}
                            <strong>rule is SHADOWED</strong>
                          </span>
                        ) : (
                          <span className="text-slate-200">
                            no finding to act on — <strong>rule is INERT</strong>
                          </span>
                        )}
                      </li>
                    </ol>
                  </details>

                  {/* Side-by-side comparison of finding vs security-memory
                      values for the fields that participate in the match. */}
                  <details
                    className="mt-2 rounded border border-primary/10 bg-muted/10 open:bg-muted/20"
                    data-testid="ignore-memory-debug-compare"
                  >
                    <summary className="cursor-pointer select-none px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                      Finding vs security-memory
                      <span className="ml-1 opacity-70">
                        · {r.match ? "1 field compared" : "no finding to compare"}
                      </span>
                    </summary>
                    <div className="px-2 py-2">
                      <div className="grid grid-cols-[max-content_1fr_1fr_max-content] gap-x-2 gap-y-1 text-[10.5px] font-mono">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          field
                        </div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          finding
                        </div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          security-memory
                        </div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground text-right">
                          =
                        </div>
                        {(() => {
                          const rows: Array<{
                            field: string;
                            left: string | null;
                            right: string | null;
                            partOfRule: boolean;
                          }> = [
                            {
                              field: "id",
                              left: r.match?.id ?? null,
                              right: r.id,
                              partOfRule: true,
                            },
                            {
                              field: "scanner",
                              left: r.match?.scanner ?? null,
                              right: null,
                              partOfRule: false,
                            },
                            {
                              field: "name",
                              left: r.match?.name ?? null,
                              right: null,
                              partOfRule: false,
                            },
                            {
                              field: "level",
                              left: r.match?.level ?? null,
                              right: null,
                              partOfRule: false,
                            },
                            {
                              field: "status",
                              left: r.match?.status ?? null,
                              right: "ignored",
                              partOfRule: false,
                            },
                            {
                              field: "justification",
                              left: null,
                              right: r.justification,
                              partOfRule: false,
                            },
                            {
                              field: "ignoredAt",
                              left: null,
                              right: r.ignoredAt,
                              partOfRule: false,
                            },
                          ];
                          return rows.map((row) => {
                            const both = row.left !== null && row.right !== null;
                            const equal = both && row.left === row.right;
                            const marker = !both
                              ? { label: "—", cls: "text-muted-foreground" }
                              : equal
                                ? { label: "✓", cls: "text-emerald-300" }
                                : { label: "✗", cls: "text-amber-300" };
                            return (
                              <FragmentWithKey key={row.field}>
                                <div
                                  key={`${row.field}-f`}
                                  className={cn(
                                    "text-muted-foreground",
                                    row.partOfRule && "font-semibold text-foreground",
                                  )}
                                  data-testid={`ignore-memory-debug-compare-field-${row.field}`}
                                >
                                  {row.field}
                                  {row.partOfRule ? (
                                    <span className="ml-1 rounded bg-primary/20 px-1 text-[9px] uppercase text-primary-foreground/90">
                                      rule
                                    </span>
                                  ) : null}
                                </div>
                                <div
                                  key={`${row.field}-l`}
                                  className={cn(
                                    "truncate rounded px-1",
                                    row.left === null
                                      ? "text-slate-400"
                                      : equal
                                        ? "bg-emerald-400/15 text-emerald-100"
                                        : both
                                          ? "bg-amber-400/10 text-amber-100"
                                          : "text-foreground",
                                  )}
                                  title={row.left ?? "—"}
                                >
                                  {row.left ?? "—"}
                                </div>
                                <div
                                  key={`${row.field}-r`}
                                  className={cn(
                                    "truncate rounded px-1",
                                    row.right === null
                                      ? "text-slate-400"
                                      : equal
                                        ? "bg-emerald-400/15 text-emerald-100"
                                        : both
                                          ? "bg-amber-400/10 text-amber-100"
                                          : "text-foreground",
                                  )}
                                  title={row.right ?? "—"}
                                >
                                  {row.right ?? "—"}
                                </div>
                                <div
                                  key={`${row.field}-m`}
                                  className={cn("text-right font-semibold", marker.cls)}
                                  aria-label={
                                    !both ? "not compared" : equal ? "equal" : "different"
                                  }
                                >
                                  {marker.label}
                                </div>
                              </FragmentWithKey>
                            );
                          });
                        })()}
                      </div>
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Only fields marked{" "}
                        <span className="rounded bg-primary/20 px-1 text-primary-foreground/90">
                          rule
                        </span>{" "}
                        take part in the skip decision (
                        <code className="font-mono">finding.id === security-memory[id]</code>). The
                        rest are shown for context.
                      </p>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
