import { createFileRoute } from "@tanstack/react-router";
import { CodeAuditor } from "@/features/audit/CodeAuditor";

export const Route = createFileRoute("/code-auditor")({
  head: () => ({
    meta: [
      { title: "Code Auditor & Debugger — deep static analysis with one-click fixes" },
      {
        name: "description",
        content:
          "A high-contrast developer tool that scans JavaScript, TypeScript, and Python for syntax errors, logic bugs, and performance smells — with instant explanations, diff view, and one-click fixes.",
      },
      { property: "og:title", content: "Code Auditor & Debugger" },
      {
        property: "og:description",
        content:
          "Paste code, get ranked findings with root-cause explanations, and apply corrections with a single click.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AuditRoute,
});

function AuditRoute() {
  return <CodeAuditor />;
}
