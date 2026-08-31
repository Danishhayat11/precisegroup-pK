import { createFileRoute } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { LetterheadLivePreview } from "@/pages/Documents";

/**
 * Deterministic public dev route that renders `LetterheadLivePreview` in
 * isolation with a pre-seeded QueryClient. The route exists solely so a
 * Playwright pixel-diff spec has a stable, auth-free URL to screenshot —
 * it is `noindex, nofollow` and never linked from the app.
 *
 * Why a dedicated route:
 *   - Rendering the preview inside `/documents` would require auth and
 *     depend on live Supabase data, both of which introduce pixel drift
 *     across CI runs.
 *   - Seeding `["s-projects"]` here guarantees the exact same brandName
 *     is rendered on every run, so any diff is genuine rendering drift.
 */
export const Route = createFileRoute("/letterhead-preview-visual")({
  head: () => ({
    meta: [
      { title: "Letterhead Preview — Visual Diff Harness" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "googlebot", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Internal deterministic harness for the letterhead live-preview pixel-diff spec.",
      },
    ],
  }),
  component: LetterheadPreviewVisualPage,
});

function LetterheadPreviewVisualPage() {
  // A dedicated QueryClient scoped to this page ensures the seeded data
  // isn't polluted by anything the outer app QueryClient may hold.
  const [qc] = useState(() => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(
      ["s-projects"],
      [{ code: "MH", project_name: "Manal Heights", display_name: "Manal Heights" }],
    );
    return client;
  });

  return (
    <div style={{ padding: 16, background: "#ffffff", minHeight: "100vh" }}>
      <QueryClientProvider client={qc}>
        <LetterheadLivePreview />
      </QueryClientProvider>
    </div>
  );
}
