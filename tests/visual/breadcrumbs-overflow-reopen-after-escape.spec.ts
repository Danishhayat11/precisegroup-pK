import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu, closeMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — overflow menu open/Esc/re-open regression.
 *
 * Historical bug: after closing the Radix DropdownMenu with Escape,
 * the *second* open sometimes left `aria-expanded="false"` on the
 * trigger (Radix state desynced from the portal) OR opened the menu
 * with no `data-highlighted` item at all, breaking arrow navigation.
 *
 * This spec runs the open → Esc → re-open cycle several times in
 * both themes and asserts the invariants on every iteration:
 *
 *   1. After opening: `aria-expanded="true"` on the trigger, exactly
 *      one visible menu, and the first menu item carries
 *      `data-highlighted` + is `document.activeElement`.
 *   2. After Esc: `aria-expanded="false"`, `aria-controls` removed,
 *      the menu portal is detached, and focus returns to the trigger.
 *   3. Re-open produces the *same* first-highlighted item (index 0)
 *      as the initial open — no drift, no ghost highlight from the
 *      previous cycle.
 */

const THEMES = ["light", "dark"] as const;
const FIXTURE_URL = "/crumb-fixture/alpha/beta/gamma/delta/epsilon";
const CYCLES = 3;

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

type HighlightSnapshot = {
  count: number;
  highlightedIndex: number;
  focusedIndex: number;
  firstText: string;
};

async function snapshotHighlight(page: Page): Promise<HighlightSnapshot> {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const highlightedIndex = items.findIndex((el) => el.hasAttribute("data-highlighted"));
    const focusedIndex = items.findIndex((el) => document.activeElement === el);
    return {
      count: items.length,
      highlightedIndex,
      focusedIndex,
      firstText: (items[0]?.textContent ?? "").trim(),
    };
  });
}

test.describe("Breadcrumbs — overflow reopen after Escape", () => {
  for (const theme of THEMES) {
    test(`${theme} · open → Esc → reopen preserves aria-expanded and first-highlight`, async ({
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

      // Baseline (closed) state — used to compare aria-controls
      // restoration after each Esc.
      await expect(trigger, "starts collapsed").toHaveAttribute("aria-expanded", "false");
      const baselineControls = await trigger.getAttribute("aria-controls");

      let baselineFirstText: string | null = null;

      for (let cycle = 1; cycle <= CYCLES; cycle++) {
        // ── Open ───────────────────────────────────────────────────
        const menu = await openMenu(page, trigger, {
          activation: "Space",
          label: `overflow menu (cycle ${cycle})`,
        });
        await expect(menu, `[cycle ${cycle}] menu visible`).toBeVisible();
        await expect(trigger, `[cycle ${cycle}] aria-expanded flips true on open`).toHaveAttribute(
          "aria-expanded",
          "true",
        );
        await expect(
          trigger,
          `[cycle ${cycle}] aria-controls references the portalled menu on open`,
        ).toHaveAttribute("aria-controls", /.+/);

        // Radix mounts + auto-highlights the first item on a keyboard
        // open. Wait for that auto-highlight so the snapshot below is
        // deterministic across shards.
        await page.waitForFunction(
          () => {
            const first = document.querySelector<HTMLElement>('[role="menuitem"]');
            return !!first && first.hasAttribute("data-highlighted");
          },
          undefined,
          { timeout: 2000 },
        );

        const snap = await snapshotHighlight(page);
        expect(snap.count, `[cycle ${cycle}] menu has items`).toBeGreaterThan(1);
        expect(
          snap.highlightedIndex,
          `[cycle ${cycle}] first item is auto-highlighted on open`,
        ).toBe(0);
        expect(snap.focusedIndex, `[cycle ${cycle}] DOM focus tracks the highlight`).toBe(0);

        if (cycle === 1) {
          baselineFirstText = snap.firstText;
        } else {
          expect(
            snap.firstText,
            `[cycle ${cycle}] first item text matches cycle 1 (no drift after reopen)`,
          ).toBe(baselineFirstText);
        }

        // ── Escape ─────────────────────────────────────────────────
        await closeMenu(page);
        await expect(
          trigger,
          `[cycle ${cycle}] aria-expanded flips back to false after Esc`,
        ).toHaveAttribute("aria-expanded", "false");
        // Radix removes aria-controls when the menu unmounts; assert
        // the closed-state attribute matches the pre-open baseline
        // (either both null, or both the same static value).
        const controlsAfter = await trigger.getAttribute("aria-controls");
        expect(
          controlsAfter,
          `[cycle ${cycle}] aria-controls returns to its closed-state value after Esc`,
        ).toBe(baselineControls);

        // Focus must return to the trigger — that's the a11y contract
        // that makes the Space→Esc→Space loop keyboard-drivable.
        const triggerFocused = await trigger.evaluate((el) => el === document.activeElement);
        expect(triggerFocused, `[cycle ${cycle}] focus returns to overflow trigger after Esc`).toBe(
          true,
        );
      }
    });
  }
});
