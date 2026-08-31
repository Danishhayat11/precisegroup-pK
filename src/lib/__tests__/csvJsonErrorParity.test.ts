/**
 * Error-parity contract: for EVERY malformed metadata input, the CSV
 * writer (`buildCsvMetadataHeader` / `prefixCsvWithMetadata`) and the
 * JSON writer (`buildJsonExportMetadata`) MUST throw the same
 * `CsvExportMetadataError` with identical structured payload fields:
 *
 *   - `name`         → always "CsvExportMetadataError"
 *   - `code`         → one of the seven documented codes
 *   - `columnIndex`  → `-1` for structural errors; the offending
 *                       column's 0-based index for column errors
 *   - `message`      → byte-identical
 *
 * This guarantees callers can pattern-match on `code`/`columnIndex`
 * without branching on which serialiser they invoked, and that a bug
 * in one writer's validation path (e.g. skipping a check) fails loudly
 * against the other writer's payload.
 */
import { describe, it, expect } from "vitest";
import {
  buildCsvMetadataHeader,
  buildJsonExportMetadata,
  CsvExportMetadataError,
  type CsvMetadataInput,
} from "../csvExportMetadata";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

/**
 * Invoke the writer and return the thrown error's structured payload,
 * or `null` if no error was thrown. Any non-`CsvExportMetadataError`
 * exception is re-thrown so the test fails loudly instead of masking
 * a different bug behind the parity check.
 */
function capture(writer: (input: CsvMetadataInput) => unknown, input: CsvMetadataInput) {
  try {
    writer(input);
    return null;
  } catch (err) {
    if (err instanceof CsvExportMetadataError) {
      return {
        name: err.name,
        code: err.code,
        columnIndex: err.columnIndex,
        message: err.message,
      };
    }
    throw err;
  }
}

/**
 * Fixture spec: label + minimal malformed input + expected code +
 * expected columnIndex. `message` equality is asserted separately from
 * the code/index pair so a diff on message alone still fails loudly.
 */
type Fixture = {
  label: string;
  input: CsvMetadataInput;
  expectedCode: CsvExportMetadataError["code"];
  expectedColumnIndex: number;
};

const BASE = { source: "OK", generatedAt: FIXED_DATE } as const;

const FIXTURES: Fixture[] = [
  // ---- Structural fields (columnIndex = -1) ------------------------
  {
    label: "blank-source: empty string",
    input: { ...BASE, source: "" },
    expectedCode: "blank-source",
    expectedColumnIndex: -1,
  },
  {
    label: "blank-source: whitespace-only string",
    input: { ...BASE, source: "   " },
    expectedCode: "blank-source",
    expectedColumnIndex: -1,
  },
  {
    label: "blank-source: non-string source",
    // @ts-expect-error — intentional invalid input
    input: { ...BASE, source: 42 },
    expectedCode: "blank-source",
    expectedColumnIndex: -1,
  },
  {
    label: "invalid-sort-direction: unknown direction",
    input: {
      ...BASE,
      // @ts-expect-error — intentional invalid input
      sort: { key: "amount", dir: "ascending" },
    },
    expectedCode: "invalid-sort-direction",
    expectedColumnIndex: -1,
  },
  {
    label: "invalid-sort-direction: null direction",
    input: {
      ...BASE,
      // @ts-expect-error — intentional invalid input
      sort: { key: "amount", dir: null },
    },
    expectedCode: "invalid-sort-direction",
    expectedColumnIndex: -1,
  },
  {
    label: "invalid-page-number: page is zero",
    input: {
      ...BASE,
      page: { page: 0, totalPages: 1, pageSize: 25 },
    },
    expectedCode: "invalid-page-number",
    expectedColumnIndex: -1,
  },
  {
    label: "invalid-page-number: totalPages is negative",
    input: {
      ...BASE,
      page: { page: 1, totalPages: -1, pageSize: 25 },
    },
    expectedCode: "invalid-page-number",
    expectedColumnIndex: -1,
  },
  {
    label: "invalid-page-number: pageSize is a float",
    input: {
      ...BASE,
      page: { page: 1, totalPages: 1, pageSize: 25.5 },
    },
    expectedCode: "invalid-page-number",
    expectedColumnIndex: -1,
  },
  {
    label: "invalid-page-number: pageSize is NaN",
    input: {
      ...BASE,
      page: { page: 1, totalPages: 1, pageSize: Number.NaN },
    },
    expectedCode: "invalid-page-number",
    expectedColumnIndex: -1,
  },
  // ---- Column-shape errors (columnIndex = position) ----------------
  {
    label: "empty-column-entry: null at index 0",
    input: { ...BASE, columns: [null] as unknown as CsvMetadataInput["columns"] },
    expectedCode: "empty-column-entry",
    expectedColumnIndex: 0,
  },
  {
    label: "empty-column-entry: undefined at index 2 (after two valid siblings)",
    input: {
      ...BASE,
      columns: [
        { label: "A" },
        { label: "B" },
        undefined,
      ] as unknown as CsvMetadataInput["columns"],
    },
    expectedCode: "empty-column-entry",
    expectedColumnIndex: 2,
  },
  {
    label: "empty-column-key: explicit key is whitespace-only",
    input: {
      ...BASE,
      columns: [{ key: "   ", label: "Total" }],
    },
    expectedCode: "empty-column-key",
    expectedColumnIndex: 0,
  },
  {
    label: "empty-column-key: whitespace-only key at index 1",
    input: {
      ...BASE,
      columns: [{ label: "A" }, { key: " ", label: "B" }],
    },
    expectedCode: "empty-column-key",
    expectedColumnIndex: 1,
  },
  {
    label: "empty-column-label: no key AND blank label",
    input: {
      ...BASE,
      columns: [{ label: "" }],
    },
    expectedCode: "empty-column-label",
    expectedColumnIndex: 0,
  },
  {
    label: "empty-column-label: string-shorthand with blank label",
    input: {
      ...BASE,
      columns: ["" as unknown as string],
    },
    expectedCode: "empty-column-label",
    expectedColumnIndex: 0,
  },
  {
    label: "empty-column-label: whitespace-only label at index 3",
    input: {
      ...BASE,
      columns: [{ label: "A" }, { label: "B" }, { label: "C" }, { label: "   " }],
    },
    expectedCode: "empty-column-label",
    expectedColumnIndex: 3,
  },
];

describe("CSV / JSON exporter error-code + payload parity", () => {
  it.each(FIXTURES)(
    "throws the same CsvExportMetadataError from both writers: $label",
    ({ input, expectedCode, expectedColumnIndex }) => {
      const csv = capture(buildCsvMetadataHeader, input);
      const json = capture(buildJsonExportMetadata, input);

      // Both writers must throw — parity is meaningless if one succeeds.
      expect(csv, "CSV writer must throw for malformed input").not.toBeNull();
      expect(json, "JSON writer must throw for malformed input").not.toBeNull();

      // Byte-identical structured payload.
      expect(csv).toEqual(json);

      // Explicit code + columnIndex assertions so a regression pinpoints
      // WHICH field drifted (message vs code vs index) rather than a
      // wall-of-diff on the whole object.
      expect(csv!.name).toBe("CsvExportMetadataError");
      expect(json!.name).toBe("CsvExportMetadataError");
      expect(csv!.code).toBe(expectedCode);
      expect(json!.code).toBe(expectedCode);
      expect(csv!.columnIndex).toBe(expectedColumnIndex);
      expect(json!.columnIndex).toBe(expectedColumnIndex);
      // Message parity — the writer's message strings are user-facing
      // (surfaced in error toasts) so silent drift between the two
      // writers would confuse users.
      expect(csv!.message).toBe(json!.message);
    },
  );

  it("every documented error code has coverage in this suite", () => {
    // Contract check: if a new code is added to CsvExportMetadataError
    // and we forget to add a fixture, this test fails so parity stays
    // exhaustive. Update BOTH the list below AND `FIXTURES` when adding
    // a new code.
    const documentedCodes: ReadonlyArray<CsvExportMetadataError["code"]> = [
      "empty-column-entry",
      "empty-column-label",
      "empty-column-key",
      "derived-key-empty", // unreachable in practice — see slugifyColumnKey
      "blank-source",
      "invalid-sort-direction",
      "invalid-page-number",
    ];
    const covered = new Set(FIXTURES.map((f) => f.expectedCode));
    for (const code of documentedCodes) {
      if (code === "derived-key-empty") continue; // documented-unreachable
      expect(covered.has(code), `Missing fixture for error code: ${code}`).toBe(true);
    }
  });

  it("first-column-error wins over later ones (deterministic ordering)", () => {
    // Both writers must report the SAME index — the first malformed
    // column, not the last. This is important when callers surface
    // `columnIndex` in UI (e.g. "column 3 has a blank label").
    const input: CsvMetadataInput = {
      ...BASE,
      columns: [
        { label: "OK" },
        { label: "" }, // index 1 — first offender
        { label: "" }, // index 2 — must NOT be the reported index
      ],
    };
    const csv = capture(buildCsvMetadataHeader, input);
    const json = capture(buildJsonExportMetadata, input);
    expect(csv).toEqual(json);
    expect(csv!.columnIndex).toBe(1);
  });

  it("structural error precedes column error (source checked first)", () => {
    // Both writers call `validateStructuralFields` BEFORE iterating
    // columns. A malformed source AND a malformed column must surface
    // the source error — with identical payload — from BOTH writers.
    const input: CsvMetadataInput = {
      source: "",
      generatedAt: FIXED_DATE,
      columns: [{ label: "" }],
    };
    const csv = capture(buildCsvMetadataHeader, input);
    const json = capture(buildJsonExportMetadata, input);
    expect(csv).toEqual(json);
    expect(csv!.code).toBe("blank-source");
    expect(csv!.columnIndex).toBe(-1);
  });
});
