/**
 * Integration test: CSV export + `parseCsvMetadataHeader` with
 * ALTERNATIVE body delimiters (`;` and `\t`).
 *
 * The metadata block is delimiter-agnostic by design — it lives above a
 * blank line and uses `# key: value` / `# Columns (…): l1 | l2 | …`
 * shapes that never touch the data-row separator. So an export tool that
 * emits a semicolon- or tab-separated body (common for European locales
 * where `,` is the decimal mark, or for TSV pipelines) must still be able
 * to round-trip through `parseCsvMetadataHeader` and preserve explicit
 * `{key}` precedence under label collisions.
 *
 * What this test locks in:
 *   1. Metadata block parses back verbatim regardless of body delimiter.
 *   2. Explicit `{key}` values survive verbatim on parsed
 *      `_meta.columns[].key` — even when they collide with what a
 *      sibling label would derive to (explicit position keeps the base
 *      slug; sibling bumps deterministically).
 *   3. The alternative-delimiter body row, parsed with a delimiter-aware
 *      RFC-4180-style parser, decodes back to the exact original labels
 *      — including labels that contain the OTHER (non-body) delimiter
 *      (e.g. a `,` inside a `;`-delimited body row, unquoted).
 *   4. Cells that contain the body delimiter itself are still round-
 *      trippable when quoted, mirroring how any real CSV tool handles
 *      an in-cell delimiter.
 */
import { describe, it, expect } from "vitest";
import { prefixCsvWithMetadata, type CsvMetadataInput } from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

/** Delimiter-aware cell escaper. Quotes when the cell contains the
 *  chosen delimiter, a double-quote, or a newline — the standard
 *  RFC-4180 rule generalised to arbitrary delimiters. */
function escapeCell(v: unknown, delim: string): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  const bad = new RegExp(`["${delim === "\t" ? "\\t" : delim}\\n\\r]`);
  return bad.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Delimiter-aware RFC-4180 row parser (single row, no embedded newlines). */
function parseRow(line: string, delim: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      out.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}

// The column set used by every delimiter variant. Deliberately packs in:
//   • an explicit `{key}` that collides with the base slug a sibling
//     label would derive to (`amount`), so we can prove precedence.
//   • a label containing `,` — trivially quoted under `,`, unquoted
//     under `;` / `\t`.
//   • a label containing `;` — quoted under `;`, unquoted under `,` / `\t`.
//   • a label containing `\t` — quoted under `\t`, unquoted otherwise.
//   • unicode + duplicate labels to exercise the deduper.
const columns = [
  { key: "booking_id", label: "Booking, ID" }, // has `,`
  { key: "amount", label: "Amount" }, // explicit wins bare slug
  { label: "Amount" }, // → amount_2
  { label: "Amount" }, // → amount_3
  { label: "Price; local" }, // has `;`
  { label: "Tab\there" }, // has `\t`
  { label: "Unicode — 中文 🚀" },
] as const satisfies NonNullable<CsvMetadataInput["columns"]>;

// Row values chosen to exercise in-cell delimiter escaping per variant.
const rowValues = [
  "BK, with comma", // triggers quoting under `,`
  "1000",
  "2000",
  "3000",
  "500; localized", // triggers quoting under `;`
  "with\ttab", // triggers quoting under `\t`
  "plain unicode 中文",
];

function runVariant(delim: string) {
  const input: CsvMetadataInput = {
    source: `CSV export — delim=${JSON.stringify(delim)}`,
    generatedAt: FIXED_DATE,
    filters: { status: "active" },
    sort: { key: "booking_id", dir: "asc" },
    columns,
  };
  const headerRow = columns
    .map((c) => escapeCell(typeof c === "string" ? c : c.label, delim))
    .join(delim);
  const dataRow = rowValues.map((v) => escapeCell(v, delim)).join(delim);
  const csv = prefixCsvWithMetadata(`${headerRow}\n${dataRow}`, input);
  const parsed = parseCsvMetadataHeader(csv);
  const bodyLines = csv.split("\n").slice(parsed.bodyStartIndex);
  return {
    parsed,
    parsedHeader: parseRow(bodyLines[0] ?? "", delim),
    parsedData: parseRow(bodyLines[1] ?? "", delim),
  };
}

describe.each([
  { name: "semicolon", delim: ";" },
  { name: "tab", delim: "\t" },
])("CSV export + parseCsvMetadataHeader with $name-delimited body", ({ delim }) => {
  it("preserves explicit {key} precedence and dedups siblings deterministically", () => {
    const { parsed } = runVariant(delim);
    const keys = parsed.columns!.map((c) => c.key);
    expect(keys).toEqual([
      "booking_id",
      "amount", // explicit wins bare slug…
      "amount_2", // …sibling bumps
      "amount_3", // …and again
      "price_local",
      "tab_here",
      "unicode",
    ]);
    // Sanity: uniqueness holds regardless of delimiter.
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("round-trips labels and other metadata verbatim regardless of body delimiter", () => {
    const { parsed } = runVariant(delim);
    expect(parsed.columns!.map((c) => c.label)).toEqual([
      "Booking, ID",
      "Amount",
      "Amount",
      "Amount",
      "Price; local",
      "Tab\there",
      "Unicode — 中文 🚀",
    ]);
    expect(parsed.source).toBe(`CSV export — delim=${JSON.stringify(delim)}`);
    expect(parsed.filters).toEqual({ status: "active" });
    expect(parsed.sort).toEqual({ key: "booking_id", dir: "asc" });
  });

  it("body header and data rows decode back to the original labels and cell values", () => {
    const { parsedHeader, parsedData } = runVariant(delim);
    // The body header is written from raw (untrimmed) labels — matches input verbatim.
    expect(parsedHeader).toEqual(columns.map((c) => (typeof c === "string" ? c : c.label)));
    // Data cells (including ones containing the body delimiter) round-trip.
    expect(parsedData).toEqual(rowValues);
  });
});

describe("delimiter independence: metadata is byte-identical across `;` and `\\t` bodies", () => {
  it("the parsed metadata block is identical no matter what body delimiter is used", () => {
    const a = runVariant(";").parsed;
    const b = runVariant("\t").parsed;
    // Everything except source (which we intentionally varied) matches.
    expect(a.columns).toEqual(b.columns);
    expect(a.filters).toEqual(b.filters);
    expect(a.sort).toEqual(b.sort);
    expect(a.generatedAt).toEqual(b.generatedAt);
  });
});
