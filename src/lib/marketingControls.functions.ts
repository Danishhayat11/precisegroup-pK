import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMarketingControls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("marketing_controls")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return (data || []) as any[];
  });

const ControlSchema = z.object({
  section_key: z.string(),
  is_enabled: z.boolean(),
  metadata: z.any().optional(),
});

export const createMarketingControl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => ControlSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).from("marketing_controls").insert([data]);

    if (error) throw new Error(error.message);
    return { success: true };
  });

export const updateMarketingControl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => ControlSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("marketing_controls")
      .update({
        is_enabled: data.is_enabled,
        metadata: data.metadata,
        updated_at: new Date().toISOString(),
      })
      .eq("section_key", data.section_key);

    if (error) throw new Error(error.message);
    return { success: true };
  });

const DeleteSchema = z.object({ section_key: z.string() });

export const deleteMarketingControl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => DeleteSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("marketing_controls")
      .delete()
      .eq("section_key", data.section_key);

    if (error) throw new Error(error.message);
    return { success: true };
  });

export const getMarketingHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("marketing_controls_history")
      .select("id, section_key, is_enabled, created_at, changed_by")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw new Error(error.message);
    return (data || []) as any[];
  });

const RevertSchema = z.object({ id: z.string() });

export const revertMarketingControl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => RevertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: historyEntry, error: historyError } = await (context.supabase as any)
      .from("marketing_controls_history")
      .select("*")
      .eq("id", data.id)
      .single();

    if (historyError) throw new Error(historyError.message);

    const { error: updateError } = await (context.supabase as any)
      .from("marketing_controls")
      .update({ is_enabled: historyEntry.is_enabled, updated_at: new Date().toISOString() })
      .eq("section_key", historyEntry.section_key);

    if (updateError) throw new Error(updateError.message);
    return { success: true };
  });

/**
 * Public, unauthenticated read of marketing section toggles.
 * The homepage is a public route, so it must NOT call the auth-protected
 * getMarketingControls (that returns 401/500 for anonymous visitors).
 */
export const getPublicMarketingControls = createServerFn({ method: "GET" }).handler(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const key =
    process.env["SUPABASE_PUBLISHABLE_KEY"] || "sb_publishable_0IJ6uUCFu3dnguK6qJoV5A_AJs_Jyv6";
  const url = process.env["SUPABASE_URL"] || "https://omxephqkcxynzxekywhn.supabase.co";
  const client = createClient(url, key, {
    auth: { persistSession: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`)
          h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });

  const { data, error } = await (client as any)
    .from("marketing_controls")
    .select("section_key, is_enabled");

  if (error) {
    console.error("getPublicMarketingControls failed", error);
    return [] as any[];
  }
  return (data || []) as any[];
});
