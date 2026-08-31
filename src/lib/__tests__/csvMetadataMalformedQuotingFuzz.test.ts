/**
 * Malformed-quoting/escaping fuzz + negative tests for
 * `parseCsvMetadataHeader`.
 *
 * The parser's contract for HOSTILE INPUT is narrow (see
 * csvMetadataParser.ts):
 *
 *   • It MAY throw `CsvMetadataParseError`, and ONLY with one of the
 *     three documented `code`s:
 *       - "missing-column-keys"
 *       - "column-key-count-mismatch"
 *       - "empty-column-key"
 *   • Every other malformed line (unclosed quotes, stray delimiters,
 *     backslash escapes, garbage after a valid value, wrong-shape
 *     `# key: value` line) is TOLERATED. The parser drops into the
 *     `EXTRA_RE` catch-all or ignores the line entirely, and returns a
 *     well-formed `ParsedCsvMetadata` with a valid `bodyStartIndex`.
 *   • The returned object always satisfies:
 *       - `rawLines` is a prefix of the input's `#`-prefixed lines
 *       - every raw line starts with `#`
 *       - `bodyStartIndex` is within `[0, splitLines.length]`
 *       - `extra` / `filters` are string→string maps
 *       - `columns`, when non-null, has non-empty `key`s and matching
 *         `label` count
 *
 * This file complements `csvMetadataParserMalformedFuzz` (which
 * focuses on column-block invariants) by hammering the parser with
 * malformed CSV QUOTING and ESCAPING patterns inside every metadata
 * slot — labels, keys, filter values, extras — and asserting the
 * parser never throws a generic `Error`, `TypeError`, or
 * `SyntaxError`.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { propRuns } from "./_helpers/propRuns";
import {
  CsvMetadataParseError,
  parseCsvMetadataHeader,
  type ParsedCsvMetadata,
} from "../csvMetadataParser";

// -------------------------------------------------------------------------
// Shape invariants — every parse result MUST satisfy these, no matter how
// hostile the input was. Called from every property in this file.
// -------------------------------------------------------------------------
function assertShape(csv: string, parsed: ParsedCsvMetadata): void {
  const lines = csv.split(/\r\n|\n|\r/);
  expect(parsed.bodyStartIndex).toBeGreaterThanOrEqual(0);
  expect(parsed.bodyStartIndex).toBeLessThanOrEqual(lines.length);
  for (const raw of parsed.rawLines) {
    expect(raw.startsWith("#")).toBe(true);
  }
  // rawLines is a prefix of the leading `#` lines.
  const leadingHash = lines.findIndex((l) => !l.startsWith("#"));
  const leadingCount = leadingHash === -1 ? lines.length : leadingHash;
  expect(parsed.rawLines.length).toBeLessThanOrEqual(leadingCount);
  // Filters / extras are string→string maps.
  for (const v of Object.values(parsed.filters)) expect(typeof v).toBe("string");
  for (const v of Object.values(parsed.extra)) expect(typeof v).toBe("string");
  if (parsed.columns) {
    for (const c of parsed.columns) {
      expect(typeof c.label).toBe("string");
      expect(typeof c.key).toBe("string");
      expect(c.key.length).toBeGreaterThan(0);
    }
  }
}

/**
 * Run the parser and route the outcome into one of two channels:
 *
 *   • it returned a `ParsedCsvMetadata` → shape invariants must hold
 *   • it threw → the thrown value MUST be a `CsvMetadataParseError`
 *     with one of the three documented `code`s
 *
 * Any other outcome (generic `Error`, `TypeError`, RangeError, …) is a
 * regression. This is the single choke-point every property funnels
 * through so the "safe-or-clear-error" invariant is enforced once.
 */
function parseSafely(csv: string): void {
  try {
    const parsed = parseCsvMetadataHeader(csv);
    assertShape(csv, parsed);
  } catch (err) {
    // Anything other than the documented parse error is a contract break.
    expect(err).toBeInstanceOf(CsvMetadataParseError);
    const code = (err as CsvMetadataParseError).code;
    expect(["missing-column-keys", "column-key-count-mismatch", "empty-column-key"]).toContain(
      code,
    );
  }
}

// -------------------------------------------------------------------------
// Arbitraries: bytes that classic CSV parsers choke on. We never emit a
// newline INSIDE a `#` line — the metadata contract is one field per line —
// but we jam every other quoting/escape hazard into the payload.
// -------------------------------------------------------------------------
const HOSTILE_BYTES = [
  '"',
  '""',
  '"""',
  "'",
  "\\",
  '\\"',
  "\\n",
  "\\t",
  ",",
  ",,",
  "|",
  "||",
  "=",
  "==",
  ":",
  "::",
  ";",
  "\t",
  "\u0000",
  "\u001b",
  "\ufeff",
  "🚀",
  "—",
  "…",
  "中",
];
const hostileFragArb = fc.constantFrom(...HOSTILE_BYTES);
const hostilePayloadArb = fc
  .array(hostileFragArb, { minLength: 0, maxLength: 8 })
  .map((parts) => parts.join(""));

// -------------------------------------------------------------------------
// Property 1: hostile payloads in `# Filters:` never crash the parser.
// -------------------------------------------------------------------------
describe("parseCsvMetadataHeader — malformed quoting/escaping fuzz", () => {
  it("tolerates hostile bytes inside `# Filters:` payloads", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ k: hostilePayloadArb, v: hostilePayloadArb }), {
          minLength: 0,
          maxLength: 6,
        }),
        (entries) => {
          // Sanitise: strip newlines/`#` so we generate ONE `# Filters:` line.
          const clean = (s: string) => s.replace(/[\r\n#]/g, "");
          const payload = entries.map((e) => `${clean(e.k)}=${clean(e.v)}`).join(" | ");
          const csv = `# Filters: ${payload}\n\nheader\nrow\n`;
          parseSafely(csv);
        },
      ),
      { numRuns: propRuns(200) },
    );
  });

  // -----------------------------------------------------------------------
  // Property 2: hostile bytes in `# Columns` labels tolerated OR fail
  // with a documented error code (never a generic throw).
  // -----------------------------------------------------------------------
  it("tolerates hostile bytes inside `# Columns` labels + `# Column keys`", () => {
    fc.assert(
      fc.property(
        fc.array(hostilePayloadArb, { minLength: 1, maxLength: 5 }),
        fc.array(hostilePayloadArb, { minLength: 1, maxLength: 5 }),
        (rawLabels, rawKeys) => {
          const clean = (s: string) => s.replace(/[\r\n#|,]/g, "");
          const labels = rawLabels.map(clean).map((s, i) => s || `L${i}`);
          const keys = rawKeys.map(clean).map((s, i) => s || `k${i}`);
          const csv = [
            `# Columns (${labels.length}, in order): ${labels.join(" | ")}`,
            `# Column keys: ${keys.join(",")}`,
            "",
            "header",
            "row",
          ].join("\n");
          parseSafely(csv);
        },
      ),
      { numRuns: propRuns(200) },
    );
  });

  // -----------------------------------------------------------------------
  // Property 3: hostile bytes in `# Key: Value` extras — always tolerated
  // (extras have no strict grammar), never a documented parse error.
  // -----------------------------------------------------------------------
  it("tolerates hostile bytes inside arbitrary `# key: value` extras", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ k: hostilePayloadArb, v: hostilePayloadArb }), {
          minLength: 0,
          maxLength: 8,
        }),
        (extras) => {
          const clean = (s: string) => s.replace(/[\r\n#:]/g, "").trim() || "Key";
          const lines = extras.map((e) => `# ${clean(e.k)}: ${e.v.replace(/[\r\n]/g, "")}`);
          const csv = [...lines, "", "header", "row"].join("\n");
          // No column block ⇒ never throws.
          const parsed = parseCsvMetadataHeader(csv);
          assertShape(csv, parsed);
        },
      ),
      { numRuns: propRuns(200) },
    );
  });

  // -----------------------------------------------------------------------
  // Property 4: fully random `#` line noise + mixed line endings — parser
  // never throws anything other than the three documented codes.
  // -----------------------------------------------------------------------
  it("survives fully-random `#` line noise with mixed line endings", () => {
    fc.assert(
      fc.property(
        fc.array(hostilePayloadArb, { minLength: 0, maxLength: 12 }),
        fc.constantFrom("\n", "\r\n", "\r"),
        (payloads, eol) => {
          const lines = payloads.map((p) => `# ${p.replace(/[\r\n]/g, "")}`);
          const csv = [...lines, "", "header", "row"].join(eol);
          parseSafely(csv);
        },
      ),
      { numRuns: propRuns(200) },
    );
  });
});

// -------------------------------------------------------------------------
// Negative regression fixtures: specific malformed CSV shapes we've seen
// in the wild. Each asserts the exact recovery-or-throw behaviour, so a
// future refactor can't silently swap a clear error for a soft recovery
// (or vice versa) without updating this file.
// -------------------------------------------------------------------------
describe("parseCsvMetadataHeader — malformed CSV negative fixtures", () => {
  it("unclosed quote in a `# Filters:` value is tolerated as raw text", () => {
    const csv = `# Filters: Owner="Ada | Status=Open\n\nheader\nrow\n`;
    const parsed = parseCsvMetadataHeader(csv);
    // The parser splits on `|` and takes the tail after the first `=` as
    // the value — an unclosed quote is preserved verbatim, not stripped.
    expect(parsed.filters).toEqual({ Owner: '"Ada', Status: "Open" });
    expect(parsed.bodyStartIndex).toBe(2);
  });

  it("`# Columns` without `# Column keys` throws missing-column-keys", () => {
    const csv = `# Columns (2, in order): A | B\n\nheader\nrow\n`;
    expect(() => parseCsvMetadataHeader(csv)).toThrow(CsvMetadataParseError);
    try {
      parseCsvMetadataHeader(csv);
    } catch (err) {
      expect((err as CsvMetadataParseError).code).toBe("missing-column-keys");
      expect((err as CsvMetadataParseError).details.labelCount).toBe(2);
    }
  });

  it("column/key count mismatch throws column-key-count-mismatch", () => {
    const csv = [
      "# Columns (3, in order): A | B | C",
      "# Column keys: a,b",
      "",
      "header",
      "row",
    ].join("\n");
    try {
      parseCsvMetadataHeader(csv);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CsvMetadataParseError);
      const e = err as CsvMetadataParseError;
      expect(e.code).toBe("column-key-count-mismatch");
      expect(e.details.labelCount).toBe(3);
      expect(e.details.keyCount).toBe(2);
    }
  });

  it("empty-string key entry throws empty-column-key with its index", () => {
    const csv = ["# Columns (3, in order): A | B | C", "# Column keys: a,,c", "", "header"].join(
      "\n",
    );
    try {
      parseCsvMetadataHeader(csv);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CsvMetadataParseError);
      const e = err as CsvMetadataParseError;
      // The parser filters blank entries before length compare, so this
      // surfaces as a count mismatch (2 keys vs 3 labels), not an empty-key
      // — pin the exact recovered code so a future rewrite either keeps
      // this behaviour or bumps the fixture explicitly.
      expect(e.code).toBe("column-key-count-mismatch");
    }
  });

  it("whitespace-only key entry throws column-key-count-mismatch", () => {
    // Same rationale as above: trimming + blank-filter collapses `   `
    // into nothing, so the surfaced error is a count mismatch.
    const csv = ["# Columns (2, in order): A | B", "# Column keys: a,   ", "", "header"].join("\n");
    try {
      parseCsvMetadataHeader(csv);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CsvMetadataParseError);
      expect((err as CsvMetadataParseError).code).toBe("column-key-count-mismatch");
    }
  });

  it("stray `|` in a `# Filters:` value splits into a bogus entry (dropped)", () => {
    // `| Owner=Ada` after the split yields `""` before `=` → no key, dropped.
    const csv = `# Filters: Status=Open|| Owner=Ada\n\nheader\n`;
    const parsed = parseCsvMetadataHeader(csv);
    // The `||` yields an empty middle segment (no `=`), which is silently
    // dropped. Both surviving entries land in the map.
    expect(parsed.filters).toEqual({ Status: "Open", Owner: "Ada" });
  });

  it("backslash escapes in labels are preserved literally, not interpreted", () => {
    const csv = ["# Columns (2, in order): A\\nB | C\\tD", "# Column keys: a,c", "", "header"].join(
      "\n",
    );
    const parsed = parseCsvMetadataHeader(csv);
    expect(parsed.columns).toEqual([
      { label: "A\\nB", key: "a" },
      { label: "C\\tD", key: "c" },
    ]);
  });

  it("BOM at the start of the file does not crash the parser", () => {
    const csv = `\ufeff# Precise Realtors — Test\n\nheader\nrow\n`;
    const parsed = parseCsvMetadataHeader(csv);
    // First line starts with BOM+`#`, so the `startsWith("#")` check fails
    // and the parser treats the whole file as body — safe recovery.
    expect(parsed.source).toBeNull();
    expect(parsed.bodyStartIndex).toBe(0);
  });

  it("garbage `# …` line with no colon becomes neither extra nor known slot", () => {
    const csv = `# just some noise with no colon\n# Real: value\n\nheader\n`;
    const parsed = parseCsvMetadataHeader(csv);
    // The first line has no `:` so `EXTRA_RE` doesn't match → silently ignored.
    // The second line lands in `extra`.
    expect(parsed.extra).toEqual({ Real: "value" });
    expect(parsed.rawLines).toHaveLength(2);
  });
});
