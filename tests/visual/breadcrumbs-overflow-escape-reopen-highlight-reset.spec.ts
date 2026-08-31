import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs — Escape-then-reopen resets highlight + roving focus.
 *
 * After closing the overflow menu with Escape and reopening it, the
 * menu MUST start from a clean roving-focus state:
 *
 *   1. Exactly one menuitem carries the initial highlight
 *      (data-highlighted). Zero highlights = keyboard nav is dead;
 *      more than one = two roving cursors will fight on the next
 *      Arrow key.
 *   2. That highlighted item is the FIRST menuitem (index 0) — the
 *      documented "reopen starts fresh" contract. A regression that
 *      reopens on the row that was highlighted before Escape (or on
 *      the second row because of a stale walk) trips this.
 *   3. Roving tabindex is well-formed: exactly one menuitem has
 *      tabindex="0", every other menuitem has tabindex="-1".
 *   4. ArrowDown from the reopened state lands on menuitem index 1
 *      with no skips — proving the roving cursor moves by one from
 *      the fresh starting point instead of jumping two (which would
 *      happen if the highlight and the tab-stop disagreed).
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

async function waitForInitialHighlight(page: Page) {
  await page.waitForFunction(
    () => !!document.querySelector('[role="menuitem"][data-highlighted]'),
    undefined,
    { timeout: 2000 },
  );
}

/** Snapshot of every menuitem's index, highlight state, and tabindex. */
async function readRovingState(page: Page) {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    return items.map((el, idx) => ({
      idx,
      text: (el.textContent ?? "").trim(),
      highlighted: el.hasAttribute("data-highlighted"),
      tabindex: el.getAttribute("tabindex"),
    }));
  });
}

test.describe("Breadcrumbs — Escape then reopen resets highlight and roving focus", () => {
  for (const theme of THEMES) {
    test(`${theme} · reopen starts on item 0 with a single, well-formed roving cursor`, async ({
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

      // ---- First open: walk highlight OFF the initial item ---------------
      // If we don't move the cursor before Escape, "reopen starts on
      // item 0" is trivially true regardless of the reset logic. We
      // walk to at least index 2 so a "restore last highlight" bug
      // would land on 2 (or 1 after a partial reset), not 0.
      await trigger.focus();
      const firstMenu = await openMenuByKeyboard(page, trigger);
      await expect(firstMenu, "menu open (first time)").toBeVisible();
      await waitForInitialHighlight(page);

      const itemCount = await page.locator('[role="menuitem"]').count();
      expect(itemCount, "fixture yields several hidden crumbs").toBeGreaterThanOrEqual(3);

      const initialIdx = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
        return els.findIndex((el) => el.hasAttribute("data-highlighted"));
      });
      // Advance to index 2 (or the last item if the list is shorter).
      const walkTarget = Math.min(2, itemCount - 1);
      for (let i = initialIdx; i < walkTarget; i++) {
        await page.keyboard.press("ArrowDown");
      }
      await page.waitForFunction(
        (idx) => {
          const els = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
          return els[idx]?.hasAttribute("data-highlighted") ?? false;
        },
        walkTarget,
        { timeout: 2000 },
      );

      // Close with Escape.
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => document.querySelectorAll('[role="menu"]').length === 0,
        undefined,
        { timeout: 2000 },
      );
      await expect(trigger, "trigger aria-expanded reset after Escape").toHaveAttribute(
        "aria-expanded",
        "false",
      );

      // ---- Reopen and inspect the roving state ---------------------------
      const reopenedMenu = await openMenuByKeyboard(page, trigger);
      await expect(reopenedMenu, "menu open (after Escape)").toBeVisible();
      await waitForInitialHighlight(page);

      const reopenCount = await page.locator('[role="menuitem"]').count();
      expect(reopenCount, "reopened menu has the same items as before").toBe(itemCount);

      const state = await readRovingState(page);

      // (1) Exactly one highlighted menuitem.
      const highlighted = state.filter((s) => s.highlighted);
      expect(
        highlighted.length,
        `exactly one menuitem is highlighted on reopen (got ${highlighted.length}: ${JSON.stringify(highlighted)})`,
      ).toBe(1);

      // (2) That menuitem is at index 0 — the fresh starting point.
      expect(
        highlighted[0].idx,
        `reopen highlights the FIRST menuitem, not the pre-Escape row (was walked to idx=${walkTarget})`,
      ).toBe(0);

      // (3) Roving tabindex is well-formed: one tabindex="0", rest -1.
      const tabStops = state.filter((s) => s.tabindex === "0");
      const nonStops = state.filter((s) => s.tabindex === "-1");
      expect(
        tabStops.length,
        `exactly one menuitem carries tabindex="0" (got ${tabStops.length}: ${JSON.stringify(tabStops)})`,
      ).toBe(1);
      expect(nonStops.length, 'every other menuitem carries tabindex="-1"').toBe(state.length - 1);
      expect(
        tabStops[0].idx,
        "the tab-stop and the highlight are on the SAME menuitem (index 0)",
      ).toBe(0);

      // (4) ArrowDown from the reset state moves to index 1 with no skips.
      await page.keyboard.press("ArrowDown");
      await page.waitForFunction(
        () => {
          const els = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
          return els[1]?.hasAttribute("data-highlighted") ?? false;
        },
        undefined,
        { timeout: 2000 },
      );
      const afterArrow = await readRovingState(page);
      const nowHighlighted = afterArrow.filter((s) => s.highlighted);
      expect(
        nowHighlighted.length,
        "still exactly one highlight after ArrowDown (no stale second cursor)",
      ).toBe(1);
      expect(
        nowHighlighted[0].idx,
        "ArrowDown from a fresh reopen lands on index 1 (no skip)",
      ).toBe(1);
    });
  }
});
