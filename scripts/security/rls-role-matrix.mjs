#!/usr/bin/env node
/**
 * RLS role-matrix regression.
 *
 * Verifies at runtime that RLS blocks non-admin (staff) users from
 * UPDATE / DELETE on financial tables while admins can mutate them
 * (directly or via admin_* RPCs). The check is idempotent and
 * non-destructive: it snapshots each target row, attempts mutations,
 * asserts DB state, then restores.
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_PUBLISHABLE_KEY
 *
 * Exit codes:
 *   0  all matrix assertions passed
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

const admin = createClient(URL, SRK, { auth: { persistSession: false, autoRefreshToken: false } });

const USERS = {
  admin: { email: "rls-admin@precise.test", role: "admin" },
  staff: { email: "rls-staff@precise.test", role: "staff" },
};

const results = [];
function check(id, ok, detail = "") {
  results.push({ id, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  const line = detail ? `${tag} ${id} — ${detail}` : `${tag} ${id}`;
  (ok ? console.log : console.error)(line);
}

async function provisionUser({ email, role }) {
  const password = `Rls-${role}-${Math.random().toString(36).slice(2, 12)}!A9`;
  // Idempotent create-or-reset via Auth Admin API.
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
  // Force role via user_roles (bypass RLS with service role).
  await admin.from("user_roles").delete().eq("user_id", user.id);
  const { error: rerr } = await admin.from("user_roles").insert({ user_id: user.id, role });
  if (rerr) throw rerr;
  // Sign in with publishable key to mint a real access token.
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
 * A "staff blocked" assertion:
 *   - Snapshot current value of `field` on the target row.
 *   - As staff, attempt UPDATE row set field = sentinel.
 *   - Re-read row via service role — value must be unchanged.
 *   - As staff, attempt DELETE of row — service role must still see row.
 */
async function assertStaffBlocked({ table, pk, id, field, staff, tag }) {
  const { data: before, error: berr } = await admin
    .from(table)
    .select(field)
    .eq(pk, id)
    .maybeSingle();
  if (berr || !before) {
    check(`${tag}.snapshot`, false, berr?.message ?? "row missing");
    return;
  }
  const original = before[field];
  const sentinel = `__rls_${Date.now()}`;
  const { data: upd, error: uerr } = await staff.client
    .from(table)
    .update({ [field]: sentinel })
    .eq(pk, id)
    .select();
  // Allowed outcomes: error (permission denied) OR empty data (RLS filter).
  const blocked = !!uerr || (Array.isArray(upd) && upd.length === 0);
  check(
    `${tag}.staff.update.blocked`,
    blocked,
    uerr ? `err=${uerr.message}` : `rows=${upd?.length ?? 0}`,
  );
  const { data: after } = await admin.from(table).select(field).eq(pk, id).maybeSingle();
  check(
    `${tag}.staff.update.state-unchanged`,
    after && after[field] === original,
    `before=${JSON.stringify(original)} after=${JSON.stringify(after?.[field])}`,
  );
  // Restore in case something slipped through.
  if (after && after[field] !== original)
    await admin
      .from(table)
      .update({ [field]: original })
      .eq(pk, id);

  const { error: derr, data: del } = await staff.client.from(table).delete().eq(pk, id).select();
  const delBlocked = !!derr || (Array.isArray(del) && del.length === 0);
  check(
    `${tag}.staff.delete.blocked`,
    delBlocked,
    derr ? `err=${derr.message}` : `rows=${del?.length ?? 0}`,
  );
  const { data: exists } = await admin.from(table).select(pk).eq(pk, id).maybeSingle();
  check(`${tag}.staff.delete.row-still-exists`, !!exists);
}

async function assertAdminAllowed({ table, pk, id, field, admin: adminUser, tag }) {
  const { data: before } = await admin.from(table).select(field).eq(pk, id).maybeSingle();
  const original = before?.[field];
  const sentinel = `__rls_admin_${Date.now()}`;
  const { data: upd, error: uerr } = await adminUser.client
    .from(table)
    .update({ [field]: sentinel })
    .eq(pk, id)
    .select();
  const ok = !uerr && Array.isArray(upd) && upd.length === 1;
  check(
    `${tag}.admin.update.allowed`,
    ok,
    uerr ? `err=${uerr.message}` : `rows=${upd?.length ?? 0}`,
  );
  // Restore original value via service role.
  await admin
    .from(table)
    .update({ [field]: original })
    .eq(pk, id);
}

async function assertAdminRpcEdit({ receipt_no, adminUser, staff }) {
  const { data: before } = await admin
    .from("payments")
    .select("remarks")
    .eq("receipt_no", receipt_no)
    .maybeSingle();
  const original = before?.remarks ?? null;
  // Staff cannot call admin_edit_payment (function checks has_role and raises 42501).
  const staffCall = await staff.client.rpc("admin_edit_payment", {
    _receipt_no: receipt_no,
    _patch: { remarks: "__rls_staff" },
    _reason: "rls test",
  });
  check(
    "rpc.admin_edit_payment.staff.blocked",
    !!staffCall.error,
    staffCall.error ? `err=${staffCall.error.message}` : "no error",
  );
  // Admin can.
  const adminCall = await adminUser.client.rpc("admin_edit_payment", {
    _receipt_no: receipt_no,
    _patch: { remarks: `__rls_admin_${Date.now()}` },
    _reason: "rls test",
  });
  check(
    "rpc.admin_edit_payment.admin.allowed",
    !adminCall.error,
    adminCall.error ? `err=${adminCall.error.message}` : "ok",
  );
  // Restore.
  await adminUser.client.rpc("admin_edit_payment", {
    _receipt_no: receipt_no,
    _patch: { remarks: original ?? "" },
    _reason: "rls test restore",
  });
}

async function pickTargets() {
  const t = {};
  t.payment = (await admin.from("payments").select("receipt_no,remarks").limit(1)).data?.[0];
  t.booking = (await admin.from("bookings").select("booking_id,notes").limit(1)).data?.[0];
  t.ledger = (
    await admin.from("installment_ledger").select("ledger_id,particulars").limit(1)
  ).data?.[0];
  t.adj = (await admin.from("adjustments").select("adjustment_id,note").limit(1)).data?.[0];
  return t;
}

async function main() {
  const adminUser = await provisionUser(USERS.admin);
  const staff = await provisionUser(USERS.staff);
  const t = await pickTargets();

  if (t.payment) {
    await assertStaffBlocked({
      table: "payments",
      pk: "receipt_no",
      id: t.payment.receipt_no,
      field: "remarks",
      staff,
      tag: "payments",
    });
    await assertAdminRpcEdit({ receipt_no: t.payment.receipt_no, adminUser, staff });
  } else check("payments.target", false, "no rows to test");

  if (t.booking) {
    await assertStaffBlocked({
      table: "bookings",
      pk: "booking_id",
      id: t.booking.booking_id,
      field: "notes",
      staff,
      tag: "bookings",
    });
    await assertAdminAllowed({
      table: "bookings",
      pk: "booking_id",
      id: t.booking.booking_id,
      field: "notes",
      admin: adminUser,
      tag: "bookings",
    });
  }
  if (t.ledger) {
    await assertStaffBlocked({
      table: "installment_ledger",
      pk: "ledger_id",
      id: t.ledger.ledger_id,
      field: "particulars",
      staff,
      tag: "installment_ledger",
    });
    await assertAdminAllowed({
      table: "installment_ledger",
      pk: "ledger_id",
      id: t.ledger.ledger_id,
      field: "particulars",
      admin: adminUser,
      tag: "installment_ledger",
    });
  }
  if (t.adj) {
    await assertStaffBlocked({
      table: "adjustments",
      pk: "adjustment_id",
      id: t.adj.adjustment_id,
      field: "note",
      staff,
      tag: "adjustments",
    });
    await assertAdminAllowed({
      table: "adjustments",
      pk: "adjustment_id",
      id: t.adj.adjustment_id,
      field: "note",
      admin: adminUser,
      tag: "adjustments",
    });
  }

  // --- Admin-only server surfaces: documents + vault + AI ------------------
  // (1) assert_admin_access RPC rejects staff and accepts admin.
  {
    const s = await staff.client.rpc("assert_admin_access", { _scope: "documents" });
    check(
      "rpc.assert_admin_access.staff.blocked",
      !!s.error,
      s.error ? `err=${s.error.code || s.error.message}` : "unexpectedly allowed",
    );
    const a = await adminUser.client.rpc("assert_admin_access", { _scope: "documents" });
    check(
      "rpc.assert_admin_access.admin.allowed",
      !a.error,
      a.error ? `err=${a.error.message}` : "ok",
    );
  }

  // (2) booking_documents INSERT blocked for staff; allowed for admin (rolled back).
  if (t.booking) {
    const stub = {
      booking_id: t.booking.booking_id,
      file_name: `__rls_probe_${Date.now()}.txt`,
      file_path: `probe/__rls_${Date.now()}.txt`,
      file_size: 1,
      mime_type: "text/plain",
      label: "RLS Probe",
    };
    const s = await staff.client.from("booking_documents").insert(stub).select("id").maybeSingle();
    check(
      "booking_documents.insert.staff.blocked",
      !!s.error || !s.data,
      s.error ? `err=${s.error.code}` : "no row returned",
    );
    const a = await adminUser.client
      .from("booking_documents")
      .insert(stub)
      .select("id")
      .maybeSingle();
    check(
      "booking_documents.insert.admin.allowed",
      !a.error && !!a.data,
      a.error ? `err=${a.error.message}` : `id=${a.data?.id}`,
    );
    if (a.data?.id) await admin.from("booking_documents").delete().eq("id", a.data.id);
  }

  // (3) booking-documents storage bucket INSERT blocked for staff.
  {
    const path = `probe/__rls_${Date.now()}.txt`;
    const body = new Blob(["probe"], { type: "text/plain" });
    const s = await staff.client.storage.from("booking-documents").upload(path, body);
    check(
      "storage.booking-documents.upload.staff.blocked",
      !!s.error,
      s.error ? `err=${s.error.message}` : "unexpectedly uploaded",
    );
    if (!s.error) await admin.storage.from("booking-documents").remove([path]);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nRLS matrix: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.error("Failures:");
    for (const f of failed) console.error(`  - ${f.id}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("fatal:", e.message ?? e);
  process.exit(2);
});
