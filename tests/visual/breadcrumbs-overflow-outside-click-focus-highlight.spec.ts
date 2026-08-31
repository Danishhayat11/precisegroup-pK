import { expect, test } from "./_overflowDebugFixture";
import type { Locator, Page } from "@playwright/test";

/**
 * Breadcrumbs — outside-click dismissal focus & highlight regression.
 *
 * The existing `breadcrumbs-overflow-outside-click-close` spec locks
 * the ARIA-state cleanup (aria-expanded / aria-controls). This spec
 * adds the two behaviours that spec deliberately does NOT touch:
 *
 *   1. Focus return: after an outside click, keyboard focus must land
 *      back on the overflow trigger. Radix's default for pointer
 *      dismissal is to leave focus at the click target (often <body>);
 *      that's a keyboard-user regression waiting to happen because the
 *      next Tab press starts from an unexpected place. We restore focus
 *      to the trigger in Breadcrumbs, so lock that behaviour here.
 *
 *   2. Highlight reset: while the menu is open, arrowing sets
 *      `data-highlighted` on a menuitem so the theme ring is visible.
 *      When the menu closes, no residual `data-highlighted` element may
 *      remain in the DOM — otherwise reopening the menu can flash the
 *      previous row before Radix re-highlights the first item, and the
 *      stale highlight can be visible mid-teardown in dark mode.
 *
 * We also re-assert aria-expanded here so a single failure explains
 * all three symptoms at once, and we run both themes because the
 * highlight visual is theme-dependent.
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

async function openMenu(page: Page, trigger: Locator): Promise<Locator> {
  const menu = page.getByRole("menu");
  for (let i = 0; i < 6; i++) {
    await trigger.focus();
    await trigger.press(" ");
    if (await menu.count()) return menu;
    await page.waitForTimeout(200);
  }
  return menu;
}

test.describe("Breadcrumbs overflow · outside-click restores focus, resets highlight, flips aria-expanded", () => {
  for (const theme of THEMES) {
    test(`${theme} · outside click closes menu, focus returns to trigger, no lingering data-highlighted`, async ({
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

      // ── Open the menu and move the highlight so we can prove it resets ──
      const menu = await openMenu(page, trigger);
      await expect(menu, "[pre] menu open").toBeVisible();
      await expect(trigger, "[pre] aria-expanded=true").toHaveAttribute("aria-expanded", "true");

      // ArrowDown a couple of times so a non-first row carries data-highlighted.
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      const highlightedBefore = await page.locator('[role="menuitem"][data-highlighted]').count();
      expect(
        highlightedBefore,
        "[pre] exactly one menuitem carries data-highlighted while open",
      ).toBe(1);

      // ── Click well outside the trigger AND the portalled menu ──
      // Bottom-right corner of the viewport is always outside both.
      const viewport = page.viewportSize()!;
      const outsideX = viewport.width - 5;
      const outsideY = viewport.height - 5;
      // Sanity: verify the outside coord isn't inside trigger or menu boxes
      // (portal placement varies between themes / animation timing).
      const triggerBox = await trigger.boundingBox();
      const menuBox = await menu.boundingBox();
      const insideAny =
        (triggerBox &&
          outsideX >= triggerBox.x &&
          outsideX <= triggerBox.x + triggerBox.width &&
          outsideY >= triggerBox.y &&
          outsideY <= triggerBox.y + triggerBox.height) ||
        (menuBox &&
          outsideX >= menuBox.x &&
          outsideX <= menuBox.x + menuBox.width &&
          outsideY >= menuBox.y &&
          outsideY <= menuBox.y + menuBox.height);
      expect(insideAny, "[sanity] outside coord truly outside trigger + menu").toBeFalsy();

      await page.mouse.click(outsideX, outsideY);

      // ── Menu unmounts, aria-expanded resets ──
      await expect(page.getByRole("menu"), "[post] menu unmounted").toHaveCount(0);
      await expect(trigger, "[post] aria-expanded=false").toHaveAttribute("aria-expanded", "false");

      // ── No stale data-highlighted anywhere in the DOM ──
      const highlightedAfter = await page.locator("[data-highlighted]").count();
      expect(highlightedAfter, "[post] no residual data-highlighted after dismissal").toBe(0);

      // ── Focus returned to the overflow trigger ──
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return {
          tag: el?.tagName ?? "BODY",
          label: el?.getAttribute("aria-label") ?? null,
          isBody: !el || el === document.body,
        };
      });
      expect(focused.isBody, "[post] focus did not fall to <body>").toBe(false);
      expect(focused.label, "[post] focus returned to the overflow trigger").toMatch(
        /hidden breadcrumb/i,
      );

      // ── Re-open cleanly to prove the reset didn't break the trigger ──
      const menu2 = await openMenu(page, trigger);
      await expect(menu2, "[re-open] menu opens again after outside-click dismissal").toBeVisible();
      // On keyboard re-open Radix highlights the first item — exactly one, not zero, not two.
      const highlightedReopen = await page.locator('[role="menuitem"][data-highlighted]').count();
      expect(
        highlightedReopen,
        "[re-open] exactly one menuitem highlighted (fresh state, not stale)",
      ).toBe(1);
    });
  }
});
