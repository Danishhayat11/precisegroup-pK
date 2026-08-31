import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callRpc } from "@/integrations/supabase/approvedRpc";

const TENANT_1_ID = "00000000-0000-0000-0000-000000000001";
const TENANT_2_ID = "00000000-0000-0000-0000-000000000002";
const KNOWN_TENANTS = new Set([TENANT_1_ID, TENANT_2_ID]);
const PROBE_PREFIX = "RLS-PENTEST-";

export type PentestAttempt = {
  operation: "SELECT" | "UPDATE" | "DELETE";
  table: string;
  target_id: string;
  rows_returned: number;
  error_code: string | null;
  error_message: string | null;
  blocked: boolean;
  note: string;
};

export type RlsPentestReport = {
  callerCompanyId: string;
  otherCompanyId: string;
  probeTable: string;
  probeId: string | null;
  probeOriginalNotes: string;
  probeIntactAfter: boolean;
  attempts: PentestAttempt[];
  overallBlocked: boolean;
  cleanedUp: boolean;
  ranAt: string;
};

export const runRlsPenetrationTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RlsPentestReport> => {
    const { supabase, userId } = context;

    // Admin-only.
    const { data: isAdmin, error: roleErr } = await callRpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    // Caller company + choose the "other" tenant as the attack target.
    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .single();
    if (profErr) throw new Error(profErr.message);
    const callerCompanyId = (profile as { company_id: string | null }).company_id;
    if (!callerCompanyId) throw new Error("Caller has no company_id");
    if (!KNOWN_TENANTS.has(callerCompanyId)) {
      throw new Error(`Caller company ${callerCompanyId} is not one of the two test tenants.`);
    }
    const otherCompanyId = callerCompanyId === TENANT_1_ID ? TENANT_2_ID : TENANT_1_ID;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const probeTable = "crm_leads";
    const originalNotes = `${PROBE_PREFIX}ORIGINAL-${Date.now()}`;
    const tamperNotes = `${PROBE_PREFIX}TAMPERED-${Date.now()}`;

    // 1. Seed a probe row in the OTHER tenant (via admin — bypasses RLS).
    const { data: probe, error: seedErr } = await supabaseAdmin
      .from(probeTable)
      .insert({
        full_name: `${PROBE_PREFIX}${Date.now()}`,
        mobile: "0000000000",
        source: "Walk-in",
        stage: "New Inquiry",
        notes: originalNotes,
        company_id: otherCompanyId,
      })
      .select("id")
      .single();
    if (seedErr) throw new Error(`Probe seed failed: ${seedErr.message}`);
    const probeId = (probe as { id: string }).id;

    const attempts: PentestAttempt[] = [];
    let probeIntactAfter = true;

    try {
      // 2. Attempt cross-tenant SELECT using the caller's RLS-scoped session.
      {
        const { data, error } = await supabase
          .from(probeTable)
          .select("id, notes, company_id")
          .eq("id", probeId);
        const rows = data?.length ?? 0;
        attempts.push({
          operation: "SELECT",
          table: probeTable,
          target_id: probeId,
          rows_returned: rows,
          error_code: error?.code ?? null,
          error_message: error?.message ?? null,
          // Blocked = we saw zero rows (RLS filters silently) OR got an explicit error.
          blocked: rows === 0,
          note:
            rows === 0
              ? "RLS correctly hid the other tenant's row from SELECT."
              : "LEAK: caller was able to read a row belonging to the other tenant.",
        });
      }

      // 3. Attempt cross-tenant UPDATE.
      {
        const { data, error } = await supabase
          .from(probeTable)
          .update({ notes: tamperNotes })
          .eq("id", probeId)
          .select("id");
        const rows = data?.length ?? 0;
        attempts.push({
          operation: "UPDATE",
          table: probeTable,
          target_id: probeId,
          rows_returned: rows,
          error_code: error?.code ?? null,
          error_message: error?.message ?? null,
          blocked: rows === 0,
          note:
            rows === 0
              ? "RLS blocked cross-tenant UPDATE (0 rows affected)."
              : "LEAK: caller updated a row in the other tenant.",
        });
      }

      // 4. Attempt cross-tenant DELETE.
      {
        const { data, error } = await supabase
          .from(probeTable)
          .delete()
          .eq("id", probeId)
          .select("id");
        const rows = data?.length ?? 0;
        attempts.push({
          operation: "DELETE",
          table: probeTable,
          target_id: probeId,
          rows_returned: rows,
          error_code: error?.code ?? null,
          error_message: error?.message ?? null,
          blocked: rows === 0,
          note:
            rows === 0
              ? "RLS blocked cross-tenant DELETE (0 rows affected)."
              : "LEAK: caller deleted a row in the other tenant.",
        });
      }

      // 5. Verify via admin that the probe row is untouched.
      const { data: after, error: verifyErr } = await supabaseAdmin
        .from(probeTable)
        .select("id, notes, company_id")
        .eq("id", probeId)
        .maybeSingle();
      if (verifyErr) throw new Error(`Verify failed: ${verifyErr.message}`);
      probeIntactAfter =
        !!after &&
        (after as { notes: string; company_id: string }).notes === originalNotes &&
        (after as { notes: string; company_id: string }).company_id === otherCompanyId;
    } finally {
      // Always clean up the probe row.
      await supabaseAdmin.from(probeTable).delete().eq("id", probeId);
    }

    const overallBlocked = attempts.every((a) => a.blocked) && probeIntactAfter;

    return {
      callerCompanyId,
      otherCompanyId,
      probeTable,
      probeId,
      probeOriginalNotes: originalNotes,
      probeIntactAfter,
      attempts,
      overallBlocked,
      cleanedUp: true,
      ranAt: new Date().toISOString(),
    };
  });
