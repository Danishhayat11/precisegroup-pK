import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — clicking an overflow menu item leaves NO stray portal
 * tabbables behind and moves focus to the expected next breadcrumb.
 *
 * Complements `breadcrumbs-overflow-click-item-closes-and-resets.spec.ts`
 * (which locks close + reopen-highlight-reset) by pinning the specific
 * regression this test guards: a Radix portal that unmounts its visible
 * `<div role="menu">` on close but leaves *tabbable* remnants in the DOM
 * — an orphaned focus-guard `<span>`, a still-mounted `[role="menuitem"]`,
 * or a stray `[data-radix-portal]` — which then poison Tab order and
 * screen-reader traversal even though the menu "looks" closed.
 *
 * In both themes:
 *   1. Open the overflow via mouse click, verify a menu with items renders.
 *   2. Snapshot the intended destination row's {text, href} pre-click.
 *   3. Click that row. Router settles on its exact href.
 *   4. Menu is fully unmounted:
 *      - `role="menu"` count === 0
 *      - `[role="menuitem"]` count === 0
 *      - NO `[data-radix-focus-guard]` remains anywhere in the document
 *      - NO orphan `[data-radix-portal]` / `[data-radix-popper-content-wrapper]`
 *      - No tabbable element (button/a/[tabindex>=0]) inside a Radix
 *        portal container remains
 *   5. Focus lands on a REAL, visible, tabbable element — the overflow
 *      trigger for the new URL, or the destination crumb's anchor —
 *      never on <body>, a focus-guard, or a stale menuitem.
 *   6. Pressing Tab from the resting focus advances to a genuine next
 *      focusable element inside the document (not a 0×0 focus-guard).
 */

const THEMES = ["light", "dark"] as const;
const FIXTURE_URL = "/crumb-fixture/alpha/beta/gamma/delta/epsilon";

async function forceTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("precise.theme", t);
    } catch {
      /* ignored */
    }
    const root = document.documentElement;
    root.classList.toggle("dark", t === "dark");
    root.style.colorScheme = t;
  }, theme);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
}

function overflowTrigger(page: Page) {
  return page.locator('nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]');
}

async function readMenuItem(page: Page, index: number): Promise<{ text: string; href: string }> {
  return page.evaluate((i) => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const el = items[i];
    if (!el) throw new Error(`no menuitem at index ${i}`);
    const anchor =
      (el.tagName === "A" ? (el as HTMLAnchorElement) : null) ??
      el.querySelector<HTMLAnchorElement>("a[href]");
    const href = anchor?.getAttribute("href");
    if (!href) throw new Error(`menuitem ${i} has no href`);
    return {
      text: (el.textContent ?? "").trim(),
      href: new URL(href, window.location.origin).pathname,
    };
  }, index);
}

/**
 * Enumerate every "leftover from the menu portal" the regression could
 * plausibly leave behind. Any non-zero count is a bug.
 */
async function portalRemnants(page: Page) {
  return page.evaluate(() => {
    const isVisible = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return (
        rect.width > 0 && rect.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"
      );
    };
    const isTabbable = (el: HTMLElement) => {
      if (el.hasAttribute("disabled")) return false;
      const ti = el.getAttribute("tabindex");
      const tiNum = ti == null ? NaN : Number(ti);
      const naturallyFocusable =
        (el.tagName === "A" && (el as HTMLAnchorElement).hasAttribute("href")) ||
        el.tagName === "BUTTON" ||
        el.tagName === "INPUT" ||
        el.tagName === "SELECT" ||
        el.tagName === "TEXTAREA";
      if (ti != null && !Number.isNaN(tiNum)) return tiNum >= 0;
      return naturallyFocusable;
    };

    const menus = document.querySelectorAll('[role="menu"]').length;
    const menuItems = document.querySelectorAll('[role="menuitem"]').length;
    const focusGuards = document.querySelectorAll("[data-radix-focus-guard]").length;
    const portalContainers = document.querySelectorAll(
      "[data-radix-portal], [data-radix-popper-content-wrapper]",
    );

    let orphanTabbablesInPortals = 0;
    const orphanSamples: string[] = [];
    portalContainers.forEach((container) => {
      const nodes = container.querySelectorAll<HTMLElement>(
        "a[href], button, input, select, textarea, [tabindex]",
      );
      nodes.forEach((n) => {
        if (isTabbable(n)) {
          orphanTabbablesInPortals += 1;
          if (orphanSamples.length < 3) {
            orphanSamples.push(
              `${n.tagName.toLowerCase()}[role=${n.getAttribute("role") ?? ""}] "${(n.textContent ?? "").trim().slice(0, 40)}"`,
            );
          }
        }
      });
    });

    // Also scan document-wide for any lingering 0×0 focus-guard that
    // isn't inside a recognized portal container.
    const guards = Array.from(document.querySelectorAll<HTMLElement>("[data-radix-focus-guard]"));
    const visibleGuards = guards.filter((g) => isVisible(g)).length;

    return {
      menus,
      menuItems,
      focusGuards,
      portalContainerCount: portalContainers.length,
      orphanTabbablesInPortals,
      orphanSamples,
      visibleGuards,
    };
  });
}

async function activeElementDescriptor(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) {
      return {
        isBody: true,
        isMenuItem: false,
        isFocusGuard: false,
        isTrigger: false,
        isDestinationAnchor: false,
        rectW: 0,
        rectH: 0,
        tag: el ? el.tagName.toLowerCase() : "null",
        text: "",
      };
    }
    const rect = el.getBoundingClientRect();
    const anchor =
      (el.tagName === "A" ? (el as HTMLAnchorElement) : null) ??
      el.querySelector<HTMLAnchorElement>("a[href]");
    return {
      isBody: false,
      isMenuItem: el.getAttribute("role") === "menuitem",
      isFocusGuard:
        (rect.width === 0 && rect.height === 0) || el.hasAttribute("data-radix-focus-guard"),
      isTrigger:
        el.tagName === "BUTTON" && /hidden breadcrumb/i.test(el.getAttribute("aria-label") ?? ""),
      isDestinationAnchor:
        !!anchor &&
        new URL(anchor.href, window.location.origin).pathname === window.location.pathname,
      rectW: rect.width,
      rectH: rect.height,
      tag: el.tagName.toLowerCase(),
      text: (el.textContent ?? "").trim().slice(0, 80),
    };
  });
}

test.describe("Breadcrumbs — clicking an overflow row closes the menu, moves focus to the next crumb, leaves no portal tabbables", () => {
  for (const theme of THEMES) {
    test(`${theme} · mouse click on overflow menuitem unmounts the portal cleanly and Tab continues into document`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = overflowTrigger(page);
      await expect(trigger, "overflow trigger renders on deep fixture URL").toBeVisible();
      await expect(trigger, "starts collapsed").toHaveAttribute("aria-expanded", "false");

      // ── Open via mouse click (the code path the bug lives in). ──
      const menu = await openMenu(page, trigger, {
        activation: "click",
        label: `overflow menu (${theme})`,
      });
      await expect(menu, "menu visible after click open").toBeVisible();

      const itemCount = await page.locator('[role="menuitem"]').count();
      expect(itemCount, "fixture yields multiple hidden crumbs").toBeGreaterThan(1);

      // Pick a non-first item so the click path is proven to fire the
      // row the user actually pointed at, not row 0.
      const targetIdx = Math.min(1, itemCount - 1);
      const target = await readMenuItem(page, targetIdx);
      expect(target.text.length, "target row has visible text").toBeGreaterThan(0);
      expect(
        target.href.startsWith("/"),
        `target href is an app-internal path (got ${target.href})`,
      ).toBe(true);
      expect(
        target.href,
        "target row does not point at the current URL (would make navigation a no-op)",
      ).not.toBe(new URL(FIXTURE_URL, "http://x").pathname);

      // ── Click. Router should navigate + portal should fully unmount. ──
      await page.locator('[role="menuitem"]').nth(targetIdx).click();

      await page.waitForFunction((expected) => window.location.pathname === expected, target.href, {
        timeout: 5000,
      });

      // Wait for the portal to unmount (Radix runs its unmount in a
      // microtask after the click). Poll until stable rather than
      // rely on a fixed sleep.
      await page.waitForFunction(
        () =>
          document.querySelectorAll('[role="menu"]').length === 0 &&
          document.querySelectorAll('[role="menuitem"]').length === 0,
        undefined,
        { timeout: 2000 },
      );

      // ── Portal cleanliness contract ─────────────────────────────
      const remnants = await portalRemnants(page);
      expect(remnants.menus, 'no <div role="menu"> remains after click').toBe(0);
      expect(remnants.menuItems, 'no stray [role="menuitem"] remains after click').toBe(0);
      expect(
        remnants.focusGuards,
        `no Radix focus-guards remain in the document (would poison Tab order); saw ${remnants.focusGuards}`,
      ).toBe(0);
      expect(
        remnants.portalContainerCount,
        "no orphan [data-radix-portal] / popper-content-wrapper remains",
      ).toBe(0);
      expect(
        remnants.orphanTabbablesInPortals,
        `no tabbable elements remain inside any Radix portal (samples: ${remnants.orphanSamples.join(" | ")})`,
      ).toBe(0);
      expect(remnants.visibleGuards, "no visible focus-guard boxes leak into the layout").toBe(0);

      // ── Focus lands on a real, expected next element. ────────────
      const active = await activeElementDescriptor(page);
      expect(active.isBody, "focus is NOT lost to <body> after click activation").toBe(false);
      expect(active.isMenuItem, "focus is NOT stuck on a stale menuitem").toBe(false);
      expect(
        active.isFocusGuard,
        `focus is NOT parked on a Radix focus-guard / 0×0 element (tag=${active.tag}, size=${active.rectW}×${active.rectH})`,
      ).toBe(false);
      expect(
        active.rectW > 0 && active.rectH > 0,
        `resting focus element is visible (tag=${active.tag}, size=${active.rectW}×${active.rectH})`,
      ).toBe(true);
      expect(
        active.isTrigger || active.isDestinationAnchor,
        `focus lands on the overflow trigger for the new URL OR on the destination crumb's anchor (got tag=${active.tag}, text="${active.text}")`,
      ).toBe(true);

      // ── Tab from resting focus advances to a REAL next element. ─
      // If Radix had left a focus-guard behind, Tab would land on a
      // 0×0 span. Assert the next focus target is visible and not a
      // guard.
      await page.keyboard.press("Tab");
      const afterTab = await activeElementDescriptor(page);
      expect(
        afterTab.isFocusGuard,
        `Tab from post-click focus does NOT land on a leftover focus-guard (tag=${afterTab.tag}, size=${afterTab.rectW}×${afterTab.rectH})`,
      ).toBe(false);
      expect(afterTab.isMenuItem, "Tab does not resurrect a stale menuitem").toBe(false);
      // The next focusable may be `<body>` only at the very end of the
      // document — but on a breadcrumb-heavy fixture URL there is
      // always at least a page heading / link after the trail. Assert
      // Tab moved to a visible interactive element OR stayed put on
      // the trigger (both are acceptable — what matters is it did not
      // land on a portal remnant).
      if (!afterTab.isBody) {
        expect(
          afterTab.rectW > 0 && afterTab.rectH > 0,
          `next Tab target is a visible element (tag=${afterTab.tag}, size=${afterTab.rectW}×${afterTab.rectH})`,
        ).toBe(true);
      }
    });
  }
});
