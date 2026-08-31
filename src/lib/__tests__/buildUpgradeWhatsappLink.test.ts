/**
 * Contract test for the WhatsApp upgrade-link builder.
 *
 * The prefilled message body is our only signal on the receiving end
 * about which gated click drove the conversation — so the shape below
 * is asserted verbatim.
 */
import { describe, it, expect } from "vitest";
import { buildUpgradeWhatsappLink, featureForPath, FEATURES, UPGRADE_WHATSAPP } from "@/lib/plans";

const DIGITS = UPGRADE_WHATSAPP.replace(/[^\d]/g, "");

function decodedTextOf(href: string): string {
  const url = new URL(href);
  const text = url.searchParams.get("text");
  expect(text, "wa.me link missing ?text= param").toBeTruthy();
  return decodeURIComponent(text!);
}

describe("buildUpgradeWhatsappLink", () => {
  it("targets the canonical wa.me number", () => {
    const href = buildUpgradeWhatsappLink(FEATURES.crm);
    const url = new URL(href);
    expect(url.origin + url.pathname).toBe(`https://wa.me/${DIGITS}`);
  });

  it("includes feature label, required plan, and current plan in the body", () => {
    const href = buildUpgradeWhatsappLink(FEATURES.crm, {
      currentPlan: "starter",
      companyName: "Acme Builders",
    });
    const body = decodedTextOf(href);
    expect(body).toContain("upgrade to the Builder plan");
    expect(body).toContain("Feature: Leads & CRM");
    expect(body).toContain("Required plan: Builder");
    expect(body).toContain("Current plan: Starter");
    expect(body).toContain("Workspace: Acme Builders");
  });

  it("falls back to 'no plan' when current plan is null", () => {
    const href = buildUpgradeWhatsappLink(FEATURES.hr, { currentPlan: null });
    expect(decodedTextOf(href)).toContain("Current plan: no plan");
  });

  it("omits the workspace line when no company name is supplied", () => {
    const href = buildUpgradeWhatsappLink(FEATURES.hr, { currentPlan: "starter" });
    expect(decodedTextOf(href)).not.toContain("Workspace:");
  });

  it("uses the CLICKED item's label for child paths, not the parent feature label", () => {
    const feat = featureForPath("/print-ledger")!;
    const body = decodedTextOf(buildUpgradeWhatsappLink(feat, { currentPlan: "starter" }));
    expect(body).toContain("Feature: Print Ledger");
    expect(body).not.toContain("Feature: Installment Ledger");

    const payroll = featureForPath("/hr/payroll")!;
    const payrollBody = decodedTextOf(
      buildUpgradeWhatsappLink(payroll, { currentPlan: "starter" }),
    );
    expect(payrollBody).toContain("Feature: Payroll");
    expect(payrollBody).toContain("Required plan: Professional");
  });

  it("URL-encodes newlines and punctuation safely", () => {
    const href = buildUpgradeWhatsappLink(FEATURES.crm);
    // %0A = newline; must be present since the body is multi-line.
    expect(href).toMatch(/%0A/);
    // No literal spaces or newlines leaked into the URL.
    expect(href).not.toMatch(/[ \n\r\t]/);
  });
});
