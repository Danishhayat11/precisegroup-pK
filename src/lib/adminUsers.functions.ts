import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callRpc } from "@/integrations/supabase/approvedRpc";
import { callServerRpc } from "@/integrations/supabase/serverRpc";

/** Verify caller is admin OR owner (owner is a superset of admin). */
async function assertAdmin(supabase: any, userId: string) {
  const { data: isAdmin, error: e1 } = await callRpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (e1) throw new Error(e1.message);
  if (isAdmin) return;
  const { data: isOwner, error: e2 } = await callRpc("has_role", {
    _user_id: userId,
    _role: "owner",
  });
  if (e2) throw new Error(e2.message);
  if (!isOwner) throw new Error("Admin access required");
}

const inviteSchema = z.object({
  email: z.string().email(),
  full_name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(["admin", "manager", "staff", "viewer"]).default("staff"),
});

export const adminInviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => inviteSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    // Always create a company_invitations row so admins can copy a shareable
    // link even when email delivery is unavailable. `handle_new_user` reads
    // the token from raw_user_meta_data on sign-up and slots the user into
    // this company with the correct role.
    const { data: inv, error: invErr } = await callServerRpc(
      context.supabase,
      "admin_create_invitation",
      { _email: data.email, _role: data.role },
    );
    if (invErr) throw new Error(invErr.message);

    const invRow: any = Array.isArray(inv) ? (inv as any[])[0] : inv;
    const token: string | undefined = invRow?.token;
    const expires_at: string | undefined = invRow?.expires_at;

    // Best-effort email invite via Supabase Auth. If the mailer isn't
    // configured, we still return the copy-link so the admin can share it
    // by hand — that's why email failure is downgraded to a warning.
    let email_sent = false;
    let email_error: string | null = null;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
        data: {
          full_name: data.full_name ?? null,
          invitation_token: token,
        },
      });
      if (error) email_error = error.message;
      else email_sent = true;
    } catch (e: any) {
      email_error = e?.message ?? "email delivery failed";
    }

    return {
      ok: true as const,
      token,
      expires_at,
      email_sent,
      email_error,
    };
  });

const setRoleSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(["admin", "manager", "staff", "viewer"]),
});

export const adminSetRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => setRoleSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await callServerRpc(context.supabase, "admin_set_role", {
      _user: data.user_id,
      _role: data.role,
    });

    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const setActiveSchema = z.object({
  user_id: z.string().uuid(),
  active: z.boolean(),
});

export const adminSetUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => setActiveSchema.parse(d))
  .handler(async ({ data, context }) => {
    if (data.user_id === context.userId) {
      throw new Error("You cannot deactivate your own account.");
    }
    const { error } = await callServerRpc(context.supabase, "admin_set_user_active", {
      _user: data.user_id,
      _active: data.active,
    });

    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const transferSchema = z.object({ new_owner_id: z.string().uuid() });

export const adminTransferOwnership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => transferSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await callServerRpc(context.supabase, "admin_transfer_ownership", {
      _new_owner: data.new_owner_id,
    });

    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await callServerRpc(context.supabase, "admin_list_users");
    if (error) throw new Error(error.message);
    return (data ?? []) as {
      id: string;
      email: string | null;
      full_name: string | null;
      role: "owner" | "admin" | "manager" | "staff" | "viewer" | null;
      last_sign_in_at: string | null;
      is_active: boolean;
    }[];
  });
