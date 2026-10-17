/**
 * Separate fail-closed backend identities: Sandbox, previously authorized
 * one-time private Preview, and an explicit (not yet enabled) public release.
 * No branch ID or URL alone authorizes Production access.
 */
import { backend } from "@/lib/backend";
import { validateNeonDataApiUrl } from "@/lib/neon/data-api";
import { sandboxResetRedirect, vercelPreviewContext } from "@/lib/neon/password-recovery";
import {VAULT_PREVIEW_NEON_BRANCH,validatePrivateVaultPreview} from "@/lib/neon/vault-preview";
import {productionReleaseIntent,validateProductionRelease} from "@/lib/neon/production-release";

export const NEON_SANDBOX_BRANCH = "br-quiet-sunset-b4xx4pnx";
const SANDBOX_ENDPOINT = "ep-square-cloud-b45d18zl";
const PRODUCTION_ENDPOINT = "ep-purple-recipe-b43kznn2";
export type SandboxConfig = {authUrl: string; dataApiUrl: string; cookieSecret: string; origin?:string};

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
  if (backend() !== "neon") {
    throw new Error("Neon 模式必須明確啟用並通過雙端設定檢查。");
  }
  // Production mode must pass the separate approved-main-commit gate.
  // This is code-only readiness; no Production Vercel variables are enabled.
  if (productionReleaseIntent(process.env)) {
    return validateProductionRelease(process.env);
  }
  // An independently approved and now-disabled Private Vault Preview retains
  // its own exact-branch gate; the original Sandbox path is unchanged.
  if (process.env.NAOSLEDGE_NEON_BRANCH_ID===VAULT_PREVIEW_NEON_BRANCH) {
    return validatePrivateVaultPreview(process.env);
  }
  if (process.env.NAOSLEDGE_NEON_BRANCH_ID !== NEON_SANDBOX_BRANCH ||
      process.env.NAOSLEDGE_VAULT_PREVIEW_ENABLED === "1") {
    throw new Error("僅允許已核准的 Neon Sandbox 或私人 Preview 分支。");
  }
  // A Vercel deployment must be the owner-approved PREVIEW of this exact
  // project and branch. Never run the Neon backend on Vercel Production.
  const vercel = vercelPreviewContext();
  if (vercel) sandboxResetRedirect("", vercel);
  const authUrl = parseStrictHttps(process.env.NEON_AUTH_BASE_URL || "", "neonauth", "/neondb/auth");
  const dataApiUrl = parseStrictHttps(
    validateNeonDataApiUrl(process.env.NEON_DATA_API_URL || ""), "apirest", "/neondb/rest/v1");
  const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET || "";
  if (cookieSecret.length < 32) throw new Error("Neon Cookie Secret 必須是至少 32 字元的伺服器專用密鑰。");
  return {authUrl, dataApiUrl, cookieSecret};
}
