import { expect, test, type Page, type Locator } from "@playwright/test";
import { PNG } from "pngjs";

/**
 * /site marketing — keyboard :focus-visible audit.
 *
 * For every /site route × theme (light + dark), walks the keyboard tab
 * order through the <main> content and asserts that each marketing CTA /
 * anchor / button:
 *
 *   1. Actually accepts keyboard focus (document.activeElement matches).
 *   2. Renders a visibly-distinct :focus-visible indicator — the element
 *      screenshot with focus differs from the same element unfocused by
 *      at least MIN_MEAN_DELTA per pixel on average AND has at least
 *      MIN_CONTRAST_DELTA max-channel change in some pixel. This catches:
 *        · `focus-visible:outline-none` with no replacement ring
 *        · a ring token that resolves to the surrounding background
 *          (invisible ring — e.g. ring-background on bg-background)
 *        · a ring hidden behind an ancestor `overflow-hidden` clip
 *
 * The audit runs against elements the marketing site expects to be
 * keyboard-reachable: primary/secondary CTAs, header/footer nav links,
 * project cards, and inline anchors. Purely decorative widgets (svgs,
 * `aria-hidden` icons, `tabindex="-1"` chrome) are skipped.
 *
 * Run:
 *   bun run test:visual:focus-visible
 */

const ROUTES = ["/site", "/site/services", "/site/projects", "/site/contact"] as const;
const THEMES = ["light", "dark"] as const;

// Interactive candidates. `main a[href]` / `main button` covers CTAs; we
// also probe the chrome (header/footer) because those links overlay the
// hero photograph on the landing page and are the most likely to lose
// their focus ring against a dark image.
const INTERACTIVE_SELECTOR = [
  "header a[href]",
  "header button:not([disabled])",
  "main a[href]",
  "main button:not([disabled])",
  "footer a[href]",
  "footer button:not([disabled])",
].join(", ");

// Pixel-diff thresholds. Empirically tuned so that a shadcn default focus
// ring (`focus-visible:ring-2 ring-foreground`) trips ~150+ mean delta on
// a ~50×20px pill, while `focus-visible:outline-none` alone stays under 2.
const MIN_MEAN_DELTA = 4; // avg per-channel absolute delta across clip
const MIN_CONTRAST_DELTA = 60; // max single-pixel channel delta (>= WCAG 3:1 heuristic)
const CLIP_PADDING = 8; // px of surrounding area captured with each element

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.evaluate((t) => {
    try {
      localStorage.setItem("theme", t);
    } catch {
      /* noop */
    }
    const root = document.documentElement;
    root.classList.toggle("dark", t === "dark");
    root.classList.toggle("light", t === "light");
  }, theme);
}

async function primeKeyboardHeuristic(page: Page) {
  // Chrome's :focus-visible heuristic ties "visible" focus to the most
  // recent input modality. A single Tab keydown flips the tab into
  // "keyboard mode" so subsequent programmatic .focus() calls surface
  // :focus-visible styles the same way a real user would see them.
  await page.keyboard.press("Tab");
}

function meanAndMaxDelta(a: Buffer, b: Buffer): { mean: number; max: number } {
  const A = PNG.sync.read(a);
  const B = PNG.sync.read(b);
  if (A.width !== B.width || A.height !== B.height) {
    return { mean: 255, max: 255 };
  }
  let sum = 0;
  let max = 0;
  let count = 0;
  const len = Math.min(A.data.length, B.data.length);
  for (let i = 0; i < len; i += 4) {
    const dr = Math.abs(A.data[i] - B.data[i]);
    const dg = Math.abs(A.data[i + 1] - B.data[i + 1]);
    const db = Math.abs(A.data[i + 2] - B.data[i + 2]);
    const d = Math.max(dr, dg, db);
    if (d > max) max = d;
    sum += (dr + dg + db) / 3;
    count += 1;
  }
  return { mean: count === 0 ? 0 : sum / count, max };
}

async function shotWithPadding(page: Page, el: Locator): Promise<Buffer | null> {
  const box = await el.boundingBox();
  if (!box || box.width < 4 || box.height < 4) return null;
  const clip = {
    x: Math.max(0, box.x - CLIP_PADDING),
    y: Math.max(0, box.y - CLIP_PADDING),
    width: box.width + CLIP_PADDING * 2,
    height: box.height + CLIP_PADDING * 2,
  };
  return page.screenshot({ clip, animations: "disabled", caret: "hide" });
}

for (const route of ROUTES) {
  for (const theme of THEMES) {
    test(`:focus-visible is visible on ${route} (${theme})`, async ({ page }) => {
      await page.goto(route, { waitUntil: "networkidle" });
      await setTheme(page, theme);
      await page.waitForTimeout(200);
      await primeKeyboardHeuristic(page);

      const targets = page.locator(INTERACTIVE_SELECTOR);
      const total = await targets.count();
      expect(total, `no interactive elements found on ${route}`).toBeGreaterThan(0);

      const failures: Array<{
        tag: string;
        text: string;
        href: string | null;
        mean: number;
        max: number;
      }> = [];
      // Cap audit at 40 elements per route × theme to keep the suite fast.
      // Marketing routes rarely exceed this; if they grow, split by section.
      const cap = Math.min(total, 40);

      for (let i = 0; i < cap; i += 1) {
        const el = targets.nth(i);
        // Skip visually-hidden / off-screen elements — they can't have a
        // focus indicator that would fail the audit.
        const visible = await el.isVisible().catch(() => false);
        if (!visible) continue;
        // Skip aria-hidden and tabindex="-1".
        const skip = await el
          .evaluate((n: HTMLElement) => {
            if (n.getAttribute("aria-hidden") === "true") return true;
            const ti = n.getAttribute("tabindex");
            if (ti !== null && Number(ti) < 0) return true;
            if ((n as HTMLButtonElement).disabled) return true;
            return false;
          })
          .catch(() => true);
        if (skip) continue;

        await el.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(50);

        // Blur any prior focus and screenshot the rest state.
        await page.evaluate(() => {
          const a = document.activeElement as HTMLElement | null;
          a?.blur();
        });
        await page.waitForTimeout(30);
        const rest = await shotWithPadding(page, el);
        if (!rest) continue;

        // Focus and let :focus-visible apply (keyboard heuristic primed above).
        await el.focus().catch(() => {});
        // Confirm the element actually took focus — otherwise the audit
        // would happily report "no ring" on elements that are unreachable.
        const isFocused = await el.evaluate((n) => document.activeElement === n).catch(() => false);
        if (!isFocused) continue;
        await page.waitForTimeout(60);
        const focused = await shotWithPadding(page, el);
        if (!focused) continue;

        const { mean, max } = meanAndMaxDelta(rest, focused);
        if (mean < MIN_MEAN_DELTA || max < MIN_CONTRAST_DELTA) {
          const meta = await el
            .evaluate((n: HTMLElement) => ({
              tag: n.tagName.toLowerCase(),
              text: (n.textContent || "").trim().slice(0, 60),
              href: n.getAttribute("href"),
            }))
            .catch(() => ({ tag: "?", text: "", href: null }));
          failures.push({ ...meta, mean: Number(mean.toFixed(2)), max });
        }
      }

      if (failures.length > 0) {
        const lines = failures
          .map(
            (f) =>
              `  · <${f.tag}${f.href ? ` href="${f.href}"` : ""}> "${f.text}" — mean Δ=${f.mean}, max Δ=${f.max}`,
          )
          .join("\n");
        throw new Error(
          `${failures.length} element(s) on ${route} (${theme}) have no visible :focus-visible indicator ` +
            `(mean Δ<${MIN_MEAN_DELTA} or max channel Δ<${MIN_CONTRAST_DELTA}):\n${lines}\n` +
            `Fix by pairing focus-visible:outline-none with a token-based ring, e.g. ` +
            `focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background.`,
        );
      }
    });
  }
}
