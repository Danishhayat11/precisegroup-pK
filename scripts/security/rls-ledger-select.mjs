#!/usr/bin/env node
/**
 * RLS regression — SELECT on public.installment_ledger.
 *
 * Verifies that non-writer users (role='viewer' AND unassigned authenticated
 * users) cannot select ANY row from installment_ledger. Only writers
 * (admin/manager/staff) may read.
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_PUBLISHABLE_KEY
 *
 * Exit: 0 = pass, 1 = fail, 2 = misconfigured.
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!URL || !SRK || !PUB) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_PUBLISHABLE_KEY");
  process.exit(2);
}
const admin = createClient(URL, SRK, { auth: { persistSession: false, autoRefreshToken: false } });

let failures = 0;
const check = (id, ok, detail = "") => {
  const tag = ok ? "PASS" : "FAIL";
  (ok ? console.log : console.error)(detail ? `${tag} ${id} — ${detail}` : `${tag} ${id}`);
  if (!ok) failures++;
};

async function provision(role /* 'viewer' | 'staff' | null */) {
  const label = role ?? "unassigned";
  const email = `rls-ledger-${label}@precise.test`;
  const password = `Rls-${label}-${Math.random().toString(36).slice(2, 12)}!A9`;
  const { data: list, error: lerr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
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
  await admin.from("user_roles").delete().eq("user_id", user.id);
  if (role) {
    const { error } = await admin.from("user_roles").insert({ user_id: user.id, role });
    if (error) throw error;
  }
  const anon = createClient(URL, PUB, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: sess, error: serr } = await anon.auth.signInWithPassword({ email, password });
  if (serr) throw serr;
  return createClient(URL, PUB, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${sess.session.access_token}` } },
  });
}

async function main() {
  // Confirm the target table has at least one row via service role.
  const { count: total, error: cerr } = await admin
    .from("installment_ledger")
    .select("ledger_id", { count: "exact", head: true });
  if (cerr) {
    console.error("bootstrap error:", cerr.message);
    process.exit(2);
  }
  check("bootstrap.rows-exist", (total ?? 0) > 0, `service-role count=${total}`);

  for (const role of ["viewer", null]) {
    const label = role ?? "unassigned";
    const client = await provision(role);
    // SELECT * (with count) — RLS must reduce to zero rows for a non-writer.
    const { data, count, error } = await client
      .from("installment_ledger")
      .select("ledger_id", { count: "exact" })
      .limit(5);
    // Allowed outcomes: empty result set OR permission-denied error.
    const blocked = !!error || ((count ?? 0) === 0 && (data?.length ?? 0) === 0);
    check(
      `ledger.select.${label}.blocked`,
      blocked,
      error ? `err=${error.message}` : `rows=${data?.length ?? 0} count=${count}`,
    );

    // Probe a specific PII-like column to confirm no column-level leak.
    const { data: d2, error: e2 } = await client
      .from("installment_ledger")
      .select("particulars, amount")
      .limit(1);
    const blocked2 = !!e2 || (d2?.length ?? 0) === 0;
    check(
      `ledger.select-cols.${label}.blocked`,
      blocked2,
      e2 ? `err=${e2.message}` : `rows=${d2?.length ?? 0}`,
    );
  }

  // Sanity: every writer role (admin/manager/staff) MUST be able to read —
  // proves is_writer(auth.uid()) grants led_read to the full writer set and
  // the policy isn't just broken across the board.
  for (const role of ["admin", "manager", "staff"]) {
    const client = await provision(role);
    const {
      data: sd,
      error: se,
      count: sc,
    } = await client.from("installment_ledger").select("ledger_id", { count: "exact" }).limit(1);
    check(
      `ledger.select.${role}.allowed`,
      !se && (sc ?? 0) > 0,
      se ? `err=${se.message}` : `rows=${sd?.length ?? 0} count=${sc}`,
    );
  }

  console.log(
    failures === 0 ? "\nOK — ledger SELECT is writer-only." : `\n${failures} failure(s).`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("unexpected:", e);
  process.exit(2);
});
