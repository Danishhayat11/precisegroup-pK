/**
 * Integration test: CSV export + `parseCsvMetadataHeader` with the
 * PIPE (`|`) body delimiter — the sibling case to the semicolon / tab
 * variants covered by `csvExportAlternativeDelimiters.test.ts`.
 *
 * The pipe case has one extra hazard the other delimiters don't: the
 * metadata block itself uses `|` internally
 *   • `# Columns (N, in order): L1 | L2 | …`
 *   • `# Filters: k=v | k=v | …`
 * so a body delimited by `|` puts the metadata separator and the data
 * separator on the same character. This test locks in that they DON'T
 * interfere: `parseCsvMetadataHeader` walks only `#`-prefixed lines, so
 * the pipe in the body is invisible to it, and the pipe in the header
 * is invisible to the body parser.
 *
 * What we assert:
 *   1. Explicit `{key}` precedence still resolves left-to-right under
 *      slug collisions when the body uses `|`.
 *   2. Metadata (source, filters, sort, columns[].label) round-trips
 *      verbatim — pipes in the body do not leak into the parsed metadata.
 *   3. Body header + data rows decode back to the original labels and
 *      cell values with a delimiter-aware RFC-4180 parser, including
 *      cells that CONTAIN a literal `|` (quoted).
 *   4. Parsed metadata for a `|` body equals the parsed metadata for a
 *      `,` body — delimiter-independence of the envelope.
 */
import { describe, it, expect } from "vitest";
import { prefixCsvWithMetadata, type CsvMetadataInput } from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

/** Delimiter-aware RFC-4180 cell escaper. */
function escapeCell(v: unknown, delim: string): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  const bad = new RegExp(`["${delim === "\t" ? "\\t" : delim === "|" ? "\\|" : delim}\\n\\r]`);
  return bad.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Delimiter-aware RFC-4180 single-row parser. */
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

// Column set for every variant. Labels deliberately AVOID `|` because
// the metadata `# Columns:` line uses `|` as its own separator — a `|`
// inside a label is unrepresentable and would be caller error, not a
// round-trip concern. The BODY rows below DO exercise in-cell `|`.
const columns = [
  { key: "booking_id", label: "Booking ID" },
  { key: "amount", label: "Amount" }, // explicit wins bare slug
  { label: "Amount" }, // → amount_2
  { label: "Amount" }, // → amount_3
  { label: "Price local" },
  { label: "Unicode — 中文 🚀" },
] as const satisfies NonNullable<CsvMetadataInput["columns"]>;

const rowValues = [
  "BK-001",
  "1000",
  "2000",
  "3000",
  "with|pipe|inside", // triggers quoting under `|`
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

describe("CSV export + parseCsvMetadataHeader with pipe-delimited body", () => {
  it("preserves explicit {key} precedence and dedups siblings deterministically", () => {
    const { parsed } = runVariant("|");
    const keys = parsed.columns!.map((c) => c.key);
    expect(keys).toEqual([
      "booking_id",
      "amount", // explicit wins bare slug…
      "amount_2", // …sibling bumps
      "amount_3", // …and again
      "price_local",
      "unicode",
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("round-trips labels and other metadata verbatim; body pipes do not leak into metadata", () => {
    const { parsed } = runVariant("|");
    expect(parsed.columns!.map((c) => c.label)).toEqual([
      "Booking ID",
      "Amount",
      "Amount",
      "Amount",
      "Price local",
      "Unicode — 中文 🚀",
    ]);
    expect(parsed.source).toBe('CSV export — delim="|"');
    expect(parsed.filters).toEqual({ status: "active" });
    expect(parsed.sort).toEqual({ key: "booking_id", dir: "asc" });
  });

  it("body header + data rows decode back to the original labels and cell values (including in-cell `|`)", () => {
    const { parsedHeader, parsedData } = runVariant("|");
    expect(parsedHeader).toEqual(columns.map((c) => (typeof c === "string" ? c : c.label)));
    expect(parsedData).toEqual(rowValues);
    // Belt-and-braces: the in-cell pipe is preserved verbatim.
    expect(parsedData[4]).toBe("with|pipe|inside");
  });
});

describe("delimiter independence: pipe body yields identical parsed metadata to comma body", () => {
  it("parsed columns / filters / sort / generatedAt match across `|` and `,` body delimiters", () => {
    const a = runVariant("|").parsed;
    const b = runVariant(",").parsed;
    expect(a.columns).toEqual(b.columns);
    expect(a.filters).toEqual(b.filters);
    expect(a.sort).toEqual(b.sort);
    expect(a.generatedAt).toEqual(b.generatedAt);
  });
});
