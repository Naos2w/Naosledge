/**
 * Strict, temporary owner-only acceptance environment for Private Vault.
 * This is NOT a general Neon Production website mode.
 * All checks derive from Vercel's own deployment metadata and branch-scoped env.
 */
export const VAULT_PREVIEW_BRANCH="feat/vault-preview-20261017";
export const VAULT_PREVIEW_PROJECT_ID="prj_JEXZkiab0njUM7VWFhDO0NhL0GtH";
export const VAULT_PREVIEW_NEON_BRANCH="br-aged-sound-b43h5r2c";
export const VAULT_PREVIEW_AUTH_URL=
  "https://ep-purple-recipe-b43kznn2.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth";
export const VAULT_PREVIEW_DATA_API_URL=
  "https://ep-purple-recipe-b43kznn2.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1";

// Alias is issued by Vercel for this one branch; no custom domains or request
// Host headers are trusted. An optional exact origin can further pin the alias.
const VAULT_PREVIEW_HOST=
  /^naosledge-git-feat-vault-preview-[a-z0-9-]{6,40}-naos-tsais-projects\.vercel\.app$/;

export type VaultPreviewRuntime=Record<string,string|undefined>;
export type VaultPreviewConfig={
  authUrl:string; dataApiUrl:string; cookieSecret:string; origin:string;
};

export function privateVaultPreviewIntent(env:VaultPreviewRuntime):boolean {
  // Production attempts are routed through the independent release gate.
  // The temporary private Preview must never replace public site navigation.
  if(env.VERCEL_ENV==="production")return false;
  return env.VERCEL_GIT_COMMIT_REF===VAULT_PREVIEW_BRANCH ||
    env.NAOSLEDGE_VAULT_PREVIEW_ENABLED==="1" ||
    env.NAOSLEDGE_NEON_BRANCH_ID===VAULT_PREVIEW_NEON_BRANCH;
}

export function validatePrivateVaultPreview(env:VaultPreviewRuntime):VaultPreviewConfig {
  const branchHost=env.VERCEL_BRANCH_URL||"";
  const origin="https://"+branchHost;
  const secret=env.NEON_AUTH_COOKIE_SECRET||"";
  if(env.NAOSLEDGE_VAULT_PREVIEW_ENABLED!=="1" ||
     env.VERCEL!=="1" || env.VERCEL_ENV!=="preview" ||
     env.VERCEL_PROJECT_ID!==VAULT_PREVIEW_PROJECT_ID ||
     env.VERCEL_GIT_COMMIT_REF!==VAULT_PREVIEW_BRANCH ||
     env.NAOSLEDGE_BACKEND!=="neon" ||
     env.NEXT_PUBLIC_NAOSLEDGE_BACKEND!=="neon" ||
     env.NAOSLEDGE_NEON_BRANCH_ID!==VAULT_PREVIEW_NEON_BRANCH ||
     !VAULT_PREVIEW_HOST.test(branchHost) ||
     (env.NAOSLEDGE_VAULT_PREVIEW_ORIGIN !== undefined &&
       env.NAOSLEDGE_VAULT_PREVIEW_ORIGIN!==origin) ||
     env.NEON_AUTH_BASE_URL!==VAULT_PREVIEW_AUTH_URL ||
     env.NEON_DATA_API_URL!==VAULT_PREVIEW_DATA_API_URL ||
     secret.length<32 || /[\s\u0000-\u001f\u007f]/.test(secret)) {
    throw new Error("Naosledge 私人驗收環境未通過精確的 Preview、Branch 和 Neon 檢查。");
  }
  return {
    authUrl:VAULT_PREVIEW_AUTH_URL,
    dataApiUrl:VAULT_PREVIEW_DATA_API_URL,
    cookieSecret:secret,
    origin,
  };
}

/** Public routes, publishing, mail/reset and owner activation stay blocked. */
export function allowedVaultPreviewPath(pathname:string):boolean {
  return pathname==="/login" || pathname==="/vault" ||
    pathname==="/vault/new" || pathname==="/vault/graph" ||
    /^\/vault\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(pathname);
}
