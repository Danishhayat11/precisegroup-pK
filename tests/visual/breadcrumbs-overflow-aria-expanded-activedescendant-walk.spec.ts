import { test, expect } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu, closeMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — overflow menu aria-expanded / aria-activedescendant contract.
 *
 * The Radix DropdownMenu is a roving-tabindex widget: real DOM focus
 * moves between menu items with Arrow keys, and `aria-activedescendant`
 * is NEVER emitted on the menu container. The two patterns are
 * mutually exclusive per WAI-ARIA — emitting both would double-announce
 * to screen readers and desync the focus signal.
 *
 * This spec ties both attributes to the interaction phases in a single
 * end-to-end walk, in both themes:
 *
 *   Phase A — Closed baseline
 *     • trigger `aria-expanded="false"`
 *     • no `role="menu"` in the document, therefore no menu-level
 *       `aria-activedescendant` can exist
 *
 *   Phase B — Open (Space)
 *     • trigger `aria-expanded="true"`
 *     • menu is present and visible
 *     • menu container does NOT set `aria-activedescendant`
 *       (roving focus model)
 *     • first item is `data-highlighted` and is `document.activeElement`
 *
 *   Phase C — Walk with ArrowDown / ArrowUp
 *     • trigger `aria-expanded` stays `"true"` throughout
 *     • highlight moves 1 → 2 (ArrowDown) → 1 (ArrowUp)
 *     • at every step, DOM focus tracks the highlight
 *     • at every step, the menu STILL does not emit
 *       `aria-activedescendant` (a regression that added it would fire
 *       here since the walked index is non-zero)
 *
 *   Phase D — Escape
 *     • menu unmounts (`role="menu"` gone)
 *     • trigger `aria-expanded` flips back to `"false"`
 *     • no residual `aria-activedescendant` anywhere in the document
 *
 * Passing this spec means assistive tech sees consistent, non-duplicated
 * focus signals across open → arrow-walk → close, without either
 * attribute being stale or double-emitted.
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

type Phase = {
  ariaExpanded: string | null;
  menuCount: number;
  menuAriaActivedescendant: string | null;
  highlightedIndices: number[];
  focusedIndex: number;
  documentActivedescendantCount: number;
};

/**
 * Read every attribute this spec cares about in a single evaluate,
 * so the assertions describe one atomic state (no flakes from a
 * highlight moving between two page.locator calls).
 */
async function readPhase(page: Page): Promise<Phase> {
  return page.evaluate(() => {
    const trigger = document.querySelector<HTMLElement>(
      'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
    );
    const menus = Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]'));
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));

    return {
      ariaExpanded: trigger?.getAttribute("aria-expanded") ?? null,
      menuCount: menus.length,
      menuAriaActivedescendant: menus[0]?.getAttribute("aria-activedescendant") ?? null,
      highlightedIndices: items
        .map((el, i) => (el.hasAttribute("data-highlighted") ? i : -1))
        .filter((i) => i >= 0),
      focusedIndex: items.findIndex((el) => document.activeElement === el),
      // Anywhere in the document — catches a regression that would
      // add aria-activedescendant to the trigger itself or to a
      // sibling container instead of the menu.
      documentActivedescendantCount: document.querySelectorAll("[aria-activedescendant]").length,
    };
  });
}

test.describe("Breadcrumbs — overflow aria-expanded + aria-activedescendant across open/walk/close", () => {
  for (const theme of THEMES) {
    test(`${theme} · full walk: aria-expanded flips correctly, aria-activedescendant stays absent (roving focus)`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = overflowTrigger(page);
      await expect(trigger, "overflow trigger renders").toBeVisible();

      // ── Phase A: Closed baseline ────────────────────────────────
      const phaseA = await readPhase(page);
      expect(phaseA.ariaExpanded, '[closed] aria-expanded="false"').toBe("false");
      expect(phaseA.menuCount, "[closed] no menu in the DOM").toBe(0);
      expect(
        phaseA.documentActivedescendantCount,
        "[closed] nothing in the document emits aria-activedescendant",
      ).toBe(0);

      // ── Phase B: Open via Space ─────────────────────────────────
      await trigger.focus();
      const menu = await openMenu(page, trigger, {
        activation: "Space",
        label: `overflow menu (${theme})`,
      });
      await expect(menu, "[open] menu visible").toBeVisible();

      // Wait for Radix's post-open auto-highlight to settle so the
      // snapshot is deterministic on slow shards.
      await page.waitForFunction(
        () => {
          const first = document.querySelector<HTMLElement>('[role="menuitem"]');
          return !!first && first.hasAttribute("data-highlighted");
        },
        undefined,
        { timeout: 2000 },
      );

      const phaseB = await readPhase(page);
      expect(phaseB.ariaExpanded, '[open] aria-expanded="true"').toBe("true");
      expect(phaseB.menuCount, "[open] exactly one menu present").toBe(1);
      expect(
        phaseB.menuAriaActivedescendant,
        "[open] menu does NOT emit aria-activedescendant (roving focus model)",
      ).toBeNull();
      expect(
        phaseB.documentActivedescendantCount,
        "[open] no element in the document emits aria-activedescendant",
      ).toBe(0);
      expect(phaseB.highlightedIndices, "[open] single highlight at index 0").toEqual([0]);
      expect(phaseB.focusedIndex, "[open] DOM focus is on the highlighted (first) item").toBe(0);

      // Need at least three items so we can go 0 → 1 → 2 → 1.
      const itemCount = await page.locator('[role="menuitem"]').count();
      expect(itemCount, "fixture yields at least three hidden crumbs").toBeGreaterThanOrEqual(3);

      // ── Phase C: Walk with ArrowDown / ArrowUp ──────────────────
      await page.keyboard.press("ArrowDown");
      await page.waitForFunction(
        () =>
          document
            .querySelectorAll<HTMLElement>('[role="menuitem"]')[1]
            ?.hasAttribute("data-highlighted") ?? false,
        undefined,
        { timeout: 2000 },
      );
      const phaseC1 = await readPhase(page);
      expect(phaseC1.ariaExpanded, '[walk→1] aria-expanded stays "true"').toBe("true");
      expect(phaseC1.highlightedIndices, "[walk→1] single highlight at index 1").toEqual([1]);
      expect(phaseC1.focusedIndex, "[walk→1] DOM focus tracks highlight").toBe(1);
      expect(
        phaseC1.menuAriaActivedescendant,
        "[walk→1] menu still does NOT emit aria-activedescendant",
      ).toBeNull();
      expect(
        phaseC1.documentActivedescendantCount,
        "[walk→1] no element in document emits aria-activedescendant",
      ).toBe(0);

      await page.keyboard.press("ArrowDown");
      await page.waitForFunction(
        () =>
          document
            .querySelectorAll<HTMLElement>('[role="menuitem"]')[2]
            ?.hasAttribute("data-highlighted") ?? false,
        undefined,
        { timeout: 2000 },
      );
      const phaseC2 = await readPhase(page);
      expect(phaseC2.ariaExpanded, '[walk→2] aria-expanded stays "true"').toBe("true");
      expect(phaseC2.highlightedIndices, "[walk→2] single highlight at index 2").toEqual([2]);
      expect(phaseC2.focusedIndex, "[walk→2] DOM focus tracks highlight").toBe(2);
      expect(
        phaseC2.menuAriaActivedescendant,
        "[walk→2] menu still does NOT emit aria-activedescendant",
      ).toBeNull();
      expect(
        phaseC2.documentActivedescendantCount,
        "[walk→2] no element in document emits aria-activedescendant",
      ).toBe(0);

      await page.keyboard.press("ArrowUp");
      await page.waitForFunction(
        () =>
          document
            .querySelectorAll<HTMLElement>('[role="menuitem"]')[1]
            ?.hasAttribute("data-highlighted") ?? false,
        undefined,
        { timeout: 2000 },
      );
      const phaseC3 = await readPhase(page);
      expect(phaseC3.ariaExpanded, '[walk↑1] aria-expanded stays "true"').toBe("true");
      expect(phaseC3.highlightedIndices, "[walk↑1] single highlight back at index 1").toEqual([1]);
      expect(phaseC3.focusedIndex, "[walk↑1] DOM focus tracks highlight backward").toBe(1);
      expect(
        phaseC3.menuAriaActivedescendant,
        "[walk↑1] menu still does NOT emit aria-activedescendant",
      ).toBeNull();
      expect(
        phaseC3.documentActivedescendantCount,
        "[walk↑1] no element in document emits aria-activedescendant",
      ).toBe(0);

      // ── Phase D: Escape closes everything ───────────────────────
      await closeMenu(page);
      await expect(menu, "[closed after Esc] menu unmounts").toHaveCount(0);

      const phaseD = await readPhase(page);
      expect(phaseD.ariaExpanded, '[closed after Esc] aria-expanded="false"').toBe("false");
      expect(phaseD.menuCount, "[closed after Esc] no menu in the DOM").toBe(0);
      expect(
        phaseD.documentActivedescendantCount,
        "[closed after Esc] no residual aria-activedescendant anywhere in the document",
      ).toBe(0);

      // Focus contract: Escape returns focus to the trigger.
      const triggerFocused = await trigger.evaluate((el) => el === document.activeElement);
      expect(triggerFocused, "[closed after Esc] focus returns to overflow trigger").toBe(true);
    });
  }
});
