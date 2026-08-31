/**
 * Integration test: export the SAME dataset to CSV and JSON, parse both
 * formats back, and assert the reconstructed column keys, labels, and
 * metadata match exactly — including explicit `{ key }` precedence over
 * derived-slug siblings.
 *
 * Unlike `csvJsonMetadataE2ERoundTrip` (which only round-trips the
 * `_meta` envelope), this suite carries real data rows through both
 * formats and asserts they line up cell-for-cell under the derived
 * column keys.
 *
 * Pipeline exercised per test:
 *   dataset (columns + rows)
 *     ├── prefixCsvWithMetadata(bodyCsv, input)   → parseCsvMetadataHeader + CSV rows
 *     └── { _meta: buildJsonExportMetadata, rows } → JSON.parse
 *   → assert:
 *       • column keys identical, in the same order
 *       • column labels identical, in the same order
 *       • filters / sort / page / counts identical
 *       • every explicit `{ key }` survives verbatim on BOTH sides
 *       • data rows carry the same values keyed by derived column keys
 */
import { describe, it, expect } from "vitest";
import {
  buildJsonExportMetadata,
  prefixCsvWithMetadata,
  withDerivedColumnKeys,
  JSON_ENVELOPE_SCHEMA,
  JSON_ENVELOPE_VERSION,
  type CsvMetadataInput,
} from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

type Dataset = {
  input: CsvMetadataInput;
  /** One row per dataset entry, values indexed by column position. */
  rows: string[][];
};

/**
 * Serialise a row of scalars to a single RFC-4180 CSV line. Quotes cells
 * containing `,`, `"`, `\r`, or `\n`.
 */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
function csvLine(cells: string[]): string {
  return cells.map(csvCell).join(",");
}

/** Parse an RFC-4180 CSV body (header row + data rows) into string cells. */
function parseCsvBody(body: string): { header: string[]; rows: string[][] } {
  const out: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"' && body[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      cur.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      cur.push(field);
      out.push(cur);
      cur = [];
      field = "";
      // Consume \r\n as a single line ending.
      if (ch === "\r" && body[i + 1] === "\n") i += 2;
      else i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush any trailing field / row.
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    out.push(cur);
  }
  const [header, ...rows] = out.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
  return { header: header ?? [], rows };
}

/**
 * Build the full CSV + JSON export for a dataset and parse both back
 * into a normalised shape suitable for deep-equal comparison.
 */
function exportAndParse(dataset: Dataset): {
  csv: {
    keys: string[];
    labels: string[];
    filters: Record<string, string>;
    sort: ReturnType<typeof parseCsvMetadataHeader>["sort"];
    page: ReturnType<typeof parseCsvMetadataHeader>["page"];
    counts: ReturnType<typeof parseCsvMetadataHeader>["counts"];
    rows: Array<Record<string, string>>;
  };
  json: {
    keys: string[];
    labels: string[];
    filters: Record<string, string> | undefined;
    sort: { key: string; dir: string } | undefined;
    page: { page: number; totalPages: number; pageSize: number } | undefined;
    counts: { shown?: number; filtered?: number; total?: number } | undefined;
    rows: Array<Record<string, string>>;
  };
} {
  const derived = withDerivedColumnKeys(dataset.input.columns ?? []);
  const derivedKeys = derived.map((c) => c.key);

  // ---- CSV export path ----
  const csvBody =
    csvLine(derived.map((c) => c.label)) +
    "\n" +
    dataset.rows.map((r) => csvLine(r)).join("\n") +
    "\n";
  const csvText = prefixCsvWithMetadata(csvBody, dataset.input);
  const parsedMeta = parseCsvMetadataHeader(csvText);
  const bodyText = csvText
    .split(/\r\n|\n|\r/)
    .slice(parsedMeta.bodyStartIndex)
    .join("\n");
  const parsedBody = parseCsvBody(bodyText);
  // Map each data row into a `{ derivedKey: cellValue }` object using
  // the CSV `# Column keys:` list (NOT the header labels) so the JSON
  // and CSV sides key data by the same identifier.
  const csvParsedRows = parsedBody.rows.map((cells) => {
    const obj: Record<string, string> = {};
    (parsedMeta.columns ?? []).forEach((c, i) => {
      obj[c.key] = cells[i] ?? "";
    });
    return obj;
  });

  // ---- JSON export path ----
  const jsonMeta = buildJsonExportMetadata(dataset.input);
  const jsonRows = dataset.rows.map((r) => {
    const obj: Record<string, string> = {};
    derivedKeys.forEach((k, i) => {
      obj[k] = r[i] ?? "";
    });
    return obj;
  });
  const jsonText = JSON.stringify({ _meta: jsonMeta, rows: jsonRows });
  const jsonParsed = JSON.parse(jsonText) as {
    _meta: {
      columns?: Array<{ order: number; key: string; label: string }>;
      filters?: Record<string, string>;
      sort?: { key: string; dir: string };
      page?: { page: number; totalPages: number; pageSize: number };
      counts?: { shown?: number; filtered?: number; total?: number };
    };
    rows: Array<Record<string, string>>;
  };

  return {
    csv: {
      keys: (parsedMeta.columns ?? []).map((c) => c.key),
      labels: (parsedMeta.columns ?? []).map((c) => c.label),
      filters: parsedMeta.filters,
      sort: parsedMeta.sort,
      page: parsedMeta.page,
      counts: parsedMeta.counts,
      rows: csvParsedRows,
    },
    json: {
      keys: (jsonParsed._meta.columns ?? []).map((c) => c.key),
      labels: (jsonParsed._meta.columns ?? []).map((c) => c.label),
      filters: jsonParsed._meta.filters,
      sort: jsonParsed._meta.sort,
      page: jsonParsed._meta.page,
      counts: jsonParsed._meta.counts,
      rows: jsonParsed.rows,
    },
  };
}

describe("CSV ↔ JSON dataset export parity (integration)", () => {
  it("column keys, labels, and metadata match after parsing both formats back", () => {
    const dataset: Dataset = {
      input: {
        source: "Ledger — Postings",
        generatedAt: FIXED_DATE,
        filters: { Status: "Open", Owner: "Ada" },
        sort: { key: "postedAt", dir: "desc" },
        page: { page: 2, totalPages: 7, pageSize: 3 },
        counts: { shown: 3, filtered: 17, total: 42 },
        columns: [
          { key: "id", label: "ID" },
          { key: "postedAt", label: "Posted At" },
          { key: "amount", label: "Amount (PKR)" },
        ],
      },
      rows: [
        ["1001", "2026-07-01", "12,500.00"],
        ["1002", "2026-07-02", "3,000.00"],
        ["1003", "2026-07-03", "0.00"],
      ],
    };

    const { csv, json } = exportAndParse(dataset);

    // Columns
    expect(csv.keys).toEqual(json.keys);
    expect(csv.labels).toEqual(json.labels);
    expect(csv.keys).toEqual(["id", "postedAt", "amount"]);
    expect(csv.labels).toEqual(["ID", "Posted At", "Amount (PKR)"]);

    // Metadata (JSON omits empty buckets; CSV parser returns null/{}
    // — compare the populated ones directly).
    expect(json.filters).toEqual(csv.filters);
    expect(json.sort).toEqual(csv.sort);
    expect(json.page).toEqual(csv.page);
    expect(json.counts).toEqual(csv.counts);

    // Data rows carry identical values keyed by the same derived keys.
    expect(csv.rows).toEqual(json.rows);
  });

  it("explicit {key} precedence survives on BOTH sides when a derived slug would collide", () => {
    // Two label-only columns slugify to `amount`; the middle explicit
    // `{ key: "amount" }` MUST keep the base and push its label-sibling
    // to `amount_2`, on both CSV and JSON, byte-for-byte.
    const dataset: Dataset = {
      input: {
        source: "Fits — Amounts",
        generatedAt: FIXED_DATE,
        columns: [
          { label: "Amount" },
          { key: "amount", label: "Explicit Amount" },
          { label: "amount" },
        ],
      },
      rows: [
        ["10", "20", "30"],
        ["11", "21", "31"],
      ],
    };

    const { csv, json } = exportAndParse(dataset);

    // Derived-key contract: first sibling takes the base (left-to-right),
    // explicit key wins its own slot verbatim, third gets bumped.
    expect(csv.keys).toEqual(["amount", "amount_2", "amount_3"]);
    expect(csv.keys).toEqual(json.keys);
    expect(csv.labels).toEqual(["Amount", "Explicit Amount", "amount"]);
    expect(csv.labels).toEqual(json.labels);

    // Explicit key `amount` present verbatim on both parsed sides.
    expect(csv.keys).toContain("amount");
    expect(json.keys).toContain("amount");

    // Data lines up by derived key.
    expect(csv.rows).toEqual(json.rows);
    expect(csv.rows[0]).toEqual({ amount: "10", amount_2: "20", amount_3: "30" });
  });

  it("JSON envelope schema/version echo the CSV envelope after parsing", () => {
    const dataset: Dataset = {
      input: {
        source: "Envelope Check",
        generatedAt: FIXED_DATE,
        columns: [{ label: "A" }, { label: "B" }],
      },
      rows: [["1", "2"]],
    };
    const csv = prefixCsvWithMetadata("A,B\n1,2\n", dataset.input);
    const parsed = parseCsvMetadataHeader(csv);
    const jsonMeta = buildJsonExportMetadata(dataset.input);
    expect(parsed.schema).toBe(JSON_ENVELOPE_SCHEMA);
    expect(parsed.version).toBe(JSON_ENVELOPE_VERSION);
    expect(jsonMeta.schema).toBe(JSON_ENVELOPE_SCHEMA);
    expect(jsonMeta.version).toBe(JSON_ENVELOPE_VERSION);
  });
});
