/**
 * Tenant-scoping helpers. Every client-side query, insert, update, delete,
 * and realtime subscription in the ERP flows through these so `company_id`
 * is applied consistently. RLS still enforces isolation server-side — this
 * is defense-in-depth plus a fail-fast for missing companyId.
 */

export type CompanyId = string;

export function assertCompanyId(
  companyId: CompanyId | null | undefined,
): asserts companyId is CompanyId {
  if (!companyId) {
    throw new Error(
      "[companyScope] Missing companyId. A query fired before auth resolved or the user has no company assigned.",
    );
  }
}

/** Spread `company_id` into an insert payload (single row or array). */
export function withCompany<T extends object>(
  row: T,
  companyId: CompanyId,
): T & { company_id: CompanyId };
export function withCompany<T extends object>(
  rows: T[],
  companyId: CompanyId,
): (T & { company_id: CompanyId })[];
export function withCompany<T extends object>(
  rowOrRows: T | T[],
  companyId: CompanyId,
): (T & { company_id: CompanyId }) | (T & { company_id: CompanyId })[] {
  assertCompanyId(companyId);
  if (Array.isArray(rowOrRows)) {
    return rowOrRows.map((r) => ({ ...r, company_id: companyId }));
  }
  return { ...rowOrRows, company_id: companyId };
}

/** Realtime channel name scoped by tenant (prevents cross-tenant subscriber collisions). */
export function companyChannelName(base: string, companyId: CompanyId): string {
  assertCompanyId(companyId);
  return `${base}:c:${companyId}`;
}

/** Realtime filter string for `postgres_changes` — `company_id=eq.<uuid>`. */
export function companyFilter(companyId: CompanyId): string {
  assertCompanyId(companyId);
  return `company_id=eq.${companyId}`;
}
