/**
 * Property-based round-trip test: hostile characters in labels and
 * explicit keys must survive the CSV metadata block.
 *
 * The writer/parser contract puts a few hard constraints on the wire
 * format (see csvMetadataParser.ts):
 *
 *   `# Columns (N, in order): L1 | L2 | …` — pipe-separated, so labels
 *     can contain commas, quotes, and non-ASCII text freely, but NOT
 *     `|`, `\n`, or `\r` (those would corrupt the line).
 *
 *   `# Column keys: k1,k2,…`               — comma-separated, so keys
 *     can contain quotes and unicode, but NOT `,`, `\n`, or `\r`.
 *
 * We sanitise the disallowed characters before feeding them in (matching
 * how the exporter's callers must already sanitise) and then assert:
 *
 *   1. Every generated label round-trips through `parseCsvMetadataHeader`
 *      byte-identical to the writer's `.trim()`-ed version (commas,
 *      quotes, unicode, emoji all preserved).
 *   2. Every generated explicit key round-trips verbatim.
 *   3. Chained-sibling `_2/_3/…` numbering still applies when hostile
 *      labels collide on the same slug base — the resolver treats
 *      unicode/punctuation as separator runs.
 *   4. Newline-bearing input still round-trips AFTER the exporter's
 *      documented pre-sanitisation step (newlines → single space).
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { propRuns } from "./_helpers/propRuns";
import { prefixCsvWithMetadata } from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

/** Strip characters that would corrupt the pipe-separated `# Columns` line. */
const sanitiseLabel = (s: string) => s.replace(/[|\r\n]+/g, " ").trim();
/** Strip characters that would corrupt the comma-separated `# Column keys` line. */
const sanitiseKey = (s: string) => s.replace(/[,\r\n]+/g, "_").trim();

/**
 * Label arbitrary — mixes:
 *   • ASCII letters / digits
 *   • Commas and double-quotes (must survive CSV escaping)
 *   • Non-ASCII: accented Latin, Cyrillic, CJK, Arabic
 *   • Emoji (astral plane, surrogate-pair territory)
 */
const labelArb = fc
  .string({
    unit: fc.oneof(
      fc.constantFrom(..."Amount Total Fee Net Gross ".split("")),
      fc.constantFrom(...",\".'()[]{}!?#$£€¥₨".split("")),
      fc.constantFrom(
        "é",
        "ñ",
        "ü",
        "ø",
        "Ω",
        "Δ",
        "Ж",
        "Я",
        "中",
        "文",
        "ع",
        "ب",
        "🚀",
        "💰",
        "📊",
      ),
    ),
    minLength: 1,
    maxLength: 32,
  })
  .map(sanitiseLabel)
  .filter((s: string) => s.length > 0);

/**
 * Explicit-key arbitrary — same character soup, minus commas (which
 * would split the `# Column keys:` line). Trimmed and non-empty.
 */
const keyArb = fc
  .string({
    unit: fc.oneof(
      fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz_0123456789".split("")),
      fc.constantFrom(..."\".'()[]{}!?#$£€¥₨".split("")),
      fc.constantFrom("é", "ñ", "Ω", "Ж", "中", "ع", "🚀", "💰"),
    ),
    minLength: 1,
    maxLength: 20,
  })
  .map(sanitiseKey)
  .filter((s: string) => s.length > 0);

const columnArb = fc.oneof(
  labelArb.map((label) => ({ label })),
  fc.record({ key: keyArb, label: labelArb }),
);

const columnsArb = fc.array(columnArb, { minLength: 1, maxLength: 12 });

/** CSV-escape a single cell for the data-row header. */
const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function buildAndParse(columns: Array<{ key?: string; label: string }>) {
  const header = columns.map((c) => esc(c.label)).join(",");
  const body = `${header}\r\nx\r\n`;
  const csv = prefixCsvWithMetadata(body, {
    source: "Property Round-Trip",
    generatedAt: FIXED_DATE,
    columns,
    counts: { shown: 1, total: 1 },
  });
  return parseCsvMetadataHeader(csv);
}

describe("CSV metadata header — property-based round-trip with hostile characters", () => {
  it("labels with commas / quotes / unicode / emoji round-trip verbatim", () => {
    fc.assert(
      fc.property(columnsArb, (columns) => {
        const parsed = buildAndParse(columns);
        expect(parsed.columns).not.toBeNull();
        // Writer trims labels; comparison must trim too.
        const expectedLabels = columns.map((c) => c.label.trim());
        expect(parsed.columns!.map((c) => c.label)).toEqual(expectedLabels);
      }),
      { numRuns: propRuns(200) },
    );
  });

  it("every explicit key with quotes / unicode / emoji is honoured verbatim or as a `_N` sibling", () => {
    // The resolver does NOT reserve explicit keys ahead of time — a
    // preceding label whose slug matches the explicit key claims the
    // slot first, and the explicit key walks to `_2/_3/…`. So the
    // guaranteed contract is: the parsed key at the explicit column's
    // position is EITHER the trimmed explicit key verbatim OR that
    // same key extended with an `_N` suffix. Never something else.
    fc.assert(
      fc.property(columnsArb, (columns) => {
        const parsed = buildAndParse(columns);
        columns.forEach((c, i) => {
          if ("key" in c && c.key) {
            const k = c.key.trim();
            const got = parsed.columns![i].key;
            const ok = got === k || got.startsWith(`${k}_`);
            expect(ok, `explicit key '${k}' produced '${got}'`).toBe(true);
          }
        });
      }),
      { numRuns: propRuns(200) },
    );
  });

  it("emitted keys are non-empty and unique regardless of the character soup", () => {
    fc.assert(
      fc.property(columnsArb, (columns) => {
        const parsed = buildAndParse(columns);
        const keys = parsed.columns!.map((c) => c.key);
        for (const k of keys) expect(k.length).toBeGreaterThan(0);
        expect(new Set(keys).size).toBe(keys.length);
      }),
      { numRuns: propRuns(200) },
    );
  });

  it("chained-sibling numbering holds when hostile labels collide on the same slug base", () => {
    // Generate N identical labels (with hostile characters) — they must
    // all slugify to the SAME base, so the resolver hands out `base`,
    // `base_2`, `base_3`, … in strict left-to-right order.
    fc.assert(
      fc.property(labelArb, fc.integer({ min: 2, max: 8 }), (label, n) => {
        const columns = Array.from({ length: n }, () => ({ label }));
        const parsed = buildAndParse(columns);
        const keys = parsed.columns!.map((c) => c.key);
        // All unique.
        expect(new Set(keys).size).toBe(keys.length);
        // Every sibling after the first ends in `_${i+1}` (2, 3, 4, …).
        const base = keys[0];
        for (let i = 1; i < keys.length; i++) {
          expect(keys[i]).toBe(`${base}_${i + 1}`);
        }
      }),
      { numRuns: propRuns(150) },
    );
  });

  it("newline-bearing labels round-trip AFTER the documented sanitisation step", () => {
    // Real callers pre-sanitise newlines to spaces before handing labels
    // to the metadata builder (the block is line-oriented). This property
    // proves the sanitisation contract holds for arbitrary inputs.
    const withNewlinesArb = fc.array(
      fc.oneof(
        labelArb,
        labelArb.map((l: string) => `${l}\nmore`),
        labelArb.map((l: string) => `${l}\r\nline`),
      ),
      { minLength: 1, maxLength: 8 },
    );
    fc.assert(
      fc.property(withNewlinesArb, (rawLabels) => {
        const columns = rawLabels.map((l) => ({ label: sanitiseLabel(l) }));
        // Skip degenerate cases where sanitisation blanks the label.
        fc.pre(columns.every((c) => c.label.length > 0));
        const parsed = buildAndParse(columns);
        expect(parsed.columns!.map((c) => c.label)).toEqual(columns.map((c) => c.label));
      }),
      { numRuns: propRuns(150) },
    );
  });
});
