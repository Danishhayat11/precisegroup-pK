import { createFileRoute, redirect } from "@tanstack/react-router";
import { logRedirectReason } from "@/lib/redirectLog";

/**
 * / — canonical marketing landing lives at /site. This route exists solely
 * to 301-redirect the bare domain to the public marketing home so search
 * engines don't index the noindex /login redirect that used to serve `/`.
 *
 * `beforeLoad` runs on both server and client; the router turns a thrown
 * `redirect()` into a real HTTP 301 during SSR, which is what Googlebot
 * needs to consolidate ranking signals onto /site. The logger is a no-op
 * on the server (client-only guard inside), so we only observe the
 * client-side hop after hydration.
 */
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    logRedirectReason("root_marketing_redirect", { from: "/", to: "/site" });
    throw redirect({ to: "/site", statusCode: 301 });
  },
});
