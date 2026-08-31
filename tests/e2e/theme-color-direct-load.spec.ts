import { expect, test, type Page } from "@playwright/test";

/**
 * Fresh direct-load theme-color contract.
 *
 * A "direct load" here = a fresh browser context landing on the route via a
 * hard navigation (`page.goto`). This exercises the SSR HTML + the
 * pre-hydration script in `src/routes/__root.tsx` — the same path a user
 * hits when they click a shared link or paste a URL into the address bar.
 * No in-app client navigation, no toggle interaction.
 *
 * For every marketing route, in both light and dark, we assert:
 *   1. Exactly one <meta name="theme-color"> is present after first paint.
 *   2. Its `content` matches the seeded literal (#F8FAFC light / #070B14 dark).
 *   3. <html class="dark"> and inline `color-scheme` agree with the meta.
 *
 * Light is driven by emulating `prefers-color-scheme: light` with empty
 * storage (system → light). Dark is driven by seeding `precise.theme=dark`
 * via `addInitScript` BEFORE first navigation so the pre-hydration script
 * sees it on the very first paint (no reload).
 */

const STORAGE_KEY = "precise.theme";
const LIGHT_COLOR = "#F8FAFC";
const DARK_COLOR = "#070B14";

const ROUTES = ["/site", "/site/contact", "/site/services", "/site/projects"] as const;

type Snapshot = {
  hasDarkClass: boolean;
  colorScheme: string;
  themeColorCount: number;
  themeColorContent: string | null;
  themeColorContents: string[];
};

async function readThemeColor(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const metas = Array.from(
      document.head.querySelectorAll('meta[name="theme-color"]'),
    ) as HTMLMetaElement[];
    return {
      hasDarkClass: document.documentElement.classList.contains("dark"),
      colorScheme: document.documentElement.style.colorScheme,
      themeColorCount: metas.length,
      themeColorContent: metas[0]?.getAttribute("content") ?? null,
      themeColorContents: metas.map((m) => m.getAttribute("content") ?? ""),
    };
  });
}

for (const path of ROUTES) {
  test(`direct load: theme-color meta is correct for LIGHT on ${path}`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    try {
      const page = await context.newPage();
      // Belt-and-braces: no persisted preference, and system pref is light,
      // so DEFAULT_THEME=system resolves to light on first paint.
      await page.addInitScript((k) => {
        try {
          localStorage.removeItem(k);
        } catch {}
      }, STORAGE_KEY);

      await page.goto(path, { waitUntil: "load" });

      const snap = await readThemeColor(page);
      expect(snap.hasDarkClass, `no .dark on ${path}`).toBe(false);
      expect(snap.colorScheme, `color-scheme:light on ${path}`).toBe("light");
      expect(
        snap.themeColorCount,
        `exactly one <meta name="theme-color"> on ${path} (light), got ${JSON.stringify(snap.themeColorContents)}`,
      ).toBe(1);
      expect(snap.themeColorContent, `theme-color=LIGHT on ${path}`).toBe(LIGHT_COLOR);
    } finally {
      await context.close();
    }
  });

  test(`direct load: theme-color meta is correct for DARK on ${path}`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    try {
      const page = await context.newPage();
      // Seed the explicit "dark" override BEFORE first navigation so the
      // pre-hydration script paints dark on this route's very first frame —
      // no client-side reload, no toggle click.
      await page.addInitScript(
        ([k, v]) => {
          try {
            localStorage.setItem(k, v);
          } catch {}
        },
        [STORAGE_KEY, "dark"] as const,
      );

      await page.goto(path, { waitUntil: "load" });

      const snap = await readThemeColor(page);
      expect(snap.hasDarkClass, `.dark on ${path}`).toBe(true);
      expect(snap.colorScheme, `color-scheme:dark on ${path}`).toBe("dark");
      expect(
        snap.themeColorCount,
        `exactly one <meta name="theme-color"> on ${path} (dark), got ${JSON.stringify(snap.themeColorContents)}`,
      ).toBe(1);
      expect(snap.themeColorContent, `theme-color=DARK on ${path}`).toBe(DARK_COLOR);
    } finally {
      await context.close();
    }
  });
}
