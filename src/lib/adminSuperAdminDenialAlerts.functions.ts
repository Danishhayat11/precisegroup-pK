/**
 * Super Admin denial alerts feed.
 *
 * Server-side alert/threshold mechanism: rows in
 * `super_admin_denial_alerts` are written by `evaluateSuperAdminDenialThresholds`
 * (src/lib/superAdmin.functions.ts) whenever repeated `super_admin.*`
 * authorization denials cluster on the same actor or company within a
 * short time window. Super admins can review and resolve them here.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callServerRpc } from "@/integrations/supabase/serverRpc";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type SuperAdminDenialAlertRow = {
  id: string;
  alert_type: "actor" | "company";
  subject_id: string;
  subject_label: string | null;
  subject_display: string | null;
  denial_count: number;
  threshold: number;
  window_minutes: number;
  window_start: string;
  window_end: string;
  sample_rpc_names: string[];
  sample_correlation_ids: string[];
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_by_email: string | null;
  resolution_notes: string | null;
};

export type SuperAdminDenialAlertsResult = {
  rows: SuperAdminDenialAlertRow[];
  unresolved_count: number;
};

async function assertSuperAdmin(
  supabase: SupabaseClient<Database>,
  userId: string,
  fnName: string,
): Promise<void> {
  const { data, error } = await callServerRpc(supabase, "is_super_admin", {
    _user_id: userId,
  });
  if (error) throw error instanceof Error ? error : new Error(String(error));
  if (data !== true) {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("rpc_authorization_denied_log").insert({
        user_id: userId,
        rpc_name: `super_admin_denial_alerts.${fnName}`,
        error_code: "42501",
        error_message: "non-super-admin attempted alert action",
        user_agent: "server-fn",
        page_path: "/admin/super-admin-denial-alerts",
      });
    } catch {
      /* best-effort */
    }
    const err = new Error("Super admin access required");
    (err as { status?: number }).status = 403;
    throw err;
  }
}

const listInput = z.object({
  status: z.enum(["all", "unresolved", "resolved"]).optional(),
  windowDays: z.number().int().min(1).max(90).optional(),
  alertType: z.enum(["actor", "company"]).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const listSuperAdminDenialAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<SuperAdminDenialAlertsResult> => {
    await assertSuperAdmin(context.supabase, context.userId, "list");

    const status = data.status ?? "unresolved";
    const windowDays = data.windowDays ?? 30;
    const limit = data.limit ?? 200;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("super_admin_denial_alerts")
      .select(
        "id, alert_type, subject_id, subject_label, denial_count, threshold, window_minutes, window_start, window_end, sample_rpc_names, sample_correlation_ids, created_at, resolved_at, resolved_by, resolution_notes",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status === "unresolved") q = q.is("resolved_at", null);
    else if (status === "resolved") q = q.not("resolved_at", "is", null);
    if (data.alertType) q = q.eq("alert_type", data.alertType);

    const { data: rowsRaw, error } = await q;
    if (error) throw new Error(error.message);

    const rows = (rowsRaw ?? []) as Array<{
      id: string;
      alert_type: "actor" | "company";
      subject_id: string;
      subject_label: string | null;
      denial_count: number;
      threshold: number;
      window_minutes: number;
      window_start: string;
      window_end: string;
      sample_rpc_names: string[] | null;
      sample_correlation_ids: string[] | null;
      created_at: string;
      resolved_at: string | null;
      resolved_by: string | null;
      resolution_notes: string | null;
    }>;

    // Hydrate subject labels + resolver emails.
    const actorIds = Array.from(
      new Set(rows.filter((r) => r.alert_type === "actor").map((r) => r.subject_id)),
    );
    const companyIds = Array.from(
      new Set(rows.filter((r) => r.alert_type === "company").map((r) => r.subject_id)),
    );
    const resolverIds = Array.from(
      new Set(rows.map((r) => r.resolved_by).filter((v): v is string => !!v)),
    );

    const [{ data: actorProfs }, { data: cos }, { data: resolvers }] = await Promise.all([
      actorIds.length
        ? supabaseAdmin.from("profiles").select("id, email, full_name").in("id", actorIds)
        : Promise.resolve({ data: [] as any[] }),
      companyIds.length
        ? supabaseAdmin.from("companies").select("id, name").in("id", companyIds)
        : Promise.resolve({ data: [] as any[] }),
      resolverIds.length
        ? supabaseAdmin.from("profiles").select("id, email").in("id", resolverIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const actorMap = new Map(((actorProfs ?? []) as any[]).map((p) => [p.id, p]));
    const coMap = new Map(((cos ?? []) as any[]).map((c) => [c.id, c]));
    const resolverMap = new Map(((resolvers ?? []) as any[]).map((p) => [p.id, p]));

    const hydrated: SuperAdminDenialAlertRow[] = rows.map((r) => {
      const display =
        r.alert_type === "actor"
          ? (actorMap.get(r.subject_id)?.email ??
            actorMap.get(r.subject_id)?.full_name ??
            r.subject_label ??
            null)
          : (coMap.get(r.subject_id)?.name ?? r.subject_label ?? null);
      return {
        id: r.id,
        alert_type: r.alert_type,
        subject_id: r.subject_id,
        subject_label: r.subject_label,
        subject_display: display,
        denial_count: r.denial_count,
        threshold: r.threshold,
        window_minutes: r.window_minutes,
        window_start: r.window_start,
        window_end: r.window_end,
        sample_rpc_names: r.sample_rpc_names ?? [],
        sample_correlation_ids: r.sample_correlation_ids ?? [],
        created_at: r.created_at,
        resolved_at: r.resolved_at,
        resolved_by: r.resolved_by,
        resolved_by_email: r.resolved_by ? (resolverMap.get(r.resolved_by)?.email ?? null) : null,
        resolution_notes: r.resolution_notes,
      };
    });

    // Unresolved count (across the same window) for the badge.
    const { count: unresolvedCount } = await supabaseAdmin
      .from("super_admin_denial_alerts")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null)
      .gte("created_at", since);

    return {
      rows: hydrated,
      unresolved_count: unresolvedCount ?? 0,
    };
  });

const resolveInput = z.object({
  alert_id: z.string().uuid(),
  notes: z.string().trim().max(1000).optional(),
});

export const resolveSuperAdminDenialAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => resolveInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase, context.userId, "resolve");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("super_admin_denial_alerts")
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by: context.userId,
        resolution_notes: data.notes ?? null,
      })
      .eq("id", data.alert_id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
