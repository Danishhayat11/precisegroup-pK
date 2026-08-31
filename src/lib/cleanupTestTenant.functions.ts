import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callRpc } from "@/integrations/supabase/approvedRpc";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000000002";
const PRIMARY_TENANT_ID = "00000000-0000-0000-0000-000000000001";

export type TenantCleanupReport = {
  companyId: string;
  companyName: string;
  deletedCounts: Record<string, number>;
  invitationsDeleted: number;
  usersDeleted: number;
  authDeleteFailures: Array<{ userId: string; error: string }>;
  ranAt: string;
};

export const cleanupTestTenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { companyId?: string; confirm: string }) => {
    if (input.confirm !== "DELETE") {
      throw new Error('Confirmation text must be exactly "DELETE".');
    }
    const companyId = input.companyId ?? TEST_TENANT_ID;
    if (companyId === PRIMARY_TENANT_ID) {
      throw new Error("Refusing to delete the primary/seed company.");
    }
    return { companyId, confirm: input.confirm };
  })
  .handler(async ({ data, context }): Promise<TenantCleanupReport> => {
    const { supabase, userId } = context;

    const { data: isSuper, error: roleErr } = await callRpc("is_super_admin", {
      _user_id: userId,
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isSuper) throw new Error("Forbidden: super_admin role required");

    // Delegates the tenant wipe to the admin-guarded SQL function so all
    // deletes run in one transaction and are refused server-side if the
    // target is the caller's own or the primary company.
    const { data: rpc, error } = await callRpc(
      "admin_cleanup_test_tenant" as never,
      { _company_id: data.companyId } as never,
    );
    if (error) throw new Error(error.message);

    const result = rpc as {
      ok: boolean;
      company_id: string;
      company_name: string;
      user_ids: string[] | null;
      invitation_ids: string[] | null;
      deleted_counts: Record<string, number>;
    };

    // Delete the tenant's auth accounts (invitees who signed up). Uses the
    // service role — safe here because the caller was already verified as
    // an admin above and the user list came from the SQL function.
    const userIds = result.user_ids ?? [];
    const authDeleteFailures: Array<{ userId: string; error: string }> = [];
    let usersDeleted = 0;
    if (userIds.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      for (const uid of userIds) {
        const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(uid);
        if (delErr) {
          authDeleteFailures.push({ userId: uid, error: delErr.message });
        } else {
          usersDeleted++;
        }
      }
    }

    return {
      companyId: result.company_id,
      companyName: result.company_name,
      deletedCounts: result.deleted_counts ?? {},
      invitationsDeleted: (result.invitation_ids ?? []).length,
      usersDeleted,
      authDeleteFailures,
      ranAt: new Date().toISOString(),
    };
  });

export const TEST_TENANT_DEFAULT_ID = TEST_TENANT_ID;
