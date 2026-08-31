import { createFileRoute } from "@tanstack/react-router";
import { makeRouteErrorComponent } from "@/components/RouteErrorBoundary";
import { UnknownReportFallback } from "@/components/reports";

/**
 * Splat fallback for `/reports/*`. Any unknown report slug lands here
 * instead of surfacing the generic app not-found or crashing the route
 * tree — new report keys can be linked from anywhere without breaking
 * navigation before the matching route file exists.
 */
export const Route = createFileRoute("/_authenticated/reports/$")({
  component: UnknownReport,
  errorComponent: makeRouteErrorComponent("Reports"),
});

function UnknownReport() {
  const { _splat } = Route.useParams();
  return <UnknownReportFallback slug={_splat || ""} />;
}
