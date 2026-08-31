#!/usr/bin/env node
/**
 * Mint an AI_TEST_BEARER access token for runtime AI auth regression tests.
 *
 * Uses the service-role key to provision (or update) a dedicated CI test user,
 * then signs in with the publishable (anon) key to obtain a real Supabase
 * access_token. The token is printed to stdout (last line) so the workflow can
 * capture it, and — when running under GitHub Actions — also exported to
 * $GITHUB_ENV as AI_TEST_BEARER and registered as a masked value.
 *
 * Required env:
 *   SUPABASE_URL                       Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY          Service-role key (admin)
 *   SUPABASE_PUBLISHABLE_KEY           Publishable / anon key
 *
 * Optional env:
 *   AI_TEST_EMAIL                      Default: ai-ci-bearer@precise.test
 *   GITHUB_ENV / GITHUB_OUTPUT         Auto-detected on GitHub Actions
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { appendFileSync } from "fs";

const IN_ACTIONS = process.env.GITHUB_ACTIONS === "true";

// ---------------------------------------------------------------------------
// Log scrubber — installed BEFORE any other code runs so a stray console.log
// or thrown error containing a token-shaped string can never reach the raw
// log stream. Two layers of defence:
//   1. ::add-mask:: registrations for every secret-shaped env value we know
//      about (and, later, for the minted token + its three JWT segments).
//   2. A monkey-patched process.stdout/stderr.write that regex-replaces any
//      JWT-shaped or sb_*_key-shaped substring before bytes hit the FD.
// Layer 2 catches values we *didn't* know to mask up-front (e.g. tokens
// returned inside an error message body, or a publishable key embedded in a
// stack trace from the Supabase client).
// ---------------------------------------------------------------------------
const MASKED_VALUES = new Set();
function registerMask(value) {
  if (!value || typeof value !== "string" || value.length < 12) return;
  if (MASKED_VALUES.has(value)) return;
  MASKED_VALUES.add(value);
  if (IN_ACTIONS) {
    // Direct write — bypass the scrubber so the ::add-mask:: directive itself
    // reaches the runner intact (the runner needs to see the raw value once
    // to register it).
    process.stdout.write(`::add-mask::${value}\n`);
  }
}

// Pre-register every secret-shaped env we already hold a reference to.
for (const name of [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_URL",
  "AI_TEST_BEARER",
  "PGPASSWORD",
  "SUPABASE_DB_URL",
]) {
  registerMask(process.env[name]);
}

// JWT: three url-safe base64 segments separated by dots, starting with `eyJ`.
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
// Supabase publishable/secret keys (new format).
const SB_KEY_RE = /sb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}/g;

function scrub(chunk) {
  let s = typeof chunk === "string" ? chunk : (chunk?.toString?.("utf8") ?? "");
  // Never scrub the ::add-mask:: directives we emit ourselves.
  if (s.startsWith("::add-mask::")) return s;
  for (const v of MASKED_VALUES) {
    if (v && s.includes(v)) s = s.split(v).join("***REDACTED***");
  }
  s = s.replace(JWT_RE, "***REDACTED_JWT***");
  s = s.replace(SB_KEY_RE, "***REDACTED_SB_KEY***");
  return s;
}

// Only monkey-patch in CI. Local runs need the raw token on stdout so the
// developer can pipe it into a test runner; CI never wants a raw token in
// the log stream regardless of how it got there.
if (IN_ACTIONS) {
  for (const stream of [process.stdout, process.stderr]) {
    const orig = stream.write.bind(stream);
    stream.write = (chunk, ...rest) => {
      const cb = typeof rest[rest.length - 1] === "function" ? rest.pop() : undefined;
      const enc = typeof rest[0] === "string" ? rest[0] : undefined;
      const out = scrub(chunk);
      return enc ? orig(out, enc, cb) : orig(out, cb);
    };
  }
}

/** Print a single actionable error and exit non-zero. */
function die(title, detail, hints = []) {
  const lines = [
    `mint-test-bearer: ${title}`,
    detail ? `  detail : ${detail}` : null,
    ...hints.map((h) => `  hint   : ${h}`),
  ].filter(Boolean);
  // GitHub Actions surfaces ::error:: as a job annotation — easier to spot
  // than buried stderr in a long log. Use a single line for the annotation
  // and the expanded breakdown immediately after.
  if (IN_ACTIONS) {
    console.error(`::error title=mint-test-bearer::${title}${detail ? ` — ${detail}` : ""}`);
  }
  for (const l of lines) console.error(l);
  process.exit(1);
}

// --- 1. Env validation ------------------------------------------------------
// Collect *every* missing var before bailing so the operator fixes them in
// one pass instead of one-at-a-time. Each missing var carries a hint that
// points at where it lives in Lovable Cloud / repo secrets.
const ENV_HINTS = {
  SUPABASE_URL:
    "Set repo secret SUPABASE_URL to your Lovable Cloud project URL (https://<ref>.supabase.co).",
  SUPABASE_SERVICE_ROLE_KEY:
    "Set repo secret SUPABASE_SERVICE_ROLE_KEY to the service-role key. NEVER commit this to the repo.",
  SUPABASE_PUBLISHABLE_KEY:
    "Set repo secret SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY) to the publishable/anon key.",
};

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;

const missing = [];
if (!url) missing.push("SUPABASE_URL");
if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
if (!publishableKey) missing.push("SUPABASE_PUBLISHABLE_KEY");
if (missing.length) {
  die(
    `missing required env: ${missing.join(", ")}`,
    "cannot mint a bearer without these — aborting before any network call",
    missing.map((k) => `${k}: ${ENV_HINTS[k]}`),
  );
}

// --- 2. Shape sanity checks -------------------------------------------------
// Catch the most common copy-paste mistakes BEFORE hitting the network, where
// the failure mode is a confusing 401/403 from gotrue.
try {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) {
    die("SUPABASE_URL is not http(s)", `got protocol "${u.protocol}"`, [
      "Expected something like https://<project-ref>.supabase.co",
    ]);
  }
} catch {
  die("SUPABASE_URL is not a valid URL", `value length ${url.length}`, [
    "Expected something like https://<project-ref>.supabase.co — check for stray quotes or whitespace.",
  ]);
}

// Service-role key is either a JWT (legacy) or an `sb_secret_*` token (new
// format). Both are valid. Catch the two most likely mix-ups: pasting the
// publishable key here, or pasting the URL.
if (serviceKey === publishableKey) {
  die("SUPABASE_SERVICE_ROLE_KEY equals SUPABASE_PUBLISHABLE_KEY", "these MUST be different keys", [
    "You probably set both repo secrets to the publishable key.",
    "Replace SUPABASE_SERVICE_ROLE_KEY with the service-role key (kept private; never used in client code).",
  ]);
}
if (/^https?:\/\//.test(serviceKey)) {
  die(
    "SUPABASE_SERVICE_ROLE_KEY looks like a URL",
    "expected an opaque key, got something starting with http(s)://",
    ["The repo secrets are likely swapped — SUPABASE_URL holds the key, and vice versa."],
  );
}
const looksJwt = serviceKey.split(".").length === 3;
const looksSbSecret = serviceKey.startsWith("sb_secret_");
if (!looksJwt && !looksSbSecret) {
  die(
    "SUPABASE_SERVICE_ROLE_KEY is not in a recognized format",
    "expected a 3-segment JWT or an `sb_secret_*` token",
    [
      "Double-check you copied the *service-role* key (not the publishable key, not the project URL).",
      "On Lovable Cloud, ask the team for the service-role key — it is not browseable from the UI.",
    ],
  );
}

// --- 3. Mint ----------------------------------------------------------------
const email = process.env.AI_TEST_EMAIL || "ai-ci-bearer@precise.test";
// Fresh random password every run; we always rewrite it before signing in.
const password = `Ci!${randomBytes(24).toString("base64url")}`;

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function classifyAdminError(err) {
  const msg = (err?.message ?? String(err)).toLowerCase();
  const status = err?.status ?? err?.statusCode;
  if (
    status === 401 ||
    msg.includes("invalid api key") ||
    msg.includes("invalid jwt") ||
    msg.includes("jwt expired")
  ) {
    return [
      "service-role key was rejected by Supabase Auth (401 / invalid key)",
      [
        "Confirm SUPABASE_SERVICE_ROLE_KEY belongs to the SAME project as SUPABASE_URL.",
        "If the project was rotated recently, re-copy the service-role key into the repo secret.",
        "If you are using a personal-access token by mistake, replace it with the service-role key.",
      ],
    ];
  }
  if (status === 403 || msg.includes("not allowed") || msg.includes("forbidden")) {
    return [
      "service-role key was accepted but lacks admin scope (403)",
      [
        "This usually means SUPABASE_SERVICE_ROLE_KEY was set to the publishable/anon key.",
        "Replace it with the actual service-role key from your project keys.",
      ],
    ];
  }
  if (msg.includes("fetch failed") || msg.includes("enotfound") || msg.includes("econnrefused")) {
    return [
      "could not reach Supabase Auth from this runner",
      [
        `Verify SUPABASE_URL is correct and reachable: ${url}`,
        "If you are behind a firewall, allowlist the project's Supabase hostname.",
      ],
    ];
  }
  return [
    `${err?.name ?? "Error"}${status ? ` (status ${status})` : ""}: ${err?.message ?? err}`,
    [],
  ];
}

async function findUserByEmail(targetEmail) {
  let page = 1;
  const perPage = 200;
  for (let i = 0; i < 50; i++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      const [detail, hints] = classifyAdminError(error);
      die("listUsers failed", detail, hints);
    }
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === targetEmail.toLowerCase());
    if (hit) return hit;
    if (data.users.length < perPage) return null;
    page += 1;
  }
  return null;
}

let userId;
const existing = await findUserByEmail(email);
if (existing) {
  const { error } = await admin.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
  });
  if (error) {
    const [detail, hints] = classifyAdminError(error);
    die("updateUserById failed", detail, hints);
  }
  userId = existing.id;
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "CI AI Auth Tester" },
  });
  if (error) {
    const [detail, hints] = classifyAdminError(error);
    die("createUser failed", detail, hints);
  }
  userId = data.user.id;
}

const anon = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({
  email,
  password,
});
if (signInErr) {
  const msg = (signInErr.message ?? "").toLowerCase();
  if (msg.includes("invalid api key")) {
    die("signInWithPassword failed: publishable key was rejected", signInErr.message, [
      "Confirm SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY) belongs to the same project as SUPABASE_URL.",
      "If you rotated keys recently, re-copy the publishable key into the repo secret.",
    ]);
  }
  if (msg.includes("email") && (msg.includes("disabled") || msg.includes("not allowed"))) {
    die(
      "signInWithPassword failed: email sign-in is disabled for this project",
      signInErr.message,
      [
        "Enable Email provider in Supabase Auth settings — the CI test user signs in via email/password.",
      ],
    );
  }
  die("signInWithPassword failed", signInErr.message, [
    "The CI test user was provisioned, but signing in with the freshly minted password did not work.",
    "Check that the Email auth provider is enabled and that no Auth hook is rejecting the sign-in.",
  ]);
}

const token = signIn.session?.access_token;
if (!token) {
  die(
    "no access_token returned from signInWithPassword",
    "Supabase returned a session object without an access_token",
    [
      "This usually indicates an Auth hook is intercepting the response — check project Auth hooks.",
    ],
  );
}

// --- 4. Emit ----------------------------------------------------------------
// Register masks BEFORE the value can appear in any later log line. We mask
// the whole token AND each JWT segment individually — a truncated log line
// (e.g. one that wraps mid-token) would otherwise expose a usable segment.
registerMask(token);
for (const seg of token.split(".")) registerMask(seg);

if (IN_ACTIONS) {
  if (process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `AI_TEST_BEARER=${token}\n`);
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `bearer=${token}\n`);
  }
  // The scrubber will replace `token` with ***REDACTED*** in this line too,
  // belt-and-braces in case the runner hasn't processed ::add-mask:: yet.
  console.error(
    `mint-test-bearer: minted token for ${email} (user ${userId}); exported AI_TEST_BEARER`,
  );
} else {
  console.error(`mint-test-bearer: minted token for ${email} (user ${userId})`);
  // Local dev only: write the raw token to a dedicated FD path so a parent
  // shell can capture it without it landing in scrollback. Falls back to
  // stdout when run interactively.
  process.stdout.write(token + "\n");
}
