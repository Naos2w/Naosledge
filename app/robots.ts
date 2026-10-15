import type { MetadataRoute } from "next";
import { getPublicSiteOrigin } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  const origin = getPublicSiteOrigin();
  // No verified production domain yet: do not advertise a localhost sitemap.
  if (!origin) return {rules: [{userAgent: "*", disallow: "/"}]};
  return {
    rules: [{userAgent: "*", allow: "/", disallow: ["/studio", "/login"]}],
    sitemap: `${origin}/sitemap.xml`,
  };
}
