#!/usr/bin/env node
/**
 * RLS PII-select regression — full role matrix.
 *
 * Verifies at runtime that RLS on client-PII and financial tables:
 *   - BLOCKS `viewer` role AND unassigned authenticated users from
 *     reading any rows or PII columns
 *   - ALLOWS every writer role (`admin`, `manager`, `staff`) to read
 *
 * The check is idempotent and non-destructive: it only performs SELECTs,
 * plus role provisioning via the Auth Admin API + user_roles.
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_PUBLISHABLE_KEY
 *
 * Exit codes:
 *   0  all assertions passed
 *   1  one or more assertions failed
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

// Every table + PII/financial columns we require RLS to gate on writer role.
// `allowed` narrows the positive-control set for tables whose policy is
// stricter than "all writers" (e.g. admin-only history, project-scoped docs).
const TARGETS = [
  { tag: "clients", table: "clients", columns: "cnic,mobile,address" },
  { tag: "payments", table: "payments", columns: "amount,cnic" },
  {
    tag: "installment_ledger",
    table: "installment_ledger",
    columns: "due_amount,particulars,client_name",
  },
  { tag: "bookings", table: "bookings", columns: "booking_id,client_name" },
  { tag: "adjustments", table: "adjustments", columns: "approved_value,note,client_name" },
  { tag: "payment_comments", table: "payment_comments", columns: "body,client_name" },
  { tag: "payment_allocations", table: "payment_allocations", columns: "amount,ledger_id" },
  { tag: "dealers", table: "dealers", columns: "*" },
  { tag: "units", table: "units", columns: "unit_id,booked_by,linked_booking_id" },
  // booking_documents: admin OR (writer AND same-active-project). Manager
  // has no active-project scope in this test env, so only admin+staff read.
  {
    tag: "booking_documents",
    table: "booking_documents",
    columns: "booking_id",
    allowed: ["admin", "staff"],
  },
  // payment_edit_history + plan_restructure_history: admin-only audit trails.
  {
    tag: "payment_edit_history",
    table: "payment_edit_history",
    columns: "*",
    allowed: ["admin"],
    blockedWriters: ["manager", "staff"],
  },
  {
    tag: "plan_restructure_history",
    table: "plan_restructure_history",
    columns: "*",
    allowed: ["admin"],
    blockedWriters: ["manager", "staff"],
  },
];

const WRITER_ROLES = ["admin", "manager", "staff"];
const NON_WRITERS = ["viewer", null]; // null = authenticated but unassigned

const results = [];
function check(id, ok, detail = "") {
  results.push({ id, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  const line = detail ? `${tag} ${id} — ${detail}` : `${tag} ${id}`;
  (ok ? console.log : console.error)(line);
}

async function provisionUser(role) {
  const label = role ?? "unassigned";
  const email = `rls-${label}@precise.test`;
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
    const { error: rerr } = await admin.from("user_roles").insert({ user_id: user.id, role });
    if (rerr) throw rerr;
  }
  const anon = createClient(URL, PUB, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: sess, error: serr } = await anon.auth.signInWithPassword({ email, password });
  if (serr) throw serr;
  const client = createClient(URL, PUB, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${sess.session.access_token}` } },
  });
  return { userId: user.id, client, token: sess.session.access_token };
}

/**
 * Non-writer must not see any rows / must receive a permission error.
 * Acceptable "blocked" outcomes:
 *   - PostgREST error (permission denied / policy failure)
 *   - Success with an empty array (RLS filtered every row out)
 */
async function assertBlocked({ table, columns, sess, tag, label }) {
  const { data, error } = await sess.client.from(table).select(columns).limit(1);
  const blocked = !!error || (Array.isArray(data) && data.length === 0);
  check(
    `${tag}.${label}.select.blocked`,
    blocked,
    error ? `err=${error.message}` : `rows=${data?.length ?? 0}`,
  );
}

async function assertAllowed({ table, columns, sess, tag, role }) {
  const { count } = await admin.from(table).select("*", { count: "exact", head: true });
  if (!count) {
    check(`${tag}.${role}.select.skipped`, true, "no rows in table");
    return;
  }
  const { data, error } = await sess.client.from(table).select(columns).limit(1);
  const ok = !error && Array.isArray(data) && data.length === 1;
  check(
    `${tag}.${role}.select.allowed`,
    ok,
    error ? `err=${error.message}` : `rows=${data?.length ?? 0}`,
  );
}

async function main() {
  const sessions = {};
  for (const r of [...NON_WRITERS, ...WRITER_ROLES]) {
    sessions[r ?? "unassigned"] = await provisionUser(r);
  }

  for (const t of TARGETS) {
    const allowed = t.allowed ?? WRITER_ROLES;
    const blockedWriters = t.blockedWriters ?? [];
    for (const r of NON_WRITERS) {
      await assertBlocked({ ...t, sess: sessions[r ?? "unassigned"], label: r ?? "unassigned" });
    }
    for (const r of blockedWriters) {
      await assertBlocked({ ...t, sess: sessions[r], label: r });
    }
    for (const r of allowed) {
      await assertAllowed({ ...t, sess: sessions[r], role: r });
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.error(`\n${failed.length} failures:`);
    for (const f of failed) console.error(` - ${f.id}${f.detail ? ` (${f.detail})` : ""}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("provisioning / setup error:", err?.message ?? err);
  process.exit(2);
});
