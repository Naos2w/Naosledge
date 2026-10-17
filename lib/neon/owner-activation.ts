/**
 * Separate, opt-in owner activation ONLY for the existing managed Production
 * Auth identity. This code never provides a Production Data API client.
 *
 * A protected Vercel *Preview* with an exact HTTPS branch alias is required;
 * no localhost, arbitrary callback, Vercel Production or host-header fallback.
 * Server secrets come from Vercel branch-scoped encrypted envs, never Git.
 */
export const OWNER_ACTIVATION_BRANCH="feat/owner-activation-20261017";
export const OWNER_VERCEL_PROJECT_ID="prj_JEXZkiab0njUM7VWFhDO0NhL0GtH";
export const OWNER_PRODUCTION_AUTH_URL=
  "https://ep-purple-recipe-b43kznn2.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth";
// Verified against the actual Vercel Preview alias for this exact Git branch.
const HOST_PATTERN=/^naosledge-git-feat-owner-activation-8d4805-naos-tsais-projects\.vercel\.app$/;

export type OwnerActivationRuntime={
  enabled?:string;
  vercel?:string;
  environment?:string;
  projectId?:string;
  gitRef?:string;
  branchHost?:string;
  origin?:string;
  authUrl?:string;
  email?:string;
  cookieSecret?:string;
};
export type OwnerActivationConfig={
  origin:string;
  authUrl:string;
  email:string;
  cookieSecret:string;
};

/** Pure guard, usable in offline tests without loading a server secret. */
export function validateOwnerActivation(context:OwnerActivationRuntime):OwnerActivationConfig{
  const {enabled,vercel,environment,projectId,gitRef,branchHost,authUrl,email,cookieSecret}=context;
  if(enabled!=="1" || vercel!=="1" ||
     environment!=="preview" ||
     projectId!==OWNER_VERCEL_PROJECT_ID ||
     gitRef!==OWNER_ACTIVATION_BRANCH ||
     !branchHost || !HOST_PATTERN.test(branchHost) ||
     authUrl!==OWNER_PRODUCTION_AUTH_URL ||
     typeof cookieSecret!=="string" || cookieSecret.length<32 ||
     typeof email!=="string" || email.length>256 ||
     !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email) ||
     email!==email.trim() || email!==email.toLowerCase()) {
    throw new Error("Owner activation is unavailable: protected Preview configuration required.");
  }
  let origin:URL;
  try {origin=new URL(context.origin||"");}
  catch {throw new Error("Owner activation callback has no approved HTTPS origin.");}
  if(origin.protocol!=="https:" || origin.hostname!==branchHost ||
     origin.port || origin.username || origin.password ||
     origin.pathname!=="/" || origin.search || origin.hash ||
     origin.href!==`https://${branchHost}/`) {
    throw new Error("Owner activation callback origin is not the verified Vercel branch alias.");
  }
  return {origin:origin.origin,authUrl,email,cookieSecret};
}

/** Do not expose arbitrary trusted callback URLs to users or requests. */
export function ownerActivationCallbacks(config:OwnerActivationConfig){
  return {
    verification:new URL("/owner-activation/verified",config.origin).href,
    reset:new URL("/owner-activation/reset",config.origin).href,
  };
}

/** OTP is entered only on the protected application page, never shared in chat. */
export function validOwnerEmailOtp(value:unknown):value is string {
  return typeof value==="string" && /^\d{4,12}$/.test(value);
}

/** Strict owner setup token shape; Better Auth creates/consumes the token. */
export function validOwnerResetToken(value:unknown):value is string {
  return typeof value==="string"&&/^[a-zA-Z0-9_-]{16,256}$/.test(value);
}
