/**
 * Property-based fuzz: JSON export download path — explicit `{key}`
 * precedence and collision handling.
 *
 * This simulates the exact serialisation pipeline that the "Download
 * filtered JSON" button runs in the browser:
 *
 *     const payload = { _meta: buildJsonExportMetadata(meta), rows };
 *     const body    = JSON.stringify(payload, null, 2);
 *     const blob    = new Blob([body], { type: "application/json;charset=utf-8" });
 *     // …a.download = filename; a.click(); …
 *
 * We drive the same builder + same JSON.stringify + a real `Blob` +
 * `Blob.text()` round trip so anything the download path mutates
 * (line endings, key ordering, dedup shape) shows up. The only piece
 * we skip is the DOM `<a>` click — the browser does not touch the
 * blob's bytes on the way out.
 *
 * Properties fuzzed:
 *
 *   1. EXPLICIT PRECEDENCE. When column `i` supplies a non-empty
 *      `key`, the emitted `_meta.columns[i].key` starts with that
 *      exact string as its BASE (no slugification, no case-fold,
 *      no whitespace collapse). If a later sibling collides with
 *      it, the LATER sibling is bumped — never the explicit key.
 *
 *   2. DERIVED-VS-EXPLICIT COLLISION. If a label-only column would
 *      slugify to a value already claimed by an explicit key that
 *      appeared FIRST, the derived key gets a `_N` suffix. The
 *      explicit key is untouched.
 *
 *   3. NO EXPLICIT-VS-EXPLICIT SILENT COLLAPSE. Two explicit keys
 *      that literally match each other produce a bumped `_N` on
 *      the SECOND occurrence — never a silent overwrite, never a
 *      dropped column.
 *
 *   4. STRUCTURAL. `_meta.columns.length === input.columns.length`,
 *      `order` is a dense `0..N-1` sequence, all emitted keys are
 *      globally unique, and every `label` equals the input's
 *      trimmed label (or the base when the label was blank but a
 *      key was provided).
 *
 *   5. WIRE ROUND-TRIP. `Blob([JSON.stringify(payload)]).text()` →
 *      `JSON.parse(...)` returns an envelope byte-equivalent to
 *      `payload` (same `_meta.columns[]`, same `rows.length`).
 *
 * The unit-level explicit-key verbatim fuzz
 * (`csvJsonExplicitColumnKeyFuzz.test.ts`) covers key CONTENTS at
 * character granularity. This spec is the DOWNLOAD-PATH sibling: it
 * fuzzes PRECEDENCE + COLLISION under the real Blob→text pipeline
 * and mixes explicit / derived / colliding columns per case, which
 * the character-level fuzz doesn't.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  buildJsonExportMetadata,
  slugifyColumnKey,
  type CsvMetadataInput,
} from "../csvExportMetadata";
import { propRuns } from "./_helpers/propRuns";
import { assertPropertyAsync } from "./support/fuzzReporter";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Labels are free-form user text — non-empty, no control chars that
 *  the writer would reject at the structural level. */
const labelArb = fc
  .string({ minLength: 1, maxLength: 24, unit: "grapheme-ascii" })
  .filter((s) => s.trim().length > 0);

/** Explicit keys mirror what the app supplies via `ALL_EXPORT_COLUMNS`
 *  plus a chaos tail (mixed casing, punctuation, unicode, whitespace
 *  around the key). Trimmed length must be > 0 — a whitespace-only
 *  explicit key is a caller bug that the builder rejects loudly, which
 *  is a separate contract covered by `csvExportMetadataEntryValidation`. */
const explicitKeyArb = fc
  .oneof(
    fc.constantFrom(
      "created_at",
      "request_id",
      "cost",
      "COST",
      "Cost ($)",
      "user.id",
      "amount",
      "amount_2",
      "column",
      "π_value",
      "🎯_target",
    ),
    fc.string({ minLength: 1, maxLength: 12, unit: "grapheme-ascii" }),
  )
  .filter((s) => s.trim().length > 0);

/** A single column spec — either `{key,label}` (explicit) or a bare
 *  label string (derived). We keep the two shapes visible on the
 *  outside so assertions can branch on which precedence rule applies. */
type ExplicitCol = { kind: "explicit"; key: string; label: string };
type DerivedCol = { kind: "derived"; label: string };
type FuzzCol = ExplicitCol | DerivedCol;

const explicitColArb = fc
  .record({ key: explicitKeyArb, label: labelArb })
  .map<ExplicitCol>((r) => ({ kind: "explicit", key: r.key, label: r.label }));

const derivedColArb = labelArb.map<DerivedCol>((label) => ({
  kind: "derived",
  label,
}));

/** Column list: 1..10 columns, mixing shapes. Bias toward including
 *  at least one explicit column so the precedence branch actually
 *  gets exercised — a `filter` on the outer arb is cheaper than a
 *  custom generator here because generation is fast and the reject
 *  rate is < 25% (P(all derived) ≤ 0.5^N ≤ 0.5). */
const columnsArb = fc
  .array(fc.oneof(explicitColArb, derivedColArb), {
    minLength: 1,
    maxLength: 10,
  })
  .filter((cols) => cols.some((c) => c.kind === "explicit"));

/** Rows are small: 0..5 minimal shapes, since collision handling is
 *  independent of row content and huge row arrays just slow the fuzz.
 *  We still assert `rows.length` survives, so we need at least one
 *  case with rows. */
const rowsArb = fc.array(
  fc.record({
    id: fc.uuid(),
    created_at: fc.constant("2026-01-01T00:00:00.000Z"),
    request_id: fc.string({ minLength: 1, maxLength: 8, unit: "grapheme-ascii" }),
  }),
  { minLength: 0, maxLength: 5 },
);

// ---------------------------------------------------------------------------
// Download-path oracle: mirror `handleExportFilteredJson` exactly.
// ---------------------------------------------------------------------------

async function downloadRoundTrip(
  cols: FuzzCol[],
  rows: Array<Record<string, unknown>>,
): Promise<{
  parsed: {
    _meta: { columns?: Array<{ order: number; key: string; label: string }> };
    rows: unknown[];
  };
  body: string;
}> {
  const meta: CsvMetadataInput = {
    source: "AI Diagnostics (filtered)",
    generatedAt: new Date("2026-01-01T00:00:00Z"),
    filters: {},
    sort: { key: "created_at", dir: "desc" },
    page: null,
    counts: { shown: rows.length, filtered: rows.length, total: rows.length },
    columns: cols.map((c) =>
      c.kind === "explicit" ? { key: c.key, label: c.label } : { label: c.label },
    ),
  };
  const payload = { _meta: buildJsonExportMetadata(meta), rows };
  const body = JSON.stringify(payload, null, 2);
  const blob = new Blob([body], { type: "application/json;charset=utf-8" });
  const text = await blob.text();
  const parsed = JSON.parse(text) as {
    _meta: { columns?: Array<{ order: number; key: string; label: string }> };
    rows: unknown[];
  };
  return { parsed, body };
}

/**
 * Compute the EXPECTED base key for column `i` under the current
 * precedence rules — the same expression the builder uses internally
 * (`explicitTrimmed || slugifyColumnKey(labelTrimmed)`), duplicated
 * here so a change to the builder that flips precedence fails LOUDLY
 * instead of the oracle silently absorbing the change.
 */
function expectedBase(col: FuzzCol): string {
  if (col.kind === "explicit") {
    const trimmed = col.key.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return slugifyColumnKey(col.label.trim());
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("JSON export download path — explicit {key} precedence + collision fuzz", () => {
  it("preserves structural invariants + explicit precedence across a Blob round-trip", async () => {
    await assertPropertyAsync(
      "JSON download — structural invariants + explicit precedence",
      fc.asyncProperty(columnsArb, rowsArb, async (cols, rows) => {
        const { parsed, body } = await downloadRoundTrip(cols, rows);
        const emitted = parsed._meta.columns;
        expect(emitted, "envelope must include _meta.columns").toBeTruthy();
        // (4a) One emitted column per input column, in input order.
        expect(emitted!.length).toBe(cols.length);
        // (5) Rows survive count + order.
        expect(parsed.rows.length).toBe(rows.length);

        // Track which base keys are already claimed as we walk left to
        // right — this mirrors the builder's dedup state machine.
        const usedKeys = new Set<string>();
        const seenBase = new Map<string, number>();
        for (let i = 0; i < cols.length; i++) {
          const col = cols[i];
          const e = emitted![i];

          // (4b) Dense order.
          expect(e.order).toBe(i);

          // (4c) All keys globally unique.
          expect(
            usedKeys.has(e.key),
            `duplicate key \`${e.key}\` at column ${i}\ninput: ${JSON.stringify(cols)}`,
          ).toBe(false);
          usedKeys.add(e.key);

          // (4d) Label survives (trimmed, or falls back to base when
          //     an explicit key is provided but label is blank —
          //     which our arbitraries don't generate but the builder
          //     supports).
          expect(e.label).toBe(col.label.trim());

          // (1)(2)(3) Precedence + collision. Compute the expected
          // base + suffix by replaying the builder's rule.
          const base = expectedBase(col);
          let n = (seenBase.get(base) ?? 0) + 1;
          let expectedKey = n === 1 ? base : `${base}_${n}`;
          // Walk past any suffix a literal sibling already claimed.
          const localUsed = new Set(Array.from(usedKeys).slice(0, -1));
          // Rebuild localUsed properly: it's every key emitted BEFORE
          // this one.
          localUsed.clear();
          for (let j = 0; j < i; j++) localUsed.add(emitted![j].key);
          while (localUsed.has(expectedKey)) {
            n += 1;
            expectedKey = `${base}_${n}`;
          }
          seenBase.set(base, n);
          expect(
            e.key,
            `precedence/collision mismatch at column ${i}\n` +
              `  input col: ${JSON.stringify(col)}\n` +
              `  expected key: ${JSON.stringify(expectedKey)}\n` +
              `  got key:      ${JSON.stringify(e.key)}\n` +
              `  full input:   ${JSON.stringify(cols)}\n` +
              `  full emitted: ${JSON.stringify(emitted)}`,
          ).toBe(expectedKey);

          // (1) Extra guard: for the FIRST occurrence of an explicit
          //     key (no prior sibling with the same base), the
          //     emitted key MUST be byte-identical to the trimmed
          //     explicit input — explicit ALWAYS wins the base.
          if (col.kind === "explicit" && n === 1) {
            expect(e.key).toBe(col.key.trim());
          }
        }

        // (5) Body is stable JSON: parse-of-body equals payload's
        //     column list byte-for-byte after a second round-trip
        //     (guards against Blob text encoding surprises).
        const second = JSON.parse(body) as typeof parsed;
        expect(second._meta.columns).toEqual(emitted);
      }),
      { numRuns: propRuns(200), verbose: false, argNames: ["columns", "rows"] },
    );
  });

  it("explicit key always beats a derived collision from a later sibling", async () => {
    // Targeted property: [{key: X, label: L1}, {label: L2 where slug(L2) === X}]
    // → column 0 keeps X, column 1 gets X_2.
    await assertPropertyAsync(
      "JSON download — explicit key beats derived collision",
      fc.asyncProperty(
        explicitKeyArb.filter((k) => {
          const t = k.trim();
          // Round-trip stable slugs only — guarantees that using `t`
          // as a LABEL slugifies back to `t`, i.e. the derived column
          // really does collide with the explicit one.
          return t.length > 0 && slugifyColumnKey(t) === t;
        }),
        labelArb,
        labelArb,
        async (explicit, l1, l2) => {
          const explicitTrim = explicit.trim();
          // Force a collision: use `explicitTrim` verbatim as a label
          // (its slug will be itself when explicit is already lower-
          // snake). This is the tight adversarial case.
          const cols: FuzzCol[] = [
            { kind: "explicit", key: explicitTrim, label: l1 },
            { kind: "derived", label: explicitTrim },
            { kind: "derived", label: l2 },
          ];
          const { parsed } = await downloadRoundTrip(cols, []);
          const emitted = parsed._meta.columns!;
          expect(emitted[0].key).toBe(explicitTrim);
          expect(emitted[1].key).toBe(`${explicitTrim}_2`);
          // Third column is independent — must not steal `_2` or `_3`
          // from the first two unless its own slug collides.
          const l2Slug = slugifyColumnKey(l2.trim());
          if (l2Slug !== explicitTrim) {
            expect(emitted[2].key).toBe(l2Slug);
          } else {
            expect(emitted[2].key).toBe(`${explicitTrim}_3`);
          }
        },
      ),
      { numRuns: propRuns(150), verbose: false, argNames: ["explicit", "l1", "l2"] },
    );
  });

  it("two explicit keys with the same value never silently collapse", async () => {
    await assertPropertyAsync(
      "JSON download — duplicate explicit keys never collapse",
      fc.asyncProperty(explicitKeyArb, labelArb, labelArb, async (k, l1, l2) => {
        const trim = k.trim();
        const cols: FuzzCol[] = [
          { kind: "explicit", key: trim, label: l1 },
          { kind: "explicit", key: trim, label: l2 },
        ];
        const { parsed } = await downloadRoundTrip(cols, []);
        const emitted = parsed._meta.columns!;
        expect(emitted).toHaveLength(2);
        expect(emitted[0].key).toBe(trim);
        expect(emitted[1].key).toBe(`${trim}_2`);
        // Labels stay pinned to their original column — the dedup
        // suffix goes on the KEY, never on the label.
        expect(emitted[0].label).toBe(l1.trim());
        expect(emitted[1].label).toBe(l2.trim());
      }),
      { numRuns: propRuns(120), verbose: false, argNames: ["k", "l1", "l2"] },
    );
  });
});
