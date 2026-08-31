#!/usr/bin/env node
/**
 * validate-supabase-columns.mjs
 *
 * Schema-aware static validator. Fails CI when source code references a
 * Supabase column that does not exist in the generated types.ts schema.
 *
 * Motivation: shipped bug — `payments.payment_id` was referenced in three
 * files but the real column is `receipt_no`. The dashboard failed at runtime
 * with `column payments.payment_id does not exist`. This script catches
 * that class of regression at build time.
 *
 * Strategy:
 *  1. Parse src/integrations/supabase/types.ts and extract each table's
 *     Row column names from the `Row: { ... }` block.
 *  2. Scan src/**\/*.{ts,tsx} for `.from("<table>")` chains and any
 *     column-string arguments passed to:
 *       - .select("a,b,c(*)")
 *       - .eq/.neq/.gt/.gte/.lt/.lte/.like/.ilike/.is/.in/.contains/.match/.filter("col", ...)
 *       - .order("col", ...)
 *       - .not("col", ...)
 *  3. Additionally scan every string / template literal in the file for raw
 *     SQL (SELECT … FROM, INSERT INTO, UPDATE … SET) and validate the
 *     referenced column identifiers against the target table's schema.
 *  4. Report every unknown column with file:line context. Exit 1 on any.
 *
 * Usage:
 *   node scripts/ci/validate-supabase-columns.mjs
 *   node scripts/ci/validate-supabase-columns.mjs --json   # machine output
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TYPES_PATH = path.join(ROOT, "src/integrations/supabase/types.ts");
const SRC_DIR = path.join(ROOT, "src");
const JSON_MODE = process.argv.includes("--json");

// ---------- 1. Parse schema from types.ts ----------

/** @returns {Record<string, Set<string>>} */
function parseSchema(source) {
  const schema = {};
  // Find the `public: { Tables: { ... } }` block by locating each
  // `<tableName>: {` followed by `Row: { ... }`.
  // Match table declarations at indentation typical of the generated file.
  const tableRe = /^\s{6}([A-Za-z_][\w]*):\s*\{\s*$/gm;
  let m;
  while ((m = tableRe.exec(source)) !== null) {
    const name = m[1];
    // Search forward for the nearest `Row: {` and capture until the balancing `}`.
    const after = source.slice(m.index);
    const rowStart = after.search(/\n\s+Row:\s*\{\s*\n/);
    if (rowStart < 0) continue;
    const rowBodyStart = after.indexOf("{", rowStart) + 1;
    // Balance braces.
    let depth = 1;
    let i = rowBodyStart;
    for (; i < after.length && depth > 0; i++) {
      const c = after[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
    }
    const body = after.slice(rowBodyStart, i - 1);
    const cols = new Set();
    for (const line of body.split("\n")) {
      const cm = line.match(/^\s*([A-Za-z_][\w]*)\s*[:?]/);
      if (cm) cols.add(cm[1]);
    }
    if (cols.size > 0) schema[name] = cols;
  }
  return schema;
}

// ---------- 2. Walk src/ for .ts/.tsx ----------

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(ent.name) && !ent.name.endsWith(".d.ts")) {
      // Skip generated + test fixtures.
      if (p.endsWith("integrations/supabase/types.ts")) continue;
      if (p.includes("/__tests__/") || /\.test\.[tj]sx?$/.test(p)) continue;
      out.push(p);
    }
  }
  return out;
}

// ---------- 3. Extract per-file references ----------

// Filter-style methods whose FIRST string arg is a column name.
const FILTER_METHODS = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "is",
  "in",
  "contains",
  "containedBy",
  "match",
  "filter",
  "order",
  "not",
  "rangeGt",
  "rangeGte",
  "rangeLt",
  "rangeLte",
  "rangeAdjacent",
  "overlaps",
  "textSearch",
]);

/**
 * Split a top-level .select() string into individual column tokens.
 * Handles nested embedded relations like `booking:bookings(id,client_name)`
 * by skipping anything inside balanced parentheses — those are embedded
 * relation columns, not columns on THIS table.
 */
function tokenizeSelect(sel) {
  const out = [];
  let buf = "";
  let depth = 0;
  for (const c of sel) {
    if (c === "(") {
      depth++;
      buf += c;
      continue;
    }
    if (c === ")") {
      depth--;
      buf += c;
      continue;
    }
    if (c === "," && depth === 0) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
    } else {
      buf += c;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * From a select token like `alias:column` or `alias:table(cols)` or just
 * `column`, return the local-column name to validate, or null when the
 * token references an embedded relation (skip; would need its own table).
 */
function localColumnFromSelectToken(tok) {
  // Embedded relation: contains "(" — skip (validated only at the embedded table level, not here).
  if (tok.includes("(")) return null;
  if (tok === "*") return null;
  if (tok.startsWith("count")) return null;
  // Alias `alias:column`
  const colonIdx = tok.indexOf(":");
  const raw = colonIdx >= 0 ? tok.slice(colonIdx + 1) : tok;
  // Strip cast `col::text`
  const noCast = raw.split("::")[0];
  // Strip ordering hints `col.asc.nullsfirst` (foreign-order syntax)
  const first = noCast.split(".")[0].trim();
  if (!first || !/^[A-Za-z_][\w]*$/.test(first)) return null;
  return first;
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

function scanFile(filePath, schema) {
  const src = fs.readFileSync(filePath, "utf8");
  const findings = [];
  // Locate every `.from("<table>")` (also .from('<table>')). Then take a
  // window of up to ~4000 chars OR until the next `.from(` — whichever comes
  // first — and inspect chained calls in it.
  const fromRe = /\.from\(\s*["'`]([A-Za-z_][\w]*)["'`]\s*\)/g;
  const fromMatches = [];
  let fm;
  while ((fm = fromRe.exec(src)) !== null) {
    fromMatches.push({ table: fm[1], start: fm.index + fm[0].length, absIndex: fm.index });
  }
  for (let i = 0; i < fromMatches.length; i++) {
    const { table, start } = fromMatches[i];
    if (!schema[table]) continue; // Unknown table — skip (could be RPC/view).
    // Walk forward tracking bracket depth so the chain window ends at the
    // enclosing statement boundary (`;`, `,`, or a closing bracket that would
    // drop below the starting depth) instead of bleeding into the next
    // sibling — e.g. into a neighboring fetchAll(q => q.select(...)) call.
    let end = src.length;
    let depth = 0;
    let inStr = null;
    for (let j = start; j < src.length; j++) {
      const c = src[j],
        prev = src[j - 1];
      if (inStr) {
        if (c === inStr && prev !== "\\") inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        inStr = c;
        continue;
      }
      if (c === "(" || c === "[" || c === "{") {
        depth++;
        continue;
      }
      if (c === ")" || c === "]" || c === "}") {
        if (depth === 0) {
          end = j;
          break;
        }
        depth--;
        continue;
      }
      if (depth === 0 && (c === ";" || c === ",")) {
        end = j;
        break;
      }
    }
    const window = src.slice(start, end);
    const cols = schema[table];

    // .select("...") — allow multi-line, arbitrary whitespace.
    const selRe = /\.select\(\s*(["'`])([\s\S]*?)\1/g;
    let sm;
    while ((sm = selRe.exec(window)) !== null) {
      for (const tok of tokenizeSelect(sm[2])) {
        const col = localColumnFromSelectToken(tok);
        if (col && !cols.has(col)) {
          findings.push({
            file: path.relative(ROOT, filePath),
            line: lineOf(src, start + sm.index),
            table,
            column: col,
            method: "select",
            snippet: tok,
          });
        }
      }
    }

    // Filter methods with a leading string column.
    const filterRe = /\.([A-Za-z]+)\(\s*(["'`])([A-Za-z_][\w]*)\2/g;
    let fmm;
    while ((fmm = filterRe.exec(window)) !== null) {
      const method = fmm[1];
      if (!FILTER_METHODS.has(method)) continue;
      const col = fmm[3];
      if (!cols.has(col)) {
        findings.push({
          file: path.relative(ROOT, filePath),
          line: lineOf(src, start + fmm.index),
          table,
          column: col,
          method,
          snippet: `.${method}("${col}", …)`,
        });
      }
    }
  }
  findings.push(...scanRawSql(src, schema, filePath));
  return findings;
}

// ---------- 3b. Raw SQL string scanner ----------

/**
 * Precompute [start,end) offsets of every string / template literal in the
 * source. We only trust raw-SQL matches that fall inside one of these spans,
 * to avoid false positives from comments or accidental keyword clashes in
 * ordinary code.
 */
function stringLiteralSpans(src) {
  const spans = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    // Line comment
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i + 2);
      i = nl < 0 ? n : nl + 1;
      continue;
    }
    // Block comment
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      const start = i + 1;
      i++;
      while (i < n) {
        const ch = src[i];
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (quote === "`" && ch === "$" && src[i + 1] === "{") {
          // Skip ${...} interpolation with brace balancing.
          spans.push([start, i]);
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            const cc = src[i];
            if (cc === "{") depth++;
            else if (cc === "}") depth--;
            i++;
          }
          // Resume template literal after interpolation
          const resume = i;
          while (i < n) {
            const cch = src[i];
            if (cch === "\\") {
              i += 2;
              continue;
            }
            if (cch === "$" && src[i + 1] === "{") {
              spans.push([resume, i]);
              i += 2;
              let d = 1;
              while (i < n && d > 0) {
                const x = src[i];
                if (x === "{") d++;
                else if (x === "}") d--;
                i++;
              }
              continue;
            }
            if (cch === "`") {
              spans.push([resume, i]);
              i++;
              break;
            }
            i++;
          }
          break;
        }
        if (ch === quote) {
          spans.push([start, i]);
          i++;
          break;
        }
        if (quote !== "`" && ch === "\n") {
          i++;
          break;
        } // unterminated single-line
        i++;
      }
      continue;
    }
    i++;
  }
  return spans;
}

function inString(spans, idx) {
  // spans are in order; linear scan is fine for our file sizes.
  for (const [s, e] of spans) {
    if (idx >= s && idx < e) return true;
    if (s > idx) return false;
  }
  return false;
}

function splitTopLevel(str, sep) {
  const out = [];
  let buf = "";
  let depth = 0;
  let inStr = null;
  for (const c of str) {
    if (inStr) {
      buf += c;
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"') {
      inStr = c;
      buf += c;
      continue;
    }
    if (c === "(" || c === "[") {
      depth++;
      buf += c;
      continue;
    }
    if (c === ")" || c === "]") {
      depth--;
      buf += c;
      continue;
    }
    if (c === sep && depth === 0) {
      if (buf.trim()) out.push(buf);
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/**
 * Extract a simple column identifier from one SELECT-list item. Skips
 * anything with a function call, aggregate, subquery, or `*`. Handles
 * `col`, `"col"`, `t.col`, `table.col AS alias`, and `col AS alias`.
 * Returns { col, qualifier } where qualifier is the table/alias if present.
 */
function extractSelectColumn(item) {
  const s = item
    .trim()
    .replace(/\s+AS\s+[A-Za-z_"][\w"]*\s*$/i, "")
    .trim();
  if (!s || s === "*") return null;
  if (s.includes("(") || s.includes(" ") || s.includes("::")) return null;
  const parts = s.split(".").map((p) => p.replace(/^"|"$/g, ""));
  if (parts.length === 1) {
    if (parts[0] === "*") return null;
    if (!/^[A-Za-z_]\w*$/.test(parts[0])) return null;
    return { qualifier: null, col: parts[0] };
  }
  if (parts.length === 2) {
    if (parts[1] === "*") return null;
    if (!/^[A-Za-z_]\w*$/.test(parts[1])) return null;
    return { qualifier: parts[0], col: parts[1] };
  }
  return null;
}

function scanRawSql(src, schema, filePath) {
  const findings = [];
  const spans = stringLiteralSpans(src);
  const rel = path.relative(ROOT, filePath);

  const push = (idx, table, column, method, snippet) => {
    findings.push({
      file: rel,
      line: lineOf(src, idx),
      table,
      column,
      method,
      snippet: (snippet || "").trim().replace(/\s+/g, " ").slice(0, 100),
    });
  };

  // SELECT <cols> FROM [public.]<table>
  const selectRe = /\bSELECT\s+([\s\S]+?)\s+FROM\s+(?:public\.)?"?([A-Za-z_]\w*)"?/gi;
  let m;
  while ((m = selectRe.exec(src)) !== null) {
    if (!inString(spans, m.index)) continue;
    const table = m[2];
    if (!schema[table]) continue;
    // Skip when the SELECT list references any JOIN alias — too ambiguous to attribute columns.
    const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 400);
    const hasJoin =
      /\bJOIN\b/i.test(tail) || /,\s*(?:public\.)?[A-Za-z_]\w*\s+[A-Za-z_]/.test(tail);
    const cols = schema[table];
    for (const raw of splitTopLevel(m[1], ",")) {
      const parsed = extractSelectColumn(raw);
      if (!parsed) continue;
      if (parsed.qualifier && hasJoin) continue; // can't resolve alias → table
      if (parsed.qualifier && parsed.qualifier !== table) continue;
      if (!cols.has(parsed.col)) push(m.index, table, parsed.col, "raw-sql-select", raw);
    }
  }

  // INSERT INTO [public.]<table> (col, col, ...)
  const insertRe = /\bINSERT\s+INTO\s+(?:public\.)?"?([A-Za-z_]\w*)"?\s*\(([^)]+)\)/gi;
  while ((m = insertRe.exec(src)) !== null) {
    if (!inString(spans, m.index)) continue;
    const table = m[1];
    if (!schema[table]) continue;
    const cols = schema[table];
    for (const raw of m[2].split(",")) {
      const col = raw.trim().replace(/^"|"$/g, "");
      if (!/^[A-Za-z_]\w*$/.test(col)) continue;
      if (!cols.has(col)) push(m.index, table, col, "raw-sql-insert", col);
    }
  }

  // UPDATE [public.]<table> SET col = ..., col2 = ...
  const updateRe =
    /\bUPDATE\s+(?:public\.)?"?([A-Za-z_]\w*)"?\s+SET\s+([\s\S]+?)(?=\bWHERE\b|\bRETURNING\b|\bFROM\b|;|$)/gi;
  while ((m = updateRe.exec(src)) !== null) {
    if (!inString(spans, m.index)) continue;
    const table = m[1];
    if (!schema[table]) continue;
    const cols = schema[table];
    for (const assign of splitTopLevel(m[2], ",")) {
      const am = assign.match(/^\s*"?([A-Za-z_]\w*)"?\s*=/);
      if (!am) continue;
      if (!cols.has(am[1])) push(m.index, table, am[1], "raw-sql-update", assign);
    }
  }

  return findings;
}

if (!fs.existsSync(TYPES_PATH)) {
  console.error(`✖ Missing ${TYPES_PATH}`);
  process.exit(2);
}
const schema = parseSchema(fs.readFileSync(TYPES_PATH, "utf8"));
if (Object.keys(schema).length === 0) {
  console.error("✖ Parsed 0 tables from types.ts — parser out of date.");
  process.exit(2);
}

const files = walk(SRC_DIR);
const all = [];
for (const f of files) all.push(...scanFile(f, schema));

if (JSON_MODE) {
  console.log(
    JSON.stringify(
      {
        ok: all.length === 0,
        findings: all,
        tables_scanned: Object.keys(schema).length,
        files_scanned: files.length,
      },
      null,
      2,
    ),
  );
  process.exit(all.length === 0 ? 0 : 1);
}

console.log(`Supabase column validator`);
console.log(`  tables in schema : ${Object.keys(schema).length}`);
console.log(`  source files     : ${files.length}`);

if (all.length === 0) {
  console.log(`✓ All referenced columns exist in the generated schema.`);
  process.exit(0);
}

console.log(`\n✖ ${all.length} unknown column reference(s):\n`);
for (const f of all) {
  const known = [...schema[f.table]].sort();
  const suggest = known
    .filter(
      (k) =>
        k.toLowerCase().includes(f.column.toLowerCase()) ||
        f.column.toLowerCase().includes(k.toLowerCase()),
    )
    .slice(0, 3);
  console.log(`  ${f.file}:${f.line}`);
  console.log(`    table  : ${f.table}`);
  console.log(`    column : ${f.column}   (via ${f.method})`);
  console.log(`    at     : ${f.snippet}`);
  if (suggest.length) console.log(`    did you mean: ${suggest.join(", ")}`);
  console.log("");
}
console.log(`Fix or update src/integrations/supabase/types.ts, then re-run.`);
process.exit(1);
