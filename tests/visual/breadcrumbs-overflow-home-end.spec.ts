import { test, expect } from "./_overflowDebugFixture";
import type { Locator, Page } from "@playwright/test";

/**
 * Breadcrumbs — overflow menu Home / End key contract.
 *
 * Radix DropdownMenu uses a *roving tabindex* focus model (see
 * breadcrumbs-overflow-arrow-navigation.spec.ts for the full write-up).
 *
 * The WAI-ARIA Authoring Practices menu pattern also requires:
 *   • Home  → move focus to the FIRST menu item
 *   • End   → move focus to the LAST menu item
 *
 * This spec verifies both, and — critically — that the roving-tabindex
 * invariants still hold after each jump:
 *
 *   1. Exactly one item has `data-highlighted`.
 *   2. That same item is `document.activeElement`.
 *   3. The focused item has `tabindex="0"`; every other item has
 *      `tabindex="-1"` (or no tabindex at all, which is equivalent —
 *      out of the tab sequence).
 *   4. The menu never emits `aria-activedescendant` (roving focus and
 *      activedescendant are mutually exclusive patterns).
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

test.describe("Breadcrumbs — overflow menu Home / End roving focus", () => {
  for (const theme of THEMES) {
    test(`${theme} · Home / End jump to first / last item and preserve roving tabindex`, async ({
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

      await trigger.focus();
      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu, "menu open").toBeVisible();

      // Roving focus and aria-activedescendant are mutually exclusive.
      const activeDescendant = await menu.getAttribute("aria-activedescendant");
      expect(
        activeDescendant,
        "menu should NOT emit aria-activedescendant when using roving focus",
      ).toBeNull();

      // Opening via Space auto-highlights the first item.
      let items = await snapshotItems(page);
      const totalItems = items.length;
      expect(totalItems, "fixture yields more than one hidden crumb").toBeGreaterThan(1);
      let focusedIdx = assertRovingContract(items, "initial");
      expect(focusedIdx, "[initial] first item highlighted after open").toBe(0);

      // ── End → jump to LAST item ─────────────────────────────────────
      await page.keyboard.press("End");
      await page.waitForFunction(
        (lastIdx) => {
          const els = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
          return els[lastIdx]?.hasAttribute("data-highlighted") ?? false;
        },
        totalItems - 1,
        { timeout: 2000 },
      );
      items = await snapshotItems(page);
      focusedIdx = assertRovingContract(items, "after End");
      expect(focusedIdx, "[after End] highlight jumped to last item").toBe(totalItems - 1);

      // ── Home → jump back to FIRST item ──────────────────────────────
      await page.keyboard.press("Home");
      await page.waitForFunction(
        () => {
          const els = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
          return els[0]?.hasAttribute("data-highlighted") ?? false;
        },
        undefined,
        { timeout: 2000 },
      );
      items = await snapshotItems(page);
      focusedIdx = assertRovingContract(items, "after Home");
      expect(focusedIdx, "[after Home] highlight jumped to first item").toBe(0);

      // ── Home again is idempotent (stays on first, invariants hold) ─
      await page.keyboard.press("Home");
      await page.waitForTimeout(150);
      items = await snapshotItems(page);
      focusedIdx = assertRovingContract(items, "Home at first");
      expect(focusedIdx, "[Home at first] no-op stays on first").toBe(0);

      // ── Walk to a middle item via ArrowDown, then End must still land last ─
      // Guards against a regression where End was implemented as
      // "advance N times" instead of "jump to last".
      const midTarget = Math.min(2, totalItems - 1);
      for (let i = 0; i < midTarget; i++) {
        await page.keyboard.press("ArrowDown");
      }
      await page.waitForFunction(
        (idx) => {
          const els = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
          return els[idx]?.hasAttribute("data-highlighted") ?? false;
        },
        midTarget,
        { timeout: 2000 },
      );
      items = await snapshotItems(page);
      assertRovingContract(items, `mid via ArrowDown #${midTarget}`);

      await page.keyboard.press("End");
      await page.waitForFunction(
        (lastIdx) => {
          const els = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
          return els[lastIdx]?.hasAttribute("data-highlighted") ?? false;
        },
        totalItems - 1,
        { timeout: 2000 },
      );
      items = await snapshotItems(page);
      focusedIdx = assertRovingContract(items, "End from middle");
      expect(focusedIdx, "[End from middle] jumps to last regardless of origin").toBe(
        totalItems - 1,
      );

      // ── End again is idempotent ─────────────────────────────────────
      await page.keyboard.press("End");
      await page.waitForTimeout(150);
      items = await snapshotItems(page);
      focusedIdx = assertRovingContract(items, "End at last");
      expect(focusedIdx, "[End at last] no-op stays on last").toBe(totalItems - 1);

      // ── aria-activedescendant must still be absent after all jumps ──
      const activeDescendantAfter = await menu.getAttribute("aria-activedescendant");
      expect(
        activeDescendantAfter,
        "menu still uses roving focus (no aria-activedescendant) after Home/End",
      ).toBeNull();
    });
  }
});
