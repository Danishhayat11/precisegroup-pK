import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callRpc } from "@/integrations/supabase/approvedRpc";

export type TenantScopeLogRow = {
  id: number;
  occurred_at: string;
  user_id: string | null;
  company_id: string | null;
  fn_path: string | null;
  status: "ok" | "err";
  duration_ms: number | null;
};

export type TenantScopeLogsQuery = {
  companyId?: string | null;
  fromIso?: string | null;
  toIso?: string | null;
  status?: "ok" | "err" | null;
  limit?: number;
};

export const listTenantScopeLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: TenantScopeLogsQuery) => input ?? {})
  .handler(async ({ data, context }): Promise<TenantScopeLogRow[]> => {
    const { supabase, userId } = context;

    const { data: isAdmin, error: roleErr } = await callRpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const limit = Math.min(Math.max(data.limit ?? 200, 1), 1000);

    let q = supabase
      .from("tenant_scope_logs")
      .select("id, occurred_at, user_id, company_id, fn_path, status, duration_ms")
      .order("occurred_at", { ascending: false })
      .limit(limit);

    if (data.companyId) q = q.eq("company_id", data.companyId);
    if (data.status) q = q.eq("status", data.status);
    if (data.fromIso) q = q.gte("occurred_at", data.fromIso);
    if (data.toIso) q = q.lte("occurred_at", data.toIso);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as TenantScopeLogRow[];
  });

export const listTenantScopeCompanies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ id: string; name: string | null }[]> => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await callRpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const { data, error } = await supabase.from("companies").select("id, name").order("name");
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; name: string | null }[];
  });
