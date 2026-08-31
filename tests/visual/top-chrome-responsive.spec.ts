/**
 * Visual regression — top chrome (header + primary nav) at three breakpoints
 * across /site, /login, /dashboard.
 *
 * Guardrail scope:
 *   • Tap-target drift — if anyone shrinks a nav button below the current
 *     baseline, the pixel diff catches it before the runtime tap-target
 *     suite even runs.
 *   • Horizontal overflow of the top chrome — bleeds, wide menu labels,
 *     unshrunk logos will visibly shift pixels inside the clip.
 *   • Sidebar rail regressions on /dashboard desktop (`aside[aria-label=
 *     "Primary sidebar"]` — hidden on mobile per `hidden md:flex`).
 *
 * Strategy:
 *   Snapshot the top viewport strip (0,0 → width × 160) at each breakpoint
 *   for every route. That uniformly captures the header/nav band whether
 *   the route uses a semantic <header>, an app-shell top bar, or (like
 *   /login) has no header landmark at all — in every case the "top of
 *   what the user sees" must not regress.
 *
 *   Baselines live under
 *   `tests/visual/top-chrome-responsive.spec.ts-snapshots/`.
 *   First run: `bunx playwright test tests/visual/top-chrome-responsive.spec.ts
 *   --project=chromium-reduced-motion --update-snapshots`.
 *
 * Run:
 *   bunx playwright test tests/visual/top-chrome-responsive.spec.ts \
 *        --project=chromium-reduced-motion
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const HAS_SESSION = Boolean(STORAGE_KEY && SESSION_JSON);

// Match the responsive-breakpoints spec so a diff here maps 1:1 to that
// suite's viewport matrix.
const VIEWPORTS = {
  mobile: { width: 375, height: 900 },
  tablet: { width: 820, height: 1000 },
  desktop: { width: 1440, height: 1000 },
} as const;
type Device = keyof typeof VIEWPORTS;

// Top chrome strip height. 160 px covers the tallest header we ship
// (site chrome = h-24 = 96 px, plus wordmark descenders + ring offset)
// with headroom, without dragging in below-fold hero content that would
// churn baselines on unrelated copy tweaks.
const STRIP_H = 160;

type Route = {
  name: string;
  path: string;
  requiresAuth: boolean;
  /** Selector we wait on before snapping — proves layout settled. */
  ready: (page: Page) => Promise<void>;
};

const ROUTES: Route[] = [
  {
    name: "site",
    path: "/site",
    requiresAuth: false,
    ready: async (page) => expect(page.locator("header").first()).toBeVisible({ timeout: 10_000 }),
  },
  {
    name: "login",
    path: "/login",
    requiresAuth: false,
    ready: async (page) =>
      expect(page.locator('input[type="email"]')).toBeVisible({
        timeout: 10_000,
      }),
  },
  {
    name: "dashboard",
    path: "/dashboard",
    requiresAuth: true,
    ready: async (page) => expect(page.getByRole("main")).toBeVisible({ timeout: 15_000 }),
  },
];

async function seedSessionIfAvailable(page: Page) {
  if (!HAS_SESSION) return;
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
    STORAGE_KEY,
    SESSION_JSON,
  ] as const);
  if (COOKIES_JSON) {
    const cookies = JSON.parse(COOKIES_JSON) as Array<Record<string, unknown>>;
    for (const c of cookies) c.url = BASE;
    await page.context().addCookies(cookies as never);
  }
}

async function settle(page: Page) {
  // Fonts must be loaded or top-chrome glyph metrics jitter across runs.
  await page.evaluate(() => document.fonts?.ready);
  // Marketing header has a scroll-linked backdrop-filter transition; a
  // short beat lets the initial (un-scrolled) state paint before capture.
  await page.waitForTimeout(150);
}

for (const device of Object.keys(VIEWPORTS) as Device[]) {
  test.describe(`top chrome @ ${device} (${VIEWPORTS[device].width}px)`, () => {
    test.use({ viewport: VIEWPORTS[device] });

    for (const route of ROUTES) {
      test(`${route.name} — header/nav strip`, async ({ page }) => {
        test.skip(
          route.requiresAuth && !HAS_SESSION,
          "No Supabase session available for authenticated route",
        );
        if (route.requiresAuth) await seedSessionIfAvailable(page);

        // Auth-protected routes race a client-side redirect from the
        // seed goto (/login → /dashboard once the session is in
        // localStorage), which occasionally aborts an immediately-
        // following goto with net::ERR_ABORTED. One retry stabilises
        // it without hiding a real navigation failure.
        try {
          await page.goto(`${BASE}${route.path}`, {
            waitUntil: "domcontentloaded",
          });
        } catch (err) {
          if (!/ERR_ABORTED/.test(String((err as Error).message))) throw err;
          await page.goto(`${BASE}${route.path}`, {
            waitUntil: "domcontentloaded",
          });
        }
        await route.ready(page);
        await settle(page);

        const { width } = VIEWPORTS[device];
        await expect(page).toHaveScreenshot(`top-chrome-${route.name}-${device}.png`, {
          clip: { x: 0, y: 0, width, height: STRIP_H },
          // AA/subpixel jitter tolerance; a real tap-target shrink or
          // wrapping/overflow shift blows past this threshold easily.
          maxDiffPixelRatio: 0.02,
          animations: "disabled",
        });
      });
    }

    // Dashboard's primary sidebar is `hidden md:flex` — only exists on
    // tablet + desktop. Lock its resting look separately so a width /
    // padding regression on the icon rail is caught without polluting
    // the top-strip baseline.
    if (device !== "mobile") {
      test(`dashboard — primary sidebar`, async ({ page }) => {
        test.skip(!HAS_SESSION, "No Supabase session available for authenticated route");
        await seedSessionIfAvailable(page);
        await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("main")).toBeVisible({ timeout: 15_000 });
        await settle(page);

        const sidebar = page.locator('aside[aria-label="Primary sidebar"]');
        await expect(sidebar).toBeVisible();
        await expect(sidebar).toHaveScreenshot(`top-chrome-dashboard-sidebar-${device}.png`, {
          maxDiffPixelRatio: 0.02,
          animations: "disabled",
        });
      });
    }
  });
}
