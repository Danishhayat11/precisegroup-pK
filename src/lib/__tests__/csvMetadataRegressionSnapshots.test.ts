/**
 * Snapshot regression fixtures for CSV header cases that previously
 * triggered real failures (or would silently drift if the parser
 * changed shape). Each fixture pairs an INPUT column set with the
 * exact parsed metadata output the writer + parser produce today, so
 * any future change that alters the round-trip is caught immediately
 * with a diff instead of a subtle behavioural regression.
 *
 * The fixtures were curated from bugs surfaced by the property tests:
 *
 *   • trailing-whitespace label — earlier the label-preservation test
 *     asserted verbatim, the builder trims. Snapshot pins the trimmed
 *     form.
 *   • embedded `\r\n` in a data cell — earlier `stripCsvMetadataHeader`
 *     re-split on `/\r\n|\n|\r/` and dropped the CR. Snapshot pins the
 *     metadata block (unchanged) and reminds why body slicing here
 *     uses plain `\n` split.
 *   • explicit `{key}` collision with a later label-only sibling
 *     (`amount` + `Amount`) — regression target for precedence logic.
 *   • combining-mark and NFC↔NFD twins — writer is normalisation-blind;
 *     snapshot proves both forms survive as distinct keys.
 *   • label containing `,` and `"` — belongs unquoted in the metadata
 *     block (`# Columns …: …`) but quoted in the CSV header row.
 *   • unclosed quote inside a data cell — should not affect metadata
 *     parsing at all; snapshot confirms metadata block is intact.
 *
 * When a fixture legitimately needs to change (e.g. writer format
 * bump), update the inline snapshot in the same commit and add a
 * one-line note in the fixture header explaining why.
 */
import { describe, it, expect } from "vitest";
import { prefixCsvWithMetadata, type CsvMetadataInput } from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

/** Build + parse a fixture. Returns a JSON-safe subset (drops
 *  `rawLines` / `bodyStartIndex` which are position-dependent noise
 *  for snapshot diffing). */
function snapshotShape(input: CsvMetadataInput, body = "col\nval") {
  const csv = prefixCsvWithMetadata(body, input);
  const parsed = parseCsvMetadataHeader(csv);
  return {
    source: parsed.source,
    schema: parsed.schema,
    version: parsed.version,
    generatedAt: parsed.generatedAt,
    extra: parsed.extra,
    filters: parsed.filters,
    sort: parsed.sort,
    page: parsed.page,
    counts: parsed.counts,
    columns: parsed.columns,
  };
}

describe("parseCsvMetadataHeader — regression snapshot fixtures", () => {
  it("trailing-whitespace label is trimmed in metadata (regression from earlier round-trip test)", () => {
    const parsed = snapshotShape({
      source: "Bookings — trim regression",
      generatedAt: FIXED_DATE,
      columns: [{ key: "amount_pkr", label: "Amount (PKR)" }, { label: "  Trailing/leading  " }],
    });
    expect(parsed).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "key": "amount_pkr",
            "label": "Amount (PKR)",
          },
          {
            "key": "trailing_leading",
            "label": "Trailing/leading",
          },
        ],
        "counts": null,
        "extra": {},
        "filters": {},
        "generatedAt": "7/7/2026, 10:00:00 AM",
        "page": null,
        "schema": "precise-realtors.csv-export-metadata",
        "sort": null,
        "source": "Bookings — trim regression",
        "version": 1,
      }
    `);
  });

  it("data-cell CRLF and unclosed-quote body do not corrupt the metadata block", () => {
    // Body carries a cell with embedded `\r\n` AND an unclosed quote.
    // The metadata block above the blank separator must parse cleanly.
    const parsed = snapshotShape(
      {
        source: "Bookings — CRLF body",
        generatedAt: FIXED_DATE,
        columns: [{ key: "notes", label: "Notes" }],
      },
      // Header row + one hostile data row (unterminated quote is a
      // downstream body-parser concern, not the metadata parser's).
      'Notes\n"Line1\r\nLine2 with "opening quote',
    );
    expect(parsed).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "key": "notes",
            "label": "Notes",
          },
        ],
        "counts": null,
        "extra": {},
        "filters": {},
        "generatedAt": "7/7/2026, 10:00:00 AM",
        "page": null,
        "schema": "precise-realtors.csv-export-metadata",
        "sort": null,
        "source": "Bookings — CRLF body",
        "version": 1,
      }
    `);
  });

  it("explicit `amount` beats later label-only `Amount` — sibling bumps to amount_2", () => {
    const parsed = snapshotShape({
      source: "Precedence collision",
      generatedAt: FIXED_DATE,
      columns: [{ key: "amount", label: "Amount" }, { label: "Amount" }, { label: "Amount" }],
    });
    expect(parsed.columns).toMatchInlineSnapshot(`
      [
        {
          "key": "amount",
          "label": "Amount",
        },
        {
          "key": "amount_2",
          "label": "Amount",
        },
        {
          "key": "amount_3",
          "label": "Amount",
        },
      ]
    `);
  });

  it("NFC and NFD twins of `café` survive as two distinct columns", () => {
    // "café" NFC (é as single code point) vs NFD (e + U+0301).
    const nfc = "café";
    const nfd = "cafe\u0301";
    // Guard: the two forms really are different strings.
    expect(nfc).not.toBe(nfd);
    const parsed = snapshotShape({
      source: "Unicode NFC vs NFD",
      generatedAt: FIXED_DATE,
      columns: [{ label: nfc }, { label: nfd }],
    });
    expect(parsed.columns).toMatchInlineSnapshot(`
      [
        {
          "key": "caf",
          "label": "café",
        },
        {
          "key": "cafe",
          "label": "café",
        },
      ]
    `);
    // Labels are BYTE-different despite rendering the same.
    expect(parsed.columns![0].label).not.toBe(parsed.columns![1].label);
  });

  it("labels containing commas and double-quotes survive verbatim in the metadata block", () => {
    const parsed = snapshotShape({
      source: "Comma + quote labels",
      generatedAt: FIXED_DATE,
      columns: [{ label: 'Booking, ID with "quotes"' }, { label: 'Amount, "final"' }],
    });
    expect(parsed.columns).toMatchInlineSnapshot(`
      [
        {
          "key": "booking_id_with_quotes",
          "label": "Booking, ID with "quotes"",
        },
        {
          "key": "amount_final",
          "label": "Amount, "final"",
        },
      ]
    `);
  });

  it("emoji + combining-mark label round-trips code-point-stable", () => {
    // Reference is the exact string; snapshot pins it so any future
    // Unicode-normalising change to the builder / parser breaks here.
    const parsed = snapshotShape({
      source: "Emoji + combining",
      generatedAt: FIXED_DATE,
      columns: [
        { label: "Amount — 🚀 café\u0301" }, // includes emoji + extra combining accent
      ],
    });
    expect(parsed.columns).toMatchInlineSnapshot(`
      [
        {
          "key": "amount_caf",
          "label": "Amount — 🚀 café́",
        },
      ]
    `);
    // Belt-and-braces: label came back exactly as sent (code-point stable).
    expect([...parsed.columns![0].label]).toEqual([..."Amount — 🚀 café\u0301"]);
  });

  it("full envelope with filters + sort + page + counts + tricky columns is stable end-to-end", () => {
    const parsed = snapshotShape({
      source: "Full envelope regression",
      generatedAt: FIXED_DATE,
      extra: { Project: "PR-001" },
      filters: { status: "active", city: "Karachi" },
      sort: { key: "booking_id", dir: "asc" },
      page: { page: 1, totalPages: 1, pageSize: 50 },
      counts: { shown: 1, filtered: 1, total: 1 },
      columns: [
        { key: "booking_id", label: "Booking, ID" },
        { key: "amount", label: "Amount" },
        { label: "Amount" },
        { label: "Unicode — 中文 🚀" },
      ],
    });
    expect(parsed).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "key": "booking_id",
            "label": "Booking, ID",
          },
          {
            "key": "amount",
            "label": "Amount",
          },
          {
            "key": "amount_2",
            "label": "Amount",
          },
          {
            "key": "unicode",
            "label": "Unicode — 中文 🚀",
          },
        ],
        "counts": {
          "filtered": 1,
          "shown": 1,
          "total": 1,
        },
        "extra": {
          "Project": "PR-001",
        },
        "filters": {
          "city": "Karachi",
          "status": "active",
        },
        "generatedAt": "7/7/2026, 10:00:00 AM",
        "page": {
          "page": 1,
          "pageSize": 50,
          "totalPages": 1,
        },
        "schema": "precise-realtors.csv-export-metadata",
        "sort": {
          "dir": "asc",
          "key": "booking_id",
        },
        "source": "Full envelope regression",
        "version": 1,
      }
    `);
  });
});
