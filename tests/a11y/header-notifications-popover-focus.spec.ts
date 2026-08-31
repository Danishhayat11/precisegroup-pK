/**
 * Regression: at 768×1024 (iPad portrait / `md` breakpoint) the
 * notifications popover — anchored to the header bell, rendered into
 * Radix's portal, and aligned `end` so it hugs the topbar's right edge —
 * must keep the trigger AND every focusable control inside the panel
 * painting a full :focus-visible ring, uncut by:
 *   - the shell's `md:overflow-hidden` root
 *   - the topbar's inner shadows / hairline / halo layers
 *   - the popover's own rounded corners
 *   - the right edge of the viewport (align="end" is the failure mode
 *     most likely to reintroduce clipping if the trigger's box ever
 *     drifts past ~viewport-width - popover-width)
 *
 * Guardrails:
 *   1. Trigger receives visible focus and its outline halo is inside
 *      the viewport before the popover is opened.
 *   2. Opening the popover with Enter keeps focus behavior sane:
 *      the popover mounts, contains at least one focusable control,
 *      and every focusable control accepts keyboard focus with a
 *      visible focus indicator that is NOT clipped by its nearest
 *      overflow ancestor.
 *   3. The popover panel itself renders fully inside the viewport
 *      (left ≥ 0, right ≤ vw + tiny sub-pixel fudge) so a right-edge
 *      layout regression can't hide the last item behind the shell.
 *
 * Shared setup / focus-halo logic lives in `./_helpers/header-a11y`.
 *
 * Run:
 *   bunx playwright test tests/a11y/header-notifications-popover-focus.spec.ts \
 *        --project=chromium-reduced-motion
 */
import { test, expect } from "@playwright/test";
import {
  assertPopoverFocusRingsUnclipped,
  assertUnclippedFocus,
  describeHeaderSuite,
  type HeaderViewport,
} from "./_helpers/header-a11y";

const VIEWPORT: HeaderViewport = {
  label: "768x1024",
  width: 768,
  height: 1024,
};

describeHeaderSuite(
  `header notifications popover — focus rings unclipped @ ${VIEWPORT.label}`,
  VIEWPORT,
  () => {
    test("trigger focus ring is fully visible before opening", async ({ page }) => {
      const bell = page.getByRole("button", { name: /view notifications/i });
      await expect(bell).toBeVisible();
      const failures: string[] = [];
      await assertUnclippedFocus(page, bell, "notifications trigger (closed)", failures);
      expect(failures, failures.join("\n")).toEqual([]);
    });

    test("popover mounts inside the viewport when opened via keyboard", async ({ page }) => {
      const bell = page.getByRole("button", { name: /view notifications/i });
      await bell.focus();
      await page.keyboard.press("Enter");

      // Radix Popover portals the panel with `data-radix-popper-content-wrapper`
      // + our `data-notifications-popover` marker.
      const popover = page.locator("[data-notifications-popover]");
      await expect(popover).toBeVisible({ timeout: 5_000 });

      const rect = await popover.evaluate((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          vw: window.innerWidth,
          vh: window.innerHeight,
        };
      });
      expect(rect.left, `popover left ${rect.left} < 0`).toBeGreaterThanOrEqual(-1);
      expect(rect.right, `popover right ${rect.right} > vw ${rect.vw}`).toBeLessThanOrEqual(
        rect.vw + 1,
      );
      expect(rect.top).toBeGreaterThanOrEqual(-1);
      expect(rect.bottom).toBeLessThanOrEqual(rect.vh + 1);
    });

    test("every focusable control inside the popover paints an unclipped focus ring", async ({
      page,
    }) => {
      const bell = page.getByRole("button", { name: /view notifications/i });
      await bell.focus();
      await page.keyboard.press("Enter");

      const popover = page.locator("[data-notifications-popover]");
      await expect(popover).toBeVisible({ timeout: 5_000 });

      await assertPopoverFocusRingsUnclipped(
        page,
        popover,
        `notifications popover item @ ${VIEWPORT.width}×${VIEWPORT.height}`,
      );
    });
  },
);
