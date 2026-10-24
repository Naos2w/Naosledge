import test from "node:test";
import assert from "node:assert/strict";
import {
  verifyNeonSandboxOwnerRls,NEON_SYNC_SANDBOX_BRANCH,NEON_SYNC_SANDBOX_DATA_API,
} from "../lib/obsidian-neon-sandbox-readonly.ts";

const sub="owner-sandbox-identity-12345";
const jwt="header."+Buffer.from(JSON.stringify({sub}),"utf8").toString("base64url")+".signature";
const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{"content-type":"application/json"},
});

test("M1 live owner proof uses GET-only exact Sandbox RLS admin self-grant",async()=>{
  let calls=0;
  const fetcher=async(url,request)=>{
    calls++;
    const parsed=new URL(url);
    assert.equal(parsed.origin,new URL(NEON_SYNC_SANDBOX_DATA_API).origin);
    assert.equal(parsed.pathname,"/neondb/rest/v1/blog_admins");
    assert.equal(parsed.searchParams.get("select"),"user_id");
    assert.equal(parsed.searchParams.get("user_id"),"eq."+sub);
    assert.equal(parsed.searchParams.get("limit"),"2");
    assert.equal(request.method,"GET");
    assert.equal(request.redirect,"manual");
    assert.equal(request.credentials,"omit");
    assert.equal(request.cache,"no-store");
    assert.equal(request.headers["Cache-Control"],"no-store");
    assert.equal(request.headers.Authorization,"Bearer "+jwt);
    assert.equal(request.body,undefined);
    return json([{user_id:sub}]);
  };
  await assert.doesNotReject(verifyNeonSandboxOwnerRls({
    branchId:NEON_SYNC_SANDBOX_BRANCH,jwt,fetcher,
  }));
  assert.equal(calls,1);
});

test("empty, foreign, duplicated and malformed admin grants never prove Owner",async()=>{
  for(const body of [
    [],[{user_id:"other-owner"}],[{user_id:sub},{user_id:sub}],
    [{user_id:sub,secret:"should-not-appear"}],{},null,
  ]){
    await assert.rejects(verifyNeonSandboxOwnerRls({
      branchId:NEON_SYNC_SANDBOX_BRANCH,jwt,fetcher:async()=>json(body),
    }),error=>{
      assert.match(error.message,/Owner RLS|Owner RLS grant/);
      assert.doesNotMatch(error.message,/secret|owner-sandbox-identity/);
      return true;
    });
  }
});

test("missing or expired owner auth, redirect and unparseable response fail closed",async()=>{
  for(const response of [
    new Response("confidential", {status:401}),
    new Response("confidential", {status:403}),
    new Response(null,{status:302,headers:{location:"https://untrusted.example"}}),
    new Response("not-json",{status:200,headers:{"content-type":"application/json"}}),
    new Response("[]",{status:200,headers:{"content-type":"text/plain"}}),
  ]){
    await assert.rejects(verifyNeonSandboxOwnerRls({
      branchId:NEON_SYNC_SANDBOX_BRANCH,jwt,fetcher:async()=>response.clone(),
    }),error=>{
      assert.doesNotMatch(error.message,/confidential|untrusted|owner-sandbox-identity/);
      return true;
    });
  }
});

test("invalid JWT and non-Sandbox branch reject before any outgoing request",async()=>{
  let calls=0;
  const fetcher=async()=>{calls++;return json([{user_id:sub}]);};
  for(const candidate of [
    {branchId:"production",jwt},
    {branchId:NEON_SYNC_SANDBOX_BRANCH,jwt:"invalid"},
    {branchId:NEON_SYNC_SANDBOX_BRANCH,jwt:"h.e30.s"},
    {branchId:NEON_SYNC_SANDBOX_BRANCH,jwt:"h."+Buffer.from('{"sub":"bad!@#"}').toString("base64url")+".s"},
  ]){
    await assert.rejects(verifyNeonSandboxOwnerRls({...candidate,fetcher}),/Sandbox|subject/);
  }
  assert.equal(calls,0);
});
