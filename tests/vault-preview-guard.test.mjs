import test from "node:test";
import assert from "node:assert/strict";
import {
  VAULT_PREVIEW_BRANCH,VAULT_PREVIEW_PROJECT_ID,VAULT_PREVIEW_NEON_BRANCH,
  VAULT_PREVIEW_AUTH_URL,VAULT_PREVIEW_DATA_API_URL,
  privateVaultPreviewIntent,validatePrivateVaultPreview,allowedVaultPreviewPath,
} from "../lib/neon/vault-preview.ts";

const host="naosledge-git-feat-vault-preview-20261017-naos-tsais-projects.vercel.app";
const valid={
  NAOSLEDGE_VAULT_PREVIEW_ENABLED:"1",
  VERCEL:"1",VERCEL_ENV:"preview",
  VERCEL_PROJECT_ID:VAULT_PREVIEW_PROJECT_ID,
  VERCEL_GIT_COMMIT_REF:VAULT_PREVIEW_BRANCH,
  VERCEL_BRANCH_URL:host,
  NAOSLEDGE_BACKEND:"neon",NEXT_PUBLIC_NAOSLEDGE_BACKEND:"neon",
  NAOSLEDGE_NEON_BRANCH_ID:VAULT_PREVIEW_NEON_BRANCH,
  NEON_AUTH_BASE_URL:VAULT_PREVIEW_AUTH_URL,
  NEON_DATA_API_URL:VAULT_PREVIEW_DATA_API_URL,
  NEON_AUTH_COOKIE_SECRET:"synthetic-offline-41-char-separate-secret-X1",
};

test("temporary preview accepts only the precise SSO-protected branch and Production Auth/Data API pair",()=>{
  const conf=validatePrivateVaultPreview(valid);
  assert.equal(conf.origin,`https://${host}`);
  assert.equal(conf.authUrl,VAULT_PREVIEW_AUTH_URL);
  assert.equal(conf.dataApiUrl,VAULT_PREVIEW_DATA_API_URL);
  assert.equal(conf.cookieSecret,valid.NEON_AUTH_COOKIE_SECRET);
  assert.equal(
    validatePrivateVaultPreview({...valid,NAOSLEDGE_VAULT_PREVIEW_ORIGIN:conf.origin}).origin,
    conf.origin,
  );
});

test("Vercel production, unrelated branches/projects/hosts, sandbox and missing secrets fail closed",()=>{
  for(const override of [
    {NAOSLEDGE_VAULT_PREVIEW_ENABLED:"0"},
    {NAOSLEDGE_VAULT_PREVIEW_ENABLED:undefined},
    {VERCEL:undefined},{VERCEL_ENV:"production"},{VERCEL_ENV:"development"},
    {VERCEL_PROJECT_ID:"prj_wrong"},{VERCEL_PROJECT_ID:undefined},
    {VERCEL_GIT_COMMIT_REF:"main"},
    {VERCEL_GIT_COMMIT_REF:"feat/knowledge-graph-p3-20261017"},
    {VERCEL_BRANCH_URL:"naosledge-git-feat-owner-activation-8d4805-naos-tsais-projects.vercel.app"},
    {VERCEL_BRANCH_URL:"evil.example"},
    {VERCEL_BRANCH_URL:host+".evil.example"},
    {VERCEL_BRANCH_URL:"https://"+host},
    {VERCEL_BRANCH_URL:host+"/vault"},
    {VERCEL_BRANCH_URL:host+"?x=1"},
    {NAOSLEDGE_BACKEND:"supabase"},
    {NEXT_PUBLIC_NAOSLEDGE_BACKEND:"supabase"},
    {NAOSLEDGE_NEON_BRANCH_ID:"br-quiet-sunset-b4xx4pnx"},
    {NEON_AUTH_BASE_URL:"https://ep-square-cloud-b45d18zl.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth"},
    {NEON_DATA_API_URL:"https://ep-square-cloud-b45d18zl.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1"},
    {NEON_AUTH_BASE_URL:VAULT_PREVIEW_AUTH_URL+"/evil"},
    {NEON_DATA_API_URL:VAULT_PREVIEW_DATA_API_URL+"?leak=1"},
    {NEON_AUTH_COOKIE_SECRET:"short"},
    {NEON_AUTH_COOKIE_SECRET:"long enough but has a newline\nnot allowed"},
    {NAOSLEDGE_VAULT_PREVIEW_ORIGIN:"https://wrong.vercel.app"},
    {NAOSLEDGE_VAULT_PREVIEW_ORIGIN:undefined,VERCEL_BRANCH_URL:undefined},
  ]) {
    assert.throws(()=>validatePrivateVaultPreview({...valid,...override}),/私人驗收/);
  }
});

test("preview intent catches misconfigured Production Neon deployments before routing",()=>{
  assert.equal(privateVaultPreviewIntent(valid),true);
  assert.equal(privateVaultPreviewIntent({VERCEL_GIT_COMMIT_REF:VAULT_PREVIEW_BRANCH}),true);
  assert.equal(privateVaultPreviewIntent({NAOSLEDGE_NEON_BRANCH_ID:VAULT_PREVIEW_NEON_BRANCH}),true);
  assert.equal(privateVaultPreviewIntent({NAOSLEDGE_VAULT_PREVIEW_ENABLED:"1"}),true);
  assert.equal(privateVaultPreviewIntent({NAOSLEDGE_NEON_BRANCH_ID:"br-quiet-sunset-b4xx4pnx"}),false);
  assert.equal(privateVaultPreviewIntent({}),false);
});

test("private acceptance app never exposes Studio, blog, public drafts, password-reset or activation routes",()=>{
  const good=["/login","/vault","/vault/new","/vault/graph",
    "/vault/00000000-0000-4000-8000-000000000001"];
  for(const path of good)assert.equal(allowedVaultPreviewPath(path),true,path);
  for(const path of ["/","/studio","/studio/new","/notes/hello",
    "/about","/forgot-password","/reset-password","/owner-activation",
    "/sitemap.xml","/robots.txt","/vault/actions","/vault/x",
    "/vault/graph/other","/vault/00000000-0000-4000-8000-000000000001/edit",
    "//vault","/Vault","/api/debug"]) {
    assert.equal(allowedVaultPreviewPath(path),false,path);
  }
});
