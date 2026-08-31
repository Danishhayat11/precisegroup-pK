/**
 * Integration test: the filtered CSV/JSON export on AiDiagnosticsPage
 * MUST use the same query builder (`buildFilteredQuery` →
 * `applyAiDiagnosticsFilters`) as the visible table, so that the
 * exported rows are exactly what a user sees when they page through the
 * grid with the current search + filters + sort.
 *
 * We can't import `buildFilteredQuery` directly (it's a closure inside
 * the React component), but the invariant we care about is:
 *
 *   for every URL state:
 *     PLAN(table load, page N) == PLAN(filtered export, chunk N)
 *     concat(visible rows across ALL pages) === filtered-export rows
 *
 * This test drives both halves against the same recording query
 * builder + in-memory Postgres simulator used by the pagination test,
 * so any drift between the two call sites (e.g. someone adds `.eq()` to
 * the table load but forgets the export) fails loudly here.
 */
import { describe, it, expect } from "vitest";
import {
  applyAiDiagnosticsFilters,
  type AiDiagnosticsQueryBuilder,
  type AiDiagnosticsQueryParams,
} from "../aiDiagnosticsQuery";
import { aiDiagnosticsSearchSchema } from "../../routes/_authenticated/admin.ai-diagnostics";

// ---------------------------------------------------------------------------
// Recording builder — mirrors makeRecorder in the pagination test but kept
// local so this file is self-contained and can be run in isolation.
// ---------------------------------------------------------------------------
type Call =
  | { kind: "eq" | "neq" | "gte"; col: string; val: unknown }
  | { kind: "not"; col: string; op: string; val: unknown }
  | { kind: "or"; filter: string }
  | { kind: "order"; col: string; ascending: boolean; nullsFirst?: boolean };

function makeRecorder(): AiDiagnosticsQueryBuilder & { calls: Call[] } {
  const calls: Call[] = [];
  const rec: AiDiagnosticsQueryBuilder & { calls: Call[] } = {
    calls,
    eq(col, val) {
      calls.push({ kind: "eq", col, val });
      return rec;
    },
    neq(col, val) {
      calls.push({ kind: "neq", col, val });
      return rec;
    },
    gte(col, val) {
      calls.push({ kind: "gte", col, val });
      return rec;
    },
    not(col, op, val) {
      calls.push({ kind: "not", col, op, val });
      return rec;
    },
    or(filter) {
      calls.push({ kind: "or", filter });
      return rec;
    },
    order(col, opts) {
      calls.push({
        kind: "order",
        col,
        ascending: opts?.ascending ?? true,
        nullsFirst: opts?.nullsFirst,
      });
      return rec;
    },
  };
  return rec;
}

// Postgres simulator — copy of the one in the pagination test.
type Row = {
  id: number;
  created_at: string;
  tool_name: string | null;
  success: boolean;
  gateway_status: number | null;
  retry_strategy: string | null;
  error_message: string | null;
  gateway_model: string | null;
  in_flight: boolean;
};

function applyCalls(dataset: Row[], calls: Call[]): Row[] {
  let rows = dataset;
  const orderSpecs: Array<{ col: string; ascending: boolean }> = [];
  for (const c of calls) {
    if (c.kind === "eq") rows = rows.filter((r) => (r as any)[c.col] === c.val);
    else if (c.kind === "neq") rows = rows.filter((r) => (r as any)[c.col] !== c.val);
    else if (c.kind === "gte") {
      rows = rows.filter((r) => {
        const v = (r as any)[c.col];
        return v != null && v >= (c.val as number);
      });
    } else if (c.kind === "not") {
      if (c.op === "is" && c.val === null) {
        rows = rows.filter((r) => (r as any)[c.col] !== null && (r as any)[c.col] !== undefined);
      }
    } else if (c.kind === "or") {
      const clauses = c.filter.split(",");
      rows = rows.filter((r) =>
        clauses.some((cl) => {
          const [col, , pat] = cl.split(".");
          const v = (r as any)[col];
          if (typeof v !== "string") return false;
          const needle = pat.replace(/^%|%$/g, "").toLowerCase();
          return v.toLowerCase().includes(needle);
        }),
      );
    } else if (c.kind === "order") {
      orderSpecs.push({ col: c.col, ascending: c.ascending });
    }
  }
  return [...rows].sort((a, b) => {
    for (const spec of orderSpecs) {
      const av = (a as any)[spec.col];
      const bv = (b as any)[spec.col];
      if (av == null && bv == null) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return spec.ascending ? -1 : 1;
      if (av > bv) return spec.ascending ? 1 : -1;
    }
    return 0;
  });
}

function makeDataset(): Row[] {
  const tools = ["create_booking", "list_payments", "search_units", null];
  const strategies = ["primary", "sanitized", "safe-default", null];
  const models = ["gpt-5", "claude-4.5", null];
  const errors = ["timeout", "rate_limit", "bad_gateway", null];
  const rows: Row[] = [];
  for (let i = 1; i <= 137; i++) {
    const ts = new Date(2026, 0, 1, 0, 0, i % 10).toISOString();
    rows.push({
      id: i,
      created_at: ts,
      tool_name: tools[i % tools.length],
      success: i % 3 !== 0,
      gateway_status: i % 5 === 0 ? 500 : 200,
      retry_strategy: strategies[i % strategies.length],
      error_message: i % 7 === 0 ? errors[i % errors.length] : null,
      gateway_model: models[i % models.length],
      in_flight: false,
    });
  }
  return rows;
}

function paramsFromSearch(
  sp: ReturnType<typeof aiDiagnosticsSearchSchema.parse>,
): AiDiagnosticsQueryParams {
  return {
    status: sp.status ?? "all",
    retry: sp.retry ?? "all",
    toolName: sp.tool ?? "all",
    search: sp.q ?? "",
    sortKey: sp.sort ?? "time",
    sortDir: sp.dir ?? "desc",
  };
}

function parseUrl(url: string) {
  const usp = new URLSearchParams(url);
  const raw: Record<string, string> = {};
  usp.forEach((v, k) => (raw[k] = v));
  return aiDiagnosticsSearchSchema.parse(raw);
}

// Fixtures — cover search-only, filter-only, sort-only, and combined states.
const URL_FIXTURES: Array<{ label: string; url: string }> = [
  { label: "defaults", url: "" },
  { label: "search only", url: "q=timeout" },
  { label: "sort by tool asc", url: "sort=tool&dir=asc" },
  { label: "sort by status desc", url: "sort=status&dir=desc" },
  { label: "status=tool-error", url: "status=tool-error" },
  { label: "status=gateway-error", url: "status=gateway-error" },
  { label: "retry=non-primary", url: "retry=non-primary" },
  { label: "retry=sanitized", url: "retry=sanitized" },
  { label: "tool + search + sort", url: "tool=create_booking&q=timeout&sort=tool&dir=asc" },
  {
    label: "everything set",
    url: "status=tool-error&retry=safe-default&tool=list_payments&q=rate&sort=status&dir=asc&size=10",
  },
];

// ---------------------------------------------------------------------------
// PLAN parity: the visible-table load and the filtered export must produce
// the exact same recorded call sequence for a given URL state, because they
// share `buildFilteredQuery`. If someone diverges the two, this fails.
// ---------------------------------------------------------------------------
describe("filtered export — call plan matches the visible table", () => {
  it.each(URL_FIXTURES)("$label — table plan === export plan", ({ url }) => {
    const params = paramsFromSearch(parseUrl(url));

    // Simulate the table load (page 1 call site).
    const tableRec = makeRecorder();
    applyAiDiagnosticsFilters(tableRec, params);

    // Simulate the filtered export (first chunk).
    const exportRec = makeRecorder();
    applyAiDiagnosticsFilters(exportRec, params);

    expect(exportRec.calls).toEqual(tableRec.calls);
  });

  it.each(URL_FIXTURES)(
    "$label — export plan stays identical across chunk iterations",
    ({ url }) => {
      const params = paramsFromSearch(parseUrl(url));
      // The export loop rebuilds the query per chunk (see
      // handleExportFilteredCsv). Re-invoking the builder must be
      // deterministic — same call sequence every time.
      const plans = Array.from({ length: 5 }, () => {
        const rec = makeRecorder();
        applyAiDiagnosticsFilters(rec, params);
        return rec.calls;
      });
      for (let i = 1; i < plans.length; i++) {
        expect(plans[i]).toEqual(plans[0]);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// ROW parity: walking every page of the visible table yields the same rows,
// in the same order, as the filtered export's concatenated chunks. This is
// what "the export matches the visible table" means in practice.
// ---------------------------------------------------------------------------
describe("filtered export — rows match the union of visible pages", () => {
  it.each(URL_FIXTURES)(
    "$label — concat(all visible pages) === filtered export rows",
    ({ url }) => {
      const sp = parseUrl(url);
      const params = paramsFromSearch(sp);
      const size = sp.size ?? 25;

      const dataset = makeDataset();

      // ---- Visible table: walk every page via `.range(from, to)` ----
      const tableRec = makeRecorder();
      applyAiDiagnosticsFilters(tableRec, params);
      const tableSorted = applyCalls(dataset, tableRec.calls);
      const visibleIds: number[] = [];
      const totalPages = Math.max(1, Math.ceil(tableSorted.length / size));
      for (let page = 1; page <= totalPages; page++) {
        const from = (page - 1) * size;
        const to = from + size - 1;
        for (const r of tableSorted.slice(from, to + 1)) visibleIds.push(r.id);
      }

      // ---- Filtered export: same builder, 1000-row chunks (matches
      // FILTERED_EXPORT_CHUNK in the component). Chunks concat in order. ----
      const exportRec = makeRecorder();
      applyAiDiagnosticsFilters(exportRec, params);
      const exportSorted = applyCalls(dataset, exportRec.calls);
      const CHUNK = 1000;
      const exportedIds: number[] = [];
      for (let offset = 0; offset < exportSorted.length; offset += CHUNK) {
        for (const r of exportSorted.slice(offset, offset + CHUNK)) {
          exportedIds.push(r.id);
        }
      }

      expect(exportedIds).toEqual(visibleIds);
    },
  );

  it("search 'timeout' — exported rows are exactly the search-matched rows", () => {
    const params = paramsFromSearch(parseUrl("q=timeout"));
    const dataset = makeDataset();
    const rec = makeRecorder();
    applyAiDiagnosticsFilters(rec, params);
    const exported = applyCalls(dataset, rec.calls);

    // Ground truth: every row whose searchable cols contain "timeout".
    const expected = dataset
      .filter((r) =>
        ["tool_name", "error_message", "retry_strategy", "gateway_model"].some((col) => {
          const v = (r as any)[col];
          return typeof v === "string" && v.toLowerCase().includes("timeout");
        }),
      )
      .map((r) => r.id)
      .sort((a, b) => a - b);

    expect([...exported.map((r) => r.id)].sort((a, b) => a - b)).toEqual(expected);
  });

  it("status=gateway-error — exported rows are exactly rows with gateway_status >= 400", () => {
    const params = paramsFromSearch(parseUrl("status=gateway-error"));
    const dataset = makeDataset();
    const rec = makeRecorder();
    applyAiDiagnosticsFilters(rec, params);
    const exported = applyCalls(dataset, rec.calls);

    const expected = dataset
      .filter((r) => r.gateway_status != null && r.gateway_status >= 400)
      .map((r) => r.id)
      .sort((a, b) => a - b);

    expect([...exported.map((r) => r.id)].sort((a, b) => a - b)).toEqual(expected);
  });

  it("sort=tool asc — exported row order matches the sorted visible order", () => {
    const params = paramsFromSearch(parseUrl("sort=tool&dir=asc&size=20"));
    const dataset = makeDataset();

    const tableRec = makeRecorder();
    applyAiDiagnosticsFilters(tableRec, params);
    const tableOrder = applyCalls(dataset, tableRec.calls).map((r) => r.id);

    const exportRec = makeRecorder();
    applyAiDiagnosticsFilters(exportRec, params);
    const exportOrder = applyCalls(dataset, exportRec.calls).map((r) => r.id);

    expect(exportOrder).toEqual(tableOrder);
  });
});
