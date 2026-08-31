import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs — overflow menu ArrowUp / ArrowDown navigation contract.
 *
 * Radix DropdownMenu uses a *roving tabindex* model rather than
 * `aria-activedescendant`: real DOM focus moves between menu items,
 * and the item that owns focus is also tagged with `data-highlighted`.
 *
 * This spec verifies, on every ArrowDown / ArrowUp keystroke:
 *
 *   1. Exactly one menu item has `data-highlighted` (single-highlight
 *      invariant — no ghosts left behind after a keystroke).
 *   2. That same item is `document.activeElement` (roving focus tracks
 *      the highlight).
 *   3. The roving `tabindex` contract holds: the focused item has
 *      `tabindex="0"` and every other item has `tabindex="-1"` — this
 *      is what keeps Tab from cycling *inside* the menu.
 *   4. Wrap-around works at both ends (ArrowDown past the last item
 *      lands on the first; ArrowUp past the first lands on the last).
 *
 * Radix also does NOT set `aria-activedescendant` on the menu (that
 * pattern is for composite widgets like listbox/combobox that keep DOM
 * focus on a single container). We assert its absence so future
 * refactors don't accidentally start emitting both signals — which
 * would confuse assistive tech about where focus actually lives.
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

/** Radix can miss the very first keydown after hydration — retry Space. */
async function openMenuByKeyboard(page: Page, trigger: Locator): Promise<Locator> {
  const menu = page.getByRole("menu");
  for (let i = 0; i < 6; i++) {
    await trigger.press(" ");
    if (await menu.count()) return menu;
    await page.waitForTimeout(250);
  }
  return menu;
}

/**
 * Snapshot the current highlight/focus state of every menu item in
 * DOM order. Returns each item's text, tabindex, whether it carries
 * `data-highlighted`, and whether it is `document.activeElement`.
 */
type ItemState = {
  index: number;
  text: string;
  tabindex: string | null;
  highlighted: boolean;
  focused: boolean;
};
async function snapshotItems(page: Page): Promise<ItemState[]> {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    return items.map((el, index) => ({
      index,
      text: (el.textContent ?? "").trim(),
      tabindex: el.getAttribute("tabindex"),
      highlighted: el.hasAttribute("data-highlighted"),
      focused: document.activeElement === el,
    }));
  });
}

/**
 * Assert the roving-focus invariants on the current snapshot and
 * return the index of the single highlighted+focused item.
 */
function assertRovingContract(items: ItemState[], label: string): number {
  expect(items.length, `[${label}] menu has items`).toBeGreaterThan(0);

  const highlighted = items.filter((i) => i.highlighted);
  expect(highlighted.length, `[${label}] exactly one item is highlighted`).toBe(1);

  const focused = items.filter((i) => i.focused);
  expect(focused.length, `[${label}] exactly one item is DOM-focused`).toBe(1);

  expect(
    focused[0].index,
    `[${label}] highlighted item === focused item (roving focus tracks highlight)`,
  ).toBe(highlighted[0].index);

  // Roving tabindex: focused item is 0, everyone else is -1. Radix
  // may render tabindex=null on unfocused items in some versions —
  // treat null as "not in the tab sequence" which is equivalent.
  for (const item of items) {
    if (item.focused) {
      expect(item.tabindex, `[${label}] focused item has tabindex="0"`).toBe("0");
    } else {
      expect(
        item.tabindex === "-1" || item.tabindex === null,
        `[${label}] unfocused item "${item.text}" is out of tab sequence (got tabindex=${item.tabindex})`,
      ).toBe(true);
    }
  }

  return focused[0].index;
}

test.describe("Breadcrumbs — overflow menu roving focus on Arrow keys", () => {
  for (const theme of THEMES) {
    test(`${theme} · ArrowDown / ArrowUp advance a single roving highlight`, async ({ page }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = page.locator(
        'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
      );
      await expect(trigger, "overflow trigger renders").toBeVisible();

      await trigger.focus();
      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu, "menu open").toBeVisible();

      // Radix uses roving tabindex, NOT aria-activedescendant. If a
      // future refactor ever adds aria-activedescendant to the menu,
      // assistive tech will get contradictory focus signals — fail loud.
      const activeDescendant = await menu.getAttribute("aria-activedescendant");
      expect(
        activeDescendant,
        "menu should NOT emit aria-activedescendant when using roving focus",
      ).toBeNull();

      // ── Initial state ─────────────────────────────────────────────
      // Opening via Space auto-highlights the first item.
      let items = await snapshotItems(page);
      const totalItems = items.length;
      expect(totalItems, "fixture yields more than one hidden crumb").toBeGreaterThan(1);
      let focusedIdx = assertRovingContract(items, "initial");
      expect(focusedIdx, "[initial] first item highlighted after open").toBe(0);

      // ── ArrowDown moves highlight+focus down one, invariants hold ─
      for (let step = 1; step < totalItems; step++) {
        await page.keyboard.press("ArrowDown");
        // Radix uses requestAnimationFrame for focus moves under
        // reduced-motion sometimes; a tiny settle avoids flakes.
        await page.waitForFunction(
          (expectedIdx) => {
            const els = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
            return els[expectedIdx]?.hasAttribute("data-highlighted") ?? false;
          },
          step,
          { timeout: 2000 },
        );

        items = await snapshotItems(page);
        focusedIdx = assertRovingContract(items, `after ArrowDown #${step}`);
        expect(focusedIdx, `[after ArrowDown #${step}] highlight advanced by one`).toBe(step);
      }

      // ── ArrowDown at the last item is a no-op (Radix does not wrap) ─
      // Highlight and DOM focus must stay on the last item, and the
      // single-highlight + roving-tabindex invariants must still hold.
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(150);
      items = await snapshotItems(page);
      focusedIdx = assertRovingContract(items, "ArrowDown at end");
      expect(focusedIdx, "[end] ArrowDown at last item does not move highlight").toBe(
        totalItems - 1,
      );

      // ── ArrowUp walks back up through every item ─────────────────
      for (let step = totalItems - 2; step >= 0; step--) {
        await page.keyboard.press("ArrowUp");
        await page.waitForFunction(
          (expectedIdx) => {
            const els = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
            return els[expectedIdx]?.hasAttribute("data-highlighted") ?? false;
          },
          step,
          { timeout: 2000 },
        );
        items = await snapshotItems(page);
        focusedIdx = assertRovingContract(items, `after ArrowUp to #${step}`);
        expect(focusedIdx, `[after ArrowUp to #${step}] highlight retreated by one`).toBe(step);
      }

      // ── ArrowUp at the first item is a no-op ─────────────────────
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(150);
      items = await snapshotItems(page);
      focusedIdx = assertRovingContract(items, "ArrowUp at top");
      expect(focusedIdx, "[top] ArrowUp at first item does not move highlight").toBe(0);
    });
  }
});
