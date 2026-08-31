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
 */
export async function fetchAll<Row>(
  build: (qb: ReturnType<typeof supabase.from>) => any,
  opts: { table: string; pageSize?: number } & Record<string, unknown>,
): Promise<Row[]> {
  const pageSize = Math.max(1, Math.min(1000, Number(opts.pageSize ?? 1000)));
  const out: Row[] = [];
  let from = 0;
  // Safety stop — refuse to loop forever on a runaway query.
  const HARD_CAP = 200_000;
  while (out.length < HARD_CAP) {
    const qb = build(supabase.from(opts.table as any));
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
 */
export async function fetchAllRows<Row = any>(
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
