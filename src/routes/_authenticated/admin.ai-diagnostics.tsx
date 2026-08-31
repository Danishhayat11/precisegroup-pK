import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import Page from "@/pages/AiDiagnosticsPage";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { AdminRequiredMessage } from "@/lib/adminGate";
import {
  makeRouteErrorComponent,
  makeRouteNotFoundComponent,
} from "@/components/RouteErrorBoundary";

// Persist search + filters + sort + pagination in the URL so a refresh or
// shared link reproduces the exact filtered view. All keys are optional and
// omitted from the URL when set to their defaults (see AiDiagnosticsPage).
export const aiDiagnosticsSearchSchema = z.object({
  q: z.string().optional(),
  // Accept the current status values plus legacy aliases from older shared
  // links (`failed` predates the tool-error/gateway-error split and mapped
  // to any failure). Legacy values are transformed to the current option so
  // old bookmarks and copy-linked URLs still reproduce the intended view.
  status: z
    .enum([
      "all",
      "success",
      "tool-error",
      "gateway-error",
      "all-errors",
      "in-flight",
      // legacy aliases — transformed below
      "failed",
      "error",
      "errors",
    ])
    .optional()
    .transform((v) => (v === "failed" || v === "error" || v === "errors" ? "all-errors" : v)),
  retry: z.enum(["all", "primary", "sanitized", "safe-default", "non-primary"]).optional(),
  tool: z.string().optional(),
  sort: z.enum(["time", "status", "tool"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  size: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  req: z.string().optional(),
});

function Guarded() {
  const { isAdmin, loading } = useAuth();
  if (loading) return null;
  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="AI Diagnostics" description="Restricted area" />
        <AdminRequiredMessage action="Viewing AI assistant diagnostics" />
      </div>
    );
  }
  return <Page />;
}

export const Route = createFileRoute("/_authenticated/admin/ai-diagnostics")({
  component: Guarded,
  validateSearch: aiDiagnosticsSearchSchema,
  errorComponent: makeRouteErrorComponent("AI Diagnostics"),
  notFoundComponent: makeRouteNotFoundComponent({
    resourceLabel: "AI Diagnostics",
    backTo: "/admin",
    backLabel: "Back to Admin",
  }),
});
