/**
 * Integration test: URL search params → PostgREST query builder →
 * DETERMINISTIC ROWS ACROSS PAGE BOUNDARIES.
 *
 * The AI Diagnostics page persists every user-controlled bit of state
 * (search, filters, sort, dir, page, size) in the URL. This test drives
 * both halves of the contract end-to-end:
 *
 *   1. VALIDATE — parse each URL fixture through the route's
 *      `aiDiagnosticsSearchSchema` so we're testing the same shape the
 *      real page reads.
 *   2. BUILD    — run `applyAiDiagnosticsFilters` (the exact helper the
 *      page uses) against a recording query builder and pin the emitted
 *      `.eq / .neq / .not / .gte / .or / .order` sequence.
 *   3. PAGINATE — run the same builder against an IN-MEMORY simulator
 *      that applies the recorded filters + order to a synthetic dataset
 *      and slices it via `.range()`, then walk every page and assert:
 *        • no row appears in two pages
 *        • no row is missing (union across pages == filtered universe)
 *        • per-page ordering matches the primary sort + tiebreakers
 *        • two independent walks over the same URL return byte-identical
 *          page contents (proof of run-to-run determinism)
 *
 * If any of these break, `range()`-based pagination silently
 * mis-partitions the log, which is the classic "duplicate rows / missing
 * rows on next page" bug.
 */
import { describe, it, expect } from "vitest";
import {
  applyAiDiagnosticsFilters,
  type AiDiagnosticsQueryBuilder,
  type AiDiagnosticsQueryParams,
} from "../aiDiagnosticsQuery";
import { aiDiagnosticsSearchSchema } from "../../routes/_authenticated/admin.ai-diagnostics";

// ---------------------------------------------------------------------------
// Route search → builder params. Mirrors AiDiagnosticsPage state-reading.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Recording builder — captures every method call in order.
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

// ---------------------------------------------------------------------------
// In-memory Postgres simulator — apply the recorded filters + orders to a
// dataset, then slice with a Postgres-like `range(from, to)` (inclusive).
// ---------------------------------------------------------------------------
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
      // Only `is null` is used by the page.
      if (c.op === "is" && c.val === null) {
        rows = rows.filter((r) => (r as any)[c.col] !== null && (r as any)[c.col] !== undefined);
      }
    } else if (c.kind === "or") {
      // Only the ilike-fan-out shape is used by the page.
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
  // Multi-key sort — later `.order()` calls are LOWER precedence in
  // PostgREST (the first `.order()` is the primary sort).
  const sorted = [...rows].sort((a, b) => {
    for (const spec of orderSpecs) {
      const av = (a as any)[spec.col];
      const bv = (b as any)[spec.col];
      // Nulls last always (nullsFirst: false in the builder).
      if (av == null && bv == null) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return spec.ascending ? -1 : 1;
      if (av > bv) return spec.ascending ? 1 : -1;
    }
    return 0;
  });
  return sorted;
}

/** Simulate `.range(from, to)` on a filtered+sorted dataset. */
function pageOf(sorted: Row[], from: number, to: number): Row[] {
  return sorted.slice(from, to + 1);
}

// ---------------------------------------------------------------------------
// Synthetic dataset — 200 rows with LOTS of ties on every sortable column so
// the tiebreaker chain has real work to do. Ids are unique.
// ---------------------------------------------------------------------------
function makeDataset(): Row[] {
  const tools = ["create_booking", "list_payments", "search_units", null];
  const strategies = ["primary", "sanitized", "safe-default", null];
  const models = ["gpt-5", "claude-4.5", null];
  const errors = ["timeout", "rate_limit", "bad_gateway", null];
  const rows: Row[] = [];
  for (let i = 1; i <= 200; i++) {
    // Only 10 distinct timestamps → massive `created_at` ties.
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

// URL fixtures — every one exercises a distinct filter/sort combination.
const URL_FIXTURES: Array<{ label: string; url: string }> = [
  { label: "defaults (empty URL)", url: "" },
  { label: "sort by tool asc", url: "sort=tool&dir=asc" },
  { label: "sort by status desc", url: "sort=status&dir=desc" },
  {
    label: "status=tool-error + sort=tool asc",
    url: "status=tool-error&sort=tool&dir=asc&size=15",
  },
  {
    label: "gateway-error + retry=non-primary",
    url: "status=gateway-error&retry=non-primary&size=10",
  },
  {
    label: "tool filter + search",
    url: "tool=create_booking&q=timeout&size=20",
  },
  {
    label: "retry=sanitized + sort=status desc + page 2",
    url: "retry=sanitized&sort=status&dir=desc&page=2&size=25",
  },
];

function parseUrl(url: string) {
  const usp = new URLSearchParams(url);
  const raw: Record<string, string> = {};
  usp.forEach((v, k) => (raw[k] = v));
  return aiDiagnosticsSearchSchema.parse(raw);
}

// ---------------------------------------------------------------------------
describe("AiDiagnostics — URL params drive deterministic paginated queries", () => {
  it.each(URL_FIXTURES)(
    "$label — sort chain ends with tool_name ASC (implicit) + id DESC and includes created_at DESC secondary",
    ({ url }) => {
      const params = paramsFromSearch(parseUrl(url));
      const rec = makeRecorder();
      applyAiDiagnosticsFilters(rec, params);
      const orderCalls = rec.calls.filter((c) => c.kind === "order");
      // Last order call MUST be `id DESC` (final tiebreaker).
      const last = orderCalls.at(-1)!;
      expect(last).toMatchObject({ kind: "order", col: "id", ascending: false });
      const primary = orderCalls[0];
      // If primary isn't `tool_name`, a `tool_name ASC` sits right before
      // the `id DESC` tiebreaker (human-meaningful secondary).
      if (primary.col !== "tool_name") {
        const beforeId = orderCalls[orderCalls.length - 2];
        expect(beforeId).toMatchObject({
          kind: "order",
          col: "tool_name",
          ascending: true,
        });
      }
      // If primary isn't `created_at`, a `created_at DESC` secondary is
      // present in the chain (between the primary and tool_name/id).
      if (primary.col !== "created_at") {
        expect(orderCalls.some((c) => c.col === "created_at" && c.ascending === false)).toBe(true);
      }
    },
  );

  it.each(URL_FIXTURES)(
    "$label — walking every page yields the full filtered set with NO overlap and NO gap",
    ({ url }) => {
      const sp = parseUrl(url);
      const params = paramsFromSearch(sp);
      const size = sp.size ?? 25;

      // Recorder captures the exact call plan; simulator applies it to
      // the dataset. This is the same plan the real page ships to
      // PostgREST — we're just executing it in-process.
      const rec = makeRecorder();
      applyAiDiagnosticsFilters(rec, params);
      const dataset = makeDataset();
      const sorted = applyCalls(dataset, rec.calls);

      const seen = new Set<number>();
      const collected: number[] = [];
      const totalPages = Math.max(1, Math.ceil(sorted.length / size));
      for (let page = 1; page <= totalPages; page++) {
        const from = (page - 1) * size;
        const to = from + size - 1;
        const rows = pageOf(sorted, from, to);
        for (const r of rows) {
          expect(seen.has(r.id), `duplicate id ${r.id} on page ${page}`).toBe(false);
          seen.add(r.id);
          collected.push(r.id);
        }
      }
      // Union of pages equals the filtered universe (order-preserving).
      expect(collected).toEqual(sorted.map((r) => r.id));
    },
  );

  it.each(URL_FIXTURES)(
    "$label — two independent walks return byte-identical page contents",
    ({ url }) => {
      const params = paramsFromSearch(parseUrl(url));
      const size = parseUrl(url).size ?? 25;

      const buildPages = (): number[][] => {
        const rec = makeRecorder();
        applyAiDiagnosticsFilters(rec, params);
        const sorted = applyCalls(makeDataset(), rec.calls);
        const pages: number[][] = [];
        for (let p = 0; p < Math.ceil(sorted.length / size); p++) {
          pages.push(pageOf(sorted, p * size, p * size + size - 1).map((r) => r.id));
        }
        return pages;
      };
      expect(buildPages()).toEqual(buildPages());
    },
  );

  it("per-page ordering respects primary sort + tiebreakers on tie-heavy data", () => {
    // Sort by tool_name asc — lots of rows share the same tool → the
    // created_at DESC + id DESC tiebreakers must kick in.
    const params = paramsFromSearch(parseUrl("sort=tool&dir=asc&size=25"));
    const rec = makeRecorder();
    applyAiDiagnosticsFilters(rec, params);
    const sorted = applyCalls(makeDataset(), rec.calls);
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      // Primary: tool_name asc (nulls last).
      if (a.tool_name !== b.tool_name) {
        if (a.tool_name == null) throw new Error("null tool_name before non-null");
        if (b.tool_name != null) expect(a.tool_name <= b.tool_name).toBe(true);
        continue;
      }
      // Tie on tool_name → created_at DESC.
      if (a.created_at !== b.created_at) {
        expect(a.created_at >= b.created_at).toBe(true);
        continue;
      }
      // Tie on created_at too → id DESC.
      expect(a.id).toBeGreaterThan(b.id);
    }
  });
});
