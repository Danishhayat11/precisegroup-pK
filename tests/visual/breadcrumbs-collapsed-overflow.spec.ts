import { expect, test, type Page } from "@playwright/test";

/**
 * Breadcrumbs — forced overflow (collapsed) visual regression.
 *
 * Sibling to the resting / focus / hover specs. Those all skip the
 * overflow cases because no production authenticated route exceeds
 * `MAX_VISIBLE = 4` breadcrumb segments. This spec navigates to the
 * dedicated test fixture route (`/crumb-fixture/$`) with
 * an intentionally deep path — six segments — so the component
 * guarantees:
 *   • first crumb (Home / Test Crumbs) visible
 *   • overflow trigger (…) rendered between
 *   • last two crumbs visible + trailing separator to current page
 *
 * What we lock:
 *   • Resting appearance of the collapsed trail: separator color,
 *     divider spacing, ellipsis trigger chrome, current-page contrast.
 *   • Hover on the overflow trigger — the divider token before/after
 *     the trigger must not shift on hover; the trigger's own bg/text
 *     tokens must resolve to `bg-accent` / `text-accent-foreground`.
 *   • Open menu with a hovered row — verifies `data-highlighted`
 *     hover treatment against theme tokens, and confirms separators
 *     in the collapsed trail don't inherit any hover state leakage
 *     from the trigger.
 *
 * All three checks are captured in both light and dark themes.
 */

const THEMES = ["light", "dark"] as const;

// Six-segment path guarantees crumbs.length (6) > MAX_VISIBLE (4).
const DEEP_PATH = "/crumb-fixture/alpha/beta/gamma/delta/epsilon";

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

/** Park the mouse away from any interactive region. */
async function resetPointer(page: Page) {
  await page.mouse.move(0, 0);
  await page.mouse.move(1, 1);
}

test.describe("Breadcrumbs — forced overflow (collapsed trail)", () => {
  for (const theme of THEMES) {
    test(`${theme} · collapsed trail — resting`, async ({ context, page }) => {
      await forceTheme(page, theme);
      await page.goto(DEEP_PATH, { waitUntil: "domcontentloaded" });

      const crumb = page.locator('nav[aria-label="Breadcrumb"]').first();
      await expect(crumb, "Breadcrumb nav should mount").toBeVisible();

      // Structural guarantee: the overflow trigger must actually be present
      // on this route. If it isn't, the spec's premise is broken — better
      // to fail loudly here than to snapshot a passing-but-wrong image.
      const trigger = crumb.getByRole("button", {
        name: /Show \d+ hidden breadcrumb/,
      });
      await expect(trigger, "overflow trigger must render at 6 crumbs").toHaveCount(1);

      await settle(page);
      await resetPointer(page);
      // Blur anything that may have picked up focus from the navigation.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
      // Anchor horizontal scroll deterministically (see trigger-hover test
      // for why). Pin to 0 so the same trail region is always in frame.
      await crumb.evaluate((el) => {
        const scroller = el.querySelector("ol") ?? el;
        (scroller as HTMLElement).scrollLeft = 0;
      });

      await expect(crumb).toHaveScreenshot(`breadcrumbs-collapsed-${theme}-resting.png`, {
        maxDiffPixelRatio: 0.02,
        animations: "disabled",
      });
    });

    test(`${theme} · collapsed trail — overflow trigger hovered`, async ({ context, page }) => {
      await forceTheme(page, theme);
      await page.goto(DEEP_PATH, { waitUntil: "domcontentloaded" });

      const crumb = page.locator('nav[aria-label="Breadcrumb"]').first();
      await expect(crumb).toBeVisible();
      await settle(page);

      const trigger = crumb.getByRole("button", {
        name: /Show \d+ hidden breadcrumb/,
      });
      await expect(trigger).toHaveCount(1);

      // Anchor the horizontal scroll BEFORE hovering. The nav is
      // overflow-x-auto and can end up scrolled either to the current-page
      // crumb (right edge) or to the start (left edge) depending on focus
      // side-effects during navigation. Pin scrollLeft = 0 deterministically
      // so the screenshot bounding box always shows the same trail region.
      await crumb.evaluate((el) => {
        const scroller = el.querySelector("ol") ?? el;
        (scroller as HTMLElement).scrollLeft = 0;
      });

      await resetPointer(page);
      await trigger.hover();
      // Ensure no keyboard focus — we're isolating hover treatment.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

      // Whole nav so we capture separators on both sides of the trigger —
      // they must not visually shift or recolor when the trigger hovers.
      await expect(crumb).toHaveScreenshot(`breadcrumbs-collapsed-${theme}-trigger-hover.png`, {
        maxDiffPixelRatio: 0.02,
        animations: "disabled",
      });
    });

    test(`${theme} · collapsed trail — dropdown open with hovered row`, async ({
      context,
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(DEEP_PATH, { waitUntil: "domcontentloaded" });

      const crumb = page.locator('nav[aria-label="Breadcrumb"]').first();
      await expect(crumb).toBeVisible();
      await settle(page);

      const trigger = crumb.getByRole("button", {
        name: /Show \d+ hidden breadcrumb/,
      });
      await expect(trigger).toHaveCount(1);

      // Open with keyboard (a11y-correct path), then hover a row via
      // pointer so `data-highlighted` reflects hover — not keyboard.
      await trigger.focus();
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();

      // Clear focus so no ring bleeds into the menu screenshot.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
      await resetPointer(page);

      const firstItem = menu.getByRole("menuitem").first();
      await firstItem.hover();
      await expect(firstItem).toHaveAttribute("data-highlighted", /.*/);

      await expect(menu).toHaveScreenshot(`breadcrumbs-collapsed-${theme}-menu-hover.png`, {
        maxDiffPixelRatio: 0.02,
        animations: "disabled",
      });
    });
  }
});
