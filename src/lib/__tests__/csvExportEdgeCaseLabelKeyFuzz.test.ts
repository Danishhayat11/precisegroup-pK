/**
 * Property-based fuzz on EDGE-CASE labels/keys:
 *
 *   • empty label + no explicit key                → must throw CsvExportMetadataError(empty-column-label)
 *   • whitespace-only label + no explicit key      → same (label is trimmed before check)
 *   • empty explicit key (present but blank/space) → must throw CsvExportMetadataError(empty-column-key)
 *   • empty label + non-empty explicit key         → OK; parsed label falls back to the key
 *   • very long unicode labels (≤ 500 chars)       → round-trip verbatim (trimmed) through
 *                                                    prefixCsvWithMetadata → parseCsvMetadataHeader
 *   • very long unicode explicit keys              → survive verbatim on parsed `_meta.columns[].key`
 *   • explicit-key precedence under collision      → holds even at extreme label / key lengths
 *
 * Labels intentionally EXCLUDE `|`, `\n`, `\r` and keys exclude `,`,
 * `\n`, `\r` — those characters are structural separators in the
 * unescaped metadata block (`# Columns …: l1 | l2 …` and
 * `# Column keys: k1,k2 …`) and would silently corrupt the wire
 * format. The rest of the Unicode plane (letters, digits, punctuation,
 * whitespace, emoji, combining marks, CJK, RTL) is fair game and is
 * exactly what a real UI can push through.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { propRuns } from "./_helpers/propRuns";
import {
  CsvExportMetadataError,
  buildJsonExportMetadata,
  prefixCsvWithMetadata,
  buildCsvMetadataHeader,
  type CsvMetadataInput,
} from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

// --- Arbitraries ---------------------------------------------------------

/** Whitespace units the trimmer collapses. */
const wsUnit = fc.constantFrom(" ", "\t", "\u00A0", "\u2003");

/** Purely-whitespace strings (0–8 chars). */
const whitespaceLabelArb = fc
  .array(wsUnit, { minLength: 0, maxLength: 8 })
  .map((cs) => cs.join(""));

/** Very long unicode label — up to 500 chars — spanning many Unicode
 *  blocks. Excludes `|` / `\n` / `\r` (see file header). Guarantees at
 *  least one alphanumeric so the derived slug never degenerates to the
 *  `column` fallback (covered by dedicated tests elsewhere). */
const longUnicodeLabelArb = fc
  .string({
    unit: fc.oneof(
      fc.stringMatching(/^[A-Za-z0-9]$/),
      fc.constantFrom(
        " ",
        ".",
        ",",
        ";",
        ":",
        "(",
        ")",
        "?",
        "!",
        "$",
        "€",
        "&",
        "@",
        "—",
        "–",
        "·",
        "…",
        "“",
        "”",
        "‘",
        "’",
        '"',
        "中",
        "文",
        "日",
        "本",
        "語",
        "🚀",
        "🔥",
        "✓",
        "★",
        "\u0301",
        "\u0308", // combining marks
        "\u200E",
        "\u200F", // LTR / RTL marks
      ),
    ),
    minLength: 50,
    maxLength: 500,
  })
  .filter((s) => /[A-Za-z0-9]/.test(s) && !/[|\n\r]/.test(s));

/** Very long unicode explicit key (≤ 300 chars). Excludes `,` / `\n` / `\r`
 *  AND leading/trailing whitespace — the metadata reader trims key
 *  entries after splitting on `,`, so a key with surrounding whitespace
 *  would round-trip in a lossy way (that's an intentional parser
 *  normalisation, not a bug worth fuzzing here). Keys are opaque
 *  identifiers, so any other Unicode is legal. */
const longUnicodeKeyArb = fc
  .string({
    unit: fc.oneof(
      fc.stringMatching(/^[a-z0-9_]$/),
      fc.constantFrom("中", "文", "🚀", "✓", "—", "…", "€", ".", "-", ":", ";", " "),
    ),
    minLength: 20,
    maxLength: 300,
  })
  .map((s) => s.trim())
  .filter((s) => s.length >= 5 && !/[,\n\r]/.test(s));

// --- Helpers -------------------------------------------------------------

function roundTripCsv(cols: CsvMetadataInput["columns"]) {
  const input: CsvMetadataInput = {
    source: "Edge — label/key round trip",
    generatedAt: FIXED_DATE,
    columns: cols,
  };
  const headerRow = (cols ?? []).map(() => "x").join(",");
  const csv = prefixCsvWithMetadata(headerRow, input);
  return parseCsvMetadataHeader(csv);
}

function jsonKeys(cols: CsvMetadataInput["columns"]): string[] {
  const meta = buildJsonExportMetadata({
    source: "probe",
    generatedAt: FIXED_DATE,
    columns: cols,
  });
  return ((meta.columns as Array<{ key: string }> | undefined) ?? []).map((c) => c.key);
}

// --- Properties ----------------------------------------------------------

describe("csvExportMetadata — edge-case label/key fuzz", () => {
  it("empty or whitespace-only label with NO explicit key throws empty-column-label", () => {
    fc.assert(
      fc.property(whitespaceLabelArb, (label) => {
        try {
          buildCsvMetadataHeader({
            source: "probe",
            generatedAt: FIXED_DATE,
            columns: [{ label }],
          });
          throw new Error("expected throw");
        } catch (e) {
          expect(e).toBeInstanceOf(CsvExportMetadataError);
          expect((e as CsvExportMetadataError).code).toBe("empty-column-label");
        }
      }),
      { numRuns: propRuns(150) },
    );
  });

  it("present-but-whitespace-only explicit key throws empty-column-key", () => {
    // A key property that's a non-empty string but trims to empty is a
    // caller bug — refused fast-fail. Guard against `""` (which the
    // builder treats as "explicit key absent, derive from label") by
    // requiring at least one whitespace char.
    const wsKeyArb = fc.array(wsUnit, { minLength: 1, maxLength: 6 }).map((cs) => cs.join(""));
    fc.assert(
      fc.property(wsKeyArb, longUnicodeLabelArb, (key, label) => {
        try {
          buildCsvMetadataHeader({
            source: "probe",
            generatedAt: FIXED_DATE,
            columns: [{ key, label }],
          });
          throw new Error("expected throw");
        } catch (e) {
          expect(e).toBeInstanceOf(CsvExportMetadataError);
          expect((e as CsvExportMetadataError).code).toBe("empty-column-key");
        }
      }),
      { numRuns: propRuns(120) },
    );
  });

  it("empty label + non-empty explicit key is accepted; parsed label falls back to the key", () => {
    fc.assert(
      fc.property(longUnicodeKeyArb, (key) => {
        const parsed = roundTripCsv([{ key, label: "" }]);
        expect(parsed.columns).not.toBeNull();
        expect(parsed.columns![0].key).toBe(key);
        // Builder assigns `labelTrimmed || base` — with empty label, label
        // becomes the explicit key.
        expect(parsed.columns![0].label).toBe(key);
      }),
      { numRuns: propRuns(120) },
    );
  });

  it("very long unicode labels round-trip verbatim (after trim) through the CSV metadata block", () => {
    fc.assert(
      fc.property(longUnicodeLabelArb, (label) => {
        const parsed = roundTripCsv([{ label }]);
        expect(parsed.columns).not.toBeNull();
        expect(parsed.columns![0].label).toBe(label.trim());
        // Derived slug must be non-empty (labels contain ≥1 alphanumeric
        // by construction).
        expect(parsed.columns![0].key.length).toBeGreaterThan(0);
      }),
      { numRuns: propRuns(150) },
    );
  });

  it("very long unicode explicit keys survive verbatim on parsed metadata", () => {
    fc.assert(
      fc.property(longUnicodeKeyArb, longUnicodeLabelArb, (key, label) => {
        const parsed = roundTripCsv([{ key, label }]);
        expect(parsed.columns![0].key).toBe(key);
        expect(parsed.columns![0].label).toBe(label.trim());
      }),
      { numRuns: propRuns(150) },
    );
  });

  it("explicit-key precedence holds at extreme label/key lengths — sibling bumps deterministically", () => {
    // Random long label + explicit key that MATCHES the slug the same
    // label would derive to (probed via the builder). Placing the
    // explicit key first must keep the bare slug; placing a label-only
    // sibling second must bump the sibling.
    const pairArb = longUnicodeLabelArb.map((label) => {
      const line = buildCsvMetadataHeader({
        source: "probe",
        generatedAt: FIXED_DATE,
        columns: [{ label }],
      }).find((l) => l.startsWith("# Column keys:"))!;
      const slug = line.replace("# Column keys: ", "");
      return { label, slug };
    });
    fc.assert(
      fc.property(pairArb, ({ label, slug }) => {
        const cols: CsvMetadataInput["columns"] = [
          { key: slug, label: "Explicit wins" },
          { label },
        ];
        const parsed = roundTripCsv(cols);
        const keys = parsed.columns!.map((c) => c.key);
        expect(keys[0]).toBe(slug); // explicit keeps bare slug
        expect(keys[1]).toBe(`${slug}_2`); // sibling bumps
        expect(new Set(keys).size).toBe(2);
      }),
      { numRuns: propRuns(150) },
    );
  });

  it("CSV and JSON exporters emit identical keys at extreme lengths", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            longUnicodeLabelArb.map((label) => ({ label })),
            fc.record({ key: longUnicodeKeyArb, label: longUnicodeLabelArb }),
          ),
          { minLength: 1, maxLength: 6 },
        ),
        (cols) => {
          const parsed = roundTripCsv(cols);
          const parsedKeys = parsed.columns!.map((c) => c.key);
          expect(parsedKeys).toEqual(jsonKeys(cols));
        },
      ),
      { numRuns: propRuns(120) },
    );
  });
});
