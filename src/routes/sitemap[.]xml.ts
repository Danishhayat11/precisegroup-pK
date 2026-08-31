import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

const BASE_URL = "https://precisegroup-pk.lovable.app";

interface SitemapEntry {
  path: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        // Public marketing pages + evergreen resources. ERP app routes
        // (auth, dashboard, admin, _authenticated) are intentionally excluded
        // and blocked in robots.txt.
        // No <lastmod>: the project has no authoritative per-page change
        // timestamp, and a generation-time date is not a real signal.
        const entries: SitemapEntry[] = [
          { path: "/site", changefreq: "weekly", priority: "1.0" },
          { path: "/site/services", changefreq: "monthly", priority: "0.9" },
          { path: "/site/projects", changefreq: "weekly", priority: "0.9" },
          { path: "/site/pricing", changefreq: "monthly", priority: "0.8" },
          { path: "/site/contact", changefreq: "monthly", priority: "0.8" },
          {
            path: "/resources/property-management-vs-erp",
            changefreq: "monthly",
            priority: "0.7",
          },
        ];

        const urls = entries.map((e) =>
          [
            `  <url>`,
            `    <loc>${BASE_URL}${e.path}</loc>`,
            e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
