import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { authAvailable, restoreSupabaseSession } from "../visual/_authHelpers";

/**
 * App shell — automated axe-core regression scan for authenticated key routes.
 *
 * Why this file exists
 * --------------------
 * `tests/a11y/site-axe.spec.ts` already covers the public `/site/*` marketing
 * pages. This spec extends the same rigor to the *authenticated* app shell —
 * the surfaces that carry real financial data and that most a11y regressions
 * ship into unnoticed because contributors rarely tab through them.
 *
 * Coverage strategy
 * -----------------
 * Rather than run every WCAG rule (which would flood the report with noise
 * from third-party portals like Radix Toaster before they mount), we scope
 * the scan to the three categories the ongoing a11y pass keeps regressing:
 *
 *   1. **Labels** — every form field / icon-only button / link must have an
 *      accessible name. Rules: `label`, `button-name`, `link-name`,
 *      `input-button-name`, `aria-input-field-name`, `image-alt`.
 *   2. **Heading structure** — exactly one <h1>, no skipped levels, no
 *      empty headings. Rules: `page-has-heading-one`, `heading-order`,
 *      `empty-heading`.
 *   3. **Focus-ring / keyboard reachability** — everything with `tabindex`
 *      or a keyboard handler must be discoverable. Rules: `tabindex`,
 *      `focus-order-semantics`, `aria-hidden-focus`, `nested-interactive`.
 *
 * Axe cannot directly measure "is the :focus-visible ring visually
 * apparent?" — that's what `tests/visual/*-focus-*` specs cover with
 * pixel-diff snapshots. What axe *can* catch is the structural failures
 * that make focus rings meaningless (tabindex=""-2", aria-hidden on the
 * currently-focused element, nested buttons stealing focus, etc.).
 *
 * Auth handling
 * -------------
 * These routes require a Supabase session. When the sandbox has not
 * injected one (external / signed-out project), the whole suite skips
 * with a clear message — never with a false red.
 */

const KEY_ROUTES = [
  { path: "/", label: "Dashboard" },
  { path: "/bookings", label: "Bookings list" },
  { path: "/payments", label: "Payments list" },
  { path: "/ledger", label: "Ledger" },
  { path: "/documents", label: "Documents index" },
  { path: "/settings", label: "Settings" },
] as const;

const THEMES = ["light", "dark"] as const;

/**
 * The rules we enforce, grouped by category so failures print with useful
 * context. Extending this list is how the a11y pass gets ratcheted — add
 * a rule id here, then fix every offender it flags.
 */
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
} as const;

const ALL_ENFORCED = [
  ...ENFORCED_RULES.labels,
  ...ENFORCED_RULES.headings,
  ...ENFORCED_RULES.focus,
];

test.describe("App shell — axe a11y regressions on authenticated routes", () => {
  test.beforeEach(async ({ context, page }) => {
    test.skip(
      !authAvailable(),
      'Skipped: LOVABLE_BROWSER_AUTH_STATUS is not "injected". Run this project against a Lovable-managed Supabase session (or manually sign in via the preview) so authenticated routes render.',
    );
    await restoreSupabaseSession(context, page);
  });

  for (const route of KEY_ROUTES) {
    for (const theme of THEMES) {
      test(`${route.label} (${theme}) — no label/heading/focus violations`, async ({ page }) => {
        // Force the theme BEFORE navigation so first paint matches the
        // theme axe is about to scan. This avoids a class-swap flash
        // that could momentarily produce contrast/landmark deltas.
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

        // `domcontentloaded` — the app has long-lived Supabase realtime
        // subscriptions that never idle, so `networkidle` would time out.
        await page.goto(route.path, { waitUntil: "domcontentloaded" });

        // Give the auth gate + skeletons + first data batch time to
        // hydrate. Axe scans the rendered DOM, so scanning too early
        // produces false "empty heading" hits on skeleton placeholders.
        await page.waitForLoadState("domcontentloaded");
        await page.evaluate(() => document.fonts?.ready);
        await page.waitForTimeout(750);

        // Fail loud if the auth gate bounced us out — surfaces a real
        // problem (bad session, cookie mismatch) instead of a green pass
        // against the login page.
        if (page.url().includes("/auth") || page.url().includes("/login")) {
          throw new Error(
            `Expected to land on ${route.path} but got ${page.url()} — auth gate rejected the injected session. Skipping axe scan.`,
          );
        }

        const results = await new AxeBuilder({ page })
          // Only run our enforced rule ids. Passing rules explicitly (via
          // `withRules`) rather than tags + disable-list keeps the scan
          // deterministic across axe minor versions that ship new rules.
          .withRules(ALL_ENFORCED)
          .analyze();

        const violations = results.violations;
        if (violations.length === 0) {
          expect(violations).toEqual([]);
          return;
        }

        // Group violations by category for a scannable failure message.
        const byCategory: Record<string, typeof violations> = {
          labels: [],
          headings: [],
          focus: [],
        };
        for (const v of violations) {
          if ((ENFORCED_RULES.labels as readonly string[]).includes(v.id))
            byCategory.labels.push(v);
          else if ((ENFORCED_RULES.headings as readonly string[]).includes(v.id))
            byCategory.headings.push(v);
          else if ((ENFORCED_RULES.focus as readonly string[]).includes(v.id))
            byCategory.focus.push(v);
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
          `${violations.length} axe violation(s) on ${route.path} (${theme}):\n${sections.join("\n")}`,
        );
      });
    }
  }
});
