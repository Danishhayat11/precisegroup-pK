/**
 * Configuration layer for the "revoked RPC" classifier used by
 * `isRevokedRpcError` in `approvedRpc.ts`.
 *
 * The defaults live here (and are re-exported for testing) so the built-in
 * PostgREST/SQLSTATE mappings can be EXTENDED without editing wrapper code.
 * Three extension points, all additive — defaults are never removed:
 *
 *   1. Environment (build-time, Vite):
 *        VITE_REVOKED_RPC_EXTRA_CODES        — comma-separated SQLSTATE or
 *                                              PGRSTxxx codes.
 *        VITE_REVOKED_RPC_EXTRA_TEXT_MARKERS — JSON array of strings, or a
 *                                              `|`-separated list. Matched
 *                                              case-insensitively.
 *
 *   2. Runtime (call at app bootstrap, e.g. from a feature-flag payload):
 *        registerRevokedRpcMappings({ codes: [...], textMarkers: [...] })
 *
 *   3. Config module (import for side effects at bootstrap):
 *        `src/integrations/supabase/revokedRpcMappings.local.ts`
 *        — optional; if present it just calls `registerRevokedRpcMappings`.
 *        Nothing in this repo imports it; consumers wire it in themselves.
 *
 * All three sources are unioned with the defaults. Nothing here can DISABLE
 * a default mapping — that would be a policy regression.
 */

/** Postgres SQLSTATEs + PostgREST error codes shipped by default. */
export const DEFAULT_REVOKED_PG_CODES: readonly string[] = [
  // ---- Postgres SQLSTATEs ----
  "42501", // insufficient_privilege — EXECUTE revoked
  "42883", // undefined_function — signature not visible to this role
  "42804", // datatype mismatch behind view/wrapper without EXECUTE
  "3F000", // invalid_schema_name — role can't see the schema the fn lives in
  "3D000", // invalid_catalog_name
  "28000", // invalid_authorization_specification
  "28P01", // invalid_password / auth failure
  // ---- PostgREST error codes ----
  // https://docs.postgrest.org/en/stable/references/errors.html
  "PGRST202",
  "PGRST203",
  "PGRST300",
  "PGRST301",
  "PGRST302",
  "PGRST303",
];

/** Case-insensitive substring markers shipped by default. */
export const DEFAULT_REVOKED_TEXT_MARKERS: readonly string[] = [
  "permission denied for function",
  "permission denied for routine",
  "permission denied for schema",
  "permission denied to execute",
  "has no execute privilege",
  "no execute privilege",
  "could not find the function",
  "no function matches the given name",
  "function not found in the schema cache",
  "the schema must be one of the following",
  "jwt expired",
  "jwt is invalid",
  "role does not exist",
  'role "anon" is not permitted',
  'role "authenticated" is not permitted',
  "anonymous access is disabled",
  "insufficient_privilege",
  "insufficient privilege",
];

export interface RevokedRpcMappings {
  readonly codes: ReadonlySet<string>;
  readonly textMarkers: readonly string[];
}

// Runtime-registered extras. Kept as arrays and folded into the memoized
// set on read so `registerRevokedRpcMappings` is O(1) at call time.
const runtimeExtraCodes = new Set<string>();
const runtimeExtraTextMarkers = new Set<string>();

let cached: RevokedRpcMappings | null = null;
const invalidate = () => {
  cached = null;
};

/**
 * Extend the classifier at runtime. Additive — defaults and previously
 * registered values are preserved. Safe to call multiple times; duplicates
 * are ignored. Empty / non-string entries are dropped.
 */
export function registerRevokedRpcMappings(input: {
  codes?: readonly (string | null | undefined)[];
  textMarkers?: readonly (string | null | undefined)[];
}): void {
  for (const c of input.codes ?? []) {
    if (typeof c === "string" && c.trim()) runtimeExtraCodes.add(c.trim());
  }
  for (const m of input.textMarkers ?? []) {
    if (typeof m === "string" && m.trim()) {
      runtimeExtraTextMarkers.add(m.trim().toLowerCase());
    }
  }
  invalidate();
}

/** Reset ONLY runtime-registered extras. Defaults and env extras remain. */
export function __resetRuntimeRevokedRpcMappingsForTests(): void {
  runtimeExtraCodes.clear();
  runtimeExtraTextMarkers.clear();
  invalidate();
}

function parseEnvCodes(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseEnvMarkers(raw: string | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((v): v is string => typeof v === "string")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
      }
    } catch {
      // fall through to `|`-split — malformed JSON should not crash the app
    }
  }
  return trimmed
    .split("|")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function readEnv(): { codes: string[]; textMarkers: string[] } {
  // Vite injects import.meta.env for the browser bundle; on the server we
  // also honor process.env so ops can tweak without a rebuild.
  const meta = (typeof import.meta !== "undefined" ? import.meta.env : undefined) as
    | Record<string, string | undefined>
    | undefined;
  const proc =
    typeof process !== "undefined" &&
    process &&
    (process as { env?: Record<string, string | undefined> }).env
      ? (process as { env: Record<string, string | undefined> }).env
      : undefined;
  const codes = parseEnvCodes(meta?.VITE_REVOKED_RPC_EXTRA_CODES ?? proc?.REVOKED_RPC_EXTRA_CODES);
  const textMarkers = parseEnvMarkers(
    meta?.VITE_REVOKED_RPC_EXTRA_TEXT_MARKERS ?? proc?.REVOKED_RPC_EXTRA_TEXT_MARKERS,
  );
  return { codes, textMarkers };
}

/**
 * Return the effective (defaults + env extras + runtime extras) mapping set.
 * Cached; call `registerRevokedRpcMappings` to invalidate.
 */
export function getRevokedRpcMappings(): RevokedRpcMappings {
  if (cached) return cached;
  const env = readEnv();
  const codes = new Set<string>([...DEFAULT_REVOKED_PG_CODES, ...env.codes, ...runtimeExtraCodes]);
  const markerSet = new Set<string>([
    ...DEFAULT_REVOKED_TEXT_MARKERS.map((m) => m.toLowerCase()),
    ...env.textMarkers,
    ...runtimeExtraTextMarkers,
  ]);
  cached = { codes, textMarkers: [...markerSet] };
  return cached;
}
