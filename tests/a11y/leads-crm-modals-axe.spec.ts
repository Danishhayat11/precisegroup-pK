import { expect, test } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "../visual/_authHelpers";
import { seedLeadsCrm } from "./_helpers/seedLeadsCrm";
import { buildAxe, filterKnownFalsePositives } from "./_helpers/axeConfig";

/**
 * LeadsCRM — modal & dialog axe coverage.
 *
 * `leads-crm-axe.spec.ts` scans only the /leads page at rest (Kanban +
 * Table). Radix Dialog/AlertDialog content is portalled and is not
 * present in the DOM until a trigger opens it, so those specs never
 * see the modals that ship the highest-risk copy (destructive
 * confirmations, forms, focus traps).
 *
 * This spec opens each interactive surface reachable from /leads and
 * runs the shared axe rule bundle (from `_helpers/axeConfig`) scoped
 * to the open dialog. Known false positives are filtered centrally
 * — never per-spec — so a whitelist entry benefits every scan.
 */

async function gotoLeads(page: import("@playwright/test").Page, query = "") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/leads${query}`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(750);
  if (page.url().includes("/auth") || page.url().includes("/login")) {
    throw new Error(
      `Expected /leads but got ${page.url()} — auth gate rejected the injected session.`,
    );
  }
}

async function scanOpenDialog(page: import("@playwright/test").Page, label: string) {
  const dialog = page
    .locator('[role="dialog"], [role="alertdialog"]')
    .filter({ has: page.locator(":scope *") })
    .last();
  await expect(dialog, `${label} — dialog should be visible`).toBeVisible({ timeout: 5000 });

  const raw = await buildAxe(page, { include: '[role="dialog"], [role="alertdialog"]' }).analyze();
  const { violations, suppressed } = filterKnownFalsePositives(raw.violations);

  if (Object.keys(suppressed).length > 0) {
    // eslint-disable-next-line no-console
    console.log(`[axe] ${label}: suppressed known false positives`, suppressed);
  }

  if (violations.length === 0) {
    expect(violations).toEqual([]);
    return;
  }

  const lines = violations.flatMap((v) => [
    `  · [${v.impact ?? "n/a"}] ${v.id} — ${v.help}`,
    `    ${v.helpUrl}`,
    ...v.nodes.slice(0, 3).map((n) => `      · ${n.target.join(" ")}`),
  ]);
  throw new Error(`${violations.length} axe violation(s) in ${label}:\n${lines.join("\n")}`);
}

async function closeDialog(page: import("@playwright/test").Page) {
  await page.keyboard.press("Escape");
  await page
    .locator('[role="dialog"], [role="alertdialog"]')
    .first()
    .waitFor({ state: "detached", timeout: 5000 })
    .catch(() => {});
}

test.describe("LeadsCRM — modals & dialogs axe scan", () => {
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

  test("Add Lead dialog — no axe violations", async ({ page }) => {
    await gotoLeads(page);
    await page
      .getByRole("button", { name: /add lead/i })
      .first()
      .click();
    await scanOpenDialog(page, "Add Lead dialog");
    await closeDialog(page);
  });

  test("Edit Lead dialog — no axe violations", async ({ page }) => {
    await gotoLeads(page);
    await page
      .getByRole("button", { name: /^edit /i })
      .first()
      .click();
    await scanOpenDialog(page, "Edit Lead dialog");
    await closeDialog(page);
  });

  test("Stage-change confirmation — no axe violations", async ({ page }) => {
    await gotoLeads(page);
    // The "Advance <name> to <stage>" button on any non-terminal card
    // routes through requestStageChange → pending AlertDialog.
    const advance = page.getByRole("button", { name: /^advance .+ to /i }).first();
    await expect(advance).toBeVisible();
    await advance.click();
    await scanOpenDialog(page, "Stage-change confirmation");
    await closeDialog(page);
  });

  test("Convert to Booking dialog — no axe violations", async ({ page }) => {
    await gotoLeads(page);
    const convert = page.getByRole("button", { name: /^convert$/i }).first();
    await expect(convert).toBeVisible();
    await convert.click();
    await scanOpenDialog(page, "Convert to Booking dialog");
    await closeDialog(page);
  });

  test("Delete lead confirmation — no axe violations", async ({ page }) => {
    await gotoLeads(page);
    await page
      .getByRole("button", { name: /^delete lead /i })
      .first()
      .click();
    await scanOpenDialog(page, "Delete lead confirmation");
    // Explicitly cancel so nothing seeded is actually deleted.
    await page.getByRole("button", { name: /^cancel$/i }).click();
  });

  test("Table view — no axe violations on interactive row", async ({ page }) => {
    // Table view rows have their own set of icon buttons + a stage
    // Select per row; the Kanban-only scan in leads-crm-axe.spec.ts
    // does not exercise them.
    await gotoLeads(page, "?view=table");
    const raw = await buildAxe(page).analyze();
    const { violations, suppressed } = filterKnownFalsePositives(raw.violations);
    if (Object.keys(suppressed).length > 0) {
      // eslint-disable-next-line no-console
      console.log("[axe] Table view: suppressed known false positives", suppressed);
    }
    if (violations.length > 0) {
      const lines = violations.flatMap((v) => [
        `  · [${v.impact ?? "n/a"}] ${v.id} — ${v.help}`,
        `    ${v.helpUrl}`,
        ...v.nodes.slice(0, 3).map((n) => `      · ${n.target.join(" ")}`),
      ]);
      throw new Error(`${violations.length} axe violation(s) in Table view:\n${lines.join("\n")}`);
    }
    expect(violations).toEqual([]);
  });
});
