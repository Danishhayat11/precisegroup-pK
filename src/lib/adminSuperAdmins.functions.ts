/**
 * List Super Admins for the Admin Controls hub.
 *
 * STRICT AUTHORIZATION: only true super admins may call this endpoint.
 * The check is enforced server-side via the SECURITY DEFINER function
 * `public.is_super_admin(auth.uid())` — client-side role state cannot
 * grant access, and non-super owners/admins are rejected with 42501.
 *
 * The response is deliberately limited to `user_id` + `email` — nothing
 * that could be used to compromise an account (no phone, no auth
 * metadata, and passwords are stored as one-way hashes in `auth.users`
 * and are never accessible to any client, admin or super-admin included).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callServerRpc } from "@/integrations/supabase/serverRpc";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type SuperAdminIdentity = {
  user_id: string;
  email: string | null;
};

/**
 * Server-side super-admin gate. Uses the SECURITY DEFINER RPC as the single
 * source of truth so RLS visibility on `user_roles` cannot influence the
 * decision. Denials are recorded to `rpc_authorization_denied_log` so
 * repeated probes are visible to the super-admin audit surface.
 */
async function assertSuperAdmin(supabase: SupabaseClient<Database>, userId: string): Promise<void> {
  const { data, error } = await callServerRpc(supabase, "is_super_admin", {
    _user_id: userId,
  });
  if (error) {
    // `callServerRpc` already normalizes revoked-EXECUTE into
    // RpcAuthorizationError and audit-logs it. Re-throw as-is.
    throw error instanceof Error ? error : new Error(String(error));
  }
  if (data !== true) {
    await logSuperAdminDenial(userId).catch(() => {});
    const err = new Error("Super admin access required");
    (err as { status?: number }).status = 403;
    throw err;
  }
}

async function logSuperAdminDenial(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("rpc_authorization_denied_log").insert({
    rpc_name: "listSuperAdminsForAdmin",
    error_code: "42501",
    error_message: "non-super-admin attempted to list super admins",
    user_agent: "server-fn",
    page_path: "/admin/super-admins",
    user_id: userId,
  });
}

export const listSuperAdminsForAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SuperAdminIdentity[]> => {
    await assertSuperAdmin(context.supabase, context.userId);

    // Cross-tenant read of `role = 'super_admin'` requires bypassing RLS
    // (super admins may live in other tenants). Loaded only after the
    // strict authorization check succeeds.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roleRows, error: rErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "super_admin");
    if (rErr) throw new Error(rErr.message);

    const userIds = Array.from(
      new Set(((roleRows ?? []) as { user_id: string }[]).map((r) => r.user_id)),
    );
    if (userIds.length === 0) return [];

    const { data: profs, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, email")
      .in("id", userIds);
    if (pErr) throw new Error(pErr.message);

    const emailById = new Map(
      ((profs ?? []) as { id: string; email: string | null }[]).map((p) => [p.id, p.email]),
    );
    return userIds
      .map((id) => ({ user_id: id, email: emailById.get(id) ?? null }))
      .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
  });
