/**
 * Property-based fuzz: random labels (quotes, commas, colons, unicode,
 * emoji, whitespace) + random explicit `{key}` mixes are pushed through
 * the FULL export pipeline —
 *
 *   columns → buildCsvMetadataHeader / prefixCsvWithMetadata
 *           → CSV text (header row + no body rows)
 *           → parseCsvMetadataHeader          (metadata block)
 *           → RFC 4180 CSV parse of header row
 *
 * Then, on EVERY generated case, we assert the round-trip invariants
 * that downstream tooling relies on:
 *
 *   1. Every explicit `{key}` survives verbatim in the parsed metadata's
 *      `_meta.columns[].key`. Explicit keys are the app's contract — a
 *      silent re-slug would break every consumer keyed off them.
 *   2. All emitted keys are non-empty and unique (collision handling
 *      never regresses under any label mix).
 *   3. Column count is preserved (no drops).
 *   4. Every parsed label matches the trimmed input label byte-for-byte
 *      (the builder trims leading/trailing whitespace but keeps commas,
 *      quotes, unicode, etc.).
 *   5. The CSV header row, when parsed with a real RFC 4180 parser,
 *      decodes back to the exact same label list — so quote and comma
 *      escaping is symmetric with parsing.
 *   6. Explicit-key precedence: when the caller supplies an explicit
 *      `key` that matches what a sibling label would derive to, the
 *      explicit position wins the base slug and the sibling bumps.
 *
 * Labels EXCLUDE `|`, `\n`, `\r` — the metadata `# Columns` line uses
 * `|` as its separator and one line per column, so those characters are
 * an existing writer limitation and out of scope here. Everything else
 * (`,` `"` `:` `#` unicode punctuation, emoji, whitespace) is fair game.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { propRuns } from "./_helpers/propRuns";
import {
  buildCsvMetadataHeader,
  prefixCsvWithMetadata,
  type CsvMetadataInput,
} from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

/** Mirrors AiDiagnosticsPage.escapeCsvCell — byte-identical to production. */
function escapeCsvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Tiny RFC 4180 parser — quoted fields, embedded quotes/commas/newlines. */
function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}

// ---- Arbitraries ---------------------------------------------------------

/**
 * Random label mixing: quotes, commas, colons, `#`, spaces, unicode
 * punctuation, curly quotes, em-dash, CJK, emoji. Excludes `|` `\n` `\r`
 * (see file header). Guarantees ≥1 alphanumeric so the derived slug
 * never falls all the way to the `column` default (covered elsewhere).
 */
const trickyUnitArb = fc.constantFrom(
  " ",
  ",",
  '"',
  ":",
  "#",
  "?",
  "!",
  "$",
  "&",
  "(",
  ")",
  "/",
  ".",
  "—",
  "–",
  "·",
  "…",
  "“",
  "”",
  "‘",
  "’",
  "€",
  "中",
  "文",
  "🚀",
  "✓",
  "🔥",
);
const labelArb = fc
  .tuple(
    fc.string({ unit: trickyUnitArb, maxLength: 4 }),
    fc.stringMatching(/^[A-Za-z0-9 ]{1,10}$/),
    fc.string({ unit: trickyUnitArb, maxLength: 4 }),
  )
  .map(([a, mid, z]) => `${a}${mid}${z}`)
  .filter((s) => /[A-Za-z0-9]/.test(s.trim()) && s.trim().length > 0);

/** Explicit-key arbitrary — bare bases AND `_N`-suffix shapes that race
 *  the deduper's own derived suffixes. */
const explicitKeyArb = fc.oneof(
  fc.stringMatching(/^[a-z][a-z0-9_]{0,7}$/),
  fc
    .tuple(fc.stringMatching(/^[a-z]{1,6}$/), fc.integer({ min: 2, max: 6 }))
    .map(([b, n]) => `${b}_${n}`),
);

const columnArb = fc.oneof(
  labelArb.map((label) => ({ label })),
  fc.record({ key: explicitKeyArb, label: labelArb }),
);

const columnsArb = fc.array(columnArb, { minLength: 1, maxLength: 20 });

// ---- Pipeline helper -----------------------------------------------------

function runPipeline(cols: CsvMetadataInput["columns"]) {
  const input: CsvMetadataInput = {
    source: "Fuzz — CSV parse round trip",
    generatedAt: FIXED_DATE,
    columns: cols,
  };
  // Build header row exactly like AiDiagnosticsPage.handleExportCsv.
  const headerRow = (cols ?? [])
    .map((c) => escapeCsvCell(typeof c === "string" ? c : c.label))
    .join(",");
  const csv = prefixCsvWithMetadata(headerRow, input);
  const parsed = parseCsvMetadataHeader(csv);
  // Slice CSV body using plain \n split (avoids stripCsvMetadataHeader's
  // CR-normalization, which is irrelevant here — no CRs in header labels).
  const bodyLines = csv.split("\n").slice(parsed.bodyStartIndex);
  const parsedHeaderCells = parseCsvRow(bodyLines[0] ?? "");
  return { parsed, parsedHeaderCells };
}

function explicitKeysOf(cols: ReadonlyArray<unknown>): string[] {
  return cols
    .map((c) =>
      c && typeof c === "object" && "key" in (c as object)
        ? String((c as { key: unknown }).key)
        : null,
    )
    .filter((k): k is string => typeof k === "string" && k.length > 0);
}

// ---- Properties ----------------------------------------------------------

describe("csvExportMetadata — CSV parse round-trip fuzz", () => {
  it("every explicit {key} survives verbatim in parsed metadata columns", () => {
    fc.assert(
      fc.property(columnsArb, (cols) => {
        const { parsed } = runPipeline(cols);
        const parsedKeys = (parsed.columns ?? []).map((c) => c.key);
        for (const k of new Set(explicitKeysOf(cols))) {
          expect(parsedKeys).toContain(k);
        }
      }),
      { numRuns: propRuns(300) },
    );
  });

  it("parsed metadata keys are non-empty, unique, and count-preserving", () => {
    fc.assert(
      fc.property(columnsArb, (cols) => {
        const { parsed } = runPipeline(cols);
        const keys = (parsed.columns ?? []).map((c) => c.key);
        expect(keys).toHaveLength(cols.length);
        for (const k of keys) expect(k.length).toBeGreaterThan(0);
        expect(new Set(keys).size).toBe(keys.length);
      }),
      { numRuns: propRuns(300) },
    );
  });

  it("parsed labels equal trimmed input labels — commas/quotes/unicode survive", () => {
    fc.assert(
      fc.property(columnsArb, (cols) => {
        const { parsed } = runPipeline(cols);
        const inputLabels = cols.map((c) => (typeof c === "string" ? c : c.label).trim());
        const parsedLabels = (parsed.columns ?? []).map((c) => c.label);
        expect(parsedLabels).toEqual(inputLabels);
      }),
      { numRuns: propRuns(300) },
    );
  });

  it("RFC 4180-parsed CSV header row matches the original input labels (untrimmed)", () => {
    // The CSV header row is written from the raw input labels via
    // escapeCsvCell, without trimming (the builder only trims labels in
    // the METADATA block). Confirms escape ↔ parse symmetry across
    // commas, quotes, and unicode.
    fc.assert(
      fc.property(columnsArb, (cols) => {
        const { parsedHeaderCells } = runPipeline(cols);
        const inputLabels = cols.map((c) => (typeof c === "string" ? c : c.label));
        expect(parsedHeaderCells).toEqual(inputLabels);
      }),
      { numRuns: propRuns(300) },
    );
  });

  it("explicit-key precedence: an explicit key wins the base slug over a sibling that would derive it", () => {
    // Focused generator: for every random label L, place `{ key: slug(L), label: "X" }`
    // FIRST, then `{ label: L }` SECOND. The explicit position must
    // keep the bare slug, and the label-only sibling must bump.
    const pairArb = labelArb.map((label) => {
      // Derive the slug the way the builder would (must stay in sync with
      // slugifyColumnKey — we probe it by running the builder on the
      // label alone and reading back the emitted key).
      const probeKey = buildCsvMetadataHeader({
        source: "probe",
        generatedAt: FIXED_DATE,
        columns: [{ label }],
      })
        .find((l) => l.startsWith("# Column keys:"))!
        .replace("# Column keys: ", "");
      return { label, slug: probeKey };
    });

    fc.assert(
      fc.property(pairArb, ({ label, slug }) => {
        const cols: CsvMetadataInput["columns"] = [
          { key: slug, label: "Explicit wins" },
          { label },
        ];
        const { parsed } = runPipeline(cols);
        const keys = (parsed.columns ?? []).map((c) => c.key);
        expect(keys[0]).toBe(slug); // explicit position keeps bare slug
        expect(keys[1]).toBe(`${slug}_2`); // label-only sibling bumps
        expect(new Set(keys).size).toBe(2);
      }),
      { numRuns: propRuns(200) },
    );
  });

  it("permuting rows never introduces duplicate parsed keys", () => {
    fc.assert(
      fc.property(
        columnsArb.chain((cols) =>
          fc
            .shuffledSubarray(cols, { minLength: cols.length, maxLength: cols.length })
            .map((shuffled) => shuffled),
        ),
        (shuffled) => {
          const { parsed } = runPipeline(shuffled);
          const keys = (parsed.columns ?? []).map((c) => c.key);
          expect(new Set(keys).size).toBe(keys.length);
        },
      ),
      { numRuns: propRuns(200) },
    );
  });
});
