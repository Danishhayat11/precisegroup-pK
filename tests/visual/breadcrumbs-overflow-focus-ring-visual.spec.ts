import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu, closeMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — visual regression: the focused overflow menu item
 * must always render the high-contrast focus ring, in both light and
 * dark themes.
 *
 * Why pixel-diff (not just token assertions)
 * ------------------------------------------
 * Sibling specs (`breadcrumbs-overflow-highlight-tokens.spec.ts`,
 * `breadcrumbs-overflow-space-focus-ring.spec.ts`) assert the ring
 * *class tokens* / *data attributes* are present. Those pass even when
 * the ring is invisible — for example if a later `outline: none` /
 * `box-shadow: none` override, a same-tone `--ring` token drift, or a
 * z-index bug hides the ring under the item's own background.
 *
 * This spec closes that gap by taking an ELEMENT screenshot of the
 * highlighted item and diffing it against a per-theme baseline. Any
 * regression that visually erases or dims the ring — token change,
 * !important override, portal stacking bug, forgotten dark-mode
 * variant — will fail the diff even when the DOM contract still holds.
 *
 * Snapshot scope
 * --------------
 *   • Element screenshot only (not full page) — keeps the baseline
 *     small and isolates the failure to the ring itself, not unrelated
 *     layout shifts elsewhere on the fixture.
 *   • `animations: 'disabled'` + reduced-motion emulation → deterministic.
 *   • Small `maxDiffPixelRatio` tolerance absorbs sub-pixel anti-alias
 *     drift between renderers without hiding a missing ring (a missing
 *     ring changes ~5%+ of pixels along the item's perimeter).
 *   • Snapshot dir is theme-scoped so light/dark baselines never collide.
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

test.describe("Breadcrumbs — overflow focused item shows high-contrast focus ring", () => {
  for (const theme of THEMES) {
    test(`${theme} · focused menu item pixel-matches focus-ring baseline`, async ({ page }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = page.locator(
        'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
      );
      await expect(trigger, "overflow trigger renders").toBeVisible();

      await trigger.focus();
      const menu = await openMenu(page, trigger, {
        activation: "Space",
        label: `overflow menu (${theme} focus ring)`,
      });
      await expect(menu, "menu open").toBeVisible();

      // Wait for Radix to stamp `data-highlighted` on the first item —
      // that is the element whose focus ring we're regressing on.
      const focused = page.locator('[role="menuitem"][data-highlighted]').first();
      await expect(focused, "first item is highlighted after Space").toBeVisible();

      // Sanity: the highlighted item is also the DOM-focused one.
      // If this ever fails, the pixel diff would be checking the wrong
      // element and would silently pass a regression.
      const focusedIsActive = await focused.evaluate((el) => document.activeElement === el);
      expect(
        focusedIsActive,
        "highlighted item is document.activeElement (roving focus tracks highlight)",
      ).toBe(true);

      // Contrast guardrail (cheap, catches the worst regression):
      // if `--ring` collapses to the item's own background, the ring
      // is functionally invisible. We assert the two resolved colors
      // are not string-identical before spending the diff.
      const { ringColor, itemBg } = await focused.evaluate((el) => {
        const cs = getComputedStyle(el);
        // Radix tokens land on --ring at :root / .dark; Tailwind's
        // `ring-ring` reads it. Read via a probe div so we don't
        // depend on which shadow property Tailwind emitted.
        const probe = document.createElement("div");
        probe.style.color = "hsl(var(--ring))";
        document.body.appendChild(probe);
        const ring = getComputedStyle(probe).color;
        probe.remove();
        return { ringColor: ring, itemBg: cs.backgroundColor };
      });
      expect(ringColor, `[${theme}] --ring token resolves to a non-empty color`).not.toBe("");
      expect(
        ringColor,
        `[${theme}] --ring color must differ from item background (invisible ring)`,
      ).not.toBe(itemBg);

      // Settle any transition frames (reduced-motion already caps
      // durations, but Radix uses rAF for its highlight sync).
      await page.waitForTimeout(120);

      // Element pixel-diff. Baselines live under
      // `breadcrumbs-overflow-focus-ring-visual.spec.ts-snapshots/`
      // and are theme-scoped by filename.
      await expect(
        focused,
        `[${theme}] focused menu item matches focus-ring baseline`,
      ).toHaveScreenshot(`focused-menuitem-${theme}.png`, {
        animations: "disabled",
        // Anti-alias / sub-pixel jitter tolerance. A missing ring
        // changes ~5%+ of pixels on the item perimeter; 1% is well
        // below that floor but well above renderer noise.
        maxDiffPixelRatio: 0.01,
        // Threshold per-channel — permissive enough for LCD subpixel
        // rendering variance, strict enough that a washed-out ring
        // (dropped alpha, wrong hue) still trips the diff.
        threshold: 0.2,
      });

      await closeMenu(page);
      await expect(trigger, "menu closes cleanly").toHaveAttribute("aria-expanded", "false");
    });
  }
});
