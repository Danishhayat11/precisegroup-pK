#!/usr/bin/env node
/**
 * Codemod: rewrite `supabase.rpc(...)` → `callRpc(...)` (client code) and
 * `context.supabase.rpc(...)` → `callServerRpc(context, ...)` (server fns),
 * inserting the correct import if missing. This is the automated counterpart
 * to `scripts/check-rpc-allowlist.mjs`, which merely fails CI on raw calls.
 *
 * Design notes:
 *   - Textual codemod (regex-based). The call sites are stereotyped
 *     (`supabase.rpc("name", args?)` / `context.supabase.rpc("name", args?)`),
 *     so a full AST pass is overkill; the check-rpc-allowlist scanner uses
 *     the same shape.
 *   - Dry-run by default. `--write` mutates files. Prints a per-file diff
 *     summary and exits non-zero when unapproved RPC names are encountered
 *     so CI can gate on it.
 *   - Skips generated / wrapper files (approvedRpc.ts, serverRpc.ts,
 *     client*.ts, types.ts) — they legitimately reference `.rpc(`.
 *   - Import insertion is idempotent; running twice is a no-op.
 *
 * Usage:
 *   node scripts/codemods/supabase-rpc-to-callRpc.mjs           # dry run
 *   node scripts/codemods/supabase-rpc-to-callRpc.mjs --write   # apply
 *   node scripts/codemods/supabase-rpc-to-callRpc.mjs --path src/features/foo
 */
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const paths = args.map((a, i) => (a === "--path" ? args[i + 1] : null)).filter(Boolean);
const ROOTS = paths.length ? paths : ["src"];

const SKIP_FILE_SUFFIXES = [
  "approvedRpc.ts",
  "serverRpc.ts",
  "client.ts",
  "client.server.ts",
  "auth-middleware.ts",
  "auth-attacher.ts",
  "types.ts",
];
const SKIP_DIRS = new Set(["node_modules", "dist", ".output", ".vinxi", "routeTree.gen.ts"]);

// Load approved RPC names for validation (best-effort textual parse).
const allowlistSrc = readFileSync("src/integrations/supabase/approvedRpc.ts", "utf8");
const APPROVED = new Set(
  Array.from(allowlistSrc.matchAll(/"([a-z_][a-z0-9_]*)"/gi))
    .map((m) => m[1])
    .filter((n) => n && !["ok", "error"].includes(n)),
);

/** @type {{file:string, changes:number, adds:string[], unknown:string[]}[]} */
const report = [];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

function shouldSkip(file) {
  const rel = relative(process.cwd(), file).split(sep).join("/");
  return SKIP_FILE_SUFFIXES.some((s) => rel.endsWith(s));
}

const CLIENT_RE = /\bsupabase\.rpc\(\s*"([a-zA-Z_][a-zA-Z0-9_]*)"/g;
const SERVER_RE = /\bcontext\.supabase\.rpc\(\s*"([a-zA-Z_][a-zA-Z0-9_]*)"/g;

function ensureImport(source, spec, module) {
  // Match: import { X, Y } from "module";
  const existing = source.match(
    new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${module.replace(/[/\\.]/g, "\\$&")}["'];?`),
  );
  if (existing) {
    const names = existing[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.includes(spec)) return source;
    const merged = [...names, spec].join(", ");
    return source.replace(existing[0], `import { ${merged} } from "${module}";`);
  }
  // Insert after last top-of-file import.
  const importBlock = source.match(/^(?:import[^\n]*\n)+/);
  const line = `import { ${spec} } from "${module}";\n`;
  return importBlock
    ? source.slice(0, importBlock[0].length) + line + source.slice(importBlock[0].length)
    : line + source;
}

function transform(source, file) {
  let out = source;
  const adds = [];
  const unknown = [];
  let count = 0;

  const isServerFn = file.endsWith(".functions.ts") || file.endsWith(".functions.tsx");

  if (SERVER_RE.test(out)) {
    SERVER_RE.lastIndex = 0;
    out = out.replace(SERVER_RE, (_m, name) => {
      count++;
      if (!APPROVED.has(name)) unknown.push(name);
      return `callServerRpc(context, "${name}"`;
    });
    out = ensureImport(out, "callServerRpc", "@/integrations/supabase/serverRpc");
    adds.push("callServerRpc");
  }

  if (CLIENT_RE.test(out)) {
    CLIENT_RE.lastIndex = 0;
    out = out.replace(CLIENT_RE, (_m, name) => {
      count++;
      if (!APPROVED.has(name)) unknown.push(name);
      return `callRpc("${name}"`;
    });
    // If this is a server-fn file, callRpc isn't appropriate — flag it.
    if (isServerFn) unknown.push("__client_callRpc_in_server_fn__");
    out = ensureImport(out, "callRpc", "@/integrations/supabase/approvedRpc");
    adds.push("callRpc");
  }

  return { out, count, adds, unknown };
}

let totalChanges = 0;
let totalFiles = 0;
const unknownNames = new Set();

for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (shouldSkip(file)) continue;
    const src = readFileSync(file, "utf8");
    if (!/\.rpc\(/.test(src)) continue;
    const { out, count, adds, unknown } = transform(src, file);
    if (count === 0 || out === src) continue;
    totalFiles++;
    totalChanges += count;
    report.push({ file, changes: count, adds, unknown });
    unknown.forEach((n) => unknownNames.add(n));
    if (WRITE) writeFileSync(file, out);
  }
}

for (const r of report) {
  const mark = WRITE ? "✍" : "•";
  console.log(
    `${mark} ${r.file}  (${r.changes} call${r.changes > 1 ? "s" : ""}, +${r.adds.join(", ") || "no imports"})`,
  );
  if (r.unknown.length) console.log(`    ⚠ unapproved: ${r.unknown.join(", ")}`);
}

console.log(
  `\n${WRITE ? "Rewrote" : "Would rewrite"} ${totalChanges} call${totalChanges === 1 ? "" : "s"} across ${totalFiles} file${totalFiles === 1 ? "" : "s"}.`,
);
if (!WRITE && totalChanges > 0) console.log("Run with --write to apply.");

// Non-zero exit when unapproved names appear so CI catches them.
const realUnknown = [...unknownNames].filter((n) => n !== "__client_callRpc_in_server_fn__");
if (realUnknown.length) {
  console.error(
    `\n❌ ${realUnknown.length} RPC name(s) missing from APPROVED_RPCS: ${realUnknown.join(", ")}`,
  );
  process.exit(2);
}
