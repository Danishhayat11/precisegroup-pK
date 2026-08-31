/**
 * CI endpoint: runs a headless tenant-isolation check with the service-role
 * client and returns HTTP 200 on pass, HTTP 500 on any detected leak.
 *
 * Called from a GitHub Actions workflow, not from the browser.
 * `/api/public/*` bypasses Lovable auth, so the handler MUST verify the
 * shared secret (HMAC over the raw body) before doing anything.
 *
 * Env:
 *   CI_ISOLATION_SECRET — shared with the GitHub Actions secret of the same name.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

const TENANT_1_ID = "00000000-0000-0000-0000-000000000001";
const TENANT_2_ID = "00000000-0000-0000-0000-000000000002";
const MARKER_PREFIX = "CI-ISOLATION-";

type Check = {
  name: string;
  passed: boolean;
  detail: string;
};

function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.CI_ISOLATION_SECRET;
  if (!secret || !header) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = header.trim().toLowerCase();
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch {
    return false;
  }
}

async function runChecks(): Promise<{ ok: boolean; checks: Check[]; marker: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const marker = `${MARKER_PREFIX}${Date.now()}`;
  const checks: Check[] = [];
  let insertedId: string | null = null;

  try {
    // 1. Insert marker into tenant #1 via admin.
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("crm_leads")
      .insert({
        full_name: marker,
        mobile: "0000000000",
        source: "Walk-in",
        stage: "New Inquiry",
        notes: "Automated CI isolation check. Auto-deleted.",
        company_id: TENANT_1_ID,
      })
      .select("id")
      .single();
    if (insErr) {
      checks.push({ name: "seed_marker", passed: false, detail: insErr.message });
      return { ok: false, checks, marker };
    }
    insertedId = (inserted as { id: string }).id;
    checks.push({ name: "seed_marker", passed: true, detail: `id=${insertedId}` });

    // 2. Marker must appear under tenant #1.
    const { count: c1, error: c1Err } = await supabaseAdmin
      .from("crm_leads")
      .select("id", { count: "exact", head: true })
      .eq("company_id", TENANT_1_ID)
      .eq("full_name", marker);
    checks.push({
      name: "marker_visible_in_tenant_1",
      passed: !c1Err && (c1 ?? 0) === 1,
      detail: c1Err?.message ?? `count=${c1 ?? 0}`,
    });

    // 3. Marker must NOT appear under tenant #2.
    const { count: c2, error: c2Err } = await supabaseAdmin
      .from("crm_leads")
      .select("id", { count: "exact", head: true })
      .eq("company_id", TENANT_2_ID)
      .eq("full_name", marker);
    checks.push({
      name: "marker_absent_in_tenant_2",
      passed: !c2Err && (c2 ?? 0) === 0,
      detail: c2Err?.message ?? `count=${c2 ?? 0}`,
    });

    // 4. Cross-tenant leakage sample across core tables: no row of tenant #1
    //    may share id/booking_id with a row of tenant #2 for the same table.
    // Untyped view over the admin client so we can iterate dynamic table names.
    const admin = supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          eq: (
            col: string,
            val: string,
          ) => {
            limit: (n: number) => Promise<{
              data: Array<Record<string, unknown>> | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };
    const tables: { table: string; keyColumn: string }[] = [
      { table: "crm_leads", keyColumn: "id" },
      { table: "bookings", keyColumn: "booking_id" },
      { table: "payments", keyColumn: "receipt_no" },
      { table: "clients", keyColumn: "client_ref" },
    ];
    for (const { table, keyColumn } of tables) {
      const [t1, t2] = await Promise.all([
        admin.from(table).select(keyColumn).eq("company_id", TENANT_1_ID).limit(2000),
        admin.from(table).select(keyColumn).eq("company_id", TENANT_2_ID).limit(2000),
      ]);
      if (t1.error || t2.error) {
        checks.push({
          name: `no_key_overlap:${table}`,
          passed: false,
          detail: t1.error?.message ?? t2.error?.message ?? "unknown",
        });
        continue;
      }
      const rowsA = t1.data ?? [];
      const rowsB = t2.data ?? [];
      const s1 = new Set(rowsA.map((r) => String(r[keyColumn])));
      const overlap: string[] = [];
      for (const row of rowsB) {
        const k = String(row[keyColumn]);
        if (s1.has(k)) overlap.push(k);
        if (overlap.length >= 5) break;
      }
      checks.push({
        name: `no_key_overlap:${table}`,
        passed: overlap.length === 0,
        detail:
          overlap.length === 0
            ? `t1=${rowsA.length} t2=${rowsB.length}`
            : `LEAK overlap on ${keyColumn}: ${overlap.join(",")}`,
      });
    }
  } finally {
    if (insertedId) {
      await supabaseAdmin.from("crm_leads").delete().eq("id", insertedId);
    }
  }

  return { ok: checks.every((c) => c.passed), checks, marker };
}

export const Route = createFileRoute("/api/public/isolation-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.CI_ISOLATION_SECRET;
        if (!secret) {
          return Response.json(
            { ok: false, error: "CI_ISOLATION_SECRET is not configured on the server." },
            { status: 503 },
          );
        }
        const rawBody = await request.text();
        const sig = request.headers.get("x-ci-signature");
        if (!verifySignature(rawBody, sig)) {
          return new Response("Invalid signature", { status: 401 });
        }

        try {
          const result = await runChecks();
          // Non-2xx when isolation fails, so CI curl/`--fail` breaks the build.
          return Response.json(result, { status: result.ok ? 200 : 500 });
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }
      },
    },
  },
});
