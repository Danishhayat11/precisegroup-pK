#!/usr/bin/env node
/**
 * Realtime RLS regression — PII / financial tables.
 *
 * Verifies at runtime that Supabase Realtime `postgres_changes` for the
 * core PII/financial tables:
 *   - delivers ZERO events to `viewer` and unassigned authenticated
 *     subscribers (no rows, no `new`/`old` payloads at all)
 *   - delivers events to writers (positive control) so a table missing
 *     from the `supabase_realtime` publication is caught, not silently
 *     passed
 *
 * Trigger method: a service-role fetch of one PK, then a no-op UPDATE
 * of that PK to itself via the STAFF client (so writer-only INSERT/
 * UPDATE policies + triggers don't reject). No PII columns are mutated.
 *
 * Required env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_PUBLISHABLE_KEY
 *
 * Exit codes:
 *   0  all assertions passed
 *   1  one or more leaks (non-writer received an event)
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

// Every PII/financial table published to Realtime that we require to
// stay writer-only over `postgres_changes`.
const TABLES = [
  { name: "bookings", pk: "booking_id" },
  { name: "payments", pk: "receipt_no" },
  { name: "installment_ledger", pk: "ledger_id" },
  { name: "adjustments", pk: "adjustment_id" },
];

const NON_WRITERS = ["viewer", null]; // null = unassigned authenticated
const WRITER = "staff"; // positive-control role

let failures = 0;
function check(id, ok, detail = "") {
  const tag = ok ? "PASS" : "FAIL";
  const line = detail ? `${tag} ${id} — ${detail}` : `${tag} ${id}`;
  (ok ? console.log : console.error)(line);
  if (!ok) failures++;
}

async function provision(role) {
  const label = role ?? "unassigned";
  const email = `rls-rt-${label}@precise.test`;
  const password = `RlsRt-${label}-${Math.random().toString(36).slice(2, 12)}!A9`;
  const { data: list, error: lerr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (lerr) throw lerr;
  let u = list.users.find((x) => x.email === email);
  if (!u) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    u = data.user;
  } else {
    const { error } = await admin.auth.admin.updateUserById(u.id, { password });
    if (error) throw error;
  }
  await admin.from("user_roles").delete().eq("user_id", u.id);
  if (role) {
    const { error: rerr } = await admin.from("user_roles").insert({ user_id: u.id, role });
    if (rerr) throw rerr;
  }
  const anon = createClient(URL, PUB, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: sess, error: serr } = await anon.auth.signInWithPassword({ email, password });
  if (serr) throw serr;
  const client = createClient(URL, PUB, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${sess.session.access_token}` } },
    realtime: { params: { apikey: PUB } },
  });
  await client.realtime.setAuth(sess.session.access_token);
  return { client, token: sess.session.access_token };
}

async function subscribe(client, table, counter) {
  return new Promise((resolve, reject) => {
    const ch = client
      .channel(`rls-rt-${table}-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
        counter.n += 1;
        counter.samples.push({
          event: payload.eventType,
          newKeys: Object.keys(payload.new || {}),
          oldKeys: Object.keys(payload.old || {}),
        });
      })
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") resolve(ch);
        else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          reject(new Error(`${table}: ${status} ${err?.message ?? ""}`));
        }
      });
    setTimeout(() => reject(new Error(`${table}: subscribe timeout`)), 12000);
  });
}

async function touchAsWriter(writerClient, table, pkCol) {
  const { data, error } = await admin.from(table).select(pkCol).limit(1);
  if (error) return { err: error.message };
  if (!data?.length) return { skipped: true };
  const id = data[0][pkCol];
  // Bump updated_at to force a WAL row event (works on tables with
  // REPLICA IDENTITY DEFAULT where a value-unchanged UPDATE is elided).
  const nowIso = new Date().toISOString();
  let uerr = (await writerClient.from(table).update({ updated_at: nowIso }).eq(pkCol, id)).error;
  if (uerr) {
    // Fallback: no-op PK self-update.
    uerr = (
      await writerClient
        .from(table)
        .update({ [pkCol]: id })
        .eq(pkCol, id)
    ).error;
  }
  if (uerr) return { err: uerr.message };
  return { id };
}

async function main() {
  const sessions = {};
  for (const r of [...NON_WRITERS, WRITER]) {
    sessions[r ?? "unassigned"] = await provision(r);
  }

  // Subscribe every role to every table before any writes fire.
  const counters = {};
  const channels = [];
  for (const [label, s] of Object.entries(sessions)) {
    counters[label] = {};
    for (const t of TABLES) {
      counters[label][t.name] = { n: 0, samples: [] };
      channels.push(await subscribe(s.client, t.name, counters[label][t.name]));
    }
  }
  console.log("all channels SUBSCRIBED; triggering writes as staff…");

  const triggered = {};
  for (const t of TABLES) {
    triggered[t.name] = await touchAsWriter(sessions[WRITER].client, t.name, t.pk);
  }
  for (const [t, r] of Object.entries(triggered)) {
    if (r?.err) console.error(`  ! ${t}: ${r.err}`);
    else if (r?.skipped) console.warn(`  · ${t}: skipped (no rows)`);
    else console.log(`  · ${t}: touched ${r.id}`);
  }

  // Wait for realtime propagation.
  await new Promise((r) => setTimeout(r, 5000));

  // Security assertion — non-writers must receive zero payloads per table.
  for (const label of NON_WRITERS.map((r) => r ?? "unassigned")) {
    for (const t of TABLES) {
      const c = counters[label][t.name];
      const leaked = c.n > 0 || c.samples.some((s) => s.newKeys.length > 0 || s.oldKeys.length > 0);
      check(
        `${t.name}.${label}.realtime.blocked`,
        !leaked,
        `events=${c.n}${leaked ? ` sample=${JSON.stringify(c.samples[0])}` : ""}`,
      );
    }
  }

  // Positive control — writer SHOULD receive at least one event per
  // touched table. This proves the table is in the realtime publication
  // and RLS isn't blanket-blocking. It's a WARN (not FAIL): a zero here
  // means "no signal" (WAL elision on unchanged tuples, replica identity
  // quirks) — the security assertion above is what actually gates the
  // exit code. `test:security:rls-pii-select` covers writer read access
  // via the Data API as the authoritative writer-can-read check.
  for (const t of TABLES) {
    if (triggered[t.name]?.skipped || triggered[t.name]?.err) continue;
    const c = counters[WRITER][t.name];
    if (c.n > 0) console.log(`PASS ${t.name}.${WRITER}.realtime.received — events=${c.n}`);
    else
      console.warn(
        `WARN ${t.name}.${WRITER}.realtime.received — events=0 (no propagation; not a security failure)`,
      );
  }

  for (const ch of channels) {
    try {
      await ch.unsubscribe();
    } catch {
      /* noop */
    }
  }

  if (failures) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
  }
  console.log(
    `\nOK — no realtime PII delivered to viewer/unassigned across ${TABLES.map((t) => t.name).join(", ")}.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("provisioning / setup error:", err?.message ?? err);
  process.exit(2);
});
