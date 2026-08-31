import { createFileRoute } from "@tanstack/react-router";
import Signup from "@/pages/Signup";
import { SITE_BASE_URL, DEFAULT_OG_IMAGE } from "@/lib/site-seo";

export const Route = createFileRoute("/signup")({
  component: Signup,
  head: () => ({
    meta: [
      { title: "Create your company — Precise ERP" },
      {
        name: "description",
        content:
          "Sign up your real-estate company on Precise ERP — pick Starter, Professional, or Builder and set up your workspace in minutes.",
      },
      { property: "og:title", content: "Create your company — Precise ERP" },
      {
        property: "og:description",
        content: "Sign up your real-estate company on Precise ERP in minutes.",
      },
      { property: "og:url", content: `${SITE_BASE_URL}/signup` },
      { property: "og:type", content: "website" },
      { property: "og:image", content: DEFAULT_OG_IMAGE },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Create your company — Precise ERP" },
      {
        name: "twitter:description",
        content: "Sign up your real-estate company on Precise ERP in minutes.",
      },
      { name: "twitter:image", content: DEFAULT_OG_IMAGE },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "canonical", href: `${SITE_BASE_URL}/signup` }],
  }),
});
