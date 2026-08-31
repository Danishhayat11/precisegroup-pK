/**
 * Locks in that emoji and special symbols in column labels are
 * slugified and deduped by the SAME rules as ASCII punctuation —
 * they're just more non-alphanumeric characters to `[^a-z0-9]+`. The
 * suffixing chain (`base`, `base_2`, `base_3`, …), the "explicit key
 * wins base slot" rule, and the "literal-suffix collision bumps past
 * the used slot" rule must behave identically whether the collapsed
 * characters are `!!!`, `💰`, `▲→`, or any mix of the three.
 *
 * Also proves the symbol-only fallback path (`column`) is shared with
 * ASCII-punctuation-only labels and non-Latin scripts — i.e. `"!!!"`,
 * `"💰"`, `"▲"`, and `"北京"` all collapse to the same `column` base
 * and dedupe positionally against each other. Companion coverage to
 * `csvExportMetadataUnicodeSlugDeterminism.test.ts` (diacritics /
 * NFC-NFD) and `csvExportMetadataPunctuation.test.ts` (ASCII-only).
 */
import { describe, it, expect } from "vitest";
import {
  buildCsvMetadataHeader,
  buildJsonExportMetadata,
  type CsvMetadataInput,
} from "../csvExportMetadata";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

function csvKeys(columns: CsvMetadataInput["columns"]): string[] {
  const line = buildCsvMetadataHeader({ source: "X", generatedAt: FIXED_DATE, columns }).find((l) =>
    l.startsWith("# Column keys:"),
  );
  return line ? line.replace("# Column keys: ", "").split(",") : [];
}

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

describe("emoji + special-symbol slugification parity with ASCII punctuation", () => {
  describe("single-label slug outputs (emoji/symbols are inert to the slugger)", () => {
    const cases: Array<{ label: string; key: string; note: string }> = [
      { label: "Amount 💰", key: "amount", note: "trailing emoji stripped like trailing '!!!'" },
      { label: "💰 Amount", key: "amount", note: "leading emoji stripped like leading '!!!'" },
      { label: "Amount 💰 Total", key: "amount_total", note: "internal emoji collapses to '_'" },
      { label: "🚀 Launch 2026", key: "launch_2026", note: "digits survive, emoji stripped" },
      { label: "A & B", key: "a_b", note: "ampersand behaves like other punctuation" },
      { label: "100%", key: "100", note: "trailing symbol trimmed, digits kept" },
      { label: "@user", key: "user", note: "leading @ trimmed" },
      { label: "$USD", key: "usd", note: "$ stripped, lower-cased" },
      { label: "#tag", key: "tag", note: "# stripped, base survives" },
      { label: "(pending)", key: "pending", note: "parens trimmed to edges" },
      { label: "a+b=c", key: "a_b_c", note: "internal symbols collapse like '_'" },
    ];
    for (const { label, key, note } of cases) {
      it(`"${label}" → "${key}" (${note})`, () => assertKeys([{ label }], [key]));
    }
  });

  describe("symbol-only labels fall back to 'column' (shared with ASCII punct + non-Latin)", () => {
    it("single emoji-only label → 'column'", () => {
      assertKeys([{ label: "💰" }], ["column"]);
    });
    it("multiple emojis / geometric shapes / arrows all collapse to 'column'", () => {
      assertKeys(
        [{ label: "💰" }, { label: "🚀🚀" }, { label: "▲" }, { label: "→" }, { label: "•" }],
        ["column", "column_2", "column_3", "column_4", "column_5"],
      );
    });
    it("emoji-only + ASCII-punct-only + em-dash + CJK all share the 'column' base", () => {
      // Parity with the ASCII-punct fallback proven in
      // csvExportMetadataPunctuation.test.ts — the dedupe chain
      // interleaves them positionally.
      assertKeys(
        [{ label: "!!!" }, { label: "💰" }, { label: "—" }, { label: "北京" }, { label: "???" }],
        ["column", "column_2", "column_3", "column_4", "column_5"],
      );
    });
  });

  describe("emoji collisions dedupe with the SAME suffix chain as ASCII punctuation", () => {
    it("'Amount' + 'Amount 💰' + 'Amount!!!' → amount / amount_2 / amount_3", () => {
      // Emoji-suffixed, punct-suffixed, and bare all slug to `amount`.
      assertKeys(
        [{ label: "Amount" }, { label: "Amount 💰" }, { label: "Amount!!!" }],
        ["amount", "amount_2", "amount_3"],
      );
    });
    it("'💰 Amount' + 'Amount 🚀' + 'AMOUNT' → amount / amount_2 / amount_3", () => {
      assertKeys(
        [{ label: "💰 Amount" }, { label: "Amount 🚀" }, { label: "AMOUNT" }],
        ["amount", "amount_2", "amount_3"],
      );
    });
    it("five emoji-decorated 'Amount' siblings → amount, _2, _3, _4, _5", () => {
      assertKeys(
        [
          { label: "Amount" },
          { label: "Amount 💰" },
          { label: "Amount 🚀" },
          { label: "Amount ✨" },
          { label: "Amount 🎯" },
        ],
        ["amount", "amount_2", "amount_3", "amount_4", "amount_5"],
      );
    });
  });

  describe("explicit-key rules survive when siblings carry emoji", () => {
    it("explicit 'amount' wins base slot over a colliding 'Amount 💰' label", () => {
      assertKeys(
        [{ key: "amount", label: "Cash 💰" }, { label: "Amount 💰" }],
        ["amount", "amount_2"],
      );
    });
    it("label first, later explicit 'amount' shifts to _2 (emoji doesn't change ordering)", () => {
      assertKeys(
        [{ label: "Amount 💰" }, { key: "amount", label: "Cash 🚀" }],
        ["amount", "amount_2"],
      );
    });
    it("two explicit 'amount' + one emoji-decorated 'Amount' → base, _2, _3", () => {
      assertKeys(
        [
          { key: "amount", label: "Cash 💰" },
          { key: "amount", label: "Bank 🏦" },
          { label: "Amount 🚀" },
        ],
        ["amount", "amount_2", "amount_3"],
      );
    });
  });

  describe("literal-suffix collision: an emoji label doesn't hide a literal _2", () => {
    it("['Amount', 'Amount 💰', 'amount_2'] → base bumps past the literal", () => {
      // Direct parity with the ASCII case
      // ['Amount', 'amount!', 'amount_2'] documented in the parity
      // suite: the deduper must skip the used `amount_2` slot even
      // when the colliding sibling label is emoji-decorated.
      assertKeys(
        [{ label: "Amount" }, { label: "Amount 💰" }, { label: "amount_2" }],
        ["amount", "amount_2", "amount_2_2"],
      );
    });
    it("['amount_2', 'Amount', 'Amount 🚀'] → literal claims _2 first, then base + _3", () => {
      assertKeys(
        [{ label: "amount_2" }, { label: "Amount" }, { label: "Amount 🚀" }],
        ["amount_2", "amount", "amount_3"],
      );
    });
  });

  describe("mixed emoji + ASCII punctuation in the same list", () => {
    it("emoji-only, punct-only, and named siblings interleave deterministically", () => {
      assertKeys(
        [
          { label: "Amount" }, // amount
          { label: "!!!" }, // column
          { label: "💰" }, // column_2
          { label: "amount!" }, // amount_2
          { label: "▲" }, // column_3
          { label: "Amount 🚀" }, // amount_3
        ],
        ["amount", "column", "column_2", "amount_2", "column_3", "amount_3"],
      );
    });
  });

  describe("ZWJ / VS-16 emoji sequences and skin-tone modifiers stay in the 'column' fallback", () => {
    // Compound emoji (family, professions, gender/skin-tone modifiers)
    // still contain zero [a-z0-9] code points, so they must fall back
    // to `column` regardless of length or code-point count.
    it("family 👨‍👩‍👧 (ZWJ sequence) → 'column'", () => {
      assertKeys([{ label: "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}" }], ["column"]);
    });
    it("waving-hand + skin tone 👋🏽 → 'column'", () => {
      assertKeys([{ label: "\u{1F44B}\u{1F3FD}" }], ["column"]);
    });
    it("keycap 1️⃣ (digit + VS-16 + combining keycap) → '1' (base digit survives)", () => {
      // The base ASCII digit `1` DOES survive the slugger — this is
      // the emoji equivalent of `"100%" → "100"`. Locks in the rule.
      assertKeys([{ label: "1\uFE0F\u20E3" }], ["1"]);
    });
    it("three ZWJ compound emoji + one keycap-1 → column, column_2, column_3, 1", () => {
      assertKeys(
        [
          { label: "\u{1F468}\u200D\u{1F4BB}" }, // 👨‍💻
          { label: "\u{1F469}\u200D\u{1F3EB}" }, // 👩‍🏫
          { label: "\u{1F9D1}\u200D\u{1F373}" }, // 🧑‍🍳
          { label: "1\uFE0F\u20E3" }, // 1️⃣
        ],
        ["column", "column_2", "column_3", "1"],
      );
    });
  });

  describe("determinism: repeat builds are byte-identical for emoji-heavy inputs", () => {
    const input: CsvMetadataInput = {
      source: "Emoji Stability",
      generatedAt: FIXED_DATE,
      columns: [
        { label: "Amount 💰" },
        { label: "Amount 🚀" },
        { label: "Amount ✨" },
        { label: "💰" },
        { label: "🚀🚀" },
        { label: "▲" },
        { label: "→" },
        { label: "!!!" },
        { label: "amount_2" },
        { key: "amount", label: "Cash 💰" },
      ],
    };
    it("CSV output is byte-identical across three builds", () => {
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
    it("CSV and JSON emit identical key sequences (writer parity for emoji inputs)", () => {
      expect(csvKeys(input.columns)).toEqual(jsonKeys(input.columns));
    });
    it("every derived key is unique across the emoji-heavy list", () => {
      const keys = csvKeys(input.columns);
      expect(keys).toHaveLength(input.columns!.length);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  describe("labels ARE preserved verbatim (only KEYS are slugged)", () => {
    // The CSV `# Columns (n, in order):` line and the JSON `label`
    // field must carry the original emoji-decorated label untouched,
    // even though the derived key strips all non-ASCII.
    it("emoji labels round-trip byte-identically in both formats", () => {
      const columns: CsvMetadataInput["columns"] = [
        { label: "Amount 💰" },
        { label: "🚀 Launch 2026" },
        { label: "👨‍👩‍👧 Family" },
      ];
      const csvLine = buildCsvMetadataHeader({
        source: "X",
        generatedAt: FIXED_DATE,
        columns,
      }).find((l) => l.startsWith("# Columns ("));
      const csvLabels = csvLine!.replace(/^# Columns \(\d+, in order\): /, "").split(" | ");
      const jsonLabels = (
        buildJsonExportMetadata({ source: "X", generatedAt: FIXED_DATE, columns })
          .columns as Array<{ label: string }>
      ).map((c) => c.label);
      expect(csvLabels).toEqual(["Amount 💰", "🚀 Launch 2026", "👨‍👩‍👧 Family"]);
      expect(jsonLabels).toEqual(csvLabels);
    });
  });
});
