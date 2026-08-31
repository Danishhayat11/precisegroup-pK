import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — after Escape closes the overflow menu, a single Tab
 * advances focus to the next logical tabbable AND does NOT reopen the
 * menu.
 *
 * Complements `breadcrumbs-overflow-tab-after-escape.spec.ts`, which
 * asserts the "landing spot matches DOM order" half of this contract.
 * This spec locks the OTHER half: pressing Tab must never re-summon
 * the menu portal, never restore aria-expanded="true", never revive a
 * stale menuitem, and must not race against a delayed Radix reopen.
 *
 * A prior regression flavor: Radix's `DropdownMenu` briefly re-set
 * `open` in a microtask when focus left the trigger while a `keydown`
 * from the trigger was still being replayed after Escape — the visible
 * symptom was the menu blinking back into view on Tab.
 *
 * Contract, in both themes:
 *   1. Open → walk to a non-first row → Escape. Menu unmounts, focus
 *      returns to the trigger, aria-expanded="false".
 *   2. Press Tab exactly once.
 *   3. Immediately (no artificial wait) and after a settle period:
 *      - `role="menu"` count === 0
 *      - `[role="menuitem"]` count === 0
 *      - overflow trigger's `aria-expanded` still `"false"`
 *      - no `[data-radix-focus-guard]` present
 *   4. `document.activeElement` is NOT `<body>`, NOT the trigger
 *      (proves Tab actually advanced), NOT a `menuitem`, NOT a
 *      focus-guard, and IS a visible, tabbable element that follows
 *      the trigger in DOM order.
 *   5. URL is unchanged — Escape+Tab never navigates.
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

function overflowTrigger(page: Page) {
  return page.locator('nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]');
}

/** Snapshot every signal that would fire if the menu had reopened. */
async function menuClosedSnapshot(page: Page) {
  return page.evaluate(() => {
    const trigger = document.querySelector<HTMLElement>(
      'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
    );
    return {
      menuCount: document.querySelectorAll('[role="menu"]').length,
      menuItemCount: document.querySelectorAll('[role="menuitem"]').length,
      focusGuardCount: document.querySelectorAll("[data-radix-focus-guard]").length,
      triggerAriaExpanded: trigger?.getAttribute("aria-expanded") ?? null,
    };
  });
}

async function activeAfterTab(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    const trigger = document.querySelector<HTMLElement>(
      'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
    );
    if (!el || el === document.body) {
      return {
        isBody: true,
        isTrigger: false,
        isMenuItem: false,
        isFocusGuard: false,
        followsTrigger: false,
        visible: false,
        tabbable: false,
        tag: el ? el.tagName.toLowerCase() : "null",
        role: null as string | null,
        label: "",
      };
    }
    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    const visible =
      rect.width > 0 && rect.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    const ti = el.tabIndex;
    return {
      isBody: false,
      isTrigger: !!trigger && el === trigger,
      isMenuItem: el.getAttribute("role") === "menuitem",
      isFocusGuard:
        el.hasAttribute("data-radix-focus-guard") || (rect.width === 0 && rect.height === 0),
      followsTrigger:
        !!trigger && (trigger.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      visible,
      tabbable: ti >= 0 && !(el as HTMLButtonElement).disabled,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      label:
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        (el.textContent ?? "").trim().slice(0, 60),
    };
  });
}

test.describe("Breadcrumbs overflow · Tab after Escape advances focus without reopening the menu", () => {
  for (const theme of THEMES) {
    test(`${theme} · Escape → Tab moves focus off trigger, menu stays closed`, async ({ page }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const urlBefore = page.url();

      const trigger = overflowTrigger(page);
      await expect(trigger, "overflow trigger renders").toBeVisible();

      // Open via Space so Radix auto-highlights index 0, then walk to
      // a non-first row so the Escape close originates from mid-menu.
      await trigger.focus();
      const menu = await openMenu(page, trigger, {
        activation: "Space",
        label: `overflow menu (${theme})`,
      });
      await expect(menu, "menu open").toBeVisible();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");

      // Escape — menu unmounts, focus returns to trigger.
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu"), "menu unmounted after Escape").toHaveCount(0);
      await expect(trigger, "aria-expanded=false after Escape").toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(trigger, "focus back on trigger after Escape").toBeFocused();

      // ── Tab once ─────────────────────────────────────────────────
      await page.keyboard.press("Tab");

      // Check IMMEDIATELY — catches a synchronous reopen fired from
      // the same event tick.
      const immediate = await menuClosedSnapshot(page);
      expect(immediate.menuCount, "menu did NOT reopen synchronously on Tab").toBe(0);
      expect(immediate.menuItemCount, "no stale menuitems synchronously after Tab").toBe(0);
      expect(
        immediate.triggerAriaExpanded,
        'aria-expanded stays "false" synchronously after Tab',
      ).toBe("false");

      // Then wait a beat and re-check — catches a microtask/setTimeout
      // reopen that races with focus movement.
      await page.waitForTimeout(150);
      const settled = await menuClosedSnapshot(page);
      expect(settled.menuCount, "menu did NOT reopen after settle (microtask/rAF reopen)").toBe(0);
      expect(settled.menuItemCount, "no stale menuitems after settle").toBe(0);
      expect(settled.focusGuardCount, "no Radix focus-guards linger after Escape+Tab").toBe(0);
      expect(settled.triggerAriaExpanded, 'aria-expanded stays "false" after settle').toBe("false");

      // ── Focus landed on a real next tabbable ─────────────────────
      const active = await activeAfterTab(page);
      expect(active.isBody, "Tab did NOT fall through to <body>").toBe(false);
      expect(active.isMenuItem, "Tab did NOT land on a stale menuitem").toBe(false);
      expect(
        active.isFocusGuard,
        `Tab did NOT land on a Radix focus-guard (tag=${active.tag})`,
      ).toBe(false);
      expect(active.isTrigger, "Tab actually advanced off the trigger").toBe(false);
      expect(
        active.followsTrigger,
        `focus moved to an element AFTER the trigger in DOM order (tag=${active.tag}, label="${active.label}")`,
      ).toBe(true);
      expect(active.visible, `resting focus target is visible (tag=${active.tag})`).toBe(true);
      expect(
        active.tabbable,
        `resting focus target is genuinely tabbable (tag=${active.tag}, role=${active.role ?? ""})`,
      ).toBe(true);

      // Escape+Tab must not navigate.
      expect(page.url(), "Escape+Tab did not change the URL").toBe(urlBefore);
    });
  }
});
