/**
 * Regression: at both iPad-sized tablet viewports, the topbar cluster
 * must keep the notifications bell and user menu fully visible and
 * keyboard-focusable inside the `md:overflow-hidden` app shell.
 *
 * Audited viewports:
 *   - 768×1024 (portrait). The exact `md` breakpoint — the tightest
 *     width where the desktop sidebar returns. Originally overflowed
 *     because `flex-1` on GlobalSearchTrigger + the ActiveProjectSwitcher
 *     `md:` label + the user-email label pushed trailing controls past
 *     the viewport, where the shell's overflow-hidden clipped them.
 *   - 1024×768 (landscape). Wider than `md` but at the boundary of the
 *     `lg` breakpoint (Tailwind treats `lg` as ≥1024). In landscape the
 *     sidebar takes more real estate proportional to the header, so a
 *     regression that re-enables the wide `md:` labels on
 *     GlobalSearchTrigger / ActiveProjectSwitcher / user email would
 *     re-clip the trailing controls on the right edge.
 *
 * Guardrails per viewport:
 *   1. Header's scrollWidth ≤ its clientWidth (no horizontal overflow).
 *   2. Notifications bell and user-menu trigger are visible AND both
 *      horizontal edges are inside the viewport.
 *   3. Both controls receive :focus-visible via keyboard focus and their
 *      focus outline (halo included) paints inside the viewport.
 *   4. Idle + focused pixel snapshots of the bell and user menu match
 *      the committed baselines (byte diffs catch icon translation, halo
 *      drop, color drift, sub-pixel clipping).
 *
 * Shared setup / focus-halo logic lives in `./_helpers/header-a11y`.
 *
 * Run:
 *   bunx playwright test tests/a11y/header-tablet-768-visibility.spec.ts \
 *        --project=chromium-reduced-motion
 */
import { test, expect } from "@playwright/test";
import { describeHeaderSuite, FOCUS_HALO_PX, type HeaderViewport } from "./_helpers/header-a11y";

const VIEWPORTS: readonly HeaderViewport[] = [
  { label: "768x1024 portrait", width: 768, height: 1024 },
  { label: "1024x768 landscape", width: 1024, height: 768 },
] as const;

for (const vp of VIEWPORTS) {
  describeHeaderSuite(`header @ ${vp.label} — bell & user menu never clip`, vp, () => {
    test("header has no horizontal overflow", async ({ page }) => {
      const metrics = await page.evaluate(() => {
        const h = document.querySelector("header")!;
        return { scrollW: h.scrollWidth, clientW: h.clientWidth };
      });
      // Allow 1px sub-pixel jitter; anything more means a real overflow.
      expect(metrics.scrollW).toBeLessThanOrEqual(metrics.clientW + 1);
    });

    test("notifications bell is visible & inside viewport", async ({ page }) => {
      const bell = page.getByRole("button", { name: /view notifications/i });
      await expect(bell).toBeVisible();
      const box = await bell.boundingBox();
      expect(box, "bell must have a bounding box").not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.height).toBeGreaterThan(0);
    });

    test("user menu trigger is visible & inside viewport", async ({ page }) => {
      const user = page.getByRole("button", { name: /open account menu/i });
      await expect(user).toBeVisible();
      const box = await user.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.height).toBeGreaterThan(0);
    });

    test("bell & user menu are keyboard-focusable with unclipped outline", async ({ page }) => {
      for (const selector of [
        'button[aria-label*="notifications" i]',
        'button[aria-label*="account menu" i]',
      ]) {
        const info = await page.evaluate(
          ({ sel, halo }) => {
            const el = document.querySelector<HTMLElement>(sel);
            if (!el) return { found: false as const };
            el.focus({ preventScroll: false });
            const active = document.activeElement === el;
            const r = el.getBoundingClientRect();
            return {
              found: true as const,
              focused: active,
              left: r.left,
              right: r.right,
              vw: window.innerWidth,
              halo,
            };
          },
          { sel: selector, halo: FOCUS_HALO_PX },
        );

        expect(info.found, `${selector} not in DOM`).toBe(true);
        if (!info.found) continue;
        expect(info.focused, `${selector} did not accept focus`).toBe(true);
        expect(info.left).toBeGreaterThanOrEqual(0);
        expect(info.right).toBeLessThanOrEqual(info.vw);
        expect(info.left - info.halo).toBeGreaterThanOrEqual(-1);
        expect(info.right + info.halo).toBeLessThanOrEqual(info.vw + 1);
      }
    });

    // Visual regression: pixel snapshots of the bell and user-menu trigger.
    // If a future layout change re-introduces clipping, translates the icon
    // off-center, or drops the focus halo, the byte-diff catches it even
    // when the bounding-box assertions above still pass.
    //
    // Snapshots live next to the spec under
    //   tests/a11y/header-tablet-768-visibility.spec.ts-snapshots/
    // Regenerate with:
    //   bunx playwright test tests/a11y/header-tablet-768-visibility.spec.ts \
    //        --project=chromium-reduced-motion --update-snapshots
    test("bell & user menu match visual snapshot (idle + focused)", async ({ page }) => {
      const bell = page.getByRole("button", { name: /view notifications/i });
      const user = page.getByRole("button", { name: /open account menu/i });
      await expect(bell).toBeVisible();
      await expect(user).toBeVisible();

      // Neutralize caret / hover / animations before snapshotting.
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur?.();
        window.scrollTo(0, 0);
      });
      await page.mouse.move(0, 0);

      // Idle state.
      expect(await bell.screenshot()).toMatchSnapshot(`bell-${vp.width}x${vp.height}-idle.png`, {
        maxDiffPixelRatio: 0.01,
      });
      expect(await user.screenshot()).toMatchSnapshot(
        `user-menu-${vp.width}x${vp.height}-idle.png`,
        { maxDiffPixelRatio: 0.01 },
      );

      // Focused state — captures the :focus-visible halo so any regression
      // that clips the outline surfaces as a pixel diff, not just an
      // assertion tweak. Snapshot with padding so the full halo is in frame.
      for (const [label, locator] of [["bell", bell] as const, ["user-menu", user] as const]) {
        await locator.focus();
        await page.evaluate(
          () =>
            new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
        );
        const box = await locator.boundingBox();
        expect(box).not.toBeNull();
        const pad = 12;
        const clip = {
          x: Math.max(0, box!.x - pad),
          y: Math.max(0, box!.y - pad),
          width: Math.min(vp.width, box!.width + pad * 2),
          height: Math.min(vp.height, box!.height + pad * 2),
        };
        expect(await page.screenshot({ clip })).toMatchSnapshot(
          `${label}-${vp.width}x${vp.height}-focused.png`,
          { maxDiffPixelRatio: 0.01 },
        );
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
      }
    });
  });
}
