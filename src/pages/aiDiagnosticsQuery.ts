/**
 * Query-builder helper for AiDiagnosticsPage — extracted so an
 * integration test can pin the exact PostgREST call sequence (filters,
 * sort columns + tiebreakers, pagination) that a given URL state
 * produces, without mounting the full page.
 *
 * The whole point is DETERMINISM ACROSS PAGE BOUNDARIES: the primary
 * sort is always followed by a `created_at DESC` secondary (when the
 * primary isn't `created_at` already) and a mandatory `id DESC` final
 * tiebreaker. Together these guarantee two consecutive `range()` calls
 * partition the result set with no overlaps and no gaps, even when
 * dozens of rows share the same primary-sort value.
 */

/** URL-backed inputs the query builder needs. Mirrors AiDiagnosticsPage state. */
export interface AiDiagnosticsQueryParams {
  status: "all" | "success" | "tool-error" | "gateway-error" | "all-errors" | "in-flight";
  retry: "all" | "primary" | "sanitized" | "safe-default" | "non-primary";
  toolName: string; // "all" | exact tool name
  search: string; // already trimmed / debounced
  sortKey: "time" | "status" | "tool";
  sortDir: "asc" | "desc";
}

/** Minimal PostgREST-shaped query builder — every method returns the builder. */
export interface AiDiagnosticsQueryBuilder {
  eq(col: string, val: unknown): AiDiagnosticsQueryBuilder;
  neq(col: string, val: unknown): AiDiagnosticsQueryBuilder;
  gte(col: string, val: unknown): AiDiagnosticsQueryBuilder;
  not(col: string, op: string, val: unknown): AiDiagnosticsQueryBuilder;
  or(filter: string): AiDiagnosticsQueryBuilder;
  order(
    col: string,
    opts?: { ascending?: boolean; nullsFirst?: boolean },
  ): AiDiagnosticsQueryBuilder;
}

/**
 * Apply filters + sort/tiebreakers to a PostgREST-shaped query builder.
 * Does NOT call `.range()` — pagination stays with the caller so this
 * helper is reusable for exports that page through the whole set.
 *
 * Sort tiebreaker contract (locked down by tests):
 *   1. primary sort column (asc/desc, NULLS LAST)
 *   2. IF primary ≠ `created_at`: `created_at DESC`
 *   3. IF primary ≠ `tool_name`: `tool_name ASC` (NULLS LAST) — human-
 *      meaningful secondary so rows sharing a Time cluster by tool.
 *   4. `id DESC` — ALWAYS, guarantees a total ordering on `id`
 */
export function applyAiDiagnosticsFilters<Q extends AiDiagnosticsQueryBuilder>(
  q: Q,
  params: AiDiagnosticsQueryParams,
): Q {
  const { status, retry, toolName, search, sortKey, sortDir } = params;

  // ---- Filters ----------------------------------------------------------
  // Terminal statuses (`success`, `tool-error`, `gateway-error`) explicitly
  // exclude in-flight rows so a call still executing doesn't leak into a
  // terminal bucket. "in-flight" is its own bucket for tool calls that
  // have been logged at start but not yet completed. "tool-error" narrows
  // the old "failed" bucket to failures NOT caused by the gateway
  // (success=false AND gateway_status IS NULL OR < 400). "gateway-error"
  // covers any HTTP ≥ 400 response regardless of the `success` flag but
  // still excludes rows that are only in-flight.
  if (status === "success") {
    q = q.eq("success", true).eq("in_flight", false) as Q;
  } else if (status === "tool-error") {
    q = q
      .eq("success", false)
      .eq("in_flight", false)
      .or("gateway_status.is.null,gateway_status.lt.400") as Q;
  } else if (status === "gateway-error") {
    q = q.gte("gateway_status", 400).eq("in_flight", false) as Q;
  } else if (status === "all-errors") {
    // Union of tool-error and gateway-error: any terminal row that is
    // either a non-success OR carries an HTTP ≥ 400 gateway status.
    // in-flight is excluded so a still-running call doesn't leak in.
    q = q.eq("in_flight", false).or("success.eq.false,gateway_status.gte.400") as Q;
  } else if (status === "in-flight") {
    q = q.eq("in_flight", true) as Q;
  }

  if (retry === "non-primary") {
    q = q.not("retry_strategy", "is", null).neq("retry_strategy", "primary") as Q;
  } else if (retry !== "all") {
    q = q.eq("retry_strategy", retry) as Q;
  }

  if (toolName !== "all") q = q.eq("tool_name", toolName) as Q;

  const term = search.trim();
  if (term) {
    // Escaping commas and parentheses ensures user-typed search text cannot
    // inject extra filter clauses into the PostgREST `.or()` string.
    const esc = term.replace(/([,()])/g, "\\$1");
    const pat = `%${esc}%`;
    q = q.or(
      [
        `tool_name.ilike.${pat}`,
        `error_message.ilike.${pat}`,
        `retry_strategy.ilike.${pat}`,
        `gateway_model.ilike.${pat}`,
      ].join(","),
    ) as Q;
  }

  // ---- Sort + tiebreakers ----------------------------------------------
  const orderCol =
    sortKey === "time" ? "created_at" : sortKey === "status" ? "success" : "tool_name";
  const ascending = sortDir === "asc";
  q = q.order(orderCol, { ascending, nullsFirst: false }) as Q;
  if (orderCol !== "created_at") q = q.order("created_at", { ascending: false }) as Q;
  if (orderCol !== "tool_name")
    q = q.order("tool_name", { ascending: true, nullsFirst: false }) as Q;
  q = q.order("id", { ascending: false }) as Q;
  return q;
}
