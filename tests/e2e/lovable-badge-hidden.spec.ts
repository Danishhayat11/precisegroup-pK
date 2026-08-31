/**
 * Verifies the Lovable branding widget is fully suppressed on every public
 * route. The badge is injected by the Lovable runtime on published
 * deployments as `#lovable-badge` (a container holding the "Made with
 * Lovable" text AND a floating close X button). We hide it globally via a
 * CSS override in `src/styles.css`; this test guards that override so a
 * future refactor can't reintroduce an orphaned X or empty container.
 *
 * Contract per route:
 *   1. Either the `#lovable-badge` node is not attached, OR it exists but
 *      is not visible AND has zero interactive area (no orphaned X).
 *   2. No descendant of the badge (text node, button, svg) is visible.
 *
 * Runs against the local dev server; the badge is only actually injected
 * on published deployments, so on localhost condition (1) is normally
 * "not attached" — which is still a pass. The value of the test is
 * defense-in-depth: if the badge ever ships to the preview build (e.g.
 * a hosting-side change) it must remain invisible.
 */
import { test, expect, Page } from "@playwright/test";

const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/signup",
  "/site",
  "/site/services",
  "/resources/property-management-vs-erp",
] as const;

async function assertBadgeHidden(page: Page, route: string) {
  // Respect the environment toggle: if the override is turned OFF for this
  // env, the badge is *expected* to be visible when injected, so the test
  // is not applicable. RootShell mirrors VITE_HIDE_LOVABLE_BADGE into the
  // `data-hide-lovable-badge` attribute on <html> so we can read it here
  // without importing Vite env into the test bundle.
  const overrideEnabled = await page.locator("html").getAttribute("data-hide-lovable-badge");
  test.skip(
    overrideEnabled === "false",
    `VITE_HIDE_LOVABLE_BADGE=false on ${route}; override intentionally disabled`,
  );

  const badge = page.locator("#lovable-badge");
  const count = await badge.count();

  if (count === 0) {
    // Not injected on this build — trivially hidden.
    return;
  }

  // If present, the container itself must not be visible.
  await expect(badge, `#lovable-badge is visible on ${route}`).toBeHidden();

  // And it must have zero interactive area — this catches the "empty box"
  // / "orphaned close X" regressions specifically.
  const box = await badge.boundingBox();
  expect(box, `#lovable-badge has a bounding box on ${route}: ${JSON.stringify(box)}`).toBeNull();

  // Every descendant (text, button, svg, X icon) must also be hidden.
  const descendants = badge.locator("*");
  const descendantCount = await descendants.count();
  for (let i = 0; i < descendantCount; i++) {
    const child = descendants.nth(i);
    await expect(
      child,
      `A child of #lovable-badge is visible on ${route} (index ${i})`,
    ).toBeHidden();
  }
}

test.describe("Lovable badge is hidden on every page", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`route ${route}`, async ({ page }) => {
      const resp = await page.goto(route, { waitUntil: "domcontentloaded" });
      // Some routes may 404 in certain envs — skip rather than false-fail;
      // the badge test only makes sense on a route that actually rendered.
      test.skip(!resp || resp.status() >= 400, `route ${route} returned ${resp?.status()}`);

      // Give the runtime a beat to inject any late-mounted badge.
      await page.waitForLoadState("networkidle").catch(() => {});
      await assertBadgeHidden(page, route);
    });
  }
});
