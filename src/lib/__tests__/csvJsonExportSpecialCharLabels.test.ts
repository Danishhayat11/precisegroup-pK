/**
 * Special-character labels: verify explicit `{ key }` precedence and
 * slugification stay identical between the CSV metadata header and the
 * JSON export envelope. Any drift here silently breaks downstream tools
 * that key data by column name, since a CSV re-import and a JSON
 * ingestor would end up with different column identifiers for the same
 * source dataset.
 *
 * Covers:
 *   - Trailing punctuation: `Amount!`, `Amount?`, `Amount.`
 *   - Symbols: `£Amount`, `€ Amount`, `#Amount`, `$Total`
 *   - Mixed whitespace + punctuation: `  Amount!  `, `Amount / Fee`
 *   - Explicit key precedence in the presence of the above
 */
import { describe, it, expect } from "vitest";
import {
  buildCsvMetadataHeader,
  buildJsonExportMetadata,
  type CsvMetadataInput,
} from "../csvExportMetadata";

const FIXED_DATE = new Date("2026-01-01T00:00:00Z");

function csvKeys(columns: CsvMetadataInput["columns"]): string[] {
  const line = buildCsvMetadataHeader({
    source: "T",
    generatedAt: FIXED_DATE,
    columns,
  }).find((l) => l.startsWith("# Column keys:"));
  return line ? line.replace("# Column keys: ", "").split(",") : [];
}

function jsonKeys(columns: CsvMetadataInput["columns"]): string[] {
  const meta = buildJsonExportMetadata({
    source: "T",
    generatedAt: FIXED_DATE,
    columns,
  });
  return (meta.columns as Array<{ key: string }>).map((c) => c.key);
}

interface Case {
  name: string;
  columns: CsvMetadataInput["columns"];
  expected: string[];
}

const CASES: Case[] = [
  {
    name: "trailing punctuation variants (!, ?, .) all slug to `amount` and dedup left-to-right",
    columns: [{ label: "Amount!" }, { label: "Amount?" }, { label: "Amount." }],
    expected: ["amount", "amount_2", "amount_3"],
  },
  {
    name: "currency prefixes strip cleanly (£Amount, €Amount, $Amount)",
    columns: [{ label: "£Amount" }, { label: "€Amount" }, { label: "$Amount" }],
    expected: ["amount", "amount_2", "amount_3"],
  },
  {
    name: "hash + dollar prefix collide on `amount` / `total` bases",
    columns: [{ label: "#Amount" }, { label: "$Total" }, { label: "Total" }],
    expected: ["amount", "total", "total_2"],
  },
  {
    name: "internal separators collapse (`Amount / Fee`, `Amount - Fee`, `Amount & Fee`)",
    columns: [{ label: "Amount / Fee" }, { label: "Amount - Fee" }, { label: "Amount & Fee" }],
    expected: ["amount_fee", "amount_fee_2", "amount_fee_3"],
  },
  {
    name: "whitespace + punctuation trims to the same base",
    columns: [{ label: "  Amount!  " }, { label: "Amount?" }, { label: " amount " }],
    expected: ["amount", "amount_2", "amount_3"],
  },
  {
    name: "explicit key beats punctuation-slug collision — explicit first",
    columns: [{ key: "amount", label: "Explicit" }, { label: "Amount!" }, { label: "€Amount" }],
    expected: ["amount", "amount_2", "amount_3"],
  },
  {
    name: "explicit key beats punctuation-slug collision — explicit last",
    columns: [
      { label: "Amount!" },
      { label: "£Amount" },
      { key: "amount", label: "Explicit Last" },
    ],
    // Left-to-right: Amount! → amount; £Amount → amount_2; explicit
    // `amount` is taken → bumps to amount_3.
    expected: ["amount", "amount_2", "amount_3"],
  },
  {
    name: "explicit `amount_2` races a `£Amount` label that would derive to `amount_2`",
    columns: [
      { label: "Amount!" }, // → amount
      { key: "amount_2", label: "Legacy Two" }, // literal amount_2
      { label: "£Amount" }, // derived amount_2 taken → amount_3
    ],
    expected: ["amount", "amount_2", "amount_3"],
  },
  {
    name: "explicit key with non-slug characters is preserved VERBATIM (not re-slugified)",
    // The explicit key is trusted as-is: even though slugifier would
    // never emit `Amount!` on its own, an explicit caller supplying it
    // must get exactly that string back.
    columns: [{ key: "Amount!", label: "Legacy" }, { label: "Amount!" }],
    expected: ["Amount!", "amount"],
  },
];

describe("special-character labels — CSV/JSON parity + explicit key precedence", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const csv = csvKeys(c.columns);
      const json = jsonKeys(c.columns);
      expect(csv).toEqual(c.expected);
      expect(json).toEqual(c.expected);
      // Parity is the whole point of the suite — assert it separately
      // so a future regression that shifts BOTH exporters in lock-step
      // still surfaces as "expected drift" rather than passing silently.
      expect(csv).toEqual(json);
      // Uniqueness invariant.
      expect(new Set(csv).size).toBe(csv.length);
    });
  }

  it("labels made ENTIRELY of special characters fall back to `column` base", () => {
    // No alphanumerics anywhere → slugifier returns `column`. Dedup then
    // walks column, column_2, column_3.
    const columns = [{ label: "!!!" }, { label: "£€$" }, { label: "—" }];
    expect(csvKeys(columns)).toEqual(["column", "column_2", "column_3"]);
    expect(jsonKeys(columns)).toEqual(["column", "column_2", "column_3"]);
  });

  it("explicit key wins even when its own label is pure symbols", () => {
    const columns = [
      { key: "net_amount", label: "£" }, // explicit survives; label kept verbatim (trimmed)
      { label: "Net Amount" }, // slug net_amount → taken → net_amount_2
    ];
    expect(csvKeys(columns)).toEqual(["net_amount", "net_amount_2"]);
    expect(jsonKeys(columns)).toEqual(["net_amount", "net_amount_2"]);
  });
});
