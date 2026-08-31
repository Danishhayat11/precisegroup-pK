/**
 * CSV data-header row ↔ JSON envelope alignment under column-key
 * collisions.
 *
 * The exporter surfaces THREE representations of the column list:
 *   1. The metadata `# Columns` / `# Column keys` block in the CSV.
 *   2. The DATA header row (the row of cell values, first non-metadata
 *      line) that downstream spreadsheet tools actually see.
 *   3. The JSON envelope `columns: [{order, key, label}]` array.
 *
 * These three MUST agree cell-for-cell at every index:
 *   - `columnIndex` (position) is identical across all three,
 *   - `label` at index i is byte-identical in the CSV header cell,
 *     the metadata block, and the JSON envelope,
 *   - `key` at index i is identical in the metadata block and the JSON
 *     envelope (the data header row has labels, not keys).
 *
 * This suite drives every collision path — duplicate labels, explicit-
 * first survival, chained numbering past pre-claimed literals,
 * punctuation-only fallbacks, unicode/emoji duplicates, and a mixed
 * matrix combining them — to prove that a caller iterating the same
 * ordered `columns` array for header + data + metadata never gets
 * misaligned columns even when the derived-key walker produces
 * seemingly-surprising suffixes.
 */
import { describe, it, expect } from "vitest";
import {
  prefixCsvWithMetadata,
  buildJsonExportMetadata,
  type CsvMetadataInput,
} from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

/** Minimal RFC-4180-ish row splitter matching the exporter's escaping. */
function splitCsvRow(row: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (quoted) {
      if (ch === '"') {
        if (row[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  out.push(cell);
  return out;
}

/** Escape a cell value the same way the exporters do. */
function esc(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build the FULL export product from a single ordered `columns` list —
 * the same pattern Dashboard / ImportCenter / DataHealth use. Returns
 * the raw CSV, its parsed metadata block, its data-header cells, and
 * the JSON envelope so callers can cross-check alignment.
 */
function buildAndParse(columns: NonNullable<CsvMetadataInput["columns"]>) {
  // Metadata `columns` accepts strings or `{key?,label}`; the DATA
  // header row uses the same labels in the same order. We normalise
  // labels here to feed the data header row.
  const labels = columns.map((c) => (typeof c === "string" ? c : c.label));
  const headerRow = labels.map((l) => esc(l)).join(",");
  const body = `${headerRow}\r\n\r\n`;
  const input: CsvMetadataInput = {
    source: "Alignment fixture",
    generatedAt: FIXED_DATE,
    columns,
  };
  const csv = prefixCsvWithMetadata(body, input);
  const parsed = parseCsvMetadataHeader(csv);
  // `bodyStartIndex` is the FIRST non-metadata line — i.e. the data
  // header row itself (the parser has already consumed the blank
  // separator). Strip a trailing `\r` from CRLF splitting.
  const allLines = csv.split("\n");
  const dataHeaderLine = (allLines[parsed.bodyStartIndex] ?? "").replace(/\r$/, "");
  const dataHeaderCells = splitCsvRow(dataHeaderLine);
  const envelope = buildJsonExportMetadata(input) as {
    columns: Array<{ order: number; key: string; label: string }>;
  };
  return { csv, parsed, dataHeaderCells, envelope };
}

/**
 * Full three-way alignment assertion for one column list. Fails with a
 * per-index diff so a regression pinpoints which slot drifted.
 */
function assertThreeWayAligned(columns: NonNullable<CsvMetadataInput["columns"]>) {
  const { parsed, dataHeaderCells, envelope } = buildAndParse(columns);
  const metaCols = parsed.columns ?? [];
  const jsonCols = envelope.columns;

  // Total count agreement — first line of defence.
  expect(metaCols.length).toBe(jsonCols.length);
  expect(dataHeaderCells.length).toBe(jsonCols.length);

  // Per-index cross-check: build a comparable object for each surface
  // and compare arrays whole, so vitest prints a per-slot diff.
  const metaShape = metaCols.map((c, i) => ({ i, key: c.key, label: c.label }));
  const jsonShape = jsonCols.map((c) => ({ i: c.order, key: c.key, label: c.label }));
  expect(metaShape).toEqual(jsonShape);

  // CSV data-header row: labels only, position must match json/meta.
  const dataShape = dataHeaderCells.map((cell, i) => ({ i, label: cell }));
  const expectedDataShape = jsonCols.map((c) => ({ i: c.order, label: c.label }));
  expect(dataShape).toEqual(expectedDataShape);

  // `order` is contiguous 0..N-1 (belt-and-braces vs. per-slot equality above).
  expect(jsonCols.map((c) => c.order)).toEqual(jsonCols.map((_, i) => i));

  // Derived keys are unique across the whole list.
  expect(new Set(jsonCols.map((c) => c.key)).size).toBe(jsonCols.length);
}

describe("columnIndex + label/key alignment: CSV metadata ↔ CSV header row ↔ JSON envelope", () => {
  it("no collisions: baseline alignment holds", () => {
    assertThreeWayAligned([
      { key: "id", label: "ID" },
      { key: "amount", label: "Amount" },
      { key: "client", label: "Client" },
    ]);
  });

  it("duplicate labels: `_2/_3` suffixes stay in the same slot as their label", () => {
    assertThreeWayAligned([
      { label: "Amount" },
      { label: "Amount" },
      { label: "Amount" },
      { label: "Notes" },
    ]);
  });

  it("explicit-first survival: explicit key stays at its index; later duplicate is suffixed", () => {
    assertThreeWayAligned([
      { key: "amount", label: "Total (USD)" },
      { label: "Notes" },
      { label: "Amount" }, // slugs to `amount` → must become `amount_2`, not steal slot 0
    ]);
  });

  it("chained numbering past a literal `_2` slot preserves alignment", () => {
    assertThreeWayAligned([
      { key: "amount", label: "First" },
      { key: "amount", label: "Second" },
      { key: "amount_2", label: "Literal Two" },
    ]);
  });

  it("punctuation-only labels: all `column` fallbacks stay in their original indices", () => {
    assertThreeWayAligned([{ label: "!!!" }, { label: "???" }, { label: "—" }, { label: "..." }]);
  });

  it("unicode + emoji duplicates: suffixing preserves per-slot label", () => {
    assertThreeWayAligned([
      { label: "Unicode ✓ ✗ ✱" },
      { label: "Emoji 🎉🚀" },
      { label: "Unicode ✓ ✗ ✱" },
      { label: "Emoji 🎉🚀" },
    ]);
  });

  it("string-shorthand + object mix: both forms align identically", () => {
    assertThreeWayAligned([
      "Plain column",
      { label: "Plain column" }, // → _2 suffix
      { key: "explicit", label: "Explicit" },
      "Another",
    ]);
  });

  it("mixed collision matrix: explicit + duplicate + punctuation + unicode", () => {
    assertThreeWayAligned([
      { key: "id", label: "ID" },
      { label: "Amount" },
      { label: "Amount" },
      { key: "amount_2", label: "Pre-claimed slot 2" },
      { label: "Amount" },
      { label: "!!!" },
      { label: "!!!" },
      { label: "Unicode ✓" },
      { label: "Unicode ✓" },
    ]);
  });

  it("single-column edge case still aligns", () => {
    assertThreeWayAligned([{ key: "only", label: "Only column" }]);
  });

  it("large adversarial set (200 cols): per-index alignment holds", () => {
    // Smaller than the perf suite — this is about ALIGNMENT breadth,
    // not throughput. Interleave five collision families.
    const cols: NonNullable<CsvMetadataInput["columns"]> = [];
    for (let i = 0; i < 200; i++) {
      const bucket = i % 5;
      if (bucket === 0) cols.push({ label: "Amount" });
      else if (bucket === 1) cols.push({ label: "!!!" });
      else if (bucket === 2) cols.push({ label: "Unicode ✓" });
      else if (bucket === 3) cols.push({ key: `amount_${i}`, label: `Preclaim ${i}` });
      else cols.push({ key: `explicit_${i}`, label: `Explicit ${i}` });
    }
    assertThreeWayAligned(cols);
  });
});
