import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end OS-theme simulation.
 *
 * Guards two contracts of the theme layer:
 *
 *   A. FIRST PAINT — THEME_INIT_SCRIPT (src/lib/theme.tsx) runs
 *      synchronously in <head> before hydration and MUST resolve the
 *      correct theme-color from the OS `prefers-color-scheme` when no
 *      preference is stored (default is `system`). We assert:
 *        · <html> gains `.dark` iff OS pref is dark
 *        · <html> inline `color-scheme` matches OS pref
 *        · <meta id="app-theme-color"> content == THEME_COLOR_DARK/LIGHT
 *
 *   B. LIVE OS CHANGE — with theme = "system", flipping the media query
 *      at runtime (a user changing OS appearance) must trigger the
 *      ThemeProvider's matchMedia listener and update the meta so the
 *      mobile URL bar / PWA status bar tracks the new OS pref without
 *      a reload.
 *
 * Uses page.emulateMedia() to swap the OS-level color-scheme preference;
 * Chromium fires the `change` event on `matchMedia("(prefers-color-scheme:
 * dark)")` in response, which is exactly what a real OS-level toggle does.
 *
 * Run:  bunx playwright test tests/visual/os-theme-swap.spec.ts
 *       bun run test:visual:os-theme-swap
 */

const ROUTES = ["/", "/site"] as const;
const THEME_COLOR_LIGHT = "#F8FAFC";
const THEME_COLOR_DARK = "#070B14";
const THEME_STORAGE_KEY = "precise.theme";
const THEME_META_ID = "app-theme-color";

// Clear any stored preference before navigation so the app falls back to
// `system` (DEFAULT_THEME). Otherwise a leftover explicit "light"/"dark" in
// localStorage would win and mask the OS-pref path we're validating.
async function clearStoredTheme(page: Page) {
  await page.addInitScript((k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* storage unavailable */
    }
  }, THEME_STORAGE_KEY);
}

async function readThemeState(page: Page) {
  return page.evaluate((metaId) => {
    const html = document.documentElement;
    const meta = document.getElementById(metaId) as HTMLMetaElement | null;
    return {
      hasDark: html.classList.contains("dark"),
      colorScheme: html.style.colorScheme,
      themeColor: meta?.getAttribute("content") ?? null,
    };
  }, THEME_META_ID);
}

// ---------- A. First paint honours OS pref ----------
for (const path of ROUTES) {
  for (const os of ["light", "dark"] as const) {
    test(`first paint: system → ${os} on ${path}`, async ({ page }) => {
      await clearStoredTheme(page);
      // Emulate OS-level pref BEFORE navigation so THEME_INIT_SCRIPT
      // sees it on first read.
      await page.emulateMedia({ colorScheme: os, reducedMotion: "reduce" });
      await page.goto(path, { waitUntil: "domcontentloaded" });

      const state = await readThemeState(page);
      const expected = os === "dark" ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
      expect(state.hasDark, `html.dark class for OS=${os} on ${path}`).toBe(os === "dark");
      expect(state.colorScheme, `html color-scheme for OS=${os} on ${path}`).toBe(os);
      expect(state.themeColor, `theme-color meta present on ${path}`).not.toBeNull();
      expect(state.themeColor!.toUpperCase(), `theme-color for OS=${os} on ${path}`).toBe(
        expected.toUpperCase(),
      );
    });
  }
}

// ---------- B. Live OS change with theme=system ----------
for (const path of ROUTES) {
  test(`live OS flip updates theme-color on ${path} (system mode)`, async ({ page }) => {
    await clearStoredTheme(page);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto(path, { waitUntil: "domcontentloaded" });

    // The provider's matchMedia("change") listener attaches in a useEffect,
    // so we must wait past hydration before flipping the OS pref — otherwise
    // the first flip fires with no listener attached and the meta stays put.
    await page.waitForLoadState("networkidle");
    await expect
      .poll(async () => (await readThemeState(page)).themeColor?.toUpperCase(), {
        timeout: 3_000,
      })
      .toBe(THEME_COLOR_LIGHT.toUpperCase());

    // OS flip → dark. matchMedia("(prefers-color-scheme: dark)").change fires
    // and the provider calls apply(dark), which writes the dark hex into meta.
    await page.emulateMedia({ colorScheme: "dark" });
    await expect
      .poll(async () => await readThemeState(page), { timeout: 3_000 })
      .toMatchObject({
        hasDark: true,
        colorScheme: "dark",
        themeColor: THEME_COLOR_DARK,
      });

    // OS flip back → light must also propagate (proves the listener isn't
    // one-shot and hasn't been detached).
    await page.emulateMedia({ colorScheme: "light" });
    await expect
      .poll(async () => await readThemeState(page), { timeout: 3_000 })
      .toMatchObject({
        hasDark: false,
        colorScheme: "light",
        themeColor: THEME_COLOR_LIGHT,
      });
  });
}

// ---------- C. Explicit stored theme wins over OS flips ----------
// Guardrail: when the user has pinned a theme (theme !== "system"), the
// provider does NOT subscribe to mq changes. An OS flip must leave the
// stored theme's meta untouched.
for (const stored of ["light", "dark"] as const) {
  test(`stored theme "${stored}" ignores OS flip on /site`, async ({ page }) => {
    await page.addInitScript(
      ([k, v]) => {
        try {
          localStorage.setItem(k, v);
        } catch {
          /* storage unavailable */
        }
      },
      [THEME_STORAGE_KEY, stored] as const,
    );
    // Start with OPPOSITE OS pref to prove the stored value overrides it.
    const opposite = stored === "dark" ? "light" : "dark";
    await page.emulateMedia({ colorScheme: opposite, reducedMotion: "reduce" });
    await page.goto("/site", { waitUntil: "domcontentloaded" });

    const expected = stored === "dark" ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
    await expect
      .poll(async () => (await readThemeState(page)).themeColor?.toUpperCase(), {
        timeout: 3_000,
      })
      .toBe(expected.toUpperCase());

    // Flip OS again — meta must stay pinned to the stored value.
    await page.emulateMedia({ colorScheme: stored });
    await page.waitForTimeout(200);
    await page.emulateMedia({ colorScheme: opposite });
    await page.waitForTimeout(200);

    const state = await readThemeState(page);
    expect(state.themeColor!.toUpperCase(), `stored=${stored} must ignore OS flips`).toBe(
      expected.toUpperCase(),
    );
    expect(state.hasDark, `html.dark for stored=${stored}`).toBe(stored === "dark");
  });
}
