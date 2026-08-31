/**
 * Cron endpoint (called by pg_cron @ 09:00 daily): notify assigned users
 * about CRM leads with a follow-up due today.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/push-lead-followups-due")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronSecret } = await import("@/lib/cron-auth.server");
        const unauth = verifyCronSecret(request);
        if (unauth) return unauth;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendPushToMany } = await import("@/lib/push.server");

        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const end = new Date(today);
        end.setUTCDate(end.getUTCDate() + 1);

        const { data: leads, error } = await supabaseAdmin
          .from("crm_leads")
          .select("id, full_name, follow_up_date, assigned_to, company_id")
          .gte("follow_up_date", today.toISOString().slice(0, 10))
          .lt("follow_up_date", end.toISOString().slice(0, 10))
          .limit(500);
        if (error)
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });

        // Group by assigned user; leads without an owner ping the company.
        const byUser = new Map<string, number>();
        const byCompany = new Map<string, number>();
        for (const l of (leads ?? []) as {
          assigned_to?: string | null;
          company_id?: string | null;
        }[]) {
          if (l.assigned_to) byUser.set(l.assigned_to, (byUser.get(l.assigned_to) ?? 0) + 1);
          else if (l.company_id)
            byCompany.set(l.company_id, (byCompany.get(l.company_id) ?? 0) + 1);
        }

        let sent = 0,
          failed = 0,
          removed = 0;
        const push = async (
          subs: { id: string; endpoint: string; p256dh: string; auth: string }[],
          count: number,
        ) => {
          if (subs.length === 0) return;
          const r = await sendPushToMany(subs, {
            title: "Lead follow-ups due today",
            body: `${count} lead${count === 1 ? "" : "s"} to follow up. Tap to open CRM.`,
            url: "/crm",
          });
          sent += r.sent;
          failed += r.failed;
          removed += r.removed;
        };

        for (const [uid, count] of byUser) {
          const { data: subs } = await supabaseAdmin
            .from("push_subscriptions")
            .select("id, endpoint, p256dh, auth")
            .eq("user_id", uid);
          await push(
            (subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[],
            count,
          );
        }
        for (const [cid, count] of byCompany) {
          const { data: subs } = await supabaseAdmin
            .from("push_subscriptions")
            .select("id, endpoint, p256dh, auth")
            .eq("company_id", cid);
          await push(
            (subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[],
            count,
          );
        }

        return Response.json({
          ok: true,
          sent,
          failed,
          removed,
          users: byUser.size,
          companies: byCompany.size,
        });
      },
    },
  },
});
