/**
 * Determinism suite for `slugifyColumnKey` — the single derived-key
 * primitive shared by the CSV metadata header and the JSON export
 * envelope. This suite pins THREE axes of the contract:
 *
 *   1. Whitespace variants (ASCII spaces/tabs/newlines, runs of
 *      whitespace, leading/trailing/interior, plus a curated set of
 *      Unicode whitespace codepoints) all collapse to the SAME slug.
 *   2. Unicode punctuation (em/en dashes, smart quotes, ellipsis,
 *      middle dot, fullwidth punctuation, math symbols) is treated as
 *      non-alphanumeric and collapses identically to ASCII punctuation.
 *   3. Mixed casing (upper / lower / TitleCase / sPoNgEbOb / all-caps)
 *      of the same underlying letters produces one identical slug.
 *
 * Determinism means, concretely:
 *   • Same input string → same output string, byte-for-byte, across
 *     repeated invocations (idempotence + no hidden state).
 *   • Inputs that differ ONLY by the axes above → identical slug.
 *   • Slug is stable under re-slugifying (`slug(slug(x)) === slug(x)`).
 *   • Slug is a subset of `[a-z0-9_]` with no leading/trailing `_` and
 *     never empty (falls back to `"column"`).
 *
 * These invariants intentionally overlap with the existing Unicode
 * determinism / punctuation suites — this file is the axis-focused
 * canary that fails FAST and points at exactly which axis regressed
 * when someone swaps in a third-party slugifier or adds Unicode
 * normalisation upstream of the primitive.
 */

import { describe, expect, it } from "vitest";
import { slugifyColumnKey } from "../csvExportMetadata";

const SLUG_ALPHABET = /^[a-z0-9_]+$/;

function assertWellFormed(slug: string) {
  expect(slug.length).toBeGreaterThan(0);
  expect(slug).toMatch(SLUG_ALPHABET);
  expect(slug.startsWith("_")).toBe(false);
  expect(slug.endsWith("_")).toBe(false);
}

describe("slugifyColumnKey — determinism", () => {
  describe("idempotence + repeatability", () => {
    it("returns byte-identical output on repeated calls (no hidden state)", () => {
      const inputs = [
        "Model Name",
        "  spaced  ",
        "UPPER_lower",
        "café — résumé",
        "hello…world",
        "",
        "———",
        "\t\ttabs\t\t",
      ];
      for (const input of inputs) {
        const first = slugifyColumnKey(input);
        for (let i = 0; i < 25; i++) {
          expect(slugifyColumnKey(input)).toBe(first);
        }
      }
    });

    it("is a fixed-point: slug(slug(x)) === slug(x) for arbitrary inputs", () => {
      const inputs = [
        "Model Name",
        "  Prompt   Tokens  ",
        "user.id",
        "COST ($)",
        "café",
        "───",
        "\u3000fullwidth\u3000space",
        "MiXeD_CaSe_123",
      ];
      for (const input of inputs) {
        const once = slugifyColumnKey(input);
        const twice = slugifyColumnKey(once);
        expect(twice).toBe(once);
      }
    });
  });

  describe("whitespace axis", () => {
    // All of these should collapse to the SAME slug as the plain
    // single-space form. Includes ASCII whitespace and a curated set
    // of Unicode whitespace codepoints treated as non-alphanumeric.
    const whitespaceVariants: Array<[string, string]> = [
      ["single space", "prompt tokens"],
      ["multiple spaces", "prompt   tokens"],
      ["leading space", "   prompt tokens"],
      ["trailing space", "prompt tokens   "],
      ["leading + trailing", "   prompt tokens   "],
      ["tab separator", "prompt\ttokens"],
      ["newline separator", "prompt\ntokens"],
      ["CRLF separator", "prompt\r\ntokens"],
      ["mixed whitespace run", "prompt \t \n tokens"],
      ["NBSP separator (U+00A0)", "prompt\u00A0tokens"],
      ["EN QUAD (U+2000)", "prompt\u2000tokens"],
      ["EM SPACE (U+2003)", "prompt\u2003tokens"],
      ["THIN SPACE (U+2009)", "prompt\u2009tokens"],
      ["IDEOGRAPHIC SPACE (U+3000)", "prompt\u3000tokens"],
      ["LINE SEPARATOR (U+2028)", "prompt\u2028tokens"],
      ["PARAGRAPH SEPARATOR (U+2029)", "prompt\u2029tokens"],
    ];

    const expected = "prompt_tokens";

    it.each(whitespaceVariants)("collapses %s to the canonical slug", (_label, input) => {
      const slug = slugifyColumnKey(input);
      assertWellFormed(slug);
      expect(slug).toBe(expected);
    });

    it("all whitespace variants produce EXACTLY one distinct slug", () => {
      const slugs = new Set(whitespaceVariants.map(([, v]) => slugifyColumnKey(v)));
      expect(slugs.size).toBe(1);
      expect([...slugs][0]).toBe(expected);
    });

    it("whitespace-only labels fall back to `column`", () => {
      const inputs = [" ", "   ", "\t\t\t", "\n\n", "\r\n \t", "\u00A0\u2003\u3000"];
      for (const input of inputs) {
        expect(slugifyColumnKey(input)).toBe("column");
      }
    });
  });

  describe("unicode punctuation axis", () => {
    // All of these should collapse to the SAME slug as an ASCII
    // hyphen-separated form — punctuation is treated as non-alnum
    // and runs collapse to a single `_`.
    const punctuationVariants: Array<[string, string]> = [
      ["ASCII hyphen", "input-tokens"],
      ["ASCII underscore", "input_tokens"],
      ["ASCII dot", "input.tokens"],
      ["ASCII slash", "input/tokens"],
      ["ASCII pipe", "input|tokens"],
      ["ASCII colon", "input:tokens"],
      ["EN DASH (U+2013)", "input\u2013tokens"],
      ["EM DASH (U+2014)", "input\u2014tokens"],
      ["HORIZONTAL BAR (U+2015)", "input\u2015tokens"],
      ["MINUS SIGN (U+2212)", "input\u2212tokens"],
      ["MIDDLE DOT (U+00B7)", "input\u00B7tokens"],
      ["BULLET (U+2022)", "input\u2022tokens"],
      ["FULLWIDTH SOLIDUS (U+FF0F)", "input\uFF0Ftokens"],
      ["FULLWIDTH COLON (U+FF1A)", "input\uFF1Atokens"],
      ["LEFT DOUBLE QUOTE (U+201C)+RIGHT (U+201D)", "\u201Cinput\u201D\u2014tokens"],
      ["ELLIPSIS (U+2026)", "input\u2026tokens"],
      ["mixed punctuation run", "input—…·/tokens"],
    ];

    const expected = "input_tokens";

    it.each(punctuationVariants)("collapses %s runs to a single `_`", (_label, input) => {
      const slug = slugifyColumnKey(input);
      assertWellFormed(slug);
      expect(slug).toBe(expected);
    });

    it("all unicode-punctuation variants produce EXACTLY one distinct slug", () => {
      const slugs = new Set(punctuationVariants.map(([, v]) => slugifyColumnKey(v)));
      expect(slugs.size).toBe(1);
      expect([...slugs][0]).toBe(expected);
    });

    it("punctuation-only labels fall back to `column`", () => {
      const inputs = ["—", "———", "…", "•·•", "\u201C\u201D", "//--..::"];
      for (const input of inputs) {
        expect(slugifyColumnKey(input)).toBe("column");
      }
    });
  });

  describe("mixed casing axis", () => {
    // Every casing permutation of the same ASCII letters must produce
    // the same slug — lowercase happens before the non-alnum collapse.
    const casingVariants: Array<[string, string]> = [
      ["all lower", "model name"],
      ["all upper", "MODEL NAME"],
      ["Title Case", "Model Name"],
      ["camelCase (joined)", "modelName"], // no separator → single token
      ["PascalCase (joined)", "ModelName"],
      ["sPoNgEbOb", "mOdEl nAmE"],
      ["random caps", "MoDEL nAME"],
    ];

    it("case-only differences on separated labels produce one slug", () => {
      const separated = casingVariants.filter(([, v]) => /\s/.test(v));
      const slugs = new Set(separated.map(([, v]) => slugifyColumnKey(v)));
      expect(slugs.size).toBe(1);
      expect([...slugs][0]).toBe("model_name");
    });

    it("case-only differences on joined labels (no separator) produce one slug", () => {
      const joined = ["modelname", "MODELNAME", "ModelName", "modelName", "MoDeLnAmE"];
      const slugs = new Set(joined.map((v) => slugifyColumnKey(v)));
      expect(slugs.size).toBe(1);
      expect([...slugs][0]).toBe("modelname");
    });

    it.each(casingVariants)("well-formed slug for %s", (_label, input) => {
      assertWellFormed(slugifyColumnKey(input));
    });
  });

  describe("all three axes combined", () => {
    // Whitespace + Unicode punctuation + mixed casing on the same
    // underlying label all collapse to one canonical slug.
    it("case × whitespace × unicode-punctuation collide on one slug", () => {
      const inputs = [
        "Cost ($) - Total",
        "cost ($) - total",
        "COST ($) - TOTAL",
        "  Cost   ($)   —   Total  ",
        "cost\t($)\u2014total",
        "Cost\u00A0($)\u2013Total",
        "cost\u3000($)\u2015total",
      ];
      const slugs = new Set(inputs.map(slugifyColumnKey));
      expect(slugs.size).toBe(1);
      const [only] = [...slugs];
      assertWellFormed(only);
      expect(only).toBe("cost_total");
    });

    it("input ordering does not affect per-input slugs (no shared state)", () => {
      const inputs = [
        "Foo Bar",
        "  foo—bar  ",
        "FOO\u00A0BAR",
        "foo…bar",
        "foo\tBAR",
        "FoO\u2003bAr",
      ];
      const forward = inputs.map(slugifyColumnKey);
      const reverse = [...inputs].reverse().map(slugifyColumnKey).reverse();
      expect(forward).toEqual(reverse);
      expect(new Set(forward).size).toBe(1);
    });
  });
});
