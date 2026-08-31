/**
 * Pins the fail-fast validation contract for malformed column entries
 * against the three new error codes introduced when the metadata
 * builders stopped silently coercing bad input:
 *
 *   • `invalid-column-type`        — entry is neither a string nor a
 *                                    plain object (numbers, booleans,
 *                                    arrays, functions, promises).
 *   • `invalid-column-key-type`    — `key` field present but not a
 *                                    string (number, boolean, object,
 *                                    null). `undefined` is still
 *                                    tolerated because it's the "property
 *                                    absent" sentinel.
 *   • `invalid-column-label-type`  — `label` property is present but
 *                                    not a string (null, number,
 *                                    boolean, object, array).
 *
 * These tests are the canary that catches:
 *   1. A refactor that reintroduces silent `.toString()` coercion.
 *   2. A code change that swaps which check runs first (order matters
 *      for the surfaced `code` and `columnIndex`).
 *   3. Any drift between the CSV header builder and the JSON envelope
 *      builder — BOTH must throw identically for the same bad input.
 */
import { describe, it, expect } from "vitest";
import {
  buildCsvMetadataHeader,
  buildJsonExportMetadata,
  CsvExportMetadataError,
  withDerivedColumnKeys,
  type CsvMetadataInput,
} from "../csvExportMetadata";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

function expectThrow(fn: () => unknown): CsvExportMetadataError {
  try {
    fn();
  } catch (e) {
    if (e instanceof CsvExportMetadataError) return e;
    throw new Error(
      `expected CsvExportMetadataError, got ${(e as Error).constructor.name}: ${(e as Error).message}`,
    );
  }
  throw new Error("expected CsvExportMetadataError to be thrown, nothing was thrown");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const csv = (columns: any[]) => () =>
  buildCsvMetadataHeader({ source: "X", generatedAt: FIXED_DATE, columns });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (columns: any[]) => () =>
  buildJsonExportMetadata({ source: "X", generatedAt: FIXED_DATE, columns });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const derive = (columns: any[]) => () =>
  withDerivedColumnKeys(columns as NonNullable<CsvMetadataInput["columns"]>);

/**
 * Assert that all three entry points — CSV, JSON, and the shared
 * `withDerivedColumnKeys` helper — throw identical (code, columnIndex)
 * for the same malformed input. This is the parity guarantee that keeps
 * callers from getting different errors depending on which serialiser
 * they picked first.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assertParityThrow(columns: any[], code: CsvExportMetadataError["code"], idx: number) {
  const cErr = expectThrow(csv(columns));
  const jErr = expectThrow(json(columns));
  const dErr = expectThrow(derive(columns));
  expect(cErr.code).toBe(code);
  expect(jErr.code).toBe(code);
  expect(dErr.code).toBe(code);
  expect(cErr.columnIndex).toBe(idx);
  expect(jErr.columnIndex).toBe(idx);
  expect(dErr.columnIndex).toBe(idx);
}

describe("metadata entry validation — new error codes", () => {
  // ------------------------------------------------------------------
  // invalid-column-type — entry itself is a wrong shape
  // ------------------------------------------------------------------
  describe("invalid-column-type", () => {
    it.each<[string, unknown]>([
      ["number", 42],
      ["negative number", -1],
      ["zero", 0],
      ["NaN", Number.NaN],
      ["boolean true", true],
      ["boolean false", false],
      ["array", ["Amount"]],
      ["nested array", [["Amount"]]],
      ["empty array", []],
      ["function", () => "x"],
      ["arrow with props", Object.assign(() => "x", { label: "Amount" })],
      ["bigint", 10n],
      ["symbol", Symbol("x")],
    ])("rejects entry of type %s at the top level", (_name, value) => {
      assertParityThrow([value], "invalid-column-type", 0);
    });

    it("thenable / promise-like object is rejected (would confuse serialisers)", () => {
      // A plain object with a `.then` method is treated as a promise by
      // many JS runtimes; refuse it up-front to avoid silent hangs.
      const thenable = { then: () => {}, label: "Amount" };
      assertParityThrow([thenable], "invalid-column-type", 0);
    });

    it("reports the index of the FIRST invalid entry when others follow", () => {
      assertParityThrow(
        [{ label: "OK" }, { label: "Also OK" }, 99, { label: "Later" }],
        "invalid-column-type",
        2,
      );
    });

    it("empty array in slot 0 is refused (arrays never satisfy the object contract)", () => {
      assertParityThrow([[], { label: "Amount" }], "invalid-column-type", 0);
    });

    it("valid string entries mixed with a bad entry: throw reports the bad one", () => {
      assertParityThrow(["Amount", "Date", true, "Client"], "invalid-column-type", 2);
    });
  });

  // ------------------------------------------------------------------
  // invalid-column-key-type — `key` field present with wrong type
  // ------------------------------------------------------------------
  describe("invalid-column-key-type", () => {
    it.each<[string, unknown]>([
      ["number", 123],
      ["boolean", true],
      ["object", { toString: () => "amount" }],
      ["null", null],
      ["array", ["amount"]],
      ["bigint", 5n],
      ["symbol", Symbol("k")],
    ])("rejects `key` of type %s", (_name, key) => {
      assertParityThrow([{ key, label: "Amount" }], "invalid-column-key-type", 0);
    });

    it("`key: undefined` is tolerated (absent property sentinel)", () => {
      // undefined === "no explicit key" — the label slug drives.
      const keys = buildJsonExportMetadata({
        source: "X",
        generatedAt: FIXED_DATE,
        columns: [{ key: undefined, label: "Amount" }],
      }).columns as Array<{ key: string }>;
      expect(keys.map((c) => c.key)).toEqual(["amount"]);
    });

    it("`key` type check fires BEFORE label type check", () => {
      // Even when both are malformed, `invalid-column-key-type` wins.
      assertParityThrow(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [{ key: 1 as any, label: 2 as any }],
        "invalid-column-key-type",
        0,
      );
    });

    it("first-offender-wins across a mixed batch", () => {
      assertParityThrow(
        [
          { label: "A" },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { key: null as any, label: "B" },
          { label: null }, // also bad, but later
        ],
        "invalid-column-key-type",
        1,
      );
    });
  });

  // ------------------------------------------------------------------
  // invalid-column-label-type — `label` property present with wrong type
  // ------------------------------------------------------------------
  describe("invalid-column-label-type", () => {
    it.each<[string, unknown]>([
      ["null", null],
      ["undefined (property present)", undefined],
      ["number", 42],
      ["boolean", true],
      ["array", ["Amount"]],
      ["plain object", { toString: () => "Amount" }],
      ["Date", new Date()],
      ["bigint", 3n],
      ["symbol", Symbol("l")],
    ])("rejects `label` of type %s (no explicit key)", (_name, label) => {
      assertParityThrow([{ label }], "invalid-column-label-type", 0);
    });

    it("valid `key` does NOT rescue a non-string `label` (no silent coercion)", () => {
      // This is a behavior CHANGE from the previous lenient contract —
      // pin it so a regression to the old fallback is caught.
      assertParityThrow(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [{ key: "amount", label: 42 as any }],
        "invalid-column-label-type",
        0,
      );
    });

    it("label property completely omitted with a valid key is FINE (no throw)", () => {
      // Absent property ≠ present-with-wrong-type. This exercises the
      // Object.prototype.hasOwnProperty branch that distinguishes the two.
      const keys = buildJsonExportMetadata({
        source: "X",
        generatedAt: FIXED_DATE,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        columns: [{ key: "amount" } as any],
      }).columns as Array<{ key: string; label: string }>;
      expect(keys).toEqual([{ order: 0, key: "amount", label: "amount" }]);
    });

    it("reports the FIRST bad label index in a long list", () => {
      assertParityThrow(
        [
          { label: "A" },
          { label: "B" },
          { label: "C" },
          { label: null }, // <-- index 3
          { label: "E" },
          { label: 99 }, // also bad, index 5
        ],
        "invalid-column-label-type",
        3,
      );
    });
  });

  // ------------------------------------------------------------------
  // Ordering: entry-type is checked before key-type before label-type
  // ------------------------------------------------------------------
  describe("check ordering (entry-type → key-type → label-type)", () => {
    it("entry-type beats every field-level check", () => {
      // A number entry can't even be introspected for `.key` / `.label`,
      // so `invalid-column-type` wins regardless of what else is wrong.
      assertParityThrow(
        [
          { label: "OK" },
          42,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { key: null as any, label: null as any },
        ],
        "invalid-column-type",
        1,
      );
    });

    it("key-type beats label-type when both fail on the same entry", () => {
      assertParityThrow(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [{ key: 1 as any, label: null as any }],
        "invalid-column-key-type",
        0,
      );
    });

    it("label-type beats empty-column-label when both would apply", () => {
      // `label: null` is a type error, NOT an "empty label" — the
      // distinct code lets callers tell "you passed the wrong type"
      // apart from "you forgot to supply a label".
      assertParityThrow([{ label: null }], "invalid-column-label-type", 0);
    });

    it("empty-column-entry (null/undefined) still beats every type check", () => {
      assertParityThrow([{ label: "OK" }, null, 42, { label: null }], "empty-column-entry", 1);
    });
  });

  // ------------------------------------------------------------------
  // Error object shape
  // ------------------------------------------------------------------
  describe("CsvExportMetadataError shape", () => {
    it("carries `name`, `code`, `columnIndex`, and a message for every new code", () => {
      const cases: Array<{ input: unknown[]; code: CsvExportMetadataError["code"]; idx: number }> =
        [
          { input: [42], code: "invalid-column-type", idx: 0 },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { input: [{ key: 1 as any, label: "A" }], code: "invalid-column-key-type", idx: 0 },
          { input: [{ label: null }], code: "invalid-column-label-type", idx: 0 },
        ];
      for (const { input, code, idx } of cases) {
        const err = expectThrow(csv(input));
        expect(err).toBeInstanceOf(CsvExportMetadataError);
        expect(err.name).toBe("CsvExportMetadataError");
        expect(err.code).toBe(code);
        expect(err.columnIndex).toBe(idx);
        expect(err.message.length).toBeGreaterThan(0);
        // Message should reference the failing index for debuggability.
        expect(err.message).toContain(`index ${idx}`);
      }
    });

    it("CSV, JSON, and derive helpers throw the SAME error instance-of class", () => {
      const bad = [42];
      expect(expectThrow(csv(bad))).toBeInstanceOf(CsvExportMetadataError);
      expect(expectThrow(json(bad))).toBeInstanceOf(CsvExportMetadataError);
      expect(expectThrow(derive(bad))).toBeInstanceOf(CsvExportMetadataError);
    });
  });

  // ------------------------------------------------------------------
  // Happy-path regression: valid entries keep working unchanged
  // ------------------------------------------------------------------
  describe("valid entries still work after the tighter validation", () => {
    it("mixed string + object entries with explicit keys succeed", () => {
      const meta = buildJsonExportMetadata({
        source: "X",
        generatedAt: FIXED_DATE,
        columns: [
          "Amount",
          { label: "Date" },
          { key: "client_id", label: "Client" },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { key: "notes" } as any, // label omitted, key drives label fallback
        ],
      });
      const cols = meta.columns as Array<{ key: string; label: string; order: number }>;
      expect(cols.map((c) => c.key)).toEqual(["amount", "date", "client_id", "notes"]);
      expect(cols.map((c) => c.label)).toEqual(["Amount", "Date", "Client", "notes"]);
    });
  });
});
