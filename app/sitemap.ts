import type { MetadataRoute } from "next";
import { publishedPosts } from "@/lib/posts";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const root = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  const posts = await publishedPosts();
  return [{url:root,lastModified:new Date()}, {url:`${root}/about`,lastModified:new Date()},
    ...posts.map((p)=>({url:`${root}/notes/${p.slug}`,lastModified:new Date(p.updated_at)}))];
}
