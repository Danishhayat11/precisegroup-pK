/**
 * Property-based stress on **insertion-order sensitivity** of the
 * deduper and suffixer.
 *
 * The existing property/fuzz suites cover:
 *   • `csvExportMetadataProperty` — stable-identity labels, exact
 *     positional invariants.
 *   • `csvExportMetadataFuzz` — small mixed lists with an oracle.
 *   • `csvExportMetadataWideFuzz` — Unicode/emoji/diacritic input
 *     space with byte-identical determinism and oracle parity.
 *   • `csvExportMetadataLargeFuzzPerf` — 100-500 columns per case,
 *     scaling guard.
 *
 * The gap this file fills: for a FIXED multiset of arbitrary labels
 * (and optional explicit keys), permuting the input order must
 * produce outputs that share a family of **order-invariant
 * properties**, even though individual positions naturally shift.
 * Concretely, for every generated column multiset and every random
 * permutation of it:
 *
 *   1. **Family size invariance** — grouping the derived keys by
 *      their base slug yields the SAME `{base → count}` histogram
 *      regardless of permutation. No matter what order the columns
 *      arrive in, the number of `amount_*` keys emitted stays fixed.
 *
 *   2. **Suffix-set invariance** — for every base, the SET of emitted
 *      suffixes is exactly `{"", "_2", "_3", …, "_N"}` where N is the
 *      family size. No gaps, no duplicates, no `_1` collapse.
 *
 *   3. **Bare-base uniqueness** — for every base with at least one
 *      member, exactly ONE column claims the bare base slot (no
 *      suffix), regardless of permutation.
 *
 *   4. **Explicit-key survival under permutation** — every distinct
 *      explicit key value appears verbatim in the output, no matter
 *      where in the permutation it lands.
 *
 *   5. **CSV ↔ JSON parity under permutation** — both writers agree
 *      on the emitted key sequence for every permutation.
 *
 *   6. **Determinism per permutation** — three back-to-back builds of
 *      the same permutation produce byte-identical output; different
 *      permutations may (and do) yield different byte sequences, but
 *      each permutation is stable in isolation.
 *
 * Together these prove the deduper is a well-defined function of the
 * input MULTISET modulo positional index — a stronger contract than
 * "same input → same output" alone.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { propRuns } from "./_helpers/propRuns";
import {
  buildCsvMetadataHeader,
  buildJsonExportMetadata,
  type CsvMetadataInput,
} from "../csvExportMetadata";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

// ---------- Mirror slugger (oracle for base-family grouping) ----------

function oracleSlug(label: string): string {
  const slug = String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "column";
}

/** Compute the expected base for a column entry as the deduper sees it. */
function baseOf(c: string | { key?: string; label: string }): string {
  const label = typeof c === "string" ? c : c.label;
  const explicit = typeof c === "string" ? undefined : c.key;
  const explicitTrimmed = typeof explicit === "string" ? explicit.trim() : "";
  const labelTrimmed = typeof label === "string" ? label.trim() : "";
  return explicitTrimmed || oracleSlug(labelTrimmed);
}

// ---------- Writer read helpers ----------

function csvKeys(columns: CsvMetadataInput["columns"]): string[] {
  const line = buildCsvMetadataHeader({ source: "P", generatedAt: FIXED_DATE, columns }).find((l) =>
    l.startsWith("# Column keys:"),
  );
  return line ? line.replace("# Column keys: ", "").split(",") : [];
}

function jsonKeys(columns: CsvMetadataInput["columns"]): string[] {
  const meta = buildJsonExportMetadata({ source: "P", generatedAt: FIXED_DATE, columns });
  return ((meta.columns as Array<{ key: string }> | undefined) ?? []).map((c) => c.key);
}

function csvBytes(input: CsvMetadataInput): string {
  return buildCsvMetadataHeader(input).join("\n");
}

function jsonBytes(input: CsvMetadataInput): string {
  return JSON.stringify(buildJsonExportMetadata(input));
}

// ---------- Arbitraries ----------

/**
 * A pool of character classes that exercise every slugifier code
 * path: ASCII letters/digits, punctuation, whitespace, precomposed
 * diacritics, non-Latin scripts, emoji, combining marks. Same shape
 * as the wide-fuzz suite so both files exercise the same input space.
 */
const interestingCharArb = fc.constantFrom(
  ..."abcdefghijklmnopqrstuvwxyz",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ..."0123456789",
  ..." \t",
  ..."!@#$%^&*()_+-=[]{};:'\",.<>/?|\\`~",
  "é",
  "è",
  "ï",
  "ñ",
  "ö",
  "ü",
  "å",
  "ß",
  "ç",
  "É",
  "北",
  "京",
  "日",
  "本",
  "語",
  "Ω",
  "α",
  "💰",
  "🚀",
  "✨",
  "▲",
  "→",
  "—",
  "\u0301",
  "\u0308",
  "\u200D",
  "\uFE0F",
  "\u20E3",
);

const wildLabelArb = fc
  .array(interestingCharArb, { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(""))
  .filter((s) => s.trim().length > 0 && !/[\r\n]/.test(s));

const wildKeyArb = fc
  .array(interestingCharArb, { minLength: 1, maxLength: 6 })
  .map((chars) => chars.join(""))
  .filter((s) => s.trim().length > 0 && !/[,\r\n]/.test(s));

const columnArb = fc.oneof(
  wildLabelArb.map((l) => l as string),
  wildLabelArb.map((label) => ({ label }) as { label: string; key?: string }),
  fc
    .record({ key: wildKeyArb, label: wildLabelArb })
    .map((r) => ({ key: r.key, label: r.label }) as { key: string; label: string }),
);

/** A column multiset (1..15 entries) that survives the writer's validation. */
const columnsArb = fc
  .array(columnArb, { minLength: 1, maxLength: 15 })
  .filter((cols) => cols.length > 0);

// ---------- Utilities ----------

type Col = string | { key?: string; label: string };

/** Fisher-Yates shuffle driven by a fast-check-supplied numeric array. */
function permute<T>(arr: readonly T[], swaps: readonly number[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = swaps[i % swaps.length] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Group the columns by expected base slug. */
function familyHistogram(cols: readonly Col[]): Map<string, number> {
  const h = new Map<string, number>();
  for (const c of cols) h.set(baseOf(c), (h.get(baseOf(c)) ?? 0) + 1);
  return h;
}

/** Group emitted keys by base (matching any `${base}` or `${base}_N`). */
function keysByBase(keys: readonly string[], bases: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const b of bases) out.set(b, []);
  // Sort bases longest-first so `amount_2` isn't misattributed to base `amount` when
  // both `amount` and `amount_2` exist as bases in the same input.
  const ordered = [...bases].sort((a, b) => b.length - a.length);
  for (const k of keys) {
    for (const b of ordered) {
      if (k === b || k.startsWith(`${b}_`)) {
        out.get(b)!.push(k);
        break;
      }
    }
  }
  return out;
}

// ---------- Properties ----------

describe("csvExportMetadata — permutation-invariance of dedup + suffix", () => {
  it("family-size histogram is INVARIANT across permutations of the same multiset", () => {
    fc.assert(
      fc.property(
        columnsArb,
        fc.array(fc.nat(1000), { minLength: 15, maxLength: 15 }),
        (cols, sw) => {
          const permuted = permute(cols, sw);
          const originalKeys = csvKeys(cols);
          const permutedKeys = csvKeys(permuted);
          const bases = Array.from(familyHistogram(cols).keys());
          const h1 = keysByBase(originalKeys, bases);
          const h2 = keysByBase(permutedKeys, bases);
          for (const b of bases) {
            expect(h1.get(b)!.length, `base "${b}" family size must be permutation-invariant`).toBe(
              h2.get(b)!.length,
            );
          }
        },
      ),
      { numRuns: propRuns(200) },
    );
  });

  it("suffix SET per base equals {'', '_2', …, '_N'} for every permutation", () => {
    fc.assert(
      fc.property(
        columnsArb,
        fc.array(fc.nat(1000), { minLength: 15, maxLength: 15 }),
        (cols, sw) => {
          const permuted = permute(cols, sw);
          const keys = csvKeys(permuted);
          const hist = familyHistogram(permuted);
          const grouped = keysByBase(keys, Array.from(hist.keys()));
          for (const [base, count] of hist) {
            const family = grouped.get(base)!;
            expect(family.length).toBe(count);
            // Expected suffix labels: '' for the bare base, `_2`..`_N`
            // for the rest — order-independent set.
            const expected = new Set<string>([
              "",
              ...Array.from({ length: count - 1 }, (_, i) => `_${i + 2}`),
            ]);
            const actual = new Set<string>(family.map((k) => k.slice(base.length)));
            expect(actual, `suffix set for base "${base}" (count=${count})`).toEqual(expected);
          }
        },
      ),
      { numRuns: propRuns(200) },
    );
  });

  it("bare base appears exactly ONCE per base for every permutation", () => {
    fc.assert(
      fc.property(
        columnsArb,
        fc.array(fc.nat(1000), { minLength: 15, maxLength: 15 }),
        (cols, sw) => {
          const permuted = permute(cols, sw);
          const keys = csvKeys(permuted);
          for (const base of familyHistogram(permuted).keys()) {
            expect(
              keys.filter((k) => k === base),
              `base "${base}" bare-slot count`,
            ).toHaveLength(1);
          }
        },
      ),
      { numRuns: propRuns(200) },
    );
  });

  it("every distinct explicit key survives verbatim under any permutation", () => {
    fc.assert(
      fc.property(
        columnsArb,
        fc.array(fc.nat(1000), { minLength: 15, maxLength: 15 }),
        (cols, sw) => {
          const permuted = permute(cols, sw);
          const explicits = Array.from(
            new Set(
              permuted
                .filter(
                  (c): c is { key: string; label: string } => typeof c !== "string" && !!c.key,
                )
                .map((c) => c.key.trim())
                .filter((k) => k.length > 0),
            ),
          );
          const keys = new Set(csvKeys(permuted));
          for (const k of explicits) {
            expect(keys.has(k), `explicit key "${k}" must survive permutation`).toBe(true);
          }
        },
      ),
      { numRuns: propRuns(200) },
    );
  });

  it("CSV ↔ JSON parity holds for every permutation", () => {
    fc.assert(
      fc.property(
        columnsArb,
        fc.array(fc.nat(1000), { minLength: 15, maxLength: 15 }),
        (cols, sw) => {
          const permuted = permute(cols, sw);
          expect(jsonKeys(permuted)).toEqual(csvKeys(permuted));
        },
      ),
      { numRuns: propRuns(200) },
    );
  });

  it("determinism per permutation: three builds are byte-identical (CSV + JSON)", () => {
    fc.assert(
      fc.property(
        columnsArb,
        fc.array(fc.nat(1000), { minLength: 15, maxLength: 15 }),
        (cols, sw) => {
          const permuted = permute(cols, sw);
          const input: CsvMetadataInput = {
            source: "Perm",
            generatedAt: FIXED_DATE,
            columns: permuted,
          };
          const c1 = csvBytes(input);
          const c2 = csvBytes(input);
          const c3 = csvBytes(input);
          expect(c1).toBe(c2);
          expect(c2).toBe(c3);
          const j1 = jsonBytes(input);
          const j2 = jsonBytes(input);
          const j3 = jsonBytes(input);
          expect(j1).toBe(j2);
          expect(j2).toBe(j3);
        },
      ),
      { numRuns: propRuns(150) },
    );
  });

  it("global uniqueness + length are invariant under all permutations", () => {
    fc.assert(
      fc.property(
        columnsArb,
        fc.array(fc.array(fc.nat(1000), { minLength: 15, maxLength: 15 }), {
          minLength: 3,
          maxLength: 5,
        }),
        (cols, permSets) => {
          // Multiple permutations per case — each must independently
          // satisfy: length matches input, every key non-empty, every
          // key unique across the emitted list.
          for (const sw of permSets) {
            const permuted = permute(cols, sw);
            const keys = csvKeys(permuted);
            expect(keys).toHaveLength(permuted.length);
            expect(keys.every((k) => k.length > 0)).toBe(true);
            expect(new Set(keys).size).toBe(keys.length);
          }
        },
      ),
      { numRuns: propRuns(100) },
    );
  });
});
