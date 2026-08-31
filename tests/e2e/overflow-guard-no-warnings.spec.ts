/**
 * E2E: the dev-only overflow guard (src/lib/overflow-guard.ts) must NOT
 * emit any `[overflow-guard]` warnings on /site, /login, or /dashboard
 * across mobile, tablet, and desktop breakpoints.
 *
 * The guard fires `console.warn("[overflow-guard] …")` when the document
 * is wider than the viewport or the window has been scrolled sideways.
 * We attach a `console` listener before navigation and fail the test if
 * any matching warning arrives.
 *
 * Dashboard requires a session; when `LOVABLE_BROWSER_SUPABASE_*` env
 * vars are absent that case is skipped rather than failed — mirroring
 * `tests/a11y/responsive-breakpoints.spec.ts`.
 *
 * Run:
 *   bunx playwright test tests/e2e/overflow-guard-no-warnings.spec.ts \
 *        --project=chromium-reduced-motion
 */
import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const HAS_SESSION = Boolean(STORAGE_KEY && SESSION_JSON);

type Device = "mobile" | "tablet" | "desktop";
const VIEWPORTS: Record<Device, { width: number; height: number }> = {
  mobile: { width: 375, height: 1200 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1440, height: 1400 },
};

type RouteCase = {
  name: string;
  path: string;
  requiresAuth: boolean;
  ready: (page: Page) => Promise<void>;
};
const ROUTES: RouteCase[] = [
  {
    name: "site",
    path: "/site",
    requiresAuth: false,
    ready: async (page) =>
      await expect(page.locator("header").first()).toBeVisible({ timeout: 10_000 }),
  },
  {
    name: "login",
    path: "/login",
    requiresAuth: false,
    ready: async (page) =>
      await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10_000 }),
  },
  {
    name: "dashboard",
    path: "/dashboard",
    requiresAuth: true,
    ready: async (page) => await expect(page.getByRole("main")).toBeVisible({ timeout: 15_000 }),
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

/** Collect every `[overflow-guard]` console.warn seen on the page. */
function collectOverflowWarnings(page: Page): string[] {
  const warnings: string[] = [];
  const listener = (msg: ConsoleMessage) => {
    if (msg.type() !== "warning") return;
    const text = msg.text();
    if (text.includes("[overflow-guard]")) warnings.push(text);
  };
  page.on("console", listener);
  return warnings;
}

/**
 * Nudge the page to trigger the guard's scroll listener. The guard reads
 * `scrollWidth` on every scroll/resize; scrolling then briefly waiting
 * lets any late-mounted content settle before we assert.
 */
async function settleAndProbe(page: Page) {
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(150);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(250);
}

for (const [device, viewport] of Object.entries(VIEWPORTS) as [
  Device,
  { width: number; height: number },
][]) {
  for (const route of ROUTES) {
    const title = `${route.name} @ ${device} emits no overflow-guard warnings`;
    test(title, async ({ browser }) => {
      test.skip(
        route.requiresAuth && !HAS_SESSION,
        "dashboard requires LOVABLE_BROWSER_SUPABASE_* session env",
      );

      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      try {
        // Attach listener BEFORE any navigation so we don't miss early warns.
        const warnings = collectOverflowWarnings(page);

        if (route.requiresAuth) {
          await seedSessionIfAvailable(page);
        }

        await page.goto(`${BASE}${route.path}`, { waitUntil: "domcontentloaded" });
        await route.ready(page);
        await settleAndProbe(page);

        expect(
          warnings,
          `[${route.name} @ ${device}] overflow-guard emitted warnings:\n${warnings.join("\n")}`,
        ).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
}
