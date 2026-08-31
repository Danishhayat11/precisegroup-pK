import { describe, it, expect } from "vitest";
import { buildCsvMetadataHeader, buildJsonExportMetadata } from "../csvExportMetadata";

/**
 * Parity tests: `buildCsvMetadataHeader` and `buildJsonExportMetadata`
 * share the SAME `withDerivedColumnKeys` helper for dedup + suffixing,
 * but they serialise the result through two different code paths:
 *
 *   - CSV: `# Column keys: a,b,c` comment line inside the header block
 *   - JSON: `_meta.columns[].key` array inside the envelope
 *
 * If either code path ever reshapes the keys — extra suffix, different
 * order, dropped column, filtered dedup counter — one exporter will
 * silently drift from the other. Every scenario in this file runs the
 * same input through both exporters and asserts the emitted key arrays
 * are byte-for-byte identical. Labels get the same treatment.
 */

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

/** Read the ordered keys emitted by the CSV metadata block. */
function csvKeys(columns: Parameters<typeof buildCsvMetadataHeader>[0]["columns"]): string[] {
  const line = buildCsvMetadataHeader({
    source: "X",
    generatedAt: FIXED_DATE,
    columns,
  }).find((l) => l.startsWith("# Column keys:"));
  return line ? line.replace("# Column keys: ", "").split(",") : [];
}

/** Read the ordered labels emitted by the CSV `# Columns (…):` line. */
function csvLabels(columns: Parameters<typeof buildCsvMetadataHeader>[0]["columns"]): string[] {
  const line = buildCsvMetadataHeader({
    source: "X",
    generatedAt: FIXED_DATE,
    columns,
  }).find((l) => l.startsWith("# Columns ("));
  return line ? line.replace(/^# Columns \(\d+, in order\): /, "").split(" | ") : [];
}

/** Read the ordered keys emitted by the JSON envelope. */
function jsonKeys(columns: Parameters<typeof buildJsonExportMetadata>[0]["columns"]): string[] {
  const meta = buildJsonExportMetadata({
    source: "X",
    generatedAt: FIXED_DATE,
    columns,
  });
  const cols = (meta.columns as Array<{ key: string }> | undefined) ?? [];
  return cols.map((c) => c.key);
}

/** Read the ordered labels emitted by the JSON envelope. */
function jsonLabels(columns: Parameters<typeof buildJsonExportMetadata>[0]["columns"]): string[] {
  const meta = buildJsonExportMetadata({
    source: "X",
    generatedAt: FIXED_DATE,
    columns,
  });
  const cols = (meta.columns as Array<{ label: string }> | undefined) ?? [];
  return cols.map((c) => c.label);
}

describe("CSV ↔ JSON exporter parity — dedup + suffixing rules", () => {
  const scenarios: Array<{
    name: string;
    columns: Parameters<typeof buildCsvMetadataHeader>[0]["columns"];
    expectedKeys: string[];
    expectedLabels: string[];
  }> = [
    {
      name: "no collisions — plain string labels slugify 1:1",
      columns: ["Amount", "Sold Date", "Client Name"],
      expectedKeys: ["amount", "sold_date", "client_name"],
      expectedLabels: ["Amount", "Sold Date", "Client Name"],
    },
    {
      name: "two label-only siblings collide → base, base_2",
      columns: [{ label: "Amount" }, { label: "Amount" }],
      expectedKeys: ["amount", "amount_2"],
      expectedLabels: ["Amount", "Amount"],
    },
    {
      name: "five label-only siblings collide → base, _2, _3, _4, _5",
      columns: Array.from({ length: 5 }, () => ({ label: "Amount" })),
      expectedKeys: ["amount", "amount_2", "amount_3", "amount_4", "amount_5"],
      expectedLabels: ["Amount", "Amount", "Amount", "Amount", "Amount"],
    },
    {
      name: "case-insensitive collision (Amount / amount / AMOUNT)",
      columns: [{ label: "Amount" }, { label: "amount" }, { label: "AMOUNT" }],
      expectedKeys: ["amount", "amount_2", "amount_3"],
      expectedLabels: ["Amount", "amount", "AMOUNT"],
    },
    {
      name: "punctuation collision (Amount, amount!, AMOUNT?)",
      columns: [{ label: "Amount" }, { label: "amount!" }, { label: "AMOUNT?" }],
      expectedKeys: ["amount", "amount_2", "amount_3"],
      expectedLabels: ["Amount", "amount!", "AMOUNT?"],
    },
    {
      name: "explicit key wins the base slot over a colliding label",
      columns: [{ key: "amount", label: "Cash" }, { label: "Amount" }],
      expectedKeys: ["amount", "amount_2"],
      expectedLabels: ["Cash", "Amount"],
    },
    {
      name: "label first, later explicit key shifts to _2",
      columns: [{ label: "Amount" }, { key: "amount", label: "Cash" }],
      expectedKeys: ["amount", "amount_2"],
      expectedLabels: ["Amount", "Cash"],
    },
    {
      name: "two explicit 'amount' + one label 'Amount' → base, _2, _3",
      columns: [
        { key: "amount", label: "Cash" },
        { key: "amount", label: "Bank" },
        { label: "Amount" },
      ],
      expectedKeys: ["amount", "amount_2", "amount_3"],
      expectedLabels: ["Cash", "Bank", "Amount"],
    },
    {
      name: "literal-suffix collision: [Amount, amount!, amount_2] → base bumps past the literal",
      columns: [{ label: "Amount" }, { label: "amount!" }, { label: "amount_2" }],
      expectedKeys: ["amount", "amount_2", "amount_2_2"],
      expectedLabels: ["Amount", "amount!", "amount_2"],
    },
    {
      name: "unicode-only labels collapse to 'column' base and dedupe",
      columns: [{ label: "北京" }, { label: "☕" }, { label: "—" }],
      expectedKeys: ["column", "column_2", "column_3"],
      expectedLabels: ["北京", "☕", "—"],
    },
    {
      name: "explicit key + unicode-only sibling",
      columns: [{ key: "city", label: "北京" }, { label: "☕" }],
      expectedKeys: ["city", "column"],
      expectedLabels: ["北京", "☕"],
    },
    {
      name: "mixed string + object entries preserve declaration order",
      columns: ["Project", { key: "pid", label: "Project ID" }, { label: "Project" }],
      expectedKeys: ["project", "pid", "project_2"],
      expectedLabels: ["Project", "Project ID", "Project"],
    },
    {
      name: "blank label with an explicit key uses the key as the label (both exporters)",
      columns: [{ key: "amount", label: "   " }, { label: "Amount" }],
      expectedKeys: ["amount", "amount_2"],
      expectedLabels: ["amount", "Amount"],
    },
    {
      name: "diacritics + emoji: slug strips non-ASCII, labels round-trip verbatim",
      columns: [
        { label: "café" },
        { label: "naïve" },
        { label: "Amount 💰" },
        { label: "日本語 2026" },
      ],
      expectedKeys: ["caf", "na_ve", "amount", "2026"],
      expectedLabels: ["café", "naïve", "Amount 💰", "日本語 2026"],
    },
  ];

  for (const { name, columns, expectedKeys, expectedLabels } of scenarios) {
    it(`CSV & JSON emit the same keys — ${name}`, () => {
      const fromCsv = csvKeys(columns);
      const fromJson = jsonKeys(columns);
      // Assert against the expected value FIRST so a regression names
      // the offending key sequence directly; then cross-check the two
      // exporters against each other so the parity failure is visible
      // even if the expected shape itself drifts.
      expect(fromCsv).toEqual(expectedKeys);
      expect(fromJson).toEqual(expectedKeys);
      expect(fromCsv).toEqual(fromJson);
    });

    it(`CSV & JSON emit the same labels — ${name}`, () => {
      const fromCsv = csvLabels(columns);
      const fromJson = jsonLabels(columns);
      expect(fromCsv).toEqual(expectedLabels);
      expect(fromJson).toEqual(expectedLabels);
      expect(fromCsv).toEqual(fromJson);
    });
  }

  it("key count always equals column count in both exporters", () => {
    for (const { columns } of scenarios) {
      const n = columns!.length;
      expect(csvKeys(columns)).toHaveLength(n);
      expect(jsonKeys(columns)).toHaveLength(n);
    }
  });

  it("every emitted key is unique in both exporters across every scenario", () => {
    for (const { name, columns } of scenarios) {
      const c = csvKeys(columns);
      const j = jsonKeys(columns);
      expect(new Set(c).size, `${name} — CSV keys`).toBe(c.length);
      expect(new Set(j).size, `${name} — JSON keys`).toBe(j.length);
    }
  });

  it("both exporters throw for the same invalid inputs with the same error code", () => {
    const invalidInputs: Array<{
      name: string;
      columns: Parameters<typeof buildCsvMetadataHeader>[0]["columns"];
      code: string;
    }> = [
      { name: "null entry", columns: [{ label: "OK" }, null as never], code: "empty-column-entry" },
      { name: "blank label", columns: [{ label: "" }], code: "empty-column-label" },
      { name: "whitespace label", columns: [{ label: "   " }], code: "empty-column-label" },
      {
        name: "whitespace-only explicit key",
        columns: [{ key: "  ", label: "Amount" }],
        code: "empty-column-key",
      },
    ];
    for (const { name, columns, code } of invalidInputs) {
      let csvErr: unknown;
      let jsonErr: unknown;
      try {
        buildCsvMetadataHeader({ source: "X", generatedAt: FIXED_DATE, columns });
      } catch (e) {
        csvErr = e;
      }
      try {
        buildJsonExportMetadata({ source: "X", generatedAt: FIXED_DATE, columns });
      } catch (e) {
        jsonErr = e;
      }
      expect(csvErr, `${name} — CSV must throw`).toBeDefined();
      expect(jsonErr, `${name} — JSON must throw`).toBeDefined();
      expect((csvErr as { code: string }).code, `${name} — CSV code`).toBe(code);
      expect((jsonErr as { code: string }).code, `${name} — JSON code`).toBe(code);
      expect((csvErr as { columnIndex: number }).columnIndex).toBe(
        (jsonErr as { columnIndex: number }).columnIndex,
      );
    }
  });
});
