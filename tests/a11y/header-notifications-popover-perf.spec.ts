/**
 * Performance regression guard: opening the header notifications
 * popover at 768×1024 must complete within a reasonable time budget.
 *
 * Complements the sibling popover specs:
 *   - header-notifications-popover-focus.spec.ts  — focus rings
 *   - header-notifications-popover-a11y.spec.ts   — structural a11y
 *
 * Why this exists
 * ---------------
 * The popover portal instantiates a fair amount of subtree work on
 * open: Radix Popper positioning, the notifications list render, any
 * data fetch the panel kicks off, plus reduced-motion CSS transitions.
 * A regression that quietly makes any of those synchronous — a heavy
 * `useMemo` deps churn, an un-memoized child list, a blocking
 * `fetch().then(setState)` in the render path — is invisible to
 * correctness tests but degrades every keyboard-only open.
 *
 * What we measure
 * ---------------
 * Wall-clock latency from the keydown that opens the popover to the
 * moment the panel is (a) rendered visible and (b) has at least one
 * focusable child that keyboard users can actually reach.
 *
 * We take N samples (open + Escape close, warmup discarded) and assert
 * the MEDIAN — not min, not max — so a single GC pause or a Vite HMR
 * blip does not turn this into a flaky red. The absolute budget is
 * generous on purpose: we're catching regressions, not benchmarking.
 *
 * Budget rationale
 * ----------------
 * A well-behaved local dashboard opens the popover in ~40–80ms in
 * dev. Reduced-motion strips the animation so there is no CSS
 * transition floor. 400ms median is well above realistic dev-mode
 * noise but far below any human-perceptible "slow" threshold, so a
 * doubling of the current cost fails here before it ships.
 *
 * Run:
 *   bunx playwright test tests/a11y/header-notifications-popover-perf.spec.ts \
 *        --project=chromium-reduced-motion
 */
import { test, expect } from "@playwright/test";
import {
  describeHeaderSuite,
  FOCUSABLE_SELECTOR,
  type HeaderViewport,
} from "./_helpers/header-a11y";

const VIEWPORT: HeaderViewport = {
  label: "768x1024",
  width: 768,
  height: 1024,
};

const POPOVER_SELECTOR = "[data-notifications-popover]";
/** Warmup opens (module init, first-paint fetch caching) that we discard. */
const WARMUP = 2;
/** Measured samples after warmup. */
const SAMPLES = 5;
/** Median latency budget, ms. See "Budget rationale" above. */
const MEDIAN_BUDGET_MS = 400;
/** Hard ceiling for the WORST sample — a single 2s open is still a bug. */
const MAX_BUDGET_MS = 1_000;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

describeHeaderSuite(
  `header notifications popover — open latency @ ${VIEWPORT.label}`,
  VIEWPORT,
  () => {
    test(`opens within ${MEDIAN_BUDGET_MS}ms median / ${MAX_BUDGET_MS}ms max over ${SAMPLES} samples`, async ({
      page,
    }) => {
      const bell = page.getByRole("button", { name: /view notifications/i });
      await expect(bell).toBeVisible();

      const samples: number[] = [];

      for (let i = 0; i < WARMUP + SAMPLES; i++) {
        await bell.focus();
        // Ensure popover is closed (defensive; prior sample closed it).
        await expect(page.locator(POPOVER_SELECTOR)).toBeHidden();

        // t0: capture just before dispatching the open key.
        const t0 = await page.evaluate(() => performance.now());
        await page.keyboard.press("Enter");

        // Wait for BOTH: panel visible AND at least one focusable
        // present. A regression that mounts an empty panel while the
        // notifications data is still loading would otherwise pass a
        // pure `toBeVisible` check while keyboard users stared at a
        // spinner they can't tab into.
        const popover = page.locator(POPOVER_SELECTOR);
        await expect(popover).toBeVisible({ timeout: MAX_BUDGET_MS + 500 });
        await popover
          .locator(FOCUSABLE_SELECTOR)
          .first()
          .waitFor({ state: "visible", timeout: MAX_BUDGET_MS + 500 });

        const t1 = await page.evaluate(() => performance.now());
        const elapsed = t1 - t0;

        if (i >= WARMUP) samples.push(elapsed);

        // Close and let the DOM settle before the next sample.
        await page.keyboard.press("Escape");
        await expect(popover).toBeHidden();
      }

      const med = median(samples);
      const worst = Math.max(...samples);

      // Attach the raw numbers so a failure report shows exactly which
      // sample blew the budget, not just "median exceeded".
      await test.info().attach("popover-open-latency-ms.json", {
        contentType: "application/json",
        body: Buffer.from(
          JSON.stringify(
            {
              viewport: VIEWPORT,
              samples,
              median: med,
              max: worst,
              budgets: {
                medianMs: MEDIAN_BUDGET_MS,
                maxMs: MAX_BUDGET_MS,
              },
            },
            null,
            2,
          ),
        ),
      });

      expect(
        med,
        `popover open MEDIAN ${med.toFixed(1)}ms exceeded ${MEDIAN_BUDGET_MS}ms budget (samples=${samples.map((s) => s.toFixed(1)).join(", ")})`,
      ).toBeLessThanOrEqual(MEDIAN_BUDGET_MS);
      expect(
        worst,
        `popover open WORST ${worst.toFixed(1)}ms exceeded ${MAX_BUDGET_MS}ms ceiling (samples=${samples.map((s) => s.toFixed(1)).join(", ")})`,
      ).toBeLessThanOrEqual(MAX_BUDGET_MS);
    });
  },
);
