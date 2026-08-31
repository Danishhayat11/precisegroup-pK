/**
 * Reports routes — mounted-with-content assertions.
 *
 * Verifies each `/reports/*` route renders past the `_authenticated` gate
 * and mounts its report component (heading + summary cards or placeholder
 * body). Both auth (`/auth/v1/*`) and the app's TanStack server-fn calls
 * (`/_serverFn/*`) are mocked so the specs don't depend on a live Supabase
 * or on network reachability inside CI sandboxes — they assert visible
 * report content, not just "no crash".
 *
 * How the mocks compose:
 *
 *   • `page.route('**\/auth/v1/**')` returns a valid session/user JSON so
 *     `_authenticated/route.tsx`'s `supabase.auth.getUser()` resolves and
 *     the child <Outlet /> mounts.
 *   • `page.route('**\/_serverFn/**')` returns `[]` for every server
 *     function so `listOverdueInstallments` / `listPaymentCollections`
 *     resolve with no rows — the components render their empty state,
 *     which still shows the CardTitle heading we assert against.
 *   • The `sb-<project>-auth-token` localStorage entry is seeded before
 *     the first navigation so the Supabase client boots into a signed-in
 *     state without needing the OAuth broker.
 */

import { expect, test, type Page, type Route } from "@playwright/test";

const FAKE_USER = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "e2e@example.com",
  app_metadata: { provider: "email" },
  user_metadata: {},
};

const FAKE_SESSION = {
  access_token: "e2e-access-token",
  refresh_token: "e2e-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: FAKE_USER,
};

// storageKey for `https://<project>.supabase.co` is `sb-<project>-auth-token`.
// Derive it from the same VITE_ env the app reads so the spec doesn't drift
// if the project ref rotates.
const PROJECT_ID = process.env.VITE_SUPABASE_PROJECT_ID ?? "omxephqkcxynzxekywhn";
const STORAGE_KEY = `sb-${PROJECT_ID}-auth-token`;

const REPORTS = [
  { path: "/reports/overdue", label: /Overdue Installments/i },
  { path: "/reports/payments", label: /Payment Collections?/i },
  { path: "/reports/adjustments", label: /Adjustment Register/i },
  { path: "/reports/bookings", label: /Booking Summary/i },
  { path: "/reports/cashflow", label: /Cash Flow Summary/i },
  { path: "/reports/outstanding", label: /Outstanding Balance/i },
] as const;

async function installMocks(page: Page) {
  // Supabase Auth — every request looks signed-in.
  await page.route("**/auth/v1/**", (route: Route) => {
    const url = route.request().url();
    if (url.includes("/auth/v1/user")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FAKE_USER),
      });
    }
    if (url.includes("/auth/v1/token")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FAKE_SESSION),
      });
    }
    // logout, settings, etc. — return an empty 200 rather than 404.
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  // TanStack server-fn endpoint — return an empty array for every read.
  // Covers both the current /_serverFn/* path and any future /_server-fns/*
  // variant the framework may emit.
  const serverFn = (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  await page.route("**/_serverFn**", serverFn);
  await page.route("**/_server-fns**", serverFn);

  // Silence any other Supabase REST/Realtime attempt (e.g. profiles read).
  await page.route("**/rest/v1/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    }),
  );
}

async function seedSession(page: Page) {
  await page.addInitScript(
    ({ key, value }) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* first-load storage may be blocked; ignore */
      }
    },
    { key: STORAGE_KEY, value: JSON.stringify(FAKE_SESSION) },
  );
}

test.describe("Reports routes — signed-in render", () => {
  test.beforeEach(async ({ page }) => {
    await installMocks(page);
    await seedSession(page);
  });

  for (const { path, label } of REPORTS) {
    test(`${path} mounts with visible report content`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(String(e)));

      const response = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(response?.status(), `HTTP status for ${path}`).toBeLessThan(400);

      await page.waitForLoadState("networkidle").catch(() => {
        /* networkidle is best-effort — assertions below are the real check */
      });

      // 1. Route did not redirect to /auth.
      expect(page.url(), `${path} should not redirect to /auth`).not.toMatch(/\/auth(\?|$)/);

      // 2. Report region for THIS route is present — the wrapper's
      //    aria-label is stable across loading / empty / error / data
      //    states and is unique per report, so it proves the right
      //    component (not just any wrapper) mounted.
      const region = page.getByRole("region", { name: label });
      await expect(region, `report region matching ${label} on ${path}`).toBeVisible({
        timeout: 10_000,
      });

      // 3. Region has non-empty rendered content — guards against an
      //    accidental empty section element being counted as "mounted".
      const textLength = ((await region.textContent()) ?? "").trim().length;
      expect(textLength, `report region on ${path} has visible text`).toBeGreaterThan(0);

      // 4. No uncaught page errors during the run.
      expect(pageErrors, `uncaught errors on ${path}: ${pageErrors.join(" | ")}`).toEqual([]);
    });
  }
});
