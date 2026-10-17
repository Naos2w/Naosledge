/**
 * A successful Neon Auth password login is not proof of email ownership.
 * Production admin access requires a server-validated emailVerified=true
 * AND a separate DB blog_admins entry, validated by signed JWT and RLS.
 */
export type NeonAdminIdentity={
 id?:unknown;
 email?:unknown;
 emailVerified?:unknown;
};

export function approvedNeonAdminIdentity(
 user:NeonAdminIdentity | null | undefined,
 env:NodeJS.ProcessEnv=process.env,
):boolean {
 if(!user||typeof user.id!=="string"||!user.id||
    typeof user.email!=="string"||!user.email.includes("@"))return false;
 if(user.emailVerified===true)return true;
 if(user.emailVerified!==false)return false;

 // Offline/isolated Neon integration tests create @example.com accounts with
 // intentionally unverified email. Allow these ONLY when explicitly opting in
 // on the local MSI against the exact approved Neon Sandbox; never on Vercel,
 // Production, or with an actual owner's email. RLS admin row is still required.
 return (
   env.NAOSLEDGE_ALLOW_UNVERIFIED_SYNTHETIC_QA==="1" &&
   env.NODE_ENV==="development" &&
   !env.VERCEL && !env.VERCEL_ENV &&
   env.NAOSLEDGE_BACKEND==="neon" &&
   env.NEXT_PUBLIC_NAOSLEDGE_BACKEND==="neon" &&
   env.NAOSLEDGE_NEON_BRANCH_ID==="br-quiet-sunset-b4xx4pnx" &&
   env.NEON_AUTH_BASE_URL===
     "https://ep-square-cloud-b45d18zl.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth" &&
   env.NEON_DATA_API_URL===
     "https://ep-square-cloud-b45d18zl.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1" &&
   typeof env.NEXT_PUBLIC_SITE_URL==="string" &&
   /^http:\/\/localhost:\d{2,5}\/?$/.test(env.NEXT_PUBLIC_SITE_URL) &&
   /^naosledge-(?:vaultqa-(?:owner|bob|reader)|owner|reader)-[a-z0-9-]{8,24}@example\.com$/.test(user.email)
 );
}
