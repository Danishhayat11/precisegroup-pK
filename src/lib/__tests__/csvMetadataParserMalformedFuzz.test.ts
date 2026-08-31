/**
 * Property-based fuzz for `parseCsvMetadataHeader` on MALFORMED input.
 *
 * Contract (see csvMetadataParser.ts):
 *   • Only `CsvMetadataParseError` may be thrown, and only for the three
 *     column-block invariants — missing-column-keys, column-key-count-
 *     mismatch, empty-column-key. Every other malformed line (unclosed
 *     quote in a label, stray delimiter, garbage `# …` shape, wrong
 *     line terminator) is TOLERATED: the parser falls back to the
 *     `EXTRA_RE` catch-all or ignores the line, and returns a well-
 *     formed `ParsedCsvMetadata` with `bodyStartIndex` pointing at the
 *     first non-`#` line.
 *   • The result object is always fully populated (no `undefined`
 *     fields) and every invariant on the returned shape holds:
 *       - `rawLines` is a prefix of the input lines
 *       - every entry in `rawLines` starts with `#`
 *       - `bodyStartIndex` is in `[0, splitLines.length]`
 *       - `columns` is either `null` OR every entry has a non-empty
 *         `key` and a string `label`, with `labels.length === keys.length`
 *       - `extra`, `filters` are plain objects with string values
 *
 * This suite generates adversarial header blocks — unclosed quotes,
 * mismatched column/key counts, stray delimiters, empty keys, random
 * garbage `# …` lines, mixed line endings — and asserts the parser
 * either recovers into that safe shape OR throws the documented
 * `CsvMetadataParseError` with a known `code`. It NEVER throws a
 * generic `Error`, `TypeError`, or `SyntaxError`.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { propRuns } from "./_helpers/propRuns";
import { CsvMetadataParseError, parseCsvMetadataHeader } from "../csvMetadataParser";

// ---- Arbitraries ---------------------------------------------------------

/** Random single-line "junk" string, no newlines, plenty of hostile bytes. */
const junkLineArb = fc.string({
  unit: fc.constantFrom(
    " ",
    "a",
    "1",
    ",",
    ";",
    ":",
    "|",
    "=",
    "#",
    '"',
    "'",
    "\\",
    "/",
    "(",
    ")",
    "—",
    "…",
    "中",
    "🚀",
  ),
  minLength: 0,
  maxLength: 40,
});

/** A `# …` line — may look like a real metadata line, may be gibberish. */
const commentLineArb = junkLineArb.map((s) => `# ${s}`);

/**
 * Adversarial `# Columns` + `# Column keys` pair. Independently randomises
 * the label list, key list, and their COUNTS so most cases mismatch (the
 * whole point) — and occasionally injects unclosed quotes and stray `|`
 * / `,` delimiters into the label / key payloads.
 */
const columnsBlockArb = fc
  .record({
    labelCount: fc.integer({ min: 0, max: 6 }),
    keyCount: fc.integer({ min: 0, max: 6 }),
    // Random extra separators to break the split.
    extraLabelSep: fc.constantFrom("", "|", " | | ", "||"),
    extraKeySep: fc.constantFrom("", ",", ",,", ", ,"),
    // Random unclosed quote / stray delim injections into a label.
    hostileLabel: fc.constantFrom("", 'un"closed', "with|pipe", "with,comma"),
    // Deliberately empty key entries — should trigger empty-column-key.
    injectEmptyKey: fc.boolean(),
    // Sometimes omit the keys line entirely — should trigger missing-column-keys.
    omitKeys: fc.boolean(),
    // Declared count in `# Columns (N, in order):` — often wrong.
    declaredCount: fc.integer({ min: 0, max: 8 }),
  })
  .map((cfg) => {
    const labels = Array.from({ length: cfg.labelCount }, (_, i) => `L${i}`);
    if (labels.length > 0) labels[0] = cfg.hostileLabel || labels[0];
    const keys = Array.from({ length: cfg.keyCount }, (_, i) => `k${i}`);
    if (cfg.injectEmptyKey && keys.length > 0) keys[0] = "";
    const columnsLine = `# Columns (${cfg.declaredCount}, in order): ${labels.join(" | ")}${cfg.extraLabelSep}`;
    const keysLine = `# Column keys: ${keys.join(",")}${cfg.extraKeySep}`;
    return cfg.omitKeys ? [columnsLine] : [columnsLine, keysLine];
  });

/** A whole malformed header: a shuffled mix of junk `# …` lines, an
 *  adversarial columns block, a blank separator, and some body lines. */
const malformedCsvArb = fc
  .record({
    prelude: fc.array(commentLineArb, { minLength: 0, maxLength: 5 }),
    columnsBlock: columnsBlockArb,
    postlude: fc.array(commentLineArb, { minLength: 0, maxLength: 3 }),
    body: fc.array(junkLineArb, { minLength: 0, maxLength: 3 }),
    lineEnding: fc.constantFrom("\n", "\r\n", "\r"),
    // Sometimes include the blank separator, sometimes not.
    withBlank: fc.boolean(),
  })
  .map(({ prelude, columnsBlock, postlude, body, lineEnding, withBlank }) => {
    const parts = [...prelude, ...columnsBlock, ...postlude];
    if (withBlank) parts.push("");
    parts.push(...body);
    return parts.join(lineEnding);
  });

// ---- Invariants ----------------------------------------------------------

function assertSafeShape(csv: string): void {
  let parsed;
  try {
    parsed = parseCsvMetadataHeader(csv);
  } catch (e) {
    // Only the documented error may escape. Anything else is a bug.
    expect(e).toBeInstanceOf(CsvMetadataParseError);
    const err = e as CsvMetadataParseError;
    expect(["missing-column-keys", "empty-column-key", "column-key-count-mismatch"]).toContain(
      err.code,
    );
    return;
  }

  // Result is always a fully-populated object — no undefined fields.
  for (const field of [
    "source",
    "schema",
    "version",
    "generatedAt",
    "extra",
    "filters",
    "sort",
    "page",
    "counts",
    "columns",
    "rawLines",
    "bodyStartIndex",
  ] as const) {
    expect(parsed).toHaveProperty(field);
  }

  const splitLines = csv.split(/\r\n|\n|\r/);
  // rawLines is a prefix of the file, and every captured line is a `#` line.
  expect(parsed.rawLines.length).toBeLessThanOrEqual(splitLines.length);
  for (let i = 0; i < parsed.rawLines.length; i++) {
    expect(parsed.rawLines[i]).toBe(splitLines[i]);
    expect(parsed.rawLines[i].startsWith("#")).toBe(true);
  }
  // bodyStartIndex is in range.
  expect(parsed.bodyStartIndex).toBeGreaterThanOrEqual(0);
  expect(parsed.bodyStartIndex).toBeLessThanOrEqual(splitLines.length);

  // If columns survived, labels ↔ keys are aligned and no key is blank.
  if (parsed.columns !== null) {
    for (const c of parsed.columns) {
      expect(typeof c.key).toBe("string");
      expect(c.key.length).toBeGreaterThan(0);
      expect(typeof c.label).toBe("string");
    }
  }

  // extra / filters are plain string→string maps.
  for (const v of Object.values(parsed.extra)) expect(typeof v).toBe("string");
  for (const v of Object.values(parsed.filters)) expect(typeof v).toBe("string");
}

// ---- Properties ----------------------------------------------------------

describe("parseCsvMetadataHeader — malformed header fuzz", () => {
  it("either throws CsvMetadataParseError with a documented code, or returns a safe shape", () => {
    fc.assert(
      fc.property(malformedCsvArb, (csv) => {
        assertSafeShape(csv);
      }),
      { numRuns: propRuns(500) },
    );
  });

  it("mismatched `# Columns` vs `# Column keys` counts throw column-key-count-mismatch", () => {
    // Focused generator: labels.length !== keys.length AND both are non-empty
    // AND keys are all non-blank (isolates this one failure mode).
    const mismatchArb = fc
      .record({
        labels: fc.integer({ min: 1, max: 4 }),
        keys: fc.integer({ min: 1, max: 4 }),
      })
      .filter(({ labels, keys }) => labels !== keys)
      .map(({ labels, keys }) => {
        const l = Array.from({ length: labels }, (_, i) => `L${i}`).join(" | ");
        const k = Array.from({ length: keys }, (_, i) => `k${i}`).join(",");
        return `# Columns (${labels}, in order): ${l}\n# Column keys: ${k}\n\nheader\ndata\n`;
      });
    fc.assert(
      fc.property(mismatchArb, (csv) => {
        expect(() => parseCsvMetadataHeader(csv)).toThrowError(CsvMetadataParseError);
        try {
          parseCsvMetadataHeader(csv);
        } catch (e) {
          expect((e as CsvMetadataParseError).code).toBe("column-key-count-mismatch");
        }
      }),
      { numRuns: propRuns(100) },
    );
  });

  it("omitting `# Column keys` throws missing-column-keys", () => {
    const omitArb = fc.integer({ min: 1, max: 5 }).map((n) => {
      const labels = Array.from({ length: n }, (_, i) => `L${i}`).join(" | ");
      return `# Columns (${n}, in order): ${labels}\n\nheader\ndata\n`;
    });
    fc.assert(
      fc.property(omitArb, (csv) => {
        try {
          parseCsvMetadataHeader(csv);
          throw new Error("expected throw");
        } catch (e) {
          expect(e).toBeInstanceOf(CsvMetadataParseError);
          expect((e as CsvMetadataParseError).code).toBe("missing-column-keys");
        }
      }),
      { numRuns: propRuns(80) },
    );
  });

  it("a blank entry in `# Column keys` throws empty-column-key or column-key-count-mismatch", () => {
    const emptyArb = fc
      .record({
        n: fc.integer({ min: 2, max: 5 }),
        blankAt: fc.nat(),
      })
      .map(({ n, blankAt }) => {
        const idx = blankAt % n;
        const labels = Array.from({ length: n }, (_, i) => `L${i}`).join(" | ");
        const keys = Array.from({ length: n }, (_, i) => (i === idx ? "" : `k${i}`)).join(",");
        return {
          csv: `# Columns (${n}, in order): ${labels}\n# Column keys: ${keys}\n\nh\nd\n`,
          idx,
        };
      });
    fc.assert(
      fc.property(emptyArb, ({ csv, idx }) => {
        try {
          parseCsvMetadataHeader(csv);
          throw new Error("expected throw");
        } catch (e) {
          expect(e).toBeInstanceOf(CsvMetadataParseError);
          const err = e as CsvMetadataParseError;
          // Parser strips blank keys via `.filter(s => s.length > 0)` BEFORE
          // the empty-key check, so a blank entry usually surfaces as a
          // count mismatch — both codes are documented failure modes for
          // this shape of input.
          expect(["empty-column-key", "column-key-count-mismatch"]).toContain(err.code);
          // Keep `idx` referenced so shrinker output pins the injection
          // site if a future regression fires.
          expect(idx).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: propRuns(150) },
    );
  });

  it("unclosed quotes and stray delimiters inside otherwise-well-formed labels never crash the parser", () => {
    // Focused: single balanced columns block with hostile label content.
    // Should always parse (or fail with a documented code) — never a
    // TypeError / generic Error.
    const hostileArb = fc
      .record({
        payload: fc.constantFrom(
          'un"closed',
          'trailing "',
          "with, comma",
          "with; semi",
          "stray | pipe", // will corrupt columns split — still must not crash
          'nested "q" and "more',
        ),
      })
      .map(
        ({ payload }) =>
          `# Columns (1, in order): ${payload}\n# Column keys: k1\n\nheader\n"un"closed"\n`,
      );
    fc.assert(
      fc.property(hostileArb, (csv) => {
        assertSafeShape(csv);
      }),
      { numRuns: propRuns(100) },
    );
  });

  it("random garbage `# …` prelude never leaks into structured fields", () => {
    // No columns block at all — every field except `rawLines` / `bodyStartIndex`
    // should be at its documented default when nothing well-formed matches.
    const garbageOnlyArb = fc
      .array(commentLineArb, { minLength: 0, maxLength: 8 })
      .filter((lines) =>
        lines.every(
          (l) =>
            !/^#\s*(Precise Realtors|Schema|Version|Generated|Filters|Sort|Page|Rows|Columns|Column keys)/i.test(
              l,
            ),
        ),
      )
      .map((lines) => `${lines.join("\n")}\n\nbody\n`);
    fc.assert(
      fc.property(garbageOnlyArb, (csv) => {
        const parsed = parseCsvMetadataHeader(csv);
        expect(parsed.columns).toBeNull();
        expect(parsed.source).toBeNull();
        expect(parsed.schema).toBeNull();
        expect(parsed.version).toBeNull();
        expect(parsed.generatedAt).toBeNull();
        expect(parsed.filters).toEqual({});
        expect(parsed.sort).toBeNull();
        expect(parsed.page).toBeNull();
        expect(parsed.counts).toBeNull();
      }),
      { numRuns: propRuns(150) },
    );
  });
});
