import { describe, it, expect } from "vitest";
import {
  buildCsvMetadataHeader,
  prefixCsvWithMetadata,
  type CsvMetadataInput,
} from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";

/**
 * End-to-end integration test:
 *
 *   [complex row values]
 *      → escapeCsvCell (mirrors AiDiagnosticsPage.handleExportCsv)
 *      → prefixCsvWithMetadata
 *      → (serialised CSV blob body)
 *      → parseCsvMetadataHeader
 *      → parseCsvBody (RFC 4180)
 *      → assert headers + metadata keys + cell values all match verbatim
 *
 * Exercises every hairy escaping case the exporter is expected to survive:
 *   • cells containing `,` (delimiter)
 *   • cells containing `"` (quote-doubling)
 *   • cells containing `\n` and `\r\n` (embedded rows)
 *   • cells containing leading/trailing whitespace
 *   • unicode punctuation in labels + cells (em-dash, curly quotes, emoji)
 *   • label collisions that force the `key` deduper to bump derived slugs
 *   • an explicit `{key}` colliding with a derived slug from a later label
 */

// Mirror the exporter's escape (byte-identical to AiDiagnosticsPage).
function escapeCsvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Tiny RFC 4180 CSV parser — quoted fields, embedded quotes/commas/newlines. */
function parseCsvBody(body: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inQuotes) {
      if (c === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        field = "";
        row = [];
      } else if (c === "\r") {
        // swallow — LF handles row break; if CR without LF, still break.
        if (body[i + 1] !== "\n") {
          row.push(field);
          rows.push(row);
          field = "";
          row = [];
        }
      } else {
        field += c;
      }
    }
  }
  // Trailing field / row (no terminating newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

describe("CSV export → parseCsvMetadataHeader round-trip with complex escaping", () => {
  const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

  // Column labels intentionally use every allowed-but-tricky code point.
  // (`|` and `\n` are forbidden in labels by the metadata format — see
  // `# Columns (…)` in csvExportMetadata.ts — so those are excluded.)
  const columns: CsvMetadataInput["columns"] = [
    { key: "booking_id", label: 'Booking, ID with "quotes"' },
    { key: "notes", label: "Notes — multiline & unicode ✓" },
    { label: "Amount (PKR)" }, // derived key: amount_pkr
    { label: "Amount (PKR)" }, // dup label → amount_pkr_2
    { key: "amount", label: "Amount" }, // explicit key wins even though the next label…
    { label: "Amount" }, // …would derive `amount` (bumped to amount_2)
    { label: "Notes / Extra: Info" }, // punctuation slug → notes_extra_info
  ];

  // A single data row with EVERY tricky value the exporter promises to
  // preserve byte-for-byte.
  const rowValues = [
    "BK,001", // comma
    'Line1\nLine2\r\nLine3 with "quote"', // \n, \r\n, embedded quote
    "  spaced  ", // leading/trailing whitespace preserved
    "unicode: — “curly” 中文 🚀", // multi-byte + emoji
    "", // empty
    null, // → ""
    "plain",
  ];

  const input: CsvMetadataInput = {
    source: "Bookings — Escaping Round Trip",
    generatedAt: FIXED_DATE,
    extra: { Project: "PR-001" },
    filters: { status: "active", city: "Karachi" },
    sort: { key: "booking_id", dir: "asc" },
    page: { page: 1, totalPages: 1, pageSize: 50 },
    counts: { shown: 1, filtered: 1, total: 1 },
    columns,
  };

  // Build the CSV exactly like AiDiagnosticsPage.handleExportCsv does.
  const headerLine =
    (buildCsvMetadataHeader(input), // just to sanity-check builder didn't throw
    columns.map((c) => escapeCsvCell(typeof c === "string" ? c : c.label)).join(","));
  const dataLine = rowValues.map(escapeCsvCell).join(",");
  const csv = prefixCsvWithMetadata(`${headerLine}\n${dataLine}`, input);

  const parsedMeta = parseCsvMetadataHeader(csv);
  // NOTE: use plain `\n` to slice off the metadata block. The library's
  // `stripCsvMetadataHeader` re-splits on `\r\n|\n|\r`, which would drop
  // embedded `\r` characters inside quoted cells and mask the very
  // escaping we're validating here.
  const csvBody = csv.split("\n").slice(parsedMeta.bodyStartIndex).join("\n");
  const bodyRows = parseCsvBody(csvBody);
  const parsedHeaderRow = bodyRows[0];
  const parsedDataRow = bodyRows[1];

  it("preserves every explicit and derived column key verbatim in metadata", () => {
    expect(parsedMeta.columns).not.toBeNull();
    const keys = parsedMeta.columns!.map((c) => c.key);
    // Explicit keys survive intact; derived keys are deterministic and
    // deduped against earlier siblings (explicit `amount` wins → later
    // label-only "Amount" bumps to `amount_2`).
    expect(keys).toEqual([
      "booking_id",
      "notes",
      "amount_pkr",
      "amount_pkr_2",
      "amount",
      "amount_2",
      "notes_extra_info",
    ]);
  });

  it("preserves every column label verbatim in the metadata block", () => {
    // The builder trims leading/trailing whitespace on labels but keeps
    // all other characters (commas, quotes, punctuation, unicode) intact.
    const labels = parsedMeta.columns!.map((c) => c.label);
    expect(labels).toEqual([
      'Booking, ID with "quotes"',
      "Notes — multiline & unicode ✓",
      "Amount (PKR)",
      "Amount (PKR)",
      "Amount",
      "Amount",
      "Notes / Extra: Info",
    ]);
  });

  it("emits a CSV header row whose fields decode back to the exact column labels", () => {
    expect(parsedHeaderRow).toEqual(parsedMeta.columns!.map((c) => c.label));
  });

  it("preserves every cell value byte-for-byte after quote/comma/CRLF escaping", () => {
    const expected = rowValues.map((v) => (v == null ? "" : String(v)));
    expect(parsedDataRow).toEqual(expected);
  });

  it("round-trips source / filters / sort / page / counts unchanged", () => {
    expect(parsedMeta.source).toBe("Bookings — Escaping Round Trip");
    expect(parsedMeta.extra).toEqual({ Project: "PR-001" });
    expect(parsedMeta.filters).toEqual({ status: "active", city: "Karachi" });
    expect(parsedMeta.sort).toEqual({ key: "booking_id", dir: "asc" });
    expect(parsedMeta.page).toEqual({ page: 1, totalPages: 1, pageSize: 50 });
    expect(parsedMeta.counts).toEqual({ shown: 1, filtered: 1, total: 1 });
  });

  it("metadata key list length matches the CSV header field count", () => {
    // The invariant that downstream re-import relies on: N labels in the
    // `# Columns` block ⇔ N keys in `# Column keys` ⇔ N header fields.
    expect(parsedMeta.columns!.length).toBe(parsedHeaderRow.length);
    expect(parsedMeta.columns!.length).toBe(columns.length);
  });
});
