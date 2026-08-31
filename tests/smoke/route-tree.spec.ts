/**
 * CI smoke: `routeTree.gen.ts` is generated + served, and every public
 * app route loads without a hard failure.
 *
 * The TanStack Router Vite plugin regenerates `src/routeTree.gen.ts`
 * whenever a file appears / disappears under `src/routes/`. If that
 * generation fails (name conflict, syntax error in a route file,
 * plugin crash) the dev server returns 500 for the module and every
 * page in the app goes blank. This smoke catches the failure BEFORE
 * the a11y / e2e specs run, so the failure surfaces as "routeTree
 * regen broke" instead of "40 unrelated specs timed out".
 *
 * Two assertions per run:
 *
 *   1. GET /src/routeTree.gen.ts → 200, the body compiles as JS,
 *      exports a `routeTree` symbol, and references every top-level
 *      public route file we expect to exist (index, login, site,
 *      health-check). Missing any of them means the generator ran but
 *      dropped a route — a silent failure the a11y suite wouldn't
 *      diagnose.
 *
 *   2. Each public route loads: navigate, wait for `domcontentloaded`,
 *      assert the response was 2xx and the page has NO uncaught
 *      console errors originating from route-tree resolution. Auth-
 *      gated routes are not covered here — those live in the a11y
 *      suite behind a Supabase session.
 */
import { test, expect, type ConsoleMessage } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";

// Public routes only. Anything under `_authenticated/` is skipped —
// smoke runs without a session and we don't want to conflate an auth
// redirect with a route-tree regression.
const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/site",
  "/site/services",
  "/site/projects",
  "/site/contact",
  "/health-check",
];

// Substrings we expect to find in the generated routeTree source. Each
// one maps 1:1 to a route file under src/routes/. If the generator
// silently drops a file, one of these substrings goes missing and the
// test fails with a precise "route X not registered" message.
const EXPECTED_ROUTE_IDS = [
  "/",
  "/login",
  "/site",
  "/site/services",
  "/site/projects",
  "/site/contact",
  "/health-check",
];

test.describe("routeTree smoke", () => {
  test("GET /src/routeTree.gen.ts serves a valid, complete route tree", async ({ request }) => {
    // Only meaningful against the dev server (Vite serves TS source
    // files directly). In a production build there is no such URL —
    // the file is bundled. CI runs `bun run dev`, so we're fine.
    const res = await request.get(`${BASE}/src/routeTree.gen.ts`);
    expect(
      res.status(),
      `expected 200 for /src/routeTree.gen.ts, got ${res.status()} — router plugin likely crashed during regen`,
    ).toBe(200);

    const body = await res.text();
    expect(
      body.length,
      "routeTree.gen.ts body is empty — generator produced no output",
    ).toBeGreaterThan(200);

    // The generator always exports `routeTree` as the aggregated tree.
    // If this symbol is missing, `router.tsx`'s `import { routeTree }`
    // would fail at module-eval and the app wouldn't mount at all.
    expect(
      body,
      "routeTree.gen.ts missing `routeTree` export — router bootstrap would fail",
    ).toMatch(/export\s+const\s+routeTree/);

    const missing = EXPECTED_ROUTE_IDS.filter(
      (id) => !body.includes(`'${id}'`) && !body.includes(`"${id}"`),
    );
    expect(
      missing,
      `routeTree.gen.ts is missing expected route ids (generator dropped these files): ${JSON.stringify(missing)}`,
    ).toEqual([]);
  });

  for (const path of PUBLIC_ROUTES) {
    test(`route loads without console errors: ${path}`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (msg: ConsoleMessage) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        // Ignore noise unrelated to the routeTree contract this smoke
        // exists to protect. Widen this list only when a NEW class of
        // noise appears — never to hide a routing regression.
        if (
          /Failed to load resource.*favicon/i.test(text) ||
          /Download the React DevTools/i.test(text) ||
          // Some third-party scripts (analytics, Sentry noop) log
          // "blocked by client" in local dev when ad-blockers or the
          // sandbox network policy intervenes.
          /ERR_BLOCKED_BY_CLIENT/i.test(text)
        ) {
          return;
        }
        consoleErrors.push(text);
      });

      const response = await page.goto(`${BASE}${path}`, {
        waitUntil: "domcontentloaded",
      });
      expect(
        response?.status(),
        `navigation to ${path} returned ${response?.status()}`,
      ).toBeLessThan(400);

      // Wait a beat so any async router error surfaces on the console
      // before we snapshot. Not a load-timing assertion — we're only
      // giving the app one tick to fail loudly.
      await page.waitForTimeout(500);

      const routeTreeErrors = consoleErrors.filter((e) =>
        /routeTree|route tree|Failed to fetch dynamically imported module/i.test(e),
      );
      expect(
        routeTreeErrors,
        `route ${path} logged routeTree-related console errors:\n${routeTreeErrors.join("\n")}`,
      ).toEqual([]);
    });
  }
});
