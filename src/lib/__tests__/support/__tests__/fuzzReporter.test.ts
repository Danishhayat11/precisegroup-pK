/**
 * Unit tests for the shared fast-check failure reporter.
 *
 * These pin the *shape* of the failure message so downstream fuzz suites
 * can rely on it — property name, escaped counterexample, seed, path,
 * and a copy-pasteable reproduction line all appear.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import {
  assertProperty,
  classifyFailure,
  escapeControlChars,
  extractCallerTestFile,
  formatFailure,
  renderValue,
  shellQuote,
} from "../fuzzReporter";

// Isolate the persistent seed store for every test in this file. Without
// this, the reporter's `writeSeed` side-effect leaks seeds into the shared
// `.fuzz-seed-store/` directory: on the next run, properties known to fail
// (e.g. `always-false`) get auto-replayed and the banner gains the
// `[auto-replay of stored seed]` suffix, breaking the exact-string
// assertions below. Disabling the store keeps each run "fresh".
const PREV_STORE_STATE: { disabled?: string } = {};
beforeEach(() => {
  PREV_STORE_STATE.disabled = process.env.FUZZ_SEED_STORE_DISABLED;
  process.env.FUZZ_SEED_STORE_DISABLED = "1";
});
afterEach(() => {
  if (PREV_STORE_STATE.disabled === undefined) {
    delete process.env.FUZZ_SEED_STORE_DISABLED;
  } else {
    process.env.FUZZ_SEED_STORE_DISABLED = PREV_STORE_STATE.disabled;
  }
});

describe("escapeControlChars", () => {
  it("renders common control chars with readable escapes", () => {
    expect(escapeControlChars("a\nb\rc\td\0e\x7f")).toBe("a\\nb\\rc\\td\\0e\\x7f");
  });

  it("leaves normal printable characters untouched", () => {
    const s = 'hello, "world" | 42';
    expect(escapeControlChars(s)).toBe(s);
  });

  it("hex-escapes uncommon control chars", () => {
    expect(escapeControlChars("\x01\x1f")).toBe("\\x01\\x1f");
  });

  it("renders invisible unicode (NBSP, ZWSP, LS/PS, BOM) as \\uXXXX", () => {
    // These characters otherwise vanish in a terminal / CI log and are
    // the #1 cause of "why does the CSV parser disagree with my eyes"
    // fuzz reports. Both encoders must render them identically.
    expect(escapeControlChars("\u00a0")).toBe("\\u00a0"); // NBSP
    expect(escapeControlChars("\u200b")).toBe("\\u200b"); // ZWSP
    expect(escapeControlChars("\u200c")).toBe("\\u200c"); // ZWNJ
    expect(escapeControlChars("\u200d")).toBe("\\u200d"); // ZWJ
    expect(escapeControlChars("\u200e")).toBe("\\u200e"); // LRM
    expect(escapeControlChars("\u200f")).toBe("\\u200f"); // RLM
    expect(escapeControlChars("\u2028")).toBe("\\u2028"); // LINE SEP
    expect(escapeControlChars("\u2029")).toBe("\\u2029"); // PARA SEP
    expect(escapeControlChars("\u2060")).toBe("\\u2060"); // WORD JOINER
    expect(escapeControlChars("\ufeff")).toBe("\\ufeff"); // BOM
  });

  it("preserves well-formed surrogate pairs (emoji) verbatim", () => {
    // 🎉 = U+1F389, encoded as surrogate pair D83C DF89.
    expect(escapeControlChars("hi 🎉")).toBe("hi 🎉");
  });

  it("escapes lone surrogates as \\uXXXX so invalid UTF-16 stays debuggable", () => {
    // Lone high surrogate.
    expect(escapeControlChars("x\ud83cy")).toBe("x\\ud83cy");
    // Lone low surrogate.
    expect(escapeControlChars("x\udf89y")).toBe("x\\udf89y");
  });
});

describe("renderValue", () => {
  it("visibly escapes control chars inside strings", () => {
    expect(renderValue('a\nb"c')).toBe('"a\\nb\\"c"');
  });

  it("renders arrays and objects recursively with quoted keys", () => {
    expect(renderValue({ x: [1, "y\t"], z: null })).toBe('{ "x": [1, "y\\t"], "z": null }');
  });

  it("guards against circular references", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(renderValue(a)).toContain("[Circular]");
  });

  it("prints undefined, bigint, and non-finite numbers explicitly", () => {
    expect(renderValue(undefined)).toBe("undefined");
    expect(renderValue(10n)).toBe("10");
    expect(renderValue(NaN)).toBe("Number(NaN)");
    expect(renderValue(Infinity)).toBe("Number(Infinity)");
  });
});

describe("formatFailure", () => {
  it("returns empty string when the run did not fail", () => {
    const details = fc.check(fc.property(fc.integer(), () => true));
    expect(formatFailure("noop", details as fc.RunDetails<unknown>)).toBe("");
  });

  it("includes name, seed, path, counters, and reproduction line on failure", () => {
    // Force a deterministic failure so we can pin the shape.
    const details = fc.check(
      fc.property(fc.constant("boom\n" as string), (s) => {
        throw new Error(`nope: ${s}`);
      }),
      { seed: 42, numRuns: 5 },
    ) as fc.RunDetails<[string]>;

    expect(details.failed).toBe(true);
    const msg = formatFailure("demo property", details);

    expect(msg).toContain('Property "demo property" failed (mode: property).');
    expect(msg).toContain("seed=42");
    expect(msg).toContain('path="');
    expect(msg).toMatch(/runs=\d+\s+shrinks=\d+/);
    // Counterexample is rendered with escaped control chars.
    expect(msg).toContain('[0] "boom\\n"');
    expect(msg).toContain("Reproduce locally:");
    expect(msg).toContain("endOnFailure: true");
    expect(msg).toContain("Original error:");
  });
});

describe("assertProperty", () => {
  it("returns silently when the property holds", () => {
    expect(() =>
      assertProperty(
        "identity holds",
        fc.property(fc.integer(), (n) => n === n),
        { numRuns: 20 },
      ),
    ).not.toThrow();
  });

  it("throws an Error with the formatted counterexample when it fails", () => {
    let caught: unknown;
    try {
      assertProperty(
        "always-false",
        fc.property(fc.constantFrom("x\ty", "z"), () => false),
        { seed: 7, numRuns: 3 },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const err = caught as Error & { fastCheckDetails?: fc.RunDetails<unknown> };
    expect(err.message).toContain('Property "always-false" failed (mode: property).');
    expect(err.message).toContain("seed=7");
    // Escaped tab survives in the rendered counterexample.
    expect(err.message).toMatch(/\[0\] "(?:x\\ty|z)"/);
    // Details object is attached for programmatic inspection.
    expect(err.fastCheckDetails?.failed).toBe(true);
  });

  it("honours displayName override", () => {
    let msg = "";
    try {
      assertProperty(
        "internal-name",
        fc.property(fc.constant(1), () => false),
        { seed: 1, numRuns: 1, displayName: "user-facing name" },
      );
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('Property "user-facing name" failed (mode: property).');
    expect(msg).not.toContain("internal-name");
  });

  it("labels each arg by name, prints the invariant, and picks an offending field", () => {
    let msg = "";
    let details: fc.RunDetails<unknown> | undefined;
    try {
      assertProperty(
        "csv round-trip",
        fc.property(
          // headerColumns: empty string, rows: non-empty array, explicitKeys: empty string
          // → the offending-field heuristic must prefer the array (`rows`).
          fc.constant(""),
          fc.constant([{ a: 1 }, { a: 2 }]),
          fc.constant(""),
          () => false,
        ),
        {
          seed: 42,
          numRuns: 1,
          argNames: ["headerColumns", "rows", "explicitKeys"],
          invariant: "row values survive CSV → JSON round-trip byte-for-byte",
        },
      );
    } catch (e) {
      const err = e as Error & { fastCheckDetails?: fc.RunDetails<unknown> };
      msg = err.message;
      details = err.fastCheckDetails;
    }
    expect(msg).toContain("invariant: row values survive CSV → JSON round-trip byte-for-byte");
    expect(msg).toContain("headerColumns (arg 0):");
    expect(msg).toContain("rows (arg 1):");
    expect(msg).toContain("explicitKeys (arg 2):");
    // Positional `[0]` format must NOT leak when labels are supplied.
    expect(msg).not.toMatch(/\n\s*\[0\]\s/);
    // Array arg beats scalar args for the offending-field guess.
    expect(msg).toContain("likely offending field: rows");
    expect(details?.failed).toBe(true);
  });
});

describe("shellQuote", () => {
  it("wraps plain strings in single quotes", () => {
    expect(shellQuote("hello")).toBe("'hello'");
  });
  it("escapes embedded single quotes with the POSIX idiom", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe("extractCallerTestFile", () => {
  it("returns the first non-reporter test frame, repo-relative", () => {
    const stack = [
      "Error",
      "    at assertProperty (/repo/src/lib/__tests__/support/fuzzReporter.ts:340:20)",
      "    at Object.<anonymous> (/repo/src/lib/__tests__/csvExportEscapingFuzz.test.ts:42:5)",
      "    at run (/repo/node_modules/vitest/dist/index.js:99:9)",
    ].join("\n");
    // Mock cwd via a scope: extractCallerTestFile reads process.cwd().
    const orig = process.cwd;
    try {
      (process as unknown as { cwd: () => string }).cwd = () => "/repo";
      expect(extractCallerTestFile(stack)).toBe("src/lib/__tests__/csvExportEscapingFuzz.test.ts");
    } finally {
      (process as unknown as { cwd: () => string }).cwd = orig;
    }
  });

  it("skips fuzzReporter and node_modules frames", () => {
    const stack = [
      "    at foo (/repo/src/lib/__tests__/support/fuzzReporter.ts:1:1)",
      "    at bar (/repo/node_modules/pkg/x.js:1:1)",
    ].join("\n");
    expect(extractCallerTestFile(stack)).toBeNull();
  });

  it("returns null for missing/unparseable stacks", () => {
    expect(extractCallerTestFile(undefined)).toBeNull();
    expect(extractCallerTestFile("Error: no frames here")).toBeNull();
  });
});

describe("assertProperty rerun command", () => {
  it("emits a cross-platform fuzz-replay command with seed, path, file and -name filter", () => {
    let msg = "";
    try {
      assertProperty(
        "rerun demo property",
        fc.property(fc.constant("v"), () => false),
        { seed: 123, numRuns: 1 },
      );
    } catch (e) {
      msg = (e as Error).message;
    }
    // The banner must invoke the portable Node CLI (works on bash, zsh,
    // cmd.exe and PowerShell — no `VAR=val cmd` env-prefix syntax) with
    // the seed, the test title, and a repo-relative path to this file.
    expect(msg).toMatch(/node scripts\/ci\/fuzz-replay\.mjs --seed 123 /);
    // --file value may be printed unquoted when it contains only "safe"
    // token chars (letters, digits, `/._-:=`), or double-quoted otherwise;
    // --name always double-quoted because it contains spaces.
    expect(msg).toMatch(/--file "?[^ "]*fuzzReporter\.test\.ts"? --name "rerun demo property/);
    // The classic fc.assert reproduce line must still be present.
    expect(msg).toContain("fc.assert(<property>");
  });
});

describe("classifyFailure / tooManySkips / interrupted reporting", () => {
  it("classifies a normal counterexample as 'property'", () => {
    // Synthesise a minimal RunDetails-shaped object rather than actually
    // running fc; the classifier only reads a couple of fields.
    const d = {
      failed: true,
      interrupted: false,
      counterexample: ["x"],
      counterexamplePath: "0",
      numRuns: 5,
      numShrinks: 1,
      numSkips: 0,
      seed: 1,
    } as unknown as fc.RunDetails<unknown>;
    expect(classifyFailure(d)).toBe("property");
  });

  it("classifies null-counterexample failures as 'tooManySkips'", () => {
    const d = {
      failed: true,
      interrupted: false,
      counterexample: null,
      counterexamplePath: null,
      numRuns: 0,
      numShrinks: 0,
      numSkips: 10000,
      seed: 1,
    } as unknown as fc.RunDetails<unknown>;
    expect(classifyFailure(d)).toBe("tooManySkips");
  });

  it("classifies interrupted runs as 'interrupted' regardless of counterexample", () => {
    const d = {
      failed: true,
      interrupted: true,
      counterexample: ["partial"],
      counterexamplePath: "3",
      numRuns: 42,
      numShrinks: 0,
      numSkips: 0,
      seed: 9,
    } as unknown as fc.RunDetails<unknown>;
    expect(classifyFailure(d)).toBe("interrupted");
  });

  it("formats tooManySkips with a distinct banner and skip count, not 'null'", () => {
    const d = {
      failed: true,
      interrupted: false,
      counterexample: null,
      counterexamplePath: null,
      numRuns: 0,
      numShrinks: 0,
      numSkips: 10000,
      seed: 555,
      failures: [], // no verbose data
    } as unknown as fc.RunDetails<unknown>;
    const msg = formatFailure("skippy", d);
    expect(msg).toContain('Property "skippy" failed (mode: tooManySkips).');
    expect(msg).toContain("skips=10000");
    expect(msg).toContain("No counterexample: fast-check gave up after 10000 skipped samples");
    // Must NOT render the "Minimal counterexample" heading with `null` under it.
    expect(msg).not.toContain("Minimal counterexample");
    // Should hint at verbose mode when no per-sample data is available.
    expect(msg).toContain("verbose");
  });

  it("formats interrupted with the last verbose sample when available", () => {
    const d = {
      failed: true,
      interrupted: true,
      counterexample: null,
      counterexamplePath: null,
      numRuns: 7,
      numShrinks: 0,
      numSkips: 0,
      seed: 77,
      failures: [["last-header", ["r1", "r2"]]],
    } as unknown as fc.RunDetails<unknown>;
    const msg = formatFailure("longrun", d, {
      argNames: ["header", "rows"],
      invariant: "must terminate within timeout",
    });
    expect(msg).toContain('Property "longrun" failed (mode: interrupted).');
    expect(msg).toContain("Run interrupted after 7 sample(s)");
    expect(msg).toContain("invariant: must terminate within timeout");
    expect(msg).toContain("Last sampled inputs before interrupt");
    // Argument labels flow through to the verbose-sample renderer.
    expect(msg).toContain("header (arg 0):");
    expect(msg).toContain("rows (arg 1):");
  });

  it("assertProperty throws with the tooManySkips banner when fc.pre skips everything", () => {
    let msg = "";
    try {
      assertProperty(
        "always-skip",
        // Every generated integer is filtered out → 0 runs, N skips.
        fc.property(fc.integer(), (n) => {
          fc.pre(false);
          return n === n;
        }),
        { seed: 3, numRuns: 5 },
      );
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('Property "always-skip" failed (mode: tooManySkips).');
    expect(msg).toContain("No counterexample");
    // Still emits a reproduction line so the reader can rerun.
    expect(msg).toContain("fc.assert(<property>");
  });
});
