import { expect, test, type Page } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "./_authHelpers";

/**
 * Dashboard — `prefers-reduced-motion: reduce` audit.
 *
 * The iOS shell layers several motion effects (card hover lift, main-
 * content fade-in-up, button press scale, sonner slide-ins, sidebar nav
 * highlight fades). CSS media queries at
 * `@media (prefers-reduced-motion: reduce)` neutralise those. This test
 * emulates the OS-level preference and audits the live DOM to prove no
 * transform, `box-shadow` transition, or running animation slips through.
 *
 * Assertions (all under `[data-theme="ios"]`, the authenticated shell):
 *
 *   1. `document.getAnimations()` returns zero *running* animations.
 *      Finished / paused entries are tolerated — Web Animations API
 *      keeps them around even after they complete; only `playState ===
 *      "running"` indicates motion the user can perceive.
 *
 *   2. No visible element has a non-identity `transform` in its
 *      computed style. `matrix(1,0,0,1,0,0)` and `none` both pass;
 *      anything else (translateY, scale, rotate) fails the audit.
 *
 *   3. No visible element has a *non-zero* transition-duration or
 *      animation-duration for `transform` / `box-shadow`. The global
 *      `@media (prefers-reduced-motion: reduce)` catch-all in
 *      `src/styles.css` collapses every `transition-duration` and
 *      `animation-duration` to `0.01ms`, which is functionally instant.
 *      Anything greater than ~0.02s means a rule leaked past the
 *      catch-all (typically via a hardcoded `transition-duration` set
 *      *after* the media query, or an inline style).
 *
 * Interaction step: we deliberately hover a card AND focus a primary
 * button before auditing, because motion regressions usually surface as
 * a `:hover` transform or a `:focus-visible` box-shadow transition. If
 * the reduced-motion rules are wired correctly, neither state should
 * produce transitions or transforms in the computed style.
 */

const ROUTE = "/";
const HAS_AUTH = authAvailable();

/** Elements that don't participate in visible motion — skip to keep the
 *  audit focused on user-visible chrome. */
const IGNORED_TAGS = new Set(["SCRIPT", "STYLE", "META", "LINK", "HEAD", "TITLE"]);

async function settle(page: Page) {
  await page.evaluate(() => document.fonts?.ready);
  // Long enough for any (bugged) transition to have started and be caught
  // by getAnimations() / computed style reads.
  await page.waitForTimeout(400);
}

test.describe("Dashboard — prefers-reduced-motion audit", () => {
  test.skip(
    !HAS_AUTH,
    "Requires an injected Lovable-managed Supabase session (LOVABLE_BROWSER_AUTH_STATUS=injected).",
  );

  // Override the project-level `reducedMotion` just to be explicit — this
  // test's contract is specifically about reduced-motion behaviour. We
  // also emulate `prefers-reduced-motion` via emulateMedia so both the
  // CSS media query AND `window.matchMedia` report `reduce`.
  test.use({ reducedMotion: "reduce" });

  test("no transforms, no shadow transitions, no running animations", async ({ context, page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await restoreSupabaseSession(context, page);
    await page.goto(ROUTE, { waitUntil: "domcontentloaded" });

    const shell = page.locator('[data-theme="ios"]').first();
    await expect(shell, "iOS-scoped shell should mount").toBeVisible();

    // Confirm the emulation actually landed — if this returns false, the
    // rest of the assertions would be a false pass because reduced-motion
    // rules simply wouldn't apply.
    const rmMatches = await page.evaluate(
      () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    expect(rmMatches, "prefers-reduced-motion should be emulated as reduce").toBe(true);

    await settle(page);

    // Drive the two most likely regression paths BEFORE auditing:
    //   • Hover a default card → would set transform:translateY(-1px)
    //     and a box-shadow transition if reduced-motion rules regressed.
    //   • Focus a primary button → would fire the focus-ring transition.
    const card = page.locator('main [data-slot="card"]:not([data-brand-accent])').first();
    if (await card.count()) {
      await card.scrollIntoViewIfNeeded();
      await card.hover();
    }
    const button = page.locator("main button.bg-primary").first();
    if (await button.count()) {
      await button.evaluate((el: HTMLElement) => el.focus({ preventScroll: true }));
    }
    await settle(page);

    // 1) No RUNNING Web Animations. Filter to `running` because completed
    //    or paused animations linger in getAnimations() indefinitely and
    //    are not user-visible motion.
    const runningAnimations = await page.evaluate(() => {
      const anims = document.getAnimations?.() ?? [];
      return anims
        .filter((a) => a.playState === "running")
        .map((a) => {
          const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
          return {
            id: a.id,
            playState: a.playState,
            target: target
              ? `${target.tagName.toLowerCase()}${target.id ? "#" + target.id : ""}` +
                (target.className && typeof target.className === "string"
                  ? "." + target.className.trim().replace(/\s+/g, ".").slice(0, 60)
                  : "")
              : null,
          };
        });
    });
    expect(
      runningAnimations,
      `Expected no running Web Animations under reduced-motion, found:\n${JSON.stringify(runningAnimations, null, 2)}`,
    ).toEqual([]);

    // 2) + 3) Walk every visible element inside the iOS shell and audit
    //    computed transform + per-property transition/animation duration.
    //    Return offending entries with enough context to diagnose which
    //    rule leaked past the global reduced-motion catch-all.
    const offenders = await shell.evaluate((root, ignoredArr) => {
      const ignored = new Set(ignoredArr);
      const isIdentityTransform = (t: string) =>
        t === "none" ||
        t === "matrix(1, 0, 0, 1, 0, 0)" ||
        t === "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)";

      // The universal `@media (prefers-reduced-motion: reduce)` rule sets
      // every duration to 0.01ms. Anything above ~0.02s (20ms) means the
      // rule was overridden downstream.
      const MAX_ALLOWED_MS = 20;
      const parseDurationsMs = (list: string): number[] =>
        list
          .split(",")
          .map((s) => s.trim())
          .map((s) => {
            if (s.endsWith("ms")) return parseFloat(s);
            if (s.endsWith("s")) return parseFloat(s) * 1000;
            return 0;
          });

      const bad: Array<{
        selector: string;
        transform?: string;
        offendingTransition?: string;
        offendingAnimation?: string;
      }> = [];

      const all = root.querySelectorAll<HTMLElement>("*");
      for (const el of all) {
        if (ignored.has(el.tagName)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;

        const cs = getComputedStyle(el);
        const transform = cs.transform;
        const badTransform = !isIdentityTransform(transform);

        // Pair transition-property to transition-duration by index (that
        // is how the spec resolves the shorthand into per-property values).
        const transProps = cs.transitionProperty.split(",").map((s) => s.trim());
        const transDurs = parseDurationsMs(cs.transitionDuration);
        let offendingTransition: string | undefined;
        for (let i = 0; i < transProps.length; i++) {
          const p = transProps[i];
          const d = transDurs[i % Math.max(transDurs.length, 1)] ?? 0;
          if ((p === "transform" || p === "box-shadow" || p === "all") && d > MAX_ALLOWED_MS) {
            offendingTransition = `${p} ${d}ms`;
            break;
          }
        }

        // Same pairing for animation-name / animation-duration. `none` is
        // the no-animation sentinel and is always OK.
        const animNames = cs.animationName.split(",").map((s) => s.trim());
        const animDurs = parseDurationsMs(cs.animationDuration);
        let offendingAnimation: string | undefined;
        for (let i = 0; i < animNames.length; i++) {
          const n = animNames[i];
          const d = animDurs[i % Math.max(animDurs.length, 1)] ?? 0;
          if (n && n !== "none" && d > MAX_ALLOWED_MS) {
            offendingAnimation = `${n} ${d}ms`;
            break;
          }
        }

        if (badTransform || offendingTransition || offendingAnimation) {
          const cls =
            typeof el.className === "string" && el.className.trim()
              ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
              : "";
          const id = el.id ? `#${el.id}` : "";
          bad.push({
            selector: `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 120),
            ...(badTransform ? { transform } : {}),
            ...(offendingTransition ? { offendingTransition } : {}),
            ...(offendingAnimation ? { offendingAnimation } : {}),
          });
        }
      }
      // Cap to the first 20 offenders — enough to locate the leaked rule.
      return bad.slice(0, 20);
    }, Array.from(IGNORED_TAGS));

    expect(
      offenders,
      `Reduced-motion audit found ${offenders.length} elements with a non-identity transform, ` +
        `or a transform/box-shadow transition/animation whose duration exceeds 20ms:\n` +
        `${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });
});
