/**
 * Per-theme focus-visible regression gate — SMALL/MEDIUM viewports.
 *
 * Sibling to `theme-focus-visible-audit.spec.ts` (desktop). Runs the same
 * audit at three breakpoints so we catch clip regressions across the
 * shell's responsive shape:
 *
 *   - 320×568  — iPhone SE (1st gen). The narrowest realistic screen; a
 *                great stress test for rounded drawer corners, safe-area
 *                padding, and small-viewport popovers.
 *   - 390×844  — iPhone 14-ish. The reference mobile size the design
 *                system targets.
 *   - 768×1024 — iPad portrait, exactly at the shell's `md` breakpoint.
 *                Bottom nav / FAB / mobile drawer are gone; the desktop
 *                sidebar returns. We still audit tablet-sized popovers
 *                (⌘K dialog, notifications dropdown) because those
 *                overlays are the most likely place for outline clip.
 *
 * For every viewport × theme, assert:
 *
 *   A. Every audited control paints a visible focus indicator (same
 *      definition as the desktop audit — outline / box-shadow / border /
 *      background diff vs the unfocused baseline).
 *   B. Hovering while focused does NOT flatten the ring.
 *   C. The focus indicator is NOT clipped by the nearest ancestor whose
 *      overflow value cuts painting (`hidden` / `clip`). A ~4px slack
 *      accounts for typical 2–3px shadcn rings.
 *
 * ─────────────────────────────────────────────────────────────────────
 * No-skip policy at 768×1024 (READ BEFORE ADDING `test.skip`)
 * ─────────────────────────────────────────────────────────────────────
 * Earlier revisions of this file skipped several checks at 768×1024
 * ("focus ring clips the viewport", "notifications trigger overflows
 * the header") because the AppShell topbar genuinely rendered past the
 * shell's `md:overflow-hidden` right edge at that width. The correct
 * fix was to tighten the header controls at `md` (see
 * `src/components/AppShell.tsx` and `src/components/ActiveProjectSwitcher.tsx`),
 * not to hide the failing assertion.
 *
 * With that layout fix in place, the 768×1024 audits pass unmodified
 * and are now permanent guardrails. DO NOT reintroduce a `test.skip`
 * at 768×1024 for any of:
 *
 *   - the notifications-trigger overflow / focus-ring assertions,
 *   - the ⌘K command dialog focus-ring checks,
 *   - any assertion that depends on viewport geometry rather than the
 *     presence of mobile chrome.
 *
 * The only legitimate skips at 768×1024 are the two mobile-chrome
 * suites guarded by `vp.hasMobileChrome` (bottom tab bar + FAB and the
 * slide-in drawer): those components are not rendered at/above `md` by
 * design, so there is nothing to audit. That gate is a compile-time
 * `if (vp.hasMobileChrome)` branch, not a runtime `test.skip`, so it
 * cannot silently hide a regression at 768×1024.
 *
 * If a 768×1024 check starts failing, fix the layout — do not skip.
 *
 * Run:
 *   bunx playwright test tests/a11y/theme-focus-visible-mobile.spec.ts \
 *        --project=chromium-reduced-motion
 */
import { test, expect, type Page, type Locator } from "@playwright/test";
import { authAvailable, restoreSupabaseSession } from "../visual/_authHelpers";

type Theme = "light" | "dark";
const THEMES: readonly Theme[] = ["light", "dark"];

/**
 * Viewports to audit. `hasMobileChrome` mirrors the shell's Tailwind
 * `md:` breakpoint (768px): strictly below → bottom nav + FAB + slide-in
 * drawer render; at/above → desktop sidebar returns.
 *
 * NOTE: `hasMobileChrome: false` at 768×1024 gates ONLY the two
 * mobile-chrome suites (bottom nav / drawer) that have no DOM to audit
 * at that width. All other suites — including the notifications
 * trigger and the ⌘K dialog — MUST run at 768×1024. See the "No-skip
 * policy at 768×1024" block in the file header before widening this
 * flag's blast radius.
 */
const VIEWPORTS = [
  { label: "320x568", width: 320, height: 568, hasMobileChrome: true },
  { label: "390x844", width: 390, height: 844, hasMobileChrome: true },
  { label: "768x1024", width: 768, height: 1024, hasMobileChrome: false },
] as const;

// Slack (px) allowed between a clipping ancestor's edge and the focused
// element's edge before we flag "the focus ring would clip". Sized for a
// standard shadcn 2–3px ring plus a small AA fudge.
const FOCUS_RING_SLACK_PX = 4;

type FocusStyle = {
  outlineStyle: string;
  outlineWidth: string;
  outlineColor: string;
  boxShadow: string;
  borderColor: string;
  borderWidth: string;
  backgroundColor: string;
};

const TRANSPARENT = new Set(["rgba(0, 0, 0, 0)", "transparent", ""]);

function hasVisibleFocus(focused: FocusStyle, baseline: FocusStyle): boolean {
  const outlineOk =
    focused.outlineStyle !== "none" &&
    parseFloat(focused.outlineWidth) > 0 &&
    !TRANSPARENT.has(focused.outlineColor);
  const shadowOk = focused.boxShadow !== "none" && focused.boxShadow !== baseline.boxShadow;
  const borderOk =
    focused.borderColor !== baseline.borderColor || focused.borderWidth !== baseline.borderWidth;
  const backgroundOk = focused.backgroundColor !== baseline.backgroundColor;
  return outlineOk || shadowOk || borderOk || backgroundOk;
}

async function readStyle(page: Page, handle: Locator): Promise<FocusStyle | null> {
  return await handle
    .evaluate((el) => {
      const s = window.getComputedStyle(el as HTMLElement);
      return {
        outlineStyle: s.outlineStyle,
        outlineWidth: s.outlineWidth,
        outlineColor: s.outlineColor,
        boxShadow: s.boxShadow,
        borderColor: s.borderColor,
        borderWidth: s.borderWidth,
        backgroundColor: s.backgroundColor,
      };
    })
    .catch(() => null);
}

async function keyboardFocus(page: Page, el: Locator) {
  // Nudging Tab first flips Chromium's :focus-visible heuristic to
  // "recent keyboard input", so the SUBSEQUENT programmatic focus()
  // is treated as :focus-visible — even for portalled elements where
  // Tab / Shift+Tab wouldn't naturally land back on our target.
  await page.keyboard.press("Tab");
  await el.evaluate((node) => {
    (document.activeElement as HTMLElement | null)?.blur();
    const target = node as HTMLElement;
    // Let ancestor scroll containers (drawer nav, tab-list, tables)
    // bring the target into view the same way real keyboard focus does.
    // Without this, tall drawer content at 320×568 leaves rows below
    // the viewport and every `overflow:hidden` root looks like a clip.
    target.focus();
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}

/** Split a computed `box-shadow` value into top-level layers, respecting parens (rgba/color-mix). */
function splitShadowLayers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/**
 * Whether the focused-state indicator visually PROJECTS OUTSIDE the
 * element's border-box. Only outward-projecting indicators can be
 * clipped by an ancestor's `overflow: hidden/clip`:
 *   - a real `outline` (always paints outside)
 *   - a `box-shadow` layer that isn't `inset` (shadcn `ring`, not `ring-inset`)
 *
 * Inset rings, background-color highlights (Radix menuitem, cmdk option),
 * and border-color-only diffs stay within the box and are never clipped.
 */
function projectsOutward(focused: FocusStyle, baseline: FocusStyle): boolean {
  const outlineOut =
    focused.outlineStyle !== "none" &&
    parseFloat(focused.outlineWidth) > 0 &&
    !TRANSPARENT.has(focused.outlineColor);
  if (outlineOut) return true;
  if (focused.boxShadow === "none" || focused.boxShadow === baseline.boxShadow) return false;
  return splitShadowLayers(focused.boxShadow).some((layer) => {
    const trimmed = layer.trim();
    return trimmed.length > 0 && !trimmed.startsWith("inset");
  });
}

/**
 * Verify the focused element's paint rect (element + outline + a small
 * ring allowance) is not cut off by an ancestor with `overflow: hidden`
 * or `overflow: clip`. We deliberately IGNORE `auto`/`scroll` ancestors
 * because keyboard focus scrolls them into view; painting isn't lost.
 */
async function assertNoRingClip(page: Page, el: Locator, label: string, failures: string[]) {
  const info = await el.evaluate((node, slack) => {
    const rect = (node as HTMLElement).getBoundingClientRect();
    let cur = (node as HTMLElement).parentElement;
    while (cur) {
      const cs = getComputedStyle(cur);
      const overflow = `${cs.overflow} ${cs.overflowX} ${cs.overflowY}`;
      if (/(hidden|clip)/.test(overflow)) {
        const r = cur.getBoundingClientRect();
        // Report which sides intrude into the element's slack-expanded
        // paint rect. Positive → the ancestor edge crosses inside the
        // ring band and would clip.
        const clipped: string[] = [];
        if (r.left > rect.left - slack)
          clipped.push(`left(anc=${r.left.toFixed(1)} el=${rect.left.toFixed(1)})`);
        if (r.top > rect.top - slack)
          clipped.push(`top(anc=${r.top.toFixed(1)} el=${rect.top.toFixed(1)})`);
        if (r.right < rect.right + slack)
          clipped.push(`right(anc=${r.right.toFixed(1)} el=${rect.right.toFixed(1)})`);
        if (r.bottom < rect.bottom + slack)
          clipped.push(`bottom(anc=${r.bottom.toFixed(1)} el=${rect.bottom.toFixed(1)})`);
        return { tag: cur.tagName.toLowerCase(), overflow, clipped };
      }
      cur = cur.parentElement;
    }
    return null;
  }, FOCUS_RING_SLACK_PX);

  if (info && info.clipped.length) {
    failures.push(
      `${label}: focus ring clipped by <${info.tag}> (overflow "${info.overflow.trim()}") on ${info.clipped.join(", ")}`,
    );
  }
}

async function assertVisibleFocus(page: Page, el: Locator, label: string, failures: string[]) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const baseline = await readStyle(page, el);
  if (!baseline) {
    failures.push(`${label}: could not read baseline computed style`);
    return;
  }
  await keyboardFocus(page, el);
  const focused = await readStyle(page, el);
  if (!focused) {
    failures.push(`${label}: could not read focused computed style`);
    return;
  }
  if (!hasVisibleFocus(focused, baseline)) {
    failures.push(
      `${label}: no visible focus ring (outline:${focused.outlineStyle}/${focused.outlineWidth}/${focused.outlineColor}, box-shadow:${focused.boxShadow}, bg:${focused.backgroundColor})`,
    );
    return;
  }
  // Only outward-projecting indicators can be clipped by ancestor overflow.
  // `ring-inset` utilities, background highlights (Radix menuitem, cmdk
  // option), and border-only diffs stay inside the border-box.
  if (projectsOutward(focused, baseline)) {
    await assertNoRingClip(page, el, label, failures);
  }

  await el.hover({ force: true }).catch(() => {
    /* may re-scroll under overlay */
  });
  const afterHover = await readStyle(page, el);
  if (!afterHover || !hasVisibleFocus(afterHover, baseline)) {
    failures.push(
      `${label}: focus ring disappears on hover (box-shadow:${afterHover?.boxShadow ?? "n/a"}, bg:${afterHover?.backgroundColor ?? "n/a"})`,
    );
  }
}

async function primeTheme(page: Page, theme: Theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.addInitScript((t: Theme) => {
    try {
      localStorage.setItem("precise.theme", t);
    } catch {
      /* noop */
    }
  }, theme);
}

async function waitForShell(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.locator('[data-theme="ios"]').first().waitFor({ state: "attached", timeout: 15_000 });
  await page.waitForTimeout(300);
}

for (const vp of VIEWPORTS) {
  test.describe(`per-theme focus-visible audit (${vp.label})`, () => {
    test.skip(
      !authAvailable(),
      "Requires an injected Supabase session (LOVABLE_BROWSER_AUTH_STATUS=injected).",
    );
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const theme of THEMES) {
      test.describe(`theme: ${theme}`, () => {
        // Mobile-chrome tests only make sense strictly below the md
        // breakpoint. At 768px the shell swaps back to the desktop
        // sidebar and the bottom nav / FAB / slide-in drawer are not
        // rendered — audit them under the desktop spec instead.
        //
        // IMPORTANT: this is a compile-time branch that omits the two
        // mobile-chrome suites at 768×1024 (because their DOM does not
        // exist), NOT a shortcut for skipping viewport-geometry checks.
        // Do not extend this branch to gate the notifications /
        // command-dialog audits at 768×1024. See the "No-skip policy
        // at 768×1024" block at the top of this file.
        if (vp.hasMobileChrome) {
          test("bottom tab bar + FAB paint & retain a focus ring without clipping", async ({
            context,
            page,
          }) => {
            await primeTheme(page, theme);
            await restoreSupabaseSession(context, page);
            await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
            await waitForShell(page);

            // Sanity: mobile chrome attached, desktop sidebar hidden.
            const bottomNav = page.locator("[data-mobile-bottom-nav]");
            await expect(bottomNav).toBeVisible();
            await expect(page.locator('aside[aria-label="Primary sidebar"]')).toBeHidden();

            const failures: string[] = [];

            const tabs = bottomNav.locator("a,button");
            const tabCount = await tabs.count();
            expect(tabCount, "bottom tab bar should expose 5 tap targets").toBe(5);
            for (let i = 0; i < tabCount; i++) {
              const tab = tabs.nth(i);
              const name =
                (await tab.getAttribute("aria-label")) ||
                (await tab.textContent())?.trim() ||
                `tab[${i}]`;
              await assertVisibleFocus(
                page,
                tab,
                `[${vp.label}/${theme}] bottom-nav "${name}"`,
                failures,
              );
            }

            const fab = page
              .getByRole("button", { name: /new booking|create booking|add booking/i })
              .last();
            if (await fab.count()) {
              await assertVisibleFocus(page, fab, `[${vp.label}/${theme}] FAB`, failures);
            }

            expect(
              failures,
              `focus-visible failures in mobile bottom chrome (${vp.label}/${theme}):\n${failures.join("\n")}`,
            ).toEqual([]);
          });

          test("slide-in drawer nav items paint focus ring inside sheet portal", async ({
            context,
            page,
          }) => {
            await primeTheme(page, theme);
            await restoreSupabaseSession(context, page);
            await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
            await waitForShell(page);

            await page
              .locator("[data-mobile-bottom-nav]")
              .getByRole("button", { name: /open navigation menu/i })
              .click();

            const drawer = page
              .getByRole("dialog")
              .filter({ hasText: /dashboard|bookings|payments/i })
              .first();
            await drawer.waitFor({ state: "visible", timeout: 5_000 });

            const failures: string[] = [];

            const wanted = [/dashboard/i, /bookings/i, /payments/i, /reports/i, /settings/i];
            for (const rx of wanted) {
              const item = drawer.getByRole("link", { name: rx }).first();
              if ((await item.count()) === 0) continue;
              const label = (await item.textContent())?.trim() || String(rx);
              await assertVisibleFocus(
                page,
                item,
                `[${vp.label}/${theme}] drawer "${label}"`,
                failures,
              );
            }

            expect(
              failures,
              `focus-visible failures inside mobile drawer (${vp.label}/${theme}):\n${failures.join("\n")}`,
            ).toEqual([]);
          });
        }

        test("⌘K command dialog input keeps an unclipped focus ring", async ({ context, page }) => {
          await primeTheme(page, theme);
          await restoreSupabaseSession(context, page);
          await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
          await waitForShell(page);

          // Hotkey path works regardless of viewport / trigger placement.
          await page.keyboard.press("Meta+k");
          const dialog = page.getByRole("dialog").first();
          await dialog.waitFor({ state: "visible", timeout: 5_000 });

          const failures: string[] = [];

          const searchbox = dialog
            .getByRole("combobox")
            .first()
            .or(dialog.locator("input").first());
          if (await searchbox.count()) {
            await assertVisibleFocus(
              page,
              searchbox.first(),
              `[${vp.label}/${theme}] command dialog input`,
              failures,
            );
          }

          expect(
            failures,
            `focus-visible failures inside command dialog (${vp.label}/${theme}):\n${failures.join("\n")}`,
          ).toEqual([]);
        });

        // Notifications dropdown — a small popover that at 320px lives
        // in an especially tight header row, and at 768px sits over
        // the newly-visible sidebar. Both configurations have historically
        // been prone to right-edge outline clipping.
        test("notifications dropdown trigger keeps focus ring unclipped", async ({
          context,
          page,
        }) => {
          await primeTheme(page, theme);
          await restoreSupabaseSession(context, page);
          await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
          await waitForShell(page);

          const bell = page.getByRole("button", { name: /view notifications/i }).first();
          if (!(await bell.count())) {
            // This skip is DOM-conditional (build has no notifications
            // trigger), NOT viewport-conditional. Do not widen it into
            // `if (!(await bell.count()) || vp.width >= 768)` or similar
            // — the 768×1024 clip regression that used to justify a
            // viewport skip is fixed and permanently guarded. See the
            // "No-skip policy at 768×1024" block in the file header.
            test.skip(true, "Notifications trigger not rendered on this build");
            return;
          }

          // Regression guard: the topbar cluster must keep the
          // notifications trigger fully inside the viewport at every
          // audited breakpoint. Historically at 768×1024 the bell used
          // to render past the shell's right edge (which is
          // `md:overflow-hidden`), producing false "focus ring clipped"
          // reports. That layout bug was fixed by tightening the
          // header controls at md (see AppShell topbar), so we now
          // ASSERT the invariant instead of skipping.
          const rect = await bell.evaluate((el) => {
            const r = (el as HTMLElement).getBoundingClientRect();
            return { left: r.left, right: r.right, viewport: window.innerWidth };
          });
          expect(
            rect.right,
            `Notifications trigger must not overflow viewport at ${vp.label} ` +
              `(left=${rect.left.toFixed(1)}, right=${rect.right.toFixed(1)}, vw=${rect.viewport}).`,
          ).toBeLessThanOrEqual(rect.viewport);
          expect(rect.left).toBeGreaterThanOrEqual(0);

          const failures: string[] = [];
          await assertVisibleFocus(
            page,
            bell,
            `[${vp.label}/${theme}] notifications trigger`,
            failures,
          );

          expect(
            failures,
            `focus-visible failures on notifications trigger (${vp.label}/${theme}):\n${failures.join("\n")}`,
          ).toEqual([]);
        });
      });
    }
  });
}
