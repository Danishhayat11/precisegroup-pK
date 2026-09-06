/**
 * Admin: manage per-stage print-readiness timeouts.
 *
 * Storage: `public.app_settings` row with key = 'print_readiness_timeouts'.
 * The row shape is `{ fonts: number; images: number; layout: number }` (ms).
 *
 * Access model:
 *  - READ: any authenticated user may read their own company's row
 *    (falls back to DEFAULT_READINESS_TIMEOUTS if absent).
 *  - WRITE: Super Admin only. To behave as a single global config,
 *    updates are mirrored into every company's row via `supabaseAdmin`.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callServerRpc } from "@/integrations/supabase/serverRpc";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const STAGE_KEYS = ["fonts", "images", "layout"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export type PrintReadinessTimeouts = Record<StageKey, number>;

export const DEFAULT_READINESS_TIMEOUTS: PrintReadinessTimeouts = {
  fonts: 4000,
  images: 4000,
  layout: 2000,
};

export const MIN_TIMEOUT_MS = 250;
export const MAX_TIMEOUT_MS = 60_000;
const APP_SETTINGS_KEY = "print_readiness_timeouts";

function coerce(value: unknown): PrintReadinessTimeouts {
  const out = { ...DEFAULT_READINESS_TIMEOUTS };
  if (value && typeof value === "object") {
    for (const k of STAGE_KEYS) {
      const raw = (value as Record<string, unknown>)[k];
      const n = typeof raw === "number" ? raw : Number(raw);
      if (Number.isFinite(n) && n >= MIN_TIMEOUT_MS && n <= MAX_TIMEOUT_MS) {
        out[k] = Math.round(n);
      }
    }
  }
  return out;
}

function validateInput(input: unknown): PrintReadinessTimeouts {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid payload");
  }
  const out = {} as PrintReadinessTimeouts;
  for (const k of STAGE_KEYS) {
    const raw = (input as Record<string, unknown>)[k];
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) throw new Error(`Stage "${k}" must be a number`);
    if (n < MIN_TIMEOUT_MS || n > MAX_TIMEOUT_MS) {
      throw new Error(`Stage "${k}" must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} ms`);
    }
    out[k] = Math.round(n);
  }
  return out;
}

async function assertSuperAdmin(supabase: SupabaseClient<Database>, userId: string): Promise<void> {
  const { data, error } = await callServerRpc(supabase, "is_super_admin", {
    _user_id: userId,
  });
  if (error) throw error instanceof Error ? error : new Error(String(error));
  if (data !== true) {
    const err = new Error("Super admin access required");
    (err as { status?: number }).status = 403;
    throw err;
  }
}

export type GetPrintReadinessTimeoutsResult = {
  timeouts: PrintReadinessTimeouts;
  usingDefaults: boolean;
  updatedAt: string | null;
};

export const getPrintReadinessTimeouts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<GetPrintReadinessTimeoutsResult> => {
    // `app_settings` is keyed globally by `key`, but RLS scopes reads to the
    // caller's company_id. Use the admin client so every signed-in user sees
    // the same single-row config regardless of which tenant wrote it.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("app_settings")
      .select("value, updated_at")
      .eq("key", APP_SETTINGS_KEY)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return {
        timeouts: DEFAULT_READINESS_TIMEOUTS,
        usingDefaults: true,
        updatedAt: null,
      };
    }
    return {
      timeouts: coerce(data.value),
      usingDefaults: false,
      updatedAt: data.updated_at ?? null,
    };
  });

export const updatePrintReadinessTimeouts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => validateInput(input))
  .handler(async ({ data, context }): Promise<GetPrintReadinessTimeoutsResult> => {
    await assertSuperAdmin(context.supabase, context.userId);

    // `app_settings` is keyed by `key` alone (globally unique), so a single
    // row represents the whole app. Load admin client only after auth passes.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const now = new Date().toISOString();
    const { error: uErr } = await supabaseAdmin.from("app_settings").upsert(
      {
        key: APP_SETTINGS_KEY,
        value: data as unknown as Record<string, number>,
        updated_at: now,
      },
      { onConflict: "key" },
    );
    if (uErr) throw new Error(uErr.message);

    return { timeouts: data, usingDefaults: false, updatedAt: now };
  });
