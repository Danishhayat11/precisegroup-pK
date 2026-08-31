import { expect, test } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "../visual/_authHelpers";
import { seedLeadsCrm, SEED_TAG } from "./_helpers/seedLeadsCrm";

/**
 * LeadsCRM — live-region correctness + repeat-fire regression.
 *
 * Sibling specs already lock:
 *   • the copy contract for the first move ("moved to stage X.")
 *   • the copy contract for undo ("reverted to stage Y.")
 *   • the copy contract for the terminal conversion
 *     ("converted to Booking Done. Booking can now be created…")
 *
 * This spec adds the two guarantees that the naive
 * `setState("")` → `rAF(setState(msg))` implementation *silently*
 * violated, and that `useLiveAnnouncer` was written to restore:
 *
 *   1. **Conversion announces on the assertive channel with the
 *      exact contract copy, including the affected lead's name.**
 *      Guards against a regression that swaps politeness or drops
 *      the lead name (a real bug we shipped once when the mutation
 *      lost `ctx.leadAtMutate`).
 *
 *   2. **Repeat actions re-announce.** Screen readers only speak a
 *      live region when its text content mutates. If the same
 *      message is written twice with no intervening empty commit,
 *      the DOM doesn't change and the user hears nothing on the
 *      second event. This spec records every mutation on the polite
 *      and assertive regions and asserts the region observably
 *      transitioned through empty and back to the target text on
 *      the repeat action — the DOM proof that a screen reader
 *      would speak it a second time.
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

/**
 * Install a MutationObserver on both live regions and store every
 * textContent snapshot in `window.__liveLog` on the page. Reading
 * that log later is how we prove a screen reader would have heard
 * a second announcement — the region must mutate to speak, so
 * counting *transitions to the target string* is the correct signal
 * (not just "is the final text equal to X").
 */
async function installLiveRegionRecorder(page: import("@playwright/test").Page) {
  await page.evaluate(
    ({ polite, assertive }) => {
      type Entry = { channel: "polite" | "assertive"; text: string; at: number };
      const log: Entry[] = [];
      (window as unknown as { __liveLog: Entry[] }).__liveLog = log;

      const attach = (selector: string, channel: Entry["channel"]) => {
        const el = document.querySelector(selector);
        if (!el) throw new Error(`Live region not mounted: ${selector}`);
        // Capture the initial value once so downstream analysis has a
        // stable baseline (should be "" but be defensive).
        log.push({ channel, text: (el.textContent ?? "").trim(), at: Date.now() });
        const obs = new MutationObserver(() => {
          log.push({ channel, text: (el.textContent ?? "").trim(), at: Date.now() });
        });
        obs.observe(el, { childList: true, characterData: true, subtree: true });
      };

      attach(polite, "polite");
      attach(assertive, "assertive");
    },
    { polite: POLITE, assertive: ASSERTIVE },
  );
}

async function readLiveLog(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const w = window as unknown as {
      __liveLog?: { channel: "polite" | "assertive"; text: string; at: number }[];
    };
    return w.__liveLog ?? [];
  });
}

async function advanceAndConfirm(
  page: import("@playwright/test").Page,
  fromStagePrefix: string,
  toStage: string,
) {
  const advance = page
    .getByRole("button", {
      name: new RegExp(`^Advance \\[pw-axe-seed\\] ${fromStagePrefix} .* to ${toStage}$`),
    })
    .first();
  await expect(
    advance,
    `Advance button for a ${fromStagePrefix} seed lead should exist`,
  ).toBeVisible({ timeout: 5000 });
  await advance.click();
  await page.getByRole("button", { name: /^confirm move$/i }).click();
}

async function clickToastUndo(page: import("@playwright/test").Page) {
  const undo = page
    .locator("ol[data-sonner-toaster]")
    .getByRole("button", { name: /^undo$/i })
    .first();
  await expect(undo, "Undo action on the sonner toast should be visible").toBeVisible({
    timeout: 5000,
  });
  await undo.click();
}

test.describe("LeadsCRM — live-region correctness & repeat-fire", () => {
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

  test("conversion to Booking Done announces on assertive channel with lead name", async ({
    page,
  }) => {
    await gotoLeads(page);
    await installLiveRegionRecorder(page);

    await advanceAndConfirm(page, "Negotiation", "Booking Done");

    const assertiveRegion = page.locator(ASSERTIVE);
    await expect(assertiveRegion).toContainText(
      /converted to Booking Done\. Booking can now be created from this lead\.$/,
      { timeout: 5000 },
    );

    // Explicitly verify the lead name (not just the tail): a regression
    // that dropped `leadName` from the template would still pass a
    // suffix-only regex.
    const text = (await assertiveRegion.textContent())?.trim() ?? "";
    const match = text.match(/^(.+?) converted to Booking Done\.$/);
    expect(
      match,
      `assertive text should start with "<lead name> converted to Booking Done." — got "${text}"`,
    ).not.toBeNull();
    expect(match![1], "lead name in assertive announcement must carry the seed tag").toContain(
      SEED_TAG,
    );

    // Politeness contract: conversion is assertive ONLY.
    await expect(page.locator(POLITE)).toHaveText("");
  });

  test("repeated polite move re-announces (region mutates through empty)", async ({ page }) => {
    await gotoLeads(page);
    await installLiveRegionRecorder(page);

    // 1st move — capture the lead's full name from the first announcement.
    await advanceAndConfirm(page, "New Inquiry", "Site Visit Scheduled");
    const politeRegion = page.locator(POLITE);
    await expect(politeRegion).toContainText(/moved to stage Site Visit Scheduled\.$/, {
      timeout: 5000,
    });
    const firstText = (await politeRegion.textContent())?.trim() ?? "";
    const name = firstText.match(/^(.+?) moved to stage Site Visit Scheduled\.$/)?.[1];
    expect(name, `Could not parse lead name from "${firstText}"`).toBeTruthy();
    const expectedMove = `${name} moved to stage Site Visit Scheduled.`;

    // Undo → back to New Inquiry.
    await clickToastUndo(page);
    await expect(politeRegion).toHaveText(`${name} reverted to stage New Inquiry.`, {
      timeout: 5000,
    });

    // 2nd move — SAME target stage, SAME expected copy. The whole
    // point of the queue is that the region visibly transitions
    // through "" and back to the message so the SR speaks again.
    await advanceAndConfirm(page, "New Inquiry", "Site Visit Scheduled");
    await expect(politeRegion).toHaveText(expectedMove, { timeout: 5000 });

    // Now inspect the mutation log. There must be at least TWO
    // transitions on the polite channel where textContent flips
    // *to* `expectedMove`. Each such transition is one SR utterance.
    const log = await readLiveLog(page);
    const politeEntries = log.filter((e) => e.channel === "polite").map((e) => e.text);
    const arrivalsAtExpected = politeEntries.filter((t) => t === expectedMove).length;
    expect(
      arrivalsAtExpected,
      `Polite region must have transitioned to "${expectedMove}" at least twice (once per user action) so a screen reader speaks both times. Actual polite log:\n${politeEntries.map((t, i) => `  [${i}] ${JSON.stringify(t)}`).join("\n")}`,
    ).toBeGreaterThanOrEqual(2);

    // Also assert the two arrivals were separated by at least one
    // empty commit — SRs won't re-speak identical text unless the
    // node observably went blank between the two writes.
    const firstIdx = politeEntries.indexOf(expectedMove);
    const secondIdx = politeEntries.indexOf(expectedMove, firstIdx + 1);
    const between = politeEntries.slice(firstIdx + 1, secondIdx);
    expect(
      between.some((t) => t === ""),
      `Polite region must have gone empty between repeat announcements. Between-arrivals slice: ${JSON.stringify(between)}`,
    ).toBe(true);
  });

  test("repeated conversion (convert → undo → convert) re-announces on assertive channel", async ({
    page,
  }) => {
    await gotoLeads(page);
    await installLiveRegionRecorder(page);

    // 1st conversion.
    await advanceAndConfirm(page, "Negotiation", "Booking Done");
    const assertiveRegion = page.locator(ASSERTIVE);
    await expect(assertiveRegion).toContainText(
      /converted to Booking Done\. Booking can now be created from this lead\.$/,
      { timeout: 5000 },
    );
    const firstAssertive = (await assertiveRegion.textContent())?.trim() ?? "";
    const name = firstAssertive.match(/^(.+?) converted to Booking Done\.$/)?.[1];
    expect(name, `Could not parse lead name from "${firstAssertive}"`).toBeTruthy();
    const expectedConversion = `${name} converted to Booking Done. Booking can now be created from this lead.`;

    // Undo puts the lead back at Negotiation. Undo itself is polite,
    // not assertive — that's fine, we're only counting assertive
    // arrivals at the conversion copy.
    await clickToastUndo(page);
    await expect(page.locator(POLITE)).toContainText(/reverted to stage Negotiation\.$/, {
      timeout: 5000,
    });

    // 2nd conversion — identical text must re-fire assertively.
    await advanceAndConfirm(page, "Negotiation", "Booking Done");
    await expect(assertiveRegion).toHaveText(expectedConversion, { timeout: 5000 });

    const log = await readLiveLog(page);
    const assertiveEntries = log.filter((e) => e.channel === "assertive").map((e) => e.text);
    const arrivals = assertiveEntries.filter((t) => t === expectedConversion).length;
    expect(
      arrivals,
      `Assertive region must have transitioned to "${expectedConversion}" at least twice. Actual assertive log:\n${assertiveEntries.map((t, i) => `  [${i}] ${JSON.stringify(t)}`).join("\n")}`,
    ).toBeGreaterThanOrEqual(2);

    const firstIdx = assertiveEntries.indexOf(expectedConversion);
    const secondIdx = assertiveEntries.indexOf(expectedConversion, firstIdx + 1);
    const between = assertiveEntries.slice(firstIdx + 1, secondIdx);
    expect(
      between.some((t) => t === ""),
      `Assertive region must have gone empty between repeat conversions. Between-arrivals slice: ${JSON.stringify(between)}`,
    ).toBe(true);
  });
});
