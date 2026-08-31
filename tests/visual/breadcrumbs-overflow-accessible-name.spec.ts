import { expect, test } from "./_overflowDebugFixture";
import type { Locator, Page } from "@playwright/test";

/**
 * Breadcrumbs — overflow trigger accessible-name stability contract.
 *
 * Screen readers announce the trigger by its accessible name. That
 * name MUST:
 *   1. Exist (non-empty), mention "hidden breadcrumb" so users
 *      understand what the popup contains — not a bare "More" or "…"
 *      which is meaningless out of context.
 *   2. Stay identical between collapsed and expanded states. Radix
 *      updates aria-expanded to convey open/closed; the *name*
 *      should not shift ("Show hidden breadcrumbs" → "Hide hidden
 *      breadcrumbs") because that makes the trigger appear to be a
 *      different control and can retrigger focus / live-region
 *      announcements on some AT.
 *   3. Be identical in light and dark themes — theme is presentation,
 *      not semantics.
 *
 * We resolve the accessible name the same way an AT does: prefer
 * aria-labelledby → aria-label → visible text content, trimmed.
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

async function openMenuByKeyboard(page: Page, trigger: Locator): Promise<Locator> {
  const menu = page.getByRole("menu");
  for (let i = 0; i < 6; i++) {
    await trigger.press(" ");
    if (await menu.count()) return menu;
    await page.waitForTimeout(250);
  }
  return menu;
}

/**
 * Compute the accessible name in the browser using the same
 * precedence AT uses. Returns { name, source } so failures show
 * *why* a name is what it is.
 */
async function readAccessibleName(page: Page) {
  return page.evaluate(() => {
    const trigger = document.querySelector<HTMLElement>(
      'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
    );
    if (!trigger) return { name: null, source: "missing" as const };

    const labelledby = trigger.getAttribute("aria-labelledby");
    if (labelledby) {
      const parts = labelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter(Boolean);
      if (parts.length) return { name: parts.join(" "), source: "aria-labelledby" as const };
    }

    const label = trigger.getAttribute("aria-label");
    if (label && label.trim()) return { name: label.trim(), source: "aria-label" as const };

    const text = (trigger.textContent ?? "").trim();
    if (text) return { name: text, source: "text" as const };

    const title = trigger.getAttribute("title");
    if (title && title.trim()) return { name: title.trim(), source: "title" as const };

    return { name: "", source: "none" as const };
  });
}

// Collect { collapsedName, expandedName, source } per theme so we can
// assert cross-theme equality at the end.
const observed: Record<
  (typeof THEMES)[number],
  { collapsed: string; expanded: string; source: string }
> = {
  light: { collapsed: "", expanded: "", source: "" },
  dark: { collapsed: "", expanded: "", source: "" },
};

test.describe("Breadcrumbs — overflow trigger has a stable accessible name", () => {
  for (const theme of THEMES) {
    test(`${theme} · accessible name is meaningful and identical when collapsed vs expanded`, async ({
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
      await expect(trigger, "baseline aria-expanded=false").toHaveAttribute(
        "aria-expanded",
        "false",
      );

      // Collapsed-state accessible name.
      const collapsed = await readAccessibleName(page);
      expect(collapsed.source, "trigger exposes an accessible name").not.toBe("none");
      expect(collapsed.source, "trigger accessible name is not missing").not.toBe("missing");
      expect(collapsed.name, "accessible name is non-empty").toBeTruthy();
      expect(
        (collapsed.name ?? "").length,
        'accessible name is descriptive (not a bare icon glyph like "…")',
      ).toBeGreaterThanOrEqual(4);
      expect(
        collapsed.name ?? "",
        'accessible name mentions "hidden breadcrumb" so AT users know what the popup contains',
      ).toMatch(/hidden breadcrumb/i);

      // Open the menu — this must not change the accessible name.
      await trigger.focus();
      const menu = await openMenuByKeyboard(page, trigger);
      await expect(menu, "menu opened").toBeVisible();
      await expect(trigger, "aria-expanded flipped to true").toHaveAttribute(
        "aria-expanded",
        "true",
      );

      const expanded = await readAccessibleName(page);
      expect(expanded.name, "expanded-state accessible name is still non-empty").toBeTruthy();
      expect(
        expanded.source,
        "accessible name source (aria-label / labelledby / text) does not change between states",
      ).toBe(collapsed.source);
      expect(
        expanded.name,
        "accessible name is identical collapsed vs expanded (only aria-expanded should flip)",
      ).toBe(collapsed.name);

      // Close so subsequent theme runs start from a clean state.
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu"), "menu closes on Escape").toHaveCount(0);

      observed[theme] = {
        collapsed: collapsed.name ?? "",
        expanded: expanded.name ?? "",
        source: collapsed.source,
      };
    });
  }

  test("accessible name and source match across light and dark themes", () => {
    // If either per-theme test above didn't run, these will be empty
    // strings and the equality check still catches the mismatch.
    expect(observed.light.collapsed, "light theme captured a name").toBeTruthy();
    expect(observed.dark.collapsed, "dark theme captured a name").toBeTruthy();

    expect(observed.dark.collapsed, "collapsed-state name is theme-independent").toBe(
      observed.light.collapsed,
    );
    expect(observed.dark.expanded, "expanded-state name is theme-independent").toBe(
      observed.light.expanded,
    );
    expect(observed.dark.source, "name resolution source is theme-independent").toBe(
      observed.light.source,
    );
  });
});
