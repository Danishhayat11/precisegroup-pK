import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — after Escape closes the overflow menu, pressing Tab
 * continues the natural tab order from the trigger (not from <body>,
 * not from the last highlighted menuitem, not from the crumb list).
 *
 * Distinct from the Tab-exit spec, which drives Tab while the menu is
 * OPEN. This spec locks the post-Escape resumption: the menu is fully
 * closed, focus has been restored to the trigger, and the user's very
 * next Tab must land on whatever tabbable element sits *after* the
 * trigger in DOM order — same as if the menu had never opened.
 *
 * Contract:
 *   1. Compute the expected "next after trigger" element BEFORE the
 *      menu ever opens, using the DOM's tab-order semantics
 *      (visible + non-negative tabindex + inert-aware).
 *   2. Open the menu via Space, arrow down into a non-initial row,
 *      then Escape. Menu tears down; focus returns to the trigger.
 *   3. Press Tab exactly once. Focus must land on the pre-computed
 *      "next tabbable" — proving the Escape close did not corrupt the
 *      tab sequence (a common Radix regression is leaving the portal's
 *      focus scope wrapper hidden but still tabbable).
 *   4. Shift+Tab from that landing spot must return focus to the
 *      trigger — bidirectional order is intact.
 *   5. Runs in light + dark since focus rings and portal wrappers
 *      differ by theme in this app.
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
    if (root) {
      root.classList.toggle("dark", t === "dark");
      root.style.colorScheme = t;
    }
  }, theme);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
}

/**
 * Compute the element that should receive focus when Tab is pressed
 * from the trigger. We reproduce the "sequential focus navigation"
 * heuristic in the page so the test matches what the browser will
 * actually do: visible, not `inert`, not `disabled`, and either a
 * naturally focusable element or `tabindex >= 0`.
 */
async function computeNextTabbableAfterTrigger(page: Page) {
  return page.evaluate(() => {
    const isVisible = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      const cs = window.getComputedStyle(el);
      return cs.visibility !== "hidden" && cs.display !== "none";
    };
    const isTabbable = (el: HTMLElement) => {
      if ((el as HTMLButtonElement).disabled) return false;
      if (el.getAttribute("aria-hidden") === "true") return false;
      // Respect the `inert` attribute (present on ancestors of closed dialogs).
      if (el.closest("[inert]")) return false;
      const ti = el.tabIndex;
      if (ti < 0) return false;
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
    // Sort by DOM order using compareDocumentPosition.
    all.sort((a, b) => {
      if (a === b) return 0;
      const rel = a.compareDocumentPosition(b);
      return rel & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    const idx = all.indexOf(trigger);
    if (idx === -1 || idx === all.length - 1) return null;
    const next = all[idx + 1];
    return {
      tag: next.tagName,
      role: next.getAttribute("role"),
      label:
        next.getAttribute("aria-label") ||
        next.getAttribute("title") ||
        (next.textContent ?? "").trim().slice(0, 60),
      href: next.getAttribute("href"),
    };
  });
}

/** Describe the currently focused element in a form we can assert on. */
async function readActive(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) {
      return { tag: "BODY", role: null, label: null, href: null, isBody: true };
    }
    return {
      tag: el.tagName,
      role: el.getAttribute("role"),
      label:
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        (el.textContent ?? "").trim().slice(0, 60),
      href: el.getAttribute("href"),
      isBody: false,
    };
  });
}

test.describe("Breadcrumbs overflow · Tab after Escape resumes the natural tab order", () => {
  for (const theme of THEMES) {
    test(`${theme} · Tab after Escape lands on the next tabbable after the trigger`, async ({
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

      // ── Baseline: what SHOULD receive focus on Tab from the trigger ──
      const expectedNext = await computeNextTabbableAfterTrigger(page);
      expect(expectedNext, `[${theme}] a next tabbable exists after the trigger`).not.toBeNull();

      // ── Open menu, arrow to a non-initial row, close with Escape ──
      await trigger.focus();
      const menu = await openMenu(page, trigger, { activation: "Space", label: "overflow menu" });
      await expect(menu, `[${theme}] menu open`).toBeVisible();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu"), `[${theme}] menu unmounted`).toHaveCount(0);
      await expect(trigger, `[${theme}] aria-expanded=false`).toHaveAttribute(
        "aria-expanded",
        "false",
      );

      // Focus must be back on the trigger before we Tab off it.
      const afterEscape = await readActive(page);
      expect(afterEscape.isBody, `[${theme}] post-Escape focus not <body>`).toBe(false);
      expect(afterEscape.label, `[${theme}] post-Escape focus on trigger`).toMatch(
        /hidden breadcrumb/i,
      );

      // ── Tab once → next tabbable ──────────────────────────────
      await page.keyboard.press("Tab");
      // Give the browser a beat to move focus.
      await page.waitForTimeout(50);

      const afterTab = await readActive(page);
      expect(afterTab.isBody, `[${theme}] Tab after Escape did not fall through to <body>`).toBe(
        false,
      );

      // The landed element must NOT be a menuitem — the menu is gone.
      expect(afterTab.role, `[${theme}] Tab did not land inside a stale menu`).not.toBe("menuitem");
      // And it must NOT be the trigger itself — Tab must have advanced.
      expect(
        /hidden breadcrumb/i.test(afterTab.label ?? ""),
        `[${theme}] Tab moved off the trigger`,
      ).toBe(false);

      // Match against the pre-computed expected next tabbable. Compare
      // by tag + (href OR label) so a stable identity is checked without
      // hard-coding the specific next element (which can change as the
      // page evolves).
      expect(afterTab.tag, `[${theme}] Tab landed on the expected tag`).toBe(expectedNext!.tag);
      if (expectedNext!.href) {
        expect(afterTab.href, `[${theme}] Tab landed on the expected href`).toBe(
          expectedNext!.href,
        );
      } else {
        expect(afterTab.label, `[${theme}] Tab landed on the expected label`).toBe(
          expectedNext!.label,
        );
      }

      // ── Shift+Tab → trigger again (bidirectional order intact) ──
      await page.keyboard.press("Shift+Tab");
      await page.waitForTimeout(50);
      const afterShiftTab = await readActive(page);
      expect(afterShiftTab.label, `[${theme}] Shift+Tab returns focus to the trigger`).toMatch(
        /hidden breadcrumb/i,
      );
    });
  }
});
