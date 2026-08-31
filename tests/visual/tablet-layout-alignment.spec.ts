import { expect, test, type Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Tablet visual checks — overflow dropdown, breadcrumb trail, and login
 * form fields.
 *
 * Sibling to `breadcrumbs-collapsed-overflow.spec.ts` and the other
 * `breadcrumbs-*` visual specs, which lock the DESKTOP (1280w) baseline
 * for the same regions. Tablet (820w) sits between mobile and desktop
 * and is the width where our "grid on mobile, flex at sm:" layout has
 * already promoted to the desktop flex layout — so spacing, alignment,
 * and rhythm are EXPECTED to match desktop.
 *
 * What we lock at tablet width (820×1180, matches the a11y responsive
 * suite's `tablet` breakpoint):
 *   • Collapsed breadcrumb trail — ellipsis trigger, divider spacing,
 *     current-page contrast (resting).
 *   • Overflow dropdown — open menu with first row highlighted; row
 *     padding, icon/label alignment, and menu chrome match desktop
 *     tokens (no mobile-only affordances leak in).
 *   • /login form — email + password fields, labels, and submit CTA;
 *     verifies the form does not collapse to the tighter mobile grid
 *     at tablet width.
 *
 * Baselines are stored under
 * `tests/visual/tablet-layout-alignment.spec.ts-snapshots/` and are
 * generated on first run with `--update-snapshots`.
 */

const TABLET = { width: 820, height: 1180 } as const;
const DEEP_PATH = "/crumb-fixture/alpha/beta/gamma/delta/epsilon";

async function forceLight(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("precise.theme", "light");
    } catch {
      /* ignored */
    }
    const root = document.documentElement;
    root.classList.remove("dark");
    root.style.colorScheme = "light";
  });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(150);
}

async function resetPointer(page: Page) {
  await page.mouse.move(0, 0);
  await page.mouse.move(1, 1);
}

test.describe("Tablet visual — overflow / breadcrumb / form alignment", () => {
  test.use({ viewport: TABLET });

  test("tablet · collapsed breadcrumb trail — resting", async ({ page }) => {
    await forceLight(page);
    await page.goto(DEEP_PATH, { waitUntil: "domcontentloaded" });

    const crumb = page.locator('nav[aria-label="Breadcrumb"]').first();
    await expect(crumb, "breadcrumb nav must mount at tablet width").toBeVisible();

    const trigger = crumb.getByRole("button", {
      name: /Show \d+ hidden breadcrumb/,
    });
    await expect(trigger, "overflow trigger must render at 6 crumbs on tablet").toHaveCount(1);

    await settle(page);
    await resetPointer(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await crumb.evaluate((el) => {
      const scroller = el.querySelector("ol") ?? el;
      (scroller as HTMLElement).scrollLeft = 0;
    });

    await expect(crumb).toHaveScreenshot("tablet-breadcrumbs-resting.png", {
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
    });
  });

  test("tablet · overflow dropdown — open with first row highlighted", async ({ page }) => {
    await forceLight(page);
    await page.goto(DEEP_PATH, { waitUntil: "domcontentloaded" });

    const crumb = page.locator('nav[aria-label="Breadcrumb"]').first();
    await expect(crumb).toBeVisible();
    await settle(page);

    const trigger = crumb.getByRole("button", {
      name: /Show \d+ hidden breadcrumb/,
    });
    await expect(trigger).toHaveCount(1);

    // Use the shared Radix opener — it retries through the first-nav
    // hydration race that occasionally swallows the first activation at
    // narrower viewports.
    const menu = await openMenu(page, trigger, {
      activation: "Space",
      label: "tablet overflow menu",
    });

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await resetPointer(page);

    const firstItem = menu.getByRole("menuitem").first();
    await firstItem.hover();
    await expect(firstItem).toHaveAttribute("data-highlighted", /.*/);

    await expect(menu).toHaveScreenshot("tablet-overflow-menu-hover.png", {
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
    });
  });

  test("tablet · /login form fields — spacing and alignment", async ({ page }) => {
    await forceLight(page);
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    const form = page.locator("form").first();
    await expect(form, "/login must render a form on tablet").toBeVisible();

    // Sanity-check the field trio the visual lock depends on: mobile-only
    // regressions typically drop the label or collapse the CTA row here.
    await expect(form.getByLabel(/email/i)).toBeVisible();
    await expect(form.getByLabel(/password/i)).toBeVisible();
    await expect(form.getByRole("button", { name: /sign in|log in|continue/i })).toBeVisible();

    await settle(page);
    await resetPointer(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

    await expect(form).toHaveScreenshot("tablet-login-form.png", {
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
    });
  });
});
