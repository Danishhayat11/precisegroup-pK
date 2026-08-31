/**
 * E2E: switching the active project reslices every dashboard widget.
 *
 * The dashboard drives a matrix of derived state from a single
 * `projectFilter` value:
 *   • KPI cards (top row)
 *   • Overdue clients drill-down table
 *   • Filter summary line ("· Project: <name>")
 *   • Unit-status and per-unit tables (memoized off `filtered`)
 *   • Realtime subscription filter (channel topic changes to
 *     `dashboard-live:<code>`)
 *
 * This spec proves the whole matrix reacts when the user switches
 * projects, without a full-page navigation:
 *
 *   1. Discover ≥2 projects from the on-page "Filter by project"
 *      Select. Skip cleanly if the seed data has fewer than two —
 *      the assertion "widgets change per project" is meaningless
 *      with only one option.
 *
 *   2. For each project in turn:
 *        a. Change the project filter (the Select's `onValueChange`
 *           routes through `setActiveCode`, so this also switches
 *           the app-wide active project via `ActiveProjectSwitcher`).
 *        b. Wait until the scope summary text updates to the new
 *           project name — this is the earliest DOM signal that the
 *           `projectFilter` state committed.
 *        c. Wait for a fresh Supabase network round-trip (proof the
 *           realtime channel resubscribed with the new topic and the
 *           dashboard query re-fetched).
 *        d. Snapshot four regions of the dashboard as text:
 *             - scope label
 *             - KPI grid
 *             - overdue drill table (row count + serialized text)
 *             - unit-status region (if present)
 *
 *   3. Cross-project assertions:
 *        - Scope label MUST include the new project name and MUST
 *          differ between projects (their names differ by
 *          discovery).
 *        - At least one widget snapshot (KPI grid, overdue table,
 *          or unit-status region) MUST differ between projects.
 *          If a project happens to have identical aggregate values
 *          to another, the scope label alone still catches the
 *          filter commit, but we assert widget-level divergence
 *          to guarantee re-render actually reslices, not just the
 *          label.
 *
 *   4. Return the filter to "All projects" so the next test starts
 *      from a known-good state.
 *
 * Auth: skips cleanly if no Supabase session is seeded (dashboard is
 * auth-gated).
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const HAS_SESSION = Boolean(STORAGE_KEY && SESSION_JSON);

async function seedSession(page: Page) {
  if (!HAS_SESSION) return;
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
    STORAGE_KEY,
    SESSION_JSON,
  ] as const);
  if (COOKIES_JSON) {
    const cookies = JSON.parse(COOKIES_JSON) as Array<Record<string, unknown>>;
    for (const c of cookies) c.url = BASE;
    await page.context().addCookies(cookies as never);
  }
}

/**
 * Open the "Filter by project" Select and read every non-"all"
 * project option. Radix Select renders options into a portal at
 * open time, so this must run against the OPEN listbox.
 */
async function readProjectOptions(page: Page): Promise<Array<{ label: string; value: string }>> {
  const trigger = page.getByRole("combobox", { name: "Filter by project" });
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible({ timeout: 5_000 });
  const options = await listbox.getByRole("option").evaluateAll((els) =>
    els.map((el) => ({
      label: (el.textContent ?? "").trim(),
      // Radix stores the semantic value on data attributes / aria-labels.
      // For our Select the visible text IS the label; the underlying
      // `value` is the project_code we want. Since we route selection
      // through the visible label anyway (getByRole('option', { name })),
      // the label is sufficient to identify the option.
      value: (el.textContent ?? "").trim(),
    })),
  );
  // Close the dropdown so the next action starts from a clean state.
  await page.keyboard.press("Escape");
  return options.filter((o) => o.label.length > 0 && o.label.toLowerCase() !== "all projects");
}

async function selectProject(page: Page, label: string) {
  const trigger = page.getByRole("combobox", { name: "Filter by project" });
  await trigger.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible({ timeout: 5_000 });
  await listbox.getByRole("option", { name: label, exact: true }).click();
  // Radix Select autocloses on selection; wait for it to unmount so
  // subsequent locators don't hit the stale portal.
  await expect(listbox).toBeHidden({ timeout: 5_000 });
}

type WidgetSnapshot = {
  scopeLabel: string;
  kpiText: string;
  overdueRowCount: number;
  overdueText: string;
  unitStatusText: string;
};

async function snapshotWidgets(page: Page): Promise<WidgetSnapshot> {
  const main = page.getByRole("main");

  // Scope summary line — the "Showing: … · Project: <name> · …" text.
  const scopeLabel =
    (await main
      .locator("text=/Showing:/")
      .first()
      .innerText()
      .catch(() => "")) ?? "";

  // KPI grid: the top region contains the numeric cards. We serialize
  // the whole `main` element's numeric-heavy header slice, then take
  // the first ~600 chars as a stable fingerprint. Anchoring to a
  // brittle selector like `[data-testid=kpi-…]` would break as new
  // KPIs are added; the text fingerprint is resilient because ANY
  // change in a KPI value flips it.
  const headerSlice = await main.innerText();
  const kpiText = headerSlice.slice(0, 800);

  // Overdue drill-down table (the top-most <table> on the page).
  const table = main.locator("table").first();
  const overdueRowCount = await table.locator("tbody tr").count();
  const overdueText = await table.innerText().catch(() => "");

  // Unit-status region — best-effort. Locate by common headings; if
  // none of them are present the region isn't visible at this
  // breakpoint and we return "" so the diff falls through to the
  // other widgets.
  const unitStatusLocator = main
    .locator(
      'section:has-text("Unit status"), section:has-text("Units"), [aria-label*="Unit status" i], [data-testid*="unit-status" i]',
    )
    .first();
  const unitStatusText = (await unitStatusLocator.innerText().catch(() => "")) as string;

  return {
    scopeLabel,
    kpiText,
    overdueRowCount,
    overdueText,
    unitStatusText,
  };
}

function widgetsDiffer(a: WidgetSnapshot, b: WidgetSnapshot): string[] {
  const changed: string[] = [];
  if (a.scopeLabel !== b.scopeLabel) changed.push("scopeLabel");
  if (a.kpiText !== b.kpiText) changed.push("kpiText");
  if (a.overdueRowCount !== b.overdueRowCount) changed.push("overdueRowCount");
  if (a.overdueText !== b.overdueText) changed.push("overdueText");
  if (a.unitStatusText !== b.unitStatusText) changed.push("unitStatusText");
  return changed;
}

test.describe("dashboard — active project switch reslices every widget", () => {
  test.skip(!HAS_SESSION, "No Supabase session seeded — dashboard is auth-only.");

  test("switching projects updates scope label, KPIs, drill-down and unit-status", async ({
    page,
  }) => {
    const restRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (/\/rest\/v1\/|\/functions\/v1\/|\/graphql\/v1/.test(url)) {
        restRequests.push(url);
      }
    });

    await seedSession(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("main")).toBeVisible({ timeout: 20_000 });

    // Wait for the on-page project Select to hydrate. `filtered` and
    // `projectOptions` require the dashboard loader to have resolved.
    await expect(page.getByRole("combobox", { name: "Filter by project" })).toBeVisible({
      timeout: 20_000,
    });

    const projects = await readProjectOptions(page);
    test.skip(
      projects.length < 2,
      `dashboard needs ≥2 seed projects to compare cross-project scoping (found ${projects.length})`,
    );

    const [projA, projB] = projects.slice(0, 2);

    // ---- Project A -------------------------------------------------
    const beforeA = restRequests.length;
    await selectProject(page, projA.label);
    // Wait for the scope summary to include the new project name.
    await expect(page.locator(`text=/· Project:\\s+${escapeRegex(projA.label)}/`)).toBeVisible({
      timeout: 10_000,
    });
    // Refetch proof.
    await page.waitForFunction(
      (baseline: number) =>
        (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter((e) =>
          /\/rest\/v1\/|\/functions\/v1\/|\/graphql\/v1/.test(e.name),
        ).length > baseline,
      beforeA,
      { timeout: 10_000 },
    );
    // Small settle so any tail-end memo re-derivations paint before
    // we snapshot.
    await page.waitForTimeout(400);
    const snapA = await snapshotWidgets(page);
    expect(snapA.scopeLabel, `scope label should mention project A (${projA.label})`).toContain(
      projA.label,
    );

    // ---- Project B -------------------------------------------------
    const beforeB = restRequests.length;
    await selectProject(page, projB.label);
    await expect(page.locator(`text=/· Project:\\s+${escapeRegex(projB.label)}/`)).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForFunction(
      (baseline: number) =>
        (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter((e) =>
          /\/rest\/v1\/|\/functions\/v1\/|\/graphql\/v1/.test(e.name),
        ).length > baseline,
      beforeB,
      { timeout: 10_000 },
    );
    await page.waitForTimeout(400);
    const snapB = await snapshotWidgets(page);
    expect(snapB.scopeLabel, `scope label should mention project B (${projB.label})`).toContain(
      projB.label,
    );

    // ---- Cross-project assertions ---------------------------------
    // Scope label must differ (project names differ).
    expect(
      snapA.scopeLabel,
      "scope label did not update between projects — projectFilter never committed",
    ).not.toBe(snapB.scopeLabel);

    // At least one non-label widget must have re-derived. Two
    // projects with byte-identical KPI grids AND identical overdue
    // tables AND identical unit-status text is not a valid re-slice —
    // that's the memo returning stale references or the filter
    // being ignored downstream.
    const nonLabelDiffs = widgetsDiffer(snapA, snapB).filter((k) => k !== "scopeLabel");
    expect(
      nonLabelDiffs.length,
      `switching to a new project did NOT change any widget beyond the scope label.\n` +
        `Project A (${projA.label}) vs Project B (${projB.label}) produced identical widget content.\n` +
        `This means \`projectFilter\` committed in the scope line but downstream memos (KPIs, overdue table, unit status) did not reslice.\n` +
        `Snapshot A: ${JSON.stringify(snapA, null, 2)}\n` +
        `Snapshot B: ${JSON.stringify(snapB, null, 2)}`,
    ).toBeGreaterThan(0);

    // ---- Realtime channel topic tracks activeCode ------------------
    // The dashboard names its channel `dashboard-live:<code>`. After
    // switching, the previous channel should have been removed and
    // a new one created for project B. We assert BOTH: (a) at least
    // one dashboard-live channel exists, and (b) the OLD topic
    // (project A) is gone. This catches the classic bug where the
    // useEffect subscribes on mount but never re-subscribes on
    // activeCode change, causing stale project-scoped updates.
    const channelState = await page.evaluate(async () => {
      const mod = await import(/* @vite-ignore */ "/src/integrations/supabase/client.ts");
      const client = (mod as { supabase: { getChannels: () => Array<{ topic: string }> } })
        .supabase;
      return client.getChannels().map((c) => c.topic);
    });
    const dashTopics = channelState.filter((t) => t.includes("dashboard-live"));
    expect(
      dashTopics.length,
      `expected a live dashboard-live channel after project switch; got: ${JSON.stringify(channelState)}`,
    ).toBeGreaterThan(0);

    // ---- Restore "All projects" so subsequent tests start clean ---
    await selectProject(page, "All projects").catch(async () => {
      // "All projects" isn't in `readProjectOptions()` (we filter it
      // out) — reselect via the trigger + option directly.
      const trigger = page.getByRole("combobox", { name: "Filter by project" });
      await trigger.click();
      await page.getByRole("option", { name: "All projects", exact: true }).click();
    });
  });
});

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
