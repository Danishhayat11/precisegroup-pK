import { test, expect } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — overflow menu Shift+Escape close + Tab / Shift+Tab
 * navigation contract.
 *
 * Background: Radix `DropdownMenu` binds its "close" handler to the
 * Escape key without inspecting `event.shiftKey`, so Shift+Escape is
 * treated as Escape — the menu closes, focus returns to the trigger.
 * That's the ONLY correct outcome for a menu widget (any other
 * interpretation would silently mutate a global keyboard shortcut
 * users expect to work identically).
 *
 * Regression window this spec locks down:
 *
 *   • The menu portal or its Radix "focus scope" wrapper occasionally
 *     leaves a hidden `<span data-radix-focus-guard>` / `<div>` with
 *     `tabindex="0"` mounted after the modifier-Escape teardown. When
 *     that happens, the next Tab press lands on that invisible node
 *     and the *visible* next-sibling gets skipped. Shift+Tab from
 *     there jumps back over the trigger and lands two elements
 *     earlier than intended.
 *   • Radix versions that inspect modifier state have historically
 *     ignored Shift+Escape entirely — the menu stays open, the
 *     next Tab moves the highlight instead of exiting the menu, and
 *     Shift+Tab from the next sibling never returns to the trigger.
 *
 * The spec verifies, in both themes:
 *
 *   1. Baseline tab order around the trigger — captured with the
 *      menu closed, so no portal content pollutes the enumeration.
 *      Records both the trigger's next and previous tabbable
 *      neighbours as descriptors.
 *   2. Open the menu with Space. `aria-expanded="true"`.
 *   3. Press Shift+Escape. The menu unmounts (`role="menu"` gone),
 *      `aria-expanded` returns to `"false"`, and focus is on the
 *      overflow trigger — same contract as plain Escape.
 *   4. Press Tab from the trigger. Active element MUST match the
 *      recorded "next" descriptor exactly — no skipping over an
 *      orphan focus guard, no landing on <body>, no landing back on
 *      a menu item.
 *   5. Press Shift+Tab from that landing spot. Focus MUST return to
 *      the overflow trigger — proves the reverse direction isn't
 *      skipping either.
 *   6. Press Shift+Tab again from the trigger. Active element MUST
 *      match the recorded "previous" descriptor exactly — same
 *      no-skip guarantee in the backward direction.
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

type TabDescriptor = {
  tag: string;
  text: string;
  ariaLabel: string | null;
  role: string | null;
};

/**
 * Enumerate the trigger's neighbours in the *live* DOM. Called only
 * while the menu is closed so portalled menu content can't skew the
 * tabbable list.
 */
async function neighboursOfTrigger(page: Page): Promise<{
  next: TabDescriptor | null;
  prev: TabDescriptor | null;
}> {
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
    if (!trigger) return { next: null, prev: null };
    const idx = tabbable.indexOf(trigger);
    if (idx === -1) return { next: null, prev: null };
    const describe = (el: HTMLElement | undefined) =>
      el
        ? {
            tag: el.tagName.toLowerCase(),
            text: (el.textContent ?? "").trim().slice(0, 80),
            ariaLabel: el.getAttribute("aria-label"),
            role: el.getAttribute("role"),
          }
        : null;
    return {
      next: describe(tabbable[idx + 1]),
      prev: describe(tabbable[idx - 1]),
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
        isFocusGuard: false,
      };
    }
    const rect = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      text: (el.textContent ?? "").trim().slice(0, 80),
      ariaLabel: el.getAttribute("aria-label"),
      isBody: false,
      isMenuItem: el.getAttribute("role") === "menuitem",
      isTrigger:
        el.tagName === "BUTTON" && /hidden breadcrumb/i.test(el.getAttribute("aria-label") ?? ""),
      // Radix focus-scope guards render as 0x0 tabindex=0 spans. A
      // "skipped visible neighbour" almost always means one of these
      // grabbed focus after the menu closed.
      isFocusGuard:
        (rect.width === 0 && rect.height === 0) || el.hasAttribute("data-radix-focus-guard"),
    };
  });
}

function expectDescriptorMatch(
  actual: Awaited<ReturnType<typeof activeElementDescriptor>>,
  expected: TabDescriptor,
  label: string,
) {
  expect(actual.isBody, `[${label}] focus is NOT lost to <body>`).toBe(false);
  expect(actual.isMenuItem, `[${label}] focus is NOT on a menu item`).toBe(false);
  expect(
    actual.isFocusGuard,
    `[${label}] focus is NOT on a Radix focus-guard / 0x0 element (would mean the visible neighbour was skipped)`,
  ).toBe(false);
  expect(actual.tag, `[${label}] focus tag matches expected neighbour`).toBe(expected.tag);
  if (expected.ariaLabel) {
    expect(actual.ariaLabel, `[${label}] focus aria-label matches expected neighbour`).toBe(
      expected.ariaLabel,
    );
  } else {
    expect(actual.text, `[${label}] focus text matches expected neighbour`).toBe(expected.text);
  }
}

test.describe("Breadcrumbs — Shift+Escape closes overflow menu and preserves Tab / Shift+Tab order", () => {
  for (const theme of THEMES) {
    test(`${theme} · Shift+Escape → Tab lands on next neighbour, Shift+Tab returns cleanly (no skipped elements)`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = overflowTrigger(page);
      await expect(trigger, "overflow trigger renders").toBeVisible();
      await expect(trigger, "starts collapsed").toHaveAttribute("aria-expanded", "false");

      // ── 1. Baseline neighbours (captured with menu closed) ──────
      const { next: expectedNext, prev: expectedPrev } = await neighboursOfTrigger(page);
      expect(expectedNext, "trigger has a next tabbable neighbour").not.toBeNull();
      expect(expectedPrev, "trigger has a previous tabbable neighbour").not.toBeNull();

      // ── 2. Open with Space ──────────────────────────────────────
      await trigger.focus();
      const menu = await openMenu(page, trigger, {
        activation: "Space",
        label: `overflow menu (${theme})`,
      });
      await expect(menu, "menu visible after open").toBeVisible();
      await expect(trigger, 'aria-expanded="true" while menu is open').toHaveAttribute(
        "aria-expanded",
        "true",
      );
      // Wait for Radix's post-open auto-highlight so the pre-Escape
      // state is deterministic.
      await page.waitForFunction(
        () => {
          const first = document.querySelector<HTMLElement>('[role="menuitem"]');
          return !!first && first.hasAttribute("data-highlighted");
        },
        undefined,
        { timeout: 2000 },
      );

      // ── 3. Shift+Escape: same close contract as plain Escape ────
      await page.keyboard.press("Shift+Escape");

      await expect(menu, "menu unmounts on Shift+Escape (treated as Escape)").toHaveCount(0);
      await expect(
        trigger,
        'aria-expanded flips back to "false" after Shift+Escape',
      ).toHaveAttribute("aria-expanded", "false");

      // No orphan Radix state left behind — this is the pre-condition
      // for the Tab-order assertions below to be meaningful.
      const orphanMenuItems = await page.locator('[role="menuitem"]').count();
      expect(orphanMenuItems, 'no orphan role="menuitem" left in DOM after Shift+Escape').toBe(0);

      const triggerFocused = await trigger.evaluate((el) => el === document.activeElement);
      expect(triggerFocused, "focus returns to overflow trigger after Shift+Escape").toBe(true);

      // ── 4. Tab from trigger lands on the next visible neighbour ─
      await page.keyboard.press("Tab");
      const afterTab = await activeElementDescriptor(page);
      expectDescriptorMatch(afterTab, expectedNext!, "Tab from trigger");

      // ── 5. Shift+Tab from the next neighbour returns to trigger ─
      await page.keyboard.press("Shift+Tab");
      const backOnTrigger = await activeElementDescriptor(page);
      expect(
        backOnTrigger.isTrigger,
        "Shift+Tab from the next neighbour returns focus to the overflow trigger (no skip)",
      ).toBe(true);
      // Sanity: aria-expanded still false — Shift+Tab must not
      // re-open the menu on the way back.
      await expect(
        trigger,
        'aria-expanded stays "false" while tabbing backward through the trigger',
      ).toHaveAttribute("aria-expanded", "false");

      // ── 6. Shift+Tab again lands on the previous neighbour ──────
      await page.keyboard.press("Shift+Tab");
      const afterShiftTab = await activeElementDescriptor(page);
      expectDescriptorMatch(afterShiftTab, expectedPrev!, "Shift+Tab from trigger");
    });
  }
});
