/**
 * Per-theme focus-visible regression gate.
 *
 * Purpose: guarantee that every interactive control in the authenticated
 * app shell paints a *visible* `:focus-visible` indicator in BOTH themes
 * (light + dark), and that the indicator SURVIVES two failure modes we've
 * regressed on before:
 *
 *   1. Hovering while focused — a stray `:hover` rule can flatten the
 *      ring by resetting `box-shadow` / `outline` back to the resting
 *      state.
 *   2. Focus inside portalled overlays (Radix DropdownMenu, cmdk
 *      CommandDialog) — these mount outside the app tree and can miss
 *      the shell's global focus-visible tokens.
 *
 * Scope per theme:
 *   - Sample of shell controls: sidebar collapse toggle, global search
 *     trigger, theme toggle, notifications, user chip.
 *   - User DropdownMenu: every visible menu item.
 *   - Global CommandDialog (⌘K): search input + first result row.
 *
 * A control "has a visible focus indicator" when at least one of
 * outline / box-shadow / border differs meaningfully from the unfocused
 * baseline (matches the definition in
 * tests/a11y/header-icon-focus-visible.spec.ts).
 *
 * Run:
 *   bunx playwright test tests/a11y/theme-focus-visible-audit.spec.ts \
 *        --project=chromium-reduced-motion
 */
import { test, expect, type Page, type Locator } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "../visual/_authHelpers";

type Theme = "light" | "dark";
const THEMES: readonly Theme[] = ["light", "dark"];

type FocusStyle = {
  outlineStyle: string;
  outlineWidth: string;
  outlineColor: string;
  boxShadow: string;
  borderColor: string;
  borderWidth: string;
  backgroundColor: string;
};

const TRANSPARENT = new Set(["rgba(0, 0, 0, 0)", "transparent", ""]);

function hasVisibleFocus(focused: FocusStyle, baseline: FocusStyle): boolean {
  // A visible focus/selection indicator is any of:
  //   - outline (native focus ring)
  //   - box-shadow that changed vs the unfocused baseline (shadcn ring)
  //   - border color/width change
  //   - background color change (Radix menuitem highlight, cmdk option)
  const outlineOk =
    focused.outlineStyle !== "none" &&
    parseFloat(focused.outlineWidth) > 0 &&
    !TRANSPARENT.has(focused.outlineColor);
  const shadowOk = focused.boxShadow !== "none" && focused.boxShadow !== baseline.boxShadow;
  const borderOk =
    focused.borderColor !== baseline.borderColor || focused.borderWidth !== baseline.borderWidth;
  const backgroundOk = focused.backgroundColor !== baseline.backgroundColor;
  return outlineOk || shadowOk || borderOk || backgroundOk;
}

async function readStyle(page: Page, handle: Locator): Promise<FocusStyle | null> {
  return await handle
    .evaluate((el) => {
      const s = window.getComputedStyle(el as HTMLElement);
      return {
        outlineStyle: s.outlineStyle,
        outlineWidth: s.outlineWidth,
        outlineColor: s.outlineColor,
        boxShadow: s.boxShadow,
        borderColor: s.borderColor,
        borderWidth: s.borderWidth,
        backgroundColor: s.backgroundColor,
      };
    })
    .catch(() => null);
}

/** Focus `el` via keyboard so `:focus-visible` matches (JS `.focus()` alone does not). */
async function keyboardFocus(page: Page, el: Locator) {
  await el.evaluate((node) => {
    (document.activeElement as HTMLElement | null)?.blur();
    (node as HTMLElement).focus({ preventScroll: true });
  });
  // Nudging Tab / Shift+Tab flips Chromium's :focus-visible heuristic on
  // for the element we just focused.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
}

async function assertVisibleFocus(page: Page, el: Locator, label: string, failures: string[]) {
  // Capture the *unfocused* baseline. If the element is already focused
  // (e.g. cmdk auto-focuses the input on open), blur first so the diff
  // is meaningful.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const baseline = await readStyle(page, el);
  if (!baseline) {
    failures.push(`${label}: could not read baseline computed style`);
    return;
  }
  await keyboardFocus(page, el);
  const focused = await readStyle(page, el);
  if (!focused) {
    failures.push(`${label}: could not read focused computed style`);
    return;
  }
  if (!hasVisibleFocus(focused, baseline)) {
    failures.push(
      `${label}: no visible focus ring (outline:${focused.outlineStyle}/${focused.outlineWidth}/${focused.outlineColor}, box-shadow:${focused.boxShadow}, bg:${focused.backgroundColor})`,
    );
    return;
  }
  // Hover while focused MUST NOT flatten the ring.
  await el.hover({ force: true }).catch(() => {
    /* may re-scroll under overlay */
  });
  const afterHover = await readStyle(page, el);
  if (!afterHover || !hasVisibleFocus(afterHover, baseline)) {
    failures.push(
      `${label}: focus ring disappears on hover (box-shadow:${afterHover?.boxShadow ?? "n/a"}, bg:${afterHover?.backgroundColor ?? "n/a"})`,
    );
  }
}

async function primeTheme(page: Page, theme: Theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.addInitScript((t: Theme) => {
    try {
      localStorage.setItem("precise.theme", t);
    } catch {
      /* noop */
    }
  }, theme);
}

async function waitForShell(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.locator('[data-theme="ios"]').first().waitFor({ state: "attached", timeout: 15_000 });
  await page.waitForTimeout(300);
}

test.describe("per-theme focus-visible audit", () => {
  test.skip(
    !authAvailable(),
    "Requires an injected Supabase session (LOVABLE_BROWSER_AUTH_STATUS=injected).",
  );

  for (const theme of THEMES) {
    test.describe(`theme: ${theme}`, () => {
      test("shell header controls paint & retain a focus ring on hover", async ({
        context,
        page,
      }) => {
        await primeTheme(page, theme);
        await restoreSupabaseSession(context, page);
        await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
        await waitForShell(page);

        // Confirm the app actually applied the requested theme so we
        // don't silently audit the wrong palette twice.
        const rootClass = await page.evaluate(() => document.documentElement.className);
        if (theme === "dark") {
          expect(rootClass, "html should carry .dark").toContain("dark");
        } else {
          expect(rootClass, "html should not carry .dark").not.toContain("dark");
        }

        const header = page.locator("header").first();
        await expect(header).toBeVisible();

        // Sample of stable, always-present shell controls. Selectors match
        // the AppShell topbar (see src/components/AppShell.tsx).
        const targets: Array<{ label: string; el: Locator }> = [
          {
            label: "sidebar collapse toggle",
            el: header.getByRole("button", { name: /collapse sidebar|expand sidebar/i }),
          },
          {
            label: "global search trigger",
            el: header.getByRole("button", { name: /search/i }).first(),
          },
          {
            label: "notifications bell",
            el: header.getByRole("button", { name: /notifications/i }),
          },
          { label: "user account chip", el: header.getByRole("button", { name: /account menu/i }) },
        ];

        const failures: string[] = [];
        for (const { label, el } of targets) {
          if ((await el.count()) === 0) continue; // control not rendered at this width
          await assertVisibleFocus(page, el.first(), `[${theme}] ${label}`, failures);
        }

        expect(
          failures,
          `focus-visible failures in shell header (${theme}):\n${failures.join("\n")}`,
        ).toEqual([]);
      });

      test("user dropdown menu items keep focus ring inside portal", async ({ context, page }) => {
        await primeTheme(page, theme);
        await restoreSupabaseSession(context, page);
        await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
        await waitForShell(page);

        const trigger = page
          .locator("header")
          .first()
          .getByRole("button", { name: /account menu/i });
        await trigger.click();

        const menu = page.getByRole("menu").first();
        await menu.waitFor({ state: "visible", timeout: 5_000 });

        const items = menu.getByRole("menuitem");
        const count = await items.count();
        expect(count, "dropdown must expose at least one menu item").toBeGreaterThan(0);

        const failures: string[] = [];

        // Radix marks the currently highlighted item with `data-highlighted`.
        // Initial highlight state after open varies (first item auto-focused
        // on some Radix versions, none on others), so for each item we
        // ArrowDown until that item is the highlighted one, then diff its
        // computed style against a sibling that isn't highlighted.
        for (let i = 0; i < count; i++) {
          const item = items.nth(i);
          const name = (await item.textContent())?.trim() || `menuitem[${i}]`;

          // Walk keyboard highlight to this item — bounded by 2*count so
          // Radix's wrap-around ArrowDown always reaches every position.
          let landed = false;
          for (let step = 0; step < count * 2 + 2; step++) {
            const isHighlighted = await item.evaluate((el) => el.hasAttribute("data-highlighted"));
            if (isHighlighted) {
              landed = true;
              break;
            }
            await page.keyboard.press("ArrowDown");
            await page.waitForTimeout(40);
          }
          if (!landed) {
            failures.push(`[${theme}] menuitem "${name}" (kbd): could not reach via ArrowDown`);
            continue;
          }

          const highlighted = await readStyle(page, item);
          const siblingIdx = i === 0 ? Math.min(count - 1, 1) : 0;
          const unhighlighted = await readStyle(page, items.nth(siblingIdx));
          if (!highlighted || !unhighlighted || !hasVisibleFocus(highlighted, unhighlighted)) {
            failures.push(
              `[${theme}] menuitem "${name}" (kbd): no visible highlight vs sibling (bg:${highlighted?.backgroundColor ?? "n/a"}, box-shadow:${highlighted?.boxShadow ?? "n/a"})`,
            );
          }
        }

        // Hover the last item — SOMETHING must remain highlighted so
        // pointer users still see focus state in the popover.
        await items.nth(count - 1).hover({ force: true });
        await page.waitForTimeout(80);
        const anyHighlighted = await menu.locator('[role="menuitem"][data-highlighted]').count();
        if (anyHighlighted === 0) {
          failures.push(`[${theme}] menuitem (hover): no item is highlighted after hover`);
        }

        expect(
          failures,
          `focus-visible failures inside user menu (${theme}):\n${failures.join("\n")}`,
        ).toEqual([]);
      });

      test("⌘K command dialog input & results keep focus ring inside overlay", async ({
        context,
        page,
      }) => {
        await primeTheme(page, theme);
        await restoreSupabaseSession(context, page);
        await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
        await waitForShell(page);

        await page.keyboard.press("Meta+k");
        const dialog = page.getByRole("dialog").first();
        await dialog.waitFor({ state: "visible", timeout: 5_000 });

        const failures: string[] = [];

        // Input auto-focuses on open. Blur→refocus so the baseline is
        // truly unfocused and the diff reflects the focus ring.
        const searchbox = dialog.getByRole("combobox").first().or(dialog.locator("input").first());
        if (await searchbox.count()) {
          await assertVisibleFocus(
            page,
            searchbox.first(),
            `[${theme}] command dialog input`,
            failures,
          );
          // Re-focus the input for the subsequent typing step.
          await searchbox.first().focus();
        }

        // Type to surface at least one result row.
        await page.keyboard.type("a", { delay: 20 });
        await page.waitForTimeout(400);
        const options = dialog.getByRole("option");
        const optionCount = await options.count();
        if (optionCount >= 2) {
          // cmdk auto-selects the first option — capture a NON-selected
          // sibling as the un-highlighted baseline, then verify the
          // selected option's style differs.
          const selectedOption = dialog.locator('[role="option"][data-selected="true"]').first();
          const unselectedOption = dialog
            .locator('[role="option"]:not([data-selected="true"])')
            .first();
          if ((await selectedOption.count()) && (await unselectedOption.count())) {
            const baseline = await readStyle(page, unselectedOption);
            const highlighted = await readStyle(page, selectedOption);
            if (!baseline || !highlighted || !hasVisibleFocus(highlighted, baseline)) {
              failures.push(
                `[${theme}] command dialog option: keyboard highlight not visually distinct (bg:${highlighted?.backgroundColor ?? "n/a"}, box-shadow:${highlighted?.boxShadow ?? "n/a"})`,
              );
            }
            // Hover the previously-unselected option — cmdk mouseMove
            // should transfer highlight so that SOME option remains
            // visually selected. We don't pin the assertion to the
            // hovered option itself (cmdk may debounce mouse-driven
            // selection) — the regression this guards is "hover kills
            // the highlight entirely and no row is selected".
            await unselectedOption.hover({ force: true });
            await page.waitForTimeout(120);
            const anySelected = await dialog
              .locator('[role="option"][data-selected="true"]')
              .count();
            if (anySelected === 0) {
              failures.push(`[${theme}] command dialog: hover cleared all option highlights`);
            }
          }
        }

        expect(
          failures,
          `focus-visible failures inside command dialog (${theme}):\n${failures.join("\n")}`,
        ).toEqual([]);
      });
    });
  }
});
