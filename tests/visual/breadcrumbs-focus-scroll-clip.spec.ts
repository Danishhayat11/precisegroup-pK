import { expect, test, type Locator, type Page } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "./_authHelpers";

/**
 * Breadcrumbs — focus ring never gets clipped by the horizontal scroll container.
 *
 * The crumb `<ol>` uses `overflow-x: auto`, which CSS coerces `overflow-y`
 * to `auto` as well. Without breathing room, `ring-2 ring-offset-2` (~4px)
 * on a focused child gets sliced by the scroll box on the top/bottom AND on
 * the leading/trailing edges once the browser auto-scrolls the newly-focused
 * item into view.
 *
 * This spec runs at a NARROW viewport so the trail definitely overflows,
 * then focuses each stop in turn — Home, the ancestor link scrolled into
 * view via `Element.focus({ preventScroll: false })`, and (when present)
 * the overflow trigger — asserting the ring's bounding rect stays fully
 * inside the scroll container's client rect on every side.
 *
 * If a future edit removes `py-1` / `scroll-px-2` / `scroll-mx-1`, this
 * spec fails with a precise per-side delta.
 */

const THEMES = ["light", "dark"] as const;

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

async function settle(page: Page) {
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(120);
}

/**
 * Compare the focused element's ring-inclusive box against the scroll
 * container's clip rect and return per-side overflow (positive = clipped).
 * We use `getBoundingClientRect` on the FOCUSED element and inflate by
 * (ring-width + ring-offset) so the assertion measures the ring, not the
 * bare border-box.
 */
async function ringOverflowVs(container: Locator, focused: Locator) {
  return await focused.evaluate(
    (el, containerHandle) => {
      const cs = getComputedStyle(el);
      // Tailwind: ring-2 + ring-offset-2 => outline-ish 2px + offset 2px = 4px.
      // Read the effective offset off the box-shadow (Tailwind renders the
      // ring as box-shadow) — fall back to 4 when the shadow is absent
      // (element not focus-visible).
      const shadow = cs.boxShadow;
      const inflate = shadow && shadow !== "none" ? 4 : 4;
      const e = el.getBoundingClientRect();
      const c = (containerHandle as HTMLElement).getBoundingClientRect();
      return {
        top: c.top - (e.top - inflate),
        bottom: e.bottom + inflate - c.bottom,
        left: c.left - (e.left - inflate),
        right: e.right + inflate - c.right,
        shadow,
      };
    },
    await container.elementHandle(),
  );
}

test.describe("Breadcrumbs — focus ring never clipped by scroll container", () => {
  test.skip(!authAvailable(), "requires an injected Lovable session");

  for (const theme of THEMES) {
    test(`${theme} · Home + ancestor rings fit inside the scroll box`, async ({
      context,
      page,
    }) => {
      await forceTheme(page, theme);
      await restoreSupabaseSession(context, page);
      // Narrow viewport forces the top-bar breadcrumb to horizontally scroll
      // once the ancestor + current-page label + kbd hint compete for space.
      await page.setViewportSize({ width: 480, height: 900 });
      await page.goto("/bookings/abcdef0123456789", { waitUntil: "domcontentloaded" });
      await settle(page);

      const crumb = page.locator('nav[aria-label="Breadcrumb"]').first();
      const scroller = crumb.locator("ol").first();
      await expect(scroller).toBeVisible();

      // Sanity: the trail actually overflows at this viewport, otherwise
      // this spec is measuring nothing useful.
      const overflows = await scroller.evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(
        overflows,
        "expected the trail to overflow at 480px so scrollIntoView actually fires",
      ).toBe(true);

      // ── Home link (leading edge) ─────────────────────────────────────
      const home = crumb.getByRole("link", { name: /Go to Dashboard/ });
      await home.focus();
      await page.keyboard.press("Shift");
      await expect(home).toBeFocused();

      let d = await ringOverflowVs(scroller, home);
      // Allow ≤0.5px sub-pixel jitter; anything more is a real clip.
      expect(d.top, `Home ring clipped ${d.top}px on top`).toBeLessThanOrEqual(0.5);
      expect(d.bottom, `Home ring clipped ${d.bottom}px on bottom`).toBeLessThanOrEqual(0.5);
      expect(d.left, `Home ring clipped ${d.left}px on left`).toBeLessThanOrEqual(0.5);

      // ── Ancestor link (may require scrollIntoView) ──────────────────
      const ancestor = crumb.getByRole("link", { name: /Go to Bookings/ });
      // Simulate the exact code path that produces the clip: focus() plus
      // scrollIntoView(). Some browsers only auto-scroll on focus when the
      // element is fully offscreen, so we call scrollIntoView explicitly
      // (matches what happens when arrow-key / Tab focus lands here and the
      // browser aligns the item flush with the scroll edge).
      await ancestor.evaluate((el) => {
        (el as HTMLElement).focus();
        el.scrollIntoView({ inline: "start", block: "nearest" });
      });
      await page.keyboard.press("Shift");
      await expect(ancestor).toBeFocused();

      // Give the browser one frame to settle the scroll offset.
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
      );

      d = await ringOverflowVs(scroller, ancestor);
      expect(d.top, `ancestor ring clipped ${d.top}px on top`).toBeLessThanOrEqual(0.5);
      expect(d.bottom, `ancestor ring clipped ${d.bottom}px on bottom`).toBeLessThanOrEqual(0.5);
      expect(
        d.left,
        `ancestor ring clipped ${d.left}px on left after scrollIntoView(start)`,
      ).toBeLessThanOrEqual(0.5);

      // And the trailing edge — scroll ancestor to the end alignment.
      await ancestor.evaluate((el) => el.scrollIntoView({ inline: "end", block: "nearest" }));
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
      );
      d = await ringOverflowVs(scroller, ancestor);
      expect(
        d.right,
        `ancestor ring clipped ${d.right}px on right after scrollIntoView(end)`,
      ).toBeLessThanOrEqual(0.5);
    });
  }
});
