#!/usr/bin/env node
/**
 * Guardrail: fail CI when marketing (/site), shell components, OR the
 * authenticated dashboard/admin surfaces introduce hard-coded colors —
 * hex literals OR non-semantic Tailwind palette utilities (bg-white,
 * text-gray-500, border-slate-200, from-blue-500, etc.).
 *
 * Forces new colors through semantic tokens defined in src/styles.css
 * (@theme) — bg-background, text-foreground, text-muted-foreground,
 * bg-card, border-border, plus status tokens bg-success / bg-warning /
 * bg-destructive / bg-info — so light/dark theming stays intact.
 *
 * Scanned surfaces:
 *   Marketing shell (original scope):
 *     - src/routes/site*.tsx           (marketing routes)
 *     - src/components/site/**         (marketing components)
 *     - src/components/*Chrome*.tsx    (any chrome component)
 *     - src/components/AppShell*       (app shell)
 *   Authenticated app (extended scope):
 *     - src/routes/_authenticated/**   (auth-gated page routes)
 *     - src/pages/**                   (dashboard/admin page components)
 *
 * Path-based exceptions (intentional): the following are NEVER scanned
 * because their raw colors are inherent to the surface, not drift:
 *   - Print / letterhead surfaces:
 *       src/pages/DocumentView.tsx         (letterhead-rendered docs)
 *       src/components/print/**            (print sub-components)
 *       src/components/PrintPreviewModal.tsx
 *       src/components/PaymentReceipt.tsx
 *       src/components/PaymentHistoryDoc.tsx
 *       src/components/BookingDocumentEditor.tsx
 *       src/lib/letterhead.tsx
 *   - Error surfaces:
 *       src/pages/NotFound.tsx
 *       src/components/DashboardErrorBoundary.tsx
 *   - Marketing/dashboard hero photography backgrounds:
 *       src/components/DashboardHero.tsx
 *   - Test files (__tests__, *.test.tsx)
 *
 * Flagged patterns (all trigger a failure):
 *   1. Tailwind arbitrary color utilities:  bg-[#0F172A], text-[#fff], etc.
 *   2. Any bare hex literal:                #1B2B4B, #fff, #0f172a80
 *   3. Non-semantic palette utilities:      bg-white, text-black,
 *      bg-slate-900, text-gray-500, border-zinc-200, from-blue-500, etc.
 *
 * Escape hatches (auditable in git blame — reason required):
 *   - Same-line marker `// allow-raw-color: <reason>` (or legacy
 *     `// allow-hex: <reason>`) OR a JSX comment on the preceding line
 *     silences violations on that line.
 *   - File-level marker `/* allow-raw-color-file: <reason> *\/` anywhere
 *     in the file silences ALL raw-color rules for the whole file.
 *     Use only when the whole file is exceptional (e.g. legacy dashboard
 *     status-color rollouts pending semantic-token migration).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

// -------- CLI flags --------
// --fix        rewrite files in place using config.autofix mappings
// --dry-run    print proposed autofix diff without touching files
// (default)    scan-only, exit 1 on violations
const ARGS = new Set(process.argv.slice(2));
const AUTOFIX_APPLY = ARGS.has("--fix");
const AUTOFIX_DRYRUN = ARGS.has("--dry-run");

const ROOT = process.cwd();

// Central config: exceptions live in a data file so adding a new page
// doesn't require editing this script. Override with COLOR_AUDIT_CONFIG=
// (absolute path or path relative to CWD) — used by the CI harness to
// swap in a synthetic config against fixture trees.
const CONFIG_PATH =
  process.env.COLOR_AUDIT_CONFIG || join(ROOT, "scripts/ci/color-audit.config.mjs");

let configModule;
try {
  configModule = await import(pathToFileURL(CONFIG_PATH).href);
} catch (err) {
  console.error(`✖ Failed to load color-audit config at ${CONFIG_PATH}`);
  console.error(`  ${err.message}`);
  process.exit(2);
}

/** Normalize `pattern` (RegExp or string) into a matcher against POSIX paths. */
function toMatcher(pattern) {
  if (pattern instanceof RegExp) return (p) => pattern.test(p);
  if (typeof pattern === "string") return (p) => p.startsWith(pattern);
  throw new Error(
    `Invalid pattern in color-audit config: ${JSON.stringify(pattern)} — expected RegExp or string`,
  );
}

const EXCLUDE_ENTRIES = (configModule.excludePaths ?? []).map((e) => ({
  ...e,
  test: toMatcher(e.pattern),
}));
const ALLOWLIST_ENTRIES = (configModule.allowlist ?? []).map((e) => {
  const rules = e.rules === "*" ? "*" : new Set(e.rules ?? []);
  if (rules !== "*" && rules.size === 0) {
    throw new Error(
      `Allowlist entry for ${e.pattern} has no rules — use rules: "*" to silence all rules or specify at least one of R1/R2/R3/R4`,
    );
  }
  return { ...e, test: toMatcher(e.pattern), rules };
});

// Autofix dictionary: exact utility → semantic replacement. Keyed by the
// `from` utility for O(1) lookup during the fix phase.
const AUTOFIX_MAP = new Map(
  (configModule.autofix ?? []).map((e) => [e.from, { to: e.to, reason: e.reason }]),
);

const INCLUDE_MATCHERS = [
  // Marketing shell (original scope)
  (p) => p.startsWith(`src${sep}routes${sep}site`),
  (p) => p.startsWith(`src${sep}components${sep}site${sep}`),
  (p) => /src[\\/]components[\\/][^\\/]*Chrome[^\\/]*\.(tsx|ts)$/.test(p),
  (p) => /src[\\/]components[\\/]AppShell[^\\/]*\.(tsx|ts)$/.test(p),
  // Authenticated app (extended scope)
  (p) => p.startsWith(`src${sep}routes${sep}_authenticated${sep}`),
  (p) => p.startsWith(`src${sep}pages${sep}`),
];

const EXTENSIONS = new Set([".ts", ".tsx"]);

const COLOR_PREFIXES =
  "bg|text|border|from|to|via|ring|fill|stroke|shadow|outline|decoration|divide|placeholder|caret|accent|ring-offset";

// Utility-with-arbitrary-hex: bg-[#fff], text-[#0F172A]/50, border-[#abc], etc.
const UTILITY_HEX = new RegExp(
  `\\b(?:${COLOR_PREFIXES})-\\[#[0-9a-fA-F]{3,8}(?:\\/[0-9]{1,3})?\\]`,
  "g",
);
// Bare hex literal anywhere (#abc, #aabbcc, #aabbccdd).
const BARE_HEX = /#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{8}\b/g;

// Tailwind default palette color names. Anything targeting one of these via a
// color utility should instead reach for a semantic token.
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
// bg-slate-900, text-gray-500/40, border-blue-200, from-red-500, etc.
const PALETTE_UTIL = new RegExp(
  `(?<![\\w-])(?:${COLOR_PREFIXES})-(?:${PALETTE_NAMES.join("|")})-(?:50|100|200|300|400|500|600|700|800|900|950)(?:\\/[0-9]{1,3})?\\b`,
  "g",
);
// bg-white, bg-black, text-white, text-black (no numeric ramp).
const BW_UTIL = new RegExp(
  `(?<![\\w-])(?:${COLOR_PREFIXES})-(?:white|black)(?:\\/[0-9]{1,3})?\\b`,
  "g",
);

// Accept both `// allow-raw-color: reason` and `{/* allow-raw-color: reason */}`
// style markers. A marker on the same line OR the immediately preceding line
// silences the violation — this lets multi-line JSX (where the offending class
// lives on its own attribute line) opt out via a preceding JSX comment.
const ALLOW_COMMENT = /allow-(?:hex|raw-color)\b/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function excludeReasonFor(posix) {
  const hit = EXCLUDE_ENTRIES.find((e) => e.test(posix));
  return hit ? `[${hit.category}] ${hit.reason}` : null;
}

function shouldScan(relPath) {
  if (!EXTENSIONS.has(relPath.slice(relPath.lastIndexOf(".")))) return false;
  // Normalize to POSIX slashes so config patterns work on Windows too.
  const posix = relPath.split(sep).join("/");
  if (excludeReasonFor(posix)) return false;
  return INCLUDE_MATCHERS.some((m) => m(relPath));
}

/** Returns { rules: Set|"*", reason } if any allowlist entry matches, else null. */
function allowlistFor(posix) {
  const matches = ALLOWLIST_ENTRIES.filter((e) => e.test(posix));
  if (!matches.length) return null;
  // Merge: if any entry says "*", the file is fully silenced. Otherwise
  // union the rule sets so overlapping entries compose additively.
  if (matches.some((m) => m.rules === "*")) {
    return { rules: "*", reason: matches.map((m) => m.reason).join("; ") };
  }
  const merged = new Set();
  for (const m of matches) for (const r of m.rules) merged.add(r);
  return { rules: merged, reason: matches.map((m) => m.reason).join("; ") };
}

const RULES = [
  {
    rx: UTILITY_HEX,
    kind: "arbitrary-hex utility",
    id: "R1",
    fix: "Replace bg-[#...]/text-[#...] with a semantic utility (bg-background, text-foreground, border-border, bg-card, bg-success, bg-warning, bg-destructive, bg-info) or a brand-* token from src/styles.css @theme.",
  },
  {
    rx: BARE_HEX,
    kind: "bare hex literal",
    id: "R2",
    fix: "Move the color into src/styles.css @theme as an hsl(var(--token)) and reference it by token, not by hex.",
  },
  {
    rx: PALETTE_UTIL,
    kind: "non-semantic palette utility",
    id: "R3",
    fix: "Swap the Tailwind palette utility (bg-slate-900, text-gray-500, from-blue-500, …) for a semantic token so light/dark theming survives.",
  },
  {
    rx: BW_UTIL,
    kind: "raw black/white utility",
    id: "R4",
    fix: "Use bg-background/bg-card/text-foreground instead of bg-white/bg-black/text-white/text-black — those bypass dark mode.",
  },
];

// File-level opt-out. A file may declare `/* allow-raw-color-file: <reason> */`
// (JS comment or JSX comment, anywhere in the file) to silence ALL raw-color
// rules across that file — hex literals, palette utilities, black/white
// utilities. Reserved for whole-file exceptions such as legacy dashboards
// pending semantic-token migration or components rendering over dark hero
// photography. The reason is required so drift stays auditable in git blame.
const FILE_ALLOW = /allow-raw-color-file\s*:\s*(\S[^\n*]*)/;
// Captures the reason text on same-line / preceding-line line-level markers so
// diagnostics can echo it back for auditability.
const LINE_ALLOW_REASON = /allow-(?:hex|raw-color)\s*:\s*([^\n*]+?)(?:\s*\*\/|\s*-->|$)/;

const violations = [];
const fileExceptions = []; // { file, reason, source: "inline"|"config" }
const lineExceptions = []; // { file, line, reason }
const configAllowlistHits = []; // { file, rules, reason }

for (const abs of walk(join(ROOT, "src"))) {
  const rel = relative(ROOT, abs);
  if (!shouldScan(rel)) continue;

  const posix = rel.split(sep).join("/");
  const source = readFileSync(abs, "utf8");

  // Config-driven full-file silencing takes precedence over the file scan.
  const allow = allowlistFor(posix);
  if (allow && allow.rules === "*") {
    fileExceptions.push({ file: rel, reason: allow.reason, source: "config" });
    continue;
  }

  const fileAllow = source.match(FILE_ALLOW);
  if (fileAllow) {
    fileExceptions.push({ file: rel, reason: fileAllow[1].trim(), source: "inline" });
    continue;
  }

  if (allow) configAllowlistHits.push({ file: rel, rules: [...allow.rules], reason: allow.reason });

  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : "";
    const lineAllowed = ALLOW_COMMENT.test(line) || ALLOW_COMMENT.test(prev);
    if (lineAllowed) {
      const reasonMatch = line.match(LINE_ALLOW_REASON) || prev.match(LINE_ALLOW_REASON);
      lineExceptions.push({
        file: rel,
        line: i + 1,
        reason: reasonMatch ? reasonMatch[1].trim() : "(no reason given)",
      });
      continue;
    }

    for (const { rx, kind, id, fix } of RULES) {
      // Config-driven per-rule silencing for this file.
      if (allow && allow.rules !== "*" && allow.rules.has(id)) continue;
      rx.lastIndex = 0;
      let m;
      while ((m = rx.exec(line))) {
        violations.push({
          file: rel,
          line: i + 1,
          column: m.index + 1,
          match: m[0],
          kind,
          ruleId: id,
          fix,
          text: line,
        });
      }
    }
  }
}

// -------------------- autofix (--fix / --dry-run) --------------------
//
// Partition violations into fixable (a mapping exists in AUTOFIX_MAP,
// exact token match) and unfixable (arbitrary/bare hex, or a palette
// utility whose mapping the maintainer hasn't approved yet). Autofix
// only rewrites exact whole-word occurrences of the offender token and
// never touches lines carrying an inline allow marker.

const fixable = [];
const unfixable = [];
for (const v of violations) {
  const hit = AUTOFIX_MAP.get(v.match);
  if (hit) fixable.push({ ...v, replacement: hit.to, mappingReason: hit.reason });
  else unfixable.push(v);
}

const autofixApplied = []; // { file, line, from, to, reason }
if ((AUTOFIX_APPLY || AUTOFIX_DRYRUN) && fixable.length) {
  // Group by file, apply per line so multiple offenders on one line all fix.
  const byFile = new Map();
  for (const v of fixable) {
    if (!byFile.has(v.file)) byFile.set(v.file, []);
    byFile.get(v.file).push(v);
  }

  for (const [file, fixes] of byFile) {
    const abs = join(ROOT, file);
    const src = readFileSync(abs, "utf8");
    const lines = src.split("\n");
    // Sort by line for stable, deterministic rewrites.
    fixes.sort((a, b) => a.line - b.line || a.column - b.column);
    for (const f of fixes) {
      const original = lines[f.line - 1];
      // Whole-word replacement: guard both sides so `bg-white/20` and
      // `text-white-space` (hypothetical) aren't touched incorrectly.
      const rx = new RegExp(
        `(?<![\\w-])${f.match.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}(?![\\w-])`,
        "g",
      );
      const rewritten = original.replace(rx, f.replacement);
      if (rewritten !== original) {
        lines[f.line - 1] = rewritten;
        autofixApplied.push({
          file: f.file,
          line: f.line,
          from: f.match,
          to: f.replacement,
          reason: f.mappingReason,
        });
      }
    }
    if (AUTOFIX_APPLY) {
      writeFileSync(abs, lines.join("\n"), "utf8");
    }
  }
}

// After autofix, the violations we successfully rewrote are no longer
// active — replace `violations` with what remains (unfixable + any
// fixables that were previewed but not written in --dry-run mode).
if (AUTOFIX_APPLY) {
  violations.length = 0;
  violations.push(...unfixable);
}

// -------------------- reporting --------------------

const scannedExceptionsBanner = () => {
  const anything = fileExceptions.length || lineExceptions.length || configAllowlistHits.length;
  if (!anything) return;
  console.error("Active exceptions applied during this scan:");
  if (fileExceptions.length) {
    console.error(`  file-level (${fileExceptions.length}):`);
    for (const e of fileExceptions) {
      const src = e.source === "config" ? "[config]" : "[inline]";
      console.error(`    - ${src} ${e.file}  reason: ${e.reason}`);
    }
  }
  if (configAllowlistHits.length) {
    console.error(`  config rule-scoped (${configAllowlistHits.length}):`);
    for (const e of configAllowlistHits) {
      console.error(`    - ${e.file}  rules: ${e.rules.join(",")}  reason: ${e.reason}`);
    }
  }
  if (lineExceptions.length) {
    console.error(`  line-level (${lineExceptions.length}):`);
    for (const e of lineExceptions) {
      console.error(`    - ${e.file}:${e.line}  reason: ${e.reason}`);
    }
  }
  console.error("");
};

function printAutofixBanner() {
  if (!autofixApplied.length) return;
  const verb = AUTOFIX_APPLY ? "Applied" : "Would apply";
  const suffix = AUTOFIX_APPLY ? "" : " (--dry-run: no files written)";
  console.error(`${verb} ${autofixApplied.length} autofix rewrite(s)${suffix}:`);
  for (const a of autofixApplied) {
    console.error(`  ${a.file}:${a.line}  ${a.from}  →  ${a.to}   (${a.reason})`);
  }
  console.error("");
}

if (violations.length === 0) {
  console.log("✓ no hard-coded colors in marketing/shell/authenticated surfaces");
  const totalExceptions =
    fileExceptions.length + lineExceptions.length + configAllowlistHits.length;
  if (totalExceptions) {
    console.log(
      `  (skipped ${fileExceptions.length} file-level + ${configAllowlistHits.length} config rule-scoped + ${lineExceptions.length} line-level exceptions — see ${CONFIG_PATH} / git blame)`,
    );
  }
  // Autofix banner is diagnostic — print to stderr even on success so
  // reviewers can see what --fix / --dry-run actually rewrote.
  printAutofixBanner();
  process.exit(0);
}

// Group violations by rule for a summary the developer can scan quickly.
const byRule = new Map();
for (const v of violations) {
  const key = `${v.ruleId} ${v.kind}`;
  if (!byRule.has(key)) byRule.set(key, { rule: v, tokens: new Map() });
  const entry = byRule.get(key);
  entry.tokens.set(v.match, (entry.tokens.get(v.match) ?? 0) + 1);
}

console.error(
  `✗ Guardrail failed: ${violations.length} hard-coded color reference(s) across ${
    new Set(violations.map((v) => v.file)).size
  } file(s).\n`,
);

console.error("Summary by rule:");
for (const [key, { rule, tokens }] of byRule) {
  const total = [...tokens.values()].reduce((a, b) => a + b, 0);
  const topTokens = [...tokens.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tok, n]) => `${tok}×${n}`)
    .join(", ");
  console.error(`  [${key}]  ${total} occurrence(s)  tokens: ${topTokens}`);
  console.error(`      fix: ${rule.fix}`);
}
console.error("");

console.error("Details:");
for (const v of violations) {
  console.error(
    `  ${v.file}:${v.line}:${v.column}  rule=${v.ruleId} (${v.kind})  offender=${v.match}`,
  );
  const context = v.text.replace(/\t/g, "  ");
  console.error(`      | ${context}`);
  const caretPad = " ".repeat(
    // account for the "      | " prefix + any tab expansion before the match
    v.text.slice(0, v.column - 1).replace(/\t/g, "  ").length,
  );
  console.error(`      | ${caretPad}${"^".repeat(v.match.length)}`);
}

scannedExceptionsBanner();
printAutofixBanner();

console.error(
  "Escape hatches (require a reason for git-blame auditability):",
  "\n  • same line:      // allow-raw-color: <reason>",
  "\n  • preceding line: {/* allow-raw-color: <reason> */}",
  "\n  • whole file:     /* allow-raw-color-file: <reason> */",
  "\n  • config:         scripts/ci/color-audit.config.mjs (excludePaths / allowlist / autofix)",
  "\nAutofix: rerun with --dry-run to preview or --fix to rewrite files;",
  "\nremaining violations have no safe mapping and need manual resolution.",
  "\nSemantic tokens live in src/styles.css @theme — bg-background, text-foreground,",
  "\ntext-muted-foreground, border-border, bg-card, bg-success, bg-warning,",
  "\nbg-destructive, bg-info, plus brand-* tokens.",
);
process.exit(1);
