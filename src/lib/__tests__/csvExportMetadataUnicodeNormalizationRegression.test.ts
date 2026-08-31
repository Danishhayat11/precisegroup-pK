/**
 * Regression coverage for slugification determinism across Unicode
 * normalization boundaries. Complements
 * `csvExportMetadataUnicodeSlugDeterminism.test.ts` (which pins the
 * baseline NFC/NFD/non-Latin contract) and
 * `csvExportMetadataEmojiSymbolSlugDedup.test.ts` (which pins the
 * emoji / punctuation contract) with three specific regression axes
 * that historically flip when someone "cleans up" the slugger:
 *
 *   1. NFC ⇄ NFD form-mixing determinism at scale: the same character
 *      appearing in NFC and NFD form in the SAME batch must produce
 *      byte-identical output across repeated builds AND across
 *      arbitrary permutations of the batch. This is the property that
 *      breaks first if someone swaps `Map` for a `Set`-backed
 *      structure without a stable iteration guarantee.
 *
 *   2. Mixed-width characters (halfwidth / fullwidth ASCII, halfwidth
 *      katakana, fullwidth digits) — none of these live in `[a-z0-9]`
 *      even though they look like ASCII, so they MUST fall back to
 *      the `column` base and dedupe positionally. This is the canary
 *      for a well-meaning "just NFKC-normalize labels" edit that would
 *      silently make fullwidth `Ａｍｏｕｎｔ` collide with ASCII
 *      `Amount` and rekey every historical export.
 *
 *   3. Emoji + diacritic combinations (ZWJ family sequences, skin-tone
 *      modifiers, emoji-with-VS16, combining-mark-on-emoji) must remain
 *      code-point-preserving in the label field AND deterministic in
 *      the derived key. Removing / re-ordering combining marks would
 *      change the label but must NEVER change key derivation.
 *
 * The whole file is written as regression-pins: every expected key is
 * spelled out. When any assertion flips, that is by construction a
 * behavior change that requires an intentional migration plan, not a
 * silent library upgrade.
 */
import { describe, it, expect } from "vitest";
import {
  buildCsvMetadataHeader,
  buildJsonExportMetadata,
  type CsvMetadataInput,
} from "../csvExportMetadata";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

function csvKeys(columns: CsvMetadataInput["columns"]): string[] {
  const line = buildCsvMetadataHeader({ source: "R", generatedAt: FIXED_DATE, columns }).find((l) =>
    l.startsWith("# Column keys:"),
  );
  return line ? line.replace("# Column keys: ", "").split(",") : [];
}
function jsonKeys(columns: CsvMetadataInput["columns"]): string[] {
  const meta = buildJsonExportMetadata({ source: "R", generatedAt: FIXED_DATE, columns });
  return ((meta.columns as Array<{ key: string }> | undefined) ?? []).map((c) => c.key);
}
function jsonLabels(columns: CsvMetadataInput["columns"]): string[] {
  const meta = buildJsonExportMetadata({ source: "R", generatedAt: FIXED_DATE, columns });
  return ((meta.columns as Array<{ label: string }> | undefined) ?? []).map((c) => c.label);
}
function assertKeys(columns: CsvMetadataInput["columns"], expected: string[]) {
  const c = csvKeys(columns);
  const j = jsonKeys(columns);
  expect(c).toEqual(expected);
  expect(j).toEqual(expected);
}

// Small deterministic permuter — swaps index i with (i * 7 + 3) % n.
function permute<T>(arr: readonly T[], seed: number): T[] {
  const out = arr.slice();
  for (let i = 0; i < out.length; i++) {
    const j = (i * 7 + seed * 3 + 1) % out.length;
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

describe("regression — unicode normalization, mixed-width, emoji/diacritics determinism", () => {
  // ------------------------------------------------------------------
  // 1. NFC ⇄ NFD form-mixing determinism at scale
  // ------------------------------------------------------------------
  describe("NFC and NFD form-mixing stays deterministic across repeat + permutation", () => {
    // Ten labels: five NFC, five NFD, interleaved. Different bases
    // (NFC strips the precomposed letter; NFD keeps the base letter)
    // — the assertion is not "they collide" but "the exact key list
    // is stable across 5 rebuilds and stable across seeded permutation".
    const nfc = [
      "caf\u00e9", // café precomposed → 'caf'
      "na\u00efve", // naïve precomposed → 'na_ve'
      "r\u00e9sum\u00e9", // résumé → 'r_sum'
      "Z\u00fcrich", // Zürich → 'z_rich'
      "\u00c5ngstr\u00f6m", // Ångström → 'ngstr_m'
    ];
    const nfd = [
      "cafe\u0301", // café decomposed → 'cafe'
      "nai\u0308ve", // naïve decomposed → 'nai_ve'
      "re\u0301sume\u0301", // résumé decomposed → 're_sume'
      "Zu\u0308rich", // Zürich decomposed → 'zu_rich'
      "A\u030angstro\u0308m", // Ångström decomposed → 'a_ngstro_m'
    ];
    const interleaved: CsvMetadataInput["columns"] = [];
    for (let i = 0; i < 5; i++) {
      interleaved.push({ label: nfc[i]! });
      interleaved.push({ label: nfd[i]! });
    }
    const expected = [
      "caf",
      "cafe",
      "na_ve",
      "nai_ve",
      "r_sum",
      "re_sume",
      "z_rich",
      "zu_rich",
      "ngstr_m",
      "a_ngstro_m",
    ];

    it("interleaved NFC/NFD batch yields the exact regression-pinned key list", () => {
      assertKeys(interleaved, expected);
    });

    it("five back-to-back builds are byte-identical (CSV + JSON)", () => {
      const csvBuilds = Array.from({ length: 5 }, () =>
        buildCsvMetadataHeader({ source: "R", generatedAt: FIXED_DATE, columns: interleaved }).join(
          "\n",
        ),
      );
      const jsonBuilds = Array.from({ length: 5 }, () =>
        JSON.stringify(
          buildJsonExportMetadata({ source: "R", generatedAt: FIXED_DATE, columns: interleaved }),
        ),
      );
      expect(new Set(csvBuilds).size).toBe(1);
      expect(new Set(jsonBuilds).size).toBe(1);
    });

    it("permuting the batch permutes the keys 1:1 — no cross-contamination", () => {
      // For every seeded permutation, the key at position i must be the
      // key that the label at position i would produce on its own.
      const soloKey = (label: string) => csvKeys([{ label }])[0]!;
      for (let seed = 0; seed < 8; seed++) {
        const perm = permute(interleaved, seed);
        const keys = csvKeys(perm);
        expect(keys).toHaveLength(perm.length);
        // No dedupe suffix should appear — every base is distinct in
        // this batch, so a `_N` suffix would signal a slug regression.
        expect(keys.every((k) => !/_\d+$/.test(k))).toBe(true);
        for (let i = 0; i < perm.length; i++) {
          expect(keys[i]).toBe(soloKey((perm[i] as { label: string }).label));
        }
      }
    });

    it("NFC-normalizing every label FIRST collapses each pair into base + _2", () => {
      const normalized = interleaved.map((c) => ({
        label: (c as { label: string }).label.normalize("NFC"),
      }));
      const keys = csvKeys(normalized);
      // Each of the 5 NFC bases appears twice → base, base_2 interleaved.
      expect(keys).toEqual([
        "caf",
        "caf_2",
        "na_ve",
        "na_ve_2",
        "r_sum",
        "r_sum_2",
        "z_rich",
        "z_rich_2",
        "ngstr_m",
        "ngstr_m_2",
      ]);
    });

    it("NFD-normalizing every label FIRST collapses each pair into base + _2", () => {
      const normalized = interleaved.map((c) => ({
        label: (c as { label: string }).label.normalize("NFD"),
      }));
      const keys = csvKeys(normalized);
      expect(keys).toEqual([
        "cafe",
        "cafe_2",
        "nai_ve",
        "nai_ve_2",
        "re_sume",
        "re_sume_2",
        "zu_rich",
        "zu_rich_2",
        "a_ngstro_m",
        "a_ngstro_m_2",
      ]);
    });
  });

  // ------------------------------------------------------------------
  // 2. Mixed-width characters (halfwidth / fullwidth) must NOT alias ASCII
  // ------------------------------------------------------------------
  describe("mixed-width characters are treated as non-ASCII (no NFKC folding)", () => {
    const FULLWIDTH_AMOUNT = "\uFF21\uFF4D\uFF4F\uFF55\uFF4E\uFF54"; // Ａｍｏｕｎｔ
    const FULLWIDTH_DIGITS = "\uFF12\uFF10\uFF12\uFF16"; // ２０２６
    const HALFWIDTH_KANA = "\uFF76\uFF80\uFF76\uFF85"; // ｶﾀｶﾅ
    const FULLWIDTH_UNDERSCORE = "\uFF3F"; // ＿

    it("fullwidth 'Ａｍｏｕｎｔ' does NOT collide with ASCII 'Amount' (falls back)", () => {
      assertKeys(
        [{ label: "Amount" }, { label: FULLWIDTH_AMOUNT }, { label: "Amount" }],
        ["amount", "column", "amount_2"],
      );
    });

    it("fullwidth digits fall back to 'column' (regression: NFKC would keep them)", () => {
      assertKeys([{ label: FULLWIDTH_DIGITS }], ["column"]);
    });

    it("halfwidth katakana falls back to 'column'", () => {
      assertKeys([{ label: HALFWIDTH_KANA }], ["column"]);
    });

    it("fullwidth underscore is NOT an ASCII underscore — falls back to 'column'", () => {
      assertKeys([{ label: FULLWIDTH_UNDERSCORE }], ["column"]);
    });

    it("mixed-width siblings dedupe positionally under the shared 'column' base", () => {
      assertKeys(
        [
          { label: FULLWIDTH_AMOUNT },
          { label: FULLWIDTH_DIGITS },
          { label: HALFWIDTH_KANA },
          { label: FULLWIDTH_UNDERSCORE },
        ],
        ["column", "column_2", "column_3", "column_4"],
      );
    });

    it("ASCII portion inside a fullwidth-heavy label still drives the slug", () => {
      // Real ASCII 'Q1' embedded in fullwidth wrapping → slug 'q1'.
      assertKeys([{ label: `${FULLWIDTH_AMOUNT} Q1 ${FULLWIDTH_DIGITS}` }], ["q1"]);
    });

    it("labels themselves are preserved code-point-for-code-point in JSON output", () => {
      // Regression: never rewrite the label under NFKC/NFC before emit.
      const labels = jsonLabels([
        { label: FULLWIDTH_AMOUNT },
        { label: HALFWIDTH_KANA },
        { label: FULLWIDTH_DIGITS },
      ]);
      expect(labels[0]).toBe(FULLWIDTH_AMOUNT);
      expect(labels[1]).toBe(HALFWIDTH_KANA);
      expect(labels[2]).toBe(FULLWIDTH_DIGITS);
    });
  });

  // ------------------------------------------------------------------
  // 3. Emoji + diacritic combinations — label preserved, key deterministic
  // ------------------------------------------------------------------
  describe("emoji/diacritic combinations preserve labels and stay key-deterministic", () => {
    const ZWJ_FAMILY = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}"; // 👨‍👩‍👧
    const ROCKET_VS16 = "\u{1F680}\uFE0F"; // 🚀 + VS16
    const THUMB_SKIN = "\u{1F44D}\u{1F3FD}"; // 👍🏽
    const FLAG_US = "\u{1F1FA}\u{1F1F8}"; // 🇺🇸
    const HEART_ON_E = "e\u2764\uFE0F"; // e❤️  (ASCII 'e' + heart)
    const DIACRITIC_ON_EMOJI = "\u{1F680}\u0301"; // 🚀 + combining acute
    const ZWJ_WORD = "e\u200Dmail"; // 'e' + ZWJ + 'mail' — ZWJ stripped

    it("emoji-only labels (ZWJ family, VS16 rocket, skin tone, flag) all fall back to 'column'", () => {
      assertKeys(
        [{ label: ZWJ_FAMILY }, { label: ROCKET_VS16 }, { label: THUMB_SKIN }, { label: FLAG_US }],
        ["column", "column_2", "column_3", "column_4"],
      );
    });

    it("'e❤️' (ASCII 'e' + heart) slugs to 'e', not fallback", () => {
      assertKeys([{ label: HEART_ON_E }], ["e"]);
    });

    it("rocket + combining acute (diacritic on emoji) still falls back to 'column'", () => {
      assertKeys([{ label: DIACRITIC_ON_EMOJI }], ["column"]);
    });

    it("ZWJ between ASCII letters is stripped like any non-[a-z0-9] char", () => {
      // 'e' + ZWJ + 'mail' → 'e_mail' (ZWJ collapses to `_`).
      assertKeys([{ label: ZWJ_WORD }], ["e_mail"]);
    });

    it("emoji + ASCII sibling: ASCII drives one, emoji falls back — deterministic pairing", () => {
      assertKeys(
        [{ label: `${ROCKET_VS16} Launch` }, { label: ROCKET_VS16 }, { label: "Launch" }],
        ["launch", "column", "launch_2"],
      );
    });

    it("emoji + diacritic batch: five rebuilds are byte-identical (CSV + JSON)", () => {
      const input: CsvMetadataInput = {
        source: "R",
        generatedAt: FIXED_DATE,
        columns: [
          { label: ZWJ_FAMILY },
          { label: "café" },
          { label: ROCKET_VS16 },
          { label: "cafe\u0301" },
          { label: THUMB_SKIN },
          { label: HEART_ON_E },
          { label: FLAG_US },
          { label: "Straße" },
          { label: DIACRITIC_ON_EMOJI },
          { label: ZWJ_WORD },
        ],
      };
      const csvBuilds = Array.from({ length: 5 }, () => buildCsvMetadataHeader(input).join("\n"));
      const jsonBuilds = Array.from({ length: 5 }, () =>
        JSON.stringify(buildJsonExportMetadata(input)),
      );
      expect(new Set(csvBuilds).size).toBe(1);
      expect(new Set(jsonBuilds).size).toBe(1);
      // And keys are the regression-pinned list:
      expect(csvKeys(input.columns)).toEqual([
        "column", // ZWJ family
        "caf", // NFC café
        "column_2", // rocket VS16
        "cafe", // NFD café
        "column_3", // thumb + skin
        "e", // e + heart
        "column_4", // US flag
        "stra_e", // Straße
        "column_5", // rocket + combining acute
        "e_mail", // e + ZWJ + mail
      ]);
    });

    it("labels round-trip verbatim (all code points preserved) for emoji entries", () => {
      const labels = jsonLabels([
        { label: ZWJ_FAMILY },
        { label: ROCKET_VS16 },
        { label: THUMB_SKIN },
        { label: FLAG_US },
        { label: DIACRITIC_ON_EMOJI },
      ]);
      expect(labels).toEqual([ZWJ_FAMILY, ROCKET_VS16, THUMB_SKIN, FLAG_US, DIACRITIC_ON_EMOJI]);
    });
  });

  // ------------------------------------------------------------------
  // 4. Combined regression: NFC + NFD + fullwidth + emoji in one batch
  // ------------------------------------------------------------------
  describe("combined batch across all three axes stays deterministic across permutation", () => {
    const combined: CsvMetadataInput["columns"] = [
      { label: "Amount" },
      { label: "\uFF21\uFF4D\uFF4F\uFF55\uFF4E\uFF54" }, // Ａｍｏｕｎｔ → column
      { label: "caf\u00e9" }, // NFC → caf
      { label: "cafe\u0301" }, // NFD → cafe
      { label: "Amount" }, // amount_2
      { label: "\u{1F680}" }, // 🚀 → column_2
      { label: "Café" }, // caf_2
      { label: "\uFF12\uFF10\uFF12\uFF16" }, // ２０２６ → column_3
      { label: "Cafe" }, // cafe_2
    ];
    const expected = [
      "amount",
      "column",
      "caf",
      "cafe",
      "amount_2",
      "column_2",
      "caf_2",
      "column_3",
      "cafe_2",
    ];

    it("exact key list is regression-pinned", () => {
      assertKeys(combined, expected);
    });

    it("byte-identical across 5 rebuilds", () => {
      const builds = Array.from({ length: 5 }, () =>
        JSON.stringify(
          buildJsonExportMetadata({ source: "R", generatedAt: FIXED_DATE, columns: combined }),
        ),
      );
      expect(new Set(builds).size).toBe(1);
    });

    it("every seeded permutation preserves the {base → count} histogram", () => {
      const baseOf = (k: string) => k.replace(/_\d+$/, "");
      const expectedHist: Record<string, number> = {};
      for (const k of expected) {
        const b = baseOf(k);
        expectedHist[b] = (expectedHist[b] ?? 0) + 1;
      }
      for (let seed = 0; seed < 12; seed++) {
        const perm = permute(combined, seed);
        const keys = csvKeys(perm);
        expect(keys).toHaveLength(perm.length);
        expect(new Set(keys).size).toBe(keys.length);
        const hist: Record<string, number> = {};
        for (const k of keys) {
          const b = baseOf(k);
          hist[b] = (hist[b] ?? 0) + 1;
        }
        expect(hist).toEqual(expectedHist);
      }
    });
  });
});
