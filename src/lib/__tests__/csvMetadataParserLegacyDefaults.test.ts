import { describe, it, expect } from "vitest";
import {
  parseCsvMetadataHeader,
  LEGACY_CSV_SCHEMA,
  LEGACY_CSV_VERSION,
} from "../csvMetadataParser";

describe("parseCsvMetadataHeader — legacy Schema/Version defaults", () => {
  it("back-fills LEGACY_CSV_SCHEMA / LEGACY_CSV_VERSION when both lines are missing but metadata is present", () => {
    const csv = [
      "# Precise Realtors — Leads",
      "# Generated: 2024-01-01T00:00:00Z",
      "",
      "id,name",
      "1,Alice",
    ].join("\n");
    const parsed = parseCsvMetadataHeader(csv);
    expect(parsed.source).toBe("Leads");
    expect(parsed.schema).toBe(LEGACY_CSV_SCHEMA);
    expect(parsed.version).toBe(LEGACY_CSV_VERSION);
    expect(parsed.schemaDefaulted).toBe(true);
  });

  it("back-fills only the missing field when Schema is present but Version is not", () => {
    const csv = ["# Precise Realtors — Leads", "# Schema: custom.schema.id", "", "id", "1"].join(
      "\n",
    );
    const parsed = parseCsvMetadataHeader(csv);
    expect(parsed.schema).toBe("custom.schema.id");
    expect(parsed.version).toBe(LEGACY_CSV_VERSION);
    expect(parsed.schemaDefaulted).toBe(true);
  });

  it("back-fills only the missing field when Version is present but Schema is not", () => {
    const csv = ["# Precise Realtors — Leads", "# Version: 7", "", "id", "1"].join("\n");
    const parsed = parseCsvMetadataHeader(csv);
    expect(parsed.schema).toBe(LEGACY_CSV_SCHEMA);
    expect(parsed.version).toBe(7);
    expect(parsed.schemaDefaulted).toBe(true);
  });

  it("does NOT default when both Schema and Version are declared (schemaDefaulted stays false)", () => {
    const csv = [
      "# Precise Realtors — Leads",
      "# Schema: precise-realtors.csv-export-metadata",
      "# Version: 1",
      "",
      "id",
      "1",
    ].join("\n");
    const parsed = parseCsvMetadataHeader(csv);
    expect(parsed.schema).toBe("precise-realtors.csv-export-metadata");
    expect(parsed.version).toBe(1);
    expect(parsed.schemaDefaulted).toBe(false);
  });

  it("leaves schema/version null on a CSV with no metadata header (we can't claim ownership)", () => {
    const csv = ["id,name", "1,Alice"].join("\n");
    const parsed = parseCsvMetadataHeader(csv);
    expect(parsed.rawLines).toEqual([]);
    expect(parsed.schema).toBeNull();
    expect(parsed.version).toBeNull();
    expect(parsed.schemaDefaulted).toBe(false);
  });

  it("preserves an explicit Version even when it's higher than LEGACY_CSV_VERSION", () => {
    const csv = ["# Precise Realtors — Leads", "# Version: 99", "", "id", "1"].join("\n");
    const parsed = parseCsvMetadataHeader(csv);
    expect(parsed.version).toBe(99);
  });
});
