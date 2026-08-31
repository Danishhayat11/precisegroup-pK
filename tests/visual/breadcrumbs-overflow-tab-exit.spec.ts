import { test, expect } from "./_overflowDebugFixture";
import type { Locator, Page } from "@playwright/test";

/**
 * Breadcrumbs — overflow menu Tab / Shift+Tab exit contract.
 *
 * Radix DropdownMenu implements the WAI-ARIA menu pattern, which is
 * intentionally a *closed* tab stop: Tab and Shift+Tab do NOT cycle
 * between menu items (that's what Arrow keys are for). Instead:
 *
 *   • Tab       → close the menu and move focus to the NEXT tabbable
 *                 element in document order after the trigger.
 *   • Shift+Tab → close the menu and move focus to the PREVIOUS
 *                 tabbable element in document order before the trigger.
 *
 * This behaviour is what keeps the trigger from becoming a focus trap
 * for keyboard-only users, and is why the roving-tabindex model works
 * inside the menu in the first place — only ONE item has tabindex=0
 * at a time, but Tab still exits cleanly because Radix intercepts it.
 *
 * This spec verifies, for both directions:
 *
 *   1. While the menu is open, the roving-tabindex invariants hold
 *      (exactly one highlighted + focused item, that item has
 *      tabindex="0", all others are tabindex="-1"|null).
 *   2. Pressing Tab (or Shift+Tab) closes the menu — `role="menu"`
 *      disappears from the DOM.
 *   3. Focus lands on the correct sibling relative to the trigger in
 *      document tab order, NOT on a menu item and NOT lost to <body>.
 *   4. The trigger's `aria-expanded` returns to `"false"` and the
 *      inert menu contents no longer participate in the tab sequence
 *      (i.e. no orphan tabindex="0" left behind by the roving model).
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

  expect(focused[0].index, `[${label}] highlighted item === focused item`).toBe(
    highlighted[0].index,
  );

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

/**
 * Compute the expected tab-order neighbour of the trigger in the
 * *live* DOM, so the assertion doesn't hard-code fixture layout.
 * We enumerate everything the browser treats as tabbable and pick
 * the element immediately before / after the trigger.
 */
async function neighbourOfTrigger(
  page: Page,
  direction: "next" | "prev",
): Promise<{ tag: string; text: string; ariaLabel: string | null } | null> {
  return page.evaluate((dir) => {
    const isVisible = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      const style = getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none";
    };
    const tabbable = Array.from(
      document.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => {
      const ti = el.getAttribute("tabindex");
      // Radix keeps the *inactive* menu items at tabindex=-1 which
      // the querySelector filter already drops, but be defensive.
      if (ti === "-1") return false;
      if (el.closest('[aria-hidden="true"]')) return false;
      return isVisible(el);
    });
    const trigger = document.querySelector<HTMLElement>(
      'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
    );
    if (!trigger) return null;
    const idx = tabbable.indexOf(trigger);
    if (idx === -1) return null;
    const target = dir === "next" ? tabbable[idx + 1] : tabbable[idx - 1];
    if (!target) return null;
    return {
      tag: target.tagName.toLowerCase(),
      text: (target.textContent ?? "").trim().slice(0, 80),
      ariaLabel: target.getAttribute("aria-label"),
    };
  }, direction);
}

async function activeElementDescriptor(page: Page): Promise<{
  tag: string;
  role: string | null;
  text: string;
  ariaLabel: string | null;
  isBody: boolean;
  isMenuItem: boolean;
}> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) {
      return {
        tag: "null",
        role: null,
        text: "",
        ariaLabel: null,
        isBody: true,
        isMenuItem: false,
      };
    }
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      text: (el.textContent ?? "").trim().slice(0, 80),
      ariaLabel: el.getAttribute("aria-label"),
      isBody: el === document.body,
      isMenuItem: el.getAttribute("role") === "menuitem",
    };
  });
}

test.describe("Breadcrumbs — overflow menu Tab / Shift+Tab exit", () => {
  for (const theme of THEMES) {
    test(`${theme} · Tab closes menu and moves focus to next tabbable after trigger`, async ({
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

      // Capture where Tab from the trigger *should* land — computed
      // BEFORE the menu opens so portal content doesn't skew the
      // tabbable enumeration.
      const expectedNext = await neighbourOfTrigger(page, "next");
      expect(expectedNext, "trigger has a next tabbable sibling in the fixture").not.toBeNull();

      await trigger.focus();
      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu, "menu open").toBeVisible();
      await expect(trigger, "aria-expanded=true while open").toHaveAttribute(
        "aria-expanded",
        "true",
      );

      // Roving-focus invariants hold while open (first item highlighted).
      let items = await snapshotItems(page);
      const openIdx = assertRovingContract(items, "menu open, before Tab");
      expect(openIdx, "[menu open] first item highlighted after Space").toBe(0);

      // ── Tab: close + advance ───────────────────────────────────────
      await page.keyboard.press("Tab");

      // Menu is portalled + animated; wait for it to fully leave the DOM.
      await expect(menu, "menu is closed by Tab").toHaveCount(0);
      await expect(trigger, "aria-expanded=false after Tab").toHaveAttribute(
        "aria-expanded",
        "false",
      );

      const active = await activeElementDescriptor(page);
      expect(active.isMenuItem, "focus is NOT on a menu item after exit").toBe(false);
      expect(active.isBody, "focus is NOT lost to <body> after exit").toBe(false);
      expect(active.tag, "focus tag matches expected next tabbable").toBe(expectedNext!.tag);
      // Prefer aria-label when present (buttons often have both text and label);
      // fall back to text otherwise.
      if (expectedNext!.ariaLabel) {
        expect(active.ariaLabel, "focus aria-label matches expected next tabbable").toBe(
          expectedNext!.ariaLabel,
        );
      } else {
        expect(active.text, "focus text matches expected next tabbable").toBe(expectedNext!.text);
      }

      // No orphan roving state after close: role="menuitem" elements
      // are gone entirely (menu unmounted), so no stray tabindex="0"
      // can be sitting in the tab sequence.
      const orphanMenuItems = await page.locator('[role="menuitem"]').count();
      expect(orphanMenuItems, "no orphan menuitem left in DOM after close").toBe(0);
    });

    test(`${theme} · Shift+Tab closes menu and moves focus to previous tabbable before trigger`, async ({
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

      const expectedPrev = await neighbourOfTrigger(page, "prev");
      expect(expectedPrev, "trigger has a previous tabbable sibling in the fixture").not.toBeNull();

      await trigger.focus();
      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu, "menu open").toBeVisible();
      await expect(trigger, "aria-expanded=true while open").toHaveAttribute(
        "aria-expanded",
        "true",
      );

      // Move highlight off the first item to prove Shift+Tab doesn't
      // "restore" state — it must close regardless of which item was
      // highlighted, and never leave a phantom highlight behind.
      await page.keyboard.press("ArrowDown");
      await page.waitForFunction(
        () => {
          const els = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
          return els[1]?.hasAttribute("data-highlighted") ?? false;
        },
        undefined,
        { timeout: 2000 },
      );

      let items = await snapshotItems(page);
      const openIdx = assertRovingContract(items, "menu open, second item highlighted");
      expect(openIdx, "[menu open] second item highlighted before Shift+Tab").toBe(1);

      // ── Shift+Tab: close + retreat ─────────────────────────────────
      await page.keyboard.press("Shift+Tab");

      await expect(menu, "menu is closed by Shift+Tab").toHaveCount(0);
      await expect(trigger, "aria-expanded=false after Shift+Tab").toHaveAttribute(
        "aria-expanded",
        "false",
      );

      const active = await activeElementDescriptor(page);
      expect(active.isMenuItem, "focus is NOT on a menu item after exit").toBe(false);
      expect(active.isBody, "focus is NOT lost to <body> after exit").toBe(false);
      expect(active.tag, "focus tag matches expected previous tabbable").toBe(expectedPrev!.tag);
      if (expectedPrev!.ariaLabel) {
        expect(active.ariaLabel, "focus aria-label matches expected previous tabbable").toBe(
          expectedPrev!.ariaLabel,
        );
      } else {
        expect(active.text, "focus text matches expected previous tabbable").toBe(
          expectedPrev!.text,
        );
      }

      const orphanMenuItems = await page.locator('[role="menuitem"]').count();
      expect(orphanMenuItems, "no orphan menuitem left in DOM after close").toBe(0);

      // Re-open and confirm state is clean: first item highlighted
      // again, roving contract intact. This guards against Radix
      // caching the previous highlight across close/reopen cycles.
      await trigger.focus();
      const menu2 = await openMenuByKeyboard(page, trigger);
      await expect(menu2, "menu reopens cleanly after Shift+Tab exit").toBeVisible();
      items = await snapshotItems(page);
      const reopenIdx = assertRovingContract(items, "reopened after Shift+Tab");
      expect(reopenIdx, "[reopen] highlight resets to first item").toBe(0);
    });
  }
});
