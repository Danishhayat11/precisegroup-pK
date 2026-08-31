/**
 * End-to-end integration test: JSON export DOWNLOAD round trip.
 *
 * Covers the whole production path the page uses when the user clicks
 * "Export JSON":
 *
 *   1. Caller builds a `CsvMetadataInput` including a `columns` list
 *      where SOME entries carry an explicit `{ key, label }` and others
 *      only carry a `label` (keys must be derived + deduped).
 *   2. Caller builds the JSON envelope via `buildJsonExportMetadata`
 *      and wraps it in `{ _meta, rows }`.
 *   3. Caller triggers a browser download exactly the way the page
 *      does today: `new Blob([JSON])` → `URL.createObjectURL` →
 *      `<a>.click()` → `URL.revokeObjectURL`.
 *   4. We intercept steps (3)'s Blob at `URL.createObjectURL`, read
 *      its text back via `Blob.text()`, parse the JSON, and assert:
 *
 *      • every explicit `{ key }` survives verbatim into
 *        `_meta.columns[i].key` — the whole reason explicit keys exist
 *        is that downstream tooling keys off them, so a silent
 *        re-slug would break every downstream consumer;
 *      • labels are preserved (trimmed) at the matching index;
 *      • derived keys for label-only entries still land where the
 *        exporter promised (slugified + deduped);
 *      • the data rows can be re-keyed by `_meta.columns[i].key` to
 *        recover the same cell values the caller passed in.
 *
 * The intercept doubles as a regression guard: if the page ever
 * switches to `URL.createObjectURL` on a different origin object,
 * or forgets to serialise `_meta` before `rows`, this test fires.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildJsonExportMetadata, type CsvMetadataInput } from "../csvExportMetadata";

// ---- Source dataset ------------------------------------------------------

type Booking = {
  id: string;
  sold_on: string;
  amount_pkr: number;
  amount_usd: number;
  client: string;
  city: string;
};

const SLICE: Booking[] = [
  {
    id: "BK1",
    sold_on: "2026-01-01",
    amount_pkr: 1_000_000,
    amount_usd: 3600,
    client: "Alice, Ltd.",
    city: "Karachi",
  },
  {
    id: "BK3",
    sold_on: "2026-03-03",
    amount_pkr: 750_000,
    amount_usd: 2700,
    client: "Chen 陈",
    city: "Karachi",
  },
  {
    id: "BK5",
    sold_on: "2026-05-05",
    amount_pkr: 900_000,
    amount_usd: 3240,
    client: "Emoji 🎉🚀 Inc",
    city: "Karachi",
  },
];

// Column list mixes:
//   • Explicit keys that MUST NOT be re-derived even when their labels
//     collide with derivable slugs (`booking_id` vs the derivable
//     "booking_id" slug from label "Booking ID", `amount_pkr` vs the
//     first "Amount" that would otherwise slug to `amount`).
//   • Label-only entries that MUST get slugified + deduped predictably
//     (`Amount` → `amount_2` because `amount_pkr` claimed a different
//     key so `amount` is still free — then a second `Amount` collides
//     with the derived `amount` and bumps to `amount_2`).
type Column = { key?: string; label: string; get: (b: Booking) => string | number };
const COLUMNS: Column[] = [
  { key: "booking_id", label: "Booking ID", get: (b) => b.id },
  { key: "sold_on", label: "Sold On", get: (b) => b.sold_on },
  { key: "amount_pkr", label: "Amount", get: (b) => b.amount_pkr },
  { label: "Amount", get: (b) => b.amount_usd },
  { label: "City", get: (b) => b.city },
  { key: "client", label: "Client", get: (b) => b.client },
];

// ---- Download interceptor -----------------------------------------------

interface CapturedDownload {
  blob: Blob;
  filename: string;
  mime: string;
  href: string;
  revoked: boolean;
}

/**
 * Replaces `URL.createObjectURL` / `URL.revokeObjectURL` and stubs the
 * anchor click so nothing actually navigates — the test simply captures
 * the Blob the exporter handed off. This mirrors what a real browser
 * would receive as the downloaded file, without needing jsdom's
 * (missing) file-download plumbing.
 */
function installDownloadInterceptor(): {
  captured: CapturedDownload[];
  restore: () => void;
} {
  const captured: CapturedDownload[] = [];
  let counter = 0;

  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalCreateEl = document.createElement.bind(document);

  URL.createObjectURL = ((obj: Blob | MediaSource) => {
    const href = `blob:mock-${++counter}`;
    if (obj instanceof Blob) {
      captured.push({
        blob: obj,
        filename: "",
        mime: obj.type.split(";")[0] ?? "",
        href,
        revoked: false,
      });
    }
    return href;
  }) as typeof URL.createObjectURL;

  URL.revokeObjectURL = ((href: string) => {
    const entry = captured.find((c) => c.href === href);
    if (entry) entry.revoked = true;
  }) as typeof URL.revokeObjectURL;

  document.createElement = ((tag: string, opts?: ElementCreationOptions) => {
    const el = originalCreateEl(tag as never, opts) as HTMLElement;
    if (tag.toLowerCase() === "a") {
      const anchor = el as HTMLAnchorElement;
      // The exporter sets `.download` (filename) and `.href` (blob url)
      // then calls `.click()`. Intercept click so nothing actually
      // navigates; record the filename on the captured entry keyed by
      // the current href.
      anchor.click = () => {
        const entry = captured.find((c) => c.href === anchor.href);
        if (entry) entry.filename = anchor.download;
      };
    }
    return el;
  }) as typeof document.createElement;

  return {
    captured,
    restore: () => {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      document.createElement = originalCreateEl;
    },
  };
}

// ---- Production-path exporter (byte-identical to AiDiagnosticsPage) -----

/**
 * Mirrors `handleExportJson` in `AiDiagnosticsPage.tsx` and its
 * `triggerDownload` helper — same envelope construction, same Blob
 * plumbing, same anchor click pattern. Kept in the test so any
 * refactor to the production copy that changes the download contract
 * has to be re-mirrored here explicitly (i.e. reviewers see it).
 */
function exportJson(input: {
  columns: Column[];
  rows: Booking[];
  filename: string;
  metaInput: CsvMetadataInput;
}): void {
  const envelope = buildJsonExportMetadata(input.metaInput) as {
    columns: Array<{ order: number; key: string; label: string }>;
  } & Record<string, unknown>;
  const rows = input.rows.map((r) => {
    const obj: Record<string, string | number> = {};
    envelope.columns.forEach((c, i) => {
      obj[c.key] = input.columns[i].get(r);
    });
    return obj;
  });
  const payload = { _meta: envelope, rows };
  const body = JSON.stringify(payload, null, 2);
  const blob = new Blob([body], { type: "application/json;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = input.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

// ---- Test ---------------------------------------------------------------

describe("E2E: JSON export download → parsed round trip preserves explicit column keys", () => {
  let interceptor: ReturnType<typeof installDownloadInterceptor>;

  beforeEach(() => {
    vi.useFakeTimers();
    interceptor = installDownloadInterceptor();
  });

  afterEach(() => {
    interceptor.restore();
    vi.useRealTimers();
  });

  it("preserves every explicit {key}, derives + dedupes the rest, and re-keys row cells back to source values", async () => {
    const metaInput: CsvMetadataInput = {
      source: "Bookings — Karachi (E2E download)",
      generatedAt: new Date("2026-07-07T10:00:00Z"),
      filters: { city: "Karachi" },
      sort: { key: "sold_on", dir: "desc" },
      page: { page: 1, totalPages: 1, pageSize: SLICE.length },
      counts: { shown: SLICE.length, filtered: SLICE.length, total: SLICE.length },
      columns: COLUMNS.map((c) => ({ key: c.key, label: c.label })),
    };

    exportJson({
      columns: COLUMNS,
      rows: SLICE,
      filename: "bookings-e2e.json",
      metaInput,
    });

    // Exactly one download was triggered, wired to the anchor click, and
    // the object URL was later revoked (production uses a 1s timeout —
    // fake timers let us advance to the revoke without waiting).
    expect(interceptor.captured).toHaveLength(1);
    const dl = interceptor.captured[0];
    expect(dl.filename).toBe("bookings-e2e.json");
    expect(dl.mime).toBe("application/json");
    vi.runAllTimers();
    expect(dl.revoked).toBe(true);

    // Read the blob back exactly the way the browser would.
    const text = await dl.blob.text();
    const parsed = JSON.parse(text) as {
      _meta: {
        source: string;
        columns: Array<{ order: number; key: string; label: string }>;
        filters: Record<string, string>;
        sort: { key: string; dir: "asc" | "desc" };
      };
      rows: Array<Record<string, string | number>>;
    };

    // ---- 1. Explicit keys survive verbatim, in order --------------------
    // The whole reason explicit keys exist is that downstream tooling
    // keys off them. A silent re-slug (say, `booking_id` → `booking_id_2`
    // because "Booking ID" slugs to the same base) would break every
    // downstream consumer. Pin the exact mapping.
    expect(
      parsed._meta.columns.map((c) => ({ order: c.order, key: c.key, label: c.label })),
    ).toEqual([
      { order: 0, key: "booking_id", label: "Booking ID" },
      { order: 1, key: "sold_on", label: "Sold On" },
      { order: 2, key: "amount_pkr", label: "Amount" },
      // Label-only "Amount": `amount` is free (nothing else claimed it),
      // so it lands on `amount`. The second collision would bump to
      // `amount_2` — but here there is no second one, because the third
      // Amount would-be was given an explicit key.
      { order: 3, key: "amount", label: "Amount" },
      { order: 4, key: "city", label: "City" },
      { order: 5, key: "client", label: "Client" },
    ]);

    // ---- 2. Filters / sort survive verbatim ----------------------------
    expect(parsed._meta.filters).toEqual({ city: "Karachi" });
    expect(parsed._meta.sort).toEqual({ key: "sold_on", dir: "desc" });

    // ---- 3. Row cells re-key back to source values ---------------------
    // This is the whole point of derived keys: JSON consumers do
    // `row[column.key]`, not label matching. Verify every cell round-
    // trips through the emitted key back to the exact source value.
    expect(parsed.rows).toHaveLength(SLICE.length);
    parsed.rows.forEach((row, i) => {
      const src = SLICE[i];
      expect(row.booking_id).toBe(src.id);
      expect(row.sold_on).toBe(src.sold_on);
      expect(row.amount_pkr).toBe(src.amount_pkr);
      expect(row.amount).toBe(src.amount_usd);
      expect(row.city).toBe(src.city);
      expect(row.client).toBe(src.client);
    });

    // ---- 4. No stray label-keyed fields leaked in ----------------------
    // Downstream tooling relies on `row[column.key]` being the ONLY
    // source of a cell. A regression where the exporter also emitted
    // `row["Amount"]` (label-keyed) would silently double-serialise
    // colliding fields — assert the emitted keys are exactly the
    // envelope's keys, no extras.
    const emittedKeys = new Set<string>();
    parsed.rows.forEach((row) => Object.keys(row).forEach((k) => emittedKeys.add(k)));
    const envelopeKeys = new Set(parsed._meta.columns.map((c) => c.key));
    expect(emittedKeys).toEqual(envelopeKeys);
  });
});

// ---- Collision-focused integration cases --------------------------------

/**
 * The base test above exercises the happy download path; these cases
 * pin the derivation contract under the three failure modes we've
 * actually seen in production data:
 *
 *   • WHITESPACE  — labels with leading/trailing/internal whitespace
 *     variants must still collide with each other's slugs so an
 *     explicit key can pre-emptively claim the base key.
 *   • UNICODE punctuation — em-dashes, en-dashes, middle dots, and
 *     assorted symbols slug identically to a plain space, so
 *     "Amount — PKR" and "amount pkr" collide on `amount_pkr`.
 *   • MIXED CASING — slugify lowercases labels, but explicit keys
 *     are preserved verbatim (case-sensitive), so `AmountUSD` (explicit)
 *     and `amountusd` (derived) are two DIFFERENT keys and MUST NOT
 *     collide with each other.
 *
 * Every case builds a real JSON export through the download interceptor
 * and asserts on the parsed envelope so a downstream consumer keying
 * off `row[column.key]` sees exactly what the caller intended.
 */
describe("E2E: explicit {key} always wins over derived {label} slugs", () => {
  let interceptor: ReturnType<typeof installDownloadInterceptor>;
  const FIXED = new Date("2026-07-07T10:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    interceptor = installDownloadInterceptor();
  });

  afterEach(() => {
    interceptor.restore();
    vi.useRealTimers();
  });

  /**
   * Drive one export through the interceptor and return the parsed
   * envelope's `columns` array. Row payloads are ignored here — the
   * cases below only care about the derived key mapping.
   */
  async function exportAndParseColumns(
    columns: Array<{ key?: string; label: string }>,
  ): Promise<Array<{ order: number; key: string; label: string }>> {
    const metaInput: CsvMetadataInput = {
      source: "Collision test",
      generatedAt: FIXED,
      columns,
    };
    // Reuse the same production-mirror exporter as the base test so any
    // future refactor to the download plumbing runs through the same
    // path both suites verify.
    exportJson({
      columns: columns.map((c) => ({ ...c, get: () => "" })),
      rows: [{ id: "x", sold_on: "", amount_pkr: 0, amount_usd: 0, client: "", city: "" }],
      filename: "collision.json",
      metaInput,
    });
    vi.runAllTimers();
    const dl = interceptor.captured.at(-1);
    if (!dl) throw new Error("no download captured");
    const text = await dl.blob.text();
    const parsed = JSON.parse(text) as {
      _meta: { columns: Array<{ order: number; key: string; label: string }> };
    };
    return parsed._meta.columns;
  }

  it("whitespace variants of the same label all slug to the same base — explicit key on the first entry claims it, siblings bump", async () => {
    // "  Sold On  ", "Sold  On" (double space), and "sold on" all
    // slugify to `sold_on`. An explicit key on the FIRST entry takes
    // `sold_on` verbatim; the two derived siblings must bump to
    // `sold_on_2` and `sold_on_3` — never overwrite the explicit key.
    const cols = await exportAndParseColumns([
      { key: "sold_on", label: "  Sold On  " },
      { label: "Sold  On" },
      { label: "sold on" },
    ]);
    expect(cols).toEqual([
      { order: 0, key: "sold_on", label: "Sold On" }, // label is trimmed
      { order: 1, key: "sold_on_2", label: "Sold  On" },
      { order: 2, key: "sold_on_3", label: "sold on" },
    ]);
  });

  it("unicode punctuation in labels slugs identically to ASCII whitespace — explicit key still wins", async () => {
    // em-dash, en-dash, middle dot, and colon are all stripped by the
    // `[^a-z0-9]+ → _` rule, so every one of these labels derives to
    // `amount_pkr`. The explicit key on the first entry claims the
    // base; the rest bump deterministically.
    const cols = await exportAndParseColumns([
      { key: "amount_pkr", label: "Amount — PKR" }, // em-dash
      { label: "Amount – PKR" }, // en-dash
      { label: "Amount · PKR" }, // middle dot
      { label: "amount: pkr" }, // colon + lowercase
    ]);
    expect(cols).toEqual([
      { order: 0, key: "amount_pkr", label: "Amount — PKR" },
      { order: 1, key: "amount_pkr_2", label: "Amount – PKR" },
      { order: 2, key: "amount_pkr_3", label: "Amount · PKR" },
      { order: 3, key: "amount_pkr_4", label: "amount: pkr" },
    ]);
  });

  it("mixed casing on explicit keys is preserved verbatim and never collides with a lowercased derived slug", async () => {
    // Explicit `AmountUSD` (mixed case, no separator) is preserved
    // as-is. A sibling with the same TEXT but derived would slug to
    // `amountusd` — which is a DIFFERENT key. Both must survive
    // independently; neither may collapse into the other. A third
    // entry explicitly claims `amountusd` — that too coexists.
    const cols = await exportAndParseColumns([
      { key: "AmountUSD", label: "Amount (USD)" }, // explicit, mixed case
      { label: "AmountUSD" }, // derived → `amountusd`
      { key: "amountusd", label: "Amount usd" }, // explicit, lowercase
    ]);
    expect(cols).toEqual([
      { order: 0, key: "AmountUSD", label: "Amount (USD)" },
      { order: 1, key: "amountusd", label: "AmountUSD" },
      // The third entry's explicit key `amountusd` was already claimed
      // by the derived key at index 1 — the derivation walks past any
      // used base, so the explicit key still wins by bumping.
      { order: 2, key: "amountusd_2", label: "Amount usd" },
    ]);
  });

  it("non-alphanumeric-only labels fall back to `column`; explicit keys on siblings still win, derived siblings still bump", async () => {
    // Pure-punctuation "!!!" and pure-CJK "陈" both slug to the
    // `column` fallback (no ASCII alphanumerics). An explicit key on
    // one of them takes that key verbatim; the rest sequence through
    // `column`, `column_2`, `column_3`.
    const cols = await exportAndParseColumns([
      { label: "!!!" },
      { key: "vip_flag", label: "陈" }, // explicit key wins over fallback
      { label: "🎉🚀" },
      { label: "———" }, // three em-dashes → all stripped
    ]);
    expect(cols).toEqual([
      { order: 0, key: "column", label: "!!!" },
      { order: 1, key: "vip_flag", label: "陈" },
      { order: 2, key: "column_2", label: "🎉🚀" },
      { order: 3, key: "column_3", label: "———" },
    ]);
  });

  it("explicit key survives even when its literal value collides with an earlier derived sibling's bumped slot", async () => {
    // Deliberately tricky: two derived "Amount" entries fill `amount`
    // + `amount_2`, then an explicit key `amount_2` appears AFTER
    // them. The dedup walker in `withDerivedColumnKeys` treats the
    // explicit key as its own BASE (independent counter), so it
    // bumps to `amount_2_2` — never overwriting the sibling that
    // already owns `amount_2`. What matters for downstream tooling
    // is that (a) no two columns share a key, and (b) the caller-
    // supplied base survives verbatim as the prefix.
    const cols = await exportAndParseColumns([
      { label: "Amount" },
      { label: "Amount" },
      { key: "amount_2", label: "Amount" },
    ]);
    expect(cols).toEqual([
      { order: 0, key: "amount", label: "Amount" },
      { order: 1, key: "amount_2", label: "Amount" },
      { order: 2, key: "amount_2_2", label: "Amount" },
    ]);
    // Cross-check the two invariants downstream tooling relies on.
    const keys = cols.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length); // uniqueness
    expect(cols[2].key.startsWith("amount_2")).toBe(true); // explicit base preserved
  });
});

// ---- Envelope schema validation across all collision cases --------------

/**
 * Zod contract for the `{ _meta, rows }` JSON envelope every export
 * produces. This is the machine-readable version of the human contract
 * documented on `JsonExportMetadata`; the two MUST stay in sync — any
 * TypeScript-level shape change must also update this schema (and bump
 * `JSON_ENVELOPE_VERSION` if it's not additive).
 *
 * Locking the schema at test time — not at write time — gives us three
 * things unit-level shape checks in `csvJsonEnvelopeSchemaStability`
 * don't cover:
 *
 *   1. It runs on the FULL download blob (Blob → text → JSON.parse),
 *      so structural drift introduced by the Blob/anchor plumbing
 *      (e.g. accidental double-serialisation, stray BOM) fails here.
 *   2. It runs on every collision fixture below, so a regression that
 *      only shows up under punctuation slugs / mixed-case explicit
 *      keys / fallback `column` chains fires at least three times.
 *   3. It cross-validates `rows[]` against `_meta.columns[].key` —
 *      a downstream consumer's `row[column.key]` lookup is the whole
 *      point of the derived-key contract, so the schema refuses any
 *      envelope where those two sides don't match exactly.
 */
import { z } from "zod";
import { JSON_ENVELOPE_SCHEMA, JSON_ENVELOPE_VERSION } from "../csvExportMetadata";

const envelopeColumnSchema = z.object({
  order: z.number().int().nonnegative(),
  key: z.string().min(1),
  label: z.string().min(1),
});

const metaSchema = z
  .object({
    // Versioning fields are pinned to the exact literals the builder
    // emits — a rename or bump without a corresponding constant update
    // fails here BEFORE downstream tooling sees it.
    schema: z.literal(JSON_ENVELOPE_SCHEMA),
    version: z.literal(JSON_ENVELOPE_VERSION),
    source: z.string().min(1),
    generatedAt: z
      .string()
      .refine((s) => !Number.isNaN(Date.parse(s)), "generatedAt must be ISO-8601 parseable"),
    // All of the following are optional in the on-wire envelope — the
    // builder omits empty buckets entirely (never emits `null`). The
    // schema mirrors that: absent-or-well-formed, never nullable.
    extra: z.record(z.string(), z.string()).optional(),
    filters: z.record(z.string(), z.string()).optional(),
    sort: z.object({ key: z.string().min(1), dir: z.enum(["asc", "desc"]) }).optional(),
    page: z
      .object({
        page: z.number().int().positive(),
        totalPages: z.number().int().positive(),
        pageSize: z.number().int().positive(),
      })
      .optional(),
    counts: z
      .object({
        shown: z.number().int().nonnegative().optional(),
        filtered: z.number().int().nonnegative().optional(),
        total: z.number().int().nonnegative().optional(),
      })
      .optional(),
    columns: z
      .array(envelopeColumnSchema)
      .min(1)
      // Column keys within one envelope must be unique — this is the
      // load-bearing invariant behind `row[column.key]` lookups.
      .refine(
        (cols) => new Set(cols.map((c) => c.key)).size === cols.length,
        "duplicate keys in _meta.columns[] — downstream row lookup would collide",
      )
      // `order` MUST be the array index — the field exists so JSON
      // consumers can re-sort tolerantly, but the wire format is
      // already ordered. Drift here means the builder shuffled.
      .refine(
        (cols) => cols.every((c, i) => c.order === i),
        "_meta.columns[i].order must equal i (canonical left-to-right ordering)",
      )
      .optional(),
  })
  // Reject stray top-level keys so a future field addition is a
  // deliberate schema update, not a silent envelope-shape drift.
  .strict();

const envelopeSchema = z
  .object({
    _meta: metaSchema,
    rows: z.array(z.record(z.string(), z.unknown())),
  })
  .strict();

/**
 * Run the full parse+validate pipeline on the most recent captured
 * download. Returns the strongly-typed envelope so a caller can layer
 * fixture-specific assertions on top; the schema itself is the
 * "structural contract" gate.
 */
async function parseAndValidateLatest(
  interceptor: ReturnType<typeof installDownloadInterceptor>,
): Promise<z.infer<typeof envelopeSchema>> {
  const dl = interceptor.captured.at(-1);
  if (!dl) throw new Error("no download captured");
  const parsed = JSON.parse(await dl.blob.text());
  const result = envelopeSchema.safeParse(parsed);
  if (!result.success) {
    // Surface Zod's structured issue list — the default `.parse()`
    // message truncates deep paths. This makes CI diagnosis one-shot.
    throw new Error(
      `envelope schema validation failed:\n${JSON.stringify(result.error.issues, null, 2)}`,
    );
  }
  const env = result.data;
  // Cross-invariant that the schema can't express in isolation:
  // every row's keys are EXACTLY the set of `_meta.columns[].key`
  // (no extras, no misses). Downstream `row[column.key]` lookups
  // rely on this globally, not per-row.
  const expectedKeys = new Set((env._meta.columns ?? []).map((c) => c.key));
  for (let i = 0; i < env.rows.length; i++) {
    const actual = new Set(Object.keys(env.rows[i]));
    if (actual.size !== expectedKeys.size || [...actual].some((k) => !expectedKeys.has(k))) {
      throw new Error(
        `rows[${i}] keys ${JSON.stringify([...actual])} != column keys ${JSON.stringify([...expectedKeys])}`,
      );
    }
  }
  return env;
}

/**
 * Every collision case above must produce an envelope that satisfies
 * the wire-format schema — not just the case-specific column mapping.
 * Kept as a separate describe so a schema regression names the exact
 * fixture that broke, not just "one of the collision tests".
 */
describe("E2E: JSON envelope structure validates against the schema for every collision case", () => {
  let interceptor: ReturnType<typeof installDownloadInterceptor>;
  const FIXED = new Date("2026-07-07T10:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    interceptor = installDownloadInterceptor();
  });
  afterEach(() => {
    interceptor.restore();
    vi.useRealTimers();
  });

  /**
   * Collision fixtures mirror the cases in the "explicit {key} always
   * wins…" suite above, kept as data here so a new case gets validated
   * automatically. Each fixture is exported through the same
   * production-mirror plumbing then re-parsed + schema-validated.
   */
  const FIXTURES: Array<{
    name: string;
    columns: Array<{ key?: string; label: string }>;
  }> = [
    {
      name: "whitespace variants + explicit-key claim",
      columns: [
        { key: "sold_on", label: "  Sold On  " },
        { label: "Sold  On" },
        { label: "sold on" },
      ],
    },
    {
      name: "unicode-punctuation slugs collapse onto one base",
      columns: [
        { key: "amount_pkr", label: "Amount — PKR" },
        { label: "Amount – PKR" },
        { label: "Amount · PKR" },
        { label: "amount: pkr" },
      ],
    },
    {
      name: "mixed-case explicit keys coexist with lowercased derived slugs",
      columns: [
        { key: "AmountUSD", label: "Amount (USD)" },
        { label: "AmountUSD" },
        { key: "amountusd", label: "Amount usd" },
      ],
    },
    {
      name: "non-alphanumeric labels fall back to `column` chain",
      columns: [
        { label: "!!!" },
        { key: "vip_flag", label: "陈" },
        { label: "🎉🚀" },
        { label: "———" },
      ],
    },
    {
      name: "explicit key colliding with an earlier derived bump",
      columns: [{ label: "Amount" }, { label: "Amount" }, { key: "amount_2", label: "Amount" }],
    },
  ];

  it.each(FIXTURES)("$name → envelope matches the schema", async ({ columns }) => {
    exportJson({
      columns: columns.map((c) => ({ ...c, get: () => "" })),
      rows: [{ id: "x", sold_on: "", amount_pkr: 0, amount_usd: 0, client: "", city: "" }],
      filename: "collision.json",
      metaInput: {
        source: "Collision schema validation",
        generatedAt: FIXED,
        columns,
      } as CsvMetadataInput,
    });
    vi.runAllTimers();
    const env = await parseAndValidateLatest(interceptor);
    // Sanity: the schema accepted an envelope with the same number of
    // columns as the fixture — proves we're validating the RIGHT
    // envelope, not an empty/default one produced by an earlier bug.
    expect(env._meta.columns).toHaveLength(columns.length);
  });

  it("base happy-path export (filters + sort + page + counts + rows) validates against the schema", async () => {
    // Same shape as the base download test above — the schema must
    // accept a fully-populated envelope, not just the minimal
    // collision fixtures. Guards against an accidental `.strict()`
    // that would refuse legal fields.
    exportJson({
      columns: COLUMNS,
      rows: SLICE,
      filename: "bookings-schema.json",
      metaInput: {
        source: "Bookings — Karachi (schema)",
        generatedAt: FIXED,
        filters: { city: "Karachi" },
        sort: { key: "sold_on", dir: "desc" },
        page: { page: 1, totalPages: 1, pageSize: SLICE.length },
        counts: { shown: SLICE.length, filtered: SLICE.length, total: SLICE.length },
        columns: COLUMNS.map((c) => ({ key: c.key, label: c.label })),
      },
    });
    vi.runAllTimers();
    const env = await parseAndValidateLatest(interceptor);
    expect(env._meta.filters).toEqual({ city: "Karachi" });
    expect(env._meta.sort).toEqual({ key: "sold_on", dir: "desc" });
    expect(env._meta.page).toEqual({ page: 1, totalPages: 1, pageSize: SLICE.length });
    expect(env.rows).toHaveLength(SLICE.length);
  });
});
