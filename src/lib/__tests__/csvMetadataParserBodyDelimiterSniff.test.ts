/**
 * Tests for `parseCsvMetadataHeader`'s auto-detected `bodyDelimiter`.
 *
 * The metadata header itself is delimiter-agnostic — every downstream
 * caller that wants to parse the DATA rows below the header used to
 * have to be told which delimiter to use. This suite pins the new
 * `bodyDelimiter` field's contract:
 *
 *   1. Comma, semicolon, tab, and pipe bodies each sniff to the right
 *      delimiter, whether the file carries a metadata block or is a
 *      plain CSV with no `#` lines at all.
 *   2. Quoted cells that contain a rival delimiter don't bias the
 *      sniffer — an unquoted `,` beats a quoted `;`.
 *   3. Ties at a non-zero count resolve in preference order
 *      `, > ; > \t > |` (matches the historical assumption).
 *   4. A single-column body (no delimiter present) returns `null`.
 *   5. An empty file / metadata-only file returns `null`.
 *   6. Sniffer skips blank lines between the metadata block and the
 *      first real body line.
 */
import { describe, it, expect } from "vitest";
import { parseCsvMetadataHeader } from "../csvMetadataParser";
import { prefixCsvWithMetadata, type CsvMetadataInput } from "../csvExportMetadata";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

const baseInput: CsvMetadataInput = {
  source: "Delimiter sniff",
  generatedAt: FIXED_DATE,
  columns: [
    { key: "a", label: "A" },
    { key: "b", label: "B" },
    { key: "c", label: "C" },
  ],
};

function withBody(body: string): string {
  return prefixCsvWithMetadata(body, baseInput);
}

describe("parseCsvMetadataHeader — bodyDelimiter auto-detection", () => {
  it("detects comma", () => {
    expect(parseCsvMetadataHeader(withBody("A,B,C\n1,2,3\n")).bodyDelimiter).toBe(",");
  });

  it("detects semicolon", () => {
    expect(parseCsvMetadataHeader(withBody("A;B;C\n1;2;3\n")).bodyDelimiter).toBe(";");
  });

  it("detects tab", () => {
    expect(parseCsvMetadataHeader(withBody("A\tB\tC\n1\t2\t3\n")).bodyDelimiter).toBe("\t");
  });

  it("detects pipe", () => {
    expect(parseCsvMetadataHeader(withBody("A|B|C\n1|2|3\n")).bodyDelimiter).toBe("|");
  });

  it("works on a plain CSV with no metadata header at all", () => {
    const parsed = parseCsvMetadataHeader("A;B;C\n1;2;3\n");
    expect(parsed.bodyDelimiter).toBe(";");
    expect(parsed.bodyStartIndex).toBe(0);
    expect(parsed.source).toBeNull();
  });

  it("quoted cells containing a rival delimiter do not bias the sniffer", () => {
    // Unquoted `,` (real delimiter) count = 2; quoted `;` (in-cell)
    // count = 3. Sniffer must ignore the quoted region and pick `,`.
    const body = `A,B,C\n"has;three;semicolons",2,3\n`;
    expect(parseCsvMetadataHeader(withBody(body)).bodyDelimiter).toBe(",");
  });

  it("ties at a non-zero count resolve in preference order (`, > ; > \\t > |`)", () => {
    // Header row has exactly one of each candidate — comma must win.
    const body = "a,b;c\td|e\n1,2;3\t4|5\n";
    expect(parseCsvMetadataHeader(withBody(body)).bodyDelimiter).toBe(",");
  });

  it("single-column body has no delimiter to detect → null", () => {
    expect(parseCsvMetadataHeader(withBody("only\n1\n2\n")).bodyDelimiter).toBeNull();
  });

  it("metadata-only file (no body) → null", () => {
    const metaOnly = withBody("").replace(/\n+$/, "\n");
    expect(parseCsvMetadataHeader(metaOnly).bodyDelimiter).toBeNull();
  });

  it("empty input → null", () => {
    expect(parseCsvMetadataHeader("").bodyDelimiter).toBeNull();
  });

  it("skips blank lines between metadata and the first real body line", () => {
    const csv = withBody("").replace(/\n$/, "") + "\n\n\nA;B;C\n1;2;3\n";
    expect(parseCsvMetadataHeader(csv).bodyDelimiter).toBe(";");
  });

  it("does not affect existing metadata parsing (source / columns / bodyStartIndex)", () => {
    const parsed = parseCsvMetadataHeader(withBody("A\tB\tC\n1\t2\t3\n"));
    expect(parsed.source).toBe("Delimiter sniff");
    expect(parsed.columns).toEqual([
      { key: "a", label: "A" },
      { key: "b", label: "B" },
      { key: "c", label: "C" },
    ]);
    // Body starts AFTER the blank separator between metadata and data.
    const bodyLines = withBody("A\tB\tC\n1\t2\t3\n").split("\n").slice(parsed.bodyStartIndex);
    expect(bodyLines[0]).toBe("A\tB\tC");
  });
});
