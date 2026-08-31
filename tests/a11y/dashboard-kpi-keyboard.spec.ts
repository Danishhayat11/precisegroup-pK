/**
 * Keyboard-only regression for the 8 KPI drill-down buttons on /dashboard.
 *
 * Three contracts under test:
 *
 *   1. TAB ORDER — pressing Tab from the first KPI card must visit the
 *      remaining seven in the declaration order from Dashboard.tsx
 *      (Sell → Cash → Adj Approved → Adj Realised → Commission →
 *      Received → Pending → Overdue). We focus the first card
 *      programmatically and then walk the tab chain, matching the
 *      `document.activeElement` aria-label against the expected sequence.
 *      This is scoped to the grid rather than the whole page so an extra
 *      focusable in the surrounding chrome doesn't turn this into a
 *      hostile regression test.
 *
 *   2. ENTER ACTIVATION — pressing Enter on a KPI tile opens its
 *      drill-down. The observable side-effect (per Dashboard.tsx) is a
 *      `?kpi=<key>` URL search param and the KPI panel switching to the
 *      active tab. We assert the URL param, since that's the load-bearing
 *      contract that also drives shareable / bookmarkable drill-downs.
 *
 *   3. SPACE ACTIVATION — the same contract must hold for Space. Native
 *      <button> semantics give this for free, but a regression that
 *      swaps <motion.button> for a <div role="button"> would silently
 *      break Space; this test locks it down.
 */
import { test, expect } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "../visual/_authHelpers";

// Order + keys match Dashboard.tsx `kpis` array.
const KPI_SEQUENCE = [
  { key: "sell", label: "Total Sell Value" },
  { key: "cash", label: "Cash Recovered" },
  { key: "adj_approved", label: "Total Adjustment Approved" },
  { key: "adj_realised", label: "Total Adjustment Realised" },
  { key: "commission", label: "Commission Paid" },
  { key: "received", label: "Total Received" },
  { key: "pending", label: "Total Pending Balance" },
  { key: "overdue", label: "Current Overdue Amount" },
] as const;

test.use({
  viewport: { width: 1280, height: 1800 },
  colorScheme: "light",
  reducedMotion: "reduce",
});

test.beforeEach(async ({ context, page }) => {
  test.skip(
    !authAvailable(),
    'Skipped: LOVABLE_BROWSER_AUTH_STATUS is not "injected" — /dashboard would redirect to login.',
  );
  await restoreSupabaseSession(context, page);
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: `Open drill-down for ${KPI_SEQUENCE[0].label}`, exact: true })
    .waitFor({ state: "visible", timeout: 20_000 });
  // Framer entrance tweens on the KPI cards.
  await page.waitForTimeout(1200);
});

test("KPI drill-down buttons are Tab-reachable in declaration order", async ({ page }) => {
  // Focus the first KPI directly — the point of this test is the tab
  // order *within* the KPI grid, not "how many Tabs from the top of the
  // page to reach it" (that depends on unrelated chrome).
  const first = page.getByRole("button", {
    name: `Open drill-down for ${KPI_SEQUENCE[0].label}`,
    exact: true,
  });
  await first.focus();
  await expect(first, "first KPI must accept programmatic focus").toBeFocused();

  for (let i = 1; i < KPI_SEQUENCE.length; i++) {
    await page.keyboard.press("Tab");
    const activeName = await page.evaluate(
      () => document.activeElement?.getAttribute("aria-label") ?? "",
    );
    // Tolerate one intra-card focus stop (e.g. the sr-only formula
    // helper span becoming focusable in the future) by tabbing again
    // if the aria-label doesn't match — but cap the fallback so a
    // broken chain fails loudly instead of looping forever.
    let expectedLabel = `Open drill-down for ${KPI_SEQUENCE[i].label}`;
    if (activeName !== expectedLabel) {
      await page.keyboard.press("Tab");
    }
    const finalName = await page.evaluate(
      () => document.activeElement?.getAttribute("aria-label") ?? "",
    );
    expect(
      finalName,
      `After ${i} Tab press(es), focus should land on KPI #${i + 1}. ` +
        `Expected aria-label "${expectedLabel}", got "${finalName}".`,
    ).toBe(expectedLabel);
  }
});

for (const { key, label } of KPI_SEQUENCE) {
  test(`Enter on "${label}" opens its drill-down (?kpi=${key})`, async ({ page }) => {
    const button = page.getByRole("button", {
      name: `Open drill-down for ${label}`,
      exact: true,
    });
    await button.focus();
    await expect(button).toBeFocused();
    await page.keyboard.press("Enter");
    // The drill-down side-effect the app relies on for shareable state.
    await expect(page, `Enter on KPI "${label}" must set ?kpi=${key} on the URL`).toHaveURL(
      new RegExp(`[?&]kpi=${key}(?:&|$)`),
    );
  });
}

test("Space on a KPI tile also opens its drill-down (native <button> semantics)", async ({
  page,
}) => {
  // Use the last KPI so a regression that only wired Enter (e.g. a
  // custom onKeyDown that forgets Space) still fails here — and pick
  // a different one than the Enter-loop tests so we're not relying on
  // any URL state from a prior test.
  const { key, label } = KPI_SEQUENCE[KPI_SEQUENCE.length - 1];
  const button = page.getByRole("button", {
    name: `Open drill-down for ${label}`,
    exact: true,
  });
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page, `Space on KPI "${label}" must set ?kpi=${key} on the URL`).toHaveURL(
    new RegExp(`[?&]kpi=${key}(?:&|$)`),
  );
});
