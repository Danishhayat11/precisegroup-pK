/**
 * Accessibility tests for the Dashboard URL-sanitizer info banner.
 *
 * Visits the dashboard with deliberately invalid query params so the
 * sanitizer fires, then asserts the wiring screen readers depend on:
 *   1. An aria-live="assertive" sr-only region with non-empty announcement
 *      text that mentions the landing destination.
 *   2. An sr-only <ul> of itemized changes, one <li> per invalid param,
 *      each sentence-formatted with "was invalid and …".
 *   3. The visible <details>/<summary> disclosure is keyboard-operable
 *      and its expanded list is aria-hidden so SR users aren't
 *      double-announced.
 *   4. The dismiss button has an accessible name and tears the banner
 *      down (live region clears).
 *
 * Run:  bunx playwright test tests/a11y/url-sanitizer-banner.spec.ts
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const SCREENSHOT_DIR = "/tmp/browser/url-sanitizer-banner";
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

test.use({
  viewport: { width: 1280, height: 1800 },
  colorScheme: "light",
  reducedMotion: "reduce",
});

// Single stale param is enough to fire the sanitizer reliably across React
// strict-mode double-invocations. Unit tests in src/lib/dashboardUrl.*.test.ts
// already cover every wording permutation; this suite only validates the
// accessibility plumbing.
const STALE_SEARCH = "?tab=banana";

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  if (STORAGE_KEY && SESSION_JSON) {
    await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
      STORAGE_KEY,
      SESSION_JSON,
    ] as const);
  }
  await page.goto(`${BASE}/${STALE_SEARCH}`, { waitUntil: "domcontentloaded" });
  // Banner heading carries a stable id; the sonner toast also shows the same
  // text but isn't what we're testing. Scope to the in-page banner.
  await page.locator("#reset-params-heading").waitFor({ timeout: 10_000 });
});

test.describe("URL sanitizer info banner — accessibility", () => {
  test("aria-live region is assertive, sr-only, and announces the landing destination", async ({
    page,
  }) => {
    // role="alert" implies aria-live="assertive". Both are asserted explicitly
    // so a regression that downgrades to polite is caught.
    const live = page.locator('[role="alert"][aria-live="assertive"]').first();
    await expect(live).toHaveCount(1);
    await expect(live).toHaveAttribute("aria-atomic", "true");

    // Visually hidden: present in the a11y tree but offscreen.
    const className = (await live.getAttribute("class")) ?? "";
    expect(className.split(/\s+/)).toContain("sr-only");

    // Live announcement must be non-empty AND end with a "Now landing on …"
    // sentence so SR users always know where focus ends up.
    const text = (await live.textContent())?.trim() ?? "";
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/Now landing on the (Overdue|KPI) tab/);
    // At least one sentence must describe the invalid-param outcome.
    expect(text).toMatch(/was invalid and (removed|replaced with)/);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/01_banner.png` });
  });

  test("sr-only invalid-params list is present and itemizes every change", async ({ page }) => {
    // Scope to the banner — id-linked container — to avoid sibling sr-only lists.
    const banner = page.locator('[aria-labelledby="reset-params-heading"]');
    await expect(banner).toHaveCount(1);

    const srList = banner.locator("ul.sr-only");
    await expect(srList).toHaveCount(1);

    const items = srList.locator("li");
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Every list item must be a complete sentence containing the original
    // value (or "(missing)") and either "removed" or "replaced with".
    const texts = await items.allInnerTexts();
    for (const t of texts) {
      expect(t).toMatch(/"[^"]*"|\(missing\)/);
      expect(t).toMatch(/was invalid and (removed|replaced with)/);
    }

    // The visible chip list and disclosure list must be aria-hidden so SR
    // users only hear the narrative once.
    const hiddenLists = banner.locator('ul[aria-hidden="true"]');
    expect(await hiddenLists.count()).toBeGreaterThanOrEqual(1);
  });

  test("visible 'Show details' disclosure is keyboard operable; its list is aria-hidden", async ({
    page,
  }) => {
    // Native <summary> exposes role=button. The element is a <summary>, so
    // querying by tag-name + accessible label keeps the test resilient.
    const summary = page.locator('details > summary[aria-label*="invalid parameter"]').first();
    await expect(summary).toHaveCount(1);

    // Pre-expansion: visible "Show details (N)" label.
    await expect(page.getByText(/Show details \(\d+\)/)).toBeVisible();

    // Activate via keyboard. Enter on focused <summary> toggles <details>.
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");

    // Post-expansion: label flips and the breakdown list renders.
    await expect(page.getByText(/Hide details/)).toBeVisible();

    const expandedList = page.locator('details[open] > ul[aria-hidden="true"]').first();
    await expect(expandedList).toHaveCount(1);
    const visibleItems = expandedList.locator("li");
    const visCount = await visibleItems.count();
    expect(visCount).toBeGreaterThanOrEqual(1);

    // Visible row count must match the sr-only narrative row count.
    const srCount = await page
      .locator('[aria-labelledby="reset-params-heading"] ul.sr-only li')
      .count();
    expect(visCount).toBe(srCount);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/02_expanded.png` });
  });

  test("dismiss button has accessible name and clears the live region", async ({ page }) => {
    const dismiss = page.getByRole("button", { name: /Dismiss invalid link parameters notice/i });
    await expect(dismiss).toHaveCount(1);
    await dismiss.click();

    await expect(page.locator("#reset-params-heading")).toHaveCount(0);
    // Live region is always mounted; its text empties when the banner clears.
    const live = page.locator('[role="alert"][aria-live="assertive"]').first();
    await expect(live).toHaveText("");
  });
});
