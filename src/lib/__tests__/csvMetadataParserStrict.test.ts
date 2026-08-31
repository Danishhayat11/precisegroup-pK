import { describe, it, expect } from "vitest";
import { parseCsvMetadataHeader, CsvMetadataParseError } from "../csvMetadataParser";

const WELL_FORMED = [
  "# Precise Realtors — Leads",
  "# Schema: precise-realtors.csv-export-metadata",
  "# Version: 1",
  "# Generated: 2024-01-01T00:00:00Z",
  "# Columns (2, in order): ID | Name",
  "# Column keys: id,name",
  "",
  "id,name",
  "1,Alice",
].join("\n");

describe("parseCsvMetadataHeader — strict mode", () => {
  it("accepts a fully well-formed header", () => {
    const parsed = parseCsvMetadataHeader(WELL_FORMED, { strict: true });
    expect(parsed.source).toBe("Leads");
    expect(parsed.columns).toEqual([
      { key: "id", label: "ID" },
      { key: "name", label: "Name" },
    ]);
  });

  it("still accepts legacy exports missing Schema/Version (back-fill runs before strict checks)", () => {
    const csv = [
      "# Precise Realtors — Leads",
      "# Generated: 2024-01-01T00:00:00Z",
      "# Columns (1, in order): ID",
      "# Column keys: id",
      "",
      "id",
      "1",
    ].join("\n");
    const parsed = parseCsvMetadataHeader(csv, { strict: true });
    expect(parsed.schema).not.toBeNull();
    expect(parsed.version).not.toBeNull();
    expect(parsed.schemaDefaulted).toBe(true);
  });

  it("throws `missing-source` when the `# Precise Realtors —` line is absent", () => {
    const csv = [
      "# Generated: 2024-01-01T00:00:00Z",
      "# Columns (1, in order): ID",
      "# Column keys: id",
      "",
      "id",
      "1",
    ].join("\n");
    let err: unknown;
    try {
      parseCsvMetadataHeader(csv, { strict: true });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CsvMetadataParseError);
    expect((err as CsvMetadataParseError).code).toBe("missing-source");
    expect((err as CsvMetadataParseError).message).toMatch(/Precise Realtors/);
  });

  it("throws `missing-columns` when the `# Columns (N, in order):` line is absent", () => {
    const csv = [
      "# Precise Realtors — Leads",
      "# Generated: 2024-01-01T00:00:00Z",
      "",
      "id,name",
      "1,Alice",
    ].join("\n");
    let err: unknown;
    try {
      parseCsvMetadataHeader(csv, { strict: true });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CsvMetadataParseError);
    expect((err as CsvMetadataParseError).code).toBe("missing-columns");
  });

  it("throws `malformed-line` for a known key with an unparseable value (e.g. bad Sort)", () => {
    const csv = [
      "# Precise Realtors — Leads",
      "# Sort: id sideways", // dir must be asc|desc
      "# Columns (1, in order): ID",
      "# Column keys: id",
      "",
      "id",
      "1",
    ].join("\n");
    let err: unknown;
    try {
      parseCsvMetadataHeader(csv, { strict: true });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CsvMetadataParseError);
    const e = err as CsvMetadataParseError;
    expect(e.code).toBe("malformed-line");
    expect(e.details.field).toMatch(/sort/i);
    expect(e.details.lineNumber).toBe(2);
  });

  it("throws `malformed-line` for a bad Page line", () => {
    const csv = [
      "# Precise Realtors — Leads",
      "# Page: 1 of many (size 25)",
      "# Columns (1, in order): ID",
      "# Column keys: id",
      "",
      "id",
      "1",
    ].join("\n");
    expect(() => parseCsvMetadataHeader(csv, { strict: true })).toThrowError(/malformed .*Page/i);
  });

  it("throws `malformed-line` for a `#` comment with no key:value shape", () => {
    const csv = [
      "# Precise Realtors — Leads",
      "# this is just a random note",
      "# Columns (1, in order): ID",
      "# Column keys: id",
      "",
      "id",
      "1",
    ].join("\n");
    let err: unknown;
    try {
      parseCsvMetadataHeader(csv, { strict: true });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CsvMetadataParseError);
    expect((err as CsvMetadataParseError).code).toBe("malformed-line");
  });

  it("tolerant mode (default) does NOT throw for any of the above — parity check", () => {
    const csvs = [
      // missing source
      "# Generated: 2024-01-01T00:00:00Z\n\nid\n1\n",
      // missing columns
      "# Precise Realtors — Leads\n\nid\n1\n",
      // bad sort
      "# Precise Realtors — Leads\n# Sort: id sideways\n\nid\n1\n",
      // random comment
      "# Precise Realtors — Leads\n# hello world\n\nid\n1\n",
    ];
    for (const csv of csvs) {
      expect(() => parseCsvMetadataHeader(csv)).not.toThrow();
    }
  });

  it("still throws the pre-existing `missing-column-keys` in strict mode", () => {
    const csv = [
      "# Precise Realtors — Leads",
      "# Columns (2, in order): ID | Name",
      "",
      "id,name",
      "1,Alice",
    ].join("\n");
    let err: unknown;
    try {
      parseCsvMetadataHeader(csv, { strict: true });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CsvMetadataParseError);
    expect((err as CsvMetadataParseError).code).toBe("missing-column-keys");
  });
});
