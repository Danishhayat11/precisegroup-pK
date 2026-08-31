/**
 * Integration test: JSON export envelope columns must use an explicit
 * `{ key }` verbatim whenever it collides with a slugified sibling
 * `{ label }`. This mirrors the CSV alignment test — the JSON envelope
 * ships to downstream tooling (pipelines, replay harnesses) that pivots
 * on `_meta.columns[i].key`, so the explicit key must always win.
 *
 * Consumer contract exercised end-to-end:
 *   1. Build a JSON payload the way real exporters do — envelope
 *      metadata from `buildJsonExportMetadata`, `rows` next to it.
 *   2. JSON-serialise then re-parse (simulating a download → upload
 *      round trip).
 *   3. Assert every `_meta.columns[i].key` matches the caller's
 *      explicit key when one was provided, and that pivoting the
 *      data rows by that key returns the right cell.
 */
import { describe, it, expect } from "vitest";
import { buildJsonExportMetadata } from "../csvExportMetadata";

interface JsonEnvelope {
  _meta: {
    columns?: Array<{ order: number; key: string; label: string }>;
    [k: string]: unknown;
  };
  rows: Array<Record<string, unknown>>;
}

describe("JSON export metadata — explicit {key} wins over slugified {label} collisions", () => {
  it("explicit key first, then a label that slugifies to the same base", () => {
    // Consumer layout: two columns share the base `amount`. The first
    // declares `{ key: 'amount' }` explicitly; the second is label-only
    // ('Amount'), which slugifies to `amount`. The explicit key must
    // survive verbatim; the label-only sibling gets bumped to `amount_2`.
    const columns = [{ key: "amount", label: "Legacy Amount" }, { label: "Amount" }];
    const rows = [
      { amount: 100, amount_2: 200 },
      { amount: 300, amount_2: 400 },
    ];
    const envelope: JsonEnvelope = {
      _meta: buildJsonExportMetadata({
        source: "Test",
        generatedAt: new Date("2026-01-01T00:00:00Z"),
        columns,
      }),
      rows,
    };
    const roundTripped = JSON.parse(JSON.stringify(envelope)) as JsonEnvelope;
    const cols = roundTripped._meta.columns!;

    expect(cols.map((c) => c.key)).toEqual(["amount", "amount_2"]);
    expect(cols.map((c) => c.label)).toEqual(["Legacy Amount", "Amount"]);
    // Row pivot: the explicit key resolves to the ORIGINAL amount column,
    // never the shifted one.
    expect(roundTripped.rows[0][cols[0].key]).toBe(100);
    expect(roundTripped.rows[0][cols[1].key]).toBe(200);
  });

  it("label-only first, explicit key second — explicit key still wins its own name", () => {
    // Reversed declaration order. The first label 'Amount' claims base
    // `amount`. The second explicitly asks for `amount_2` — that literal
    // must survive; no bumping into `amount_2_2`.
    const columns = [{ label: "Amount" }, { key: "amount_2", label: "Explicit Second" }];
    const envelope: JsonEnvelope = {
      _meta: buildJsonExportMetadata({
        source: "Test",
        generatedAt: new Date("2026-01-01T00:00:00Z"),
        columns,
      }),
      rows: [],
    };
    const cols = JSON.parse(JSON.stringify(envelope))._meta.columns;

    expect(cols.map((c: { key: string }) => c.key)).toEqual(["amount", "amount_2"]);
    // Explicit key is preserved even though a derived key would land here.
    expect(cols[1].key).toBe("amount_2");
    expect(cols[1].label).toBe("Explicit Second");
  });

  it("three-way collision with explicit key sandwiched in the middle", () => {
    // Two label-only siblings surround an explicit `{ key: 'amount_2' }`.
    // Left-to-right dedup: 'Amount' → `amount`, explicit → `amount_2`
    // (literal), 'Amount' again would derive to `amount_2` but that's
    // now taken → walks past to `amount_3`.
    const columns = [
      { label: "Amount" },
      { key: "amount_2", label: "Explicit Middle" },
      { label: "Amount" },
    ];
    const envelope: JsonEnvelope = {
      _meta: buildJsonExportMetadata({
        source: "Test",
        generatedAt: new Date("2026-01-01T00:00:00Z"),
        columns,
      }),
      rows: [{ amount: "a", amount_2: "b", amount_3: "c" }],
    };
    const roundTripped = JSON.parse(JSON.stringify(envelope)) as JsonEnvelope;
    const cols = roundTripped._meta.columns!;

    expect(cols.map((c) => c.key)).toEqual(["amount", "amount_2", "amount_3"]);
    // The explicit label survives untouched (labels are trimmed but not
    // renamed to match the key).
    expect(cols[1].label).toBe("Explicit Middle");
    // Pivoting the row by the emitted keys reproduces original cells in order.
    const row = roundTripped.rows[0];
    expect(cols.map((c) => row[c.key])).toEqual(["a", "b", "c"]);
  });

  it("case- and punctuation-insensitive collisions still yield the explicit key verbatim", () => {
    // ' Amount ', 'amount!', 'AMOUNT?' all slugify to `amount`. Explicit
    // `{ key: 'amount' }` claims the base slot; the others get `_2`,
    // `_3` in declaration order.
    const columns = [
      { key: "amount", label: "Total (explicit)" },
      { label: " Amount " },
      { label: "amount!" },
      { label: "AMOUNT?" },
    ];
    const envelope: JsonEnvelope = {
      _meta: buildJsonExportMetadata({
        source: "Test",
        generatedAt: new Date("2026-01-01T00:00:00Z"),
        columns,
      }),
      rows: [],
    };
    const cols = JSON.parse(JSON.stringify(envelope))._meta.columns as Array<{
      key: string;
      label: string;
      order: number;
    }>;

    expect(cols.map((c) => c.key)).toEqual(["amount", "amount_2", "amount_3", "amount_4"]);
    expect(cols[0].key).toBe("amount");
    expect(cols[0].label).toBe("Total (explicit)");
    // `order` must reflect declaration order after JSON round-trip.
    expect(cols.map((c) => c.order)).toEqual([0, 1, 2, 3]);
    // Every emitted key must be unique.
    expect(new Set(cols.map((c) => c.key)).size).toBe(cols.length);
  });
});
