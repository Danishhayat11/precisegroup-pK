#!/usr/bin/env node
/**
 * Run the live ledger vs cached booking cross-check for every pinned
 * expectations file IN PARALLEL inside a single process. Each booking is
 * spawned as its own `booking-reconciliation.mjs` child process so output,
 * exit codes, and $GITHUB_STEP_SUMMARY appends stay isolated per booking.
 *
 * Exits 0 only if every audit passes. Exits 1 if any audit fails. Exits 2
 * on usage errors.
 *
 * Usage:
 *   node scripts/audit/run-all-reconciliations.mjs              # all pinned files
 *   node scripts/audit/run-all-reconciliations.mjs BK-MA-00014 BK-MA-00015
 *   node scripts/audit/run-all-reconciliations.mjs --concurrency 4
 *   node scripts/audit/run-all-reconciliations.mjs --dir scripts/audit/expectations
 */
import { spawn } from "node:child_process";
import { readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDITOR = join(__dirname, "booking-reconciliation.mjs");

function parseArgs(argv) {
  const out = { ids: [], dir: null, concurrency: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--concurrency" || a === "-c") {
      const v = argv[++i];
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) {
        console.error(`✗ --concurrency requires a positive integer (got ${JSON.stringify(v)})`);
        process.exit(2);
      }
      out.concurrency = n;
    } else if (a === "--dir" || a === "-d") {
      const v = argv[++i];
      if (!v) {
        console.error(`✗ ${a} requires a value`);
        process.exit(2);
      }
      out.dir = v;
    } else if (a.startsWith("-")) {
      console.error(`✗ unknown flag: ${a}`);
      process.exit(2);
    } else {
      out.ids.push(a);
    }
  }
  return out;
}

const { ids, dir, concurrency, help } = parseArgs(process.argv.slice(2));
if (help) {
  console.log(
    "Usage: node scripts/audit/run-all-reconciliations.mjs [BOOKING_ID...] [--concurrency N] [--dir <path>]",
  );
  process.exit(0);
}

const expDir = resolve(dir || join(__dirname, "expectations"));
if (!existsSync(expDir) || !statSync(expDir).isDirectory()) {
  console.error(`✗ expectations directory not found: ${expDir}`);
  process.exit(2);
}

let bookings = ids;
if (bookings.length === 0) {
  bookings = readdirSync(expDir)
    .filter((f) => f.endsWith(".json") && !basename(f).startsWith("_"))
    .map((f) => basename(f, ".json"))
    .sort();
}
if (bookings.length === 0) {
  console.log("No pinned expectations found — nothing to audit.");
  process.exit(0);
}

const limit = Math.max(1, Math.min(concurrency ?? Math.max(2, cpus().length), bookings.length));
console.log(
  `▶ Running ${bookings.length} booking cross-check(s) with concurrency=${limit}:\n  ${bookings.join(", ")}\n`,
);

/**
 * Spawn one auditor child and buffer its stdout/stderr so logs from
 * concurrent runs don't interleave. Resolves with { id, code, output }.
 */
function runOne(id) {
  return new Promise((resolveRun) => {
    const start = Date.now();
    const child = spawn(process.execPath, [AUDITOR, id], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    const chunks = [];
    child.stdout.on("data", (b) => chunks.push(b));
    child.stderr.on("data", (b) => chunks.push(b));
    child.on("close", (code) => {
      resolveRun({
        id,
        code: code ?? 1,
        ms: Date.now() - start,
        output: Buffer.concat(chunks).toString("utf8"),
      });
    });
    child.on("error", (err) => {
      resolveRun({
        id,
        code: 1,
        ms: Date.now() - start,
        output: `failed to spawn auditor for ${id}: ${err.message}\n`,
      });
    });
  });
}

// Simple worker-pool: keep `limit` runs in flight, start the next as each finishes.
const queue = [...bookings];
const results = [];
async function worker() {
  while (queue.length) {
    const id = queue.shift();
    const r = await runOne(id);
    // Print the captured output as one contiguous block per booking so
    // parallel logs stay readable in the CI console.
    process.stdout.write(`\n──── ${id} (exit ${r.code}, ${r.ms} ms) ────\n${r.output}`);
    results.push(r);
  }
}
await Promise.all(Array.from({ length: limit }, worker));

const failed = results.filter((r) => r.code !== 0);
console.log(`\n${results.length - failed.length}/${results.length} booking cross-check(s) passed.`);
if (failed.length) {
  console.error(`\n✗ Failed bookings: ${failed.map((r) => `${r.id} (exit ${r.code})`).join(", ")}`);
  process.exit(1);
}
