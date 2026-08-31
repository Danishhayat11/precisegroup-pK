/**
 * Shared helpers for the header a11y / snapshot regression suites.
 *
 * Two specs use these:
 *   - tests/a11y/header-tablet-768-visibility.spec.ts
 *   - tests/a11y/header-notifications-popover-focus.spec.ts
 *
 * They share the same setup shape (Supabase session bootstrap →
 * dashboard nav → header assertion at a tablet-sized viewport) and the
 * same focus-halo/clip contract, so the logic lives here in one place.
 * Keep this module framework-agnostic: no `test.describe`, no
 * `test.beforeEach`. Individual specs wire the helpers into their own
 * lifecycle so the callsite still reads top-to-bottom in the spec file.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

// ─── Session env ────────────────────────────────────────────────────
export const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "";
const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON ?? "";
/** True when a Supabase browser session is injected into the sandbox. */
export const HAS_SESSION = Boolean(STORAGE_KEY && SESSION_JSON);

/**
 * Focus-ring halo budget used by every unclipped-focus assertion in the
 * header suites. Sized for the iOS topbar's stack:
 *   3px outline + 2px offset + ~3px halo shadow ≈ 8px.
 * If the design system widens the ring, bump this here — do NOT
 * hardcode a different number in individual specs.
 */
export const FOCUS_HALO_PX = 8;

// ─── Session bootstrap ─────────────────────────────────────────────
/**
 * Restore the injected Supabase session into `page` via localStorage
 * (and cookies, when available for `@supabase/ssr` apps). Must run
 * BEFORE navigating to any authenticated route.
 */
export async function seedSession(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
    STORAGE_KEY,
    SESSION_JSON,
  ] as const);
  if (COOKIES_JSON) {
    const cookies = JSON.parse(COOKIES_JSON) as Array<Record<string, unknown>>;
    for (const c of cookies) c.url = BASE_URL;
    await page.context().addCookies(cookies as never);
  }
}

/**
 * Navigate to `/dashboard`, tolerate the one-shot ERR_ABORTED that Vite
 * sometimes throws mid-HMR, and wait for the header + web fonts before
 * returning. Callers can then assert against a settled DOM.
 */
export async function gotoDashboard(page: Page): Promise<void> {
  try {
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "domcontentloaded" });
  } catch (err) {
    if (!/ERR_ABORTED/.test(String((err as Error).message))) throw err;
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "domcontentloaded" });
  }
  await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => document.fonts?.ready);
  await freezeAnimations(page);
}

/**
 * Belt-and-braces animation kill switch layered on top of Playwright's
 * `animations: 'disabled'` snapshot flag (playwright.config.ts).
 *
 * Playwright's flag freezes CSS animations/transitions AT capture time.
 * That's not enough for us:
 *   - We take some snapshots with `page.screenshot({ clip })` after a
 *     `.focus()` call, and read layout via `getBoundingClientRect()`
 *     during the same sequence. Any RAF-driven transform / opacity
 *     transition that fires between focus and capture reads back a
 *     different rect on different runs.
 *   - Framer Motion animates inline `style="opacity: ...; transform: ..."`
 *     which the SSR pass in `__root.tsx` sometimes serializes at a
 *     mid-tween value, producing a hydration-time visual difference
 *     between two runs of the same CI matrix cell.
 *
 * Injecting a global CSS override that zeros duration + delay on
 * animations, transitions, and scroll-behavior removes that entire
 * class of flake at the source, before any capture starts.
 */
export async function freezeAnimations(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
      html, body { scroll-behavior: auto !important; }
    `,
  });
}

// ─── Viewport wiring ───────────────────────────────────────────────
export type HeaderViewport = { label: string; width: number; height: number };

/**
 * One-line `test.describe` wiring shared by every header suite:
 *   - pins the viewport size
 *   - skips the whole block when no Supabase session is available
 *   - restores the session and lands on /dashboard before each test
 *
 * Usage:
 *   describeHeaderSuite(
 *     `header @ ${vp.label} — bell & user menu never clip`,
 *     vp,
 *     () => {
 *       test("...", async ({ page }) => { ... });
 *     },
 *   );
 */
export function describeHeaderSuite(title: string, vp: HeaderViewport, body: () => void): void {
  test.describe(title, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    test.skip(!HAS_SESSION, "No Supabase session available");
    test.beforeEach(async ({ page }) => {
      await seedSession(page);
      await gotoDashboard(page);
    });
    body();
  });
}

// ─── Focus-visible / clip assertion ────────────────────────────────
type FocusProbe = {
  active: boolean;
  outlineStyle: string;
  outlineWidth: string;
  outlineColor: string;
  boxShadow: string;
  baselineBoxShadow: string;
  rect: { left: number; right: number; top: number; bottom: number };
  vw: number;
  vh: number;
  clippedBy: { tag: string; sides: string[] } | null;
};

/**
 * Assert the element (a) receives keyboard focus, (b) paints a visible
 * focus indicator (outline or box-shadow diff vs the unfocused
 * baseline), and (c) its outward-projecting focus halo is not clipped
 * by the nearest ancestor whose `overflow` cuts painting
 * (`hidden` / `clip`) or by the viewport edge.
 *
 * Failures are pushed onto `failures` instead of thrown so a caller can
 * iterate over many controls (e.g. every focusable inside a popover)
 * and report them all at once.
 */
export async function assertUnclippedFocus(
  page: Page,
  handle: Locator,
  label: string,
  failures: string[],
): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

  const probe: FocusProbe = await handle.evaluate((node, halo) => {
    const el = node as HTMLElement;
    const baselineBoxShadow = getComputedStyle(el).boxShadow;
    el.focus({ preventScroll: false });
    const active = document.activeElement === el;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    // Walk up looking for a hidden/clip ancestor; ignore auto/scroll
    // because keyboard focus scrolls them into view.
    let clippedBy: { tag: string; sides: string[] } | null = null;
    let cur: HTMLElement | null = el.parentElement;
    while (cur) {
      const acs = getComputedStyle(cur);
      const ov = `${acs.overflow} ${acs.overflowX} ${acs.overflowY}`;
      if (/(hidden|clip)/.test(ov)) {
        const r = cur.getBoundingClientRect();
        const sides: string[] = [];
        if (r.left > rect.left - halo) sides.push("left");
        if (r.top > rect.top - halo) sides.push("top");
        if (r.right < rect.right + halo) sides.push("right");
        if (r.bottom < rect.bottom + halo) sides.push("bottom");
        if (sides.length) clippedBy = { tag: cur.tagName.toLowerCase(), sides };
        break;
      }
      cur = cur.parentElement;
    }

    return {
      active,
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineColor: cs.outlineColor,
      boxShadow: cs.boxShadow,
      baselineBoxShadow,
      rect: {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      },
      vw: window.innerWidth,
      vh: window.innerHeight,
      clippedBy,
    };
  }, FOCUS_HALO_PX);

  if (!probe.active) {
    failures.push(`${label}: did not accept keyboard focus`);
    return;
  }

  const outlineVisible =
    probe.outlineStyle !== "none" &&
    parseFloat(probe.outlineWidth) > 0 &&
    probe.outlineColor !== "rgba(0, 0, 0, 0)";
  const shadowVisible = probe.boxShadow !== "none" && probe.boxShadow !== probe.baselineBoxShadow;
  if (!outlineVisible && !shadowVisible) {
    failures.push(
      `${label}: no visible focus indicator (outline:${probe.outlineStyle}/${probe.outlineWidth}, shadow-diff:${probe.boxShadow !== probe.baselineBoxShadow})`,
    );
  }

  if (probe.clippedBy) {
    failures.push(
      `${label}: focus halo clipped by <${probe.clippedBy.tag}> on ${probe.clippedBy.sides.join(", ")}`,
    );
  }
  if (probe.rect.left - FOCUS_HALO_PX < -1) {
    failures.push(`${label}: focus halo overflows viewport left (${probe.rect.left})`);
  }
  if (probe.rect.right + FOCUS_HALO_PX > probe.vw + 1) {
    failures.push(
      `${label}: focus halo overflows viewport right (right=${probe.rect.right}, vw=${probe.vw})`,
    );
  }
}

// ─── Popover-specific helpers ──────────────────────────────────────
/** CSS selector matching every keyboard-focusable control (excluding disabled). */
export const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

/**
 * Assert every focusable control inside `container` paints an
 * unclipped focus ring. Fails with a single aggregated error listing
 * every offending control, so one regression report covers the entire
 * popover instead of masking later failures behind the first.
 */
export async function assertPopoverFocusRingsUnclipped(
  page: Page,
  container: Locator,
  contextLabel: string,
): Promise<void> {
  const focusables = container.locator(FOCUSABLE_SELECTOR);
  const count = await focusables.count();
  expect(
    count,
    `${contextLabel}: popover should expose at least one focusable control`,
  ).toBeGreaterThan(0);

  const failures: string[] = [];
  for (let i = 0; i < count; i++) {
    const el = focusables.nth(i);
    const label =
      (await el.getAttribute("aria-label")) ||
      (await el.textContent())?.trim().slice(0, 40) ||
      `focusable[${i}]`;
    await assertUnclippedFocus(page, el, `${contextLabel} "${label}"`, failures);
  }

  expect(failures, `focus-visible failures in ${contextLabel}:\n${failures.join("\n")}`).toEqual(
    [],
  );
}
