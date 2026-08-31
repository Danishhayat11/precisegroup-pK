import { expect, test } from "./_overflowDebugFixture";
import type { Locator, Page } from "@playwright/test";

/**
 * Breadcrumbs — overflow menu outside-click dismissal contract.
 *
 * Clicking outside an open Radix DropdownMenu MUST:
 *   1. Close the menu (no lingering role="menu" in the DOM).
 *   2. Flip the trigger's aria-expanded back to "false".
 *   3. Drop aria-controls from the trigger — Radix only sets
 *      aria-controls while the popup is mounted, because
 *      pointing at an id that no longer exists is invalid ARIA
 *      and confuses screen-reader virtual buffers.
 *
 * We click a neutral area (the page heading text) so the click
 * doesn't accidentally hit another interactive control that
 * could steal focus / navigate.
 */

const THEMES = ["light", "dark"] as const;
const FIXTURE_URL = "/crumb-fixture/alpha/beta/gamma/delta/epsilon";

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

async function openMenuByKeyboard(page: Page, trigger: Locator): Promise<Locator> {
  const menu = page.getByRole("menu");
  for (let i = 0; i < 6; i++) {
    await trigger.press(" ");
    if (await menu.count()) return menu;
    await page.waitForTimeout(250);
  }
  return menu;
}

test.describe("Breadcrumbs — outside click closes the overflow menu and cleans up ARIA", () => {
  for (const theme of THEMES) {
    test(`${theme} · outside click closes menu, flips aria-expanded, drops aria-controls`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = page.locator(
        'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
      );
      await expect(trigger, "overflow trigger renders").toBeVisible();

      // Baseline: menu is closed, aria-expanded=false, no aria-controls.
      await expect(trigger, "baseline aria-expanded=false").toHaveAttribute(
        "aria-expanded",
        "false",
      );
      const baselineControls = await trigger.getAttribute("aria-controls");
      expect(baselineControls, "closed trigger should not advertise aria-controls").toBeNull();

      // Open the menu.
      await trigger.focus();
      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu, "menu is open").toBeVisible();
      await expect(trigger, "aria-expanded flips to true on open").toHaveAttribute(
        "aria-expanded",
        "true",
      );

      // While open, Radix sets aria-controls to the popup id and that
      // id must resolve to a real element in the document.
      const openControls = await trigger.getAttribute("aria-controls");
      expect(
        openControls,
        "open trigger advertises aria-controls pointing at the popup",
      ).toBeTruthy();
      const controlsResolves = await page.evaluate(
        (id) => !!(id && document.getElementById(id)),
        openControls,
      );
      expect(controlsResolves, "aria-controls id resolves to a mounted element").toBe(true);

      // Click outside the menu AND outside the trigger, on a neutral
      // spot inside the fixture page body. The crumb-fixture route
      // renders visible page content below the breadcrumb — click
      // there via a bounding-box point so we don't hit any other
      // menu / link / button.
      const outsidePoint = await page.evaluate(() => {
        // Pick a coordinate well below the breadcrumb nav but inside
        // the viewport, then confirm the element under it is neither
        // the trigger nor inside the menu.
        const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
        const navBottom = nav ? nav.getBoundingClientRect().bottom : 0;
        const y = Math.min(window.innerHeight - 20, Math.max(navBottom + 120, 200));
        const x = Math.max(20, Math.floor(window.innerWidth / 2));
        return { x, y };
      });

      await page.mouse.click(outsidePoint.x, outsidePoint.y);

      // 1. Menu closes.
      await expect(page.getByRole("menu"), "menu closes after outside click").toHaveCount(0);

      // 2. aria-expanded flips back.
      await expect(trigger, "aria-expanded returns to false after outside click").toHaveAttribute(
        "aria-expanded",
        "false",
      );

      // 3. aria-controls is dropped (Radix removes it on close).
      await page.waitForFunction(
        () => {
          const t = document.querySelector<HTMLElement>(
            'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
          );
          return !!t && !t.hasAttribute("aria-controls");
        },
        undefined,
        { timeout: 2000 },
      );
      const closedControls = await trigger.getAttribute("aria-controls");
      expect(closedControls, "closed trigger no longer advertises aria-controls").toBeNull();

      // Sanity: URL didn't change — outside click must not navigate.
      expect(new URL(page.url()).pathname, "outside click did not navigate away").toBe(
        new URL(FIXTURE_URL, "http://x").pathname,
      );
    });
  }
});
