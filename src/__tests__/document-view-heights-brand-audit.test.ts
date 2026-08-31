import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Automated audit: every exported/printable document type in DocumentView.tsx
 * must brand as "Manal Heights" with email "manalheights@gmail.com" whenever
 * the booking is a Heights booking.
 *
 * Every doc renderer funnels branding through a single helper —
 * `projectInfo(booking)` — so this test proves two things statically:
 *
 *   1. Every case in `renderDocBody`'s switch is a real, known doc type
 *      (fails loudly if a new doc type is added without covering it here).
 *   2. Every one of those doc components calls `projectInfo(booking)` in its
 *      body — so brand + email are guaranteed to come from the audited helper
 *      rather than a hardcoded literal.
 *   3. `projectInfo`'s isHeights branch returns "Manal Heights" for `name`
 *      and "manalheights@gmail.com" for `email`.
 */

const SOURCE = readFileSync(resolve(__dirname, "../pages/DocumentView.tsx"), "utf8");

// Doc slug → component name pairs, mirrored from `renderDocBody` router.
const DOC_TYPES: Array<{ slug: string; component: string }> = [
  { slug: "receipt", component: "ReceiptDoc" },
  { slug: "payment-plan", component: "PaymentPlanDoc" },
  { slug: "allotment", component: "AllotmentDoc" },
  { slug: "possession", component: "PossessionDoc" },
  { slug: "prov-possession", component: "ProvPossessionDoc" },
  { slug: "deposit-summary", component: "DepositSummaryDoc" },
  { slug: "demand-notice", component: "DemandNoticeDoc" },
  { slug: "transfer-form", component: "TransferFormDoc" },
  { slug: "sale-agreement", component: "SaleAgreementDoc" },
  { slug: "legal-notice", component: "LegalShowCauseDoc" },
  { slug: "final-legal-notice", component: "FinalLegalNoticeDoc" },
  { slug: "final-cancel-warning", component: "FinalCancelWarningDoc" },
  { slug: "cancellation-notice", component: "CancellationNoticeDoc" },
];

describe("DocumentView.tsx — Manal Heights brand + email audit", () => {
  it("`projectInfo` Heights branch returns 'Manal Heights' + 'manalheights@gmail.com'", () => {
    // Anchor on the projectInfo helper, then verify both required literals
    // sit inside its return object.
    const fnMatch = SOURCE.match(/function projectInfo\(booking: any\) \{[\s\S]*?\n\}/);
    expect(fnMatch, "projectInfo helper not found").toBeTruthy();
    const body = fnMatch![0];

    expect(body).toMatch(/isHeights\s*\?\s*"Manal Heights"\s*:/);
    expect(body).toMatch(/isHeights\s*\?\s*"MANAL HEIGHTS"\s*:/);
    expect(body).toMatch(/email:\s*isHeights\s*\?\s*"manalheights@gmail\.com"\s*:/);
    expect(body).toMatch(/isHeights\s*\?\s*"Manal Heights, B-17 Multi Gardens, Islamabad"/);
  });

  it("`renderDocBody` router covers every audited doc type (no unknown slugs)", () => {
    const routerMatch = SOURCE.match(/function renderDocBody\(args: any\) \{[\s\S]*?\n\}/);
    expect(routerMatch).toBeTruthy();
    const router = routerMatch![0];
    for (const { slug, component } of DOC_TYPES) {
      expect(router, `renderDocBody missing "${slug}" → <${component} />`).toMatch(
        new RegExp(`case "${slug}":[^\\n]*<${component}\\b`),
      );
    }
  });

  it.each(DOC_TYPES)(
    "$component ($slug) resolves branding via projectInfo(booking)",
    ({ component }) => {
      const fnRegex = new RegExp(`function ${component}\\([^)]*\\)[^{]*\\{[\\s\\S]*?\\n\\}\\n`);
      const match = SOURCE.match(fnRegex);
      expect(match, `${component} definition not found in DocumentView.tsx`).toBeTruthy();
      const body = match![0];
      expect(
        body,
        `${component} must derive branding from projectInfo(booking) — ` +
          `otherwise it can drift from the Manal Heights display name/email.`,
      ).toMatch(/projectInfo\(\s*booking\s*\)/);
    },
  );

  it("has no stray hardcoded Manal-Heights-context email that skips projectInfo", () => {
    // Any occurrence of the Heights email OUTSIDE the projectInfo helper must
    // be inside a template expression that reads from `proj.email` (the value
    // returned by projectInfo). Direct literals elsewhere would silently
    // bypass the audit surface.
    const outsideHelper = SOURCE.replace(/function projectInfo\(booking: any\) \{[\s\S]*?\n\}/, "");
    const strayLiterals = outsideHelper.match(/"manalheights@gmail\.com"/g) ?? [];
    expect(
      strayLiterals,
      "manalheights@gmail.com must only appear inside projectInfo — " +
        "other occurrences bypass the branding audit.",
    ).toEqual([]);
  });
});
