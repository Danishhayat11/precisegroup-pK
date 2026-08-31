import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @tanstack/react-start so createServerFn returns a builder that
// simply captures the handler and exposes it as the callable function.
// This lets us invoke the server-side logic in the Node test runtime
// without the Start AsyncLocalStorage context.
vi.mock("@tanstack/react-start", () => {
  function makeBuilder() {
    const state: { handler?: Function; validator?: (d: unknown) => unknown } = {};
    const builder: {
      middleware: (m: unknown) => typeof builder;
      inputValidator: (v: (d: unknown) => unknown) => typeof builder;
      handler: (h: Function) => (args: { data?: unknown; context: unknown }) => unknown;
    } = {
      middleware: () => builder,
      inputValidator: (v) => {
        state.validator = v;
        return builder;
      },
      handler: (h) => {
        state.handler = h;
        const callable = async (args: { data?: unknown; context: unknown }) => {
          const parsed = state.validator ? state.validator(args.data) : args.data;
          return h({ data: parsed, context: args.context });
        };
        return callable as ReturnType<typeof builder.handler>;
      },
    };
    return builder;
  }
  return { createServerFn: () => makeBuilder() };
});

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: {},
}));

import { savePushSubscription } from "../push.functions";

/**
 * Verifies that the push subscription creation endpoint always writes the
 * signed-in user's tenant context (profiles.active_company_id) into
 * push_subscriptions.company_id, and never a client-provided value.
 *
 * The DB-level trigger enforces this too, but this test locks the
 * server-side handler behavior so a refactor cannot silently drop it.
 */

type Row = Record<string, unknown>;

function makeSupabase(opts: { activeCompanyId: string | null; upsertError?: string | null }) {
  const upsertCalls: Array<{ row: Row; onConflict?: string }> = [];

  const supabase = {
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { active_company_id: opts.activeCompanyId },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "push_subscriptions") {
        return {
          upsert: async (row: Row, options?: { onConflict?: string }) => {
            upsertCalls.push({ row, onConflict: options?.onConflict });
            return { error: opts.upsertError ? { message: opts.upsertError } : null };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { supabase, upsertCalls };
}

async function invoke(
  fn: unknown,
  data: Record<string, unknown>,
  context: { supabase: unknown; userId: string },
) {
  return (fn as (a: { data: unknown; context: unknown }) => Promise<unknown>)({
    data,
    context,
  });
}

const validInput = {
  endpoint: "https://push.example.com/abc",
  p256dh: "p256dh-key",
  auth: "auth-secret",
  userAgent: "vitest",
};

describe("savePushSubscription — company_id tenant scoping", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("stores company_id from profiles.active_company_id for the signed-in user", async () => {
    const { supabase, upsertCalls } = makeSupabase({
      activeCompanyId: "company-a",
    });

    await invoke(savePushSubscription, validInput, {
      supabase,
      userId: "user-1",
    });

    expect(upsertCalls).toHaveLength(1);
    const row = upsertCalls[0].row;
    expect(row.company_id).toBe("company-a");
    expect(row.user_id).toBe("user-1");
    expect(upsertCalls[0].onConflict).toBe("endpoint");
  });

  it("ignores any client-supplied company_id / user_id fields", async () => {
    const { supabase, upsertCalls } = makeSupabase({
      activeCompanyId: "company-a",
    });

    await invoke(
      savePushSubscription,
      {
        ...validInput,
        // Attacker-supplied extras should not be forwarded.
        company_id: "company-hostile",
        user_id: "user-hostile",
      },
      { supabase, userId: "user-1" },
    );

    expect(upsertCalls).toHaveLength(1);
    const row = upsertCalls[0].row;
    expect(row.company_id).toBe("company-a");
    expect(row.user_id).toBe("user-1");
  });

  it("switches to a different tenant when the user's active company changes", async () => {
    for (const cid of ["company-a", "company-b", "company-c"]) {
      const { supabase, upsertCalls } = makeSupabase({ activeCompanyId: cid });
      await invoke(savePushSubscription, validInput, {
        supabase,
        userId: "user-1",
      });
      expect(upsertCalls[0].row.company_id).toBe(cid);
    }
  });

  it("writes null company_id when the profile has no active company (DB trigger will then reject)", async () => {
    const { supabase, upsertCalls } = makeSupabase({ activeCompanyId: null });

    await invoke(savePushSubscription, validInput, {
      supabase,
      userId: "user-1",
    });

    expect(upsertCalls[0].row.company_id).toBeNull();
  });

  it("propagates database errors from the upsert", async () => {
    const { supabase } = makeSupabase({
      activeCompanyId: "company-a",
      upsertError: "row-level security policy violation",
    });

    await expect(
      invoke(savePushSubscription, validInput, { supabase, userId: "user-1" }),
    ).rejects.toThrow(/row-level security/);
  });
});
