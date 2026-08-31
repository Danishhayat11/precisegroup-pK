import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the browser supabase client BEFORE importing the module under test.
const rpcMock = vi.fn();
const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock("../client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: () => ({ insert: insertMock }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

import { callRpc, RpcAuthorizationError, isRevokedRpcError } from "../approvedRpc";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("callRpc — revoked-RPC error handling", () => {
  const revokedFixtures: Array<{ label: string; error: Record<string, unknown> }> = [
    {
      label: "42501 insufficient_privilege",
      error: { code: "42501", message: "permission denied for function admin_list_users" },
    },
    {
      label: "42883 undefined_function",
      error: { code: "42883", message: "function public.admin_list_users() does not exist" },
    },
    {
      label: "PGRST202 (schema cache miss)",
      error: { code: "PGRST202", message: "Could not find the function" },
    },
    { label: "PGRST203 ambiguous", error: { code: "PGRST203", message: "Could not choose" } },
    { label: "PGRST300 (JWT missing)", error: { code: "PGRST300", message: "JWT missing" } },
    { label: "PGRST301 JWT/role not permitted", error: { code: "PGRST301", message: "JWT" } },
    {
      label: "PGRST302 (anon disabled)",
      error: { code: "PGRST302", message: "Anonymous access is disabled" },
    },
    {
      label: "PGRST303 (role missing)",
      error: { code: "PGRST303", message: "role does not exist" },
    },
    {
      label: "3F000 invalid_schema_name",
      error: { code: "3F000", message: 'schema "private" does not exist' },
    },
    {
      label: "28000 invalid_authorization",
      error: { code: "28000", message: "invalid authorization" },
    },
    { label: "numeric code coerced to string", error: { code: 42501, message: "boom" } },
    {
      label: "HTTP 401 with no error code",
      error: { status: 401, message: "Unauthorized" },
    },
    {
      label: "HTTP 403 statusCode variant",
      error: { statusCode: 403, message: "Forbidden" },
    },
    {
      label: "message-only permission denied",
      error: { code: "XX000", message: "ERROR: permission denied for routine admin_list_users" },
    },
    {
      label: "permission denied for schema",
      error: { code: "XX000", message: "permission denied for schema api" },
    },
    {
      label: "permission denied to execute",
      error: { code: "XX000", message: "permission denied to execute function admin_list_users" },
    },
    {
      label: "no function matches signature",
      error: { code: "XX000", message: "No function matches the given name and argument types" },
    },
    {
      label: "hint mentions no execute privilege",
      error: { code: "XX000", message: "boom", hint: "role has no execute privilege on function" },
    },
    {
      label: "details mentions insufficient_privilege",
      error: { code: "XX000", message: "boom", details: "insufficient_privilege" },
    },
    {
      label: "JWT expired text signal",
      error: { code: "XX000", message: "JWT expired" },
    },
  ];

  for (const { label, error } of revokedFixtures) {
    it(`converts ${label} into RpcAuthorizationError`, async () => {
      rpcMock.mockResolvedValue({
        data: null,
        error,
        status: 403,
        statusText: "Forbidden",
        count: null,
      });

      const result = await callRpc("admin_list_users");

      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(RpcAuthorizationError);
      const err = result.error as RpcAuthorizationError;
      expect(err.code).toBe("RPC_NOT_AUTHORIZED");
      expect(err.rpcName).toBe("admin_list_users");
      expect(err.message).toMatch(/not authorized|signed in/);
      expect(err.message).toContain("admin_list_users");
      expect(err.cause).toBe(error);
    });
  }

  it("passes non-authorization errors through unchanged", async () => {
    const otherError = { code: "23505", message: "duplicate key value violates unique constraint" };
    rpcMock.mockResolvedValue({
      data: null,
      error: otherError,
      status: 409,
      statusText: "Conflict",
      count: null,
    });

    const result = await callRpc("admin_list_users");

    expect(result.error).toBe(otherError);
    expect(result.error).not.toBeInstanceOf(RpcAuthorizationError);
  });

  it("returns successful responses untouched", async () => {
    const payload = [{ id: "u1" }];
    rpcMock.mockResolvedValue({
      data: payload,
      error: null,
      status: 200,
      statusText: "OK",
      count: null,
    });

    const result = await callRpc("admin_list_users");

    expect(result.error).toBeNull();
    expect(result.data).toBe(payload);
  });

  it("forwards args to supabase.rpc", async () => {
    rpcMock.mockResolvedValue({
      data: true,
      error: null,
      status: 200,
      statusText: "OK",
      count: null,
    });

    await callRpc("has_role", { _user_id: "abc", _role: "admin" });

    expect(rpcMock).toHaveBeenCalledWith("has_role", { _user_id: "abc", _role: "admin" });
  });
});

describe("callRpc — no-session vs forbidden distinction", () => {
  const cases: Array<{
    label: string;
    error: unknown;
    reason: "no_session" | "forbidden";
    expect: RegExp;
  }> = [
    {
      label: "401 JWT expired → no_session",
      error: { status: 401, message: "JWT expired" },
      reason: "no_session",
      expect: /signed in|session/i,
    },
    {
      label: "PGRST301 → no_session",
      error: { code: "PGRST301", message: "JWT" },
      reason: "no_session",
      expect: /signed in|session/i,
    },
    {
      label: "401 no authorization header → no_session",
      error: { status: 401, message: "No authorization header provided" },
      reason: "no_session",
      expect: /signed in|session/i,
    },
    {
      label: "42501 permission denied → forbidden",
      error: { code: "42501", message: "permission denied for function admin_list_users" },
      reason: "forbidden",
      expect: /not authorized/i,
    },
    {
      label: "HTTP 403 → forbidden",
      error: { statusCode: 403, message: "Forbidden" },
      reason: "forbidden",
      expect: /not authorized/i,
    },
  ];

  for (const c of cases) {
    it(c.label, async () => {
      rpcMock.mockResolvedValue({
        data: null,
        error: c.error,
        status: 401,
        statusText: "",
        count: null,
      });
      const result = await callRpc("admin_list_users");
      const err = result.error as RpcAuthorizationError;
      expect(err).toBeInstanceOf(RpcAuthorizationError);
      expect(err.reason).toBe(c.reason);
      expect(err.message).toMatch(c.expect);
    });
  }
});

describe("callRpc — runtime allowlist guard", () => {
  it("rejects unlisted RPC names even when TS is bypassed", async () => {
    // Simulate a caller that has cast around the compile-time allowlist.
    const smuggled = "pg_read_server_files" as unknown as "admin_list_users";
    const result = await callRpc(smuggled);

    expect(result.error).toBeInstanceOf(RpcAuthorizationError);
    expect(result.data).toBeNull();
    expect(result.status).toBe(403);
    // Critically: the underlying supabase.rpc must NOT be invoked.
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects non-string names (e.g. cast-through object)", async () => {
    const bogus = { toString: () => "admin_list_users" } as unknown as "admin_list_users";
    const result = await callRpc(bogus);
    expect(result.error).toBeInstanceOf(RpcAuthorizationError);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("isRevokedRpcError", () => {
  it("returns false for null / non-objects", () => {
    expect(isRevokedRpcError(null)).toBe(false);
    expect(isRevokedRpcError(undefined)).toBe(false);
    expect(isRevokedRpcError("nope")).toBe(false);
  });

  it("detects known Postgres codes", () => {
    expect(isRevokedRpcError({ code: "42501" })).toBe(true);
    expect(isRevokedRpcError({ code: "PGRST202" })).toBe(true);
    expect(isRevokedRpcError({ code: "PGRST300" })).toBe(true);
    expect(isRevokedRpcError({ code: "PGRST302" })).toBe(true);
    expect(isRevokedRpcError({ code: "3F000" })).toBe(true);
  });

  it("detects HTTP 401/403 without a code", () => {
    expect(isRevokedRpcError({ status: 401 })).toBe(true);
    expect(isRevokedRpcError({ statusCode: 403 })).toBe(true);
  });

  it("does not misclassify RAISE EXCEPTION application errors", () => {
    // Business-rule errors thrown from the function body should pass through.
    expect(
      isRevokedRpcError({
        code: "P0001", // raise_exception
        message: "Booking is already cancelled",
      }),
    ).toBe(false);
  });

  it("ignores unrelated codes without matching text", () => {
    expect(isRevokedRpcError({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(isRevokedRpcError({ code: "23503", message: "foreign key violation" })).toBe(false);
    expect(isRevokedRpcError({ code: "22P02", message: "invalid input syntax" })).toBe(false);
  });

  it("ignores 5xx server errors that aren't auth-shaped", () => {
    expect(isRevokedRpcError({ status: 500, message: "Internal Server Error" })).toBe(false);
    expect(isRevokedRpcError({ status: 502 })).toBe(false);
  });
});
