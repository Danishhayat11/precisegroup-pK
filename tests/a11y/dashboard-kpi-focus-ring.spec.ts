/**
 * Focus-ring visibility + no-clip regression for the 8 KPI drill-down
 * buttons on /dashboard.
 *
 * Two related contracts under test (both keyboard-only — the ring MUST
 * be a `:focus-visible` state, not just `:focus`):
 *
 *   1. VISIBLE FOCUS OUTLINE
 *      Tailwind wires `focus-visible:ring-2 focus-visible:ring-primary/50`
 *      on each KPI tile. The ring is implemented as a `box-shadow`
 *      (Tailwind ring utility) so we compare the computed box-shadow
 *      before vs. after keyboard focus — a non-zero delta means a ring
 *      is actually painted. A regression that removes the utility, adds
 *      `focus:outline-none` without a `focus-visible` replacement, or
 *      swaps in a transparent colour must fail this test.
 *
 *   2. NO CLIP INSIDE THE VIEWPORT
 *      A focus ring that renders offscreen is invisible in practice.
 *      For each KPI we:
 *        - scroll the button into view,
 *        - focus it via Tab (so :focus-visible fires),
 *        - expand its bounding box by the ring width (~4px) to model the
 *          painted ring bounds,
 *        - assert those bounds fit inside the viewport AND inside every
 *          scrollable / clipping ancestor's client rect (catches
 *          `overflow: hidden` cropping the ring even when the button
 *          itself is visible).
 */
import { test, expect, type Locator } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "../visual/_authHelpers";

const KPI_LABELS = [
  "Total Sell Value",
  "Cash Recovered",
  "Total Adjustment Approved",
  "Total Adjustment Realised",
  "Commission Paid",
  "Total Received",
  "Total Pending Balance",
  "Current Overdue Amount",
] as const;

// Tailwind's `ring-2` is a 2px ring plus a 2px offset shadow layer, so
// the painted focus ring extends ~4px past the button's own border box.
const RING_EXPANSION_PX = 4;

test.use({
  viewport: { width: 1280, height: 1800 },
  colorScheme: "light",
  reducedMotion: "reduce",
});

test.beforeEach(async ({ context, page }) => {
  test.skip(
    !authAvailable(),
    'Skipped: LOVABLE_BROWSER_AUTH_STATUS is not "injected" — /dashboard would redirect to login.',
  );
  await restoreSupabaseSession(context, page);
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: `Open drill-down for ${KPI_LABELS[0]}`, exact: true })
    .waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(1200); // Framer entrance settle
});

/**
 * Move keyboard focus to a specific element via Tab, not `.focus()`.
 * `.focus()` triggers `:focus` but NOT `:focus-visible` in every engine —
 * WebKit in particular gates focus-visible on the "last input was
 * keyboard" heuristic. We seed that heuristic by pressing Tab from the
 * page body, then jump to the target via `evaluate` and one more Tab.
 * Simpler and engine-portable: click a neutral anchor to prime keyboard
 * mode, then Tab until the aria-label matches.
 */
async function keyboardFocus(page: import("@playwright/test").Page, ariaLabel: string) {
  // Prime keyboard-input mode without disturbing scroll — a plain
  // Tab from <body> works in all three engines because the browser
  // marks the next focus change as keyboard-originated.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press("Tab");
  // Now programmatically focus the target with a keyboard-flavoured
  // dispatch: focus() + a synthetic keydown so `:focus-visible` applies
  // even on engines that would otherwise clear it.
  await page.evaluate((label) => {
    const el = document.querySelector<HTMLElement>(
      `button[aria-label="${label.replace(/"/g, '\\"')}"]`,
    );
    if (!el) throw new Error(`No KPI button with aria-label "${label}"`);
    el.focus({ preventScroll: false });
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  }, ariaLabel);
}

async function computedBoxShadow(loc: Locator): Promise<string> {
  return loc.evaluate((el) => getComputedStyle(el).boxShadow);
}

test.describe("KPI drill-down buttons — focus ring visibility & clipping", () => {
  for (const label of KPI_LABELS) {
    test(`"${label}": has a visible focus ring and is not clipped in the viewport`, async ({
      page,
    }) => {
      const button = page.getByRole("button", {
        name: `Open drill-down for ${label}`,
        exact: true,
      });
      await expect(button, `KPI "${label}" must render`).toHaveCount(1);
      await button.scrollIntoViewIfNeeded();

      // Baseline: computed box-shadow while UNfocused.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
      const unfocusedShadow = await computedBoxShadow(button);

      // Move keyboard focus onto the tile.
      await keyboardFocus(page, `Open drill-down for ${label}`);
      await expect(button, "KPI must actually receive DOM focus").toBeFocused();

      // 1) Focus ring is painted — computed box-shadow must change.
      const focusedShadow = await computedBoxShadow(button);
      expect(
        focusedShadow,
        `KPI "${label}" must paint a visible focus ring on keyboard focus. ` +
          `Unfocused box-shadow: "${unfocusedShadow}", focused: "${focusedShadow}"`,
      ).not.toBe(unfocusedShadow);
      // ...and the focused shadow must not itself be "none" or fully
      // transparent (defends against a regression that swaps the ring
      // colour for `transparent`).
      expect(focusedShadow, `KPI "${label}" focused box-shadow must not be "none"`).not.toBe(
        "none",
      );
      expect(
        focusedShadow.includes("rgba(0, 0, 0, 0)") &&
          !focusedShadow.match(/rgba?\((?!0, ?0, ?0, ?0)/),
        `KPI "${label}" focused box-shadow must not be fully transparent (got "${focusedShadow}")`,
      ).toBe(false);

      // 2) Ring bounds fit inside the viewport.
      const box = await button.boundingBox();
      expect(box, `KPI "${label}" must have a layout box`).not.toBeNull();
      const ringBox = {
        left: box!.x - RING_EXPANSION_PX,
        top: box!.y - RING_EXPANSION_PX,
        right: box!.x + box!.width + RING_EXPANSION_PX,
        bottom: box!.y + box!.height + RING_EXPANSION_PX,
      };
      const viewport = page.viewportSize();
      expect(viewport, "viewport size must be known").not.toBeNull();
      expect(
        ringBox.left >= 0 &&
          ringBox.top >= 0 &&
          ringBox.right <= viewport!.width &&
          ringBox.bottom <= viewport!.height,
        `KPI "${label}" focus ring must fit inside viewport ` +
          `(ring bounds=${JSON.stringify(ringBox)}, viewport=${JSON.stringify(viewport)})`,
      ).toBe(true);

      // 3) Ring bounds are not clipped by any ancestor with
      //    `overflow: hidden|clip|scroll|auto`. Walk up the tree and
      //    compare against each clipping ancestor's client rect.
      const clipViolation = await button.evaluate((el, expansion) => {
        const rect = el.getBoundingClientRect();
        const ring = {
          left: rect.left - expansion,
          top: rect.top - expansion,
          right: rect.right + expansion,
          bottom: rect.bottom + expansion,
        };
        let node: HTMLElement | null = el.parentElement;
        while (node && node !== document.body) {
          const cs = getComputedStyle(node);
          const clips = ["hidden", "clip", "scroll", "auto"];
          const isClipping =
            clips.includes(cs.overflow) ||
            clips.includes(cs.overflowX) ||
            clips.includes(cs.overflowY);
          if (isClipping) {
            const anc = node.getBoundingClientRect();
            if (
              ring.left < anc.left ||
              ring.top < anc.top ||
              ring.right > anc.right ||
              ring.bottom > anc.bottom
            ) {
              return {
                ancestor:
                  node.tagName.toLowerCase() +
                  (node.id ? `#${node.id}` : "") +
                  (node.className
                    ? `.${String(node.className).split(/\s+/).slice(0, 3).join(".")}`
                    : ""),
                ancestorRect: {
                  left: anc.left,
                  top: anc.top,
                  right: anc.right,
                  bottom: anc.bottom,
                },
                ringRect: ring,
              };
            }
          }
          node = node.parentElement;
        }
        return null;
      }, RING_EXPANSION_PX);

      expect(
        clipViolation,
        `KPI "${label}" focus ring is clipped by an ancestor: ` +
          JSON.stringify(clipViolation, null, 2),
      ).toBeNull();
    });
  }
});
