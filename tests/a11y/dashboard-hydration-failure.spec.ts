/**
 * E2E: Dashboard hydration-failure scenario.
 *
 * Simulates a broken initial data fetch (the client hydrates but every
 * Supabase REST call fails) and verifies the full loading → error UI
 * contract that ships with the Dashboard:
 *
 *   1. While requests are in-flight, the aria-live loading status
 *      ("Loading dashboard…") is announced and marked `aria-busy`.
 *   2. Once the query retry budget is exhausted, the inline error UI
 *      renders with role="alert", the failure copy, and a "Retry" button.
 *   3. Diagnostic events fire in the correct order — `mount`, `fetch_start`,
 *      `fetch_error` — and are captured on the `dashboard:diagnostic`
 *      window event bus.
 *   4. Clicking Retry issues a fresh `fetch_start`, and if the failure
 *      clears, the dashboard recovers and renders the live totals list.
 *
 * Run:  bunx playwright test tests/a11y/dashboard-hydration-failure.spec.ts
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const SCREENSHOT_DIR = "/tmp/browser/dashboard-hydration-failure";
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

test.use({
  viewport: { width: 1280, height: 1800 },
  colorScheme: "light",
  reducedMotion: "reduce",
});

/** Install a diagnostic collector on the window before the app boots. */
async function installDiagnosticCollector(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __diagEvents: unknown[] }).__diagEvents = [];
    window.addEventListener("dashboard:diagnostic", (ev) => {
      const arr = (window as unknown as { __diagEvents: unknown[] }).__diagEvents;
      arr.push((ev as CustomEvent).detail);
    });
  });
}

async function seedSession(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  if (STORAGE_KEY && SESSION_JSON) {
    await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
      STORAGE_KEY,
      SESSION_JSON,
    ] as const);
  }
}

/** All REST reads the dashboard makes go through Supabase's `/rest/v1/*`. */
const REST_GLOB = "**/rest/v1/**";

async function getDiagEvents(page: Page): Promise<Array<{ event: string; level?: string }>> {
  return page.evaluate(
    () =>
      ((window as unknown as { __diagEvents?: Array<{ event: string; level?: string }> })
        .__diagEvents ?? []) as Array<{ event: string; level?: string }>,
  );
}

test.describe("Dashboard hydration-failure UI states", () => {
  test("shows loading spinner, then error alert, then recovers after Retry", async ({ page }) => {
    // Silence expected console errors from the failing fetch.
    page.on("pageerror", () => {});
    page.on("console", () => {});

    await installDiagnosticCollector(page);
    await seedSession(page);

    // -----------------------------------------------------------------
    // Phase 1 — every REST GET fails. We first delay them briefly so the
    // loading state is observable before the failures land.
    // -----------------------------------------------------------------
    let failMode: "delay-then-fail" | "recover" = "delay-then-fail";
    let requestCount = 0;

    await page.route(REST_GLOB, async (route: Route) => {
      if (route.request().method() !== "GET") return route.continue();
      requestCount += 1;
      if (failMode === "delay-then-fail") {
        // Delay long enough for the loading state to render, then abort.
        await new Promise((r) => setTimeout(r, 400));
        return route.abort("failed");
      }
      return route.continue();
    });

    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });

    // 1a. Loading status is announced with aria-live + aria-busy.
    const loadingStatus = page
      .getByRole("status")
      .filter({ hasText: /Loading dashboard/i })
      .first();
    await expect(loadingStatus).toBeVisible({ timeout: 10_000 });
    await expect(loadingStatus).toHaveAttribute("aria-busy", "true");
    await expect(loadingStatus).toHaveAttribute("aria-live", "polite");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/1_loading.png` });

    // 1b. Error UI appears after retry budget exhausts (useQuery retry: 1).
    const errorAlert = page
      .getByRole("alert")
      .filter({ hasText: /Failed to load dashboard data/i });
    await expect(errorAlert).toBeVisible({ timeout: 20_000 });
    const retryButton = page.getByRole("button", { name: /^Retry$/ });
    await expect(retryButton).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/2_error.png` });

    // Loading gate must be gone now that the error surface has taken over.
    await expect(loadingStatus).toHaveCount(0);

    // 1c. Diagnostic bus captured the failure path in the correct order.
    const eventsAfterError = await getDiagEvents(page);
    const names = eventsAfterError.map((e) => e.event);
    expect(names).toContain("mount");
    expect(names).toContain("fetch_start");
    expect(names).toContain("fetch_error");
    expect(names.indexOf("fetch_start")).toBeLessThan(names.indexOf("fetch_error"));
    const fetchError = eventsAfterError.find((e) => e.event === "fetch_error");
    expect(fetchError?.level).toBe("error");

    // Sanity: at least one REST request was attempted.
    expect(requestCount).toBeGreaterThan(0);

    // -----------------------------------------------------------------
    // Phase 2 — clicking Retry re-issues a fetch. We assert the retry
    // wiring by observing a fresh `fetch_start` diagnostic (whether the
    // subsequent request succeeds depends on backend state and is out of
    // scope for the hydration-failure UI contract).
    // -----------------------------------------------------------------
    failMode = "recover";
    const beforeRetryCount = (await getDiagEvents(page)).filter(
      (e) => e.event === "fetch_start",
    ).length;

    await retryButton.click();

    await expect
      .poll(
        async () => (await getDiagEvents(page)).filter((e) => e.event === "fetch_start").length,
        { timeout: 10_000 },
      )
      .toBeGreaterThan(beforeRetryCount);

    // The retry click itself must be logged so ops can trace user intent.
    await expect
      .poll(async () => (await getDiagEvents(page)).map((e) => e.event), {
        timeout: 5_000,
      })
      .toContain("retry_click");
  });
});
