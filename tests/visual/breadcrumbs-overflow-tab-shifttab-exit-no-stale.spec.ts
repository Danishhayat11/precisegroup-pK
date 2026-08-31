import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Breadcrumbs overflow — Tab AND Shift+Tab exit the open menu cleanly.
 *
 * Radix's DropdownMenu is a closed tab-stop: Tab and Shift+Tab don't
 * cycle menuitems, they close the menu and hand focus to the next /
 * previous tabbable in document order relative to the trigger. This
 * spec parametrises over BOTH directions and asserts the full exit
 * contract — including "no stale highlighted state anywhere in the
 * DOM" — for each.
 *
 * Distinct from:
 *   • `breadcrumbs-overflow-tab-exit.spec.ts` — covers Tab and
 *     Shift+Tab direction correctness.
 *   • `breadcrumbs-overflow-tab-out-no-stale-highlight.spec.ts` —
 *     covers the stale-highlight regression but only for forward Tab.
 *
 * The gap this spec fills: Shift+Tab exit with the no-stale-highlight
 * post-condition. A regression that leaves `data-highlighted` /
 * `tabindex="0"` on a menuitem after Shift+Tab (but cleans up cleanly
 * after Tab) would slip past both existing specs.
 *
 * Contract (per direction):
 *   1. Menu is torn down — no `role="menu"` remains.
 *   2. Trigger `aria-expanded="false"`.
 *   3. Focus lands on the expected sibling of the trigger in DOM tab
 *      order — the next tabbable for Tab, the previous tabbable for
 *      Shift+Tab. Never `<body>`, never a stale menuitem.
 *   4. No `data-highlighted` element exists anywhere in the DOM after
 *      exit; no orphan `role="menuitem"` remains.
 *   5. Reopening the menu restarts the highlight at idx 0 with
 *      exactly one highlighted row (the ghost never reappears).
 */

const THEMES = ["light", "dark"] as const;
const DIRECTIONS = ["Tab", "Shift+Tab"] as const;
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

/**
 * Compute the tabbable that should receive focus when Tab (dir=+1) or
 * Shift+Tab (dir=-1) is pressed from the overflow trigger. Reproduces
 * the browser's sequential-focus heuristic in-page so the assertion
 * tracks reality, not a hard-coded neighbour.
 */
async function computeTabbableRelativeToTrigger(page: Page, dir: 1 | -1) {
  return page.evaluate((direction) => {
    const isVisible = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      const cs = window.getComputedStyle(el);
      return cs.visibility !== "hidden" && cs.display !== "none";
    };
    const isTabbable = (el: HTMLElement) => {
      if ((el as HTMLButtonElement).disabled) return false;
      if (el.getAttribute("aria-hidden") === "true") return false;
      if (el.closest("[inert]")) return false;
      if (el.tabIndex < 0) return false;
      return isVisible(el);
    };
    const trigger = document.querySelector<HTMLElement>(
      'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
    );
    if (!trigger) return null;
    const all = Array.from(
      document.querySelectorAll<HTMLElement>(
        "a[href], button, input, select, textarea, [tabindex]",
      ),
    ).filter(isTabbable);
    all.sort((a, b) => {
      if (a === b) return 0;
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    const idx = all.indexOf(trigger);
    const nextIdx = idx + direction;
    if (idx === -1 || nextIdx < 0 || nextIdx >= all.length) return null;
    const target = all[nextIdx];
    return {
      tag: target.tagName,
      role: target.getAttribute("role"),
      label: target.getAttribute("aria-label") || (target.textContent ?? "").trim().slice(0, 60),
      href: target.getAttribute("href"),
    };
  }, dir);
}

async function readActive(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) {
      return { isBody: true, tag: "BODY", role: null, label: null, href: null };
    }
    return {
      isBody: false,
      tag: el.tagName,
      role: el.getAttribute("role"),
      label: el.getAttribute("aria-label") || (el.textContent ?? "").trim().slice(0, 60),
      href: el.getAttribute("href"),
    };
  });
}

test.describe("Breadcrumbs overflow · Tab / Shift+Tab exit closes menu, moves focus, leaves no stale highlight", () => {
  for (const theme of THEMES) {
    for (const direction of DIRECTIONS) {
      test(`${theme} · ${direction} from open menu exits cleanly with no residual highlight`, async ({
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

        // Pre-compute the expected neighbour for this direction BEFORE
        // opening — the menu portal changes the DOM and would poison the
        // computation.
        const expectedNeighbour = await computeTabbableRelativeToTrigger(
          page,
          direction === "Tab" ? 1 : -1,
        );
        expect(
          expectedNeighbour,
          `[${theme}] a ${direction === "Tab" ? "next" : "previous"} tabbable exists relative to the trigger`,
        ).not.toBeNull();

        // ── Open menu, walk highlight OFF idx 0 so stale check is meaningful ──
        const menu = await openByKeyboard(page, trigger);
        await expect(menu, `[${theme}] menu open`).toBeVisible();
        await expect(trigger, `[${theme}] aria-expanded=true while open`).toHaveAttribute(
          "aria-expanded",
          "true",
        );

        await page.waitForFunction(
          () => !!document.querySelector('[role="menuitem"][data-highlighted]'),
          undefined,
          { timeout: 2000 },
        );
        const itemCount = await page.locator('[role="menuitem"]').count();
        expect(itemCount, `[${theme}] fixture yields several hidden crumbs`).toBeGreaterThanOrEqual(
          3,
        );
        const walkTarget = Math.min(2, itemCount - 1);
        for (let i = 0; i < walkTarget; i++) {
          await page.keyboard.press("ArrowDown");
        }
        await page.waitForFunction(
          (idx) => {
            const els = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
            return els[idx]?.hasAttribute("data-highlighted") ?? false;
          },
          walkTarget,
          { timeout: 2000 },
        );

        // ── Exit via the parametrised direction ────────────────────────────
        await page.keyboard.press(direction);
        await page.waitForTimeout(50);

        // (1) Menu unmounted.
        await expect(
          page.getByRole("menu"),
          `[${theme}] menu unmounted after ${direction}`,
        ).toHaveCount(0);

        // (2) aria-expanded flips (or trigger absent, an even stronger signal).
        if ((await trigger.count()) > 0) {
          await expect(
            trigger,
            `[${theme}] trigger aria-expanded=false after ${direction}`,
          ).toHaveAttribute("aria-expanded", "false");
        }

        // (3) Focus lands on the expected neighbour — not <body>, not menuitem, not trigger.
        const active = await readActive(page);
        expect(active.isBody, `[${theme}] focus not <body> after ${direction}`).toBe(false);
        expect(active.role, `[${theme}] focus not on stale menuitem after ${direction}`).not.toBe(
          "menuitem",
        );
        expect(
          /hidden breadcrumb/i.test(active.label ?? ""),
          `[${theme}] focus advanced OFF the trigger (got label="${active.label}")`,
        ).toBe(false);
        expect(
          active.tag,
          `[${theme}] ${direction} landed on the expected tag (${expectedNeighbour!.tag})`,
        ).toBe(expectedNeighbour!.tag);
        if (expectedNeighbour!.href) {
          expect(active.href, `[${theme}] ${direction} landed on the expected href`).toBe(
            expectedNeighbour!.href,
          );
        } else {
          expect(active.label, `[${theme}] ${direction} landed on the expected element label`).toBe(
            expectedNeighbour!.label,
          );
        }

        // (4) No stale highlighted state anywhere in the DOM.
        const stale = await page.evaluate(() => ({
          highlighted: document.querySelectorAll("[data-highlighted]").length,
          menuitems: document.querySelectorAll('[role="menuitem"]').length,
          menus: document.querySelectorAll('[role="menu"]').length,
        }));
        expect(
          stale.highlighted,
          `[${theme}] no [data-highlighted] element remains after ${direction} (got ${stale.highlighted})`,
        ).toBe(0);
        expect(
          stale.menuitems,
          `[${theme}] no orphan role="menuitem" remains after ${direction} (got ${stale.menuitems})`,
        ).toBe(0);
        expect(stale.menus, `[${theme}] no orphan role="menu" remains after ${direction}`).toBe(0);

        // (5) Reopening restarts highlight at idx 0 with exactly one highlight.
        // Focus the trigger explicitly — after Shift+Tab we're on the *previous*
        // element and need to be on the trigger to reopen via Space.
        await trigger.focus();
        const reopened = await openByKeyboard(page, trigger);
        await expect(reopened, `[${theme}] menu reopens after ${direction} exit`).toBeVisible();
        await page.waitForFunction(
          () => !!document.querySelector('[role="menuitem"][data-highlighted]'),
          undefined,
          { timeout: 2000 },
        );
        const reopenState = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
          const highlighted = items
            .map((el, idx) => ({ idx, hi: el.hasAttribute("data-highlighted") }))
            .filter((s) => s.hi);
          return { count: items.length, highlighted };
        });
        expect(
          reopenState.highlighted.length,
          `[${theme}] exactly one highlighted menuitem on reopen (got ${reopenState.highlighted.length})`,
        ).toBe(1);
        expect(
          reopenState.highlighted[0].idx,
          `[${theme}] reopen highlights idx 0, not the pre-exit walked row (walked to ${walkTarget})`,
        ).toBe(0);
      });
    }
  }
});
