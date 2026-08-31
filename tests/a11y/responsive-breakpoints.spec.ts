/**
 * E2E responsive regression suite:
 *   Verify /site, /login, and the dashboard render at mobile / tablet /
 *   desktop breakpoints with:
 *     (a) ZERO horizontal overflow (page never scrolls sideways).
 *     (b) Interactive tap targets ≥ 44×44 CSS px on touch viewports
 *         (mobile + tablet), per WCAG 2.5.5 / iOS HIG.
 *
 * The dashboard lives under the `_authenticated` layout, so the same
 * session-seeding pattern used in `dashboard-hydration-failure.spec.ts`
 * is applied via `LOVABLE_BROWSER_SUPABASE_*`. When those env vars are
 * missing (running against a project without a mintable session) the
 * dashboard case is skipped instead of failing — the /site + /login
 * cases still run everywhere.
 *
 * Run:
 *   bunx playwright test tests/a11y/responsive-breakpoints.spec.ts \
 *        --project=chromium-reduced-motion
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const HAS_SESSION = Boolean(STORAGE_KEY && SESSION_JSON);

const SCREENSHOT_DIR = "/tmp/browser/responsive-breakpoints";
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// --- Breakpoint matrix ----------------------------------------------------
// Widths chosen to hit the two extremes real users see (iPhone SE at 375
// and small-Android/foldables just above it) plus a canonical tablet and
// desktop. Heights are generous so lazy-mounted below-the-fold content
// still ends up in the layout tree we assert against.
type Device = "mobile" | "tablet" | "desktop";
const VIEWPORTS: Record<Device, { width: number; height: number }> = {
  mobile: { width: 375, height: 1200 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1440, height: 1400 },
};
// WCAG 2.5.5 minimum target size = 44×44 CSS px. Enforced on touch
// viewports; on desktop pointer-precision devices we don't gate on it.
const MIN_TAP = 44;
const TOUCH_DEVICES: Device[] = ["mobile", "tablet"];

// --- Route matrix ---------------------------------------------------------
type RouteCase = {
  name: string;
  path: string;
  requiresAuth: boolean;
  /**
   * How we know the page finished its initial layout. We use a role/text
   * selector rather than `networkidle` because Supabase polling keeps the
   * network warm indefinitely on the dashboard.
   */
  ready: (page: Page) => Promise<void>;
};
const ROUTES: RouteCase[] = [
  {
    name: "site",
    path: "/site",
    requiresAuth: false,
    // The marketing site always renders a top-level <header> landmark.
    ready: async (page) =>
      await expect(page.locator("header").first()).toBeVisible({ timeout: 10_000 }),
  },
  {
    name: "login",
    path: "/login",
    requiresAuth: false,
    // Login renders an email input as its primary control.
    ready: async (page) =>
      await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10_000 }),
  },
  {
    name: "dashboard",
    path: "/dashboard",
    requiresAuth: true,
    // Dashboard's shell mounts an aria-live status region immediately
    // (loading OR loaded); either way SOMETHING inside <main> is visible
    // once hydration starts.
    ready: async (page) => await expect(page.getByRole("main")).toBeVisible({ timeout: 15_000 }),
  },
];

// --- Helpers --------------------------------------------------------------
async function seedSessionIfAvailable(page: Page) {
  if (!HAS_SESSION) return;
  // Establish the localhost origin before writing localStorage, so the
  // write lands on the right origin (see browser-use guidance).
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

/**
 * Horizontal overflow gate. We compare `scrollWidth` against `clientWidth`
 * on both <html> and <body> because different apps root their scroll on
 * different elements. A 1px tolerance absorbs sub-pixel rounding.
 */
async function assertNoHorizontalOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => ({
    docScroll: document.documentElement.scrollWidth,
    docClient: document.documentElement.clientWidth,
    bodyScroll: document.body.scrollWidth,
    bodyClient: document.body.clientWidth,
    innerWidth: window.innerWidth,
  }));
  const docOverflow = metrics.docScroll - metrics.docClient;
  const bodyOverflow = metrics.bodyScroll - metrics.bodyClient;
  expect(
    docOverflow,
    `[${label}] <html> horizontally overflows: ${JSON.stringify(metrics)}`,
  ).toBeLessThanOrEqual(1);
  expect(
    bodyOverflow,
    `[${label}] <body> horizontally overflows: ${JSON.stringify(metrics)}`,
  ).toBeLessThanOrEqual(1);

  // Belt + suspenders: find any DESCENDANT whose right edge extends past
  // the viewport AND whose overflow is NOT clipped by an ancestor. This
  // catches an inner container overflowing even when the page suppresses
  // the scrollbar with `overflow-x: hidden` on <html>/<body>, while
  // correctly ignoring decorative absolutely-positioned bleeds (radial
  // gradients, blurred blobs) that are safely clipped by a section
  // wrapper — those don't cause user-visible horizontal scroll.
  const offenders = await page.evaluate(
    (max) => {
      /** True iff `el` or one of its ancestors clips the x-axis. */
      function hasClippingAncestor(el: HTMLElement): boolean {
        let node: HTMLElement | null = el.parentElement;
        while (node && node !== document.documentElement) {
          const s = window.getComputedStyle(node);
          if (
            s.overflowX === "hidden" ||
            s.overflowX === "clip" ||
            s.overflow === "hidden" ||
            s.overflow === "clip"
          ) {
            return true;
          }
          node = node.parentElement;
        }
        return false;
      }
      const bad: Array<{ tag: string; cls: string; right: number }> = [];
      const els = Array.from(document.querySelectorAll<HTMLElement>("body *"));
      for (const el of els) {
        const r = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        if (style.position === "fixed") continue;
        // Pure decoration — can't be interacted with and layout doesn't hinge on it.
        if (style.pointerEvents === "none") continue;
        if (r.width === 0 || r.height === 0) continue;
        if (r.right - max <= 1) continue;
        // Clipped by an ancestor → not a user-visible overflow.
        if (hasClippingAncestor(el)) continue;
        bad.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.getAttribute("class") ?? "").slice(0, 120),
          right: Math.round(r.right),
        });
        if (bad.length >= 5) break;
      }
      return { viewport: max, offenders: bad };
    },
    (await page.viewportSize())!.width,
  );

  expect(
    offenders.offenders,
    `[${label}] elements overflow viewport: ${JSON.stringify(offenders)}`,
  ).toEqual([]);
}

/**
 * Tap-target gate. Every visible, actionable control (button, link,
 * input, [role=button|link|menuitem|tab|switch|checkbox]) must have a
 * bounding box ≥ 44×44. We EXCLUDE:
 *   - controls with `aria-hidden="true"` (invisible to AT anyway)
 *   - controls inside a closed `<details>` or `hidden` ancestor
 *   - controls whose bounding box is 0 (not laid out)
 *   - dev-tools/story chrome (`[data-testid^="dev-"]`) — none in prod.
 */
async function assertTapTargets(page: Page, label: string) {
  const violations = await page.evaluate((min) => {
    const SELECTOR = [
      "button",
      "a[href]",
      "input:not([type='hidden'])",
      "select",
      "textarea",
      "summary",
      "[role='button']",
      "[role='link']",
      "[role='menuitem']",
      "[role='tab']",
      "[role='switch']",
      "[role='checkbox']",
    ].join(",");
    const bad: Array<{ tag: string; text: string; w: number; h: number }> = [];
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR));
    for (const el of nodes) {
      if (el.getAttribute("aria-hidden") === "true") continue;
      if (el.closest("[hidden]")) continue;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      // Skip disabled inputs — they aren't a tap target for real users.
      if ((el as HTMLButtonElement).disabled) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Visually-hidden helpers (sr-only skip links, screen-reader-only
      // announcers) collapse to a 1x1 clipped box and only become a real
      // tap target when focused — exclude them from the size gate.
      if (r.width <= 1 && r.height <= 1) continue;
      // Off-screen (e.g. sticky footer below the fold) — still assert size
      // because when it scrolls into view it must be tappable.
      if (r.width < min || r.height < min) {
        bad.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 40),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
      if (bad.length >= 10) break;
    }
    return bad;
  }, min);

  expect(
    violations,
    `[${label}] tap targets smaller than ${MIN_TAP}x${MIN_TAP}: ${JSON.stringify(violations)}`,
  ).toEqual([]);
}

const min = MIN_TAP;

// --- Test matrix ----------------------------------------------------------
// `RESPONSIVE_SMOKE_DEVICES` (comma-separated: `mobile`, `tablet`,
// `desktop`) narrows the breakpoint matrix — used by the CI "smoke"
// mode on `push` to run just one viewport per commit while full PR
// runs keep the whole matrix. Unknown device names are ignored; an
// empty / unset value runs everything.
const SMOKE_DEVICES = (process.env.RESPONSIVE_SMOKE_DEVICES ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter((s): s is Device => (["mobile", "tablet", "desktop"] as string[]).includes(s));
const ACTIVE_DEVICES: Device[] =
  SMOKE_DEVICES.length > 0 ? SMOKE_DEVICES : (Object.keys(VIEWPORTS) as Device[]);

for (const device of ACTIVE_DEVICES) {
  test.describe(`responsive @ ${device} (${VIEWPORTS[device].width}px)`, () => {
    test.use({ viewport: VIEWPORTS[device] });

    for (const route of ROUTES) {
      test(`${route.name} — no horizontal overflow${TOUCH_DEVICES.includes(device) ? " + 44px tap targets" : ""}`, async ({
        page,
      }) => {
        if (route.requiresAuth && !HAS_SESSION) {
          test.skip(true, "No LOVABLE_BROWSER_SUPABASE_* session in env — skipping authed route.");
        }

        if (route.requiresAuth) {
          await seedSessionIfAvailable(page);
        }

        await page.goto(`${BASE}${route.path}`, { waitUntil: "domcontentloaded" });
        await route.ready(page);

        // Give layout one paint frame so any post-hydration reflow settles.
        await page.evaluate(
          () =>
            new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
        );

        // Screenshot for the artifact on failure. Keep it viewport-only so
        // it stays under the "no full_page" rule from the browser-use guide.
        await page.screenshot({
          path: `${SCREENSHOT_DIR}/${device}-${route.name}.png`,
        });

        await assertNoHorizontalOverflow(page, `${device}:${route.name}`);
        if (TOUCH_DEVICES.includes(device)) {
          await assertTapTargets(page, `${device}:${route.name}`);
        }
      });
    }
  });
}
