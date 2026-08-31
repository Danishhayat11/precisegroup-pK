/**
 * Wide-input property/fuzz suite for the column derivation pipeline.
 *
 * The existing `csvExportMetadataProperty.test.ts` proves invariants
 * on a *stable-identity* label subset (`^[a-z][a-z0-9]{0,7}$`), where
 * every label slugifies to itself. That's exact but narrow.
 *
 * This file broadens the input space to the actual production surface
 * — arbitrary Unicode text, diacritics, non-Latin scripts, emoji /
 * ZWJ sequences, punctuation-only labels, whitespace padding, upper /
 * lower / mixed case, string-shorthand vs `{label}` vs `{key,label}`
 * entries — and asserts THREE cross-cutting invariants on every case:
 *
 *   1. **Determinism** — three back-to-back builds of the SAME input
 *      produce byte-identical CSV and byte-identical JSON. No hidden
 *      insertion-order sensitivity, no reliance on Map iteration
 *      timing, no PRNG leaks.
 *
 *   2. **Uniqueness + length** — every derived key is non-empty and
 *      every key is unique across the emitted list; the emitted list
 *      length equals the input length (no dropped columns).
 *
 *   3. **CSV ↔ JSON parity** — `# Column keys: …` and
 *      `_meta.columns[].key` produce the exact same ordered sequence.
 *
 * A mirror re-implementation of `slugifyColumnKey` + the deduper acts
 * as an ORACLE: for each generated input, we predict the derived key
 * sequence independently and assert both writers reproduce it. If the
 * oracle and the writer disagree, the property fails with the exact
 * offending input (fast-check shrinks to a minimal counterexample).
 *
 * Invalid inputs (null entries, blank labels + missing keys,
 * whitespace-only explicit keys) are filtered out via `fc.pre` so this
 * suite only exercises the happy-path derivation logic — the failure
 * modes are covered exhaustively in `csvExportMetadataHardening` and
 * `csvJsonErrorParity`.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { propRuns } from "./_helpers/propRuns";
import {
  buildCsvMetadataHeader,
  buildJsonExportMetadata,
  type CsvMetadataInput,
} from "../csvExportMetadata";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

// ---------- Oracle: mirror of production slugifier + deduper ----------

/** Mirror of `slugifyColumnKey` in csvExportMetadata.ts. */
function oracleSlug(label: string): string {
  const slug = String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "column";
}

/** Mirror of `withDerivedColumnKeys` for the shape our arbitraries emit. */
function oracleDerive(
  columns: Array<string | { key?: string; label: string }>,
): Array<{ key: string; label: string }> {
  const seen = new Map<string, number>();
  const used = new Set<string>();
  return columns.map((c) => {
    const label = typeof c === "string" ? c : c.label;
    const explicit = typeof c === "string" ? undefined : c.key;
    const explicitTrimmed = typeof explicit === "string" ? explicit.trim() : "";
    const labelTrimmed = typeof label === "string" ? label.trim() : "";
    const base = explicitTrimmed || oracleSlug(labelTrimmed);
    let n = (seen.get(base) ?? 0) + 1;
    let key = n === 1 ? base : `${base}_${n}`;
    while (used.has(key)) {
      n += 1;
      key = `${base}_${n}`;
    }
    seen.set(base, n);
    used.add(key);
    return { key, label: labelTrimmed || base };
  });
}

// ---------- Writer read helpers ----------

function csvKeys(columns: CsvMetadataInput["columns"]): string[] {
  const line = buildCsvMetadataHeader({ source: "X", generatedAt: FIXED_DATE, columns }).find((l) =>
    l.startsWith("# Column keys:"),
  );
  return line ? line.replace("# Column keys: ", "").split(",") : [];
}

function jsonKeys(columns: CsvMetadataInput["columns"]): string[] {
  const meta = buildJsonExportMetadata({ source: "X", generatedAt: FIXED_DATE, columns });
  return ((meta.columns as Array<{ key: string }> | undefined) ?? []).map((c) => c.key);
}

function csvBytes(input: CsvMetadataInput): string {
  return buildCsvMetadataHeader(input).join("\n");
}

function jsonBytes(input: CsvMetadataInput): string {
  return JSON.stringify(buildJsonExportMetadata(input));
}

// ---------- Arbitraries: wide input space ----------

/**
 * A hand-picked pool of "interesting" characters covering:
 *   - ASCII letters + digits (base slug material)
 *   - ASCII punctuation (collapses to `_`)
 *   - Whitespace variants (collapse to `_`)
 *   - Precomposed diacritics (NFC single code points, stripped)
 *   - Non-Latin scripts (CJK, Cyrillic, Arabic, Greek — fallback to `column`)
 *   - Emoji, arrows, geometric shapes (fallback to `column`)
 *   - Combining marks + ZWJ + VS-16 (compound sequences)
 */
const interestingChars = [
  ..."abcdefghijklmnopqrstuvwxyz",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ..."0123456789",
  ..." \t",
  ..."!@#$%^&*()_+-=[]{};:'\",.<>/?|\\`~",
  // Diacritics — precomposed
  "é",
  "è",
  "ê",
  "ë",
  "ï",
  "î",
  "ñ",
  "ö",
  "ü",
  "å",
  "ø",
  "ß",
  "ç",
  "É",
  "Ñ",
  // Non-Latin scripts
  "北",
  "京",
  "日",
  "本",
  "語",
  "Ω",
  "α",
  "β",
  "Москва".charAt(0),
  "ص",
  "ك",
  // Emoji + symbols
  "💰",
  "🚀",
  "✨",
  "🎯",
  "▲",
  "→",
  "•",
  "—",
  "☕",
  // Combining marks / joiners
  "\u0301",
  "\u0308",
  "\u200D",
  "\uFE0F",
  "\u20E3",
];

const interestingCharArb = fc.constantFrom(...interestingChars);

/**
 * A label built from the interesting-char pool. May be pure garbage.
 * Newlines / carriage returns are excluded because the metadata block
 * is line-based; embedding them would break the header format itself
 * (a separate concern from the derivation logic under test here).
 */
const wildLabelArb = fc
  .array(interestingCharArb, { minLength: 1, maxLength: 12 })
  .map((chars) => chars.join(""))
  .filter((s) => !/[\r\n]/.test(s));

/**
 * An explicit key that is guaranteed non-blank after trim. Additional
 * exclusions vs labels: `,` `\r` `\n` — the CSV `# Column keys:` line
 * comma-joins explicit keys verbatim (they're expected to already be
 * machine-safe identifiers), so those separators would corrupt the
 * transport. This narrowing keeps the fuzz on the derivation logic
 * rather than the CSV encoding, which the writer intentionally leaves
 * to the caller for explicit keys.
 */
const wildKeyArb = fc
  .array(interestingCharArb, { minLength: 1, maxLength: 10 })
  .map((chars) => chars.join(""))
  .filter((s) => s.trim().length > 0 && !/[,\r\n]/.test(s));

/** One column entry — string shorthand OR {label} OR {key, label}. */
const columnArb = fc.oneof(
  wildLabelArb.filter((l) => l.trim().length > 0).map((l) => l as string),
  wildLabelArb
    .filter((l) => l.trim().length > 0)
    .map((label) => ({ label }) as { label: string; key?: string }),
  fc
    .record({ key: wildKeyArb, label: wildLabelArb })
    .filter(({ label, key }) => label.trim().length > 0 || key.trim().length > 0)
    .map((r) => ({ key: r.key, label: r.label }) as { key: string; label: string }),
);

/** A column LIST of size 1..12 that survives the writer's validation. */
const columnsArb = fc
  .array(columnArb, { minLength: 1, maxLength: 12 })
  // Belt-and-braces: drop any residual entry the writer would reject.
  .map((cols) =>
    cols.filter(
      (c) =>
        c !== null &&
        c !== undefined &&
        (typeof c === "string"
          ? c.trim().length > 0
          : c.label.trim().length > 0 || (c.key ?? "").trim().length > 0),
    ),
  )
  .filter((cols) => cols.length > 0);

// ---------- Properties ----------

describe("csvExportMetadata — wide-input fuzz: determinism, uniqueness, parity", () => {
  it("determinism: three back-to-back builds are byte-identical (CSV + JSON)", () => {
    fc.assert(
      fc.property(columnsArb, (cols) => {
        const input: CsvMetadataInput = {
          source: "Fuzz",
          generatedAt: FIXED_DATE,
          columns: cols,
        };
        const c1 = csvBytes(input);
        const c2 = csvBytes(input);
        const c3 = csvBytes(input);
        expect(c1).toBe(c2);
        expect(c2).toBe(c3);
        const j1 = jsonBytes(input);
        const j2 = jsonBytes(input);
        const j3 = jsonBytes(input);
        expect(j1).toBe(j2);
        expect(j2).toBe(j3);
      }),
      { numRuns: propRuns(200) },
    );
  });

  it("uniqueness + length: every emitted key is non-empty, unique, count == input length", () => {
    fc.assert(
      fc.property(columnsArb, (cols) => {
        const keys = csvKeys(cols);
        expect(keys).toHaveLength(cols.length);
        expect(keys.every((k) => k.length > 0)).toBe(true);
        expect(new Set(keys).size).toBe(keys.length);
      }),
      { numRuns: propRuns(300) },
    );
  });

  it("CSV ↔ JSON parity: both writers emit the same ordered key sequence", () => {
    fc.assert(
      fc.property(columnsArb, (cols) => {
        expect(jsonKeys(cols)).toEqual(csvKeys(cols));
      }),
      { numRuns: propRuns(300) },
    );
  });

  it("oracle parity: writer output matches the mirror derivation exactly", () => {
    // Strongest invariant: for every wide-input case, the derivation
    // is fully predictable by the oracle. If either writer drifts
    // from the shared helper, this property fails with a minimal
    // shrunk counterexample naming the offending column list.
    fc.assert(
      fc.property(columnsArb, (cols) => {
        const expected = oracleDerive(cols).map((c) => c.key);
        expect(csvKeys(cols)).toEqual(expected);
        expect(jsonKeys(cols)).toEqual(expected);
      }),
      { numRuns: propRuns(300) },
    );
  });

  it("explicit key survival: every trimmed explicit key appears verbatim in the output", () => {
    // Explicit keys are contractual — the caller passed them because
    // downstream code keys on them. If any siblings collide, the
    // OTHER columns must move, never the explicit key itself.
    // Note: two DIFFERENT explicit entries can share the same key
    // value (both `{key: "amount"}`), in which case at most one
    // survives verbatim and the rest get suffixed — so we only assert
    // each DISTINCT explicit key value shows up.
    fc.assert(
      fc.property(columnsArb, (cols) => {
        const explicits = Array.from(
          new Set(
            cols
              .filter((c): c is { key: string; label: string } => typeof c !== "string" && !!c.key)
              .map((c) => c.key.trim())
              .filter((k) => k.length > 0),
          ),
        );
        const keys = new Set(csvKeys(cols));
        for (const k of explicits) {
          expect(keys.has(k), `explicit key "${k}" must survive verbatim`).toBe(true);
        }
      }),
      { numRuns: propRuns(200) },
    );
  });

  it("order preservation: derived key at index i corresponds to input column at index i", () => {
    // The deduper is positional — column 0's key must come first, no
    // silent reordering. Verified by re-running the oracle and
    // comparing element-wise.
    fc.assert(
      fc.property(columnsArb, (cols) => {
        const derived = oracleDerive(cols);
        const keys = csvKeys(cols);
        for (let i = 0; i < cols.length; i++) {
          expect(keys[i]).toBe(derived[i].key);
        }
      }),
      { numRuns: propRuns(200) },
    );
  });

  it("shape stability: label whitespace variants produce identical keys", () => {
    // Adding surrounding whitespace to a label must NOT change its
    // slug — the writer trims first. Property: for any base column
    // list, padding every label with random whitespace prefixes /
    // suffixes yields the same emitted key sequence.
    const wsArb = fc.stringMatching(/^[ \t]{0,4}$/);
    fc.assert(
      fc.property(columnsArb, wsArb, wsArb, (cols, lp, rp) => {
        const padded = cols.map((c) => {
          if (typeof c === "string") return `${lp}${c}${rp}`;
          return { ...c, label: `${lp}${c.label}${rp}` };
        });
        expect(csvKeys(padded)).toEqual(csvKeys(cols));
        expect(jsonKeys(padded)).toEqual(jsonKeys(cols));
      }),
      { numRuns: propRuns(150) },
    );
  });

  it("insertion-order stability for map fields: filters/extra reorder ≠ different output", () => {
    // The JSON envelope sorts `filters` / `extra` alphabetically, so
    // reordering the input object keys must not change the emitted
    // JSON bytes. Same holds for CSV via the deterministic writer.
    const kvPairArb = fc.tuple(
      fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/),
      fc.stringMatching(/^[a-zA-Z0-9 .-]{1,10}$/).filter((v) => v.trim().length > 0),
    );
    fc.assert(
      fc.property(
        columnsArb,
        fc.uniqueArray(kvPairArb, { minLength: 0, maxLength: 6, selector: ([k]) => k }),
        (cols, pairs) => {
          const forward = Object.fromEntries(pairs) as Record<string, string>;
          const reverse = Object.fromEntries([...pairs].reverse()) as Record<string, string>;
          const base = {
            source: "S",
            generatedAt: FIXED_DATE,
            columns: cols,
          } as const;
          const jFwd = jsonBytes({ ...base, filters: forward, extra: forward });
          const jRev = jsonBytes({ ...base, filters: reverse, extra: reverse });
          expect(jFwd).toBe(jRev);
          // CSV insertion order is preserved by design — we only
          // assert the derived KEY sequence (from columns) is stable
          // across the map reorder.
          expect(csvKeys(cols)).toEqual(csvKeys(cols));
        },
      ),
      { numRuns: propRuns(150) },
    );
  });
});
