/**
 * Accessibility E2E — captures the role="status" aria-live announcement
 * emitted by the Dashboard URL sanitizer when invalid KPI params load.
 *
 * The status region (data-testid="url-sanitizer-status") mirrors the toast
 * narrative in a polite live region so assistive tech reliably announces it.
 * This test loads a deliberately stale URL and asserts:
 *   1. The region exists with role="status" and aria-live="polite".
 *   2. Its text content names each invalid param, its original value, and the
 *      outcome (removed vs replaced with X).
 *   3. The landing-destination sentence is included.
 *   4. On a clean URL the region renders empty (no spurious announcements).
 *
 * Run:  bunx playwright test tests/a11y/url-sanitizer-status.spec.ts
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const OUT = "/tmp/browser/url-sanitizer-status";
fs.mkdirSync(OUT, { recursive: true });

test.use({
  viewport: { width: 1280, height: 1800 },
  reducedMotion: "reduce",
});

async function seedSession(page: import("@playwright/test").Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  if (STORAGE_KEY && SESSION_JSON) {
    await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
      STORAGE_KEY,
      SESSION_JSON,
    ] as const);
  }
}

test.describe("URL sanitizer — role=status announcement", () => {
  test("announces every invalid param with original and outcome", async ({ page }) => {
    await seedSession(page);
    // risk=BANANA   → removed
    // kpi=ghost     → replaced with overdue
    // kexp=-1       → clamped to row #1
    await page.goto(`${BASE}/?risk=BANANA&kpi=ghost&kexp=-1`, {
      waitUntil: "domcontentloaded",
    });

    const status = page.getByTestId("url-sanitizer-status");
    // Wait for the sanitizer effect to populate the region.
    await expect(status).toHaveAttribute("role", "status");
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(status).not.toHaveText("", { timeout: 10_000 });

    const text = (await status.textContent())?.trim() ?? "";
    // Capture the exact announcement for the test report / debugging.
    fs.writeFileSync(`${OUT}/announcement.txt`, text);
    console.log("[a11y status]", text);

    // 1) Leading sentence.
    expect(text).toMatch(/^Invalid link parameters were reset\./);
    // 2) Each invalid param with its original value and outcome.
    expect(text).toMatch(/Risk filter "BANANA" removed/);
    expect(text).toMatch(/KPI selection "ghost" replaced with "overdue"/);
    expect(text).toMatch(/KPI expanded row "-1" replaced with "1"/);
    // 3) Landing-destination sentence appended.
    expect(text).toMatch(/(Resolved: KPI|Landing on: KPI tab)/);
  });

  test("clean URL leaves the status region empty", async ({ page }) => {
    await seedSession(page);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    const status = page.getByTestId("url-sanitizer-status");
    await expect(status).toHaveAttribute("role", "status");
    // Give the mount effect a chance — region must stay empty.
    await page.waitForTimeout(1500);
    await expect(status).toHaveText("");
  });
});
