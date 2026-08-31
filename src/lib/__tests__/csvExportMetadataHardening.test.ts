/**
 * Contract test for malformed metadata handling in production.
 *
 * The metadata builders split malformed input into two buckets, and the
 * boundary must be identical between the CSV and JSON code paths so a
 * consumer can rely on either format failing the same way:
 *
 *   • FAIL-FAST (throw `CsvExportMetadataError`) — structural fields
 *     that anchor the block:
 *       - blank / non-string `source`
 *       - `sort.dir` not "asc"/"desc"
 *       - `page.{page,totalPages,pageSize}` non-integer / < 1
 *       - every previously-covered `columns` error
 *
 *   • SILENTLY EXCLUDE — row-shaped fields:
 *       - `extra` / `filters` entries with a blank key, or wire-hostile
 *         characters (`\r`, `\n`, `|`, `=` in filter keys, `:` in extra
 *         keys) in the key OR the value
 *       - `counts` buckets that aren't finite non-negative integers
 *
 * A regression that flips exclusion↔throw for the SAME input in one
 * format but not the other would silently corrupt exports in the wild.
 */
import { describe, it, expect } from "vitest";
import {
  buildCsvMetadataHeader,
  buildJsonExportMetadata,
  CsvExportMetadataError,
  type CsvMetadataInput,
} from "../csvExportMetadata";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");
const BASE = { source: "Hardening", generatedAt: FIXED_DATE } satisfies Partial<CsvMetadataInput>;

/** Assert BOTH builders throw with the same `CsvExportMetadataError.code`. */
function expectBothThrow(input: CsvMetadataInput, code: CsvExportMetadataError["code"]) {
  const grab = (fn: () => unknown) => {
    try {
      fn();
      return null;
    } catch (e) {
      return e;
    }
  };
  const csvErr = grab(() => buildCsvMetadataHeader(input));
  const jsonErr = grab(() => buildJsonExportMetadata(input));
  expect(csvErr, "CSV must throw").toBeInstanceOf(CsvExportMetadataError);
  expect(jsonErr, "JSON must throw").toBeInstanceOf(CsvExportMetadataError);
  expect((csvErr as CsvExportMetadataError).code).toBe(code);
  expect((jsonErr as CsvExportMetadataError).code).toBe(code);
}

/** Read the JSON envelope's field, defaulting undefined to null for equality. */
function jsonField(
  input: CsvMetadataInput,
  field: keyof ReturnType<typeof buildJsonExportMetadata>,
) {
  return (buildJsonExportMetadata(input) as Record<string, unknown>)[field] ?? null;
}

describe("CSV/JSON metadata hardening — fail-fast codes", () => {
  it.each<[string, CsvMetadataInput]>([
    ["blank string source", { ...BASE, source: "" }],
    ["whitespace-only source", { ...BASE, source: "   " }],
    ["non-string source", { ...BASE, source: 42 as unknown as string }],
  ])("blank-source: %s", (_name, input) => expectBothThrow(input, "blank-source"));

  it.each<[string, CsvMetadataInput]>([
    ["dir='sideways'", { ...BASE, sort: { key: "amount", dir: "sideways" as never } }],
    ["dir=''", { ...BASE, sort: { key: "amount", dir: "" as never } }],
    ["dir=null", { ...BASE, sort: { key: "amount", dir: null as never } }],
  ])("invalid-sort-direction: %s", (_n, input) => expectBothThrow(input, "invalid-sort-direction"));

  it.each<[string, CsvMetadataInput]>([
    ["page=0", { ...BASE, page: { page: 0, totalPages: 1, pageSize: 25 } }],
    ["page=-1", { ...BASE, page: { page: -1, totalPages: 1, pageSize: 25 } }],
    ["page=1.5", { ...BASE, page: { page: 1.5, totalPages: 1, pageSize: 25 } }],
    ["page=NaN", { ...BASE, page: { page: NaN, totalPages: 1, pageSize: 25 } }],
    ["totalPages=0", { ...BASE, page: { page: 1, totalPages: 0, pageSize: 25 } }],
    ["pageSize=Infinity", { ...BASE, page: { page: 1, totalPages: 1, pageSize: Infinity } }],
  ])("invalid-page-number: %s", (_n, input) => expectBothThrow(input, "invalid-page-number"));

  it("empty-column-label still throws (regression check for the pre-hardening contract)", () => {
    expectBothThrow({ ...BASE, columns: [{ label: "" }] }, "empty-column-label");
  });
});

describe("CSV/JSON metadata hardening — silent exclusion", () => {
  it("filter keys with `|`, `=`, `\\n`, `\\r` are dropped; clean entries survive", () => {
    const input: CsvMetadataInput = {
      ...BASE,
      filters: {
        keep: "yes",
        "bad|pipe": "x",
        "bad=eq": "x",
        "bad\nnewline": "x",
        "bad\rcarriage": "x",
        "  ": "x", // blank after trim
      },
    };
    const csvLines = buildCsvMetadataHeader(input);
    const jsonFilters = jsonField(input, "filters") as Record<string, unknown> | null;
    const filtersLine = csvLines.find((l) => l.startsWith("# Filters:")) ?? "";
    expect(filtersLine).toBe("# Filters: keep=yes");
    expect(jsonFilters).toEqual({ keep: "yes" });
  });

  it("filter values with `|`, `\\n`, `\\r` are dropped; `=` in values is preserved", () => {
    const input: CsvMetadataInput = {
      ...BASE,
      filters: {
        equation: "a=b+c", // legal (`=` in value)
        pipe: "a|b", // corrupts pipe separator → drop
        newline: "line1\nline2", // corrupts line-oriented block → drop
      },
    };
    const csvLines = buildCsvMetadataHeader(input);
    const jsonFilters = jsonField(input, "filters") as Record<string, unknown> | null;
    expect(csvLines.find((l) => l.startsWith("# Filters:"))).toBe("# Filters: equation=a=b+c");
    expect(jsonFilters).toEqual({ equation: "a=b+c" });
  });

  it("extra keys with `:`, `\\n`, `\\r` are dropped; extras with legal `:` in VALUE survive", () => {
    const input: CsvMetadataInput = {
      ...BASE,
      extra: {
        Build: "abc123", // clean
        "bad:colon": "x", // key has `:`, would collide with the `# k: v` separator
        "bad\nnl": "x",
        Region: "eu-west-1:az-a", // `:` in VALUE is fine (parser uses first `:`)
      },
    };
    const csvLines = buildCsvMetadataHeader(input);
    const jsonExtra = jsonField(input, "extra") as Record<string, unknown> | null;
    expect(csvLines.filter((l) => l.startsWith("# Build") || l.startsWith("# Region"))).toEqual([
      "# Build: abc123",
      "# Region: eu-west-1:az-a",
    ]);
    expect(csvLines.some((l) => l.includes("bad"))).toBe(false);
    expect(jsonExtra).toEqual({ Build: "abc123", Region: "eu-west-1:az-a" });
  });

  it("counts buckets that aren't finite non-negative integers are dropped", () => {
    const input: CsvMetadataInput = {
      ...BASE,
      counts: {
        shown: 10, // keep
        filtered: NaN, // drop
        total: -1, // drop (negative)
      },
    };
    const csvLines = buildCsvMetadataHeader(input);
    const jsonCounts = jsonField(input, "counts") as Record<string, unknown> | null;
    expect(csvLines.find((l) => l.startsWith("# Rows:"))).toBe("# Rows: 10 shown");
    expect(jsonCounts).toEqual({ shown: 10 });
  });

  it("counts with ALL buckets bad → the whole `# Rows:` line and `counts` key are omitted", () => {
    const input: CsvMetadataInput = {
      ...BASE,
      counts: { shown: NaN, filtered: Infinity, total: 1.5 },
    };
    const csvLines = buildCsvMetadataHeader(input);
    expect(csvLines.some((l) => l.startsWith("# Rows:"))).toBe(false);
    expect(jsonField(input, "counts")).toBeNull();
  });

  it("sentinel filter values ('all', '', null) are STILL dropped after hardening", () => {
    // Regression: hardening must not accidentally start emitting sentinel
    // values that `isMeaningful` used to drop.
    const input: CsvMetadataInput = {
      ...BASE,
      filters: { keep: "yes", drop_all: "all", drop_blank: "", drop_null: null },
    };
    expect(buildCsvMetadataHeader(input).find((l) => l.startsWith("# Filters:"))).toBe(
      "# Filters: keep=yes",
    );
    expect(jsonField(input, "filters")).toEqual({ keep: "yes" });
  });
});
