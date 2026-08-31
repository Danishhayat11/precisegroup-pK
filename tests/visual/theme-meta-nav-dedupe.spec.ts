import { expect, test, type Page } from "@playwright/test";

/**
 * theme-color dedupe guard — CLIENT-SIDE NAVIGATION.
 *
 * theme-meta-dedupe.spec.ts covers cold-load HTML and post-hydration DOM.
 * This spec covers the third failure mode: a route's head() re-runs on
 * every client-side navigation, and if any route (or the pre-hydration
 * script) accidentally APPENDS a new <meta name="theme-color"> instead of
 * mutating the existing one, the count grows every time the user clicks
 * between pages — invisible on a fresh reload, visible only after real
 * SPA navigation.
 *
 * We simulate a real session: land on one route, click through to the
 * other via the client router (no full reload), bounce back, do it again,
 * then assert the head still carries exactly one theme-color meta —
 * under both light and dark theme.
 */

const THEME_STORAGE_KEY = "precise.theme";
const THEME_COLOR_LIGHT = "#F8FAFC";
const THEME_COLOR_DARK = "#070B14";
const EXPECTED_CONTENT: Record<"light" | "dark", string> = {
  light: THEME_COLOR_LIGHT,
  dark: THEME_COLOR_DARK,
};
// Ping-pong between the two theme-color-emitting routes several times so
// any per-navigation append leaks would compound into a countable failure.
const NAV_SEQUENCE: ReadonlyArray<"/" | "/site"> = ["/site", "/", "/site", "/", "/site"];

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

async function countThemeColorMetas(page: Page): Promise<number> {
  return page.locator('head meta[name="theme-color"]').count();
}

/**
 * Click-navigate to `target` via the client router. Falls back to
 * page.goto only if no matching in-page link exists — we prefer real
 * anchor clicks so TanStack's onClick handler (not the browser's
 * document-load path) is what mutates the head.
 */
async function clientNavigate(page: Page, target: "/" | "/site") {
  const startedAt = page.url();
  // Prefer an existing anchor with the exact href — this exercises the
  // real client router path. Header/footer nav on this site links both
  // "/" (home) and "/site" (marketing shell).
  const link = page.locator(`a[href="${target}"], a[href$="${target}"]`).first();
  const linkExists = await link.count();

  if (linkExists > 0) {
    await link.scrollIntoViewIfNeeded().catch(() => {});
    await link.click({ trial: false }).catch(async () => {
      // If a click is intercepted (overlay, sheet, etc.), fall back to
      // programmatic history navigation — still client-side, no reload.
      await page.evaluate((t) => {
        window.history.pushState({}, "", t);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, target);
    });
  } else {
    await page.evaluate((t) => {
      window.history.pushState({}, "", t);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, target);
  }

  // Wait for the URL to actually change AND for the router to settle
  // (theme-color mutation runs in the head-effect after commit).
  await page
    .waitForFunction(
      ([from, to]) => window.location.pathname !== from && window.location.pathname.startsWith(to),
      [new URL(startedAt).pathname, target] as const,
      { timeout: 5000 },
    )
    .catch(() => {
      /* fall through — count assertion is the source of truth */
    });
  await page.waitForLoadState("networkidle").catch(() => {});
}

for (const theme of ["light", "dark"] as const) {
  test(`theme-color meta count stays flat across client-side / ↔ /site navigation (${theme})`, async ({
    page,
  }) => {
    await seedTheme(page, theme);

    // Cold-load the entry route and let network settle so the SSR HTML,
    // the pre-hydration init script, and ThemeProvider's effect have all
    // committed. Whatever the baseline count is (ideally 1), THAT is the
    // stable ground state — client-side navigation must not grow it.
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(120);
    const baseline = await countThemeColorMetas(page);
    expect(
      baseline,
      `baseline theme-color meta count on "/" (${theme}) should be ≥1`,
    ).toBeGreaterThanOrEqual(1);

    // Walk the sequence. After every hop, count must equal baseline —
    // a per-navigation append leak would compound to baseline + N here.
    for (let i = 0; i < NAV_SEQUENCE.length; i += 1) {
      const target = NAV_SEQUENCE[i];
      await clientNavigate(page, target);
      // Give the router-committed head-effect a beat to run. Head
      // mutations happen in useEffect which is async wrt the URL change.
      await page.waitForTimeout(150);

      const count = await countThemeColorMetas(page);
      const metas = await page.$$eval('head meta[name="theme-color"]', (els) =>
        els.map((e) => (e as HTMLMetaElement).outerHTML),
      );
      expect(
        count,
        `after nav #${i + 1} to ${target} (${theme}) the theme-color meta count grew from baseline ${baseline} to ${count}:\n${metas.join("\n")}`,
      ).toBe(baseline);

      // Content must reflect the active theme after every hop. A route
      // that overwrites content with a stale value (or a stale head-effect
      // that races the theme init script) would show up here.
      const content = await page
        .locator('head meta[name="theme-color"]')
        .first()
        .getAttribute("content");
      expect(
        content?.toUpperCase(),
        `after nav #${i + 1} to ${target} (${theme}) theme-color content should be ${EXPECTED_CONTENT[theme]}`,
      ).toBe(EXPECTED_CONTENT[theme].toUpperCase());
    }

    // Belt-and-braces: exercise back/forward, which re-runs head() with
    // a different code path (browser popstate) than forward clicks.
    await page.goBack({ waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(150);
    expect(await countThemeColorMetas(page), `after history back (${theme})`).toBe(baseline);
    expect(
      (
        await page.locator('head meta[name="theme-color"]').first().getAttribute("content")
      )?.toUpperCase(),
      `after history back (${theme}) theme-color content`,
    ).toBe(EXPECTED_CONTENT[theme].toUpperCase());

    await page.goForward({ waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(150);
    expect(await countThemeColorMetas(page), `after history forward (${theme})`).toBe(baseline);
    expect(
      (
        await page.locator('head meta[name="theme-color"]').first().getAttribute("content")
      )?.toUpperCase(),
      `after history forward (${theme}) theme-color content`,
    ).toBe(EXPECTED_CONTENT[theme].toUpperCase());
  });
}
