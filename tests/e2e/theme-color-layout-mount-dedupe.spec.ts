import { expect, test, type Page, type BrowserContext } from "@playwright/test";

/**
 * Site-wide guarantee: mounting/unmounting the two big layout shells
 * (marketing `SiteChrome` under `/site/*` and authenticated `AppShell`
 * under `/_authenticated/*`) MUST NOT accumulate `<meta name="theme-color">`
 * tags in <head>.
 *
 * The theme-color meta is owned by the root shell (src/routes/__root.tsx),
 * not by the layout shells — but a subtle regression is easy to introduce:
 * any layout, provider, or app-shell portal that renders its own <meta>
 * via a head manager would silently accumulate on every mount. This test
 * walks a path that repeatedly tears down and re-mounts each shell, and
 * after every stop asserts `document.head.querySelectorAll('meta[name=
 * "theme-color"]').length === 1` — the only correct count.
 *
 * Path (LIGHT theme, so we isolate this contract from the known
 * hydration-timing meta-dup bug that only manifests with dark seeded):
 *
 *   /site              (SiteChrome mount)
 *   /site/contact      (SiteChrome persists across sibling routes)
 *   /                  (SiteChrome unmount, AppShell mount)
 *   /site              (AppShell unmount, SiteChrome mount)
 *   /_authenticated /  (SiteChrome unmount, AppShell re-mount)
 *   /site/services     (AppShell unmount, SiteChrome re-mount)
 *
 * If the authenticated Supabase session isn't available in the sandbox,
 * the test skips the AppShell legs and still exercises marketing-only
 * mount/unmount churn (`/site` ↔ `/site/contact` ↔ `/site/services`),
 * which is enough to catch layout-owned meta accumulation on public
 * routes.
 */

const STORAGE_KEY = "precise.theme";
const LIGHT_COLOR = "#F8FAFC";

type Snapshot = {
  path: string;
  count: number;
  contents: string[];
  ids: string[];
};

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const metas = Array.from(
      document.head.querySelectorAll('meta[name="theme-color"]'),
    ) as HTMLMetaElement[];
    return {
      path: window.location.pathname,
      count: metas.length,
      contents: metas.map((m) => m.getAttribute("content") ?? ""),
      ids: metas.map((m) => m.getAttribute("id") ?? ""),
    };
  });
}

function assertSingleMeta(snap: Snapshot, stage: string) {
  expect(
    snap.count,
    `${stage} (${snap.path}): exactly one <meta name="theme-color"> — got ${snap.count} with contents ${JSON.stringify(snap.contents)} and ids ${JSON.stringify(snap.ids)}`,
  ).toBe(1);
  expect(snap.contents[0], `${stage}: content = LIGHT literal`).toBe(LIGHT_COLOR);
  expect(snap.ids[0], `${stage}: surviving meta is the app-managed one`).toBe("app-theme-color");
}

async function goAndSettle(page: Page, path: string) {
  // `waitUntil: 'load'` matches how a real user perceives the page; a
  // secondary networkidle wait catches any post-hydration meta injection
  // by a shell / provider that mounts after the initial paint.
  await page.goto(path, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
}

/**
 * Restore the Lovable-injected Supabase session so `/_authenticated/*`
 * doesn't bounce to /login. Returns false when no session is available.
 */
async function restoreSupabaseSession(context: BrowserContext, page: Page): Promise<boolean> {
  const storageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
  const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
  const cookiesJson = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON;
  if (!storageKey || !sessionJson) return false;

  if (cookiesJson) {
    const cookies = (JSON.parse(cookiesJson) as Array<Record<string, unknown>>).map(
      (c) => ({ ...c, url: "http://localhost:8080" }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as any;
    await context.addCookies(cookies);
  }
  await page.goto("http://localhost:8080/site", { waitUntil: "load" });
  await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
    storageKey,
    sessionJson,
  ] as const);
  return true;
}

test("layout mount/unmount across marketing ↔ authenticated shells never duplicates theme-color meta", async ({
  browser,
}) => {
  const context = await browser.newContext({ colorScheme: "light" });
  try {
    const page = await context.newPage();

    // Pin LIGHT before ANY navigation so the pre-hydration script paints
    // light on the first frame — this test is scoped to layout-mount
    // dedupe, not the dark-hydration timing behavior.
    await page.addInitScript(
      ([k]) => {
        try {
          localStorage.setItem(k, "light");
        } catch {}
      },
      [STORAGE_KEY] as const,
    );

    const authRestored =
      process.env.LOVABLE_BROWSER_AUTH_STATUS === "injected" &&
      (await restoreSupabaseSession(context, page));

    // ---------- Marketing shell (SiteChrome) mount ------------------
    await goAndSettle(page, "/site");
    assertSingleMeta(await snapshot(page), "1) mount SiteChrome on /site");

    // ---------- Sibling marketing route (SiteChrome persists) -------
    await goAndSettle(page, "/site/contact");
    assertSingleMeta(await snapshot(page), "2) sibling /site/contact");

    // ---------- Another sibling → force layout to re-render ---------
    await goAndSettle(page, "/site/services");
    assertSingleMeta(await snapshot(page), "3) sibling /site/services");

    // ---------- Round-trip back to /site — SiteChrome re-render -----
    await goAndSettle(page, "/site");
    assertSingleMeta(await snapshot(page), "4) round-trip back to /site");

    if (!authRestored) {
      test.info().annotations.push({
        type: "skip-detail",
        description:
          "No Supabase session available — skipped AppShell mount/unmount legs. Marketing-only churn was still validated.",
      });
      return;
    }

    // ---------- Cross-shell hop: SiteChrome → AppShell --------------
    await goAndSettle(page, "/");
    // Guard: if the auth gate bounced us to /login, the session restore
    // silently failed and this test's "shell swap" premise is invalid.
    expect(new URL(page.url()).pathname, "landed on authenticated /").not.toBe("/login");
    assertSingleMeta(await snapshot(page), "5) mount AppShell on /");

    // ---------- Back to marketing: AppShell → SiteChrome ------------
    await goAndSettle(page, "/site");
    assertSingleMeta(await snapshot(page), "6) unmount AppShell → mount SiteChrome");

    // ---------- One more cross-shell hop to confirm no accumulation -
    await goAndSettle(page, "/");
    expect(new URL(page.url()).pathname).not.toBe("/login");
    assertSingleMeta(await snapshot(page), "7) mount AppShell again on /");

    await goAndSettle(page, "/site/projects");
    assertSingleMeta(await snapshot(page), "8) final marketing leaf /site/projects");
  } finally {
    await context.close();
  }
});
