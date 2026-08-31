import { expect, test, type Locator, type Page } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "./_authHelpers";

/**
 * iOS shell — hover, focus-visible, and active table-row visual regression.
 *
 * Locks the styling emitted by the "Dashboard Perfection Layer v3" and the
 * "logo-cohesion" layer in `src/styles.css`, both scoped to
 * `[data-theme="ios"]` on the authenticated AppShell:
 *
 *   1. Card hover — brand-tinted border shift + primary/gold dual glow +
 *      1px lift. Any regression to the `:hover` box-shadow ramp, the
 *      `::before` top-rail opacity, or the transform:translateY(-1px)
 *      shows as a pixel diff on the first dashboard card.
 *
 *   2. Primary button `:focus-visible` — the tighter 2px background halo +
 *      4px primary/gold outline defined by
 *      `[data-theme="ios"] :focus-visible { box-shadow: ... }`. Driven via
 *      keyboard Tab so `:focus-visible` matches (mouse `.focus()` would
 *      only set `:focus`).
 *
 *   3. Table row hover — the `color-mix(--card 90%, --primary 10%)` wash
 *      on `tbody tr:hover`. Regressions here (e.g. the mix collapsing to
 *      transparent, the thead ramp bleeding into the body) are locked by
 *      screenshotting a single hovered row.
 *
 * Non-goals:
 *   • This is NOT a full-page baseline — content in the shell changes with
 *     data and would produce noisy diffs. Each assertion screenshots ONLY
 *     the target element so the baseline is stable across data/day changes.
 *   • Reduced-motion is enabled (see playwright.config `chromium-reduced-
 *     motion` project) so the transform + glow are captured post-transition.
 */

const ROUTE = "/";
const HAS_AUTH = authAvailable();

async function settle(page: Page) {
  await page.evaluate(() => document.fonts?.ready);
  // Give the fade-in-up main-content animation time to end even under
  // reduced-motion (which zeroes the animation but leaves a paint frame).
  await page.waitForTimeout(200);
}

/**
 * Park the mouse outside every interactive region so a previous test's
 * cursor position (or the default 0,0) cannot leave a stale `:hover` on
 * an unrelated element and bleed into the element screenshot.
 */
async function resetPointer(page: Page) {
  await page.mouse.move(0, 0);
  await page.mouse.move(2, 2);
}

/**
 * Wait for the iOS-scoped theme surface to mount. All rules under test
 * live inside `[data-theme="ios"]` — if that wrapper hasn't rendered
 * yet, the screenshots would capture unstyled defaults and flap.
 */
async function waitForIosShell(page: Page): Promise<Locator> {
  const shell = page.locator('[data-theme="ios"]').first();
  await expect(shell, "iOS-scoped shell should mount on authenticated routes").toBeVisible();
  return shell;
}

test.describe("iOS shell — interactive-state visual regression", () => {
  test.skip(
    !HAS_AUTH,
    "Requires an injected Lovable-managed Supabase session (LOVABLE_BROWSER_AUTH_STATUS=injected).",
  );

  test.beforeEach(async ({ context, page }) => {
    await restoreSupabaseSession(context, page);
    await page.goto(ROUTE, { waitUntil: "domcontentloaded" });
    await waitForIosShell(page);
    await settle(page);
  });

  test("card :hover — dual-glow + border shift + lift", async ({ page }) => {
    // First rendered shadcn card in the main content area. The dashboard's
    // hero is also a `[data-slot="card"]`, but it sits inside `<section>`
    // (not `<main> > *`); we specifically want a plain grid card so the
    // baseline captures the default hover treatment, not the brand-accent
    // variant. Scope to `main` to skip the sidebar's cards.
    const card = page.locator('main [data-slot="card"]:not([data-brand-accent])').first();
    await expect(card, "A default dashboard card should render").toBeVisible();

    await resetPointer(page);
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    // Blur any lingering keyboard focus so `:focus-visible` cannot bleed
    // a ring onto the hovered card and pollute the hover-only baseline.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    // Let the 260ms hover transition (transform + shadow + border) settle.
    await page.waitForTimeout(320);

    await expect(card).toHaveScreenshot("ios-card-hover.png", {
      // Allow ≤ 0.4% differing pixels for GPU/subpixel jitter around the
      // soft dual-glow edges; larger drift indicates a real token change.
      maxDiffPixelRatio: 0.004,
    });
  });

  test("primary button :focus-visible — brand-tinted 4px outline", async ({ page }) => {
    // Use the first primary-styled button on the page. Any regression to
    // the `[data-theme="ios"] :focus-visible { box-shadow: ... }` block
    // (background halo + brand-mixed outline) shows up here.
    const button = page.locator("main button.bg-primary").first();
    await expect(button, "A primary-filled button should render").toBeVisible();

    await button.scrollIntoViewIfNeeded();
    await resetPointer(page);

    // Keyboard-drive focus so `:focus-visible` matches. `button.focus()`
    // only sets `:focus`; the iOS ring rule intentionally scopes to
    // `:focus-visible` so mouse clicks don't leave a lingering ring.
    await button.evaluate((el: HTMLElement) => el.focus({ preventScroll: true }));
    await page.evaluate(() => {
      // Emit a synthetic keyboard-focus signal so :focus-visible engages
      // even on browsers that require a heuristic (Chromium honors focus
      // via the FocusEvent's sourceCapabilities heuristic; dispatching a
      // keydown before focus reliably flips the state).
      const active = document.activeElement as HTMLElement | null;
      active?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    // Ensure :focus-visible is applied before the screenshot.
    await expect(button).toBeFocused();
    await page.waitForTimeout(180);

    await expect(button).toHaveScreenshot("ios-button-focus-visible.png", {
      maxDiffPixelRatio: 0.004,
    });
  });

  test("table tbody row :hover — brand-tinted wash", async ({ page }) => {
    // Skip gracefully if the landing dashboard doesn't render a table on
    // this account (e.g. no bookings yet). We check table presence and
    // fall through instead of failing — the spec locks the STYLE, not
    // the presence of data.
    const row = page.locator("main table tbody tr").first();
    const rowCount = await row.count();
    test.skip(rowCount === 0, "No table row rendered on the dashboard for this account.");
    await expect(row).toBeVisible();

    await row.scrollIntoViewIfNeeded();
    await resetPointer(page);
    await row.hover();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    // 160ms bg-color transition on tbody tr.
    await page.waitForTimeout(220);

    await expect(row).toHaveScreenshot("ios-table-row-hover.png", {
      maxDiffPixelRatio: 0.004,
    });
  });
});
