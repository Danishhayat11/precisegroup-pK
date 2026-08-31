import { createFileRoute } from "@tanstack/react-router";
import Login from "@/pages/Login";
import { SITE_BASE_URL, DEFAULT_OG_IMAGE } from "@/lib/site-seo";

export const Route = createFileRoute("/login")({
  component: Login,
  head: () => ({
    meta: [
      { title: "Sign in — Precise ERP" },
      {
        name: "description",
        content:
          "Sign in to Precise ERP, the internal operations platform for Precise Realtors & Builders staff.",
      },
      { property: "og:title", content: "Sign in — Precise ERP" },
      {
        property: "og:description",
        content: "Staff sign-in for the Precise Realtors & Builders ERP platform.",
      },
      { property: "og:url", content: `${SITE_BASE_URL}/login` },
      { property: "og:type", content: "website" },
      { property: "og:image", content: DEFAULT_OG_IMAGE },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Sign in — Precise ERP" },
      {
        name: "twitter:description",
        content: "Staff sign-in for the Precise Realtors & Builders ERP platform.",
      },
      { name: "twitter:image", content: DEFAULT_OG_IMAGE },
      { name: "robots", content: "noindex,nofollow" },
    ],
    links: [{ rel: "canonical", href: `${SITE_BASE_URL}/login` }],
  }),
});
