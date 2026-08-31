import { expect, test } from "./_overflowDebugFixture";
import type { Locator, Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — Escape from a highlighted row returns focus to the
 * overflow trigger (the "row trigger" that opened the menu).
 *
 * Complements the existing focus-return spec, which only exercises
 * Escape immediately after open (highlight on item 0). This spec
 * moves the roving highlight to a NON-initial row first — that is
 * the shape of the real regression risk, because Radix has to
 * remember which element originally opened the menu even after
 * focus has roved several steps deeper into the list.
 *
 * Contract per theme:
 *   1. Space opens the menu; Radix commits highlight on item 0.
 *   2. ArrowDown twice moves the highlight+focus down to item 2.
 *   3. Escape closes the menu (portal detaches, aria-expanded=false).
 *   4. Focus lands back on the overflow trigger — not on <body>, not
 *      on the previously highlighted row, not on any breadcrumb link.
 *   5. Re-opening works cleanly from the returned focus, proving the
 *      trigger is still the same interactive element (no detached
 *      node, no stale ref).
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

async function waitForHighlightIndex(page: Page, idx: number, label: string) {
  await page
    .waitForFunction(
      (i) => {
        const items = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
        return items[i]?.hasAttribute("data-highlighted") ?? false;
      },
      idx,
      { timeout: 2000 },
    )
    .catch(() => {
      throw new Error(`[${label}] highlight never landed on index ${idx}`);
    });
}

/** Snapshot document.activeElement in a form we can assert on. */
async function readActive(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) {
      return { tag: "BODY", role: null, label: null, isBody: true };
    }
    return {
      tag: el.tagName,
      role: el.getAttribute("role"),
      label: el.getAttribute("aria-label"),
      isBody: false,
    };
  });
}

test.describe("Breadcrumbs overflow · Escape from highlighted row returns focus to the row trigger", () => {
  for (const theme of THEMES) {
    test(`${theme} · Escape from item 2 returns focus to the overflow trigger`, async ({
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

      // Capture the trigger's DOM identity so we can prove focus returns
      // to the *same* element after the menu tears down and rebuilds.
      const triggerHandle = await trigger.elementHandle();
      expect(triggerHandle, "trigger handle resolved").not.toBeNull();

      // ── Open via Space ─────────────────────────────────────────
      await trigger.focus();
      const menu = await openMenu(page, trigger, { activation: "Space", label: "overflow menu" });
      await expect(menu, "menu open").toBeVisible();
      await expect(trigger, "aria-expanded=true").toHaveAttribute("aria-expanded", "true");

      // ── Move highlight to a non-initial row (item 2) ──────────
      await waitForHighlightIndex(page, 0, `${theme}/after Space`);
      await page.keyboard.press("ArrowDown");
      await waitForHighlightIndex(page, 1, `${theme}/after ArrowDown #1`);
      await page.keyboard.press("ArrowDown");
      await waitForHighlightIndex(page, 2, `${theme}/after ArrowDown #2`);

      // Sanity: the highlighted row is DOM-focused (Radix roving focus).
      const focusOnRow = await page.evaluate(() => {
        const items = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
        return items[2] && document.activeElement === items[2];
      });
      expect(focusOnRow, `[${theme}] roving focus on item 2 before Escape`).toBe(true);

      // ── Escape ────────────────────────────────────────────────
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu"), `[${theme}] menu unmounted on Escape`).toHaveCount(0);
      await expect(trigger, `[${theme}] aria-expanded resets to false`).toHaveAttribute(
        "aria-expanded",
        "false",
      );

      // ── Focus returned to the overflow (row) trigger ──────────
      const active = await readActive(page);
      expect(active.isBody, `[${theme}] focus not dumped to <body>`).toBe(false);
      expect(active.tag, `[${theme}] focused element is the trigger BUTTON`).toBe("BUTTON");
      expect(
        active.label,
        `[${theme}] focused element is the overflow trigger by accessible name`,
      ).toMatch(/hidden breadcrumb/i);

      // Prove it's literally the same DOM node we opened from — not a
      // sibling button with the same label that Radix accidentally
      // re-rendered into.
      const sameNode = await page.evaluate(
        (originalTrigger) => document.activeElement === originalTrigger,
        triggerHandle,
      );
      expect(sameNode, `[${theme}] focus is on the ORIGINAL trigger node`).toBe(true);

      // ── No residual highlight lingering after teardown ────────
      const stale = await page.locator("[data-highlighted]").count();
      expect(stale, `[${theme}] no lingering data-highlighted after Escape`).toBe(0);

      // ── Trigger is still functional: reopen from the returned focus ──
      const menu2 = await openMenu(page, trigger, { activation: "Space", label: "overflow menu" });
      await expect(menu2, `[${theme}] menu re-opens from returned focus`).toBeVisible();
      await waitForHighlightIndex(page, 0, `${theme}/re-open fresh highlight`);
    });
  }
});
