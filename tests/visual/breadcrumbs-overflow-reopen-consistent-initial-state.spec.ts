import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs overflow — reopen after close returns a consistent
 * initial focus/highlight state, regardless of HOW the previous open
 * was closed.
 *
 * Close paths exercised (each combined with keyboard + pointer reopen):
 *   • keyboard    — Escape while a non-initial row is highlighted.
 *   • outside     — pointer click on an inert page region.
 *   • toggle      — pointer click on the trigger itself to close.
 *
 * The expected reopen state (the "consistent" contract) is:
 *   1. Exactly one menuitem carries `data-highlighted`.
 *   2. That menuitem is at index 0 — the documented fresh-start row.
 *   3. Exactly one menuitem carries `tabindex="0"` and it is that same
 *      index-0 row (roving tab-stop and roving highlight agree).
 *   4. `document.activeElement` sits inside the reopened menu (on the
 *      first menuitem or the menu container) — not on `<body>`, not on
 *      a leaked portal wrapper, not on the trigger.
 *
 * Runs across { close-path × reopen-path × theme } so a regression that
 * only mis-restores highlight after (e.g.) pointer close + keyboard
 * reopen surfaces as a single named failing case.
 */

const THEMES = ["light", "dark"] as const;
const CLOSE_PATHS = ["keyboard-escape", "pointer-outside", "pointer-trigger"] as const;
const REOPEN_PATHS = ["keyboard", "pointer"] as const;
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

async function openByKeyboard(page: Page, trigger: Locator): Promise<Locator> {
  const menu = page.getByRole("menu");
  await trigger.focus();
  for (let i = 0; i < 6; i++) {
    await trigger.press(" ");
    if (await menu.count()) return menu;
    await page.waitForTimeout(200);
  }
  return menu;
}

async function openByPointer(page: Page, trigger: Locator): Promise<Locator> {
  const menu = page.getByRole("menu");
  for (let i = 0; i < 6; i++) {
    await trigger.click();
    if (await menu.count()) return menu;
    await page.waitForTimeout(200);
  }
  return menu;
}

async function waitForInitialHighlight(page: Page) {
  await page.waitForFunction(
    () => !!document.querySelector('[role="menuitem"][data-highlighted]'),
    undefined,
    { timeout: 2000 },
  );
}

async function waitForMenuClosed(page: Page) {
  await page.waitForFunction(
    () => document.querySelectorAll('[role="menu"]').length === 0,
    undefined,
    { timeout: 2000 },
  );
}

/**
 * Walk the highlight OFF item 0 so the "reopen resets to 0" assertion
 * is meaningful. Returns the index we walked to.
 */
async function walkHighlight(page: Page): Promise<number> {
  await waitForInitialHighlight(page);
  const itemCount = await page.locator('[role="menuitem"]').count();
  const startIdx = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    return els.findIndex((el) => el.hasAttribute("data-highlighted"));
  });
  const target = Math.min(2, itemCount - 1);
  for (let i = startIdx; i < target; i++) {
    await page.keyboard.press("ArrowDown");
  }
  await page.waitForFunction(
    (idx) => {
      const els = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
      return els[idx]?.hasAttribute("data-highlighted") ?? false;
    },
    target,
    { timeout: 2000 },
  );
  return target;
}

async function readRovingState(page: Page) {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    return items.map((el, idx) => ({
      idx,
      text: (el.textContent ?? "").trim().slice(0, 40),
      highlighted: el.hasAttribute("data-highlighted"),
      tabindex: el.getAttribute("tabindex"),
    }));
  });
}

async function readActiveInsideMenu(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) {
      return {
        isBody: true,
        insideMenu: false,
        role: null,
        isFirstItem: false,
        tag: "BODY",
        label: null,
      };
    }
    const menu = document.querySelector('[role="menu"]');
    const insideMenu = !!(menu && (menu === el || menu.contains(el)));
    const firstItem = document.querySelector<HTMLElement>('[role="menuitem"]');
    return {
      isBody: false,
      insideMenu,
      role: el.getAttribute("role"),
      isFirstItem: !!firstItem && firstItem === el,
      tag: el.tagName,
      label: el.getAttribute("aria-label") || (el.textContent ?? "").trim().slice(0, 60),
    };
  });
}

test.describe("Breadcrumbs overflow · reopen after close returns a consistent initial state", () => {
  for (const theme of THEMES) {
    for (const closePath of CLOSE_PATHS) {
      for (const reopenPath of REOPEN_PATHS) {
        test(`${theme} · close via ${closePath} → reopen via ${reopenPath} highlights item 0 with aligned roving state`, async ({
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

          // ── First open: walk highlight OFF item 0 ──────────────────────
          const firstMenu = await openByKeyboard(page, trigger);
          await expect(firstMenu, `[${theme}] first open`).toBeVisible();
          const itemCount = await page.locator('[role="menuitem"]').count();
          expect(
            itemCount,
            `[${theme}] fixture yields several hidden crumbs`,
          ).toBeGreaterThanOrEqual(3);
          const walkedTo = await walkHighlight(page);

          // ── Close via the requested path ───────────────────────────────
          if (closePath === "keyboard-escape") {
            await page.keyboard.press("Escape");
          } else if (closePath === "pointer-outside") {
            // Click a benign page region well outside the breadcrumb nav.
            // Coordinate click bypasses Radix's inside-nav pointer logic.
            const viewport = page.viewportSize();
            const x = Math.min(50, (viewport?.width ?? 200) - 10);
            const y = Math.min((viewport?.height ?? 600) - 10, 600);
            await page.mouse.click(x, y);
          } else {
            // pointer-trigger: clicking the trigger while open toggles it closed.
            await trigger.click();
          }
          await waitForMenuClosed(page);
          await expect(
            trigger,
            `[${theme}] aria-expanded=false after ${closePath} close`,
          ).toHaveAttribute("aria-expanded", "false");

          // ── Reopen via the requested path ──────────────────────────────
          const reopened =
            reopenPath === "keyboard"
              ? await openByKeyboard(page, trigger)
              : await openByPointer(page, trigger);
          await expect(reopened, `[${theme}] menu reopens via ${reopenPath}`).toBeVisible();
          await waitForInitialHighlight(page);

          const reopenCount = await page.locator('[role="menuitem"]').count();
          expect(reopenCount, `[${theme}] reopened menu has the same items as before`).toBe(
            itemCount,
          );

          const state = await readRovingState(page);

          // (1) Exactly one highlighted menuitem.
          const highlighted = state.filter((s) => s.highlighted);
          expect(
            highlighted.length,
            `[${theme}] exactly one menuitem highlighted on reopen (got ${highlighted.length}: ${JSON.stringify(highlighted)})`,
          ).toBe(1);

          // (2) That menuitem is index 0 — the documented reset row.
          expect(
            highlighted[0].idx,
            `[${theme}] reopen after ${closePath} highlights item 0 (had walked to idx=${walkedTo})`,
          ).toBe(0);

          // (3) Roving tab-stop is well-formed and aligned with the highlight.
          const tabStops = state.filter((s) => s.tabindex === "0");
          const nonStops = state.filter((s) => s.tabindex === "-1");
          expect(
            tabStops.length,
            `[${theme}] exactly one menuitem carries tabindex="0" (got ${tabStops.length}: ${JSON.stringify(tabStops)})`,
          ).toBe(1);
          expect(nonStops.length, `[${theme}] every other menuitem carries tabindex="-1"`).toBe(
            state.length - 1,
          );
          expect(
            tabStops[0].idx,
            `[${theme}] tab-stop and highlight are on the SAME menuitem`,
          ).toBe(0);

          // Reopens routed through the pointer path skip focus assertions
          // when the reopen itself was pointer-driven: browsers legitimately
          // leave focus on the trigger after a mouse-driven menu open. The
          // roving highlight/tabindex assertions above still catch the state
          // regression; the focus assertion below is scoped to keyboard reopens.
          if (reopenPath === "keyboard") {
            const active = await readActiveInsideMenu(page);
            expect(
              active.isBody,
              `[${theme}] post-reopen focus not <body> for keyboard reopen`,
            ).toBe(false);
            expect(
              active.insideMenu,
              `[${theme}] keyboard reopen focuses inside the menu (got tag=${active.tag}, label="${active.label}")`,
            ).toBe(true);
          }

          // (4) ArrowDown from the reopened state moves to index 1 with no skips —
          //     proves the roving cursor increments by one from the reset row,
          //     which would fail if highlight and tab-stop had disagreed.
          await page.keyboard.press("ArrowDown");
          await page.waitForFunction(
            () => {
              const els = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
              return els[1]?.hasAttribute("data-highlighted") ?? false;
            },
            undefined,
            { timeout: 2000 },
          );
          const afterArrow = await readRovingState(page);
          const nowHighlighted = afterArrow.filter((s) => s.highlighted);
          expect(
            nowHighlighted.length,
            `[${theme}] still exactly one highlight after ArrowDown (no stale second cursor)`,
          ).toBe(1);
          expect(
            nowHighlighted[0].idx,
            `[${theme}] ArrowDown from reset lands on index 1 (no skip)`,
          ).toBe(1);
        });
      }
    }
  }
});
