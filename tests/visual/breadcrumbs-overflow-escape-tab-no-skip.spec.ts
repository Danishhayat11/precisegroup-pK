import { expect, test } from "./_overflowDebugFixture";
import type { Page } from "@playwright/test";
import { openMenu } from "./_radixDropdownMenu";

/**
 * Breadcrumbs — after Escape closes the overflow menu, pressing Tab
 * advances focus by EXACTLY ONE step in the document's tab order.
 * No element is skipped, no element is repeated, focus does not
 * jump two-or-more slots ahead (a common Radix regression when the
 * portal's focus scope sentinel is left tabbable in the DOM after
 * teardown).
 *
 * How this differs from `breadcrumbs-overflow-tab-after-escape`:
 *   - That spec asserts "Tab lands on the expected next element".
 *   - This spec asserts "Tab lands on the element at index N+1 of the
 *     full ordered tabbable list, and subsequent Tabs continue to
 *     N+2, N+3 — no gaps". It locks the *sequence*, not just the
 *     first hop.
 *
 * Contract:
 *   1. Snapshot the ordered tabbable list BEFORE opening the menu.
 *   2. Locate the trigger's index N in that list.
 *   3. Open the menu (Space), move into the menu (ArrowDown twice),
 *      Escape. Focus returns to the trigger.
 *   4. Re-snapshot the tabbable list — it must be byte-identical to
 *      the pre-open snapshot (no stale portal wrappers left behind).
 *   5. Tab → element N+1. Tab → N+2. Tab → N+3. Each step advances
 *      by one, with no menuitem role and no repeat of the trigger.
 *   6. Runs in light + dark.
 */

const THEMES = ["light", "dark"] as const;
const FIXTURE_URL = "/crumb-fixture/alpha/beta/gamma/delta/epsilon";
const MAX_FORWARD_STEPS = 3;

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

type TabbableDescriptor = {
  tag: string;
  role: string | null;
  label: string;
  href: string | null;
  key: string;
};

/**
 * Snapshot the ordered list of tabbable elements. Mirrors the browser's
 * sequential focus navigation: visible, not `inert`, not `disabled`,
 * `tabindex >= 0`, sorted by DOM order.
 */
async function snapshotTabbables(page: Page): Promise<TabbableDescriptor[]> {
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
      if (el.closest("[inert]")) return false;
      const ti = el.tabIndex;
      if (ti < 0) return false;
      return isVisible(el);
    };
    const all = Array.from(
      document.querySelectorAll<HTMLElement>(
        "a[href], button, input, select, textarea, [tabindex]",
      ),
    ).filter(isTabbable);
    all.sort((a, b) => {
      if (a === b) return 0;
      const rel = a.compareDocumentPosition(b);
      return rel & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    return all.map((el) => {
      const label =
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        (el.textContent ?? "").trim().slice(0, 60);
      const tag = el.tagName;
      const role = el.getAttribute("role");
      const href = el.getAttribute("href");
      // Stable identity for equality checks across snapshots.
      const key = `${tag}::${role ?? ""}::${href ?? ""}::${label}`;
      return { tag, role, label, href, key };
    });
  });
}

async function readActive(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) {
      return { tag: "BODY", role: null, label: "", href: null, key: "BODY", isBody: true };
    }
    const label =
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      (el.textContent ?? "").trim().slice(0, 60);
    const tag = el.tagName;
    const role = el.getAttribute("role");
    const href = el.getAttribute("href");
    return {
      tag,
      role,
      label,
      href,
      key: `${tag}::${role ?? ""}::${href ?? ""}::${label}`,
      isBody: false,
    };
  });
}

test.describe("Breadcrumbs overflow · Escape → Tab advances by exactly one, no skips", () => {
  for (const theme of THEMES) {
    test(`${theme} · Tab after Escape steps through the tab order without gaps`, async ({
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

      // ── Snapshot pre-open tab order ─────────────────────────────
      const preOpen = await snapshotTabbables(page);
      const triggerKey = (await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>(
          'nav[aria-label="Breadcrumb"] button[aria-label*="hidden breadcrumb" i]',
        );
        if (!el) return null;
        const label =
          el.getAttribute("aria-label") ||
          el.getAttribute("title") ||
          (el.textContent ?? "").trim().slice(0, 60);
        return `${el.tagName}::${el.getAttribute("role") ?? ""}::${el.getAttribute("href") ?? ""}::${label}`;
      }))!;
      const triggerIdx = preOpen.findIndex((t) => t.key === triggerKey);
      expect(triggerIdx, `[${theme}] trigger is in the tab order`).toBeGreaterThanOrEqual(0);
      const tabbablesAfterTrigger = preOpen.length - triggerIdx - 1;
      expect(
        tabbablesAfterTrigger,
        `[${theme}] at least one tabbable follows the trigger`,
      ).toBeGreaterThanOrEqual(1);
      const forwardSteps = Math.min(MAX_FORWARD_STEPS, tabbablesAfterTrigger);

      // ── Open menu, move within, Escape ─────────────────────────
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

      const afterEscape = await readActive(page);
      expect(afterEscape.isBody, `[${theme}] focus not on <body> after Escape`).toBe(false);
      expect(afterEscape.key, `[${theme}] focus restored to trigger`).toBe(triggerKey);

      // ── Post-Escape snapshot must equal pre-open snapshot ──────
      const postEscape = await snapshotTabbables(page);
      expect(
        postEscape.map((t) => t.key),
        `[${theme}] no stale portal tabbables left after menu teardown`,
      ).toEqual(preOpen.map((t) => t.key));

      // ── Tab N times; each hop = index+1, no skips, no repeats ──
      const visited: string[] = [];
      for (let step = 1; step <= forwardSteps; step++) {
        await page.keyboard.press("Tab");
        await page.waitForTimeout(50);
        const active = await readActive(page);

        expect(active.isBody, `[${theme}] step ${step} did not fall to <body>`).toBe(false);
        expect(active.role, `[${theme}] step ${step} not inside a stale menu`).not.toBe("menuitem");
        expect(active.key, `[${theme}] step ${step} moved off the trigger`).not.toBe(triggerKey);
        expect(
          visited.includes(active.key),
          `[${theme}] step ${step} did not revisit an earlier element`,
        ).toBe(false);

        const expected = preOpen[triggerIdx + step];
        expect(
          active.key,
          `[${theme}] step ${step} landed on index ${triggerIdx + step} with no skip`,
        ).toBe(expected.key);

        visited.push(active.key);
      }
    });
  }
});
