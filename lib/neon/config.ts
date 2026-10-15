/**
 * Deliberately restricted to the one owner-approved Neon TEST branch.
 * Any future production migration needs a separate change and approval.
 */
import { backend } from "@/lib/backend";
import { validateNeonDataApiUrl } from "@/lib/neon/data-api";

export const NEON_SANDBOX_BRANCH = "br-quiet-sunset-b4xx4pnx";
const SANDBOX_ENDPOINT = "ep-square-cloud-b45d18zl";
const PRODUCTION_ENDPOINT = "ep-purple-recipe-b43kznn2";
export type SandboxConfig = {authUrl: string; dataApiUrl: string; cookieSecret: string};

function parseStrictHttps(value: string, service: string, path: string): string {
  const url = new URL(value);
  const expectedPrefix = `${SANDBOX_ENDPOINT}.${service}.`;
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.hostname.startsWith(PRODUCTION_ENDPOINT) || !url.hostname.startsWith(expectedPrefix) ||
      !url.hostname.endsWith(".aws.neon.tech") || url.pathname !== path) {
    throw new Error("僅允許已核准的 Neon Sandbox 端點。");
  }
  return url.href.replace(/\/$/, "");
}

export function neonSandboxConfig(): SandboxConfig {
  if (backend() !== "neon" ||
      process.env.NAOSLEDGE_NEON_BRANCH_ID !== NEON_SANDBOX_BRANCH) {
    throw new Error("Neon 模式必須明確指定已授權的 sandbox branch。");
  }
  const authUrl = parseStrictHttps(process.env.NEON_AUTH_BASE_URL || "", "neonauth", "/neondb/auth");
  const dataApiUrl = parseStrictHttps(
    validateNeonDataApiUrl(process.env.NEON_DATA_API_URL || ""), "apirest", "/neondb/rest/v1");
  const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET || "";
  if (cookieSecret.length < 32) throw new Error("Neon Cookie Secret 必須是至少 32 字元的伺服器專用密鑰。");
  return {authUrl, dataApiUrl, cookieSecret};
}
