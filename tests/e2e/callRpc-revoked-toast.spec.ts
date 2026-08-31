/**
 * End-to-end: a revoked-RPC response is normalized into `RpcAuthorizationError`
 * by `callRpc`, surfaced by the global QueryClient error handler as a sonner
 * toast with the exact user-facing message, and NOT retried by TanStack Query.
 *
 * Route under test: `/admin/ssr-monitor` — mounted `useQuery` calls
 * `callRpc("get_ssr_error_stats")` on mount and rethrows on error, so a 42501
 * response is the shortest possible path from "revoked RPC" → toast.
 *
 * What we assert:
 *   1. A sonner toast appears whose description is the VERBATIM message
 *      thrown by `RpcAuthorizationError` (locked so a copy tweak is caught
 *      in review).
 *   2. The RPC endpoint is invoked exactly once — retries are disabled for
 *      auth failures by `createQueryClientWithAccessHandler`. If the retry
 *      guard regresses, the counter goes above 1 and the test fails.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

const RPC_NAME = "get_ssr_error_stats";

// Verbatim copy from `RpcAuthorizationError#message` in
// src/integrations/supabase/approvedRpc.ts. Any wording change must update
// both places together — the toast is user-visible and shipped copy.
const EXPECTED_MESSAGE =
  `You are not authorized to perform this action (${RPC_NAME}). ` +
  `If you believe this is a mistake, contact an administrator.`;

const FAKE_USER = {
  id: "00000000-0000-4000-8000-000000000042",
  aud: "authenticated",
  role: "authenticated",
  email: "e2e-admin@example.com",
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

const PROJECT_ID = process.env.VITE_SUPABASE_PROJECT_ID ?? "omxephqkcxynzxekywhn";
const STORAGE_KEY = `sb-${PROJECT_ID}-auth-token`;

/** Count of hits to the RPC endpoint — asserted at end to prove no retry. */
type Counter = { hits: number };

async function installMocks(page: Page, counter: Counter) {
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
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  // NOTE on ordering: Playwright checks routes in REVERSE registration order
  // (last registered wins). Register the broadest catch-all FIRST so the
  // specific routes below it take precedence.
  await page.route("**/rest/v1/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );

  // Grant admin so the page renders past its "Admin only" alert and mounts
  // the useQuery that calls the RPC.
  await page.route("**/rest/v1/user_roles*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ role: "admin" }]),
    }),
  );
  await page.route("**/rest/v1/profiles*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: FAKE_USER.id, company_id: null }),
    }),
  );

  // The RPC under test — return a Postgres 42501 (insufficient_privilege) so
  // `isRevokedRpcError` classifies it as an auth denial and `callRpc` swaps
  // it out for `RpcAuthorizationError`. Registered LAST so it wins over the
  // `/rest/v1/**` catch-all above.
  await page.route(`**/rest/v1/rpc/${RPC_NAME}*`, (route) => {
    counter.hits += 1;
    return route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        code: "42501",
        message: `permission denied for function ${RPC_NAME}`,
        details: null,
        hint: null,
      }),
    });
  });

  // TanStack server fns aren't exercised by this route, but silence them
  // defensively so nothing else can pollute the "hits" count.
  const okEmpty = (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  await page.route("**/_serverFn**", okEmpty);
  await page.route("**/_server-fns**", okEmpty);
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

test.describe("callRpc revoked-RPC → global toast", () => {
  test("shows the exact RpcAuthorizationError copy and does not retry", async ({ page }) => {
    const counter: Counter = { hits: 0 };
    await installMocks(page, counter);
    await seedSession(page);

    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await page.goto("/admin/ssr-monitor", { waitUntil: "domcontentloaded" });

    // Sonner renders each toast as a `[data-sonner-toast]` element. Assert
    // by that stable data-attr rather than by role — sonner has flipped
    // between `role="status"` and `role="listitem"` across versions.
    const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Not authorized" }).first();
    await expect(toast, "sonner auth toast is visible").toBeVisible({ timeout: 10_000 });
    await expect(toast, "toast shows the verbatim RpcAuthorizationError message").toContainText(
      EXPECTED_MESSAGE,
    );

    // Give TanStack Query a full stale window in which it COULD retry (the
    // handler disables retries for auth errors). If retry were still on the
    // default 2-with-backoff, we'd see 2-3 hits well under this budget.
    await page.waitForTimeout(2500);
    expect(counter.hits, "RPC endpoint called exactly once — retries disabled").toBe(1);

    // We only guard against UNCAUGHT exceptions here. The browser will log
    // a 403 in the network tab and TanStack Query will report the classified
    // error to its onError handler — both are expected side effects, not
    // regressions. A truly unhandled render error would surface via
    // `pageerror`.
    expect(pageErrors, `uncaught errors: ${pageErrors.join(" | ")}`).toEqual([]);
  });
});
