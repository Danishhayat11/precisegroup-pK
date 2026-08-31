import { expect, test } from "@playwright/test";

/**
 * Playwright regression — <TeamHeadshot> runtime validator.
 *
 * Renders the dev-only harness at
 * `/__test/team-headshot-bad-object-position` which mounts a single
 * TeamHeadshot with `objectPosition="centre 30vh"` (bad keyword AND
 * unsupported unit). Asserts:
 *   1. A `[TeamHeadshot]` console.warn fired mentioning the bad value
 *      and the fallback.
 *   2. The rendered <img> ships to the DOM with inline
 *      `object-position: center 30%` (the face-safe default) — never the
 *      malformed string. Both the inline `style` attribute and the
 *      computed style are checked so a future refactor to `<style>` /
 *      `data-*` attribute can't silently regress the fallback.
 */

const HARNESS_URL = "/team-headshot-op-harness";
const BAD = "centre 30vh";
const FALLBACK = "center 30%";

test("TeamHeadshot falls back to default when objectPosition is invalid", async ({ page }) => {
  const consoleMessages: string[] = [];
  page.on("console", (msg) => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
  });

  await page.goto(HARNESS_URL, { waitUntil: "domcontentloaded" });
  // Wait for React hydration + the harness's post-mount `key` bump that
  // remounts <TeamHeadshot> entirely on the client so the validator's
  // console.warn fires in the browser (not just during SSR).
  await page.waitForFunction(
    () => !!document.querySelector('img[alt^="Harness subject portrait"]'),
  );
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);

  const img = page.getByAltText("Harness subject portrait for objectPosition validator regression");
  await expect(img).toBeAttached();

  // Inline style attribute — must be the fallback verbatim.
  const inlineObjectPosition = await img.evaluate(
    (el) => (el as HTMLImageElement).style.objectPosition,
  );
  expect(inlineObjectPosition).toBe(FALLBACK);

  // Computed style — belt-and-braces against a future refactor that
  // moves the declaration off the `style` attribute. jsdom (unit tests)
  // can't cover this; a real browser can.
  const computedObjectPosition = await img.evaluate(
    (el) => window.getComputedStyle(el).objectPosition,
  );
  // Browsers normalize percentages but the keyword `center` may be
  // preserved or serialized to `50%`. Accept either canonical form
  // rather than pinning to a single string.
  expect(computedObjectPosition).toMatch(/^(center 30%|50% 30%)$/);

  // Confirm the malformed value never leaked through.
  expect(inlineObjectPosition).not.toContain("centre");
  expect(inlineObjectPosition).not.toContain("vh");

  // The validator's console.warn must have named the bad value and the
  // fallback so QA sees an actionable message in the browser console.
  const match = consoleMessages.find(
    (w) =>
      w.includes("[TeamHeadshot]") &&
      w.includes(`invalid objectPosition="${BAD}"`) &&
      w.includes(FALLBACK),
  );
  expect(
    match,
    `expected a [TeamHeadshot] invalid-objectPosition warning; got:\n${consoleMessages.join("\n")}`,
  ).toBeTruthy();
});
