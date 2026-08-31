# Admin AI API — CORS Origin Allowlist

Scope: `POST /api/ai` (and its `OPTIONS` preflight). This endpoint is admin-only,
forwards the caller's Supabase bearer token, and can trigger AI Gateway spend, so
it must never respond with `Access-Control-Allow-Origin: *`. See
`src/routes/api/ai.ts` (`DEFAULT_ALLOWED_ORIGINS`, `getAllowedOrigins`,
`corsHeadersFor`) for the implementation, and
`scripts/security/lint-security-invariants.mjs` (`ai_wildcard_cors` rule) for the
static check that fails CI if a wildcard ever regresses.

## How matching works

1. On every request (preflight or actual), the handler reads the `Origin`
   request header.
2. It builds an allowlist = `DEFAULT_ALLOWED_ORIGINS` ∪ `ADMIN_AI_CORS_ORIGINS`
   (both sources unioned into a `Set<string>`).
3. Matching is **exact string equality** on the origin — scheme + host + port,
   lowercase, **no trailing slash**, no path. There is no wildcard, no suffix
   match, and no regex.
4. If `Origin` is present **and** in the allowlist, the response includes:
   - `Access-Control-Allow-Origin: <echoed origin>`
   - `Vary: Origin, Access-Control-Request-Headers`
   - `Access-Control-Allow-Methods: POST, OPTIONS`
   - `Access-Control-Allow-Headers: authorization, content-type`
   - `Access-Control-Max-Age: 86400`
5. If `Origin` is missing, or present but not in the allowlist, the
   `Access-Control-Allow-Origin` header is **omitted entirely** (never `*`,
   never the requested origin). The `Vary` and method/header advertisements are
   still returned so caches key correctly. The browser then blocks the response
   client-side; disallowed cross-origin callers cannot read the body.
6. `access-control-allow-credentials` is **not** sent. Callers must not use
   `credentials: "include"`; the endpoint expects the Supabase bearer token in
   the `Authorization` header, which is covered by the allow-headers list.
7. Non-`POST`/`OPTIONS` methods return `405 Method Not Allowed` with the same
   CORS header treatment (allowed origin echoed, disallowed origin omitted).

## `DEFAULT_ALLOWED_ORIGINS` (compiled in)

These are hard-coded in `src/routes/api/ai.ts` and are always allowed without
any env configuration:

| Origin                                                                  | Purpose                                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `https://precisegroup-pk.lovable.app`                                   | Published production URL (custom project slug)                                 |
| `https://id-preview--f005784b-c144-4b0f-ab61-e934f9e0b5ac.lovable.app`  | In-editor Lovable preview iframe                                               |
| `https://project--f005784b-c144-4b0f-ab61-e934f9e0b5ac.lovable.app`     | Stable production URL (`project--{id}.lovable.app`) — immutable across renames |
| `https://project--f005784b-c144-4b0f-ab61-e934f9e0b5ac-dev.lovable.app` | Stable preview URL (`project--{id}-dev.lovable.app`) — latest preview build    |
| `http://localhost:8080`                                                 | Local dev server (Vite default)                                                |
| `http://127.0.0.1:8080`                                                 | Local dev server via loopback IP                                               |

Notes:

- All entries are absolute origins with **no trailing slash and no path**. A
  browser's `Origin` header follows the same shape, so equality holds.
- `https://` vs `http://` matters — `http://precisegroup-pk.lovable.app` would
  NOT match `https://precisegroup-pk.lovable.app`.
- Port matters — `http://localhost:3000` is not covered by the `:8080` entries.
- The two `project--{id}` URLs are the stable Lovable hostnames documented for
  webhooks/external services. They are safe to hard-code because they don't
  change if the project is renamed; the human-friendly slug
  (`precisegroup-pk`) can, which is why we list both.

## `ADMIN_AI_CORS_ORIGINS` (per-deploy override)

Comma-separated absolute origins, appended to the defaults at request time
(read inside the handler, not at module load, so a redeploy picks up new
values without a rebuild).

Format rules — enforced by the same exact-match logic above:

- Comma-separated: `https://a.example.com,https://b.example.com`
- Each entry MUST be an absolute origin: `<scheme>://<host>[:<port>]`
- No trailing slash, no path, no query, no fragment
- No wildcards (`*`, `*.example.com`) — they will be stored literally and
  never match a real `Origin` header
- Whitespace around commas is trimmed; empty entries are ignored
- Duplicates of a `DEFAULT_ALLOWED_ORIGINS` entry are harmless (unioned into a
  `Set`)
- The variable is optional; unset/empty means "defaults only"

Typical uses:

- A custom domain not yet baked into `DEFAULT_ALLOWED_ORIGINS`
  (e.g. `https://app.acme.com`)
- A staging or QA hostname
- An alternate local dev port (e.g. `http://localhost:5173`) when running the
  frontend outside the default Vite config

## What is intentionally NOT matched

- `Origin: null` (opaque origins — `file://`, sandboxed iframes,
  cross-origin redirects)
- Any `*.lovable.app` host other than the four listed above
- Any `http://localhost:*` port other than `:8080`
- Any origin differing only in trailing slash, path, casing of the host, or
  scheme

Adding coverage for any of these requires an explicit entry in
`DEFAULT_ALLOWED_ORIGINS` or `ADMIN_AI_CORS_ORIGINS`.

## Regression coverage

- **Static:** `scripts/security/lint-security-invariants.mjs` fails the build if
  `Access-Control-Allow-Origin: *` (or a `"*"` literal assigned to that header)
  reappears in `src/routes/api/**` — rule id `ai_wildcard_cors`. Wired into CI
  via `.github/workflows/security.yml` (`security-invariants` job) and required
  by `.github/rulesets/main-required-checks.json`.
- **Runtime:** `tests/security/ai-cors.spec.ts` exercises `OPTIONS` and `POST`
  from allowed and disallowed origins and asserts the ACAO / `Vary` behavior
  documented above.
