import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";

const createShareSchema = z.object({
  reportId: z.string().uuid(),
  filters: z.record(z.string(), z.any()),
  expiresInDays: z.number().min(1).max(365).optional().default(7),
});

const shareIdSchema = z.object({
  shareId: z.string().uuid(),
});

/**
 * Creates a shareable link for a report.
 * Requires authentication.
 */
export const createShareableLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createShareSchema.parse(input))
  .handler(async ({ data, context }) => {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + data.expiresInDays);

    const { data: share, error } = await context.supabase
      .from("security_report_shares")
      .insert({
        filters: data.filters as Json,
        expires_at: expiresAt.toISOString(),
        created_by: context.userId,
      })
      .select("id, share_token")
      .single();

    if (error) throw new Error(`Failed to create share: ${error.message}`);

    return {
      shareId: share.id,
      token: share.share_token,
      expiresAt: expiresAt.toISOString(),
    };
  });

/**
 * Lists active shares created by the user.
 * Requires authentication.
 */
export const listActiveShares = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("security_report_shares")
      .select("*")
      .eq("created_by", context.userId)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Failed to list shares: ${error.message}`);
    return data;
  });

/**
 * Revokes (deletes) a shareable link.
 * Requires authentication.
 */
export const revokeShareableLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => shareIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("security_report_shares")
      .delete()
      .eq("id", data.shareId)
      .eq("created_by", context.userId);

    if (error) throw new Error(`Failed to revoke share: ${error.message}`);
    return { success: true };
  });

/**
 * Gets access logs for a specific share.
 * Requires authentication.
 */
export const getAccessLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => shareIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    // First verify ownership of the share
    const { data: share, error: shareError } = await context.supabase
      .from("security_report_shares")
      .select("id")
      .eq("id", data.shareId)
      .eq("created_by", context.userId)
      .single();

    if (shareError || !share) {
      throw new Error("Unauthorized or share not found");
    }

    // Using any since the table might not be in the types yet
    const { data: logs, error } = await (
      context.supabase.from("security_report_access_logs" as any) as any
    )
      .select("*")
      .eq("share_id", data.shareId)
      .order("accessed_at", { ascending: false });

    if (error) throw new Error(`Failed to get access logs: ${error.message}`);
    return logs;
  });
