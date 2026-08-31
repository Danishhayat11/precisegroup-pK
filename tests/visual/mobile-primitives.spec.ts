/**
 * Visual regression — shared UI primitives at iOS + Android mobile widths.
 *
 * Scope (the ONLY things this suite guards):
 *   1. StatusBadge  — tone + shape parity on Bookings list.
 *   2. EmptyState   — icon + copy + spacing on Maintenance.
 *   3. Skeleton     — TableRowsSkeleton on Bookings while data is in-flight.
 *   4. CRM header   — /crm mobile header contrast (regression sentinel for
 *                     the "dark heading on dark bar" bug).
 *   5. Bookings FAB — floating "+" position vs per-card action buttons
 *                     (regression sentinel for FAB/chat-icon overlap).
 *
 * Each surface is captured at 390px (iPhone 14) and 412px (Pixel 7) — the
 * two production mobile breakpoints. Baselines live under
 * `tests/visual/mobile-primitives.spec.ts-snapshots/`.
 *
 * First run (creates baselines):
 *   bunx playwright test tests/visual/mobile-primitives.spec.ts \
 *        --project=chromium-reduced-motion --update-snapshots
 *
 * Regression run:
 *   bun run test:visual:mobile-primitives
 */
import { test, expect, type Page, type Route } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const HAS_SESSION = Boolean(STORAGE_KEY && SESSION_JSON);

const DEVICES = {
  ios: { width: 390, height: 844 }, // iPhone 14
  android: { width: 412, height: 915 }, // Pixel 7
} as const;
type Device = keyof typeof DEVICES;

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
const THEME_STORAGE_KEY = "precise.theme";

async function seedSession(page: Page, theme: Theme) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([sk, sv, tk, tv]) => {
      window.localStorage.setItem(sk, sv);
      window.localStorage.setItem(tk, tv);
    },
    [STORAGE_KEY, SESSION_JSON, THEME_STORAGE_KEY, theme] as const,
  );
  if (COOKIES_JSON) {
    const cookies = JSON.parse(COOKIES_JSON) as Array<Record<string, unknown>>;
    for (const c of cookies) c.url = BASE;
    await page.context().addCookies(cookies as never);
  }
}

async function settle(page: Page, theme: Theme) {
  // Verify the pre-hydration theme script applied the requested class so
  // the screenshot cannot be captured mid-flip.
  await page.waitForFunction(
    (t) => document.documentElement.classList.contains("dark") === (t === "dark"),
    theme,
    { timeout: 5_000 },
  );
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(150);
}

const SNAP = { animations: "disabled", maxDiffPixelRatio: 0.02 } as const;

for (const device of Object.keys(DEVICES) as Device[]) {
  for (const theme of THEMES) {
    test.describe(`mobile primitives @ ${device} (${DEVICES[device].width}px) — ${theme}`, () => {
      test.use({ viewport: DEVICES[device], colorScheme: theme });

      test("StatusBadge — Bookings first row pill", async ({ page }) => {
        test.skip(!HAS_SESSION, "No Supabase session available");
        await seedSession(page, theme);
        await page.goto(`${BASE}/bookings`, { waitUntil: "domcontentloaded" });
        const badge = page
          .locator(".badge-pill")
          .filter({ hasText: /Completed|Active|Booked|Cancelled|Pending|Overdue/i })
          .first();
        await expect(badge).toBeVisible({ timeout: 15_000 });
        await settle(page, theme);
        await expect(badge).toHaveScreenshot(`status-badge-bookings-${device}-${theme}.png`, SNAP);
      });

      test("EmptyState — Maintenance", async ({ page }) => {
        test.skip(!HAS_SESSION, "No Supabase session available");
        await seedSession(page, theme);
        await page.goto(`${BASE}/maintenance`, { waitUntil: "domcontentloaded" });
        const empty = page
          .getByText(/No maintenance charges/i)
          .locator("xpath=ancestor::*[self::div or self::section][1]");
        await expect(empty).toBeVisible({ timeout: 15_000 });
        await settle(page, theme);
        await expect(empty).toHaveScreenshot(
          `empty-state-maintenance-${device}-${theme}.png`,
          SNAP,
        );
      });

      test("Skeleton — Bookings list while loading", async ({ page }) => {
        test.skip(!HAS_SESSION, "No Supabase session available");
        await seedSession(page, theme);
        let release: (() => void) | null = null;
        const gate = new Promise<void>((r) => (release = r));
        await page.route(/\/rest\/v1\/bookings/i, async (route: Route) => {
          await gate;
          await route.continue();
        });
        await page.goto(`${BASE}/bookings`, { waitUntil: "domcontentloaded" });
        await expect(
          page.getByRole("status").filter({ hasText: /Loading bookings/i }),
        ).toBeAttached({ timeout: 10_000 });
        await settle(page, theme);
        const cards = page.locator("div.md\\:hidden.flex.flex-col").first();
        await expect(cards).toBeVisible();
        await expect(cards).toHaveScreenshot(`skeleton-bookings-${device}-${theme}.png`, SNAP);
        release?.();
      });

      test("CRM header — /crm mobile contrast strip", async ({ page }) => {
        test.skip(!HAS_SESSION, "No Supabase session available");
        await seedSession(page, theme);
        await page.goto(`${BASE}/crm`, { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("main")).toBeVisible({ timeout: 15_000 });
        await settle(page, theme);
        await expect(page).toHaveScreenshot(`crm-header-${device}-${theme}.png`, {
          ...SNAP,
          clip: { x: 0, y: 0, width: DEVICES[device].width, height: 220 },
        });
      });

      test("Bookings FAB — no overlap with row actions", async ({ page }) => {
        test.skip(!HAS_SESSION, "No Supabase session available");
        await seedSession(page, theme);
        await page.goto(`${BASE}/bookings`, { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("button", { name: /New booking/i }).first()).toBeVisible({
          timeout: 15_000,
        });
        await settle(page, theme);
        const { width, height } = DEVICES[device];
        await expect(page).toHaveScreenshot(`bookings-fab-${device}-${theme}.png`, {
          ...SNAP,
          clip: {
            x: width - 160,
            y: height - 220,
            width: 160,
            height: 220,
          },
        });
      });
    });
  }
}
