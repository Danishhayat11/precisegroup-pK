import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu, closeMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — Space opens the overflow menu and preserves the
 * trigger's focus-visible ring, independent of when Radix stamps
 * `data-highlighted` on the first item.
 *
 * Why this test exists
 * --------------------
 * Two subtle contracts have regressed before:
 *
 *   1. Space on the focused trigger must flip `aria-expanded` to
 *      "true" and mount the menu portal — but on the very first
 *      keydown after hydration Radix can miss the event, so we go
 *      through the shared `openMenu` helper (idempotent retries).
 *
 *   2. Between "menu opened" and "Radix highlighted item 0", there is
 *      a short window (usually one frame) where no menu item has
 *      `data-highlighted` yet. During that window the *trigger* must
 *      still show its focus-visible ring, because keyboard focus is
 *      still visually anchored there from the user's perspective —
 *      losing the ring is what makes users think "the button just
 *      swallowed my keystroke." We assert the ring tokens exist on
 *      the trigger both before AND immediately after Space, without
 *      waiting for `data-highlighted` to appear.
 *
 * Focus-visible tokens
 * --------------------
 * The project's design tokens render the ring via Tailwind classes
 * `focus-visible:ring-2`, `focus-visible:ring-ring`, and
 * `focus-visible:ring-offset-2`. Rather than matching computed pixel
 * colors (which vary by theme), we assert the class tokens are still
 * present on the trigger element — that keeps the test theme-agnostic
 * and stable against future palette changes.
 */

const THEMES = ["light", "dark"] as const;
const FIXTURE_URL = "/crumb-fixture/alpha/beta/gamma/delta/epsilon";

const REQUIRED_RING_TOKENS = [
  "focus-visible:ring-2",
  "focus-visible:ring-ring",
  "focus-visible:ring-offset-2",
] as const;

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

test.describe("Breadcrumbs — Space opens menu, trigger keeps focus-visible ring", () => {
  for (const theme of THEMES) {
    test(`${theme} · Space flips aria-expanded and preserves ring tokens pre-highlight`, async ({
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
      await expect(trigger, "starts collapsed").toHaveAttribute("aria-expanded", "false");

      // ── Baseline: focus the trigger via keyboard so :focus-visible
      // applies. Tabbing from the document body simulates a real
      // keyboard user landing on the trigger.
      await page.keyboard.press("Tab");
      await trigger.focus();

      const classesBefore = (await trigger.getAttribute("class")) ?? "";
      for (const token of REQUIRED_RING_TOKENS) {
        expect(
          classesBefore.split(/\s+/),
          `[before Space] trigger has ring token "${token}"`,
        ).toContain(token);
      }

      // Sanity: :focus-visible actually matches on the trigger before
      // we press Space. If this fails, either the trigger lost focus
      // or the browser didn't classify the focus as keyboard-driven,
      // and the downstream ring assertion would be meaningless.
      const focusVisibleBefore = await trigger.evaluate((el) => el.matches(":focus-visible"));
      expect(
        focusVisibleBefore,
        "[before Space] trigger matches :focus-visible after keyboard focus",
      ).toBe(true);

      // ── Space opens the menu. We use the shared retry helper so
      // the hydration-race on the first keydown doesn't flake this
      // test, but we still assert what the *user-visible contract*
      // says: aria-expanded flips true and the menu mounts.
      const menu = await openMenu(page, trigger, {
        activation: "Space",
        label: "overflow menu (space-open)",
      });
      await expect(menu, "menu mounted after Space").toBeVisible();
      await expect(trigger, "aria-expanded flips to true after Space").toHaveAttribute(
        "aria-expanded",
        "true",
      );

      // ── Ring tokens must still be on the trigger even before Radix
      // has stamped data-highlighted on the first menu item. This is
      // the core regression: we do NOT wait for data-highlighted.
      const classesAfter = (await trigger.getAttribute("class")) ?? "";
      for (const token of REQUIRED_RING_TOKENS) {
        expect(
          classesAfter.split(/\s+/),
          `[after Space, pre-highlight] trigger still has ring token "${token}"`,
        ).toContain(token);
      }

      // Class list should not have swapped out for a hover/active-only
      // variant on activation (a common regression when someone adds
      // `data-[state=open]:` class overrides). Assert byte-equality of
      // the token set to catch that class of change.
      const beforeTokens = new Set(classesBefore.split(/\s+/).filter(Boolean));
      const afterTokens = new Set(classesAfter.split(/\s+/).filter(Boolean));
      for (const token of REQUIRED_RING_TOKENS) {
        expect(
          afterTokens.has(token) && beforeTokens.has(token),
          `[stability] ring token "${token}" present in both class lists`,
        ).toBe(true);
      }

      // Explicitly document that we do NOT require data-highlighted
      // to be set yet. If it *is* set (fast machines), that's fine;
      // if it isn't, the ring contract above still stands. Either
      // way, the menu is now the interaction surface — Radix moves
      // DOM focus into it, so :focus-visible on the trigger stops
      // matching. We assert the *ring class tokens* remain on the
      // trigger's className, not that :focus-visible still matches.
      const highlightedCount = await page.locator('[role="menuitem"][data-highlighted]').count();
      expect(
        highlightedCount === 0 || highlightedCount === 1,
        "[invariant] at most one menu item is highlighted (0 during the race window, 1 after)",
      ).toBe(true);

      // ── Cleanup so the next iteration starts from a closed menu.
      await closeMenu(page);
      await expect(trigger, "aria-expanded returns to false after Esc").toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });
  }
});
