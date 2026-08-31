import { expect, test, type Page } from "@playwright/test";

/**
 * Breadcrumbs — hover-state visual regression across light + dark themes.
 *
 * Sibling to `breadcrumbs-focus-states.spec.ts` (which locks the focus
 * ring). This spec locks the **hover state** — the color/underline/bg
 * treatments applied by `:hover` on breadcrumb links and by Radix
 * `data-[highlighted]` (set on pointer-enter) inside the overflow menu.
 *
 * Why hover deserves its own baselines:
 *   • Hover uses `text-foreground` / `bg-accent` / underline utilities that
 *     drift independently of the focus ring token. A regression on hover
 *     (e.g. `text-muted-foreground` losing contrast on light theme, or
 *     `bg-accent` collapsing to transparent in dark) is invisible to the
 *     focus-states spec.
 *   • Pointer-driven `:hover` deliberately does NOT set `:focus-visible`, so
 *     the ring should NOT appear here. That's a structural check baked into
 *     the baseline: any accidental `focus` styling on hover shows up as a
 *     pixel diff.
 *
 * Interaction model:
 *   • Move the pointer to the target BEFORE taking the screenshot
 *     (`locator.hover()` positions the mouse over the element center).
 *   • For the overflow menu, open with keyboard `Enter` (so the menu is
 *     visible + a11y-correct), then `hover()` a specific row so Radix
 *     applies `data-highlighted` via pointer — NOT via ArrowDown, which
 *     would conflate hover with keyboard highlight. To pin this down, we
 *     also call `blur()` on the trigger so `:focus-visible` clears from
 *     the trigger and the ring cannot bleed into the trigger-row shot.
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

/**
 * Park the mouse well outside any interactive region before hovering the
 * target. Without this, a previous test's mouse position (or the default
 * 0,0) can leave a stale `:hover` on an unrelated element that bleeds into
 * the element-screenshot bounding box.
 */
async function resetPointer(page: Page) {
  await page.mouse.move(0, 0);
  await page.mouse.move(1, 1);
}

test.describe("Breadcrumbs — hover state across themes", () => {
  for (const theme of THEMES) {
    test(`${theme} · Home link hovered`, async ({ context, page }) => {
      await forceTheme(page, theme);
      // Any non-root route so Home is a link (not the current-page span).
      await page.goto("/bookings", { waitUntil: "domcontentloaded" });

      const crumb = page.locator('nav[aria-label="Breadcrumb"]').first();
      await expect(crumb, "Breadcrumb nav should mount").toBeVisible();
      await settle(page);

      await resetPointer(page);
      const home = crumb.getByRole("link", { name: /Go to Dashboard/ });
      await home.hover();
      // Blur any lingering keyboard focus so the ring cannot appear.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

      await expect(home).toBeVisible();
      await expect(crumb).toHaveScreenshot(`breadcrumbs-hover-${theme}-home-link.png`, {
        maxDiffPixelRatio: 0.02,
        animations: "disabled",
      });
    });

    test(`${theme} · ancestor crumb hovered`, async ({ context, page }) => {
      await forceTheme(page, theme);
      // Deep-enough route so "Bookings" is a mid-trail link.
      await page.goto("/bookings/abcdef0123456789", { waitUntil: "domcontentloaded" });

      const crumb = page.locator('nav[aria-label="Breadcrumb"]').first();
      await expect(crumb).toBeVisible();
      await settle(page);

      await resetPointer(page);
      const ancestor = crumb.getByRole("link", { name: /Go to Bookings/ });
      await ancestor.hover();
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

      // Structural: ancestor must still be aria-current="location" while
      // hovered — hover state should not clobber semantic attrs.
      await expect(ancestor).toHaveAttribute("aria-current", "location");
      await expect(crumb).toHaveScreenshot(`breadcrumbs-hover-${theme}-ancestor-link.png`, {
        maxDiffPixelRatio: 0.02,
        animations: "disabled",
      });
    });

    test(`${theme} · overflow trigger + hovered dropdown row`, async ({ context, page }) => {
      await forceTheme(page, theme);

      // Fixture route `/crumb-fixture/$` forces > MAX_VISIBLE
      // (4) crumbs so the overflow trigger reliably renders. Sibling
      // overflow specs use the same fixture path.
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

      // 1) Hover the closed trigger — locks the button hover treatment
      //    (bg/text tokens) without any menu visible.
      await resetPointer(page);
      await trigger.hover();
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
      await expect(crumb).toHaveScreenshot(`breadcrumbs-hover-${theme}-overflow-trigger.png`, {
        maxDiffPixelRatio: 0.02,
        animations: "disabled",
      });

      // 2) Open the menu with the keyboard so opening is a11y-correct,
      //    then hover a row to trigger Radix `data-highlighted` via the
      //    POINTER path (distinct from keyboard highlight covered in the
      //    focus-states spec).
      await trigger.focus();
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();

      // Blur trigger focus so its ring cannot appear in the menu shot.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
      await resetPointer(page);

      const firstItem = menu.getByRole("menuitem").first();
      await firstItem.hover();
      await expect(firstItem).toHaveAttribute("data-highlighted", /.*/);

      await expect(menu).toHaveScreenshot(`breadcrumbs-hover-${theme}-overflow-menu-row.png`, {
        maxDiffPixelRatio: 0.02,
        animations: "disabled",
      });
    });
  }
});
