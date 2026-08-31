import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * /site marketing — automated axe-core accessibility scan.
 *
 * Runs axe against every marketing route in both light and dark themes.
 * Enforces WCAG 2.1 A + AA + best-practice rules with a specific focus on
 * the three families the design pass touched:
 *
 *   · focus-visible / interactive keyboard reachability
 *   · color-contrast (text + non-text UI)
 *   · landmark structure (single <main>, unique landmark names)
 *
 * Fails the run on ANY violation in those tag sets. Prints the offending
 * rule id, help URL, and up to 5 node targets so fixes are grep-able.
 */

const ROUTES = ["/site", "/site/services", "/site/projects", "/site/contact"] as const;
const THEMES = ["light", "dark"] as const;

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

for (const route of ROUTES) {
  for (const theme of THEMES) {
    test(`axe: no a11y violations on ${route} (${theme})`, async ({ page }) => {
      await page.goto(route, { waitUntil: "networkidle" });
      await page.evaluate((t) => {
        try {
          localStorage.setItem("theme", t);
        } catch {
          /* noop */
        }
        const root = document.documentElement;
        root.classList.toggle("dark", t === "dark");
        root.classList.toggle("light", t === "light");
      }, theme);
      await page.waitForTimeout(250);

      const results = await new AxeBuilder({ page })
        .withTags(AXE_TAGS)
        // Disable rules that don't apply to a marketing single-page render:
        //  · region: flagged by axe when non-landmark text sits outside a
        //    landmark; the marketing shell already wraps content in <main>
        //    and the header/footer are <header>/<footer> landmarks.
        //    Keeping it ON would false-positive on <Toaster /> portal roots.
        .disableRules([])
        .analyze();

      const violations = results.violations;
      if (violations.length > 0) {
        const summary = violations
          .map((v) => {
            const nodes = v.nodes
              .slice(0, 5)
              .map((n) => `      target: ${n.target.join(" ")}`)
              .join("\n");
            return `  · [${v.impact ?? "n/a"}] ${v.id} — ${v.help}\n    ${v.helpUrl}\n${nodes}`;
          })
          .join("\n");
        throw new Error(
          `${violations.length} axe violation(s) on ${route} (${theme}):\n${summary}`,
        );
      }
      expect(violations).toEqual([]);
    });
  }
}
