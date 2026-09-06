import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callServerRpc } from "@/integrations/supabase/serverRpc";

const deactivateSchema = z.object({
  reason: z.string().trim().min(3, "Please describe why").max(500),
});

export const adminDeactivateCompany = createServerFn({ method: "POST" })
  .validator((d: unknown) => deactivateSchema.parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { error } = await callServerRpc(context.supabase, "admin_deactivate_company", {
      _reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
