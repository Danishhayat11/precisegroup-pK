import { describe, it, expect } from "vitest";
import {
  buildCsvMetadataHeader,
  buildJsonExportMetadata,
  prefixCsvWithMetadata,
  JSON_ENVELOPE_SCHEMA,
  JSON_ENVELOPE_VERSION,
  type CsvMetadataInput,
} from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";

/**
 * The CSV writer (`# Schema: …` / `# Version: …`) and the JSON writer
 * (`_meta.schema` / `_meta.version`) MUST always agree. Both sides read
 * from the same `JSON_ENVELOPE_SCHEMA` / `JSON_ENVELOPE_VERSION`
 * constants — this suite locks that invariant in place so a future
 * refactor can't accidentally hard-code either side and let them drift.
 */
const sample = (over: Partial<CsvMetadataInput> = {}): CsvMetadataInput => ({
  source: "Leads",
  generatedAt: new Date("2024-06-01T12:00:00Z"),
  columns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
  ],
  ...over,
});

describe("CSV / JSON export envelope parity", () => {
  it("writes JSON_ENVELOPE_SCHEMA and JSON_ENVELOPE_VERSION on both sides", () => {
    const input = sample();
    const csvHeader = buildCsvMetadataHeader(input);
    const jsonMeta = buildJsonExportMetadata(input);
    expect(csvHeader).toContain(`# Schema: ${JSON_ENVELOPE_SCHEMA}`);
    expect(csvHeader).toContain(`# Version: ${JSON_ENVELOPE_VERSION}`);
    expect(jsonMeta.schema).toBe(JSON_ENVELOPE_SCHEMA);
    expect(jsonMeta.version).toBe(JSON_ENVELOPE_VERSION);
  });

  it("parsed CSV `# Schema:` / `# Version:` match `_meta.schema` / `_meta.version` byte-for-byte", () => {
    const input = sample();
    const csv = prefixCsvWithMetadata("id,name\n1,Alice\n", input);
    const parsed = parseCsvMetadataHeader(csv);
    const jsonMeta = buildJsonExportMetadata(input);
    expect(parsed.schema).toBe(jsonMeta.schema);
    expect(parsed.version).toBe(jsonMeta.version);
  });

  it("parity holds across varied inputs (filters, sort, page, counts, extras)", () => {
    const variants: CsvMetadataInput[] = [
      sample(),
      sample({ filters: { Search: "abc", Status: "success" } }),
      sample({ sort: { key: "created_at", dir: "desc" } }),
      sample({ page: { page: 2, totalPages: 10, pageSize: 25 } }),
      sample({ counts: { shown: 25, filtered: 100, total: 500 } }),
      sample({ extra: { Notes: "Truncated at 50000 rows" } }),
    ];
    for (const input of variants) {
      const csv = prefixCsvWithMetadata("id,name\n", input);
      const parsed = parseCsvMetadataHeader(csv);
      const jsonMeta = buildJsonExportMetadata(input);
      expect(parsed.schema).toBe(jsonMeta.schema);
      expect(parsed.version).toBe(jsonMeta.version);
      // And both agree with the source-of-truth constants:
      expect(parsed.schema).toBe(JSON_ENVELOPE_SCHEMA);
      expect(parsed.version).toBe(JSON_ENVELOPE_VERSION);
    }
  });

  it("`schemaDefaulted` is false for freshly written exports — they carry explicit envelope lines", () => {
    const csv = prefixCsvWithMetadata("id\n1\n", sample());
    const parsed = parseCsvMetadataHeader(csv);
    expect(parsed.schemaDefaulted).toBe(false);
  });
});
