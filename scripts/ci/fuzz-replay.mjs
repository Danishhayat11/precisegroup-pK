#!/usr/bin/env node
/**
 * Replay the exact failing property test from a fuzz failure artifact.
 *
 * The fuzz reporter (src/lib/__tests__/support/fuzzReporter.ts) writes a
 * JSON envelope per failure under `test-results/fuzz-failures/` (override
 * with FUZZ_FAILURE_DIR). Each envelope contains everything needed for
 * deterministic replay: `seed`, `counterexamplePath`, `testFile`, and
 * `property` (the -t name filter).
 *
 * Usage:
 *   node scripts/ci/fuzz-replay.mjs                # pick newest *.json in default dir
 *   node scripts/ci/fuzz-replay.mjs <path.json>    # explicit artifact
 *   node scripts/ci/fuzz-replay.mjs --dir <dir>    # newest *.json in <dir>
 *   node scripts/ci/fuzz-replay.mjs --seed 123 --path 0:3:1 --file <spec> --name <prop>
 *
 * Extra args after `--` are forwarded to vitest, e.g.
 *   node scripts/ci/fuzz-replay.mjs -- --reporter=verbose
 *
 * Exits with the vitest child process exit code.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const DEFAULT_DIR = process.env.FUZZ_FAILURE_DIR ?? "test-results/fuzz-failures";

function parseArgs(argv) {
  const out = { positional: [], forward: [] };
  let i = 0;
  let sawDD = false;
  while (i < argv.length) {
    const a = argv[i];
    if (sawDD) {
      out.forward.push(a);
      i++;
      continue;
    }
    if (a === "--") {
      sawDD = true;
      i++;
      continue;
    }
    if (a === "--dir") {
      out.dir = argv[++i];
      i++;
      continue;
    }
    if (a === "--seed") {
      out.seed = argv[++i];
      i++;
      continue;
    }
    if (a === "--path") {
      out.path = argv[++i];
      i++;
      continue;
    }
    if (a === "--file") {
      out.file = argv[++i];
      i++;
      continue;
    }
    if (a === "--name") {
      out.name = argv[++i];
      i++;
      continue;
    }
    if (a === "-h" || a === "--help") {
      out.help = true;
      i++;
      continue;
    }
    out.positional.push(a);
    i++;
  }
  return out;
}

function newestJsonIn(dir) {
  if (!existsSync(dir)) return null;
  const entries = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const p = join(dir, f);
      return { p, mtime: statSync(p).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return entries[0]?.p ?? null;
}

function loadArtifact(p) {
  const abs = resolve(p);
  if (!existsSync(abs)) {
    console.error(`[fuzz-replay] artifact not found: ${abs}`);
    process.exit(2);
  }
  try {
    return JSON.parse(readFileSync(abs, "utf8"));
  } catch (err) {
    console.error(`[fuzz-replay] failed to parse ${abs}: ${err.message}`);
    process.exit(2);
  }
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(
    readFileSync(new URL(import.meta.url), "utf8")
      .split("\n")
      .slice(1, 25)
      .join("\n"),
  );
  process.exit(0);
}

let seed, replayPath, testFile, propertyName;

if (args.seed && args.file && args.name) {
  // Fully manual override — no artifact required.
  seed = String(args.seed);
  replayPath = args.path ?? "";
  testFile = args.file;
  propertyName = args.name;
} else {
  const artifactPath = args.positional[0] ?? newestJsonIn(args.dir ?? DEFAULT_DIR);
  if (!artifactPath) {
    console.error(
      `[fuzz-replay] no artifact given and no *.json found in ${args.dir ?? DEFAULT_DIR}\n` +
        `  pass an explicit path, --dir, or --seed/--path/--file/--name.`,
    );
    process.exit(2);
  }
  const artifact = loadArtifact(artifactPath);
  seed = args.seed ?? (artifact.seed != null ? String(artifact.seed) : null);
  replayPath = args.path ?? artifact.counterexamplePath ?? "";
  testFile = args.file ?? artifact.testFile;
  propertyName = args.name ?? artifact.property;
  console.log(`[fuzz-replay] using artifact: ${artifactPath}`);
  if (!seed || !testFile || !propertyName) {
    console.error(
      `[fuzz-replay] artifact is missing required fields (seed/testFile/property).\n` +
        `  seed=${seed} testFile=${testFile} property=${propertyName}\n` +
        `  supply the missing pieces via --seed/--file/--name.`,
    );
    process.exit(2);
  }
}

const env = {
  ...process.env,
  FC_REPLAY_SEED: seed,
  FC_REPLAY_PATH: replayPath ?? "",
};

const cmd = "pnpm";
const cmdArgs = ["exec", "vitest", "run", testFile, "-t", propertyName, ...args.forward];

console.log(
  `[fuzz-replay] FC_REPLAY_SEED=${seed} FC_REPLAY_PATH=${JSON.stringify(replayPath ?? "")}\n` +
    `  ${cmd} ${cmdArgs.map((a) => (/^[A-Za-z0-9_.\/=:\-]+$/.test(a) ? a : JSON.stringify(a))).join(" ")}`,
);

const res = spawnSync(cmd, cmdArgs, { stdio: "inherit", env });
if (res.error) {
  console.error(`[fuzz-replay] failed to spawn pnpm: ${res.error.message}`);
  process.exit(1);
}
process.exit(res.status ?? 1);
