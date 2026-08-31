/**
 * /security-review — dedicated route hosting the SecurityIssuesReviewPanel.
 * Sits alongside the existing /security-dashboard so reviewers can focus on
 * scanner findings and their justifications without the wider CVE-style
 * dashboard chrome.
 *
 * Also mounts the local test harness (TestFindingSeeder) so reviewers can
 * seed a synthetic finding, ignore it with a justification, refresh, and
 * confirm the ignore persists — and drops out of a simulated next scan.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SecurityIssuesReviewPanel,
  type ExportedDecision,
} from "@/components/security/SecurityIssuesReviewPanel";
import { TestFindingSeeder } from "@/components/security/TestFindingSeeder";
import { IgnoreMemoryDebugPanel } from "@/components/security/IgnoreMemoryDebugPanel";
import { SECURITY_FINDINGS } from "@/lib/security/findings";
import {
  applyIgnoreSkip,
  mergeWithSeededFindings,
  recordIgnored,
} from "@/lib/security/testFindings";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { AdminRequiredMessage } from "@/lib/adminGate";
import { logSecurityReviewAccess } from "@/lib/security/accessAudit";

export const Route = createFileRoute("/_authenticated/security-review")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Security Issues Review — Precise ERP" },
      {
        name: "description",
        content:
          "Review each security scan finding, mark it Pending, Ignore, or Fix, and see the recorded justification behind every decision.",
      },
      { property: "og:title", content: "Security Issues Review" },
      {
        property: "og:description",
        content:
          "Actionable review console for scanner findings, with per-issue status and justification.",
      },
    ],
  }),
  component: SecurityReviewRoute,
});

function SecurityReviewRoute() {
  const { isAdmin, loading, user } = useAuth();

  // Structured audit hook: once the session has hydrated, record whether
  // this access attempt was granted (admin) or denied (authenticated
  // non-admin). Unauthenticated attempts are logged from the parent
  // `_authenticated` beforeLoad — the redirect fires before this
  // component ever mounts. Coalesced client-side inside the helper.
  useEffect(() => {
    if (loading || !user) return;
    void logSecurityReviewAccess(
      isAdmin ? "granted_admin" : "denied_non_admin",
      "/security-review",
    );
  }, [loading, isAdmin, user]);

  if (loading) return null;
  if (!isAdmin) {
    return (
      <main className="min-h-dvh bg-background px-4 py-8 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-5xl">
          <PageHeader title="Security Issues Review" description="Restricted area" />
          <AdminRequiredMessage action="Viewing the Security Issues Review panel" />
        </div>
      </main>
    );
  }
  return <SecurityReviewInner />;
}

function SecurityReviewInner() {
  // Tick bumps on every seeder mutation so the merged findings recompute.
  const [tick, setTick] = useState(0);
  const [simulating, setSimulating] = useState(false);

  const merged = useMemo(() => {
    void tick;
    return mergeWithSeededFindings(SECURITY_FINDINGS);
  }, [tick]);

  const findings = useMemo(
    () => (simulating ? applyIgnoreSkip(merged) : merged),
    [merged, simulating],
  );

  const handleSeederChange = useCallback(() => setTick((n) => n + 1), []);

  const handleDecisionsExported = useCallback((decisions: ExportedDecision[]) => {
    // Mirror the agent-side security-memory persistence locally so a
    // page refresh reproduces the exact "already ignored" state.
    let touched = false;
    for (const d of decisions) {
      if (d.next === "ignored" && d.justification.length >= 20) {
        recordIgnored(d.id, d.justification);
        touched = true;
      }
    }
    if (touched) setTick((n) => n + 1);
  }, []);

  return (
    <main className="min-h-dvh bg-background px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <header className="flex flex-col gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--gold))]">
            Security
          </p>
          <h1 className="font-serif text-foreground">Issues review</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Every finding surfaced by the security scanners, with the current review outcome and the
            justification the team recorded. Local edits are session-only — use{" "}
            <em>Export decisions</em> to hand the diff back to the agent for persistence.
          </p>
        </header>
        <TestFindingSeeder
          onChange={handleSeederChange}
          onSimulateNextScan={setSimulating}
          simulating={simulating}
        />
        <IgnoreMemoryDebugPanel
          mergedFindings={merged}
          surfacedFindings={findings}
          refreshKey={tick}
          onRefresh={handleSeederChange}
        />
        <SecurityIssuesReviewPanel
          findings={findings}
          onDecisionsExported={handleDecisionsExported}
        />
      </div>
    </main>
  );
}
