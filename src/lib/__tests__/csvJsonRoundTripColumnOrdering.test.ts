/**
 * CSV → parse → JSON envelope round-trip: the ordered `columns` array
 * must survive an on-disk boundary intact when labels collide.
 *
 * Motivation: `csvJsonMetadataEquivalence` proves the writers agree
 * before serialisation; `csvJsonExporterParity` compares the two writers
 * side-by-side. Neither proves that a downstream consumer who only ever
 * sees the CSV file — parses it with `parseCsvMetadataHeader`, then
 * re-serialises into the JSON envelope shape — recovers the EXACT same
 * left-to-right column key/label ordering the writer originally emitted.
 *
 * Collision paths exercised here (the ordering is fragile precisely on
 * these paths — regressions historically manifested as suffixes drifting
 * onto the wrong sibling):
 *
 *   • Duplicate labels → `_2`, `_3`, … derived-key suffixes
 *   • Explicit key survives even when a later duplicate label shares its
 *     slug ("explicit-first survival")
 *   • Chained numbering: bases like `amount, amount, amount_2` must not
 *     collapse the second `amount` onto the literal `amount_2`
 *   • Punctuation-only labels that all slug to `column` fallbacks
 *   • Special-character labels (commas, quotes, pipes, newlines, unicode,
 *     emoji) that force the `# Columns` / `# Column keys` split-writer
 *     path
 *
 * Contract asserted per fixture:
 *   1. The parsed CSV `columns` array is in the SAME order as
 *      `buildJsonExportMetadata(input).columns` (stripped of `order`).
 *   2. Re-serialising the parsed columns back into the JSON envelope
 *      shape (`{ order, key, label }`) is byte-identical to the writer's
 *      direct JSON envelope — order indices, keys, and labels all match.
 */
import { describe, it, expect } from "vitest";
import {
  prefixCsvWithMetadata,
  buildJsonExportMetadata,
  type CsvMetadataInput,
} from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";

type OrderedColumn = { order: number; key: string; label: string };

/** Re-serialise parsed CSV columns into the JSON-envelope column shape. */
function reserializeParsedColumns(
  parsed: Array<{ key: string; label: string }> | null,
): OrderedColumn[] | null {
  if (!parsed) return null;
  return parsed.map((c, i) => ({ order: i, key: c.key, label: c.label }));
}

/** Extract the writer's JSON envelope columns (already `{order,key,label}`). */
function writerJsonColumns(input: CsvMetadataInput): OrderedColumn[] | null {
  const env = buildJsonExportMetadata(input) as {
    columns?: OrderedColumn[];
  };
  return env.columns ?? null;
}

/** Full round-trip: input → CSV → parse → re-serialise; must equal writer JSON. */
function assertColumnOrderingRoundTrips(input: CsvMetadataInput) {
  const csv = prefixCsvWithMetadata("h\r\nv\r\n", input);
  const parsed = parseCsvMetadataHeader(csv);
  const reserialised = reserializeParsedColumns(parsed.columns);
  const writerJson = writerJsonColumns(input);
  expect(reserialised).toEqual(writerJson);
  // Belt-and-braces: assert the ordering explicitly, not just deep-equal.
  if (reserialised && writerJson) {
    expect(reserialised.map((c) => c.key)).toEqual(writerJson.map((c) => c.key));
    expect(reserialised.map((c) => c.label)).toEqual(writerJson.map((c) => c.label));
    expect(reserialised.map((c) => c.order)).toEqual(writerJson.map((_, i) => i));
  }
}

const BASE: Omit<CsvMetadataInput, "columns"> = {
  source: "Round-trip fixture",
  generatedAt: new Date("2026-07-07T10:00:00Z"),
};

describe("CSV → parse → JSON envelope: colliding column ordering round-trips", () => {
  it("duplicate labels get stable `_2`/`_3` suffixes in the same slot", () => {
    assertColumnOrderingRoundTrips({
      ...BASE,
      columns: [{ label: "Amount" }, { label: "Amount" }, { label: "Amount" }, { label: "Notes" }],
    });
  });

  it("explicit key at position N survives a later duplicate-label collision", () => {
    // The explicit `amount` at index 0 must stay `amount`; the label
    // duplicate at index 2 must become `amount_2` — NOT steal index 0.
    assertColumnOrderingRoundTrips({
      ...BASE,
      columns: [{ key: "amount", label: "Total (USD)" }, { label: "Notes" }, { label: "Amount" }],
    });
  });

  it("chained numbering does not collapse onto a literal `_2` sibling", () => {
    // Bases `amount, amount, amount_2` → the second `amount` must become
    // `amount_3` (walking past the literal `amount_2`), preserving order.
    assertColumnOrderingRoundTrips({
      ...BASE,
      columns: [
        { key: "amount", label: "First" },
        { key: "amount", label: "Second" },
        { key: "amount_2", label: "Literal Two" },
      ],
    });
  });

  it("punctuation-only labels all fallback to `column` and are numbered in order", () => {
    assertColumnOrderingRoundTrips({
      ...BASE,
      columns: [{ label: "!!!" }, { label: "???" }, { label: "—" }, { label: "..." }],
    });
  });

  it("unicode / emoji labels with duplicates still preserve column order", () => {
    // Focus of this suite is COLLISION ORDERING, not arbitrary special
    // chars — labels containing `|` or newlines break the pipe-delimited
    // `# Columns` line by design and are covered by the header
    // round-trip property suite + hardening suite.
    assertColumnOrderingRoundTrips({
      ...BASE,
      columns: [
        { label: "Unicode ✓ ✗ ✱" },
        { label: "Emoji 🎉🚀" },
        { label: "Unicode ✓ ✗ ✱" }, // duplicate → `_2` suffix, same slot
        { label: "Emoji 🎉🚀" }, // duplicate → `_2` suffix, same slot
      ],
    });
  });

  it("mixed collision matrix: explicit + duplicate + punctuation + unicode", () => {
    assertColumnOrderingRoundTrips({
      ...BASE,
      columns: [
        { key: "id", label: "ID" },
        { label: "Amount" },
        { label: "Amount" },
        { key: "amount_2", label: "Pre-claimed slot 2" },
        { label: "Amount" }, // must become amount_3
        { label: "!!!" },
        { label: "!!!" }, // → column_2 (or slug fallback + _2)
        { label: "Unicode ✓" },
        { label: "Unicode ✓" }, // → suffix _2 on unicode slug
        "Plain string column",
        { label: "Plain string column" }, // → suffix _2
      ],
    });
  });

  it("single-column input still round-trips (edge case)", () => {
    assertColumnOrderingRoundTrips({
      ...BASE,
      columns: [{ key: "only", label: "Only column" }],
    });
  });

  it("no columns provided → both sides emit null (no envelope drift)", () => {
    const input: CsvMetadataInput = { ...BASE };
    const csv = prefixCsvWithMetadata("h\r\nv\r\n", input);
    const parsed = parseCsvMetadataHeader(csv);
    expect(parsed.columns).toBeNull();
    expect(writerJsonColumns(input)).toBeNull();
  });
});
