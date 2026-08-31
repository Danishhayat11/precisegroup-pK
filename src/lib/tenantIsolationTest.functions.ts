import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callRpc } from "@/integrations/supabase/approvedRpc";

const TENANT_1_ID = "00000000-0000-0000-0000-000000000001";
const TENANT_2_ID = "00000000-0000-0000-0000-000000000002";
const KNOWN_TENANTS = new Set([TENANT_1_ID, TENANT_2_ID]);
const MARKER_PREFIX = "ISOLATION-TEST-";

type CheckResult = {
  table: string;
  tenant1Count: number;
  tenant2Count: number;
  passed: boolean;
  note?: string;
  /** Raw per-check payload so exports can preserve exactly what the probe returned. */
  raw?: {
    kind: "marker" | "counts" | "rls_probe";
    expected: string;
    actual: string;
    /** JSON-stringified probe response (rows, counts, ids) — kept as a string
     *  so it is trivially serializable across the server-fn RPC boundary. */
    probe_response_json?: string;
    error?: string | null;
  };
};

export type IsolationReport = {
  callerCompanyId: string;
  otherCompanyId: string;
  tenant1CompanyId: string;
  tenant2CompanyId: string;
  direction: "1->2" | "2->1";
  marker: string;
  insertedLeadId: string | null;
  checks: CheckResult[];
  overallPassed: boolean;
  cleanedUp: boolean;
};

export const runTenantIsolationTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<IsolationReport> => {
    const { supabase, userId } = context;

    // Authorize: admin only (of whichever tenant is signed in)
    const { data: isAdmin, error: roleErr } = await callRpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .single();
    if (profErr) throw new Error(profErr.message);
    const callerCompanyId = (profile as { company_id: string | null }).company_id;
    if (!callerCompanyId) throw new Error("Caller has no company_id");
    if (!KNOWN_TENANTS.has(callerCompanyId)) {
      throw new Error(
        `Caller company ${callerCompanyId} is not one of the two isolation test tenants.`,
      );
    }
    const otherCompanyId = callerCompanyId === TENANT_1_ID ? TENANT_2_ID : TENANT_1_ID;
    const direction: IsolationReport["direction"] =
      callerCompanyId === TENANT_1_ID ? "1->2" : "2->1";
    const callerLabel = callerCompanyId === TENANT_1_ID ? "tenant #1" : "tenant #2";
    const otherLabel = callerCompanyId === TENANT_1_ID ? "tenant #2" : "tenant #1";

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const marker = `${MARKER_PREFIX}${Date.now()}`;
    let insertedLeadId: string | null = null;
    const checks: CheckResult[] = [];

    // Small helper so the report always slots counts into the T#1 / T#2 columns
    // regardless of which side is the caller.
    const asColumns = (callerCount: number, otherCount: number) =>
      callerCompanyId === TENANT_1_ID
        ? { tenant1Count: callerCount, tenant2Count: otherCount }
        : { tenant1Count: otherCount, tenant2Count: callerCount };

    try {
      // 1. Insert marker in the caller's tenant (RLS-scoped write).
      const { data: inserted, error: insErr } = await supabase
        .from("crm_leads")
        .insert({
          full_name: marker,
          mobile: "0000000000",
          source: "Walk-in",
          stage: "New Inquiry",
          notes: `Automated tenant isolation test row from ${callerLabel}. Safe to delete.`,
          company_id: callerCompanyId,
        })
        .select("id")
        .single();
      if (insErr) throw new Error(`Insert into ${callerLabel} failed: ${insErr.message}`);
      insertedLeadId = (inserted as { id: string }).id;

      // 2. Marker cross-visibility: must exist under caller, must NOT under other.
      const { count: callerMarker, error: cmErr } = await supabaseAdmin
        .from("crm_leads")
        .select("id", { count: "exact", head: true })
        .eq("company_id", callerCompanyId)
        .eq("full_name", marker);
      if (cmErr) throw new Error(cmErr.message);
      const { count: otherMarker, error: omErr } = await supabaseAdmin
        .from("crm_leads")
        .select("id", { count: "exact", head: true })
        .eq("company_id", otherCompanyId)
        .eq("full_name", marker);
      if (omErr) throw new Error(omErr.message);

      checks.push({
        table: "crm_leads (marker row)",
        ...asColumns(callerMarker ?? 0, otherMarker ?? 0),
        passed: (callerMarker ?? 0) === 1 && (otherMarker ?? 0) === 0,
        note: `Marker inserted in ${callerLabel} must be invisible to ${otherLabel}.`,
        raw: {
          kind: "marker",
          expected: `caller=1, other=0 for full_name="${marker}"`,
          actual: `caller=${callerMarker ?? 0}, other=${otherMarker ?? 0}`,
          probe_response_json: JSON.stringify({
            marker,
            insertedLeadId,
            callerCompanyId,
            otherCompanyId,
            callerMarkerCount: callerMarker ?? 0,
            otherMarkerCount: otherMarker ?? 0,
          }),
        },
      });

      // 3. Per-tenant row counts across core tables.
      const coreTables = [
        "crm_leads",
        "bookings",
        "clients",
        "payments",
        "projects",
        "units",
        "hr_employees",
        "office_expenses",
        "maintenance_charges",
      ] as const;

      for (const table of coreTables) {
        // Use the SECURITY DEFINER RPC so numbers reflect the underlying data
        // and are never filtered by RLS on either side.
        const [{ data: c1, error: e1 }, { data: c2, error: e2 }] = await Promise.all([
          callRpc("count_rows_by_company", {
            _table_name: table,
            _company_id: TENANT_1_ID,
          }),
          callRpc("count_rows_by_company", {
            _table_name: table,
            _company_id: TENANT_2_ID,
          }),
        ]);
        const rawCounts = {
          rpc: "count_rows_by_company",
          tenant1: { company_id: TENANT_1_ID, raw: c1, error: e1?.message ?? null },
          tenant2: { company_id: TENANT_2_ID, raw: c2, error: e2?.message ?? null },
        };
        if (e1 || e2) {
          checks.push({
            table,
            tenant1Count: Number(c1 ?? 0),
            tenant2Count: Number(c2 ?? 0),
            passed: false,
            note: `RPC error: ${e1?.message ?? e2?.message}`,
            raw: {
              kind: "counts",
              expected: "no rpc errors, numeric counts for both tenants",
              actual: `t1=${c1 ?? "null"}, t2=${c2 ?? "null"}`,
              error: e1?.message ?? e2?.message ?? null,
              probe_response_json: JSON.stringify(rawCounts),
            },
          });
          continue;
        }
        checks.push({
          table,
          tenant1Count: Number(c1 ?? 0),
          tenant2Count: Number(c2 ?? 0),
          passed: true,
          note: "Row counts are scoped per company_id (via SECURITY DEFINER RPC, bypasses RLS).",
          raw: {
            kind: "counts",
            expected: "tenant-scoped counts (RLS-bypassing RPC)",
            actual: `t1=${Number(c1 ?? 0)}, t2=${Number(c2 ?? 0)}`,
            probe_response_json: JSON.stringify(rawCounts),
          },
        });
      }

      // 4. RLS probe: caller session must NOT see any of the other tenant's rows.
      const { data: leakedRows, error: leakErr } = await supabase
        .from("crm_leads")
        .select("id")
        .eq("company_id", otherCompanyId)
        .limit(5);
      if (leakErr) throw new Error(`RLS probe failed: ${leakErr.message}`);
      const leakedIds = (leakedRows ?? []).map((r) => (r as { id: string }).id);
      checks.push({
        table: "crm_leads (RLS probe)",
        ...asColumns(0, leakedRows?.length ?? 0),
        passed: (leakedRows?.length ?? 0) === 0,
        note: `Signed-in ${callerLabel} user must NOT see any ${otherLabel} rows.`,
        raw: {
          kind: "rls_probe",
          expected: `0 rows for company_id=${otherCompanyId} via RLS-scoped session`,
          actual: `${leakedRows?.length ?? 0} row(s)`,
          probe_response_json: JSON.stringify({
            query: `crm_leads.select('id').eq('company_id','${otherCompanyId}').limit(5)`,
            client: "authenticated (RLS applies)",
            row_count: leakedRows?.length ?? 0,
            leaked_ids: leakedIds,
          }),
        },
      });
    } finally {
      if (insertedLeadId) {
        await supabaseAdmin.from("crm_leads").delete().eq("id", insertedLeadId);
      }
    }

    const overallPassed = checks.every((c) => c.passed);
    return {
      callerCompanyId,
      otherCompanyId,
      tenant1CompanyId: TENANT_1_ID,
      tenant2CompanyId: TENANT_2_ID,
      direction,
      marker,
      insertedLeadId,
      checks,
      overallPassed,
      cleanedUp: true,
    };
  });

// -----------------------------------------------------------------------------
// Share the last isolation report: uploads the JSON snapshot to a private
// storage bucket and returns a time-limited signed download URL so a teammate
// (or the same admin in another browser) can pull it without logging in.
// -----------------------------------------------------------------------------

const SHARE_BUCKET = "isolation-reports";
const SHARE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type ShareIsolationReportResult = {
  url: string;
  path: string;
  expires_at: string;
  ttl_seconds: number;
};

export const shareIsolationReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { report: IsolationReport }) => {
    if (!data || typeof data !== "object" || !data.report) {
      throw new Error("report is required");
    }
    return data;
  })
  .handler(async ({ context, data }): Promise<ShareIsolationReportResult> => {
    const { supabase, userId } = context;

    const { data: isAdmin, error: roleErr } = await callRpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const generatedAt = new Date().toISOString();
    const slug = generatedAt.replace(/[:.]/g, "-");
    const rand = crypto.randomUUID();
    const path = `${data.report.callerCompanyId}/tenant-isolation-${slug}-${rand.slice(0, 8)}.json`;

    const payload = {
      schema_version: 1,
      generated_at: generatedAt,
      shared_by_user_id: userId,
      report: data.report,
    };

    const body = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });

    const upload = await supabaseAdmin.storage.from(SHARE_BUCKET).upload(path, body, {
      contentType: "application/json",
      upsert: false,
    });
    if (upload.error) throw new Error(`upload failed: ${upload.error.message}`);

    const signed = await supabaseAdmin.storage
      .from(SHARE_BUCKET)
      .createSignedUrl(path, SHARE_TTL_SECONDS, {
        download: `tenant-isolation-${slug}.json`,
      });
    if (signed.error || !signed.data?.signedUrl) {
      throw new Error(`sign failed: ${signed.error?.message ?? "unknown"}`);
    }

    return {
      url: signed.data.signedUrl,
      path,
      expires_at: new Date(Date.now() + SHARE_TTL_SECONDS * 1000).toISOString(),
      ttl_seconds: SHARE_TTL_SECONDS,
    };
  });
