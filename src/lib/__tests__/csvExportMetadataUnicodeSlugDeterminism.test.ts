/**
 * Locks in deterministic slugification + dedup behavior for column
 * labels containing diacritics, composed (NFC) vs decomposed (NFD)
 * Unicode forms, and non-Latin scripts.
 *
 * Current contract (documented, not aspirational):
 *
 *   • The slugifier is ASCII-only: `[^a-z0-9]+` collapses to `_`. It
 *     does NOT normalize or transliterate — so NFC "café" (`caf\u00E9`)
 *     slugs to `caf` (the precomposed é is stripped whole), while NFD
 *     "café" (`cafe\u0301`) slugs to `cafe` (the base "e" survives, the
 *     combining acute is stripped). Callers that need NFC and NFD to
 *     collide MUST normalize before handing labels to the exporter.
 *
 *   • Non-Latin scripts (CJK, Greek, Cyrillic, Arabic, emoji-only) have
 *     zero ASCII letters, so every such label falls back to the `column`
 *     base and is deduped positionally: `column`, `column_2`, `column_3`.
 *
 *   • German ß lower-cases to itself (NOT "ss") in JavaScript's default
 *     `toLowerCase`, so "Straße" → `stra_e`, matching "strasse" would
 *     NOT collide. This is intentional: `toLocaleLowerCase("de")` would
 *     change the mapping and is not what the exporter uses.
 *
 * These tests are the canary that catches:
 *   1. A well-intentioned "let's normalize Unicode" edit that silently
 *      changes every historical export's column keys.
 *   2. A swap to a library slugifier (slugify, github-slugger) that
 *      transliterates diacritics and shifts every downstream key.
 *   3. Non-determinism across repeat builds for the same input.
 */
import { describe, it, expect } from "vitest";
import {
  buildCsvMetadataHeader,
  buildJsonExportMetadata,
  type CsvMetadataInput,
} from "../csvExportMetadata";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

/** Extract the ordered derived keys from the CSV `# Column keys:` line. */
function csvKeys(columns: CsvMetadataInput["columns"]): string[] {
  const line = buildCsvMetadataHeader({ source: "X", generatedAt: FIXED_DATE, columns }).find((l) =>
    l.startsWith("# Column keys:"),
  );
  return line ? line.replace("# Column keys: ", "").split(",") : [];
}

/** Extract the ordered derived keys from the JSON envelope. */
function jsonKeys(columns: CsvMetadataInput["columns"]): string[] {
  const meta = buildJsonExportMetadata({ source: "X", generatedAt: FIXED_DATE, columns });
  return ((meta.columns as Array<{ key: string }> | undefined) ?? []).map((c) => c.key);
}

/** Both exporters must agree, and the result must match `expected`. */
function assertKeys(columns: CsvMetadataInput["columns"], expected: string[]) {
  const c = csvKeys(columns);
  const j = jsonKeys(columns);
  expect(c).toEqual(expected);
  expect(j).toEqual(expected);
  expect(c).toEqual(j);
}

describe("slugification determinism — diacritics, NFC/NFD, non-Latin scripts", () => {
  describe("diacritic labels (single-byte precomposed forms)", () => {
    // Each expected key is anchored to the exact character stripping
    // rule: precomposed accented letters (U+00E0..U+017F range) have
    // no [a-z0-9] mapping, so they collapse to `_` alongside spaces.
    const cases: Array<{ label: string; key: string }> = [
      { label: "café", key: "caf" }, // é (U+00E9) stripped
      { label: "naïve", key: "na_ve" }, // ï (U+00EF) → _
      { label: "résumé", key: "r_sum" }, // é × 2 stripped at edges
      { label: "Ångström", key: "ngstr_m" }, // Å, ö stripped; trailing/leading _ trimmed
      { label: "Zürich", key: "z_rich" },
      { label: "São Paulo", key: "s_o_paulo" },
      { label: "Piñata", key: "pi_ata" },
      { label: "Straße", key: "stra_e" }, // ß lower-cases to itself, NOT "ss"
    ];
    for (const { label, key } of cases) {
      it(`"${label}" → ${key}`, () => assertKeys([{ label }], [key]));
    }
  });

  describe("NFC vs NFD are NOT canonically equal (documented divergence)", () => {
    // The slugifier does not normalize. This test PINS the current
    // behavior so any silent normalization change is caught in CI.
    const NFC_CAFE = "caf\u00e9"; // é as one code point
    const NFD_CAFE = "cafe\u0301"; // e + combining acute
    const NFC_NAIVE = "na\u00efve"; // ï precomposed
    const NFD_NAIVE = "nai\u0308ve"; // i + combining diaeresis
    const NFC_ANGSTROM = "\u00c5ngstr\u00f6m";
    const NFD_ANGSTROM = "A\u030angstro\u0308m";

    it("NFC 'café' strips the precomposed letter → 'caf'", () => {
      assertKeys([{ label: NFC_CAFE }], ["caf"]);
    });
    it("NFD 'café' keeps the base 'e', strips the combining mark → 'cafe'", () => {
      assertKeys([{ label: NFD_CAFE }], ["cafe"]);
    });
    it("NFC and NFD 'café' are DIFFERENT keys (no auto-normalization)", () => {
      assertKeys([{ label: NFC_CAFE }, { label: NFD_CAFE }], ["caf", "cafe"]);
    });
    it("NFC 'naïve' → 'na_ve', NFD 'naïve' → 'nai_ve' (base 'i' survives NFD)", () => {
      assertKeys([{ label: NFC_NAIVE }, { label: NFD_NAIVE }], ["na_ve", "nai_ve"]);
    });
    it("NFC 'Ångström' → 'ngstr_m'; NFD → 'a_ngstro_m' (base 'A', 'o' survive NFD)", () => {
      assertKeys([{ label: NFC_ANGSTROM }, { label: NFD_ANGSTROM }], ["ngstr_m", "a_ngstro_m"]);
    });
    it("caller pre-normalization (NFC) makes the two forms collide via dedup", () => {
      // Documents the escape hatch: if callers normalize FIRST, the
      // two forms produce the same base and dedupe deterministically.
      const a = NFC_CAFE.normalize("NFC");
      const b = NFD_CAFE.normalize("NFC");
      assertKeys([{ label: a }, { label: b }], ["caf", "caf_2"]);
    });
    it("NFC and NFD siblings do NOT dedupe against each other (different bases)", () => {
      // Three NFD 'café' entries collide with themselves but NOT with
      // the NFC form because they slug to a different base.
      assertKeys(
        [{ label: NFD_CAFE }, { label: NFD_CAFE }, { label: NFC_CAFE }, { label: NFD_CAFE }],
        ["cafe", "cafe_2", "caf", "cafe_3"],
      );
    });
  });

  describe("non-Latin scripts (no ASCII letters → fallback base 'column')", () => {
    it("single CJK label falls back to 'column'", () => {
      assertKeys([{ label: "北京" }], ["column"]);
    });
    it("three distinct non-Latin labels dedupe positionally as column/column_2/column_3", () => {
      // CJK, Japanese, Greek — all zero ASCII letters, so all three
      // collapse to the same `column` base and dedupe by position.
      assertKeys(
        [{ label: "北京" }, { label: "日本語" }, { label: "Ω" }],
        ["column", "column_2", "column_3"],
      );
    });
    it("Cyrillic + Arabic + emoji-only labels all fall back to 'column'", () => {
      assertKeys(
        [{ label: "Москва" }, { label: "القاهرة" }, { label: "🚀" }],
        ["column", "column_2", "column_3"],
      );
    });
    it("mixed ASCII + non-Latin: ASCII portion drives the slug, non-Latin is stripped", () => {
      // "City 北京" → strip non-Latin, keep "city" → base `city`.
      assertKeys([{ label: "City 北京" }, { label: "City 东京" }], ["city", "city_2"]);
    });
    it("explicit key on a non-Latin label wins; sibling non-Latin still falls back", () => {
      assertKeys([{ key: "beijing", label: "北京" }, { label: "东京" }], ["beijing", "column"]);
    });
    it("digits inside a non-Latin label are preserved by the slug", () => {
      // "日本語 2026" has digits → slug `2026` (leading _ trimmed).
      assertKeys([{ label: "日本語 2026" }], ["2026"]);
    });
  });

  describe("dedup ordering with mixed diacritic + ASCII siblings", () => {
    it("'Café' + 'Cafe' → same base 'caf'/'cafe' — different bases, no collision", () => {
      // Different bases (`caf` vs `cafe`) so BOTH get slot 1 of their
      // respective base sequences.
      assertKeys([{ label: "Café" }, { label: "Cafe" }], ["caf", "cafe"]);
    });
    it("'Cafe' + 'CAFE' → same lowercased base 'cafe' → dedupe as cafe/cafe_2", () => {
      assertKeys([{ label: "Cafe" }, { label: "CAFE" }], ["cafe", "cafe_2"]);
    });
    it("'Café' + 'Café' + 'Cafe' → caf, caf_2, cafe (different bases interleave)", () => {
      assertKeys(
        [{ label: "Café" }, { label: "Café" }, { label: "Cafe" }],
        ["caf", "caf_2", "cafe"],
      );
    });
  });

  describe("byte-stable across repeat builds (determinism)", () => {
    // Same input, three back-to-back builds: outputs must be
    // byte-identical. Guards against any hidden Map/Set iteration
    // reliance on insertion timing.
    const input: CsvMetadataInput = {
      source: "Unicode Stability",
      generatedAt: FIXED_DATE,
      columns: [
        { label: "café" }, // NFC
        { label: "cafe\u0301" }, // NFD
        { label: "北京" },
        { label: "日本語" },
        { label: "Ω" },
        { label: "Straße" },
        { label: "Café" },
        { label: "Cafe" },
        { label: "🚀" },
        { key: "city_explicit", label: "Zürich" },
      ],
    };
    it("CSV header lines are byte-identical across three builds", () => {
      const a = buildCsvMetadataHeader(input).join("\n");
      const b = buildCsvMetadataHeader(input).join("\n");
      const c = buildCsvMetadataHeader(input).join("\n");
      expect(a).toBe(b);
      expect(b).toBe(c);
    });
    it("JSON envelope is byte-identical across three builds", () => {
      const a = JSON.stringify(buildJsonExportMetadata(input));
      const b = JSON.stringify(buildJsonExportMetadata(input));
      const c = JSON.stringify(buildJsonExportMetadata(input));
      expect(a).toBe(b);
      expect(b).toBe(c);
    });
    it("CSV and JSON derive the SAME keys (writer parity for unicode inputs)", () => {
      expect(csvKeys(input.columns)).toEqual(jsonKeys(input.columns));
    });
  });

  describe("key-count invariants under unicode inputs", () => {
    it("every derived key is unique regardless of unicode form mixing", () => {
      const columns: CsvMetadataInput["columns"] = [
        { label: "café" },
        { label: "cafe\u0301" },
        { label: "CAFÉ" },
        { label: "cafe" },
        { label: "北京" },
        { label: "北京" },
        { label: "🚀" },
        { label: "Ω" },
      ];
      const keys = csvKeys(columns);
      expect(keys).toHaveLength(columns!.length);
      expect(new Set(keys).size).toBe(keys.length);
      // And JSON must be identical.
      expect(jsonKeys(columns)).toEqual(keys);
    });
  });
});
