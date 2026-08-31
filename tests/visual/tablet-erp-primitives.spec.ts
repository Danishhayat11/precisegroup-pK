import { expect, test, type Page } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "./_authHelpers";
import { screenshotOptionsFor } from "./_thresholds";

/**
 * ERP tablet visual coverage — iPad breakpoints for the authenticated
 * primary surfaces (Dashboard, Bookings, Payments, Ledger).
 *
 * Complements:
 *   • `tablet-layout-alignment.spec.ts` — locks PUBLIC surfaces
 *     (breadcrumb overflow, /login form) at a single 820×1180 width.
 *   • `mobile-primitives.spec.ts` — locks the ERP mobile chrome at
 *     phone widths.
 *   • `mobile-primary-tap-targets.spec.ts` — locks phone FAB / bottom-nav
 *     hit areas.
 *
 * This spec fills the gap in between: the tablet widths where the
 * AppShell has already promoted to the DESKTOP layout (persistent
 * sidebar at `md:flex`, no bottom-nav / no FAB) but the horizontal
 * budget is narrower than a laptop. Regressions that only appear at
 * tablet width — collapsed sidebar clipping the main content, table
 * columns overflowing to a horizontal scroll, top-chrome breadcrumbs
 * wrapping — are invisible to both the phone and desktop suites.
 *
 * Breakpoints (portrait + one landscape; deviceScaleFactor stays at 1
 * from playwright.config to keep baseline bytes identical across runners):
 *   • iPad mini 6            768 × 1024   — the `md` boundary; sidebar
 *                                            just appeared, breadcrumbs
 *                                            just gained space.
 *   • iPad 10.9"             820 × 1180   — matches the existing
 *                                            tablet suite for cross-check.
 *   • iPad Pro 11" portrait  834 × 1194   — Apple's default tablet layout.
 *   • iPad Pro 11" landscape 1194 × 834   — first width where the sidebar
 *                                            defaults to expanded (>= lg).
 *
 * Auth-gated: the `_authenticated` layout would otherwise redirect the
 * tested routes to /auth and every locator would resolve to the auth
 * page instead of the ERP shell.
 */

const HAS_AUTH = authAvailable();

const BREAKPOINTS = [
  { name: "ipad-mini", width: 768, height: 1024 },
  { name: "ipad-10-9", width: 820, height: 1180 },
  { name: "ipad-pro-11-portrait", width: 834, height: 1194 },
  { name: "ipad-pro-11-landscape", width: 1194, height: 834 },
] as const;

// One representative route per primary ERP surface. Kept small on purpose:
// every added route × every breakpoint is one more snapshot to review.
const SURFACES = [
  { name: "dashboard", path: "/dashboard", waitFor: "[data-app-shell]" },
  { name: "bookings", path: "/bookings", waitFor: "main" },
  { name: "payments", path: "/payments", waitFor: "main" },
  { name: "ledger", path: "/ledger", waitFor: "main" },
] as const;

async function settle(page: Page) {
  await page.evaluate(() => document.fonts?.ready);
  // Give the sidebar collapse-persistence read + fade-in-up main-content
  // animation time to end under reduced-motion. 250ms is empirically the
  // shortest interval that eliminates flake on the CI runner.
  await page.waitForTimeout(250);
}

test.describe("ERP tablet primitives — iPad breakpoints", () => {
  test.skip(
    !HAS_AUTH,
    "Requires an injected Lovable-managed Supabase session (LOVABLE_BROWSER_AUTH_STATUS=injected).",
  );

  for (const vp of BREAKPOINTS) {
    for (const surface of SURFACES) {
      test(`${surface.name} @ ${vp.name} (${vp.width}×${vp.height})`, async ({ context, page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await restoreSupabaseSession(context, page);
        await page.goto(surface.path, { waitUntil: "domcontentloaded" });
        await expect(
          page.locator('[data-theme="ios"]').first(),
          "iOS-scoped shell should mount",
        ).toBeVisible();
        await expect(page.locator(surface.waitFor).first()).toBeVisible();
        await settle(page);

        // No horizontal scroll at ANY tablet width — the most common
        // tablet regression is a fixed-width chart / table that overflows
        // its container. Assert BEFORE the pixel snapshot so a clear
        // failure message beats a mystery diff.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect
          .soft(overflow, `${surface.name} @ ${vp.name}: no horizontal overflow`)
          .toBeLessThanOrEqual(0);

        // Sidebar MUST be present on every iPad breakpoint — its
        // visibility rule is `hidden md:flex`, so any width ≥ 768 must
        // render it. A regression that pushes it to `lg:flex` would
        // silently hide primary nav on iPad portrait.
        await expect(
          page.locator("nav[data-app-sidebar], aside[data-app-sidebar]").first(),
          "Sidebar must render at iPad width (>= md)",
        ).toBeVisible();

        // Mobile-only chrome MUST NOT render at iPad width — a `md:hidden`
        // regression would double-stack a FAB over the sidebar.
        await expect(
          page.locator("[data-mobile-fab]"),
          "MobileFab must be hidden at iPad width",
        ).toHaveCount(0);
        await expect(
          page.locator("[data-mobile-bottom-nav]"),
          "MobileBottomNav must be hidden at iPad width",
        ).toHaveCount(0);

        // Pixel baseline. First run under `--update-snapshots` creates
        // `tablet-erp-<surface>-<breakpoint>.png` under
        // `tests/visual/tablet-erp-primitives.spec.ts-snapshots/`.
        const shot = `tablet-erp-${surface.name}-${vp.name}.png`;
        await expect(page).toHaveScreenshot(shot, {
          fullPage: false,
          ...screenshotOptionsFor(shot),
        });
      });
    }
  }
});
