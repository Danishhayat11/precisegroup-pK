#!/usr/bin/env node
/**
 * tap-target-audit.mjs — build-time a11y gate.
 *
 * Fails the build if any interactive control renders smaller than 44×44 CSS
 * px on mobile / tablet, per WCAG 2.5.5 and the project's tap-target rule
 * (see `tests/a11y/responsive-breakpoints.spec.ts` + the a11y knowledge).
 *
 * Why a static check on top of the Playwright suite?
 *   • The Playwright suite (`test:a11y:responsive`) only audits /site,
 *     /login, and /dashboard because it needs a running server and a live
 *     session. That catches regressions on those routes but misses every
 *     other page.
 *   • This static scanner covers ALL of `src/`, runs in the `prebuild`
 *     hook, and blocks the build with a clear per-offender report. New
 *     small-tap icon buttons anywhere in the app are caught immediately.
 *
 * Scope (kept deterministic to avoid noisy false positives):
 *   R1  `<Button size="icon" ...>` must bump to at least 44×44 via
 *       `min-h-11 min-w-11` / `size-11+` / `h-11 w-11+` / `min-h-[≥44px]`
 *       (or equivalent). Default shadcn icon button is 36×36.
 *   R2  Any `<Button>`, `<button>`, `<a>`, `<input>`, or `<textarea>`
 *       carrying an explicit `h-<N>` / `w-<N>` / `size-<N>` (N < 11 in
 *       Tailwind's rem scale, i.e. < 44px) at an unprefixed / `sm:` /
 *       `md:` breakpoint must also include a `min-h-11 min-w-11` (or
 *       ≥ 11) that applies at those breakpoints.
 *
 * Compliant escape hatches (auditable via git blame):
 *   • same line:              // allow-small-tap: <reason>
 *   • preceding line:         {/* allow-small-tap: <reason> * /}
 *   • whole-file:             /* allow-small-tap-file: <reason> * /
 *   • desktop-only prefix:    every small-size class is prefixed with
 *     `lg:`, `xl:`, or `2xl:` (so the element never renders that small on
 *     touch viewports).
 *
 * Exits 0 on success, 1 with a human-readable report on failure.
 */
import { readFile, readdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "@babel/parser";

const SRC = path.resolve("src");
const ALLOWLIST_PATH = path.resolve("scripts/ci/tap-target-audit.allowlist.json");
const MIN_TAP_UNIT = 11; // Tailwind unit == 0.25rem == 4px; 11 == 44px.
const DESKTOP_PREFIXES = new Set(["lg", "xl", "2xl"]);
const IGNORED_PREFIXES = new Set(["print", "motion-reduce", "motion-safe"]);
const TOUCH_INTERACTIVE = new Set(["Button", "button", "a", "input", "textarea"]);

/** Collect every .tsx/.jsx/.ts/.js file under `src/`. */
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

/**
 * Split a Tailwind class like `md:hover:h-8` into prefix segments + core.
 * Returns `{ prefixes: ["md","hover"], core: "h-8" }`.
 */
function splitClass(cls) {
  const parts = cls.split(":");
  return { prefixes: parts.slice(0, -1), core: parts.at(-1) ?? "" };
}

/**
 * Parse the numeric size from a Tailwind class core.
 * Returns the value in Tailwind units (1 unit = 4px), or null if not a
 * size-relevant class.  Handles `h-N`, `w-N`, `size-N`, `min-h-N`,
 * `min-w-N` (integer N) and arbitrary `[Npx]` / `[Nrem]` values.
 */
function parseSizeCore(core) {
  const m = /^(min-h|min-w|h|w|size)-(.+)$/.exec(core);
  if (!m) return null;
  const [, prop, value] = m;
  // Arbitrary values: h-[44px], min-h-[3rem], etc.
  const bracket = /^\[(\d+(?:\.\d+)?)(px|rem)\]$/.exec(value);
  if (bracket) {
    const n = Number(bracket[1]);
    const units = bracket[2] === "px" ? n / 4 : (n * 16) / 4;
    return { prop, units };
  }
  // Numeric Tailwind scale: h-8 → 8 units. Fractional (h-1/2), h-full,
  // h-screen, h-dvh, h-auto — treat as "not a fixed small size".
  const numeric = /^(\d+(?:\.\d+)?)$/.exec(value);
  if (!numeric) return null;
  return { prop, units: Number(numeric[1]) };
}

/** True if `prefixes` render on mobile/tablet (i.e. NOT desktop-only). */
function appliesToTouch(prefixes) {
  // If ANY prefix is a desktop-only breakpoint, the class is desktop-gated.
  // (Tailwind stacks prefixes; a desktop breakpoint prefix restricts the
  // whole class to that breakpoint upward.)
  for (const p of prefixes) {
    if (DESKTOP_PREFIXES.has(p)) return false;
  }
  return true;
}

/**
 * Given a class list, produce:
 *   • smallOffenders: [{ cls, prop, units }] for size classes < 11 units
 *     that would apply on mobile/tablet
 *   • hasBigMin: true iff the list guarantees min-h≥11 AND min-w≥11 on
 *     mobile/tablet (via `min-h-11+`, `size-11+`, `h-11+ w-11+`, or an
 *     arbitrary [≥44px] equivalent)
 */
function analyzeClasses(classList) {
  const smallOffenders = [];
  let minH = 0;
  let minW = 0;
  for (const raw of classList) {
    const cls = raw.trim();
    if (!cls) continue;
    const { prefixes, core } = splitClass(cls);
    if (prefixes.some((p) => IGNORED_PREFIXES.has(p))) continue;
    if (!appliesToTouch(prefixes)) continue;
    const parsed = parseSizeCore(core);
    if (!parsed) continue;
    if (
      parsed.units < MIN_TAP_UNIT &&
      (parsed.prop === "h" || parsed.prop === "w" || parsed.prop === "size")
    ) {
      smallOffenders.push({ cls, ...parsed });
    }
    if (parsed.units >= MIN_TAP_UNIT) {
      if (parsed.prop === "min-h" || parsed.prop === "h" || parsed.prop === "size")
        minH = Math.max(minH, parsed.units);
      if (parsed.prop === "min-w" || parsed.prop === "w" || parsed.prop === "size")
        minW = Math.max(minW, parsed.units);
    }
  }
  const hasBigMin = minH >= MIN_TAP_UNIT && minW >= MIN_TAP_UNIT;
  return { smallOffenders, hasBigMin };
}

/**
 * Pull a static className string from a JSX attribute value. We handle
 * three forms: plain string, JSX expression containing a string literal,
 * and simple template literals with no interpolation. Dynamic bindings
 * (function calls, ternaries) return null — the scanner treats those as
 * unknown and skips them; that's a conservative choice to keep false
 * positives near zero.
 */
function readClassName(attr) {
  const v = attr.value;
  if (!v) return null;
  if (v.type === "StringLiteral") return v.value;
  if (v.type === "JSXExpressionContainer") {
    const e = v.expression;
    if (e.type === "StringLiteral") return e.value;
    if (e.type === "TemplateLiteral" && e.expressions.length === 0) {
      return e.quasis.map((q) => q.value.cooked).join("");
    }
    // cn("a", "b", cond && "c") — pluck literal string args conservatively.
    if (e.type === "CallExpression") {
      const parts = [];
      for (const arg of e.arguments) {
        if (arg.type === "StringLiteral") parts.push(arg.value);
        else if (arg.type === "LogicalExpression" && arg.right?.type === "StringLiteral") {
          parts.push(arg.right.value);
        } else if (arg.type === "ConditionalExpression") {
          if (arg.consequent?.type === "StringLiteral") parts.push(arg.consequent.value);
          if (arg.alternate?.type === "StringLiteral") parts.push(arg.alternate.value);
        }
      }
      return parts.join(" ");
    }
  }
  return null;
}

function getAttr(openingElement, name) {
  return openingElement.attributes.find((a) => a.type === "JSXAttribute" && a.name?.name === name);
}

function elementName(openingElement) {
  const n = openingElement.name;
  if (n.type === "JSXIdentifier") return n.name;
  return null;
}

/** Extract `size="icon"` (or size={"icon"}) from a Button opener. */
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

async function scanFile(file) {
  const source = await readFile(file, "utf8");
  if (source.includes("allow-small-tap-file:")) return [];
  let ast;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
      errorRecovery: true,
    });
  } catch (err) {
    // Skip unparseable files rather than blocking the build on a syntax
    // error unrelated to tap targets — the TypeScript build will catch it.
    return [];
  }
  const lines = source.split("\n");
  const violations = [];

  /** Return true if the JSX line has an inline/preceding allow-small-tap comment. */
  function hasEscapeAt(lineIdx /* 0-based */) {
    const line = lines[lineIdx] ?? "";
    if (/allow-small-tap:/.test(line)) return true;
    // Preceding non-blank line may hold {/* allow-small-tap: … */}.
    for (let i = lineIdx - 1; i >= 0; i--) {
      const prev = lines[i];
      if (!prev.trim()) continue;
      return /allow-small-tap:/.test(prev);
    }
    return false;
  }

  walkJsx(ast, (node) => {
    if (node.type !== "JSXOpeningElement") return;
    const tag = elementName(node);
    if (!tag) return;
    if (!TOUCH_INTERACTIVE.has(tag) && tag !== "Button") return;

    const classAttr = getAttr(node, "className");
    const classes = classAttr ? readClassName(classAttr) : "";
    // `readClassName` returns null when the binding is fully dynamic.
    // Fall back to empty-string analysis so R1 (icon button default)
    // still flags size="icon" with a dynamic className that we can't
    // statically prove is compliant.
    const classList = (classes ?? "").split(/\s+/);
    const { smallOffenders, hasBigMin } = analyzeClasses(classList);

    const lineIdx = (node.loc?.start.line ?? 1) - 1;
    if (hasEscapeAt(lineIdx)) return;

    // R1 — shadcn Button size="icon" defaults to 36×36. Requires a bump.
    if (tag === "Button" && isIconButton(node) && !hasBigMin) {
      violations.push({
        file,
        line: lineIdx + 1,
        rule: "R1",
        reason: `<Button size="icon"> needs min-h-11 min-w-11 (or size-11+/h-11 w-11+); default renders 36×36 < 44×44`,
        snippet: (lines[lineIdx] ?? "").trim().slice(0, 160),
      });
      return;
    }

    // R2 — explicit small size classes on interactive controls.
    if (smallOffenders.length > 0 && !hasBigMin) {
      violations.push({
        file,
        line: lineIdx + 1,
        rule: "R2",
        reason: `<${tag}> has small tap-size class(es) [${smallOffenders.map((o) => o.cls).join(", ")}] < 44px on mobile/tablet without a matching min-h-11 min-w-11`,
        snippet: (lines[lineIdx] ?? "").trim().slice(0, 160),
      });
    }
  });

  return violations;
}

function walkJsx(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "range" || key === "parent") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) walkJsx(c, visit);
    } else if (child && typeof child === "object" && "type" in child) {
      walkJsx(child, visit);
    }
  }
}

/**
 * Allowlist entry identity: `<posix-relative-path>|<rule>|<snippet>`.
 * We deliberately key on the offending JSX snippet rather than line
 * number so unrelated edits above don't invalidate the entry, while any
 * material change to the offending element itself drops the grandfathered
 * pass and requires a fresh look.
 */
function keyOf(v) {
  const rel = path.relative(process.cwd(), v.file).split(path.sep).join("/");
  return `${rel}|${v.rule}|${v.snippet}`;
}

async function loadAllowlist() {
  try {
    const raw = await readFile(ALLOWLIST_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return new Set((parsed.entries ?? []).map((e) => `${e.file}|${e.rule}|${e.snippet}`));
  } catch {
    return new Set();
  }
}

async function writeAllowlist(violations) {
  const entries = violations
    .map((v) => ({
      file: path.relative(process.cwd(), v.file).split(path.sep).join("/"),
      rule: v.rule,
      snippet: v.snippet,
    }))
    .sort((a, b) => (a.file + a.snippet).localeCompare(b.file + b.snippet));
  const body = {
    generatedAt: new Date().toISOString(),
    note:
      "Grandfathered tap-target violations. New offenders block the build; " +
      "clear an entry by fixing the underlying JSX (min-h-11 min-w-11) or " +
      "adding an inline // allow-small-tap: <reason> comment. Re-run with " +
      "`node scripts/ci/tap-target-audit.mjs --update-allowlist` after " +
      "intentional cleanup.",
    minTapPx: MIN_TAP_UNIT * 4,
    entries,
  };
  await writeFile(ALLOWLIST_PATH, JSON.stringify(body, null, 2) + "\n");
}

async function main() {
  const argv = new Set(process.argv.slice(2));
  const updateMode = argv.has("--update-allowlist");
  const files = await walk(SRC);
  const all = [];
  for (const f of files) {
    const v = await scanFile(f);
    all.push(...v);
  }

  if (updateMode) {
    await writeAllowlist(all);
    console.log(
      `Wrote ${all.length} grandfathered entry${all.length === 1 ? "" : "ies"} to ${path.relative(process.cwd(), ALLOWLIST_PATH)}`,
    );
    return;
  }

  const allowlist = await loadAllowlist();
  const fresh = [];
  const grandfathered = [];
  for (const v of all) {
    if (allowlist.has(keyOf(v))) grandfathered.push(v);
    else fresh.push(v);
  }

  if (fresh.length === 0) {
    console.log(
      `✓ tap-target audit clean (${files.length} files scanned, min ${MIN_TAP_UNIT * 4}×${MIN_TAP_UNIT * 4} px on mobile/tablet, ${grandfathered.length} grandfathered)`,
    );
    return;
  }

  const grouped = new Map();
  for (const v of fresh) {
    if (!grouped.has(v.file)) grouped.set(v.file, []);
    grouped.get(v.file).push(v);
  }
  // ---- Headline summary ---------------------------------------------------
  // One-glance banner: total offenders, file count, top rule, and top file.
  // Reviewers see this in the first frame of the failing log; the detailed
  // file:line list follows so it's easy to jump straight to the fix.
  const ruleCounts = new Map();
  for (const v of fresh) ruleCounts.set(v.rule, (ruleCounts.get(v.rule) ?? 0) + 1);
  const topRule = [...ruleCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const topFileEntry = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const topFileRel = topFileEntry ? path.relative(process.cwd(), topFileEntry[0]) : "";

  console.error(`━━━ ✗ TAP-TARGET AUDIT FAILED ━━━`);
  console.error(
    `  ${fresh.length} violation${fresh.length === 1 ? "" : "s"} across ${grouped.size} file${grouped.size === 1 ? "" : "s"}  ·  WCAG 2.5.5: ≥ 44×44 CSS px on touch viewports`,
  );
  if (topRule) {
    console.error(
      `  Top rule: ${topRule[0]} (${topRule[1]})   Top file: ${topFileRel} (${topFileEntry[1].length})   Grandfathered: ${grandfathered.length}`,
    );
  }
  console.error("");
  console.error(`  Offenders (file:line):`);

  // GitHub Actions surfaces `::error file=...,line=...::message` workflow
  // commands as inline annotations on the PR "Files changed" tab and in the
  // check-run summary. Emit one per violation so reviewers see the exact
  // offending line without scrolling the raw log.
  const isGithubActions = process.env.GITHUB_ACTIONS === "true";
  const escapeAnnotation = (s) =>
    String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  for (const [file, vs] of grouped) {
    const rel = path.relative(process.cwd(), file);
    console.error(`  ${rel}`);
    for (const v of vs) {
      console.error(`    L${v.line}  [${v.rule}] ${v.reason}`);
      console.error(`           | ${v.snippet}`);
      if (isGithubActions) {
        const title = escapeAnnotation(`Tap target < 44×44 (${v.rule})`);
        const message = escapeAnnotation(
          `${v.reason}\n${v.snippet}\nFix: add min-h-11 min-w-11, or gate small size with lg:/xl:. Escape hatch: // allow-small-tap: <reason>`,
        );
        // `col=1` keeps the annotation anchored to the line even when the
        // matched JSX spans multiple columns; GitHub still highlights the
        // full line in the diff view.
        console.log(`::error file=${rel},line=${v.line},col=1,title=${title}::${message}`);
      }
    }
  }
  console.error("");
  console.error(
    `Fix: add min-h-11 min-w-11 (44×44) — bump size on mobile/tablet, or gate the small size with lg:/xl:.`,
  );
  console.error(`Escape hatch (needs a reason for git-blame):`);
  console.error(`  • same line:      // allow-small-tap: <reason>`);
  console.error(`  • preceding line: {/* allow-small-tap: <reason> */}`);
  console.error(`  • whole file:     /* allow-small-tap-file: <reason> */`);
  console.error(
    `Intentional legacy-refresh only: node scripts/ci/tap-target-audit.mjs --update-allowlist`,
  );

  // ---- GitHub Actions job summary ----------------------------------------
  // Rendered on the workflow run page above the log — same headline plus a
  // markdown table of every offender so reviewers can triage without
  // expanding the log or opening every annotation.
  if (isGithubActions && process.env.GITHUB_STEP_SUMMARY) {
    const lines = [];
    lines.push(`## ✗ Tap-target audit failed`);
    lines.push("");
    lines.push(
      `**${fresh.length} violation${fresh.length === 1 ? "" : "s"}** across **${grouped.size} file${grouped.size === 1 ? "" : "s"}** — WCAG 2.5.5 requires ≥ 44×44 CSS px on touch viewports. Grandfathered: ${grandfathered.length}.`,
    );
    if (topRule) {
      lines.push("");
      lines.push(`- Top rule: \`${topRule[0]}\` (${topRule[1]})`);
      lines.push(`- Top file: \`${topFileRel}\` (${topFileEntry[1].length})`);
    }
    lines.push("");
    lines.push(`| File | Line | Rule | Reason |`);
    lines.push(`| --- | ---: | --- | --- |`);
    for (const [file, vs] of grouped) {
      const rel = path.relative(process.cwd(), file);
      for (const v of vs) {
        const reason = String(v.reason).replace(/\|/g, "\\|").replace(/\n/g, " ");
        lines.push(`| \`${rel}\` | ${v.line} | ${v.rule} | ${reason} |`);
      }
    }
    lines.push("");
    lines.push(
      `**Fix:** add \`min-h-11 min-w-11\` (44×44) on mobile/tablet, or gate the small size with \`lg:\`/\`xl:\`.`,
    );
    lines.push(`Escape hatch (needs a git-blame reason): \`// allow-small-tap: <reason>\`.`);
    await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  }

  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
