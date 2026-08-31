import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";

/**
 * Breadcrumbs — pressing Escape while the overflow dropdown is
 * already CLOSED must be a complete no-op.
 *
 * Why this matters:
 *   - Radix DropdownMenu attaches a document-level keydown listener
 *     while the menu is open and detaches it on close. A regression
 *     that leaves the listener attached (or bubbles Escape into an
 *     ancestor handler that treats it as "activate") could:
 *       • navigate the router (Escape acting like Enter on a link),
 *       • blur the currently focused element,
 *       • toggle aria-expanded even though there is no menu to open,
 *       • steal focus into a phantom portal.
 *   - This spec exercises Escape in TWO resting states — trigger
 *     focused, and a sibling breadcrumb link focused — and asserts
 *     the world is byte-identical before and after.
 *
 * Distinct from `breadcrumbs-overflow-enter-space-escape-aria` (which
 * only tests Escape while the menu is OPEN) and the Escape close-
 * behaviour specs. Here the menu never opens.
 */

const THEMES = ["light", "dark"] as const;
const FIXTURE_URL = "/crumb-fixture/alpha/beta/gamma/delta/epsilon";
const ESCAPE_PRESSES = 3;

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

type WorldSnapshot = {
  url: string;
  triggerExpanded: string | null;
  triggerAriaLabel: string | null;
  menuCount: number;
  menuItemCount: number;
  highlightedCount: number;
  activeKey: string;
  activeTag: string;
  activeIsBody: boolean;
};

async function snapshotWorld(page: Page): Promise<WorldSnapshot> {
  const url = page.url();
  const domSnap = await page.evaluate(() => {
    const trigger = document.querySelector<HTMLElement>(
      'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
    );
    const el = document.activeElement as HTMLElement | null;
    const label = (e: HTMLElement) =>
      e.getAttribute("aria-label") ||
      e.getAttribute("title") ||
      (e.textContent ?? "").trim().slice(0, 60);
    const activeIsBody = !el || el === document.body;
    return {
      triggerExpanded: trigger?.getAttribute("aria-expanded") ?? null,
      triggerAriaLabel: trigger?.getAttribute("aria-label") ?? null,
      menuCount: document.querySelectorAll('[role="menu"]').length,
      menuItemCount: document.querySelectorAll('[role="menuitem"]').length,
      highlightedCount: document.querySelectorAll("[data-highlighted]").length,
      activeIsBody,
      activeTag: activeIsBody ? "BODY" : el!.tagName,
      activeKey: activeIsBody
        ? "BODY"
        : `${el!.tagName}::${el!.getAttribute("role") ?? ""}::${el!.getAttribute("href") ?? ""}::${label(el!)}`,
    };
  });
  return { url, ...domSnap };
}

/** Assert the world is byte-identical to the baseline, one field at a time. */
function assertWorldUnchanged(before: WorldSnapshot, after: WorldSnapshot, label: string) {
  expect(after.url, `[${label}] URL unchanged (no navigation)`).toBe(before.url);
  expect(after.triggerExpanded, `[${label}] trigger aria-expanded unchanged`).toBe(
    before.triggerExpanded,
  );
  expect(after.triggerAriaLabel, `[${label}] trigger aria-label unchanged`).toBe(
    before.triggerAriaLabel,
  );
  expect(after.menuCount, `[${label}] no menu mounted`).toBe(before.menuCount);
  expect(after.menuItemCount, `[${label}] no menuitems mounted`).toBe(before.menuItemCount);
  expect(after.highlightedCount, `[${label}] no [data-highlighted] appeared`).toBe(
    before.highlightedCount,
  );
  expect(after.activeIsBody, `[${label}] focus did not fall to <body>`).toBe(before.activeIsBody);
  expect(after.activeTag, `[${label}] activeElement tag unchanged`).toBe(before.activeTag);
  expect(after.activeKey, `[${label}] activeElement identity unchanged`).toBe(before.activeKey);
}

test.describe("Breadcrumbs overflow · Escape while closed is a no-op", () => {
  for (const theme of THEMES) {
    test(`${theme} · Escape with focused trigger — no navigate, no state change`, async ({
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

      // Pre-conditions: menu is closed and trigger reports collapsed.
      await expect(trigger, "starts collapsed").toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("menu"), "no menu at rest").toHaveCount(0);

      await trigger.focus();
      await expect(trigger, "trigger is focused before Escape").toBeFocused();

      const before = await snapshotWorld(page);
      expect(before.triggerExpanded, "baseline aria-expanded=false").toBe("false");
      expect(before.menuCount, "baseline no menu").toBe(0);
      expect(before.activeKey, "baseline focus is on trigger").toContain("hidden breadcrumb");

      // Press Escape multiple times — each must remain a no-op.
      for (let i = 1; i <= ESCAPE_PRESSES; i++) {
        await page.keyboard.press("Escape");
        // Give any stale handler a chance to mis-fire before we snapshot.
        await page.waitForTimeout(80);
        const after = await snapshotWorld(page);
        assertWorldUnchanged(before, after, `${theme} · trigger · Escape #${i}`);
        await expect(trigger, `[${theme}] trigger still focused after Escape #${i}`).toBeFocused();
      }
    });

    test(`${theme} · Escape with focused sibling breadcrumb link — no navigate, focus stays put`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const nav = page.locator('nav[aria-label="Breadcrumb"]');
      const trigger = nav.locator('button[aria-label*="hidden breadcrumb" i]');
      await expect(trigger, "overflow trigger renders").toBeVisible();

      // Focus a sibling breadcrumb link (the Home anchor is always
      // present in the collapsed layout). If the collapsed nav ever
      // stops rendering it, fall back to the first anchor.
      const homeLink = nav.locator('a[href="/"]').first();
      const anyLink = nav.locator("a[href]").first();
      const siblingLink = (await homeLink.count()) ? homeLink : anyLink;
      await expect(siblingLink, "a sibling breadcrumb link exists").toBeVisible();
      await siblingLink.focus();
      await expect(siblingLink, "sibling link is focused before Escape").toBeFocused();

      // Baseline while the menu is closed and focus is OFF the trigger.
      await expect(trigger, "menu closed").toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("menu"), "no menu mounted").toHaveCount(0);

      const before = await snapshotWorld(page);
      expect(before.triggerExpanded, "baseline collapsed").toBe("false");
      expect(before.menuCount, "baseline no menu").toBe(0);
      expect(before.activeTag, "baseline focus is on a link").toBe("A");

      for (let i = 1; i <= ESCAPE_PRESSES; i++) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(80);
        const after = await snapshotWorld(page);
        assertWorldUnchanged(before, after, `${theme} · sibling · Escape #${i}`);
        // Focus specifically must not migrate to the trigger — a
        // regression could route Escape as "restore focus to menu
        // trigger" even when no menu was open.
        await expect(
          siblingLink,
          `[${theme}] sibling link still focused after Escape #${i}`,
        ).toBeFocused();
      }
    });
  }
});
