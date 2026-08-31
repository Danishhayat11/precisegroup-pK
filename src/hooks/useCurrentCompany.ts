import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/**
 * Returns the caller's active company_id. Reads from profiles the first time
 * per session and caches the result in module state (per tab). RLS on
 * profiles ensures a user can only ever see their own row.
 */
let cached: { userId: string; companyId: string } | null = null;

export function useCurrentCompany() {
  const { user, loading: authLoading } = useAuth();
  const [companyId, setCompanyId] = useState<string | null>(
    cached && user && cached.userId === user.id ? cached.companyId : null,
  );
  const [loading, setLoading] = useState(!companyId);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setCompanyId(null);
      setLoading(false);
      cached = null;
      return;
    }
    if (cached && cached.userId === user.id) {
      setCompanyId(cached.companyId);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data?.company_id) {
        console.error("[useCurrentCompany] no company_id for user", user.id, error);
        setCompanyId(null);
      } else {
        cached = { userId: user.id, companyId: data.company_id };
        setCompanyId(data.company_id);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  return { companyId, loading: loading || authLoading };
}

/** Reset the in-memory cache. Call on sign-out. */
export function resetCurrentCompanyCache() {
  cached = null;
}
