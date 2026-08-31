import { test, expect } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu, closeMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — overflow menu ArrowDown-then-Escape contract.
 *
 * Sister spec to `breadcrumbs-overflow-reopen-after-escape.spec.ts`
 * (which cycles open/Esc with the *auto-highlighted* first row) and
 * `breadcrumbs-overflow-escape-from-highlighted-row-focus.spec.ts`
 * (focused on the visual focus ring on the trigger post-Esc). This
 * one specifically locks in the "Escape from a WALKED highlight"
 * contract, which is the historical regression window:
 *
 *   • Radix's `onEscapeKeyDown` returned focus to the trigger only
 *     when the highlight was still on index 0. Once ArrowDown had
 *     moved the highlight, the internal focus-restore reference was
 *     replaced by the walked item, and Escape sometimes left focus
 *     on <body> (the item unmounted with focus on it).
 *   • The next open then inherited the *walked* highlight index
 *     instead of resetting to index 0, breaking screen-reader flow.
 *
 * The spec verifies, in both light and dark:
 *
 *   1. Menu opens with a single highlight at index 0 (baseline).
 *   2. ArrowDown moves the single highlight OFF index 0 (proves the
 *     later "reset to 0" assertion is not vacuous).
 *   3. Escape closes the menu (`role="menu"` gone) and flips
 *     `aria-expanded` back to `"false"`.
 *   4. Focus returns to the overflow trigger — NOT <body>, NOT a
 *     menu item, NOT the walked row's underlying anchor.
 *   5. No element in the document still carries `data-highlighted`
 *     after the menu unmounts (no ghost state leaks).
 *   6. Re-opening restarts the highlight at index 0 with exactly
 *     one highlighted row, matching the cycle-1 baseline text.
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

/** Wait for Radix's post-open auto-highlight before walking. */
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

async function snapshotHighlight(page: Page) {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const highlightedIndices = items
      .map((el, i) => (el.hasAttribute("data-highlighted") ? i : -1))
      .filter((i) => i >= 0);
    return {
      count: items.length,
      highlightedIndices,
      firstText: (items[0]?.textContent ?? "").trim(),
      highlightedText:
        highlightedIndices.length === 1
          ? (items[highlightedIndices[0]]?.textContent ?? "").trim()
          : null,
    };
  });
}

test.describe("Breadcrumbs — ArrowDown then Escape returns focus + resets highlight", () => {
  for (const theme of THEMES) {
    test(`${theme} · Arrow-walked highlight → Esc returns focus to trigger and reopen resets to index 0`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = overflowTrigger(page);
      await expect(trigger, "overflow trigger renders").toBeVisible();
      await expect(trigger, "starts collapsed").toHaveAttribute("aria-expanded", "false");

      // ── 1. Open + baseline first-highlight ──────────────────────
      await trigger.focus();
      const menu = await openMenu(page, trigger, {
        activation: "Space",
        label: `overflow menu (${theme}, cycle 1)`,
      });
      await expect(menu, "menu visible after open").toBeVisible();
      await expect(trigger, "aria-expanded=true while open").toHaveAttribute(
        "aria-expanded",
        "true",
      );

      await waitForFirstAutoHighlight(page);
      const baseline = await snapshotHighlight(page);
      expect(baseline.count, "fixture yields multiple hidden crumbs").toBeGreaterThan(1);
      expect(
        baseline.highlightedIndices,
        "baseline: single highlight at index 0 after open",
      ).toEqual([0]);
      const baselineFirstText = baseline.firstText;
      expect(baselineFirstText.length, "first row has visible text").toBeGreaterThan(0);

      // ── 2. ArrowDown walks the highlight to index 1 ─────────────
      await page.keyboard.press("ArrowDown");
      await page.waitForFunction(
        () => {
          const els = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
          return els[1]?.hasAttribute("data-highlighted") ?? false;
        },
        undefined,
        { timeout: 2000 },
      );
      const walked = await snapshotHighlight(page);
      expect(
        walked.highlightedIndices,
        "after ArrowDown: single highlight at index 1 (walked off first item)",
      ).toEqual([1]);
      expect(
        walked.highlightedText,
        "walked highlight is a different row than the baseline first row",
      ).not.toBe(baselineFirstText);

      // ── 3. Escape closes + flips aria-expanded ──────────────────
      await closeMenu(page);
      await expect(menu, "menu unmounts after Escape").toHaveCount(0);
      await expect(trigger, "aria-expanded flips back to false after Escape").toHaveAttribute(
        "aria-expanded",
        "false",
      );

      // ── 4. Focus returns to the overflow trigger ────────────────
      const focusReturned = await trigger.evaluate((el) => el === document.activeElement);
      expect(
        focusReturned,
        "focus returns to the overflow trigger after Escape from walked highlight",
      ).toBe(true);

      const active = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return {
          isBody: !el || el === document.body,
          role: el?.getAttribute("role") ?? null,
          tag: el?.tagName.toLowerCase() ?? "null",
        };
      });
      expect(active.isBody, "focus is NOT lost to <body>").toBe(false);
      expect(active.role, "focus is NOT on a menu item").not.toBe("menuitem");

      // ── 5. No stray highlighted state left in the document ──────
      const stragglers = await page.locator("[data-highlighted]").count();
      expect(stragglers, "no element carries data-highlighted after menu teardown").toBe(0);
      const orphanMenuItems = await page.locator('[role="menuitem"]').count();
      expect(orphanMenuItems, 'no orphan role="menuitem" left in DOM after Escape').toBe(0);

      // ── 6. Re-open resets highlight to index 0 ──────────────────
      const menu2 = await openMenu(page, trigger, {
        activation: "Space",
        label: `overflow menu (${theme}, cycle 2 reopen)`,
      });
      await expect(menu2, "menu visible on reopen").toBeVisible();
      await waitForFirstAutoHighlight(page);

      const reopen = await snapshotHighlight(page);
      expect(
        reopen.highlightedIndices,
        "reopen: exactly one item highlighted, at index 0 (no ghost from walked cycle 1)",
      ).toEqual([0]);
      expect(
        reopen.firstText,
        "reopen: first row text matches the cycle-1 baseline (no reorder drift)",
      ).toBe(baselineFirstText);
      expect(
        reopen.highlightedText,
        "reopen: highlighted row is the baseline first row, not the previously-walked row",
      ).toBe(baselineFirstText);
    });
  }
});
