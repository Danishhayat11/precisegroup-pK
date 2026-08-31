import { expect, test, type Page } from "@playwright/test";

/**
 * /site marketing home — automated visual regression snapshots.
 *
 * Guards the marketing home page against unintended color/layout drift
 * from CSS token or component changes. Captures full-page screenshots
 * at two viewports × two themes (4 baselines total).
 *
 * The whole test uses reduced-motion, disables animations, hides caret,
 * pins DPR=1, and waits for fonts + all hero imagery to fully decode
 * before capturing — see playwright.config.ts for global defaults.
 *
 * Run:
 *   bun run test:visual:marketing-home
 *   # promote baselines after an intentional visual change:
 *   bun run test:visual:marketing-home:update
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

async function settle(page: Page) {
  await page.goto("/site", { waitUntil: "networkidle" });
  // Wait for web fonts so text metrics are stable across runs.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Scroll the whole page top→bottom so lazy-loaded imagery below the fold
  // enters the viewport and starts decoding. Without this, `loading="lazy"`
  // images never fire `load` and the image-wait below hangs.
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.9));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 50));
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 100));
    window.scrollTo(0, 0);
  });
  // Wait for every <img> in the DOM to finish decoding — the hero + gallery
  // photography is a common source of one-pixel jitter otherwise.
  await page.evaluate(async () => {
    const imgs = Array.from(document.images);
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
  // One RAF to let post-load layout settle.
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
}

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 1800 },
  { name: "mobile", width: 390, height: 1800 },
] as const;

const THEMES = ["light", "dark"] as const;

for (const theme of THEMES) {
  for (const vp of VIEWPORTS) {
    test(`site home visual — ${vp.name} · ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await applyTheme(page, theme);
      await settle(page);

      // Full-page capture — catches color shifts AND vertical layout drift
      // (a shifted section pushes every downstream pixel).
      await expect(page).toHaveScreenshot(`site-home-${vp.name}-${theme}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.003,
        timeout: 30_000,
      });
    });
  }
}
