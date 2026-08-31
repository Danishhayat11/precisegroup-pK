import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu, closeMenu } from "../visual/_radixDropdownMenu";

/**
 * Breadcrumbs overflow — highlighted-row a11y state (roving-tabindex contract).
 *
 * Complements `breadcrumbs-overflow-sr-aria.spec.ts` (opens the menu once
 * and asserts the resting SR surface). This spec drives the *highlight
 * cursor* through the menu with ArrowDown / ArrowUp / Home / End and, at
 * every stop, verifies the correct focus/active properties are updated
 * on the newly-highlighted row while explicitly forbidding listbox
 * semantics (`aria-selected` / `aria-checked`) anywhere in the menu.
 *
 * ── What we assert at every highlight move ─────────────────────────────
 *
 *   ROVING TABINDEX (the "focus/active" signal for menu widgets)
 *     • Exactly one [role="menuitem"] has `data-highlighted` set.
 *     • That same menuitem has `tabindex="0"`; every other menuitem has
 *       `tabindex="-1"`. This IS the "which row is active" signal that
 *       AT rely on for `role="menu"` — there is no separate active
 *       attribute for menu, unlike listbox.
 *     • `document.activeElement` IS that menuitem (roving-tabindex moves
 *       real DOM focus, unlike aria-activedescendant).
 *
 *   NEVER-USED ATTRIBUTES (silent-regression guardrails)
 *     • `aria-activedescendant` is absent from the trigger AND the menu.
 *       Emitting it on top of roving-tabindex gives ATs two contradictory
 *       focus signals (double / wrong-row announcements).
 *     • NO menuitem carries `aria-selected` — that is the listbox pattern
 *       (`role="option"`), not menu; NVDA/JAWS announce "selected" which
 *       is misleading for a transient hover-highlight.
 *     • NO menuitem carries `aria-checked` — that is the
 *       menuitemcheckbox / menuitemradio pattern, not plain menuitem.
 *
 * Runs in both light + dark so a theme-swap regression can't sneak in a
 * class-name based active state that quietly emits `aria-selected`.
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

type HighlightSurface = {
  /** Indices of every menuitem currently carrying [data-highlighted]. */
  highlightedIndices: number[];
  /** tabindex value for each menuitem, in DOM order. */
  tabIndexes: string[];
  /** Whether document.activeElement is one of the menuitems, and its index. */
  activeElementIndex: number;
  /** aria-activedescendant on trigger + menu (both MUST be null). */
  triggerActiveDescendant: string | null;
  menuActiveDescendant: string | null;
  /** aria-selected / aria-checked values per menuitem (MUST all be null). */
  perItemAriaSelected: (string | null)[];
  perItemAriaChecked: (string | null)[];
};

async function readHighlightSurface(page: Page): Promise<HighlightSurface> {
  return page.evaluate(() => {
    const trigger = document.querySelector<HTMLElement>(
      'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
    );
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    const items = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'),
    );
    const active = document.activeElement as HTMLElement | null;

    return {
      highlightedIndices: items
        .map((el, i) => (el.hasAttribute("data-highlighted") ? i : -1))
        .filter((i) => i >= 0),
      tabIndexes: items.map((el) => el.getAttribute("tabindex") ?? ""),
      activeElementIndex: active ? items.indexOf(active) : -1,
      triggerActiveDescendant: trigger?.getAttribute("aria-activedescendant") ?? null,
      menuActiveDescendant: menu?.getAttribute("aria-activedescendant") ?? null,
      perItemAriaSelected: items.map((el) => el.getAttribute("aria-selected")),
      perItemAriaChecked: items.map((el) => el.getAttribute("aria-checked")),
    };
  });
}

function assertSurface(
  surface: HighlightSurface,
  ctx: { theme: string; step: string; expectHighlightIndex?: number },
) {
  const tag = `[${ctx.theme} · ${ctx.step}]`;

  // Exactly one highlighted row.
  expect(
    surface.highlightedIndices.length,
    `${tag} exactly one menuitem carries [data-highlighted]`,
  ).toBe(1);
  if (ctx.expectHighlightIndex !== undefined) {
    expect(
      surface.highlightedIndices[0],
      `${tag} highlight is on row #${ctx.expectHighlightIndex}`,
    ).toBe(ctx.expectHighlightIndex);
  }
  const highlightIdx = surface.highlightedIndices[0];

  // Roving tabindex: highlighted row = 0, everyone else = -1.
  surface.tabIndexes.forEach((ti, i) => {
    const expected = i === highlightIdx ? "0" : "-1";
    expect(
      ti,
      `${tag} row #${i} tabindex ("${ti}") matches roving-tabindex model (expected "${expected}")`,
    ).toBe(expected);
  });

  // Real DOM focus follows the highlight (roving-tabindex, NOT
  // aria-activedescendant).
  expect(
    surface.activeElementIndex,
    `${tag} document.activeElement is the highlighted menuitem`,
  ).toBe(highlightIdx);

  // aria-activedescendant MUST be absent from trigger and menu — it
  // contradicts the roving-tabindex model Radix uses.
  expect(
    surface.triggerActiveDescendant,
    `${tag} trigger.aria-activedescendant is absent`,
  ).toBeNull();
  expect(surface.menuActiveDescendant, `${tag} menu.aria-activedescendant is absent`).toBeNull();

  // NO listbox / menuitemcheckbox semantics leak in — every menuitem
  // must have aria-selected AND aria-checked absent, on every row,
  // regardless of highlight state.
  surface.perItemAriaSelected.forEach((v, i) => {
    expect(v, `${tag} row #${i} must not carry aria-selected (listbox pattern only)`).toBeNull();
  });
  surface.perItemAriaChecked.forEach((v, i) => {
    expect(
      v,
      `${tag} row #${i} must not carry aria-checked (menuitemcheckbox pattern only)`,
    ).toBeNull();
  });
}

test.describe("Breadcrumbs overflow — highlighted row a11y state", () => {
  for (const theme of THEMES) {
    test(`${theme} · ArrowDown / ArrowUp / End / Home update roving-tabindex without aria-selected`, async ({
      page,
    }) => {
      await forceTheme(page, theme);
      await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(200);

      const trigger = page.locator(
        'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
      );
      await expect(trigger, "overflow trigger renders").toBeVisible();

      await trigger.focus();
      const menu = await openMenu(page, trigger, {
        activation: "Space",
        label: `overflow menu (${theme} highlighted-row surface)`,
      });
      await expect(menu).toBeVisible();

      const items = menu.locator('[role="menuitem"]');
      const itemCount = await items.count();
      expect(itemCount, "menu lists more than one hidden crumb").toBeGreaterThan(1);

      // Radix auto-highlights the first item on keyboard open. Confirm the
      // baseline surface BEFORE moving so a failure here points at the
      // opening handshake, not the arrow-key handler.
      await page.keyboard.press("ArrowDown");
      let surface = await readHighlightSurface(page);
      assertSurface(surface, { theme, step: "after 1× ArrowDown", expectHighlightIndex: 0 });

      // ArrowDown → row #1.
      await page.keyboard.press("ArrowDown");
      surface = await readHighlightSurface(page);
      assertSurface(surface, { theme, step: "after 2× ArrowDown", expectHighlightIndex: 1 });

      // ArrowDown → row #2 (if the menu has that many; skip cleanly otherwise).
      if (itemCount > 2) {
        await page.keyboard.press("ArrowDown");
        surface = await readHighlightSurface(page);
        assertSurface(surface, { theme, step: "after 3× ArrowDown", expectHighlightIndex: 2 });
      }

      // ArrowUp brings us back one step.
      await page.keyboard.press("ArrowUp");
      surface = await readHighlightSurface(page);
      assertSurface(surface, {
        theme,
        step: "after ArrowUp",
        expectHighlightIndex: itemCount > 2 ? 1 : 0,
      });

      // End jumps to the last row; Home returns to the first. These are
      // WAI-ARIA menu keys — worth exercising here because a regression
      // in the End/Home handler is one of the classic ways `aria-selected`
      // gets silently added ("we needed a way to say 'the last one is
      // active'").
      await page.keyboard.press("End");
      surface = await readHighlightSurface(page);
      assertSurface(surface, {
        theme,
        step: "after End",
        expectHighlightIndex: itemCount - 1,
      });

      await page.keyboard.press("Home");
      surface = await readHighlightSurface(page);
      assertSurface(surface, { theme, step: "after Home", expectHighlightIndex: 0 });

      // Sanity: aria-expanded is still true throughout the highlight walk
      // (a stray Escape from a keybinding handler would end this test
      // early and make the surface assertions vacuous).
      await expect(
        trigger,
        `[${theme}] aria-expanded stayed true throughout the highlight walk`,
      ).toHaveAttribute("aria-expanded", "true");

      await closeMenu(page);
    });
  }
});
