import test from "node:test";
import assert from "node:assert/strict";
import {
 OWNER_ACTIVATION_BRANCH,OWNER_VERCEL_PROJECT_ID,OWNER_PRODUCTION_AUTH_URL,
 validateOwnerActivation,ownerActivationCallbacks,validOwnerResetToken,validOwnerEmailOtp,
} from "../lib/neon/owner-activation.ts";

const host="naosledge-git-feat-owner-activation-8d4805-naos-tsais-projects.vercel.app";
const valid={
 enabled:"1",vercel:"1",environment:"preview",
 projectId:OWNER_VERCEL_PROJECT_ID,gitRef:OWNER_ACTIVATION_BRANCH,
 branchHost:host,origin:`https://${host}`,
 authUrl:OWNER_PRODUCTION_AUTH_URL,
 email:"owner@example.com",
 cookieSecret:"synthetic-only-secure-32-character-test-secret",
};
test("activation uses only exact verified HTTPS preview alias and production AUTH (not database)",()=>{
 const config=validateOwnerActivation(valid);
 assert.equal(config.authUrl,OWNER_PRODUCTION_AUTH_URL);
 assert.equal(config.origin,`https://${host}`);
 assert.deepEqual(ownerActivationCallbacks(config),{
   verification:`https://${host}/owner-activation/verified`,
   reset:`https://${host}/owner-activation/reset`,
 });
});
test("production, local, unauthorized project, wrong branch and callbacks fail closed",()=>{
 const bad=[
  {enabled:"0"},{enabled:undefined},{vercel:undefined},
  {environment:"production"},{environment:"development"},
  {projectId:"prj_wrong"},{projectId:undefined},
  {gitRef:"main"},{gitRef:"feat/private-knowledge-vault-20261017"},
  {branchHost:"naosledge-git-main-naos-tsais-projects.vercel.app"},
  {branchHost:"evil.vercel.app"},
  {branchHost:host+".evil.com"},
  {branchHost:host+"/redirect"},
  {branchHost:undefined},
  {origin:"http://localhost:3000"},
  {origin:"http://"+host},
  {origin:"https://evil.example"},
  {origin:"https://"+host+".evil.com"},
  {origin:"https://"+host+":444"},
  {origin:"https://user:pass@"+host},
  {origin:"https://"+host+"/reset"},
  {origin:"https://"+host+"/?callback=evil"},
  {origin:"https://"+host+"/#token"},
  {origin:"javascript:alert(1)"},
  {authUrl:"https://ep-square-cloud-b45d18zl.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth"},
  {authUrl:OWNER_PRODUCTION_AUTH_URL+"/wrong"},
  {authUrl:undefined},
  {email:"someone@example.com\nBcc: x@example.com"},
  {email:"admin@localhost"},
  {email:"OWNER@example.com"},
  {email:undefined},
  {cookieSecret:"short"},
  {cookieSecret:undefined},
 ];
 for(const override of bad)assert.throws(()=>validateOwnerActivation({...valid,...override}),/activation|callback/);
});
test("email verification OTP is numeric, bounded and never interpreted as a URL token",()=>{
 for(const code of ["1234","123456","12345678","123456789012"])assert.equal(validOwnerEmailOtp(code),true);
 for(const input of ["","123","1234567890123"," 123456","1234a6",
   "00-23456",null,undefined,{},["123456"]])
   assert.equal(validOwnerEmailOtp(input),false);
});

test("malformed reset tokens never reach the managed provider",()=>{
 assert.equal(validOwnerResetToken("Ac0123456789_ABCDEF-1234"),true);
 for(const token of [null,undefined,{},["abcdefghijklmnop"],"a","../abc",
 "abc.def","x".repeat(300),"a b","abc%20def","abc\n123456789123456789"])
 assert.equal(validOwnerResetToken(token),false);
});
