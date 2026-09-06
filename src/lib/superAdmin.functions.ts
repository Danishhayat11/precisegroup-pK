import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText, Output, NoObjectGeneratedError } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callServerRpc } from "@/integrations/supabase/serverRpc";
import { newCorrelationId } from "@/integrations/supabase/correlationId";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Guard: throw unless the caller is a super_admin.
 *
 * MUST use `callServerRpc(context.supabase, …)` — the user-scoped server
 * client from `requireSupabaseAuth`. The browser `callRpc` uses a
 * module-scope Supabase client with no auth session, which returns 401/403
 * on the server and is then normalized into a misleading
 * `RpcAuthorizationError("is_super_admin")` even for real super admins.
 *
 * Returns the correlation id used for this authorization check so the
 * caller can thread it through downstream RPCs / logs in the same request.
 */
async function assertSuperAdmin(
  supabase: SupabaseClient<Database>,
  userId: string,
  fnName: string,
): Promise<string> {
  const correlationId = newCorrelationId();
  const { data, error } = await callServerRpc(
    supabase,
    "is_super_admin",
    { _user_id: userId },
    { correlationId },
  );
  if (error) {
    await logSuperAdminAuthFailure({
      actorId: userId,
      fnName,
      reason: "rpc_error",
      errorCode: (error as { code?: string })?.code ?? null,
      errorMessage: error instanceof Error ? error.message : String(error),
      correlationId,
    });
    throw error instanceof Error ? error : new Error(String(error));
  }
  if (data !== true) {
    await logSuperAdminAuthFailure({
      actorId: userId,
      fnName,
      reason: "not_super_admin",
      errorCode: "NOT_SUPER_ADMIN",
      errorMessage: "is_super_admin() returned false for caller",
      correlationId,
    });
    throw new Error(`Super Admin access required [ref: ${correlationId}]`);
  }
  return correlationId;
}

/**
 * Best-effort server-side trail for Super Admin authorization failures.
 * Writes to `rpc_authorization_denied_log` via service role (so the row lands
 * even when the caller lacks RLS insert privileges) AND emits a structured
 * console.error line that surfaces in server-function logs. Never throws.
 */
async function logSuperAdminAuthFailure(params: {
  actorId: string;
  fnName: string;
  reason: "rpc_error" | "not_super_admin";
  errorCode: string | null;
  errorMessage: string | null;
  correlationId: string;
}) {
  const { actorId, fnName, reason, errorCode, errorMessage, correlationId } = params;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let companyId: string | null = null;
    let actorEmail: string | null = null;
    try {
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("email, company_id")
        .eq("id", actorId)
        .maybeSingle();
      actorEmail = (data as { email?: string | null } | null)?.email ?? null;
      companyId = (data as { company_id?: string | null } | null)?.company_id ?? null;
    } catch {
      // best-effort — proceed with nulls
    }
    // Structured server log for quick tracing in stack_modern--server-function-logs.
    console.error("[superadmin auth failure]", {
      fn: fnName,
      reason,
      actor_id: actorId,
      actor_email: actorEmail,
      company_id: companyId,
      error_code: errorCode,
      error_message: errorMessage,
      correlation_id: correlationId,
      at: new Date().toISOString(),
    });
    await supabaseAdmin.from("rpc_authorization_denied_log").insert({
      user_id: actorId,
      company_id: companyId,
      rpc_name: `super_admin.${fnName}`,
      error_code: errorCode,
      error_message: errorMessage,
      user_agent: "server-fn",
      page_path: null,
      correlation_id: correlationId,
    });
    // Best-effort threshold check — fires alerts when a burst of denials
    // cluster on the same actor or company inside the alert window.
    await evaluateSuperAdminDenialThresholds({
      actorId,
      companyId,
      actorEmail,
      correlationId,
    });
  } catch (e) {
    console.error("[superadmin auth failure] log write failed", e);
  }
}

/* ────────────── Repeated-denial alert / threshold mechanism ────────────── */

/**
 * Alert thresholds. Alerts for the same subject won't re-fire until the
 * cooldown expires — keeps the signal high without spamming operators.
 */
const DENIAL_ALERT_WINDOW_MINUTES = 10;
const DENIAL_ALERT_ACTOR_THRESHOLD = 5;
const DENIAL_ALERT_COMPANY_THRESHOLD = 10;
const DENIAL_ALERT_COOLDOWN_MINUTES = 30;

type DenialSample = {
  rpc_name: string | null;
  correlation_id: string | null;
  occurred_at: string;
};

async function evaluateSuperAdminDenialThresholds(params: {
  actorId: string;
  companyId: string | null;
  actorEmail: string | null;
  correlationId: string;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const windowStart = new Date(Date.now() - DENIAL_ALERT_WINDOW_MINUTES * 60_000).toISOString();

    await maybeEmitAlert(supabaseAdmin, {
      alertType: "actor",
      subjectId: params.actorId,
      subjectLabel: params.actorEmail,
      threshold: DENIAL_ALERT_ACTOR_THRESHOLD,
      windowStart,
      filterColumn: "user_id",
    });

    if (params.companyId) {
      await maybeEmitAlert(supabaseAdmin, {
        alertType: "company",
        subjectId: params.companyId,
        subjectLabel: null,
        threshold: DENIAL_ALERT_COMPANY_THRESHOLD,
        windowStart,
        filterColumn: "company_id",
      });
    }
  } catch (e) {
    console.error("[superadmin denial threshold] evaluation failed", e);
  }
}

async function maybeEmitAlert(
  supabaseAdmin: SupabaseClient<Database>,
  opts: {
    alertType: "actor" | "company";
    subjectId: string;
    subjectLabel: string | null;
    threshold: number;
    windowStart: string;
    filterColumn: "user_id" | "company_id";
  },
) {
  const { data: rows, error } = await supabaseAdmin
    .from("rpc_authorization_denied_log")
    .select("rpc_name, correlation_id, occurred_at")
    .eq(opts.filterColumn, opts.subjectId)
    .like("rpc_name", "super_admin.%")
    .gte("occurred_at", opts.windowStart)
    .order("occurred_at", { ascending: false })
    .limit(200);
  if (error || !rows || rows.length < opts.threshold) return;

  const samples = rows as DenialSample[];
  const cooldownStart = new Date(Date.now() - DENIAL_ALERT_COOLDOWN_MINUTES * 60_000).toISOString();

  const { data: recent } = await supabaseAdmin
    .from("super_admin_denial_alerts")
    .select("id")
    .eq("alert_type", opts.alertType)
    .eq("subject_id", opts.subjectId)
    .gte("created_at", cooldownStart)
    .limit(1);
  if (recent && recent.length > 0) return; // cooldown active

  const rpcNames = Array.from(
    new Set(samples.map((s) => s.rpc_name).filter((v): v is string => !!v)),
  ).slice(0, 10);
  const correlationIds = Array.from(
    new Set(samples.map((s) => s.correlation_id).filter((v): v is string => !!v)),
  ).slice(0, 10);
  const windowEnd = samples[0]?.occurred_at ?? new Date().toISOString();

  const { error: insErr } = await supabaseAdmin.from("super_admin_denial_alerts").insert({
    alert_type: opts.alertType,
    subject_id: opts.subjectId,
    subject_label: opts.subjectLabel,
    denial_count: samples.length,
    threshold: opts.threshold,
    window_minutes: DENIAL_ALERT_WINDOW_MINUTES,
    window_start: opts.windowStart,
    window_end: windowEnd,
    sample_rpc_names: rpcNames,
    sample_correlation_ids: correlationIds,
  });
  if (insErr) {
    console.error("[superadmin denial threshold] alert insert failed", insErr);
    return;
  }

  console.error("[superadmin denial threshold] ALERT", {
    alert_type: opts.alertType,
    subject_id: opts.subjectId,
    subject_label: opts.subjectLabel,
    denial_count: samples.length,
    threshold: opts.threshold,
    window_minutes: DENIAL_ALERT_WINDOW_MINUTES,
    sample_rpc_names: rpcNames,
    at: new Date().toISOString(),
  });
}

/** Insert an audit-log row via service role. Never throws — logging must not block the action. */
async function logSuperAdminAction(params: {
  actorId: string;
  action:
    | "company.approve"
    | "company.reject"
    | "company.activate"
    | "company.deactivate"
    | "company.change_plan"
    | "company.impersonate"
    | "super_admin.grant"
    | "super_admin.revoke";
  companyId?: string | null;
  targetUserId?: string | null;
  details?: Record<string, unknown>;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: actorProf }, { data: co }, { data: targetProf }] = await Promise.all([
      supabaseAdmin.from("profiles").select("email").eq("id", params.actorId).maybeSingle(),
      params.companyId
        ? supabaseAdmin.from("companies").select("name").eq("id", params.companyId).maybeSingle()
        : Promise.resolve({ data: null as any }),
      params.targetUserId
        ? supabaseAdmin.from("profiles").select("email").eq("id", params.targetUserId).maybeSingle()
        : Promise.resolve({ data: null as any }),
    ]);
    await supabaseAdmin.from("super_admin_audit_log").insert({
      actor_id: params.actorId,
      actor_email: (actorProf as any)?.email ?? null,
      action: params.action,
      company_id: params.companyId ?? null,
      company_name: (co as any)?.name ?? null,
      target_user_id: params.targetUserId ?? null,
      target_user_email: (targetProf as any)?.email ?? null,
      details: (params.details ?? {}) as any,
    });
  } catch (e) {
    console.error("[superadmin audit] failed to log", e);
  }
}

export type CompanyRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  plan: string;
  is_active: boolean;
  approval_status: "pending" | "approved" | "rejected";
  approved_at: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
  onboarding_completed_at: string | null;
  created_at: string;
  user_count: number;
  booking_count: number;
};

/** List every company across every tenant. Super-admin only. */
export const superAdminListCompanies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.supabase, context.userId, "superAdminListCompanies");
    // Super-admin RLS policy grants cross-tenant SELECT on companies.
    const { data: companies, error } = await context.supabase
      .from("companies")
      .select(
        "id,name,email,phone,city,plan,is_active,approval_status,approved_at,approved_by,rejection_reason,onboarding_completed_at,created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    // Counts per company — cheap aggregate via service role.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ids = (companies ?? []).map((c: any) => c.id);
    const [{ data: userRows }, { data: bookingRows }] = await Promise.all([
      supabaseAdmin.from("user_roles").select("company_id").in("company_id", ids),
      supabaseAdmin.from("bookings").select("company_id").in("company_id", ids),
    ]);
    const userCount = new Map<string, number>();
    (userRows ?? []).forEach((r: any) =>
      userCount.set(r.company_id, (userCount.get(r.company_id) ?? 0) + 1),
    );
    const bookingCount = new Map<string, number>();
    (bookingRows ?? []).forEach((r: any) =>
      bookingCount.set(r.company_id, (bookingCount.get(r.company_id) ?? 0) + 1),
    );

    return (companies ?? []).map(
      (c: any): CompanyRow => ({
        ...c,
        user_count: userCount.get(c.id) ?? 0,
        booking_count: bookingCount.get(c.id) ?? 0,
      }),
    );
  });

/** Cheap count of tenants awaiting approval. Super-admin only. */
export const superAdminPendingCount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.supabase, context.userId, "superAdminPendingCount");
    const { count, error } = await context.supabase
      .from("companies")
      .select("id", { count: "exact", head: true })
      .eq("approval_status", "pending");
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
  });

const approveSchema = z.object({ company_id: z.string().uuid() });

export const superAdminApproveCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => approveSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase, context.userId, "superAdminApproveCompany");
    const { error } = await context.supabase
      .from("companies")
      .update({
        approval_status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: context.userId,
        rejection_reason: null,
        is_active: true,
      })
      .eq("id", data.company_id);
    if (error) throw new Error(error.message);
    await logSuperAdminAction({
      actorId: context.userId,
      action: "company.approve",
      companyId: data.company_id,
    });
    return { ok: true as const };
  });

const rejectSchema = z.object({
  company_id: z.string().uuid(),
  reason: z.string().trim().min(3, "Please describe why").max(500),
});

export const superAdminRejectCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => rejectSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase, context.userId, "superAdminRejectCompany");
    const { error } = await context.supabase
      .from("companies")
      .update({
        approval_status: "rejected",
        rejection_reason: data.reason,
        is_active: false,
        approved_at: null,
        approved_by: null,
      })
      .eq("id", data.company_id);
    if (error) throw new Error(error.message);
    await logSuperAdminAction({
      actorId: context.userId,
      action: "company.reject",
      companyId: data.company_id,
      details: { reason: data.reason },
    });
    return { ok: true as const };
  });

const setActiveSchema = z.object({
  company_id: z.string().uuid(),
  active: z.boolean(),
});

export const superAdminSetCompanyActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => setActiveSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase, context.userId, "superAdminSetCompanyActive");
    const { error } = await context.supabase
      .from("companies")
      .update({ is_active: data.active })
      .eq("id", data.company_id);
    if (error) throw new Error(error.message);
    await logSuperAdminAction({
      actorId: context.userId,
      action: data.active ? "company.activate" : "company.deactivate",
      companyId: data.company_id,
    });
    return { ok: true as const };
  });

const planSchema = z.object({
  company_id: z.string().uuid(),
  plan: z.enum(["starter", "professional", "builder"]),
});

export const superAdminChangePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => planSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase, context.userId, "superAdminChangePlan");
    const { error } = await context.supabase
      .from("companies")
      .update({ plan: data.plan })
      .eq("id", data.company_id);
    if (error) throw new Error(error.message);
    await logSuperAdminAction({
      actorId: context.userId,
      action: "company.change_plan",
      companyId: data.company_id,
      details: { plan: data.plan },
    });
    return { ok: true as const };
  });

const grantSaSchema = z.object({ email: z.string().email() });

export const superAdminGrantSuperAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => grantSaSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase, context.userId, "superAdminGrantSuperAdmin");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, company_id")
      .eq("email", data.email)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!prof) throw new Error(`No user found with email ${data.email}`);
    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: (prof as any).id, role: "super_admin", company_id: (prof as any).company_id },
        { onConflict: "user_id,role" },
      );
    if (error) throw new Error(error.message);
    await logSuperAdminAction({
      actorId: context.userId,
      action: "super_admin.grant",
      companyId: (prof as any).company_id ?? null,
      targetUserId: (prof as any).id,
      details: { email: data.email },
    });
    return { ok: true as const };
  });

const revokeSaSchema = z.object({ user_id: z.string().uuid() });

export const superAdminRevokeSuperAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => revokeSaSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase, context.userId, "superAdminRevokeSuperAdmin");
    if (data.user_id === context.userId) {
      throw new Error("You cannot revoke your own Super Admin role.");
    }
    const { error } = await context.supabase
      .from("user_roles")
      .delete()
      .eq("user_id", data.user_id)
      .eq("role", "super_admin");
    if (error) throw new Error(error.message);
    await logSuperAdminAction({
      actorId: context.userId,
      action: "super_admin.revoke",
      targetUserId: data.user_id,
    });
    return { ok: true as const };
  });

/* ─────────────────────────── Tenant Impersonation ─────────────────────────── */

const impersonateSchema = z.object({
  company_id: z.string().uuid(),
  redirect_to: z.string().url(),
});

/**
 * Generate a one-time magic-link that signs the caller in as a member of the
 * target tenant so a Super Admin can verify that tenant's dashboard.
 * Prefers owner → admin → any member. Every use is written to
 * super_admin_audit_log.
 */
export const superAdminImpersonateCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => impersonateSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase, context.userId, "superAdminImpersonateCompany");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Confirm the company exists and grab its name for auditing.
    const { data: company, error: coErr } = await supabaseAdmin
      .from("companies")
      .select("id, name")
      .eq("id", data.company_id)
      .maybeSingle();
    if (coErr) throw new Error(coErr.message);
    if (!company) throw new Error("Company not found");

    // Pick the best available member: owner > admin > manager > staff > viewer.
    const { data: members, error: mErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .eq("company_id", data.company_id);
    if (mErr) throw new Error(mErr.message);
    if (!members || members.length === 0) {
      throw new Error("This tenant has no members to impersonate.");
    }

    const rank: Record<string, number> = {
      owner: 0,
      admin: 1,
      manager: 2,
      staff: 3,
      viewer: 4,
    };
    const target = [...members].sort(
      (a: any, b: any) => (rank[a.role] ?? 99) - (rank[b.role] ?? 99),
    )[0] as { user_id: string; role: string };

    const { data: targetProfile, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, email, full_name")
      .eq("id", target.user_id)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!targetProfile?.email) {
      throw new Error("Target member has no email on file.");
    }

    // Generate a magiclink action_link the Super Admin can open.
    const { data: link, error: lErr } = await (supabaseAdmin.auth.admin as any).generateLink({
      type: "magiclink",
      email: (targetProfile as any).email,
      options: { redirectTo: data.redirect_to },
    });
    if (lErr) throw new Error(lErr.message);
    const actionLink: string | undefined =
      (link as any)?.properties?.action_link ?? (link as any)?.action_link;
    if (!actionLink) throw new Error("Failed to generate impersonation link.");

    await logSuperAdminAction({
      actorId: context.userId,
      action: "company.impersonate",
      companyId: data.company_id,
      targetUserId: (targetProfile as any).id,
      details: {
        target_email: (targetProfile as any).email,
        target_role: target.role,
        company_name: (company as any).name,
      },
    });

    return {
      ok: true as const,
      url: actionLink,
      target: {
        email: (targetProfile as any).email as string,
        full_name: ((targetProfile as any).full_name as string | null) ?? null,
        role: target.role,
      },
    };
  });

/* ─────────────────────────────── Audit log ─────────────────────────────── */

export type SuperAdminAuditRow = {
  id: string;
  actor_id: string;
  actor_email: string | null;
  action: string;
  company_id: string | null;
  company_name: string | null;
  target_user_id: string | null;
  target_user_email: string | null;
  details: Record<string, any>;
  created_at: string;
};

export const superAdminListAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SuperAdminAuditRow[]> => {
    await assertSuperAdmin(context.supabase, context.userId, "superAdminListAuditLog");
    const { data, error } = await context.supabase
      .from("super_admin_audit_log")
      .select(
        "id,actor_id,actor_email,action,company_id,company_name,target_user_id,target_user_email,details,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []) as SuperAdminAuditRow[];
  });

export type SuperAdminRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  company_id: string | null;
  company_name: string | null;
};

export const superAdminListSuperAdmins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.supabase, context.userId, "superAdminListSuperAdmins");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roleRows, error } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, company_id")
      .eq("role", "super_admin");
    if (error) throw new Error(error.message);
    const rows = (roleRows ?? []) as { user_id: string; company_id: string | null }[];
    const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
    const companyIds = Array.from(
      new Set(rows.map((r) => r.company_id).filter(Boolean)),
    ) as string[];
    const [{ data: profs }, { data: cos }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, email, full_name")
        .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]),
      companyIds.length
        ? supabaseAdmin.from("companies").select("id, name").in("id", companyIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const profMap = new Map((profs ?? []).map((p: any) => [p.id, p]));
    const coMap = new Map(((cos ?? []) as any[]).map((c) => [c.id, c]));
    return rows.map(
      (r): SuperAdminRow => ({
        user_id: r.user_id,
        email: profMap.get(r.user_id)?.email ?? null,
        full_name: profMap.get(r.user_id)?.full_name ?? null,
        company_id: r.company_id,
        company_name: r.company_id ? (coMap.get(r.company_id)?.name ?? null) : null,
      }),
    );
  });

/* ─────────────────────────────── AI Review ─────────────────────────────── */

const AiReviewSchema = z.object({
  verdict: z.enum(["approve", "reject", "hold"]),
  confidence: z.enum(["low", "medium", "high"]),
  summary: z.string(),
  reasons: z.array(z.string()),
  risks: z.array(z.string()),
  suggested_plan: z.enum(["starter", "professional", "builder"]).nullable(),
});
export type AiCompanyReview = z.infer<typeof AiReviewSchema>;

const reviewSchema = z.object({ company_id: z.string().uuid() });

export const superAdminAiReviewCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => reviewSchema.parse(d))
  .handler(async ({ data, context }): Promise<AiCompanyReview> => {
    await assertSuperAdmin(context.supabase, context.userId, "superAdminAiReviewCompany");

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI is not configured on this workspace.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: co }, { data: owners }, { data: bookings }] = await Promise.all([
      supabaseAdmin
        .from("companies")
        .select(
          "id,name,email,phone,city,plan,is_active,approval_status,created_at,onboarding_completed_at",
        )
        .eq("id", data.company_id)
        .maybeSingle(),
      supabaseAdmin
        .from("user_roles")
        .select("role, user_id, profiles:profiles!inner(email, full_name)")
        .eq("company_id", data.company_id),
      supabaseAdmin
        .from("bookings")
        .select("booking_id", { count: "exact", head: true })
        .eq("company_id", data.company_id),
    ]);
    if (!co) throw new Error("Company not found");

    const ownerList = (owners ?? []).map((r: any) => ({
      role: r.role,
      email: r.profiles?.email ?? null,
      name: r.profiles?.full_name ?? null,
    }));
    const domain = (co as any).email?.split("@")[1] ?? null;
    const freeMail = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"]);

    const payload = {
      company: {
        name: (co as any).name,
        email: (co as any).email,
        phone: (co as any).phone,
        city: (co as any).city,
        plan: (co as any).plan,
        signed_up_at: (co as any).created_at,
        onboarded: Boolean((co as any).onboarding_completed_at),
        email_domain: domain,
        uses_free_email: domain ? freeMail.has(domain) : null,
      },
      users: ownerList,
      user_count: ownerList.length,
      booking_count: (bookings as any)?.count ?? 0,
    };

    const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3-flash-preview");

    const system = `You are a platform trust & safety analyst for a real-estate ERP SaaS.
Review a newly signed-up tenant and recommend whether to approve, reject, or hold for follow-up.
Weigh: business-looking name and email domain (branded > free-mail), presence of phone/city,
credible owner accounts, and whether they've begun onboarding. Be concise, factual, non-judgmental.
Return only the structured fields.`;

    try {
      const { output } = await generateText({
        model,
        system,
        prompt: `Tenant payload:\n${JSON.stringify(payload, null, 2)}`,
        output: Output.object({ schema: AiReviewSchema }),
      });
      return output;
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        return {
          verdict: "hold",
          confidence: "low",
          summary: "AI could not produce a structured review. Please review manually.",
          reasons: [],
          risks: ["Unstructured AI response"],
          suggested_plan: null,
        };
      }
      throw error;
    }
  });
