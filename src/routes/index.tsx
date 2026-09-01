import { createFileRoute, redirect } from "@tanstack/react-router";
import { logRedirectReason } from "@/lib/redirectLog";
import { supabase } from "@/integrations/supabase/client";

/**
 * / — canonical marketing landing lives at /site. This route exists solely
 * to redirect the bare domain. If authenticated, we go to /dashboard.
 * Otherwise, we 301-redirect to the public marketing home so search
 * engines don't index the noindex /login redirect.
 */
export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();

    if (data?.session) {
      throw redirect({ to: "/dashboard" });
    }

    logRedirectReason("root_marketing_redirect", { from: "/", to: "/site" });
    throw redirect({ to: "/site", statusCode: 301 });
  },
});
