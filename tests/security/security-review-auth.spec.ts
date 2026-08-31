/**
 * End-to-end regression tests for the /security-review route auth gating.
 *
 * Verifies:
 *   - Unauthenticated visitors are redirected to /login (route lives under
 *     the `_authenticated` layout).
 *   - The public path `/security-review` no longer exists as a top-level
 *     route (it now lives at `/_authenticated/security-review`).
 *   - An authenticated admin session renders the Issues review panel.
 *
 * The admin-path check is skipped unless the sandbox has injected a valid
 * managed Supabase session for an admin user via the standard
 * LOVABLE_BROWSER_SUPABASE_* env vars.
 *
 * Run:
 *   bunx playwright test tests/security/security-review-auth.spec.ts
 */
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.SECURITY_REVIEW_BASE_URL ?? "http://localhost:8080";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON;
const AUTH_STATUS = process.env.LOVABLE_BROWSER_AUTH_STATUS ?? "";

async function restoreSupabaseSession(
  context: import("@playwright/test").BrowserContext,
  page: import("@playwright/test").Page,
) {
  if (COOKIES_JSON) {
    const cookies = JSON.parse(COOKIES_JSON) as Array<Record<string, unknown>>;
    for (const c of cookies) {
      (c as any).url = BASE_URL;
    }
    await context.addCookies(cookies as any);
  }
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  if (STORAGE_KEY && SESSION_JSON) {
    await page.evaluate(
      ([k, v]) => window.localStorage.setItem(k as string, v as string),
      [STORAGE_KEY, SESSION_JSON],
    );
  }
}

test.describe("/security-review auth gating", () => {
  test.describe.configure({
    retries: process.env.CI ? 2 : 0,
    timeout: 60_000,
  });

  test("SEC-SR-001: unauthenticated visit is redirected away from /security-review", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    // Ensure no session is present.
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.localStorage.clear());
    await context.clearCookies();

    // Navigate to the (now-protected) path and wait for the router to settle.
    await page.goto(`${BASE_URL}/security-review`, { waitUntil: "domcontentloaded" });
    // Give client-side auth guard a moment to redirect.
    await page
      .waitForURL((u) => !u.toString().endsWith("/security-review"), {
        timeout: 10_000,
      })
      .catch(() => {});

    const finalUrl = page.url();
    // Must NOT stay on /security-review as a signed-out user.
    expect(finalUrl, `finalUrl=${finalUrl}`).not.toMatch(/\/security-review(\?|#|$)/);
    // Should end up on /login (route guard sends unauthenticated users there).
    expect(finalUrl).toMatch(/\/login(\?|#|$)/);

    // Sanity: page must not render the admin panel heading.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/Issues review/i);

    await context.close();
  });

  test("SEC-SR-002: public top-level /security-review route file has been removed", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const publicPath = path.resolve(process.cwd(), "src/routes/security-review.tsx");
    const gatedPath = path.resolve(process.cwd(), "src/routes/_authenticated/security-review.tsx");
    expect(fs.existsSync(publicPath), "public /security-review route must not exist").toBe(false);
    expect(fs.existsSync(gatedPath), "gated /_authenticated/security-review route must exist").toBe(
      true,
    );
    const gated = fs.readFileSync(gatedPath, "utf8");
    expect(gated, "route must be under the _authenticated layout").toMatch(
      /createFileRoute\(["']\/_authenticated\/security-review["']\)/,
    );
    expect(gated, "route must gate on isAdmin").toMatch(/isAdmin/);
    expect(gated, "route must render AdminRequiredMessage for non-admins").toMatch(
      /AdminRequiredMessage/,
    );
  });

  test("SEC-SR-003: authenticated admin session renders the Issues review panel", async ({
    browser,
  }) => {
    test.skip(
      AUTH_STATUS !== "injected" || !SESSION_JSON || !STORAGE_KEY,
      `No managed admin Supabase session available (LOVABLE_BROWSER_AUTH_STATUS="${AUTH_STATUS}")`,
    );

    const context = await browser.newContext();
    const page = await context.newPage();
    await restoreSupabaseSession(context, page);

    await page.goto(`${BASE_URL}/security-review`, { waitUntil: "domcontentloaded" });
    // Wait for either the review panel OR a redirect back to /login.
    await page
      .waitForFunction(
        () =>
          document.body.innerText.includes("Issues review") ||
          location.pathname.startsWith("/login"),
        undefined,
        { timeout: 15_000 },
      )
      .catch(() => {});

    const finalUrl = page.url();
    expect(finalUrl, `finalUrl=${finalUrl}`).toMatch(/\/security-review/);
    const bodyText = await page.locator("body").innerText();
    // Admin panel heading is present …
    expect(bodyText).toMatch(/Issues review/i);
    // …and the non-admin restricted-area message is NOT.
    expect(bodyText).not.toMatch(/Admin access required/i);

    await context.close();
  });
});
