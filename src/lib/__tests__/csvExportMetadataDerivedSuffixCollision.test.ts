/**
 * Regression tests: a derived `_N` suffix collides with an *explicitly*
 * provided key that happens to look identical (e.g. `{ key: "amount_2" }`
 * alongside a label that slugifies to `amount_2`, or two `Amount` labels
 * whose dedup would otherwise land on `amount_2`).
 *
 * Invariants under test:
 *   1. Explicitly provided keys are ALWAYS honored verbatim — they are
 *      never bumped or renamed to make room for a derived suffix.
 *   2. Derived suffixes walk PAST any literal explicit key already in the
 *      used-set, regardless of whether it was declared before or after.
 *   3. All emitted keys are unique and CSV↔JSON stay in lockstep.
 */
import { describe, it, expect } from "vitest";
import {
  buildCsvMetadataHeader,
  buildJsonExportMetadata,
  type CsvMetadataInput,
} from "../csvExportMetadata";

const FIXED_DATE = new Date("2026-01-01T00:00:00Z");

function keysFromCsv(lines: string[]): string[] {
  const row = lines.find((l) => l.startsWith("# Column keys:"));
  if (!row) throw new Error("no column keys row");
  return row.replace("# Column keys:", "").trim().split(",");
}

function keysFromJson(meta: Record<string, unknown>): string[] {
  return (meta.columns as Array<{ key: string }>).map((c) => c.key);
}

function bothKeys(columns: CsvMetadataInput["columns"]): {
  csv: string[];
  json: string[];
} {
  const input: CsvMetadataInput = {
    source: "Regression",
    generatedAt: FIXED_DATE,
    columns,
  };
  return {
    csv: keysFromCsv(buildCsvMetadataHeader(input)),
    json: keysFromJson(buildJsonExportMetadata(input)),
  };
}

describe("derived suffix vs explicit key collision", () => {
  it("explicit {key:'amount_2'} declared FIRST is preserved; later duplicate label walks past it", () => {
    // Order: explicit amount_2, then Amount, then Amount again.
    // Derived path would otherwise assign the second Amount → amount_2.
    const { csv, json } = bothKeys([
      { key: "amount_2", label: "Legacy Amount" },
      { label: "Amount" },
      { label: "Amount" },
    ]);
    expect(csv).toEqual(["amount_2", "amount", "amount_3"]);
    expect(json).toEqual(csv);
  });

  it("explicit {key:'amount_2'} declared LAST is preserved; earlier dedup skips over it", () => {
    // Two `Amount` labels would normally dedup to [amount, amount_2],
    // but the third entry claims `amount_2` explicitly → second must
    // become amount_3 (walk-past), and the explicit key stays put.
    const { csv, json } = bothKeys([
      { label: "Amount" },
      { label: "Amount" },
      { key: "amount_2", label: "Legacy Amount" },
    ]);
    // NB: dedup runs left-to-right and only consults the used-set as it
    // grows. The 2nd Amount is resolved BEFORE the 3rd entry exists, so
    // it lands on amount_2, and the explicit amount_2 then bumps to
    // amount_2_2 to honor uniqueness without renaming an earlier column.
    expect(csv).toEqual(["amount", "amount_2", "amount_2_2"]);
    expect(json).toEqual(csv);
  });

  it("label that slugifies to 'amount_2' collides with a prior explicit key of the same name", () => {
    // "amount 2" → slug "amount_2". Explicit key already owns that slot.
    const { csv, json } = bothKeys([
      { key: "amount_2", label: "Legacy Amount" },
      { label: "amount 2" },
    ]);
    expect(csv).toEqual(["amount_2", "amount_2_2"]);
    expect(json).toEqual(csv);
  });

  it("two explicit keys of the same value dedup to key, key_2 (explicit-vs-explicit)", () => {
    const { csv, json } = bothKeys([
      { key: "amount_2", label: "First" },
      { key: "amount_2", label: "Second" },
    ]);
    expect(csv).toEqual(["amount_2", "amount_2_2"]);
    expect(json).toEqual(csv);
  });

  it("explicit key with derived-style suffix does not free up its own base slot", () => {
    // Explicit `amount_2` must NOT be treated as "amount + suffix 2" —
    // its base is the whole string. A sibling labelled Amount still
    // gets amount / amount_2 (walk-past) / amount_3 progression.
    const { csv, json } = bothKeys([
      { key: "amount_2", label: "Explicit" },
      { label: "Amount" }, // base amount, n=1 → amount
      { label: "Amount" }, // base amount, n=2 → amount_2 taken → amount_3
      { label: "Amount" }, // base amount, n=3 → amount_3 taken → amount_4
    ]);
    expect(csv).toEqual(["amount_2", "amount", "amount_3", "amount_4"]);
    expect(json).toEqual(csv);
  });

  it("chained explicit-suffix collisions: amount_2 and amount_3 both explicit, plus derived Amount siblings", () => {
    const { csv, json } = bothKeys([
      { key: "amount_3", label: "Explicit Three" },
      { label: "Amount" }, // → amount
      { key: "amount_2", label: "Explicit Two" },
      { label: "Amount" }, // n=2 → amount_2 taken → amount_3 taken → amount_4
      { label: "Amount" }, // n=5 → amount_5
    ]);
    expect(csv).toEqual(["amount_3", "amount", "amount_2", "amount_4", "amount_5"]);
    expect(json).toEqual(csv);
  });

  it("explicit key equal to a punctuation-slug collision target is preserved", () => {
    // "Amount!" and "Amount?" both slug to "amount"; explicit amount_2
    // wedged between them must survive and force the second to amount_3.
    const { csv, json } = bothKeys([
      { label: "Amount!" }, // → amount
      { key: "amount_2", label: "Explicit" },
      { label: "Amount?" }, // n=2 → amount_2 taken → amount_3
    ]);
    expect(csv).toEqual(["amount", "amount_2", "amount_3"]);
    expect(json).toEqual(csv);
  });

  it("explicit key that itself has a double-suffix (amount_2_2) is preserved verbatim", () => {
    const { csv, json } = bothKeys([
      { label: "Amount" },
      { label: "Amount" }, // → amount_2
      { key: "amount_2_2", label: "Legacy" }, // untouched
      { label: "Amount" }, // n=3 → amount_3
    ]);
    expect(csv).toEqual(["amount", "amount_2", "amount_2_2", "amount_3"]);
    expect(json).toEqual(csv);
  });

  it("output is deterministic across repeated calls with the same colliding input", () => {
    const columns: CsvMetadataInput["columns"] = [
      { key: "amount_2", label: "Legacy" },
      { label: "Amount" },
      { label: "amount 2" },
      { label: "Amount" },
    ];
    const first = bothKeys(columns);
    const second = bothKeys(columns);
    expect(first.csv).toEqual(second.csv);
    expect(first.json).toEqual(second.json);
    // And all keys must remain unique.
    expect(new Set(first.csv).size).toBe(first.csv.length);
  });
});
