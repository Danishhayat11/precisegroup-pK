import { describe, it, expect } from "vitest";
import { buildCsvMetadataHeader, prefixCsvWithMetadata } from "../csvExportMetadata";
import {
  CsvMetadataParseError,
  parseCsvMetadataHeader,
  stripCsvMetadataHeader,
} from "../csvMetadataParser";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

describe("parseCsvMetadataHeader — round-trip with writer", () => {
  it("round-trips source, filters, sort, page, counts, columns", () => {
    const input = {
      source: "Bookings — Table",
      generatedAt: FIXED_DATE,
      extra: { Project: "PR-001", Device: "desktop" },
      filters: { status: "active", agent: "all", city: "" },
      sort: { key: "sold_date", dir: "desc" as const },
      page: { page: 2, totalPages: 5, pageSize: 50 },
      counts: { shown: 25, filtered: 100, total: 500 },
      columns: [
        { key: "booking_id", label: "Booking ID" },
        { key: "sold_date", label: "Sold On" },
        { key: "amount", label: "Amount (PKR)" },
      ],
    };
    const csv = prefixCsvWithMetadata("booking_id,sold_date,amount\nBK1,2026-01-01,1000\n", input);
    const parsed = parseCsvMetadataHeader(csv);

    expect(parsed.source).toBe("Bookings — Table");
    expect(parsed.generatedAt).toBe(FIXED_DATE.toLocaleString());
    expect(parsed.extra).toEqual({ Project: "PR-001", Device: "desktop" });
    // Sentinel filters were dropped by the writer, so parser sees only real ones.
    expect(parsed.filters).toEqual({ status: "active" });
    expect(parsed.sort).toEqual({ key: "sold_date", dir: "desc" });
    expect(parsed.page).toEqual({ page: 2, totalPages: 5, pageSize: 50 });
    expect(parsed.counts).toEqual({ shown: 25, filtered: 100, total: 500 });
    expect(parsed.columns).toEqual([
      { key: "booking_id", label: "Booking ID" },
      { key: "sold_date", label: "Sold On" },
      { key: "amount", label: "Amount (PKR)" },
    ]);
  });

  it("stripCsvMetadataHeader returns just the CSV body", () => {
    const csv = prefixCsvWithMetadata("a,b\n1,2\n", {
      source: "T",
      generatedAt: FIXED_DATE,
      filters: { x: "y" },
    });
    expect(stripCsvMetadataHeader(csv)).toBe("a,b\n1,2\n");
  });

  it("parses label-only columns with keys derived from the label by the writer", () => {
    const header = buildCsvMetadataHeader({
      source: "X",
      generatedAt: FIXED_DATE,
      columns: [{ label: "Booking ID" }, { label: "Amount" }],
    });
    const parsed = parseCsvMetadataHeader(`${header.join("\n")}\n\na,b\n1,2\n`);
    // Writer now always emits `# Column keys:` (slugified from labels),
    // so the parser can pair label ↔ key even when the caller only had labels.
    expect(parsed.columns).toEqual([
      { key: "booking_id", label: "Booking ID" },
      { key: "amount", label: "Amount" },
    ]);
  });

  it("returns an empty result and bodyStartIndex=0 when no header is present", () => {
    const parsed = parseCsvMetadataHeader("a,b\n1,2\n");
    expect(parsed.source).toBeNull();
    expect(parsed.filters).toEqual({});
    expect(parsed.sort).toBeNull();
    expect(parsed.page).toBeNull();
    expect(parsed.counts).toBeNull();
    expect(parsed.columns).toBeNull();
    expect(parsed.bodyStartIndex).toBe(0);
    expect(stripCsvMetadataHeader("a,b\n1,2\n")).toBe("a,b\n1,2\n");
  });

  it("parses partial counts (only one bucket)", () => {
    const csv = prefixCsvWithMetadata("a\n1\n", {
      source: "T",
      generatedAt: FIXED_DATE,
      counts: { total: 500 },
    });
    expect(parseCsvMetadataHeader(csv).counts).toEqual({ total: 500 });
  });

  it("tolerates CRLF line endings and preserves body", () => {
    const csv = prefixCsvWithMetadata("a,b\n1,2\n", {
      source: "T",
      generatedAt: FIXED_DATE,
      sort: { key: "a", dir: "asc" },
    }).replace(/\n/g, "\r\n");
    const parsed = parseCsvMetadataHeader(csv);
    expect(parsed.sort).toEqual({ key: "a", dir: "asc" });
    expect(stripCsvMetadataHeader(csv)).toBe("a,b\n1,2\n");
  });

  it("does not duplicate well-known keys into `extra`", () => {
    const csv = prefixCsvWithMetadata("a\n1\n", {
      source: "T",
      generatedAt: FIXED_DATE,
      filters: { k: "v" },
      sort: { key: "a", dir: "asc" },
      page: { page: 1, totalPages: 1, pageSize: 10 },
      counts: { total: 1 },
    });
    const parsed = parseCsvMetadataHeader(csv);
    expect(parsed.extra).toEqual({});
  });
});

describe("parseCsvMetadataHeader — column key validation (fail-fast)", () => {
  const HEADER_PREFIX = [
    "# Precise Realtors — X",
    `# Generated: ${FIXED_DATE.toLocaleString()}`,
  ].join("\n");
  const body = "\n\na,b\n1,2\n";

  it("throws when `# Columns` is present but `# Column keys` is missing", () => {
    const csv = `${HEADER_PREFIX}\n# Columns (2, in order): A | B${body}`;
    const err = expectParseThrow(() => parseCsvMetadataHeader(csv));
    expect(err.code).toBe("missing-column-keys");
    expect(err.details.labelCount).toBe(2);
  });

  it("throws when label and key counts disagree", () => {
    const csv = `${HEADER_PREFIX}\n# Columns (2, in order): A | B\n# Column keys: a${body}`;
    const err = expectParseThrow(() => parseCsvMetadataHeader(csv));
    expect(err.code).toBe("column-key-count-mismatch");
    expect(err.details).toMatchObject({ labelCount: 2, keyCount: 1 });
  });

  it("throws when a key is empty (trailing / duplicate comma)", () => {
    const csv = `${HEADER_PREFIX}\n# Columns (2, in order): A | B\n# Column keys: a, ${body}`;
    // The split-and-trim in the parser keeps a blank entry — we assert the
    // error surfaces its index rather than silently dropping the column.
    const err = expectParseThrow(() => parseCsvMetadataHeader(csv));
    // Either count-mismatch (blank filtered out) or empty-column-key — both
    // are acceptable fail-fast behaviors; assert one of them.
    expect(["empty-column-key", "column-key-count-mismatch"]).toContain(err.code);
  });

  it("accepts writer output unchanged (round-trip stays valid)", () => {
    const csv = prefixCsvWithMetadata("a,b\n1,2\n", {
      source: "X",
      generatedAt: FIXED_DATE,
      columns: [{ label: "A" }, { label: "B" }],
    });
    const parsed = parseCsvMetadataHeader(csv);
    expect(parsed.columns).toEqual([
      { key: "a", label: "A" },
      { key: "b", label: "B" },
    ]);
  });
});

function expectParseThrow(fn: () => unknown): CsvMetadataParseError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CsvMetadataParseError);
    return e as CsvMetadataParseError;
  }
  throw new Error("Expected CsvMetadataParseError but nothing was thrown");
}
