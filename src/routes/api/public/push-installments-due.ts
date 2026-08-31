/**
 * Cron endpoint (called by pg_cron @ 09:00 daily): notify users about
 * installments due tomorrow.
 * Authenticated via Supabase apikey header (bypasses published-site auth
 * because the path lives under /api/public/*).
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/push-installments-due")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronSecret } = await import("@/lib/cron-auth.server");
        const unauth = verifyCronSecret(request);
        if (unauth) return unauth;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendPushToMany, loadSubscriptionsForUsers } = await import("@/lib/push.server");

        const start = new Date();
        start.setUTCHours(0, 0, 0, 0);
        start.setUTCDate(start.getUTCDate() + 1);
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 1);

        // Find installments due tomorrow. We alert the booking owner if we
        // can identify one; otherwise all company members with subscriptions.
        const { data: rows, error } = await supabaseAdmin
          .from("installment_ledger")
          .select("id, booking_id, due_date, amount, bookings ( company_id )")
          .gte("due_date", start.toISOString().slice(0, 10))
          .lt("due_date", end.toISOString().slice(0, 10))
          .limit(500);
        if (error)
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });

        const byCompany = new Map<string, number>();
        for (const r of (rows ?? []) as { bookings?: { company_id?: string | null } | null }[]) {
          const cid = r.bookings?.company_id;
          if (!cid) continue;
          byCompany.set(cid, (byCompany.get(cid) ?? 0) + 1);
        }
        if (byCompany.size === 0)
          return Response.json({ ok: true, sent: 0, note: "no due installments" });

        let sent = 0,
          failed = 0,
          removed = 0;
        for (const [companyId, count] of byCompany) {
          const { data: subs } = await supabaseAdmin
            .from("push_subscriptions")
            .select("id, endpoint, p256dh, auth, user_id")
            .eq("company_id", companyId);
          const subsClean = (subs ?? []) as {
            id: string;
            endpoint: string;
            p256dh: string;
            auth: string;
          }[];
          if (subsClean.length === 0) continue;
          const _ = await loadSubscriptionsForUsers([]);
          void _;
          const res = await sendPushToMany(subsClean, {
            title: "Installments due tomorrow",
            body: `${count} installment${count === 1 ? "" : "s"} due tomorrow. Tap to review.`,
            url: "/dashboard",
          });
          sent += res.sent;
          failed += res.failed;
          removed += res.removed;
        }
        return Response.json({ ok: true, sent, failed, removed, companies: byCompany.size });
      },
    },
  },
});
