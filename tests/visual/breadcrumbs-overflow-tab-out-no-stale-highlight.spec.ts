import { test, expect } from "./_overflowDebugFixture";
import type { Locator, Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — overflow menu Tab-out close + no-stale-highlight contract.
 *
 * Distinct from `breadcrumbs-overflow-tab-exit.spec.ts` (which verifies
 * the *direction* of Tab / Shift+Tab focus movement): this spec locks
 * in the "no ghost state after Tab close" surface. The historical
 * regression was:
 *
 *   • User opens the overflow menu, ArrowDowns to a non-first row,
 *     Tabs out to advance focus past the trigger.
 *   • Menu unmounts, but the previously-highlighted row's
 *     `data-highlighted` / `tabindex="0"` leaks in the portal tree
 *     because Radix's teardown ran after the focus move.
 *   • Re-opening the menu (or the next keyboard user landing on it)
 *     saw two highlighted items — the auto-highlighted first row
 *     AND the ghost — which broke arrow navigation.
 *
 * We prove all four contract points in both themes:
 *
 *   1. `aria-expanded="true"` while open; walking with ArrowDown moves
 *      the single highlight OFF index 0 (so the reset assertion later
 *      isn't a tautology).
 *   2. Pressing Tab closes the menu (`role="menu"` gone) AND flips
 *      the trigger's `aria-expanded` back to `"false"`.
 *   3. Focus moves forward — it is NOT on the trigger, NOT on <body>,
 *      NOT on any element that still carries `role="menuitem"`. It
 *      lands on the next-tabbable neighbour of the trigger in document
 *      order.
 *   4. Nothing in the DOM carries `data-highlighted` after Tab close,
 *      no orphan `role="menuitem"` remains, and re-opening the menu
 *      restarts the highlight at index 0 with exactly one highlighted
 *      row — the ghost never reappears.
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

function overflowTrigger(page: Page): Locator {
  return page.locator('nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]');
}

/**
 * Enumerate the trigger's next tabbable sibling in the *live* DOM,
 * computed while the menu is closed so portal content can't skew the
 * enumeration. Returned as a descriptor we can compare to whatever
 * ends up as `document.activeElement` after Tab.
 */
async function nextTabbableAfterTrigger(page: Page) {
  return page.evaluate(() => {
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
    const next = tabbable[idx + 1];
    if (!next) return null;
    return {
      tag: next.tagName.toLowerCase(),
      text: (next.textContent ?? "").trim().slice(0, 80),
      ariaLabel: next.getAttribute("aria-label"),
    };
  });
}

async function activeElementDescriptor(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) {
      return {
        tag: el ? el.tagName.toLowerCase() : "null",
        role: null as string | null,
        text: "",
        ariaLabel: null as string | null,
        isBody: true,
        isMenuItem: false,
        isTrigger: false,
      };
    }
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      text: (el.textContent ?? "").trim().slice(0, 80),
      ariaLabel: el.getAttribute("aria-label"),
      isBody: false,
      isMenuItem: el.getAttribute("role") === "menuitem",
      isTrigger:
        el.tagName === "BUTTON" && /hidden breadcrumb/i.test(el.getAttribute("aria-label") ?? ""),
    };
  });
}

test.describe("Breadcrumbs — Tab closes overflow menu without leaking highlighted state", () => {
  for (const theme of THEMES) {
    test(`${theme} · Tab out of walked menu → aria-expanded false, focus advances, no ghost highlight on reopen`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = overflowTrigger(page);
      await expect(trigger, "overflow trigger renders").toBeVisible();
      await expect(trigger, "starts collapsed").toHaveAttribute("aria-expanded", "false");

      // Snapshot the intended focus destination BEFORE opening the
      // menu — portalled menu items would otherwise pollute the
      // tabbable enumeration.
      const expectedNext = await nextTabbableAfterTrigger(page);
      expect(
        expectedNext,
        "fixture has a next tabbable element after the overflow trigger",
      ).not.toBeNull();

      // ── 1. Open + walk highlight OFF index 0 ────────────────────
      await trigger.focus();
      const menu = await openMenu(page, trigger, {
        activation: "Space",
        label: `overflow menu (${theme})`,
      });
      await expect(menu, "menu visible after open").toBeVisible();
      await expect(trigger, "aria-expanded=true while menu is open").toHaveAttribute(
        "aria-expanded",
        "true",
      );

      // Wait for Radix auto-highlight so the ArrowDown lands deterministically.
      await page.waitForFunction(
        () => {
          const first = document.querySelector<HTMLElement>('[role="menuitem"]');
          return !!first && first.hasAttribute("data-highlighted");
        },
        undefined,
        { timeout: 2000 },
      );

      const itemCount = await page.locator('[role="menuitem"]').count();
      expect(itemCount, "fixture yields multiple hidden crumbs").toBeGreaterThan(1);

      await page.keyboard.press("ArrowDown");
      await page.waitForFunction(
        () => {
          const els = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
          return els[1]?.hasAttribute("data-highlighted") ?? false;
        },
        undefined,
        { timeout: 2000 },
      );

      const walkedHighlight = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
        const highlightedIndices = items
          .map((el, i) => (el.hasAttribute("data-highlighted") ? i : -1))
          .filter((i) => i >= 0);
        return { highlightedIndices, count: items.length };
      });
      expect(
        walkedHighlight.highlightedIndices,
        "exactly one item highlighted after walking (single, at index 1)",
      ).toEqual([1]);

      // ── 2. Tab out closes menu + flips aria-expanded ────────────
      await page.keyboard.press("Tab");

      await expect(menu, "menu is removed from the DOM by Tab").toHaveCount(0);
      await expect(trigger, "aria-expanded flips back to false after Tab").toHaveAttribute(
        "aria-expanded",
        "false",
      );

      // ── 3. Focus is on the next logical element ─────────────────
      const active = await activeElementDescriptor(page);
      expect(active.isBody, "focus is NOT lost to <body> after Tab").toBe(false);
      expect(active.isTrigger, "focus does NOT stay on the trigger after Tab").toBe(false);
      expect(active.isMenuItem, "focus is NOT on a menu item after Tab").toBe(false);
      expect(active.tag, "focus tag matches expected next tabbable").toBe(expectedNext!.tag);
      if (expectedNext!.ariaLabel) {
        expect(active.ariaLabel, "focus aria-label matches expected next tabbable").toBe(
          expectedNext!.ariaLabel,
        );
      } else {
        expect(active.text, "focus text matches expected next tabbable").toBe(expectedNext!.text);
      }

      // ── 4. No stale highlight / no orphan menu state ────────────
      const orphanMenuItems = await page.locator('[role="menuitem"]').count();
      expect(orphanMenuItems, 'no orphan role="menuitem" left in DOM after Tab close').toBe(0);

      const stragglers = await page.locator("[data-highlighted]").count();
      expect(
        stragglers,
        "no element in the document carries data-highlighted after Tab close",
      ).toBe(0);

      const orphanTabindexZero = await page.evaluate(() => {
        // Any lingering portal chunk that still holds tabindex=0 would
        // silently re-enter the tab sequence. Assert none exist inside
        // aria-hidden / detached menu content.
        return Array.from(document.querySelectorAll<HTMLElement>('[tabindex="0"]')).filter(
          (el) => el.getAttribute("role") === "menuitem",
        ).length;
      });
      expect(orphanTabindexZero, 'no menuitem retains tabindex="0" after menu teardown').toBe(0);

      // ── 5. Re-open restarts highlight at index 0 (no ghost) ──────
      // Return focus to the trigger and reopen. The walked highlight
      // (index 1) must NOT reappear — Radix must start fresh.
      await trigger.focus();
      const menu2 = await openMenu(page, trigger, {
        activation: "Space",
        label: `overflow menu (${theme}, reopen after Tab)`,
      });
      await expect(menu2, "menu visible on reopen after Tab close").toBeVisible();

      await page.waitForFunction(
        () => {
          const first = document.querySelector<HTMLElement>('[role="menuitem"]');
          return !!first && first.hasAttribute("data-highlighted");
        },
        undefined,
        { timeout: 2000 },
      );

      const reopen = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
        return {
          count: items.length,
          highlightedIndices: items
            .map((el, i) => (el.hasAttribute("data-highlighted") ? i : -1))
            .filter((i) => i >= 0),
        };
      });

      expect(reopen.count, "reopened menu has items").toBeGreaterThan(0);
      expect(
        reopen.highlightedIndices,
        "exactly one item highlighted on reopen, at index 0 (no ghost from previous walk)",
      ).toEqual([0]);
    });
  }
});
