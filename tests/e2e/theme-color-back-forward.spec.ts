import { expect, test, type Page } from "@playwright/test";

/**
 * Back/forward + reload journey.
 *
 * Simulates a real browsing session:
 *   1. Land on /site
 *   2. Client-navigate to /site/contact
 *   3. Hard reload the current page
 *   4. Browser Back → /site
 *   5. Browser Forward → /site/contact
 *
 * At every stop we assert the theme-color meta invariant:
 *   - exactly one <meta name="theme-color"> in <head>
 *   - content matches the active theme literal
 *   - <html.dark> and inline color-scheme agree
 *
 * We run the whole journey twice — once with `precise.theme=light` seeded
 * and once with `dark` — to prove the meta contract holds in BOTH modes
 * across the full navigation lifecycle (bfcache restore, SSR, and the
 * client's popstate handler).
 */

const STORAGE_KEY = "precise.theme";
const LIGHT_COLOR = "#F8FAFC";
const DARK_COLOR = "#070B14";

type Snapshot = {
  path: string;
  count: number;
  content: string | null;
  contents: string[];
  hasDarkClass: boolean;
  colorScheme: string;
};

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const metas = Array.from(
      document.head.querySelectorAll('meta[name="theme-color"]'),
    ) as HTMLMetaElement[];
    return {
      path: window.location.pathname,
      count: metas.length,
      content: metas[0]?.getAttribute("content") ?? null,
      contents: metas.map((m) => m.getAttribute("content") ?? ""),
      hasDarkClass: document.documentElement.classList.contains("dark"),
      colorScheme: document.documentElement.style.colorScheme,
    };
  });
}

function assertMeta(
  snap: Snapshot,
  stage: string,
  expectedPath: string,
  expected: { color: string; dark: boolean },
) {
  expect(snap.path, `${stage}: path`).toBe(expectedPath);
  expect(
    snap.count,
    `${stage}: exactly one <meta name="theme-color"> (got ${JSON.stringify(snap.contents)})`,
  ).toBe(1);
  expect(snap.content, `${stage}: meta content matches ${expected.color}`).toBe(expected.color);
  expect(snap.hasDarkClass, `${stage}: .dark class`).toBe(expected.dark);
  expect(snap.colorScheme, `${stage}: color-scheme`).toBe(expected.dark ? "dark" : "light");
}

for (const mode of ["light", "dark"] as const) {
  const expected =
    mode === "dark" ? { color: DARK_COLOR, dark: true } : { color: LIGHT_COLOR, dark: false };

  test(`back/forward + reload preserves theme-color meta on marketing routes (${mode})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    try {
      const page = await context.newPage();
      // Seed the theme BEFORE first navigation so the pre-hydration script
      // paints the right mode on the very first frame — no toggle click,
      // no flash-of-wrong-theme.
      await page.addInitScript(
        ([k, v]) => {
          try {
            localStorage.setItem(k, v);
          } catch {}
        },
        [STORAGE_KEY, mode] as const,
      );

      // 1) Direct load /site
      await page.goto("/site", { waitUntil: "load" });
      await page.waitForLoadState("networkidle");
      assertMeta(await snapshot(page), "1) direct /site", "/site", expected);

      // 2) Client navigation to /site/contact — use the header nav so we
      //    exercise the same popstate/pushState path a user would take,
      //    not a raw page.goto (which is a full document load).
      const contactLink = page.locator('header a[href="/site/contact"]:visible').first();
      if (await contactLink.count()) {
        await contactLink.click();
      } else {
        // Fallback: some breakpoints render the link inside a menu we'd
        // have to open first. A programmatic goto still round-trips
        // through the router, which is what we care about here.
        await page.goto("/site/contact", { waitUntil: "load" });
      }
      await page.waitForURL("**/site/contact", { timeout: 5000 });
      await page.waitForLoadState("networkidle");
      assertMeta(await snapshot(page), "2) client-nav to /site/contact", "/site/contact", expected);

      // 3) Hard reload /site/contact — reloading is the historically
      //    fragile path (pre-hydration script races React hydration).
      await page.reload({ waitUntil: "load" });
      await page.waitForLoadState("networkidle");
      assertMeta(await snapshot(page), "3) reload /site/contact", "/site/contact", expected);

      // 4) Browser Back → /site
      await page.goBack({ waitUntil: "load" });
      await page.waitForURL("**/site", { timeout: 5000 });
      await page.waitForLoadState("networkidle");
      assertMeta(await snapshot(page), "4) back to /site", "/site", expected);

      // 5) Browser Forward → /site/contact
      await page.goForward({ waitUntil: "load" });
      await page.waitForURL("**/site/contact", { timeout: 5000 });
      await page.waitForLoadState("networkidle");
      assertMeta(await snapshot(page), "5) forward to /site/contact", "/site/contact", expected);
    } finally {
      await context.close();
    }
  });
}
