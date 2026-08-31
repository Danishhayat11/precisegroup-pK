import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { supabase } from "./client";

/**
 * requireSupabaseAuth Middleware
 *
 * Ensures a valid Supabase session exists before allowing the server function
 * to execute. Records an audit log for unauthenticated attempts.
 */
export const requireSupabaseAuth = createMiddleware().server(async ({ next }) => {
  const req = getRequest();
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    console.error("[auth-middleware] No Authorization token found in request headers.");
    throw new Error("Unauthorized");
  }

  // Create a request-specific Supabase client that uses the user's token.
  // We must not use the shared `supabase` proxy because it is module-scoped
  // and lacks the current request's auth context.
  const SUPABASE_URL = process.env.SUPABASE_URL || "https://omxephqkcxynzxekywhn.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY =
    process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_0IJ6uUCFu3dnguK6qJoV5A_AJs_Jyv6";

  const client = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();

  if (authError || !user) {
    console.error("[auth-middleware] Supabase auth error:", authError);
    throw new Error("Unauthorized");
  }

  return next({
    context: {
      supabase: client,
      userId: user.id,
      claims: user.app_metadata,
    },
  });
});
