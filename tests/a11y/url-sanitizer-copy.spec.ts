/**
 * E2E — clicks "Copy reset details" on the dashboard sanitizer notice and
 * verifies the clipboard payload includes every invalid KPI param, its
 * original value, and whether it was removed or replaced.
 *
 * The clipboard report is built in src/pages/Dashboard.tsx with this shape:
 *   Dashboard URL sanitization report
 *   Time: <ISO>
 *   URL: <href>
 *
 *   Invalid (removed):
 *     - <key> = "<from>"  [<label>]
 *
 *   Adjusted:
 *     - <key>: "<from>" -> "<to>"  [<label>]
 *
 *   <landing sentence>
 *
 * Run:  bunx playwright test tests/a11y/url-sanitizer-copy.spec.ts
 */
import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";

test.use({ viewport: { width: 1280, height: 1800 }, reducedMotion: "reduce" });

async function seedSession(page: import("@playwright/test").Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  if (STORAGE_KEY && SESSION_JSON) {
    await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
      STORAGE_KEY,
      SESSION_JSON,
    ] as const);
  }
}

test.describe("URL sanitizer — Copy reset details", () => {
  test("clipboard payload lists every invalid param, original value, and outcome", async ({
    page,
    context,
    browserName,
  }) => {
    // Clipboard API requires a permission grant; Firefox/WebKit don't accept
    // the chromium permission name, so skip there — the unit suite covers the
    // payload shape and this E2E proves the wiring end-to-end in Chromium.
    test.skip(browserName !== "chromium", "clipboard permission only granted in chromium");
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });

    await seedSession(page);
    // Stale combo:
    //   risk=BANANA   → invalid value, removed
    //   age=999       → invalid value, removed
    //   kpi=ghost     → replaced with "overdue"
    //   kexp=-1       → clamped to row "1"
    await page.goto(`${BASE}/?risk=BANANA&age=999&kpi=ghost&kexp=-1`, {
      waitUntil: "domcontentloaded",
    });

    const notice = page.getByRole("button", { name: /Copy reset details/i });
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await notice.click();

    // Confirmation toast tells us the copy resolved successfully.
    await expect(
      page.locator("[data-sonner-toast]", { hasText: /Reset details copied/i }).first(),
    ).toBeVisible({ timeout: 5_000 });

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    console.log("[clipboard]\n" + clipboard);

    // Header block.
    expect(clipboard).toMatch(/^Dashboard URL sanitization report$/m);
    expect(clipboard).toMatch(/^Time: \d{4}-\d{2}-\d{2}T/m);
    expect(clipboard).toMatch(/^URL: https?:\/\/[^\s]+\?[^\s]*risk=BANANA[^\s]*/m);

    // Removed section: each removed param appears with its original value and
    // friendly label (PARAM_LABELS in Dashboard.tsx).
    expect(clipboard).toMatch(/^Invalid \(removed\):$/m);
    expect(clipboard).toMatch(/^ {2}- risk = "BANANA" {2}\[Risk filter\]$/m);
    expect(clipboard).toMatch(/^ {2}- age = "999" {2}\[Overdue age filter\]$/m);

    // Adjusted section: each repaired param shows original -> replacement.
    expect(clipboard).toMatch(/^Adjusted:$/m);
    expect(clipboard).toMatch(/^ {2}- kpi: "ghost" -> "overdue" {2}\[KPI selection\]$/m);
    expect(clipboard).toMatch(/^ {2}- kexp: "-1" -> "1" {2}\[KPI expanded row\]$/m);

    // Landing sentence appended at the bottom (combined kpi+kexp resolution
    // OR plain landing form — both shapes are produced by describeSanitization).
    expect(clipboard).toMatch(
      /(Resolved: KPI ["“][^"”]+["”] at row #\d+ \(kpi \+ kexp were both stale\))|(Landing on: KPI tab → ["“][^"”]+["”])/,
    );

    // Sanity: every change is reported exactly once.
    expect(clipboard.match(/^ {2}- /gm)?.length).toBe(4);
  });
});
