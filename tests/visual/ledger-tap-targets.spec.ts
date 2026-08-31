import { expect, test, type Locator, type Page } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "./_authHelpers";

/**
 * Ledger — button tap-target visual + size regression.
 *
 * Locks two things at once so a future CSS change can't silently shrink
 * touch targets:
 *
 *   1. Rendered size assertion — the "Filter by Booking" combobox and any
 *      per-row WhatsApp reminder button MUST measure ≥ 44×44 CSS px on
 *      mobile / tablet (WCAG 2.5.5) and are allowed to compact to ≥ 32 px
 *      on desktop where pointer precision makes the small size acceptable.
 *      This is the same rule the static `tap-target-audit.mjs` gate
 *      enforces on source; here we verify the runtime paint matches.
 *
 *   2. Pixel baseline — element screenshots per viewport, so any regression
 *      to padding, border, or icon size on the Ledger controls shows up
 *      as a diff instead of only a size drift.
 *
 * Runs only when the sandbox has an injected Supabase session — the
 * `_authenticated` layout would otherwise redirect to /auth and the
 * page-scoped locators would never resolve.
 */

const ROUTE = "/ledger";
const HAS_AUTH = authAvailable();

// WCAG 2.5.5 minimum on touch viewports. Desktop is allowed to relax to
// the shadcn compact size (36 px "sm"), floored at 32 to leave room for
// the outline variant's border box.
const MIN_TOUCH_PX = 44;
const MIN_DESKTOP_PX = 32;

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, min: MIN_TOUCH_PX },
  { name: "tablet", width: 820, height: 1180, min: MIN_TOUCH_PX },
  { name: "desktop", width: 1280, height: 900, min: MIN_DESKTOP_PX },
] as const;

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

test.describe("Ledger — tap-target sizes across viewports", () => {
  test.skip(
    !HAS_AUTH,
    "Requires an injected Lovable-managed Supabase session (LOVABLE_BROWSER_AUTH_STATUS=injected).",
  );

  for (const vp of VIEWPORTS) {
    test(`${vp.name} (${vp.width}×${vp.height}) — controls stay ≥ ${vp.min}px`, async ({
      context,
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await restoreSupabaseSession(context, page);
      await page.goto(ROUTE, { waitUntil: "domcontentloaded" });
      await expect(
        page.locator('[data-theme="ios"]').first(),
        "iOS-scoped shell should mount on /ledger",
      ).toBeVisible();
      await settle(page);

      // --- Filter-by-Booking combobox — always rendered, no data needed ---
      const combobox = page.getByRole("combobox", { name: /select booking/i });
      await expect(combobox, "Booking picker should render").toBeVisible();
      await combobox.scrollIntoViewIfNeeded();
      await expectMinSize(combobox, vp.min, `${vp.name} booking-picker`);
      await expect(combobox).toHaveScreenshot(`ledger-booking-picker-${vp.name}.png`, {
        maxDiffPixelRatio: 0.01,
      });

      // --- Per-row WhatsApp reminder — only present on OVERDUE rows ---
      // Gate on presence so the test doesn't fail on accounts that have
      // no overdue installments today; when it IS present, size + pixels
      // must both hold.
      const whatsapp = page.getByRole("link", { name: /send whatsapp reminder/i }).first();
      if (await whatsapp.count().then((c) => c > 0)) {
        await whatsapp.scrollIntoViewIfNeeded();
        await expectMinSize(whatsapp, vp.min, `${vp.name} whatsapp-button`);
        await expect(whatsapp).toHaveScreenshot(`ledger-whatsapp-button-${vp.name}.png`, {
          maxDiffPixelRatio: 0.01,
        });
      }
    });
  }
});
