import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/DocumentView";
import { makeRouteErrorComponent, RouteNotFound } from "@/components/RouteErrorBoundary";

export const Route = createFileRoute("/_authenticated/documents/$type")({
  component: Page,
  errorComponent: makeRouteErrorComponent("Document"),
  notFoundComponent: NotFound,
});

function NotFound() {
  const { type } = Route.useParams();
  return (
    <RouteNotFound
      resourceLabel="Document type"
      identifier={type}
      backTo="/documents"
      backLabel="Back to Documents"
    />
  );
}
