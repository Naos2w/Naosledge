/**
 * Code-only production release gate.
 *
 * Setting a valid Neon URL alone MUST NOT publish Naosledge. The user must
 * approve a future exact main commit SHA and production HTTPS origin.
 * This module does not deploy, migrate, or grant production access.
 */
export const RELEASE_PROJECT_ID="prj_JEXZkiab0njUM7VWFhDO0NhL0GtH";
export const RELEASE_BRANCH="main";
export const RELEASE_NEON_BRANCH="br-aged-sound-b43h5r2c";
export const RELEASE_AUTH_URL=
  "https://ep-purple-recipe-b43kznn2.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth";
export const RELEASE_DATA_API_URL=
  "https://ep-purple-recipe-b43kznn2.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1";

// Existing Vercel project default domain, NOT approval to remove SSO.
// An owner-selected custom domain requires a separately reviewed code change.
export const RELEASE_ORIGIN="https://naosledge-naos-tsais-projects.vercel.app";

export type ReleaseRuntime=Record<string,string|undefined>;
export type ReleaseConfig={
  authUrl:string;dataApiUrl:string;cookieSecret:string;origin:string;
};

/** Misconfigured attempted releases also fail closed before backend routing. */
export function productionReleaseIntent(env:ReleaseRuntime):boolean{
  return env.VERCEL_ENV==="production" ||
    env.NAOSLEDGE_PRODUCTION_ENABLED==="1";
}

export function validateProductionRelease(env:ReleaseRuntime):ReleaseConfig {
  const secret=env.NEON_AUTH_COOKIE_SECRET||"";
  const approvedSha=env.NAOSLEDGE_PRODUCTION_RELEASE_SHA||"";
  if(
    env.NAOSLEDGE_PRODUCTION_ENABLED!=="1" ||
    env.VERCEL!=="1" || env.VERCEL_ENV!=="production" ||
    env.NODE_ENV!=="production" ||
    env.VERCEL_PROJECT_ID!==RELEASE_PROJECT_ID ||
    env.VERCEL_GIT_COMMIT_REF!==RELEASE_BRANCH ||
    !/^[a-f0-9]{40}$/.test(approvedSha) ||
    env.VERCEL_GIT_COMMIT_SHA!==approvedSha ||
    env.NAOSLEDGE_BACKEND!=="neon" ||
    env.NEXT_PUBLIC_NAOSLEDGE_BACKEND!=="neon" ||
    env.NAOSLEDGE_NEON_BRANCH_ID!==RELEASE_NEON_BRANCH ||
    env.NEON_AUTH_BASE_URL!==RELEASE_AUTH_URL ||
    env.NEON_DATA_API_URL!==RELEASE_DATA_API_URL ||
    env.NEXT_PUBLIC_SITE_URL!==RELEASE_ORIGIN ||
    env.NAOSLEDGE_PRODUCTION_ORIGIN!==RELEASE_ORIGIN ||
    env.NAOSLEDGE_VAULT_PREVIEW_ENABLED==="1" ||
    env.NAOSLEDGE_OWNER_ACTIVATION_ENABLED==="1" ||
    secret.length<32 || /[\s\u0000-\u001f\u007f]/.test(secret)
  ){
    throw new Error("Naosledge 正式發布尚未取得精確版本、網域與 Neon 安全核准。");
  }
  return {
    authUrl:RELEASE_AUTH_URL,
    dataApiUrl:RELEASE_DATA_API_URL,
    cookieSecret:secret,
    origin:RELEASE_ORIGIN,
  };
}
