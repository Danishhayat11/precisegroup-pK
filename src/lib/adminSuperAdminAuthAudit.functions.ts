/**
 * Super Admin authorization audit feed.
 *
 * Lists recent `rpc_authorization_denied_log` rows tagged with
 * `rpc_name LIKE 'super_admin.%'` (written by
 * `logSuperAdminAuthFailure` in src/lib/superAdmin.functions.ts) so
 * super admins can trace which function and tenant produced a 401/403.
 *
 * STRICT AUTHORIZATION: super_admin only. Uses `is_super_admin(auth.uid())`
 * (SECURITY DEFINER) as the single source of truth. Denials attempting to
 * read this feed are themselves logged.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callServerRpc } from "@/integrations/supabase/serverRpc";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type SuperAdminAuthAuditRow = {
  id: string;
  occurred_at: string;
  rpc_name: string;
  fn_name: string;
  user_id: string;
  actor_email: string | null;
  company_id: string | null;
  error_code: string | null;
  error_message: string | null;
  user_agent: string | null;
  page_path: string | null;
};

export type SuperAdminAuthAuditResult = {
  since: string;
  window_days: number;
  total: number;
  truncated: boolean;
  rows: SuperAdminAuthAuditRow[];
  distinct_fn_names: string[];
};

const inputSchema = z.object({
  windowDays: z.number().int().min(1).max(90).optional(),
  fnName: z.string().trim().max(120).optional(),
  companyId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  actorEmail: z.string().trim().max(320).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

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
    user_id: userId,
    rpc_name: "getSuperAdminAuthAuditLog",
    error_code: "42501",
    error_message: "non-super-admin attempted to read super-admin audit log",
    user_agent: "server-fn",
    page_path: "/admin/super-admin-auth-audit",
  });
}

export const getSuperAdminAuthAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => inputSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<SuperAdminAuthAuditResult> => {
    await assertSuperAdmin(context.supabase, context.userId);

    const windowDays = data.windowDays ?? 7;
    const limit = data.limit ?? 250;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    // Cross-tenant probe visibility requires the service role. Reached
    // only after the strict super-admin gate above.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // If filtering by email, resolve to a set of user_ids first.
    let actorIdsFromEmail: string[] | null = null;
    if (data.actorEmail && data.actorEmail.length > 0) {
      const { data: profs, error: pErr } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .ilike("email", `%${data.actorEmail}%`)
        .limit(500);
      if (pErr) throw new Error(pErr.message);
      actorIdsFromEmail = ((profs ?? []) as { id: string }[]).map((p) => p.id);
      if (actorIdsFromEmail.length === 0) {
        return {
          since: since.toISOString(),
          window_days: windowDays,
          total: 0,
          truncated: false,
          rows: [],
          distinct_fn_names: [],
        };
      }
    }

    let q = supabaseAdmin
      .from("rpc_authorization_denied_log")
      .select(
        "id, occurred_at, rpc_name, user_id, company_id, error_code, error_message, user_agent, page_path",
      )
      .like("rpc_name", "super_admin.%")
      .gte("occurred_at", since.toISOString())
      .order("occurred_at", { ascending: false })
      .limit(limit + 1);

    if (data.fnName && data.fnName.length > 0) {
      q = q.eq("rpc_name", `super_admin.${data.fnName}`);
    }
    if (data.companyId) q = q.eq("company_id", data.companyId);
    if (data.actorId) q = q.eq("user_id", data.actorId);
    if (actorIdsFromEmail) q = q.in("user_id", actorIdsFromEmail);

    const { data: rowsRaw, error } = await q;
    if (error) throw new Error(error.message);

    const rows = (rowsRaw ?? []) as {
      id: string;
      occurred_at: string;
      rpc_name: string;
      user_id: string;
      company_id: string | null;
      error_code: string | null;
      error_message: string | null;
      user_agent: string | null;
      page_path: string | null;
    }[];

    const truncated = rows.length > limit;
    const page = truncated ? rows.slice(0, limit) : rows;

    // Batch-hydrate emails for the visible page.
    const uniqUserIds = Array.from(new Set(page.map((r) => r.user_id)));
    const emailById = new Map<string, string | null>();
    if (uniqUserIds.length > 0) {
      const { data: profs, error: pErr } = await supabaseAdmin
        .from("profiles")
        .select("id, email")
        .in("id", uniqUserIds);
      if (pErr) throw new Error(pErr.message);
      for (const p of (profs ?? []) as { id: string; email: string | null }[]) {
        emailById.set(p.id, p.email);
      }
    }

    // Distinct fn_names present across the FULL window (ignoring the fnName
    // filter) so the UI can populate a stable dropdown even when the current
    // filter narrows results to one row.
    const { data: distinctRaw, error: dErr } = await supabaseAdmin
      .from("rpc_authorization_denied_log")
      .select("rpc_name")
      .like("rpc_name", "super_admin.%")
      .gte("occurred_at", since.toISOString())
      .limit(5000);
    if (dErr) throw new Error(dErr.message);
    const distinctFnNames = Array.from(
      new Set(
        ((distinctRaw ?? []) as { rpc_name: string }[]).map((r) =>
          r.rpc_name.startsWith("super_admin.")
            ? r.rpc_name.slice("super_admin.".length)
            : r.rpc_name,
        ),
      ),
    ).sort((a, b) => a.localeCompare(b));

    const hydrated: SuperAdminAuthAuditRow[] = page.map((r) => ({
      id: r.id,
      occurred_at: r.occurred_at,
      rpc_name: r.rpc_name,
      fn_name: r.rpc_name.startsWith("super_admin.")
        ? r.rpc_name.slice("super_admin.".length)
        : r.rpc_name,
      user_id: r.user_id,
      actor_email: emailById.get(r.user_id) ?? null,
      company_id: r.company_id,
      error_code: r.error_code,
      error_message: r.error_message,
      user_agent: r.user_agent,
      page_path: r.page_path,
    }));

    return {
      since: since.toISOString(),
      window_days: windowDays,
      total: hydrated.length,
      truncated,
      rows: hydrated,
      distinct_fn_names: distinctFnNames,
    };
  });
