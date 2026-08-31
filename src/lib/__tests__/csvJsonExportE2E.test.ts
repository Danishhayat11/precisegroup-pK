/**
 * End-to-end export parity: CSV + JSON produced from ONE dataset and
 * ONE ordered column list must agree on both the metadata envelope AND
 * the actual data rows.
 *
 * This test reproduces the pattern Dashboard / ImportCenter /
 * DataHealth use in production:
 *   1. Take a filtered/sorted/paginated slice of a source dataset.
 *   2. Build a `columns` list (with `key`, `label`, and a cell getter).
 *   3. Emit a CSV file via `prefixCsvWithMetadata` where the data
 *      header + data rows iterate the same `columns` array.
 *   4. Emit a JSON file whose top-level `_meta` is
 *      `buildJsonExportMetadata` and whose `rows` array is built by
 *      the same getters, keyed by the derived column keys.
 *
 * Then, in a downstream role, we:
 *   - parse the CSV metadata header,
 *   - parse the CSV data rows,
 *   - and assert that every field of `_meta` matches the parsed CSV
 *     metadata AND that every data cell matches the JSON payload
 *     keyed by `columns[i].key` for the same row index.
 *
 * The dataset intentionally exercises collision paths (duplicate label
 * "Amount", punctuation label "!!!", unicode label "Unicode ✓") so the
 * derived-key mapping used to key the JSON rows is non-trivial.
 */
import { describe, it, expect } from "vitest";
import {
  prefixCsvWithMetadata,
  buildJsonExportMetadata,
  type CsvMetadataInput,
} from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

// ---- Source dataset (bookings) --------------------------------------

type Booking = {
  id: string;
  sold_on: string;
  amount_pkr: number;
  amount_usd: number;
  client: string;
  note: string;
  city: string;
};

const DATASET: Booking[] = [
  {
    id: "BK1",
    sold_on: "2026-01-01",
    amount_pkr: 1_000_000,
    amount_usd: 3600,
    client: "Alice, Ltd.",
    note: "VIP",
    city: "Karachi",
  },
  {
    id: "BK2",
    sold_on: "2026-02-02",
    amount_pkr: 2_500_000,
    amount_usd: 9000,
    client: 'Bob "Quoted" Co',
    note: "Refund pending",
    city: "Lahore",
  },
  {
    id: "BK3",
    sold_on: "2026-03-03",
    amount_pkr: 750_000,
    amount_usd: 2700,
    client: "Chen 陈",
    note: "Unicode ✓ ✗ ✱",
    city: "Karachi",
  },
  {
    id: "BK4",
    sold_on: "2026-04-04",
    amount_pkr: 5_000_000,
    amount_usd: 18000,
    client: "Delta \\ Backslash",
    note: "Line1\nLine2",
    city: "Islamabad",
  },
  {
    id: "BK5",
    sold_on: "2026-05-05",
    amount_pkr: 900_000,
    amount_usd: 3240,
    client: "Emoji 🎉🚀 Inc",
    note: "!!!",
    city: "Karachi",
  },
];

// Simulate a query: filter city=Karachi, sort by sold_on desc, page 1 of 1.
const FILTER = { city: "Karachi", status: "all" };
const SLICE = DATASET.filter((b) => b.city === FILTER.city).sort((a, b) =>
  b.sold_on.localeCompare(a.sold_on),
);

// Columns include collision paths: duplicate "Amount" labels,
// punctuation-only, unicode.
type Column = { key?: string; label: string; get: (b: Booking) => string | number };
const COLUMNS: Column[] = [
  { key: "id", label: "Booking ID", get: (b) => b.id },
  { key: "sold_on", label: "Sold On", get: (b) => b.sold_on },
  { label: "Amount", get: (b) => b.amount_pkr }, // slug → amount
  { label: "Amount", get: (b) => b.amount_usd }, // → amount_2
  { label: "!!!", get: (b) => b.client }, // slug fallback → column
  { label: "Unicode ✓", get: (b) => b.note }, // slug → unicode
  { key: "city", label: "City", get: (b) => b.city },
];

// ---- Exporter (matches production usage) ----------------------------

function esc(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

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

/**
 * Split a CSV body (post-metadata) into rows. Handles quoted cells that
 * span embedded `\n` and `\r\n` newlines, matching the escaping the
 * exporter uses.
 */
function splitCsvBody(body: string): string[] {
  const rows: string[] = [];
  let buf = "";
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      buf += ch;
      if (ch === '"') {
        if (body[i + 1] === '"') {
          buf += '"';
          i++;
        } else {
          quoted = false;
        }
      }
    } else if (ch === '"') {
      buf += ch;
      quoted = true;
    } else if (ch === "\r" && body[i + 1] === "\n") {
      rows.push(buf);
      buf = "";
      i++;
    } else if (ch === "\n" || ch === "\r") {
      rows.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.length > 0) rows.push(buf);
  return rows.filter((r) => r.length > 0);
}

interface FullExport {
  csv: string;
  json: {
    _meta: Record<string, unknown>;
    rows: Array<Record<string, string>>;
  };
  metaInput: CsvMetadataInput;
}

function exportFull(): FullExport {
  const metaInput: CsvMetadataInput = {
    source: "Bookings — Karachi (E2E)",
    generatedAt: FIXED_DATE,
    filters: FILTER,
    sort: { key: "sold_on", dir: "desc" },
    page: { page: 1, totalPages: 1, pageSize: SLICE.length },
    counts: { shown: SLICE.length, filtered: SLICE.length, total: DATASET.length },
    columns: COLUMNS.map((c) => ({ key: c.key, label: c.label })),
  };
  const headerRow = COLUMNS.map((c) => esc(c.label)).join(",");
  const dataRows = SLICE.map((b) => COLUMNS.map((c) => esc(c.get(b))).join(","));
  const body = [headerRow, ...dataRows].join("\r\n") + "\r\n";
  const csv = grid(prefixCsvWithMetadata(body, metaInput));

  const envelope = buildJsonExportMetadata(metaInput) as {
    columns: Array<{ order: number; key: string; label: string }>;
  } & Record<string, unknown>;
  // JSON rows are keyed by the DERIVED keys from the envelope — this
  // is the whole point of derived keys existing: JSON callers use
  // `row[column.key]`, not label matching.
  const jsonRows = SLICE.map((b) => {
    const obj: Record<string, string> = {};
    envelope.columns.forEach((c, i) => {
      obj[c.key] = String(COLUMNS[i].get(b));
    });
    return obj;
  });
  return {
    csv,
    json: { _meta: envelope, rows: jsonRows },
    metaInput,
  };
}

/** Preserve CSV as-is; grid() is a hook for future normalisation. */
function grid(csv: string): string {
  return csv;
}

// ---- Assertions -----------------------------------------------------

describe("E2E export: CSV + JSON metadata AND data rows agree cell-for-cell", () => {
  const { csv, json } = exportFull();
  const parsed = parseCsvMetadataHeader(csv);

  it("metadata envelope: CSV-parsed fields match JSON `_meta`", () => {
    // Source — byte-identical after trim.
    expect(parsed.source).toBe(json._meta.source);
    // generatedAt — both non-null (representations differ).
    expect(parsed.generatedAt).toBeTruthy();
    expect(json._meta.generatedAt).toBeTruthy();
    // Filters — key/value pairs match (city only; status:"all" is dropped).
    expect(parsed.filters).toEqual(json._meta.filters);
    // Sort / page / counts.
    expect(parsed.sort).toEqual(json._meta.sort);
    expect(parsed.page).toEqual(json._meta.page);
    expect(parsed.counts).toEqual(json._meta.counts);
    // Columns: parsed shape (no `order`) matches envelope shape.
    const jsonColShape = (
      json._meta.columns as Array<{ order: number; key: string; label: string }>
    ).map(({ key, label }) => ({ key, label }));
    expect(parsed.columns).toEqual(jsonColShape);
  });

  it("data rows: CSV data rows parse into the same values the JSON payload records", () => {
    // Extract the body (everything after the metadata + blank separator).
    const lines = csv.split("\n");
    const bodyLines = lines.slice(parsed.bodyStartIndex);
    const body = bodyLines.join("\n");
    const rawRows = splitCsvBody(body);
    // First row is the DATA HEADER — labels in `columns` order.
    const headerCells = splitCsvRow(rawRows[0]);
    const dataRows = rawRows.slice(1).map(splitCsvRow);

    const jsonCols = json._meta.columns as Array<{ order: number; key: string; label: string }>;

    // Header labels align with envelope labels at every index.
    expect(headerCells).toEqual(jsonCols.map((c) => c.label));

    // Row count matches.
    expect(dataRows.length).toBe(json.rows.length);

    // For every row, every cell equals `jsonRow[columns[i].key]`.
    dataRows.forEach((cells, rowIdx) => {
      expect(cells.length).toBe(jsonCols.length);
      cells.forEach((cell, colIdx) => {
        const key = jsonCols[colIdx].key;
        expect(cell).toBe(json.rows[rowIdx][key]);
      });
    });
  });

  it("collision-derived keys reach the JSON payload correctly", () => {
    // The two "Amount" columns must land on `amount` and `amount_2`
    // (in that order) in the JSON payload, and the values must match
    // the PKR / USD source fields respectively for every row.
    const jsonCols = json._meta.columns as Array<{ key: string; label: string }>;
    const amountKeys = jsonCols.filter((c) => c.label === "Amount").map((c) => c.key);
    expect(amountKeys).toEqual(["amount", "amount_2"]);
    json.rows.forEach((row, i) => {
      expect(row.amount).toBe(String(SLICE[i].amount_pkr));
      expect(row.amount_2).toBe(String(SLICE[i].amount_usd));
    });
    // Punctuation-only "!!!" → slug fallback `column`; unicode → `unicode`.
    expect(jsonCols.some((c) => c.label === "!!!" && c.key === "column")).toBe(true);
    expect(jsonCols.some((c) => c.label === "Unicode ✓" && c.key === "unicode")).toBe(true);
  });

  it("row count matches counts.shown across CSV, JSON, and source slice", () => {
    const lines = csv.split("\n");
    const bodyLines = lines.slice(parsed.bodyStartIndex);
    const rawRows = splitCsvBody(bodyLines.join("\n"));
    const csvDataRowCount = rawRows.length - 1; // minus header
    expect(csvDataRowCount).toBe(SLICE.length);
    expect(json.rows.length).toBe(SLICE.length);
    expect(parsed.counts?.shown).toBe(SLICE.length);
  });

  it("filter/sort applied to source dataset is faithfully reflected in the export", () => {
    // Every emitted row must satisfy the filter, and rows must be
    // sorted by sold_on desc — the same filter/sort recorded in
    // metadata. This guards against a caller advertising one query in
    // metadata while exporting a different query's rows.
    for (const row of json.rows) {
      expect(row.city).toBe(FILTER.city);
    }
    const soldDates = json.rows.map((r) => r.sold_on);
    const resorted = [...soldDates].sort((a, b) => b.localeCompare(a));
    expect(soldDates).toEqual(resorted);
  });
});
