import type { MetadataRoute } from "next";
import { publishedPosts } from "@/lib/posts";
import { articleCanonical, getPublicSiteOrigin } from "@/lib/seo";

// A public Neon sitemap needs a fresh anonymous Auth JWT (cache: no-store).
// Static prerendering at build time throws Next.js DynamicServerError.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = getPublicSiteOrigin();
  if (!origin) return [];
  const posts = await publishedPosts();
  return [
    {url: origin},
    {url: `${origin}/about`},
    ...posts.map((p) => ({url: articleCanonical(p.slug, origin), lastModified: new Date(p.updated_at)})),
  ];
}
