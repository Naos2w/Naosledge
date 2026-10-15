import { NeonPostgrestClient } from "@neondatabase/postgrest-js";

export type JwtProvider = () => Promise<string>;

/**
 * A small, opt-in Neon Data API transport. The live site DOES NOT use this yet.
 *
 * Never send a Postgres password, owner URL, or admin secret to this client.
 * The JWT must be issued by the approved Better Auth instance for this branch.
 */
export function validateNeonDataApiUrl(input: string): string {
  try {
    const url = new URL(input);
    const segments = url.pathname.split("/").filter(Boolean);
    if (
      url.protocol !== "https:" ||
      url.username || url.password || url.search || url.hash ||
      !url.hostname.endsWith(".neon.tech") ||
      !url.hostname.includes(".apirest.") ||
      segments.length !== 3 ||
      segments[1] !== "rest" || segments[2] !== "v1" ||
      !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(segments[0])
    ) throw new Error("Invalid Neon Data API URL");
    return url.origin + "/" + segments.join("/");
  } catch {
    throw new Error("Neon Data API 網址必須是已啟用的 HTTPS PostgREST API，不能使用 PostgreSQL 連線字串。");
  }
}

export function createNeonDataApiClient(
  dataApiUrl: string,
  getJwt: JwtProvider,
  request: typeof fetch = fetch,
) {
  const url = validateNeonDataApiUrl(dataApiUrl);
  const authorizedFetch: typeof fetch = async (input, init) => {
    const token = await getJwt();
    if (!token || typeof token !== "string" || /[\s\u0000-\u001f]/.test(token)) {
      throw new Error("缺少有效的 Neon Auth JWT，拒絕傳送資料庫請求。");
    }
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return request(input, {...init, headers});
  };
  return new NeonPostgrestClient({
    dataApiUrl: url,
    options: {global: {fetch: authorizedFetch}},
  });
}
