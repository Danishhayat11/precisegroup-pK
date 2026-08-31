/**
 * A11y E2E — verifies the combined "Resolved" sentence reaches assistive
 * tech via the live regions after the dashboard loads with stale kpi+kexp.
 *
 * Two live regions mirror the toast narrative:
 *   - role="alert"  aria-live="assertive" (sr-only, in src/pages/Dashboard.tsx)
 *   - role="status" aria-live="polite"    (data-testid="url-sanitizer-status")
 *
 * Both must contain the verbatim combined sentence:
 *   Resolved: KPI “<label>” at row #<N> (kpi + kexp were both stale)
 *
 * Run:  bunx playwright test tests/a11y/url-sanitizer-resolved-live.spec.ts
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

// Each fixture exercises a different kexp clamping boundary so the row
// number announced to SRs is verified at both ends of the valid range.
const CASES: Array<{ search: string; row: number; note: string }> = [
  { search: "?tab=kpi&kpi=ghost&kexp=-1", row: 1, note: "below-min clamp" },
  { search: "?tab=kpi&kpi=ghost&kexp=100001", row: 100001, note: "above-max clamp" },
  { search: "?tab=kpi&kpi=banana&kexp=abc", row: 1, note: "non-numeric → default" },
];

test.describe("URL sanitizer — combined Resolved sentence reaches live regions", () => {
  for (const c of CASES) {
    test(`${c.note} (${c.search}) → live regions announce row #${c.row}`, async ({ page }) => {
      await seedSession(page);
      await page.goto(`${BASE}/${c.search}`, { waitUntil: "domcontentloaded" });

      const expected = new RegExp(
        // Curly quotes (U+201C/U+201D) match the source string.
        `Resolved: KPI “Current Overdue Amount” at row #${c.row} \\(kpi \\+ kexp were both stale\\)`,
      );

      // --- Polite status mirror (primary SR surface) ---
      const status = page.getByTestId("url-sanitizer-status");
      await expect(status).toHaveAttribute("role", "status");
      await expect(status).toHaveAttribute("aria-live", "polite");
      await expect(status).not.toHaveText("", { timeout: 10_000 });
      await expect(status).toContainText(expected);

      // --- Assertive alert region (interrupts SR for fast announcement) ---
      // The alert region carries the landing sentence only; locate it by role
      // and aria-live so the test does not depend on testids.
      const alert = page.locator('[role="alert"][aria-live="assertive"]').first();
      await expect(alert).toContainText(expected);

      // Neither region should leak the plain "Landing on:" form when the
      // combined branch fires — they are mutually exclusive in the source.
      await expect(status).not.toContainText(/Landing on: KPI tab →/);
      await expect(alert).not.toContainText(/Landing on: KPI tab →/);
    });
  }

  test("clean URL → both live regions stay empty (no spurious announcement)", async ({ page }) => {
    await seedSession(page);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    // Allow the mount effect to settle.
    await page.waitForTimeout(1500);

    const status = page.getByTestId("url-sanitizer-status");
    await expect(status).toHaveText("");

    const alert = page.locator('[role="alert"][aria-live="assertive"]').first();
    // The alert region is always mounted but stays empty on a clean URL.
    await expect(alert).toHaveText("");
  });
});
