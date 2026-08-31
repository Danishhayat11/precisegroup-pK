/**
 * E2E — invalid KPI params on dashboard load produce a sonner toast whose
 * text exactly matches the canonical sanitizer wording.
 *
 * Canonical title:
 *   "Some dashboard params were invalid"
 *
 * Body lines (order-independent, but text must match verbatim):
 *   Invalid (removed): <key>="<orig>"
 *   Adjusted: <key>: "<orig>" -> "<new>"
 *   Resolved: KPI “<label>” at row #<N> (kpi + kexp were both stale)
 *   Landing on: KPI tab → <label>
 *
 * Run:  bunx playwright test tests/a11y/url-sanitizer-toast-exact.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";

test.use({ viewport: { width: 1280, height: 1800 }, reducedMotion: "reduce" });

async function seedSession(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  if (STORAGE_KEY && SESSION_JSON) {
    await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
      STORAGE_KEY,
      SESSION_JSON,
    ] as const);
  }
}

// Sonner renders toasts in an aria-live region with role=status; scope all
// assertions to that container so unrelated page text can't satisfy them.
const TOAST = "[data-sonner-toaster] li[data-sonner-toast]";

test.describe("Dashboard URL sanitizer — toast exact wording", () => {
  test("kpi+kexp both stale → toast shows removed, adjusted, resolved, landing", async ({
    page,
  }) => {
    await seedSession(page);
    await page.goto(`${BASE}/?risk=BANANA&age=999&tab=kpi&kpi=ghost&kexp=-1`, {
      waitUntil: "domcontentloaded",
    });

    const toast = page.locator(TOAST).first();
    await expect(toast).toBeVisible({ timeout: 10_000 });

    // Title — verbatim.
    await expect(toast).toContainText("Some dashboard params were invalid");

    // Removed entries (risk + age aren't KPI params → removed, not adjusted).
    await expect(toast).toContainText('Invalid (removed): risk="BANANA"');
    await expect(toast).toContainText('Invalid (removed): age="999"');

    // Adjusted entries — kpi resolves to overdue, kexp clamps to 1.
    await expect(toast).toContainText('Adjusted: kpi: "ghost" -> "overdue"');
    await expect(toast).toContainText('Adjusted: kexp: "-1" -> "1"');

    // Combined resolved sentence (curly quotes from source).
    await expect(toast).toContainText(
      "Resolved: KPI “Current Overdue Amount” at row #1 (kpi + kexp were both stale)",
    );

    // Combined branch suppresses the plain landing form.
    await expect(toast).not.toContainText(/Landing on: KPI tab →/);
  });

  test("only kpi stale → toast shows adjusted + plain landing line", async ({ page }) => {
    await seedSession(page);
    await page.goto(`${BASE}/?tab=kpi&kpi=ghost`, { waitUntil: "domcontentloaded" });

    const toast = page.locator(TOAST).first();
    await expect(toast).toBeVisible({ timeout: 10_000 });

    await expect(toast).toContainText("Some dashboard params were invalid");
    await expect(toast).toContainText('Adjusted: kpi: "ghost" -> "overdue"');
    await expect(toast).toContainText("Landing on: KPI tab → Current Overdue Amount");
    // Not the combined branch.
    await expect(toast).not.toContainText(/kpi \+ kexp were both stale/);
  });

  test("only kexp stale (above max) → toast clamps to row #100001", async ({ page }) => {
    await seedSession(page);
    await page.goto(`${BASE}/?tab=kpi&kpi=overdue&kexp=99999999`, {
      waitUntil: "domcontentloaded",
    });

    const toast = page.locator(TOAST).first();
    await expect(toast).toBeVisible({ timeout: 10_000 });

    await expect(toast).toContainText('Adjusted: kexp: "99999999" -> "100001"');
    // kpi was valid, so the combined sentence must NOT appear.
    await expect(toast).not.toContainText(/kpi \+ kexp were both stale/);
  });

  test("clean URL → no sanitizer toast", async ({ page }) => {
    await seedSession(page);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    await expect(
      page.locator(TOAST, { hasText: "Some dashboard params were invalid" }),
    ).toHaveCount(0);
  });
});
