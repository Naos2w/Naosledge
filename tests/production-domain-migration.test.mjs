import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {RELEASE_ORIGIN,validateProductionRelease} from "../lib/neon/production-release.ts";

const config=JSON.parse(readFileSync(new URL("../vercel.json",import.meta.url),"utf8"));
const mainHost="naosledge.vercel.app";
const legacyHost="naosledge-naos-tsais-projects.vercel.app";

test("Owner-approved production SEO origin is the shorter indexed Vercel alias",()=>{
  assert.equal(RELEASE_ORIGIN,"https://"+mainHost);
  assert.notEqual(RELEASE_ORIGIN,"https://"+legacyHost);
});

test("legacy hostname redirects its root and all subpaths to the canonical host",()=>{
  assert.equal(config.redirects?.length,2);
  const [root,paths]=config.redirects;
  assert.equal(root.source,"/");
  assert.equal(root.destination,"https://"+mainHost+"/");
  assert.equal(paths.source,"/:path*");
  assert.equal(paths.destination,"https://"+mainHost+"/:path*");
  for(const r of [root,paths]){
    assert.equal(r.permanent,true);
    assert.deepEqual(r.has,[{type:"host",value:legacyHost}]);
    assert.notEqual(r.has[0].value,mainHost);
  }
});

test("merge to main must NOT auto-deploy before exact release SHA is approved",()=>{
  assert.equal(config.git?.deploymentEnabled?.main,false);
  assert.equal(config.git?.deploymentEnabled?.["feat/obsidian-manual-sync-review-20261023"],false);
  assert.equal(config.git?.deploymentEnabled?.["feat/obsidian-m2-manual-review-ui-20261023"],false);
  assert.equal(config.git?.deploymentEnabled?.["fix/private-route-cache-and-ci-20261018"],false);
  assert.equal(config.git?.deploymentEnabled?.["fix/legacy-home-redirect-20261018"],false);
});

test("production release gate refuses the legacy hostname as its primary origin",()=>{
  const sha="f".repeat(40);
  const baseline={
    VERCEL:"1",VERCEL_ENV:"production",NODE_ENV:"production",
    VERCEL_PROJECT_ID:"prj_JEXZkiab0njUM7VWFhDO0NhL0GtH",
    VERCEL_GIT_COMMIT_REF:"main",VERCEL_GIT_COMMIT_SHA:sha,
    NAOSLEDGE_PRODUCTION_ENABLED:"1",NAOSLEDGE_PRODUCTION_RELEASE_SHA:sha,
    NAOSLEDGE_BACKEND:"neon",NEXT_PUBLIC_NAOSLEDGE_BACKEND:"neon",
    NAOSLEDGE_NEON_BRANCH_ID:"br-aged-sound-b43h5r2c",
    NEON_AUTH_BASE_URL:"https://ep-purple-recipe-b43kznn2.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth",
    NEON_DATA_API_URL:"https://ep-purple-recipe-b43kznn2.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1",
    NAOSLEDGE_PRODUCTION_ORIGIN:RELEASE_ORIGIN,NEXT_PUBLIC_SITE_URL:RELEASE_ORIGIN,
    NEON_AUTH_COOKIE_SECRET:"only-synthetic-not-an-actual-cookie-secret-123456789",
    NAOSLEDGE_VAULT_PREVIEW_ENABLED:"0",NAOSLEDGE_OWNER_ACTIVATION_ENABLED:"0",
  };
  assert.equal(validateProductionRelease(baseline).origin,RELEASE_ORIGIN);
  for(const override of [
    {NEXT_PUBLIC_SITE_URL:"https://"+legacyHost},
    {NAOSLEDGE_PRODUCTION_ORIGIN:"https://"+legacyHost},
    {NEXT_PUBLIC_SITE_URL:"https://"+legacyHost,NAOSLEDGE_PRODUCTION_ORIGIN:"https://"+legacyHost},
  ]) assert.throws(()=>validateProductionRelease({...baseline,...override}),/正式發布/);
});
