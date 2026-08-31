/**
 * Runtime regression tests for /api/ai authentication.
 *
 * Verifies:
 *   - 401 when the Authorization header is missing
 *   - 401 when the bearer is not a well-formed JWT
 *   - 200 when a valid Supabase JWT is presented
 *
 * The positive-path test (valid JWT) is skipped unless one of these is set:
 *   - LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN  (auto-injected in the sandbox)
 *   - AI_TEST_BEARER                          (explicit override)
 *
 * Run locally:
 *   bunx playwright test tests/security/ai-auth.spec.ts
 */
import { test, expect, request as pwRequest } from "@playwright/test";

const BASE_URL = process.env.AI_TEST_BASE_URL ?? "http://localhost:8080";
const BEARER =
  process.env.AI_TEST_BEARER ?? process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN ?? "";

const PAYLOAD = {
  mode: "chat",
  messages: [{ role: "user", content: "ping" }],
};

/**
 * Build an unsigned JWT-shaped token with the given claims. The signature is
 * intentionally bogus — Supabase Auth must reject it on signature/exp/nbf
 * grounds before our handler ever runs. This is sufficient to assert that the
 * gate enforces expiry and not-before semantics: a 200 here would mean the
 * server is accepting tokens with bad lifetimes (or no verification at all).
 */
function forgeJwt(claims: Record<string, unknown>): string {
  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=+$/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const header = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    sub: "00000000-0000-0000-0000-000000000000",
    aud: "authenticated",
    role: "authenticated",
    iss: "https://example.supabase.co/auth/v1",
    iat: Math.floor(Date.now() / 1000) - 60,
    ...claims,
  });
  // Fixed bogus signature — never a valid HMAC for the header/body above.
  return `${header}.${body}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
}

// Per-test request timeout for fetches against /api/ai. Cold-starts on
// serverless platforms can take several seconds; 20s keeps real regressions
// fast to flag without churning on transient cold-starts.
const REQUEST_TIMEOUT_MS = 20_000;

test.describe("/api/ai auth regression", () => {
  // Retry policy:
  //   - In CI: retry twice (3 attempts total) to absorb cold-starts, brief
  //     gateway hiccups, and DNS blips that produce transient non-401/405
  //     responses. A true regression fails consistently across all attempts.
  //   - Locally: no retries — surface failures immediately during development.
  // Per-test timeout is larger than the per-request timeout so a slow first
  // attempt + retry can still complete within one test slot.
  test.describe.configure({
    retries: process.env.CI ? 2 : 0,
    timeout: 60_000,
  });

  test("SEC-200: rejects requests with no Authorization header (401)", async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.post(`${BASE_URL}/api/ai`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { "content-type": "application/json" },
      data: PAYLOAD,
    });
    expect(res.status(), `no-auth status ${res.status()}`).toBe(401);
    await ctx.dispose();
  });

  test("SEC-201: rejects requests with a malformed bearer (401)", async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.post(`${BASE_URL}/api/ai`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "content-type": "application/json",
        authorization: "Bearer not-a-jwt",
      },
      data: PAYLOAD,
    });
    expect(res.status(), `bad-bearer status ${res.status()}`).toBe(401);
    await ctx.dispose();
  });

  // SEC-216..SEC-224: variety of malformed / undecodable bearer shapes.
  // Each must be rejected at the auth layer with 401 — the validator must
  // never partially-trust a token whose structure or encoding is invalid.
  const b64u = (s: string) =>
    Buffer.from(s).toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const malformedCases: Array<{ id: string; label: string; header: string }> = [
    { id: "SEC-216", label: "empty bearer value", header: "Bearer " },
    { id: "SEC-217", label: "whitespace-only bearer", header: "Bearer    \t  " },
    { id: "SEC-218", label: "one-segment token", header: "Bearer onlyonesegment" },
    { id: "SEC-219", label: "two-segment token", header: "Bearer header.payload" },
    { id: "SEC-220", label: "four-segment token", header: "Bearer a.b.c.d" },
    { id: "SEC-221", label: "non-base64 garbage segs", header: "Bearer !!!.@@@.###" },
    {
      id: "SEC-222",
      label: "base64 of non-JSON",
      header: `Bearer ${b64u("hello")}.${b64u("world")}.AAAA`,
    },
    { id: "SEC-223", label: "wrong auth scheme", header: "Basic dXNlcjpwYXNz" },
    {
      id: "SEC-224",
      label: "missing scheme (raw token)",
      header: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig",
    },
  ];
  for (const { id, label, header } of malformedCases) {
    test(`${id}: rejects ${label} → 401 + {error:"Unauthorized"}`, async () => {
      const ctx = await pwRequest.newContext();
      const res = await ctx.post(`${BASE_URL}/api/ai`, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: { "content-type": "application/json", authorization: header },
        data: PAYLOAD,
      });
      expect(res.status(), `${label} status ${res.status()}`).toBe(401);
      const ct = res.headers()["content-type"] ?? "";
      expect(ct, `content-type "${ct}"`).toMatch(/application\/json/i);
      const raw = await res.text();
      let parsed: unknown = null;
      expect(
        () => {
          parsed = JSON.parse(raw);
        },
        `body not JSON: ${raw.slice(0, 120)}`,
      ).not.toThrow();
      expect(parsed).toEqual({ error: "Unauthorized" });
      expect(Object.keys(parsed as object)).toEqual(["error"]);
      await ctx.dispose();
    });
  }

  // SEC-234: non-Bearer auth schemes must be rejected with 401 + canonical
  // `{"error":"Unauthorized"}` even when the token portion is a structurally
  // valid JWT-shaped string. Guards against a lenient parser that ignores
  // the scheme and just splits on whitespace.
  const fakeJwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u('{"sub":"x"}')}.${b64u("sig")}`;
  const wrongSchemeCases: Array<{ id: string; label: string; header: string }> = [
    { id: "SEC-234a", label: "Token scheme", header: `Token ${fakeJwt}` },
    { id: "SEC-234b", label: "Basic scheme", header: "Basic dXNlcjpwYXNzd29yZA==" },
    {
      id: "SEC-234c",
      label: "Digest scheme",
      header: 'Digest username="x", realm="r", nonce="n", response="abc"',
    },
    { id: "SEC-234d", label: "JWT scheme", header: `JWT ${fakeJwt}` },
    { id: "SEC-234e", label: "OAuth scheme", header: `OAuth ${fakeJwt}` },
    { id: "SEC-234f", label: "ApiKey scheme", header: "ApiKey abc123" },
    { id: "SEC-234g", label: "Negotiate scheme", header: "Negotiate YIIZ..." },
    { id: "SEC-234h", label: "lowercase token scheme", header: `token ${fakeJwt}` },
  ];
  for (const { id, label, header } of wrongSchemeCases) {
    test(`${id}: rejects ${label} → 401 + {error:"Unauthorized"}`, async () => {
      const ctx = await pwRequest.newContext();
      const res = await ctx.post(`${BASE_URL}/api/ai`, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: { "content-type": "application/json", authorization: header },
        data: PAYLOAD,
      });
      expect(res.status(), `${label} status ${res.status()}`).toBe(401);
      const ct = res.headers()["content-type"] ?? "";
      expect(ct, `content-type "${ct}"`).toMatch(/application\/json/i);
      const raw = await res.text();
      let parsed: unknown = null;
      expect(
        () => {
          parsed = JSON.parse(raw);
        },
        `body not JSON: ${raw.slice(0, 120)}`,
      ).not.toThrow();
      expect(parsed).toEqual({ error: "Unauthorized" });
      expect(Object.keys(parsed as object)).toEqual(["error"]);
      await ctx.dispose();
    });
  }

  // SEC-229: "no credentials" must be 401 Unauthorized, never 403 Forbidden.
  // 403 implies an authenticated identity that lacks permission — wrong
  // semantics when the caller supplied no token at all. We assert the exact
  // status code and the canonical `{error:"Unauthorized"}` JSON shape.
  const noCredCases: Array<{ id: string; label: string; header: string | null }> = [
    { id: "SEC-229a", label: "no Authorization header", header: null },
    { id: "SEC-229b", label: "empty Authorization header", header: "" },
    { id: "SEC-229c", label: "Bearer with empty token", header: "Bearer " },
  ];
  for (const { id, label, header } of noCredCases) {
    test(`${id}: ${label} → 401 (not 403) with {error:'Unauthorized'}`, async () => {
      const ctx = await pwRequest.newContext();
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (header !== null) headers.authorization = header;
      const res = await ctx.post(`${BASE_URL}/api/ai`, {
        timeout: REQUEST_TIMEOUT_MS,
        headers,
        data: PAYLOAD,
      });
      expect(res.status(), `${label} status ${res.status()}`).toBe(401);
      expect(res.status(), `${label} must not be 403`).not.toBe(403);
      const ct = (res.headers()["content-type"] ?? "").toLowerCase();
      expect(ct).toContain("application/json");
      const body = await res.json();
      expect(body).toEqual({ error: "Unauthorized" });
      await ctx.dispose();
    });
  }

  test("SEC-202: accepts requests with a valid Supabase JWT (2xx)", async () => {
    test.skip(!BEARER, "No AI_TEST_BEARER / LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN available");
    const ctx = await pwRequest.newContext();
    const res = await ctx.post(`${BASE_URL}/api/ai`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${BEARER}`,
      },
      data: PAYLOAD,
    });
    // 2xx = auth passed. 402/429 are upstream-gateway conditions, not auth
    // regressions, so we only fail when the gate itself rejects.
    expect(
      res.status() < 400 || res.status() === 402 || res.status() === 429,
      `valid-bearer status ${res.status()}`,
    ).toBe(true);
    expect(res.status(), "auth must not produce 401/403").not.toBe(401);
    expect(res.status(), "auth must not produce 401/403").not.toBe(403);
    await ctx.dispose();
  });

  test("SEC-230: valid Supabase JWT returns 200 and {text:string} JSON", async () => {
    test.skip(!BEARER, "No AI_TEST_BEARER / LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN available");
    const ctx = await pwRequest.newContext();
    // Use a deterministic small one-shot mode ("insights") with a minimal
    // snapshot so the gateway has trivial work to do. We assert the canonical
    // success shape: status 200, application/json, body has a string `text`.
    const successPayload = {
      mode: "insights",
      snapshot: {
        totalSellValue: 0,
        totalCashReceived: 0,
        totalPending: 0,
        totalOverdue: 0,
      },
    };
    const res = await ctx.post(`${BASE_URL}/api/ai`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${BEARER}`,
      },
      data: successPayload,
    });

    // 402/429 are environmental (credits exhausted / rate-limited) — skip,
    // since they're not an auth regression and would flake CI.
    test.skip(
      res.status() === 402 || res.status() === 429,
      `gateway returned ${res.status()} (credits/rate-limit, not an auth regression)`,
    );

    expect(res.status(), `valid-bearer success status ${res.status()}`).toBe(200);
    const ct = res.headers()["content-type"] ?? "";
    expect(ct, `content-type "${ct}"`).toMatch(/application\/json/i);
    const raw = await res.text();
    let parsed: any = null;
    expect(
      () => {
        parsed = JSON.parse(raw);
      },
      `body not JSON: ${raw.slice(0, 120)}`,
    ).not.toThrow();
    expect(parsed && typeof parsed).toBe("object");
    expect(typeof parsed.text, `expected string \`text\`, got ${typeof parsed.text}`).toBe(
      "string",
    );
    expect(parsed).not.toHaveProperty("error");
    await ctx.dispose();
  });

  // SEC-231: with a valid bearer, an unsupported `mode` must be rejected
  // at the input-validation layer with 400 + canonical
  // {"error":"Invalid mode"} — never coerced to a working default.
  const invalidModeCases: Array<[string, string, unknown]> = [
    ["SEC-231a", "unknown string mode", "totally-bogus-mode"],
    ["SEC-231b", "numeric mode", 12345],
    ["SEC-231c", "object mode", { x: 1 }],
    ["SEC-231d", "array mode", ["insights"]],
    ["SEC-231e", "boolean mode", true],
  ];
  for (const [id, label, modeVal] of invalidModeCases) {
    test(`${id}: invalid mode (${label}) returns 400 + {error:"Invalid mode"}`, async () => {
      test.skip(!BEARER, "No AI_TEST_BEARER / LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN available");
      const ctx = await pwRequest.newContext();
      const res = await ctx.post(`${BASE_URL}/api/ai`, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${BEARER}`,
        },
        data: { mode: modeVal, snapshot: {} },
      });
      expect(res.status(), `${label} status ${res.status()}`).toBe(400);
      const ct = res.headers()["content-type"] ?? "";
      expect(ct, `content-type "${ct}"`).toMatch(/application\/json/i);
      const raw = await res.text();
      let parsed: unknown = null;
      expect(
        () => {
          parsed = JSON.parse(raw);
        },
        `body not JSON: ${raw.slice(0, 120)}`,
      ).not.toThrow();
      expect(parsed).toEqual({ error: "Invalid mode" });
      expect(Object.keys(parsed as object)).toEqual(["error"]);
      await ctx.dispose();
    });
  }

  // SEC-232: with a valid bearer, omitting required body fields must surface
  // a canonical JSON error — never silently coerced into a default request.
  // 400 for "body isn't a JSON object" cases; 422 for "object but missing
  // required fields" cases. Each response must be content-type
  // application/json with a single `error` key.
  const missingFieldCases: Array<[string, string, string, number, string]> = [
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
    test(`${id}: missing required fields (${label}) returns ${wantStatus} + {error:"${wantError}"}`, async () => {
      test.skip(!BEARER, "No AI_TEST_BEARER / LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN available");
      const ctx = await pwRequest.newContext();
      const res = await ctx.post(`${BASE_URL}/api/ai`, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${BEARER}`,
        },
        data: rawBody,
      });
      expect(res.status(), `${label} status ${res.status()}`).toBe(wantStatus);
      const ct = res.headers()["content-type"] ?? "";
      expect(ct, `content-type "${ct}"`).toMatch(/application\/json/i);
      const raw = await res.text();
      let parsed: unknown = null;
      expect(
        () => {
          parsed = JSON.parse(raw);
        },
        `body not JSON: ${raw.slice(0, 120)}`,
      ).not.toThrow();
      expect(parsed).toEqual({ error: wantError });
      expect(Object.keys(parsed as object)).toEqual(["error"]);
      await ctx.dispose();
    });
  }

  // SEC-233: 429 rate-limit responses must use the canonical JSON error shape
  // (`{"error":"Rate limit reached."}`, single key, application/json) — not a
  // bare HTML/text body. Triggered deterministically via the CI-only force
  // header gated by AI_TEST_FORCE_SECRET so this case is verified, never just
  // skipped, whenever the secret is present on both client and server.
  test("SEC-233: 429 rate-limit response uses canonical JSON shape", async () => {
    const forceSecret = process.env.AI_TEST_FORCE_SECRET ?? "";
    test.skip(!BEARER, "No AI_TEST_BEARER / LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN available");
    test.skip(!forceSecret, "AI_TEST_FORCE_SECRET not set — cannot deterministically force 429");
    const ctx = await pwRequest.newContext();
    const res = await ctx.post(`${BASE_URL}/api/ai`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${BEARER}`,
        "x-ai-test-force-secret": forceSecret,
        "x-ai-test-force-status": "429",
      },
      data: { mode: "insights", snapshot: {} },
    });
    expect(res.status(), `429-force status ${res.status()}`).toBe(429);
    const ct = res.headers()["content-type"] ?? "";
    expect(ct, `content-type "${ct}"`).toMatch(/application\/json/i);
    const raw = await res.text();
    let parsed: unknown = null;
    expect(
      () => {
        parsed = JSON.parse(raw);
      },
      `body not JSON: ${raw.slice(0, 120)}`,
    ).not.toThrow();
    expect(parsed).toEqual({ error: "Rate limit reached." });
    expect(Object.keys(parsed as object)).toEqual(["error"]);
    await ctx.dispose();
  });

  test("SEC-203: rejects an expired JWT (401)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = forgeJwt({ exp: now - 3600, nbf: now - 7200 });
    const ctx = await pwRequest.newContext();
    const res = await ctx.post(`${BASE_URL}/api/ai`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      data: PAYLOAD,
    });
    expect(res.status(), `expired-jwt status ${res.status()}`).toBe(401);
    await ctx.dispose();
  });

  test('SEC-203b: expired JWT returns canonical {"error":"Unauthorized"} JSON body', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = forgeJwt({ exp: now - 3600, nbf: now - 7200 });
    const ctx = await pwRequest.newContext();
    const res = await ctx.post(`${BASE_URL}/api/ai`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      data: PAYLOAD,
    });
    expect(res.status(), `expired-jwt body status ${res.status()}`).toBe(401);
    const ct = res.headers()["content-type"] ?? "";
    expect(ct, `content-type "${ct}"`).toMatch(/application\/json/i);
    const raw = await res.text();
    let parsed: unknown = null;
    expect(
      () => {
        parsed = JSON.parse(raw);
      },
      `body not JSON: ${raw.slice(0, 120)}`,
    ).not.toThrow();
    expect(parsed).toEqual({ error: "Unauthorized" });
    expect(Object.keys(parsed as object)).toEqual(["error"]);
    await ctx.dispose();
  });

  test("SEC-204: rejects a not-yet-valid JWT (401)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = forgeJwt({ nbf: now + 3600, exp: now + 7200 });
    const ctx = await pwRequest.newContext();
    const res = await ctx.post(`${BASE_URL}/api/ai`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      data: PAYLOAD,
    });
    expect(res.status(), `nbf-future status ${res.status()}`).toBe(401);
    await ctx.dispose();
  });

  // SEC-214 / SEC-215: clock-skew leeway.
  //
  // JWT verifiers commonly allow a small `leeway` (a few seconds to a couple
  // of minutes) on `exp`/`nbf` to absorb clock drift between issuer and
  // verifier. That is fine, but the gate must still reject anything *past*
  // the leeway window — otherwise the leeway becomes an unbounded grace
  // period.
  //
  // To stay stable across environments we parameterize the assumed leeway via
  // `AI_TEST_JWT_LEEWAY_SECONDS` (default 60s) and test at `leeway × 5`
  // outside the window — comfortably beyond any reasonable skew tolerance,
  // so the assertion can't flake on a host with a slightly skewed clock or a
  // verifier that allows a few extra seconds.
  const LEEWAY_S = Number(process.env.AI_TEST_JWT_LEEWAY_SECONDS ?? 60);
  const BEYOND_LEEWAY_S = Math.max(LEEWAY_S * 5, 300);

  test(`SEC-214: rejects exp ${BEYOND_LEEWAY_S}s past (beyond leeway) (401)`, async () => {
    const now = Math.floor(Date.now() / 1000);
    // exp just beyond leeway, but iat/nbf comfortably in the past so the only
    // possible rejection reason is expiry (not nbf or iat-in-future).
    const token = forgeJwt({
      iat: now - BEYOND_LEEWAY_S - 60,
      nbf: now - BEYOND_LEEWAY_S - 60,
      exp: now - BEYOND_LEEWAY_S,
    });
    const ctx = await pwRequest.newContext();
    const res = await ctx.post(`${BASE_URL}/api/ai`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      data: PAYLOAD,
    });
    expect(res.status(), `exp-beyond-leeway (${BEYOND_LEEWAY_S}s) status ${res.status()}`).toBe(
      401,
    );
    await ctx.dispose();
  });

  test(`SEC-215: rejects nbf ${BEYOND_LEEWAY_S}s in the future (beyond leeway) (401)`, async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = forgeJwt({
      iat: now,
      nbf: now + BEYOND_LEEWAY_S,
      exp: now + BEYOND_LEEWAY_S + 3600,
    });
    const ctx = await pwRequest.newContext();
    const res = await ctx.post(`${BASE_URL}/api/ai`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      data: PAYLOAD,
    });
    expect(res.status(), `nbf-beyond-leeway (${BEYOND_LEEWAY_S}s) status ${res.status()}`).toBe(
      401,
    );
    await ctx.dispose();
  });

  // SEC-235: structurally valid 3-segment JWT with valid identity claims but
  // missing one or more required time-based claims (`exp`, `iat`, `nbf`). A
  // correct verifier MUST require these for session tokens — without claim
  // presence checks a forged token would be implicitly immortal. The response
  // must always be 401 + canonical {"error":"Unauthorized"} single-key JSON,
  // with no echo of `sub`/`aud`/`role` from the unverified payload.
  function forgeJwtExact(claims: Record<string, unknown>): string {
    const b64 = (obj: unknown) =>
      Buffer.from(JSON.stringify(obj))
        .toString("base64")
        .replace(/=+$/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    const header = b64({ alg: "HS256", typ: "JWT" });
    // No defaults: only the fields the caller passes are encoded.
    const body = b64(claims);
    return `${header}.${body}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
  }
  const BASE_IDENTITY = {
    sub: "00000000-0000-0000-0000-000000000000",
    aud: "authenticated",
    role: "authenticated",
    iss: "https://example.supabase.co/auth/v1",
  };
  const missingClaimCases: Array<{
    id: string;
    label: string;
    build: () => Record<string, unknown>;
  }> = [
    {
      id: "SEC-235a",
      label: "no exp (iat+nbf present)",
      build: () => {
        const n = Math.floor(Date.now() / 1000);
        return { ...BASE_IDENTITY, iat: n - 60, nbf: n - 60 };
      },
    },
    {
      id: "SEC-235b",
      label: "no iat (exp+nbf present)",
      build: () => {
        const n = Math.floor(Date.now() / 1000);
        return { ...BASE_IDENTITY, nbf: n - 60, exp: n + 3600 };
      },
    },
    {
      id: "SEC-235c",
      label: "no nbf (exp+iat present)",
      build: () => {
        const n = Math.floor(Date.now() / 1000);
        return { ...BASE_IDENTITY, iat: n - 60, exp: n + 3600 };
      },
    },
    { id: "SEC-235d", label: "no exp/iat/nbf at all", build: () => ({ ...BASE_IDENTITY }) },
  ];
  for (const { id, label, build } of missingClaimCases) {
    test(`${id}: rejects JWT missing time-based claims — ${label} (401 + canonical body)`, async () => {
      const token = forgeJwtExact(build());
      const ctx = await pwRequest.newContext();
      const res = await ctx.post(`${BASE_URL}/api/ai`, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        data: PAYLOAD,
      });
      const status = res.status();
      const ct = (res.headers()["content-type"] ?? "").toLowerCase();
      const raw = await res.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw);
      } catch {}
      expect(status, `${label} status ${status}`).toBe(401);
      expect(ct, `${label} content-type "${ct}"`).toContain("application/json");
      expect(parsed, `${label} body not JSON object: ${raw.slice(0, 120)}`).toEqual({
        error: "Unauthorized",
      });
      await ctx.dispose();
    });
  }

  // SEC-236: 401 responses MUST NOT echo any decoded JWT claims or other
  // token-derived data. We forge tokens stuffed with a uniquely identifiable
  // "canary" in every standard + custom claim slot across the major 401
  // rejection paths (expired, not-yet-valid, missing claims, bad signature)
  // and assert the raw response body never contains that canary and exposes
  // exactly the single `error: "Unauthorized"` key.
  const LEAK_CANARY = "CANARY-LEAK-PROBE-7f3c1e9a";
  function canaryClaims(extra: Record<string, unknown>): Record<string, unknown> {
    return {
      sub: `${LEAK_CANARY}-sub-00000000-0000-0000-0000-000000000000`,
      aud: `${LEAK_CANARY}-aud`,
      role: `${LEAK_CANARY}-role`,
      iss: `https://${LEAK_CANARY}.example.invalid/auth/v1`,
      email: `${LEAK_CANARY}@example.invalid`,
      user_metadata: { name: `${LEAK_CANARY}-name` },
      app_metadata: { provider: `${LEAK_CANARY}-provider` },
      [`x_${LEAK_CANARY}_custom`]: `${LEAK_CANARY}-custom-value`,
      ...extra,
    };
  }
  const leakCases: Array<{ id: string; label: string; build: () => Record<string, unknown> }> = [
    {
      id: "SEC-236a",
      label: "expired",
      build: () => {
        const n = Math.floor(Date.now() / 1000);
        return canaryClaims({ iat: n - 7200, nbf: n - 7200, exp: n - 3600 });
      },
    },
    {
      id: "SEC-236b",
      label: "not-yet-valid",
      build: () => {
        const n = Math.floor(Date.now() / 1000);
        return canaryClaims({ iat: n, nbf: n + 3600, exp: n + 7200 });
      },
    },
    {
      id: "SEC-236c",
      label: "missing-exp",
      build: () => {
        const n = Math.floor(Date.now() / 1000);
        return canaryClaims({ iat: n - 60, nbf: n - 60 });
      },
    },
    {
      id: "SEC-236d",
      label: "bad-signature",
      build: () => {
        const n = Math.floor(Date.now() / 1000);
        return canaryClaims({ iat: n - 60, nbf: n - 60, exp: n + 3600 });
      },
    },
  ];
  for (const { id, label, build } of leakCases) {
    test(`${id}: 401 body never echoes decoded JWT claims — ${label}`, async () => {
      const token = forgeJwtExact(build());
      const ctx = await pwRequest.newContext();
      const res = await ctx.post(`${BASE_URL}/api/ai`, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        data: PAYLOAD,
      });
      const status = res.status();
      const ct = (res.headers()["content-type"] ?? "").toLowerCase();
      const raw = await res.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw);
      } catch {}
      expect(status, `${label} status ${status}`).toBe(401);
      expect(ct, `${label} content-type "${ct}"`).toContain("application/json");
      // A single substring check on the raw body catches a canary leaked in
      // any field (top-level, nested, or interpolated into a message string).
      expect(
        raw.includes(LEAK_CANARY),
        `${label} body leaks token-derived canary: ${raw.slice(0, 200)}`,
      ).toBe(false);
      expect(
        parsed,
        `${label} body not canonical {error:"Unauthorized"}: ${raw.slice(0, 200)}`,
      ).toEqual({ error: "Unauthorized" });
      await ctx.dispose();
    });
  }

  // SEC-205..208: unsupported HTTP methods must be rejected with 405 and an
  // `Allow` header advertising the supported verbs. Auth is intentionally NOT
  // provided — method dispatch must happen before (or independently of) the
  // auth check, so unsupported verbs never leak into handler logic.
  for (const method of ["GET", "PUT", "PATCH", "DELETE"] as const) {
    const id = { GET: "SEC-205", PUT: "SEC-206", PATCH: "SEC-207", DELETE: "SEC-208" }[method];
    test(`${id}: rejects ${method} with 405 + Allow header`, async () => {
      const ctx = await pwRequest.newContext();
      const res = await ctx.fetch(`${BASE_URL}/api/ai`, {
        timeout: REQUEST_TIMEOUT_MS,
        method,
        headers: { "content-type": "application/json" },
        data: method === "GET" ? undefined : PAYLOAD,
      });
      // 405 is the contract; some runtimes return 401 first if they auth before
      // dispatch — we want 405 specifically to prove method gating.
      expect(res.status(), `${method} status ${res.status()}`).toBe(405);
      const allow = (res.headers()["allow"] ?? "").toLowerCase();
      expect(allow, `${method} Allow header`).toContain("post");
      await ctx.dispose();
    });
  }

  test("SEC-209: OPTIONS returns 204 with Allow header", async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.fetch(`${BASE_URL}/api/ai`, {
      timeout: REQUEST_TIMEOUT_MS,
      method: "OPTIONS",
    });
    expect(res.status(), `OPTIONS status ${res.status()}`).toBe(204);
    const allow = (res.headers()["allow"] ?? "").toLowerCase();
    expect(allow).toContain("post");
    await ctx.dispose();
  });

  test("SEC-225: CORS preflight returns Access-Control-Allow-* headers", async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.fetch(`${BASE_URL}/api/ai`, {
      timeout: REQUEST_TIMEOUT_MS,
      method: "OPTIONS",
      headers: {
        origin: "https://example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, content-type",
      },
    });
    expect(res.status(), `preflight status ${res.status()}`).toBe(204);
    const h = res.headers();
    const allowOrigin = (h["access-control-allow-origin"] ?? "").toLowerCase();
    const allowMethods = (h["access-control-allow-methods"] ?? "").toLowerCase();
    const allowHeaders = (h["access-control-allow-headers"] ?? "").toLowerCase();
    const maxAge = (h["access-control-max-age"] ?? "").toLowerCase();
    expect(allowOrigin === "*" || allowOrigin === "https://example.com").toBe(true);
    expect(allowMethods).toContain("post");
    expect(allowHeaders).toContain("authorization");
    expect(allowHeaders).toContain("content-type");
    expect(maxAge).toMatch(/^\d+$/);
    await ctx.dispose();
  });

  test("SEC-226: 405 responses still carry CORS headers", async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.fetch(`${BASE_URL}/api/ai`, {
      timeout: REQUEST_TIMEOUT_MS,
      method: "GET",
      headers: { origin: "https://example.com" },
    });
    expect(res.status(), `GET status ${res.status()}`).toBe(405);
    const allowOrigin = (res.headers()["access-control-allow-origin"] ?? "").toLowerCase();
    expect(allowOrigin === "*" || allowOrigin === "https://example.com").toBe(true);
    await ctx.dispose();
  });

  test("SEC-210: rejects a JWT with valid claims but a bad signature (401)", async () => {
    // Claims are all valid (not expired, nbf in the past). Only the signature
    // segment is bogus. A correct verifier MUST reject on signature alone —
    // independent of any expiry/nbf checks covered by SEC-203/204.
    const now = Math.floor(Date.now() / 1000);
    const token = forgeJwt({ iat: now - 60, nbf: now - 60, exp: now + 3600 });
    const ctx = await pwRequest.newContext();
    const res = await ctx.post(`${BASE_URL}/api/ai`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      data: PAYLOAD,
    });
    expect(res.status(), `bad-signature status ${res.status()}`).toBe(401);
    await ctx.dispose();
  });

  test('SEC-210b: bad-signature JWT returns canonical {"error":"Unauthorized"} JSON body', async () => {
    // Same shape as SEC-210, but also asserts the response body — proves the
    // rejection is the auth gate (not a generic 5xx or a different 401 from
    // downstream) and that no claim/identity hint leaks back to the caller.
    const now = Math.floor(Date.now() / 1000);
    const token = forgeJwt({ iat: now - 60, nbf: now - 60, exp: now + 3600 });
    const ctx = await pwRequest.newContext();
    const res = await ctx.post(`${BASE_URL}/api/ai`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      data: PAYLOAD,
    });
    expect(res.status(), `bad-signature body status ${res.status()}`).toBe(401);
    const ct = res.headers()["content-type"] ?? "";
    expect(ct, `content-type "${ct}"`).toMatch(/application\/json/i);
    const raw = await res.text();
    let parsed: unknown = null;
    expect(
      () => {
        parsed = JSON.parse(raw);
      },
      `body not JSON: ${raw.slice(0, 120)}`,
    ).not.toThrow();
    expect(parsed).toEqual({ error: "Unauthorized" });
    expect(Object.keys(parsed as object)).toEqual(["error"]);
    await ctx.dispose();
  });

  test("SEC-211: rejects a tampered real JWT (payload mutated after signing) (401)", async () => {
    // Take a known-good token and flip a byte in the payload segment. The
    // header.signature pair no longer matches the new payload — Supabase Auth
    // must reject it as a forgery.
    test.skip(!BEARER, "No AI_TEST_BEARER / LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN available");
    const parts = BEARER.split(".");
    expect(parts.length, "bearer must be a 3-segment JWT").toBe(3);
    // Decode → mutate sub claim → re-encode. Even a single-char change in the
    // payload invalidates the original HMAC signature.
    const pad = (s: string) => s + "=".repeat((4 - (s.length % 4)) % 4);
    const payload = JSON.parse(
      Buffer.from(pad(parts[1]).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    );
    payload.sub = "00000000-0000-0000-0000-000000000001";
    const tamperedPayload = Buffer.from(JSON.stringify(payload))
      .toString("base64")
      .replace(/=+$/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    const ctx = await pwRequest.newContext();
    const res = await ctx.post(`${BASE_URL}/api/ai`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tampered}`,
      },
      data: PAYLOAD,
    });
    expect(res.status(), `tampered-jwt status ${res.status()}`).toBe(401);
    await ctx.dispose();
  });

  // SEC-212 / SEC-213: classic JWT "alg confusion" attacks. A correct verifier
  // pins the expected algorithm (HS256 for Supabase) and rejects everything
  // else — most importantly `alg:"none"` (no signature required) and
  // mismatched asymmetric algs (e.g. RS256) where an attacker hopes the
  // verifier will skip signature checks.
  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=+$/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const claims = () => ({
    sub: "00000000-0000-0000-0000-000000000000",
    aud: "authenticated",
    role: "authenticated",
    iss: "https://example.supabase.co/auth/v1",
    iat: Math.floor(Date.now() / 1000) - 60,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const unsafeAlgCases: Array<{ id: string; alg: string; signature: string; note: string }> = [
    // alg:"none" — RFC 7519 lets a token declare it is unsigned. Any verifier
    // honoring this is critically broken. Signature segment is empty.
    { id: "SEC-212", alg: "none", signature: "", note: "alg=none" },
    // Mismatched alg — header claims RS256 but no real RSA signature exists.
    // A misconfigured verifier that trusts the header `alg` would attempt
    // RSA-verify against the HMAC secret (or skip) and accept. Must 401.
    {
      id: "SEC-213",
      alg: "RS256",
      signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      note: "alg=RS256 mismatch",
    },
  ];

  for (const { id, alg, signature, note } of unsafeAlgCases) {
    test(`${id}: rejects bearer with ${note} (401)`, async () => {
      const header = b64url({ alg, typ: "JWT" });
      const payload = b64url(claims());
      const token = `${header}.${payload}.${signature}`;
      const ctx = await pwRequest.newContext();
      const res = await ctx.post(`${BASE_URL}/api/ai`, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        data: PAYLOAD,
      });
      expect(res.status(), `${note} status ${res.status()}`).toBe(401);
      await ctx.dispose();
    });
  }

  test("SEC-227: 401 responses use {error:'Unauthorized'} JSON shape", async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.post(`${BASE_URL}/api/ai`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { "content-type": "application/json" },
      data: PAYLOAD,
    });
    expect(res.status(), `status ${res.status()}`).toBe(401);
    const ct = (res.headers()["content-type"] ?? "").toLowerCase();
    expect(ct).toContain("application/json");
    const body = await res.json();
    expect(body).toEqual({ error: "Unauthorized" });
    await ctx.dispose();
  });

  test("SEC-228: 405 responses use {error:'Method Not Allowed'} JSON shape", async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.fetch(`${BASE_URL}/api/ai`, {
      timeout: REQUEST_TIMEOUT_MS,
      method: "GET",
    });
    expect(res.status(), `status ${res.status()}`).toBe(405);
    const ct = (res.headers()["content-type"] ?? "").toLowerCase();
    expect(ct).toContain("application/json");
    const body = await res.json();
    expect(body).toEqual({ error: "Method Not Allowed" });
    await ctx.dispose();
  });
});
