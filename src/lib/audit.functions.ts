import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const auditSchema = z.object({
  eventType: z.string(),
  resource: z.string(),
  metadata: z.record(z.string(), z.any()).default({}),
});

/**
 * Audit Log Server Function
 *
 * Thin wrapper around the security-definer database function.
 * Used to record security-relevant events from the server runtime.
 */
export const recordAuditLog = createServerFn({ method: "POST" })
  .inputValidator(auditSchema)
  .handler(async ({ data }: any) => {
    // Read environment variables or perform sensitive logic inside .handler()
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Use the RPC call to invoke the security definer function via admin client
    // Cast to any to bypass potential type mismatches in generated client for RPC arguments
    const { data: logId, error } = await (supabaseAdmin as any).rpc("log_admin_access_event", {
      _event_type: data.eventType,
      _resource: data.resource,
      _metadata: data.metadata,
    });

    if (error) {
      console.error("[audit] Failed to record audit log:", error);
      return { success: false, error: error.message };
    }

    return { success: true, id: logId };
  });
