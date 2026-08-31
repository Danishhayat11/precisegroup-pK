import { expect, test, type Page } from "@playwright/test";

/**
 * Breadcrumbs — focus-state visual regression across light + dark themes.
 *
 * Sibling to `breadcrumbs-theme-tokens.spec.ts` (which locks the *resting*
 * appearance). This spec locks the **focus ring** — the shared `focusRing`
 * class in `src/components/Breadcrumbs.tsx` — against unintended drift in:
 *   • ring color        (must resolve to the theme `--ring` token)
 *   • ring width/offset (`ring-2` + `ring-offset-2` on `ring-offset-background`)
 *   • lift/stacking     (`relative z-10` so neighbours never clip the ring)
 *   • dropdown highlight (Radix `data-[highlighted]` = `bg-accent` /
 *                         `text-accent-foreground`)
 *
 * We drive focus with the keyboard (`page.keyboard.press('Tab')` /
 * `ArrowDown`) rather than `element.focus()` so `:focus-visible` matches —
 * that's the exact selector the component relies on, and a mouse-only focus
 * would silently pass even if `:focus-visible` were broken.
 *
 * Element screenshots keep baselines stable against unrelated top-bar
 * changes. Small `maxDiffPixelRatio` tolerates AA jitter; any real token
 * shift (ring color / offset / spacing) blows past it.
 */

const THEMES = ["light", "dark"] as const;

async function forceTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("precise.theme", t);
    } catch {
      /* ignored */
    }
    const root = document.documentElement;
    root.classList.toggle("dark", t === "dark");
    root.style.colorScheme = t;
  }, theme);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(150);
}

test.describe("Breadcrumbs — focus ring across themes", () => {
  for (const theme of THEMES) {
    test(`${theme} · Home link focused`, async ({ context, page }) => {
      await forceTheme(page, theme);
      // Any non-root route so the Home crumb renders as a link (not a span).
      await page.goto("/bookings", { waitUntil: "domcontentloaded" });

      const crumb = page.locator('nav[aria-label="Breadcrumb"]').first();
      await expect(crumb, "Breadcrumb nav should mount").toBeVisible();
      await settle(page);

      const home = crumb.getByRole("link", { name: /Go to Dashboard/ });
      // Programmatic .focus() + keyboard sync = deterministic :focus-visible.
      await home.focus();
      await page.keyboard.press("Shift"); // no-op keypress flips focus-visible on

      await expect(home).toBeFocused();
      await expect(crumb).toHaveScreenshot(`breadcrumbs-focus-${theme}-home-link.png`, {
        maxDiffPixelRatio: 0.02,
        animations: "disabled",
      });
    });

    test(`${theme} · ancestor crumb focused`, async ({ context, page }) => {
      await forceTheme(page, theme);
      // Deep-enough route so "Bookings" is a mid-trail link, not the current page.
      await page.goto("/bookings/abcdef0123456789", { waitUntil: "domcontentloaded" });

      const crumb = page.locator('nav[aria-label="Breadcrumb"]').first();
      await expect(crumb).toBeVisible();
      await settle(page);

      const ancestor = crumb.getByRole("link", { name: /Go to Bookings/ });
      await ancestor.focus();
      await page.keyboard.press("Shift");

      await expect(ancestor).toBeFocused();
      // aria-current="location" on ancestor is a hard structural check —
      // if the label resolver drifts and marks it "page", the ring test
      // would still pass visually but the semantic contract would break.
      await expect(ancestor).toHaveAttribute("aria-current", "location");

      await expect(crumb).toHaveScreenshot(`breadcrumbs-focus-${theme}-ancestor-link.png`, {
        maxDiffPixelRatio: 0.02,
        animations: "disabled",
      });
    });

    test(`${theme} · overflow trigger + highlighted dropdown row`, async ({ context, page }) => {
      await forceTheme(page, theme);

      // Fixture route `/crumb-fixture/$` derives the trail
      // from the pathname, so this 6-segment URL guarantees > MAX_VISIBLE
      // (4) crumbs and mounts the overflow trigger deterministically.
      await page.goto("/crumb-fixture/alpha/beta/gamma/delta/epsilon", {
        waitUntil: "domcontentloaded",
      });
      await settle(page);

      const trigger = page
        .locator('nav[aria-label="Breadcrumb"]')
        .getByRole("button", { name: /Show \d+ hidden breadcrumb/ });
      await expect(
        trigger,
        "fixture route must produce the collapsed overflow trigger",
      ).toBeVisible();

      const crumb = page.locator('nav[aria-label="Breadcrumb"]').first();
      await trigger.focus();
      await page.keyboard.press("Shift");
      await expect(trigger).toBeFocused();
      await expect(crumb).toHaveScreenshot(`breadcrumbs-focus-${theme}-overflow-trigger.png`, {
        maxDiffPixelRatio: 0.02,
        animations: "disabled",
      });

      // Open the menu with the keyboard so the first item is auto-highlighted
      // by Radix (matches real keyboard-only navigation, not a hover).
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      await page.keyboard.press("ArrowDown"); // ensure data-[highlighted] is set

      const highlighted = menu.locator("[data-highlighted]").first();
      await expect(highlighted, "a menu item should be highlighted").toHaveCount(1);

      await expect(menu).toHaveScreenshot(
        `breadcrumbs-focus-${theme}-overflow-menu-highlighted.png`,
        { maxDiffPixelRatio: 0.02, animations: "disabled" },
      );
    });
  }
});
