#!/usr/bin/env node
/**
 * DB-constraint regression — profiles.active_project_code FK.
 *
 * Verifies the FK added in
 *   20260707074500_profiles_active_project_code_fk.sql
 * behaves correctly for every documented case:
 *
 *   1. NULL is allowed (no active project selected).
 *   2. A real project_code is allowed.
 *   3. A bogus project_code is REJECTED with PostgREST error code 23503
 *      (foreign_key_violation).
 *   4. Deleting a referenced project cascades to SET NULL on the profile
 *      (not DELETE — profile row must survive).
 *   5. Renaming a project_code CASCADEs the new value to the profile.
 *
 * All mutations run via the service-role client so RLS never masks a
 * constraint failure. Every side effect is snapshotted and restored,
 * including a disposable test project created for the delete/rename
 * cases so no real project ever gets removed.
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_PUBLISHABLE_KEY
 *
 * Exit codes:
 *   0  all assertions passed
 *   1  one or more assertions failed (a constraint regression)
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

const TEST_EMAIL = "rls-profile-fk@precise.test";
// Suffixed with `Date.now()` so a leftover row from a crashed prior run
// never blocks the current test's INSERT.
const RUN = Date.now();
const TEST_PROJECT_CODE = `FKTEST-${RUN}`;
const RENAMED_PROJECT_CODE = `FKTEST-R-${RUN}`;

const results = [];
function check(id, ok, detail = "") {
  results.push({ id, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  const line = detail ? `${tag} ${id} — ${detail}` : `${tag} ${id}`;
  (ok ? console.log : console.error)(line);
}

async function provisionUser() {
  const password = `Fk-prof-${Math.random().toString(36).slice(2, 12)}!A9`;
  const { data: list, error: lerr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (lerr) throw lerr;
  let user = list.users.find((u) => u.email === TEST_EMAIL);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
  }
  return user.id;
}

async function ensureTestProject(code) {
  // Insert with the minimum required columns. `project_name` is NOT NULL
  // in the existing schema; we set an obviously-disposable name so the
  // row is easy to identify if cleanup ever fails partway.
  const { error } = await admin.from("projects").upsert(
    { project_code: code, project_name: `__fk_test_${RUN}` },
    {
      onConflict: "project_code",
    },
  );
  if (error) throw new Error(`ensureTestProject(${code}): ${error.message}`);
}

async function readActive(userId) {
  const { data, error } = await admin
    .from("profiles")
    .select("active_project_code")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.active_project_code ?? null;
}

async function cleanup(userId, originalActive) {
  // Restore the profile's original active_project_code (best-effort) and
  // drop both the original + renamed test project rows if they still exist.
  try {
    await admin.from("profiles").update({ active_project_code: originalActive }).eq("id", userId);
  } catch (e) {
    console.error("cleanup: restore profile failed:", e?.message ?? e);
  }
  for (const code of [TEST_PROJECT_CODE, RENAMED_PROJECT_CODE]) {
    try {
      await admin.from("projects").delete().eq("project_code", code);
    } catch (e) {
      // Non-fatal — a leftover FKTEST-* row is harmless and will be
      // upserted-over on the next run.
      console.error(`cleanup: delete project ${code} failed:`, e?.message ?? e);
    }
  }
}

async function main() {
  const userId = await provisionUser();
  // Ensure a profiles row exists so subsequent UPDATEs affect >0 rows.
  const { error: seedErr } = await admin
    .from("profiles")
    .upsert({ id: userId, active_project_code: null }, { onConflict: "id" });
  if (seedErr) {
    console.error("seed profile failed:", seedErr.message);
    process.exit(2);
  }
  const originalActive = await readActive(userId);
  await ensureTestProject(TEST_PROJECT_CODE);

  try {
    // ── (1) NULL is allowed ───────────────────────────────────────────
    {
      const { error } = await admin
        .from("profiles")
        .update({ active_project_code: null })
        .eq("id", userId);
      check(
        "profiles.active_project_code.null.allowed",
        !error,
        error ? `err=${error.message}` : "",
      );
    }

    // ── (2) real project_code is allowed ─────────────────────────────
    {
      const { error } = await admin
        .from("profiles")
        .update({ active_project_code: TEST_PROJECT_CODE })
        .eq("id", userId);
      const persisted = await readActive(userId);
      check(
        "profiles.active_project_code.valid.allowed",
        !error && persisted === TEST_PROJECT_CODE,
        error ? `err=${error.message}` : `persisted=${persisted}`,
      );
    }

    // ── (3) bogus project_code is REJECTED (23503) ───────────────────
    {
      const bogus = `NOPE-${RUN}-DOES-NOT-EXIST`;
      const { error } = await admin
        .from("profiles")
        .update({ active_project_code: bogus })
        .eq("id", userId);
      // supabase-js surfaces PostgREST error `code` as the Postgres SQLSTATE
      // for constraint violations. 23503 = foreign_key_violation.
      const isFk = !!error && (error.code === "23503" || /foreign key/i.test(error.message ?? ""));
      check(
        "profiles.active_project_code.invalid.rejected",
        isFk,
        error ? `code=${error.code} msg=${error.message}` : "UPDATE unexpectedly succeeded",
      );
      const persisted = await readActive(userId);
      check(
        "profiles.active_project_code.invalid.state-unchanged",
        persisted === TEST_PROJECT_CODE,
        `persisted=${persisted} (should still be ${TEST_PROJECT_CODE})`,
      );
    }

    // ── (5) rename cascades (do BEFORE delete so the profile still ────
    //        points at a real row when we test SET NULL below)
    {
      const { error } = await admin
        .from("projects")
        .update({ project_code: RENAMED_PROJECT_CODE })
        .eq("project_code", TEST_PROJECT_CODE);
      const persisted = await readActive(userId);
      check(
        "profiles.active_project_code.rename.cascade",
        !error && persisted === RENAMED_PROJECT_CODE,
        error
          ? `err=${error.message}`
          : `persisted=${persisted} (expected ${RENAMED_PROJECT_CODE})`,
      );
    }

    // ── (4) deleting the referenced project SETs the profile to NULL ─
    {
      const { error } = await admin
        .from("projects")
        .delete()
        .eq("project_code", RENAMED_PROJECT_CODE);
      const persisted = await readActive(userId);
      // Cross-check the profile row itself still exists (SET NULL, not CASCADE).
      const { data: row } = await admin
        .from("profiles")
        .select("id")
        .eq("id", userId)
        .maybeSingle();
      check(
        "profiles.active_project_code.delete.cascade-set-null",
        !error && persisted === null && !!row,
        error ? `err=${error.message}` : `persisted=${persisted} row=${!!row}`,
      );
    }
  } finally {
    await cleanup(userId, originalActive);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\nprofiles.active_project_code FK: ${results.length - failed.length}/${results.length} passed`,
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
