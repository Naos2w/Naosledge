/**
 * MANUAL Neon SANDBOX ONLY. Checks whether Neon Managed Better Auth accepts
 * verification and password reset requests for a pre-created synthetic user.
 * Sends only to a reserved @example.com address; never to an owner's inbox.
 * Does not obtain verification tokens or claim inbox delivery.
 */
const BRANCH="br-quiet-sunset-b4xx4pnx";
const AUTH_URL="https://ep-square-cloud-b45d18zl.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth";
const EMAIL="naosledge-activation-20261017-check01@example.com";
if(process.env.NAOSLEDGE_ACTIVATION_SANDBOX_CHECK!==BRANCH ||
   process.env.CI==="true")throw Error("Sandbox-only explicit opt-in required");
const origin="http://localhost:3000";
const requests=[
  ["verification","/send-verification-email",{
    email:EMAIL,callbackURL:origin+"/owner-activation/verified",
  }],
  ["first_password","/request-password-reset",{
    email:EMAIL,redirectTo:origin+"/owner-activation/reset",
  }],
];
let failures=0;
for(const [label,path,data] of requests){
 try {
   const response=await fetch(AUTH_URL+path,{
     method:"POST",headers:{"Content-Type":"application/json","Origin":origin},
     body:JSON.stringify(data),redirect:"manual",signal:AbortSignal.timeout(14000),
   });
   let details={};
   try{details=await response.json()}catch{}
   const safe=typeof details?.code==="string"&&/^[A-Z_]{1,45}$/.test(details.code)
      ?details.code:"none";
   const okay=response.status>=200&&response.status<300;
   if(!okay)failures++;
   console.log(`SANDBOX_AUTH_${label.toUpperCase()} accepted=${okay} HTTP=${response.status} safe_code=${safe}`);
 }catch(e){
   failures++;
   console.log(`SANDBOX_AUTH_${label.toUpperCase()} accepted=false reason=network_timeout_or_endpoint_error`);
 }
}
console.log("NOTE: API acceptance is not evidence of email delivery or token verification.");
if(failures)process.exitCode=1;
