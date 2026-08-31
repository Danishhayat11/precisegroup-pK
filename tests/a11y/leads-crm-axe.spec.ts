import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { authAvailable, restoreSupabaseSession } from "../visual/_authHelpers";
import { seedLeadsCrm } from "./_helpers/seedLeadsCrm";

/**
 * LeadsCRM — automated axe-core + tap-target regression scan.
 *
 * Why this file exists
 * --------------------
 * LeadsCRM has two rendering modes (Kanban board + Table) and dense
 * per-row action rows (Call · WhatsApp · Edit · Delete · Stage Select ·
 * Convert). A11y regressions here — an unlabeled icon button, a
 * shrunken tap target, a low-contrast badge — historically slip past
 * `app-axe.spec.ts` because that spec doesn't visit /leads.
 *
 * This spec locks in the WCAG guarantees the ongoing a11y pass has
 * established for the Leads pipeline:
 *
 *   1. **Labels / headings / focus** — same rule bundle as
 *      `app-axe.spec.ts`, applied on both Kanban and Table views in
 *      both themes.
 *   2. **Color contrast** — `color-contrast` is added here (not in
 *      the app-shell spec) because Kanban stage badges and status
 *      chips use small text that regressions can push below AA.
 *   3. **Tap targets ≥ 44×44 CSS px on mobile** — every rendered
 *      <button> and role="button" element on the mobile viewport
 *      must meet WCAG 2.5.5 Target Size. Static source is scanned
 *      by `scripts/ci/tap-target-audit.mjs`; this runtime check
 *      catches regressions the static scanner can't see (dynamic
 *      classes, computed size from parent flex/grid, etc.).
 *
 * Auth handling mirrors app-axe.spec.ts — skip loudly when no
 * Supabase session was injected rather than pass a false green.
 */

const VIEWS = [
  { param: "", label: "Kanban view" },
  { param: "?view=table", label: "Table view" },
] as const;

const THEMES = ["light", "dark"] as const;

const ENFORCED_RULES = {
  labels: [
    "label",
    "button-name",
    "link-name",
    "input-button-name",
    "aria-input-field-name",
    "image-alt",
    "label-title-only",
    "form-field-multiple-labels",
  ],
  headings: ["page-has-heading-one", "heading-order", "empty-heading"],
  focus: ["tabindex", "focus-order-semantics", "aria-hidden-focus", "nested-interactive"],
  contrast: ["color-contrast"],
} as const;

const ALL_ENFORCED = [
  ...ENFORCED_RULES.labels,
  ...ENFORCED_RULES.headings,
  ...ENFORCED_RULES.focus,
  ...ENFORCED_RULES.contrast,
];

// WCAG 2.5.5 (AAA) / 2.5.8 (AA target size minimum).
// Radix Popover/Tooltip triggers reuse the tap target; we allow a
// small floor to avoid flagging elements that intentionally live
// inside a larger 44×44 hit-slop wrapper (e.g. `size="icon"` inside
// a header).
const MIN_TAP_PX = 44;

test.describe("LeadsCRM — axe a11y + tap-target regressions", () => {
  // Auto-seed one lead per stage into the caller's tenant so /leads
  // actually renders <LeadCard>s + stage Selects + badges — otherwise
  // a clean CI environment loads the empty state and the axe /
  // tap-target checks pass vacuously. Seeding runs once per worker;
  // cleanup deletes exactly the rows we inserted (RLS-scoped by user).
  let cleanupSeed: (() => Promise<void>) | null = null;
  test.beforeAll(async ({}, testInfo) => {
    if (!authAvailable()) return; // matches the per-test skip below
    cleanupSeed = await seedLeadsCrm({ workerIndex: testInfo.workerIndex });
  });
  test.afterAll(async () => {
    await cleanupSeed?.();
    cleanupSeed = null;
  });

  test.beforeEach(async ({ context, page }) => {
    test.skip(
      !authAvailable(),
      'Skipped: LOVABLE_BROWSER_AUTH_STATUS is not "injected". Sign in via the Lovable preview so /leads renders.',
    );
    await restoreSupabaseSession(context, page);
  });

  for (const view of VIEWS) {
    for (const theme of THEMES) {
      test(`${view.label} (${theme}) — no axe violations`, async ({ page }, testInfo) => {
        await page.addInitScript((t) => {
          try {
            localStorage.setItem("precise.theme", t);
          } catch {
            /* noop */
          }
          const root = document.documentElement;
          root.classList.toggle("dark", t === "dark");
          root.classList.toggle("light", t === "light");
          root.style.colorScheme = t;
        }, theme);

        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });

        await page.goto(`/leads${view.param}`, { waitUntil: "domcontentloaded" });
        await page.evaluate(() => document.fonts?.ready);
        await page.waitForTimeout(750);

        if (page.url().includes("/auth") || page.url().includes("/login")) {
          throw new Error(
            `Expected /leads but got ${page.url()} — auth gate rejected the injected session.`,
          );
        }

        const results = await new AxeBuilder({ page }).withRules(ALL_ENFORCED).analyze();

        const violations = results.violations;
        if (violations.length === 0) {
          expect(violations).toEqual([]);
          return;
        }

        const byCategory: Record<string, typeof violations> = {
          labels: [],
          headings: [],
          focus: [],
          contrast: [],
        };
        for (const v of violations) {
          if ((ENFORCED_RULES.labels as readonly string[]).includes(v.id))
            byCategory.labels.push(v);
          else if ((ENFORCED_RULES.headings as readonly string[]).includes(v.id))
            byCategory.headings.push(v);
          else if ((ENFORCED_RULES.focus as readonly string[]).includes(v.id))
            byCategory.focus.push(v);
          else if ((ENFORCED_RULES.contrast as readonly string[]).includes(v.id))
            byCategory.contrast.push(v);
        }

        // Attach a screenshot + outerHTML of the first failing node for
        // every contrast violation. Contrast regressions are visual by
        // nature — the failureSummary text alone ("Element has
        // insufficient color contrast of 3.24") doesn't tell a reviewer
        // *which pixel of which badge* is bad. Attachments do.
        for (const v of byCategory.contrast) {
          const node = v.nodes[0];
          if (!node) continue;
          const selector = node.target.map(String).join(" ");
          await attachFailingNode(page, testInfo, `contrast-${v.id}`, selector, node.html);
        }

        const sections: string[] = [];
        for (const [cat, items] of Object.entries(byCategory)) {
          if (items.length === 0) continue;
          sections.push(`  ── ${cat.toUpperCase()} (${items.length}) ──`);
          for (const v of items) {
            const nodes = v.nodes
              .slice(0, 5)
              .map(
                (n) =>
                  `      · ${n.target.join(" ")}${n.failureSummary ? `\n        ${n.failureSummary.replace(/\n/g, "\n        ")}` : ""}`,
              )
              .join("\n");
            sections.push(
              `  · [${v.impact ?? "n/a"}] ${v.id} — ${v.help}\n    ${v.helpUrl}\n${nodes}`,
            );
          }
        }

        throw new Error(
          `${violations.length} axe violation(s) on /leads${view.param} (${theme}):\n${sections.join("\n")}`,
        );
      });
    }
  }

  test("Kanban view (mobile) — every interactive control meets 44×44 tap target", async ({
    page,
  }, testInfo) => {
    // WCAG 2.5.5 runtime enforcement. The static scanner catches
    // literal class regressions like `h-8 w-8`; this catches sizes
    // that only appear after layout (e.g. flex-1 children, computed
    // padding, Radix portalled triggers).
    await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/leads", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(750);

    if (page.url().includes("/auth") || page.url().includes("/login")) {
      throw new Error(`Expected /leads but got ${page.url()} — auth gate rejected the session.`);
    }

    type SmallTarget = {
      selector: string;
      width: number;
      height: number;
      label: string;
      outerHTML: string;
    };

    // Mark the *first* undersized element with a stable data-attribute
    // in the same pass we collect measurements, so the outer test can
    // screenshot it via a unique selector without racing hover / focus
    // state changes.
    const undersized: SmallTarget[] = await page.evaluate((minPx) => {
      const results: SmallTarget[] = [];
      let marked = false;
      const interactive = document.querySelectorAll<HTMLElement>(
        'button, [role="button"], a[href], [role="link"], [role="menuitem"], [role="tab"], [role="option"]',
      );
      for (const el of Array.from(interactive)) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const style = window.getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") continue;
        if (el.closest('[hidden], [aria-hidden="true"]')) continue;

        if (rect.width < minPx || rect.height < minPx) {
          const cls = (el.className || "")
            .toString()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 3)
            .join(".");
          const tag = el.tagName.toLowerCase();
          const label =
            el.getAttribute("aria-label") ??
            el.getAttribute("title") ??
            el.textContent?.trim().slice(0, 40) ??
            "(no label)";
          if (!marked) {
            el.setAttribute("data-a11y-tap-fail", "1");
            marked = true;
          }
          results.push({
            selector: cls ? `${tag}.${cls}` : tag,
            width: Math.round(rect.width * 10) / 10,
            height: Math.round(rect.height * 10) / 10,
            label,
            outerHTML: el.outerHTML,
          });
        }
      }
      return results;
    }, MIN_TAP_PX);

    if (undersized.length > 0) {
      // Screenshot + HTML of the first offender, plus a viewport-scoped
      // page screenshot so reviewers can see the surrounding layout that
      // shrank the target.
      await attachFailingNode(
        page,
        testInfo,
        "first-undersized-tap-target",
        '[data-a11y-tap-fail="1"]',
        undersized[0].outerHTML,
      );
      const viewportShot = await page.screenshot().catch(() => null);
      if (viewportShot) {
        await testInfo.attach("viewport-when-tap-target-failed.png", {
          body: viewportShot,
          contentType: "image/png",
        });
      }

      const lines = undersized
        .map((t) => `  · ${t.width}×${t.height}px — "${t.label}" — ${t.selector}`)
        .join("\n");
      throw new Error(
        `${undersized.length} interactive control(s) on /leads (mobile 390×844) are smaller than ${MIN_TAP_PX}×${MIN_TAP_PX}px (WCAG 2.5.5):\n${lines}`,
      );
    }
    expect(undersized).toEqual([]);
  });
});

/**
 * Attach a screenshot + HTML snapshot of a single failing DOM node to
 * the current test. Used for contrast + tap-target failures where the
 * visual evidence is the fastest path to a fix. Swallows its own
 * errors — a diagnostic helper must never mask the real assertion.
 */
async function attachFailingNode(
  page: import("@playwright/test").Page,
  testInfo: import("@playwright/test").TestInfo,
  name: string,
  selector: string,
  fallbackHtml?: string,
) {
  try {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (count > 0) {
      const shot = await locator.screenshot({ timeout: 2000 }).catch(() => null);
      if (shot) {
        await testInfo.attach(`${name}.png`, { body: shot, contentType: "image/png" });
      }
      const html = await locator.evaluate((el) => (el as HTMLElement).outerHTML).catch(() => null);
      if (html) {
        await testInfo.attach(`${name}.html`, { body: html, contentType: "text/html" });
        return;
      }
    }
    if (fallbackHtml) {
      await testInfo.attach(`${name}.html`, { body: fallbackHtml, contentType: "text/html" });
    }
  } catch {
    /* diagnostic-only; ignore */
  }
}
