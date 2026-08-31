/**
 * End-to-end CSV export runner test.
 *
 * Models the paginated exporter the Dashboard / ImportCenter / DataHealth
 * pages drive against `prefixCsvWithMetadata`, wired through the same
 * `ExportJob` phase shape that `BackgroundExportsPanel` renders. We
 * exercise the full user-visible surface in one place:
 *
 *   1. PROGRESS UPDATES — the runner must transition
 *      `fetching → building → finalising → done`, with `exported` and
 *      `matched` counters monotonically advancing per page (never going
 *      backwards, never exceeding `cap`).
 *
 *   2. TRUNCATION BANNER — when `matched > cap` the runner stops at the
 *      cap, marks the job `done`, and surfaces a human-readable banner
 *      whose numbers agree with the emitted CSV metadata's `Rows:`
 *      counts (shown ≤ cap, filtered = matched, total = dataset size).
 *
 *   3. ERROR BANNER — a rejected page fetch flips the job to `error`
 *      with a message that includes the failing page index and the
 *      original fetch error text; no CSV is produced, no truncation
 *      banner leaks through.
 *
 *   4. METADATA / TABLE PARITY — for randomised inputs (fast-check),
 *      parsing the emitted CSV back must reproduce the exact rows the
 *      runner rendered, in the same order, keyed by the same derived
 *      column keys. This is the property that keeps the metadata block
 *      and the visible table in sync no matter what the caller filters,
 *      sorts, paginates, or truncates.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  prefixCsvWithMetadata,
  withDerivedColumnKeys,
  type CsvMetadataInput,
} from "../csvExportMetadata";
import { parseCsvMetadataHeader } from "../csvMetadataParser";
import { assertPropertyAsync } from "./support/fuzzReporter";

// ---------- Types mirrored from BackgroundExportsPanel -----------------

type Phase = "fetching" | "building" | "finalising" | "done";
type Status = "running" | "done" | "error" | "cancelled";
interface JobState {
  status: Status;
  phase: Phase;
  matched: number | null;
  exported: number;
  cap: number;
  error?: string;
  truncated?: boolean;
  banner?: string;
}

// ---------- Minimal row/column shape ---------------------------------

type Row = Record<string, string | number>;
interface Column {
  key?: string;
  label: string;
  get: (r: Row) => string | number;
}

// ---------- CSV cell escaper (matches production) --------------------

function esc(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

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
        } else quoted = false;
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

/** Split a CSV body honouring quoted cells that span embedded newlines. */
function splitCsvBody(body: string): string[] {
  const rows: string[] = [];
  let buf = "";
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      buf += ch;
      if (ch === '"') {
        if (body[i + 1] === '"') {
          buf += '"';
          i++;
        } else quoted = false;
      }
    } else if (ch === '"') {
      buf += ch;
      quoted = true;
    } else if (ch === "\r" && body[i + 1] === "\n") {
      rows.push(buf);
      buf = "";
      i++;
    } else if (ch === "\n" || ch === "\r") {
      rows.push(buf);
      buf = "";
    } else buf += ch;
  }
  if (buf.length > 0) rows.push(buf);
  return rows.filter((r) => r.length > 0);
}

// ---------- Progress recorder ----------------------------------------

/**
 * Wraps a JobState in a change-log so tests can assert not just the
 * final state but the ORDER of phase transitions and counter updates.
 */
function makeRecorder(cap: number) {
  const snapshots: JobState[] = [];
  const state: JobState = {
    status: "running",
    phase: "fetching",
    matched: null,
    exported: 0,
    cap,
  };
  const patch = (p: Partial<JobState>) => {
    Object.assign(state, p);
    snapshots.push({ ...state });
  };
  return { state, snapshots, patch };
}

// ---------- Paginated exporter under test ----------------------------

interface RunOptions {
  dataset: Row[];
  columns: Column[];
  pageSize: number;
  cap: number;
  source: string;
  generatedAt: Date;
  /**
   * Optional page-index → reject reason. When present, that page throws
   * instead of resolving, driving the error-banner path.
   */
  failOnPage?: number;
}

interface RunResult {
  csv: string | null;
  state: JobState;
  snapshots: JobState[];
  renderedRows: Row[];
}

async function runExport(opts: RunOptions): Promise<RunResult> {
  const rec = makeRecorder(opts.cap);
  const { dataset, columns, pageSize, cap } = opts;

  // Phase 1 — fetching (one page at a time, cap-aware).
  rec.patch({ phase: "fetching", matched: dataset.length });
  const rendered: Row[] = [];
  const totalPages = Math.max(1, Math.ceil(Math.min(dataset.length, cap) / pageSize));
  for (let p = 0; p < totalPages; p++) {
    if (opts.failOnPage === p) {
      rec.patch({
        status: "error",
        error: `page ${p} failed: simulated fetch rejection`,
        banner: `Export failed while fetching page ${p + 1} of ${totalPages}.`,
      });
      return { csv: null, state: rec.state, snapshots: rec.snapshots, renderedRows: [] };
    }
    const start = p * pageSize;
    const slice = dataset.slice(start, start + pageSize);
    for (const row of slice) {
      if (rendered.length >= cap) break;
      rendered.push(row);
    }
    rec.patch({ exported: rendered.length });
    if (rendered.length >= cap) break;
  }

  // Phase 2 — building (serialise the CSV).
  rec.patch({ phase: "building" });
  const derived = withDerivedColumnKeys(columns.map((c) => ({ key: c.key, label: c.label })));
  const headerRow = derived.map((c) => esc(c.label)).join(",");
  const dataRows = rendered.map((r, i) =>
    columns.map((c) => esc(c.get(r) ?? c.get(rendered[i]))).join(","),
  );
  const body = [headerRow, ...dataRows].join("\r\n") + "\r\n";

  const truncated = dataset.length > cap;
  const metaInput: CsvMetadataInput = {
    source: opts.source,
    generatedAt: opts.generatedAt,
    counts: {
      shown: rendered.length,
      filtered: dataset.length,
      total: dataset.length,
    },
    columns: columns.map((c) => ({ key: c.key, label: c.label })),
  };
  const csv = prefixCsvWithMetadata(body, metaInput);

  // Phase 3 — finalising + optional truncation banner.
  rec.patch({ phase: "finalising" });
  if (truncated) {
    rec.patch({
      truncated: true,
      banner:
        `Export truncated: showing ${rendered.length.toLocaleString()} of ` +
        `${dataset.length.toLocaleString()} matched rows (cap ${cap.toLocaleString()}).`,
    });
  }
  rec.patch({ phase: "done", status: "done" });

  return { csv, state: rec.state, snapshots: rec.snapshots, renderedRows: rendered };
}

// ---------- Fixtures --------------------------------------------------

const FIXED_DATE = new Date("2026-07-07T10:00:00Z");

const COLUMNS: Column[] = [
  { key: "id", label: "ID", get: (r) => r.id },
  { label: "Amount", get: (r) => r.amount }, // → slug "amount"
  { label: "Amount", get: (r) => r.amount_alt }, // → "amount_2"
  { label: "!!!", get: (r) => r.note }, // → "column"
  { label: "Unicode ✓", get: (r) => r.tag }, // → "unicode"
];

function buildDataset(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `R${i}`,
    amount: 1000 + i,
    amount_alt: (2000 + i) / 10,
    note: i % 3 === 0 ? `note, with, commas #${i}` : `plain ${i}`,
    tag: i % 5 === 0 ? `tag🎉 ${i}` : `t${i}`,
  }));
}

// ---------- Tests -----------------------------------------------------

describe("CSV export runner: progress, truncation, error, and metadata↔rows parity", () => {
  it("emits fetching → building → finalising → done with monotonically advancing counters", async () => {
    const { state, snapshots } = await runExport({
      dataset: buildDataset(12),
      columns: COLUMNS,
      pageSize: 5,
      cap: 100,
      source: "E2E — progress",
      generatedAt: FIXED_DATE,
    });
    // Terminal state.
    expect(state.status).toBe("done");
    expect(state.phase).toBe("done");
    expect(state.truncated).toBeFalsy();
    expect(state.exported).toBe(12);

    // Phase order: every distinct phase we see must appear in the
    // fixed order fetching < building < finalising < done, with no
    // regressions (e.g. finalising back to fetching).
    const phaseOrder: Phase[] = ["fetching", "building", "finalising", "done"];
    const seenPhases = snapshots.map((s) => s.phase);
    let cursor = 0;
    for (const ph of seenPhases) {
      const idx = phaseOrder.indexOf(ph);
      expect(idx).toBeGreaterThanOrEqual(cursor);
      cursor = idx;
    }
    // All four phases were observed.
    expect(new Set(seenPhases)).toEqual(new Set(phaseOrder));
    // Exported counter never decreases.
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i].exported).toBeGreaterThanOrEqual(snapshots[i - 1].exported);
    }
    // At least one intermediate fetching snapshot with a partial count
    // (so the panel would actually animate, not jump 0 → done).
    const fetching = snapshots.filter((s) => s.phase === "fetching");
    expect(fetching.some((s) => s.exported > 0 && s.exported < 12)).toBe(true);
  });

  it("surfaces a truncation banner whose numbers match the CSV Rows: metadata", async () => {
    const cap = 7;
    const dataset = buildDataset(20);
    const { csv, state } = await runExport({
      dataset,
      columns: COLUMNS,
      pageSize: 5,
      cap,
      source: "E2E — truncation",
      generatedAt: FIXED_DATE,
    });
    expect(state.status).toBe("done");
    expect(state.truncated).toBe(true);
    expect(state.exported).toBe(cap);
    expect(state.banner).toMatch(/Export truncated: showing 7 of 20 matched rows/);

    // Numbers in the banner must agree with what the parser sees.
    const parsed = parseCsvMetadataHeader(csv!, { strict: true });
    expect(parsed.counts).toEqual({ shown: cap, filtered: 20, total: 20 });

    // Body row count matches `exported` — the visible table and the
    // metadata never disagree.
    const body = csv!.slice(parsed.rawLines.join("\n").length).trimStart();
    const bodyRows = splitCsvBody(body);
    // First body row is the header, remainder is data.
    expect(bodyRows.length - 1).toBe(cap);
  });

  it("flips to error with a page-scoped banner and produces no CSV on fetch failure", async () => {
    const { csv, state } = await runExport({
      dataset: buildDataset(30),
      columns: COLUMNS,
      pageSize: 5,
      cap: 100,
      source: "E2E — error",
      generatedAt: FIXED_DATE,
      failOnPage: 2, // fail mid-run so we've already advanced through phases 0 and 1
    });
    expect(state.status).toBe("error");
    expect(state.error).toMatch(/page 2 failed: simulated fetch rejection/);
    expect(state.banner).toMatch(/Export failed while fetching page 3 of \d+\./);
    expect(state.truncated).toBeFalsy(); // truncation must not leak past an error
    expect(csv).toBeNull();
  });

  it("parsed metadata + parsed rows match the runner's rendered rows (fast-check)", async () => {
    const rowArb = fc.record({
      id: fc.string({ minLength: 1, maxLength: 8 }).filter((s) => !/[\r\n]/.test(s)),
      amount: fc.integer({ min: 0, max: 1_000_000 }),
      amount_alt: fc.integer({ min: 0, max: 1_000_000 }),
      note: fc.string({ maxLength: 20 }).filter((s) => !/[\r\n]/.test(s)),
      tag: fc.string({ maxLength: 12 }).filter((s) => !/[\r\n]/.test(s)),
    });

    await assertPropertyAsync(
      "csv-export-e2e/metadata-matches-rendered-rows",
      fc.asyncProperty(
        fc.array(rowArb, { minLength: 1, maxLength: 30 }),
        fc.integer({ min: 1, max: 10 }), // page size
        fc.integer({ min: 1, max: 40 }), // cap
        async (dataset, pageSize, cap) => {
          const { csv, renderedRows, state } = await runExport({
            dataset,
            columns: COLUMNS,
            pageSize,
            cap,
            source: "fuzz E2E",
            generatedAt: FIXED_DATE,
          });
          if (state.status !== "done") return false;
          if (csv === null) return false;

          // Parse metadata and body, then reconcile.
          const parsed = parseCsvMetadataHeader(csv, { strict: true });
          if (parsed.columns === null) return false;

          // Derived keys used by the runner match the ones the parser
          // recovered from the metadata block.
          const derivedKeys = withDerivedColumnKeys(
            COLUMNS.map((c) => ({ key: c.key, label: c.label })),
          ).map((c) => c.key);
          if (JSON.stringify(parsed.columns.map((c) => c.key)) !== JSON.stringify(derivedKeys)) {
            return false;
          }

          // Body row count matches `exported` from the recorder.
          const bodyLines = csv.split(/\r\n|\n|\r/).slice(parsed.bodyStartIndex);
          const bodyText = bodyLines.join("\r\n");
          const bodyRows = splitCsvBody(bodyText);
          const headerCells = splitCsvRow(bodyRows[0]);
          const dataRows = bodyRows.slice(1);
          if (dataRows.length !== renderedRows.length) return false;
          if (headerCells.length !== COLUMNS.length) return false;

          // Every parsed cell equals the rendered value under the
          // derived key — the metadata block's column ordering IS the
          // table's column ordering.
          for (let r = 0; r < renderedRows.length; r++) {
            const cells = splitCsvRow(dataRows[r]);
            if (cells.length !== COLUMNS.length) return false;
            for (let c = 0; c < COLUMNS.length; c++) {
              const rendered = String(COLUMNS[c].get(renderedRows[r]));
              if (cells[c] !== rendered) return false;
            }
          }

          // Metadata counts agree with the recorder — the banner would
          // read the same numbers a downstream parser reads.
          const expectedCounts = {
            shown: renderedRows.length,
            filtered: dataset.length,
            total: dataset.length,
          };
          if (JSON.stringify(parsed.counts) !== JSON.stringify(expectedCounts)) return false;

          return true;
        },
      ),
      {
        seed: 42,
        numRuns: 60,
        argNames: ["dataset", "pageSize", "cap"],
        invariant:
          "parsed CSV metadata (columns + keys + counts) must match the rows the runner actually rendered",
      },
    );
  });
});
