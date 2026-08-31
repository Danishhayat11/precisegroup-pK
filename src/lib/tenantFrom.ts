/**
 * Tenant-scoped Supabase query helper — defence-in-depth wrapper that
 * guarantees every read/write against a tenant table is filtered by
 * company_id (RLS is the primary defence; this stops accidental
 * cross-tenant queries from ever reaching the network).
 *
 * Usage:
 *
 *   import { useTenantFrom } from "@/lib/tenantFrom";
 *   const from = useTenantFrom();
 *   const { data } = await from("bookings").select("*").order("booking_date");
 *
 * `from(table)` returns the normal Supabase query builder pre-filtered by
 * `company_id`. Inserts and upserts get `company_id` injected automatically.
 * If the caller has no company yet (still bootstrapping), the query throws
 * synchronously so the bug surfaces immediately instead of silently reading
 * another tenant's data.
 *
 * The `scripts/audit-tenant-scope.mjs` audit treats any call chain
 * containing `company_id` as compliant, so files migrated to this helper
 * automatically clear their baseline entries.
 */
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { Database } from "@/integrations/supabase/types";

type TenantTable = keyof Database["public"]["Tables"];

export function tenantFrom(companyId: string | null | undefined) {
  if (!companyId) {
    throw new Error("tenantFrom(): no company_id in session — refusing cross-tenant query.");
  }
  return <T extends TenantTable>(table: T) => {
    // Cast to any: builder types are stricter than we need — this helper's
    // contract is enforced at runtime and by the audit script.
    const builder = (supabase.from as unknown as (t: string) => any)(table as string);
    return {
      select: (cols = "*", opts?: unknown) =>
        builder.select(cols, opts).eq("company_id", companyId),
      insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        const stamped = Array.isArray(rows)
          ? rows.map((r) => ({ ...r, company_id: companyId }))
          : { ...rows, company_id: companyId };
        return builder.insert(stamped);
      },
      upsert: (rows: Record<string, unknown> | Record<string, unknown>[], opts?: unknown) => {
        const stamped = Array.isArray(rows)
          ? rows.map((r) => ({ ...r, company_id: companyId }))
          : { ...rows, company_id: companyId };
        return builder.upsert(stamped, opts);
      },
      update: (patch: Record<string, unknown>) => builder.update(patch).eq("company_id", companyId),
      delete: (opts?: unknown) => builder.delete(opts).eq("company_id", companyId),
    };
  };
}

/** React hook that binds `tenantFrom` to the current session's company. */
export function useTenantFrom() {
  const { companyId } = useAuth();
  return useMemo(() => tenantFrom(companyId), [companyId]);
}
