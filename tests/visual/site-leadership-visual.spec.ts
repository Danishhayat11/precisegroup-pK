import { expect, test, type Page } from "@playwright/test";

/**
 * /site — Leadership / Team section visual regression.
 *
 * Element-scoped screenshot of `#leadership` at 2 viewports × 2 themes.
 * Diffing the section (not the full page) keeps this spec stable when
 * unrelated marketing sections above/below change while still catching:
 *
 *   • TeamHeadshot <picture> layout drift (aspect ratio, radius, crop)
 *   • AVIF/WebP negotiation regressions surfacing a different raster
 *   • Card grid alignment / gutter changes
 *   • Token or typography drift on the leadership headings/roles
 *   • LQIP fade regressions (screenshot is captured post-load)
 *
 * Baselines live under
 *   tests/visual/site-leadership-visual.spec.ts-snapshots/
 * Promote intentional changes with:
 *   bun run test:visual:leadership:update
 */

const THEME_STORAGE_KEY = "precise.theme";

async function applyTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript(
    ({ key, value }) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* storage unavailable */
      }
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(value);
      root.style.colorScheme = value;
    },
    { key: THEME_STORAGE_KEY, value: theme },
  );
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
}

/**
 * Navigate, scroll the leadership section into view so lazy images decode,
 * wait for fonts + every <img> under `#leadership` to finish loading, and
 * then park scroll at the section top for a stable element capture.
 */
async function settleLeadership(page: Page) {
  await page.goto("/site", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  // Sweep the page so `loading="lazy"` team images enter the viewport
  // and start decoding. Without this the element screenshot captures
  // the LQIP blur instead of the real portrait.
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.9));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 50));
    }
  });

  await page.locator("#leadership").scrollIntoViewIfNeeded();

  // Wait for every <img> inside #leadership to fully decode.
  await page.evaluate(async () => {
    const root = document.querySelector("#leadership");
    if (!root) return;
    const imgs = Array.from(root.querySelectorAll("img"));
    await Promise.all(
      imgs.map((img) =>
        img.complete && img.naturalWidth > 0
          ? Promise.resolve()
          : new Promise<void>((r) => {
              img.addEventListener("load", () => r(), { once: true });
              img.addEventListener("error", () => r(), { once: true });
            }),
      ),
    );
  });

  // Two RAFs so the LQIP fade-out transition settles before capture.
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 1800 },
  { name: "mobile", width: 390, height: 1800 },
] as const;

const THEMES = ["light", "dark"] as const;

for (const theme of THEMES) {
  for (const vp of VIEWPORTS) {
    test(`site leadership visual — ${vp.name} · ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await applyTheme(page, theme);
      await settleLeadership(page);

      const section = page.locator("#leadership");
      await expect(section).toBeVisible();

      // Element-scoped screenshot — diff scope is the leadership grid
      // and its team cards only. `maxDiffPixelRatio` is a touch more
      // generous than the global default to absorb sub-pixel AA from
      // AVIF re-encodes, but still fails on any real layout or color
      // change.
      await expect(section).toHaveScreenshot(`site-leadership-${vp.name}-${theme}.png`, {
        maxDiffPixelRatio: 0.004,
        timeout: 30_000,
      });
    });
  }
}
