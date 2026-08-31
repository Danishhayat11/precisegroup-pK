import { createFileRoute } from "@tanstack/react-router";
import Onboarding from "@/pages/Onboarding";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: Onboarding,
  head: () => ({
    meta: [{ title: "Setup wizard — Precise ERP" }, { name: "robots", content: "noindex" }],
  }),
});
