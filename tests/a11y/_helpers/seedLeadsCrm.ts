/**
 * Auto-seed helper for LeadsCRM Playwright specs.
 *
 * Why this exists
 * ---------------
 * `tests/a11y/leads-crm-axe.spec.ts` and any future LeadsCRM spec need
 * the /leads page to render *both* the Kanban board and the Table view
 * with actual data. On a clean tenant the page shows an empty state
 * only — no <LeadCard>, no stage badges, no per-row Select — and the
 * axe / tap-target checks would either pass vacuously or (worse) miss
 * regressions on the very controls the suite was written to guard.
 *
 * Implementation notes
 * --------------------
 * • Talks directly to PostgREST with the injected user access token,
 *   so RLS applies as that user. No service-role key needed and no
 *   admin escalation.
 * • `company_id` is left unset on insert — the `crm_leads.company_id`
 *   column DEFAULTs to `current_company_id()`, which reads from the
 *   authenticated JWT, guaranteeing the seed row lands in the caller's
 *   tenant regardless of which QA account is signed in.
 * • Every seeded row's `full_name` starts with `SEED_TAG` so the
 *   cleanup step is precise (never touches real customer rows) and
 *   any accidental leftover from a crashed run is trivially findable
 *   in the UI: search for "[pw-axe-seed]".
 * • One row per stage, with staggered `stage_entered_at` offsets so
 *   the "Xd in stage" badge in the Kanban card renders realistic
 *   varying values (0, 2, 5, 12, 30 days).
 *
 * Usage from a spec:
 *
 *   import { seedLeadsCrm } from './_helpers/seedLeadsCrm';
 *
 *   test.describe('LeadsCRM — ...', () => {
 *     let cleanup: (() => Promise<void>) | null = null;
 *     test.beforeAll(async () => {
 *       cleanup = await seedLeadsCrm();
 *     });
 *     test.afterAll(async () => { await cleanup?.(); });
 *   });
 */

// LEAD_STAGES is duplicated here (not imported from src/pages/LeadsCRM.tsx)
// on purpose — importing an app page into Playwright pulls the whole
// React/TanStack graph through vite-node and blows up on server-only
// modules. This list is the contract; if the app stages change,
// update both places and the axe spec's per-stage assertions.
const LEAD_STAGES = [
  "New Inquiry",
  "Site Visit Scheduled",
  "Negotiation",
  "Booking Done",
  "Lost",
] as const;

/** Prefix used on every seeded lead's full_name for precise cleanup. */
export const SEED_TAG = "[pw-axe-seed]";

const STAGE_AGE_DAYS: Record<(typeof LEAD_STAGES)[number], number> = {
  "New Inquiry": 0,
  "Site Visit Scheduled": 2,
  Negotiation: 5,
  "Booking Done": 12,
  Lost: 30,
};

type SessionShape = {
  access_token?: string;
};

function readSession(): { url: string; anonKey: string; accessToken: string } | null {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const anonKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY ??
    "";
  const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? "";
  if (!url || !anonKey || !sessionJson) return null;
  try {
    const parsed = JSON.parse(sessionJson) as SessionShape;
    if (!parsed.access_token) return null;
    return { url: url.replace(/\/+$/, ""), anonKey, accessToken: parsed.access_token };
  } catch {
    return null;
  }
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

/**
 * Seed one lead per stage into the current tenant. Returns a cleanup
 * function that removes exactly the rows this call inserted. Safe to
 * call from `test.beforeAll` — subsequent parallel runs each get their
 * own tagged rows (the tag also carries the workerIndex + timestamp).
 *
 * No-op (returns a noop cleanup) when the Playwright sandbox has no
 * injected Supabase session — the calling spec is already skipped in
 * that case, so we don't want to raise here.
 */
export async function seedLeadsCrm(
  opts: { workerIndex?: number } = {},
): Promise<() => Promise<void>> {
  const session = readSession();
  if (!session) return async () => {};

  const { url, anonKey, accessToken } = session;
  const runId = `${Date.now().toString(36)}-w${opts.workerIndex ?? 0}`;
  const authHeaders = {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  } as const;

  const rows = LEAD_STAGES.map((stage, i) => ({
    // `company_id` intentionally omitted — column DEFAULT is
    // current_company_id(), scoped to the caller's tenant via JWT.
    full_name: `${SEED_TAG} ${stage} #${i + 1} ${runId}`,
    mobile: `0300000${(1000 + i).toString().padStart(4, "0")}`,
    source: "Walk-in",
    stage,
    stage_entered_at: isoDaysAgo(STAGE_AGE_DAYS[stage]),
    budget_min: 5_000_000 + i * 1_000_000,
    budget_max: 10_000_000 + i * 1_000_000,
    // A follow-up 3 days out so the "Follow-up" row renders on Kanban
    // cards without triggering the destructive-tone due-soon styling
    // (which would require a color-contrast token variance the axe
    // spec doesn't need to exercise here).
    follow_up_date: isoDaysAgo(-3).slice(0, 10),
  }));

  const insertRes = await fetch(`${url}/rest/v1/crm_leads`, {
    method: "POST",
    headers: { ...authHeaders, Prefer: "return=representation" },
    body: JSON.stringify(rows),
  });

  if (!insertRes.ok) {
    const body = await insertRes.text();
    throw new Error(
      `seedLeadsCrm: insert failed [${insertRes.status}]: ${body}\n` +
        `→ Verify the injected Supabase session belongs to a signed-in user with insert access on public.crm_leads.`,
    );
  }

  const inserted = (await insertRes.json()) as Array<{ id: string }>;
  const ids = inserted.map((r) => r.id);

  return async function cleanup() {
    if (ids.length === 0) return;
    // Delete by primary key set to avoid a like-scan on full_name; RLS
    // still applies as the same user so we can only remove our own rows.
    const inClause = `(${ids.map((id) => `"${id}"`).join(",")})`;
    const delRes = await fetch(`${url}/rest/v1/crm_leads?id=in.${encodeURIComponent(inClause)}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    if (!delRes.ok) {
      const body = await delRes.text();
      // Non-fatal — surface as a console warning so CI logs make it
      // obvious that tagged rows leaked, without failing the run.
      // (The tag makes them trivially removable manually.)
      // eslint-disable-next-line no-console
      console.warn(
        `seedLeadsCrm.cleanup: delete failed [${delRes.status}]: ${body}\n` +
          `→ Leaked seed rows can be found with: full_name LIKE '${SEED_TAG}%${runId}'`,
      );
    }
  };
}
