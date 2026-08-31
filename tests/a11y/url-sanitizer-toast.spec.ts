/**
 * End-to-end test for the Dashboard URL-sanitizer info TOAST.
 *
 * Visits the dashboard with deliberately invalid KPI-related query params and
 * asserts the sonner toast appears with:
 *   - the canonical title ("Some link parameters were invalid")
 *   - the "Invalid (removed): key=\"orig\"" segment for stripped params
 *   - the "Adjusted: key=\"orig\" → newValue" segment for repaired params
 *   - the "Landing on: …" destination confirmation
 *   - a working "Copy reset details" action button
 *
 * The unit tests in src/lib/dashboardUrl.toast*.test.ts cover wording
 * permutations exhaustively; this suite proves the toast actually renders
 * end-to-end with those exact strings.
 *
 * Run:  bunx playwright test tests/a11y/url-sanitizer-toast.spec.ts
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const SCREENSHOT_DIR = "/tmp/browser/url-sanitizer-toast";
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

test.use({
  viewport: { width: 1280, height: 1800 },
  colorScheme: "light",
  // Toast animations are skipped so the toast is in its final position
  // immediately — keeps assertions deterministic.
  reducedMotion: "reduce",
});

// Stale combo exercising all three reporting branches:
//   risk=BANANA   → invalid value, removed
//   kpi=ghost     → invalid value, replaced with "overdue"
//   kexp=-1       → invalid number, clamped to "row #1"
const STALE_SEARCH = "?risk=BANANA&kpi=ghost&kexp=-1";

async function seedSession(page: import("@playwright/test").Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  if (STORAGE_KEY && SESSION_JSON) {
    await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
      STORAGE_KEY,
      SESSION_JSON,
    ] as const);
  }
}

test.describe("URL sanitizer info toast — end-to-end", () => {
  test("toast renders with original→replacement text for every invalid param", async ({ page }) => {
    await seedSession(page);
    await page.goto(`${BASE}/${STALE_SEARCH}`, { waitUntil: "domcontentloaded" });

    // Sonner mounts toasts inside [data-sonner-toaster]. Wait for the
    // warning-variant toast whose title equals the canonical sanitizer title.
    const toast = page
      .locator("[data-sonner-toast]", { hasText: "Some link parameters were invalid" })
      .first();
    await expect(toast).toBeVisible({ timeout: 10_000 });

    // The visible description joins all parts with " · ". We assert each
    // segment individually so a regression on any one branch is caught.
    // 1) Removed: risk was an invalid value, stripped from the URL.
    await expect(toast).toContainText(/Invalid \(removed\):[^·]*risk="BANANA"/);
    // 2) Adjusted: kpi swapped from "ghost" to the recovery default "overdue".
    await expect(toast).toContainText(/Adjusted:[^·]*kpi="ghost"\s*→\s*overdue/);
    // 3) Adjusted: kexp clamped from "-1" to "row #1".
    await expect(toast).toContainText(/kexp="-1"\s*→\s*row #1/);
    // 4) Landing destination. With kpi+kexp both stale, the combined
    //    "Resolved: KPI …" sentence fires (see describeSanitization). Either
    //    that or the plain "Landing on:" form must be present.
    await expect(toast).toContainText(
      /(?:Resolved: KPI ["“][^"”]+["”] at row #\d+ \(kpi \+ kexp were both stale\))|(?:Landing on: KPI tab → ["“][^"”]+["”])/,
    );

    await page.screenshot({ path: `${SCREENSHOT_DIR}/01_toast.png` });
  });

  test("toast 'Copy reset details' action is present and clickable", async ({ page }) => {
    await seedSession(page);
    await page.goto(`${BASE}/${STALE_SEARCH}`, { waitUntil: "domcontentloaded" });

    const toast = page
      .locator("[data-sonner-toast]", { hasText: "Some link parameters were invalid" })
      .first();
    await expect(toast).toBeVisible({ timeout: 10_000 });

    // Sonner renders the action prop as a button inside the toast. Match by
    // visible label so a wording change is caught.
    const copyBtn = toast.getByRole("button", { name: /Copy reset details/i });
    await expect(copyBtn).toBeVisible();
    await expect(copyBtn).toBeEnabled();

    // Grant clipboard permission so the success path is exercised end-to-end.
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: BASE,
    });
    await copyBtn.click();

    // Confirmation toast (success variant) appears after a successful copy.
    await expect(
      page.locator("[data-sonner-toast]", { hasText: /Reset details copied/i }).first(),
    ).toBeVisible({ timeout: 5_000 });

    await page.screenshot({ path: `${SCREENSHOT_DIR}/02_copied.png` });
  });

  test("clean URL produces no sanitizer toast", async ({ page }) => {
    await seedSession(page);
    // No stale params → describeSanitization returns null → no toast emitted.
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    // Give the dashboard's mount-effect a chance to run.
    await page.waitForTimeout(1500);
    await expect(
      page.locator("[data-sonner-toast]", { hasText: "Some link parameters were invalid" }),
    ).toHaveCount(0);
  });
});
