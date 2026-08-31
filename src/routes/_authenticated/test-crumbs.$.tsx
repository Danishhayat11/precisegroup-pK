import { createFileRoute } from "@tanstack/react-router";
import Breadcrumbs from "@/components/Breadcrumbs";

/**
 * Test-only splat route to force a collapsed-breadcrumb scenario.
 *
 * Breadcrumbs derives its trail from the matched pathname, and no
 * production route currently produces more than 4 segments. This splat
 * matches `/test-crumbs/*` so a URL like
 * `/test-crumbs/alpha/beta/gamma/delta/epsilon` yields 6 crumbs, exceeding
 * `MAX_VISIBLE = 4` and triggering the overflow dropdown.
 *
 * Mirrors AppShell's breadcrumb slot so the visual context (background,
 * padding, container width) matches real usage. Kept sibling to other
 * `test-*` fixture routes in this project.
 */
export const Route = createFileRoute("/_authenticated/test-crumbs/$")({
  component: TestCrumbsPage,
});

function TestCrumbsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      <Breadcrumbs />
    </div>
  );
}
