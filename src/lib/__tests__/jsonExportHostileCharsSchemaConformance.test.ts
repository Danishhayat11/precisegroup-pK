/**
 * Integration test: every hostile-character column configuration from
 * `jsonExportHostileCharsIntegration.test.ts` must produce a JSON
 * envelope that conforms to `jsonExportEnvelopeSchema`.
 *
 * This closes the loop between the free-form invariants asserted in
 * that suite (unique keys, verbatim explicit keys, etc.) and a
 * machine-checkable schema downstream tooling can pin to. If the
 * envelope shape drifts — extra field, wrong `order` sequence,
 * duplicate keys, missing `schema`/`version` — this suite fails.
 *
 * Every scenario:
 *   1. Serialises via `JSON.stringify` (the real download path).
 *   2. Parses via `JSON.parse` (the real reader path).
 *   3. Validates via `jsonExportEnvelopeSchema.safeParse` and asserts
 *      `success === true`. On failure the whole zod issue list is
 *      surfaced so a regression is diagnosable at a glance.
 */
import { describe, it, expect } from "vitest";
import { buildJsonExportMetadata, type CsvMetadataInput } from "../csvExportMetadata";
import { jsonExportEnvelopeSchema } from "../jsonExportEnvelopeSchema";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

/** Build the full envelope + serialise + parse + schema-validate. */
function validate(input: CsvMetadataInput, rows: Array<Record<string, unknown>> = []) {
  const envelope = { _meta: buildJsonExportMetadata(input), rows };
  const parsed = JSON.parse(JSON.stringify(envelope));
  const result = jsonExportEnvelopeSchema.safeParse(parsed);
  return { parsed, result };
}

function baseInput(columns: CsvMetadataInput["columns"]): CsvMetadataInput {
  return {
    source: "JSON export — hostile chars",
    generatedAt: FIXED_DATE,
    columns,
  };
}

describe("JSON export envelope schema — hostile-chars conformance", () => {
  it("explicit keys with quotes / newlines / tabs / backslash / unicode conform", () => {
    const { result } = validate(
      baseInput([
        { key: 'weird"key', label: "Label A" },
        { key: "multi\nline\rkey", label: "Label B" },
        { key: "tab\tkey", label: "Label C" },
        { key: "back\\slash", label: "Label D" },
        { key: "unicode—✓🚀", label: "Label E" },
        { key: "amount_2", label: "Explicit collision" },
      ]),
    );
    expect(result.success, JSON.stringify(result.error?.issues, null, 2)).toBe(true);
  });

  it("hostile-char labels (quotes / newlines / tabs / unicode) conform", () => {
    const { result } = validate(
      baseInput([
        { key: "a", label: 'Label with "quotes"' },
        { key: "b", label: "Label\nwith\nnewlines" },
        { key: "c", label: "Label\twith\ttabs" },
        { key: "d", label: "Label with \\ backslash and — em-dash" },
        { key: "e", label: 'Mixed "punct" — 中文 🚀\nnewline' },
      ]),
    );
    expect(result.success, JSON.stringify(result.error?.issues, null, 2)).toBe(true);
  });

  it("explicit-key precedence collision block conforms and keys stay unique", () => {
    const { parsed, result } = validate(
      baseInput([
        { key: 'amount"\n2', label: "First — explicit weird key" },
        { key: "amount", label: "Explicit amount" },
        { label: "Amount" },
        { label: "Amount" },
      ]),
    );
    expect(result.success, JSON.stringify(result.error?.issues, null, 2)).toBe(true);
    const keys = (parsed as { _meta: { columns: Array<{ key: string }> } })._meta.columns.map(
      (c) => c.key,
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('amount"\n2');
    expect(keys).toContain("amount");
  });

  it("dense adversarial mix of derived siblings and hostile explicit keys conforms", () => {
    const { result } = validate(
      baseInput([
        { label: "Amount" },
        { key: "amount_2", label: "Legacy 2" },
        { label: "Amount" },
        { key: 'amount_3"weird', label: "Weird" },
        { label: "Amount" },
        { key: "amount\n5", label: "NL key" },
        { label: "Amount" },
        { label: "amount!" },
      ]),
    );
    expect(result.success, JSON.stringify(result.error?.issues, null, 2)).toBe(true);
  });

  it("full envelope with hostile keys AND rows keyed by those hostile keys conforms", () => {
    const columns: CsvMetadataInput["columns"] = [
      { key: 'k"1', label: 'l"1' },
      { key: "k\n2", label: "l\n2" },
    ];
    const { result } = validate(baseInput(columns), [
      { 'k"1': "row-0-a", "k\n2": "row-0-b" },
      { 'k"1': "row-1-a", "k\n2": "row-1-b" },
    ]);
    expect(result.success, JSON.stringify(result.error?.issues, null, 2)).toBe(true);
  });

  it("full-fat envelope (filters + sort + page + counts + hostile columns) conforms", () => {
    const { result } = validate({
      source: "Ledger — Hostile",
      generatedAt: FIXED_DATE,
      filters: { Status: "Open", 'weird"filter': "value\twith tab" },
      sort: { key: "postedAt", dir: "desc" },
      page: { page: 2, totalPages: 7, pageSize: 25 },
      counts: { shown: 25, filtered: 175, total: 500 },
      columns: [
        { key: 'weird"key', label: "Label A" },
        { key: "amount", label: "Amount" },
        { label: "Amount" }, // → amount_2
      ],
    });
    expect(result.success, JSON.stringify(result.error?.issues, null, 2)).toBe(true);
  });

  it("schema REJECTS a tampered envelope (proves the check has teeth)", () => {
    // Sanity: if a downstream consumer mutates the payload to introduce
    // a duplicate key, the schema must flag it. Without this negative
    // case the passing tests above prove nothing.
    const envelope = {
      _meta: buildJsonExportMetadata(
        baseInput([
          { key: "a", label: "A" },
          { key: "b", label: "B" },
        ]),
      ),
      rows: [] as Array<Record<string, unknown>>,
    };
    const tampered = JSON.parse(JSON.stringify(envelope)) as {
      _meta: { columns: Array<{ order: number; key: string; label: string }> };
    };
    tampered._meta.columns[1].key = "a"; // force a duplicate
    const result = jsonExportEnvelopeSchema.safeParse(tampered);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/Duplicate column key/);
  });
});
