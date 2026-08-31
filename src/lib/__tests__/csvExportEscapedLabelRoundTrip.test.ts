/**
 * Integration test: CSV labels containing commas, quotes, and newlines.
 *
 * We assert two overlapping contracts:
 *
 *   1. `parseCsvMetadataHeader` round-trips labels containing COMMAS and
 *      QUOTES. The `# Columns (N, in order): L1 | L2 | …` block is
 *      pipe-separated, so commas and quotes are legal characters inside
 *      a label and must survive the writer → parser round trip verbatim.
 *
 *   2. Key precedence holds throughout: explicit `{ key }` wins over
 *      derived-slug siblings even when the labels around it contain
 *      CSV-hostile characters that force quoting in the data-row header.
 *
 * Newlines are a special case: the metadata block is LINE-oriented, so
 * a raw `\n` inside a label would corrupt the `# Columns` line. That
 * case is covered separately by asserting the data-row header still
 * round-trips through a CSV cell splitter (the on-disk contract) while
 * documenting that the metadata block cannot carry a raw newline.
 */
import { describe, it, expect } from "vitest";
import { prefixCsvWithMetadata } from "../csvExportMetadata";
import { parseCsvMetadataHeader, stripCsvMetadataHeader } from "../csvMetadataParser";

/** Minimal CSV cell splitter matching the writer's escape rules. */
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

/** Parse a CSV body that may contain quoted cells spanning newlines. */
function parseCsvRows(body: string): string[][] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      // Terminate row on any line ending; swallow CRLF as one break.
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (ch === "\r" && body[i + 1] === "\n") i++;
    } else cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function buildExport(columns: Array<{ key?: string; label: string; value: string }>) {
  const header = columns.map((c) => esc(c.label)).join(",");
  const dataRow = columns.map((c) => esc(c.value)).join(",");
  const body = `${header}\r\n${dataRow}\r\n`;
  const csv = prefixCsvWithMetadata(body, {
    source: "Escape Test",
    generatedAt: new Date("2026-07-07T10:00:00Z"),
    columns: columns.map((c) => (c.key ? { key: c.key, label: c.label } : { label: c.label })),
    counts: { shown: 1, total: 1 },
  });
  return { csv, labels: columns.map((c) => c.label), values: columns.map((c) => c.value) };
}

describe("CSV escaped-label round-trip + explicit key precedence", () => {
  it("labels with commas and quotes round-trip through parseCsvMetadataHeader", () => {
    const { csv, labels, values } = buildExport([
      { label: "Amount, gross (PKR)", value: "1,000" },
      { label: 'Amount "net"', value: 'She said "hi"' },
      { label: "Simple", value: "x" },
    ]);
    const parsed = parseCsvMetadataHeader(csv);
    const bodyLines = stripCsvMetadataHeader(csv)
      .split(/\r\n|\n/)
      .filter(Boolean);

    // Metadata labels come back byte-identical from the `# Columns` line.
    expect(parsed.columns!.map((c) => c.label)).toEqual(labels);
    // Data-row header comes back byte-identical via CSV escaping.
    expect(splitCsvRow(bodyLines[0])).toEqual(labels);
    expect(splitCsvRow(bodyLines[1])).toEqual(values);
  });

  it("explicit key wins when a comma-bearing sibling slugifies to the same base", () => {
    // `Amount, gross` → slug `amount_gross`. `Amount, net` → `amount_net`.
    // Explicit `{ key: 'amount_gross' }` claims the base slot; the
    // label-only sibling with the same derived slug bumps to `_2`.
    const { csv, labels } = buildExport([
      { key: "amount_gross", label: "Amount, gross (explicit)", value: "100" },
      { label: "Amount, gross", value: "200" }, // derived → amount_gross taken → amount_gross_2
      { label: "Amount, net", value: "300" }, // derived → amount_net (fresh)
    ]);
    const parsed = parseCsvMetadataHeader(csv);

    expect(parsed.columns!.map((c) => c.key)).toEqual([
      "amount_gross",
      "amount_gross_2",
      "amount_net",
    ]);
    // Labels retained verbatim in the metadata, including the commas.
    expect(parsed.columns!.map((c) => c.label)).toEqual(labels);
  });

  it("explicit key with embedded quotes is preserved VERBATIM and labels still round-trip", () => {
    const { csv, labels } = buildExport([
      { key: 'weird"key', label: 'Weird "quoted" label', value: "1" },
      { label: 'Weird "quoted" label', value: "2" }, // derived → weird_quoted_label
    ]);
    const parsed = parseCsvMetadataHeader(csv);

    // Explicit key is trusted as-is — quotes and all.
    expect(parsed.columns![0].key).toBe('weird"key');
    // Derived sibling gets the slugified fallback.
    expect(parsed.columns![1].key).toBe("weird_quoted_label");
    // Both labels survive the escape/parse round trip.
    expect(parsed.columns!.map((c) => c.label)).toEqual(labels);
  });

  it("data-row header with newlines inside a label survives CSV escaping", () => {
    // Newlines inside a metadata `# Columns` line would corrupt the
    // block (metadata is line-oriented), so this scenario only asserts
    // the DATA-row contract: proper CSV quoting keeps the newline
    // inside one cell that a CSV parser can round-trip. We build the
    // body directly and skip `prefixCsvWithMetadata` for the
    // newline-bearing label to avoid corrupting the metadata block.
    const columns = [
      { key: "amount", label: "Amount" },
      { key: "notes", label: "Notes\nwith newline" }, // safe in body only
    ];
    const header = columns.map((c) => esc(c.label)).join(",");
    const dataRow = ["100", "line one\nline two"].map(esc).join(",");
    const body = `${header}\r\n${dataRow}\r\n`;

    const rows = parseCsvRows(body);
    expect(rows).toHaveLength(2);
    // Header row: newline preserved inside quoted cell 2.
    expect(rows[0]).toEqual(columns.map((c) => c.label));
    // Data row: multi-line cell preserved verbatim.
    expect(rows[1]).toEqual(["100", "line one\nline two"]);
  });

  it("explicit key precedence still holds when a newline-bearing sibling is present in the DATA header", () => {
    // The metadata block uses SAFE labels (newline stripped); the
    // data-row header renders the raw label with the newline. This
    // matches the real exporter contract: callers pre-sanitise labels
    // before handing them to `prefixCsvWithMetadata`.
    const rawLabels = ["Amount", "Notes\nwith newline", "Amount"];
    const metaLabels = rawLabels.map((l) => l.replace(/\r?\n/g, " "));
    const header = rawLabels.map(esc).join(",");
    const dataRow = ["1", "line one\nline two", "2"].map(esc).join(",");
    const body = `${header}\r\n${dataRow}\r\n`;
    const csv = prefixCsvWithMetadata(body, {
      source: "Escape Test",
      generatedAt: new Date("2026-07-07T10:00:00Z"),
      columns: [
        { key: "amount", label: metaLabels[0] }, // explicit — must survive
        { label: metaLabels[1] }, // derived → notes_with_newline
        { label: metaLabels[2] }, // derived → amount taken → amount_2
      ],
      counts: { shown: 1, total: 1 },
    });
    const parsed = parseCsvMetadataHeader(csv);
    expect(parsed.columns!.map((c) => c.key)).toEqual(["amount", "notes_with_newline", "amount_2"]);
    // Metadata labels are the sanitised versions.
    expect(parsed.columns!.map((c) => c.label)).toEqual(metaLabels);
    // DATA-row header still carries the raw label with the newline,
    // survived via CSV quoting.
    const rows = parseCsvRows(stripCsvMetadataHeader(csv));
    expect(rows[0]).toEqual(rawLabels);
  });
});
