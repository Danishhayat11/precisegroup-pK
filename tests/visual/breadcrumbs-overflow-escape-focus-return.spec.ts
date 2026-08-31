import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs — Escape returns focus to the overflow trigger.
 *
 * Narrow regression guard for a single WAI-ARIA menu-button contract:
 *
 *   after Escape closes the collapsed overflow menu,
 *   focus MUST land back on the overflow trigger button
 *   in BOTH light and dark themes.
 *
 * The broader keyboard flow (Tab → open → Enter to navigate) lives in
 * `breadcrumbs-overflow-keyboard.spec.ts`; the pre-open focus origin is
 * covered by `breadcrumbs-overflow-escape-restores-preopen-focus.spec.ts`.
 * This file exists so a regression in the focus-return contract shows up
 * as a small, obviously-named failure instead of hiding inside a larger
 * multi-step spec.
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

async function settle(page: Page) {
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(200);
}

/**
 * Cross-browser open helper — Radix DropdownMenu accepts Space, Enter, or
 * ArrowDown as menu-button activators. WebKit occasionally drops the first
 * keydown between focus commitment and press, so rotate the activators and
 * re-focus every attempt. Mirrors the helper in the sibling keyboard spec.
 */
async function openMenuByKeyboard(page: Page, trigger: Locator) {
  const menu = page.getByRole("menu");
  const keys = [" ", "Enter", "ArrowDown"] as const;
  for (let attempt = 0; attempt < 9; attempt++) {
    await trigger.focus();
    await trigger.press(keys[attempt % keys.length]);
    const expanded = await trigger.getAttribute("aria-expanded");
    if (expanded === "true" || (await menu.count())) return menu;
    await page.waitForTimeout(200);
  }
  return menu;
}

test.describe("Breadcrumbs overflow — Escape returns focus to trigger", () => {
  for (const theme of THEMES) {
    test(`${theme} · Escape restores focus to the overflow button`, async ({ page }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await settle(page);

      const crumb = page.locator('nav[aria-label="Breadcrumb"]').first();
      // Radix mutates the button's accessible name while open (aria-expanded
      // flips, some builds swap "Show N hidden" → "Hide"), so match on the
      // stable substring instead of a role+regex.
      const trigger = crumb.locator('button[aria-label*="hidden breadcrumb" i]');
      await expect(
        trigger,
        `[${theme}] overflow trigger is rendered for the collapsed crumb`,
      ).toBeVisible();

      // Open via keyboard — this is the surface under test. A click-open
      // would bypass the focus-return contract Escape guarantees for
      // keyboard users.
      await trigger.focus();
      await expect(trigger, `[${theme}] trigger is focused before opening`).toBeFocused();

      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu, `[${theme}] menu opens by keyboard`).toBeVisible();
      await expect(
        trigger,
        `[${theme}] aria-expanded flips to true while menu is open`,
      ).toHaveAttribute("aria-expanded", "true");

      // Move highlight into the menu so we're not testing the trivial
      // "focus never left" case — Escape must actively pull focus back
      // from a highlighted menuitem to the trigger.
      await page.keyboard.press("ArrowDown");
      await expect(
        menu.locator("[data-highlighted]"),
        `[${theme}] a menuitem is highlighted before Escape`,
      ).toHaveCount(1);

      // ── The contract ──────────────────────────────────────────
      await page.keyboard.press("Escape");

      await expect(menu, `[${theme}] menu closes on Escape`).toBeHidden();
      await expect(
        page.getByRole("menu"),
        `[${theme}] menu is fully unmounted after Escape`,
      ).toHaveCount(0);
      await expect(
        trigger,
        `[${theme}] focus returns to the overflow trigger after Escape`,
      ).toBeFocused();
      await expect(
        trigger,
        `[${theme}] aria-expanded resets to false after Escape`,
      ).toHaveAttribute("aria-expanded", "false");

      // :focus-visible must still paint — the return isn't just any focus
      // event, it's a keyboard-origin focus event.
      const focusVisible = await trigger.evaluate((el) => el.matches(":focus-visible"));
      expect(focusVisible, `[${theme}] trigger still shows :focus-visible after Escape`).toBe(true);
    });
  }
});
