/**
 * Password recovery is deliberately Sandbox-only until the owner separately
 * approves the production website, a trusted HTTPS domain and Auth policies.
 * Keep this module pure so URL/token rules can be regression-tested offline.
 */
export function sandboxResetRedirect(siteUrl: string): string {
  let site: URL;
  try {
    site = new URL(siteUrl);
  } catch {
    throw new Error("尚未設定可用的 Sandbox 測試網站網址。");
  }
  // Trust the explicitly configured local origin, never a request-controlled
  // callback URL. Production and external domains are intentionally rejected.
  if (
    site.protocol !== "http:" ||
    site.hostname !== "localhost" ||
    !!site.username || !!site.password ||
    site.pathname !== "/" || !!site.search || !!site.hash
  ) {
    throw new Error("密碼重設目前只允許本機 Neon Sandbox。");
  }
  return new URL("/reset-password", site).href;
}

export function validRecoveryEmail(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= 256 && value.length >= 3 &&
    !/[\u0000-\u0020\u007f]/.test(value) &&
    /^[^@]+@[^@.]+(?:\.[^@.]+)+$/.test(value);
}

export function validRecoveryToken(value: unknown): value is string {
  return typeof value === "string" &&
    /^[A-Za-z0-9_-]{16,256}$/.test(value);
}

export function validRecoveryPassword(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 12 && value.length <= 128 &&
    !/[\u0000-\u001f\u007f]/.test(value);
}
