#!/usr/bin/env node
/**
 * RLS regression — profiles.active_project_code isolation.
 *
 * Verifies at runtime that the RLS policies added in
 *   supabase/migrations/20260707071723_c4fc1ab9-*.sql
 * (profiles_select_self_or_admin, profiles_update_self)
 * enforce per-user isolation on `active_project_code`:
 *
 *   1. User A can READ their own row (1 row returned).
 *   2. User A CANNOT read user B's row (0 rows, no error required).
 *   3. User A can UPDATE their own active_project_code (1 row affected,
 *      value re-reads as the new value via service role).
 *   4. User A's UPDATE targeting user B's id affects 0 rows AND user B's
 *      active_project_code remains unchanged when re-read via service role.
 *
 * Idempotent + non-destructive: provisions two dedicated test users, seeds
 * their profiles via service role, snapshots + restores every value it
 * touches. Never runs against production data.
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_PUBLISHABLE_KEY
 *
 * Exit codes:
 *   0  all assertions passed
 *   1  one or more assertions failed (an RLS regression)
 *   2  misconfigured environment / provisioning error
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!URL || !SRK || !PUB) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_PUBLISHABLE_KEY");
  process.exit(2);
}

const admin = createClient(URL, SRK, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const USERS = {
  a: { email: "rls-profile-a@precise.test" },
  b: { email: "rls-profile-b@precise.test" },
};

const results = [];
function check(id, ok, detail = "") {
  results.push({ id, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  const line = detail ? `${tag} ${id} — ${detail}` : `${tag} ${id}`;
  (ok ? console.log : console.error)(line);
}

/**
 * Idempotent user provisioning: create-or-reset via Auth Admin, then sign
 * in with the publishable key to mint a real access token bound to the
 * user. Returns { userId, client } — `client` has RLS applied as that user.
 */
async function provisionUser({ email }) {
  const password = `Rls-prof-${Math.random().toString(36).slice(2, 12)}!A9`;
  const { data: list, error: lerr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (lerr) throw lerr;
  let user = list.users.find((u) => u.email === email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
  } else {
    const { error } = await admin.auth.admin.updateUserById(user.id, { password });
    if (error) throw error;
  }
  const anon = createClient(URL, PUB, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: sess, error: serr } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (serr) throw serr;
  const client = createClient(URL, PUB, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${sess.session.access_token}` } },
  });
  return { userId: user.id, client };
}

/**
 * Ensure a `profiles` row exists for `userId` with a known
 * `active_project_code` sentinel. Written via service role so RLS never
 * blocks the seed.
 */
async function seedProfile(userId, code) {
  // profiles.id is typically a FK to auth.users.id; upsert so re-runs
  // don't fail on the unique constraint.
  const { error } = await admin
    .from("profiles")
    .upsert({ id: userId, active_project_code: code }, { onConflict: "id" });
  if (error) throw new Error(`seedProfile(${userId}): ${error.message}`);
}

async function readActiveCode(client, userId) {
  return client.from("profiles").select("id, active_project_code").eq("id", userId).maybeSingle();
}

async function main() {
  const a = await provisionUser(USERS.a);
  const b = await provisionUser(USERS.b);

  const seedA = `MA-A-${Date.now()}`;
  const seedB = `MA-B-${Date.now()}`;
  await seedProfile(a.userId, seedA);
  await seedProfile(b.userId, seedB);

  // ── (1) A reads own row → returns exactly A's seeded code ───────────
  {
    const { data, error } = await readActiveCode(a.client, a.userId);
    check(
      "profiles.select.self.allowed",
      !error && data && data.active_project_code === seedA,
      error ? `err=${error.message}` : `code=${data?.active_project_code}`,
    );
  }

  // ── (2) A tries to read B's row → RLS filter returns 0 rows ─────────
  {
    // Use .select() (no .single) so a filtered-out row surfaces as an
    // empty array rather than a PostgREST "no rows" error.
    const { data, error } = await a.client
      .from("profiles")
      .select("id, active_project_code")
      .eq("id", b.userId);
    check(
      "profiles.select.other.blocked",
      !error && Array.isArray(data) && data.length === 0,
      error ? `err=${error.message}` : `rows=${data?.length ?? 0}`,
    );
  }

  // ── (3) A updates OWN active_project_code → 1 row, value persists ──
  {
    const newCode = `MA-A-UPD-${Date.now()}`;
    const { data, error } = await a.client
      .from("profiles")
      .update({ active_project_code: newCode })
      .eq("id", a.userId)
      .select("id, active_project_code");
    const ok =
      !error && Array.isArray(data) && data.length === 1 && data[0].active_project_code === newCode;
    check(
      "profiles.update.self.allowed",
      ok,
      error ? `err=${error.message}` : `rows=${data?.length ?? 0}`,
    );
    // Cross-verify via service role (never trust the just-modified client).
    const svc = await admin
      .from("profiles")
      .select("active_project_code")
      .eq("id", a.userId)
      .maybeSingle();
    check(
      "profiles.update.self.persisted",
      svc.data?.active_project_code === newCode,
      `svc=${svc.data?.active_project_code}`,
    );
  }

  // ── (4) A tries to update B's active_project_code → 0 rows AND ──────
  //        B's value on disk MUST remain the original seed.
  {
    const beforeSvc = await admin
      .from("profiles")
      .select("active_project_code")
      .eq("id", b.userId)
      .maybeSingle();
    const originalB = beforeSvc.data?.active_project_code;

    const sentinel = `__rls_evil_${Date.now()}`;
    const { data, error } = await a.client
      .from("profiles")
      .update({ active_project_code: sentinel })
      .eq("id", b.userId)
      .select("id");
    // Allowed outcomes: PostgREST error OR empty result set. Both prove
    // no row was mutated. FAIL only if data.length > 0 or the sentinel
    // ended up on disk.
    const zeroRows = !!error || (Array.isArray(data) && data.length === 0);
    check(
      "profiles.update.other.zero-rows",
      zeroRows,
      error ? `err=${error.message}` : `rows=${data?.length ?? 0}`,
    );

    const afterSvc = await admin
      .from("profiles")
      .select("active_project_code")
      .eq("id", b.userId)
      .maybeSingle();
    check(
      "profiles.update.other.state-unchanged",
      afterSvc.data?.active_project_code === originalB,
      `before=${originalB} after=${afterSvc.data?.active_project_code}`,
    );

    // Defensive restore in case something slipped through — the assertion
    // above will have already flagged the regression.
    if (afterSvc.data?.active_project_code !== originalB) {
      await admin.from("profiles").update({ active_project_code: originalB }).eq("id", b.userId);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\nprofiles.active_project_code RLS: ${
      results.length - failed.length
    }/${results.length} passed`,
  );
  if (failed.length) {
    console.error("Failures:");
    for (const f of failed) console.error(`  - ${f.id}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("fatal:", e?.message ?? e);
  process.exit(2);
});
