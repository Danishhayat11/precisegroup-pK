/**
 * Server function for the non-super-admin signup flow.
 *
 * Wraps the `public.bootstrap_company` SECURITY DEFINER RPC so a newly
 * signed-up authenticated user can create their own company (pending,
 * inactive — awaiting super-admin approval) and be promoted to admin of
 * that new tenant atomically.
 *
 * Security:
 * - `.middleware([requireSupabaseAuth])` guarantees an authenticated caller;
 *   the RPC additionally enforces `auth.uid()` server-side.
 * - The RPC only allows callers still on the seed company
 *   (`00000000-0000-0000-0000-000000000001`), preventing re-bootstrap.
 * - New company is created with `is_active=false, approval_status='pending'`
 *   so a super admin must approve it before the tenant can operate.
 * - RLS elsewhere continues to scope reads/writes via `current_company_id()`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callServerRpc } from "@/integrations/supabase/serverRpc";

const bootstrapSchema = z.object({
  company_name: z.string().trim().min(2, "Company name is required").max(120),
  phone: z
    .string()
    .trim()
    .regex(/^[+\d][\d\s\-()]{9,20}$/, "Enter a valid mobile number")
    .max(32),
  plan: z.enum(["starter", "professional", "builder"]),
});

export const bootstrapCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => bootstrapSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: newCompanyId, error } = await callServerRpc(
      context.supabase,
      "bootstrap_company",
      {
        _company_name: data.company_name,
        _phone: data.phone,
        _plan: data.plan,
      },
    );
    if (error) {
      // Surface RPC error message; RLS/precondition failures raise 42501.
      throw new Error(error.message || "Could not create workspace");
    }
    return { ok: true as const, company_id: newCompanyId as string | null };
  });
