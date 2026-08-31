/**
 * Header-row label alignment when multiple columns collide on the same
 * slug base. The exporter's `# Column keys:` row will dedupe with
 * `_2`, `_3` suffixes; the human header row must still show the caller's
 * ORIGINAL labels in the ORIGINAL order. This test guards the "keys
 * change, labels don't" contract that downstream spreadsheet users rely
 * on when eyeballing an export.
 *
 * Also exercised end-to-end through `parseCsvMetadataHeader` so we know
 * a real re-importer sees the same alignment.
 */
import { describe, it, expect } from "vitest";
import { prefixCsvWithMetadata } from "../csvExportMetadata";
import { parseCsvMetadataHeader, stripCsvMetadataHeader } from "../csvMetadataParser";

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
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cell);
      cell = "";
    } else cell += ch;
  }
  out.push(cell);
  return out;
}

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Build an export the same way real callers do: metadata columns and
 * body header derived from the SAME ordered `columns` array. Returns
 * both the CSV string and the source labels/values used, so the test
 * body can assert alignment without re-deriving expectations.
 */
function buildExport(columns: Array<{ key?: string; label: string; value: string }>) {
  const header = columns.map((c) => esc(c.label)).join(",");
  const dataRow = columns.map((c) => esc(c.value)).join(",");
  const body = `${header}\r\n${dataRow}\r\n`;
  const csv = prefixCsvWithMetadata(body, {
    source: "Alignment",
    generatedAt: new Date("2026-07-07T10:00:00Z"),
    columns: columns.map((c) => (c.key ? { key: c.key, label: c.label } : { label: c.label })),
    counts: { shown: 1, total: 1 },
  });
  return {
    csv,
    labels: columns.map((c) => c.label),
    values: columns.map((c) => c.value),
  };
}

describe("CSV header-row label alignment under slug collisions", () => {
  it("two colliding label-only siblings — header labels preserved, keys dedup with _2", () => {
    const { csv, labels, values } = buildExport([
      { label: "Amount", value: "100" },
      { label: "Amount", value: "200" },
    ]);
    const parsed = parseCsvMetadataHeader(csv);
    const bodyLines = stripCsvMetadataHeader(csv)
      .split(/\r\n|\n/)
      .filter(Boolean);

    // Header row: original labels in original order (unchanged).
    expect(splitCsvRow(bodyLines[0])).toEqual(labels);
    // Metadata keys: deduped with _2.
    expect(parsed.columns!.map((c) => c.key)).toEqual(["amount", "amount_2"]);
    // Metadata labels align 1:1 with the header row.
    expect(parsed.columns!.map((c) => c.label)).toEqual(labels);
    // Data row cells align 1:1 with both.
    expect(splitCsvRow(bodyLines[1])).toEqual(values);
  });

  it("four-way collision across case/whitespace/punctuation — labels stay verbatim in header row", () => {
    // All four slugify to `amount`. Header must show the four ORIGINAL
    // spellings, keys walk amount / _2 / _3 / _4.
    const { csv, labels, values } = buildExport([
      { label: "Amount", value: "a" },
      { label: "amount!", value: "b" },
      { label: "AMOUNT?", value: "c" },
      { label: "  amount  ", value: "d" },
    ]);
    const parsed = parseCsvMetadataHeader(csv);
    const bodyLines = stripCsvMetadataHeader(csv)
      .split(/\r\n|\n/)
      .filter(Boolean);

    expect(splitCsvRow(bodyLines[0])).toEqual(labels);
    expect(parsed.columns!.map((c) => c.key)).toEqual([
      "amount",
      "amount_2",
      "amount_3",
      "amount_4",
    ]);
    // Metadata label vs. header-row label: identical after label trimming
    // for the whitespace-padded variant (exporter trims labels in meta,
    // but the on-disk header ROW preserves the original spelling).
    const metaLabels = parsed.columns!.map((c) => c.label);
    expect(metaLabels).toEqual(labels.map((l) => l.trim()));
    expect(splitCsvRow(bodyLines[1])).toEqual(values);
  });

  it("explicit {key:'amount_2'} sandwiched between two label collisions — labels still align", () => {
    // Keys: amount / amount_2 (explicit) / amount_3 (bumped past literal).
    // Header row: the three ORIGINAL labels in order. Data cells must
    // stay glued to their labels — no shuffling introduced by the
    // suffix walk-past.
    const { csv, labels, values } = buildExport([
      { label: "Amount", value: "first" },
      { key: "amount_2", label: "Legacy Two", value: "middle" },
      { label: "Amount", value: "last" },
    ]);
    const parsed = parseCsvMetadataHeader(csv);
    const bodyLines = stripCsvMetadataHeader(csv)
      .split(/\r\n|\n/)
      .filter(Boolean);

    expect(parsed.columns!.map((c) => c.key)).toEqual(["amount", "amount_2", "amount_3"]);
    expect(parsed.columns!.map((c) => c.label)).toEqual(labels);
    expect(splitCsvRow(bodyLines[0])).toEqual(labels);
    // The middle column's data cell is 'middle', not shifted onto the
    // third slot even though its key ends in `_2`.
    expect(splitCsvRow(bodyLines[1])).toEqual(values);
  });

  it("dense same-base collision (6 identical labels) preserves labels and cell alignment", () => {
    const columns = Array.from({ length: 6 }, (_, i) => ({
      label: "Amount",
      value: `v${i + 1}`,
    }));
    const { csv, labels, values } = buildExport(columns);
    const parsed = parseCsvMetadataHeader(csv);
    const bodyLines = stripCsvMetadataHeader(csv)
      .split(/\r\n|\n/)
      .filter(Boolean);

    expect(parsed.columns!.map((c) => c.key)).toEqual([
      "amount",
      "amount_2",
      "amount_3",
      "amount_4",
      "amount_5",
      "amount_6",
    ]);
    expect(parsed.columns!.map((c) => c.label)).toEqual(labels);
    expect(splitCsvRow(bodyLines[0])).toEqual(labels);
    expect(splitCsvRow(bodyLines[1])).toEqual(values);
    // Cell count equals metadata column count.
    expect(splitCsvRow(bodyLines[1])).toHaveLength(parsed.columns!.length);
  });

  it("labels containing commas / quotes stay aligned with their (deduped) keys", () => {
    const { csv, labels, values } = buildExport([
      { label: "Amount, gross", value: "10" },
      { label: 'Amount, "net"', value: "20" },
      { label: "Amount", value: "30" },
    ]);
    const parsed = parseCsvMetadataHeader(csv);
    const bodyLines = stripCsvMetadataHeader(csv)
      .split(/\r\n|\n/)
      .filter(Boolean);

    // `Amount, gross` and `Amount, "net"` both slug to `amount_gross`
    // and `amount_net`; the last is bare `amount`. No dedup needed —
    // this case guards that comma/quote ESCAPING in the header row
    // stays aligned even when it changes the derived key.
    expect(parsed.columns!.map((c) => c.key)).toEqual(["amount_gross", "amount_net", "amount"]);
    // Header row round-trips the escaped labels back to their originals.
    expect(splitCsvRow(bodyLines[0])).toEqual(labels);
    expect(splitCsvRow(bodyLines[1])).toEqual(values);
  });
});
