import { expect, test, type Page } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "./_authHelpers";

/**
 * Breadcrumbs — visual regression across light + dark themes.
 *
 * Locks the top-bar breadcrumb trail against unintended drift in:
 *   • typography  (font size / weight / tracking / leading)
 *   • spacing     (gap, padding, radius)
 *   • token color (foreground / muted-foreground / accent hover)
 *
 * We take an *element* screenshot of `nav[aria-label="Breadcrumb"]` so the
 * baseline is stable against unrelated top-bar changes (search input, avatar,
 * notifications). Routes are picked to exercise every branch of the label
 * resolver:
 *
 *   /bookings                            → curated LABELS map ("Bookings")
 *   /admin/ssr-monitor                   → nested + multi-word slug
 *   /bookings/abcdef0123456789           → dynamic id → "#abcdef" fallback
 *
 * Screenshots are compared per (route × theme) with a small pixel tolerance
 * so anti-aliasing jitter never fails a good build; a token change that
 * shifts spacing or color WILL blow past the threshold.
 */

const CASES = [
  { route: "/bookings", slug: "curated-single" },
  { route: "/admin/ssr-monitor", slug: "nested-two-level" },
  { route: "/bookings/abcdef0123456789", slug: "dynamic-id-fallback" },
] as const;

const THEMES = ["light", "dark"] as const;

async function forceTheme(page: Page, theme: "light" | "dark") {
  // Pre-hydration write so the app's init script resolves the right theme on
  // first paint (mirrors `precise.theme` storage key used by src/lib/theme.tsx).
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

test.describe("Breadcrumbs — token-aligned across themes", () => {
  test.skip(!authAvailable(), "requires an injected Lovable session");

  for (const theme of THEMES) {
    for (const { route, slug } of CASES) {
      test(`${theme} · ${slug} (${route})`, async ({ context, page }) => {
        await forceTheme(page, theme);
        await restoreSupabaseSession(context, page);
        await page.goto(route, { waitUntil: "domcontentloaded" });

        const crumb = page.locator('nav[aria-label="Breadcrumb"]').first();
        await expect(crumb, "Breadcrumb nav should mount").toBeVisible();

        // Let motion + fonts settle so screenshots are stable.
        await page.evaluate(() => document.fonts?.ready);
        await page.waitForTimeout(150);

        // Structural asserts BEFORE the pixel snapshot — these fail with
        // clear messages when the label resolver drifts, so a diff isn't
        // needed to understand what broke.
        const currentPage = crumb.locator('[aria-current="page"]');
        await expect(currentPage, 'exactly one aria-current="page"').toHaveCount(1);

        if (slug === "dynamic-id-fallback") {
          // Confirms the fallback chain still collapses long hex ids.
          await expect(currentPage).toHaveText(/^#[0-9a-f]{6}$/i);
        }

        // Pixel baseline — spacing/typography/token guard.
        // maxDiffPixelRatio: 0.02 tolerates AA jitter (~2% of pixels) but
        // catches any real spacing/color/weight shift immediately.
        await expect(crumb).toHaveScreenshot(`breadcrumbs-${theme}-${slug}.png`, {
          maxDiffPixelRatio: 0.02,
          animations: "disabled",
        });
      });
    }
  }
});
