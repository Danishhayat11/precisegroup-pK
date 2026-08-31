/**
 * E2E accessible-name + tab-order gate for header/chrome controls.
 *
 * Confirms three properties on /site, /login, /dashboard:
 *
 *   1. axe-core reports ZERO violations of `button-name`, `link-name`,
 *      `image-alt`, `input-button-name`, `aria-command-name`,
 *      `aria-input-field-name`, or `aria-toggle-field-name` inside the
 *      header scope. This is the exact rule set that catches an icon-
 *      only Button/Link shipped without an aria-label.
 *
 *   2. Every visible, non-disabled interactive element inside the
 *      header scope has a non-empty accessible name (computed via the
 *      browser's `ariaLabel` fallback chain: `aria-labelledby` →
 *      `aria-label` → visible text → `title`). This catches gaps axe
 *      doesn't cover (e.g. a link whose only child is an unlabeled
 *      <img>, or a Button whose text is set to whitespace).
 *
 *   3. Every one of those controls is reachable by keyboard: pressing
 *      Tab from `document.body` eventually lands on it, without any
 *      `tabindex="-1"` trap or `pointer-events:none` shadow overlay
 *      swallowing the focus.
 *
 * Header scope per route:
 *   /site       → first <header> (marketing SiteChrome).
 *   /dashboard  → AppShell sticky <header> inside <main>'s sibling shell.
 *   /login      → no <header> landmark by design (auth surface is a
 *                 form-only card). We scope to the auth card container
 *                 so the same rules apply to the buttons/links inside
 *                 the sign-in form + provider buttons.
 *
 * Run:
 *   bunx playwright test tests/a11y/header-controls-names.spec.ts \
 *        --project=chromium-reduced-motion
 */
import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
const HAS_SESSION = Boolean(STORAGE_KEY && SESSION_JSON);

// Rule ids that gate "every icon control has an accessible name".
// Keep this list explicit — using `.withTags("wcag2a")` would pull in
// dozens of unrelated checks that other suites already own (contrast,
// landmarks, etc.), producing noise on failure.
const NAME_RULES = [
  "button-name",
  "link-name",
  "image-alt",
  "input-button-name",
  "aria-command-name",
  "aria-input-field-name",
  "aria-toggle-field-name",
];

type RouteCase = {
  name: string;
  path: string;
  requiresAuth: boolean;
  /** CSS selector for the header/chrome region to scope the audit to. */
  scope: string;
  /** How we know the region has mounted. */
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
    name: "login",
    path: "/login",
    requiresAuth: false,
    // Login has no <header>/<main> landmark — the auth card IS the
    // chrome. `form` is the closest stable container that owns every
    // interactive control on the page (email, password, submit,
    // provider buttons, forgot-password link).
    scope: "form",
    ready: async (page) =>
      expect(page.locator('input[type="email"]')).toBeVisible({
        timeout: 10_000,
      }),
  },
  {
    name: "dashboard",
    path: "/dashboard",
    requiresAuth: true,
    // AppShell renders exactly one sticky top <header>. Scope to that
    // so we audit the top bar controls (menu, breadcrumbs, search,
    // notifications, account) without pulling in row-level actions
    // from the dashboard body.
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
  // Auth-protected routes race a client-side redirect from the seed
  // goto (/login → /dashboard once the session lands in localStorage),
  // which occasionally aborts an immediately-following goto with
  // net::ERR_ABORTED. One retry stabilises without hiding real errors.
  try {
    await page.goto(`${BASE}${route.path}`, { waitUntil: "domcontentloaded" });
  } catch (err) {
    if (!/ERR_ABORTED/.test(String((err as Error).message))) throw err;
    await page.goto(`${BASE}${route.path}`, { waitUntil: "domcontentloaded" });
  }
  await route.ready(page);
  // Fonts loaded before we count nodes — avoids racing an icon-only
  // button whose sr-only text is still hydrating.
  await page.evaluate(() => document.fonts?.ready);
}

/**
 * Return `{ role, name, selectorHint }` for every visible, enabled
 * interactive element inside `scope`. `name` is the ACCESSIBLE name as
 * the browser would compute it for AT — same fallback chain axe walks.
 */
async function collectInteractive(scope: Locator) {
  return await scope.evaluateAll((roots) => {
    const root = roots[0];
    if (!root) return [];
    const SELECTOR =
      'button, a[href], [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"], input:not([type="hidden"])';
    const out: Array<{
      tag: string;
      role: string;
      name: string;
      hint: string;
    }> = [];
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(SELECTOR));
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (r.width === 0 || r.height === 0) continue;
      if (style.display === "none" || style.visibility === "hidden") continue;
      if ((el as HTMLButtonElement).disabled) continue;
      if (el.getAttribute("aria-hidden") === "true") continue;

      // Accessible-name computation, mirroring axe's `accessible-text`:
      //   aria-labelledby → aria-label → visible text → title → alt (img)
      let name = "";
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        name = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .filter(Boolean)
          .join(" ");
      }
      if (!name) name = (el.getAttribute("aria-label") ?? "").trim();
      if (!name) name = (el.textContent ?? "").trim();
      if (!name) name = (el.getAttribute("title") ?? "").trim();
      if (!name && el.tagName === "IMG") name = (el.getAttribute("alt") ?? "").trim();
      // For an <input>, the associated <label> counts too.
      if (!name && el.tagName === "INPUT" && el.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        name = (lbl?.textContent ?? "").trim();
      }

      out.push({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") ?? (el.tagName === "A" ? "link" : el.tagName.toLowerCase()),
        name,
        // Grep-able hint so failures point at the exact node in source.
        hint:
          (el.getAttribute("data-testid") ??
            el.getAttribute("aria-label") ??
            (el.textContent ?? "").trim().slice(0, 40) ??
            el.className.slice(0, 60)) ||
          "(no identifier)",
      });
    }
    return out;
  });
}

// --- Breakpoint matrix ----------------------------------------------------
// Same widths as `responsive-breakpoints.spec.ts` so header/name gaps
// caught here map 1:1 onto overflow/tap-target regressions caught
// there — one shared "device" vocabulary across the a11y suite.
// `RESPONSIVE_SMOKE_DEVICES` (comma-separated: `mobile`, `tablet`,
// `desktop`) narrows the matrix so CI push runs a single viewport
// while PR runs sweep the full set.
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
      test.describe(`header controls — ${route.name}`, () => {
        test.skip(
          route.requiresAuth && !HAS_SESSION,
          "No Supabase session available for authenticated route",
        );

        test(`axe: no missing accessible names in header scope (${route.scope})`, async ({
          page,
        }) => {
          await gotoRoute(page, route);
          const results = await new AxeBuilder({ page })
            .include(route.scope)
            // Only run the rules that gate accessible-name presence, so a
            // contrast or landmark issue elsewhere doesn't drown the signal
            // this spec exists to catch.
            .withRules(NAME_RULES)
            .analyze();

          if (results.violations.length > 0) {
            const summary = results.violations
              .map((v) => {
                const nodes = v.nodes
                  .slice(0, 5)
                  .map((n) => `      target: ${n.target.join(" ")}`)
                  .join("\n");
                return `  · [${v.impact ?? "n/a"}] ${v.id} — ${v.help}\n    ${v.helpUrl}\n${nodes}`;
              })
              .join("\n");
            throw new Error(
              `[${device}] ${results.violations.length} accessible-name violation(s) in ${route.scope} on ${route.path}:\n${summary}`,
            );
          }
          expect(results.violations).toEqual([]);
        });

        test(`every interactive control has a non-empty accessible name`, async ({ page }) => {
          await gotoRoute(page, route);
          const scope = page.locator(route.scope).first();
          await expect(scope).toBeVisible();

          const controls = await collectInteractive(scope);
          expect(
            controls.length,
            `[${device}] expected at least one interactive control inside ${route.scope}`,
          ).toBeGreaterThan(0);

          const unnamed = controls.filter((c) => !c.name);
          expect(
            unnamed,
            `[${device}] controls missing accessible names in ${route.scope}: ${JSON.stringify(unnamed, null, 2)}`,
          ).toEqual([]);
        });

        test(`every interactive control is reachable via Tab`, async ({ page }) => {
          await gotoRoute(page, route);
          const scope = page.locator(route.scope).first();
          await expect(scope).toBeVisible();

          const controls = await collectInteractive(scope);
          const targetNames = new Set(controls.map((c) => c.name).filter(Boolean));
          expect(
            targetNames.size,
            `[${device}] no named interactive controls to walk in ${route.scope}`,
          ).toBeGreaterThan(0);

          // Focus body first so we start Tab traversal from a known origin.
          // Tab into the document a bounded number of times; every named
          // control inside scope must appear as the focused element at
          // some point. Ceiling = 4× total to allow for skip-links, off-
          // scope preceding controls (marketing wordmark before nav, sr-
          // only content), and Radix focus-guards. Any control still
          // missing after the ceiling means Tab order can't reach it.
          await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
          await page.locator("body").focus();

          const seen = new Set<string>();
          const budget = Math.max(40, targetNames.size * 4);

          for (let i = 0; i < budget && seen.size < targetNames.size; i++) {
            await page.keyboard.press("Tab");
            const activeName = await page.evaluate(() => {
              const el = document.activeElement as HTMLElement | null;
              if (!el || el === document.body) return "";
              // Same accessible-name chain as collectInteractive.
              const lb = el.getAttribute("aria-labelledby");
              if (lb) {
                const t = lb
                  .split(/\s+/)
                  .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
                  .filter(Boolean)
                  .join(" ");
                if (t) return t;
              }
              const al = (el.getAttribute("aria-label") ?? "").trim();
              if (al) return al;
              const tx = (el.textContent ?? "").trim();
              if (tx) return tx;
              const ti = (el.getAttribute("title") ?? "").trim();
              if (ti) return ti;
              // <input> fallback: associated <label for="…"> supplies the
              // accessible name. Without this branch, focused inputs would
              // look "unnamed" to the walker even though AT sees the label.
              if (el.tagName === "INPUT" && el.id) {
                const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
                return (lbl?.textContent ?? "").trim();
              }
              return "";
            });
            if (activeName && targetNames.has(activeName)) seen.add(activeName);
          }

          const unreachable = [...targetNames].filter((n) => !seen.has(n));
          expect(
            unreachable,
            `[${device}] controls NOT reachable via Tab in ${route.scope}: ${JSON.stringify(unreachable, null, 2)}`,
          ).toEqual([]);
        });
      });
    }
  });
}
