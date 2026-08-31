import { expect, test } from "./_overflowDebugFixture";
import type { Locator, Page } from "@playwright/test";

/**
 * Breadcrumbs — overflow menu ARIA roles + highlight state contract.
 *
 * When the overflow trigger is opened by keyboard, screen readers rely
 * on two things being true:
 *
 *   1. The dropdown container exposes role="menu" (Radix DropdownMenu
 *      contract). This is what turns the popup into a "menu" for AT
 *      users; without it NVDA/VoiceOver announce it as a generic group.
 *
 *   2. Each row inside exposes role="menuitem". Radix DropdownMenu
 *      does NOT use aria-selected — menu semantics use the
 *      "highlighted" state instead, surfaced via data-highlighted on
 *      exactly one item at a time. We assert both: the attribute is
 *      present for AT-friendly styling, AND only one item carries it
 *      after each ArrowDown step (single-highlight invariant).
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

/** Snapshot the currently-highlighted index and total menuitem count. */
async function readHighlight(page: Page) {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const highlightedIdxs = items
      .map((el, i) => (el.hasAttribute("data-highlighted") ? i : -1))
      .filter((i) => i !== -1);
    return {
      total: items.length,
      highlighted: highlightedIdxs,
      // aria-selected is intentionally NOT set on Radix menuitems — record
      // it so a regression that adds the wrong attribute is caught.
      ariaSelectedCount: items.filter((el) => el.hasAttribute("aria-selected")).length,
    };
  });
}

test.describe("Breadcrumbs — overflow menu exposes menu/menuitem roles and single highlight", () => {
  for (const theme of THEMES) {
    test(`${theme} · role=menu + role=menuitem, single data-highlighted moves with ArrowDown`, async ({
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

      // Trigger is a menu button (aria-haspopup=menu, aria-expanded).
      await expect(trigger, "trigger advertises a menu popup").toHaveAttribute(
        "aria-haspopup",
        /menu|true/,
      );
      await expect(trigger, "trigger is collapsed before open").toHaveAttribute(
        "aria-expanded",
        "false",
      );

      await trigger.focus();
      const menu = await openMenuByKeyboard(page, trigger);

      // 1. Container role is menu.
      await expect(menu, 'dropdown container carries role="menu"').toBeVisible();
      await expect(menu, 'exactly one role="menu" is present').toHaveCount(1);

      // Trigger now marked expanded.
      await expect(trigger, "trigger is expanded once menu opens").toHaveAttribute(
        "aria-expanded",
        "true",
      );

      // 2. Rows carry role="menuitem".
      const menuItems = page.locator('[role="menuitem"]');
      const itemCount = await menuItems.count();
      expect(itemCount, "fixture yields multiple hidden crumbs as menuitems").toBeGreaterThan(1);

      // Wait for Radix to auto-highlight the first item after keyboard-open.
      await page.waitForFunction(
        () => !!document.querySelector('[role="menuitem"][data-highlighted]'),
        undefined,
        { timeout: 2000 },
      );

      // Snapshot #1: exactly one highlight, no aria-selected leakage.
      const initial = await readHighlight(page);
      expect(initial.total, "menuitem count matches locator count").toBe(itemCount);
      expect(
        initial.highlighted.length,
        "exactly one menuitem carries data-highlighted on open",
      ).toBe(1);
      expect(
        initial.ariaSelectedCount,
        "menu semantics: no menuitem should expose aria-selected (highlighted, not selected)",
      ).toBe(0);

      // Walk ArrowDown through the rest of the list, asserting the
      // single-highlight invariant AND that the highlighted index
      // advances by exactly one step each press until we reach the end.
      let previousIdx = initial.highlighted[0];
      for (let step = 1; step < itemCount; step++) {
        await page.keyboard.press("ArrowDown");

        // Wait for the highlight to actually move — Radix mutates the
        // attribute synchronously but focus/data-highlighted may lag a tick.
        const expectedIdx = Math.min(previousIdx + 1, itemCount - 1);
        await page.waitForFunction(
          (idx) => {
            const items = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
            return items[idx]?.hasAttribute("data-highlighted") ?? false;
          },
          expectedIdx,
          { timeout: 2000 },
        );

        const snap = await readHighlight(page);
        expect(snap.highlighted.length, `step ${step}: still exactly one highlighted row`).toBe(1);
        expect(snap.highlighted[0], `step ${step}: highlight advanced to row ${expectedIdx}`).toBe(
          expectedIdx,
        );
        expect(
          snap.ariaSelectedCount,
          `step ${step}: no aria-selected leaks in during navigation`,
        ).toBe(0);

        previousIdx = expectedIdx;
      }
    });
  }
});
