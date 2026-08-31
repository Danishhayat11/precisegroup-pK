/**
 * Randomized fuzz coverage for the JSON metadata envelope shape when a
 * mix of explicit-key and label-only columns is present. Complements
 * the existing structural / equivalence / snapshot suites with wide
 * randomized coverage of the ENVELOPE contract:
 *
 *   • Top-level required fields exist with the right types:
 *       schema: string === JSON_ENVELOPE_SCHEMA
 *       version: number === JSON_ENVELOPE_VERSION
 *       source: non-empty string (input.source trimmed)
 *       generatedAt: ISO-8601 string parseable by `new Date()`
 *       columns: Array<{ order, key, label }>  (when supplied)
 *
 *   • Optional blocks (`extra`, `filters`, `sort`, `page`, `counts`) are
 *     PRESENT iff they contribute at least one meaningful field, ABSENT
 *     otherwise — no empty `{}` objects, no null-holes.
 *
 *   • Each column entry has EXACTLY the three keys `{order, key, label}`
 *     in stable insertion order; `order` matches its index (0..N-1);
 *     `key` is a non-empty string; `label` is a non-empty string; every
 *     `key` is unique across the array; explicit keys survive verbatim
 *     at their input position.
 *
 *   • Envelope byte-stability: two builds with the same input serialise
 *     to identical JSON.
 *
 *   • Explicit / label-only interleave: given random mixed input, the
 *     positions carrying `{key}` keep that key literally, and the
 *     positions carrying `{label}` only get a slugified derived key —
 *     no cross-contamination.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  buildJsonExportMetadata,
  JSON_ENVELOPE_SCHEMA,
  JSON_ENVELOPE_VERSION,
  slugifyColumnKey,
  type CsvMetadataInput,
} from "../csvExportMetadata";

const RUNS = Math.max(50, 150 * (Number(process.env.FC_RUNS_MULTIPLIER) || 1));

// --- Arbitraries ---------------------------------------------------

/** Non-empty printable label that never contains newline / pipe. */
const safeLabelArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .map((s) => s.replace(/[\r\n|]+/g, " ").trim())
  .filter((s) => s.length > 0);

/** Explicit key: non-blank after trim; excludes chars that would corrupt
 *  the CSV `# Column keys:` line (we don't test that here, but keeping
 *  keys comma/newline-free keeps this suite orthogonal to the escaping
 *  fuzz suite). */
const explicitKeyArb = fc
  .string({ minLength: 1, maxLength: 15 })
  .map((s) => s.replace(/[\r\n,|]+/g, "_").trim())
  .filter((s) => s.length > 0);

/** A single column entry: either {label} only, or {key, label}. The
 *  boolean drives whether it's explicit. */
const columnArb = fc.record({
  hasKey: fc.boolean(),
  key: explicitKeyArb,
  label: safeLabelArb,
});

/** A batch of 1..10 columns with a random explicit/label-only mix. */
const columnsArb = fc.array(columnArb, { minLength: 1, maxLength: 10 });

/** A safe, opaque non-sentinel filter/extra value. Restricted to the
 *  intersection type accepted by BOTH `extra` (string|number|null|undef)
 *  and `filters` (adds boolean) so the same generator feeds both. */
const filterValueArb = fc.oneof(
  fc
    .string({ minLength: 1, maxLength: 10 })
    .filter(
      (s) =>
        s.trim().length > 0 && !/^(all|any|null|undefined)$/i.test(s.trim()) && !/[\r\n|]/.test(s),
    ),
  fc.integer({ min: -1000, max: 1000 }),
);

/** Sort direction. */
const sortArb = fc.record({
  key: safeLabelArb,
  dir: fc.constantFrom("asc", "desc") as fc.Arbitrary<"asc" | "desc">,
});

/** Positive-integer page block. */
const pageArb = fc.record({
  page: fc.integer({ min: 1, max: 999 }),
  totalPages: fc.integer({ min: 1, max: 999 }),
  pageSize: fc.integer({ min: 1, max: 500 }),
});

/** Counts with 0..3 present buckets. */
const countsArb = fc.record(
  {
    shown: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: undefined }),
    filtered: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: undefined }),
    total: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: undefined }),
  },
  { requiredKeys: [] },
);

/** Sanitised filter/extra map with unique keys. */
const kvMapArb = fc
  .array(
    fc.tuple(
      fc
        .string({ minLength: 1, maxLength: 8 })
        .filter((s) => s.trim().length > 0 && !/[\r\n|=:]/.test(s)),
      filterValueArb,
    ),
    { minLength: 0, maxLength: 6 },
  )
  .map((entries) => {
    const out: Record<string, string | number> = {};
    for (const [k, v] of entries) if (!(k in out)) out[k] = v;
    return out;
  });

/** Materialise a raw column-input array from `columnArb` records. */
function toColumns(specs: ReadonlyArray<{ hasKey: boolean; key: string; label: string }>) {
  return specs.map((s) => (s.hasKey ? { key: s.key, label: s.label } : { label: s.label }));
}

// --- Suite ---------------------------------------------------------

describe("randomized fuzz — JSON metadata envelope shape/type invariants under mixed columns", () => {
  // ------------------------------------------------------------------
  // 1. Top-level envelope shape and types.
  // ------------------------------------------------------------------
  it("envelope always has the required top-level fields with correct types", () => {
    fc.assert(
      fc.property(safeLabelArb, columnsArb, (source, colSpecs) => {
        const columns = toColumns(colSpecs);
        const meta = buildJsonExportMetadata({ source, columns });
        expect(typeof meta.schema).toBe("string");
        expect(meta.schema).toBe(JSON_ENVELOPE_SCHEMA);
        expect(typeof meta.version).toBe("number");
        expect(meta.version).toBe(JSON_ENVELOPE_VERSION);
        expect(typeof meta.source).toBe("string");
        expect((meta.source as string).length).toBeGreaterThan(0);
        expect(typeof meta.generatedAt).toBe("string");
        expect(Number.isNaN(new Date(meta.generatedAt as string).getTime())).toBe(false);
        // ISO-8601 has a `T` and ends with `Z` for UTC.
        expect(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(meta.generatedAt as string),
        ).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it("envelope surfaces `columns` iff input.columns is non-empty; never empty array", () => {
    fc.assert(
      fc.property(safeLabelArb, fc.option(columnsArb, { nil: undefined }), (source, colSpecs) => {
        const meta = buildJsonExportMetadata({
          source,
          columns: colSpecs ? toColumns(colSpecs) : undefined,
        });
        if (colSpecs && colSpecs.length > 0) {
          expect(Array.isArray(meta.columns)).toBe(true);
          expect((meta.columns as unknown[]).length).toBe(colSpecs.length);
        } else {
          expect(meta.columns).toBeUndefined();
        }
      }),
      { numRuns: RUNS },
    );
  });

  // ------------------------------------------------------------------
  // 2. Optional blocks appear iff meaningful; never empty {}.
  // ------------------------------------------------------------------
  it("optional blocks (extra/filters/sort/page/counts) are present iff meaningful", () => {
    fc.assert(
      fc.property(
        safeLabelArb,
        kvMapArb, // extra
        kvMapArb, // filters
        fc.option(sortArb, { nil: undefined }),
        fc.option(pageArb, { nil: undefined }),
        fc.option(countsArb, { nil: undefined }),
        (source, extra, filters, sort, page, counts) => {
          const meta = buildJsonExportMetadata({
            source,
            extra,
            filters,
            sort,
            page,
            counts,
          });
          // Never surface an empty container.
          if (meta.extra !== undefined) {
            expect(typeof meta.extra).toBe("object");
            expect(Object.keys(meta.extra as object).length).toBeGreaterThan(0);
          }
          if (meta.filters !== undefined) {
            expect(typeof meta.filters).toBe("object");
            expect(Object.keys(meta.filters as object).length).toBeGreaterThan(0);
          }
          if (sort && sort.key) {
            expect(meta.sort).toEqual({ key: sort.key, dir: sort.dir });
          } else {
            expect(meta.sort).toBeUndefined();
          }
          if (page) {
            expect(meta.page).toEqual(page);
          } else {
            expect(meta.page).toBeUndefined();
          }
          if (
            counts &&
            (counts.shown !== undefined ||
              counts.filtered !== undefined ||
              counts.total !== undefined)
          ) {
            expect(typeof meta.counts).toBe("object");
            const emittedCounts = meta.counts as Record<string, number>;
            for (const b of ["shown", "filtered", "total"] as const) {
              if (counts[b] !== undefined) expect(emittedCounts[b]).toBe(counts[b]);
              else expect(b in emittedCounts).toBe(false);
            }
          } else {
            expect(meta.counts).toBeUndefined();
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  // ------------------------------------------------------------------
  // 3. Column entry shape / types / uniqueness / order.
  // ------------------------------------------------------------------
  it("every column entry has exactly {order, key, label} with correct types", () => {
    fc.assert(
      fc.property(safeLabelArb, columnsArb, (source, colSpecs) => {
        const columns = toColumns(colSpecs);
        const meta = buildJsonExportMetadata({ source, columns });
        const cols = meta.columns ?? [];
        expect(cols).toHaveLength(columns.length);
        for (let i = 0; i < cols.length; i++) {
          const c = cols[i]!;
          const keys = Object.keys(c).sort();
          expect(keys).toEqual(["key", "label", "order"]);
          expect(c.order).toBe(i);
          expect(typeof c.key).toBe("string");
          expect(c.key.length).toBeGreaterThan(0);
          expect(typeof c.label).toBe("string");
          expect(c.label.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("every derived `key` across the columns array is unique", () => {
    fc.assert(
      fc.property(safeLabelArb, columnsArb, (source, colSpecs) => {
        const meta = buildJsonExportMetadata({ source, columns: toColumns(colSpecs) });
        const keys = (meta.columns as Array<{ key: string }>).map((c) => c.key);
        expect(new Set(keys).size).toBe(keys.length);
      }),
      { numRuns: RUNS },
    );
  });

  // ------------------------------------------------------------------
  // 4. Explicit / label-only interleave: no cross-contamination.
  // ------------------------------------------------------------------
  it("explicit-keyed and label-only positions keep their own base namespace (no cross-contamination)", () => {
    fc.assert(
      fc.property(safeLabelArb, columnsArb, (source, colSpecs) => {
        // Force at least one of each variety when possible so the
        // interleave is real; otherwise skip.
        fc.pre(colSpecs.some((s) => s.hasKey) && colSpecs.some((s) => !s.hasKey));
        // Deduplicate explicit keys inside the batch — the builder
        // enforces uniqueness by suffixing, so identical explicit keys
        // would drift from `verbatim` to `key_2`. We're testing
        // preservation here, so filter down to a first-write-wins set.
        const seenExplicit = new Set<string>();
        const filtered = colSpecs.filter((s) => {
          if (!s.hasKey) return true;
          const k = s.key.trim();
          if (seenExplicit.has(k)) return false;
          seenExplicit.add(k);
          return true;
        });
        fc.pre(filtered.length > 0);
        const columns = toColumns(filtered);
        const meta = buildJsonExportMetadata({ source, columns });
        const cols = meta.columns as Array<{ order: number; key: string; label: string }>;
        // Base-namespace membership check: a legitimate slug can END
        // with `_N` (e.g. "0 0" → "0_0"), so a naive `/_\d+$/` strip
        // would confuse the label's own slug with a dedupe suffix.
        // Instead assert startsWith: emitted key is either the base
        // verbatim OR `base_` followed by digits added by dedupe.
        const inBaseNamespace = (emitted: string, base: string) => {
          if (emitted === base) return true;
          if (!emitted.startsWith(base + "_")) return false;
          const tail = emitted.slice(base.length + 1);
          return /^\d+$/.test(tail);
        };
        for (let i = 0; i < filtered.length; i++) {
          const spec = filtered[i]!;
          if (spec.hasKey) {
            const trimmed = spec.key.trim();
            expect(inBaseNamespace(cols[i].key, trimmed)).toBe(true);
            expect(cols[i].label).toBe(spec.label.trim());
          } else {
            const slug = slugifyColumnKey(spec.label);
            expect(inBaseNamespace(cols[i].key, slug)).toBe(true);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  // ------------------------------------------------------------------
  // 5. Byte-stability: same input → identical JSON serialisation.
  // ------------------------------------------------------------------
  it("two builds with the same input produce byte-identical JSON.stringify output", () => {
    fc.assert(
      fc.property(
        safeLabelArb,
        columnsArb,
        kvMapArb,
        kvMapArb,
        fc.option(sortArb, { nil: undefined }),
        (source, colSpecs, extra, filters, sort) => {
          const input: CsvMetadataInput = {
            source,
            columns: toColumns(colSpecs),
            extra,
            filters,
            sort,
            generatedAt: new Date("2026-07-07T10:00:00Z"),
          };
          const a = JSON.stringify(buildJsonExportMetadata(input));
          const b = JSON.stringify(buildJsonExportMetadata(input));
          expect(a).toBe(b);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("permuting `extra` / `filters` insertion order does NOT change the emitted JSON", () => {
    // Sorted-entries invariant: the envelope must be byte-stable across
    // caller insertion order for the two map-shaped optional blocks.
    fc.assert(
      fc.property(
        safeLabelArb,
        kvMapArb,
        kvMapArb,
        fc.integer({ min: 0, max: 20 }),
        (source, extra, filters, seed) => {
          const shuffle = <T extends Record<string, unknown>>(m: T): T => {
            const entries = Object.entries(m);
            for (let i = 0; i < entries.length; i++) {
              const j = (i * 7 + seed * 3 + 1) % Math.max(1, entries.length);
              const tmp = entries[i]!;
              entries[i] = entries[j]!;
              entries[j] = tmp;
            }
            return Object.fromEntries(entries) as T;
          };
          const generatedAt = new Date("2026-07-07T10:00:00Z");
          const a = JSON.stringify(
            buildJsonExportMetadata({ source, extra, filters, generatedAt }),
          );
          const b = JSON.stringify(
            buildJsonExportMetadata({
              source,
              extra: shuffle(extra),
              filters: shuffle(filters),
              generatedAt,
            }),
          );
          expect(a).toBe(b);
        },
      ),
      { numRuns: RUNS },
    );
  });

  // ------------------------------------------------------------------
  // 6. Column ORDER matches input order (no re-sorting).
  // ------------------------------------------------------------------
  it("emitted column order mirrors input order exactly (no re-sorting by key/label)", () => {
    fc.assert(
      fc.property(safeLabelArb, columnsArb, (source, colSpecs) => {
        const columns = toColumns(colSpecs);
        const meta = buildJsonExportMetadata({ source, columns });
        const cols = meta.columns as Array<{ order: number; label: string }>;
        // `order` sequence is a strictly ascending 0..N-1.
        expect(cols.map((c) => c.order)).toEqual(cols.map((_, i) => i));
        // And labels appear in the same order as the trimmed inputs.
        expect(cols.map((c) => c.label)).toEqual(columns.map((c) => c.label.trim()));
      }),
      { numRuns: RUNS },
    );
  });
});
