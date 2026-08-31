import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock sonner before importing the module under test — toastError() calls
// `toast.error` at module-boundary and we don't want it to blow up.
vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

import { friendlyError, toastError } from "../friendlyError";
import { toast } from "sonner";

describe("friendlyError", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    // Restore navigator.onLine between tests that override it.
    if (typeof navigator !== "undefined") {
      Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    }
  });

  describe("network / transport", () => {
    it("detects offline via navigator.onLine", () => {
      Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
      const r = friendlyError(new Error("anything"));
      expect(r.title).toMatch(/offline/i);
      expect(r.transient).toBe(true);
    });

    it("maps 'Failed to fetch' TypeError", () => {
      const err = new TypeError("Failed to fetch");
      const r = friendlyError(err);
      expect(r.title).toMatch(/can't reach the server/i);
      expect(r.transient).toBe(true);
    });

    it.each([
      "NetworkError when attempting to fetch resource",
      "Network request failed",
      "Load failed",
    ])("maps generic network message %j", (msg) => {
      const r = friendlyError(new Error(msg));
      expect(r.title).toMatch(/can't reach the server/i);
      expect(r.transient).toBe(true);
    });

    it("maps timeout / aborted / 408 / 57014", () => {
      expect(friendlyError(new Error("The operation was aborted")).title).toMatch(/timed out/i);
      expect(friendlyError({ message: "connection timeout" }).title).toMatch(/timed out/i);
      expect(friendlyError({ status: 408, message: "req" }).title).toMatch(/timed out/i);
      expect(friendlyError({ code: "57014", message: "query cancelled" }).title).toMatch(
        /timed out/i,
      );
    });
  });

  describe("HTTP status", () => {
    it.each([
      [401, /signed out|sign in again/i, false],
      [403, /permission/i, false],
      [404, /couldn't find/i, false],
      [409, /conflicts/i, false],
      [422, /invalid/i, false],
      [429, /too many requests/i, true],
      [500, /server had a problem/i, true],
      [503, /server had a problem/i, true],
    ] as const)("status %i → %s (transient=%s)", (status, re, transient) => {
      const r = friendlyError({ status, message: "x" });
      expect(r.title).toMatch(re);
      expect(r.transient).toBe(transient);
    });

    it("parses status from message when no status prop", () => {
      expect(friendlyError({ message: "Request failed with 500" }).title).toMatch(/server/i);
      expect(friendlyError({ message: "got a 404 back" }).title).toMatch(/couldn't find/i);
    });
  });

  describe("Postgres transient", () => {
    it.each(["40001", "40P01"])("code %s = busy/retry", (code) => {
      const r = friendlyError({ code, message: "conflict" });
      expect(r.title).toMatch(/busy/i);
      expect(r.transient).toBe(true);
    });

    it("53300 too many connections", () => {
      const r = friendlyError({ code: "53300", message: "sorry, too many clients already" });
      expect(r.title).toMatch(/heavy load/i);
      expect(r.transient).toBe(true);
    });

    it("08006 connection failure", () => {
      const r = friendlyError({ code: "08006", message: "connection failure" });
      expect(r.title).toMatch(/lost connection/i);
      expect(r.transient).toBe(true);
    });
  });

  describe("integrity constraints", () => {
    it("23505 with 'Key (col)=(val)' names the field", () => {
      const r = friendlyError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "profiles_email_key"',
        details: "Key (email)=(a@b.com) already exists.",
      });
      expect(r.title).toMatch(/email is already in use/i);
      expect(r.transient).toBe(false);
    });

    it("23505 falls back to generic when field not extractable", () => {
      const r = friendlyError({ code: "23505", message: "already exists" });
      expect(r.title).toMatch(/already exists/i);
    });

    it("23503 direction — delete side vs insert side", () => {
      const del = friendlyError({
        code: "23503",
        message: 'update or delete on table "x" violates foreign key constraint',
      });
      expect(del.title).toMatch(/still depend/i);

      const ins = friendlyError({
        code: "23503",
        message: 'insert or update on table "y" violates foreign key constraint',
      });
      expect(ins.title).toMatch(/related record is missing/i);
    });

    it("23P01 exclusion constraint", () => {
      const r = friendlyError({ code: "23P01", message: "conflicting key value" });
      expect(r.title).toMatch(/conflicts/i);
    });

    it("23514 check constraint", () => {
      const r = friendlyError({ code: "23514", message: "check constraint" });
      expect(r.title).toMatch(/isn't allowed/i);
    });

    it("23502 names the null column", () => {
      const r = friendlyError({
        code: "23502",
        message: 'null value in column "phone" of relation "profiles" violates not-null constraint',
      });
      expect(r.title).toMatch(/^Phone is required/i);
    });

    it("23502 fallback when no column extractable", () => {
      const r = friendlyError({ code: "23502", message: "not-null violation" });
      expect(r.title).toMatch(/required field/i);
    });
  });

  describe("data type / range", () => {
    it("22P02 uuid", () => {
      const r = friendlyError({
        code: "22P02",
        message: 'invalid input syntax for type uuid: "abc"',
      });
      expect(r.title).toMatch(/id doesn't look right/i);
    });

    it("22P02 numeric", () => {
      const r = friendlyError({ code: "22P02", message: "invalid input syntax for integer" });
      expect(r.title).toMatch(/must be a number/i);
    });

    it("22001 extracts max length", () => {
      const r = friendlyError({
        code: "22001",
        message: "value too long for type character varying(50)",
      });
      expect(r.title).toMatch(/max 50 characters/i);
    });

    it("22003 out of range", () => {
      expect(friendlyError({ code: "22003", message: "numeric field overflow" }).title).toMatch(
        /out of the allowed range/i,
      );
    });

    it("22007 invalid date", () => {
      expect(
        friendlyError({ code: "22007", message: "invalid input syntax for type date" }).title,
      ).toMatch(/date isn't valid/i);
    });

    it("22012 division by zero", () => {
      expect(friendlyError({ code: "22012", message: "division by zero" }).title).toMatch(
        /division by zero/i,
      );
    });
  });

  describe("PostgREST framing", () => {
    it("PGRST116 no rows", () => {
      expect(friendlyError({ code: "PGRST116", message: "no rows" }).title).toMatch(
        /wasn't found/i,
      );
    });
    it("PGRST200 relationship missing", () => {
      expect(
        friendlyError({ code: "PGRST200", message: "could not find a relationship" }).title,
      ).toMatch(/couldn't load related data/i);
    });
    it("PGRST202 missing RPC", () => {
      expect(
        friendlyError({ code: "PGRST202", message: "could not find the function" }).title,
      ).toMatch(/isn't available/i);
    });
    it("PGRST301 expired JWT", () => {
      const r = friendlyError({ code: "PGRST301", message: "JWT expired" });
      expect(r.title).toMatch(/session expired/i);
      expect(r.transient).toBe(false);
    });
    it("PGRST10x parse error family", () => {
      expect(friendlyError({ code: "PGRST100", message: "parse error" }).title).toMatch(
        /couldn't be processed/i,
      );
    });
    it("42501 permission denied / RLS", () => {
      expect(friendlyError({ code: "42501", message: "permission denied" }).title).toMatch(
        /don't have permission/i,
      );
      expect(friendlyError({ message: "row-level security policy" }).title).toMatch(/permission/i);
    });
    it("42P01 undefined table", () => {
      expect(
        friendlyError({ code: "42P01", message: 'relation "foo" does not exist' }).title,
      ).toMatch(/temporarily unavailable/i);
    });
  });

  describe("Supabase Auth", () => {
    it("invalid credentials", () => {
      expect(friendlyError({ message: "Invalid login credentials" }).title).toMatch(/incorrect/i);
    });
    it("email not confirmed", () => {
      expect(friendlyError({ message: "Email not confirmed" }).title).toMatch(
        /confirm your email/i,
      );
    });
    it("user already registered", () => {
      expect(friendlyError({ message: "User already registered" }).title).toMatch(
        /already exists/i,
      );
    });
    it("weak password", () => {
      expect(friendlyError({ message: "Password should be at least 6 characters" }).title).toMatch(
        /too weak/i,
      );
    });
  });

  describe("custom RAISE (P0001)", () => {
    it("surfaces the message verbatim as title", () => {
      const msg = "Company already exists for this owner";
      const r = friendlyError({ code: "P0001", message: msg });
      expect(r.title).toBe(msg);
      expect(r.detail).toBe(msg);
    });
  });

  describe("fallback + detail", () => {
    it("uses the fallback title for unknown errors", () => {
      const r = friendlyError({ message: "" }, "Custom fallback");
      expect(r.title).toBe("Custom fallback");
      expect(r.transient).toBe(false);
    });

    it("always carries the raw detail alongside the mapped title", () => {
      const raw = 'duplicate key value violates unique constraint "profiles_email_key"';
      const r = friendlyError({ code: "23505", message: raw });
      expect(r.detail).toBe(raw);
      expect(r.title).not.toBe(raw);
    });

    it("handles string errors", () => {
      const r = friendlyError("something broke");
      expect(r.detail).toBe("something broke");
    });

    it("handles null/undefined", () => {
      expect(friendlyError(null).title).toBe("Something went wrong");
      expect(friendlyError(undefined, "boom").title).toBe("boom");
    });
  });
});

describe("toastError", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes title as toast, detail as description when they differ", () => {
    toastError({
      code: "23505",
      message: 'duplicate key … "users_email_key"',
      details: "Key (email)=(a) already exists.",
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
    const [title, opts] = (toast.error as any).mock.calls[0];
    expect(title).toMatch(/email is already in use/i);
    expect(opts.description).toMatch(/duplicate key/i);
  });

  it("omits description when title equals detail (P0001 case)", () => {
    toastError({ code: "P0001", message: "Domain rule triggered" });
    const [, opts] = (toast.error as any).mock.calls[0];
    expect(opts?.description).toBeUndefined();
  });

  it("attaches a Retry action only for transient errors", () => {
    const retry = vi.fn();
    toastError(new TypeError("Failed to fetch"), "fallback", { retry });
    const [, opts] = (toast.error as any).mock.calls[0];
    expect(opts.action).toEqual({ label: "Retry", onClick: expect.any(Function) });
    opts.action.onClick();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("does NOT attach Retry for non-transient errors even if retry provided", () => {
    const retry = vi.fn();
    toastError({ code: "23505", message: "duplicate key" }, "fallback", { retry });
    const [, opts] = (toast.error as any).mock.calls[0];
    expect(opts?.action).toBeUndefined();
  });
});
