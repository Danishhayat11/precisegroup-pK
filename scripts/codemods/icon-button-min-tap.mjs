#!/usr/bin/env node
/**
 * Codemod CLI: enforce min-h-11 / min-w-11 (≥ 44×44 px) on every
 * `<Button size="icon" ...>` that doesn't already meet the tap-target
 * minimum. Mirrors rule R1 in `scripts/ci/tap-target-audit.mjs` so the
 * codemod and the build gate agree bit-for-bit on what counts as
 * compliant.
 *
 * Why a codemod?
 *   The audit script tells us *which* icon Buttons are too small and
 *   grandfathers the historical set in an allowlist. This CLI walks that
 *   backlog and injects the missing classes so the allowlist can shrink.
 *
 * Usage:
 *   node scripts/codemods/icon-button-min-tap.mjs [options]
 *
 * Options:
 *   --path <dir>   Scan only this directory (repeatable). Relative to CWD.
 *                  Default: src/
 *   --write        Actually rewrite files. Default is dry-run — prints a
 *                  compact per-file report and exits 0 without mutation.
 *   --json         Emit a machine-readable JSON summary to stdout instead
 *                  of the human report (suppresses per-file output).
 *   -h, --help     Print this help.
 *
 * Exit codes:
 *   0  dry-run completed, OR --write applied changes successfully
 *   1  invalid arguments / parse error in a scanned file
 *
 * What the codemod changes
 *   For each `<Button size="icon">` that is NOT already ≥ 44×44 on mobile
 *   / tablet (per the audit's `analyzeClasses`), the codemod merges
 *   `min-h-11 min-w-11` into the element's `className`:
 *     • className="h-8 w-8"        → className="h-8 w-8 min-h-11 min-w-11"
 *     • className={"h-8 w-8"}      → className={"h-8 w-8 min-h-11 min-w-11"}
 *     • className={`h-8 w-8`}      → className={`h-8 w-8 min-h-11 min-w-11`}
 *     • (no className attr)        → className="min-h-11 min-w-11"
 *   Files with `allow-small-tap-file:` are skipped entirely. Individual
 *   elements with an inline `allow-small-tap:` (same or preceding line)
 *   are skipped, matching the audit's escape hatches.
 *
 * What the codemod refuses to touch
 *   Icon Buttons whose className is fully dynamic (`cn(...)`, template
 *   literal with interpolations, variable reference) are reported under
 *   `needsManualReview` and left alone — the audit already flags them at
 *   build time, and blind rewriting would risk breaking the expression.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "@babel/parser";

const ROOT = process.cwd();
const MIN_TAP_UNIT = 11;
const DESKTOP_PREFIXES = new Set(["lg", "xl", "2xl"]);
const IGNORED_PREFIXES = new Set(["print", "motion-reduce", "motion-safe"]);

// -------------------- args --------------------
function parseArgs(argv) {
  const out = { paths: [], write: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else if (a === "--write") out.write = true;
    else if (a === "--json") out.json = true;
    else if (a === "--path") out.paths.push(argv[++i]);
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  if (out.paths.length === 0) out.paths.push("src");
  return out;
}

function printHelp() {
  const header = /\/\*\*[\s\S]*?\*\//.exec(
    // read this file's own docblock so `--help` stays in sync with the
    // source-of-truth comment at the top.
    // eslint-disable-next-line no-undef
    "" + (globalThis.__CODEMOD_HELP__ ?? ""),
  );
  if (header) console.log(header[0]);
  else console.log("See top-of-file docblock for usage.");
}

// -------------------- shared with audit --------------------
function splitClass(cls) {
  const parts = cls.split(":");
  return { prefixes: parts.slice(0, -1), core: parts.at(-1) ?? "" };
}
function parseSizeCore(core) {
  const m = /^(min-h|min-w|h|w|size)-(.+)$/.exec(core);
  if (!m) return null;
  const [, prop, value] = m;
  const bracket = /^\[(\d+(?:\.\d+)?)(px|rem)\]$/.exec(value);
  if (bracket) {
    const n = Number(bracket[1]);
    const units = bracket[2] === "px" ? n / 4 : (n * 16) / 4;
    return { prop, units };
  }
  const numeric = /^(\d+(?:\.\d+)?)$/.exec(value);
  if (!numeric) return null;
  return { prop, units: Number(numeric[1]) };
}
function appliesToTouch(prefixes) {
  for (const p of prefixes) if (DESKTOP_PREFIXES.has(p)) return false;
  return true;
}
function analyzeClasses(classList) {
  let minH = 0,
    minW = 0;
  for (const raw of classList) {
    const cls = raw.trim();
    if (!cls) continue;
    const { prefixes, core } = splitClass(cls);
    if (prefixes.some((p) => IGNORED_PREFIXES.has(p))) continue;
    if (!appliesToTouch(prefixes)) continue;
    const parsed = parseSizeCore(core);
    if (!parsed) continue;
    if (parsed.units >= MIN_TAP_UNIT) {
      if (parsed.prop === "min-h" || parsed.prop === "h" || parsed.prop === "size")
        minH = Math.max(minH, parsed.units);
      if (parsed.prop === "min-w" || parsed.prop === "w" || parsed.prop === "size")
        minW = Math.max(minW, parsed.units);
    }
  }
  return { hasBigMin: minH >= MIN_TAP_UNIT && minW >= MIN_TAP_UNIT };
}

// -------------------- file walk --------------------
async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      out.push(...(await walk(full)));
    } else if (/\.(tsx|jsx)$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

// -------------------- AST helpers --------------------
function getAttr(openingElement, name) {
  return openingElement.attributes.find((a) => a.type === "JSXAttribute" && a.name?.name === name);
}
function elementName(openingElement) {
  const n = openingElement.name;
  if (n.type === "JSXIdentifier") return n.name;
  return null;
}
function isIconButton(openingElement) {
  const attr = getAttr(openingElement, "size");
  if (!attr || !attr.value) return false;
  if (attr.value.type === "StringLiteral") return attr.value.value === "icon";
  if (
    attr.value.type === "JSXExpressionContainer" &&
    attr.value.expression?.type === "StringLiteral"
  ) {
    return attr.value.expression.value === "icon";
  }
  return false;
}
/**
 * Return { kind, staticText, node } for a className attr:
 *   kind: "string" | "expr-string" | "template" | "none" | "dynamic"
 *   staticText: the literal class text when statically resolvable
 *   node: the AST node whose location we'll splice into
 */
function classifyClassName(attr) {
  if (!attr) return { kind: "none" };
  const v = attr.value;
  if (v?.type === "StringLiteral") {
    return { kind: "string", staticText: v.value, node: v };
  }
  if (v?.type === "JSXExpressionContainer") {
    const e = v.expression;
    if (e.type === "StringLiteral") {
      return { kind: "expr-string", staticText: e.value, node: e };
    }
    if (e.type === "TemplateLiteral" && e.expressions.length === 0) {
      const text = e.quasis.map((q) => q.value.cooked).join("");
      return { kind: "template", staticText: text, node: e };
    }
  }
  return { kind: "dynamic" };
}
function walkJsx(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "range" || key === "parent") continue;
    const child = node[key];
    if (Array.isArray(child)) child.forEach((c) => walkJsx(c, visit));
    else if (child && typeof child === "object") walkJsx(child, visit);
  }
}

// -------------------- escape-hatch check --------------------
function hasEscapeAt(lines, lineIdx /* 0-based */) {
  const line = lines[lineIdx] ?? "";
  if (/allow-small-tap:/.test(line)) return true;
  for (let i = lineIdx - 1; i >= 0; i--) {
    const prev = lines[i];
    if (!prev.trim()) continue;
    return /allow-small-tap:/.test(prev);
  }
  return false;
}

// -------------------- transform --------------------
const INJECT = "min-h-11 min-w-11";

/**
 * Build the list of edits for one file. Each edit is
 *   { start, end, replacement }
 * against the original source, sorted so we apply them back-to-front.
 */
function planEdits(source) {
  if (source.includes("allow-small-tap-file:")) {
    return { edits: [], fixed: 0, manual: 0 };
  }
  let ast;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
      errorRecovery: true,
    });
  } catch {
    return { edits: [], fixed: 0, manual: 0, parseFailed: true };
  }
  const lines = source.split("\n");
  const edits = [];
  let fixed = 0;
  let manual = 0;

  walkJsx(ast, (node) => {
    if (node.type !== "JSXOpeningElement") return;
    if (elementName(node) !== "Button") return;
    if (!isIconButton(node)) return;

    const lineIdx = (node.loc?.start.line ?? 1) - 1;
    if (hasEscapeAt(lines, lineIdx)) return;

    const classAttr = getAttr(node, "className");
    const info = classifyClassName(classAttr);
    const staticText = info.staticText ?? "";
    const { hasBigMin } = analyzeClasses(staticText.split(/\s+/));
    if (hasBigMin) return;

    if (info.kind === "dynamic") {
      manual += 1;
      return;
    }
    if (info.kind === "none") {
      // Insert a fresh className right after the tag name.
      const tagEnd = node.name.end;
      edits.push({
        start: tagEnd,
        end: tagEnd,
        replacement: ` className="${INJECT}"`,
      });
      fixed += 1;
      return;
    }
    // string / expr-string / template: append inside the literal, one
    // leading space so we don't collapse against the last existing class.
    const lit = info.node;
    if (info.kind === "template") {
      // Splice before the closing backtick of the single quasi.
      const q = lit.quasis[0];
      const insertAt = q.end - 1; // char before "`" or "${"; here no interp so it's the final "`"
      // For a no-interp template, quasi.end points to the final backtick's
      // position (Babel: TemplateElement.end == index of the terminator).
      const needsSpace = staticText.length > 0 && !/\s$/.test(staticText);
      edits.push({
        start: insertAt,
        end: insertAt,
        replacement: (needsSpace ? " " : "") + INJECT,
      });
    } else {
      // StringLiteral has enclosing quotes in the source; splice before
      // the closing quote at (lit.end - 1).
      const insertAt = lit.end - 1;
      const needsSpace = staticText.length > 0 && !/\s$/.test(staticText);
      edits.push({
        start: insertAt,
        end: insertAt,
        replacement: (needsSpace ? " " : "") + INJECT,
      });
    }
    fixed += 1;
  });

  return { edits, fixed, manual };
}

function applyEdits(source, edits) {
  const sorted = edits.slice().sort((a, b) => b.start - a.start);
  let out = source;
  for (const e of sorted) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  }
  return out;
}

// -------------------- main --------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const files = [];
  for (const p of opts.paths) {
    files.push(...(await walk(path.resolve(ROOT, p))));
  }

  let totalFixed = 0;
  let totalManual = 0;
  let filesChanged = 0;
  const perFile = [];
  const manualFiles = [];
  const parseFails = [];

  for (const file of files) {
    const src = await readFile(file, "utf8");
    const plan = planEdits(src);
    if (plan.parseFailed) {
      parseFails.push(path.relative(ROOT, file));
      continue;
    }
    if (plan.fixed === 0 && plan.manual === 0) continue;

    totalFixed += plan.fixed;
    totalManual += plan.manual;
    if (plan.manual > 0) manualFiles.push({ file: path.relative(ROOT, file), count: plan.manual });
    if (plan.fixed === 0) continue;

    const next = applyEdits(src, plan.edits);
    filesChanged += 1;
    perFile.push({ file: path.relative(ROOT, file), fixed: plan.fixed });
    if (opts.write) await writeFile(file, next, "utf8");
  }

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          mode: opts.write ? "write" : "dry-run",
          filesScanned: files.length,
          filesChanged,
          totalFixed,
          needsManualReview: totalManual,
          perFile,
          manualFiles,
          parseFailures: parseFails,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    `${opts.write ? "✎ wrote" : "≡ dry-run"}: ${filesChanged} file(s) modified, ${totalFixed} icon Button(s) fixed`,
  );
  if (perFile.length > 0) {
    for (const r of perFile) console.log(`  ${r.file}  +${r.fixed}`);
  }
  if (totalManual > 0) {
    console.log(`\n⚠ ${totalManual} icon Button(s) with dynamic className need manual review:`);
    for (const r of manualFiles) console.log(`  ${r.file}  (${r.count})`);
  }
  if (parseFails.length > 0) {
    console.log(`\n⚠ ${parseFails.length} file(s) failed to parse (skipped):`);
    for (const f of parseFails) console.log(`  ${f}`);
  }
  if (!opts.write) console.log(`\nRun with --write to apply.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
