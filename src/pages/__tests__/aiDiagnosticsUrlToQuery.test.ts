/**
 * Contract test: URL → server query parameters for AI Diagnostics.
 *
 * `aiDiagnosticsQueryPagination.test.ts` proves that the emitted
 * builder plan paginates deterministically; THIS test pins the exact
 * `.eq / .neq / .not / .gte / .or / .order` calls each URL param
 * translates into, so a regression in the URL → PostgREST mapping
 * (e.g. dropping the `in_flight=false` guard on `status=success`,
 * mis-encoding the search ilike, or forgetting the `id DESC`
 * tiebreaker) surfaces as an obvious diff — not as a subtle data bug
 * a user would have to catch in production.
 *
 * Covers every URL-driven server input:
 *   • status = success | tool-error | gateway-error | in-flight
 *   • retry  = primary | sanitized | safe-default | non-primary
 *   • tool   = <exact tool name>
 *   • q      = free-text search (multi-column ilike OR)
 *   • sort   = time | status | tool  (× dir = asc|desc)
 *   • size/page — asserted at the caller level (range window)
 */
import { describe, it, expect } from "vitest";
import {
  applyAiDiagnosticsFilters,
  type AiDiagnosticsQueryBuilder,
  type AiDiagnosticsQueryParams,
} from "../aiDiagnosticsQuery";
import { aiDiagnosticsSearchSchema } from "../../routes/_authenticated/admin.ai-diagnostics";

// ---------------------------------------------------------------------------
// Recorder — captures every builder call verbatim.
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

function paramsFromUrl(url: string): AiDiagnosticsQueryParams {
  const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const raw: Record<string, string> = {};
  for (const seg of q.split("&").filter(Boolean)) {
    const [k, v = ""] = seg.split("=");
    raw[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  const sp = aiDiagnosticsSearchSchema.parse(raw);
  return {
    status: sp.status ?? "all",
    retry: sp.retry ?? "all",
    toolName: sp.tool ?? "all",
    search: sp.q ?? "",
    sortKey: sp.sort ?? "time",
    sortDir: sp.dir ?? "desc",
  };
}

function planFor(url: string): Call[] {
  const rec = makeRecorder();
  applyAiDiagnosticsFilters(rec, paramsFromUrl(url));
  return rec.calls;
}

// The three-call sort tail every plan MUST end with when sort key is
// the default `time` (created_at) — pinned separately so per-URL
// assertions can focus on the filters and stay short.
const DEFAULT_SORT_TAIL: Call[] = [
  { kind: "order", col: "created_at", ascending: false, nullsFirst: false },
  { kind: "order", col: "tool_name", ascending: true, nullsFirst: false },
  { kind: "order", col: "id", ascending: false, nullsFirst: undefined },
];

// ---------------------------------------------------------------------------
describe("URL params → server query filters (verbatim mapping)", () => {
  it("bare URL → only the sort tail (no filter calls at all)", () => {
    expect(planFor("/admin/ai-diagnostics")).toEqual(DEFAULT_SORT_TAIL);
  });

  it("status=success → success=true AND in_flight=false, THEN sort tail", () => {
    expect(planFor("/admin/ai-diagnostics?status=success")).toEqual([
      { kind: "eq", col: "success", val: true },
      { kind: "eq", col: "in_flight", val: false },
      ...DEFAULT_SORT_TAIL,
    ]);
  });

  it("status=tool-error → success=false AND in_flight=false AND (gateway_status.is.null | gateway_status.lt.400)", () => {
    expect(planFor("/admin/ai-diagnostics?status=tool-error")).toEqual([
      { kind: "eq", col: "success", val: false },
      { kind: "eq", col: "in_flight", val: false },
      { kind: "or", filter: "gateway_status.is.null,gateway_status.lt.400" },
      ...DEFAULT_SORT_TAIL,
    ]);
  });

  it("status=gateway-error → gateway_status>=400 AND in_flight=false", () => {
    expect(planFor("/admin/ai-diagnostics?status=gateway-error")).toEqual([
      { kind: "gte", col: "gateway_status", val: 400 },
      { kind: "eq", col: "in_flight", val: false },
      ...DEFAULT_SORT_TAIL,
    ]);
  });

  it("status=in-flight → in_flight=true only (no success/gateway_status guard)", () => {
    expect(planFor("/admin/ai-diagnostics?status=in-flight")).toEqual([
      { kind: "eq", col: "in_flight", val: true },
      ...DEFAULT_SORT_TAIL,
    ]);
  });

  it("retry=primary → retry_strategy=primary (no NOT NULL guard)", () => {
    expect(planFor("/admin/ai-diagnostics?retry=primary")).toEqual([
      { kind: "eq", col: "retry_strategy", val: "primary" },
      ...DEFAULT_SORT_TAIL,
    ]);
  });

  it("retry=sanitized / safe-default → single eq on the exact strategy value", () => {
    expect(planFor("/admin/ai-diagnostics?retry=sanitized")).toContainEqual({
      kind: "eq",
      col: "retry_strategy",
      val: "sanitized",
    });
    expect(planFor("/admin/ai-diagnostics?retry=safe-default")).toContainEqual({
      kind: "eq",
      col: "retry_strategy",
      val: "safe-default",
    });
  });

  it("retry=non-primary → retry_strategy IS NOT NULL AND retry_strategy != primary", () => {
    const calls = planFor("/admin/ai-diagnostics?retry=non-primary");
    expect(calls).toContainEqual({
      kind: "not",
      col: "retry_strategy",
      op: "is",
      val: null,
    });
    expect(calls).toContainEqual({
      kind: "neq",
      col: "retry_strategy",
      val: "primary",
    });
    // No plain `eq` on retry_strategy — non-primary is a compound filter.
    expect(calls.some((c) => c.kind === "eq" && c.col === "retry_strategy")).toBe(false);
  });

  it("tool=<name> → exact match on tool_name, other filters untouched", () => {
    expect(planFor("/admin/ai-diagnostics?tool=list_bookings")).toEqual([
      { kind: "eq", col: "tool_name", val: "list_bookings" },
      ...DEFAULT_SORT_TAIL,
    ]);
  });

  it("q=booking → OR ilike across tool_name / error_message / retry_strategy / gateway_model", () => {
    const calls = planFor("/admin/ai-diagnostics?q=booking");
    expect(calls).toContainEqual({
      kind: "or",
      filter:
        "tool_name.ilike.%booking%,error_message.ilike.%booking%,retry_strategy.ilike.%booking%,gateway_model.ilike.%booking%",
    });
  });

  it("q=<value with commas/parens> → punctuation escaped before ilike", () => {
    // Commas and parens are PostgREST's OR-filter delimiters; they must
    // be escaped so they don't corrupt the filter.
    const calls = planFor("/admin/ai-diagnostics?q=" + encodeURIComponent("foo,bar(baz)"));
    const orCall = calls.find((c) => c.kind === "or") as Extract<Call, { kind: "or" }>;
    expect(orCall).toBeDefined();
    // The term should be properly escaped with backslashes
    const term = orCall.filter.match(/tool_name\.ilike\.%([^%]*)%/)![1];
    expect(term).toBe("foo\\,bar\\(baz\\)");
  });

  it("combined filters (status + retry + tool + q) all appear in one plan", () => {
    const calls = planFor(
      "/admin/ai-diagnostics?status=success&retry=sanitized&tool=list_bookings&q=err",
    );
    expect(calls).toContainEqual({ kind: "eq", col: "success", val: true });
    expect(calls).toContainEqual({ kind: "eq", col: "in_flight", val: false });
    expect(calls).toContainEqual({
      kind: "eq",
      col: "retry_strategy",
      val: "sanitized",
    });
    expect(calls).toContainEqual({
      kind: "eq",
      col: "tool_name",
      val: "list_bookings",
    });
    expect(
      calls.some((c) => c.kind === "or" && (c as { filter: string }).filter.includes("%err%")),
    ).toBe(true);
  });

  it("sort=status&dir=asc → primary success ASC, then created_at DESC, tool_name ASC, id DESC", () => {
    const orderCalls = planFor("/admin/ai-diagnostics?sort=status&dir=asc").filter(
      (c) => c.kind === "order",
    );
    // Only the PRIMARY sort call passes `nullsFirst: false`; the
    // secondaries call `.order()` without opts (nullsFirst: undefined).
    expect(orderCalls).toEqual([
      { kind: "order", col: "success", ascending: true, nullsFirst: false },
      { kind: "order", col: "created_at", ascending: false, nullsFirst: undefined },
      { kind: "order", col: "tool_name", ascending: true, nullsFirst: false },
      { kind: "order", col: "id", ascending: false, nullsFirst: undefined },
    ]);
  });

  it("sort=tool&dir=desc → primary tool_name DESC, then created_at DESC, id DESC (no redundant tool_name secondary)", () => {
    const orderCalls = planFor("/admin/ai-diagnostics?sort=tool&dir=desc").filter(
      (c) => c.kind === "order",
    );
    expect(orderCalls).toEqual([
      { kind: "order", col: "tool_name", ascending: false, nullsFirst: false },
      { kind: "order", col: "created_at", ascending: false, nullsFirst: undefined },
      { kind: "order", col: "id", ascending: false, nullsFirst: undefined },
    ]);
  });

  it("sort=time&dir=asc → primary created_at ASC, then tool_name ASC, id DESC (no redundant created_at secondary)", () => {
    const orderCalls = planFor("/admin/ai-diagnostics?sort=time&dir=asc").filter(
      (c) => c.kind === "order",
    );
    expect(orderCalls).toEqual([
      { kind: "order", col: "created_at", ascending: true, nullsFirst: false },
      { kind: "order", col: "tool_name", ascending: true, nullsFirst: false },
      { kind: "order", col: "id", ascending: false, nullsFirst: undefined },
    ]);
  });

  it("status=all + retry=all + tool=all + no q → zero filter calls (only the sort tail)", () => {
    // The `all` sentinel MUST be treated as "no filter" — not sent to
    // the database as `status=all` (which would return zero rows).
    const calls = planFor("/admin/ai-diagnostics?status=all&retry=all&tool=all");
    expect(calls.filter((c) => c.kind !== "order")).toEqual([]);
  });
});
