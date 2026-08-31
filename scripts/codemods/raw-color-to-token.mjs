#!/usr/bin/env node
/**
 * Codemod CLI: rewrite raw color utilities to semantic tokens across the
 * guardrail's protected directories using the exact same mapping table the
 * CI rule uses (`scripts/ci/color-audit.config.mjs` → `autofix`).
 *
 * The CI rule (`scripts/ci/no-hex-in-marketing-shell.mjs`) also exposes
 * `--fix`, but that path is scoped to the CI-scanned surfaces. This CLI
 * is a standalone codemod you can point at any subset of the tree during
 * a migration or a large refactor — it's a proper preview-first codemod
 * with a unified-diff style output, per-file summaries, and opt-in write.
 *
 * Usage:
 *   node scripts/codemods/raw-color-to-token.mjs [options]
 *
 * Options:
 *   --path <dir>       Scan only this directory (repeatable). Path is
 *                      relative to CWD. Defaults to the guardrail's
 *                      protected scope: src/routes/site*, src/components/site,
 *                      src/components/*Chrome*, src/components/AppShell*,
 *                      src/routes/_authenticated, src/pages.
 *   --write            Actually rewrite files. Without this, prints diffs
 *                      only and exits 0 (dry-run is the default so codemods
 *                      cannot accidentally mutate the working tree).
 *   --config <path>    Load autofix map + excludePaths from this file
 *                      (default: scripts/ci/color-audit.config.mjs).
 *   --allow-excluded   Also rewrite files that are in config.excludePaths.
 *                      Off by default — the exclusions exist for a reason
 *                      (print CSS, error pages) and shouldn't be codemodded.
 *   --json [<path>]    Emit a machine-readable JSON report of the run for
 *                      CI consumption: files changed, per-token rewrite
 *                      counts, and unfixable raw-color violations detected
 *                      in the scanned files (matches the CI rule's R1/R2/
 *                      R3/R4 buckets, minus anything with an autofix
 *                      mapping). Pass a path to write the report to a file,
 *                      or "-" (or omit the value) to write to stdout. When
 *                      writing to stdout the human-readable diff/summary is
 *                      suppressed so the stream stays parseable.
 *   -h, --help         Print this help.
 *
 * Exit codes:
 *   0  no changes needed, OR --write applied changes successfully,
 *      OR dry-run completed (with or without proposed changes)
 *   1  invalid arguments / config load error
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();

// -------------------- args --------------------
// Sentinel used when --json is passed with no value (i.e. followed by
// another flag or end-of-argv) — resolved to "-" (stdout) later.
const JSON_NO_VALUE = Symbol("json-no-value");

function parseArgs(argv) {
  const out = {
    paths: [],
    write: false,
    config: null,
    allowExcluded: false,
    json: null, // null = disabled, "-" = stdout, other = file path
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--path") out.paths.push(argv[++i]);
    else if (a === "--write") out.write = true;
    else if (a === "--config") out.config = argv[++i];
    else if (a === "--allow-excluded") out.allowExcluded = true;
    else if (a === "--json") {
      // Accept `--json`, `--json -`, `--json path/to/report.json`.
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out.json = "-";
      } else {
        out.json = next;
        i++;
      }
    } else if (a === "-h" || a === "--help") out.help = true;
    else {
      console.error(`Unknown argument: ${a}`);
      out.error = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  // Print the top-of-file doc comment.
  const self = readFileSync(new URL(import.meta.url), "utf8");
  const doc = self.match(/\/\*\*([\s\S]*?)\*\//)?.[1] ?? "";
  console.log(
    doc
      .split("\n")
      .map((l) => l.replace(/^\s\*\s?/, ""))
      .join("\n")
      .trim(),
  );
  process.exit(0);
}
if (args.error) process.exit(1);

// -------------------- config --------------------
const CONFIG_PATH = resolve(ROOT, args.config || "scripts/ci/color-audit.config.mjs");
let cfg;
try {
  cfg = await import(pathToFileURL(CONFIG_PATH).href);
} catch (err) {
  console.error(`✖ Failed to load config at ${CONFIG_PATH}`);
  console.error(`  ${err.message}`);
  process.exit(1);
}

const AUTOFIX = new Map((cfg.autofix ?? []).map((e) => [e.from, { to: e.to, reason: e.reason }]));
if (AUTOFIX.size === 0) {
  console.error("✖ config.autofix is empty — nothing to codemod.");
  process.exit(1);
}

function toMatcher(pattern) {
  if (pattern instanceof RegExp) return (p) => pattern.test(p);
  if (typeof pattern === "string") return (p) => p.startsWith(pattern);
  throw new Error(`Invalid pattern: ${JSON.stringify(pattern)}`);
}
const EXCLUDE = (cfg.excludePaths ?? []).map((e) => ({
  ...e,
  test: toMatcher(e.pattern),
}));

// Default scan roots mirror the CI guardrail's include list. Passing
// --path overrides these entirely so a targeted codemod (e.g. one team's
// pages) doesn't rewrite unrelated files.
const DEFAULT_ROOTS = [
  "src/routes", // covers site*.tsx + _authenticated/**
  "src/components/site",
  "src/components", // for AppShell* and *Chrome* (filtered below)
  "src/pages",
];
const SCAN_ROOTS = (args.paths.length ? args.paths : DEFAULT_ROOTS).map((p) => resolve(ROOT, p));

// When falling back to DEFAULT_ROOTS we still need the guardrail's include
// filter so we don't rewrite arbitrary src/components/* files. With --path
// the caller has said "this dir, no filter" — trust them.
const INCLUDE_MATCHERS = args.paths.length
  ? [() => true]
  : [
      (p) => p.startsWith(`src${sep}routes${sep}site`),
      (p) => p.startsWith(`src${sep}components${sep}site${sep}`),
      (p) => /src[\\/]components[\\/][^\\/]*Chrome[^\\/]*\.(tsx|ts)$/.test(p),
      (p) => /src[\\/]components[\\/]AppShell[^\\/]*\.(tsx|ts)$/.test(p),
      (p) => p.startsWith(`src${sep}routes${sep}_authenticated${sep}`),
      (p) => p.startsWith(`src${sep}pages${sep}`),
    ];

const EXTENSIONS = new Set([".ts", ".tsx"]);

// Line-level allow marker — never rewrite these lines even if a mapping
// exists; the reason on the marker is authoritative.
const ALLOW_COMMENT = /allow-(?:hex|raw-color)\b/;
// File-level allow marker — skip the entire file.
const FILE_ALLOW = /allow-raw-color-file\s*:\s*\S/;

// -------------------- walk --------------------
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function shouldConsider(rel, posix) {
  if (!EXTENSIONS.has(rel.slice(rel.lastIndexOf(".")))) return false;
  if (!args.allowExcluded && EXCLUDE.some((e) => e.test(posix))) return false;
  return INCLUDE_MATCHERS.some((m) => m(rel));
}

// -------------------- rewrite --------------------
// Build one alternation regex from the autofix keys so we can find every
// candidate in a single line pass. Whole-word boundary on both sides so
// `bg-white/20` (opacity suffix) and `text-white-space` (hypothetical)
// stay untouched.
const escaped = [...AUTOFIX.keys()]
  .sort((a, b) => b.length - a.length) // longest-first — avoid shadowing
  .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const CANDIDATE_RX = new RegExp(`(?<![\\w-])(${escaped.join("|")})(?![\\w-])`, "g");

/**
 * Apply autofix to one file's source. Returns
 *   { rewritten, edits: [{ line, from, to, reason, before, after }] }
 * without mutating the input.
 */
function rewriteSource(source) {
  const lines = source.split("\n");
  const edits = [];
  for (let i = 0; i < lines.length; i++) {
    const original = lines[i];
    const prev = i > 0 ? lines[i - 1] : "";
    if (ALLOW_COMMENT.test(original) || ALLOW_COMMENT.test(prev)) continue;
    CANDIDATE_RX.lastIndex = 0;
    if (!CANDIDATE_RX.test(original)) continue;
    // Second pass with .replace captures each hit for reporting.
    CANDIDATE_RX.lastIndex = 0;
    const rewritten = original.replace(CANDIDATE_RX, (m) => {
      const hit = AUTOFIX.get(m);
      return hit ? hit.to : m;
    });
    if (rewritten !== original) {
      // Enumerate individual token edits for the diff summary.
      CANDIDATE_RX.lastIndex = 0;
      let match;
      while ((match = CANDIDATE_RX.exec(original))) {
        const hit = AUTOFIX.get(match[1]);
        if (!hit) continue;
        edits.push({
          line: i + 1,
          from: match[1],
          to: hit.to,
          reason: hit.reason,
          before: original,
          after: rewritten,
        });
      }
      lines[i] = rewritten;
    }
  }
  return { rewritten: lines.join("\n"), edits };
}

// -------------------- unfixable-violation detection --------------------
// Mirror the four raw-color rules from scripts/ci/no-hex-in-marketing-shell.mjs
// (R1/R2/R3/R4) so the JSON report can surface what a codemod pass CAN'T
// auto-remediate. Kept as a local copy — importing the CI script would run
// its top-level scan as a side effect.
const COLOR_PREFIXES =
  "bg|text|border|from|to|via|ring|fill|stroke|shadow|outline|decoration|divide|placeholder|caret|accent|ring-offset";
const PALETTE_NAMES = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
];
const UNFIXABLE_RULES = [
  {
    id: "R1",
    kind: "arbitrary-hex utility",
    rx: new RegExp(`\\b(?:${COLOR_PREFIXES})-\\[#[0-9a-fA-F]{3,8}(?:\\/[0-9]{1,3})?\\]`, "g"),
  },
  {
    id: "R2",
    kind: "bare hex literal",
    rx: /#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{8}\b/g,
  },
  {
    id: "R3",
    kind: "non-semantic palette utility",
    rx: new RegExp(
      `(?<![\\w-])(?:${COLOR_PREFIXES})-(?:${PALETTE_NAMES.join("|")})-(?:50|100|200|300|400|500|600|700|800|900|950)(?:\\/[0-9]{1,3})?\\b`,
      "g",
    ),
  },
  {
    id: "R4",
    kind: "raw black/white utility",
    rx: new RegExp(`(?<![\\w-])(?:${COLOR_PREFIXES})-(?:white|black)(?:\\/[0-9]{1,3})?\\b`, "g"),
  },
];

/**
 * Scan one file's source for raw-color violations that DO NOT have an
 * autofix mapping. Anything in AUTOFIX is remediable by this codemod and
 * therefore isn't "unfixable" from CI's perspective — only leftover hits
 * belong in the report. Honors the same line/file allow markers as the
 * rewrite pass so noise stays consistent with the CI rule.
 */
function collectUnfixable(source) {
  const hits = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const original = lines[i];
    const prev = i > 0 ? lines[i - 1] : "";
    if (ALLOW_COMMENT.test(original) || ALLOW_COMMENT.test(prev)) continue;
    for (const rule of UNFIXABLE_RULES) {
      rule.rx.lastIndex = 0;
      let match;
      while ((match = rule.rx.exec(original))) {
        const token = match[0];
        // An autofix mapping exists → this is fixable, skip.
        if (AUTOFIX.has(token)) continue;
        hits.push({
          line: i + 1,
          rule: rule.id,
          kind: rule.kind,
          token,
          snippet: original.trim(),
        });
      }
    }
  }
  return hits;
}

// -------------------- run --------------------
const filesConsidered = new Set();
const filesChanged = [];
const totalEdits = [];
const unfixable = []; // { file, line, rule, kind, token, snippet }

for (const root of SCAN_ROOTS) {
  for (const abs of walk(root)) {
    const rel = relative(ROOT, abs);
    const posix = rel.split(sep).join("/");
    if (!shouldConsider(rel, posix)) continue;
    filesConsidered.add(rel);

    const src = readFileSync(abs, "utf8");
    if (FILE_ALLOW.test(src)) continue;

    const { rewritten, edits } = rewriteSource(src);
    if (edits.length) {
      filesChanged.push({ file: rel, abs, rewritten, edits });
      totalEdits.push(...edits.map((e) => ({ ...e, file: rel })));
    }

    // Unfixable violations are computed against the ORIGINAL source. A
    // rewrite in the same file may resolve some hits, but the JSON report
    // documents the pre-codemod state — that's what CI needs to compare
    // against the CI rule's own output.
    for (const h of collectUnfixable(src)) unfixable.push({ file: rel, ...h });
  }
}

// -------------------- apply writes --------------------
// Apply writes BEFORE emitting either report so the JSON report can
// accurately describe the on-disk outcome (mode + wrote counts).
if (args.write) {
  for (const f of filesChanged) writeFileSync(f.abs, f.rewritten, "utf8");
}

// -------------------- JSON report (CI-consumable) --------------------
// When --json is set we build a structured report. Format contract:
//   {
//     schemaVersion, tool, generatedAt, cwd, config, roots, mode, applied,
//     summary: { filesConsidered, filesChanged, totalRewrites,
//                unfixableViolations, unfixableFiles },
//     filesChanged: [{ file, editCount, lines: [ints], edits: [...] }],
//     tokenRewrites: [{ from, to, reason, count, files: [ints] }],
//     unfixableViolations: [{ file, line, rule, kind, token, snippet }]
//   }
// Downstream consumers should key on `schemaVersion` — bump it on breaking
// changes to this shape.
const jsonDestIsStdout = args.json === "-";

function buildJsonReport() {
  const tokenAgg = new Map(); // key = `${from}→${to}` → { from, to, reason, count, files:Set }
  for (const e of totalEdits) {
    const key = `${e.from}\u0000${e.to}`;
    let entry = tokenAgg.get(key);
    if (!entry) {
      entry = { from: e.from, to: e.to, reason: e.reason, count: 0, files: new Set() };
      tokenAgg.set(key, entry);
    }
    entry.count += 1;
    entry.files.add(e.file);
  }

  return {
    schemaVersion: 1,
    tool: "raw-color-to-token",
    generatedAt: new Date().toISOString(),
    cwd: ROOT,
    config: relative(ROOT, CONFIG_PATH),
    roots: args.paths.length ? args.paths : DEFAULT_ROOTS,
    mode: args.write ? "write" : "dry-run",
    applied: args.write,
    summary: {
      filesConsidered: filesConsidered.size,
      filesChanged: filesChanged.length,
      totalRewrites: totalEdits.length,
      unfixableViolations: unfixable.length,
      unfixableFiles: new Set(unfixable.map((u) => u.file)).size,
    },
    filesChanged: filesChanged.map((f) => ({
      file: f.file,
      editCount: f.edits.length,
      lines: [...new Set(f.edits.map((e) => e.line))].sort((a, b) => a - b),
      edits: f.edits.map((e) => ({
        line: e.line,
        from: e.from,
        to: e.to,
        reason: e.reason,
        before: e.before,
        after: e.after,
      })),
    })),
    tokenRewrites: [...tokenAgg.values()]
      .map((e) => ({
        from: e.from,
        to: e.to,
        reason: e.reason,
        count: e.count,
        files: [...e.files].sort(),
      }))
      .sort((a, b) => b.count - a.count),
    unfixableViolations: unfixable,
  };
}

if (args.json) {
  const report = buildJsonReport();
  const serialized = JSON.stringify(report, null, 2);
  if (jsonDestIsStdout) {
    // Stdout must stay parseable — suppress the human summary entirely.
    process.stdout.write(serialized + "\n");
    process.exit(0);
  }
  const outPath = resolve(ROOT, args.json);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, serialized + "\n", "utf8");
  // Fall through to the human summary below and mention the report path.
}

// -------------------- human-readable report --------------------
const mode = args.write ? "WRITE" : "DRY-RUN";
console.log(
  `raw-color-to-token codemod [${mode}]  config=${relative(ROOT, CONFIG_PATH)}  roots=${(args.paths
    .length
    ? args.paths
    : DEFAULT_ROOTS
  ).join(", ")}`,
);
console.log(
  `  considered ${filesConsidered.size} file(s), proposing ${totalEdits.length} rewrite(s) across ${filesChanged.length} file(s)`,
);
if (unfixable.length) {
  const unfixableFiles = new Set(unfixable.map((u) => u.file)).size;
  console.log(
    `  ${unfixable.length} unfixable violation(s) in ${unfixableFiles} file(s) — see CI rule for remediation.`,
  );
}
if (args.json && !jsonDestIsStdout) {
  console.log(`  JSON report written to ${relative(ROOT, resolve(ROOT, args.json))}`);
}

if (filesChanged.length === 0) {
  console.log("✓ nothing to rewrite.");
  process.exit(0);
}

for (const f of filesChanged) {
  console.log("");
  console.log(`── ${f.file}  (${f.edits.length} change(s)) ──`);
  // Show one diff line per edited line, deduped.
  const seenLines = new Set();
  for (const e of f.edits) {
    if (seenLines.has(e.line)) continue;
    seenLines.add(e.line);
    console.log(`  L${e.line}`);
    console.log(`    - ${e.before.trim()}`);
    console.log(`    + ${e.after.trim()}`);
  }
  // Token-level roll-up so reviewers can scan intent quickly.
  const tokenCounts = new Map();
  for (const e of f.edits) {
    const key = `${e.from} → ${e.to} (${e.reason})`;
    tokenCounts.set(key, (tokenCounts.get(key) ?? 0) + 1);
  }
  console.log(`  mappings:`);
  for (const [k, n] of tokenCounts) console.log(`    ${k}   ×${n}`);
}

if (args.write) {
  console.log("");
  console.log(`✓ wrote ${filesChanged.length} file(s).`);
  console.log(
    "  Re-run `node scripts/ci/no-hex-in-marketing-shell.mjs` to confirm remaining violations require manual resolution.",
  );
} else {
  console.log("");
  console.log("(dry-run — re-run with --write to apply)");
}
process.exit(0);
