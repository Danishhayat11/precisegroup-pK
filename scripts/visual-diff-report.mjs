#!/usr/bin/env node
/**
 * Visual-diff report generator.
 *
 * Playwright's `toHaveScreenshot` writes three PNGs into `test-results/`
 * whenever a screenshot assertion fails:
 *
 *   <name>-expected.png   ← the committed baseline
 *   <name>-actual.png     ← what the current build actually rendered
 *   <name>-diff.png       ← per-pixel diff heat-map (red = changed)
 *
 * They're easy to miss in raw CI logs. This script:
 *
 *   1. Walks `test-results/`, groups the three PNGs per failing shot.
 *   2. Composes a side-by-side triptych PNG per failure
 *      (`expected | actual | diff`) with captions burned in, so a
 *      single image tells the whole story.
 *   3. Writes a markdown index (`index.md`) and a self-contained
 *      HTML index (`index.html`, images embedded as data-URIs so it
 *      opens anywhere, no server needed).
 *   4. Emits a GitHub-Actions step-summary snippet
 *      (`step-summary.md`) with the triptychs inlined as base64
 *      data-URIs so reviewers see every regression on the run page
 *      without downloading anything.
 *
 * Usage:
 *   node scripts/visual-diff-report.mjs
 *
 * Flags:
 *   --input <dir>     Playwright output dir. Default: test-results
 *   --output <dir>    Report dir. Default: visual-diff-report
 *   --summary <file>  GitHub step-summary path. Default: $GITHUB_STEP_SUMMARY
 *                     if set, else <output>/step-summary.md.
 *
 * Exit code is 0 even when diffs exist — this is a reporter, not an
 * assertion. The test job itself owns pass/fail.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}
const INPUT = path.resolve(args.get("input") ?? "test-results");
const OUTPUT = path.resolve(args.get("output") ?? "visual-diff-report");
const THRESHOLDS_PATH = path.resolve(
  args.get("thresholds") ?? "tests/visual/thresholds.config.json",
);
const SUMMARY_PATH =
  args.get("summary") ?? process.env.GITHUB_STEP_SUMMARY ?? path.join(OUTPUT, "step-summary.md");

/**
 * Load the same per-test threshold config the specs consume. We can't
 * import the .ts helper from a plain .mjs script, so we re-implement
 * the lookup here — it's ~30 lines and keeps the report free of a TS
 * build step. Config schema is documented in `_thresholds.ts`.
 */
async function loadThresholds() {
  try {
    const raw = await fs.readFile(THRESHOLDS_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { default: {}, tests: {} };
  }
}
function globToRegex(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}
function stripMeta(o) {
  if (!o) return {};
  const { _why, ...rest } = o;
  return rest;
}
function budgetFor(cfg, specRel, screenshotName) {
  const testCfg = specRel ? cfg.tests?.[specRel] : undefined;
  let matched;
  if (testCfg?.screenshots) {
    for (const [glob, budget] of Object.entries(testCfg.screenshots)) {
      if (globToRegex(glob).test(screenshotName)) {
        matched = budget;
        break;
      }
    }
  }
  return {
    ...stripMeta(cfg.default),
    ...stripMeta(testCfg?.default),
    ...stripMeta(matched),
    _why: matched?._why ?? testCfg?.default?._why ?? cfg.default?._why,
  };
}
/**
 * Playwright emits `<name>-diff.png` where changed pixels are painted
 * magenta / red on a transparent bg. Counting non-zero-alpha pixels is
 * a good-enough approximation of the diff count for the report table.
 */
function countDiffPixels(png) {
  let n = 0;
  for (let i = 3; i < png.data.length; i += 4) {
    if (png.data[i] > 0) n++;
  }
  return n;
}

const GAP = 12; // px between panels
const CAPTION_H = 22; // px caption strip height
const BG = [255, 255, 255, 255];
const CAPTION_BG = [17, 24, 39, 255]; // slate-900
const CAPTION_FG = [255, 255, 255, 255];

/** Recursively walk a dir; yield absolute file paths. */
async function* walk(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

/**
 * Group the three sibling PNGs Playwright emits per failing screenshot.
 * File naming pattern is `<name>-expected.png | -actual.png | -diff.png`.
 */
async function collect(root) {
  const groups = new Map(); // key = dir + name-stem
  for await (const p of walk(root)) {
    const base = path.basename(p);
    const m = base.match(/^(.*)-(expected|actual|diff)\.png$/);
    if (!m) continue;
    const key = path.join(path.dirname(p), m[1]);
    const g = groups.get(key) ?? { dir: path.dirname(p), name: m[1] };
    g[m[2]] = p;
    groups.set(key, g);
  }
  return [...groups.values()].filter((g) => g.expected && g.actual && g.diff);
}

/** Read a PNG file into a pngjs instance. */
async function readPng(p) {
  const buf = await fs.readFile(p);
  return PNG.sync.read(buf);
}

/** Blit `src` onto `dst` at (x, y). Assumes same 4-byte RGBA layout. */
function blit(dst, src, x, y) {
  for (let row = 0; row < src.height; row++) {
    const srcStart = row * src.width * 4;
    const dstStart = ((y + row) * dst.width + x) * 4;
    src.data.copy(dst.data, dstStart, srcStart, srcStart + src.width * 4);
  }
}

/** Fill a rectangle with an RGBA color. */
function fillRect(png, x, y, w, h, [r, g, b, a]) {
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = ((y + row) * png.width + x + col) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = a;
    }
  }
}

/**
 * Minimal 5x7 bitmap font for caption strips. Only glyphs we need:
 * uppercase A-Z, digits, space, dash, dot. Missing glyphs render as
 * a small square so we notice.
 * Each glyph = 5 columns × 7 rows, bits packed row-major, MSB-left.
 */
const GLYPHS = /** @type {Record<string, number[]>} */ ({
  " ": [0, 0, 0, 0, 0, 0, 0],
  "-": [0, 0, 0, 0b11111, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0, 0b00110],
  "|": [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  C: [0b01111, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b01111],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  I: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
});

function drawText(png, text, x, y, fg = CAPTION_FG, scale = 2) {
  const upper = text.toUpperCase();
  const gw = 5;
  const gh = 7;
  const spacing = 1;
  let cx = x;
  for (const ch of upper) {
    const g = GLYPHS[ch] ?? GLYPHS[" "];
    for (let row = 0; row < gh; row++) {
      const bits = g[row];
      for (let col = 0; col < gw; col++) {
        if (bits & (1 << (gw - 1 - col))) {
          fillRect(png, cx + col * scale, y + row * scale, scale, scale, fg);
        }
      }
    }
    cx += (gw + spacing) * scale;
  }
}

/**
 * Build a triptych PNG:  [EXPECTED | ACTUAL | DIFF]
 * with a caption strip above each panel. All three panels are scaled to
 * the SAME width (max of the three) and heights are kept as-is (they
 * will match because Playwright compares equal-sized images).
 */
function makeTriptych(expected, actual, diff) {
  const w = Math.max(expected.width, actual.width, diff.width);
  const h = Math.max(expected.height, actual.height, diff.height);
  const totalW = w * 3 + GAP * 2;
  const totalH = h + CAPTION_H;
  const out = new PNG({ width: totalW, height: totalH });
  fillRect(out, 0, 0, totalW, totalH, BG);
  // Caption strip
  fillRect(out, 0, 0, totalW, CAPTION_H, CAPTION_BG);
  const labelX = (panel) => panel * (w + GAP) + 8;
  drawText(out, "EXPECTED", labelX(0), 4);
  drawText(out, "ACTUAL", labelX(1), 4);
  drawText(out, "DIFF", labelX(2), 4);
  // Panels
  blit(out, expected, 0, CAPTION_H);
  blit(out, actual, w + GAP, CAPTION_H);
  blit(out, diff, (w + GAP) * 2, CAPTION_H);
  return out;
}

function slugify(s) {
  return s.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_|_$/g, "");
}

async function main() {
  const groups = await collect(INPUT);
  const thresholds = await loadThresholds();
  if (groups.length === 0) {
    console.log(`[visual-diff-report] no diffs found under ${INPUT}`);
    // Still write an empty report so downstream steps have a stable path.
    await fs.mkdir(OUTPUT, { recursive: true });
    await fs.writeFile(
      path.join(OUTPUT, "index.md"),
      "# Visual diff report\n\nNo failing screenshots — all baselines match.\n",
    );
    await fs.writeFile(
      SUMMARY_PATH,
      "### Visual regression — mobile primitives\n\n✅ All baselines match. No diffs to review.\n",
      { flag: process.env.GITHUB_STEP_SUMMARY ? "a" : "w" },
    );
    return;
  }

  await fs.mkdir(OUTPUT, { recursive: true });
  const items = [];
  for (const g of groups) {
    const [expected, actual, diff] = await Promise.all([
      readPng(g.expected),
      readPng(g.actual),
      readPng(g.diff),
    ]);
    const tri = makeTriptych(expected, actual, diff);
    const outName = `${slugify(g.name)}-triptych.png`;
    const outPath = path.join(OUTPUT, outName);
    await fs.writeFile(outPath, PNG.sync.write(tri));
    const relDir = path.relative(process.cwd(), g.dir);

    // Attribute the diff to its spec so we can look up the right budget.
    // Playwright's `test-results/<spec>-<title>/…` layout means the first
    // path segment under test-results is spec-derived; we scan the loaded
    // config for a matching spec key by suffix.
    const relFromRoot = path.relative(process.cwd(), g.dir).replace(/\\/g, "/");
    const specKey = Object.keys(thresholds.tests ?? {}).find((k) => {
      const base = path.basename(k, path.extname(k));
      return relFromRoot.includes(base);
    });
    const shotFile = `${g.name}.png`;
    const budget = budgetFor(thresholds, specKey, shotFile);
    const diffPixels = countDiffPixels(diff);
    const totalPixels = diff.width * diff.height;
    const diffRatio = totalPixels ? diffPixels / totalPixels : 0;
    const withinRatio = budget.maxDiffPixelRatio == null || diffRatio <= budget.maxDiffPixelRatio;
    const withinAbs = budget.maxDiffPixels == null || diffPixels <= budget.maxDiffPixels;
    const withinBudget = withinRatio && withinAbs;

    items.push({
      name: g.name,
      dir: relDir,
      file: outName,
      base64: PNG.sync.write(tri).toString("base64"),
      spec: specKey ?? "(unmatched)",
      budget,
      diffPixels,
      diffRatio,
      withinBudget,
    });
    console.log(
      `[visual-diff-report] wrote ${outPath} — ${diffPixels}px (${(diffRatio * 100).toFixed(3)}%), budget=${JSON.stringify(
        { r: budget.maxDiffPixelRatio, p: budget.maxDiffPixels, t: budget.threshold },
      )}, ${withinBudget ? "within" : "OVER"}`,
    );
  }

  const fmtBudget = (b) => {
    const parts = [];
    if (b.maxDiffPixelRatio != null)
      parts.push(`ratio ≤ ${(b.maxDiffPixelRatio * 100).toFixed(3)}%`);
    if (b.maxDiffPixels != null) parts.push(`≤ ${b.maxDiffPixels}px`);
    if (b.threshold != null) parts.push(`AA threshold ${b.threshold}`);
    return parts.join(", ") || "(default)";
  };

  // Markdown index (for local review)
  const md = [
    "# Visual diff report",
    "",
    `${items.length} failing screenshot${items.length === 1 ? "" : "s"}. Each triptych shows **EXPECTED | ACTUAL | DIFF** side by side.`,
    "",
    "Per-item pixel-diff budget is resolved from `tests/visual/thresholds.config.json` — bump the entry for a spec/screenshot instead of adding inline options in the test file.",
    "",
    ...items.flatMap((it) => [
      `## ${it.name}  ${it.withinBudget ? "🟡 within budget" : "🔴 over budget"}`,
      `Source: \`${it.dir}\``,
      `Spec: \`${it.spec}\``,
      `Diff: **${it.diffPixels}px** (${(it.diffRatio * 100).toFixed(3)}%) · Budget: ${fmtBudget(it.budget)}${it.budget._why ? ` — _${it.budget._why}_` : ""}`,
      "",
      `![${it.name}](./${it.file})`,
      "",
    ]),
  ].join("\n");
  await fs.writeFile(path.join(OUTPUT, "index.md"), md);

  // Self-contained HTML index (images inline; opens with a double-click)
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Visual diff report</title>
<style>
  body { font: 14px/1.5 -apple-system, Segoe UI, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 24px; }
  h1 { margin: 0 0 8px; }
  .item { margin: 24px 0; background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 16px; }
  .item h2 { margin: 0 0 4px; font-size: 15px; }
  .item .dir { color: #94a3b8; font-family: ui-monospace, monospace; font-size: 12px; margin-bottom: 12px; }
  img { max-width: 100%; height: auto; border: 1px solid #334155; border-radius: 4px; display: block; }
</style></head><body>
<h1>Visual diff report</h1>
<p>${items.length} failing screenshot${items.length === 1 ? "" : "s"} — <b>expected | actual | diff</b>.</p>
${items
  .map(
    (it) => `<section class="item">
  <h2>${it.name} ${it.withinBudget ? '<span style="color:#fbbf24">🟡 within budget</span>' : '<span style="color:#f87171">🔴 over budget</span>'}</h2>
  <div class="dir">${it.dir} · ${it.spec}</div>
  <div class="dir">Diff: <b>${it.diffPixels}px</b> (${(it.diffRatio * 100).toFixed(3)}%) · Budget: ${fmtBudget(it.budget)}${it.budget._why ? ` — <i>${it.budget._why}</i>` : ""}</div>
  <img alt="${it.name}" src="data:image/png;base64,${it.base64}">
</section>`,
  )
  .join("\n")}
</body></html>`;
  await fs.writeFile(path.join(OUTPUT, "index.html"), html);

  // GitHub-Actions step summary (inline data-URI images; ≤1MB total).
  // Skip inlining if a single image is >200KB base64 to stay under GH's
  // 1MB summary cap — fall back to a link to the artifact.
  const LIMIT = 200 * 1024;
  const summary = [
    `### Visual regression — mobile primitives`,
    ``,
    `❌ ${items.length} screenshot${items.length === 1 ? " differs" : "s differ"} from the committed baseline. Full report uploaded as the **visual-diff-report** artifact.`,
    ``,
    ...items.flatMap((it) => {
      const inline = it.base64.length <= LIMIT;
      const flag = it.withinBudget ? "🟡 within budget" : "🔴 over budget";
      return [
        `<details open><summary><b>${it.name}</b> — ${flag} · ${it.diffPixels}px (${(it.diffRatio * 100).toFixed(3)}%) · budget ${fmtBudget(it.budget)}</summary>`,
        ``,
        it.budget._why ? `_${it.budget._why}_` : ``,
        ``,
        inline
          ? `<img alt="${it.name}" src="data:image/png;base64,${it.base64}">`
          : `Image too large to inline — see the \`visual-diff-report\` artifact (\`${it.file}\`).`,
        ``,
        `</details>`,
        ``,
      ];
    }),
  ].join("\n");
  await fs.writeFile(SUMMARY_PATH, summary, {
    flag: process.env.GITHUB_STEP_SUMMARY ? "a" : "w",
  });

  // ── GitHub check annotations ─────────────────────────────────────────
  // Emit one `::error file=…` workflow command per failing screenshot so
  // reviewers see inline annotations on the PR's Files-changed tab
  // pointing straight at the committed baseline PNG. GitHub renders
  // these as "Files changed" comments AND as check annotations on the
  // PR summary — no extra job, no extra API call, no PAT needed
  // (the built-in `github-actions` bot writes them via stdout).
  //
  // The annotated file is the committed baseline (`<spec>-snapshots/<name>.png`),
  // because that is the file the author needs to look at (or re-baseline)
  // to resolve the diff. Absolute paths are collapsed to repo-relative
  // so GitHub can link them.
  //
  // Gated on GITHUB_ACTIONS so local runs of the script stay quiet.
  const annotate =
    args.get("annotate") === "true" ||
    args.get("annotate") === "1" ||
    process.env.GITHUB_ACTIONS === "true";
  if (annotate) {
    const repoRoot = process.cwd();
    for (const it of items) {
      // Playwright's snapshot dir convention: `<spec>-snapshots/<name>.png`.
      // We know the spec from `it.spec` (thresholds config key) — fall
      // back to the diff's own dir when the spec is unmatched so the
      // annotation still lands on a real file.
      const snapshotFile =
        it.spec && it.spec !== "(unmatched)"
          ? path
              .relative(repoRoot, path.join(repoRoot, `${it.spec}-snapshots`, `${it.name}.png`))
              .replace(/\\/g, "/")
          : it.dir.replace(/\\/g, "/");

      const severity = it.withinBudget ? "warning" : "error";
      const title = it.withinBudget
        ? `Visual diff within budget — ${it.name}`
        : `Visual regression — ${it.name}`;
      const message = [
        `${it.diffPixels}px differ (${(it.diffRatio * 100).toFixed(3)}%).`,
        `Budget: ${fmtBudget(it.budget)}.`,
        it.budget._why ? `Suppression rationale: ${it.budget._why}.` : "",
        `Triptych: visual-diff-report artifact → ${it.file}.`,
        it.withinBudget
          ? "Within threshold — no action required unless the diff represents a real regression."
          : "Re-baseline with `bun run test:visual:<suite>:update` if this is an intentional design change, otherwise fix the regression.",
      ]
        .filter(Boolean)
        .join(" ")
        // Escape workflow-command control characters (per GH docs):
        // %, \r, \n MUST be percent-encoded inside a single-line command.
        .replace(/%/g, "%25")
        .replace(/\r/g, "%0D")
        .replace(/\n/g, "%0A");

      // Single-line workflow command. `file` MUST be repo-relative for
      // GitHub to render the annotation on the diff view.
      process.stdout.write(
        `::${severity} file=${snapshotFile},title=${title.replace(/,/g, "%2C")}::${message}\n`,
      );
    }
    console.log(
      `[visual-diff-report] emitted ${items.length} GitHub annotation${items.length === 1 ? "" : "s"} (${items.filter((i) => !i.withinBudget).length} error, ${items.filter((i) => i.withinBudget).length} warning).`,
    );
  }

  console.log(
    `[visual-diff-report] ${items.length} diff(s); wrote ${OUTPUT}/{index.md,index.html} and step summary to ${SUMMARY_PATH}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
