import { expect, test, type Page } from "@playwright/test";

/**
 * theme-color dedupe guard.
 *
 * The shell in src/routes/__root.tsx emits a single dynamic
 *   <meta id="app-theme-color" name="theme-color" content="…">
 * that the pre-hydration script and ThemeProvider mutate in place.
 *
 * Per-route head() entries MUST NOT emit a second <meta name="theme-color">.
 * TanStack Router dedupes meta by `name`/`property`, but only when routes
 * use the head() mechanism — a raw <meta> in a component's JSX bypasses
 * that dedupe, and browsers then honor only ONE of the two tags
 * (usually the last), silently defeating the runtime swap.
 *
 * This spec fails loudly if any route (served HTML or post-hydration DOM,
 * light or dark) ends up with more than one theme-color meta.
 *
 * Routes covered mirror theme-meta.spec.ts so future route additions get
 * added in both places together.
 */

const ROUTES = ["/", "/site"] as const;
const THEME_STORAGE_KEY = "precise.theme";

// ---------- A. Served HTML: exactly one <meta name="theme-color"> ----------
for (const path of ROUTES) {
  test(`served HTML on ${path} has exactly one theme-color meta`, async ({ request, baseURL }) => {
    const res = await request.get(new URL(path, baseURL).toString());
    expect(res.ok(), `GET ${path} should 200`).toBe(true);
    const html = await res.text();

    // Match <meta …name="theme-color"…> in either attribute order.
    const matches = html.match(/<meta\b[^>]*\bname=["']theme-color["'][^>]*>/gi) ?? [];
    expect(
      matches.length,
      `served HTML ${path} should carry exactly one <meta name="theme-color">, found ${matches.length}:\n${matches.join("\n")}`,
    ).toBe(1);
  });
}

// ---------- B. Post-hydration DOM per theme: still exactly one ----------
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
    test(`hydrated DOM on ${path} (${theme}) has exactly one theme-color meta`, async ({
      page,
    }) => {
      await seedTheme(page, theme);
      await page.goto(path, { waitUntil: "domcontentloaded" });

      const count = await page.locator('head meta[name="theme-color"]').count();
      expect(
        count,
        `hydrated DOM ${path} (${theme}) should carry exactly one <meta name="theme-color">, found ${count}`,
      ).toBe(1);
    });
  }
}

// ---------- B2. Hard reload per theme: still exactly one ----------
// Block B measures the first navigation only. A hard reload exercises a
// different codepath — the browser tears down the document, re-runs the
// pre-hydration <script> in __root.tsx from a warm cache, then rehydrates.
// A regression where the init script or ThemeProvider injects a *second*
// theme-color meta on rehydrate (instead of mutating the existing one in
// place) shows up here and only here. Wait for `load` so all deferred
// scripts have executed before we count.
const LIGHT_CONTENT = "#F8FAFC";
const DARK_CONTENT = "#070B14";

for (const path of ROUTES) {
  for (const theme of ["light", "dark"] as const) {
    test(`hard reload on ${path} (${theme}) keeps exactly one theme-color meta`, async ({
      page,
    }) => {
      await seedTheme(page, theme);
      await page.goto(path, { waitUntil: "load" });

      const meta = page.locator('head meta[name="theme-color"]');
      await expect(meta, `pre-reload on ${path} (${theme})`).toHaveCount(1);

      // Hard refresh — F5 semantics. Reuses the cached document but
      // re-runs every script tag, including the pre-hydration theme
      // init that owns the single <meta id="app-theme-color">.
      await page.reload({ waitUntil: "load" });

      await expect(
        meta,
        `after hard reload on ${path} (${theme}), <meta name="theme-color"> must not duplicate`,
      ).toHaveCount(1);

      // The one remaining meta must still carry the correct value for
      // the seeded theme — proves we didn't just delete both.
      await expect(meta).toHaveAttribute(
        "content",
        theme === "dark" ? DARK_CONTENT : LIGHT_CONTENT,
      );

      // A second reload catches regressions that only leak on the
      // *third* document lifecycle (idempotency bugs where the init
      // script appends on every rehydrate after the first).
      await page.reload({ waitUntil: "load" });
      await expect(
        meta,
        `after second hard reload on ${path} (${theme}), <meta name="theme-color"> must not duplicate`,
      ).toHaveCount(1);
    });
  }
}

// ---------- C. Runtime light↔dark swap (no reload): still exactly one ----------
// Seeds theme='system' so ThemeProvider's matchMedia listener drives the swap.
// Playwright's `emulateMedia({ colorScheme })` updates prefers-color-scheme
// and fires the change event ThemeProvider subscribes to — exercising the
// same in-place mutation path as the ThemeToggle UI, without navigating or
// reloading. The active theme-color <meta> must remain unique AND its
// `content` must actually swap between the light/dark literals.
const THEME_COLOR_LIGHT = "#F8FAFC";
const THEME_COLOR_DARK = "#070B14";

for (const path of ROUTES) {
  test(`runtime theme swap on ${path} keeps exactly one theme-color meta`, async ({ page }) => {
    // Force 'system' so the matchMedia listener is active; start in light.
    await page.addInitScript(
      ([k]) => {
        try {
          localStorage.setItem(k, "system");
        } catch {
          /* noop */
        }
      },
      [THEME_STORAGE_KEY] as const,
    );
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });

    // Capture a marker on window so we can prove no full reload happened.
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      (window as unknown as { __noReload?: number }).__noReload = Date.now();
    });

    const meta = page.locator('head meta[name="theme-color"]');
    await expect(meta).toHaveCount(1);
    await expect(meta).toHaveAttribute("content", THEME_COLOR_LIGHT);

    // Swap to dark without navigating.
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await expect(meta).toHaveAttribute("content", THEME_COLOR_DARK);
    await expect(meta, `dark swap on ${path} must not duplicate theme-color meta`).toHaveCount(1);

    // Swap back to light without navigating.
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await expect(meta).toHaveAttribute("content", THEME_COLOR_LIGHT);
    await expect(meta, `light swap on ${path} must not duplicate theme-color meta`).toHaveCount(1);

    // No full reload occurred — window marker survived both swaps.
    const survived = await page.evaluate(
      () => typeof (window as unknown as { __noReload?: number }).__noReload === "number",
    );
    expect(survived, `runtime theme swap on ${path} unexpectedly reloaded the page`).toBe(true);
  });
}
