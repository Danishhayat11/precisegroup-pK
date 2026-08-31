import { expect, test } from "./_overflowDebugFixture";
import type { Locator, Page } from "@playwright/test";
import { openMenu, closeMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — Space opens the overflow menu, ArrowDown lands on the
 * correct first item, and the focus-visible ring tokens on that item
 * remain intact — in both light and dark themes.
 *
 * Contract:
 *   • Space activation opens the menu (shared `openMenu` helper handles
 *     the Radix first-keydown hydration race).
 *   • Radix roving-focus lands DOM focus on exactly one menuitem after
 *     open. We wait for that highlight to materialise (Radix commits it
 *     asynchronously in a rAF under reduced motion).
 *   • Pressing ArrowDown once confirms roving-focus advances by one
 *     step (highlight and DOM focus stay in lockstep on the same item).
 *     "Correct first item" for the fixture URL = "Alpha".
 *   • The highlighted item's inner anchor must keep every required
 *     focus-visible ring token — losing any of them silently kills the
 *     keyboard focus indicator in the affected theme.
 *   • The ring must also resolve to a visible box-shadow/outline at
 *     runtime; a purged token that "still exists in the class string"
 *     but computes to `none` is the exact regression we're guarding.
 */

const THEMES = ["light", "dark"] as const;
const FIXTURE_URL = "/crumb-fixture/alpha/beta/gamma/delta/epsilon";

const REQUIRED_RING_TOKENS = [
  "outline-none",
  "focus-visible:ring-2",
  "focus-visible:ring-ring",
  "focus-visible:ring-offset-2",
  "focus-visible:ring-offset-background",
] as const;

async function forceTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("precise.theme", t);
    } catch {
      /* ignored */
    }
    const root = document.documentElement;
    if (root) {
      root.classList.toggle("dark", t === "dark");
      root.style.colorScheme = t;
    }
  }, theme);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
}

async function waitForHighlightIndex(page: Page, expectedIdx: number, label: string) {
  await page
    .waitForFunction(
      (i) => {
        const items = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
        return items[i]?.hasAttribute("data-highlighted") ?? false;
      },
      expectedIdx,
      { timeout: 2000 },
    )
    .catch(() => {
      throw new Error(`[${label}] highlight never landed on index ${expectedIdx}`);
    });
}

/**
 * Read the currently highlighted menuitem. DropdownMenuItem uses
 * `asChild`, so the anchor IS the element carrying role="menuitem" —
 * we read className directly from the highlighted node.
 */
async function readActiveItem(page: Page, menu: Locator) {
  const highlighted = menu.locator('[role="menuitem"][data-highlighted]');
  await expect(highlighted, "exactly one menuitem highlighted").toHaveCount(1);
  const text = (await highlighted.innerText()).trim();
  const anchorClass = (await highlighted.getAttribute("class")) ?? "";
  const isActiveElement = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    const hi = document.querySelector('[role="menuitem"][data-highlighted]');
    return !!el && !!hi && (el === hi || hi.contains(el));
  });
  return { text, anchorClass, isActiveElement, anchor: highlighted };
}

test.describe("Breadcrumbs overflow · Space open → ArrowDown highlights correct first item → focus-visible ring intact", () => {
  for (const theme of THEMES) {
    test(`${theme} · Space + ArrowDown lands roving focus on "Alpha" and preserves the ring`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = page.locator(
        'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
      );
      await expect(trigger, "overflow trigger visible").toBeVisible();

      // ── Open via Space ─────────────────────────────────────────
      await trigger.focus();
      const menu = await openMenu(page, trigger, { activation: "Space", label: "overflow menu" });
      await expect(menu, "menu open after Space").toBeVisible();
      await expect(trigger, "aria-expanded flips to true").toHaveAttribute("aria-expanded", "true");

      // Fixture yields collapsed = [alpha, beta, gamma] so item 0 = "Alpha".
      const items = menu.getByRole("menuitem");
      const total = await items.count();
      expect(total, "overflow menu populated").toBeGreaterThanOrEqual(2);
      expect((await items.nth(0).innerText()).trim(), `[${theme}] item 0 is "Alpha"`).toBe("Alpha");

      // ── Wait for the roving highlight to commit on item 0 ───────
      // Radix auto-highlights the first item on keyboard open, but the
      // commit happens on the next frame under reduced motion.
      await waitForHighlightIndex(page, 0, `${theme}/after Space`);

      // ── ArrowDown → highlight+focus advance from item 0 → item 1 ──
      await page.keyboard.press("ArrowDown");
      await waitForHighlightIndex(page, 1, `${theme}/after ArrowDown`);

      const active = await readActiveItem(page, menu);
      expect(active.text, `[${theme}] ArrowDown moves highlight to item 1 ("Beta")`).toBe("Beta");
      expect(active.isActiveElement, `[${theme}] roving DOM focus tracks the highlight`).toBe(true);

      // ── ArrowUp back to the correct first item ("Alpha") ────────
      await page.keyboard.press("ArrowUp");
      await waitForHighlightIndex(page, 0, `${theme}/after ArrowUp`);
      const backToFirst = await readActiveItem(page, menu);
      expect(backToFirst.text, `[${theme}] correct first item becomes active`).toBe("Alpha");
      expect(backToFirst.isActiveElement, `[${theme}] roving focus on first item`).toBe(true);

      // ── Focus-visible ring tokens on the highlighted first-item anchor ──
      const tokens = backToFirst.anchorClass.split(/\s+/);
      for (const token of REQUIRED_RING_TOKENS) {
        expect(
          tokens,
          `[${theme}] highlighted anchor keeps focus-visible token "${token}"`,
        ).toContain(token);
      }

      // ── Runtime proof: the ring actually paints ──
      const ringComputed = await backToFirst.anchor.evaluate((el) => {
        const cs = window.getComputedStyle(el);
        return {
          outlineStyle: cs.outlineStyle,
          outlineWidth: cs.outlineWidth,
          boxShadow: cs.boxShadow,
          ringColorVar: cs.getPropertyValue("--tw-ring-color").trim(),
          ringOffsetColorVar: cs.getPropertyValue("--tw-ring-offset-color").trim(),
        };
      });
      const hasVisibleRing =
        (ringComputed.boxShadow && ringComputed.boxShadow !== "none") ||
        (ringComputed.outlineStyle && ringComputed.outlineStyle !== "none");
      expect(
        hasVisibleRing,
        `[${theme}] focus-visible ring renders (computed: ${JSON.stringify(ringComputed)})`,
      ).toBe(true);

      // Clean teardown so consecutive tests don't inherit an open menu.
      await closeMenu(page);
      await expect(page.getByRole("menu"), "menu closed after test").toHaveCount(0);
    });
  }
});
