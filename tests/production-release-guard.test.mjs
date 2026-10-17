import test from "node:test";
import assert from "node:assert/strict";
import {
  RELEASE_PROJECT_ID,RELEASE_BRANCH,RELEASE_NEON_BRANCH,
  RELEASE_AUTH_URL,RELEASE_DATA_API_URL,RELEASE_ORIGIN,
  productionReleaseIntent,validateProductionRelease,
} from "../lib/neon/production-release.ts";
import {privateVaultPreviewIntent} from "../lib/neon/vault-preview.ts";
import {getPublicSiteOrigin} from "../lib/seo.ts";
import {backend} from "../lib/backend.ts";

const sha="a1b2c3d4".repeat(5);
const allowed={
  VERCEL:"1",VERCEL_ENV:"production",NODE_ENV:"production",
  VERCEL_PROJECT_ID:RELEASE_PROJECT_ID,
  VERCEL_GIT_COMMIT_REF:RELEASE_BRANCH,
  VERCEL_GIT_COMMIT_SHA:sha,
  NAOSLEDGE_PRODUCTION_ENABLED:"1",
  NAOSLEDGE_PRODUCTION_RELEASE_SHA:sha,
  NAOSLEDGE_PRODUCTION_ORIGIN:RELEASE_ORIGIN,
  NEXT_PUBLIC_SITE_URL:RELEASE_ORIGIN,
  NAOSLEDGE_BACKEND:"neon",NEXT_PUBLIC_NAOSLEDGE_BACKEND:"neon",
  NAOSLEDGE_NEON_BRANCH_ID:RELEASE_NEON_BRANCH,
  NEON_AUTH_BASE_URL:RELEASE_AUTH_URL,
  NEON_DATA_API_URL:RELEASE_DATA_API_URL,
  NEON_AUTH_COOKIE_SECRET:"synthetic-only-48-plus-characters-for-local-tests-123",
};

function withEnv(changes,action){
  const keys=Object.keys(changes);
  const prior=keys.map(k=>[k,process.env[k]]);
  try{
    for(const [key,value] of Object.entries(changes)){
      if(value===undefined)delete process.env[key];
      else process.env[key]=value;
    }
    return action();
  }finally{
    for(const [key,value] of prior){
      if(value===undefined)delete process.env[key];
      else process.env[key]=value;
    }
  }
}

test("release requires explicit exact main SHA, project, paired Neon and HTTPS site",()=>{
  const conf=validateProductionRelease(allowed);
  assert.deepEqual(conf,{
    authUrl:RELEASE_AUTH_URL,
    dataApiUrl:RELEASE_DATA_API_URL,
    cookieSecret:allowed.NEON_AUTH_COOKIE_SECRET,
    origin:RELEASE_ORIGIN,
  });
});

test("every missing or incorrect release approval attribute fails closed",()=>{
  const deny=[
    {NAOSLEDGE_PRODUCTION_ENABLED:undefined},
    {NAOSLEDGE_PRODUCTION_ENABLED:"0"},
    {VERCEL:undefined},{VERCEL_ENV:"preview"},
    {VERCEL_ENV:"development"},{NODE_ENV:"development"},
    {VERCEL_PROJECT_ID:"prj_different"},
    {VERCEL_GIT_COMMIT_REF:"feat/vault-preview-20261017"},
    {VERCEL_GIT_COMMIT_REF:"master"},
    {NAOSLEDGE_PRODUCTION_RELEASE_SHA:undefined},
    {NAOSLEDGE_PRODUCTION_RELEASE_SHA:"a".repeat(39)},
    {NAOSLEDGE_PRODUCTION_RELEASE_SHA:"z".repeat(40)},
    {NAOSLEDGE_PRODUCTION_RELEASE_SHA:"b".repeat(40)},
    {VERCEL_GIT_COMMIT_SHA:"b".repeat(40)},
    {NAOSLEDGE_BACKEND:"supabase"},
    {NEXT_PUBLIC_NAOSLEDGE_BACKEND:"supabase"},
    {NAOSLEDGE_NEON_BRANCH_ID:"br-quiet-sunset-b4xx4pnx"},
    {NEON_AUTH_BASE_URL:"https://ep-square-cloud-b45d18zl.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth"},
    {NEON_DATA_API_URL:"https://ep-square-cloud-b45d18zl.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1"},
    {NEON_AUTH_BASE_URL:RELEASE_AUTH_URL+"/"},
    {NEON_DATA_API_URL:RELEASE_DATA_API_URL+"?debug=1"},
    {NEXT_PUBLIC_SITE_URL:"http://"+RELEASE_ORIGIN.slice(8)},
    {NEXT_PUBLIC_SITE_URL:"https://attacker.example.tw"},
    {NEXT_PUBLIC_SITE_URL:RELEASE_ORIGIN+"/vault"},
    {NAOSLEDGE_PRODUCTION_ORIGIN:"https://another-project.vercel.app"},
    {NAOSLEDGE_PRODUCTION_ORIGIN:undefined},
    {NAOSLEDGE_VAULT_PREVIEW_ENABLED:"1"},
    {NAOSLEDGE_OWNER_ACTIVATION_ENABLED:"1"},
    {NEON_AUTH_COOKIE_SECRET:"synthetic-short"},
    {NEON_AUTH_COOKIE_SECRET:"synthetic long secret with spaces and newline\nno"},
  ];
  for(const override of deny){
    assert.throws(()=>validateProductionRelease({...allowed,...override}),/正式發布/,JSON.stringify(override));
  }
});

test("attempted Vercel production routes are gated without fallback even with missing env",()=>{
  assert.equal(productionReleaseIntent({VERCEL_ENV:"production"}),true);
  assert.equal(productionReleaseIntent({NAOSLEDGE_PRODUCTION_ENABLED:"1"}),true);
  assert.equal(productionReleaseIntent({VERCEL_ENV:"preview"}),false);
  assert.equal(productionReleaseIntent({}),false);
  for(const attr of [
    {VERCEL_ENV:"production",NAOSLEDGE_PRODUCTION_ENABLED:undefined},
    {VERCEL_ENV:"preview",NAOSLEDGE_PRODUCTION_ENABLED:"1"},
  ]){
    const env={...allowed,...attr};
    assert.throws(()=>validateProductionRelease(env),/正式發布/);
  }
});

test("Production Neon is never misrouted to the temporary private-only Preview UI",()=>{
  assert.equal(privateVaultPreviewIntent(allowed),false);
  assert.equal(privateVaultPreviewIntent({VERCEL_ENV:"production",NAOSLEDGE_NEON_BRANCH_ID:RELEASE_NEON_BRANCH}),false);
  assert.equal(privateVaultPreviewIntent({VERCEL_GIT_COMMIT_REF:"feat/vault-preview-20261017",VERCEL_ENV:"preview"}),true);
});

test("backend and SEO refuse any unapproved production Vercel deployment",()=>{
  withEnv({...allowed,NAOSLEDGE_PRODUCTION_ENABLED:"0"},()=>{
    assert.throws(()=>backend(),/正式發布/);
    assert.equal(getPublicSiteOrigin(),null);
  });
  withEnv({...allowed,VERCEL_GIT_COMMIT_SHA:"b".repeat(40)},()=>{
    assert.throws(()=>backend(),/正式發布/);
    assert.equal(getPublicSiteOrigin(RELEASE_ORIGIN),null);
  });
  withEnv(allowed,()=>{
    assert.equal(backend(),"neon");
    assert.equal(getPublicSiteOrigin(RELEASE_ORIGIN),RELEASE_ORIGIN);
    assert.equal(getPublicSiteOrigin("https://different-site.example.tw"),null);
  });
});

test("no producer may opt in from localhost or another Preview using only the release flag",()=>{
  const env={
    ...allowed,
    VERCEL:undefined,
    VERCEL_ENV:"preview",
    VERCEL_PROJECT_ID:"prj_attacker",
  };
  assert.equal(productionReleaseIntent(env),true);
  assert.throws(()=>validateProductionRelease(env),/正式發布/);
});
