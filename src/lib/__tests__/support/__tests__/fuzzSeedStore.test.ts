/**
 * Unit tests for the fuzz seed store + auto-replay wiring.
 *
 * The high-value guarantee is BEHAVIOURAL: given a stored failing seed
 * for property P, the NEXT invocation of `assertProperty(P, …)` must
 * reproduce that failure deterministically before any random
 * exploration — otherwise the whole point of the store (turn a flaky
 * CI failure into a one-command local repro) is defeated.
 *
 * We split the coverage into three layers:
 *
 *   1. Pure store primitives — read/write/clear round-trip, atomicity,
 *      env-override precedence, corrupted-file resilience. No fast-check
 *      involvement, so a bug in the store surfaces with a legible
 *      assertion instead of a mysterious "why did the property replay
 *      the wrong seed" failure.
 *
 *   2. Auto-replay integration with `assertProperty` — a synthetic
 *      "always-fail-on-input-42" property captures a seed on first
 *      failure, and a subsequent call with a "green now" version of
 *      the property runs the stored seed first, discovers it passes,
 *      and clears the entry. This is the "regression fixed, stop
 *      forcing replay" path.
 *
 *   3. Env-override precedence — `FC_REPLAY_SEED` must beat the
 *      stored entry so a human bisecting from a failure banner can
 *      pin a specific seed without touching files on disk.
 *
 * The tests use an ISOLATED store directory (`FUZZ_SEED_STORE_DIR`
 * pointed at a per-test tmpdir) so they don't leak into the repo's
 * real `.fuzz-seed-store/` or race with other test files.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { clearSeed, fileNameFor, readEnvOverride, readSeed, writeSeed } from "../fuzzSeedStore";
import { assertProperty } from "../fuzzReporter";

let TMP_DIR: string;
let PRIOR_DIR: string | undefined;
let PRIOR_ENV_SEED: string | undefined;
let PRIOR_ENV_PATH: string | undefined;
let PRIOR_DISABLED: string | undefined;
let PRIOR_FAILURE_DIR: string | undefined;

beforeEach(() => {
  TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fuzz-seed-store-"));
  PRIOR_DIR = process.env.FUZZ_SEED_STORE_DIR;
  PRIOR_ENV_SEED = process.env.FC_REPLAY_SEED;
  PRIOR_ENV_PATH = process.env.FC_REPLAY_PATH;
  PRIOR_DISABLED = process.env.FUZZ_SEED_STORE_DISABLED;
  PRIOR_FAILURE_DIR = process.env.FUZZ_FAILURE_DIR;
  process.env.FUZZ_SEED_STORE_DIR = TMP_DIR;
  delete process.env.FC_REPLAY_SEED;
  delete process.env.FC_REPLAY_PATH;
  delete process.env.FUZZ_SEED_STORE_DISABLED;
  // Silence the artifact-persistence branch — its output is unrelated
  // and would pollute /tmp on every run of this suite.
  process.env.FUZZ_FAILURE_DIR = "";
});

afterEach(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  const restore = (name: string, prior: string | undefined) => {
    if (prior === undefined) delete process.env[name];
    else process.env[name] = prior;
  };
  restore("FUZZ_SEED_STORE_DIR", PRIOR_DIR);
  restore("FC_REPLAY_SEED", PRIOR_ENV_SEED);
  restore("FC_REPLAY_PATH", PRIOR_ENV_PATH);
  restore("FUZZ_SEED_STORE_DISABLED", PRIOR_DISABLED);
  restore("FUZZ_FAILURE_DIR", PRIOR_FAILURE_DIR);
});

describe("fuzzSeedStore — primitives", () => {
  it("round-trips a seed entry through write → read", () => {
    const entry = {
      property: "example prop",
      seed: 1234,
      path: "0:1:2",
      capturedAt: "2026-01-01T00:00:00Z",
      invariant: "example invariant",
    };
    writeSeed(entry);
    expect(readSeed("example prop")).toEqual(entry);
  });

  it("returns null when no entry exists for the property", () => {
    expect(readSeed("never-written")).toBeNull();
  });

  it("clearSeed removes the on-disk entry", () => {
    writeSeed({
      property: "p",
      seed: 1,
      path: "",
      capturedAt: "2026-01-01T00:00:00Z",
    });
    expect(readSeed("p")).not.toBeNull();
    clearSeed("p");
    expect(readSeed("p")).toBeNull();
  });

  it("ignores corrupted store files instead of crashing", () => {
    const file = path.join(TMP_DIR, fileNameFor("garbled"));
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.writeFileSync(file, "{not valid json", "utf8");
    expect(readSeed("garbled")).toBeNull();
  });

  it("ignores entries with the wrong shape", () => {
    const file = path.join(TMP_DIR, fileNameFor("badshape"));
    fs.writeFileSync(file, JSON.stringify({ seed: "not a number", path: "" }), "utf8");
    expect(readSeed("badshape")).toBeNull();
  });

  it("distinguishes two property names whose sanitised prefix collides", () => {
    // Both sanitise to `weird_name` after stripping non-word chars, so
    // the SHA suffix in `fileNameFor` is the only thing keeping them
    // apart. Losing the suffix would cause one to silently overwrite
    // the other.
    const a = "weird name!!!";
    const b = "weird*name???";
    writeSeed({ property: a, seed: 1, path: "", capturedAt: "t" });
    writeSeed({ property: b, seed: 2, path: "", capturedAt: "t" });
    expect(readSeed(a)?.seed).toBe(1);
    expect(readSeed(b)?.seed).toBe(2);
    expect(fileNameFor(a)).not.toBe(fileNameFor(b));
  });

  it("is disabled entirely when FUZZ_SEED_STORE_DISABLED=1", () => {
    process.env.FUZZ_SEED_STORE_DISABLED = "1";
    writeSeed({ property: "p", seed: 99, path: "", capturedAt: "t" });
    expect(readSeed("p")).toBeNull();
    // And no file was actually written.
    expect(fs.readdirSync(TMP_DIR).length).toBe(0);
  });
});

describe("fuzzSeedStore — env override", () => {
  it("returns null when FC_REPLAY_SEED is unset", () => {
    expect(readEnvOverride()).toBeNull();
  });

  it("parses FC_REPLAY_SEED + optional FC_REPLAY_PATH", () => {
    process.env.FC_REPLAY_SEED = "42";
    process.env.FC_REPLAY_PATH = "0:3:1";
    expect(readEnvOverride()).toEqual({ seed: 42, path: "0:3:1" });
  });

  it("defaults path to empty string when only seed is set", () => {
    process.env.FC_REPLAY_SEED = "7";
    expect(readEnvOverride()).toEqual({ seed: 7, path: "" });
  });

  it("rejects a non-numeric seed", () => {
    process.env.FC_REPLAY_SEED = "not-a-number";
    expect(readEnvOverride()).toBeNull();
  });
});

describe("assertProperty — auto-replay integration", () => {
  it("captures a seed on failure and replays it deterministically on the next call", () => {
    const NAME = "captures-and-replays";
    // First run: a property that always fails. `assertProperty` must
    // throw AND leave a seed in the store.
    const failing = fc.property(fc.integer({ min: 0, max: 100 }), (_n) => {
      throw new Error("always fails");
    });
    expect(() => assertProperty(NAME, failing, { numRuns: 3 })).toThrow(/always fails/);
    const captured = readSeed(NAME);
    expect(captured, "seed store must contain an entry after a failure").not.toBeNull();
    expect(typeof captured!.seed).toBe("number");
    expect(captured!.property).toBe(NAME);

    // Second run: same failing property. It must still fail, and the
    // banner MUST say "auto-replay of stored seed" — proving the
    // stored seed drove the reproduction rather than a fresh random
    // exploration finding a new failure by luck.
    let thrown: Error | null = null;
    try {
      assertProperty(NAME, failing, { numRuns: 3 });
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown, "second run must fail").not.toBeNull();
    expect(thrown!.message).toContain("[auto-replay of stored seed]");
    expect(thrown!.message).toContain(`seed=${captured!.seed}`);
  });

  it("clears the stored seed when the replay passes on a fixed property", () => {
    const NAME = "regression-fixed";
    // Seed the store with an entry that we KNOW will not reproduce a
    // failure for the "always green" property below. This models the
    // "yesterday's failure was fixed today" flow.
    writeSeed({
      property: NAME,
      seed: 987654321,
      path: "",
      capturedAt: "2026-01-01T00:00:00Z",
    });
    const green = fc.property(fc.integer(), () => true);
    // Should not throw — replay passes, fresh run passes.
    assertProperty(NAME, green, { numRuns: 5 });
    expect(readSeed(NAME), "entry should be cleared after successful run").toBeNull();
  });

  it("FC_REPLAY_SEED overrides the stored entry", () => {
    const NAME = "env-override-beats-store";
    // Store one seed; env supplies a different one. The banner must
    // reflect the ENV seed, proving env precedence.
    writeSeed({ property: NAME, seed: 111, path: "", capturedAt: "t" });
    process.env.FC_REPLAY_SEED = "222";
    const failing = fc.property(fc.integer(), () => {
      throw new Error("boom");
    });
    let thrown: Error | null = null;
    try {
      assertProperty(NAME, failing, { numRuns: 5 });
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain("[auto-replay of stored seed]");
    expect(thrown!.message).toContain("seed=222");
  });
});
