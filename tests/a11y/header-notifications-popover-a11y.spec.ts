/**
 * Automated a11y contract for the header notifications popover at
 * 768×1024 (iPad portrait / `md` breakpoint).
 *
 * Complements the sibling specs:
 *   - header-notifications-popover-focus.spec.ts — focus-ring / clip
 *   - header-tablet-768-visibility.spec.ts       — geometry / snapshots
 *
 * This spec is the STRUCTURAL a11y contract: even if the ring paints
 * correctly and nothing overflows, the popover is still broken if it
 * has no accessible name, wrong role, focusable children with no
 * accessible names, or a keyboard trap. Those failures are what screen
 * readers and keyboard-only users actually feel.
 *
 * Guardrails:
 *   1. Trigger — `aria-haspopup` + `aria-expanded` transitions correctly
 *      when the popover opens (Radix wiring regression guard).
 *   2. Popover — mounts with a valid role (`dialog` | `menu` | `region`
 *      | `listbox`) and an accessible name so screen readers can
 *      announce it on open.
 *   3. Every focusable inside the popover has an accessible name
 *      (button-name / link-name / aria-label).
 *   4. Axe scan (labels + roles + focus categories) scoped to the
 *      popover panel reports zero violations — catches structural
 *      failures the specs above are not designed to see
 *      (aria-hidden on the focused item, nested-interactive, etc.).
 *   5. Keyboard nav:
 *        a. Tab from the trigger moves focus INTO the popover panel.
 *        b. Escape closes the popover AND returns focus to the trigger
 *           (Radix contract — regression here breaks keyboard-only
 *           users, not just screen-reader users).
 *
 * Run:
 *   bunx playwright test tests/a11y/header-notifications-popover-a11y.spec.ts \
 *        --project=chromium-reduced-motion
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  describeHeaderSuite,
  FOCUSABLE_SELECTOR,
  type HeaderViewport,
} from "./_helpers/header-a11y";

const VIEWPORT: HeaderViewport = {
  label: "768x1024",
  width: 768,
  height: 1024,
};

// Axe rules the app-wide scan enforces — re-run here scoped to the
// popover so a regression that only exists inside the portal is
// still caught (the top-level scan runs before the popover mounts).
const ENFORCED_RULES = [
  // labels / names
  "button-name",
  "link-name",
  "input-button-name",
  "aria-input-field-name",
  "image-alt",
  // roles / structure
  "aria-allowed-role",
  "aria-required-attr",
  "aria-required-children",
  "aria-required-parent",
  "aria-roles",
  "aria-valid-attr",
  "aria-valid-attr-value",
  // focus / keyboard reachability
  "tabindex",
  "focus-order-semantics",
  "aria-hidden-focus",
  "nested-interactive",
];

/** Radix Popover portals mark the panel; the app tags it further. */
const POPOVER_SELECTOR = "[data-notifications-popover]";
/** Radix roles the popover panel might carry. */
const VALID_POPOVER_ROLES = new Set(["dialog", "menu", "region", "listbox", "group"]);

async function openPopover(page: Page, bell: Locator): Promise<Locator> {
  await bell.focus();
  await expect(bell).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  const popover = page.locator(POPOVER_SELECTOR);
  await expect(popover).toBeVisible({ timeout: 5_000 });
  await expect(bell).toHaveAttribute("aria-expanded", "true");
  return popover;
}

async function accessibleName(handle: Locator): Promise<string> {
  return handle.evaluate((el) => {
    const e = el as HTMLElement;
    const labelledBy = e.getAttribute("aria-labelledby");
    if (labelledBy) {
      const ids = labelledBy.split(/\s+/).filter(Boolean);
      const names = ids
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter(Boolean);
      if (names.length) return names.join(" ");
    }
    const label = e.getAttribute("aria-label");
    if (label && label.trim()) return label.trim();
    const title = e.getAttribute("title");
    if (title && title.trim()) return title.trim();
    return (e.textContent ?? "").trim();
  });
}

describeHeaderSuite(
  `header notifications popover — a11y contract @ ${VIEWPORT.label}`,
  VIEWPORT,
  () => {
    test("trigger exposes aria-haspopup + aria-expanded and toggles it", async ({ page }) => {
      const bell = page.getByRole("button", { name: /view notifications/i });
      await expect(bell).toBeVisible();
      // aria-haspopup is the SR hint that Enter/Space will open a
      // secondary surface. Radix sets it to "dialog" or "menu" — any
      // truthy value satisfies the contract, "false" / missing does not.
      const haspopup = await bell.getAttribute("aria-haspopup");
      expect(
        haspopup,
        "trigger must set aria-haspopup so SR users know Enter opens a panel",
      ).toBeTruthy();
      expect(haspopup).not.toBe("false");

      await openPopover(page, bell);
      await page.keyboard.press("Escape");
      await expect(page.locator(POPOVER_SELECTOR)).toBeHidden();
      await expect(bell).toHaveAttribute("aria-expanded", "false");
    });

    test("popover panel has a valid role and an accessible name", async ({ page }) => {
      const bell = page.getByRole("button", { name: /view notifications/i });
      const popover = await openPopover(page, bell);

      const role = await popover.evaluate((el) => (el as HTMLElement).getAttribute("role"));
      expect(
        role && VALID_POPOVER_ROLES.has(role),
        `popover must carry one of ${[...VALID_POPOVER_ROLES].join(", ")}, got ${role ?? "null"}`,
      ).toBeTruthy();

      const name = await accessibleName(popover);
      expect(
        name.length,
        "popover must have an accessible name (aria-label / aria-labelledby / heading) so SR users hear it on open",
      ).toBeGreaterThan(0);
    });

    test("every focusable inside the popover has an accessible name", async ({ page }) => {
      const bell = page.getByRole("button", { name: /view notifications/i });
      const popover = await openPopover(page, bell);

      const focusables = popover.locator(FOCUSABLE_SELECTOR);
      const count = await focusables.count();
      expect(count, "popover should expose at least one focusable").toBeGreaterThan(0);

      const nameless: string[] = [];
      for (let i = 0; i < count; i++) {
        const el = focusables.nth(i);
        const name = await accessibleName(el);
        if (!name) {
          const outer = await el.evaluate((n) => (n as HTMLElement).outerHTML.slice(0, 120));
          nameless.push(`[${i}] ${outer}`);
        }
      }
      expect(
        nameless,
        `focusable(s) inside popover have no accessible name:\n${nameless.join("\n")}`,
      ).toEqual([]);
    });

    test("axe scan (labels + roles + focus) scoped to the popover has zero violations", async ({
      page,
    }) => {
      const bell = page.getByRole("button", { name: /view notifications/i });
      await openPopover(page, bell);

      const results = await new AxeBuilder({ page })
        .include(POPOVER_SELECTOR)
        .withRules(ENFORCED_RULES)
        .analyze();

      const violations = results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.map((n) => n.html.slice(0, 140)),
      }));
      expect(
        violations,
        `axe violations inside notifications popover @ ${VIEWPORT.width}×${VIEWPORT.height}:\n${JSON.stringify(violations, null, 2)}`,
      ).toEqual([]);
    });

    test("Tab moves focus into the popover; Escape closes and returns focus to the trigger", async ({
      page,
    }) => {
      const bell = page.getByRole("button", { name: /view notifications/i });
      const popover = await openPopover(page, bell);

      // Radix Popover behaviors vary: some implementations auto-focus
      // the first focusable on open (via autoFocus), others require an
      // explicit Tab. Either satisfies the keyboard contract — after
      // opening + one Tab, activeElement MUST be inside the popover.
      await page.keyboard.press("Tab");
      const focusInside = await popover.evaluate((panel) => {
        const active = document.activeElement as HTMLElement | null;
        return !!(active && panel.contains(active));
      });
      expect(
        focusInside,
        "after opening the popover and pressing Tab, focus must be inside the panel",
      ).toBe(true);

      // Escape closes and returns focus to the trigger (Radix contract).
      await page.keyboard.press("Escape");
      await expect(popover).toBeHidden();
      const focusedBack = await bell.evaluate((el) => document.activeElement === el);
      expect(focusedBack, "Escape must return focus to the notifications trigger").toBe(true);
    });
  },
);
