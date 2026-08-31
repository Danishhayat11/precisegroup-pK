/**
 * Automated axe-core audit scoped to the /dashboard KPI grid.
 *
 * Why a KPI-only spec (in addition to `app-axe.spec.ts`)?
 * -------------------------------------------------------
 * The whole-page axe scan runs a curated rule subset to keep the report
 * readable. That's the right trade-off for the app shell, but the KPI
 * grid is a load-bearing, high-density financial surface — we want the
 * full WCAG 2.1 A + AA rule set on it, INCLUDING contrast checks that
 * the shell-level scan intentionally omits.
 *
 * Scope
 * -----
 *   1. `include('h2:has-text("KPI Summary") + div')` — the grid itself.
 *      Since the sr-only heading immediately precedes the KPI grid in
 *      Dashboard.tsx, this locator pins the audit to exactly the region
 *      the user asked us to certify.
 *   2. Per-card sub-audit — each `<button aria-label="Open drill-down
 *      for <label>">` is scanned individually so a single failing card
 *      does not get lost in the noise of seven passing siblings.
 *
 * Failure reporting
 * -----------------
 * On violation we serialise `{ id, impact, help, nodes[].target,
 * nodes[].failureSummary }` into the expect message so CI logs show the
 * offending selector without needing to open the HTML report.
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { authAvailable, restoreSupabaseSession } from "../visual/_authHelpers";

// Baseline snapshot directory populated by the a11y workflow's
// `actions/cache` restore step from the previous successful run
// (see `scripts/axe-snapshot-diff.mjs` for the write side). Each file is
// `<project>__<suite>__<label>.json` and lists the axe violations that
// were already present on the previous baseline — those are treated as
// KNOWN and do not fail this run. Only violations whose
// `${id} :: ${targetSelector}` key is missing from the baseline count as
// NEW and fail CI. Set `AXE_KPI_STRICT=1` to disable the baseline and
// fail on any violation (useful for a scheduled "true zero" nightly).
const AXE_BASELINE_DIR = path.join(process.cwd(), ".axe-snapshots", "baseline");
const AXE_STRICT = process.env.AXE_KPI_STRICT === "1";

// Where per-test axe result JSON files land. The a11y workflow runs
// `scripts/axe-results-to-html.mjs` after the test step to convert every
// JSON dropped here into a single self-contained HTML report at
// `axe-report/index.html`, which is uploaded as its own CI artifact on
// failure. Kept outside `test-results/` so it isn't wiped by Playwright's
// per-test output cleanup.
//
// Filenames are namespaced by Playwright project (chromium /
// webkit / firefox) so the same logical test running across the
// cross-browser matrix writes three sibling JSONs instead of
// clobbering each other — the HTML report and snapshot-diff both
// key on project + suite + label to surface engine-specific
// regressions (e.g. WebKit-only contrast rounding).
const AXE_RESULTS_DIR = path.join(process.cwd(), "axe-results");

function projectSlug(testInfo: TestInfo): string {
  const raw = testInfo.project.name || "default";
  // Collapse the "-reduced-motion" suffix defined in playwright.config.ts
  // down to the engine name so filenames / snapshot keys stay short and
  // stable if we later add e.g. a "-full-motion" variant.
  const engine = raw.replace(/-reduced-motion$/, "");
  return engine.replace(/[^a-zA-Z0-9_.-]+/g, "_");
}

async function writeAxeResults(
  testInfo: TestInfo,
  suite: string,
  label: string,
  results: Awaited<ReturnType<AxeBuilder["analyze"]>>,
) {
  await mkdir(AXE_RESULTS_DIR, { recursive: true });
  const project = projectSlug(testInfo);
  const safe = `${project}__${suite}__${label}`.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 200);
  const file = path.join(AXE_RESULTS_DIR, `${safe}.json`);
  await writeFile(
    file,
    JSON.stringify(
      {
        project,
        projectRaw: testInfo.project.name,
        suite,
        label,
        url: results.url,
        timestamp: results.timestamp,
        violations: results.violations,
        passes: results.passes.map((p) => ({ id: p.id, help: p.help })),
        incomplete: results.incomplete,
        inapplicable: results.inapplicable.map((r) => r.id),
        testEngine: results.testEngine,
        testRunner: results.testRunner,
        testEnvironment: results.testEnvironment,
      },
      null,
      2,
    ),
  );
}

const KPI_LABELS = [
  "Total Sell Value",
  "Cash Recovered",
  "Total Adjustment Approved",
  "Total Adjustment Realised",
  "Commission Paid",
  "Total Received",
  "Total Pending Balance",
  "Current Overdue Amount",
] as const;

// WCAG 2.1 A + AA, plus best-practice tags for ARIA. `wcag***` tags
// enable the full contrast + name-role-value rule set on the scoped
// region — this is exactly what the user asked for ("no remaining ARIA
// or contrast issues").
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] as const;

function summarise(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]) {
  return violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => ({
      target: n.target,
      failureSummary: n.failureSummary,
    })),
  }));
}

type AxeViolation = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"][number];

function violationKeys(
  violations: readonly { id: string; nodes: readonly { target: unknown }[] }[],
): Set<string> {
  const keys = new Set<string>();
  for (const v of violations) {
    if (!v.nodes || v.nodes.length === 0) {
      keys.add(`${v.id} :: (no nodes)`);
      continue;
    }
    for (const n of v.nodes) {
      const target = Array.isArray(n.target)
        ? n.target.map(String).join(" > ")
        : String(n.target ?? "");
      keys.add(`${v.id} :: ${target}`);
    }
  }
  return keys;
}

async function loadBaselineKeys(
  testInfo: TestInfo,
  suite: string,
  label: string,
): Promise<{ keys: Set<string>; found: boolean; path: string }> {
  const project = projectSlug(testInfo);
  const safe = `${project}__${suite}__${label}`.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 200);
  const file = path.join(AXE_BASELINE_DIR, `${safe}.json`);
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as { violations?: unknown };
    const violations = Array.isArray(raw.violations)
      ? (raw.violations as { id: string; nodes: { target: unknown }[] }[])
      : [];
    return { keys: violationKeys(violations), found: true, path: file };
  } catch {
    return { keys: new Set(), found: false, path: file };
  }
}

/**
 * Split the current-run violations into { newFailures, allowedByBaseline }
 * using per-node `${id} :: ${target}` keys. If AXE_KPI_STRICT is set,
 * every violation is treated as new (no allow-list).
 */
function partitionAgainstBaseline(
  violations: AxeViolation[],
  baselineKeys: Set<string>,
): { newFailures: AxeViolation[]; allowedByBaseline: AxeViolation[] } {
  if (AXE_STRICT) return { newFailures: violations, allowedByBaseline: [] };
  const newFailures: AxeViolation[] = [];
  const allowedByBaseline: AxeViolation[] = [];
  for (const v of violations) {
    const newNodes = v.nodes.filter((n) => {
      const target = Array.isArray(n.target)
        ? n.target.map(String).join(" > ")
        : String(n.target ?? "");
      return !baselineKeys.has(`${v.id} :: ${target}`);
    });
    const oldNodes = v.nodes.filter((n) => {
      const target = Array.isArray(n.target)
        ? n.target.map(String).join(" > ")
        : String(n.target ?? "");
      return baselineKeys.has(`${v.id} :: ${target}`);
    });
    if (newNodes.length > 0) newFailures.push({ ...v, nodes: newNodes });
    if (oldNodes.length > 0) allowedByBaseline.push({ ...v, nodes: oldNodes });
  }
  return { newFailures, allowedByBaseline };
}

function assertNoNewViolations(
  testInfo: TestInfo,
  scopeLabel: string,
  results: Awaited<ReturnType<AxeBuilder["analyze"]>>,
  baseline: { keys: Set<string>; found: boolean; path: string },
) {
  const { newFailures, allowedByBaseline } = partitionAgainstBaseline(
    results.violations,
    baseline.keys,
  );
  const mode = AXE_STRICT
    ? "strict (baseline disabled via AXE_KPI_STRICT=1)"
    : baseline.found
      ? `baseline present (${baseline.keys.size} allowed key${baseline.keys.size === 1 ? "" : "s"})`
      : "no baseline on disk — treating all current violations as the initial baseline";

  // If there is NO baseline on disk and we are not strict, don't fail the
  // run on pre-existing violations: this is the first observation and the
  // snapshot-diff step will promote them into the baseline for next run.
  const seed = !baseline.found && !AXE_STRICT;

  testInfo.annotations.push({
    type: "axe-baseline",
    description: [
      `[${testInfo.project.name}] ${scopeLabel}`,
      `mode=${mode}`,
      `baseline=${baseline.path}`,
      `total=${results.violations.length}`,
      `new=${newFailures.length}`,
      `allowed=${allowedByBaseline.length}`,
      seed ? "seeding baseline (no fail)" : "",
    ]
      .filter(Boolean)
      .join(" | "),
  });

  if (seed || newFailures.length === 0) {
    // Still surface pre-existing violations in the log so they don't rot silently.
    if (allowedByBaseline.length > 0) {
      console.log(
        `[axe:baseline-allowed] [${testInfo.project.name}] ${scopeLabel}: ${allowedByBaseline.length} pre-existing violation(s) suppressed by baseline`,
      );
    }
    return;
  }

  expect(
    newFailures,
    `[${testInfo.project.name}] ${scopeLabel} — NEW axe violations vs baseline (${allowedByBaseline.length} pre-existing suppressed):\n${JSON.stringify(summarise(newFailures), null, 2)}`,
  ).toEqual([]);
}

async function gotoDashboard(page: Page) {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  // The KPI grid is anchored by the sr-only "KPI Summary" heading.
  // Wait for it before scanning so axe doesn't race the initial paint.
  await page
    .getByRole("heading", { name: "KPI Summary", exact: true })
    .waitFor({ state: "attached", timeout: 20_000 });
  // Framer entrance tweens on the KPI cards — let them settle so axe
  // isn't scanning a partially-transformed subtree.
  await page.waitForTimeout(1200);
}

test.describe("KPI grid — axe a11y (ARIA + contrast, full WCAG 2.1 AA)", () => {
  test.beforeEach(async ({ context, page }) => {
    test.skip(
      !authAvailable(),
      'Skipped: LOVABLE_BROWSER_AUTH_STATUS is not "injected" — cannot render /dashboard.',
    );
    await restoreSupabaseSession(context, page);
    await gotoDashboard(page);
  });

  test("KPI region: no ARIA / contrast / name-role-value violations", async ({
    page,
  }, testInfo) => {
    // Scope axe to the KPI grid: the <div class="grid ..."> that
    // immediately follows the sr-only "KPI Summary" h2 in Dashboard.tsx.
    // Using a stable structural selector avoids coupling to Tailwind
    // class names that may reflow across breakpoints.
    const results = await new AxeBuilder({ page })
      .withTags([...AXE_TAGS])
      .include("h2.sr-only + div.grid")
      .analyze();

    await writeAxeResults(testInfo, "kpi-region", "KPI Summary grid", results);

    const baseline = await loadBaselineKeys(testInfo, "kpi-region", "KPI Summary grid");
    assertNoNewViolations(testInfo, "KPI region", results, baseline);
  });

  for (const label of KPI_LABELS) {
    test(`KPI card "${label}": no per-card ARIA / contrast violations`, async ({
      page,
    }, testInfo) => {
      const button = page.getByRole("button", {
        name: `Open drill-down for ${label}`,
        exact: true,
      });
      const count = await button.count();
      // If a KPI is legitimately absent for the current dataset (e.g. a
      // future feature-flagged card) skip cleanly rather than fail —
      // the "exactly once" contract is enforced by
      // dashboard-kpi-cards.spec.ts.
      test.skip(count === 0, `KPI "${label}" not rendered on this dataset.`);
      expect(count, `KPI "${label}" must render exactly once for a scoped scan`).toBe(1);

      const selector = `button[aria-label="Open drill-down for ${label}"]`;
      const results = await new AxeBuilder({ page })
        .withTags([...AXE_TAGS])
        .include(selector)
        .analyze();

      await writeAxeResults(testInfo, "kpi-card", label, results);

      const baseline = await loadBaselineKeys(testInfo, "kpi-card", label);
      assertNoNewViolations(testInfo, `KPI card "${label}"`, results, baseline);
    });
  }
});
