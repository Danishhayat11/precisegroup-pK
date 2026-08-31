import { expect, test, type Page } from "@playwright/test";

/**
 * /site — per-team-member headshot crop visual regression.
 *
 * Complements `site-leadership-visual.spec.ts` (whole-section diff) with a
 * TIGHTLY scoped element screenshot of each team member's `<TeamHeadshot>`
 * portrait frame (`.lg-media`, the 4:5 slot) across the four canonical
 * breakpoints. The purpose is to lock the responsive crop — specifically
 * `object-position` — so a future edit to `TeamHeadshot` defaults or to a
 * subject anchor (e.g. Saeed's `center 22%`) doesn't silently shift the
 * eye-line between releases.
 *
 * Why per-card instead of only the section shot:
 *   • The section-level diff can absorb a small crop shift (a few px) inside
 *     its overall pixel budget. Cropping to just the portrait raises the
 *     signal — a 2% face-position drift becomes an easy fail.
 *   • Saeed's frame is anchored differently from Mushtaq/Danish. Isolating
 *     each card makes regressions attributable to a single subject rather
 *     than "something moved in leadership".
 *
 * Baselines live under
 *   tests/visual/site-team-headshot-crop-visual.spec.ts-snapshots/
 * Promote intentional changes with `--update-snapshots`.
 */

const THEME_STORAGE_KEY = "precise.theme";

async function applyTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript(
    ({ key, value }) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* storage unavailable */
      }
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(value);
      root.style.colorScheme = value;
    },
    { key: THEME_STORAGE_KEY, value: theme },
  );
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
}

/**
 * Navigate to /site, scroll leadership into view so lazy portraits decode,
 * and wait for every <img> under `#leadership` plus the LQIP fade-out.
 */
async function settleLeadership(page: Page) {
  await page.goto("/site", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.9));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 50));
    }
  });

  await page.locator("#leadership").scrollIntoViewIfNeeded();

  // Wait for every leadership <img> to fully decode and reach the
  // `data-headshot-state="loaded"` state (skeleton + LQIP faded out).
  await page.evaluate(async () => {
    const root = document.querySelector("#leadership");
    if (!root) return;
    const imgs = Array.from(root.querySelectorAll("img"));
    await Promise.all(
      imgs.map((img) =>
        img.complete && img.naturalWidth > 0
          ? Promise.resolve()
          : new Promise<void>((r) => {
              img.addEventListener("load", () => r(), { once: true });
              img.addEventListener("error", () => r(), { once: true });
            }),
      ),
    );
  });

  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

const VIEWPORTS = [
  // 375 → iPhone SE / small mobile
  // 768 → iPad portrait / tablet breakpoint
  // 1280 → primary desktop baseline
  // 1440 → wide desktop / retina laptop
  { name: "w375", width: 375, height: 1600 },
  { name: "w768", width: 768, height: 1600 },
  { name: "w1280", width: 1280, height: 1800 },
  { name: "w1440", width: 1440, height: 1800 },
] as const;

const MEMBERS = [
  { slug: "mushtaq", heading: /Mushtaq\s+Ahma[dt]/i },
  { slug: "danish", heading: /Danish\s+Hayat/i },
  { slug: "saeed", heading: /Saeed\s+ullah/i },
] as const;

for (const member of MEMBERS) {
  for (const vp of VIEWPORTS) {
    test(`team headshot crop — ${member.slug} · ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await applyTheme(page, "light");
      await settleLeadership(page);

      // Locate the card by its h3 heading, then the portrait frame inside.
      // `.lg-media` is the fixed 4:5 slot rendered by `<TeamHeadshot>` —
      // capturing just this element isolates the crop and object-position
      // from any surrounding card chrome (headings, pills, bio copy) that
      // may reflow independently.
      const card = page
        .locator("#leadership article")
        .filter({ has: page.getByRole("heading", { level: 3, name: member.heading }) });
      await expect(card).toHaveCount(1);

      const frame = card.locator(".lg-media").first();
      await frame.scrollIntoViewIfNeeded();
      await expect(frame).toBeVisible();
      await expect(frame).toHaveAttribute("data-headshot-state", "loaded");

      await expect(frame).toHaveScreenshot(`team-headshot-${member.slug}-${vp.name}.png`, {
        // Slightly wider than the global 0.2% default: AVIF re-encodes
        // and font-hinting near the badge overlay produce a few dozen
        // sub-pixel-different pixels. A real crop shift (object-position
        // change, aspect-ratio drift, subject-anchor edit) still fails
        // with room to spare.
        maxDiffPixelRatio: 0.005,
        timeout: 30_000,
      });
    });
  }
}
