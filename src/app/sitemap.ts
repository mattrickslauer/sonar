import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Sonar is a single-route app (everything happens on the live map at `/`), so
// the sitemap is just the home page. New public, indexable routes should be
// added here as they're created.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
  ];
}
