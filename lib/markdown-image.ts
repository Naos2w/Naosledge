/**
 * Markdown image sources are author-supplied content. Only load HTTPS images
 * or same-origin absolute paths; refuse mixed content, javascript/data URLs,
 * protocol-relative URLs and credential-bearing remote links.
 *
 * External HTTPS image hosts can still see the visitor's IP address.
 * Readers' page URLs are protected separately by referrerPolicy=no-referrer.
 */
export function safeMarkdownImageSrc(source: unknown): string | null {
  if (typeof source !== "string" || !source.trim()) return null;
  const value = source.trim();
  if (/[\u0000-\u001F\u007F\\]/.test(value)) return null;
  if (value.startsWith("/")) {
    return value.startsWith("//") ? null : value;
  }
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" || !host || url.username || url.password ||
      host === "localhost" || host.endsWith(".localhost") ||
      host.endsWith(".local") || host.startsWith("[") ||
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}
