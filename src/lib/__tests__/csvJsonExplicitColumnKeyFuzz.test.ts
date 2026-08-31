/**
 * Fuzz: explicit `columns[i].key` values must appear byte-for-byte in the
 * JSON metadata envelope produced by `buildJsonExportMetadata`, no matter
 * what characters they contain — including CSV-hostile ones (`"`, `,`,
 * `|`), whitespace controls (`\t`, `\n`, `\r`), backslashes, unicode, and
 * combining marks.
 *
 * Why this matters: the CSV `# Column keys:` line is comma-separated and
 * mangles some of these characters, but the JSON envelope has no such
 * excuse — a `key` string goes in, the *same* string must come out on
 * `envelope.columns[i].key`, and a `JSON.stringify → JSON.parse` round
 * trip must return it verbatim. Any silent transformation here breaks
 * downstream consumers that key on the original string (analytics
 * pipelines, replayers, snapshot diffs).
 *
 * The test is a property-style fuzz: we generate ~600 explicit keys from
 * a broad character alphabet, assert each survives verbatim, then run
 * targeted spot-checks for the CSV-hostile characters the user called
 * out (`"`, `|`, `\t`, `\\`) so regressions on those specific chars fail
 * with a legible message instead of hiding inside the fuzz batch.
 */
import { describe, it, expect } from "vitest";
import { buildJsonExportMetadata, type CsvMetadataInput } from "../csvExportMetadata";

// ---------------------------------------------------------------------------
// Deterministic PRNG so failures are reproducible from the seed alone.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pickInt(rand: () => number, lo: number, hi: number): number {
  return Math.floor(rand() * (hi - lo + 1)) + lo;
}

// Character alphabet — deliberately loaded with the "should be preserved
// verbatim" set. Whitespace-only keys aren't tested because
// `withDerivedColumnKeys` intentionally rejects those (empty-key error);
// every generated key here has at least one non-whitespace anchor char.
const FUZZ_CHARS = [
  '"',
  "'",
  "`",
  "|",
  ",",
  ";",
  ":",
  "=",
  "*",
  "?",
  "!",
  "#",
  "%",
  "&",
  "<",
  ">",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "/",
  "\\",
  "\t",
  "\n",
  "\r",
  " ",
  "  ",
  "a",
  "b",
  "z",
  "0",
  "9",
  "_",
  "-",
  ".",
  "+",
  "é",
  "ñ",
  "π",
  "汉",
  "🎯",
  "\u200b" /* zero-width space */,
  "\u0301" /* combining acute */,
];

function makeFuzzKey(rand: () => number, i: number): string {
  const len = pickInt(rand, 1, 12);
  let s = "";
  for (let j = 0; j < len; j++) s += FUZZ_CHARS[Math.floor(rand() * FUZZ_CHARS.length)];
  // Anchor with `k{i}_` at the start AND `_z` at the end so the key has
  // non-whitespace boundaries — the builder INTENTIONALLY trims outer
  // whitespace off explicit keys (documented in `withDerivedColumnKeys`),
  // which isn't the invariant this fuzz measures. INNER whitespace and
  // every other exotic char must still survive verbatim.
  return `k${i}_${s}_z`;
}

import { runWithBudget } from "./support/csvFuzzBudget";

// ---------------------------------------------------------------------------
describe("explicit column keys — fuzz preserves every character verbatim in JSON", () => {
  it("≥300 fuzzed keys survive buildJsonExportMetadata + JSON round-trip byte-for-byte under budget", () => {
    const SEED = 0x12345678;
    // Determinism floor: 300 columns still covers every char in
    // FUZZ_CHARS in expectation (300 × 12 chars ≈ 3.6k draws). The
    // budget loop scales this up on faster machines.
    const MIN_ITERATIONS = 300;
    const BUDGET_MS = 500;

    const res = runWithBudget({
      name: "explicit-column-key-fuzz",
      minIterations: MIN_ITERATIONS,
      budgetMs: BUDGET_MS,
      run: (i) => {
        // Each iteration = one full metadata round-trip on ONE key.
        // Keeping the batch size at 1 makes the perf budget meaningful:
        // one iteration ≈ one buildJsonExportMetadata + stringify+parse.
        const rand = mulberry32(SEED ^ (i + 1));
        const key = makeFuzzKey(rand, i);
        const input: CsvMetadataInput = {
          source: "Fuzz",
          columns: [{ key, label: `Column ${i}` }],
        };
        const json = buildJsonExportMetadata(input);
        const got = json.columns![0]!.key;
        if (got !== key) {
          const gotHex = [...got].map((c) => c.charCodeAt(0).toString(16)).join(" ");
          const wantHex = [...key].map((c) => c.charCodeAt(0).toString(16)).join(" ");
          throw new Error(
            `iter=${i} key mismatch (seed=${SEED.toString(16)})\n  want=${JSON.stringify(key)} [${wantHex}]\n  got =${JSON.stringify(got)} [${gotHex}]`,
          );
        }
        expect(json.columns![0]!.order).toBe(0);
        const roundTripped = JSON.parse(JSON.stringify(json)) as typeof json;
        expect(roundTripped.columns![0]!.key, `iter=${i} JSON round-trip`).toBe(key);
      },
    });
    expect(res.ranIterations).toBeGreaterThanOrEqual(MIN_ITERATIONS);
  });

  // Targeted spot-checks for the user-called-out characters. Each one
  // fails with a specific, greppable name instead of hiding inside the
  // fuzz batch above.
  const CALLED_OUT: Array<{ label: string; key: string }> = [
    { label: "double quote", key: 'has"quote' },
    { label: "single quote", key: "has'quote" },
    { label: "pipe", key: "col|pipe" },
    { label: "tab", key: "col\tab" },
    { label: "backslash", key: "col\\back\\slash" },
    { label: "comma", key: "a,b,c" },
    { label: "newline", key: "line1\nline2" },
    { label: "carriage return", key: "cr\rhere" },
    { label: "CRLF pair", key: "crlf\r\npair" },
    { label: "escaped quote sequence", key: 'a\\"b' },
    { label: "backslash-n literal", key: "not\\na\\newline" },
    { label: "unicode emoji", key: "col🎯end" },
    { label: "combining accent", key: "e\u0301end" },
    { label: "mixed CSV-hostile", key: 'a",|\t\\b' },
  ];

  it.each(CALLED_OUT)(
    "explicit key with $label round-trips through JSON envelope verbatim",
    ({ key }) => {
      const input: CsvMetadataInput = {
        source: "S",
        columns: [{ key, label: "L" }],
      };
      const json = buildJsonExportMetadata(input);
      expect(json.columns![0]!.key).toBe(key);
      const roundTripped = JSON.parse(JSON.stringify(json)) as typeof json;
      expect(roundTripped.columns![0]!.key).toBe(key);
      // Order is stable at 0 for a single-column envelope.
      expect(json.columns![0]!.order).toBe(0);
      expect(roundTripped.columns![0]!.order).toBe(0);
    },
  );

  // If two callers supply DIFFERENT explicit keys that happen to share
  // an emoji or a control char, both must land in the envelope
  // untouched — no de-dup rewrite, no normalization. Guards against
  // silent NFC/NFD folding or accidental base-suffix behaviour when the
  // "base" contains fuzz chars.
  it("distinct fuzz keys stay distinct — no dedup rewrite, no normalization", () => {
    const columns = [
      { key: "α|β", label: "A" },
      { key: "α|γ", label: "B" }, // shares prefix `α|`, must remain untouched
      { key: "e\u0301", label: "C" }, // combining
      { key: "\u00e9", label: "D" }, // precomposed é — must NOT fold with above
      { key: "tab\there", label: "E" },
      { key: "back\\slash", label: "F" },
    ];
    const json = buildJsonExportMetadata({ source: "S", columns });
    const gotKeys = json.columns!.map((c) => c.key);
    expect(gotKeys).toEqual(columns.map((c) => c.key));
    // And round-trip through JSON preserves the same distinctness.
    const rt = JSON.parse(JSON.stringify(json)) as typeof json;
    expect(rt.columns!.map((c) => c.key)).toEqual(columns.map((c) => c.key));
  });
});
