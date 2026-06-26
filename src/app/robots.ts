import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Allow crawling of the public app; keep crawlers out of the JSON API routes
// (auth, billing, media, realtime — nothing indexable, all request-specific).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
