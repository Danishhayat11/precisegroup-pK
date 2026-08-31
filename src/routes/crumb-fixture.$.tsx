import { createFileRoute } from "@tanstack/react-router";
import Breadcrumbs from "@/components/Breadcrumbs";

/**
 * Public test-only splat route to force a collapsed-breadcrumb scenario.
 *
 * Mirrors `/_authenticated/test-crumbs/$` but lives OUTSIDE the auth
 * layout so Playwright specs targeting the overflow dropdown can run
 * without an injected Lovable session (previously they skipped when
 * `authAvailable()` was false).
 *
 * Breadcrumbs derives its trail from the matched pathname, and no
 * production route currently produces more than 4 segments. This splat
 * matches `/crumb-fixture/*` so a URL like
 * `/crumb-fixture/alpha/beta/gamma/delta/epsilon` yields 6 crumbs,
 * exceeding `MAX_VISIBLE = 4` and triggering the overflow dropdown.
 */
export const Route = createFileRoute("/crumb-fixture/$")({
  component: CrumbFixturePage,
});

function CrumbFixturePage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      <h1 className="sr-only">Breadcrumb overflow fixture</h1>
      <Breadcrumbs />
    </div>
  );
}
