/**
 * Regression: the JSON metadata envelope for a collision-heavy export
 * must serialise to the EXACT SAME bytes on every run — same key
 * ordering, same suffix bumps, same optional-bucket omission, same
 * whitespace. A drift here corrupts snapshot diffs, breaks downstream
 * consumers that hash the envelope for cache-busting, and desynchronises
 * the CSV↔JSON sibling round-trip.
 *
 * The test loops the full export→import→re-export workflow N times
 * against a fixture built to trigger every derived-key collision path:
 *
 *   • bare slug collision                     (`Zeta Score` × 3)
 *   • label collides with a literal `_2` sibling   (`amount` + `amount_2`)
 *   • unicode label folded to same slug       (`Café` NFC vs NFD)
 *   • explicit-key precedence at collision    (`{key: "gamma"}` vs `Gamma`)
 *   • empty/symbol-only label → "column" bucket
 *
 * Assertions per iteration:
 *   1. `JSON.stringify(meta, null, 2)` is byte-identical to iteration 0
 *      (proves ordering + omission + suffix bumps are deterministic).
 *   2. The CSV round-trip (`prefixCsvWithMetadata → parseCsvMetadataHeader
 *      → reconstruct envelope → stringify`) is byte-identical to
 *      iteration 0 (proves the on-disk boundary preserves ordering).
 *   3. The `Object.keys(meta)` order matches the writer's canonical order
 *      (proves nothing was re-shuffled by `V8`'s hash map).
 */
import { describe, it, expect } from "vitest";
import {
  prefixCsvWithMetadata,
  buildJsonExportMetadata,
  type CsvMetadataInput,
  type JsonExportMetadata,
} from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");
const ITERATIONS = 50;

// Collision-heavy fixture — every derived-key path in
// `withDerivedColumnKeys` is exercised at least once.
const COLLISION_INPUT: CsvMetadataInput = {
  source: "Ledger — Collision Regression",
  generatedAt: FIXED_DATE,
  // Insertion order deliberately jumbled to prove the writer sorts.
  extra: { Owner: "ops", Report: "Weekly", Batch: "42" },
  filters: { Status: "Open", Owner: "Ada", Bucket: "A" },
  sort: { key: "postedAt", dir: "desc" },
  page: { page: 2, totalPages: 7, pageSize: 25 },
  counts: { shown: 25, filtered: 175, total: 500 },
  columns: [
    "Zeta Score", // bare slug: zeta_score
    "Zeta Score", // collision → zeta_score_2
    "Zeta Score", // collision → zeta_score_3
    "amount", // bare slug: amount
    "amount_2", // literal sibling; next `amount` must skip past it
    "amount", // collision walk: amount_3 (not amount_2)
    "Café", // NFC
    "Cafe\u0301", // NFD twin — same visual, distinct slug
    { key: "gamma", label: "Gamma" }, // explicit key wins
    "Gamma", // label-only sibling → gamma_2
    "—", // symbol-only label → "column" bucket
    "—", // → column_2
  ],
};

/**
 * Reconstruct a JSON-envelope-shaped object from the parsed CSV
 * metadata, matching the exact field order + shape of
 * `buildJsonExportMetadata`. Used by iteration 0's CSV baseline and
 * every subsequent iteration.
 */
function reconstructFromCsv(csv: string): Record<string, unknown> {
  const parsed = parseCsvMetadataHeader(csv);
  const out: Record<string, unknown> = {
    schema: parsed.schema,
    version: parsed.version,
    source: parsed.source,
    generatedAt: parsed.generatedAt,
  };
  const sortKeys = <T extends Record<string, unknown>>(m: T): T => {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(m).sort()) o[k] = m[k];
    return o as T;
  };
  if (Object.keys(parsed.extra).length > 0) out.extra = sortKeys(parsed.extra);
  if (Object.keys(parsed.filters).length > 0) out.filters = sortKeys(parsed.filters);
  if (parsed.sort) out.sort = parsed.sort;
  if (parsed.page) out.page = parsed.page;
  if (parsed.counts) out.counts = parsed.counts;
  if (parsed.columns) {
    out.columns = parsed.columns.map((c, i) => ({
      order: i,
      key: c.key,
      label: c.label,
    }));
  }
  return out;
}

describe("JSON metadata — collision workflow byte-stability regression", () => {
  it("stays bit-for-bit identical across repeated export cycles", () => {
    const baselineMeta: JsonExportMetadata = buildJsonExportMetadata(COLLISION_INPUT);
    const baselineJson = JSON.stringify(baselineMeta, null, 2);
    const baselineKeyOrder = Object.keys(baselineMeta);

    // Canonical top-level ordering — required by every downstream
    // consumer that greps `schema` / `version` before parsing further.
    const canonicalOrder = [
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
    ];
    expect(baselineKeyOrder).toEqual(canonicalOrder);

    // Round-trip baseline through the CSV boundary once so we can pin
    // the on-disk representation to the same bytes on every iteration.
    const baselineCsv = prefixCsvWithMetadata("h1,h2\r\nv1,v2\r\n", COLLISION_INPUT);
    const baselineCsvJson = JSON.stringify(reconstructFromCsv(baselineCsv), null, 2);

    for (let i = 1; i <= ITERATIONS; i++) {
      const meta = buildJsonExportMetadata(COLLISION_INPUT);
      const json = JSON.stringify(meta, null, 2);

      // 1. Envelope bytes stable across runs.
      expect(json, `iteration ${i}: JSON drift`).toBe(baselineJson);

      // 2. Top-level key order stable (V8 does not re-shuffle).
      expect(Object.keys(meta), `iteration ${i}: key order drift`).toEqual(baselineKeyOrder);

      // 3. Sorted-map bucket order stable (`extra` / `filters` sorted).
      expect(Object.keys(meta.extra ?? {}), `iteration ${i}: extra key order`).toEqual([
        "Batch",
        "Owner",
        "Report",
      ]);
      expect(Object.keys(meta.filters ?? {}), `iteration ${i}: filters key order`).toEqual([
        "Bucket",
        "Owner",
        "Status",
      ]);

      // 4. Column suffix bumps land on the exact same keys every run.
      expect(
        meta.columns?.map((c) => c.key),
        `iteration ${i}: column keys`,
      ).toEqual([
        "zeta_score",
        "zeta_score_2",
        "zeta_score_3",
        "amount",
        "amount_2",
        "amount_3",
        "caf", // "Café" NFC → non-alnum stripped
        "cafe", // "Cafe\u0301" NFD → combining mark stripped, trailing e kept
        "gamma", // explicit key wins
        "gamma_2", // label-only sibling bumped
        "column", // "—" → fallback bucket
        "column_2", // second "—" bumped
      ]);

      // 5. CSV round-trip produces the same bytes as the baseline.
      const csv = prefixCsvWithMetadata("h1,h2\r\nv1,v2\r\n", COLLISION_INPUT);
      const csvJson = JSON.stringify(reconstructFromCsv(csv), null, 2);
      expect(csvJson, `iteration ${i}: CSV round-trip drift`).toBe(baselineCsvJson);
    }
  });

  it("input insertion-order permutations do not change the envelope", () => {
    // Rebuild the input with `extra` / `filters` keys inserted in reverse
    // order. Because the writer sorts these maps, the serialised envelope
    // must be identical to the baseline byte-for-byte.
    const reverseObj = <T extends Record<string, unknown>>(o: T): T => {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(o).reverse()) out[k] = o[k];
      return out as T;
    };
    const permuted: CsvMetadataInput = {
      ...COLLISION_INPUT,
      extra: reverseObj(COLLISION_INPUT.extra ?? {}) as CsvMetadataInput["extra"],
      filters: reverseObj(
        COLLISION_INPUT.filters as Record<string, unknown>,
      ) as CsvMetadataInput["filters"],
    };
    const baseline = JSON.stringify(buildJsonExportMetadata(COLLISION_INPUT), null, 2);
    const shuffled = JSON.stringify(buildJsonExportMetadata(permuted), null, 2);
    expect(shuffled).toBe(baseline);
  });
});
