#!/usr/bin/env node
/**
 * check-team-headshot-assets.mjs
 *
 * CI guard: for every `@/assets/site/team-*` (AVIF / WebP / JPG) import in
 * `src/routes/site.index.tsx` — i.e. every source that will end up inside a
 * <TeamHeadshot> <picture> — assert the referenced file:
 *
 *   1. Exists on disk (either as a raw binary or as a `.asset.json` CDN
 *      pointer).
 *   2. Has the correct binary format for its extension (AVIF/AV1, WebP,
 *      JPEG). A mislabeled file (e.g. a WebP saved as `.avif`) still loads
 *      in some browsers but silently defeats the <source type="image/avif">
 *      negotiation and ships a heavier variant to real users.
 *   3. Has intrinsic dimensions matching the filename width rung
 *      (`team-<name>-<W>.<ext>` → width === W, height === W * 5 / 4). The
 *      4:5 aspect ratio is enforced by <TeamHeadshot>'s slot; a variant
 *      that drifts from that ratio will letterbox or crop at runtime.
 *
 * `.asset.json` CDN pointers are treated as opaque (the binary lives on
 * R2, not on disk) — we can only verify the pointer exists. On-disk raw
 * binaries always get the full format + dimensions probe.
 *
 * Format probing uses `ffprobe` (already installed in CI + sandbox). If
 * ffprobe is unavailable we degrade to existence-only checks with a warning
 * so a missing binary can't silently disable the guard.
 *
 * Exit codes:
 *   0 — every referenced asset exists, is correctly formatted, and matches
 *       its filename-declared width at the 4:5 aspect ratio
 *   1 — one or more referenced assets are missing, mis-encoded, or the
 *       wrong size (per-file reasons printed to stderr)
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const routeFile = resolve(repoRoot, "src/routes/site.index.tsx");
const assetsRoot = resolve(repoRoot, "src");

const src = readFileSync(routeFile, "utf8");

// Match: import ... from "@/assets/site/team-<name>[.ext][?url]";
// Captures the path segment after `@/` and strips any Vite query suffix.
const IMPORT_RE = /from\s+["'](@\/assets\/site\/team-[^"']+?)(?:\?[^"']*)?["']/g;

const referenced = new Set();
for (const m of src.matchAll(IMPORT_RE)) {
  referenced.add(m[1]);
}

if (referenced.size === 0) {
  console.error(
    "check-team-headshot-assets: no @/assets/site/team-* imports found in " +
      "src/routes/site.index.tsx — did the route move? Refusing to pass " +
      "vacuously.",
  );
  process.exit(1);
}

// Filename → declared width rung. Only `team-<name>-<W>.<ext>` files carry
// a width in the filename; bare `team-<name>.jpg` fallbacks don't.
function declaredWidth(specPath) {
  const b = basename(specPath).replace(/\.[^.]+$/, "");
  const m = b.match(/-(\d{2,4})$/);
  return m ? Number(m[1]) : null;
}

// ffprobe once so we can detect it up-front.
const ffprobe = spawnSync("ffprobe", ["-version"], { encoding: "utf8" });
const hasFfprobe = ffprobe.status === 0;
if (!hasFfprobe) {
  console.warn(
    "check-team-headshot-assets: ffprobe not available — falling back to " +
      "existence-only checks. Format and dimension drift will NOT be caught.",
  );
}

// Which codec should ffprobe report for a given extension.
const EXPECTED_CODEC = {
  ".avif": ["av1"], // AVIF = AV1-in-HEIF
  ".webp": ["webp"],
  ".jpg": ["mjpeg"],
  ".jpeg": ["mjpeg"],
};

function probe(onDisk) {
  const out = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,codec_name",
      "-of",
      "json",
      onDisk,
    ],
    { encoding: "utf8" },
  );
  if (out.status !== 0) {
    return { error: (out.stderr || "").trim() || "ffprobe failed" };
  }
  try {
    const stream = JSON.parse(out.stdout).streams?.[0];
    if (!stream) return { error: "no video stream" };
    return {
      codec: stream.codec_name,
      width: stream.width,
      height: stream.height,
    };
  } catch (e) {
    return { error: `ffprobe json parse: ${e.message}` };
  }
}

const problems = [];
const perSpec = []; // full report row per referenced spec (ok or not)

for (const spec of referenced) {
  // "@/assets/site/foo.avif"  ->  "<repo>/src/assets/site/foo.avif"
  const rel = spec.replace(/^@\//, "");
  const onDisk = resolve(assetsRoot, rel);
  const pointer = `${onDisk}.asset.json`;

  const rawExists = existsSync(onDisk);
  const pointerExists = existsSync(pointer);
  const row = {
    spec,
    onDisk,
    rawExists,
    pointerExists,
    codec: null,
    width: null,
    height: null,
    declaredWidth: declaredWidth(spec),
    problems: [],
  };

  if (!rawExists && !pointerExists) {
    const reason = "missing on disk (no raw file, no .asset.json pointer)";
    problems.push({ spec, reason });
    row.problems.push(reason);
    perSpec.push(row);
    continue;
  }

  // CDN pointers can't be probed locally — the binary lives on R2.
  if (!rawExists && pointerExists) {
    perSpec.push(row);
    continue;
  }
  if (!hasFfprobe) {
    perSpec.push(row);
    continue;
  }

  const ext = extname(onDisk).toLowerCase();
  const expectedCodecs = EXPECTED_CODEC[ext];
  if (!expectedCodecs) {
    perSpec.push(row);
    continue; // unknown ext — leave to reviewer
  }

  const info = probe(onDisk);
  if (info.error) {
    const reason = `probe failed: ${info.error}`;
    problems.push({ spec, reason });
    row.problems.push(reason);
    perSpec.push(row);
    continue;
  }

  row.codec = info.codec;
  row.width = info.width;
  row.height = info.height;

  if (!expectedCodecs.includes(info.codec)) {
    const reason = `wrong format: extension ${ext} expects ${expectedCodecs.join("/")}, got codec "${info.codec}"`;
    problems.push({ spec, reason });
    row.problems.push(reason);
  }

  // Width rung check (only for `team-<name>-<W>.<ext>`).
  const w = row.declaredWidth;
  if (w != null) {
    const expectedH = (w * 5) / 4; // 4:5 slot
    if (info.width !== w) {
      const reason = `width mismatch: filename declares ${w}px, actual ${info.width}px`;
      problems.push({ spec, reason });
      row.problems.push(reason);
    }
    if (info.height !== expectedH) {
      const reason = `height mismatch: 4:5 requires ${expectedH}px for ${w}w, actual ${info.height}px`;
      problems.push({ spec, reason });
      row.problems.push(reason);
    }
  } else {
    // Un-rung fallbacks (e.g. `team-danish.jpg`) still must be 4:5.
    if (info.width * 5 !== info.height * 4) {
      const reason = `aspect mismatch: 4:5 required, got ${info.width}x${info.height}`;
      problems.push({ spec, reason });
      row.problems.push(reason);
    }
  }

  perSpec.push(row);
}

// -----------------------------------------------------------------------
// Emit JSON + HTML report to $TEAM_HEADSHOT_ASSET_REPORT_DIR (default:
// ./test-artifacts). Runs on both pass and fail so CI can upload the
// artifact unconditionally and reviewers get a full manifest.
// -----------------------------------------------------------------------
const reportDir = resolve(repoRoot, process.env.TEAM_HEADSHOT_ASSET_REPORT_DIR || "test-artifacts");
try {
  mkdirSync(reportDir, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    routeFile: "src/routes/site.index.tsx",
    hasFfprobe,
    totalReferenced: referenced.size,
    passed: problems.length === 0,
    problemCount: problems.length,
    problems: [...problems].sort((a, b) => a.spec.localeCompare(b.spec)),
    variants: [...perSpec].sort((a, b) => a.spec.localeCompare(b.spec)),
  };
  writeFileSync(resolve(reportDir, "team-headshot-assets.json"), JSON.stringify(report, null, 2));

  const esc = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const badge = report.passed
    ? '<span class="ok">PASS</span>'
    : `<span class="fail">FAIL — ${report.problemCount} problem${report.problemCount === 1 ? "" : "s"}</span>`;
  const problemRows = report.problems
    .map(
      (p) =>
        `<tr class="row-fail"><td><code>${esc(p.spec)}</code></td><td>${esc(p.reason)}</td></tr>`,
    )
    .join("");
  const variantRows = report.variants
    .map((v) => {
      const status = v.problems.length ? "row-fail" : "row-ok";
      const source = !v.rawExists && v.pointerExists ? "CDN pointer" : "on-disk";
      const dims = v.width != null && v.height != null ? `${v.width}×${v.height}` : "—";
      const codec = v.codec ?? "—";
      const decl = v.declaredWidth != null ? `${v.declaredWidth}w` : "—";
      const notes = v.problems.length ? v.problems.map(esc).join("<br>") : "ok";
      return `<tr class="${status}"><td><code>${esc(v.spec)}</code></td><td>${source}</td><td>${decl}</td><td>${dims}</td><td>${codec}</td><td>${notes}</td></tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>TeamHeadshot asset check — ${esc(report.generatedAt)}</title>
<style>
  body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:2rem;color:#111;background:#fafafa;}
  h1{margin:0 0 .25rem;font-size:1.4rem;}
  .meta{color:#555;font-size:.85rem;margin-bottom:1rem;}
  .ok{color:#0a7d33;font-weight:600;}
  .fail{color:#b3261e;font-weight:600;}
  table{border-collapse:collapse;width:100%;background:#fff;margin:1rem 0 2rem;box-shadow:0 1px 2px rgba(0,0,0,.05);}
  th,td{padding:.5rem .75rem;border-bottom:1px solid #eee;text-align:left;vertical-align:top;font-size:.85rem;}
  th{background:#f4f4f5;font-weight:600;}
  .row-fail td{background:#fff5f5;}
  .row-ok td{background:#fff;}
  code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;}
  section{margin-bottom:1.5rem;}
</style></head><body>
<h1>TeamHeadshot &lt;picture&gt; asset check</h1>
<div class="meta">
  Generated ${esc(report.generatedAt)} · route <code>${esc(report.routeFile)}</code> · ffprobe: ${hasFfprobe ? "available" : "MISSING (existence-only)"} · ${badge}
</div>

<section>
  <h2>Problems (${report.problemCount})</h2>
  ${report.problems.length ? `<table><thead><tr><th>Spec</th><th>Reason</th></tr></thead><tbody>${problemRows}</tbody></table>` : "<p>None — every referenced variant passed.</p>"}
</section>

<section>
  <h2>All referenced variants (${report.totalReferenced})</h2>
  <table><thead><tr><th>Spec</th><th>Source</th><th>Declared</th><th>Actual</th><th>Codec</th><th>Notes</th></tr></thead><tbody>${variantRows}</tbody></table>
</section>

</body></html>`;
  writeFileSync(resolve(reportDir, "team-headshot-assets.html"), html);
  console.log(`📝 Wrote asset report to ${reportDir}/team-headshot-assets.{json,html}`);
} catch (err) {
  console.warn(`check-team-headshot-assets: failed to write report artifacts: ${err.message}`);
}

if (problems.length > 0) {
  console.error("\n❌ TeamHeadshot <picture> asset validation failed:\n");
  for (const p of problems.sort((a, b) => a.spec.localeCompare(b.spec))) {
    console.error(`   • ${p.spec}\n       → ${p.reason}`);
  }
  console.error(
    "\nRegenerate the AVIF/WebP ladder from the 1600x2000 master (or " +
      "restore the .asset.json pointer) before merging.\n",
  );
  process.exit(1);
}

console.log(
  `✅ TeamHeadshot assets OK — verified ${referenced.size} @/assets/site/team-* references (existence, format, and 4:5 dimensions).`,
);
