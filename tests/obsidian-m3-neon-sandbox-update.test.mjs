import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {updateNeonSandboxNoteIfUnchanged} from "../lib/obsidian-neon-sandbox-update.ts";
import {
  NEON_SYNC_SANDBOX_BRANCH,NEON_SYNC_SANDBOX_DATA_API,
} from "../lib/obsidian-neon-sandbox-readonly.ts";

const digest=s=>createHash("sha256").update(s).digest("hex");
const owner="m3-sandbox-update-owner";
const jwt="header."+Buffer.from(JSON.stringify({sub:owner})).toString("base64url")+".signature";
const rowId="b3e9f7b4-7c4a-4f86-98df-d8e1c21912a0";
const oldStamp="2026-10-24T10:00:00.000Z";
const newStamp="2026-10-25T10:00:00.000Z";
const old={
  id:rowId,slug:"edit-test-note",title:"Original title",summary:"Before",
  content_md:"Original content",category:"筆記",tags:["before"],
  learned_on:"2026-10-24",updated_at:oldStamp,
};
const latest={...old,title:"Updated title",summary:"After",
  content_md:"Updated content",tags:["after"],updated_at:newStamp};
const portable=r=>serializeObsidianMarkdown({
  slug:r.slug,title:r.title,excerpt:r.summary,content_md:r.content_md,
  category:r.category,tags:r.tags,learned_on:r.learned_on,
});
const oldSha=digest(portable(old));
const newMarkdown=portable(latest);
const newSha=digest(newMarkdown);
const oldRevision=digest(rowId+":"+oldStamp);
const decision={
  slug:old.slug,choice:"review-upload",manualReview:true,
  expectedLocalSha:newSha,expectedRemoteSha:oldSha,
  expectedRemoteRevision:oldRevision,
};
const args={
  branchId:NEON_SYNC_SANDBOX_BRANCH,sandboxOwnerJwt:jwt,decision,
  readMarkdown:async()=>newMarkdown,
  typedConfirmation:"UPDATE SANDBOX "+old.slug,
};
const asJson=(value,range=null)=>new Response(JSON.stringify(value),{
  status:200,headers:{
    "content-type":"application/json",
    ...(range?{"content-range":range}:{}),
  },
});

function mockNetwork({granted=true,race=false,failPostVerify=false}={}){
  const calls=[];
  let remote={...old};
  let postVerified=false;
  async function fetcher(raw,options){
    const u=new URL(raw);
    assert.equal(u.origin,new URL(NEON_SYNC_SANDBOX_DATA_API).origin);
    assert.equal(options.headers.Authorization,"Bearer "+jwt);
    assert.equal(options.redirect,"manual");
    assert.equal(options.credentials,"omit");
    assert.equal(options.cache,"no-store");
    const operation=options.method+" "+u.pathname;
    calls.push(operation);
    if(u.pathname.endsWith("/blog_admins")){
      assert.equal(options.method,"GET");
      return asJson(granted?[{user_id:owner}]:[]);
    }
    if(u.pathname.endsWith("/knowledge_notes")&&options.method==="GET"){
      assert.equal(options.headers.Prefer,"count=exact");
      if(u.searchParams.get("select")==="id,slug,updated_at"){
        assert.equal(u.searchParams.get("slug"),"eq."+old.slug);
        return asJson([{id:remote.id,slug:remote.slug,updated_at:remote.updated_at}],"0-0/1");
      }
      assert.equal(u.searchParams.get("limit"),"21");
      if(postVerified&&failPostVerify)remote={...old,updated_at:newStamp};
      return asJson([remote],"0-0/1");
    }
    if(u.pathname.endsWith("/knowledge_notes")&&options.method==="PATCH"){
      assert.equal(u.searchParams.get("id"),"eq."+rowId);
      assert.equal(u.searchParams.get("slug"),"eq."+old.slug);
      assert.equal(u.searchParams.get("updated_at"),"eq."+oldStamp);
      assert.equal(u.searchParams.get("select"),"id,slug,updated_at");
      assert.equal(options.headers.Prefer,"return=representation");
      assert.equal(options.headers["Content-Type"],"application/json");
      const body=JSON.parse(options.body);
      assert.deepEqual(body,{
        title:latest.title,summary:latest.summary,content_md:latest.content_md,
        category:latest.category,tags:latest.tags,learned_on:latest.learned_on,
      },"PATCH never changes slug, owner, id or deletions");
      if(race){
        remote={...old,title:"Other editor",updated_at:newStamp};
        return asJson([],"*/0");
      }
      remote={...latest};postVerified=true;
      return asJson([{id:remote.id,slug:remote.slug,updated_at:remote.updated_at}],"0-0/1");
    }
    throw Error("Unexpected HTTP request");
  }
  return {fetcher,calls,getRemote:()=>remote};
}

test("M3 single-note Sandbox PATCH uses row id + updated_at atomic CAS, then re-verifies",async()=>{
  const mock=mockNetwork();
  const result=await updateNeonSandboxNoteIfUnchanged({...args,fetcher:mock.fetcher});
  assert.deepEqual(mock.calls,[
    "GET /neondb/rest/v1/blog_admins",
    "GET /neondb/rest/v1/knowledge_notes",
    "GET /neondb/rest/v1/knowledge_notes",
    "PATCH /neondb/rest/v1/knowledge_notes",
    "GET /neondb/rest/v1/knowledge_notes",
  ]);
  assert.equal(result.slug,old.slug);
  assert.equal(result.sha256,newSha);
  assert.equal(result.revision,digest(rowId+":"+newStamp));
  assert.equal(result.baselineSaved,false);
  assert.equal(mock.getRemote().content_md,latest.content_md);
});

test("M3 rejects ambiguous, missing, and conflict approvals without a write",async()=>{
  for(const override of [
    {typedConfirmation:""},
    {decision:{...decision,choice:"conflict"}},
    {decision:{...decision,manualReview:false}},
    {decision:{...decision,expectedRemoteRevision:null}},
    {decision:{...decision,expectedRemoteSha:null}},
    {decision:{...decision,expectedLocalSha:oldSha}},
    {branchId:"other-branch"},
  ]){
    const mock=mockNetwork();
    await assert.rejects(updateNeonSandboxNoteIfUnchanged({
      ...args,...override,fetcher:mock.fetcher,
    }),/single-note conditional update/);
    assert.deepEqual(mock.calls,[]);
  }
});

test("M3 refuses stale reviewed remote inventory, without an update",async()=>{
  const mock=mockNetwork();
  await assert.rejects(updateNeonSandboxNoteIfUnchanged({
    ...args,decision:{...decision,expectedRemoteRevision:"f".repeat(64)},
    fetcher:mock.fetcher,
  }),/remote Sandbox version changed/);
  assert.deepEqual(mock.calls,[
    "GET /neondb/rest/v1/blog_admins","GET /neondb/rest/v1/knowledge_notes",
  ]);
});

test("M3 refuses changed local note after remote verification and before PATCH",async()=>{
  const mock=mockNetwork();
  await assert.rejects(updateNeonSandboxNoteIfUnchanged({
    ...args,readMarkdown:async()=>newMarkdown+"changed",fetcher:mock.fetcher,
  }),/local Markdown changed/);
  assert.equal(mock.calls.some(s=>s.startsWith("PATCH ")),false);
  assert.equal(mock.getRemote().content_md,old.content_md);
});

test("M3 lost CAS race updates zero rows, preserves other editor and never retries",async()=>{
  const mock=mockNetwork({race:true});
  await assert.rejects(updateNeonSandboxNoteIfUnchanged({
    ...args,fetcher:mock.fetcher,
  }),/needs manual reconciliation/);
  assert.equal(mock.calls.filter(s=>s.startsWith("PATCH ")).length,1);
  assert.equal(mock.getRemote().title,"Other editor");
  assert.equal(mock.calls.length,4,"no retry or inferred Baseline");
});

test("M3 remote post-PATCH mismatch cannot certify a baseline or success",async()=>{
  const mock=mockNetwork({failPostVerify:true});
  await assert.rejects(updateNeonSandboxNoteIfUnchanged({
    ...args,fetcher:mock.fetcher,
  }),/needs manual reconciliation/);
  assert.equal(mock.calls.filter(s=>s.startsWith("PATCH ")).length,1);
});

test("M3 non-owner RLS proof rejects prior to note GET or PATCH",async()=>{
  const mock=mockNetwork({granted:false});
  await assert.rejects(updateNeonSandboxNoteIfUnchanged({
    ...args,fetcher:mock.fetcher,
  }),/Owner RLS grant/);
  assert.deepEqual(mock.calls,["GET /neondb/rest/v1/blog_admins"]);
});
