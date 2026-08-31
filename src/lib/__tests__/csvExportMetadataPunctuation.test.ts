import { describe, it, expect } from "vitest";
import { buildCsvMetadataHeader, buildJsonExportMetadata } from "../csvExportMetadata";

/**
 * Tests for label variants with leading/trailing whitespace and common
 * punctuation. The invariants under test:
 *
 *   1. Slugification is DETERMINISTIC — the same label always produces
 *      the same base key across invocations and across exporters.
 *   2. All punctuation and whitespace variants of the same word collapse
 *      to a single base slug (so "Amount", " amount ", "amount!",
 *      "amount?" all share "amount" and dedupe in declaration order).
 *   3. Punctuation *between* words collapses to a single `_` separator
 *      (never doubles, never leaks through as-is).
 *   4. Interior whitespace, tabs, and newlines all normalize to `_`.
 *   5. Emitted keys never contain leading/trailing `_` regardless of
 *      what junk surrounded the input.
 */

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

function keysFor(columns: Parameters<typeof buildCsvMetadataHeader>[0]["columns"]): string[] {
  const line = buildCsvMetadataHeader({
    source: "X",
    generatedAt: FIXED_DATE,
    columns,
  }).find((l) => l.startsWith("# Column keys:"));
  return line ? line.replace("# Column keys: ", "").split(",") : [];
}

function keyForSingle(label: string): string {
  const keys = keysFor([{ label }]);
  return keys[0] ?? "";
}

describe("slugification — whitespace variants", () => {
  it.each([
    ["leading spaces", "   Amount", "amount"],
    ["trailing spaces", "Amount   ", "amount"],
    ["surrounding spaces", "  Amount  ", "amount"],
    ["mixed tabs and spaces", "\t Amount \t", "amount"],
    ["newlines around the word", "\nAmount\n", "amount"],
    ["carriage return + newline", "\r\nAmount\r\n", "amount"],
    ["all whitespace kinds combined", " \t\nAmount\r ", "amount"],
    ["single interior space becomes _", "Sold Date", "sold_date"],
    ["multiple interior spaces collapse to a single _", "Sold      Date", "sold_date"],
    ["interior tab becomes a single _", "Sold\tDate", "sold_date"],
    ["interior newline becomes a single _", "Sold\nDate", "sold_date"],
    ["mixed interior whitespace collapses to one _", "Sold \t\n Date", "sold_date"],
    ["three-word label", "Client Full Name", "client_full_name"],
  ])("%s → %s", (_name, label, expected) => {
    expect(keyForSingle(label)).toBe(expected);
  });

  it("emitted keys never start or end with underscore, regardless of input", () => {
    const junky = [
      "   Amount   ",
      "!!Amount!!",
      "___Amount___",
      "   !!! Amount !!!   ",
      "\n\t---Amount---\t\n",
    ];
    for (const label of junky) {
      const k = keyForSingle(label);
      expect(k.startsWith("_"), `key "${k}" for label "${label}"`).toBe(false);
      expect(k.endsWith("_"), `key "${k}" for label "${label}"`).toBe(false);
    }
  });
});

describe("slugification — punctuation variants", () => {
  it.each([
    ["trailing exclamation", "amount!", "amount"],
    ["trailing question mark", "amount?", "amount"],
    ["trailing period", "amount.", "amount"],
    ["trailing comma", "amount,", "amount"],
    ["trailing semicolon", "amount;", "amount"],
    ["trailing colon", "amount:", "amount"],
    ["surrounding parentheses", "(amount)", "amount"],
    ["surrounding brackets", "[amount]", "amount"],
    ["surrounding braces", "{amount}", "amount"],
    ["surrounding quotes", '"amount"', "amount"],
    ["surrounding apostrophes", "'amount'", "amount"],
    ["stacked trailing punctuation", "amount!?!", "amount"],
    ["stacked leading punctuation", "!!!amount", "amount"],
    ["punctuation on both sides", "***amount***", "amount"],
    ["interior hyphen becomes _", "sold-date", "sold_date"],
    ["interior slash becomes _", "sold/date", "sold_date"],
    ["interior period becomes _", "sold.date", "sold_date"],
    ["interior ampersand becomes _", "sold&date", "sold_date"],
    ["multiple interior punctuation collapses to one _", "sold///date", "sold_date"],
    ["mixed punctuation + spaces collapses to one _", "sold - date", "sold_date"],
    ["currency symbol dropped", "Amount ($)", "amount"],
    ["percentage symbol dropped", "Growth %", "growth"],
    ["numbers survive intact", "Q4 2026", "q4_2026"],
    ["numbers + punctuation", "v1.2.3", "v1_2_3"],
  ])("%s → %s", (_name, label, expected) => {
    expect(keyForSingle(label)).toBe(expected);
  });
});

describe("dedup remains deterministic across whitespace + punctuation variants", () => {
  it("Amount, ' Amount ', 'amount!', 'amount?' all funnel to base + _2, _3, _4", () => {
    expect(
      keysFor([
        { label: "Amount" },
        { label: " Amount " },
        { label: "amount!" },
        { label: "amount?" },
      ]),
    ).toEqual(["amount", "amount_2", "amount_3", "amount_4"]);
  });

  it("dedup order follows DECLARATION order, not lexicographic order", () => {
    // Swap the input order — expected suffixes rebind to the NEW positions.
    expect(
      keysFor([
        { label: "amount?" }, // now first → wins the base slot
        { label: "Amount" },
        { label: " amount " },
        { label: "amount!" },
      ]),
    ).toEqual(["amount", "amount_2", "amount_3", "amount_4"]);
  });

  it("running the same input twice yields byte-identical keys (pure function)", () => {
    const cols = [
      { label: "  Amount  " },
      { label: "amount!" },
      { label: "AMOUNT?" },
      { label: "Sold Date" },
      { label: "sold-date" },
    ];
    const first = keysFor(cols);
    const second = keysFor(cols);
    const third = keysFor(cols);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    // Pin the exact sequence too so a determinism regression that
    // *happens* to match itself twice would still fail.
    expect(first).toEqual(["amount", "amount_2", "amount_3", "sold_date", "sold_date_2"]);
  });

  it("CSV and JSON exporters agree on the whitespace/punctuation dedup", () => {
    const cols = [
      { label: "Amount" },
      { label: " Amount " },
      { label: "amount!" },
      { label: "amount?" },
      { label: "(amount)" },
    ];
    const csv = keysFor(cols);
    const meta = buildJsonExportMetadata({
      source: "X",
      generatedAt: FIXED_DATE,
      columns: cols,
    });
    const json = (meta.columns as Array<{ key: string }>).map((c) => c.key);
    expect(csv).toEqual(json);
    expect(csv).toEqual(["amount", "amount_2", "amount_3", "amount_4", "amount_5"]);
  });

  it("mixed word groupings that all slug to 'sold_date' dedupe in order", () => {
    // "Sold Date", "sold-date", "sold.date", "sold_date" all normalise
    // to the same base — expect four deterministic suffixes.
    expect(
      keysFor([
        { label: "Sold Date" },
        { label: "sold-date" },
        { label: "sold.date" },
        { label: "sold_date" },
      ]),
    ).toEqual(["sold_date", "sold_date_2", "sold_date_3", "sold_date_4"]);
  });

  it("explicit key still wins over any whitespace/punctuation variant", () => {
    expect(
      keysFor([
        { label: " Amount " },
        { key: "amount", label: "Cash" }, // explicit still bumps in declaration order
        { label: "amount!" },
      ]),
    ).toEqual(["amount", "amount_2", "amount_3"]);
  });

  it("dedup counts pre-existing bumped literals correctly", () => {
    // The literal "amount_2" arrives AFTER two "amount" slugs have
    // already claimed base + _2 → walk-past logic must bump the literal
    // to "amount_2_2". This pin ensures a whitespace/punctuation edit
    // to earlier siblings never quietly changes the walk-past target.
    expect(keysFor([{ label: "  Amount  " }, { label: "amount!" }, { label: "amount_2" }])).toEqual(
      ["amount", "amount_2", "amount_2_2"],
    );
  });
});
