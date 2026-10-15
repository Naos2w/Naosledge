import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  const root = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  return { rules:[{userAgent:"*",allow:"/",disallow:["/studio","/studio/","/login"]}],sitemap:`${root}/sitemap.xml`};
}
