import { expect, test } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "../visual/_authHelpers";
import { seedLeadsCrm, SEED_TAG } from "./_helpers/seedLeadsCrm";

/**
 * LeadsCRM — Undo / revert live-region announcement.
 *
 * Sibling spec `leads-crm-live-regions.spec.ts` covers the initial
 * "moved to stage X" / "converted to Booking Done" announcements.
 * This spec locks in the **revert** copy contract from
 * src/pages/LeadsCRM.tsx (line ~505):
 *
 *   announce(`${leadName} reverted to stage ${v.stage}.`);   // polite
 *
 * Revert is triggered by the "Undo" action on the sonner toast that
 * appears after a normal stage move. The mutation runs again with
 * `silent: true`, which routes to the polite region only — the
 * assertive channel must stay empty for an undo (undoing is not
 * urgent; announcing it assertively would interrupt the user).
 */

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
  await expect(page.getByText(SEED_TAG, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
}

test.describe("LeadsCRM — undo/revert live-region announcement", () => {
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

  test("undo of a stage move announces the reverted stage in the polite region", async ({
    page,
  }) => {
    await gotoLeads(page);
    const politeRegion = page.locator(POLITE);
    const assertiveRegion = page.locator(ASSERTIVE);
    await expect(politeRegion).toHaveText("");
    await expect(assertiveRegion).toHaveText("");

    // ---- Step 1: move New Inquiry → Site Visit Scheduled --------------
    const advance = page
      .getByRole("button", {
        name: /^Advance \[pw-axe-seed\] New Inquiry .* to Site Visit Scheduled$/,
      })
      .first();
    await expect(advance, "Advance button for a New Inquiry seed lead should exist").toBeVisible({
      timeout: 5000,
    });
    await advance.click();

    await page.getByRole("button", { name: /^confirm move$/i }).click();

    // Capture the exact lead name from the polite region so we can
    // assert byte-for-byte revert copy — the seed run-id suffix
    // varies per test run, so we can't hardcode the full name.
    await expect(politeRegion).toContainText(/moved to stage Site Visit Scheduled\.$/, {
      timeout: 5000,
    });
    const movedText = (await politeRegion.textContent())?.trim() ?? "";
    const nameMatch = movedText.match(/^(.+?) moved to stage Site Visit Scheduled\.$/);
    expect(
      nameMatch,
      `Could not parse lead name from polite region text: "${movedText}"`,
    ).not.toBeNull();
    const leadName = nameMatch![1];
    expect(leadName.startsWith(SEED_TAG)).toBe(true);

    // ---- Step 2: click Undo in the sonner toast ----------------------
    // Sonner exposes the action as a real button named "Undo" inside
    // the toast landmark. It's rendered at the document root, not
    // inside /leads, so scope to the ol[data-sonner-toaster].
    const toaster = page.locator("ol[data-sonner-toaster]");
    const undo = toaster.getByRole("button", { name: /^undo$/i }).first();
    await expect(undo, "Undo action should appear on the sonner toast").toBeVisible({
      timeout: 5000,
    });
    await undo.click();

    // ---- Step 3: assert revert copy contract -------------------------
    // Copy contract from LeadsCRM.tsx:
    //   `${leadName} reverted to stage ${v.stage}.`
    // v.stage on undo is the *previous* stage — "New Inquiry".
    const expectedRevert = `${leadName} reverted to stage New Inquiry.`;
    await expect(politeRegion).toHaveText(expectedRevert, { timeout: 5000 });

    // Undo must NEVER announce assertively — it would interrupt the
    // screen reader mid-sentence for a non-urgent action.
    await expect(assertiveRegion).toHaveText("");
  });
});
