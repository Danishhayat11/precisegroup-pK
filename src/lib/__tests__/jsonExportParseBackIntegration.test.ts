/**
 * Integration tests: parse a JSON export envelope BACK into the app's
 * internal structures (`ParsedJsonExport` from
 * `jsonExportEnvelopeParser`) and assert that explicit `{ key }`
 * precedence and derived-collision resolution survive the full
 * export → serialise → parse → reify pipeline.
 *
 * Every test:
 *   1. Builds a `_meta` envelope with `buildJsonExportMetadata`.
 *   2. Wraps it as `{ _meta, rows }`, `JSON.stringify` + `JSON.parse`.
 *   3. Feeds the parsed object to `parseJsonExportEnvelope`.
 *   4. Asserts:
 *       - `columns` order matches the export order.
 *       - Every explicit key survives verbatim on the parsed
 *         `columnByKey` map.
 *       - `columnByKey.size === columns.length` (no silent collisions).
 *       - `rowValuesInColumnOrder(row)` returns cells aligned to the
 *         same order as the original dataset.
 *       - Two independent export → parse cycles produce byte-identical
 *         key sequences (determinism).
 */
import { describe, it, expect } from "vitest";
import {
  buildJsonExportMetadata,
  withDerivedColumnKeys,
  type CsvMetadataInput,
} from "../csvExportMetadata";
import { parseJsonExportEnvelope, JsonExportParseError } from "../jsonExportEnvelopeParser";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

function exportAndReparse(
  columns: CsvMetadataInput["columns"],
  rows: Array<Record<string, unknown>> = [],
  extra: Partial<CsvMetadataInput> = {},
) {
  const input: CsvMetadataInput = {
    source: "Parse-back integration",
    generatedAt: FIXED_DATE,
    columns,
    ...extra,
  };
  const envelope = { _meta: buildJsonExportMetadata(input), rows };
  const wire = JSON.parse(JSON.stringify(envelope));
  return { input, parsed: parseJsonExportEnvelope(wire) };
}

describe("parseJsonExportEnvelope — explicit key + derived collision precedence", () => {
  it("reifies columns in export order with a lookup map keyed by derived/explicit key", () => {
    const { parsed } = exportAndReparse([
      { key: "id", label: "ID" },
      { key: "postedAt", label: "Posted At" },
      { key: "amount", label: "Amount (PKR)" },
    ]);

    expect(parsed.columns.map((c) => c.key)).toEqual(["id", "postedAt", "amount"]);
    expect(parsed.columns.map((c) => c.order)).toEqual([0, 1, 2]);
    expect(parsed.columnByKey.get("postedAt")?.label).toBe("Posted At");
    expect(parsed.columnByKey.size).toBe(parsed.columns.length);
  });

  it("left-to-right precedence: earlier slot keeps base slug, later explicit / derived collisions bump", () => {
    // Contract from `withDerivedColumnKeys`: keys are assigned strictly
    // left-to-right. When a label-only sibling at index 0 already claims
    // `amount`, an explicit `{ key: "amount" }` at index 1 gets bumped
    // rather than silently overwriting — the explicit key is preserved
    // in a bumped form (`amount_2`) only when the shared derivation
    // helper does so. We pin the sequence to the helper's output so
    // any drift in either the exporter, JSON writer, or parser fails.
    const cols: CsvMetadataInput["columns"] = [
      { label: "Amount" },
      { key: "amount", label: "Explicit" },
      { label: "amount" },
    ];
    const { parsed } = exportAndReparse(cols);
    const keys = parsed.columns.map((c) => c.key);
    const reference = withDerivedColumnKeys(cols).map((c) => c.key);

    expect(keys).toEqual(reference);
    expect(new Set(keys).size).toBe(keys.length);
    // The explicit column's LABEL still travels with whatever key it got.
    const explicitCol = parsed.columns[1];
    expect(explicitCol.label).toBe("Explicit");
    expect(parsed.columnByKey.get(explicitCol.key)).toBe(explicitCol);
  });

  it("explicit key at index 0 DOES win the base slug (nothing came before it)", () => {
    // Complement to the previous test: when the explicit key is the
    // first thing the deduper sees, it takes the base slug verbatim
    // and forces later derived siblings to bump.
    const cols: CsvMetadataInput["columns"] = [
      { key: "amount", label: "Explicit" },
      { label: "Amount" },
      { label: "amount" },
    ];
    const { parsed } = exportAndReparse(cols);
    const keys = parsed.columns.map((c) => c.key);
    expect(keys[0]).toBe("amount");
    expect(parsed.columnByKey.get("amount")?.label).toBe("Explicit");
    expect(keys).toEqual(withDerivedColumnKeys(cols).map((c) => c.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("rowValuesInColumnOrder aligns cells to export order even under hostile-key columns", () => {
    const cols: CsvMetadataInput["columns"] = [
      { key: 'weird"key', label: "A" },
      { key: "amount", label: "B" },
      { label: "amount" }, // derives to amount_2
    ];
    const rows = [
      { 'weird"key': "row0-A", amount: "row0-B", amount_2: "row0-C" },
      { 'weird"key': "row1-A", amount: "row1-B", amount_2: "row1-C" },
    ];
    const { parsed } = exportAndReparse(cols, rows);

    expect(parsed.columns.map((c) => c.key)).toEqual(['weird"key', "amount", "amount_2"]);
    expect(parsed.rowValuesInColumnOrder(parsed.rows[0])).toEqual(["row0-A", "row0-B", "row0-C"]);
    expect(parsed.rowValuesInColumnOrder(parsed.rows[1])).toEqual(["row1-A", "row1-B", "row1-C"]);
  });

  it("dense derived-vs-explicit collision block reifies with unique keys and stable order", () => {
    const cols: CsvMetadataInput["columns"] = [
      { label: "Amount" },
      { key: "amount_2", label: "Legacy 2" },
      { label: "Amount" },
      { key: 'amount_3"weird', label: "Weird" },
      { label: "Amount" },
      { key: "amount\n5", label: "NL key" },
      { label: "Amount" },
      { label: "amount!" },
    ];
    const { parsed } = exportAndReparse(cols);
    const keys = parsed.columns.map((c) => c.key);

    // Uniqueness + count.
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(cols.length);

    // Every explicit key present verbatim on the map.
    for (const explicit of ["amount_2", 'amount_3"weird', "amount\n5"]) {
      expect(parsed.columnByKey.has(explicit)).toBe(true);
    }

    // Reference: parsed sequence matches the shared derivation helper.
    expect(keys).toEqual(withDerivedColumnKeys(cols).map((c) => c.key));
  });

  it("two independent export → parse cycles produce byte-identical key sequences", () => {
    const cols: CsvMetadataInput["columns"] = [
      { label: "Amount" },
      { key: "amount", label: "Explicit" },
      { label: "Amount" },
      { key: "amount_2", label: "Legacy" },
    ];
    const a = exportAndReparse(cols).parsed.columns.map((c) => c.key);
    const b = exportAndReparse(cols).parsed.columns.map((c) => c.key);
    expect(a).toEqual(b);
  });

  it("filters / sort / page / counts survive parse-back on `meta`", () => {
    const { parsed } = exportAndReparse([{ key: "id", label: "ID" }], [{ id: "1" }], {
      filters: { Status: "Open" },
      sort: { key: "id", dir: "desc" },
      page: { page: 2, totalPages: 5, pageSize: 25 },
      counts: { shown: 25, filtered: 100, total: 500 },
    });
    expect(parsed.meta.filters).toEqual({ Status: "Open" });
    expect(parsed.meta.sort).toEqual({ key: "id", dir: "desc" });
    expect(parsed.meta.page).toEqual({ page: 2, totalPages: 5, pageSize: 25 });
    expect(parsed.meta.counts).toEqual({ shown: 25, filtered: 100, total: 500 });
  });

  it("throws JsonExportParseError with issues when the envelope is malformed", () => {
    // Duplicate keys are impossible from the writer, but hand-edited or
    // corrupted files can carry them — the parser MUST reject rather
    // than silently return a lossy `columnByKey` map.
    const bad = {
      _meta: {
        schema: "precise-realtors.csv-export-metadata",
        version: 1,
        source: "hand-edited",
        generatedAt: new Date().toISOString(),
        columns: [
          { order: 0, key: "a", label: "A" },
          { order: 1, key: "a", label: "A dup" },
        ],
      },
      rows: [],
    };
    let thrown: unknown = null;
    try {
      parseJsonExportEnvelope(bad);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(JsonExportParseError);
    expect((thrown as JsonExportParseError).issues.length).toBeGreaterThan(0);
    expect(JSON.stringify((thrown as JsonExportParseError).issues)).toMatch(/Duplicate column key/);
  });
});
