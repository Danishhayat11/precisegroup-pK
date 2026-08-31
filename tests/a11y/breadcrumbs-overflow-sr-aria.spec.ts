import { expect, test } from "../visual/_overflowDebugFixture";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { openMenu, closeMenu } from "../visual/_radixDropdownMenu";

/**
 * Breadcrumbs — overflow menu **screen-reader** ARIA contract.
 *
 * Sibling specs in `tests/visual/breadcrumbs-overflow-*.spec.ts` cover
 * the *behavioural* ARIA surface (aria-expanded flips, roving tabindex
 * moves with the highlight, aria-posinset/setsize numbering). This
 * spec is scoped to what a screen reader announces on OPEN, and to
 * the properties that MUST NOT be present because they would corrupt
 * that announcement.
 *
 * ── What we assert ────────────────────────────────────────────────────
 *
 *  ROLES / STRUCTURE
 *   • Trigger role="button", aria-haspopup="menu", aria-controls → menu id.
 *   • Menu   role="menu", stable `id`, non-empty accessible name (via
 *            aria-label OR aria-labelledby → the trigger's a11y name).
 *   • Items  role="menuitem" (never "option" / "menuitemcheckbox" /
 *            "menuitemradio" — those change the announced pattern).
 *   • Every item has a non-empty accessible name (name computation via
 *            Playwright's accessibility snapshot, which mirrors what an
 *            AT would compute).
 *
 *  MUST-NOT-EXIST (silent-regression guardrails)
 *   • `aria-activedescendant` is absent from BOTH trigger and menu.
 *     Radix uses roving tabindex; emitting activedescendant on top of
 *     that gives ATs two contradictory focus signals and typically
 *     produces double announcements or wrong-row announcements.
 *   • No item carries `aria-selected` or `aria-checked` — those are
 *     the listbox / menuitemcheckbox patterns, not menu.
 *   • No item is `aria-hidden="true"` (would remove it from the a11y
 *     tree while it is still keyboard-reachable — the classic silent
 *     accessibility bug).
 *   • The mounted menu has NO `role="presentation"` / `role="none"`
 *     ancestor between it and the a11y-tree root that would flatten
 *     its group semantics.
 *
 *  AXE SCAN (open state)
 *   • Run axe-core scoped to the open menu subtree with the WCAG 2 A/AA
 *     + best-practice rule sets. Any violation on the menu itself
 *     fails loudly with the rule id and the offending selector — this
 *     catches whole categories (aria-required-parent, aria-valid-attr,
 *     nested-interactive) we don't hand-enumerate above.
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

test.describe("Breadcrumbs overflow — screen-reader ARIA surface", () => {
  for (const theme of THEMES) {
    test(`${theme} · open menu exposes correct roles/properties without aria-activedescendant`, async ({
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

      // ── Trigger (closed) ─────────────────────────────────────────────
      await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(
        await trigger.getAttribute("aria-activedescendant"),
        "trigger must not emit aria-activedescendant (roving tabindex model)",
      ).toBeNull();

      // ── Open the menu ────────────────────────────────────────────────
      await trigger.focus();
      const menu = await openMenu(page, trigger, {
        activation: "Space",
        label: `overflow menu (${theme} SR contract)`,
      });
      await expect(menu, "menu open").toBeVisible();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");

      // aria-controls (trigger) ↔ id (menu) must round-trip.
      const controlsId = await trigger.getAttribute("aria-controls");
      expect(controlsId, "trigger.aria-controls set on open").toBeTruthy();
      expect(await menu.getAttribute("id"), "menu.id matches trigger.aria-controls").toBe(
        controlsId,
      );

      // ── Menu accessible name ─────────────────────────────────────────
      // Radix wires aria-labelledby → the trigger, so the a11y name is
      // the trigger's own accessible name ("Show N hidden breadcrumb…").
      // We accept either an explicit aria-label OR a non-empty computed
      // name from the a11y tree.
      const menuAriaLabel = await menu.getAttribute("aria-label");
      const menuAriaLabelledBy = await menu.getAttribute("aria-labelledby");
      const menuAxNode = await page.accessibility.snapshot({
        root: (await menu.elementHandle()) ?? undefined,
      });
      expect(
        (menuAriaLabel && menuAriaLabel.trim().length > 0) ||
          (menuAriaLabelledBy && menuAriaLabelledBy.trim().length > 0) ||
          (menuAxNode && typeof menuAxNode.name === "string" && menuAxNode.name.trim().length > 0),
        "menu has a non-empty accessible name (aria-label, aria-labelledby, or computed)",
      ).toBe(true);
      expect(menuAxNode?.role, 'menu is exposed as role="menu" in the a11y tree').toBe("menu");

      // ── activedescendant MUST be absent on the menu ──────────────────
      // Core assertion of this spec — roving tabindex + activedescendant
      // is a well-known SR anti-pattern (double / wrong announcements).
      expect(
        await menu.getAttribute("aria-activedescendant"),
        "menu must not emit aria-activedescendant (contradicts roving tabindex)",
      ).toBeNull();

      // ── Items: role + accessible name + forbidden props ──────────────
      const items = menu.locator('[role="menuitem"]');
      const count = await items.count();
      expect(count, "menu lists at least one hidden crumb").toBeGreaterThan(0);

      // Collect every item's SR-relevant attribute surface in one pass
      // so a failure lists the offending row(s) instead of aborting on
      // the first bad item.
      const itemSurface = await items.evaluateAll((rows) =>
        rows.map((el, index) => {
          // Compute an approximation of the AT-facing name from the
          // WAI-ARIA name computation priority: aria-labelledby →
          // aria-label → text content. Matches what NVDA/VO would say.
          const labelledBy = el.getAttribute("aria-labelledby");
          const labelledByText = labelledBy
            ? labelledBy
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent ?? "")
                .join(" ")
                .trim()
            : "";
          const name =
            labelledByText ||
            (el.getAttribute("aria-label") ?? "").trim() ||
            (el.textContent ?? "").trim();
          return {
            index,
            role: el.getAttribute("role"),
            name,
            ariaSelected: el.getAttribute("aria-selected"),
            ariaChecked: el.getAttribute("aria-checked"),
            ariaHidden: el.getAttribute("aria-hidden"),
            ariaDisabled: el.getAttribute("aria-disabled"),
            insideHidden: !!el.closest('[aria-hidden="true"]'),
            role_presentation_ancestor: !!el.closest('[role="presentation"], [role="none"]'),
          };
        }),
      );

      for (const row of itemSurface) {
        const tag = `item[${row.index}] "${row.name.slice(0, 40)}"`;

        expect(row.role, `${tag} role is "menuitem"`).toBe("menuitem");
        expect(row.name.length, `${tag} has a non-empty accessible name`).toBeGreaterThan(0);

        // Forbidden — wrong widget pattern.
        expect(
          row.ariaSelected,
          `${tag} must NOT set aria-selected (that is listbox pattern)`,
        ).toBeNull();
        expect(
          row.ariaChecked,
          `${tag} must NOT set aria-checked (that is menuitemcheckbox pattern)`,
        ).toBeNull();

        // Forbidden — hides the row from AT while keyboard-reachable.
        expect(row.ariaHidden, `${tag} must NOT set aria-hidden="true"`).not.toBe("true");
        expect(row.insideHidden, `${tag} must not be inside an aria-hidden="true" ancestor`).toBe(
          false,
        );

        // Forbidden — flattens group semantics.
        expect(
          row.role_presentation_ancestor,
          `${tag} must not have a role="presentation"/"none" ancestor inside the menu`,
        ).toBe(false);
      }

      // ── Axe scan of the open menu subtree ────────────────────────────
      // Scoped `include` keeps the assertion focused on THIS widget so
      // unrelated page violations don't cross-contaminate.
      const axe = await new AxeBuilder({ page })
        .include('[role="menu"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
        .analyze();

      if (axe.violations.length > 0) {
        // Format each violation with rule id + first offending selector
        // so the CI log tells you exactly what to fix.
        const summary = axe.violations
          .map((v) => {
            const first = v.nodes[0];
            const selector = Array.isArray(first?.target)
              ? first.target.join(" ")
              : String(first?.target ?? "");
            return `  • [${v.id}] ${v.help} — ${selector}\n    ${v.helpUrl}`;
          })
          .join("\n");
        throw new Error(
          `[${theme}] axe found ${axe.violations.length} violation(s) in open overflow menu:\n${summary}`,
        );
      }

      // Cleanup so the next iteration starts from a closed menu.
      await closeMenu(page);
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
    });
  }
});
