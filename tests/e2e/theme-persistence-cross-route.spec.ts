import { expect, test, type Page, type BrowserContext } from "@playwright/test";

/**
 * Persistence and theme-color hygiene across marketing + authenticated surfaces.
 *
 * Two things get regressed most often when new routes land:
 *   1. A route mounts its OWN <meta name="theme-color"> in addition to the
 *      root one, so users end up with duplicate meta tags and Safari picks
 *      the wrong color for the status bar.
 *   2. A route wraps content in a provider that resets or re-reads the
 *      persisted theme incorrectly, so a user who chose Dark on /site sees
 *      Light again after navigating to /contact or logging in.
 *
 * This spec walks the persisted-Dark state through:
 *   - /site (baseline where Dark was picked)
 *   - /site/contact (marketing leaf)
 *   - / (authenticated landing / dashboard, after Supabase session restore)
 *
 * On each stop it asserts:
 *   - `<html>` still has the `dark` class + `color-scheme: dark`
 *   - exactly one `<meta name="theme-color">` with the seeded DARK color
 *   - localStorage still holds `"dark"`
 */

const STORAGE_KEY = "precise.theme";
const DARK_COLOR = "#070B14";

type ThemeSnapshot = {
  hasDarkClass: boolean;
  colorScheme: string;
  themeColorCount: number;
  themeColorContent: string | null;
  stored: string | null;
};

async function readTheme(page: Page): Promise<ThemeSnapshot> {
  return page.evaluate(
    (key) => ({
      hasDarkClass: document.documentElement.classList.contains("dark"),
      colorScheme: document.documentElement.style.colorScheme,
      themeColorCount: document.head.querySelectorAll('meta[name="theme-color"]').length,
      themeColorContent:
        document.head.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? null,
      stored: window.localStorage.getItem(key),
    }),
    STORAGE_KEY,
  );
}

function expectDark(snap: ThemeSnapshot, where: string) {
  expect(snap.hasDarkClass, `<html class="dark"> on ${where}`).toBe(true);
  expect(snap.colorScheme, `color-scheme:dark on ${where}`).toBe("dark");
  expect(snap.themeColorCount, `exactly one theme-color meta on ${where}`).toBe(1);
  expect(snap.themeColorContent, `theme-color=DARK on ${where}`).toBe(DARK_COLOR);
  expect(snap.stored, `localStorage persists "dark" on ${where}`).toBe("dark");
}

/**
 * Seed `precise.theme=dark` in the localhost origin so the pre-hydration
 * script in __root.tsx picks Dark on the very first paint of every route
 * this test visits. Must run after a navigation to localhost (localStorage
 * is origin-scoped).
 */
async function seedDarkPersisted(page: Page) {
  await page.goto("/site", { waitUntil: "load" });
  await page.evaluate(([k]) => window.localStorage.setItem(k, "dark"), [STORAGE_KEY] as const);
  await page.reload({ waitUntil: "load" });
  await page.waitForLoadState("networkidle");
}

/**
 * Restore the Lovable-managed Supabase session for authenticated routes.
 * Env vars are injected by the sandbox when the user is signed in via the
 * preview (see `LOVABLE_BROWSER_AUTH_STATUS === "injected"`).
 */
async function restoreSupabaseSession(context: BrowserContext, page: Page) {
  const storageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
  const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
  const cookiesJson = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON;
  if (!storageKey || !sessionJson) return false;

  if (cookiesJson) {
    const cookies = (JSON.parse(cookiesJson) as Array<Record<string, unknown>>).map((c) => ({
      ...c,
      url: "http://localhost:8080",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any;
    await context.addCookies(cookies);
  }

  // Establish the localhost origin before writing to localStorage.
  await page.goto("http://localhost:8080/site", { waitUntil: "load" });
  await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
    storageKey,
    sessionJson,
  ] as const);
  return true;
}

test("dark theme persists across /site → /site/contact and remains a single theme-color meta", async ({
  browser,
}) => {
  const context = await browser.newContext({ colorScheme: "light" });
  try {
    const page = await context.newPage();
    await seedDarkPersisted(page);

    // /site — baseline. Seeded via the reload in seedDarkPersisted.
    expectDark(await readTheme(page), "/site");

    // /site/contact — cross-route client navigation on the same origin.
    await page.goto("/site/contact", { waitUntil: "load" });
    await page.waitForLoadState("networkidle");
    expectDark(await readTheme(page), "/site/contact");

    // A second hard reload on /contact must also come up in Dark (proves the
    // pre-hydration script rehydrates from localStorage on this route too).
    await page.reload({ waitUntil: "load" });
    await page.waitForLoadState("networkidle");
    expectDark(await readTheme(page), "/site/contact (after reload)");
  } finally {
    await context.close();
  }
});

test("dark theme persists into the authenticated landing page after Supabase session restore", async ({
  browser,
}) => {
  test.skip(
    process.env.LOVABLE_BROWSER_AUTH_STATUS !== "injected",
    `Auth status "${process.env.LOVABLE_BROWSER_AUTH_STATUS ?? "unset"}" — no managed Supabase session available to restore.`,
  );

  const context = await browser.newContext({ colorScheme: "light" });
  try {
    const page = await context.newPage();

    // Restore session BEFORE seeding theme so subsequent navigations to
    // protected routes don't bounce us to /login (which would reset the
    // origin's localStorage view for the pre-hydration script).
    const restored = await restoreSupabaseSession(context, page);
    expect(restored, "Supabase session env vars must be present").toBe(true);

    // Seed dark on the same localhost origin.
    await page.evaluate(([k]) => window.localStorage.setItem(k, "dark"), [STORAGE_KEY] as const);
    await page.reload({ waitUntil: "load" });
    await page.waitForLoadState("networkidle");
    expectDark(await readTheme(page), "/site (authenticated, seeded dark)");

    // Navigate to the authenticated landing (`/` is under _authenticated).
    await page.goto("/", { waitUntil: "load" });
    await page.waitForLoadState("networkidle");

    // Guard: if the auth gate bounced us to /login, the session restore
    // silently failed — fail loudly so the "persistence" claim below means
    // something.
    expect(new URL(page.url()).pathname, "must land on authenticated /, not /login").not.toBe(
      "/login",
    );

    expectDark(await readTheme(page), "authenticated / (dashboard)");

    // Hard reload while authenticated — proves rehydration on this surface.
    await page.reload({ waitUntil: "load" });
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).pathname).not.toBe("/login");
    expectDark(await readTheme(page), "authenticated / (after reload)");
  } finally {
    await context.close();
  }
});
