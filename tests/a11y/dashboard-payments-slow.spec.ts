/**
 * E2E: dashboard emits a `payments_slow` diagnostic when the payments query
 * exceeds its latency budget, AND the dashboard still renders successfully
 * (no error alert, header + main content visible).
 *
 * We simulate a slow payments backend by throttling every request whose URL
 * hits `/rest/v1/payments` by ~2500ms — well above the default 1500ms budget
 * defined in `src/lib/dashboardDiagnostics.ts` (DEFAULT_PAYMENTS_LATENCY_BUDGET_MS).
 * The diagnostic is asserted from two independent surfaces:
 *   1. The `dashboard:diagnostic` CustomEvent dispatched on `window`.
 *   2. The `[dashboard] payments_slow` console.warn line.
 *
 * Run: bunx playwright test tests/a11y/dashboard-payments-slow.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const SCREENSHOT_DIR = "/tmp/browser/dashboard-payments-slow";
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// Throttle applied per matching request. Must exceed the client-side budget
// (DEFAULT_PAYMENTS_LATENCY_BUDGET_MS = 1500ms) by a comfortable margin so
// the assertion is deterministic even on a warm CI runner.
const PAYMENTS_THROTTLE_MS = 2500;
const EXPECTED_BUDGET_MS = 1500;

test.use({
  viewport: { width: 1280, height: 1800 },
  colorScheme: "light",
  reducedMotion: "reduce",
});

async function seedSession(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  if (STORAGE_KEY && SESSION_JSON) {
    await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
      STORAGE_KEY,
      SESSION_JSON,
    ] as const);
  }
}

test("Slow payments — payments_slow warning fires and dashboard still renders", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);

  // ---- Diagnostic capture (window CustomEvent) --------------------------
  // Install BEFORE any page script runs so we don't miss the event that
  // fires during the initial dashboard load.
  await context.addInitScript(() => {
    const w = window as unknown as {
      __paymentsSlowEvents?: Array<Record<string, unknown>>;
    };
    w.__paymentsSlowEvents = [];
    window.addEventListener("dashboard:diagnostic", (e: Event) => {
      const detail = (e as CustomEvent).detail as { event?: string } | undefined;
      if (detail && detail.event === "payments_slow") {
        w.__paymentsSlowEvents!.push(detail as Record<string, unknown>);
      }
    });
  });

  // ---- Diagnostic capture (console.warn) --------------------------------
  const consolePaymentsSlow: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "warning" && msg.type() !== "warn") return;
    const t = msg.text();
    if (/\[dashboard\]\s*payments_slow/i.test(t)) consolePaymentsSlow.push(t);
  });

  // ---- Guard: no error surface, ever -----------------------------------
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(`${err.name}: ${err.message}`));

  // ---- Throttle the payments REST endpoint only ------------------------
  // Delaying every Supabase call would slow the whole test unnecessarily;
  // targeting only `/rest/v1/payments` proves the tracker measures THIS
  // request specifically. `route.continue()` preserves the real response
  // so schema/order guarantees still hold.
  let throttledCount = 0;
  await context.route(/\/rest\/v1\/payments(\?|$)/i, async (route) => {
    throttledCount += 1;
    await new Promise((r) => setTimeout(r, PAYMENTS_THROTTLE_MS));
    await route.continue();
  });

  await seedSession(page);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });

  // Dashboard header must render even while payments are still in flight —
  // proves the slow query does not block the whole page from mounting.
  await expect(page.getByText(/PRECISE REALTORS & BUILDERS/i).first()).toBeVisible({
    timeout: 60_000,
  });

  // The error alert used for hard fetch failures must NEVER appear during a
  // slow-but-successful load; `payments_slow` is a warning, not an error.
  const errorAlert = page.getByRole("alert").filter({ hasText: /Failed to load dashboard data/i });
  await expect(errorAlert).toHaveCount(0);

  // Wait for the throttled payments request to complete and the tracker to
  // fire. `networkidle` guarantees the payments response landed; the extra
  // settle gives React a beat to flush the `trackPaymentsLatency` call.
  await page.waitForLoadState("networkidle", { timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(500);

  await page.screenshot({
    path: `${SCREENSHOT_DIR}/1_dashboard_after_slow_payments.png`,
  });

  // ---- Assert the payments request was actually intercepted -----------
  expect(
    throttledCount,
    "expected at least one /rest/v1/payments request to be throttled",
  ).toBeGreaterThan(0);

  // ---- Assert payments_slow surfaced on at least one channel ----------
  // Prefer the window event (structured, has durationMs + budgetMs). Fall
  // back to the console warning so a Sentry-disabled tab still passes.
  const eventHits = await page.evaluate(() => {
    const w = window as unknown as {
      __paymentsSlowEvents?: Array<Record<string, unknown>>;
    };
    return w.__paymentsSlowEvents ?? [];
  });

  const surfaced = eventHits.length > 0 || consolePaymentsSlow.length > 0;
  expect(
    surfaced,
    [
      "Expected a `payments_slow` diagnostic after throttling payments by",
      `${PAYMENTS_THROTTLE_MS}ms (budget is ${EXPECTED_BUDGET_MS}ms).`,
      `window events: ${JSON.stringify(eventHits)}`,
      `console warns: ${JSON.stringify(consolePaymentsSlow)}`,
    ].join(" "),
  ).toBe(true);

  // If the structured event fired, sanity-check the payload.
  if (eventHits.length > 0) {
    const first = eventHits[0] as {
      event?: string;
      level?: string;
      durationMs?: number;
      budgetMs?: number;
    };
    expect(first.event).toBe("payments_slow");
    expect(first.level).toBe("warning");
    expect(typeof first.durationMs).toBe("number");
    expect(typeof first.budgetMs).toBe("number");
    expect(first.durationMs!).toBeGreaterThan(first.budgetMs!);
    // The measured duration must be at least the throttle we injected
    // (minus a small scheduler tolerance).
    expect(first.durationMs!).toBeGreaterThanOrEqual(PAYMENTS_THROTTLE_MS - 250);
  }

  // ---- Dashboard remains healthy across the settle window ------------
  await expect(errorAlert).toHaveCount(0);
  expect(pageErrors, `Dashboard threw uncaught page errors:\n${pageErrors.join("\n")}`).toEqual([]);
});
