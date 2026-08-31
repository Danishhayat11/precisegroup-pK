import type { BrowserContext, Page } from "@playwright/test";

/**
 * Restore the Lovable-managed Supabase session into the Playwright context
 * so authenticated routes render without a login redirect.
 *
 * The Lovable sandbox mints a real session and exposes it via env vars when
 * `LOVABLE_BROWSER_AUTH_STATUS === 'injected'`:
 *   - LOVABLE_BROWSER_SUPABASE_STORAGE_KEY  (e.g. sb-<ref>-auth-token)
 *   - LOVABLE_BROWSER_SUPABASE_SESSION_JSON (full session JSON)
 *   - LOVABLE_BROWSER_SUPABASE_COOKIES_JSON (@supabase/ssr cookies array)
 *
 * We install BOTH: cookies (for @supabase/ssr) and localStorage (for the
 * classic @supabase/supabase-js client) so the correct storage is present
 * regardless of which client the app uses.
 *
 * Test files should call `authAvailable()` and `test.skip(!auth, …)` first
 * so the suite gracefully no-ops on external / signed-out projects.
 */

export function authAvailable(): boolean {
  return (
    process.env.LOVABLE_BROWSER_AUTH_STATUS === "injected" &&
    !!process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON &&
    !!process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY
  );
}

export async function restoreSupabaseSession(
  context: BrowserContext,
  page: Page,
  origin = "http://localhost:8080",
) {
  const storageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY!;
  const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON!;
  const cookiesJson = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON;

  // SSR path: cookie-based session used by @supabase/ssr.
  if (cookiesJson) {
    try {
      const cookies = JSON.parse(cookiesJson) as Array<Record<string, unknown>>;
      await context.addCookies(
        cookies.map(
          (c) => ({ ...c, url: origin }) as Parameters<BrowserContext["addCookies"]>[0][number],
        ),
      );
    } catch {
      /* malformed cookies JSON — fall through to localStorage-only path */
    }
  }

  // Establish the origin so the localStorage write lands there. Use
  // `domcontentloaded` (not `networkidle`) — the app makes long-lived
  // subscriptions that never idle.
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([k, v]) => {
      try {
        window.localStorage.setItem(k, v);
      } catch {
        /* storage unavailable */
      }
    },
    [storageKey, sessionJson],
  );
}
