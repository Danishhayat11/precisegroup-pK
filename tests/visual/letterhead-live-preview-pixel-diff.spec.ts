import { expect, test } from "@playwright/test";

/**
 * Pixel-diff regression for `LetterheadLivePreview`.
 *
 * OPT-IN ONLY. Runs when `VISUAL_DIFF=1` is set in the environment; every
 * other invocation is skipped so CI stays green until a maintainer opts in.
 * This is deliberate: a pixel diff is the most sensitive kind of test and
 * we only want it running on runners with a stable font stack and DPR.
 *
 * The complementary structural regression at
 * `src/__tests__/letterhead-live-preview.visual-regression.test.tsx` runs
 * on every push — it catches DOM/style drift. This spec catches TRUE
 * rendering drift (font metrics, spacing, border rendering) that a
 * DOM-shape check cannot see.
 *
 * Run locally:
 *   VISUAL_DIFF=1 bunx playwright test tests/visual/letterhead-live-preview-pixel-diff.spec.ts --project=chromium-reduced-motion
 * Update the committed baseline (only when a design change is intentional):
 *   VISUAL_DIFF=1 bunx playwright test tests/visual/letterhead-live-preview-pixel-diff.spec.ts --project=chromium-reduced-motion --update-snapshots
 */

const OPT_IN = process.env.VISUAL_DIFF === "1";

test.describe("LetterheadLivePreview — pixel diff", () => {
  test.skip(!OPT_IN, "opt-in only: set VISUAL_DIFF=1 to run this spec");

  test("renders pixel-identical to the committed baseline", async ({ page }) => {
    // Deterministic harness route — pre-seeded QueryClient, no auth, no
    // Supabase round-trip. See src/routes/letterhead-preview-visual.tsx.
    await page.goto("/letterhead-preview-visual", { waitUntil: "networkidle" });

    const preview = page.getByTestId("letterhead-live-preview");
    await expect(preview).toBeVisible();

    // Wait for web fonts + Tailwind CSS to settle. Font loading is the
    // #1 source of pixel-diff flakiness — a missing font renders the
    // fallback and every glyph shifts by a subpixel.
    await page.evaluate(async () => {
      const anyDoc = document as unknown as { fonts?: { ready: Promise<unknown> } };
      if (anyDoc.fonts?.ready) await anyDoc.fonts.ready;
      // Two RAFs lets Tailwind's utility styles apply and any
      // useLayoutEffect measurement settle before we snap.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });

    // Confirm the header actually rendered the seeded brand — if the
    // component fell back to a supabase call and errored, the screenshot
    // would still look plausible but the baseline would be wrong.
    await expect(preview.getByText("MANAL HEIGHTS", { exact: true })).toBeVisible();

    await expect(preview).toHaveScreenshot("letterhead-live-preview.png", {
      // Slightly looser than the project-wide 0.2% default because the
      // preview embeds a rasterized `Times New Roman` fallback whose
      // hinting varies by ~0.3% between chromium point releases.
      maxDiffPixelRatio: 0.005,
      // Snapshot only the preview element, not the surrounding page
      // padding — keeps the baseline immune to route-level layout tweaks.
      animations: "disabled",
      caret: "hide",
    });
  });
});
