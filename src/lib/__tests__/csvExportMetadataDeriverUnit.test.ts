/**
 * Focused unit tests for the shared column-key derivation helper
 * (`withDerivedColumnKeys` + `slugifyColumnKey`) that both the CSV
 * metadata header and the JSON envelope call to produce their
 * `# Column keys` / `_meta.columns[].key` sequences.
 *
 * Every other test in this codebase reaches these helpers *through*
 * the metadata builders and their surrounding serialisation. This
 * file targets the helpers DIRECTLY so a regression in the primitive
 * is localised — a failure names the derivation contract, not the
 * writer that noticed the drift.
 *
 * Coverage is split into two sections:
 *
 *   1. `slugifyColumnKey` — the pure label → key transform. Rules
 *      pinned: lowercase, `[^a-z0-9]+` collapses to `_`, leading and
 *      trailing `_` trimmed, `column` fallback when no ASCII alnum
 *      remains. Also documents the intentional non-normalisation of
 *      Unicode (NFC ≠ NFD) and non-transliteration of diacritics.
 *
 *   2. `withDerivedColumnKeys` — the deduping + suffixing layer.
 *      Rules pinned: explicit `{key}` wins base slot; label-only
 *      siblings sharing a base bump `_2`, `_3`, …; the walker must
 *      skip pre-claimed literal `_N` slots; blank labels with an
 *      explicit key use the key as the label; every derived key is
 *      unique; declaration order is preserved. Failure modes throw
 *      `CsvExportMetadataError` with a specific `code` + `columnIndex`.
 */
import { describe, it, expect } from "vitest";
import {
  slugifyColumnKey,
  withDerivedColumnKeys,
  CsvExportMetadataError,
} from "../csvExportMetadata";

describe("slugifyColumnKey — pure label → key transform", () => {
  describe("baseline ASCII slugging", () => {
    it("lowercases", () => expect(slugifyColumnKey("Amount")).toBe("amount"));
    it("collapses non-alnum runs to a single `_`", () =>
      expect(slugifyColumnKey("Sold On")).toBe("sold_on"));
    it("collapses multi-punct runs to one `_`", () =>
      expect(slugifyColumnKey("a + b = c")).toBe("a_b_c"));
    it("trims leading `_`", () => expect(slugifyColumnKey("@user")).toBe("user"));
    it("trims trailing `_`", () => expect(slugifyColumnKey("Amount!!!")).toBe("amount"));
    it("trims both edges", () => expect(slugifyColumnKey("!!!Amount!!!")).toBe("amount"));
    it("preserves internal digits", () =>
      expect(slugifyColumnKey("Q4 2026 Total")).toBe("q4_2026_total"));
    it("preserves ASCII underscore-shaped identifiers verbatim", () =>
      expect(slugifyColumnKey("sold_on")).toBe("sold_on"));
  });

  describe("fallback to 'column' when no ASCII alnum survives", () => {
    it("empty string → 'column'", () => expect(slugifyColumnKey("")).toBe("column"));
    it("whitespace only → 'column'", () => expect(slugifyColumnKey("   \t ")).toBe("column"));
    it("punctuation only → 'column'", () => expect(slugifyColumnKey("!!!")).toBe("column"));
    it("em-dash only → 'column'", () => expect(slugifyColumnKey("—")).toBe("column"));
    it("emoji only → 'column'", () => expect(slugifyColumnKey("💰")).toBe("column"));
    it("CJK only → 'column'", () => expect(slugifyColumnKey("北京")).toBe("column"));
    it("Greek only → 'column'", () => expect(slugifyColumnKey("Ω")).toBe("column"));
  });

  describe("intentional non-normalisation of Unicode", () => {
    // The slugger does NOT normalize NFC↔NFD and does NOT transliterate.
    // These tests PIN that contract so any silent switch to
    // `.normalize("NFD").replace(/\p{M}/gu, "")` fails the suite.
    it("NFC 'café' strips precomposed 'é' whole → 'caf'", () =>
      expect(slugifyColumnKey("caf\u00e9")).toBe("caf"));
    it("NFD 'café' keeps the base 'e', strips the combining mark → 'cafe'", () =>
      expect(slugifyColumnKey("cafe\u0301")).toBe("cafe"));
    it("NFC and NFD forms are DIFFERENT slugs", () =>
      expect(slugifyColumnKey("caf\u00e9")).not.toBe(slugifyColumnKey("cafe\u0301")));
    it("German ß lower-cases to ß (not 'ss') then is stripped → 'stra_e'", () =>
      expect(slugifyColumnKey("Stra\u00dfe")).toBe("stra_e"));
  });

  describe("determinism", () => {
    it("is a pure function: three calls return the same string", () => {
      const s = "Amount 💰 (net) — 2026";
      expect(slugifyColumnKey(s)).toBe(slugifyColumnKey(s));
      expect(slugifyColumnKey(s)).toBe(slugifyColumnKey(s));
    });
    it("output has no leading or trailing `_` after any input", () => {
      for (const s of ["_amount_", "___", "!!!", "  a  ", "💰 x 💰", "北京"]) {
        const out = slugifyColumnKey(s);
        expect(out.startsWith("_"), `"${s}" → "${out}"`).toBe(false);
        expect(out.endsWith("_"), `"${s}" → "${out}"`).toBe(false);
      }
    });
    it("output has no consecutive `__` runs after any input", () => {
      for (const s of ["a   b", "a!!!b", "a💰🚀b", "a — b", "a\t\tb"]) {
        expect(slugifyColumnKey(s)).not.toMatch(/__/);
      }
    });
  });
});

describe("withDerivedColumnKeys — dedup + suffix orchestration", () => {
  describe("no collisions: keys mirror slugified labels 1:1", () => {
    it("plain string entries slugify positionally", () => {
      expect(withDerivedColumnKeys(["Amount", "Sold On", "Client Name"])).toEqual([
        { key: "amount", label: "Amount" },
        { key: "sold_on", label: "Sold On" },
        { key: "client_name", label: "Client Name" },
      ]);
    });
    it("mixed string + {label} + {key,label} entries all work", () => {
      expect(
        withDerivedColumnKeys([
          "Amount",
          { label: "Sold On" },
          { key: "pid", label: "Project ID" },
        ]),
      ).toEqual([
        { key: "amount", label: "Amount" },
        { key: "sold_on", label: "Sold On" },
        { key: "pid", label: "Project ID" },
      ]);
    });
  });

  describe("collision chain: base, base_2, base_3, …", () => {
    it("two identical labels → base + base_2", () => {
      const out = withDerivedColumnKeys([{ label: "Amount" }, { label: "Amount" }]);
      expect(out.map((c) => c.key)).toEqual(["amount", "amount_2"]);
    });
    it("five identical labels → base, _2, _3, _4, _5", () => {
      const out = withDerivedColumnKeys(Array.from({ length: 5 }, () => ({ label: "Amount" })));
      expect(out.map((c) => c.key)).toEqual([
        "amount",
        "amount_2",
        "amount_3",
        "amount_4",
        "amount_5",
      ]);
    });
    it("case-insensitive: Amount / amount / AMOUNT collide", () => {
      const out = withDerivedColumnKeys([
        { label: "Amount" },
        { label: "amount" },
        { label: "AMOUNT" },
      ]);
      expect(out.map((c) => c.key)).toEqual(["amount", "amount_2", "amount_3"]);
      // Labels are preserved verbatim — only KEYS collapse.
      expect(out.map((c) => c.label)).toEqual(["Amount", "amount", "AMOUNT"]);
    });
    it("punctuation variants collide onto same base", () => {
      const out = withDerivedColumnKeys([
        { label: "Amount" },
        { label: "amount!" },
        { label: "AMOUNT?" },
      ]);
      expect(out.map((c) => c.key)).toEqual(["amount", "amount_2", "amount_3"]);
    });
  });

  describe("explicit key wins base slot", () => {
    it("explicit before label: explicit gets base, sibling shifts to _2", () => {
      const out = withDerivedColumnKeys([{ key: "amount", label: "Cash" }, { label: "Amount" }]);
      expect(out.map((c) => c.key)).toEqual(["amount", "amount_2"]);
    });
    it("label before explicit: label gets base, explicit shifts to _2 (declaration order wins)", () => {
      const out = withDerivedColumnKeys([{ label: "Amount" }, { key: "amount", label: "Cash" }]);
      expect(out.map((c) => c.key)).toEqual(["amount", "amount_2"]);
    });
    it("two explicit + one label: chain is base, _2, _3 in declaration order", () => {
      const out = withDerivedColumnKeys([
        { key: "amount", label: "Cash" },
        { key: "amount", label: "Bank" },
        { label: "Amount" },
      ]);
      expect(out.map((c) => c.key)).toEqual(["amount", "amount_2", "amount_3"]);
    });
  });

  describe("literal `_N` slot collision — walker must skip pre-claimed slots", () => {
    it("[Amount, amount!, amount_2] → base bumps past the literal `_2`", () => {
      const out = withDerivedColumnKeys([
        { label: "Amount" },
        { label: "amount!" },
        { label: "amount_2" },
      ]);
      expect(out.map((c) => c.key)).toEqual(["amount", "amount_2", "amount_2_2"]);
    });
    it("literal `_2` first, then two 'Amount' siblings → literal, base, _3", () => {
      const out = withDerivedColumnKeys([
        { label: "amount_2" },
        { label: "Amount" },
        { label: "Amount" },
      ]);
      expect(out.map((c) => c.key)).toEqual(["amount_2", "amount", "amount_3"]);
    });
  });

  describe("blank label with explicit key uses the key as the label", () => {
    it("whitespace-only label falls back to explicit key as label", () => {
      const out = withDerivedColumnKeys([{ key: "amount", label: "   " }]);
      expect(out).toEqual([{ key: "amount", label: "amount" }]);
    });
  });

  describe("unicode / emoji / non-Latin dedupe onto the shared 'column' base", () => {
    it("three symbol-only labels dedupe as column / column_2 / column_3", () => {
      const out = withDerivedColumnKeys([{ label: "💰" }, { label: "北京" }, { label: "—" }]);
      expect(out.map((c) => c.key)).toEqual(["column", "column_2", "column_3"]);
    });
  });

  describe("universal invariants for any well-formed input", () => {
    const inputs: Array<Parameters<typeof withDerivedColumnKeys>[0]> = [
      ["Amount", "Sold Date"],
      [{ label: "A" }, { label: "A" }, { label: "A" }],
      [{ key: "amount", label: "Cash" }, { label: "Amount" }, { label: "amount_2" }],
      [{ label: "💰" }, { label: "🚀" }, { label: "amount" }],
      [{ label: "café" }, { label: "cafe\u0301" }, { label: "Cafe" }],
    ];
    it("every derived key is non-empty", () => {
      for (const cols of inputs)
        for (const { key } of withDerivedColumnKeys(cols)) expect(key.length).toBeGreaterThan(0);
    });
    it("every derived key is unique per call", () => {
      for (const cols of inputs) {
        const keys = withDerivedColumnKeys(cols).map((c) => c.key);
        expect(new Set(keys).size).toBe(keys.length);
      }
    });
    it("output length equals input length (no drops, no additions)", () => {
      for (const cols of inputs) expect(withDerivedColumnKeys(cols).length).toBe(cols.length);
    });
    it("declaration order is preserved", () => {
      // Sanity: the FIRST occurrence of every base gets the bare
      // slot; later occurrences get suffixed. Verified by asserting
      // the emitted key at position 0 has no `_N` suffix for a
      // label-only case with unique labels.
      const out = withDerivedColumnKeys(["Alpha", "Beta", "Gamma"]);
      expect(out.map((c) => c.key)).toEqual(["alpha", "beta", "gamma"]);
    });
    it("is a pure function: three calls on the same input return equal output", () => {
      const cols: Parameters<typeof withDerivedColumnKeys>[0] = [
        { label: "Amount" },
        { label: "Amount" },
        { key: "amount", label: "Cash" },
      ];
      const a = withDerivedColumnKeys(cols);
      const b = withDerivedColumnKeys(cols);
      const c = withDerivedColumnKeys(cols);
      expect(a).toEqual(b);
      expect(b).toEqual(c);
    });
  });

  describe("failure modes throw CsvExportMetadataError with a specific code + columnIndex", () => {
    it("null entry → 'empty-column-entry' at the offending index", () => {
      let caught: unknown;
      try {
        withDerivedColumnKeys([{ label: "OK" }, null as never, { label: "OK2" }]);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CsvExportMetadataError);
      expect((caught as CsvExportMetadataError).code).toBe("empty-column-entry");
      expect((caught as CsvExportMetadataError).columnIndex).toBe(1);
    });
    it("blank label + no explicit key → 'empty-column-label'", () => {
      let caught: unknown;
      try {
        withDerivedColumnKeys([{ label: "" }]);
      } catch (e) {
        caught = e;
      }
      expect((caught as CsvExportMetadataError).code).toBe("empty-column-label");
      expect((caught as CsvExportMetadataError).columnIndex).toBe(0);
    });
    it("whitespace-only label + no explicit key → 'empty-column-label'", () => {
      let caught: unknown;
      try {
        withDerivedColumnKeys([{ label: "   " }]);
      } catch (e) {
        caught = e;
      }
      expect((caught as CsvExportMetadataError).code).toBe("empty-column-label");
    });
    it("explicit key present but whitespace-only → 'empty-column-key'", () => {
      let caught: unknown;
      try {
        withDerivedColumnKeys([{ key: "   ", label: "Amount" }]);
      } catch (e) {
        caught = e;
      }
      expect((caught as CsvExportMetadataError).code).toBe("empty-column-key");
      expect((caught as CsvExportMetadataError).columnIndex).toBe(0);
    });
    it("first offender wins: multiple bad entries throw for the first one", () => {
      let caught: unknown;
      try {
        withDerivedColumnKeys([
          { label: "OK" },
          { label: "" }, // index 1 — should throw here
          null as never, // index 2 — never reached
        ]);
      } catch (e) {
        caught = e;
      }
      expect((caught as CsvExportMetadataError).code).toBe("empty-column-label");
      expect((caught as CsvExportMetadataError).columnIndex).toBe(1);
    });
  });
});
