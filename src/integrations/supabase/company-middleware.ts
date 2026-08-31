import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Adds `context.companyId` to any server function that also uses
 * `requireSupabaseAuth`. Reads via RLS-scoped profiles query (user can only
 * see their own row) so the value is authoritative and cannot be spoofed
 * from the client.
 */
export const requireCompanyContext = createMiddleware()
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("company_id")
      .eq("id", context.userId)
      .maybeSingle();

    if (error) {
      throw new Error(`[requireCompanyContext] profile lookup failed: ${error.message}`);
    }
    if (!data?.company_id) {
      throw new Error("[requireCompanyContext] no company_id on profile");
    }

    return next({
      context: {
        companyId: data.company_id as string,
      },
    });
  });
