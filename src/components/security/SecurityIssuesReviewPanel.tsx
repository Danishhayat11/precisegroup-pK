/**
 * SecurityIssuesReviewPanel — presentational review console for security
 * scan findings. Reads the curated snapshot from `src/lib/security/findings`
 * and lets the reviewer toggle each row through Pending → Ignore → Fix as
 * an in-session working copy. Actual scanner state is agent-managed, so
 * changes here don't persist; the panel exposes an "Export decisions"
 * action that copies a JSON diff to the clipboard for the reviewer to
 * hand back to the agent (or paste into a PR description).
 *
 * Emerald Prestige surface: forest ink base, champagne accents, monospace
 * for identifiers so scanner IDs stay readable at small sizes.
 */
import { useMemo, useState, useCallback } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  ExternalLink,
  Clipboard,
  Check,
  Search,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  SECURITY_FINDINGS,
  countByStatus,
  type SecurityFinding,
  type SecurityFindingStatus,
} from "@/lib/security/findings";

type Working = Record<string, SecurityFindingStatus>;
type Justifications = Record<string, string>;

/** Minimum characters required before an ignore justification can be exported. */
const MIN_JUSTIFICATION_LENGTH = 20;

const STATUS_LABEL: Record<SecurityFindingStatus, string> = {
  pending: "Pending",
  ignored: "Ignored",
  fixed: "Fixed",
};

/** Tailwind classes for the status badge in each row. */
const STATUS_BADGE: Record<SecurityFindingStatus, string> = {
  pending: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  ignored: "border-slate-400/40 bg-slate-400/10 text-slate-200",
  fixed: "border-emerald-400/40 bg-emerald-400/15 text-emerald-200",
};

const LEVEL_BADGE: Record<SecurityFinding["level"], string> = {
  info: "border-sky-400/40 bg-sky-400/10 text-sky-200",
  warn: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  error: "border-rose-400/40 bg-rose-400/10 text-rose-200",
};

function StatusIcon({ status }: { status: SecurityFindingStatus }) {
  if (status === "fixed") return <ShieldCheck className="h-3.5 w-3.5" aria-hidden />;
  if (status === "ignored") return <ShieldQuestion className="h-3.5 w-3.5" aria-hidden />;
  return <ShieldAlert className="h-3.5 w-3.5" aria-hidden />;
}

export type ExportedDecision = {
  id: string;
  scanner: SecurityFinding["scanner"];
  name: string;
  previous: SecurityFindingStatus;
  next: SecurityFindingStatus;
  justification: string;
  persistTo: "security-memory" | "mark-as-fixed" | "working-copy-only";
};

export function SecurityIssuesReviewPanel({
  findings = SECURITY_FINDINGS,
  className,
  onDecisionsExported,
}: {
  findings?: readonly SecurityFinding[];
  className?: string;
  /** Called with the exported decisions payload right after the clipboard copy succeeds. */
  onDecisionsExported?: (decisions: ExportedDecision[]) => void;
}) {
  // Working copy of statuses keyed by finding id. Reset when the source
  // snapshot changes (new scan pushed a fresh list).
  const [working, setWorking] = useState<Working>(() =>
    Object.fromEntries(findings.map((f) => [f.id, f.status])),
  );
  // Draft justifications collected when a reviewer moves a finding into
  // `ignored`. On export these become the payload that seeds security-memory
  // so the next scan skips the same rule without re-flagging.
  const [justifications, setJustifications] = useState<Justifications>(() =>
    Object.fromEntries(findings.map((f) => [f.id, f.justification])),
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | SecurityFindingStatus>("all");
  const [copied, setCopied] = useState(false);

  const effective = useMemo(
    () =>
      findings.map((f) => ({
        ...f,
        status: working[f.id] ?? f.status,
        justification: justifications[f.id] ?? f.justification,
      })),
    [findings, working, justifications],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return effective.filter((f) => {
      if (filter !== "all" && f.status !== filter) return false;
      if (!q) return true;
      return (
        f.id.toLowerCase().includes(q) ||
        f.name.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.justification.toLowerCase().includes(q) ||
        f.scanner.toLowerCase().includes(q)
      );
    });
  }, [effective, query, filter]);

  const counts = useMemo(() => countByStatus(effective), [effective]);
  const dirty = useMemo(
    () =>
      findings.some(
        (f) =>
          (working[f.id] ?? f.status) !== f.status ||
          (justifications[f.id] ?? f.justification) !== f.justification,
      ),
    [findings, working, justifications],
  );

  /**
   * Newly-ignored findings must ship with a substantive justification —
   * that text is what future scans persist into security-memory to skip
   * the rule without re-flagging.
   */
  const ignoredMissingJustification = useMemo(
    () =>
      findings.filter((f) => {
        const nextStatus = working[f.id] ?? f.status;
        if (nextStatus !== "ignored") return false;
        const j = (justifications[f.id] ?? f.justification).trim();
        return j.length < MIN_JUSTIFICATION_LENGTH;
      }),
    [findings, working, justifications],
  );
  const canExport = dirty && ignoredMissingJustification.length === 0;

  const setStatus = useCallback((id: string, next: SecurityFindingStatus) => {
    setWorking((prev) => ({ ...prev, [id]: next }));
    setCopied(false);
  }, []);

  const setJustification = useCallback((id: string, next: string) => {
    setJustifications((prev) => ({ ...prev, [id]: next }));
    setCopied(false);
  }, []);

  const resetAll = useCallback(() => {
    setWorking(Object.fromEntries(findings.map((f) => [f.id, f.status])));
    setJustifications(Object.fromEntries(findings.map((f) => [f.id, f.justification])));
    setCopied(false);
  }, [findings]);

  const exportDecisions = useCallback(async () => {
    const diff: ExportedDecision[] = findings
      .filter((f) => {
        const nextStatus = working[f.id] ?? f.status;
        const nextJust = justifications[f.id] ?? f.justification;
        return nextStatus !== f.status || nextJust !== f.justification;
      })
      .map((f) => {
        const nextStatus = working[f.id] ?? f.status;
        const nextJust = (justifications[f.id] ?? f.justification).trim();
        return {
          id: f.id,
          scanner: f.scanner,
          name: f.name,
          previous: f.status,
          next: nextStatus,
          justification: nextJust,
          // Convenience hint for the agent: ignored findings should be
          // persisted via security--manage_security_finding + a
          // security--update_memory call so the next scan skips this rule.
          persistTo:
            nextStatus === "ignored"
              ? "security-memory"
              : nextStatus === "fixed"
                ? "mark-as-fixed"
                : "working-copy-only",
        };
      });
    const payload = JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        instructions:
          "Feed to the Lovable agent. For each `ignored` decision the agent will call security--manage_security_finding (operation: ignore, explanation: justification) and security--update_memory so future scans automatically skip the rule.",
        decisions: diff,
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers without clipboard access — dump to console.

      console.log("[security-review] decisions", payload);
    }
    onDecisionsExported?.(diff);
  }, [findings, working, justifications, onDecisionsExported]);

  return (
    <Card
      className={cn("border-primary/20 bg-card/60 shadow-lg backdrop-blur", className)}
      data-testid="security-issues-review-panel"
    >
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 font-serif text-xl">
              <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
              Security issues review
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Curated snapshot from the latest scanner run. Toggle each finding through{" "}
              <em>Pending</em>, <em>Ignore</em>, or <em>Fix</em>, then export the decisions for the
              agent to persist.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={STATUS_BADGE.pending}
              data-testid="security-count-pending"
            >
              <ShieldAlert className="mr-1 h-3 w-3" aria-hidden />
              {counts.pending} pending
            </Badge>
            <Badge
              variant="outline"
              className={STATUS_BADGE.ignored}
              data-testid="security-count-ignored"
            >
              <ShieldQuestion className="mr-1 h-3 w-3" aria-hidden />
              {counts.ignored} ignored
            </Badge>
            <Badge
              variant="outline"
              className={STATUS_BADGE.fixed}
              data-testid="security-count-fixed"
            >
              <ShieldCheck className="mr-1 h-3 w-3" aria-hidden />
              {counts.fixed} fixed
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by id, name, justification…"
              className="pl-8"
              aria-label="Filter security findings"
              data-testid="security-review-search"
            />
          </div>
          <div className="flex items-center gap-1" role="tablist" aria-label="Filter by status">
            {(["all", "pending", "ignored", "fixed"] as const).map((key) => (
              <Button
                key={key}
                role="tab"
                aria-selected={filter === key}
                variant={filter === key ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(key)}
                data-testid={`security-review-filter-${key}`}
              >
                {key === "all" ? "All" : STATUS_LABEL[key]}
              </Button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={resetAll}
              disabled={!dirty}
              data-testid="security-review-reset"
            >
              Reset
            </Button>
            <Button
              size="sm"
              onClick={exportDecisions}
              disabled={!canExport}
              data-testid="security-review-export"
              title={
                !dirty
                  ? "No changes to export yet"
                  : ignoredMissingJustification.length > 0
                    ? `Add a justification (≥ ${MIN_JUSTIFICATION_LENGTH} characters) for each newly ignored finding first`
                    : "Copy the decisions JSON so the agent can persist them to security-memory"
              }
            >
              {copied ? (
                <>
                  <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Copied
                </>
              ) : (
                <>
                  <Clipboard className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Export decisions
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {ignoredMissingJustification.length > 0 ? (
          <div
            role="alert"
            className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-100"
            data-testid="security-review-justification-warning"
          >
            {ignoredMissingJustification.length} newly ignored finding
            {ignoredMissingJustification.length === 1 ? "" : "s"} still need a justification of at
            least {MIN_JUSTIFICATION_LENGTH} characters. The justification is what gets persisted
            into
            <span className="mx-1 font-mono">security-memory</span>
            so future scans automatically skip the same rule.
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <div
            className="rounded-lg border border-dashed border-primary/20 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground"
            data-testid="security-review-empty"
          >
            No findings match the current filter.
          </div>
        ) : (
          <ul className="space-y-3">
            {filtered.map((finding) => {
              const originalStatus = findings.find((f) => f.id === finding.id)?.status ?? "pending";
              const changed = finding.status !== originalStatus;
              return (
                <li
                  key={finding.id}
                  data-testid="security-review-item"
                  data-finding-id={finding.id}
                  data-status={finding.status}
                  className={cn(
                    "rounded-xl border border-primary/10 bg-background/60 p-4 shadow-sm transition",
                    changed && "ring-1 ring-[hsl(var(--gold))]/40",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground">{finding.name}</h3>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] uppercase tracking-wide",
                            LEVEL_BADGE[finding.level],
                          )}
                        >
                          {finding.level}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={cn("text-[10px]", STATUS_BADGE[finding.status])}
                        >
                          <StatusIcon status={finding.status} />
                          <span className="ml-1">{STATUS_LABEL[finding.status]}</span>
                        </Badge>
                        {changed ? (
                          <Badge
                            variant="outline"
                            className="border-[hsl(var(--gold))]/40 bg-[hsl(var(--gold))]/10 text-[10px] text-[hsl(var(--gold))]"
                          >
                            Unsaved
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{finding.description}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
                        <span>scanner: {finding.scanner}</span>
                        <span aria-hidden>·</span>
                        <span>id: {finding.id}</span>
                        <span aria-hidden>·</span>
                        <span>reviewed: {finding.reviewedAt}</span>
                        {finding.link ? (
                          <a
                            href={finding.link}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                          >
                            Docs <ExternalLink className="h-3 w-3" aria-hidden />
                          </a>
                        ) : null}
                      </div>
                    </div>

                    <div
                      className="flex flex-shrink-0 items-center gap-1"
                      role="group"
                      aria-label={`Set status for ${finding.name}`}
                    >
                      {(["pending", "ignored", "fixed"] as const).map((s) => (
                        <Button
                          key={s}
                          size="sm"
                          variant={finding.status === s ? "default" : "outline"}
                          onClick={() => setStatus(finding.id, s)}
                          data-testid={`security-review-action-${s}`}
                          aria-pressed={finding.status === s}
                        >
                          {s === "pending" ? "Pending" : s === "ignored" ? "Ignore" : "Fix"}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 rounded-lg border border-primary/10 bg-muted/30 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor={`sec-just-${finding.id}`}
                        className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground"
                      >
                        Justification
                        {finding.status === "ignored" ? " — persisted to security-memory" : ""}
                      </label>
                      {finding.status === "ignored" &&
                      finding.justification.trim().length < MIN_JUSTIFICATION_LENGTH ? (
                        <span className="text-[10px] font-medium text-amber-300">
                          Needs ≥ {MIN_JUSTIFICATION_LENGTH} chars
                        </span>
                      ) : null}
                    </div>
                    <Textarea
                      id={`sec-just-${finding.id}`}
                      value={finding.justification}
                      onChange={(e) => setJustification(finding.id, e.target.value)}
                      placeholder="Explain why this finding is not applicable — this text seeds security-memory so future scans skip the rule."
                      rows={3}
                      className="mt-1.5 text-sm leading-relaxed"
                      data-testid="security-review-justification"
                      aria-invalid={
                        finding.status === "ignored" &&
                        finding.justification.trim().length < MIN_JUSTIFICATION_LENGTH
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
