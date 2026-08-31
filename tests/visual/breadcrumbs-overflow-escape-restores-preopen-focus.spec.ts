import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — Escape restores focus to the element that owned focus
 * BEFORE the overflow menu opened.
 *
 * Framed intentionally around the pre-open focus target instead of
 * "the trigger". Radix DropdownMenu's contract is to return focus to
 * whatever opened it, and for the overflow menu that opener is always
 * the trigger button (keyboard opening requires focus on the trigger).
 * We capture `document.activeElement` immediately before pressing
 * Space and assert Escape restores focus to *that exact DOM node* —
 * so a future refactor that swaps trigger references, portals into a
 * sibling, or accidentally moves focus to the crumb list after close
 * will fail loudly instead of silently degrading the keyboard flow.
 *
 * Run in light + dark because the focus-return machinery must not
 * depend on class-name state (a theme-swap regression would break AT
 * users on whichever mode happens to remount the trigger).
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
    if (root) {
      root.classList.toggle("dark", t === "dark");
      root.style.colorScheme = t;
    }
  }, theme);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
}

test.describe("Breadcrumbs overflow · Escape returns focus to the pre-open element", () => {
  for (const theme of THEMES) {
    test(`${theme} · focus restored to the exact element that owned focus before opening`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = page.locator(
        'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
      );
      await expect(trigger, "overflow trigger renders").toBeVisible();

      // ── Snapshot pre-open focus ────────────────────────────────
      // Focus the trigger (keyboard-open precondition) and capture
      // both a DOM handle and a descriptor of the currently focused
      // element. The handle is what proves node identity survives
      // the menu's mount/unmount cycle.
      await trigger.focus();
      const preOpenHandle = await page.evaluateHandle(() => document.activeElement);
      const preOpenSnapshot = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el
          ? {
              tag: el.tagName,
              role: el.getAttribute("role"),
              label: el.getAttribute("aria-label"),
              isBody: false,
            }
          : { tag: "BODY", role: null, label: null, isBody: true };
      });
      expect(preOpenSnapshot.isBody, `[${theme}] pre-open focus not <body>`).toBe(false);
      expect(preOpenSnapshot.label, `[${theme}] pre-open focus is the overflow trigger`).toMatch(
        /hidden breadcrumb/i,
      );

      // ── Open the menu ──────────────────────────────────────────
      const menu = await openMenu(page, trigger, { activation: "Space", label: "overflow menu" });
      await expect(menu, `[${theme}] menu open`).toBeVisible();
      await expect(trigger, `[${theme}] aria-expanded=true`).toHaveAttribute(
        "aria-expanded",
        "true",
      );

      // While the menu is open, focus has moved off the trigger onto
      // a menuitem — sanity check so we know Escape has real work to do.
      const focusMovedIntoMenu = await page.evaluate((original) => {
        return document.activeElement !== original;
      }, preOpenHandle);
      expect(
        focusMovedIntoMenu,
        `[${theme}] focus moved into the menu (Escape needs to restore it)`,
      ).toBe(true);

      // ── Escape ────────────────────────────────────────────────
      await page.keyboard.press("Escape");

      await expect(page.getByRole("menu"), `[${theme}] menu unmounted on Escape`).toHaveCount(0);
      await expect(trigger, `[${theme}] aria-expanded resets to false`).toHaveAttribute(
        "aria-expanded",
        "false",
      );

      // ── Assert restoration ────────────────────────────────────
      // Node identity: the focused element after Escape must be the
      // SAME node that was focused before Space. Comparing handles
      // catches "same-looking button but a different re-rendered
      // instance" that a plain label check would miss.
      const restoredToSameNode = await page.evaluate(
        (original) => document.activeElement === original,
        preOpenHandle,
      );
      expect(restoredToSameNode, `[${theme}] focus returned to the exact pre-open element`).toBe(
        true,
      );

      // Descriptor cross-check so a failure message names what got focus instead.
      const postClose = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el
          ? {
              tag: el.tagName,
              role: el.getAttribute("role"),
              label: el.getAttribute("aria-label"),
              isBody: false,
            }
          : { tag: "BODY", role: null, label: null, isBody: true };
      });
      expect(postClose.isBody, `[${theme}] focus not dumped to <body>`).toBe(false);
      expect(postClose.tag, `[${theme}] focus on the same tag as pre-open`).toBe(
        preOpenSnapshot.tag,
      );
      expect(postClose.label, `[${theme}] focus on the same accessible name as pre-open`).toBe(
        preOpenSnapshot.label,
      );
    });
  }
});
