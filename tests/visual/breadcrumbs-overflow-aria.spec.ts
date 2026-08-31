import { expect, test } from "./_overflowDebugFixture";
import type { Locator, Page } from "@playwright/test";

/**
 * Breadcrumbs overflow dropdown — screen-reader ARIA contract.
 *
 * Locks the attributes that assistive tech relies on to announce the
 * overflow menu correctly:
 *
 *   • Trigger: `aria-haspopup="menu"`, `aria-expanded` toggles false → true
 *     on open, `aria-controls` points at the mounted menu.
 *   • Menu:    has an accessible name ("Hidden breadcrumb ancestors")
 *     and `role="menu"`.
 *   • Items:   `role="menuitem"`, `aria-current` is "location" for
 *     ancestors (never "page" unless the item exactly matches the
 *     current URL), `aria-posinset` / `aria-setsize` for "N of M"
 *     announcements.
 *   • Focus:   Radix uses roving tabindex — the currently-highlighted
 *     item (`data-[highlighted]`) IS `document.activeElement`, so
 *     screen readers announce whatever the keyboard user just moved to.
 *
 * The whole spec skips cleanly on projects where no authenticated
 * route currently produces > 4 breadcrumb segments (the collapse
 * threshold). Sibling behaviour specs already document that gap.
 *
 * FLAKE MITIGATION — first-navigation ERR_ABORTED / hydration jitter:
 *   TanStack Router's initial SPA navigation can bounce (`ERR_ABORTED`)
 *   when Vite's HMR overlay + preload chain race the first paint, and
 *   Radix's `DropdownMenu.Trigger` sometimes swallows the very first
 *   Enter/Space that lands before its keydown listener finishes
 *   attaching. Symptom: `aria-expanded` stays "false" through the whole
 *   5s poll and the menu never mounts. We defend in two layers:
 *     1. `settle()` waits for fonts AND a longer post-hydration delay.
 *     2. `openMenuAwaitingExpanded()` retries the open action with
 *        short backoff until `aria-expanded="true"` AND `role=menu`
 *        are both observed — asserting the CONTRACT, not our ability
 *        to guess the exact hydration boundary.
 */

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

async function settle(page: Page) {
  await page.evaluate(() => document.fonts?.ready);
  // 400ms mirrors the sibling `breadcrumbs-overflow-keyboard` spec, which
  // empirically absorbs Radix's post-hydration listener installation.
  await page.waitForTimeout(400);
}

/**
 * Open the overflow menu and wait until BOTH:
 *   • trigger reports aria-expanded="true"
 *   • a role=menu element is mounted
 *
 * Retries the open action (Enter / Space / click) up to `attempts` times
 * with `backoffMs` between tries so a swallowed first keydown never
 * fails the suite. Returns the mounted menu locator.
 */
async function openMenuAwaitingExpanded(
  page: Page,
  trigger: Locator,
  mode: "keyboard" | "click",
  { attempts = 8, backoffMs = 350 } = {},
): Promise<Locator> {
  const menu = page.getByRole("menu");
  for (let i = 0; i < attempts; i++) {
    // Idempotency guard: if a previous iteration's action already opened
    // the menu (aria-expanded flipped after the short poll timed out),
    // do NOT send another Enter — that would toggle the menu closed and
    // we would open it a second time WITHOUT Radix's auto-highlight
    // (highlight is set only on the first open triggered by a keydown).
    const already = await trigger.getAttribute("aria-expanded");
    if (already !== "true") {
      if (mode === "keyboard") {
        // Always Enter — Space also toggles Radix menus but does NOT reliably
        // auto-highlight the first item on every hydration state.
        await trigger.press("Enter");
      } else {
        await trigger.click();
      }
    }
    try {
      await expect(trigger).toHaveAttribute("aria-expanded", "true", { timeout: backoffMs });
      if (await menu.count()) {
        // Small settle so Radix's post-open focus + highlight installation
        // is observable to the caller.
        await page.waitForTimeout(80);
        return menu;
      }
    } catch {
      /* retry */
    }
    await page.waitForTimeout(backoffMs);
  }
  await expect(
    trigger,
    `open menu after ${attempts} attempts → aria-expanded="true"`,
  ).toHaveAttribute("aria-expanded", "true");
  return menu;
}

const THEMES = ["light", "dark"] as const;

test.describe("Breadcrumbs overflow — ARIA contract", () => {
  for (const theme of THEMES) {
    test(`${theme} · trigger + menu + item ARIA are wired for screen readers`, async ({
      context,
      page,
    }) => {
      await forceTheme(page, theme);
      // Fixture route `/crumb-fixture/$` derives its trail
      // straight from the pathname, so this 6-segment URL guarantees the
      // > MAX_VISIBLE (4) collapse and unmasks the overflow ARIA contract
      // that no production route currently reaches.
      await page.goto("/crumb-fixture/alpha/beta/gamma/delta/epsilon", {
        waitUntil: "domcontentloaded",
      });
      await settle(page);

      const crumb = page.locator('nav[aria-label="Breadcrumb"]').first();
      // Closed-state trigger: query by role to prove the button IS in the
      // accessibility tree with the expected accessible name.
      const triggerByRole = crumb.getByRole("button", {
        name: /Show \d+ hidden breadcrumb/,
      });
      await expect(
        triggerByRole,
        "fixture route must produce the collapsed overflow trigger",
      ).toBeVisible();

      // Open-state trigger: once Radix opens the menu, its FocusScope marks
      // the enclosing breadcrumb <ol> aria-hidden="true" so screen readers
      // stay inside the menu — that hides the trigger from `getByRole`
      // even though the DOM element is unchanged. Use an attribute selector
      // (which ignores aria-hidden) for every post-open assertion on the
      // trigger itself.
      const trigger = crumb.locator('button[aria-label^="Show "]').first();

      // ── Trigger (closed) ─────────────────────────────────────────────
      await expect(trigger, "Radix sets haspopup on the trigger").toHaveAttribute(
        "aria-haspopup",
        "menu",
      );
      await expect(trigger, 'closed menu → aria-expanded="false"').toHaveAttribute(
        "aria-expanded",
        "false",
      );

      // Open with keyboard so Radix highlights the first item as it would
      // for an assistive-tech user pressing Enter/Space. The helper retries
      // the keydown if Radix's post-hydration listener swallows the first
      // one (see FLAKE MITIGATION note at the top of this file), then
      // asserts BOTH the trigger flip AND the menu mount together.
      const menu = await openMenuAwaitingExpanded(page, trigger, "keyboard");

      // ── Trigger (open) ───────────────────────────────────────────────
      // aria-expanded was already asserted true inside the helper; re-read
      // aria-controls once the DOM has settled on the mounted menu id.
      const controlsId = await trigger.getAttribute("aria-controls");
      expect(controlsId, "trigger points at the mounted menu").toBeTruthy();

      // ── Menu ─────────────────────────────────────────────────────────
      // Radix auto-sets `aria-labelledby` pointing at the trigger, and the
      // accessible-name algorithm gives labelledby priority over aria-label
      // — so `getByRole('menu', { name: 'Hidden breadcrumb ancestors' })`
      // would find nothing even though we set that aria-label. Query by
      // role only and assert the aria-label attribute directly.
      await expect(menu, "exactly one open menu").toHaveCount(1);
      await expect(menu, "menu is visible after Enter opens it").toBeVisible();
      await expect(
        menu,
        "menu carries the aria-label our code sets for SR announcement",
      ).toHaveAttribute("aria-label", "Hidden breadcrumb ancestors");
      expect(await menu.getAttribute("id")).toBe(controlsId);

      // ── Items ────────────────────────────────────────────────────────
      const items = menu.getByRole("menuitem");
      const count = await items.count();
      expect(count, "menu should list every collapsed ancestor").toBeGreaterThan(0);

      // aria-posinset / aria-setsize on every item, gapless 1..N.
      for (let i = 0; i < count; i++) {
        const item = items.nth(i);
        await expect(item).toHaveAttribute("aria-posinset", String(i + 1));
        await expect(item).toHaveAttribute("aria-setsize", String(count));
        // Ancestor items are "location", never "page" (the current-page
        // crumb is rendered as a non-focusable span outside the menu).
        await expect(item).toHaveAttribute("aria-current", "location");
      }

      // ── Roving tabindex: highlighted item == activeElement ───────────
      // Radix auto-highlights the first item when the menu opens via
      // keyboard (Enter/Space), so no extra ArrowDown is needed here —
      // sending one would jump the highlight to posinset=2 and desync
      // the snapshot invariant below.
      const highlighted = menu.locator("[data-highlighted]");
      await expect(highlighted, "exactly one highlighted item").toHaveCount(1);

      const focusMatches = await page.evaluate(() => {
        const active = document.activeElement;
        const hi = document.querySelector('[role="menu"] [data-highlighted]');
        return !!active && !!hi && (active === hi || hi.contains(active));
      });
      expect(
        focusMatches,
        "Radix roving tabindex: highlighted item must be document.activeElement " +
          "(otherwise SRs announce the trigger, not the row the user arrowed to)",
      ).toBe(true);

      // ── Roving tabindex: tabIndex snapshot follows ArrowDown/Up ──────
      // Radix's roving-tabindex contract says exactly ONE item in the
      // menu carries tabIndex=0 at a time; every sibling is tabIndex=-1.
      // As the user arrows through the menu, the "0" MUST travel with
      // the highlight — otherwise Shift+Tab out of the menu would land
      // on a stale row instead of the visually-focused one, and screen
      // readers announcing "in list, 2 of 3" would disagree with the
      // browser's focus target.
      //
      // Snapshot the whole `<li[role=menuitem]>` array as
      // `[tabIndex, isHighlighted]` tuples so a regression pinpoints
      // which row drifted, not just that "something is wrong".
      const snapshotTabIndex = () =>
        page.$$eval('[role="menu"] [role="menuitem"]', (rows) =>
          rows.map((row) => ({
            tabIndex: (row as HTMLElement).tabIndex,
            highlighted: row.hasAttribute("data-highlighted"),
            posinset: row.getAttribute("aria-posinset"),
          })),
        );

      const assertRovingInvariant = (
        snap: Awaited<ReturnType<typeof snapshotTabIndex>>,
        expectedHighlightedPos: string,
        label: string,
      ) => {
        const zeros = snap.filter((r) => r.tabIndex === 0);
        expect(
          zeros.length,
          `${label}: exactly one row must carry tabIndex=0 (got ${zeros.length})`,
        ).toBe(1);
        expect(
          zeros[0].highlighted,
          `${label}: the tabIndex=0 row must also be data-highlighted`,
        ).toBe(true);
        expect(
          zeros[0].posinset,
          `${label}: the tabIndex=0 row must be at aria-posinset=${expectedHighlightedPos}`,
        ).toBe(expectedHighlightedPos);
        for (const row of snap) {
          if (row.tabIndex === 0) continue;
          expect(row.tabIndex, `${label}: non-highlighted row must be tabIndex=-1`).toBe(-1);
        }
      };

      // On keyboard-open (Enter/Space), Radix auto-highlights item #1.
      assertRovingInvariant(await snapshotTabIndex(), "1", "after keyboard open");

      if (count > 1) {
        // ArrowDown → highlight moves to item #2 and the roving 0 MUST
        // follow it (Radix updates on the same tick).
        await page.keyboard.press("ArrowDown");
        await expect(
          menu.locator('[data-highlighted][aria-posinset="2"]'),
          "ArrowDown should move highlight to posinset=2",
        ).toHaveCount(1);
        assertRovingInvariant(await snapshotTabIndex(), "2", "after ArrowDown");

        // ArrowUp → highlight returns to item #1 and the 0 travels back.
        await page.keyboard.press("ArrowUp");
        await expect(
          menu.locator('[data-highlighted][aria-posinset="1"]'),
          "ArrowUp should return highlight to posinset=1",
        ).toHaveCount(1);
        assertRovingInvariant(await snapshotTabIndex(), "1", "after ArrowUp");
      }

      // Esc closes → aria-expanded flips back and focus returns to trigger.
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(trigger).toBeFocused();
    });
  }

  // Cross-opener parity: the click-to-open path and the keyboard-Enter path
  // MUST both leave the trigger + menu in an ARIA-consistent state. Radix
  // differs subtly between the two — mouse-open leaves NO item highlighted
  // (so the menu itself receives focus and SRs announce the group), while
  // keyboard-open highlights item #1 and moves activeElement onto it. Both
  // are valid WAI-ARIA menu behaviours; we lock both here so a regression
  // in either opener path is caught.
  for (const opener of ["click", "keyboard"] as const) {
    test(`opener=${opener} · aria-expanded, aria-controls & focused-item stay correct`, async ({
      context,
      page,
    }) => {
      await forceTheme(page, "light");
      await page.goto("/crumb-fixture/alpha/beta/gamma/delta/epsilon", {
        waitUntil: "domcontentloaded",
      });
      await settle(page);

      const crumb = page.locator('nav[aria-label="Breadcrumb"]').first();
      const trigger = crumb.locator('button[aria-label^="Show "]').first();
      await expect(trigger).toBeVisible();

      // Closed baseline — aria-expanded=false; aria-controls may be absent
      // OR point at a not-yet-mounted id. Either way, no menu exists yet.
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("menu")).toHaveCount(0);

      // Open via the requested path. The helper retries the action if a
      // first click/keydown is swallowed during Radix's post-hydration
      // window, then asserts BOTH the trigger flip AND the menu mount.
      const menu = await openMenuAwaitingExpanded(page, trigger, opener);

      // ── Post-open ARIA on the trigger ────────────────────────────────
      // aria-expanded was asserted inside the helper; re-read controlsId
      // once the menu is confirmed mounted.
      const controlsId = await trigger.getAttribute("aria-controls");
      expect(controlsId, `${opener}-open → aria-controls references the mounted menu`).toBeTruthy();

      // Menu is mounted with the matching id.
      await expect(menu).toHaveCount(1);
      await expect(menu).toBeVisible();
      expect(await menu.getAttribute("id")).toBe(controlsId);

      // ── Focused-item semantics per opener ────────────────────────────
      // Radix: keyboard-open highlights the first item and puts DOM focus
      // on it; mouse-open leaves the menu container focused with no
      // highlighted item until the user presses an Arrow key.
      const highlighted = menu.locator("[data-highlighted]");
      if (opener === "keyboard") {
        await expect(highlighted, "keyboard-open must auto-highlight item #1").toHaveCount(1);
        await expect(menu.locator('[data-highlighted][aria-posinset="1"]')).toHaveCount(1);
        const activeIsHighlighted = await page.evaluate(() => {
          const a = document.activeElement;
          const h = document.querySelector('[role="menu"] [data-highlighted]');
          return !!a && !!h && (a === h || h.contains(a));
        });
        expect(
          activeIsHighlighted,
          "keyboard-open → highlighted item IS document.activeElement",
        ).toBe(true);
      } else {
        await expect(highlighted, "mouse-open must NOT pre-highlight any row").toHaveCount(0);
        // First ArrowDown after mouse-open promotes item #1 to highlighted
        // AND activeElement — proving keyboard navigation still works
        // after entering the menu via pointer.
        await page.keyboard.press("ArrowDown");
        await expect(
          menu.locator('[data-highlighted][aria-posinset="1"]'),
          "ArrowDown after mouse-open should highlight item #1",
        ).toHaveCount(1);
        const activeIsHighlighted = await page.evaluate(() => {
          const a = document.activeElement;
          const h = document.querySelector('[role="menu"] [data-highlighted]');
          return !!a && !!h && (a === h || h.contains(a));
        });
        expect(
          activeIsHighlighted,
          "after ArrowDown → highlighted item IS document.activeElement",
        ).toBe(true);
      }

      // ── Close & post-close ARIA ──────────────────────────────────────
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(trigger, 'close → aria-expanded flips back to "false"').toHaveAttribute(
        "aria-expanded",
        "false",
      );
      // Esc always returns focus to the trigger regardless of opener path.
      await expect(trigger).toBeFocused();
    });
  }
});
