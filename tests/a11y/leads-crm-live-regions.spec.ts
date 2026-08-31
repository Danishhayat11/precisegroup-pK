import { expect, test } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "../visual/_authHelpers";
import { seedLeadsCrm, SEED_TAG } from "./_helpers/seedLeadsCrm";

/**
 * LeadsCRM — live-region announcement regression.
 *
 * The Leads page mounts two dedicated `.sr-only` live regions (see
 * src/pages/LeadsCRM.tsx around lines 660–679):
 *
 *   • `role="status"` + `aria-live="polite"`  → ordinary stage moves
 *   • `role="alert"`  + `aria-live="assertive"` → conversion to
 *                                                 Booking Done + errors
 *
 * Sonner toasts have their own live region, but it's shared with
 * unrelated notifications; screen-reader users depend on these two
 * regions to hear stage transitions. Every regression we've had here
 * (wrong copy, wrong politeness, region unmounted mid-announce) has
 * been silent in the UI — this spec locks the contract in place:
 *
 *   1. Advancing a New Inquiry lead announces
 *      "<name> moved to stage Site Visit Scheduled."
 *      in the polite (status) region only.
 *   2. Advancing a Negotiation lead — the terminal conversion —
 *      announces
 *      "<name> converted to Booking Done. Booking can now be created
 *      from this lead."
 *      in the assertive (alert) region.
 *
 * Uses the same seed helper as the other LeadsCRM specs so a clean
 * environment has one lead per stage to click into.
 */

// The two Leads-page live regions carry the .sr-only class exactly
// because they're supposed to be invisible; the class is the stable
// hook. Other role=alert / role=status elements on the page (form
// errors, inline validations) are NOT sr-only, so this selector
// isolates the stage-transition channel from the noise.
const POLITE = '[aria-live="polite"][role="status"].sr-only';
const ASSERTIVE = '[aria-live="assertive"][role="alert"].sr-only';

async function gotoLeads(page: import("@playwright/test").Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/leads", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(500);
  if (page.url().includes("/auth") || page.url().includes("/login")) {
    throw new Error(`Expected /leads but got ${page.url()} — auth gate rejected the session.`);
  }
  // Make sure the seeded cards have rendered before we look for
  // aria-label matches on them.
  await expect(page.getByText(SEED_TAG, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
}

async function advanceAndConfirm(
  page: import("@playwright/test").Page,
  stagePrefix: string,
  toStage: string,
) {
  // Aria-label is `Advance <full_name> to <toStage>`. Seed rows have
  // full_name = `[pw-axe-seed] <stage> #<i> <runId>` — anchor the
  // regex so we don't collide with the neighboring "back" button
  // ("Move ... back to ...").
  const label = new RegExp(`^Advance \\[pw-axe-seed\\] ${stagePrefix} .* to ${toStage}$`);
  const advance = page.getByRole("button", { name: label }).first();
  await expect(advance, `Advance button for a ${stagePrefix} seed lead should exist`).toBeVisible({
    timeout: 5000,
  });
  await advance.click();

  // The confirmation AlertDialog offers "Confirm move" (or "Mark
  // Lost", but Booking Done is not Lost so it's still "Confirm move").
  const confirm = page.getByRole("button", { name: /^(confirm move|mark lost)$/i });
  await expect(confirm).toBeVisible({ timeout: 5000 });
  await confirm.click();
}

test.describe("LeadsCRM — live-region announcements", () => {
  let cleanupSeed: (() => Promise<void>) | null = null;

  test.beforeAll(async ({}, testInfo) => {
    if (!authAvailable()) return;
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

  test("advancing a lead announces via the polite status region", async ({ page }) => {
    await gotoLeads(page);
    const politeRegion = page.locator(POLITE);
    const assertiveRegion = page.locator(ASSERTIVE);
    await expect(politeRegion, "polite live region must be mounted").toHaveCount(1);
    await expect(assertiveRegion, "assertive live region must be mounted").toHaveCount(1);

    // Both regions start empty — an unrelated announcement would
    // corrupt this test's expectations.
    await expect(politeRegion).toHaveText("");
    await expect(assertiveRegion).toHaveText("");

    await advanceAndConfirm(page, "New Inquiry", "Site Visit Scheduled");

    // Copy contract from LeadsCRM.tsx:
    //   `${leadName} moved to stage ${v.stage}.`
    await expect(politeRegion).toContainText(/moved to stage Site Visit Scheduled\.$/, {
      timeout: 5000,
    });
    await expect(politeRegion).toContainText(SEED_TAG);
    // Non-conversion moves MUST NOT fire the assertive region.
    await expect(assertiveRegion).toHaveText("");
  });

  test("conversion to Booking Done announces via the assertive alert region", async ({ page }) => {
    await gotoLeads(page);
    const politeRegion = page.locator(POLITE);
    const assertiveRegion = page.locator(ASSERTIVE);
    await expect(politeRegion).toHaveText("");
    await expect(assertiveRegion).toHaveText("");

    // Negotiation → Booking Done is the terminal, revenue-recognizing
    // transition; it MUST announce assertively.
    await advanceAndConfirm(page, "Negotiation", "Booking Done");

    // Copy contract from LeadsCRM.tsx:
    //   `${leadName} converted to Booking Done. Booking can now be
    //    created from this lead.`
    await expect(assertiveRegion).toContainText(
      /converted to Booking Done\. Booking can now be created from this lead\.$/,
      { timeout: 5000 },
    );
    await expect(assertiveRegion).toContainText(SEED_TAG);
    // Conversions announce assertively only — no polite echo.
    await expect(politeRegion).toHaveText("");
  });
});
