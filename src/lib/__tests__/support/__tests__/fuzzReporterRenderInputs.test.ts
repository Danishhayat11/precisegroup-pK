/**
 * Verifies `assertProperty`'s `renderInputs` hook persists the shrunk
 * counterexample's CSV/JSON inputs to disk as sibling artifacts of the
 * failure banner. CI uploads the `test-results/fuzz-failures/` dir, so
 * a reviewer opening a failed run can `cat` the exact CSV or JSON the
 * property was exercising without re-running fast-check.
 *
 * Contract asserted:
 *   1. Every string entry returned by `renderInputs` is written to its
 *      own file under the failure directory, with the same `<base>`
 *      prefix as the `.txt` banner and `.json` metadata.
 *   2. The `.json` metadata lists the written filenames under
 *      `renderedInputFiles` and includes a truncated inline preview
 *      under `renderedInputsPreview`.
 *   3. A throwing renderer never masks the real assertion failure —
 *      the property's error is still thrown, and the failure is still
 *      persisted with an `__renderer_error__` marker.
 *   4. The rendered inputs reflect the SHRUNK counterexample, not an
 *      arbitrary intermediate sample.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { assertProperty } from "../fuzzReporter";
import { clearSeed } from "../fuzzSeedStore";

const NAME_BASE = "renderInputsPersistence";

let tmpDir: string;
let prevFuzzDir: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fuzz-render-"));
  prevFuzzDir = process.env.FUZZ_FAILURE_DIR;
  process.env.FUZZ_FAILURE_DIR = tmpDir;
});

afterEach(() => {
  if (prevFuzzDir === undefined) delete process.env.FUZZ_FAILURE_DIR;
  else process.env.FUZZ_FAILURE_DIR = prevFuzzDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** List every artifact file for a given property name, sorted. */
function artifacts(propertyName: string): string[] {
  const prefix = propertyName.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return fs
    .readdirSync(tmpDir)
    .filter((f) => f.startsWith(prefix))
    .sort();
}

describe("fuzzReporter — renderInputs persists rendered CSV/JSON on failure", () => {
  it("writes each renderInputs entry as a sibling file and lists them in the JSON payload", () => {
    const NAME = `${NAME_BASE}/writes-sibling-files`;
    clearSeed(NAME);
    // A property that always fails, so we deterministically hit the
    // persistence path.
    const alwaysFails = fc.property(fc.integer({ min: 0, max: 10 }), (n) => {
      expect(n).toBeGreaterThan(1_000_000); // always false in the range
    });
    expect(() =>
      assertProperty(NAME, alwaysFails, {
        numRuns: 3,
        renderInputs: (cx) => {
          const [n] = cx as [number];
          return {
            "input.csv": `# Precise Realtors — Test\n\ncol\n${n}\n`,
            "input.json": JSON.stringify({ _meta: { source: "Test" }, rows: [{ n }] }),
          };
        },
      }),
    ).toThrow();

    const files = artifacts(NAME);
    // Banner (.txt), payload (metadata .json), plus the two rendered inputs.
    expect(files.filter((f) => f.endsWith(".txt"))).toHaveLength(1);
    // Exactly ONE metadata `.json` — the payload — plus one `input.json`
    // rendered artifact. Match on the full suffix to disambiguate.
    const metaJsonCandidates = files.filter(
      (f) => f.endsWith(".json") && !f.endsWith(".input.json"),
    );
    expect(metaJsonCandidates).toHaveLength(1);
    const csvFile = files.find((f) => f.endsWith(".input.csv"));
    const jsonFile = files.find((f) => f.endsWith(".input.json"));
    expect(csvFile).toBeDefined();
    expect(jsonFile).toBeDefined();

    // Rendered inputs contain the SHRUNK counterexample (fast-check
    // shrinks integer ranges toward 0 — the minimum satisfying the
    // arb bounds).
    const csvBody = fs.readFileSync(path.join(tmpDir, csvFile!), "utf8");
    expect(csvBody).toMatch(/# Precise Realtors — Test\n\ncol\n\d+\n/);
    const jsonBody = fs.readFileSync(path.join(tmpDir, jsonFile!), "utf8");
    const parsed = JSON.parse(jsonBody) as { rows: Array<{ n: number }> };
    expect(typeof parsed.rows[0].n).toBe("number");

    // .json metadata lists the rendered files and inline preview.
    const meta = JSON.parse(fs.readFileSync(path.join(tmpDir, metaJsonCandidates[0]), "utf8")) as {
      renderedInputFiles: string[];
      renderedInputsPreview: Record<string, string>;
    };
    expect(meta.renderedInputFiles.sort()).toEqual([csvFile, jsonFile].sort());
    expect(meta.renderedInputsPreview["input.csv"]).toContain("Precise Realtors");
    expect(meta.renderedInputsPreview["input.json"]).toContain('"_meta"');

    // Clean up the seed store so this failing test doesn't cause an
    // auto-replay noise on the next run.
    clearSeed(NAME);
  });

  it("a throwing renderer does not mask the real assertion failure", () => {
    const NAME = `${NAME_BASE}/renderer-throws`;
    clearSeed(NAME);
    const alwaysFails = fc.property(fc.integer({ min: 0, max: 5 }), (n) => {
      expect(n).toBe(-1); // impossible in the range
    });
    let thrown: unknown = null;
    try {
      assertProperty(NAME, alwaysFails, {
        numRuns: 3,
        renderInputs: () => {
          throw new Error("boom in renderer");
        },
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    // The thrown error is the ASSERTION failure, not the renderer error.
    expect(String((thrown as Error).message)).toMatch(/PROPERTY TEST FAILED|expected/);

    const files = artifacts(NAME);
    const jsonFile = files.find((f) => f.endsWith(".json"));
    expect(jsonFile).toBeDefined();
    const meta = JSON.parse(fs.readFileSync(path.join(tmpDir, jsonFile!), "utf8")) as {
      renderedInputFiles: string[];
      renderedInputsPreview: Record<string, string>;
    };
    // No rendered input files were written, but the renderer error is
    // captured in the preview so triage can see WHY.
    expect(meta.renderedInputFiles).toEqual([]);
    expect(meta.renderedInputsPreview["__renderer_error__"]).toMatch(/boom in renderer/);
    clearSeed(NAME);
  });

  it("passing property writes nothing (no failure → no artifact)", () => {
    const NAME = `${NAME_BASE}/passing`;
    clearSeed(NAME);
    const passes = fc.property(fc.integer({ min: 0, max: 10 }), (n) => {
      expect(n).toBeGreaterThanOrEqual(0);
    });
    assertProperty(NAME, passes, {
      numRuns: 5,
      renderInputs: () => ({ "should.not.exist": "irrelevant" }),
    });
    expect(artifacts(NAME)).toEqual([]);
  });
});
