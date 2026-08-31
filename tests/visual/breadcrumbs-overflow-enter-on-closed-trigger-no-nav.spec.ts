import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";

/**
 * Breadcrumbs overflow · keyboard · pressing Enter on the CLOSED trigger
 * must never navigate the page, and focus must never escape the trigger.
 *
 * Why this spec:
 *   The overflow trigger is a <button>, not a link. A regression that
 *   accidentally rendered it as <a href="#"> (or wired an onKeyDown that
 *   calls router.navigate) would silently change the URL when a keyboard
 *   user hits Enter — the exact scenario screen-reader users encounter
 *   first, because they land on the trigger via Tab. We lock:
 *     1. No navigation: pathname (+ search + hash) is byte-identical
 *        before and after the keypress.
 *     2. Focus never escapes: activeElement is either the trigger itself
 *        or a [role="menuitem"] inside the menu the trigger controls
 *        (the standard Radix behaviour when Enter opens the menu is to
 *         move DOM focus onto the first item).
 *   Anything else — <body>, a sibling breadcrumb <a>, or a random
 *   focusable element — is a regression.
 *
 * Runs light + dark to catch a theme-scoped regression (e.g. a
 * conditional <a> rendered only in one theme's compact variant).
 */

const THEMES = ["light", "dark"] as const;
const FIXTURE_SEGMENTS = ["alpha", "beta", "gamma", "delta", "epsilon"] as const;
const FIXTURE_URL = `/crumb-fixture/${FIXTURE_SEGMENTS.join("/")}`;

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

test.describe("Breadcrumbs overflow · Enter on CLOSED trigger does not navigate or lose focus", () => {
  for (const theme of THEMES) {
    test(`${theme} · Enter on closed trigger keeps URL and keeps focus in the trigger's control`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = page.locator(
        'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
      );
      await expect(trigger, `[${theme}] overflow trigger renders`).toBeVisible();

      // Baseline: menu is closed and we're on the fixture URL.
      await expect(page.getByRole("menu"), `[${theme}] menu is closed at start`).toHaveCount(0);
      await expect(
        trigger,
        `[${theme}] trigger reports aria-expanded=false at rest`,
      ).toHaveAttribute("aria-expanded", "false");

      const urlBefore = page.url();
      const beforeParts = (() => {
        const u = new URL(urlBefore);
        return { pathname: u.pathname, search: u.search, hash: u.hash };
      })();

      // Focus the trigger via keyboard-shaped focus() (matches the state a
      // Tab-navigating user would reach), then press Enter on the CLOSED trigger.
      await trigger.focus();
      const triggerHandle = await trigger.elementHandle();
      expect(triggerHandle, `[${theme}] trigger has a DOM handle`).not.toBeNull();

      await page.keyboard.press("Enter");

      // Small settle so any Radix state (aria-expanded, portal mount) resolves,
      // and any accidental client-side navigation would have committed.
      await page.waitForTimeout(150);

      // ── Assertion 1: NO navigation. ──────────────────────────────
      const urlAfter = page.url();
      const afterParts = (() => {
        const u = new URL(urlAfter);
        return { pathname: u.pathname, search: u.search, hash: u.hash };
      })();
      expect(afterParts.pathname, `[${theme}] pathname unchanged after Enter on trigger`).toBe(
        beforeParts.pathname,
      );
      expect(afterParts.search, `[${theme}] search unchanged after Enter on trigger`).toBe(
        beforeParts.search,
      );
      expect(afterParts.hash, `[${theme}] hash unchanged after Enter on trigger`).toBe(
        beforeParts.hash,
      );

      // ── Assertion 2: focus never escapes the trigger's control. ──
      //
      // We accept either:
      //   (a) The menu stayed closed and focus is still on the trigger.
      //   (b) The menu opened and DOM focus moved to a [role="menuitem"]
      //       inside the menu the trigger controls — the documented Radix
      //       behaviour for keyboard activation. This is the practical
      //       meaning of "focus stays with the trigger" for a menu button.
      // Anything else (body, a sibling anchor, an unrelated focusable) is
      // a regression the a11y user would experience as "Enter jumped me
      // somewhere unrelated".
      const focusState = await page.evaluate(() => {
        const trig = document.querySelector<HTMLElement>(
          'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
        );
        const menu = document.querySelector<HTMLElement>('[role="menu"]');
        const ae = document.activeElement as HTMLElement | null;
        const menuItem = ae && ae.getAttribute("role") === "menuitem" ? ae : null;
        const menuOwnedByTrigger =
          !!menu &&
          (!!trig?.getAttribute("aria-controls")
            ? trig.getAttribute("aria-controls") === menu.id
            : true);
        return {
          activeIsBody: ae === document.body,
          activeIsTrigger: !!trig && ae === trig,
          activeIsMenuItemInOwnedMenu:
            !!menuItem && !!menu && menu.contains(menuItem) && menuOwnedByTrigger,
          menuOpen: !!menu,
          triggerExpanded: trig?.getAttribute("aria-expanded") ?? null,
          activeDescribe: ae
            ? `${ae.tagName.toLowerCase()}` +
              `${ae.getAttribute("role") ? `[role="${ae.getAttribute("role")}"]` : ""}` +
              ` "${(ae.textContent ?? "").trim().slice(0, 40)}"`
            : "null",
        };
      });

      expect(
        focusState.activeIsBody,
        `[${theme}] focus did NOT fall back to <body> (active=${focusState.activeDescribe})`,
      ).toBe(false);

      const focusOk = focusState.activeIsTrigger || focusState.activeIsMenuItemInOwnedMenu;
      expect(
        focusOk,
        `[${theme}] focus stays with the trigger — either on the trigger itself ` +
          `or on a menuitem inside the menu it controls ` +
          `(menuOpen=${focusState.menuOpen}, ` +
          `aria-expanded=${focusState.triggerExpanded}, ` +
          `active=${focusState.activeDescribe})`,
      ).toBe(true);

      // If the menu DID open, aria-expanded must reflect that — the trigger
      // must not be lying to assistive tech about its own state.
      if (focusState.menuOpen) {
        expect(
          focusState.triggerExpanded,
          `[${theme}] when the menu opens, trigger reports aria-expanded=true`,
        ).toBe("true");
      } else {
        expect(
          focusState.triggerExpanded,
          `[${theme}] when the menu stays closed, trigger reports aria-expanded=false`,
        ).toBe("false");
        expect(
          focusState.activeIsTrigger,
          `[${theme}] menu-stayed-closed branch: focus must be exactly on the trigger`,
        ).toBe(true);
      }
    });
  }
});
