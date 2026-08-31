import { expect, test, type Page } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "./_authHelpers";

/**
 * Dashboard — animation duration / easing / reduced-motion contract.
 *
 * Locks the specific timing values declared by the "Dashboard Perfection
 * Layer v3" in `src/styles.css` for each interactive surface. A drift on
 * any of these values changes the perceived feel of the dashboard, so we
 * assert the exact computed duration and easing per component.
 *
 * Expected values (source of truth: `src/styles.css` iOS perfection layer):
 *
 *   ┌─────────────────────┬────────────┬───────────────────────────────────┐
 *   │ Surface             │ Duration   │ Easing                            │
 *   ├─────────────────────┼────────────┼───────────────────────────────────┤
 *   │ Card                │ 260 ms     │ cubic-bezier(0.22, 1, 0.36, 1)    │
 *   │ Button              │ 180 ms     │ cubic-bezier(0.22, 1, 0.36, 1)    │
 *   │ Input / Select      │ 180 ms     │ ease                              │
 *   │ Table row (tbody)   │ 160 ms     │ ease                              │
 *   └─────────────────────┴────────────┴───────────────────────────────────┘
 *
 * Companion to `dashboard-reduced-motion.spec.ts` (which audits the
 * global neutralisation catch-all). This spec asserts the *positive*
 * timing contract when motion IS allowed, plus a targeted per-component
 * reduced-motion check that all four surfaces collapse to ≤ 20 ms.
 */

const ROUTE = "/";
const HAS_AUTH = authAvailable();

const IOS_EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
const CSS_EASE = "ease";

interface Timing {
  durationMs: number;
  easing: string;
}

/**
 * Read the computed transition-duration and transition-timing-function
 * for a specific property from an element. When the element declares a
 * comma-separated `transition-property` list, we align duration/easing
 * to the property's index (per CSS spec resolution).
 */
async function readTiming(
  page: Page,
  selector: string,
  property: "transform" | "box-shadow" | "background-color" | "border-color",
): Promise<Timing | null> {
  return page.evaluate(
    ({ sel, prop }) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      const cs = getComputedStyle(el);
      const props = cs.transitionProperty.split(",").map((s) => s.trim());
      const durs = cs.transitionDuration.split(",").map((s) => s.trim());
      const eases = cs.transitionTimingFunction.split(",").map((s) => s.trim());

      const parseMs = (s: string): number => {
        if (!s) return 0;
        if (s.endsWith("ms")) return parseFloat(s);
        if (s.endsWith("s")) return parseFloat(s) * 1000;
        return 0;
      };

      // Prefer an exact property match; fall back to `all` if present;
      // otherwise return the first entry (the CSS shorthand fills every
      // property with the same value in that case).
      let idx = props.indexOf(prop);
      if (idx === -1) idx = props.indexOf("all");
      if (idx === -1) idx = 0;

      return {
        durationMs: parseMs(durs[idx % Math.max(durs.length, 1)] ?? "0"),
        easing: eases[idx % Math.max(eases.length, 1)] ?? "",
      };
    },
    { sel: selector, prop: property },
  );
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(200);
}

test.describe("Dashboard — motion timing contract", () => {
  test.skip(
    !HAS_AUTH,
    "Requires an injected Lovable-managed Supabase session (LOVABLE_BROWSER_AUTH_STATUS=injected).",
  );

  /* ─────────────────────────────────────────────────────────────────
     Positive-timing contract — motion allowed.
     Emulate `reducedMotion: 'no-preference'` so the global catch-all
     in `src/styles.css` does NOT neutralise durations. We then read
     the computed timing on live components and assert the exact
     duration + easing the perfection layer declares.
     ───────────────────────────────────────────────────────────────── */
  test.describe("motion allowed — exact per-component timings", () => {
    test.use({ reducedMotion: "no-preference" });

    test.beforeEach(async ({ context, page }) => {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await restoreSupabaseSession(context, page);
      await page.goto(ROUTE, { waitUntil: "domcontentloaded" });
      await expect(
        page.locator('[data-theme="ios"]').first(),
        "iOS shell should mount",
      ).toBeVisible();
      await settle(page);
    });

    test("card — 260ms cubic-bezier(0.22,1,0.36,1) on transform + box-shadow", async ({ page }) => {
      const selector = 'main [data-slot="card"]:not([data-brand-accent])';
      const first = page.locator(selector).first();
      await expect(first, "A default dashboard card should render").toBeVisible();

      for (const prop of ["transform", "box-shadow"] as const) {
        const t = await readTiming(page, selector, prop);
        expect(t, `Timing for card.${prop} should be readable`).not.toBeNull();
        // Allow ±5ms tolerance for browser rounding of subsecond values.
        expect(
          Math.abs(t!.durationMs - 260),
          `card.${prop} duration expected ~260ms, got ${t!.durationMs}ms`,
        ).toBeLessThanOrEqual(5);
        expect(t!.easing, `card.${prop} easing should be the iOS ease-out`).toBe(IOS_EASE_OUT);
      }
    });

    test("primary button — 180ms cubic-bezier(0.22,1,0.36,1) on transform", async ({ page }) => {
      const selector = "main button.bg-primary";
      const first = page.locator(selector).first();
      await expect(first, "A primary-filled button should render").toBeVisible();

      const t = await readTiming(page, selector, "transform");
      expect(t).not.toBeNull();
      expect(
        Math.abs(t!.durationMs - 180),
        `button transform duration expected ~180ms, got ${t!.durationMs}ms`,
      ).toBeLessThanOrEqual(5);
      expect(t!.easing).toBe(IOS_EASE_OUT);
    });

    test("input / textarea — 180ms ease on border-color", async ({ page }) => {
      // The perfection layer scopes input styling to non-checkbox/radio.
      const selector = 'main input:not([type="checkbox"]):not([type="radio"])';
      const count = await page.locator(selector).count();
      test.skip(count === 0, "No text input rendered on the dashboard landing view.");

      const t = await readTiming(page, selector, "border-color");
      expect(t).not.toBeNull();
      expect(
        Math.abs(t!.durationMs - 180),
        `input border-color duration expected ~180ms, got ${t!.durationMs}ms`,
      ).toBeLessThanOrEqual(5);
      expect(t!.easing).toBe(CSS_EASE);
    });

    test("table row — 160ms ease on background-color", async ({ page }) => {
      const selector = "main table tbody tr";
      const count = await page.locator(selector).count();
      test.skip(count === 0, "No table rendered on the dashboard for this account.");

      const t = await readTiming(page, selector, "background-color");
      expect(t).not.toBeNull();
      expect(
        Math.abs(t!.durationMs - 160),
        `table row background-color duration expected ~160ms, got ${t!.durationMs}ms`,
      ).toBeLessThanOrEqual(5);
      expect(t!.easing).toBe(CSS_EASE);
    });
  });

  /* ─────────────────────────────────────────────────────────────────
     Reduced-motion contract — every component collapses to ≤ 20ms.
     The universal catch-all in `src/styles.css` forces every
     transition/animation duration to 0.01ms; browsers round this to
     ~0.01–1ms depending on precision. We assert ≤ 20ms to be robust
     to rounding while still catching any rule that leaks past the
     media query (e.g. an inline style with a hardcoded duration, or
     a media-query-scoped rule declared AFTER the catch-all).
     ───────────────────────────────────────────────────────────────── */
  test.describe("reduced-motion — per-component neutralisation", () => {
    test.use({ reducedMotion: "reduce" });

    test.beforeEach(async ({ context, page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await restoreSupabaseSession(context, page);
      await page.goto(ROUTE, { waitUntil: "domcontentloaded" });
      await expect(
        page.locator('[data-theme="ios"]').first(),
        "iOS shell should mount",
      ).toBeVisible();
      await settle(page);

      const rmMatches = await page.evaluate(
        () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
      expect(rmMatches, "reduced-motion should be emulated as reduce").toBe(true);
    });

    const MAX = 20; // ms

    test("card transform + shadow duration ≤ 20ms", async ({ page }) => {
      const selector = 'main [data-slot="card"]:not([data-brand-accent])';
      await expect(page.locator(selector).first()).toBeVisible();
      for (const prop of ["transform", "box-shadow"] as const) {
        const t = await readTiming(page, selector, prop);
        expect(t!.durationMs, `card.${prop} should be neutralised`).toBeLessThanOrEqual(MAX);
      }
    });

    test("primary button transform duration ≤ 20ms", async ({ page }) => {
      const selector = "main button.bg-primary";
      await expect(page.locator(selector).first()).toBeVisible();
      const t = await readTiming(page, selector, "transform");
      expect(t!.durationMs, "button transform should be neutralised").toBeLessThanOrEqual(MAX);
    });

    test("input border-color duration ≤ 20ms", async ({ page }) => {
      const selector = 'main input:not([type="checkbox"]):not([type="radio"])';
      const count = await page.locator(selector).count();
      test.skip(count === 0, "No text input rendered.");
      const t = await readTiming(page, selector, "border-color");
      expect(t!.durationMs, "input border-color should be neutralised").toBeLessThanOrEqual(MAX);
    });

    test("table row background-color duration ≤ 20ms", async ({ page }) => {
      const selector = "main table tbody tr";
      const count = await page.locator(selector).count();
      test.skip(count === 0, "No table rendered.");
      const t = await readTiming(page, selector, "background-color");
      expect(t!.durationMs, "row background-color should be neutralised").toBeLessThanOrEqual(MAX);
    });

    test("no running Web Animations under reduced-motion", async ({ page }) => {
      // Drive both hover + focus so any hover-only or focus-only animation
      // would have started before the audit reads getAnimations().
      const card = page.locator('main [data-slot="card"]:not([data-brand-accent])').first();
      if (await card.count()) {
        await card.scrollIntoViewIfNeeded();
        await card.hover();
      }
      const button = page.locator("main button.bg-primary").first();
      if (await button.count()) {
        await button.evaluate((el: HTMLElement) => el.focus({ preventScroll: true }));
      }
      await page.waitForTimeout(300);

      const running = await page.evaluate(() =>
        (document.getAnimations?.() ?? [])
          .filter((a) => a.playState === "running")
          .map((a) => a.id || "anonymous"),
      );
      expect(
        running,
        `Expected zero running animations under reduced-motion, saw: ${JSON.stringify(running)}`,
      ).toEqual([]);
    });
  });
});
