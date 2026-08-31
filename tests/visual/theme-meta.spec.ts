import { expect, test, type Page } from "@playwright/test";

/**
 * theme-color / color-scheme meta tag guard.
 *
 * Two-layer contract:
 *
 *   A. SERVED HTML (raw fetch, no JS) — deterministic across themes because
 *      SSR ships the light default and the pre-hydration script mutates
 *      the DOM after parse. We assert the served HTML for / and /site
 *      contains:
 *        · <meta name="color-scheme" content="light dark">
 *        · <meta id="app-theme-color" name="theme-color" content="#F8FAFC">
 *      Fails loudly if either meta is dropped from __root.tsx head(), or
 *      if the SSR default drifts from styles.css --background.
 *
 *   B. POST-HYDRATION DOM per theme — the THEME_INIT_SCRIPT in <head>
 *      reads localStorage and swaps `theme-color` to the dark hex when
 *      the stored theme resolves dark. We seed `precise.theme` before
 *      navigation and assert the meta's `content` matches the expected
 *      hex for each (route × theme) pair. Guards the init-script contract
 *      and keeps the meta in sync with --background token values.
 *
 * Kept literal here (not imported from src/lib/theme.tsx) so a token
 * drift in the app fails the test instead of silently updating the
 * expectation.
 */

const ROUTES = ["/", "/site"] as const;
const THEME_COLOR_LIGHT = "#F8FAFC";
const THEME_COLOR_DARK = "#070B14";
const THEME_STORAGE_KEY = "precise.theme";
const THEME_META_ID = "app-theme-color";

// ---------- A. Served HTML ----------
for (const path of ROUTES) {
  test(`served HTML on ${path} carries color-scheme + theme-color meta`, async ({
    request,
    baseURL,
  }) => {
    const res = await request.get(new URL(path, baseURL).toString());
    expect(res.ok(), `GET ${path} should 200`).toBe(true);
    const html = await res.text();

    // color-scheme: static "light dark" hint for the UA (form controls, scrollbars).
    expect(
      /<meta[^>]+name=["']color-scheme["'][^>]+content=["']light dark["']/i.test(html),
      `served HTML ${path} missing <meta name="color-scheme" content="light dark">`,
    ).toBe(true);

    // theme-color: SSR ships the light default; the init script swaps at runtime.
    const themeColor = html.match(
      new RegExp(`<meta[^>]+id=["']${THEME_META_ID}["'][^>]+content=["']([^"']+)["']`, "i"),
    );
    expect(themeColor, `served HTML ${path} missing <meta id="${THEME_META_ID}">`).not.toBeNull();
    expect(themeColor![1].toUpperCase(), `SSR theme-color on ${path} should default to light`).toBe(
      THEME_COLOR_LIGHT.toUpperCase(),
    );
  });
}

// ---------- B. Post-hydration DOM per theme ----------
async function seedTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript(
    ([k, v]) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* storage unavailable */
      }
    },
    [THEME_STORAGE_KEY, theme] as const,
  );
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
}

for (const path of ROUTES) {
  for (const theme of ["light", "dark"] as const) {
    test(`hydrated theme-color reflects ${theme} on ${path}`, async ({ page }) => {
      await seedTheme(page, theme);
      await page.goto(path, { waitUntil: "domcontentloaded" });

      // color-scheme meta is static — assert it survived hydration.
      const scheme = await page.locator('meta[name="color-scheme"]').getAttribute("content");
      expect(scheme, `color-scheme meta missing on ${path}`).toBe("light dark");

      // theme-color meta swaps via THEME_INIT_SCRIPT before first paint.
      const expected = theme === "dark" ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
      const themeColor = await page.locator(`meta#${THEME_META_ID}`).getAttribute("content");
      expect(themeColor, `theme-color meta missing on ${path}`).not.toBeNull();
      expect(themeColor!.toUpperCase(), `theme-color for ${theme} on ${path}`).toBe(
        expected.toUpperCase(),
      );

      // Belt & braces: <html> color-scheme inline style should agree with the
      // resolved theme — catches the case where the meta was updated but the
      // root class/inline style drifted.
      const inlineScheme = await page.evaluate(() => document.documentElement.style.colorScheme);
      expect(inlineScheme, `html color-scheme for ${theme} on ${path}`).toBe(theme);
    });
  }
}
