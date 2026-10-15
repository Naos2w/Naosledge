import type { Post } from "./types";

/**
 * A canonical public origin is an explicit deployment setting, not the
 * incoming Host header. Never publish localhost/test-domain canonicals.
 */
export function getPublicSiteOrigin(raw = process.env.NEXT_PUBLIC_SITE_URL): string | null {
  if (!raw || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash ||
      !host.includes(".") ||
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) ||
      host === "localhost" || host.endsWith(".localhost") ||
      host.endsWith(".local") || host.endsWith(".test") ||
      host.endsWith(".invalid") || host.endsWith(".example") ||
      ["example.com", "example.org", "example.net"].includes(host)
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function articleCanonical(postSlug: string, origin: string): string {
  return `${origin}/notes/${encodeURIComponent(postSlug)}`;
}

/** These fields are public post metadata, never private drafts or owner IDs. */
export function articleStructuredData(
  post: Pick<Post, "slug" | "title" | "excerpt" | "tags" | "published_at" | "updated_at">,
  origin: string,
) {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    mainEntityOfPage: articleCanonical(post.slug, origin),
    headline: post.title,
    description: post.excerpt || `${post.title} - Naosledge`,
    inLanguage: "zh-Hant",
    datePublished: post.published_at || post.updated_at,
    dateModified: post.updated_at,
    keywords: post.tags,
  };
}

/** Escape HTML-significant characters before embedding JSON inside a script. */
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
