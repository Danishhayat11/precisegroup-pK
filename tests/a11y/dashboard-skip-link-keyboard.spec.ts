/**
 * E2E: keyboard activation of the "Skip to main content" link on
 * /dashboard.
 *
 * Verifies the full user path — not just CSS/box math (which
 * `dashboard-skip-link.spec.ts` already covers):
 *   1. Tab from a neutral starting point (document.body) reveals the
 *      skip link as the first focusable control — it becomes visible
 *      (not-sr-only, painted box ≥ 44×44) and is `document.activeElement`.
 *   2. Pressing Enter activates the link, moves focus into
 *      `<main id="main-content" tabIndex={-1}>`, and updates the URL
 *      hash to `#main-content`.
 *   3. Revealing + activating the skip link does NOT cause a layout
 *      shift of the surrounding page chrome — the link uses
 *      `focus:fixed` (out-of-flow overlay), so the header/sidebar/main
 *      bounding boxes must be pixel-identical before vs. after focus.
 *      A regression to `absolute` / in-flow positioning would push
 *      real content down and this assertion catches it.
 *
 * Run:
 *   bunx playwright test tests/a11y/dashboard-skip-link-keyboard.spec.ts \
 *        --project=chromium-reduced-motion
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const HAS_SESSION = Boolean(STORAGE_KEY && SESSION_JSON);

const MIN_TAP = 44;

type Rect = { x: number; y: number; w: number; h: number };

async function seedSession(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
    STORAGE_KEY,
    SESSION_JSON,
  ] as const);
  if (COOKIES_JSON) {
    const cookies = JSON.parse(COOKIES_JSON) as Array<Record<string, unknown>>;
    for (const c of cookies) c.url = BASE;
    await page.context().addCookies(cookies as never);
  }
}

async function rectOf(page: Page, selector: string): Promise<Rect | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    // Round to whole px — sub-pixel jitter under devicePixelRatio isn't
    // a real layout shift and would make the equality check flaky.
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  }, selector);
}

test.describe("dashboard skip link keyboard flow", () => {
  test.skip(!HAS_SESSION, "No Supabase session available for authenticated route");

  test.beforeEach(async ({ page }) => {
    await seedSession(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("main")).toBeVisible({ timeout: 15_000 });
  });

  test("Tab reveals it, Enter moves focus to main without layout shift", async ({ page }) => {
    const skip = page.getByRole("link", { name: /skip to main content/i });
    await expect(skip).toHaveCount(1);

    // Capture the chrome layout BEFORE any focus movement. We sample
    // three landmarks that surround the skip link — if any shift by
    // ≥ 1 CSS px after focus/activation, the link left the overlay
    // layer and pushed real content.
    const beforeMain = await rectOf(page, "#main-content");
    const beforeHeader = await rectOf(page, "header");
    const beforeBody = await rectOf(page, "body");
    expect(beforeMain, "main-content must be present before focus").not.toBeNull();

    // Neutral starting point — clicking `body` blurs whatever the
    // browser auto-focused after load (usually the first control),
    // so the next Tab lands on document order position 1, which is
    // the skip link.
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      document.body.setAttribute("tabindex", "-1");
      document.body.focus();
    });

    await page.keyboard.press("Tab");

    // (1) Skip link is now the focused element and visible.
    await expect(skip).toBeFocused();
    const focusedBox = await skip.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        w: r.width,
        h: r.height,
        position: cs.position,
        // `sr-only` uses clip-path: inset(50%). Once focus applies
        // `not-sr-only`, clip-path resets to `none`.
        clipPath: cs.clipPath,
      };
    });
    expect(
      focusedBox.w,
      `focused skip link width ${focusedBox.w} < ${MIN_TAP}`,
    ).toBeGreaterThanOrEqual(MIN_TAP);
    expect(
      focusedBox.h,
      `focused skip link height ${focusedBox.h} < ${MIN_TAP}`,
    ).toBeGreaterThanOrEqual(MIN_TAP);
    expect(focusedBox.position, "must overlay, not push content").toBe("fixed");
    expect(focusedBox.clipPath).not.toMatch(/inset\(\s*50%/);

    // (2) Enter activates → focus moves into <main id="main-content">.
    await page.keyboard.press("Enter");

    // Hash reflects the fragment target.
    await expect(page).toHaveURL(/#main-content$/);

    // Focus lands on the main region (tabIndex=-1 makes it
    // programmatically focusable so browsers move focus, not just
    // scroll position).
    const activeId = await page.evaluate(() => document.activeElement?.id ?? null);
    expect(activeId).toBe("main-content");

    // (3) No layout shift. Skip link is out-of-flow, so the chrome
    // rectangles must be byte-for-byte identical.
    const afterMain = await rectOf(page, "#main-content");
    const afterHeader = await rectOf(page, "header");
    const afterBody = await rectOf(page, "body");
    expect(afterMain).toEqual(beforeMain);
    expect(afterHeader).toEqual(beforeHeader);
    expect(afterBody).toEqual(beforeBody);
  });
});
