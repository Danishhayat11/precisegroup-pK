#!/usr/bin/env node
/**
 * Validate every pinned expectations file against the schema.
 *
 * Skips files whose basename starts with `_` (templates / README artifacts).
 * Exits 0 on success, 1 on any schema error, 2 on usage error.
 *
 * Usage:
 *   node scripts/audit/validate-expectations.mjs
 *   node scripts/audit/validate-expectations.mjs --dir path/to/expectations
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateExpectations } from "./expectations-schema.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { dir: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--dir" || a === "-d") {
      const v = argv[++i];
      if (!v) {
        console.error(`✗ ${a} requires a value`);
        process.exit(2);
      }
      out.dir = v;
    } else {
      console.error(`✗ unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

const { help, dir } = parseArgs(process.argv.slice(2));
if (help) {
  console.log("Usage: node scripts/audit/validate-expectations.mjs [--dir <path>]");
  process.exit(0);
}

const root = resolve(dir || join(__dirname, "expectations"));
if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`✗ expectations directory not found: ${root}`);
  process.exit(2);
}

const files = readdirSync(root)
  .filter((f) => f.endsWith(".json") && !basename(f).startsWith("_"))
  .sort();

if (files.length === 0) {
  console.log(`No expectations files found under ${root}.`);
  process.exit(0);
}

let failed = 0;
for (const f of files) {
  const path = join(root, f);
  const id = basename(f, ".json");
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`✗ ${f}: invalid JSON — ${e.message}`);
    failed++;
    continue;
  }
  const { valid, errors } = validateExpectations(doc, {
    source: f,
    expectedBookingId: id,
  });
  if (valid) {
    console.log(`✓ ${f}`);
  } else {
    failed++;
    console.error(`✗ ${f}`);
    for (const e of errors) console.error(`    • ${e}`);
  }
}

console.log(
  `\n${files.length - failed}/${files.length} expectations file(s) passed schema validation.`,
);
process.exit(failed > 0 ? 1 : 0);
