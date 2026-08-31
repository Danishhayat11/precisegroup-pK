import { expect, test } from "@playwright/test";

/**
 * Simulate OS-level `prefers-color-scheme` and `prefers-reduced-motion` flips
 * via Playwright's `page.emulateMedia()` — which dispatches a `change` event on
 * matching MediaQueryList objects, exactly like a real OS setting change would.
 *
 * The app's ThemeProvider (src/lib/theme.tsx) subscribes to both queries with
 * `useSyncExternalStore`, so a flip should be reflected in the DOM immediately
 * (next paint) without any user interaction or page reload:
 *
 *   prefers-color-scheme  → toggles <html class="dark">, html.style.color-scheme,
 *                           and the #app-theme-color <meta content>
 *   prefers-reduced-motion → toggles <html data-reduced-motion> and the
 *                            --motion-scale CSS custom property (0 vs 1)
 *
 * These assertions fail if the app ever regresses to a static/one-shot read of
 * matchMedia (e.g. only reading on mount, without subscribing to `change`).
 */

const STORAGE_KEY = "precise.theme";
const LIGHT_COLOR = "#F8FAFC";
const DARK_COLOR = "#070B14";

async function readState(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const meta = document.getElementById("app-theme-color");
    return {
      hasDarkClass: root.classList.contains("dark"),
      colorScheme: root.style.colorScheme,
      themeColor: meta?.getAttribute("content") ?? null,
      reducedMotionAttr: root.getAttribute("data-reduced-motion"),
      motionScale: getComputedStyle(root).getPropertyValue("--motion-scale").trim(),
    };
  });
}

test.describe("live matchMedia updates", () => {
  test("prefers-color-scheme changes update classes, color-scheme, and theme-color meta immediately", async ({
    browser,
  }) => {
    // Start in light; guarantee empty localStorage so ThemeProvider is in
    // "system" mode and truly follows prefers-color-scheme.
    const context = await browser.newContext({ colorScheme: "light" });
    try {
      const page = await context.newPage();
      await page.goto("/site", { waitUntil: "domcontentloaded" });

      const stored = await page.evaluate((k) => window.localStorage.getItem(k), STORAGE_KEY);
      expect(stored, 'localStorage must be empty so theme === "system"').toBeNull();

      // Baseline: light.
      let state = await readState(page);
      expect(state.hasDarkClass).toBe(false);
      expect(state.colorScheme).toBe("light");
      expect(state.themeColor).toBe(LIGHT_COLOR);

      // Flip OS → dark. Playwright fires `change` on the MediaQueryList; the
      // provider's useSyncExternalStore subscriber re-renders and applyTheme
      // runs in a layout effect before the next paint.
      await page.emulateMedia({ colorScheme: "dark" });

      // No reload, no navigation, no interaction — poll until the DOM reflects
      // the change. If the app regresses to a static read this will time out.
      await expect
        .poll(async () => (await readState(page)).hasDarkClass, { timeout: 2000 })
        .toBe(true);

      state = await readState(page);
      expect(state.hasDarkClass).toBe(true);
      expect(state.colorScheme).toBe("dark");
      expect(state.themeColor).toBe(DARK_COLOR);

      // Flip back → light, same expectations in reverse.
      await page.emulateMedia({ colorScheme: "light" });
      await expect
        .poll(async () => (await readState(page)).hasDarkClass, { timeout: 2000 })
        .toBe(false);

      state = await readState(page);
      expect(state.hasDarkClass).toBe(false);
      expect(state.colorScheme).toBe("light");
      expect(state.themeColor).toBe(LIGHT_COLOR);

      // Sanity: still no persistence — "system" mode never writes storage.
      const storedAfter = await page.evaluate((k) => window.localStorage.getItem(k), STORAGE_KEY);
      expect(storedAfter).toBeNull();
    } finally {
      await context.close();
    }
  });

  test("manual theme override is not clobbered by OS colorScheme changes", async ({ browser }) => {
    // Regression guard: if the user explicitly picks "light", flipping the OS
    // to dark must not flip the app — theme takes precedence over systemDark.
    const context = await browser.newContext({ colorScheme: "light" });
    try {
      const page = await context.newPage();
      await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [
        STORAGE_KEY,
        "light",
      ] as const);
      await page.goto("/site", { waitUntil: "domcontentloaded" });

      let state = await readState(page);
      expect(state.hasDarkClass).toBe(false);
      expect(state.themeColor).toBe(LIGHT_COLOR);

      await page.emulateMedia({ colorScheme: "dark" });

      // Give the change event a chance to propagate — but we EXPECT no change.
      await page.waitForTimeout(200);
      state = await readState(page);
      expect(state.hasDarkClass, 'manual "light" must survive OS → dark').toBe(false);
      expect(state.colorScheme).toBe("light");
      expect(state.themeColor).toBe(LIGHT_COLOR);
    } finally {
      await context.close();
    }
  });

  test("prefers-reduced-motion changes update data-reduced-motion and --motion-scale immediately", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "no-preference" });
    try {
      const page = await context.newPage();
      await page.goto("/site", { waitUntil: "domcontentloaded" });

      // Baseline: motion allowed.
      let state = await readState(page);
      expect(state.reducedMotionAttr).toBe("no-preference");
      expect(state.motionScale).toBe("1");

      // Flip OS → reduce.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect
        .poll(async () => (await readState(page)).reducedMotionAttr, { timeout: 2000 })
        .toBe("reduce");

      state = await readState(page);
      expect(state.reducedMotionAttr).toBe("reduce");
      expect(state.motionScale).toBe("0");

      // Flip back → no-preference.
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await expect
        .poll(async () => (await readState(page)).reducedMotionAttr, { timeout: 2000 })
        .toBe("no-preference");

      state = await readState(page);
      expect(state.motionScale).toBe("1");
    } finally {
      await context.close();
    }
  });

  test("color-scheme and reduced-motion are independent — flipping one does not touch the other", async ({
    browser,
  }) => {
    // Belt-and-braces: the two matchMedia subscribers must not share state.
    const context = await browser.newContext({
      colorScheme: "light",
      reducedMotion: "no-preference",
    });
    try {
      const page = await context.newPage();
      await page.goto("/site", { waitUntil: "domcontentloaded" });

      // Flip only color scheme — motion attrs must be untouched.
      await page.emulateMedia({ colorScheme: "dark" });
      await expect
        .poll(async () => (await readState(page)).hasDarkClass, { timeout: 2000 })
        .toBe(true);
      let state = await readState(page);
      expect(state.reducedMotionAttr).toBe("no-preference");
      expect(state.motionScale).toBe("1");

      // Flip only motion — dark class must persist.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect
        .poll(async () => (await readState(page)).reducedMotionAttr, { timeout: 2000 })
        .toBe("reduce");
      state = await readState(page);
      expect(state.hasDarkClass).toBe(true);
      expect(state.themeColor).toBe(DARK_COLOR);
      expect(state.motionScale).toBe("0");
    } finally {
      await context.close();
    }
  });
});
