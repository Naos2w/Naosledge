import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { createNeonDataApiClient } from "@/lib/neon/data-api";
import { neonSandboxConfig } from "@/lib/neon/config";
import { neonAuth } from "@/lib/neon/auth-server";

/** Anonymous JWT is issued by Neon Better Auth; it cannot edit content. */
const anonymousJwt = cache(async (): Promise<string> => {
  const {authUrl} = neonSandboxConfig();
  const res = await fetch(`${authUrl}/token/anonymous`, {
    cache:"no-store", signal:AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error("Neon 匿名讀取權限暫時無法驗證。");
  const json: unknown = await res.json();
  const token = typeof json === "object" && json !== null && "token" in json
    ? json.token : undefined;
  if (typeof token !== "string" || token.split(".").length !== 3) {
    throw new Error("Neon 匿名 JWT 回應格式不正確。");
  }
  return token;
});

export async function publicNeonClient() {
  const {dataApiUrl} = neonSandboxConfig();
  return createNeonDataApiClient(dataApiUrl, anonymousJwt);
}

function neonCookieHeader(source: string): string {
  return source.split(";").map((value)=>value.trim())
    .filter((value)=>value.startsWith("__Secure-neon-auth.") && /^[^;=]+=[^;\r\n]*$/.test(value))
    .join("; ");
}

/** Extracts only the issued upstream JWT; never constructs a caller-supplied role. */
const sessionJwt = cache(async (expectedId: string): Promise<string> => {
  const {authUrl} = neonSandboxConfig();
  const {data:session, error} = await neonAuth().getSession();
  if (error || !session?.user || session.user.id !== expectedId) {
    throw new Error("未通過 Neon Auth 伺服器端身分檢查。");
  }
  const requestHeaders = await headers();
  const browserCookies = neonCookieHeader(requestHeaders.get("cookie") || "");
  if (!browserCookies.includes("__Secure-neon-auth.session_token=")) {
    throw new Error("Neon 登入憑證不存在，請重新登入。");
  }
  // Better Auth itself issues Set-Auth-Jwt. This signed JWT is validated again
  // by the Data API; a signed session-data cookie is never used as its bearer.
  const response = await fetch(`${authUrl}/get-session`, {
    headers: {
      Cookie: browserCookies,
      Origin: requestHeaders.get("origin") || "http://localhost:3000",
    },
    cache:"no-store", signal:AbortSignal.timeout(12000),
  });
  const jwt = response.headers.get("set-auth-jwt");
  if (!response.ok || !jwt || jwt.split(".").length !== 3) {
    throw new Error("Neon Auth JWT 無法取得，請重新登入。");
  }
  // Consistency check only: actual JWT signature verification remains Neon
  // Data API's responsibility. Never authorize solely from decoded claims.
  let subject: unknown;
  try {
    subject = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")).sub;
  } catch {
    throw new Error("Neon Auth JWT 格式不正確。");
  }
  if (subject !== expectedId) throw new Error("Neon Auth Session 和 JWT 身分不一致。");
  return jwt;
});

export async function memberNeonClient(userId: string) {
  const {dataApiUrl} = neonSandboxConfig();
  const token = await sessionJwt(userId);
  return createNeonDataApiClient(dataApiUrl, async ()=>token);
}
