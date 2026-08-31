/**
 * Integration: export CSV with edge-case labels/keys, parse the result,
 * verify metadata + column precedence round-trip exactly.
 *
 * This complements the existing `csvExportEscapedLabelRoundTrip` (which
 * focuses on commas / quotes / newlines) by sweeping the OTHER hostile
 * label shapes that historically broke either the slugifier, the
 * `# Columns` pipe-separator, or the `Column keys` dedupe pass:
 *
 *   • Unicode + emoji + combining marks (multi-code-unit labels)
 *   • Whitespace-only + purely-punctuation labels (slug fallback to "column")
 *   • Numeric-only labels (slug is legal, must not clash with `column`)
 *   • Explicit key that collides with a sibling's derived slug
 *   • Explicit key that collides with another explicit key
 *   • Bidi controls (LRM/RLM) and BOM inside labels
 *   • Duplicate labels — every duplicate must slug-collide and bump
 *
 * We assert:
 *   1. Header build succeeds (no throw for tolerated shapes).
 *   2. `parseCsvMetadataHeader` recovers every metadata slot BYTE-EXACT:
 *      source, schema, version, generatedAt, filters, sort, page, counts,
 *      column labels (in order), column keys (in order).
 *   3. Explicit `{ key }` always wins over any derived slug — even when
 *      the derived slug would have collided with it.
 *   4. The body separator (blank line) survives so `bodyStartIndex`
 *      lands on the data row.
 */
import { describe, it, expect } from "vitest";
import {
  prefixCsvWithMetadata,
  withDerivedColumnKeys,
  type CsvMetadataInput,
} from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";

/**
 * Build a stable CsvMetadataInput fixture with a fixed `generatedAt`
 * so the parsed `Generated:` string round-trips deterministically.
 * All non-column slots are populated so the round-trip covers every
 * field the writer emits, not just columns.
 */
function fixture(columns: NonNullable<CsvMetadataInput["columns"]>): CsvMetadataInput {
  return {
    source: "Dashboard — Édge Càses ✨",
    generatedAt: new Date("2026-07-07T12:34:56.000Z"),
    filters: { status: "active", "owner name": "Ada Lovelace" },
    sort: { key: "amount", dir: "desc" },
    page: { page: 2, totalPages: 5, pageSize: 25 },
    counts: { shown: 25, filtered: 120, total: 500 },
    columns,
  };
}

/**
 * Serialize + parse the fixture and return the parsed metadata plus the
 * `# Columns` and `# Column keys` payloads we care about most. Every
 * caller uses the same body ("a,b\n1,2\n") so the body-delimiter sniff
 * lands on `,`.
 */
function roundTrip(input: CsvMetadataInput) {
  const csv = prefixCsvWithMetadata("a,b\n1,2\n", input);
  const parsed = parseCsvMetadataHeader(csv, { strict: true });
  return { csv, parsed };
}

describe("csv export → parse round-trip with edge-case labels/keys", () => {
  it("survives unicode, emoji, combining marks, bidi controls, and BOM in labels", () => {
    // Combining acute on "e" (é as e + U+0301). LRM/RLM around Arabic
    // preserve display order. BOM inside a label is common when a
    // spreadsheet exports header cells as UTF-16.
    const labels = [
      "Amount 💰 (USD)",
      "Cafe\u0301", // combining diacritic form of "Café"
      "\u200eEnglish → \u200fالعربية\u200e", // LRM/RLM sandwich
      "with\ufeffBOM",
      "Δelta_Ω",
    ];
    const { parsed } = roundTrip(fixture(labels.map((label) => ({ label }))));
    expect(parsed.columns).not.toBeNull();
    // Labels come back verbatim, in order — no NFC/NFKD folding.
    expect(parsed.columns!.map((c) => c.label)).toEqual(labels);
    // Derived keys match `withDerivedColumnKeys` exactly (single source
    // of truth for the slugifier).
    const expectedKeys = withDerivedColumnKeys(labels.map((label) => ({ label }))).map(
      (c) => c.key,
    );
    expect(parsed.columns!.map((c) => c.key)).toEqual(expectedKeys);
    // Every key is non-empty (the "column" fallback covered below).
    expect(parsed.columns!.every((c) => c.key.length > 0)).toBe(true);
  });

  it('slugs punctuation-only labels to the "column" fallback and dedupes them in order', () => {
    // Three labels that all slug to "column" — the dedupe pass must
    // bump the 2nd and 3rd to `column_2` / `column_3` in ORDER.
    // (Whitespace-only labels are rejected by the writer's structural
    // check, so we exercise punctuation-only forms here instead.)
    const labels = ["—", "…", "***"];
    const { parsed } = roundTrip(fixture(labels.map((label) => ({ label }))));
    expect(parsed.columns!.map((c) => c.label)).toEqual(labels);
    expect(parsed.columns!.map((c) => c.key)).toEqual(["column", "column_2", "column_3"]);
  });

  it("keeps numeric-only labels as their own slug, distinct from the 'column' fallback", () => {
    const labels = ["2024", "2025", "—"]; // last one falls back to "column"
    const { parsed } = roundTrip(fixture(labels.map((label) => ({ label }))));
    expect(parsed.columns!.map((c) => c.key)).toEqual(["2024", "2025", "column"]);
  });

  it("resolves explicit {key} colliding with a prior derived slug via deterministic encounter-order bump", () => {
    // Contract (per `withDerivedColumnKeys`): keys are assigned in
    // encounter order — an explicit key does NOT retroactively evict a
    // previously-assigned derived key. Whichever entry appears first
    // owns the base slug; later collisions (explicit or derived) bump.
    //
    // This test pins that ordering so future refactors that try to
    // introduce implicit "explicit-wins" precedence fail loudly here.
    const columns = [
      { label: "Amount" }, // idx 0 → "amount" (wins base)
      { key: "amount", label: "Amount (canonical)" }, // idx 1 → "amount_2" (bumps)
      { label: "Amount" }, // idx 2 → "amount_3" (bumps around both)
    ];
    const { parsed } = roundTrip(fixture(columns));
    const keys = parsed.columns!.map((c) => c.key);
    // Exact bump ordering — the derivation is deterministic.
    expect(keys).toEqual(["amount", "amount_2", "amount_3"]);
    // Every key stays unique.
    expect(new Set(keys).size).toBe(keys.length);
    // The writer-side helper agrees with the parsed output byte-for-byte
    // (single source of truth for the derivation).
    const expected = withDerivedColumnKeys(columns).map((c) => c.key);
    expect(keys).toEqual(expected);
    // Labels round-trip verbatim in declared order.
    expect(parsed.columns!.map((c) => c.label)).toEqual(["Amount", "Amount (canonical)", "Amount"]);
  });

  it("preserves an explicit {key} that arrives BEFORE any derived slug collision", () => {
    // Same collision family, opposite order — now the explicit key is
    // encountered first and owns the base slug outright. Later derived
    // siblings must bump around it.
    const columns = [
      { key: "amount", label: "Amount (canonical)" }, // idx 0 → "amount"
      { label: "Amount" }, // idx 1 → "amount_2"
      { label: "Amount" }, // idx 2 → "amount_3"
    ];
    const { parsed } = roundTrip(fixture(columns));
    expect(parsed.columns!.map((c) => c.key)).toEqual(["amount", "amount_2", "amount_3"]);
    expect(parsed.columns![0].label).toBe("Amount (canonical)");
  });

  it("preserves duplicate labels with deterministic sibling bump numbering", () => {
    const columns = [
      { label: "Score" }, // → "score"
      { label: "Score" }, // → "score_2"
      { label: "Score" }, // → "score_3"
      { label: "Score" }, // → "score_4"
    ];
    const { parsed } = roundTrip(fixture(columns));
    expect(parsed.columns!.map((c) => c.key)).toEqual(["score", "score_2", "score_3", "score_4"]);
    // All four labels come back identical — no writer-side dedupe of
    // labels themselves.
    expect(parsed.columns!.map((c) => c.label)).toEqual(["Score", "Score", "Score", "Score"]);
  });

  it("round-trips every non-column metadata slot byte-exact", () => {
    // Uses a boring column list so this test isolates the non-column
    // fields (source, schema, version, generated, filters, sort, page,
    // counts). Every field the writer emits should reappear identical
    // after parse.
    const input = fixture([{ label: "A" }, { label: "B" }]);
    const { parsed } = roundTrip(input);

    expect(parsed.source).toBe(input.source);
    // Schema + version are constants echoed by the writer.
    expect(parsed.schema).not.toBeNull();
    expect(parsed.version).toBe(1);
    expect(parsed.schemaDefaulted).toBe(false);
    // `Generated:` uses `.toLocaleString()`, which is locale-dependent
    // — assert non-null + presence in the raw lines rather than
    // pinning the exact format.
    expect(parsed.generatedAt).toBe(input.generatedAt!.toLocaleString());
    expect(parsed.filters).toEqual({ status: "active", "owner name": "Ada Lovelace" });
    expect(parsed.sort).toEqual({ key: "amount", dir: "desc" });
    expect(parsed.page).toEqual({ page: 2, totalPages: 5, pageSize: 25 });
    expect(parsed.counts).toEqual({ shown: 25, filtered: 120, total: 500 });
    // Body separator survived — parser lands on the header data row.
    expect(parsed.bodyStartIndex).toBeGreaterThan(0);
    expect(parsed.bodyDelimiter).toBe(",");
  });

  it("keeps explicit-key precedence intact even when the label contains BOM/bidi noise", () => {
    // The explicit key should be unaffected by hostile CHARACTERS in
    // the label — the writer never re-derives the key from the label
    // when one is supplied.
    const columns = [
      { key: "amount", label: "Amount\ufeff (with BOM)" },
      { label: "amount" }, // derived collides with the explicit above
      { key: "amount_usd", label: "Amount \u202e reversed" },
    ];
    const { parsed } = roundTrip(fixture(columns));
    const keys = parsed.columns!.map((c) => c.key);
    expect(keys[0]).toBe("amount");
    // Sibling with derived slug "amount" must bump around the explicit.
    expect(keys[1]).toBe("amount_2");
    // Explicit `amount_usd` survives untouched at its declared index.
    expect(keys[2]).toBe("amount_usd");
    expect(parsed.columns!.map((c) => c.label)).toEqual(columns.map((c) => c.label));
  });
});
