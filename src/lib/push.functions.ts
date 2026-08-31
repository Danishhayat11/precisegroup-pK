import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Publish the VAPID public key so the browser can subscribe. Public read is safe. */
export const getVapidPublicKey = createServerFn({ method: "GET" }).handler(async () => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) throw new Error("VAPID public key not configured");
  return { publicKey: key };
});

const subscribeInput = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  userAgent: z.string().optional(),
});

/** Save (or upsert) the browser subscription for the signed-in user. */
export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => subscribeInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Fetch active company (best-effort) to tag the subscription.
    let companyId: string | null = null;
    try {
      const { data: prof } = await supabase
        .from("profiles")
        .select("active_company_id")
        .eq("id", userId)
        .maybeSingle();
      companyId = (prof as { active_company_id?: string | null } | null)?.active_company_id ?? null;
    } catch {
      /* noop */
    }

    const row = {
      user_id: userId,
      company_id: companyId,
      endpoint: data.endpoint,
      p256dh: data.p256dh,
      auth: data.auth,
      user_agent: data.userAgent ?? null,
      last_used_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(row, { onConflict: "endpoint" });
    if (error) {
      // Surface RLS / tenant-scope violations to both server logs and the
      // tenant_scope_logs audit table so ops can alert on them.
      const code = (error as { code?: string }).code ?? "";
      const message = error.message ?? "";
      const isRlsViolation =
        code === "42501" || // insufficient_privilege
        code === "23514" || // check_violation (our BEFORE trigger)
        /row-level security|check constraint|tenant context|company_id/i.test(message);

      if (isRlsViolation) {
        console.error(
          "[push_subscriptions] rejected write",
          JSON.stringify({
            user_id: userId,
            attempted_company_id: companyId,
            endpoint_host: safeHost(data.endpoint),
            code,
            message,
          }),
        );
        // Best-effort audit row; never let logging failure mask the original error.
        try {
          await supabase.from("tenant_scope_logs").insert({
            user_id: userId,
            company_id: companyId,
            fn_path: "savePushSubscription",
            status: `rejected:${code || "rls"}`,
          });
        } catch {
          /* noop */
        }
      } else {
        console.error("[push_subscriptions] upsert failed", message);
      }
      throw new Error(error.message);
    }
    return { ok: true };
  });

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid";
  }
}

/** Remove a subscription by endpoint (called on unsubscribe or when the browser rotates it). */
export const deletePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ endpoint: z.string().url() }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", data.endpoint);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Send a test push to the current user (used to confirm the setup works). */
export const sendTestPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    const subs = (data ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[];
    if (subs.length === 0)
      return { sent: 0, failed: 0, removed: 0, message: "No devices subscribed" };
    const { sendPushToMany } = await import("@/lib/push.server");
    const res = await sendPushToMany(subs, {
      title: "Precise ERP",
      body: "Notifications are enabled on this device.",
      url: "/dashboard",
    });
    return { ...res, message: `Sent to ${res.sent} of ${subs.length} device(s)` };
  });
