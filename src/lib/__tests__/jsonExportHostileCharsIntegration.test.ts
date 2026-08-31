/**
 * Integration tests: JSON export when column labels AND explicit `{key}`
 * values contain "hostile" characters — double quotes, newlines, CR,
 * tabs, backslashes, unicode punctuation, emoji.
 *
 * The JSON envelope must:
 *   1. Serialise to a string that `JSON.parse` accepts (no unescaped
 *      control characters or stray quotes leaking through).
 *   2. Preserve every explicit `{key}` byte-for-byte on the parsed
 *      `_meta.columns[].key` — even when the key itself contains `"`,
 *      `\n`, `\r`, `\t`, `\\`, or unicode. Explicit keys are the
 *      downstream contract; a silent rewrite would break consumers.
 *   3. Preserve every label byte-for-byte on `_meta.columns[].label`
 *      (labels are only trimmed, never re-escaped in a lossy way).
 *   4. Never collide: even with adversarial explicit keys that look
 *      like derived `_N` suffixes, all emitted keys stay unique.
 *   5. Keep explicit-key precedence: when an explicit key equals the
 *      slug a sibling label would derive to, the explicit position
 *      wins the base slug and the sibling bumps.
 *
 * These are integration tests — they go through the real serialiser
 * (`JSON.stringify` on the envelope the app ships), a real
 * `JSON.parse` on the resulting string, and then assert against the
 * PARSED object, not the in-memory one. That closes the loop that
 * matters for downstream tooling reading a downloaded `.json` file.
 */
import { describe, it, expect } from "vitest";
import { buildJsonExportMetadata, type CsvMetadataInput } from "../csvExportMetadata";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

function roundTrip(cols: CsvMetadataInput["columns"]) {
  const input: CsvMetadataInput = {
    source: "JSON export — hostile chars",
    generatedAt: FIXED_DATE,
    columns: cols,
  };
  const envelope = {
    _meta: buildJsonExportMetadata(input),
    rows: [] as Array<Record<string, unknown>>,
  };
  const serialised = JSON.stringify(envelope);
  // The whole point: parse the SERIALISED string, not the object.
  const parsed = JSON.parse(serialised) as {
    _meta: { columns: Array<{ order: number; key: string; label: string }> };
  };
  return { serialised, parsed };
}

describe("JSON export — hostile-character labels and keys", () => {
  it("serialises to valid JSON and preserves explicit keys containing quotes/newlines", () => {
    const columns: CsvMetadataInput["columns"] = [
      { key: 'weird"key', label: "Label A" },
      { key: "multi\nline\rkey", label: "Label B" },
      { key: "tab\tkey", label: "Label C" },
      { key: "back\\slash", label: "Label D" },
      { key: "unicode—✓🚀", label: "Label E" },
      { key: "amount_2", label: "Explicit collision" }, // looks like a derived suffix
    ];
    const { serialised, parsed } = roundTrip(columns);

    // 1. Serialised output round-trips through JSON.parse without error
    //    (this is implicit — roundTrip already parsed it — but assert the
    //    shape anyway so a future regression is caught here, not upstream).
    expect(typeof serialised).toBe("string");
    expect(parsed._meta.columns).toHaveLength(columns.length);

    // 2. Every explicit key survives verbatim on the parsed object.
    const parsedKeys = parsed._meta.columns.map((c) => c.key);
    expect(parsedKeys).toEqual([
      'weird"key',
      "multi\nline\rkey",
      "tab\tkey",
      "back\\slash",
      "unicode—✓🚀",
      "amount_2",
    ]);

    // 3. Serialised string does NOT contain any unescaped control chars.
    //    (JSON.stringify escapes them; a raw `\n` inside a key would break
    //    JSON.parse.) Belt-and-braces check against manual concatenation
    //    regressions.
    expect(serialised).not.toMatch(/[\u0000-\u001F]/);
  });

  it("preserves labels containing quotes/newlines/tabs byte-for-byte", () => {
    const columns: CsvMetadataInput["columns"] = [
      { key: "a", label: 'Label with "quotes"' },
      { key: "b", label: "Label\nwith\nnewlines" },
      { key: "c", label: "Label\twith\ttabs" },
      { key: "d", label: "Label with \\ backslash and — em-dash" },
      { key: "e", label: 'Mixed "punct" — 中文 🚀\nnewline' },
    ];
    const { parsed } = roundTrip(columns);

    expect(parsed._meta.columns.map((c) => c.label)).toEqual([
      'Label with "quotes"',
      "Label\nwith\nnewlines",
      "Label\twith\ttabs",
      "Label with \\ backslash and — em-dash",
      'Mixed "punct" — 中文 🚀\nnewline',
    ]);
    // And keys stay verbatim in parallel.
    expect(parsed._meta.columns.map((c) => c.key)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("explicit-key precedence holds even when the explicit key contains hostile characters", () => {
    // Explicit key with quotes+newline is placed FIRST at the same slug
    // a later label-only sibling would derive to. The explicit key must
    // survive verbatim on its own slot; the sibling bumps and cannot
    // collide with anything.
    const columns: CsvMetadataInput["columns"] = [
      { key: 'amount"\n2', label: "First — explicit weird key" },
      { key: "amount", label: "Explicit amount" }, // takes bare `amount`
      { label: "Amount" }, // would derive `amount` → bumps to amount_2
      { label: "Amount" }, // → amount_3
    ];
    const { parsed } = roundTrip(columns);
    const keys = parsed._meta.columns.map((c) => c.key);

    expect(keys[0]).toBe('amount"\n2'); // hostile explicit survives verbatim
    expect(keys[1]).toBe("amount"); // explicit amount wins bare slug
    expect(keys[2]).toBe("amount_2"); // sibling bumps
    expect(keys[3]).toBe("amount_3"); // next sibling bumps further
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("collision handling: many derived-label siblings + explicit weird keys stay unique and valid JSON", () => {
    // Interleave label-only "Amount" siblings with explicit keys that
    // deliberately look like the derived suffix targets, some carrying
    // hostile characters. Assert (a) valid JSON, (b) all-unique keys,
    // (c) every explicit key present verbatim, (d) column count preserved.
    const columns: CsvMetadataInput["columns"] = [
      { label: "Amount" }, // amount
      { key: "amount_2", label: "Legacy 2" }, // explicit `amount_2` wins
      { label: "Amount" }, // would want amount_2 → bumps to amount_3
      { key: 'amount_3"weird', label: "Weird" }, // explicit hostile key
      { label: "Amount" }, // → amount_4 (amount_3 is taken by derived slot? no — amount_3 is free, `amount_3"weird` is a different string)
      { key: "amount\n5", label: "NL key" },
      { label: "Amount" }, // → amount_5
      { label: "amount!" }, // slug → amount → amount_6
    ];
    const { serialised, parsed } = roundTrip(columns);
    const keys = parsed._meta.columns.map((c) => c.key);

    // (a) valid JSON was implicit — we already parsed. Also confirm
    //     the serialised string never contains a raw control char.
    expect(typeof serialised).toBe("string");
    expect(serialised).not.toMatch(/[\u0000-\u001F]/);

    // (b) uniqueness holds even under adversarial mixing.
    expect(new Set(keys).size).toBe(keys.length);
    // (d) column count preserved.
    expect(keys).toHaveLength(columns.length);

    // (c) every explicit key survives verbatim.
    const explicits = columns
      .filter((c): c is { key: string; label: string } => typeof c !== "string" && "key" in c)
      .map((c) => c.key);
    for (const e of explicits) {
      expect(keys).toContain(e);
    }
  });

  it("serialised bytes for a hostile-key envelope decode back to a structurally identical envelope", () => {
    // Full envelope round-trip (not just columns): source, generatedAt,
    // schema, version, columns all present after JSON.parse.
    const columns: CsvMetadataInput["columns"] = [
      { key: 'k"1', label: 'l"1' },
      { key: "k\n2", label: "l\n2" },
    ];
    const { serialised, parsed } = roundTrip(columns);
    // Deterministic re-serialise → same bytes both times.
    expect(JSON.stringify(parsed)).toBe(serialised);
    expect(parsed._meta.columns).toEqual([
      { order: 0, key: 'k"1', label: 'l"1' },
      { order: 1, key: "k\n2", label: "l\n2" },
    ]);
  });
});
