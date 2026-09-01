import { supabase } from "@/integrations/supabase/client";

/**
 * Paginated fetch helper that defeats PostgREST's default 1000-row cap.
 *
 * Pass a builder function that returns a Supabase query (already narrowed via
 * `.from(...).select(...)` and any filters / ordering you need). `fetchAll`
 * will walk it in fixed-size pages via `.range()` until the server reports
 * fewer rows than requested, then return the concatenated array.
 *
 * Always include a stable `.order(...)` in your builder — without it
 * PostgREST may return rows in different orders per page and you can
 * silently drop or duplicate records.
 *
 * Use this for any aggregation query that scans a full table (Dashboard,
 * Reports, AI snapshot, portfolio KPIs). For UI lists that intentionally
 * cap at N rows, keep the explicit `.limit(N)` and do NOT use fetchAll.
 *
 * TYPE SAFETY NOTE: The builder callback parameter is typed as `any` because
 * `supabase.from()` returns a different generic instantiation per table name,
 * and we accept the table name at runtime. The Row generic on the return type
 * still enforces output shape at every call site. Callers SHOULD always
 * provide an explicit Row type parameter.
 */
export async function fetchAll<Row>(
  build: (qb: any) => any,
  opts: { table: string; pageSize?: number } & Record<string, unknown>,
): Promise<Row[]> {
  const pageSize = Math.max(1, Math.min(1000, Number(opts.pageSize ?? 1000)));
  const out: Row[] = [];
  let from = 0;
  // Safety stop — refuse to loop forever on a runaway query.
  const HARD_CAP = 200_000;
  while (out.length < HARD_CAP) {
    // Table name is a runtime string — `as never` satisfies the literal-type
    // constraint on `.from()` while the Row generic enforces output shape.
    const qb = build(supabase.from(opts.table as never));
    const { data, error } = await qb.range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

/**
 * Convenience: full-table `select(cols)` with stable ordering.
 * `orderBy` MUST be a column with unique-enough values (typically the PK)
 * so paginated `.range()` calls don't drop or duplicate rows.
 *
 * Callers SHOULD provide an explicit Row type parameter, e.g.:
 *   `fetchAllRows<BookingRow>("bookings", "...", "booking_id")`
 */
export async function fetchAllRows<Row>(
  table: string,
  cols: string,
  orderBy: string,
  opts: { ascending?: boolean; pageSize?: number } = {},
): Promise<Row[]> {
  return fetchAll<Row>(
    (q) => q.select(cols).order(orderBy, { ascending: opts.ascending ?? true }),
    { table, pageSize: opts.pageSize },
  );
}
