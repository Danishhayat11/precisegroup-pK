/**
 * E2E aria-pressed / aria-expanded gate for toggle-style header icon
 * buttons on /site and /dashboard.
 *
 * A "toggle-style" header icon button is any visible, non-disabled
 * <button> / [role="button"] inside the header scope whose visible text
 * is empty (icon-only) AND which behaves as a toggle. We identify it by
 * the presence of either:
 *
 *   - `aria-pressed`  → toggle button (theme switch, pin, star)
 *   - `aria-expanded` → disclosure/menu trigger (mobile nav, user menu,
 *                      notifications popover)
 *
 * For each such control we assert three properties:
 *
 *   1. STATIC — the attribute value is a valid boolean string
 *      ("true" | "false"), never missing / "" / "undefined". A
 *      disclosure trigger with a live popover but no `aria-expanded`
 *      attribute is a screen-reader dead-end.
 *
 *   2. LINKAGE — a control with `aria-expanded` and `aria-controls`
 *      points at an element that exists in the DOM (`aria-controls`
 *      pointing at an id that never mounts is the #1 cause of "menu
 *      opens but AT never hears about it").
 *
 *   3. DYNAMIC — activating the control (Enter key on the focused
 *      element, to exercise the same code path as keyboard users)
 *      flips the reported state. `aria-pressed` must toggle
 *      true ↔ false; `aria-expanded` must move away from its initial
 *      value and (for disclosure triggers with `aria-controls`) the
 *      controlled element's visibility must change accordingly.
 *
 * Header scope + auth handling mirror
 * `header-controls-names.spec.ts` / `header-icon-focus-visible.spec.ts`.
 *
 * Run:
 *   bunx playwright test tests/a11y/header-toggle-aria-state.spec.ts \
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

type Toggle = {
  key: string;
  selector: string;
  mode: "pressed" | "expanded";
  initial: string;
  controls: string | null;
};

/**
 * Collect every icon-only toggle/disclosure in `scope`. Tags each node
 * with `data-toggle-id` so we can re-query after focus lands on it.
 */
async function collectToggles(scope: Locator): Promise<Toggle[]> {
  return await scope.evaluateAll((roots) => {
    const root = roots[0];
    if (!root) return [];
    const nodes = Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"]'));
    const out: Array<{
      key: string;
      selector: string;
      mode: "pressed" | "expanded";
      initial: string;
      controls: string | null;
    }> = [];
    let idx = 0;
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (r.width === 0 || r.height === 0) continue;
      if (style.display === "none" || style.visibility === "hidden") continue;
      if ((el as HTMLButtonElement).disabled) continue;
      if (el.getAttribute("aria-hidden") === "true") continue;
      if (el.tabIndex < 0) continue;

      // Icon-only filter (strip sr-only spans).
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

      const hasPressed = el.hasAttribute("aria-pressed");
      const hasExpanded = el.hasAttribute("aria-expanded");
      if (!hasPressed && !hasExpanded) continue;

      const marker = `toggle-${idx++}`;
      el.setAttribute("data-toggle-id", marker);

      const label =
        el.getAttribute("aria-label") ??
        el.getAttribute("title") ??
        el.getAttribute("data-testid") ??
        marker;

      out.push({
        key: label.trim() || marker,
        selector: `[data-toggle-id="${marker}"]`,
        // aria-pressed wins if both are set (rare but valid for a
        // toggleable disclosure). aria-pressed is the more specific
        // toggle-state contract, so assert it.
        mode: hasPressed ? "pressed" : "expanded",
        initial:
          (hasPressed ? el.getAttribute("aria-pressed") : el.getAttribute("aria-expanded")) ?? "",
        controls: el.getAttribute("aria-controls"),
      });
    }
    return out;
  });
}

/** Read the current aria-pressed / aria-expanded value + controlled visibility. */
async function readState(page: Page, t: Toggle) {
  return await page.evaluate(
    ({ selector, mode, controls }) => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) return null;
      const value =
        mode === "pressed" ? el.getAttribute("aria-pressed") : el.getAttribute("aria-expanded");
      let controlledVisible: boolean | null = null;
      if (controls) {
        // aria-controls may be a space-separated id list; take the first
        // that resolves to something in the DOM.
        const ids = controls.split(/\s+/).filter(Boolean);
        for (const id of ids) {
          const node = document.getElementById(id);
          if (node) {
            const rect = node.getBoundingClientRect();
            const cs = window.getComputedStyle(node);
            controlledVisible =
              rect.width > 0 &&
              rect.height > 0 &&
              cs.display !== "none" &&
              cs.visibility !== "hidden";
            break;
          }
        }
      }
      return { value, controlledVisible };
    },
    { selector: t.selector, mode: t.mode, controls: t.controls },
  );
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
      test.describe(`header toggle aria state — ${route.name}`, () => {
        test.skip(
          route.requiresAuth && !HAS_SESSION,
          "No Supabase session available for authenticated route",
        );

        test(`toggle/disclosure icon buttons expose valid + reactive aria-pressed / aria-expanded`, async ({
          page,
        }) => {
          await gotoRoute(page, route);
          const scope = page.locator(route.scope).first();
          await expect(scope).toBeVisible();

          const toggles = await collectToggles(scope);
          // Zero toggles is a legitimate shape (e.g. /site desktop where
          // nav is fully expanded and there's no theme switcher). Skip
          // rather than fail — the spec gates toggles WHEN they exist.
          test.skip(
            toggles.length === 0,
            `[${device}] no toggle/disclosure icon buttons in ${route.scope} on ${route.path}`,
          );

          // ---- 1. STATIC: value must be "true" | "false" -----------------
          const invalid = toggles.filter((t) => t.initial !== "true" && t.initial !== "false");
          expect(
            invalid,
            `[${device}] icon toggles with invalid aria-${
              invalid[0]?.mode ?? "pressed/expanded"
            } value in ${route.scope}: ${JSON.stringify(
              invalid.map((t) => ({ key: t.key, mode: t.mode, value: t.initial })),
              null,
              2,
            )}`,
          ).toEqual([]);

          // ---- 2. LINKAGE: aria-controls must resolve --------------------
          const brokenControls: Array<{ key: string; controls: string }> = [];
          for (const t of toggles) {
            if (t.mode !== "expanded" || !t.controls) continue;
            const resolved = await page.evaluate((controls) => {
              const ids = controls.split(/\s+/).filter(Boolean);
              return ids.some((id) => !!document.getElementById(id));
            }, t.controls);
            if (!resolved) brokenControls.push({ key: t.key, controls: t.controls });
          }
          expect(
            brokenControls,
            `[${device}] aria-controls pointing at missing ids in ${route.scope}: ${JSON.stringify(brokenControls, null, 2)}`,
          ).toEqual([]);

          // ---- 3. DYNAMIC: activation flips the state --------------------
          // Tab from body until focus lands on each toggle, then press
          // Enter and re-read the attribute. This exercises the same
          // keyboard path AT users take.
          const targets = new Map(toggles.map((t) => [t.selector, t] as const));
          const notFlipped: Array<{
            key: string;
            mode: string;
            before: string;
            after: string;
          }> = [];
          const unreached: string[] = [];

          for (const t of toggles) {
            await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
            await page.locator("body").focus();

            let focused = false;
            const budget = Math.max(60, targets.size * 6);
            for (let i = 0; i < budget && !focused; i++) {
              await page.keyboard.press("Tab");
              const activeSelector = await page.evaluate(() => {
                const el = document.activeElement as HTMLElement | null;
                const id = el?.getAttribute("data-toggle-id");
                return id ? `[data-toggle-id="${id}"]` : "";
              });
              if (activeSelector === t.selector) focused = true;
            }
            if (!focused) {
              unreached.push(t.key);
              continue;
            }

            const before = await readState(page, t);
            await page.keyboard.press("Enter");
            // Radix / most portals mount asynchronously; give a
            // microtask + animation frame before reading.
            await page.waitForTimeout(150);
            const after = await readState(page, t);

            if (!before || !after) {
              notFlipped.push({
                key: t.key,
                mode: t.mode,
                before: before?.value ?? "(null)",
                after: after?.value ?? "(null)",
              });
              continue;
            }
            if (before.value === after.value) {
              notFlipped.push({
                key: t.key,
                mode: t.mode,
                before: before.value ?? "",
                after: after.value ?? "",
              });
            }

            // For disclosure triggers with aria-controls, the controlled
            // region's visibility must match the new aria-expanded state.
            if (t.mode === "expanded" && t.controls && after.controlledVisible !== null) {
              const expectedVisible = after.value === "true";
              if (after.controlledVisible !== expectedVisible) {
                notFlipped.push({
                  key: t.key,
                  mode: "expanded+controls-visibility",
                  before: `aria-expanded=${after.value}`,
                  after: `controlled visible=${after.controlledVisible}`,
                });
              }
            }

            // Close it again so the next iteration starts from a clean
            // header (open menu can push other toggles out of the
            // viewport / trap focus).
            if (after.value === "true") {
              await page.keyboard.press("Escape").catch(() => {});
              await page.waitForTimeout(100);
            }
          }

          expect(
            unreached,
            `[${device}] toggle icon buttons NOT reachable via Tab in ${route.scope}: ${JSON.stringify(unreached, null, 2)}`,
          ).toEqual([]);
          expect(
            notFlipped,
            `[${device}] toggle icon buttons whose aria state did not react to Enter in ${route.scope}:\n${JSON.stringify(notFlipped, null, 2)}`,
          ).toEqual([]);
        });
      });
    }
  });
}
