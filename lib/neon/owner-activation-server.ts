import "server-only";
import {createNeonAuth} from "@neondatabase/auth/next/server";
import {
 validateOwnerActivation,ownerActivationCallbacks,
 type OwnerActivationConfig,
} from "@/lib/neon/owner-activation";

/**
 * Activation is isolated from the regular Naosledge backend: it connects
 * ONLY to Neon Managed Production AUTH, never to a Data API / Postgres role.
 */
export function ownerActivationConfig():OwnerActivationConfig {
 return validateOwnerActivation({
   enabled:process.env.NAOSLEDGE_OWNER_ACTIVATION_ENABLED,
   vercel:process.env.VERCEL,
   environment:process.env.VERCEL_ENV,
   projectId:process.env.VERCEL_PROJECT_ID,
   gitRef:process.env.VERCEL_GIT_COMMIT_REF,
   branchHost:process.env.VERCEL_BRANCH_URL,
   origin:process.env.NAOSLEDGE_OWNER_ACTIVATION_ORIGIN,
   authUrl:process.env.NAOSLEDGE_OWNER_ACTIVATION_AUTH_URL,
   email:process.env.NAOSLEDGE_OWNER_ACTIVATION_EMAIL,
   cookieSecret:process.env.NAOSLEDGE_OWNER_ACTIVATION_COOKIE_SECRET,
 });
}

let client:ReturnType<typeof createNeonAuth>|undefined;
export function ownerActivationAuth() {
 const config=ownerActivationConfig();
 if(!client)client=createNeonAuth({
   baseUrl:config.authUrl,
   cookies:{secret:config.cookieSecret,sameSite:"lax"},
   logLevel:"warn",
 });
 return {client,config,callbacks:ownerActivationCallbacks(config)};
}
