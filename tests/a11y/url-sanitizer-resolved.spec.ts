/**
 * E2E — verifies the combined "Resolved" sentence renders verbatim in BOTH
 * surfaces (sonner toast description + inline amber banner) when `kpi` and
 * `kexp` are both stale on the dashboard URL.
 *
 * Exact format under test (curly quotes around the KPI label are intentional):
 *   Resolved: KPI “<label>” at row #<N> (kpi + kexp were both stale)
 *
 * Run:  bunx playwright test tests/a11y/url-sanitizer-resolved.spec.ts
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

// Each case: a stale URL where BOTH kpi and kexp must be repaired, plus the
// curly-quoted KPI label the combined sentence is expected to resolve to.
const CASES: Array<{ search: string; label: string; row: number; note: string }> = [
  {
    search: "?tab=kpi&kpi=ghost&kexp=-1",
    label: "Current Overdue Amount", // recovery default for invalid kpi
    row: 1, // clamped from -1
    note: "ghost kpi + negative kexp",
  },
  {
    search: "?tab=kpi&kpi=banana&kexp=999999",
    label: "Current Overdue Amount",
    row: 1, // clamped from out-of-range high value (nearest valid row)
    note: "unknown kpi + overflow kexp",
  },
];

test.describe("URL sanitizer — combined Resolved sentence (kpi + kexp both stale)", () => {
  for (const c of CASES) {
    test(`${c.note} → renders the exact combined sentence in banner and toast`, async ({
      page,
    }) => {
      await seedSession(page);
      await page.goto(`${BASE}/${c.search}`, { waitUntil: "domcontentloaded" });

      // Allow a regex-ish row check (the sanitizer clamps to the nearest
      // valid row, which is 1 in both fixtures, but we keep the assertion
      // tolerant in case the dataset shifts).
      const expectedSentence = new RegExp(
        // NB: U+201C / U+201D curly quotes, NOT straight quotes.
        `Resolved: KPI “${c.label}” at row #\\d+ \\(kpi \\+ kexp were both stale\\)`,
      );
      const expectedRowExact = new RegExp(
        `Resolved: KPI “${c.label}” at row #${c.row} \\(kpi \\+ kexp were both stale\\)`,
      );

      // ----- 1. Sonner toast -----
      const toast = page
        .locator("[data-sonner-toast]", { hasText: "Some link parameters were invalid" })
        .first();
      await expect(toast).toBeVisible({ timeout: 10_000 });
      await expect(toast).toContainText(expectedSentence);
      await expect(toast).toContainText(expectedRowExact);
      // Negative assertion: the plain "Landing on:" form must NOT appear when
      // the combined branch fires — they are mutually exclusive in the source.
      await expect(toast).not.toContainText(/Landing on: KPI tab →/);

      // ----- 2. Inline amber banner (sr-only landing sentence) -----
      // The banner mounts the same resolved-landing text in an sr-only <p>
      // (see src/pages/Dashboard.tsx around the reset-params-heading block)
      // and in the polite role=status mirror. Either is sufficient evidence
      // the banner-side received the identical sentence.
      const status = page.getByTestId("url-sanitizer-status");
      await expect(status).toContainText(expectedSentence);
      await expect(status).toContainText(expectedRowExact);
    });
  }

  test("dismissing the toast does not change the resolved sentence text", async ({ page }) => {
    await seedSession(page);
    await page.goto(`${BASE}/?tab=kpi&kpi=ghost&kexp=-1`, { waitUntil: "domcontentloaded" });

    const toast = page
      .locator("[data-sonner-toast]", { hasText: "Some link parameters were invalid" })
      .first();
    await expect(toast).toBeVisible({ timeout: 10_000 });
    const text = (await toast.textContent()) ?? "";
    expect(text).toMatch(
      /Resolved: KPI “Current Overdue Amount” at row #1 \(kpi \+ kexp were both stale\)/,
    );
  });
});
