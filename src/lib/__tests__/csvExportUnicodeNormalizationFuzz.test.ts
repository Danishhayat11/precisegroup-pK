/**
 * Property-based fuzz for unicode-heavy labels and keys:
 *   • combining marks (e.g. `e` + U+0301 ≡ `é` in NFD)
 *   • base-plane and astral-plane emoji (including ZWJ sequences)
 *   • mixed NFC/NFD normalisation forms
 *
 * The exporter is intentionally NORMALISATION-BLIND — it does not call
 * `String.prototype.normalize()` on labels or keys, so the same visual
 * glyph in NFC vs NFD is treated as two distinct strings. Downstream
 * tooling that reads a `.csv` / `.json` export needs this: silently
 * folding forms would corrupt data for callers that key off exact byte
 * sequences (e.g. Postgres identifiers, filesystem paths).
 *
 * Invariants asserted here on every generated case:
 *
 *   1. Byte-stable label round-trip: labels containing combining
 *      marks / emoji / ZWJ sequences come back byte-for-byte through
 *      `prefixCsvWithMetadata → parseCsvMetadataHeader`, in whichever
 *      normalisation form the caller used (NFC stays NFC, NFD stays
 *      NFD, mixed stays mixed).
 *   2. Byte-stable explicit-key round-trip: same guarantee for
 *      explicit `{key}` values on parsed `_meta.columns[].key`.
 *   3. Normalisation blindness: an NFD label and its NFC-normalised
 *      twin are treated as two distinct columns — both survive, and
 *      the derived-key deduper bumps siblings deterministically.
 *   4. Explicit-key precedence: an explicit key with combining marks /
 *      emoji still wins the base slug over a sibling that would
 *      derive to the same slug.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { propRuns } from "./_helpers/propRuns";
import {
  buildCsvMetadataHeader,
  prefixCsvWithMetadata,
  buildJsonExportMetadata,
  type CsvMetadataInput,
} from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

// --- Arbitraries ---------------------------------------------------------

/** Base characters that compose interestingly with the combining marks below. */
const baseCharArb = fc.constantFrom("a", "e", "i", "o", "u", "n", "c", "s", "A", "E", "N", "C");

/** A random combining diacritic (Latin, generic, and one CJK). */
const combiningMarkArb = fc.constantFrom(
  "\u0301", // COMBINING ACUTE ACCENT
  "\u0300", // COMBINING GRAVE ACCENT
  "\u0303", // COMBINING TILDE
  "\u0308", // COMBINING DIAERESIS
  "\u0327", // COMBINING CEDILLA
  "\u030A", // COMBINING RING ABOVE
);

/** Emoji, including ZWJ sequences and skin-tone modifiers. */
const emojiArb = fc.constantFrom(
  "🚀",
  "🔥",
  "✓",
  "★",
  "🇺🇳",
  "👨\u200D💻", // ZWJ: man technologist
  "👩\u200D🚀", // ZWJ: woman astronaut
  "👋\uD83C\uDFFF", // waving hand + dark skin tone
  "🏳️\u200D🌈", // ZWJ: rainbow flag
);

/** `base + combining` cluster in NFD form. */
const nfdClusterArb = fc.tuple(baseCharArb, combiningMarkArb).map(([b, m]) => `${b}${m}`);

/** A label built from a random interleave of NFC letters, NFD clusters,
 *  emoji and ASCII noise. Length 20–80 chars. */
const unicodeLabelArb = fc
  .array(
    fc.oneof(
      fc.stringMatching(/^[A-Za-z0-9 ]$/),
      nfdClusterArb,
      emojiArb,
      fc.constantFrom(".", "-", ":", ";", "(", ")", "—", "…"),
    ),
    { minLength: 10, maxLength: 40 },
  )
  .map((parts) => parts.join(""))
  // Exclude bytes that corrupt the un-escaped metadata block.
  .filter((s) => !/[|\n\r]/.test(s) && /[A-Za-z0-9]/.test(s));

/** Explicit key: unicode + combining marks + emoji, no `,` `\n` `\r`,
 *  no leading/trailing whitespace (parser trims key entries). */
const unicodeKeyArb = fc
  .array(fc.oneof(fc.stringMatching(/^[a-z0-9_]$/), nfdClusterArb, emojiArb), {
    minLength: 4,
    maxLength: 20,
  })
  .map((parts) => parts.join("").trim())
  .filter((s) => s.length >= 3 && !/[,\n\r]/.test(s));

// --- Helpers -------------------------------------------------------------

function roundTrip(cols: CsvMetadataInput["columns"]) {
  const csv = prefixCsvWithMetadata((cols ?? []).map(() => "x").join(","), {
    source: "Unicode round-trip",
    generatedAt: FIXED_DATE,
    columns: cols,
  });
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

/** Probe: what key does the deduper derive for a lone label? */
function derivedSlugFor(label: string): string {
  const line = buildCsvMetadataHeader({
    source: "probe",
    generatedAt: FIXED_DATE,
    columns: [{ label }],
  }).find((l) => l.startsWith("# Column keys:"))!;
  return line.replace("# Column keys: ", "");
}

// --- Properties ----------------------------------------------------------

describe("csvExportMetadata — unicode / combining / emoji / NFC↔NFD fuzz", () => {
  it("labels containing combining marks and emoji round-trip byte-for-byte (trimmed)", () => {
    fc.assert(
      fc.property(unicodeLabelArb, (label) => {
        const parsed = roundTrip([{ label }]);
        expect(parsed.columns).not.toBeNull();
        expect(parsed.columns![0].label).toBe(label.trim());
        // The label kept every code unit — no NFC folding.
        expect([...parsed.columns![0].label]).toEqual([...label.trim()]);
      }),
      { numRuns: propRuns(200) },
    );
  });

  it("explicit keys containing combining marks and emoji round-trip byte-for-byte", () => {
    fc.assert(
      fc.property(unicodeKeyArb, unicodeLabelArb, (key, label) => {
        const parsed = roundTrip([{ key, label }]);
        expect(parsed.columns![0].key).toBe(key);
        // Same code-point stability check on the parsed key.
        expect([...parsed.columns![0].key]).toEqual([...key]);
      }),
      { numRuns: propRuns(200) },
    );
  });

  it("NFC and NFD variants of the same visual label are treated as distinct siblings", () => {
    // Generate a random NFC-normalised label, then derive its NFD twin.
    // When the two forms genuinely differ (i.e. the label contains at
    // least one decomposable code point), both must survive AS DISTINCT
    // columns with unique derived keys.
    const twinArb = unicodeLabelArb
      .map((label) => {
        const nfc = label.normalize("NFC").trim();
        const nfd = label.normalize("NFD").trim();
        return { nfc, nfd };
      })
      .filter(({ nfc, nfd }) => nfc !== nfd && nfc.length > 0 && nfd.length > 0);

    fc.assert(
      fc.property(twinArb, ({ nfc, nfd }) => {
        const parsed = roundTrip([{ label: nfc }, { label: nfd }]);
        expect(parsed.columns).toHaveLength(2);
        // Labels survive verbatim in their original normalisation form.
        expect(parsed.columns![0].label).toBe(nfc);
        expect(parsed.columns![1].label).toBe(nfd);
        // The deduper produced two DISTINCT keys — the writer did not
        // silently fold the two forms onto the same slug.
        const keys = parsed.columns!.map((c) => c.key);
        expect(new Set(keys).size).toBe(2);
      }),
      { numRuns: propRuns(150) },
    );
  });

  it("explicit-key precedence holds when the explicit key contains combining marks / emoji", () => {
    // Place `{ key: derived_slug(L), label: 'winner' }` first, then
    // `{ label: L }`. The explicit position keeps the bare slug and
    // the label-only sibling bumps to `_2` — regardless of the unicode
    // complexity of `L` or the derived slug.
    fc.assert(
      fc.property(unicodeLabelArb, (label) => {
        const slug = derivedSlugFor(label);
        const parsed = roundTrip([{ key: slug, label: "Explicit winner" }, { label }]);
        const keys = parsed.columns!.map((c) => c.key);
        expect(keys[0]).toBe(slug);
        expect(keys[1]).toBe(`${slug}_2`);
        expect(new Set(keys).size).toBe(2);
      }),
      { numRuns: propRuns(150) },
    );
  });

  it("CSV and JSON exporters emit identical key sequences on unicode-heavy mixes", () => {
    const mixArb = fc.array(
      fc.oneof(
        unicodeLabelArb.map((label) => ({ label })),
        fc.record({ key: unicodeKeyArb, label: unicodeLabelArb }),
      ),
      { minLength: 1, maxLength: 6 },
    );
    fc.assert(
      fc.property(mixArb, (cols) => {
        const parsed = roundTrip(cols);
        expect(parsed.columns!.map((c) => c.key)).toEqual(jsonKeys(cols));
      }),
      { numRuns: propRuns(150) },
    );
  });
});
