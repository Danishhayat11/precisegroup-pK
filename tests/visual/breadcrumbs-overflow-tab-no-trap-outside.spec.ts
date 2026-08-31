import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — overflow menu Tab / Shift+Tab a11y guard: focus must
 * never get trapped on an element that lives OUTSIDE the breadcrumb
 * container's world (breadcrumb nav OR the menu's own portal), on a
 * detached / hidden / inert node, or on <body>.
 *
 * Complements the existing tab-exit spec, which asserts the specific
 * "Tab closes menu + lands on the next sibling" contract. This spec
 * intentionally makes NO assumption about whether Tab closes the menu
 * or keeps it open — Radix behavior varies per version — and only
 * asserts the a11y invariants that must hold either way:
 *
 *   • activeElement is always a real, connected, visible element.
 *   • activeElement is never <body>, never inside an `aria-hidden`
 *     subtree, never inside an `inert` subtree.
 *   • activeElement is always reachable from the breadcrumb world:
 *     - inside the breadcrumb <nav>, OR
 *     - inside the Radix menu portal (which is logically part of the
 *       breadcrumb overflow trigger), OR
 *     - on a later tabbable that sits AFTER the breadcrumb nav in
 *       document order (a legitimate tab exit).
 *   • The same guarantees hold under repeated Tab and Shift+Tab
 *     presses — no keystroke can strand focus on an off-screen
 *     portal wrapper or a detached node.
 *
 * Verified in both light and dark themes because portal mount order
 * and aria-hidden application differ per theme in this app.
 */

const THEMES = ["light", "dark"] as const;
const FIXTURE_URL = "/crumb-fixture/alpha/beta/gamma/delta/epsilon";
const TAB_STEPS = 5;

async function forceTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("precise.theme", t);
    } catch {
      /* ignored */
    }
    const root = document.documentElement;
    if (root) {
      root.classList.toggle("dark", t === "dark");
      root.style.colorScheme = t;
    }
  }, theme);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
}

type FocusProbe = {
  isBody: boolean;
  connected: boolean;
  visible: boolean;
  ariaHidden: boolean;
  inert: boolean;
  insideBreadcrumbNav: boolean;
  insideMenuPortal: boolean;
  afterBreadcrumbNavInDom: boolean;
  tag: string;
  role: string | null;
  label: string | null;
};

/**
 * Snapshot every a11y property of `document.activeElement` we care about.
 * All checks run inside the page so we can inspect the live DOM (portals,
 * aria-hidden ancestors, computed visibility).
 */
async function probeFocus(page: Page): Promise<FocusProbe> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) {
      return {
        isBody: true,
        connected: !!el?.isConnected,
        visible: false,
        ariaHidden: false,
        inert: false,
        insideBreadcrumbNav: false,
        insideMenuPortal: false,
        afterBreadcrumbNavInDom: false,
        tag: el?.tagName ?? "BODY",
        role: null,
        label: null,
      };
    }
    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    const visible =
      (rect.width > 0 || rect.height > 0) && cs.visibility !== "hidden" && cs.display !== "none";

    // Walk ancestors to catch inherited aria-hidden / inert states.
    const ariaHidden = !!el.closest('[aria-hidden="true"]');
    const inert = !!el.closest("[inert]");

    const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
    const insideBreadcrumbNav = !!(nav && nav.contains(el));

    // Radix DropdownMenu portals its content. Detect via role=menu ancestry
    // OR the standard Radix portal attribute.
    const insideMenuPortal = !!el.closest(
      '[role="menu"], [data-radix-popper-content-wrapper], [data-radix-portal]',
    );

    let afterNav = false;
    if (nav && !insideBreadcrumbNav && !insideMenuPortal) {
      // FOLLOWING = the nav comes BEFORE el in document order.
      afterNav = !!(nav.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    }

    return {
      isBody: false,
      connected: el.isConnected,
      visible,
      ariaHidden,
      inert,
      insideBreadcrumbNav,
      insideMenuPortal,
      afterBreadcrumbNavInDom: afterNav,
      tag: el.tagName,
      role: el.getAttribute("role"),
      label:
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        (el.textContent ?? "").trim().slice(0, 60),
    };
  });
}

function assertNotTrappedOutside(probe: FocusProbe, label: string) {
  expect(probe.isBody, `[${label}] focus never falls to <body>`).toBe(false);
  expect(probe.connected, `[${label}] focused element is connected to DOM`).toBe(true);
  expect(probe.visible, `[${label}] focused element is visible (not offscreen ghost)`).toBe(true);
  expect(probe.ariaHidden, `[${label}] focused element not inside aria-hidden subtree`).toBe(false);
  expect(probe.inert, `[${label}] focused element not inside inert subtree`).toBe(false);
  // The core invariant: focus is inside one of the three legitimate zones.
  const inLegitimateZone =
    probe.insideBreadcrumbNav || probe.insideMenuPortal || probe.afterBreadcrumbNavInDom;
  expect(
    inLegitimateZone,
    `[${label}] focus stayed reachable from breadcrumb container (nav / portal / after-nav), got tag=${probe.tag} role=${probe.role} label="${probe.label}"`,
  ).toBe(true);
}

test.describe("Breadcrumbs overflow · Tab / Shift+Tab never trap focus outside the breadcrumb container", () => {
  for (const theme of THEMES) {
    test(`${theme} · repeated Tab keeps focus in a legitimate zone`, async ({ page }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = page.locator(
        'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
      );
      await expect(trigger, "overflow trigger renders").toBeVisible();

      await trigger.focus();
      const menu = await openMenu(page, trigger, { activation: "Space", label: "overflow menu" });
      await expect(menu, `[${theme}] menu open`).toBeVisible();

      // Baseline: focus lives inside the portalled menu.
      const initial = await probeFocus(page);
      assertNotTrappedOutside(initial, `${theme}/initial-open`);

      // Press Tab repeatedly. After each keystroke the a11y invariants
      // must hold, regardless of whether Radix closes the menu on Tab
      // or keeps it open.
      for (let i = 1; i <= TAB_STEPS; i++) {
        await page.keyboard.press("Tab");
        await page.waitForTimeout(50);
        const probe = await probeFocus(page);
        assertNotTrappedOutside(probe, `${theme}/Tab #${i}`);
      }
    });

    test(`${theme} · repeated Shift+Tab keeps focus in a legitimate zone`, async ({ page }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = page.locator(
        'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
      );
      await expect(trigger, "overflow trigger renders").toBeVisible();

      await trigger.focus();
      const menu = await openMenu(page, trigger, { activation: "Space", label: "overflow menu" });
      await expect(menu, `[${theme}] menu open`).toBeVisible();

      const initial = await probeFocus(page);
      assertNotTrappedOutside(initial, `${theme}/initial-open`);

      for (let i = 1; i <= TAB_STEPS; i++) {
        await page.keyboard.press("Shift+Tab");
        await page.waitForTimeout(50);
        const probe = await probeFocus(page);
        // Shift+Tab may legitimately move focus to a tabbable BEFORE the
        // breadcrumb nav (e.g. a skip-link, header nav). Accept that too:
        // the invariant we care about here is "not trapped on a hidden /
        // detached / inert node". Recompute the legitimate-zone check to
        // also allow "before the breadcrumb nav" for the reverse direction.
        const inLegitimateZone =
          probe.insideBreadcrumbNav ||
          probe.insideMenuPortal ||
          probe.afterBreadcrumbNavInDom ||
          // Reverse direction: any element that comes BEFORE the nav
          // in document order is also a valid Shift+Tab exit.
          (await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
            if (!el || !nav || el === document.body) return false;
            if (nav.contains(el)) return true;
            return !!(nav.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);
          }));
        expect(probe.isBody, `[${theme}/Shift+Tab #${i}] focus not on <body>`).toBe(false);
        expect(probe.connected, `[${theme}/Shift+Tab #${i}] focused element connected`).toBe(true);
        expect(probe.visible, `[${theme}/Shift+Tab #${i}] focused element visible`).toBe(true);
        expect(probe.ariaHidden, `[${theme}/Shift+Tab #${i}] not in aria-hidden`).toBe(false);
        expect(probe.inert, `[${theme}/Shift+Tab #${i}] not in inert subtree`).toBe(false);
        expect(
          inLegitimateZone,
          `[${theme}/Shift+Tab #${i}] focus in legitimate zone (nav/portal/before/after), got tag=${probe.tag} role=${probe.role} label="${probe.label}"`,
        ).toBe(true);
      }
    });
  }
});
