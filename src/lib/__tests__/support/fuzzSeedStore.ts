/**
 * Persistent fuzz-seed store — one JSON file per property under
 * `.fuzz-seed-store/`. Keeps the "last known failing seed" for every
 * fast-check property in the repo so a future CI failure can be
 * reproduced deterministically without any human copy-paste.
 *
 * Design decisions:
 *
 *   • ONE FILE PER PROPERTY, keyed by a filesystem-safe hash of the
 *     property display name. Vitest runs test files in parallel
 *     workers; a single monolithic JSON blob would race on
 *     read-modify-write. Per-property files sidestep the race entirely
 *     because two workers can only collide on the same property name,
 *     which (by construction) they're not both running.
 *
 *   • ATOMIC WRITES via `fs.writeFileSync(tmp)` + `fs.renameSync`.
 *     Rename is atomic on POSIX and on modern Windows for same-volume
 *     replacements. A crash mid-write can't leave a half-written
 *     JSON file that breaks the next run.
 *
 *   • COMMITTED TO VCS. The whole point is that a CI failure on
 *     branch X reproduces locally on branch Y at the same commit;
 *     the store MUST travel with the code. Files are tiny (<200
 *     bytes each) and updated only on failure, so churn is
 *     negligible in normal operation.
 *
 *   • CLEARED ON SUCCESS. When the auto-replay layer runs a stored
 *     counterexample and it passes, the entry is removed the same
 *     tick — the regression is fixed and stale seeds would just
 *     waste one run per CI invocation forever.
 *
 * Env overrides:
 *   • `FUZZ_SEED_STORE_DIR` — relocate the store (e.g. to a mount that
 *     survives sandbox recycles). Empty string disables the store
 *     entirely, useful for one-off local runs where the writes would
 *     be noise.
 *   • `FUZZ_SEED_STORE_DISABLED=1` — hard-disable read + write without
 *     changing paths, so a caller can bisect "is the auto-replay
 *     itself the problem?" in one env-flip.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export interface FuzzSeedEntry {
  /** Full property display name — human-readable, matches banner. */
  property: string;
  /** fast-check seed that reproduces the failure. */
  seed: number;
  /** fast-check `counterexamplePath` string. Empty string == root. */
  path: string;
  /** ISO timestamp of when the failure was captured. */
  capturedAt: string;
  /** Git commit + branch when known, for retro-triage. */
  commit?: string;
  /** Free-form label from the caller, e.g. the `invariant` string. */
  invariant?: string;
}

const DEFAULT_DIR = ".fuzz-seed-store";

function isDisabled(): boolean {
  if (process.env.FUZZ_SEED_STORE_DISABLED === "1") return true;
  if (process.env.FUZZ_SEED_STORE_DIR === "") return true;
  if (typeof process === "undefined" || !process.versions?.node) return true;
  return false;
}

function storeDir(): string {
  const override = process.env.FUZZ_SEED_STORE_DIR;
  if (override && override.length > 0) return path.resolve(override);
  return path.resolve(process.cwd(), DEFAULT_DIR);
}

/**
 * Filesystem-safe filename for a property. Strips non-word chars, then
 * appends the first 10 chars of a SHA-256 over the ORIGINAL name so
 * two properties whose sanitised prefix collides still map to distinct
 * files. Full names > 80 chars are truncated in the human-readable
 * prefix but the hash disambiguates.
 */
export function fileNameFor(property: string): string {
  const safe =
    property
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "property";
  const digest = createHash("sha256").update(property).digest("hex").slice(0, 10);
  return `${safe}.${digest}.json`;
}

function pathFor(property: string): string {
  return path.join(storeDir(), fileNameFor(property));
}

/** Read the stored seed for a property, or `null` if none / disabled. */
export function readSeed(property: string): FuzzSeedEntry | null {
  if (isDisabled()) return null;
  const file = pathFor(property);
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as FuzzSeedEntry;
    // Minimum shape: numeric seed + string path. Anything else is a
    // corrupted / hand-edited file — ignore it rather than crash the
    // test run.
    if (typeof parsed.seed !== "number" || typeof parsed.path !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist a seed for a property (atomic write). No-op when disabled. */
export function writeSeed(entry: FuzzSeedEntry): void {
  if (isDisabled()) return;
  const dir = storeDir();
  const file = pathFor(entry.property);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entry, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, file);
  } catch (err) {
    // Never let store persistence mask a real test failure.

    console.error(`[fuzzSeedStore] failed to persist seed for "${entry.property}":`, err);
  }
}

/** Remove any stored seed for a property (called when replay passes). */
export function clearSeed(property: string): void {
  if (isDisabled()) return;
  const file = pathFor(property);
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* best-effort */
  }
}

/**
 * Env-override for one-off manual replay. `FC_REPLAY_SEED` + optional
 * `FC_REPLAY_PATH` bypass the store entirely — mirrors the shell hint
 * printed by the failure banner so a user can paste-and-run without
 * touching any files. Returns `null` when no env override is set.
 */
export function readEnvOverride(): Pick<FuzzSeedEntry, "seed" | "path"> | null {
  const rawSeed = process.env.FC_REPLAY_SEED;
  if (!rawSeed) return null;
  const seed = Number(rawSeed);
  if (!Number.isFinite(seed)) return null;
  return { seed: Math.trunc(seed), path: process.env.FC_REPLAY_PATH ?? "" };
}
