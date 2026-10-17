import test from "node:test";
import assert from "node:assert/strict";
import {approvedNeonAdminIdentity} from "../lib/neon/admin-identity.ts";

const synthetic={
 id:"00000000-0000-4000-8000-000000000001",
 email:"naosledge-vaultqa-owner-012345abcdef12@example.com",
 emailVerified:false,
};
const offlineEnv={
 NODE_ENV:"development",
 NAOSLEDGE_ALLOW_UNVERIFIED_SYNTHETIC_QA:"1",
 NAOSLEDGE_BACKEND:"neon",
 NEXT_PUBLIC_NAOSLEDGE_BACKEND:"neon",
 NAOSLEDGE_NEON_BRANCH_ID:"br-quiet-sunset-b4xx4pnx",
 NEON_AUTH_BASE_URL:"https://ep-square-cloud-b45d18zl.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth",
 NEON_DATA_API_URL:"https://ep-square-cloud-b45d18zl.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1",
 NEXT_PUBLIC_SITE_URL:"http://localhost:35419",
};
test("authenticated admin requires provider-verified email by default",()=>{
 assert.equal(approvedNeonAdminIdentity({...synthetic,emailVerified:true},{}),true);
 for(const u of [
  {...synthetic,emailVerified:false},
  {...synthetic,emailVerified:undefined},
  {...synthetic,emailVerified:"true"},
  {...synthetic,id:""}, {...synthetic,email:null},
  null,undefined,{}, {id:"x",emailVerified:true,email:undefined},
 ])assert.equal(approvedNeonAdminIdentity(u,{}),false);
});
test("synthetic override works ONLY in local isolated Sandbox with explicit opt-in",()=>{
 assert.equal(approvedNeonAdminIdentity(synthetic,offlineEnv),true);
 const blocked=[
  {VERCEL:"1"}, {VERCEL_ENV:"preview"}, {VERCEL_ENV:"production"},
  {NODE_ENV:"production"},
  {NAOSLEDGE_BACKEND:"supabase"},
  {NEXT_PUBLIC_NAOSLEDGE_BACKEND:"supabase"},
  {NAOSLEDGE_NEON_BRANCH_ID:"br-aged-sound-b43h5r2c"},
  {NEON_AUTH_BASE_URL:"https://ep-purple-recipe-b43kznn2.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth"},
  {NEON_DATA_API_URL:"https://ep-purple-recipe-b43kznn2.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1"},
  {NEXT_PUBLIC_SITE_URL:"https://example.com"},
  {NEXT_PUBLIC_SITE_URL:"http://localhost.evil.example:5000"},
  {NAOSLEDGE_ALLOW_UNVERIFIED_SYNTHETIC_QA:"0"},
  {NAOSLEDGE_ALLOW_UNVERIFIED_SYNTHETIC_QA:undefined},
 ];
 for(const patch of blocked)assert.equal(approvedNeonAdminIdentity(synthetic,{...offlineEnv,...patch}),false);
});
test("never allow a real or arbitrary email as a local unverified test admin",()=>{
 for(const email of [
   "owner@example.com","example@yahoo.com","simplelove0922@yahoo.com.tw",
   "naosledge-vaultqa-owner-012345abcdef12@evil.example",
   "naosledge-vaultqa-owner-012345abcdef12@example.com.evil",
   "naosledge-vaultqa-other-012345abcdef12@example.com",
 ]) assert.equal(approvedNeonAdminIdentity({...synthetic,email},offlineEnv),false);
});
