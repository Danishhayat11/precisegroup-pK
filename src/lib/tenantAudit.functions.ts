import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callRpc } from "@/integrations/supabase/approvedRpc";

export type TenantAuditIdentity = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  company_id: string | null;
  company_name: string | null;
  roles: string[];
  claims_company_id: string | null;
};

export type RlsProbeResult = {
  table: string;
  mine_count: number | null;
  mine_error: string | null;
  cross_read_count: number | null;
  cross_read_error: string | null;
  insert_status: "blocked_by_rls" | "blocked_other" | "leaked" | "skipped";
  insert_detail: string | null;
};

export type TenantAuditReport = {
  identity: TenantAuditIdentity;
  foreign_company_id: string | null;
  foreign_company_name: string | null;
  probes: RlsProbeResult[];
  ran_at: string;
};

const PROBE_TABLES = [
  "bookings",
  "clients",
  "units",
  "payments",
  "crm_leads",
  "hr_employees",
] as const;

async function loadIdentity(
  supabase: any,
  userId: string,
  claims: Record<string, unknown> | null | undefined,
): Promise<TenantAuditIdentity> {
  const [{ data: profile }, { data: roleRows }] = await Promise.all([
    supabase.from("profiles").select("email, full_name, company_id").eq("id", userId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
  ]);

  let company_name: string | null = null;
  if (profile?.company_id) {
    const { data: c } = await supabase
      .from("companies")
      .select("name")
      .eq("id", profile.company_id)
      .maybeSingle();
    company_name = (c?.name as string | null) ?? null;
  }

  const claims_company_id =
    claims && typeof claims === "object" && "company_id" in claims
      ? ((claims as { company_id?: string | null }).company_id ?? null)
      : null;

  return {
    user_id: userId,
    email: (profile?.email as string | null) ?? null,
    full_name: (profile?.full_name as string | null) ?? null,
    company_id: (profile?.company_id as string | null) ?? null,
    company_name,
    roles: (roleRows ?? []).map((r: { role: string }) => r.role),
    claims_company_id,
  };
}

export const getTenantAuditIdentity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TenantAuditIdentity> => {
    const { supabase, userId, claims } = context as {
      supabase: any;
      userId: string;
      claims: Record<string, unknown> | null;
    };
    return loadIdentity(supabase, userId, claims);
  });

export const runTenantRlsProbes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TenantAuditReport> => {
    const { supabase, userId, claims } = context as {
      supabase: any;
      userId: string;
      claims: Record<string, unknown> | null;
    };

    // Require admin — this endpoint enumerates tenant-visibility state.
    const { data: isAdmin, error: roleErr } = await callRpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const identity = await loadIdentity(supabase, userId, claims);

    // Pick a foreign company to probe against. Admins can typically see the
    // companies list; if RLS narrows it to their own, we fall back to a synthetic
    // UUID (still a valid RLS probe: no row should match on cross-read).
    const { data: companies } = await supabase
      .from("companies")
      .select("id, name")
      .neq("id", identity.company_id ?? "00000000-0000-0000-0000-000000000000")
      .limit(1);
    const foreign = (companies ?? [])[0] as { id: string; name: string | null } | undefined;
    const foreign_company_id = foreign?.id ?? "11111111-1111-1111-1111-111111111111";
    const foreign_company_name = foreign?.name ?? null;

    const probes: RlsProbeResult[] = [];
    for (const table of PROBE_TABLES) {
      const probe: RlsProbeResult = {
        table,
        mine_count: null,
        mine_error: null,
        cross_read_count: null,
        cross_read_error: null,
        insert_status: "skipped",
        insert_detail: null,
      };

      // Own-tenant read
      const mineRes = await supabase.from(table).select("*", { count: "exact", head: true });
      if (mineRes.error) probe.mine_error = mineRes.error.message;
      else probe.mine_count = mineRes.count ?? 0;

      // Cross-tenant read — expect 0
      const crossRes = await supabase
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("company_id", foreign_company_id);
      if (crossRes.error) probe.cross_read_error = crossRes.error.message;
      else probe.cross_read_count = crossRes.count ?? 0;

      // Cross-tenant insert probe — expect RLS block (42501).
      const insertRes = await supabase
        .from(table)
        .insert({ company_id: foreign_company_id } as Record<string, unknown>)
        .select("*")
        .maybeSingle();

      if (insertRes.error) {
        const code = (insertRes.error as { code?: string }).code ?? "";
        const msg = insertRes.error.message ?? "";
        if (code === "42501" || /row-level security|policy/i.test(msg)) {
          probe.insert_status = "blocked_by_rls";
        } else {
          probe.insert_status = "blocked_other";
        }
        probe.insert_detail = `${code ? code + ": " : ""}${msg}`;
      } else if (insertRes.data) {
        probe.insert_status = "leaked";
        probe.insert_detail = "Insert with foreign company_id succeeded";
        // Best-effort cleanup — try common id columns.
        const row = insertRes.data as Record<string, unknown>;
        for (const key of ["id", `${table.slice(0, -1)}_id`, "booking_id", "lead_id"]) {
          if (key in row && row[key] != null) {
            await supabase.from(table).delete().eq(key, row[key]);
            break;
          }
        }
      }

      probes.push(probe);
    }

    return {
      identity,
      foreign_company_id,
      foreign_company_name,
      probes,
      ran_at: new Date().toISOString(),
    };
  });

export type IsolationTestResult = {
  ran_at: string;
  passed: boolean;
  tenant1_company_id: string;
  tenant1_company_name: string;
  tenant2_company_id: string | null;
  tenant2_company_name: string | null;
  marker_id: string;
  marker_name: string;
  visible_by_name_count: number;
  visible_by_id: boolean;
  cleaned_up: boolean;
  cleanup_error: string | null;
  notes: string[];
};

const ISOLATION_COMPANY_NAME = "__rls_isolation_scratch__";

export const runTenantIsolationTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<IsolationTestResult> => {
    const { supabase, userId, claims } = context as {
      supabase: any;
      userId: string;
      claims: Record<string, unknown> | null;
    };

    const { data: isAdmin, error: roleErr } = await callRpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const identity = await loadIdentity(supabase, userId, claims);
    const tenant2 = identity.company_id;
    if (!tenant2) {
      throw new Error("Current user has no company_id — cannot verify isolation");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const notes: string[] = [];

    // Step 1: ensure a scratch "tenant #1" company distinct from the caller's.
    let tenant1Id: string;
    let tenant1Name: string;
    {
      const { data: existing, error: findErr } = await supabaseAdmin
        .from("companies")
        .select("id, name")
        .eq("name", ISOLATION_COMPANY_NAME)
        .maybeSingle();
      if (findErr) throw new Error(`find scratch tenant: ${findErr.message}`);
      if (existing && existing.id !== tenant2) {
        tenant1Id = existing.id as string;
        tenant1Name = (existing.name as string) ?? ISOLATION_COMPANY_NAME;
        notes.push("Reused existing scratch tenant.");
      } else {
        const { data: created, error: createErr } = await supabaseAdmin
          .from("companies")
          .insert({ name: ISOLATION_COMPANY_NAME, plan: "starter", is_active: false })
          .select("id, name")
          .single();
        if (createErr) throw new Error(`create scratch tenant: ${createErr.message}`);
        tenant1Id = created.id as string;
        tenant1Name = (created.name as string) ?? ISOLATION_COMPANY_NAME;
        notes.push("Created scratch tenant.");
      }
    }

    if (tenant1Id === tenant2) {
      throw new Error("scratch tenant collision with caller company — aborting");
    }

    // Step 2: insert a uniquely-named marker crm_lead into tenant #1 via admin.
    const stamp = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    const markerName = `__isolation_probe_${stamp}`;
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("crm_leads")
      .insert({
        company_id: tenant1Id,
        full_name: markerName,
        mobile: "0000000000",
        source: "isolation-test",
        stage: "New Inquiry",
      })
      .select("id")
      .single();
    if (insErr) throw new Error(`seed marker row: ${insErr.message}`);
    const markerId = inserted.id as string;
    notes.push(`Seeded marker ${markerId} in tenant #1.`);

    // Step 3: as the current user (tenant #2, RLS applied), query for it.
    const byName = await supabase
      .from("crm_leads")
      .select("id", { count: "exact" })
      .eq("full_name", markerName);
    const byId = await supabase.from("crm_leads").select("id").eq("id", markerId).maybeSingle();

    const visible_by_name_count = byName.error ? -1 : (byName.count ?? byName.data?.length ?? 0);
    const visible_by_id = !byId.error && byId.data != null;
    if (byName.error) notes.push(`byName error: ${byName.error.message}`);
    if (byId.error && byId.error.code !== "PGRST116")
      notes.push(`byId error: ${byId.error.message}`);

    const passed = visible_by_name_count === 0 && !visible_by_id;

    // Step 4: cleanup via admin.
    let cleaned_up = false;
    let cleanup_error: string | null = null;
    const del = await supabaseAdmin.from("crm_leads").delete().eq("id", markerId);
    if (del.error) cleanup_error = del.error.message;
    else cleaned_up = true;

    // Load tenant #2 name for display.
    const tenant2Name = identity.company_name;

    return {
      ran_at: new Date().toISOString(),
      passed,
      tenant1_company_id: tenant1Id,
      tenant1_company_name: tenant1Name,
      tenant2_company_id: tenant2,
      tenant2_company_name: tenant2Name,
      marker_id: markerId,
      marker_name: markerName,
      visible_by_name_count,
      visible_by_id,
      cleaned_up,
      cleanup_error,
      notes,
    };
  });

export type SerializableScalar = string | number | boolean | null;

export type QueryDescriptor = {
  client:
    | "admin (service role, bypasses RLS)"
    | "current user (RLS)"
    | "ephemeral tenant #2 admin (RLS, signed-in JWT)";
  op: "select" | "insert" | "update" | "delete" | "rpc";
  table: string;
  filters: Record<string, SerializableScalar>;
  payload: Record<string, SerializableScalar>;
  columns: string;
  head: boolean;
  count: "exact" | "planned" | "estimated" | "none";
  sql: string;
};

export type RlsErrorDetail = {
  code: string | null;
  message: string;
  details: string | null;
  hint: string | null;
  is_rls_block: boolean;
};

function toRlsError(err: unknown): RlsErrorDetail | null {
  if (!err || typeof err !== "object") return null;
  const e = err as {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
  };
  const message = e.message ?? String(err);
  const code = e.code ?? null;
  const is_rls_block = code === "42501" || /row-level security|policy/i.test(message);
  return {
    code,
    message,
    details: e.details ?? null,
    hint: e.hint ?? null,
    is_rls_block,
  };
}

export type ControlResult = {
  key: string;
  label: string;
  tenant: "tenant1" | "tenant2";
  kind: "positive" | "negative";
  expected: string;
  actual: string;
  passed: boolean;
  error: string | null;
  query: QueryDescriptor | null;
  rls_error: RlsErrorDetail | null;
};

export type IsolationCheckReport = {
  ran_at: string;
  passed: boolean;
  tenant1_company_id: string;
  tenant1_company_name: string;
  tenant2_company_id: string;
  tenant2_company_name: string | null;
  tenant1_source: "scratch" | "override";
  tenant2_source: "caller" | "override";
  caller_company_id: string | null;
  caller_is_tenant2: boolean;
  marker1_id: string | null;
  marker2_id: string | null;
  ephemeral_user_id: string | null;
  ephemeral_user_email: string | null;
  ephemeral_user_cleanup_error: string | null;
  controls: ControlResult[];
  cleanup_error: string | null;
  notes: string[];
};

export type IsolationCompanyOption = {
  id: string;
  name: string | null;
  is_active: boolean | null;
  is_scratch: boolean;
};

export const listIsolationCompanies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<IsolationCompanyOption[]> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { data: isAdmin, error: roleErr } = await callRpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("companies")
      .select("id, name, is_active")
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(
      (r: { id: string; name: string | null; is_active: boolean | null }) => ({
        id: r.id,
        name: r.name,
        is_active: r.is_active,
        is_scratch: r.name === ISOLATION_COMPANY_NAME,
      }),
    );
  });

export type RunIsolationCheckInput = {
  tenant1_id?: string | null;
  tenant2_id?: string | null;
};

export const runIsolationCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: RunIsolationCheckInput | undefined): RunIsolationCheckInput => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const t1 = data?.tenant1_id ?? null;
    const t2 = data?.tenant2_id ?? null;
    if (t1 && !uuid.test(t1)) throw new Error("tenant1_id is not a valid UUID");
    if (t2 && !uuid.test(t2)) throw new Error("tenant2_id is not a valid UUID");
    if (t1 && t2 && t1 === t2) throw new Error("tenant1_id and tenant2_id must differ");
    return { tenant1_id: t1, tenant2_id: t2 };
  })
  .handler(async ({ context, data }): Promise<IsolationCheckReport> => {
    const { supabase, userId, claims } = context as {
      supabase: any;
      userId: string;
      claims: Record<string, unknown> | null;
    };

    const { data: isAdmin, error: roleErr } = await callRpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const identity = await loadIdentity(supabase, userId, claims);
    const callerCompanyId = identity.company_id;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const notes: string[] = [];

    // Resolve tenant #2 — either an explicit override, or the caller's company.
    let tenant2Id: string;
    let tenant2Name: string | null;
    let tenant2Source: "caller" | "override";
    if (data.tenant2_id) {
      tenant2Source = "override";
      const { data: row, error } = await supabaseAdmin
        .from("companies")
        .select("id, name")
        .eq("id", data.tenant2_id)
        .maybeSingle();
      if (error) throw new Error(`resolve tenant #2: ${error.message}`);
      if (!row) throw new Error("Selected tenant #2 does not exist");
      tenant2Id = row.id as string;
      tenant2Name = (row.name as string | null) ?? null;
      if (tenant2Id !== callerCompanyId) {
        notes.push(
          "Tenant #2 differs from the caller's tenant — RLS probes are run only via a freshly-provisioned admin signed into tenant #2. The 'current user' probes are skipped for this run.",
        );
      }
    } else {
      if (!callerCompanyId) throw new Error("Current user has no company_id");
      tenant2Source = "caller";
      tenant2Id = callerCompanyId;
      tenant2Name = identity.company_name;
    }

    // Resolve tenant #1 — either an explicit override, or ensure the scratch tenant.
    let tenant1Id: string;
    let tenant1Name: string;
    let tenant1Source: "scratch" | "override";
    if (data.tenant1_id) {
      tenant1Source = "override";
      const { data: row, error } = await supabaseAdmin
        .from("companies")
        .select("id, name")
        .eq("id", data.tenant1_id)
        .maybeSingle();
      if (error) throw new Error(`resolve tenant #1: ${error.message}`);
      if (!row) throw new Error("Selected tenant #1 does not exist");
      tenant1Id = row.id as string;
      tenant1Name = (row.name as string) ?? "";
    } else {
      tenant1Source = "scratch";
      const { data: existing } = await supabaseAdmin
        .from("companies")
        .select("id, name")
        .eq("name", ISOLATION_COMPANY_NAME)
        .maybeSingle();
      if (existing && existing.id !== tenant2Id) {
        tenant1Id = existing.id as string;
        tenant1Name = (existing.name as string) ?? ISOLATION_COMPANY_NAME;
      } else {
        const { data: created, error: cErr } = await supabaseAdmin
          .from("companies")
          .insert({ name: ISOLATION_COMPANY_NAME, plan: "starter", is_active: false })
          .select("id, name")
          .single();
        if (cErr) throw new Error(`create scratch tenant: ${cErr.message}`);
        tenant1Id = created.id as string;
        tenant1Name = (created.name as string) ?? ISOLATION_COMPANY_NAME;
      }
    }

    if (tenant1Id === tenant2Id) {
      throw new Error("Tenant #1 and Tenant #2 resolve to the same company — aborting");
    }

    const callerIsTenant2 = callerCompanyId === tenant2Id;

    const stamp = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    const name1 = `__iso_t1_${stamp}`;
    const name2 = `__iso_t2_${stamp}`;

    const seed = async (cid: string, fullName: string) => {
      const { data, error } = await supabaseAdmin
        .from("crm_leads")
        .insert({
          company_id: cid,
          full_name: fullName,
          mobile: "0000000000",
          source: "isolation-check",
          stage: "New Inquiry",
        })
        .select("id")
        .single();
      if (error) throw new Error(`seed ${fullName}: ${error.message}`);
      return data.id as string;
    };

    let marker1: string | null = null;
    let marker2: string | null = null;
    let ephemeralUserId: string | null = null;
    let ephemeralEmail: string | null = null;
    let ephemeralCleanupError: string | null = null;
    const controls: ControlResult[] = [];
    let cleanup_error: string | null = null;

    // Query descriptor helpers — capture the exact operation shape so the UI can
    // show "here's what we asked, here's what came back, here's the RLS block".
    const mkSelect = (
      client: QueryDescriptor["client"],
      table: string,
      columns: string,
      filters: Record<string, SerializableScalar>,
      opts?: { head?: boolean; count?: QueryDescriptor["count"]; single?: boolean },
    ): QueryDescriptor => {
      const head = !!opts?.head;
      const count = opts?.count ?? "none";
      const whereSql = Object.entries(filters)
        .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
        .join(" AND ");
      const sql =
        `-- via ${client}\n` +
        `SELECT ${head ? "1" : columns} FROM public.${table}` +
        (whereSql ? `\n  WHERE ${whereSql}` : "") +
        (count !== "none" ? `\n  -- count: ${count}` : "") +
        (opts?.single ? `\n  LIMIT 1` : "");
      return { client, op: "select", table, columns, filters, payload: {}, head, count, sql };
    };
    const mkInsert = (
      client: QueryDescriptor["client"],
      table: string,
      payload: Record<string, SerializableScalar>,
      returning = "id",
    ): QueryDescriptor => {
      const cols = Object.keys(payload).join(", ");
      const vals = Object.values(payload)
        .map((v) => JSON.stringify(v))
        .join(", ");
      return {
        client,
        op: "insert",
        table,
        filters: {},
        payload,
        columns: returning,
        head: false,
        count: "none",
        sql:
          `-- via ${client}\n` +
          `INSERT INTO public.${table} (${cols})\n  VALUES (${vals})\n  RETURNING ${returning};`,
      };
    };
    const mkUpdate = (
      client: QueryDescriptor["client"],
      table: string,
      payload: Record<string, SerializableScalar>,
      filters: Record<string, SerializableScalar>,
      returning = "id",
    ): QueryDescriptor => {
      const setSql = Object.entries(payload)
        .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
        .join(", ");
      const whereSql = Object.entries(filters)
        .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
        .join(" AND ");
      return {
        client,
        op: "update",
        table,
        filters,
        payload,
        columns: returning,
        head: false,
        count: "none",
        sql:
          `-- via ${client}\n` +
          `UPDATE public.${table} SET ${setSql}` +
          (whereSql ? `\n  WHERE ${whereSql}` : "") +
          `\n  RETURNING ${returning};`,
      };
    };

    try {
      marker1 = await seed(tenant1Id, name1);
      marker2 = await seed(tenant2Id, name2);

      // --- Tenant #1 controls (authoritative via admin, filtering by company_id) ---
      {
        // Positive: tenant #1 marker exists under tenant #1's company_id
        const query = mkSelect(
          "admin (service role, bypasses RLS)",
          "crm_leads",
          "id",
          { id: marker1, company_id: tenant1Id },
          { head: true, count: "exact" },
        );
        const { count, error } = await supabaseAdmin
          .from("crm_leads")
          .select("id", { count: "exact", head: true })
          .eq("id", marker1)
          .eq("company_id", tenant1Id);
        const actual = error ? "error" : String(count ?? 0);
        controls.push({
          key: "t1_positive_own_row",
          label: "Tenant #1: own marker is present under its company_id",
          tenant: "tenant1",
          kind: "positive",
          expected: "1",
          actual,
          passed: !error && count === 1,
          error: error?.message ?? null,
          query,
          rls_error: toRlsError(error),
        });
      }
      {
        // Negative: tenant #2's marker never appears under tenant #1's company_id
        const query = mkSelect(
          "admin (service role, bypasses RLS)",
          "crm_leads",
          "id",
          { id: marker2, company_id: tenant1Id },
          { head: true, count: "exact" },
        );
        const { count, error } = await supabaseAdmin
          .from("crm_leads")
          .select("id", { count: "exact", head: true })
          .eq("id", marker2)
          .eq("company_id", tenant1Id);
        const actual = error ? "error" : String(count ?? 0);
        controls.push({
          key: "t1_negative_foreign_row",
          label: "Tenant #1: tenant #2's marker is NOT under its company_id",
          tenant: "tenant1",
          kind: "negative",
          expected: "0",
          actual,
          passed: !error && (count ?? 0) === 0,
          error: error?.message ?? null,
          query,
          rls_error: toRlsError(error),
        });
      }

      // --- Tenant #2 controls (live RLS as the current authenticated user) ---
      // Only meaningful when the caller actually belongs to tenant #2. When the
      // switcher points tenant #2 at another company, we rely on the ephemeral
      // signed-in admin below (which IS in tenant #2) for the live-RLS probes.
      if (callerIsTenant2) {
        {
          // Positive: RLS-scoped read of own marker succeeds
          const query = mkSelect(
            "current user (RLS)",
            "crm_leads",
            "id",
            { id: marker2 },
            { single: true },
          );
          const { data, error } = await supabase
            .from("crm_leads")
            .select("id")
            .eq("id", marker2)
            .maybeSingle();
          const found = !error && data != null;
          controls.push({
            key: "t2_positive_own_row",
            label: "Tenant #2 (API/RLS): can read own marker",
            tenant: "tenant2",
            kind: "positive",
            expected: "1",
            actual: found ? "1" : "0",
            passed: found,
            error: error && error.code !== "PGRST116" ? error.message : null,
            query,
            rls_error: error && error.code !== "PGRST116" ? toRlsError(error) : null,
          });
        }
        {
          // Negative: RLS-scoped read of tenant #1 marker returns nothing
          const query = mkSelect(
            "current user (RLS)",
            "crm_leads",
            "id",
            { id: marker1, "OR full_name": name1 },
            { single: true },
          );
          const byId = await supabase
            .from("crm_leads")
            .select("id")
            .eq("id", marker1)
            .maybeSingle();
          const byName = await supabase
            .from("crm_leads")
            .select("id", { count: "exact", head: true })
            .eq("full_name", name1);
          const idLeak = !byId.error && byId.data != null;
          const nameCount = byName.error ? -1 : (byName.count ?? 0);
          const passed = !idLeak && nameCount === 0;
          controls.push({
            key: "t2_negative_foreign_row",
            label: "Tenant #2 (API/RLS): CANNOT read tenant #1's marker by id or name",
            tenant: "tenant2",
            kind: "negative",
            expected: "0",
            actual: `by-id:${idLeak ? "leaked" : "hidden"}, by-name:${nameCount}`,
            passed,
            error: null,
            query,
            rls_error: toRlsError(byId.error) ?? toRlsError(byName.error),
          });
        }
        {
          // Negative: RLS-scoped write into tenant #1 must be blocked
          const payload = {
            company_id: tenant1Id,
            full_name: `__iso_write_${stamp}`,
            mobile: "0000000000",
            source: "isolation-check",
            stage: "New Inquiry",
          };
          const query = mkInsert("current user (RLS)", "crm_leads", payload, "id");
          const ins = await supabase.from("crm_leads").insert(payload).select("id").maybeSingle();
          const rlsBlocked =
            !!ins.error &&
            ((ins.error as { code?: string }).code === "42501" ||
              /row-level security|policy/i.test(ins.error.message ?? ""));
          const passed = rlsBlocked || !ins.data;
          // Cleanup a leaked write if it slipped through.
          if (ins.data?.id) {
            await supabaseAdmin.from("crm_leads").delete().eq("id", ins.data.id);
          }
          controls.push({
            key: "t2_negative_foreign_write",
            label: "Tenant #2 (API/RLS): cross-tenant INSERT is blocked",
            tenant: "tenant2",
            kind: "negative",
            expected: "blocked_by_rls (42501)",
            actual: ins.data
              ? "leaked (row created)"
              : rlsBlocked
                ? "blocked_by_rls"
                : `blocked (${(ins.error as { code?: string })?.code ?? "unknown"})`,
            passed,
            error: !passed ? (ins.error?.message ?? "insert unexpectedly succeeded") : null,
            query,
            rls_error: toRlsError(ins.error),
          });
        }
      } else {
        // Caller is not in tenant #2 — record a single skipped placeholder so the
        // UI reflects that the "current user" probes were intentionally not run.
        controls.push({
          key: "t2_current_user_probes_skipped",
          label: "Tenant #2 (current user RLS) probes: skipped (caller is not in tenant #2)",
          tenant: "tenant2",
          kind: "positive",
          expected: "skipped",
          actual: "skipped",
          passed: true,
          error: null,
          query: null,
          rls_error: null,
        });
      }

      // --- Fresh admin user in tenant #2 signs in and probes tenant #1's marker ---
      const { createClient } = await import("@supabase/supabase-js");
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabasePublishable = process.env.SUPABASE_PUBLISHABLE_KEY;
      if (!supabaseUrl || !supabasePublishable) {
        controls.push({
          key: "t2_admin_signin_probe",
          label: "Tenant #2 admin sign-in probe: cannot run — Supabase env missing",
          tenant: "tenant2",
          kind: "negative",
          expected: "blocked",
          actual: "skipped",
          passed: false,
          error: "SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not set on server",
          query: null,
          rls_error: null,
        });
      } else {
        ephemeralEmail = `iso-admin-${stamp}@isolation.test`;
        const password = `Iso!${stamp}${Math.random().toString(36).slice(2, 10)}Aa1`;
        const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
          email: ephemeralEmail,
          password,
          email_confirm: true,
          user_metadata: { full_name: "Isolation Probe Admin" },
        });
        if (createErr || !created?.user) {
          throw new Error(`create ephemeral admin: ${createErr?.message ?? "no user returned"}`);
        }
        ephemeralUserId = created.user.id;

        // Place them into tenant #2 as an admin (the trigger assigns the seed
        // tenant + viewer role; override both).
        await supabaseAdmin
          .from("profiles")
          .update({ company_id: tenant2Id })
          .eq("id", ephemeralUserId);
        await supabaseAdmin.from("user_roles").delete().eq("user_id", ephemeralUserId);
        const { error: roleErr2 } = await supabaseAdmin
          .from("user_roles")
          .insert({ user_id: ephemeralUserId, role: "admin", company_id: tenant2Id });
        if (roleErr2) throw new Error(`grant admin: ${roleErr2.message}`);

        // Sign in with a fresh anon client to get a real JWT.
        const anonClient = createClient(supabaseUrl, supabasePublishable, {
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });
        const { data: signIn, error: signInErr } = await anonClient.auth.signInWithPassword({
          email: ephemeralEmail,
          password,
        });
        const accessToken = signIn?.session?.access_token;
        if (signInErr || !accessToken) {
          throw new Error(`sign in as ephemeral admin: ${signInErr?.message ?? "no token"}`);
        }

        // Build a user-scoped client with that JWT for the probes.
        const userClient = createClient(supabaseUrl, supabasePublishable, {
          global: { headers: { Authorization: `Bearer ${accessToken}` } },
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });

        const ephemeralClient: QueryDescriptor["client"] =
          "ephemeral tenant #2 admin (RLS, signed-in JWT)";

        // Read by id
        {
          const query = mkSelect(
            ephemeralClient,
            "crm_leads",
            "id, full_name, stage",
            { id: marker1! },
            { single: true },
          );
          const readById = await userClient
            .from("crm_leads")
            .select("id, full_name, stage")
            .eq("id", marker1!)
            .maybeSingle();
          const readIdLeak = !readById.error && readById.data != null;
          controls.push({
            key: "t2_admin_read_by_id",
            label: "Tenant #2 admin (signed-in JWT): tenant #1 marker NOT readable by id",
            tenant: "tenant2",
            kind: "negative",
            expected: "not found",
            actual: readIdLeak ? "leaked (row returned)" : "hidden",
            passed: !readIdLeak,
            error:
              readById.error && readById.error.code !== "PGRST116" ? readById.error.message : null,
            query,
            rls_error:
              readById.error && readById.error.code !== "PGRST116"
                ? toRlsError(readById.error)
                : null,
          });
        }

        // Read by full_name
        {
          const query = mkSelect(
            ephemeralClient,
            "crm_leads",
            "id",
            { full_name: name1 },
            { head: true, count: "exact" },
          );
          const readByName = await userClient
            .from("crm_leads")
            .select("id", { count: "exact", head: true })
            .eq("full_name", name1);
          const nameCount = readByName.error ? -1 : (readByName.count ?? 0);
          controls.push({
            key: "t2_admin_read_by_name",
            label: "Tenant #2 admin (signed-in JWT): tenant #1 marker NOT readable by name",
            tenant: "tenant2",
            kind: "negative",
            expected: "0",
            actual: String(nameCount),
            passed: nameCount === 0,
            error: readByName.error?.message ?? null,
            query,
            rls_error: toRlsError(readByName.error),
          });
        }

        // Update by id — expect zero rows updated (RLS filters targets of UPDATE)
        {
          const query = mkUpdate(
            ephemeralClient,
            "crm_leads",
            { notes: `__pwn_attempt_${stamp}` },
            { id: marker1! },
            "id",
          );
          const upd = await userClient
            .from("crm_leads")
            .update({ notes: `__pwn_attempt_${stamp}` })
            .eq("id", marker1!)
            .select("id");
          const updatedCount = upd.error ? -1 : (upd.data?.length ?? 0);
          const updBlocked =
            !!upd.error &&
            ((upd.error as { code?: string }).code === "42501" ||
              /row-level security|policy/i.test(upd.error.message ?? ""));
          // Authoritative check: read the row via admin and confirm notes are unchanged.
          const { data: after } = await supabaseAdmin
            .from("crm_leads")
            .select("notes")
            .eq("id", marker1!)
            .maybeSingle();
          const notesMutated = after?.notes === `__pwn_attempt_${stamp}`;
          const updatePassed = updatedCount === 0 && !notesMutated;
          controls.push({
            key: "t2_admin_update_by_id",
            label: "Tenant #2 admin (signed-in JWT): UPDATE of tenant #1 marker is blocked",
            tenant: "tenant2",
            kind: "negative",
            expected: "0 rows updated & notes unchanged",
            actual: notesMutated
              ? "leaked (row mutated)"
              : updBlocked
                ? "blocked_by_rls"
                : `${updatedCount} row(s) touched`,
            passed: updatePassed,
            error: !updatePassed
              ? (upd.error?.message ?? "update unexpectedly affected the row")
              : null,
            query,
            rls_error: toRlsError(upd.error),
          });
        }

        // Sign the ephemeral session out — best-effort.
        await anonClient.auth.signOut().catch(() => {});
      }
    } finally {
      // Cleanup markers
      const ids = [marker1, marker2].filter((v): v is string => Boolean(v));
      if (ids.length) {
        const del = await supabaseAdmin.from("crm_leads").delete().in("id", ids);
        if (del.error) cleanup_error = del.error.message;
      }
      // Cleanup ephemeral admin user
      if (ephemeralUserId) {
        const { error: userDelErr } = await supabaseAdmin.auth.admin.deleteUser(ephemeralUserId);
        if (userDelErr) ephemeralCleanupError = userDelErr.message;
      }
    }

    return {
      ran_at: new Date().toISOString(),
      passed: controls.every((c) => c.passed),
      tenant1_company_id: tenant1Id,
      tenant1_company_name: tenant1Name,
      tenant2_company_id: tenant2Id,
      tenant2_company_name: tenant2Name,
      tenant1_source: tenant1Source,
      tenant2_source: tenant2Source,
      caller_company_id: callerCompanyId,
      caller_is_tenant2: callerIsTenant2,
      marker1_id: marker1,
      marker2_id: marker2,
      ephemeral_user_id: ephemeralUserId,
      ephemeral_user_email: ephemeralEmail,
      ephemeral_user_cleanup_error: ephemeralCleanupError,
      controls,
      cleanup_error,
      notes,
    };
  });

export type CleanupTestTenantResult = {
  ran_at: string;
  found: boolean;
  company_id: string | null;
  company_name: string | null;
  deleted_counts: Record<string, number>;
  user_ids: string[];
  invitation_ids: string[];
  auth_users_deleted: number;
  auth_user_errors: { user_id: string; error: string }[];
  notes: string[];
};

export const cleanupIsolationTestTenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CleanupTestTenantResult> => {
    const { supabase, userId } = context as {
      supabase: any;
      userId: string;
    };

    const { data: isAdmin, error: roleErr } = await callRpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const notes: string[] = [];

    // Locate the scratch tenant created by the isolation flows.
    const { data: scratch, error: findErr } = await supabaseAdmin
      .from("companies")
      .select("id, name")
      .eq("name", ISOLATION_COMPANY_NAME)
      .maybeSingle();
    if (findErr) throw new Error(`locate scratch tenant: ${findErr.message}`);

    if (!scratch) {
      return {
        ran_at: new Date().toISOString(),
        found: false,
        company_id: null,
        company_name: null,
        deleted_counts: {},
        user_ids: [],
        invitation_ids: [],
        auth_users_deleted: 0,
        auth_user_errors: [],
        notes: ["No scratch tenant found — nothing to clean up."],
      };
    }

    // admin_cleanup_test_tenant refuses primary/seed and caller's own company,
    // wipes every tenant-scoped table, and returns the affected user + invite ids.
    const { data: rpcData, error: rpcErr } = await callRpc("admin_cleanup_test_tenant", {
      _company_id: scratch.id,
    });
    if (rpcErr) throw new Error(`cleanup RPC: ${rpcErr.message}`);

    const payload = (rpcData ?? {}) as {
      company_id?: string;
      company_name?: string;
      user_ids?: string[];
      invitation_ids?: string[];
      deleted_counts?: Record<string, number>;
    };

    const userIds = payload.user_ids ?? [];
    const invitationIds = payload.invitation_ids ?? [];

    // Delete the associated auth users so they can't linger as orphans.
    let auth_users_deleted = 0;
    const auth_user_errors: { user_id: string; error: string }[] = [];
    for (const uid of userIds) {
      if (uid === userId) {
        auth_user_errors.push({ user_id: uid, error: "refusing to delete caller" });
        continue;
      }
      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(uid);
      if (delErr) auth_user_errors.push({ user_id: uid, error: delErr.message });
      else auth_users_deleted += 1;
    }

    notes.push(
      `Removed scratch tenant "${payload.company_name ?? scratch.name ?? ""}" and ${userIds.length} profile(s), ${invitationIds.length} invitation(s).`,
    );

    return {
      ran_at: new Date().toISOString(),
      found: true,
      company_id: payload.company_id ?? scratch.id,
      company_name: payload.company_name ?? (scratch.name as string | null),
      deleted_counts: payload.deleted_counts ?? {},
      user_ids: userIds,
      invitation_ids: invitationIds,
      auth_users_deleted,
      auth_user_errors,
      notes,
    };
  });

// -----------------------------------------------------------------------------
// Automatic artifact sweep — removes any leftover isolation-test markers and
// ephemeral admin users, even from prior runs that errored, crashed, or were
// abandoned when the user navigated away. Safe to call repeatedly.
// -----------------------------------------------------------------------------

export type SweepIsolationResult = {
  ran_at: string;
  markers_deleted: number;
  marker_ids: string[];
  auth_users_deleted: number;
  auth_user_errors: { user_id: string; email: string | null; error: string }[];
  errors: string[];
};

export const sweepIsolationArtifacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SweepIsolationResult> => {
    const { supabase, userId } = context as { supabase: any; userId: string };

    const { data: isAdmin, error: roleErr } = await callRpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const errors: string[] = [];

    // 1) Delete marker leads (any full_name written by the test flows).
    let marker_ids: string[] = [];
    {
      const { data: rows, error } = await supabaseAdmin
        .from("crm_leads")
        .select("id, full_name")
        .or("full_name.like.__iso\\_%,full_name.like.__isolation\\_probe\\_%");
      if (error) {
        errors.push(`list markers: ${error.message}`);
      } else if (rows && rows.length > 0) {
        marker_ids = rows.map((r: { id: string }) => r.id);
        const { error: delErr } = await supabaseAdmin
          .from("crm_leads")
          .delete()
          .in("id", marker_ids);
        if (delErr) errors.push(`delete markers: ${delErr.message}`);
      }
    }

    // 2) Delete ephemeral admin auth users (iso-admin-*@isolation.test).
    let auth_users_deleted = 0;
    const auth_user_errors: {
      user_id: string;
      email: string | null;
      error: string;
    }[] = [];
    {
      // Paginate through auth.users; the ephemeral pool is tiny so a couple
      // of pages is more than enough.
      let page = 1;
      const perPage = 200;
      const targets: { id: string; email: string | null }[] = [];
      for (let i = 0; i < 5; i += 1) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({
          page,
          perPage,
        });
        if (error) {
          errors.push(`list auth users: ${error.message}`);
          break;
        }
        const users = data?.users ?? [];
        for (const u of users) {
          const email = (u.email ?? "").toLowerCase();
          if (
            email.startsWith("iso-admin-") &&
            email.endsWith("@isolation.test") &&
            u.id !== userId
          ) {
            targets.push({ id: u.id, email: u.email ?? null });
          }
        }
        if (users.length < perPage) break;
        page += 1;
      }
      for (const t of targets) {
        const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(t.id);
        if (delErr) {
          auth_user_errors.push({ user_id: t.id, email: t.email, error: delErr.message });
        } else {
          auth_users_deleted += 1;
        }
      }
    }

    return {
      ran_at: new Date().toISOString(),
      markers_deleted: marker_ids.length,
      marker_ids,
      auth_users_deleted,
      auth_user_errors,
      errors,
    };
  });
