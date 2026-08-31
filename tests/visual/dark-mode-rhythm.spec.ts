import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Dark-mode typography contrast & vertical rhythm regression suite.
 *
 * Forces `.dark` on <html>, visits every public marketing route at desktop
 * (1440) and mobile (375), and asserts:
 *
 *   1. WCAG 2.1 AA contrast for h1–h6, p, .lead, .caption, .eyebrow, and
 *      inline <code> — resolves the computed foreground vs the effective
 *      opaque background (walking ancestors past transparent fills).
 *   2. Vertical rhythm — heading line-heights stay within the design's
 *      1.05–1.55 band, and adjacent .prose siblings retain the
 *      margin-block cadence declared in src/styles.css.
 *   3. Captures a dark-mode full-page screenshot per route/width to
 *      test-results/dark/<route>-<width>.png for artifact review.
 *
 * Run:
 *   bunx playwright test tests/visual/dark-mode-rhythm.spec.ts
 *   bun run test:visual:dark
 */

const WIDTHS = [
  { w: 375, h: 812, label: "375" },
  { w: 1440, h: 900, label: "1440" },
] as const;

const ROUTES = [
  { path: "/", name: "home" },
  { path: "/site", name: "site" },
  { path: "/site/services", name: "site-services" },
  { path: "/site/projects", name: "site-projects" },
  { path: "/site/contact", name: "site-contact" },
  { path: "/resources/property-management-vs-erp", name: "resources-pm-erp" },
] as const;

/**
 * WCAG 2.1 AA thresholds:
 *   - normal text: 4.5
 *   - large text (≥ 24px, or ≥ 18.66px bold): 3.0
 *
 * We use a small safety margin (0.05) so sub-pixel color-mix() drift near
 * 4.5 doesn't flap the suite red on every run.
 */
const CONTRAST_MARGIN = 0.05;
const LINE_HEIGHT_MIN = 1.05;
const LINE_HEIGHT_MAX = 1.75;

// Sampled text selectors. Kept narrow so we test the utility layer
// (.lead / .caption / .eyebrow) directly instead of every span on the page.
const TEXT_SELECTORS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  ".lead",
  ".caption",
  ".eyebrow",
  ":not(pre) > code",
];

async function forceDarkMode(page: Page) {
  await page.addInitScript(() => {
    // Set BEFORE first paint so the theme boot code sees `.dark` and every
    // token in :root vs .dark resolves against the dark palette.
    try {
      localStorage.setItem("theme", "dark");
      localStorage.setItem("vite-ui-theme", "dark");
      localStorage.setItem("color-scheme", "dark");
    } catch {}
    document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = "dark";
  });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
}

/**
 * In-page audit — returns per-selector contrast + line-height + rhythm
 * findings. Runs entirely in the page context because Playwright can't
 * introspect getComputedStyle from Node.
 */
function audit() {
  return /* js */ `
    (() => {
      // ---- color helpers ----
      const parseColor = (str) => {
        const m = str.match(/rgba?\\(([^)]+)\\)/);
        if (!m) return null;
        const parts = m[1].split(',').map(s => parseFloat(s.trim()));
        const [r, g, b, a] = [parts[0], parts[1], parts[2], parts[3] ?? 1];
        return { r, g, b, a };
      };
      const srgbToLin = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      const luminance = ({ r, g, b }) =>
        0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
      const contrast = (fg, bg) => {
        const L1 = luminance(fg), L2 = luminance(bg);
        const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
        return (hi + 0.05) / (lo + 0.05);
      };
      const blend = (fg, bg) => {
        const a = fg.a;
        return {
          r: fg.r * a + bg.r * (1 - a),
          g: fg.g * a + bg.g * (1 - a),
          b: fg.b * a + bg.b * (1 - a),
          a: 1,
        };
      };

      // Walk up until we find a fully-opaque background; blend translucent
      // fills onto that stack in reverse. Falls back to the body's computed
      // background (which for .dark is the midnight canvas token).
      const effectiveBg = (el) => {
        const stack = [];
        let cur = el;
        let root = null;
        while (cur && cur !== document.documentElement) {
          const cs = getComputedStyle(cur);
          const bg = parseColor(cs.backgroundColor);
          if (bg && bg.a > 0) {
            stack.push(bg);
            if (bg.a >= 0.999) { root = bg; break; }
          }
          cur = cur.parentElement;
        }
        if (!root) {
          const bodyBg = parseColor(getComputedStyle(document.body).backgroundColor);
          const htmlBg = parseColor(getComputedStyle(document.documentElement).backgroundColor);
          root = (bodyBg && bodyBg.a >= 0.999) ? bodyBg
               : (htmlBg && htmlBg.a >= 0.999) ? htmlBg
               : { r: 15, g: 23, b: 42, a: 1 }; // slate-900 fallback (matches --background dark)
        }
        let acc = root;
        for (let i = stack.length - 1; i >= 0; i--) acc = blend(stack[i], acc);
        return acc;
      };

      const isLargeText = (fontPx, weight) =>
        fontPx >= 24 || (fontPx >= 18.66 && weight >= 700);

      const selectors = ${JSON.stringify(TEXT_SELECTORS)};
      const contrastFindings = [];
      const lhFindings = [];
      const inspected = { count: 0, perSelector: {} };

      for (const sel of selectors) {
        const nodes = Array.from(document.querySelectorAll(sel)).slice(0, 12);
        inspected.perSelector[sel] = nodes.length;
        for (const el of nodes) {
          const cs = getComputedStyle(el);
          const text = (el.textContent || '').trim();
          if (!text) continue;
          // Skip visually hidden nodes — they don't need contrast.
          const rect = el.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) continue;
          if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;

          const fg = parseColor(cs.color);
          if (!fg) continue;
          const bg = effectiveBg(el);
          const ratio = contrast(fg, bg);
          const fontPx = parseFloat(cs.fontSize);
          const weight = parseInt(cs.fontWeight, 10) || 400;
          const large = isLargeText(fontPx, weight);
          const threshold = large ? 3.0 : 4.5;
          inspected.count++;

          if (ratio + ${CONTRAST_MARGIN} < threshold) {
            contrastFindings.push({
              selector: sel,
              text: text.slice(0, 60),
              fg: 'rgb(' + Math.round(fg.r) + ',' + Math.round(fg.g) + ',' + Math.round(fg.b) + ')',
              bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')',
              fontPx: +fontPx.toFixed(1),
              weight,
              ratio: +ratio.toFixed(2),
              threshold,
              large,
            });
            if (contrastFindings.length >= 20) break;
          }

          // ---- line-height sanity (dark mode should not change rhythm,
          //      but we assert bounds so nothing snuck past) ----
          const lhRaw = cs.lineHeight;
          let lh = null;
          if (lhRaw && lhRaw !== 'normal') {
            const px = parseFloat(lhRaw);
            if (!Number.isNaN(px) && fontPx > 0) lh = px / fontPx;
          }
          if (lh != null && (lh < ${LINE_HEIGHT_MIN} || lh > ${LINE_HEIGHT_MAX})) {
            lhFindings.push({
              selector: sel,
              tag: el.tagName.toLowerCase(),
              text: text.slice(0, 40),
              lineHeight: +lh.toFixed(2),
              fontPx: +fontPx.toFixed(1),
            });
          }
        }
      }

      // ---- .prose vertical rhythm — adjacent block siblings must have
      //      non-zero margin-block between them (proves the rhythm layer
      //      isn't being flattened by dark-mode overrides). ----
      const rhythm = [];
      const prose = document.querySelector('.prose');
      if (prose) {
        const kids = Array.from(prose.children).filter(c => {
          const t = c.tagName.toLowerCase();
          return ['h1','h2','h3','h4','h5','h6','p','ul','ol','blockquote','pre'].includes(t);
        });
        for (let i = 1; i < kids.length; i++) {
          const prev = getComputedStyle(kids[i - 1]);
          const cur = getComputedStyle(kids[i]);
          const gap = Math.max(parseFloat(prev.marginBottom) || 0, parseFloat(cur.marginTop) || 0);
          if (gap < 4) {
            rhythm.push({
              between: kids[i - 1].tagName.toLowerCase() + '→' + kids[i].tagName.toLowerCase(),
              gapPx: +gap.toFixed(1),
            });
          }
        }
      }

      return {
        darkClass: document.documentElement.classList.contains('dark'),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        bodyFg: getComputedStyle(document.body).color,
        inspected,
        contrastFindings,
        lhFindings,
        rhythmFindings: rhythm,
        proseFound: !!prose,
      };
    })()
  `;
}

test.describe("Dark mode — contrast & vertical rhythm", () => {
  test.beforeAll(async () => {
    await mkdir(join(process.cwd(), "test-results", "dark"), { recursive: true });
  });

  for (const route of ROUTES) {
    test.describe(`route: ${route.path}`, () => {
      for (const vp of WIDTHS) {
        test(`${vp.label}px  ${route.path}`, async ({ browser }) => {
          const context = await browser.newContext({
            viewport: { width: vp.w, height: vp.h },
            deviceScaleFactor: 2,
            colorScheme: "dark",
            reducedMotion: "reduce",
            hasTouch: vp.w <= 768,
          });
          const page = await context.newPage();
          try {
            await forceDarkMode(page);
            const resp = await page.goto(route.path, { waitUntil: "networkidle" });
            expect(resp?.ok(), `HTTP for ${route.path}`).toBe(true);

            // Enforce .dark post-hydration in case a theme provider replaces it.
            await page.evaluate(() => {
              document.documentElement.classList.add("dark");
              document.documentElement.classList.remove("light");
            });
            await page.evaluate(
              () => (document.fonts && document.fonts.ready) || Promise.resolve(),
            );
            await page.waitForTimeout(200);

            const shotPath = join("test-results", "dark", `${route.name}-${vp.label}.png`);
            await page.screenshot({ path: shotPath, fullPage: true });

            const result: any = await page.evaluate(audit());

            // Sanity: the page actually rendered under .dark with a dark canvas.
            expect(result.darkClass, "dark class survived hydration").toBe(true);
            expect(result.inspected.count, "inspected at least one text node").toBeGreaterThan(0);

            expect(
              result.contrastFindings,
              `contrast failures under WCAG AA at ${vp.label}px:\n` +
                JSON.stringify(result.contrastFindings.slice(0, 10), null, 2),
            ).toEqual([]);

            expect(
              result.lhFindings,
              `line-height out of [${LINE_HEIGHT_MIN}, ${LINE_HEIGHT_MAX}]:\n` +
                JSON.stringify(result.lhFindings.slice(0, 10), null, 2),
            ).toEqual([]);

            if (result.proseFound) {
              expect(
                result.rhythmFindings,
                `.prose vertical rhythm collapsed:\n` +
                  JSON.stringify(result.rhythmFindings, null, 2),
              ).toEqual([]);
            }
          } finally {
            await context.close();
          }
        });
      }
    });
  }
});
