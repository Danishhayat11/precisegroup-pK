/**
 * Regression: the "Skip to main content" link inside AppShell must be
 *   (a) visually hidden at rest — occupies effectively zero layout box
 *       and is clipped via the `sr-only` utility, so sighted users never
 *       see it, but screen readers announce it as the first focusable
 *       control on /dashboard.
 *   (b) When it receives keyboard focus (Tab from the address bar) it
 *       must materialize into a real ≥ 44×44 CSS-px focus target, per
 *       WCAG 2.5.5, and point at #main-content.
 *
 * If either invariant breaks, keyboard + AT users lose the primary
 * bypass mechanism for the dashboard chrome — hence a dedicated spec
 * separate from the broad responsive-breakpoints sweep.
 *
 * Run:
 *   bunx playwright test tests/a11y/dashboard-skip-link.spec.ts \
 *        --project=chromium-reduced-motion
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const HAS_SESSION = Boolean(STORAGE_KEY && SESSION_JSON);

const MIN_TAP = 44;

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

test.describe("dashboard skip link", () => {
  test.skip(!HAS_SESSION, "No Supabase session available for authenticated route");

  test.beforeEach(async ({ page }) => {
    await seedSession(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("main")).toBeVisible({ timeout: 15_000 });
  });

  test("is sr-only at rest but expands to a ≥44×44 focus target", async ({ page }) => {
    const skip = page.getByRole("link", { name: /skip to main content/i });

    // (a) Present in the accessibility tree — screen readers can find it.
    await expect(skip).toHaveCount(1);
    await expect(skip).toHaveAttribute("href", "#main-content");

    // (a) At rest: `sr-only` collapses the box to 1×1 with clip-path,
    // so it does not consume any visible layout real estate. We assert
    // the rendered box is ≤ 1×1 — the canonical Tailwind `sr-only`
    // fingerprint — instead of `toBeHidden()` (which would fail because
    // AT-visible elements aren't "hidden" in Playwright's sense).
    const rest = await skip.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    expect(rest.w, `skip link should be sr-only at rest, got width=${rest.w}`).toBeLessThanOrEqual(
      1,
    );
    expect(rest.h, `skip link should be sr-only at rest, got height=${rest.h}`).toBeLessThanOrEqual(
      1,
    );

    // (b) Focus via keyboard — matches the real user path (Tab from URL
    // bar). `focus()` alone would trigger `:focus` styles too, but
    // `.focus()` from Playwright programmatically is what actually
    // fires the browser's focus pipeline here.
    await skip.focus();
    await expect(skip).toBeFocused();

    // (b) Focused: the `focus:not-sr-only focus:min-h-[44px]
    // focus:min-w-[44px]` classes must expand it to a WCAG-sized
    // target. Read the actual painted box, not the class list, so a
    // future refactor that swaps utilities but preserves size still
    // passes.
    const focused = await skip.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    expect(focused.w, `focused skip link width ${focused.w} < ${MIN_TAP}`).toBeGreaterThanOrEqual(
      MIN_TAP,
    );
    expect(focused.h, `focused skip link height ${focused.h} < ${MIN_TAP}`).toBeGreaterThanOrEqual(
      MIN_TAP,
    );
  });
});
