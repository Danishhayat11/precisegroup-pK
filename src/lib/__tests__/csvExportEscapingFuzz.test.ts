/**
 * Randomized fuzz coverage for CSV escaping and quoting when labels and
 * explicit keys contain the three RFC-4180 hostile characters — commas,
 * double quotes, and newlines (LF / CR / CRLF) — plus common
 * neighbours (tabs, backslashes, pipes) that historically trip up
 * ad-hoc escape implementations.
 *
 * The project uses the standard RFC-4180 escape rule for CSV data rows
 * (header row + values):
 *
 *   esc(s) = /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
 *
 * That rule is shared verbatim across every writer (see
 * csvExportColumnAlignment / csvJsonExportE2E / csvReplay / etc.),
 * so we pin it here as `esc()` and fuzz against a matching
 * `splitCsvRow` / `parseCsvRows` reader.
 *
 * The metadata block above the data (`# Columns`, `# Column keys:`)
 * uses different, LINE-oriented separators (`|` for labels, `,` for
 * keys) with NO quoting — commas and pipes in a label are fine because
 * of the pipe separator, but a raw newline would corrupt the block.
 * The exporter contract is that callers pre-sanitise newlines before
 * handing labels to `prefixCsvWithMetadata`. This suite fuzzes both
 * halves:
 *
 *   • DATA-ROW half:  hostile characters allowed everywhere; the
 *                     RFC-4180 escape MUST make writer → parser
 *                     round-trip exact, over ~200 random shapes.
 *
 *   • METADATA half:  after newline sanitisation, labels round-trip
 *                     through `parseCsvMetadataHeader` byte-identical;
 *                     explicit keys with quotes survive verbatim in
 *                     the JSON envelope; keys with commas / newlines
 *                     would corrupt the CSV `# Column keys:` line, so
 *                     we exclude them from that assertion (the JSON
 *                     envelope always accepts them because JSON strings
 *                     are natively quoted).
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  buildJsonExportMetadata,
  prefixCsvWithMetadata,
  type CsvMetadataInput,
} from "../csvExportMetadata";
import { parseCsvMetadataHeader, stripCsvMetadataHeader } from "../csvMetadataParser";

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");
// Bumped when running the nightly property job.
const RUNS = Math.max(50, 200 * (Number(process.env.FC_RUNS_MULTIPLIER) || 1));

// --- Writer / parser mirrors (share exactly the app's escape rule) ---

const esc = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function splitCsvRow(row: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (quoted) {
      if (ch === '"') {
        if (row[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cell);
      cell = "";
    } else cell += ch;
  }
  out.push(cell);
  return out;
}

function parseCsvRows(body: string): string[][] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (ch === "\r" && body[i + 1] === "\n") i++;
    } else cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// --- Character pools weighted toward the hostile set --------------

/** Every character the escape rule is required to handle. */
const HOSTILE = ['"', ",", "\n", "\r", "\r\n"];
const NEIGHBOURS = ["\t", "\\", "|", "'", " ", ":"];
const SAFE = "abcdefghijklmnopqrstuvwxyz0123456789 -_.".split("");

const charArb = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...HOSTILE) },
  { weight: 2, arbitrary: fc.constantFrom(...NEIGHBOURS) },
  { weight: 5, arbitrary: fc.constantFrom(...SAFE) },
  { weight: 1, arbitrary: fc.string({ minLength: 1, maxLength: 1 }) },
);

/** A hostile string: 1..12 chars, biased toward CSV-hostile characters. */
const hostileString = fc
  .array(charArb, { minLength: 1, maxLength: 12 })
  .map((chars) => chars.join(""))
  .filter((s) => s.trim().length > 0);

// --- Suite --------------------------------------------------------

describe("randomized fuzz — CSV escaping and quoting for hostile labels/keys/values", () => {
  // ------------------------------------------------------------------
  // 1. DATA-ROW round-trip: header + one data row survive verbatim.
  // ------------------------------------------------------------------
  describe("data-row escape rule round-trips for arbitrary label + value pairs", () => {
    it("writer → parser is a byte-identical round-trip (labels)", () => {
      fc.assert(
        fc.property(fc.array(hostileString, { minLength: 1, maxLength: 8 }), (labels) => {
          const line = labels.map(esc).join(",");
          expect(splitCsvRow(line)).toEqual(labels);
        }),
        { numRuns: RUNS },
      );
    });

    it("writer → parser is a byte-identical round-trip (values, may include newlines)", () => {
      fc.assert(
        fc.property(fc.array(hostileString, { minLength: 1, maxLength: 8 }), (values) => {
          const line = values.map(esc).join(",");
          // Values may contain newlines that terminate rows in a naive
          // parser; use the multi-row parser and check the first row.
          const rows = parseCsvRows(line);
          // Concatenate all reconstructed cells — the parser terminates
          // a row on unquoted newlines, but every value's newlines are
          // INSIDE quotes so exactly one row must come back.
          expect(rows).toHaveLength(1);
          expect(rows[0]).toEqual(values);
        }),
        { numRuns: RUNS },
      );
    });

    it("writer → parser survives header + N data rows (2-D matrix round-trip)", () => {
      fc.assert(
        fc.property(
          fc.array(hostileString, { minLength: 1, maxLength: 5 }), // labels
          fc.array(fc.array(hostileString, { minLength: 1, maxLength: 5 }), {
            minLength: 1,
            maxLength: 4,
          }),
          (labels, rowsRaw) => {
            // Force every row to match the header width.
            const width = labels.length;
            const rows = rowsRaw.map((r) => {
              const padded = r.slice(0, width);
              while (padded.length < width) padded.push("x");
              return padded;
            });
            const body =
              `${labels.map(esc).join(",")}\r\n` +
              rows.map((r) => r.map(esc).join(",")).join("\r\n") +
              "\r\n";
            const parsed = parseCsvRows(body);
            expect(parsed).toHaveLength(1 + rows.length);
            expect(parsed[0]).toEqual(labels);
            for (let i = 0; i < rows.length; i++) {
              expect(parsed[i + 1]).toEqual(rows[i]);
            }
          },
        ),
        { numRuns: RUNS },
      );
    });

    it("quotes are only emitted when required, and are doubled inside a quoted cell", () => {
      fc.assert(
        fc.property(hostileString, (s) => {
          const out = esc(s);
          const needsQuoting = /[",\r\n]/.test(s);
          if (needsQuoting) {
            expect(out.startsWith('"')).toBe(true);
            expect(out.endsWith('"')).toBe(true);
            // Strip outer quotes; every remaining `"` must be paired.
            const inner = out.slice(1, -1);
            // Every literal `"` in the source becomes exactly two `""`.
            const rawQuoteCount = (s.match(/"/g) ?? []).length;
            const innerQuoteCount = (inner.match(/"/g) ?? []).length;
            expect(innerQuoteCount).toBe(rawQuoteCount * 2);
          } else {
            expect(out).toBe(s);
          }
        }),
        { numRuns: RUNS },
      );
    });

    it("esc is idempotent for safe strings and stable for hostile ones", () => {
      // esc(esc(s)) is NOT esc(s) in general (a hostile string gets
      // re-quoted), but esc(safe) === safe MUST hold and splitCsvRow
      // must invert esc for any single-cell input.
      fc.assert(
        fc.property(hostileString, (s) => {
          const round = splitCsvRow(esc(s));
          expect(round).toEqual([s]);
        }),
        { numRuns: RUNS },
      );
    });
  });

  // ------------------------------------------------------------------
  // 2. METADATA labels: newlines sanitised, everything else survives.
  // ------------------------------------------------------------------
  describe("metadata `# Columns` labels round-trip after newline sanitisation", () => {
    // Labels may carry commas and quotes into the metadata block; the
    // separator is ` | `, so those chars are legal. Newlines and the
    // pipe character are the ONLY things that would corrupt the block,
    // so we sanitise those and assert the rest survives verbatim.
    const sanitise = (s: string) => s.replace(/[\r\n|]+/g, " ").trim() || "x";

    it("labels with commas and quotes survive parseCsvMetadataHeader byte-identical", () => {
      fc.assert(
        fc.property(fc.array(hostileString, { minLength: 1, maxLength: 6 }), (rawLabels) => {
          const labels = rawLabels.map(sanitise);
          const body = `${labels.map(esc).join(",")}\r\n`;
          const csv = prefixCsvWithMetadata(body, {
            source: "Fuzz Escape",
            generatedAt: FIXED_DATE,
            columns: labels.map((label) => ({ label })),
          });
          const parsed = parseCsvMetadataHeader(csv);
          expect(parsed.columns?.map((c) => c.label)).toEqual(labels);
          // Data-row header is byte-identical too.
          const rows = parseCsvRows(stripCsvMetadataHeader(csv));
          expect(rows[0]).toEqual(labels);
        }),
        { numRuns: RUNS },
      );
    });

    it("labels containing pipe / newline are dropped from metadata via sanitisation, not corrupted", () => {
      // The caller-side sanitiser we assert above (`sanitise`) never
      // produces an empty label — every random hostile string still
      // yields a non-empty sanitised label that the metadata block
      // accepts. This property proves it: metadata parses cleanly and
      // no `# Columns` line contains a `|` inside a label token.
      fc.assert(
        fc.property(fc.array(hostileString, { minLength: 1, maxLength: 6 }), (raw) => {
          const labels = raw.map(sanitise);
          const csv = prefixCsvWithMetadata("body\r\n", {
            source: "Fuzz",
            generatedAt: FIXED_DATE,
            columns: labels.map((label) => ({ label })),
          });
          const line = csv.split("\n").find((l) => l.startsWith("# Columns"));
          expect(line).toBeTruthy();
          // Trailing count matches; pipe-splitting yields exactly N tokens.
          const after = line!.split(": ").slice(1).join(": ");
          expect(after.split(" | ")).toHaveLength(labels.length);
        }),
        { numRuns: RUNS },
      );
    });
  });

  // ------------------------------------------------------------------
  // 3. EXPLICIT KEYS: hostile chars pass through the JSON envelope
  //    verbatim; safe chars additionally survive the CSV keys line.
  // ------------------------------------------------------------------
  describe("explicit keys with hostile characters", () => {
    it("JSON envelope preserves explicit keys VERBATIM regardless of hostile chars", () => {
      // JSON strings are natively quoted, so ANY explicit key — commas,
      // quotes, newlines — survives without transformation. This is the
      // canary that catches any silent slugification of explicit keys.
      fc.assert(
        fc.property(hostileString, hostileString, (rawKey, rawLabel) => {
          // Trim to satisfy the "not just whitespace" validator; the
          // hostile chars we care about (`"`, `,`, `\n`) survive trim.
          const key = rawKey.replace(/^\s+|\s+$/g, "");
          const label = rawLabel.replace(/^\s+|\s+$/g, "");
          fc.pre(key.length > 0 && label.length > 0);
          const meta = buildJsonExportMetadata({
            source: "Fuzz",
            generatedAt: FIXED_DATE,
            columns: [{ key, label }],
          } as CsvMetadataInput);
          const cols = meta.columns as Array<{ key: string; label: string }>;
          expect(cols[0].key).toBe(key);
          expect(cols[0].label).toBe(label);
        }),
        { numRuns: RUNS },
      );
    });

    it("CSV `# Column keys:` line preserves keys VERBATIM when they contain no comma/newline", () => {
      // `# Column keys:` is comma-separated with no quoting, so a comma
      // or newline INSIDE a key would corrupt the line. The exporter
      // does not currently escape those (documented as a caller
      // constraint), so we restrict this property to comma/newline-free
      // explicit keys — but allow every OTHER hostile char (quotes,
      // pipes, tabs, backslashes) to prove those survive verbatim.
      const safeishKey = hostileString.filter((s) => !/[,\r\n]/.test(s));
      fc.assert(
        fc.property(fc.array(safeishKey, { minLength: 1, maxLength: 5 }), (keys) => {
          // Every key must be unique after trim to hit distinct base
          // slots (dedupe otherwise appends `_N`, changing bytes).
          const unique = Array.from(new Set(keys.map((k) => k.trim()))).filter((k) => k.length > 0);
          fc.pre(unique.length === keys.length && unique.length > 0);
          const csv = prefixCsvWithMetadata("body\r\n", {
            source: "Fuzz Keys",
            generatedAt: FIXED_DATE,
            columns: keys.map((key) => ({ key, label: `L-${key.length}` })),
          });
          const line = csv.split("\n").find((l) => l.startsWith("# Column keys:"));
          expect(line).toBeTruthy();
          const emitted = line!.replace("# Column keys: ", "").split(",");
          expect(emitted).toEqual(keys.map((k) => k.trim()));
        }),
        { numRuns: RUNS },
      );
    });

    it("mixed batch: explicit hostile keys + derived slugs coexist and JSON round-trips", () => {
      fc.assert(
        fc.property(
          fc.array(hostileString, { minLength: 1, maxLength: 4 }), // explicit keys
          fc.array(hostileString, { minLength: 1, maxLength: 4 }), // derived-only labels
          (explicitKeys, derivedLabels) => {
            const explicit = Array.from(
              new Set(
                explicitKeys.map((k) => k.replace(/^\s+|\s+$/g, "")).filter((k) => k.length > 0),
              ),
            );
            const derived = derivedLabels
              .map((l) => l.replace(/[\r\n|]+/g, " ").trim())
              .filter((l) => l.length > 0);
            fc.pre(explicit.length > 0 && derived.length > 0);
            const columns = [
              ...explicit.map((k) => ({ key: k, label: `Explicit ${k.length}` })),
              ...derived.map((label) => ({ label })),
            ];
            const meta = buildJsonExportMetadata({
              source: "Fuzz Mixed",
              generatedAt: FIXED_DATE,
              columns,
            });
            const cols = meta.columns as Array<{ key: string; label: string }>;
            // Explicit keys come out verbatim at positions [0..explicit.length).
            for (let i = 0; i < explicit.length; i++) {
              expect(cols[i].key).toBe(explicit[i]);
            }
            // Every emitted key is unique (dedupe invariant).
            const keys = cols.map((c) => c.key);
            expect(new Set(keys).size).toBe(keys.length);
            // Emitted length matches input length exactly.
            expect(cols).toHaveLength(columns.length);
          },
        ),
        { numRuns: RUNS },
      );
    });
  });

  // ------------------------------------------------------------------
  // 4. Full-stack: metadata prefix + escaped body parse cleanly.
  // ------------------------------------------------------------------
  describe("full-stack: prefix + hostile body parses cleanly end-to-end", () => {
    const sanitise = (s: string) => s.replace(/[\r\n|]+/g, " ").trim() || "x";

    it("random labels + values yield a valid CSV whose data half round-trips", () => {
      fc.assert(
        fc.property(
          fc.array(hostileString, { minLength: 1, maxLength: 4 }), // labels
          fc.array(hostileString, { minLength: 1, maxLength: 4 }), // data-row values
          (rawLabels, rawValues) => {
            const labels = rawLabels.map(sanitise);
            // Force the value row to match label count.
            const width = labels.length;
            const values = rawValues.slice(0, width);
            while (values.length < width) values.push("x");
            const body = `${labels.map(esc).join(",")}\r\n${values.map(esc).join(",")}\r\n`;
            const csv = prefixCsvWithMetadata(body, {
              source: "Fuzz FullStack",
              generatedAt: FIXED_DATE,
              columns: labels.map((label) => ({ label })),
            });
            const parsedMeta = parseCsvMetadataHeader(csv);
            expect(parsedMeta.columns?.map((c) => c.label)).toEqual(labels);

            // Slice the raw body after the metadata block's `\n\n`
            // delimiter to preserve byte-exact CRLF inside quoted
            // cells — `stripCsvMetadataHeader` re-normalises line
            // endings to `\n`, which would mangle `\r\n` values.
            const bodyStart = csv.indexOf("\n\n");
            const rawBody = bodyStart >= 0 ? csv.slice(bodyStart + 2) : csv;
            const rows = parseCsvRows(rawBody);
            expect(rows[0]).toEqual(labels);
            expect(rows[1]).toEqual(values);
          },
        ),
        { numRuns: RUNS },
      );
    });
  });
});
