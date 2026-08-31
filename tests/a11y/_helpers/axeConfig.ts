/**
 * Shared axe-core rules configuration for the /tests/a11y suite.
 *
 * Design goals
 * ------------
 * 1. **Whitelist, don't blacklist.** Every spec enables an explicit
 *    set of WCAG-relevant rule IDs (`ENFORCED_RULES`). If axe adds a
 *    new experimental rule, it does NOT start failing our CI until we
 *    consciously add it here. This keeps the signal:noise ratio high.
 *
 * 2. **False positives are per-node, not per-rule.** A rule like
 *    `color-contrast` is WCAG SC 1.4.3 — we never turn it off
 *    globally. Instead, individual DOM nodes that axe misjudges (e.g.
 *    a Radix portal ghost, a decorative gradient overlay, an SVG icon
 *    axe reads as text) are suppressed with a documented reason via
 *    `KNOWN_FALSE_POSITIVES`. Every entry MUST cite:
 *      • the rule ID
 *      • a stable CSS selector or html substring
 *      • why axe is wrong (contrast token proof, ARIA source, etc.)
 *      • the date and author who verified it
 *    Entries without a `reason` field fail the type contract.
 *
 * 3. **No project-wide disables.** `disableRules([...])` is not
 *    exported. If you find yourself wanting to silence a whole rule,
 *    add per-node exceptions instead and open a ticket.
 *
 * Usage
 * -----
 *   import { buildAxe, filterKnownFalsePositives } from './_helpers/axeConfig';
 *
 *   const raw = await buildAxe(page).analyze();
 *   const violations = filterKnownFalsePositives(raw.violations);
 *   expect(violations).toEqual([]);
 *
 * To scope a scan (e.g. an open dialog):
 *
 *   const raw = await buildAxe(page, { include: '[role="dialog"]' }).analyze();
 */

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import type { Result, NodeResult } from "axe-core";

// ---------------------------------------------------------------------------
// Enforced rules — the WCAG A/AA surface we test everywhere.
// ---------------------------------------------------------------------------
//
// Grouped for readable failure output. If you add a rule, add it to
// exactly one group and document why it's enforced.

export const ENFORCED_RULE_GROUPS = {
  // Accessible names on every interactive control and media element.
  labels: [
    "label",
    "button-name",
    "link-name",
    "input-button-name",
    "aria-input-field-name",
    "aria-required-attr",
    "aria-valid-attr",
    "aria-valid-attr-value",
    "image-alt",
    "label-title-only",
    "form-field-multiple-labels",
    "select-name",
  ],
  // Document / dialog structure.
  structure: [
    "page-has-heading-one",
    "heading-order",
    "empty-heading",
    "landmark-one-main",
    "aria-dialog-name",
    "aria-allowed-attr",
    "aria-required-children",
    "aria-required-parent",
    "duplicate-id-aria",
  ],
  // Keyboard operability.
  focus: [
    "tabindex",
    "focus-order-semantics",
    "aria-hidden-focus",
    "nested-interactive",
    "scrollable-region-focusable",
  ],
  // Perceivability.
  contrast: ["color-contrast"],
} as const;

export const ENFORCED_RULES: readonly string[] = Object.values(ENFORCED_RULE_GROUPS).flat();

// ---------------------------------------------------------------------------
// Known false positives — narrow, documented, dated.
// ---------------------------------------------------------------------------
//
// A node is suppressed when EVERY predicate on the entry matches:
//   • `rule`     — axe rule ID (required)
//   • `selector` — a CSS selector present in the node's `target` chain,
//                  OR
//     `htmlIncludes` — a substring present in the node's `html`
//                  (use when Radix portals give unstable selectors)
// At least one of `selector` / `htmlIncludes` MUST be set. A blanket
// rule-only entry is rejected below.

export type KnownFalsePositive = {
  rule: string;
  selector?: string;
  htmlIncludes?: string;
  /** Why axe is wrong here. Include the token/ratio/spec reference. */
  reason: string;
  /** ISO date the exception was verified. */
  verifiedOn: `${number}-${number}-${number}`;
  /** GitHub handle or initials of the reviewer. */
  verifiedBy: string;
};

export const KNOWN_FALSE_POSITIVES: readonly KnownFalsePositive[] = [
  // Example entry (kept live so the shape is self-documenting). Radix
  // Select's portalled ghost `SelectValue` text is measured by axe
  // before the popover animates in, when its background is temporarily
  // transparent. Real (post-animation) contrast is `--foreground` on
  // `--popover`, ~15:1 — verified in `theme-focus-visible-audit`.
  {
    rule: "color-contrast",
    htmlIncludes: "data-radix-select-viewport",
    reason:
      "Radix SelectContent measures during enter animation while bg is transparent; post-animation ratio is ~15:1 (--foreground on --popover). Confirmed in theme-focus-visible-audit.spec.ts.",
    verifiedOn: "2026-07-11",
    verifiedBy: "a11y-review",
  },
];

// Validate entries at module load — catch a blanket exception before
// it silences a real regression.
for (const fp of KNOWN_FALSE_POSITIVES) {
  if (!fp.selector && !fp.htmlIncludes) {
    throw new Error(
      `axeConfig: KNOWN_FALSE_POSITIVES entry for rule "${fp.rule}" must set selector or htmlIncludes — blanket rule disables are not allowed.`,
    );
  }
  if (!fp.reason || !fp.verifiedOn || !fp.verifiedBy) {
    throw new Error(
      `axeConfig: KNOWN_FALSE_POSITIVES entry for rule "${fp.rule}" is missing reason/verifiedOn/verifiedBy.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Builder + filter helpers.
// ---------------------------------------------------------------------------

export type BuildAxeOptions = {
  /** Optional CSS scope; forwarded to AxeBuilder.include(). */
  include?: string;
  /** Extra rules to enforce for this scan only (merged with ENFORCED_RULES). */
  extraRules?: readonly string[];
};

export function buildAxe(page: Page, opts: BuildAxeOptions = {}): AxeBuilder {
  const rules = Array.from(new Set([...ENFORCED_RULES, ...(opts.extraRules ?? [])]));
  let builder = new AxeBuilder({ page }).withRules(rules);
  if (opts.include) builder = builder.include(opts.include);
  return builder;
}

function nodeMatches(node: NodeResult, fp: KnownFalsePositive): boolean {
  if (fp.htmlIncludes && node.html && node.html.includes(fp.htmlIncludes)) return true;
  if (fp.selector) {
    // node.target is (string | string[])[] — flatten to compare.
    const flat = node.target.flat(Infinity as 1) as string[];
    if (flat.some((t) => typeof t === "string" && t.includes(fp.selector!))) return true;
  }
  return false;
}

export type FilterOutcome = {
  /** Violations that remain after suppressions. Assert against this. */
  violations: Result[];
  /** Suppressed node counts, keyed by rule ID — logged for visibility. */
  suppressed: Record<string, number>;
};

export function filterKnownFalsePositives(rawViolations: readonly Result[]): FilterOutcome {
  const suppressed: Record<string, number> = {};
  const violations: Result[] = [];

  for (const v of rawViolations) {
    const applicable = KNOWN_FALSE_POSITIVES.filter((fp) => fp.rule === v.id);
    if (applicable.length === 0) {
      violations.push(v);
      continue;
    }
    const kept = v.nodes.filter((n) => !applicable.some((fp) => nodeMatches(n, fp)));
    const removed = v.nodes.length - kept.length;
    if (removed > 0) {
      suppressed[v.id] = (suppressed[v.id] ?? 0) + removed;
    }
    if (kept.length > 0) {
      violations.push({ ...v, nodes: kept });
    }
  }

  return { violations, suppressed };
}
