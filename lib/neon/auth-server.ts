import "server-only";
import { createNeonAuth } from "@neondatabase/auth/next/server";
import { neonSandboxConfig } from "@/lib/neon/config";

type NeonAuth = ReturnType<typeof createNeonAuth>;
let instance: NeonAuth | undefined;

/** Official Neon Auth server SDK owns the HTTP-only cookie and session lifecycle. */
export function neonAuth(): NeonAuth {
  const config = neonSandboxConfig();
  if (!instance) instance = createNeonAuth({
    baseUrl: config.authUrl,
    cookies: {secret: config.cookieSecret, sameSite: "lax"},
    logLevel: "warn",
  });
  return instance;
}
