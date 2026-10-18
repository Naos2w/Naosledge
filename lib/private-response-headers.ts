/**
 * Apply privacy headers after auth middleware finishes constructing its
 * response. Mutate the original Headers in place to preserve Set-Cookie,
 * redirect Location, and any session-refresh headers.
 *
 * These routes carry account state, private notes, or one-time recovery data;
 * neither browsers, proxies nor search engines should retain their responses.
 */
const privateRoots=[
  "/studio",
  "/vault",
  "/login",
  "/forgot-password",
  "/reset-password",
  "/owner-activation",
] as const;

export function isPrivateRoutePath(pathname:string):boolean {
  return privateRoots.some(root=>pathname===root||pathname.startsWith(root+"/"));
}

export function protectPrivateResponseHeaders(headers:Headers,pathname:string):boolean {
  if(!isPrivateRoutePath(pathname))return false;
  headers.set("Cache-Control","private, no-store, max-age=0");
  headers.set("Referrer-Policy","no-referrer");
  headers.set("X-Robots-Tag","noindex, nofollow, noarchive");
  headers.set("X-Frame-Options","DENY");
  return true;
}
