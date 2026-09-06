/**
 * Aggregated metrics for revoked-RPC denials.
 *
 * STRICT AUTHORIZATION: super_admin only. Uses `is_super_admin(auth.uid())`
 * (SECURITY DEFINER) as the single source of truth, matching the pattern in
 * `listSuperAdminsForAdmin`. Denied attempts are logged to
 * `rpc_authorization_denied_log`.
 *
 * Returns counts grouped by (rpc_name, error_code) within a rolling window
 * so admins can spot which permissions are failing most and drill into
 * root cause.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callServerRpc } from "@/integrations/supabase/serverRpc";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type RpcDenialBucket = {
  rpc_name: string;
  error_code: string | null;
  count: number;
  distinct_users: number;
  last_occurred_at: string;
};

export type RpcDenialMetrics = {
  window_days: number;
  total: number;
  since: string;
  by_rpc_and_code: RpcDenialBucket[];
  by_rpc: { rpc_name: string; count: number }[];
  by_error_code: { error_code: string | null; count: number }[];
};

async function assertSuperAdmin(supabase: SupabaseClient<Database>, userId: string): Promise<void> {
  const { data, error } = await callServerRpc(supabase, "is_super_admin", {
    _user_id: userId,
  });
  if (error) throw error instanceof Error ? error : new Error(String(error));
  if (data !== true) {
    await logDenial(userId).catch(() => {});
    const err = new Error("Super admin access required");
    (err as { status?: number }).status = 403;
    throw err;
  }
}

async function logDenial(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("rpc_authorization_denied_log").insert({
    rpc_name: "getRpcDenialMetricsForAdmin",
    error_code: "42501",
    error_message: "non-super-admin attempted to read RPC denial metrics",
    user_agent: "server-fn",
    page_path: "/admin/rpc-denials",
    user_id: userId,
  });
}

export const getRpcDenialMetricsForAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { windowDays?: number } | undefined) => {
    const raw = input?.windowDays ?? 7;
    const n = Math.floor(Number(raw));
    const windowDays = Number.isFinite(n) ? Math.max(1, Math.min(90, n)) : 7;
    return { windowDays };
  })
  .handler(async ({ data, context }): Promise<RpcDenialMetrics> => {
    await assertSuperAdmin(context.supabase, context.userId);

    const since = new Date(Date.now() - data.windowDays * 24 * 60 * 60 * 1000);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Page through rows; RLS bypassed to see cross-tenant probes.
    const PAGE = 1000;
    const rows: {
      rpc_name: string;
      error_code: string | null;
      user_id: string;
      occurred_at: string;
    }[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data: page, error } = await supabaseAdmin
        .from("rpc_authorization_denied_log")
        .select("rpc_name, error_code, user_id, occurred_at")
        .gte("occurred_at", since.toISOString())
        .order("occurred_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!page || page.length === 0) break;
      rows.push(...(page as typeof rows));
      if (page.length < PAGE) break;
      // Safety cap so a runaway log doesn't blow memory.
      if (rows.length >= 50_000) break;
    }

    const bucketMap = new Map<
      string,
      {
        rpc_name: string;
        error_code: string | null;
        count: number;
        users: Set<string>;
        last: string;
      }
    >();
    const byRpc = new Map<string, number>();
    const byCode = new Map<string | null, number>();

    for (const r of rows) {
      const key = `${r.rpc_name}\u0000${r.error_code ?? ""}`;
      const b = bucketMap.get(key);
      if (b) {
        b.count += 1;
        b.users.add(r.user_id);
        if (r.occurred_at > b.last) b.last = r.occurred_at;
      } else {
        bucketMap.set(key, {
          rpc_name: r.rpc_name,
          error_code: r.error_code,
          count: 1,
          users: new Set([r.user_id]),
          last: r.occurred_at,
        });
      }
      byRpc.set(r.rpc_name, (byRpc.get(r.rpc_name) ?? 0) + 1);
      byCode.set(r.error_code, (byCode.get(r.error_code) ?? 0) + 1);
    }

    const by_rpc_and_code: RpcDenialBucket[] = [...bucketMap.values()]
      .map((b) => ({
        rpc_name: b.rpc_name,
        error_code: b.error_code,
        count: b.count,
        distinct_users: b.users.size,
        last_occurred_at: b.last,
      }))
      .sort((a, b) => b.count - a.count || a.rpc_name.localeCompare(b.rpc_name));

    const by_rpc = [...byRpc.entries()]
      .map(([rpc_name, count]) => ({ rpc_name, count }))
      .sort((a, b) => b.count - a.count);

    const by_error_code = [...byCode.entries()]
      .map(([error_code, count]) => ({ error_code, count }))
      .sort((a, b) => b.count - a.count);

    return {
      window_days: data.windowDays,
      total: rows.length,
      since: since.toISOString(),
      by_rpc_and_code,
      by_rpc,
      by_error_code,
    };
  });
