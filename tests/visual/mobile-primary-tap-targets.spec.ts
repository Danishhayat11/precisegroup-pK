import { expect, test, type Locator, type Page } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "./_authHelpers";
import { screenshotOptionsFor } from "./_thresholds";

/**
 * Primary mobile chrome — FAB + bottom-nav tab icons + per-card chat
 * button — tap-target size + pixel regression.
 *
 * Locks two things at once so a future CSS change (icon size shrink,
 * `size="icon"` swap without `min-h-11`, padding rewrite) can't silently
 * drop primary tap targets below WCAG 2.5.5's 44 × 44 CSS px floor:
 *
 *   1. Rendered size assertion — every primary tap target measures
 *      ≥ 44 × 44 CSS px at 375 / 390 / 412 px mobile widths. Runs the
 *      same rule as `scripts/ci/tap-target-audit.mjs`, but on the
 *      painted DOM instead of on source — catches regressions where
 *      an ancestor `transform: scale()`, `overflow: hidden`, or a
 *      flex-shrink misconfig collapses the box at runtime.
 *
 *   2. Pixel baseline — element screenshots per surface × per viewport,
 *      so a padding / icon-size drift shows up as a triptych diff even
 *      when the bounding box still clears 44 px.
 *
 * Runs only when the sandbox has an injected Lovable-managed Supabase
 * session — the `_authenticated` layout would otherwise redirect to
 * /auth and none of the mobile chrome would mount.
 */

const ROUTE = "/dashboard";
const HAS_AUTH = authAvailable();

// WCAG 2.5.5 minimum on touch viewports. All three mobile widths are
// touch-first, so there is no desktop relaxation here.
const MIN_TOUCH_PX = 44;

const VIEWPORTS = [
  { name: "iphone-se", width: 375, height: 812 },
  { name: "iphone-14", width: 390, height: 844 },
  { name: "pixel-7", width: 412, height: 915 },
] as const;

// Bottom-nav tab items, keyed by their accessible name. Kept in sync
// with `src/components/MobileBottomNav.tsx`.
const BOTTOM_NAV_TABS = ["Dashboard", "Bookings", "Payments", "Reports"] as const;

async function settle(page: Page) {
  await page.evaluate(() => document.fonts?.ready);
  // Small paint delay so hover / focus rings from prior navigation clear
  // and the fade-in-up main-content animation ends under reduced-motion.
  await page.waitForTimeout(200);
}

/**
 * Assert an element's laid-out box is at least `min × min` CSS px. We
 * measure `getBoundingClientRect()` rather than `boundingBox()` so a
 * zero-height wrapper (e.g. a `display:contents` parent) can't mask a
 * regression — the rect always reflects the painted geometry.
 */
async function expectMinSize(locator: Locator, min: number, label: string) {
  const rect = await locator.evaluate((el) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
  expect
    .soft(rect.height, `${label}: height ${rect.height}px must be ≥ ${min}px`)
    .toBeGreaterThanOrEqual(min);
  expect
    .soft(rect.width, `${label}: width ${rect.width}px must be ≥ ${min}px`)
    .toBeGreaterThanOrEqual(min);
}

test.describe("Mobile primary tap targets — FAB, bottom-nav, chat", () => {
  test.skip(
    !HAS_AUTH,
    "Requires an injected Lovable-managed Supabase session (LOVABLE_BROWSER_AUTH_STATUS=injected).",
  );

  for (const vp of VIEWPORTS) {
    test(`${vp.name} (${vp.width}×${vp.height}) — every primary control ≥ ${MIN_TOUCH_PX}px`, async ({
      context,
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await restoreSupabaseSession(context, page);
      await page.goto(ROUTE, { waitUntil: "domcontentloaded" });
      await expect(
        page.locator('[data-theme="ios"]').first(),
        "iOS-scoped shell should mount on /dashboard",
      ).toBeVisible();
      await settle(page);

      // --- FAB (fixed bottom-right, "New booking") -----------------------
      // Selector matches the `data-mobile-fab` marker + aria-label, so a
      // refactor that swaps <button> for <a> still resolves.
      const fab = page.locator("[data-mobile-fab]");
      await expect(fab, "MobileFab should render on /dashboard").toBeVisible();
      await expectMinSize(fab, MIN_TOUCH_PX, `${vp.name} fab`);
      const fabName = `mobile-fab-${vp.name}.png`;
      await expect(fab).toHaveScreenshot(fabName, screenshotOptionsFor(fabName));

      // --- Bottom-nav tab icons ------------------------------------------
      // Each tab has an aria-label matching its human label. The trailing
      // "Open navigation menu" hamburger is checked separately below.
      const bottomNav = page.locator("[data-mobile-bottom-nav]");
      await expect(bottomNav, "MobileBottomNav should render on mobile").toBeVisible();

      for (const label of BOTTOM_NAV_TABS) {
        const tab = bottomNav.getByRole("link", { name: label, exact: true });
        await expect(tab, `${label} tab should render`).toBeVisible();
        await expectMinSize(tab, MIN_TOUCH_PX, `${vp.name} tab:${label}`);
      }

      const menuTab = bottomNav.getByRole("button", { name: /open navigation menu/i });
      await expect(menuTab, "Menu hamburger tab should render").toBeVisible();
      await expectMinSize(menuTab, MIN_TOUCH_PX, `${vp.name} tab:menu`);

      const navName = `mobile-bottom-nav-${vp.name}.png`;
      await expect(bottomNav).toHaveScreenshot(navName, screenshotOptionsFor(navName));

      // --- Per-card chat / WhatsApp button (gated on presence) -----------
      // Bookings / Ledger cards surface a per-row chat icon. It only
      // renders when the account has at least one card, so we gate on
      // count > 0. When present, size + pixels must both hold — a
      // shrunk hit area here is the FAB-overlap bug we already fixed
      // and must never regress.
      const chat = page
        .getByRole("link", { name: /send whatsapp reminder|open chat|message client/i })
        .first();
      if (await chat.count().then((c) => c > 0)) {
        await chat.scrollIntoViewIfNeeded();
        await expectMinSize(chat, MIN_TOUCH_PX, `${vp.name} chat-button`);
        const chatName = `mobile-chat-button-${vp.name}.png`;
        await expect(chat).toHaveScreenshot(chatName, screenshotOptionsFor(chatName));
      }
    });
  }
});
