/**
 * Zod schema for the JSON export envelope produced by
 * `buildJsonExportMetadata` (as `_meta`) plus a `rows` array of records.
 *
 * The schema is the machine-checkable version of the contract described
 * on `JsonExportMetadata` in `csvExportMetadata.ts`. Downstream tooling
 * (importers, audits, integration tests) can `parse()` a downloaded
 * `.json` file against `jsonExportEnvelopeSchema` and fail loudly on
 * any drift instead of silently accepting a malformed payload.
 *
 * Design rules:
 *   - `schema` and `version` are pinned to the current envelope
 *     constants — a bump on either side means the reader must
 *     opt-in, not blindly accept.
 *   - Optional buckets (`extra`, `filters`, `sort`, `page`, `counts`,
 *     `columns`) are absent-or-populated; explicit `null` is rejected
 *     because the writer never emits it.
 *   - `columns` entries carry a dense `order: 0..N-1` sequence with
 *     globally-unique, non-empty `key`s.
 *   - `page` numeric fields are positive integers (writer contract).
 *   - `counts` buckets are non-negative integers when present.
 *   - The envelope is `.passthrough()` — the writer's `[key: string]:
 *     unknown` index signature lets callers spread extra top-level
 *     fields alongside `_meta` (e.g. `rows`, custom envelopes), so the
 *     schema must NOT reject unknown keys.
 */
import { z } from "zod";
import { JSON_ENVELOPE_SCHEMA, JSON_ENVELOPE_VERSION } from "./csvExportMetadata";

const nonEmptyString = z.string().min(1);
const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();

/** A single `_meta.columns[]` entry. */
export const jsonExportColumnSchema = z.object({
  order: nonNegativeInt,
  key: nonEmptyString,
  label: z.string(),
});

/** The `_meta` object itself. */
export const jsonExportMetaSchema = z
  .object({
    schema: z.literal(JSON_ENVELOPE_SCHEMA),
    version: z.literal(JSON_ENVELOPE_VERSION),
    source: nonEmptyString,
    /** ISO-8601 timestamp emitted by `Date.toISOString()`. */
    generatedAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
      message: "generatedAt must be a parseable ISO-8601 timestamp",
    }),
    extra: z.record(z.string(), z.string()).optional(),
    filters: z.record(z.string(), z.string()).optional(),
    sort: z
      .object({
        key: nonEmptyString,
        dir: z.enum(["asc", "desc"]),
      })
      .optional(),
    page: z
      .object({
        page: positiveInt,
        totalPages: positiveInt,
        pageSize: positiveInt,
      })
      .optional(),
    counts: z
      .object({
        shown: nonNegativeInt.optional(),
        filtered: nonNegativeInt.optional(),
        total: nonNegativeInt.optional(),
      })
      .refine((c) => c.shown !== undefined || c.filtered !== undefined || c.total !== undefined, {
        message: "counts must have at least one populated bucket",
      })
      .optional(),
    columns: z.array(jsonExportColumnSchema).optional(),
  })
  // Structural refinements that span multiple fields — kept as
  // `.superRefine` so the error paths point at the offending element.
  .superRefine((meta, ctx) => {
    if (!meta.columns) return;
    const keys = new Set<string>();
    meta.columns.forEach((c, i) => {
      if (c.order !== i) {
        ctx.addIssue({
          code: "custom",
          path: ["columns", i, "order"],
          message: `Expected order ${i}, got ${c.order}`,
        });
      }
      if (keys.has(c.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["columns", i, "key"],
          message: `Duplicate column key: ${JSON.stringify(c.key)}`,
        });
      }
      keys.add(c.key);
    });
  });

/**
 * The full envelope shape: `{ _meta, rows }` plus any additional
 * top-level fields the caller chose to spread in. `rows` is an array
 * of records keyed by string — cell values are `unknown` so downstream
 * schemas can narrow per dataset without this base schema having to
 * know every column type.
 */
export const jsonExportEnvelopeSchema = z
  .object({
    _meta: jsonExportMetaSchema,
    rows: z.array(z.record(z.string(), z.unknown())),
  })
  // Allow additional top-level fields so callers can extend the envelope.
  .catchall(z.unknown());

export type JsonExportEnvelope = z.infer<typeof jsonExportEnvelopeSchema>;
export type JsonExportMetaParsed = z.infer<typeof jsonExportMetaSchema>;
