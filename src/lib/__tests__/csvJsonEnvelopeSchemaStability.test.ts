/**
 * JSON envelope schema stability under colliding metadata across
 * insertion orders.
 *
 * This suite exists to lock two promises the exporter makes to
 * downstream consumers (analytics ingest, audit replay, third-party
 * importers):
 *
 *   1. **Schema shape is stable.** Every envelope carries the top-level
 *      keys `schema` and `version` FIRST, followed by a well-known set
 *      of optional fields. Adding a new field is fine; renaming,
 *      removing, or reordering existing fields is a breaking change and
 *      must bump `version`.
 *
 *   2. **Serialised output is byte-stable across caller insertion
 *      order.** Two callers producing semantically-identical metadata
 *      (same filters, same extras, same columns, same counts) must
 *      produce byte-identical `JSON.stringify()` output — regardless of
 *      the order in which they populated `extra` / `filters` object
 *      keys. Column arrays are ordered and MUST be preserved as-is
 *      (collision resolution depends on left-to-right order); this test
 *      only reshuffles unordered maps.
 *
 * Colliding cases exercised: duplicate labels producing `_2/_3`
 * suffixes, explicit-key survival, chained numbering, punctuation
 * fallbacks, unicode duplicates, and combinations of all of the above
 * alongside filters/extra with keys that hit the alphabetical-sort
 * path (`z…` before `a…` in the input, `a…` before `z…` on the wire).
 */
import { describe, it, expect } from "vitest";
import {
  buildJsonExportMetadata,
  JSON_ENVELOPE_SCHEMA,
  JSON_ENVELOPE_VERSION,
  type CsvMetadataInput,
} from "../csvExportMetadata";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

/** Full set of top-level keys the envelope may emit, in canonical order. */
const CANONICAL_TOP_LEVEL_ORDER = [
  "schema",
  "version",
  "source",
  "generatedAt",
  "extra",
  "filters",
  "sort",
  "page",
  "counts",
  "columns",
] as const;

function build(input: Partial<CsvMetadataInput> = {}): Record<string, unknown> {
  return buildJsonExportMetadata({
    source: "Stability fixture",
    generatedAt: FIXED_DATE,
    ...input,
  } as CsvMetadataInput);
}

function stringify(v: unknown): string {
  return JSON.stringify(v);
}

describe("JSON envelope: versioning + schema shape", () => {
  it("emits `schema` and `version` as the first two top-level keys", () => {
    const meta = build();
    const keys = Object.keys(meta);
    expect(keys[0]).toBe("schema");
    expect(keys[1]).toBe("version");
    expect(meta.schema).toBe(JSON_ENVELOPE_SCHEMA);
    expect(meta.version).toBe(JSON_ENVELOPE_VERSION);
    expect(JSON_ENVELOPE_VERSION).toBe(1); // Bump this test intentionally.
  });

  it("top-level key order matches the canonical order for every emitted key", () => {
    // Include every optional field so the full canonical order is exercised.
    const meta = build({
      extra: { note: "x" },
      filters: { status: "active" },
      sort: { key: "created_at", dir: "desc" },
      page: { page: 1, totalPages: 2, pageSize: 25 },
      counts: { shown: 25, filtered: 25, total: 50 },
      columns: [{ label: "A" }, { label: "A" }],
    });
    const observed = Object.keys(meta);
    const canonical = CANONICAL_TOP_LEVEL_ORDER.filter((k) => observed.includes(k));
    expect(observed).toEqual(canonical);
    // Belt-and-braces: NO unexpected keys — additions require adding to
    // CANONICAL_TOP_LEVEL_ORDER above (which is itself the schema
    // contract this suite protects).
    for (const k of observed) {
      expect(CANONICAL_TOP_LEVEL_ORDER).toContain(k as (typeof CANONICAL_TOP_LEVEL_ORDER)[number]);
    }
  });

  it("`schema` + `version` survive when every optional field is omitted", () => {
    const meta = build();
    expect(meta).toEqual({
      schema: JSON_ENVELOPE_SCHEMA,
      version: JSON_ENVELOPE_VERSION,
      source: "Stability fixture",
      generatedAt: FIXED_DATE.toISOString(),
    });
  });
});

describe("JSON envelope: byte-stable across insertion order for colliding metadata", () => {
  it("filters and extras are alphabetised regardless of caller insertion order", () => {
    const a = build({
      filters: { zulu: "z", alpha: "a", mike: "m" },
      extra: { z_note: "zz", a_note: "aa" },
    });
    const b = build({
      filters: { alpha: "a", mike: "m", zulu: "z" },
      extra: { a_note: "aa", z_note: "zz" },
    });
    expect(stringify(a)).toBe(stringify(b));
    // And the on-wire order is alphabetical, not insertion:
    expect(Object.keys(a.filters as object)).toEqual(["alpha", "mike", "zulu"]);
    expect(Object.keys(a.extra as object)).toEqual(["a_note", "z_note"]);
  });

  it("duplicate-label collisions keep the same `_2/_3` mapping regardless of filter/extra order", () => {
    const columns = [
      { label: "Amount" },
      { label: "Amount" },
      { label: "Amount" },
      { key: "amount", label: "Total" }, // explicit-first survival test
    ];
    const a = build({
      columns,
      filters: { b: "1", a: "2" },
      extra: { y: "y", x: "x" },
    });
    const b = build({
      columns,
      filters: { a: "2", b: "1" },
      extra: { x: "x", y: "y" },
    });
    expect(stringify(a)).toBe(stringify(b));
    // The collision resolution itself is order-preserving on `columns`:
    expect((a.columns as Array<{ key: string }>).map((c) => c.key)).toEqual([
      "amount",
      "amount_2",
      "amount_3",
      "amount_4", // explicit `amount` bumps past the three label-derived siblings
    ]);
  });

  it("chained numbering + pre-claimed literal slot: envelope is stable across insertion order", () => {
    const columns = [
      { key: "amount", label: "First" },
      { key: "amount", label: "Second" },
      { key: "amount_2", label: "Literal Two" },
    ];
    const a = build({ columns, filters: { z: "1", a: "2", m: "3" } });
    const b = build({ columns, filters: { m: "3", a: "2", z: "1" } });
    expect(stringify(a)).toBe(stringify(b));
    expect((a.columns as Array<{ key: string }>).map((c) => c.key)).toEqual([
      "amount",
      "amount_2",
      "amount_2_2", // explicit `amount_2` collides with the derived slot → `_2` suffix
    ]);
  });

  it("punctuation-only labels + unicode duplicates: envelope byte-stable across order", () => {
    const columns = [
      { label: "!!!" },
      { label: "???" },
      { label: "Unicode ✓" },
      { label: "Unicode ✓" }, // → suffix _2 on unicode slug
    ];
    const a = build({
      columns,
      filters: { status: "active", agent: "x", city: "y" },
    });
    const b = build({
      columns,
      filters: { city: "y", status: "active", agent: "x" },
    });
    expect(stringify(a)).toBe(stringify(b));
  });

  it("mixed collision matrix serialises identically across three insertion permutations", () => {
    const columns = [
      { key: "id", label: "ID" },
      { label: "Amount" },
      { label: "Amount" },
      { key: "amount_2", label: "Pre-claimed slot 2" },
      { label: "Amount" },
      { label: "!!!" },
      { label: "!!!" },
    ];
    const permutations: Array<Record<string, string>> = [
      { z: "1", m: "2", a: "3", k: "4" },
      { a: "3", k: "4", m: "2", z: "1" },
      { m: "2", k: "4", z: "1", a: "3" },
    ];
    const outputs = permutations.map((filters) =>
      stringify(
        build({
          columns,
          filters,
          extra: { note_z: "z", note_a: "a" },
          counts: { shown: 7, filtered: 7, total: 12 },
        }),
      ),
    );
    expect(new Set(outputs).size).toBe(1);
  });

  it("empty extra/filters after sanitisation do not surface as `{}` keys", () => {
    // `agent: "all"` and `city: ""` are dropped by isMeaningful; the
    // remaining single entry must still appear, and the empty maps must
    // NOT leak into the envelope.
    const meta = build({
      filters: { status: "active", agent: "all", city: "" },
      extra: { blank: "", populated: "yes" },
    });
    expect(meta).not.toHaveProperty("extra.blank");
    expect(meta.extra).toEqual({ populated: "yes" });
    expect(meta.filters).toEqual({ status: "active" });
  });
});
