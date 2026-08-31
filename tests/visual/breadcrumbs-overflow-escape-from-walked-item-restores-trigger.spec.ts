import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — Escape from a walked-to overflow menu item restores
 * focus to the trigger AND flips aria-expanded back to "false".
 *
 * Tightens the escape/close contract at a specific slice not otherwise
 * pinned in one spec:
 *
 *   - Focus is moved *by keyboard walking* onto a non-first menuitem
 *     (index 1) so we prove Radix doesn't stash a stale "opened-from"
 *     focus and blindly restore it.
 *   - Escape is pressed while that walked row owns focus / highlight.
 *   - After Escape: aria-expanded === "false", role="menu" is gone,
 *     document.activeElement === the overflow trigger button, and the
 *     URL did not change (Escape must not navigate).
 *
 * Runs against both themes so a theme-scoped focus regression can't
 * hide behind the default.
 */

const THEMES = ["light", "dark"] as const;
const FIXTURE_URL = "/crumb-fixture/alpha/beta/gamma/delta/epsilon";
const TARGET_INDEX = 1;

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

async function waitForHighlightIndex(page: Page, index: number) {
  await page.waitForFunction(
    (i) => {
      const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      return items[i]?.hasAttribute("data-highlighted") ?? false;
    },
    index,
    { timeout: 2000 },
  );
}

async function waitForFirstAutoHighlight(page: Page) {
  await page.waitForFunction(
    () => {
      const first = document.querySelector<HTMLElement>('[role="menuitem"]');
      return !!first && first.hasAttribute("data-highlighted");
    },
    undefined,
    { timeout: 2000 },
  );
}

test.describe("Breadcrumbs — Escape from a walked overflow item returns focus to trigger with aria-expanded=false", () => {
  for (const theme of THEMES) {
    test(`${theme} · walk to menuitem[${TARGET_INDEX}] then Escape restores focus + collapses aria-expanded`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const urlBefore = page.url();

      const trigger = overflowTrigger(page);
      await expect(trigger, "overflow trigger renders").toBeVisible();
      await expect(trigger, "starts collapsed").toHaveAttribute("aria-expanded", "false");

      // Open via keyboard (Space) so Radix auto-highlights index 0.
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
      await waitForFirstAutoHighlight(page);

      const itemCount = await page.locator('[role="menuitem"]').count();
      expect(itemCount, "fixture yields enough hidden crumbs").toBeGreaterThan(TARGET_INDEX);

      // Walk focus/highlight onto a specific NON-first row so the
      // Escape assertion proves the trigger is restored regardless of
      // which row was focused.
      for (let i = 0; i < TARGET_INDEX; i++) {
        await page.keyboard.press("ArrowDown");
      }
      await waitForHighlightIndex(page, TARGET_INDEX);

      // Sanity: DOM focus is inside the menu on the walked-to row.
      const preEscape = await page.evaluate((i) => {
        const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
        const el = items[i];
        return {
          highlighted: el?.hasAttribute("data-highlighted") ?? false,
          focusedIsMenuItem: document.activeElement?.getAttribute("role") === "menuitem",
          focusedMatchesTarget: document.activeElement === el,
        };
      }, TARGET_INDEX);
      expect(preEscape.highlighted, `menuitem[${TARGET_INDEX}] is highlighted before Escape`).toBe(
        true,
      );
      expect(preEscape.focusedIsMenuItem, "DOM focus is on a menuitem before Escape").toBe(true);
      expect(
        preEscape.focusedMatchesTarget,
        `DOM focus is on menuitem[${TARGET_INDEX}] (roving tabindex tracked the walk)`,
      ).toBe(true);

      // ── Press Escape ─────────────────────────────────────────────
      await page.keyboard.press("Escape");

      // Menu unmounts.
      await expect(page.getByRole("menu"), "menu closes after Escape").toHaveCount(0);
      expect(
        await page.locator('[role="menuitem"]').count(),
        "no orphan menuitem after Escape",
      ).toBe(0);

      // aria-expanded flips back to "false" on the SAME trigger.
      await expect(trigger, 'aria-expanded returns to "false" after Escape').toHaveAttribute(
        "aria-expanded",
        "false",
      );

      // Focus returns to the trigger button (not <body>, not a
      // focus-guard, not the just-highlighted row).
      const focusInfo = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        const trg = document.querySelector<HTMLElement>(
          'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
        );
        return {
          activeIsTrigger: !!el && !!trg && el === trg,
          activeTag: el ? el.tagName.toLowerCase() : "null",
          activeIsBody: !el || el === document.body,
          activeIsFocusGuard:
            !!el &&
            (el.hasAttribute("data-radix-focus-guard") ||
              (el.getBoundingClientRect().width === 0 && el.getBoundingClientRect().height === 0)),
          activeRole: el?.getAttribute("role") ?? null,
        };
      });
      expect(focusInfo.activeIsBody, "focus is NOT lost to <body>").toBe(false);
      expect(focusInfo.activeIsFocusGuard, "focus is NOT on a Radix focus-guard").toBe(false);
      expect(focusInfo.activeRole, "focus is NOT on a stale menuitem").not.toBe("menuitem");
      expect(
        focusInfo.activeIsTrigger,
        `focus returns to the overflow trigger (got <${focusInfo.activeTag} role=${focusInfo.activeRole ?? ""}>)`,
      ).toBe(true);

      // Playwright's own view of focus agrees.
      await expect(trigger, "trigger reports focused via Playwright").toBeFocused();

      // Escape did NOT navigate.
      expect(page.url(), "Escape did not change the URL").toBe(urlBefore);
    });
  }
});
