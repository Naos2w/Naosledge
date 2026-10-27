/**
 * M6 concrete failure mode: a Sandbox POST can COMMIT and then lose its
 * response. A second POST could duplicate or overwrite, so only Owner-RLS
 * GETs may investigate. A matching SHA is NOT proof of the prior write or a
 * trusted baseline. All network traffic below is simulated; no live Neon.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {
  createOneReviewedScratchNote,readScratchCreateRequest,
} from "../scripts/obsidian-m3-sandbox-manual-create.ts";
import {inspectUncertainM3SandboxOutcome}
  from "../lib/obsidian-m5-sandbox-transfer-witness.ts";
import {
  M6_UNCERTAIN_READONLY_FLAG,assertManualM6Invocation,readM6UncertainRequest,
} from "../scripts/obsidian-m6-sandbox-uncertain-recovery.ts";
import {
  NEON_SYNC_SANDBOX_DATA_API,
} from "../lib/obsidian-neon-sandbox-readonly.ts";

const owner="m6-uncertain-sandbox-owner";
const token="header."+Buffer.from(JSON.stringify({sub:owner})).toString("base64url")+".signature";
const original={
  id:"00000000-0000-4000-8000-000000000071",
  slug:"m6-uncertain-transfer",title:"Uncertain transfer",summary:"offline only",
  content_md:"## Portable\n\nThe write may already exist.",
  category:"測試",tags:["offline"],learned_on:"2026-10-28",
  updated_at:"2026-10-28T01:00:00.000Z",
};
const portable=serializeObsidianMarkdown({
  slug:original.slug,title:original.title,excerpt:original.summary,
  content_md:original.content_md,category:original.category,
  tags:original.tags,learned_on:original.learned_on,
});
const sha=value=>createHash("sha256").update(value,"utf8").digest("hex");
const json=items=>new Response(JSON.stringify(items),{
  status:200,headers:{"content-type":"application/json",
    "content-range":items.length?"0-"+(items.length-1)+"/"+items.length:"*/0"},
});
function fakeSandbox({commitBeforeTimeout=false,initial=null,ownerGranted=true,
  changeDuringRecheck=false,failDuringRecheck=false}={}){
  let row=initial,inventoryCalls=0;
  const calls=[];
  const fetcher=async(url,request)=>{
    const target=new URL(url);
    assert.equal(target.origin,new URL(NEON_SYNC_SANDBOX_DATA_API).origin);
    assert.equal(request.redirect,"manual");
    assert.equal(request.credentials,"omit");
    assert.equal(request.headers.Authorization,"Bearer "+token);
    calls.push(request.method+" "+target.pathname);
    if(target.pathname.endsWith("/blog_admins")){
      assert.equal(request.method,"GET");
      return new Response(JSON.stringify(ownerGranted?[{user_id:owner}]:[]),{
        status:200,headers:{"content-type":"application/json"},
      });
    }
    assert.ok(target.pathname.endsWith("/knowledge_notes"));
    if(request.method==="GET"){
      assert.equal(request.headers.Prefer,"count=exact");
      inventoryCalls++;
      if(failDuringRecheck&&inventoryCalls>=2)throw Error("simulated GET outage");
      const item=changeDuringRecheck&&inventoryCalls>=2&&row?
        {...row,updated_at:"2026-10-28T01:01:00.000Z"}:row;
      return json(item?[item]:[]);
    }
    if(request.method==="POST"){
      if(commitBeforeTimeout)row={...original};
      throw Error("simulated lost POST acknowledgement");
    }
    throw Error("Unexpected mutation/HTTP method");
  };
  return {fetcher,calls};
}

const observationInput=fetcher=>({
  sandboxOwnerJwt:token,localMarkdown:portable,
  reviewedLocalSha:sha(portable),fetcher,
});

test("M6 POST committed but its acknowledgement was lost: read-only recheck never retries or certifies Baseline",async()=>{
  const sandbox=fakeSandbox({commitBeforeTimeout:true});
  const request=await readScratchCreateRequest([JSON.stringify({
    sandboxOwnerJwt:token,markdown:portable,
    typedConfirmation:"CREATE SANDBOX "+original.slug,
  })]);
  await assert.rejects(createOneReviewedScratchNote(request,sandbox.fetcher,true),
    /simulated lost POST acknowledgement/);
  assert.equal(sandbox.calls.filter(s=>s.startsWith("POST ")).length,1);
  const observed=await inspectUncertainM3SandboxOutcome(
    observationInput(sandbox.fetcher),
  );
  assert.deepEqual(observed,{
    currentRemoteState:"matches-supplied-scratch",
    ownerRlsReadOnly:true,transferConfirmed:false,
    baselineSaved:false,automaticRetryAllowed:false,
  });
  assert.equal(sandbox.calls.filter(s=>s.startsWith("POST ")).length,1);
  assert.equal(sandbox.calls.filter(s=>s.startsWith("GET ")).length,6,
    "first preflight and two independently authorized full-inventory reads");
});

test("M6 read-only reconciliation distinguishes missing and divergent current remote notes",async()=>{
  const missing=fakeSandbox();
  assert.equal((await inspectUncertainM3SandboxOutcome(observationInput(missing.fetcher)))
    .currentRemoteState,"absent-now");
  const different=fakeSandbox({initial:{...original,content_md:"Different remote edit"}});
  assert.equal((await inspectUncertainM3SandboxOutcome(observationInput(different.fetcher)))
    .currentRemoteState,"different-now");
  assert.equal(missing.calls.every(s=>s.startsWith("GET ")),true);
  assert.equal(different.calls.every(s=>s.startsWith("GET ")),true);
});

test("M6 lost Owner grant, second-read outage, or remote drift never returns false success",async()=>{
  for(const env of [
    fakeSandbox({initial:original,ownerGranted:false}),
    fakeSandbox({initial:original,failDuringRecheck:true}),
    fakeSandbox({initial:original,changeDuringRecheck:true}),
  ]){
    await assert.rejects(inspectUncertainM3SandboxOutcome(observationInput(env.fetcher)));
    assert.equal(env.calls.filter(s=>s.startsWith("POST ")).length,0);
  }
  const invalid=fakeSandbox();
  await assert.rejects(inspectUncertainM3SandboxOutcome({
    ...observationInput(invalid.fetcher),
    localMarkdown:portable+"edited since review",
  }),/canonical portable Scratch Markdown/);
  assert.deepEqual(invalid.calls,[],"modified reviewed Scratch is rejected before Owner GET");
});

test("M6 recovery CLI requires MSI, a pipe and exact nonexecutable read-only fields",async()=>{
  assertManualM6Invocation("win32","MSI",[M6_UNCERTAIN_READONLY_FLAG],false);
  for(const input of [
    ["linux","MSI",[M6_UNCERTAIN_READONLY_FLAG],false],
    ["win32","OTHER",[M6_UNCERTAIN_READONLY_FLAG],false],
    ["win32","MSI",[],false],
    ["win32","MSI",[M6_UNCERTAIN_READONLY_FLAG],true],
  ]){
    assert.throws(()=>assertManualM6Invocation(...input),/MSI, explicit read-only/);
  }
  const valid={sandboxOwnerJwt:token,localMarkdown:portable,
    reviewedLocalSha:sha(portable)};
  assert.deepEqual(await readM6UncertainRequest([JSON.stringify(valid)]),valid);
  for(const bad of [
    {...valid,destination:"C:\\\\Naos\\\\Obsidian"},
    {...valid,reviewedLocalSha:"0".repeat(62)},
    {...valid,sandboxOwnerJwt:"not-a-token"},
    {...valid,localMarkdown:portable+"x".repeat(300_000)},
  ]){
    await assert.rejects(readM6UncertainRequest([JSON.stringify(bad)]),
      /M6 request|exceeds limit/);
  }
});
