/**
 * E2E focus-visible gate for header ICON buttons on /site and /dashboard.
 *
 * For every reachable, visible, icon-only interactive control inside the
 * header scope, tab focus to it and assert the browser paints a VISIBLE
 * focus indicator — i.e. at least one of `outline`, `box-shadow`, or
 * `border` changes to a non-empty, non-transparent state when the element
 * is `:focus-visible`, versus the unfocused baseline.
 *
 * Definition of "icon button" for this spec:
 *   A `<button>`, `<a>`, `[role="button"]`, or `[role="link"]` whose
 *   trimmed visible text is empty (i.e. label comes from `aria-label` /
 *   sr-only), which is the shape produced by shadcn `Button size="icon"`
 *   and `Toggle`. We deliberately skip text buttons — their focus ring is
 *   already covered by axe + visual regression.
 *
 * We simulate keyboard focus (Tab), not `.focus()`, because Chromium only
 * matches `:focus-visible` on keyboard-driven focus. Clicking or calling
 * `.focus()` from JS suppresses the ring by design.
 *
 * Header scope matches `header-controls-names.spec.ts`:
 *   /site       → first <header> (marketing SiteChrome).
 *   /dashboard  → AppShell sticky <header>.
 *
 * The `RESPONSIVE_SMOKE_DEVICES` env filter narrows the viewport matrix
 * so CI push runs one viewport while PRs sweep the full set.
 *
 * Run:
 *   bunx playwright test tests/a11y/header-icon-focus-visible.spec.ts \
 *        --project=chromium-reduced-motion
 */
import { test, expect, type Page, type Locator } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const HAS_SESSION = Boolean(STORAGE_KEY && SESSION_JSON);

type RouteCase = {
  name: string;
  path: string;
  requiresAuth: boolean;
  scope: string;
  ready: (page: Page) => Promise<void>;
};

const ROUTES: RouteCase[] = [
  {
    name: "site",
    path: "/site",
    requiresAuth: false,
    scope: "header",
    ready: async (page) => expect(page.locator("header").first()).toBeVisible({ timeout: 10_000 }),
  },
  {
    name: "dashboard",
    path: "/dashboard",
    requiresAuth: true,
    scope: "header",
    ready: async (page) => expect(page.getByRole("main")).toBeVisible({ timeout: 15_000 }),
  },
];

async function seedSessionIfAvailable(page: Page) {
  if (!HAS_SESSION) return;
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

async function gotoRoute(page: Page, route: RouteCase) {
  if (route.requiresAuth) await seedSessionIfAvailable(page);
  try {
    await page.goto(`${BASE}${route.path}`, { waitUntil: "domcontentloaded" });
  } catch (err) {
    if (!/ERR_ABORTED/.test(String((err as Error).message))) throw err;
    await page.goto(`${BASE}${route.path}`, { waitUntil: "domcontentloaded" });
  }
  await route.ready(page);
  await page.evaluate(() => document.fonts?.ready);
}

/**
 * Collect a stable key for every visible ICON-only interactive control
 * inside `scope`. The key is (aria-label ‖ title ‖ testid) — the same
 * strings used to identify the control in `header-controls-names.spec.ts`
 * so failures cross-reference cleanly. We also record a CSS selector for
 * post-focus computed-style lookup.
 */
async function collectIconTargets(scope: Locator) {
  return await scope.evaluateAll((roots) => {
    const root = roots[0];
    if (!root) return [];
    const SELECTOR = 'button, a[href], [role="button"], [role="link"]';
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(SELECTOR));
    const out: Array<{ key: string; selector: string }> = [];
    let idx = 0;
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (r.width === 0 || r.height === 0) continue;
      if (style.display === "none" || style.visibility === "hidden") continue;
      if ((el as HTMLButtonElement).disabled) continue;
      if (el.getAttribute("aria-hidden") === "true") continue;
      if (el.tabIndex < 0) continue;

      // "Icon-only": no visible text content. Whitespace-only counts as
      // empty. sr-only spans have zero layout width but their text is in
      // `textContent`; strip nodes that are visually hidden.
      const visibleText = Array.from(el.childNodes)
        .map((n) => {
          if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? "";
          if (n.nodeType === Node.ELEMENT_NODE) {
            const child = n as HTMLElement;
            const cs = window.getComputedStyle(child);
            if (
              cs.position === "absolute" &&
              (cs.clip === "rect(0px, 0px, 0px, 0px)" || child.classList.contains("sr-only"))
            ) {
              return "";
            }
            return child.textContent ?? "";
          }
          return "";
        })
        .join("")
        .trim();
      if (visibleText.length > 0) continue;

      // Tag a unique data attribute so we can re-query the same node
      // after Tab focus lands on it (accessible names are not always
      // unique — two "Close" buttons in one header would collide).
      const marker = `focusvis-${idx++}`;
      el.setAttribute("data-focusvis-id", marker);

      const label =
        el.getAttribute("aria-label") ??
        el.getAttribute("title") ??
        el.getAttribute("data-testid") ??
        el.className.slice(0, 60) ??
        marker;

      out.push({
        key: label.trim() || marker,
        selector: `[data-focusvis-id="${marker}"]`,
      });
    }
    return out;
  });
}

/** Snapshot the focus-visible-relevant computed style. */
async function readFocusStyle(page: Page, selector: string) {
  return await page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return null;
    const s = window.getComputedStyle(el);
    return {
      outlineStyle: s.outlineStyle,
      outlineWidth: s.outlineWidth,
      outlineColor: s.outlineColor,
      boxShadow: s.boxShadow,
      borderColor: s.borderColor,
      borderWidth: s.borderWidth,
    };
  }, selector);
}

/**
 * Is this style "visibly focused"? An indicator counts if any of:
 *   - outline has non-zero width AND non-`none` style AND non-transparent color
 *   - box-shadow is not "none" (shadcn ring uses ring shadow)
 *   - border differs from the unfocused baseline (color or width)
 */
function hasVisibleFocus(
  focused: NonNullable<Awaited<ReturnType<typeof readFocusStyle>>>,
  baseline: NonNullable<Awaited<ReturnType<typeof readFocusStyle>>>,
) {
  const transparent = (c: string) => c === "rgba(0, 0, 0, 0)" || c === "transparent" || c === "";
  const outlineOk =
    focused.outlineStyle !== "none" &&
    parseFloat(focused.outlineWidth) > 0 &&
    !transparent(focused.outlineColor);
  const shadowOk = focused.boxShadow !== "none" && focused.boxShadow !== baseline.boxShadow;
  const borderOk =
    focused.borderColor !== baseline.borderColor || focused.borderWidth !== baseline.borderWidth;
  return outlineOk || shadowOk || borderOk;
}

// --- Breakpoint matrix (shared vocabulary with responsive-breakpoints) ----
type Device = "mobile" | "tablet" | "desktop";
const VIEWPORTS: Record<Device, { width: number; height: number }> = {
  mobile: { width: 375, height: 1200 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1440, height: 1400 },
};
const SMOKE_DEVICES = (process.env.RESPONSIVE_SMOKE_DEVICES ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter((s): s is Device => (["mobile", "tablet", "desktop"] as string[]).includes(s));
const ACTIVE_DEVICES: Device[] =
  SMOKE_DEVICES.length > 0 ? SMOKE_DEVICES : (Object.keys(VIEWPORTS) as Device[]);

for (const device of ACTIVE_DEVICES) {
  test.describe(`@ ${device} (${VIEWPORTS[device].width}px)`, () => {
    test.use({ viewport: VIEWPORTS[device] });

    for (const route of ROUTES) {
      test.describe(`header icon focus-visible — ${route.name}`, () => {
        test.skip(
          route.requiresAuth && !HAS_SESSION,
          "No Supabase session available for authenticated route",
        );

        test(`every icon button paints a visible focus ring on Tab`, async ({ page }) => {
          await gotoRoute(page, route);
          const scope = page.locator(route.scope).first();
          await expect(scope).toBeVisible();

          const targets = await collectIconTargets(scope);
          // Header may legitimately have zero icon-only controls at a
          // given breakpoint (e.g. desktop /site with text-labeled nav).
          // Don't fail the test — the spec exists to gate icon buttons
          // when they exist, not to require them.
          test.skip(
            targets.length === 0,
            `[${device}] no icon-only controls in ${route.scope} on ${route.path}`,
          );

          // Baseline: capture unfocused computed style for every target
          // BEFORE any Tab press so the diff after focus is trustworthy.
          const baselines = new Map<
            string,
            NonNullable<Awaited<ReturnType<typeof readFocusStyle>>>
          >();
          for (const t of targets) {
            const s = await readFocusStyle(page, t.selector);
            if (s) baselines.set(t.selector, s);
          }

          await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
          await page.locator("body").focus();

          const remaining = new Map(targets.map((t) => [t.selector, t] as const));
          const failures: Array<{ key: string; reason: string }> = [];
          // Ceiling scales with target count so a header with many
          // preceding focusable controls (skip-link, wordmark, nav
          // items) can still reach the last icon button.
          const budget = Math.max(60, targets.length * 6);

          for (let i = 0; i < budget && remaining.size > 0; i++) {
            await page.keyboard.press("Tab");
            const activeSelector = await page.evaluate(() => {
              const el = document.activeElement as HTMLElement | null;
              const id = el?.getAttribute("data-focusvis-id");
              return id ? `[data-focusvis-id="${id}"]` : "";
            });
            if (!activeSelector || !remaining.has(activeSelector)) continue;

            const target = remaining.get(activeSelector)!;
            const focused = await readFocusStyle(page, activeSelector);
            const baseline = baselines.get(activeSelector);
            if (!focused || !baseline) {
              failures.push({
                key: target.key,
                reason: "could not read computed style after focus",
              });
            } else if (!hasVisibleFocus(focused, baseline)) {
              failures.push({
                key: target.key,
                reason: `no visible focus indicator — outline:${focused.outlineStyle}/${focused.outlineWidth}/${focused.outlineColor}, box-shadow:${focused.boxShadow}`,
              });
            }
            remaining.delete(activeSelector);
          }

          const unreached = [...remaining.values()].map((t) => t.key);
          expect(
            unreached,
            `[${device}] icon controls NOT reachable via Tab in ${route.scope}: ${JSON.stringify(unreached, null, 2)}`,
          ).toEqual([]);
          expect(
            failures,
            `[${device}] icon controls missing focus-visible styling in ${route.scope}:\n${JSON.stringify(failures, null, 2)}`,
          ).toEqual([]);
        });
      });
    }
  });
}
