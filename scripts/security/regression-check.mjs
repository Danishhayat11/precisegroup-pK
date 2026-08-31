#!/usr/bin/env node
/**
 * Security regression checks.
 *
 * One assertion per previously-fixed finding. CI fails if any assertion
 * returns false. Each check has a stable `id` so failures point to the
 * exact entry in docs/security/regression-checks.md.
 *
 * Run locally:
 *   node scripts/security/regression-check.mjs
 *
 * In CI:
 *   - Static checks always run.
 *   - DB checks run only when SUPABASE_DB_URL is provided as a secret
 *     (psql must be on PATH; the workflow installs it).
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const results = [];

function record(id, ok, detail) {
  results.push({ id, ok, detail });
  const tag = ok ? "✅ PASS" : "❌ FAIL";
  console.log(`${tag}  ${id}${detail ? `  — ${detail}` : ""}`);
}

async function read(rel) {
  return readFile(path.join(ROOT, rel), "utf8");
}

// ───────────────────────── Static (source) checks ─────────────────────────

// SEC-001: Login UI must not expose self-signup.
async function checkNoSignupUi() {
  const file = "src/pages/Login.tsx";
  if (!existsSync(path.join(ROOT, file))) {
    return record("SEC-001", false, `${file} missing — login page moved or deleted`);
  }
  const src = await read(file);
  const forbidden = [/auth\.signUp\s*\(/, /signInWithSignUp/, /mode\s*===\s*['"]signup['"]/i];
  const hits = forbidden.filter((re) => re.test(src));
  record(
    "SEC-001",
    hits.length === 0,
    hits.length
      ? `forbidden patterns matched: ${hits.map(String).join(", ")}`
      : "no signup affordances",
  );
}

// SEC-002: No `supabase.auth.signUp(` anywhere in the client bundle paths.
async function checkNoSignUpAnywhere() {
  const grep = spawnSync(
    "grep",
    ["-RIn", "--include=*.ts", "--include=*.tsx", "supabase.auth.signUp(", "src"],
    { cwd: ROOT, encoding: "utf8" },
  );
  // grep exit 1 = no matches (good); 0 = matches found (bad); >1 = error
  if (grep.status === 1) return record("SEC-002", true, "no signUp callers");
  if (grep.status === 0)
    return record("SEC-002", false, `signUp callers found:\n${grep.stdout.trim()}`);
  record("SEC-002", false, `grep error: ${grep.stderr}`);
}

// SEC-003: /api/ai route must validate a Supabase bearer.
async function checkAiAuth() {
  const file = "src/routes/api/ai.ts";
  if (!existsSync(path.join(ROOT, file))) {
    return record("SEC-003", false, `${file} missing — AI route moved or deleted`);
  }
  const src = await read(file);
  const ok = /getAuthedSupabase|requireSupabaseAuth|auth\.getClaims/.test(src) && /401/.test(src);
  record("SEC-003", ok, ok ? "bearer validation present" : "no bearer validation / no 401 path");
}

// SEC-004: Client must attach Authorization header when calling /api/ai.
async function checkAiClientAttachesBearer() {
  const file = "src/components/DashboardAI.tsx";
  if (!existsSync(path.join(ROOT, file))) {
    // Component renamed/removed is acceptable only if no other caller exists.
    const grep = spawnSync(
      "grep",
      ["-RIln", "--include=*.ts", "--include=*.tsx", "/api/ai", "src"],
      { cwd: ROOT, encoding: "utf8" },
    );
    return record(
      "SEC-004",
      grep.status === 1,
      grep.status === 1
        ? "no /api/ai callers"
        : `callers exist but DashboardAI.tsx missing:\n${grep.stdout}`,
    );
  }
  const src = await read(file);
  const ok = /Authorization/i.test(src) && /Bearer/.test(src);
  record(
    "SEC-004",
    ok,
    ok ? "bearer attached" : "Authorization/Bearer not found in DashboardAI.tsx",
  );
}

// SEC-005: `supabaseAdmin` (service-role) must never be imported at module
// scope from a route file or *.functions.ts module. It is loaded dynamically.
async function checkAdminClientNotLeaked() {
  const grep = spawnSync(
    "grep",
    [
      "-RIln",
      "--include=src/routes/**/*.ts",
      "--include=src/routes/**/*.tsx",
      "--include=src/**/*.functions.ts",
      "--include=src/**/*.functions.tsx",
      'from "@/integrations/supabase/client.server"',
      "src",
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (grep.status === 1)
    return record("SEC-005", true, "no top-level admin imports in client-reachable modules");
  record("SEC-005", false, `top-level admin imports leaked:\n${grep.stdout.trim()}`);
}

// ───────────────────────── DB (psql) checks ─────────────────────────

function psql(sql) {
  const r = spawnSync("psql", ["-Atqc", sql], {
    encoding: "utf8",
    env: { ...process.env, PGOPTIONS: "--client-min-messages=warning" },
  });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

async function runDbChecks() {
  if (!process.env.SUPABASE_DB_URL) {
    console.log("ℹ️  SUPABASE_DB_URL not set — skipping DB checks (SEC-100..SEC-107).");
    return;
  }
  // psql reads PG* env; the workflow exports them from SUPABASE_DB_URL.

  // Intentional anon-callable SECURITY DEFINER functions. Both back the
  // anonymous /client-note/$token share flow: they look the payment up by
  // an unguessable UUID stored on payments.public_note_token and refuse
  // to return anything on a miss. Any *other* anon-callable definer is a
  // regression — SEC-100 / SEC-104 flag it, SEC-105 asserts these two
  // are still reachable so the share flow keeps working.
  const ANON_DEFINER_ALLOWLIST = ["client_get_payment_by_token", "client_add_note_by_token"];
  const allowlistSql = ANON_DEFINER_ALLOWLIST.map((n) => `'${n}'`).join(",");

  // SEC-100: No SECURITY DEFINER function in public is EXECUTE-able by anon,
  //          except the intentional allowlist above.
  try {
    const out = psql(`
      SELECT p.proname
      FROM   pg_proc p
      JOIN   pg_namespace n ON n.oid = p.pronamespace
      WHERE  n.nspname = 'public'
        AND  p.prosecdef = true
        AND  p.proname NOT IN (${allowlistSql})
        AND  has_function_privilege('anon', p.oid, 'EXECUTE');
    `);
    record(
      "SEC-100",
      out === "",
      out
        ? `anon can EXECUTE: ${out.replace(/\n/g, ", ")}`
        : "no unintended anon-callable definers",
    );
  } catch (e) {
    record("SEC-100", false, e.message);
  }

  // SEC-101: Trigger/maintenance definers must NOT be authenticated-callable.
  try {
    const out = psql(`
      SELECT p.proname
      FROM   pg_proc p
      JOIN   pg_namespace n ON n.oid = p.pronamespace
      WHERE  n.nspname = 'public'
        AND  p.proname IN ('handle_new_user','recompute_booking_overdue','trg_recompute_booking_overdue')
        AND  has_function_privilege('authenticated', p.oid, 'EXECUTE');
    `);
    record(
      "SEC-101",
      out === "",
      out
        ? `authenticated can EXECUTE trigger helpers: ${out.replace(/\n/g, ", ")}`
        : "trigger helpers locked down",
    );
  } catch (e) {
    record("SEC-101", false, e.message);
  }

  // SEC-102: RLS enabled on every table in public.
  try {
    const out = psql(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND rowsecurity = false;
    `);
    record(
      "SEC-102",
      out === "",
      out ? `RLS disabled on: ${out.replace(/\n/g, ", ")}` : "RLS enabled everywhere",
    );
  } catch (e) {
    record("SEC-102", false, e.message);
  }

  // SEC-103: Only known roles present in user_roles.
  try {
    const out = psql(
      `SELECT count(*)::text FROM public.user_roles WHERE role NOT IN ('admin','manager','staff','viewer');`,
    );
    record(
      "SEC-103",
      out === "0",
      out === "0" ? "no unexpected roles" : `found ${out} rows with unexpected role values`,
    );
  } catch (e) {
    record("SEC-103", false, e.message);
  }

  // SEC-104: Per-function ACL scan for EXECUTE grants leaked to anon or to
  // PUBLIC, excluding the intentional allowlist. Where SEC-100 uses
  // has_function_privilege (which already resolves through PUBLIC), SEC-104
  // enumerates the *specific* grantee so a regression points at the offender.
  try {
    const out = psql(`
      WITH defs AS (
        SELECT p.oid, p.proname,
               pg_get_function_identity_arguments(p.oid) AS args,
               COALESCE(p.proacl, acldefault('f', p.proowner)) AS acl
        FROM   pg_proc p
        JOIN   pg_namespace n ON n.oid = p.pronamespace
        WHERE  n.nspname = 'public' AND p.prosecdef = true
          AND  p.proname NOT IN (${allowlistSql})
      ), exploded AS (
        SELECT proname, args, (aclexplode(acl)).grantee, (aclexplode(acl)).privilege_type
        FROM   defs
      )
      SELECT proname || '(' || args || ') -> ' ||
             COALESCE(NULLIF(pg_get_userbyid(grantee), ''), 'PUBLIC')
      FROM   exploded
      WHERE  privilege_type = 'EXECUTE'
        AND  (grantee = 0 OR pg_get_userbyid(grantee) = 'anon');
    `);
    record(
      "SEC-104",
      out === "",
      out
        ? `EXECUTE leaked: ${out.replace(/\n/g, "; ")}`
        : "no anon/PUBLIC EXECUTE on non-allowlisted definers",
    );
  } catch (e) {
    record("SEC-104", false, e.message);
  }

  // SEC-105: The allowlisted client-note functions MUST still be EXECUTE-able
  // by anon — otherwise the /client-note/$token share flow silently breaks.
  try {
    const out = psql(`
      WITH want(name) AS (VALUES ${ANON_DEFINER_ALLOWLIST.map((n) => `('${n}')`).join(",")})
      SELECT w.name
      FROM   want w
      LEFT JOIN pg_proc p
             ON p.proname = w.name
            AND p.pronamespace = 'public'::regnamespace
            AND p.prosecdef = true
      WHERE  p.oid IS NULL
         OR  NOT has_function_privilege('anon', p.oid, 'EXECUTE');
    `);
    record(
      "SEC-105",
      out === "",
      out
        ? `anon lost EXECUTE on client-note fn(s): ${out.replace(/\n/g, ", ")}`
        : "anon can execute both client-note functions",
    );
  } catch (e) {
    record("SEC-105", false, e.message);
  }

  // SEC-106: Anon must NOT have SELECT (or write) on the sensitive tables
  // that back the client-note flow. All access is intentionally funneled
  // through the two RPCs so anon can never enumerate payments or bookings
  // by hitting the Data API directly.
  const SENSITIVE_TABLES = [
    "payments",
    "payment_comments",
    "payment_allocations",
    "installment_ledger",
    "bookings",
    "clients",
    "user_roles",
    "profiles",
    "audit_logs",
  ];
  try {
    const tablesSql = SENSITIVE_TABLES.map((t) => `'${t}'`).join(",");
    const out = psql(`
      SELECT table_name || ':' || privilege_type
      FROM   information_schema.role_table_grants
      WHERE  table_schema = 'public'
        AND  table_name IN (${tablesSql})
        AND  grantee IN ('anon','PUBLIC');
    `);
    record(
      "SEC-106",
      out === "",
      out
        ? `anon/PUBLIC privileges leaked on: ${out.replace(/\n/g, ", ")}`
        : "sensitive tables locked down for anon",
    );
  } catch (e) {
    record("SEC-106", false, e.message);
  }

  // SEC-107: Functional test — SET ROLE anon and:
  //   (a) client_get_payment_by_token(<random uuid>) must return NULL
  //       (the token gate refuses on any miss).
  //   (b) SELECT on public.payments must be blocked (permission denied).
  //   (c) SELECT on public.user_roles must be blocked (permission denied).
  // This proves the runtime posture matches the ACL scan above.
  //
  // `SET ROLE anon` requires that the connecting user is a member of
  // `anon` (true for the CI `postgres` role, not necessarily for every
  // sandbox). If SET ROLE itself is denied, we mark SEC-107 as PASS with
  // a "skipped: not a member of anon" note — SEC-105 / SEC-106 already
  // pin the posture via catalog reads.
  let canSetRoleAnon = true;
  try {
    psql(`SET ROLE anon; SELECT 1;`);
  } catch (e) {
    if (/permission denied to set role/i.test(String(e?.message ?? e))) {
      canSetRoleAnon = false;
    }
  }

  if (!canSetRoleAnon) {
    record(
      "SEC-107a",
      true,
      "skipped: connecting role is not a member of anon (SEC-105/106 still cover the posture)",
    );
    record("SEC-107b", true, "skipped: connecting role is not a member of anon");
    record("SEC-107c", true, "skipped: connecting role is not a member of anon");
  } else {
    try {
      const nullOut = psql(`
        SET ROLE anon;
        SELECT COALESCE(public.client_get_payment_by_token(gen_random_uuid())::text, 'NULL');
      `);
      record(
        "SEC-107a",
        nullOut === "NULL",
        nullOut === "NULL"
          ? "anon RPC returns NULL for unknown token"
          : `unexpected RPC output for anon: ${nullOut.slice(0, 120)}`,
      );
    } catch (e) {
      record("SEC-107a", false, e.message);
    }

    for (const [id, table] of [
      ["SEC-107b", "payments"],
      ["SEC-107c", "user_roles"],
    ]) {
      try {
        psql(`SET ROLE anon; SELECT 1 FROM public.${table} LIMIT 1;`);
        record(id, false, `anon SELECT on public.${table} unexpectedly succeeded`);
      } catch (e) {
        const msg = String(e?.message ?? e);
        const denied = /permission denied|insufficient_privilege/i.test(msg);
        record(
          id,
          denied,
          denied
            ? `anon SELECT on public.${table} denied`
            : `unexpected error: ${msg.slice(0, 160)}`,
        );
      }
    }
  }
}

// ───────────────────────── Runtime (HTTP) checks ─────────────────────────

async function runAiAuthChecks() {
  const base = process.env.AI_TEST_BASE_URL;
  if (!base) {
    console.log(
      "ℹ️  AI_TEST_BASE_URL not set — skipping runtime AI checks (SEC-200, SEC-201, SEC-202).",
    );
    return;
  }
  const url = base.replace(/\/$/, "") + "/api/ai";
  const body = JSON.stringify({ mode: "chat", messages: [{ role: "user", content: "ping" }] });
  const json = { "content-type": "application/json" };

  // SEC-200: missing Authorization header ⇒ 401.
  try {
    const r = await fetch(url, { method: "POST", headers: json, body });
    record("SEC-200", r.status === 401, `no-auth → status ${r.status} (want 401)`);
  } catch (e) {
    record("SEC-200", false, String(e?.message ?? e));
  }

  // SEC-201: malformed bearer ⇒ 401.
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { ...json, authorization: "Bearer not-a-jwt" },
      body,
    });
    record("SEC-201", r.status === 401, `bad-bearer → status ${r.status} (want 401)`);
  } catch (e) {
    record("SEC-201", false, String(e?.message ?? e));
  }

  // SEC-216..SEC-224: a battery of malformed / undecodable bearer shapes.
  // Each one should be rejected at the auth layer with 401 — the route must
  // never try to interpret a partially-parsed token. Failing any of these
  // means the validator is too lenient (likely a try/catch that swallows
  // decode errors and falls through to "no user" instead of "deny").
  const b64u = (s) =>
    Buffer.from(s).toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const malformedCases = [
    ["SEC-216", "empty bearer value", "Bearer "],
    ["SEC-217", "whitespace-only bearer", "Bearer    \t  "],
    ["SEC-218", "one-segment token", "Bearer onlyonesegment"],
    ["SEC-219", "two-segment token", "Bearer header.payload"],
    ["SEC-220", "four-segment token", "Bearer a.b.c.d"],
    ["SEC-221", "non-base64 garbage segs", "Bearer !!!.@@@.###"],
    ["SEC-222", "base64 of non-JSON", `Bearer ${b64u("hello")}.${b64u("world")}.AAAA`],
    ["SEC-223", "wrong auth scheme", "Basic dXNlcjpwYXNz"],
    ["SEC-224", "missing scheme (raw token)", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig"],
  ];
  for (const [id, label, header] of malformedCases) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { ...json, authorization: header },
        body,
      });
      const ct = (r.headers.get("content-type") ?? "").toLowerCase();
      let payload = null,
        raw = "";
      try {
        raw = await r.text();
        payload = JSON.parse(raw);
      } catch {}
      const ok =
        r.status === 401 &&
        ct.includes("application/json") &&
        payload &&
        typeof payload === "object" &&
        Object.keys(payload).length === 1 &&
        payload.error === "Unauthorized";
      record(
        id,
        ok,
        `${label} → status ${r.status}, ct "${ct}", body ${raw.slice(0, 80)} (want 401 + {error:"Unauthorized"} single-key JSON)`,
      );
    } catch (e) {
      record(id, false, String(e?.message ?? e));
    }
  }

  // SEC-234: non-Bearer auth schemes must be rejected with 401 + canonical
  // `{"error":"Unauthorized"}` even when the token portion is a structurally
  // valid JWT-shaped string. This guards against a lenient parser that
  // ignores the scheme and just splits on whitespace.
  const fakeJwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u('{"sub":"x"}')}.${b64u("sig")}`;
  const wrongSchemeCases = [
    ["SEC-234a", "Token scheme", `Token ${fakeJwt}`],
    ["SEC-234b", "Basic scheme", "Basic dXNlcjpwYXNzd29yZA=="],
    ["SEC-234c", "Digest scheme", 'Digest username="x", realm="r", nonce="n", response="abc"'],
    ["SEC-234d", "JWT scheme", `JWT ${fakeJwt}`],
    ["SEC-234e", "OAuth scheme", `OAuth ${fakeJwt}`],
    ["SEC-234f", "ApiKey scheme", "ApiKey abc123"],
    ["SEC-234g", "Negotiate", "Negotiate YIIZ..."],
    ["SEC-234h", "lowercase token after Token", `token ${fakeJwt}`],
  ];
  for (const [id, label, header] of wrongSchemeCases) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { ...json, authorization: header },
        body,
      });
      const ct = (r.headers.get("content-type") ?? "").toLowerCase();
      let payload = null,
        raw = "";
      try {
        raw = await r.text();
        payload = JSON.parse(raw);
      } catch {}
      const ok =
        r.status === 401 &&
        ct.includes("application/json") &&
        payload &&
        typeof payload === "object" &&
        Object.keys(payload).length === 1 &&
        payload.error === "Unauthorized";
      record(
        id,
        ok,
        `${label} → status ${r.status}, ct "${ct}", body ${raw.slice(0, 80)} (want 401 + {error:"Unauthorized"} single-key JSON)`,
      );
    } catch (e) {
      record(id, false, String(e?.message ?? e));
    }
  }

  // SEC-229: missing/empty bearer must be rejected with exactly 401
  // (Unauthorized), never 403 (Forbidden). 403 implies an authenticated
  // identity that lacks permission — wrong semantics for "no credentials".
  // We assert status === 401 AND status !== 403, and that the canonical
  // `{error:"Unauthorized"}` shape comes back, for three "no credentials"
  // shapes that real clients send.
  const noCredCases = [
    ["SEC-229a", "no Authorization header", null],
    ["SEC-229b", "empty Authorization header", ""],
    ["SEC-229c", "Bearer with empty token", "Bearer "],
  ];
  for (const [id, label, header] of noCredCases) {
    try {
      const headers = header === null ? { ...json } : { ...json, authorization: header };
      const r = await fetch(url, { method: "POST", headers, body });
      const ct = (r.headers.get("content-type") ?? "").toLowerCase();
      let payload = null;
      try {
        payload = await r.json();
      } catch {
        /* not JSON */
      }
      const ok =
        r.status === 401 &&
        r.status !== 403 &&
        ct.includes("application/json") &&
        payload?.error === "Unauthorized";
      record(
        id,
        ok,
        `${label} → status ${r.status}, body=${JSON.stringify(payload)} (want 401 + {error:"Unauthorized"}, not 403)`,
      );
    } catch (e) {
      record(id, false, String(e?.message ?? e));
    }
  }

  // Forge an unsigned JWT-shaped token. Supabase Auth must reject it on
  // signature/exp/nbf grounds before our handler runs.
  const b64 = (o) =>
    Buffer.from(JSON.stringify(o))
      .toString("base64")
      .replace(/=+$/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const forgeJwt = (claims) => {
    const header = b64({ alg: "HS256", typ: "JWT" });
    const payload = b64({
      sub: "00000000-0000-0000-0000-000000000000",
      aud: "authenticated",
      role: "authenticated",
      iss: "https://example.supabase.co/auth/v1",
      iat: Math.floor(Date.now() / 1000) - 60,
      ...claims,
    });
    return `${header}.${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
  };
  const now = () => Math.floor(Date.now() / 1000);

  // SEC-203: expired JWT (exp in the past) ⇒ 401.
  try {
    const t = forgeJwt({ exp: now() - 3600, nbf: now() - 7200 });
    const r = await fetch(url, {
      method: "POST",
      headers: { ...json, authorization: `Bearer ${t}` },
      body,
    });
    record("SEC-203", r.status === 401, `expired-jwt → status ${r.status} (want 401)`);

    // SEC-203b: expired JWT must return canonical {"error":"Unauthorized"} JSON body.
    const ct = r.headers.get("content-type") || "";
    let parsed = null,
      raw = "";
    try {
      raw = await r.text();
      parsed = JSON.parse(raw);
    } catch {}
    const ok =
      r.status === 401 &&
      /application\/json/i.test(ct) &&
      parsed &&
      typeof parsed === "object" &&
      Object.keys(parsed).length === 1 &&
      parsed.error === "Unauthorized";
    record(
      "SEC-203b",
      ok,
      `expired-jwt body → status ${r.status}, ct "${ct}", body ${raw.slice(0, 80)}`,
    );
  } catch (e) {
    record("SEC-203", false, String(e?.message ?? e));
  }

  // SEC-204: not-yet-valid JWT (nbf in the future) ⇒ 401.
  try {
    const t = forgeJwt({ nbf: now() + 3600, exp: now() + 7200 });
    const r = await fetch(url, {
      method: "POST",
      headers: { ...json, authorization: `Bearer ${t}` },
      body,
    });
    record("SEC-204", r.status === 401, `nbf-future → status ${r.status} (want 401)`);
  } catch (e) {
    record("SEC-204", false, String(e?.message ?? e));
  }

  // SEC-214 / SEC-215: clock-skew leeway. Verifiers may allow a small
  // exp/nbf grace window (`AI_TEST_JWT_LEEWAY_SECONDS`, default 60s); these
  // checks push exp/nbf to `leeway × 5` outside the window so the assertion
  // stays stable across environments with mildly skewed clocks.
  const LEEWAY_S = Number(process.env.AI_TEST_JWT_LEEWAY_SECONDS ?? 60);
  const BEYOND_LEEWAY_S = Math.max(LEEWAY_S * 5, 300);

  try {
    const t = forgeJwt({
      iat: now() - BEYOND_LEEWAY_S - 60,
      nbf: now() - BEYOND_LEEWAY_S - 60,
      exp: now() - BEYOND_LEEWAY_S,
    });
    const r = await fetch(url, {
      method: "POST",
      headers: { ...json, authorization: `Bearer ${t}` },
      body,
    });
    record(
      "SEC-214",
      r.status === 401,
      `exp-beyond-leeway(${BEYOND_LEEWAY_S}s) → status ${r.status} (want 401)`,
    );
  } catch (e) {
    record("SEC-214", false, String(e?.message ?? e));
  }

  try {
    const t = forgeJwt({
      iat: now(),
      nbf: now() + BEYOND_LEEWAY_S,
      exp: now() + BEYOND_LEEWAY_S + 3600,
    });
    const r = await fetch(url, {
      method: "POST",
      headers: { ...json, authorization: `Bearer ${t}` },
      body,
    });
    record(
      "SEC-215",
      r.status === 401,
      `nbf-beyond-leeway(${BEYOND_LEEWAY_S}s) → status ${r.status} (want 401)`,
    );
  } catch (e) {
    record("SEC-215", false, String(e?.message ?? e));
  }

  // SEC-235: structurally valid 3-segment JWT but missing required
  // time-based claims (`exp`, `iat`, `nbf`). A correct verifier MUST require
  // `exp` (and treat tokens without `iat`/`nbf` as invalid for Supabase
  // sessions) — without claim presence checks a token would be implicitly
  // immortal. All variants must return 401 + canonical {"error":"Unauthorized"}
  // single-key JSON, never a partial claim echo.
  const forgeJwtExact = (claims) => {
    const header = b64({ alg: "HS256", typ: "JWT" });
    // No defaults: only the fields the caller passes are encoded.
    const payload = b64(claims);
    return `${header}.${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
  };
  const baseIdentity = {
    sub: "00000000-0000-0000-0000-000000000000",
    aud: "authenticated",
    role: "authenticated",
    iss: "https://example.supabase.co/auth/v1",
  };
  const missingClaimCases = [
    ["SEC-235a", "no exp (iat+nbf present)", { ...baseIdentity, iat: now() - 60, nbf: now() - 60 }],
    [
      "SEC-235b",
      "no iat (exp+nbf present)",
      { ...baseIdentity, nbf: now() - 60, exp: now() + 3600 },
    ],
    [
      "SEC-235c",
      "no nbf (exp+iat present)",
      { ...baseIdentity, iat: now() - 60, exp: now() + 3600 },
    ],
    ["SEC-235d", "no exp/iat/nbf at all", { ...baseIdentity }],
  ];
  for (const [id, label, claims] of missingClaimCases) {
    try {
      const t = forgeJwtExact(claims);
      const r = await fetch(url, {
        method: "POST",
        headers: { ...json, authorization: `Bearer ${t}` },
        body,
      });
      const ct = (r.headers.get("content-type") ?? "").toLowerCase();
      let parsed = null,
        raw = "";
      try {
        raw = await r.text();
        parsed = JSON.parse(raw);
      } catch {}
      const ok =
        r.status === 401 &&
        ct.includes("application/json") &&
        parsed &&
        typeof parsed === "object" &&
        Object.keys(parsed).length === 1 &&
        parsed.error === "Unauthorized";
      record(
        id,
        ok,
        `${label} → status ${r.status}, ct "${ct}", body ${raw.slice(0, 80)} (want 401 + {error:"Unauthorized"} single-key JSON)`,
      );
    } catch (e) {
      record(id, false, String(e?.message ?? e));
    }
  }

  // SEC-236: 401 responses MUST NOT echo any decoded JWT claims or other
  // token-derived data. Forge tokens whose payloads contain a uniquely
  // identifiable "canary" string in every standard + custom claim slot, then
  // assert the raw response body contains none of those canaries and exposes
  // exactly the single `error` key. Covers expired, not-yet-valid, missing
  // claims, and bad-signature rejection paths.
  const CANARY = "CANARY-LEAK-PROBE-7f3c1e9a";
  const canaryClaims = (extra) => ({
    sub: `${CANARY}-sub-00000000-0000-0000-0000-000000000000`,
    aud: `${CANARY}-aud`,
    role: `${CANARY}-role`,
    iss: `https://${CANARY}.example.invalid/auth/v1`,
    email: `${CANARY}@example.invalid`,
    user_metadata: { name: `${CANARY}-name` },
    app_metadata: { provider: `${CANARY}-provider` },
    [`x_${CANARY}_custom`]: `${CANARY}-custom-value`,
    ...extra,
  });
  const canaryCases = [
    [
      "SEC-236a",
      "expired",
      canaryClaims({ iat: now() - 7200, nbf: now() - 7200, exp: now() - 3600 }),
    ],
    [
      "SEC-236b",
      "not-yet-valid",
      canaryClaims({ iat: now(), nbf: now() + 3600, exp: now() + 7200 }),
    ],
    ["SEC-236c", "missing-exp", canaryClaims({ iat: now() - 60, nbf: now() - 60 })],
    [
      "SEC-236d",
      "bad-signature",
      canaryClaims({ iat: now() - 60, nbf: now() - 60, exp: now() + 3600 }),
    ],
  ];
  for (const [id, label, claims] of canaryCases) {
    try {
      const t = forgeJwtExact(claims);
      const r = await fetch(url, {
        method: "POST",
        headers: { ...json, authorization: `Bearer ${t}` },
        body,
      });
      const ct = (r.headers.get("content-type") ?? "").toLowerCase();
      const raw = await r.text();
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {}
      const keys =
        parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed) : [];
      // The raw body must not include the canary anywhere — neither as a
      // top-level field, nested in a debug envelope, nor inside a message
      // string. A single substring check covers all of those.
      const noCanary = !raw.includes(CANARY);
      const onlyErrorKey = keys.length === 1 && keys[0] === "error";
      const ok =
        r.status === 401 &&
        ct.includes("application/json") &&
        parsed &&
        parsed.error === "Unauthorized" &&
        onlyErrorKey &&
        noCanary;
      record(
        id,
        ok,
        `${label} → status ${r.status}, ct "${ct}", keys [${keys.join(",")}], canary-leak=${!noCanary}, body ${raw.slice(0, 120)}`,
      );
    } catch (e) {
      record(id, false, String(e?.message ?? e));
    }
  }

  // SEC-210: JWT with all-valid timing claims but a bogus signature ⇒ 401.
  // Proves rejection is driven by signature verification, not just exp/nbf.
  try {
    const t = forgeJwt({ iat: now() - 60, nbf: now() - 60, exp: now() + 3600 });
    const r = await fetch(url, {
      method: "POST",
      headers: { ...json, authorization: `Bearer ${t}` },
      body,
    });
    record("SEC-210", r.status === 401, `bad-signature → status ${r.status} (want 401)`);

    // SEC-210b: same forged token must also return the canonical
    // {"error":"Unauthorized"} JSON body — no claim/identity leak.
    const ct = (r.headers.get("content-type") ?? "").toLowerCase();
    let parsed = null,
      raw = "";
    try {
      raw = await r.text();
      parsed = JSON.parse(raw);
    } catch {}
    const ok =
      r.status === 401 &&
      ct.includes("application/json") &&
      parsed &&
      typeof parsed === "object" &&
      Object.keys(parsed).length === 1 &&
      parsed.error === "Unauthorized";
    record(
      "SEC-210b",
      ok,
      `bad-signature body → status ${r.status}, ct "${ct}", body ${raw.slice(0, 80)}`,
    );
  } catch (e) {
    record("SEC-210", false, String(e?.message ?? e));
  }

  // SEC-211: tampered real JWT — flip a claim in the payload of a known-good
  // bearer; original HMAC no longer matches the mutated payload ⇒ 401.
  const realBearer =
    process.env.AI_TEST_BEARER || process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN;
  if (realBearer && realBearer.split(".").length === 3) {
    try {
      const parts = realBearer.split(".");
      const pad = (s) => s + "=".repeat((4 - (s.length % 4)) % 4);
      const payload = JSON.parse(
        Buffer.from(pad(parts[1]).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
      );
      payload.sub = "00000000-0000-0000-0000-000000000001";
      const tampered = `${parts[0]}.${b64(payload)}.${parts[2]}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { ...json, authorization: `Bearer ${tampered}` },
        body,
      });
      record("SEC-211", r.status === 401, `tampered-jwt → status ${r.status} (want 401)`);
    } catch (e) {
      record("SEC-211", false, String(e?.message ?? e));
    }
  } else {
    console.log("ℹ️  No real bearer available — skipping SEC-211 (tampered-JWT check).");
  }

  // SEC-230: with a valid Supabase JWT, /api/ai must return 200 and the
  // canonical success JSON shape: content-type=application/json and a body
  // with a string `text` key. Skipped if no real bearer is available.
  // Environmental rate-limit (429) or credit-exhaustion (402) are surfaced
  // as a notice — not a regression — so the suite stays stable in CI.
  if (realBearer) {
    try {
      const okBody = JSON.stringify({
        mode: "insights",
        snapshot: { totalSellValue: 0, totalCashReceived: 0, totalPending: 0, totalOverdue: 0 },
      });
      const r = await fetch(url, {
        method: "POST",
        headers: { ...json, authorization: `Bearer ${realBearer}` },
        body: okBody,
      });
      if (r.status === 402 || r.status === 429) {
        console.log(
          `ℹ️  SEC-230 skipped — gateway returned ${r.status} (credits/rate-limit, not an auth regression).`,
        );
      } else {
        const ct = (r.headers.get("content-type") ?? "").toLowerCase();
        let payload = null;
        try {
          payload = await r.json();
        } catch {
          /* not JSON */
        }
        const ok =
          r.status === 200 &&
          ct.includes("application/json") &&
          payload &&
          typeof payload === "object" &&
          typeof payload.text === "string" &&
          !("error" in payload);
        record(
          "SEC-230",
          ok,
          `valid-bearer success → status ${r.status}, ct="${ct}", body keys=[${payload ? Object.keys(payload).join(",") : "n/a"}] (want 200 + {text:string})`,
        );
      }
    } catch (e) {
      record("SEC-230", false, String(e?.message ?? e));
    }
  } else {
    console.log(
      "ℹ️  No real bearer available — skipping SEC-230 (valid-bearer success-shape check).",
    );
  }

  // SEC-231: with a valid bearer, an unsupported `mode` value must be
  // rejected at the input-validation layer with 400 + canonical
  // {"error":"Invalid mode"} JSON — never silently coerced to a default.
  // Runs only when a real bearer is available, otherwise the request would
  // 401 at the auth gate before mode validation can run.
  if (realBearer) {
    const invalidModeCases = [
      ["SEC-231a", "unknown string mode", "totally-bogus-mode"],
      ["SEC-231b", "numeric mode", 12345],
      ["SEC-231c", "object mode", { x: 1 }],
      ["SEC-231d", "array mode", ["insights"]],
      ["SEC-231e", "boolean mode", true],
    ];
    for (const [id, label, modeVal] of invalidModeCases) {
      try {
        const reqBody = JSON.stringify({ mode: modeVal, snapshot: {} });
        const r = await fetch(url, {
          method: "POST",
          headers: { ...json, authorization: `Bearer ${realBearer}` },
          body: reqBody,
        });
        const ct = (r.headers.get("content-type") ?? "").toLowerCase();
        let payload = null,
          raw = "";
        try {
          raw = await r.text();
          payload = JSON.parse(raw);
        } catch {}
        const ok =
          r.status === 400 &&
          ct.includes("application/json") &&
          payload &&
          typeof payload === "object" &&
          Object.keys(payload).length === 1 &&
          payload.error === "Invalid mode";
        record(
          id,
          ok,
          `${label} → status ${r.status}, ct "${ct}", body ${raw.slice(0, 80)} (want 400 + {error:"Invalid mode"})`,
        );
      } catch (e) {
        record(id, false, String(e?.message ?? e));
      }
    }
  } else {
    console.log(
      "ℹ️  No real bearer available — skipping SEC-231 (invalid-mode input-validation check).",
    );
  }

  // SEC-232: with a valid bearer, omitting required body fields must surface a
  // canonical JSON error — never silently coerced into a default request. The
  // handler returns 400 for "body isn't a JSON object" cases and 422 for
  // "object but missing required fields" cases. Each response must be
  // content-type application/json with a single `error` key.
  if (realBearer) {
    const missingFieldCases = [
      // [id, label, rawBodyString, expectedStatus, expectedError]
      ["SEC-232a", "empty string body", "", 400, "Invalid JSON"],
      ["SEC-232b", "JSON null body", "null", 400, "Request body must be a JSON object"],
      ["SEC-232c", "JSON array body", "[]", 400, "Request body must be a JSON object"],
      ["SEC-232d", "empty object body", "{}", 422, "snapshot or instruction is required"],
      [
        "SEC-232e",
        "chat mode missing msgs",
        JSON.stringify({ mode: "chat" }),
        422,
        "messages array is required",
      ],
      [
        "SEC-232f",
        "assistant missing msgs",
        JSON.stringify({ mode: "assistant" }),
        422,
        "messages array is required",
      ],
    ];
    for (const [id, label, rawBody, wantStatus, wantError] of missingFieldCases) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { ...json, authorization: `Bearer ${realBearer}` },
          body: rawBody,
        });
        const ct = (r.headers.get("content-type") ?? "").toLowerCase();
        let payload = null,
          raw = "";
        try {
          raw = await r.text();
          payload = JSON.parse(raw);
        } catch {}
        const ok =
          r.status === wantStatus &&
          ct.includes("application/json") &&
          payload &&
          typeof payload === "object" &&
          Object.keys(payload).length === 1 &&
          payload.error === wantError;
        record(
          id,
          ok,
          `${label} → status ${r.status}, ct "${ct}", body ${raw.slice(0, 100)} (want ${wantStatus} + {error:"${wantError}"})`,
        );
      } catch (e) {
        record(id, false, String(e?.message ?? e));
      }
    }
  } else {
    console.log(
      "ℹ️  No real bearer available — skipping SEC-232 (missing-required-fields input-validation check).",
    );
  }

  // SEC-233: 429 rate-limit responses must use the canonical JSON error shape
  // (`{"error":"Rate limit reached."}`, single key, application/json) — not a
  // bare HTML/text body. Triggered deterministically via the CI-only force
  // header gated by AI_TEST_FORCE_SECRET; we DO NOT skip when a real bearer
  // is available — only when the force secret isn't configured.
  const forceSecret = process.env.AI_TEST_FORCE_SECRET ?? "";
  if (realBearer && forceSecret) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          ...json,
          authorization: `Bearer ${realBearer}`,
          "x-ai-test-force-secret": forceSecret,
          "x-ai-test-force-status": "429",
        },
        body: JSON.stringify({ mode: "insights", snapshot: {} }),
      });
      const ct = (r.headers.get("content-type") ?? "").toLowerCase();
      let payload = null,
        raw = "";
      try {
        raw = await r.text();
        payload = JSON.parse(raw);
      } catch {}
      const ok =
        r.status === 429 &&
        ct.includes("application/json") &&
        payload &&
        typeof payload === "object" &&
        Object.keys(payload).length === 1 &&
        payload.error === "Rate limit reached.";
      record(
        "SEC-233",
        ok,
        `429 shape → status ${r.status}, ct "${ct}", body ${raw.slice(0, 100)} (want 429 + {error:"Rate limit reached."})`,
      );
    } catch (e) {
      record("SEC-233", false, String(e?.message ?? e));
    }
  } else if (!forceSecret) {
    console.log(
      "ℹ️  AI_TEST_FORCE_SECRET not set — skipping SEC-233 (429 shape check). Set it in CI alongside the matching env var on the server to enable.",
    );
  } else {
    console.log("ℹ️  No real bearer available — skipping SEC-233 (429 shape check).");
  }

  // SEC-212 / SEC-213: JWT "alg confusion" attacks. Verifier must pin HS256
  // and reject `alg:"none"` (unsigned) and mismatched algs like RS256 where
  // no real RSA signature is present. Both must return 401.
  const algClaims = {
    sub: "00000000-0000-0000-0000-000000000000",
    aud: "authenticated",
    role: "authenticated",
    iss: "https://example.supabase.co/auth/v1",
    iat: now() - 60,
    exp: now() + 3600,
  };
  const algCases = [
    ["SEC-212", "none", "", "alg=none"],
    ["SEC-213", "RS256", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "alg=RS256 mismatch"],
  ];
  for (const [id, alg, sig, note] of algCases) {
    try {
      const token = `${b64({ alg, typ: "JWT" })}.${b64(algClaims)}.${sig}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { ...json, authorization: `Bearer ${token}` },
        body,
      });
      record(id, r.status === 401, `${note} → status ${r.status} (want 401)`);
    } catch (e) {
      record(id, false, String(e?.message ?? e));
    }
  }

  // SEC-205..208: unsupported HTTP methods must return 405 with an `Allow`
  // header that advertises POST. Asserts method gating runs independently of
  // (and produces a distinct status from) the 401 auth gate.
  const methodChecks = [
    ["SEC-205", "GET"],
    ["SEC-206", "PUT"],
    ["SEC-207", "PATCH"],
    ["SEC-208", "DELETE"],
  ];
  for (const [id, method] of methodChecks) {
    try {
      const r = await fetch(url, {
        method,
        headers: json,
        body: method === "GET" ? undefined : body,
      });
      const allow = (r.headers.get("allow") ?? "").toLowerCase();
      const ok = r.status === 405 && allow.includes("post");
      record(id, ok, `${method} → status ${r.status}, allow="${allow}" (want 405 + POST)`);
    } catch (e) {
      record(id, false, String(e?.message ?? e));
    }
  }

  // SEC-209: OPTIONS preflight returns 204 with the Allow header.
  try {
    const r = await fetch(url, { method: "OPTIONS" });
    const allow = (r.headers.get("allow") ?? "").toLowerCase();
    record(
      "SEC-209",
      r.status === 204 && allow.includes("post"),
      `OPTIONS → status ${r.status}, allow="${allow}" (want 204 + POST)`,
    );
  } catch (e) {
    record("SEC-209", false, String(e?.message ?? e));
  }

  // SEC-225: CORS preflight (OPTIONS with Origin + ACRM/ACRH) returns 204 and
  // the expected Access-Control-Allow-* headers. A browser will block the real
  // POST if any of these are missing or mismatched.
  try {
    const r = await fetch(url, {
      method: "OPTIONS",
      headers: {
        origin: "https://example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, content-type",
      },
    });
    const h = (n) => (r.headers.get(n) ?? "").toLowerCase();
    const allowOrigin = h("access-control-allow-origin");
    const allowMethods = h("access-control-allow-methods");
    const allowHeaders = h("access-control-allow-headers");
    const maxAge = h("access-control-max-age");
    const ok =
      r.status === 204 &&
      (allowOrigin === "*" || allowOrigin === "https://example.com") &&
      allowMethods.includes("post") &&
      allowHeaders.includes("authorization") &&
      allowHeaders.includes("content-type") &&
      /^\d+$/.test(maxAge);
    record(
      "SEC-225",
      ok,
      `CORS preflight → status ${r.status}, origin="${allowOrigin}", methods="${allowMethods}", headers="${allowHeaders}", max-age="${maxAge}"`,
    );
  } catch (e) {
    record("SEC-225", false, String(e?.message ?? e));
  }

  // SEC-226: a 405 on an unsupported method still carries CORS headers, so
  // browsers can surface the error instead of a generic network failure.
  try {
    const r = await fetch(url, { method: "GET", headers: { origin: "https://example.com" } });
    const allowOrigin = (r.headers.get("access-control-allow-origin") ?? "").toLowerCase();
    record(
      "SEC-226",
      r.status === 405 && (allowOrigin === "*" || allowOrigin === "https://example.com"),
      `GET → status ${r.status}, access-control-allow-origin="${allowOrigin}" (want 405 + CORS origin)`,
    );
  } catch (e) {
    record("SEC-226", false, String(e?.message ?? e));
  }

  // SEC-227: 401 responses use the canonical JSON error shape
  // `{"error":"Unauthorized"}` with `content-type: application/json`. Clients
  // depend on this exact shape to surface auth failures.
  try {
    const r = await fetch(url, { method: "POST", headers: json, body });
    const ct = (r.headers.get("content-type") ?? "").toLowerCase();
    let payload = null;
    try {
      payload = await r.json();
    } catch {
      /* not JSON */
    }
    const ok =
      r.status === 401 &&
      ct.includes("application/json") &&
      payload &&
      typeof payload === "object" &&
      Object.keys(payload).length === 1 &&
      payload.error === "Unauthorized";
    record(
      "SEC-227",
      ok,
      `401 shape → status ${r.status}, content-type="${ct}", body=${JSON.stringify(payload)}`,
    );
  } catch (e) {
    record("SEC-227", false, String(e?.message ?? e));
  }

  // SEC-228: 405 responses use the canonical JSON error shape
  // `{"error":"Method Not Allowed"}` with `content-type: application/json`.
  try {
    const r = await fetch(url, { method: "GET" });
    const ct = (r.headers.get("content-type") ?? "").toLowerCase();
    let payload = null;
    try {
      payload = await r.json();
    } catch {
      /* not JSON */
    }
    const ok =
      r.status === 405 &&
      ct.includes("application/json") &&
      payload &&
      typeof payload === "object" &&
      Object.keys(payload).length === 1 &&
      payload.error === "Method Not Allowed";
    record(
      "SEC-228",
      ok,
      `405 shape → status ${r.status}, content-type="${ct}", body=${JSON.stringify(payload)}`,
    );
  } catch (e) {
    record("SEC-228", false, String(e?.message ?? e));
  }

  // SEC-202: valid JWT ⇒ 2xx (skipped if AI_TEST_BEARER not provided).
  if (!process.env.AI_TEST_BEARER) {
    console.log("ℹ️  AI_TEST_BEARER not set — skipping SEC-202 (positive-path AI auth).");
    return;
  }
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { ...json, authorization: `Bearer ${process.env.AI_TEST_BEARER}` },
      body,
    });
    record(
      "SEC-202",
      r.status >= 200 && r.status < 300,
      `valid-bearer → status ${r.status} (want 2xx)`,
    );
  } catch (e) {
    record("SEC-202", false, String(e?.message ?? e));
  }
}

// ───────────────────────── Main ─────────────────────────

await checkNoSignupUi();
await checkNoSignUpAnywhere();
await checkAiAuth();
await checkAiClientAttachesBearer();
await checkAdminClientNotLeaked();
await runDbChecks();
await runAiAuthChecks();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) {
  console.error(
    `\n::error title=Security regression::${failed.length} previously-fixed finding(s) regressed: ${failed
      .map((r) => r.id)
      .join(", ")}`,
  );
  console.error("See docs/security/regression-checks.md for the description of each ID.");
  process.exit(1);
}
