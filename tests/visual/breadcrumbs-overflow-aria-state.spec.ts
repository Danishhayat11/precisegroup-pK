import { expect, test } from "./_overflowDebugFixture";
import type { Locator, Page } from "@playwright/test";

/**
 * Breadcrumbs — overflow trigger ARIA state contract.
 *
 * Radix `DropdownMenu.Trigger` owns three assistive-tech attributes that
 * flip when the menu opens/closes:
 *
 *   • `aria-haspopup`   — stable, must always be "menu".
 *   • `aria-expanded`   — "false" at rest, "true" while the menu is open.
 *   • `aria-controls`   — while open, points to the menu's DOM id so
 *                         screen readers can jump between trigger + menu.
 *
 * This spec exercises the full resting → open → closed cycle and
 * verifies each transition in both light and dark themes (theme is
 * incidental here — flipping it proves the ARIA wiring does not
 * accidentally depend on class-name state).
 *
 * The overflow trigger only exists in the collapsed state, so we use
 * the 5-segment fixture that forces `crumbs.length > MAX_VISIBLE`.
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

/** Radix can miss the very first keydown after hydration — retry Space. */
async function openMenuByKeyboard(page: Page, trigger: Locator): Promise<Locator> {
  const menu = page.getByRole("menu");
  for (let i = 0; i < 6; i++) {
    await trigger.press(" ");
    if (await menu.count()) return menu;
    await page.waitForTimeout(250);
  }
  return menu;
}

test.describe("Breadcrumbs — overflow trigger ARIA state transitions", () => {
  for (const theme of THEMES) {
    test(`${theme} · aria-expanded / aria-controls flip on open+close`, async ({ page }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const trigger = page.locator(
        'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
      );
      await expect(trigger, "overflow trigger renders in collapsed state").toBeVisible();

      // ── Phase 1: resting (menu closed) ───────────────────────────
      await expect(trigger, "[resting] haspopup=menu").toHaveAttribute("aria-haspopup", "menu");
      await expect(trigger, "[resting] expanded=false").toHaveAttribute("aria-expanded", "false");
      // Radix omits aria-controls while the menu is unmounted (content
      // is portalled on demand). Confirm it's absent so a stale id
      // never dangles pointing to a non-existent element.
      expect(
        await trigger.getAttribute("aria-controls"),
        "[resting] no dangling aria-controls",
      ).toBeNull();
      // Menu should truly not exist yet.
      await expect(page.getByRole("menu"), "[resting] no menu in DOM").toHaveCount(0);

      // ── Phase 2: open ────────────────────────────────────────────
      await trigger.focus();
      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu, "[open] menu visible").toBeVisible();

      await expect(trigger, "[open] haspopup still menu").toHaveAttribute("aria-haspopup", "menu");
      await expect(trigger, "[open] expanded=true").toHaveAttribute("aria-expanded", "true");

      // aria-controls must exist and reference the actual menu element.
      const controlsId = await trigger.getAttribute("aria-controls");
      expect(controlsId, "[open] aria-controls is set").toBeTruthy();
      const menuId = await menu.getAttribute("id");
      expect(menuId, "[open] menu carries an id").toBeTruthy();
      expect(controlsId, "[open] aria-controls points at the menu id").toBe(menuId);

      // The referenced id must resolve to exactly one element in the DOM —
      // otherwise SRs following the pointer would land nowhere. Run the
      // lookup inside the browser so CSS.escape is available.
      const referencedCount = await page.evaluate(
        (id) => document.querySelectorAll(`#${CSS.escape(id)}`).length,
        controlsId!,
      );
      expect(referencedCount, "[open] aria-controls resolves to one element").toBe(1);

      // ── Phase 3: close via Escape ────────────────────────────────
      await page.keyboard.press("Escape");
      await expect(menu, "[closed] menu unmounted").toHaveCount(0);
      await expect(trigger, "[closed] expanded flips back to false").toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(trigger, "[closed] haspopup remains menu").toHaveAttribute(
        "aria-haspopup",
        "menu",
      );
      expect(
        await trigger.getAttribute("aria-controls"),
        "[closed] aria-controls cleared",
      ).toBeNull();

      // ── Phase 4: re-open to prove the cycle is idempotent ────────
      const menu2 = await openMenuByKeyboard(page, trigger);
      await expect(menu2, "[re-open] menu visible again").toBeVisible();
      await expect(trigger, "[re-open] expanded=true").toHaveAttribute("aria-expanded", "true");
      const controlsId2 = await trigger.getAttribute("aria-controls");
      expect(controlsId2, "[re-open] aria-controls set again").toBeTruthy();
      const menuId2 = await menu2.getAttribute("id");
      expect(controlsId2, "[re-open] aria-controls tracks the new menu id").toBe(menuId2);
    });

    test(`${theme} · aria-expanded / aria-controls reset when closed by Escape`, async ({
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

      // Open the menu and capture its id.
      await trigger.focus();
      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu, "[pre-esc] menu visible").toBeVisible();
      const openControlsId = await trigger.getAttribute("aria-controls");
      const openMenuId = await menu.getAttribute("id");
      expect(openControlsId, "[pre-esc] aria-controls set").toBeTruthy();
      expect(openControlsId, "[pre-esc] aria-controls matches menu id").toBe(openMenuId);
      await expect(trigger, "[pre-esc] expanded=true").toHaveAttribute("aria-expanded", "true");

      // Close via Escape.
      await page.keyboard.press("Escape");

      // Menu must unmount so no stale content lingers under the pointer id.
      await expect(page.getByRole("menu"), "[esc] menu unmounted").toHaveCount(0);

      // Trigger ARIA must fully reset — expanded=false AND aria-controls
      // removed (not left dangling at the now-detached menu id).
      await expect(trigger, "[esc] expanded reset to false").toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(trigger, "[esc] haspopup still menu").toHaveAttribute("aria-haspopup", "menu");
      expect(
        await trigger.getAttribute("aria-controls"),
        "[esc] aria-controls cleared, not pointing at the unmounted menu",
      ).toBeNull();

      // Escape should also return focus to the trigger for keyboard users.
      const focused = await page.evaluate(
        () => document.activeElement?.getAttribute("aria-label") ?? null,
      );
      expect(focused, "[esc] focus returned to trigger").toMatch(/hidden breadcrumb/i);
    });

    test(`${theme} · aria-expanded / aria-controls reset when closed by outside click`, async ({
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

      // Open the menu using the retry-capable keyboard opener — Radix can
      // swallow the very first pointer/key event after hydration, and the
      // point of this test is the *close* path, not the open path.
      await trigger.focus();
      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu, "[pre-outside] menu visible").toBeVisible();

      const openControlsId = await trigger.getAttribute("aria-controls");
      const openMenuId = await menu.getAttribute("id");
      expect(openControlsId, "[pre-outside] aria-controls set").toBeTruthy();
      expect(openControlsId, "[pre-outside] aria-controls matches menu id").toBe(openMenuId);
      await expect(trigger, "[pre-outside] expanded=true").toHaveAttribute("aria-expanded", "true");

      // Click well away from both the trigger and the portalled menu.
      // Using page.mouse.click at a fixed coord avoids accidentally
      // landing on the trigger (which would just toggle it) or on any
      // portalled menu content.
      const triggerBox = await trigger.boundingBox();
      const menuBox = await menu.boundingBox();
      // Bottom-right corner of the viewport is always outside both.
      const viewport = page.viewportSize()!;
      const outsideX = viewport.width - 10;
      const outsideY = viewport.height - 10;
      // Sanity: coord is not inside trigger or menu rectangles.
      const inside = (box: { x: number; y: number; width: number; height: number } | null) =>
        !!box &&
        outsideX >= box.x &&
        outsideX <= box.x + box.width &&
        outsideY >= box.y &&
        outsideY <= box.y + box.height;
      expect(inside(triggerBox) || inside(menuBox), "outside coord is outside both rects").toBe(
        false,
      );

      await page.mouse.click(outsideX, outsideY);

      // Menu must unmount.
      await expect(page.getByRole("menu"), "[outside] menu unmounted").toHaveCount(0);

      // ARIA fully reset — same contract as the Escape path.
      await expect(trigger, "[outside] expanded reset to false").toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(trigger, "[outside] haspopup still menu").toHaveAttribute(
        "aria-haspopup",
        "menu",
      );
      expect(
        await trigger.getAttribute("aria-controls"),
        "[outside] aria-controls cleared after outside click",
      ).toBeNull();

      // Prove the cycle is symmetric: reopening after an outside-click
      // close mints a fresh aria-controls that resolves.
      await trigger.focus();
      const menu2 = await openMenuByKeyboard(page, trigger);
      await expect(menu2, "[reopen] menu visible again").toBeVisible();
      const controlsId2 = await trigger.getAttribute("aria-controls");
      const menuId2 = await menu2.getAttribute("id");
      expect(controlsId2, "[reopen] aria-controls tracks new menu").toBe(menuId2);
    });
  }
});

/**
 * Focus-return contract on Escape.
 *
 * Regardless of how the overflow menu is opened, pressing Escape must
 * return keyboard focus to the *exact same* trigger element — not to
 * <body>, not to a re-rendered clone, not to the first breadcrumb link.
 * Losing focus here breaks keyboard flow: the user's next Tab jumps to
 * an unrelated element and their mental position in the page is gone.
 *
 * We assert element-level identity by tagging the trigger with a unique
 * data attribute at the start of each test, then comparing
 * `document.activeElement`'s attribute value after Escape.
 */
test.describe("Breadcrumbs — overflow trigger focus returns on Escape", () => {
  const OPEN_PATHS = [
    {
      name: "mouse open",
      open: async (page: Page, trigger: Locator) => {
        // Radix DropdownMenu opens on pointerdown. `.click()` sometimes
        // races hydration on the first attempt, so retry with a short
        // settle window between clicks.
        const menu = page.getByRole("menu");
        for (let i = 0; i < 6; i++) {
          await trigger.click();
          if (await menu.count()) return menu;
          await page.waitForTimeout(250);
        }
        return menu;
      },
    },
    {
      name: "keyboard open",
      open: async (page: Page, trigger: Locator) => {
        await trigger.focus();
        return openMenuByKeyboard(page, trigger);
      },
    },
  ] as const;

  for (const theme of THEMES) {
    for (const path of OPEN_PATHS) {
      test(`${theme} · ${path.name} → Esc returns focus to the exact trigger`, async ({ page }) => {
        await forceTheme(page, theme);
        await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
        await page.evaluate(() => document.fonts?.ready);
        await page.waitForTimeout(300);

        const trigger = page.locator(
          'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
        );
        await expect(trigger, "overflow trigger renders").toBeVisible();

        // Tag the trigger with a unique attribute so we can assert
        // element identity — not just role/label match — after Escape.
        const marker = `overflow-trigger-${theme}-${path.name.replace(/\s+/g, "-")}`;
        await trigger.evaluate((el, m) => el.setAttribute("data-focus-marker", m), marker);

        // Snapshot the exact DOM node so we can compare it against
        // document.activeElement after Escape via elementHandle equality.
        const triggerHandle = await trigger.elementHandle();
        expect(triggerHandle, "trigger element handle resolved").not.toBeNull();

        // Open via the chosen path.
        const menu = await path.open(page, trigger);
        await expect(menu, `[${path.name}] menu visible`).toBeVisible();
        // Radix moves focus into the menu on open — confirm focus has
        // *left* the trigger before we press Escape, otherwise the
        // "focus returned" assertion would be trivially true.
        const focusedTagInsideMenu = await page.evaluate(
          () => document.activeElement?.closest('[role="menu"]') !== null,
        );
        expect(focusedTagInsideMenu, `[${path.name}] focus moved into menu on open`).toBe(true);

        // Close.
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu"), `[${path.name}] menu unmounted`).toHaveCount(0);

        // 1) The active element carries our unique marker — proving it
        //    is the same overflow trigger we opened, not a sibling
        //    button or a re-rendered replacement.
        const activeMarker = await page.evaluate(
          () => document.activeElement?.getAttribute("data-focus-marker") ?? null,
        );
        expect(activeMarker, `[${path.name}] focus returned to marked trigger`).toBe(marker);

        // 2) Element-handle identity: document.activeElement === the
        //    exact DOM node we captured before opening. This catches
        //    the failure mode where Radix re-renders the trigger with
        //    the same attributes but a fresh DOM node.
        const isSameNode = await page.evaluate(
          (el) => document.activeElement === el,
          triggerHandle,
        );
        expect(isSameNode, `[${path.name}] activeElement === original trigger node`).toBe(true);

        // 3) :focus-visible must be applied so the ring is painted for
        //    keyboard users (WCAG 2.4.7). If Escape returned focus but
        //    dropped the focus-visible state, the ring would vanish.
        const hasFocusVisible = await trigger.evaluate((el) => el.matches(":focus-visible"));
        expect(hasFocusVisible, `[${path.name}] :focus-visible still applied on trigger`).toBe(
          true,
        );
      });
    }
  }
});
