#!/usr/bin/env node
/**
 * Line-level color audit report generator.
 *
 * Scans every .ts/.tsx file under src/ EXCEPT the intentional exception
 * surfaces (print/letterhead, error pages, DashboardHero, tests, and any file
 * that opted in with `/* allow-raw-color-file: <reason> *\/`). Also honors
 * per-line `// allow-raw-color: <reason>` markers.
 *
 * Emits:
 *   - /mnt/documents/color-audit.csv   (rows: file, line, col, kind, match, suggestion, snippet)
 *   - /mnt/documents/color-audit.md    (human-readable grouped report)
 *
 * Kept purposely independent from the CI guardrail (scripts/ci/
 * no-hex-in-marketing-shell.mjs) so we can audit the WHOLE tree without
 * changing what the CI blocks.
 */
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";

const ROOT = process.cwd();
const OUT_DIR = "/mnt/documents";
const CSV_PATH = join(OUT_DIR, "color-audit.csv");
const MD_PATH = join(OUT_DIR, "color-audit.md");

// Exception surfaces — raw colors here are intentional (print stylesheets,
// error boundaries, hero photography). Match the same set the CI script uses.
const EXCLUDE_MATCHERS = [
  /^src\/pages\/DocumentView\.tsx$/,
  /^src\/components\/print\//,
  /^src\/components\/(PrintPreviewModal|PaymentReceipt|PaymentHistoryDoc|BookingDocumentEditor)\.tsx$/,
  /^src\/lib\/letterhead\.tsx$/,
  /^src\/pages\/NotFound\.tsx$/,
  /^src\/components\/DashboardErrorBoundary\.tsx$/,
  /^src\/components\/DashboardHero\.tsx$/,
  /__tests__/,
  /\.test\.(ts|tsx)$/,
  // shadcn/ui primitives keep their own token wiring; treat as vendored.
  /^src\/components\/ui\//,
  // Auto-generated & integration files
  /^src\/integrations\//,
  /^src\/routeTree\.gen\.ts$/,
  // styles.css / theme.tsx contain the token definitions themselves
];

const EXTENSIONS = new Set([".ts", ".tsx"]);

const COLOR_PREFIXES =
  "bg|text|border|from|to|via|ring|fill|stroke|shadow|outline|decoration|divide|placeholder|caret|accent|ring-offset";

const UTILITY_HEX = new RegExp(
  `\\b(?:${COLOR_PREFIXES})-\\[#[0-9a-fA-F]{3,8}(?:\\/[0-9]{1,3})?\\]`,
  "g",
);
const BARE_HEX = /#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{8}\b/g;

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
const PALETTE_UTIL = new RegExp(
  `(?<![\\w-])(?:${COLOR_PREFIXES})-(?:${PALETTE_NAMES.join("|")})-(?:50|100|200|300|400|500|600|700|800|900|950)(?:\\/[0-9]{1,3})?\\b`,
  "g",
);
const BW_UTIL = new RegExp(
  `(?<![\\w-])(?:${COLOR_PREFIXES})-(?:white|black)(?:\\/[0-9]{1,3})?\\b`,
  "g",
);

const ALLOW_COMMENT = /allow-(?:hex|raw-color)\b/;
const FILE_ALLOW = /allow-raw-color-file\s*:\s*\S/;

const RULES = [
  { rx: UTILITY_HEX, kind: "arbitrary-hex-utility" },
  { rx: BARE_HEX, kind: "bare-hex-literal" },
  { rx: PALETTE_UTIL, kind: "palette-utility" },
  { rx: BW_UTIL, kind: "black-white-utility" },
];

// ------------ suggestion engine ------------

// Neutral ramp mapping — grayscale families map onto surface/foreground tokens.
const NEUTRAL_FAMILIES = new Set(["slate", "gray", "zinc", "neutral", "stone"]);

// Family → semantic mapping for coloured utilities. Prefer app-role tokens.
const FAMILY_ROLE = {
  red: "destructive",
  rose: "destructive",
  orange: "warning",
  amber: "warning",
  yellow: "warning",
  green: "success",
  emerald: "success",
  lime: "success",
  teal: "info",
  cyan: "info",
  sky: "info",
  blue: "primary",
  indigo: "primary",
  violet: "accent",
  purple: "accent",
  fuchsia: "accent",
  pink: "accent",
};

function suggestForNeutral(prefix, stepStr) {
  const step = Number(stepStr);
  if (prefix === "text") {
    if (step <= 400) return "text-muted-foreground";
    return "text-foreground";
  }
  if (prefix === "bg") {
    if (step <= 100) return "bg-muted";
    if (step <= 300) return "bg-muted / bg-card";
    if (step <= 600) return "bg-secondary";
    return "bg-foreground (over-inverse) or bg-card in dark";
  }
  if (prefix === "border" || prefix === "divide" || prefix === "ring") {
    if (step <= 300) return `${prefix}-border`;
    return `${prefix}-input`;
  }
  if (prefix === "placeholder") return "placeholder:text-muted-foreground";
  if (prefix === "from" || prefix === "to" || prefix === "via") return `${prefix}-muted`;
  return `${prefix}-foreground (review)`;
}

function suggestForColoured(prefix, family) {
  const role = FAMILY_ROLE[family] ?? "primary";
  if (prefix === "text") return `text-${role}`;
  if (prefix === "bg") return `bg-${role}`;
  if (prefix === "border") return `border-${role}`;
  if (prefix === "ring") return `ring-${role}`;
  if (prefix === "from" || prefix === "to" || prefix === "via") return `${prefix}-${role}`;
  if (prefix === "fill" || prefix === "stroke") return `${prefix}-${role}`;
  if (prefix === "shadow") return `shadow-${role}/20`;
  return `${prefix}-${role} (review)`;
}

function suggestForBW(prefix, tone) {
  // tone === 'white' | 'black'
  if (prefix === "bg") return tone === "white" ? "bg-background / bg-card" : "bg-foreground";
  if (prefix === "text")
    return tone === "white"
      ? "text-primary-foreground (on tinted bg) / text-background"
      : "text-foreground";
  if (prefix === "border") return tone === "white" ? "border-background" : "border-foreground";
  if (prefix === "ring") return tone === "white" ? "ring-background" : "ring-foreground";
  if (prefix === "fill" || prefix === "stroke")
    return tone === "white" ? `${prefix}-background` : `${prefix}-foreground`;
  return `${prefix}-${tone === "white" ? "background" : "foreground"} (review)`;
}

function hexBrightness(hex) {
  const h = hex.replace(/^#/, "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  // perceived luminance
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function suggestForHex(hex) {
  const b = hexBrightness(hex);
  if (b < 0.08) return "bg-background (dark) / text-foreground";
  if (b < 0.25) return "bg-card / text-foreground (dark surface)";
  if (b > 0.92) return "bg-background / text-background";
  if (b > 0.75) return "bg-muted / border-border";
  return "review — pick semantic token (primary/accent/success/warning/destructive)";
}

function suggest(kind, match) {
  if (kind === "bare-hex-literal") return suggestForHex(match);
  // arbitrary-hex-utility: "bg-[#0F172A]" or "text-[#fff]/50"
  if (kind === "arbitrary-hex-utility") {
    const m = /^([a-z-]+)-\[#([0-9a-fA-F]{3,8})\]/.exec(match);
    if (m) {
      const prefix = m[1].replace(/-(?:offset)$/, "");
      const hex = "#" + m[2];
      const b = hexBrightness(hex);
      if (prefix === "text")
        return b > 0.6 ? "text-primary-foreground / text-background" : "text-foreground";
      if (prefix === "bg")
        return b > 0.6 ? "bg-background / bg-card" : "bg-foreground / bg-primary";
      if (prefix === "border" || prefix === "ring") return `${prefix}-border`;
      return `${prefix}-foreground (review)`;
    }
    return "use a semantic token";
  }
  if (kind === "palette-utility") {
    const m = /^([a-z-]+)-([a-z]+)-(\d{2,3})/.exec(match);
    if (!m) return "use a semantic token";
    const prefix = m[1].replace(/-(?:offset)$/, "");
    const family = m[2];
    const step = m[3];
    if (NEUTRAL_FAMILIES.has(family)) return suggestForNeutral(prefix, step);
    return suggestForColoured(prefix, family);
  }
  if (kind === "black-white-utility") {
    const m = /^([a-z-]+)-(white|black)/.exec(match);
    if (!m) return "use a semantic token";
    return suggestForBW(m[1], m[2]);
  }
  return "use a semantic token";
}

// ------------ scan ------------

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

function excluded(relPath) {
  const posix = relPath.split(sep).join("/");
  return EXCLUDE_MATCHERS.some((rx) => rx.test(posix));
}

const findings = [];
const skippedFileAllow = [];
const skippedLineAllow = new Map();

for (const abs of walk(join(ROOT, "src"))) {
  const rel = relative(ROOT, abs);
  if (!EXTENSIONS.has(rel.slice(rel.lastIndexOf(".")))) continue;
  if (excluded(rel)) continue;

  const source = readFileSync(abs, "utf8");
  if (FILE_ALLOW.test(source)) {
    skippedFileAllow.push(rel);
    continue;
  }

  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : "";
    const lineAllowed = ALLOW_COMMENT.test(line) || ALLOW_COMMENT.test(prev);

    for (const { rx, kind } of RULES) {
      rx.lastIndex = 0;
      let m;
      while ((m = rx.exec(line))) {
        if (kind === "bare-hex-literal") {
          // skip hexes inside a utility (already flagged by UTILITY_HEX rule)
          const before = line[m.index - 1];
          if (before === "[") continue;
          // skip common non-color hex: URL fragments, CSS custom property names
          if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(m[0]) === false) continue;
        }
        if (lineAllowed) {
          skippedLineAllow.set(rel, (skippedLineAllow.get(rel) ?? 0) + 1);
          continue;
        }
        findings.push({
          file: rel.split(sep).join("/"),
          line: i + 1,
          col: m.index + 1,
          kind,
          match: m[0],
          suggestion: suggest(kind, m[0]),
          snippet: line.trim().slice(0, 200),
        });
      }
    }
  }
}

// ------------ emit ------------

mkdirSync(dirname(CSV_PATH), { recursive: true });

function csvEscape(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const csvRows = [
  ["file", "line", "col", "kind", "match", "suggestion", "snippet"].join(","),
  ...findings.map((f) =>
    [f.file, f.line, f.col, f.kind, f.match, f.suggestion, f.snippet].map(csvEscape).join(","),
  ),
];
writeFileSync(CSV_PATH, csvRows.join("\n") + "\n");

// Markdown grouped by file, sorted by finding count desc
const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}
const files = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);

const byKind = new Map();
for (const f of findings) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);

const md = [];
md.push(`# Color audit — hardcoded color usage report`);
md.push("");
md.push(`Generated: ${new Date().toISOString()}`);
md.push("");
md.push(`**Total findings:** ${findings.length} across ${files.length} files`);
md.push("");
md.push(`## Counts by rule`);
md.push("");
md.push(`| Rule | Count |`);
md.push(`| --- | ---: |`);
for (const [k, c] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
  md.push(`| \`${k}\` | ${c} |`);
}
md.push("");
md.push(`## Exception surfaces (skipped by path)`);
md.push("");
md.push(
  "- `src/pages/DocumentView.tsx`, `src/components/print/**`, `PrintPreviewModal`, `PaymentReceipt`, `PaymentHistoryDoc`, `BookingDocumentEditor`, `src/lib/letterhead.tsx` — print / letterhead",
);
md.push("- `src/pages/NotFound.tsx`, `src/components/DashboardErrorBoundary.tsx` — error surfaces");
md.push("- `src/components/DashboardHero.tsx` — hero photography backdrop");
md.push("- `src/components/ui/**` — vendored shadcn primitives");
md.push("- `src/integrations/**`, `src/routeTree.gen.ts` — auto-generated");
md.push("- `**/__tests__/**`, `*.test.{ts,tsx}` — tests");
md.push("");
md.push(`## Files opted out via \`/* allow-raw-color-file: ... */\``);
md.push("");
if (skippedFileAllow.length === 0) md.push("_none_");
else for (const f of skippedFileAllow) md.push(`- \`${f.split(sep).join("/")}\``);
md.push("");
md.push(`## Findings by file`);
md.push("");
for (const [file, fs] of files) {
  md.push(`### \`${file}\` — ${fs.length} finding${fs.length === 1 ? "" : "s"}`);
  md.push("");
  md.push(`| Line:Col | Rule | Match | Suggested semantic token | Snippet |`);
  md.push(`| ---: | --- | --- | --- | --- |`);
  for (const f of fs) {
    const snip = f.snippet.replace(/\|/g, "\\|").replace(/`/g, "\\`");
    md.push(
      `| ${f.line}:${f.col} | ${f.kind} | \`${f.match}\` | \`${f.suggestion}\` | \`${snip}\` |`,
    );
  }
  md.push("");
}

writeFileSync(MD_PATH, md.join("\n"));

console.log(`Findings: ${findings.length}`);
console.log(`Files with findings: ${files.length}`);
console.log(`Files opted out (allow-raw-color-file): ${skippedFileAllow.length}`);
console.log(`Wrote ${CSV_PATH}`);
console.log(`Wrote ${MD_PATH}`);
