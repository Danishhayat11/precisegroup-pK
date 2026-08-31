/**
 * A11y E2E — verifies the resolved-KPI + clamped-row announcement is
 * delivered to screen readers via both live regions, for the two stale
 * scenarios the sanitizer handles differently:
 *
 *   A) kpi-only stale       → "Landing on: KPI tab → “<label>”"
 *      (no row in the sentence because kexp was never set)
 *
 *   B) kpi + kexp both stale → combined sentence:
 *      "Resolved: KPI “<label>” at row #<N> (kpi + kexp were both stale)"
 *
 * Both live regions must carry the message:
 *   - role="alert"  aria-live="assertive" (sr-only)
 *   - role="status" aria-live="polite"    (data-testid="url-sanitizer-status")
 *
 * Run:  bunx playwright test tests/a11y/url-sanitizer-resolved-announce.spec.ts
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

// Locators shared across cases.
const statusRegion = (p: Page) => p.getByTestId("url-sanitizer-status");
const alertRegion = (p: Page) => p.locator('[role="alert"][aria-live="assertive"]').first();

test.describe("Resolved-KPI announcement reaches both live regions", () => {
  test("A) kpi-only stale — plain landing sentence is announced", async ({ page }) => {
    await seedSession(page);
    await page.goto(`${BASE}/?tab=kpi&kpi=ghost`, { waitUntil: "domcontentloaded" });

    const status = statusRegion(page);
    const alert = alertRegion(page);

    // Polite mirror — full narrative including the adjusted entry and landing.
    await expect(status).toHaveAttribute("role", "status");
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(status).not.toHaveText("", { timeout: 10_000 });
    await expect(status).toContainText(/Landing on: KPI tab → “Current Overdue Amount”/);
    // No row component — kexp was never in the URL.
    await expect(status).not.toContainText(/at row #/);
    // Not the combined branch.
    await expect(status).not.toContainText(/kpi \+ kexp were both stale/);

    // Assertive region carries the same landing sentence.
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(alert).toHaveAttribute("aria-live", "assertive");
    await expect(alert).toContainText(/Landing on: KPI tab → “Current Overdue Amount”/);
    await expect(alert).not.toContainText(/kpi \+ kexp were both stale/);
  });

  test("B) kpi + kexp stale (below-min clamp) — combined sentence at row #1", async ({ page }) => {
    await seedSession(page);
    await page.goto(`${BASE}/?tab=kpi&kpi=ghost&kexp=-1`, { waitUntil: "domcontentloaded" });

    const expected =
      /Resolved: KPI “Current Overdue Amount” at row #1 \(kpi \+ kexp were both stale\)/;

    const status = statusRegion(page);
    const alert = alertRegion(page);

    await expect(status).not.toHaveText("", { timeout: 10_000 });
    await expect(status).toContainText(expected);
    // Combined branch must suppress the plain landing form in both regions.
    await expect(status).not.toContainText(/Landing on: KPI tab →/);

    await expect(alert).toContainText(expected);
    await expect(alert).not.toContainText(/Landing on: KPI tab →/);
  });

  test("B') kpi + kexp stale (above-max clamp) — combined sentence at row #100001", async ({
    page,
  }) => {
    await seedSession(page);
    await page.goto(`${BASE}/?tab=kpi&kpi=ghost&kexp=99999999`, { waitUntil: "domcontentloaded" });

    const expected =
      /Resolved: KPI “Current Overdue Amount” at row #100001 \(kpi \+ kexp were both stale\)/;

    await expect(statusRegion(page)).toContainText(expected, { timeout: 10_000 });
    await expect(alertRegion(page)).toContainText(expected);
  });

  test("clean URL — neither live region announces anything", async ({ page }) => {
    await seedSession(page);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    // Give the sanitizer effect a tick to settle.
    await page.waitForTimeout(1000);

    await expect(statusRegion(page)).toHaveText("");
    await expect(alertRegion(page)).toHaveText("");
  });
});
