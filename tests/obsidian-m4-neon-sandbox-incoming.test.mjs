import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {stageNeonSandboxIncoming} from "../lib/obsidian-neon-sandbox-incoming.ts";
import {
  NEON_SYNC_SANDBOX_BRANCH,NEON_SYNC_SANDBOX_DATA_API,
} from "../lib/obsidian-neon-sandbox-readonly.ts";

const owner="m4-sandbox-offline-owner";
const jwt="header."+Buffer.from(JSON.stringify({sub:owner})).toString("base64url")+".signature";
const note={
  id:"00000000-0000-4000-8000-000000000017",
  slug:"sample-incoming",title:"Sandbox Incoming",summary:"One note",
  content_md:"## Private test Markdown\n\nKeep both copies",
  category:"筆記",tags:["sandbox"],learned_on:"2026-10-24",
  updated_at:"2026-10-24T12:20:00.000Z",
};
const portable=n=>serializeObsidianMarkdown({
  title:n.title,slug:n.slug,excerpt:n.summary,content_md:n.content_md,
  category:n.category,tags:n.tags,learned_on:n.learned_on,
});
const digest=createHash("sha256").update(portable(note)).digest("hex");
const revision=createHash("sha256").update(note.id+":"+note.updated_at).digest("hex");
const choice={
  slug:note.slug,choice:"conflict",manualReview:true,
  expectedLocalSha:"a".repeat(64),expectedRemoteSha:digest,
  expectedRemoteRevision:revision,
};
const options={
  branchId:NEON_SYNC_SANDBOX_BRANCH,sandboxOwnerJwt:jwt,decision:choice,
  typedConfirmation:"SAVE SANDBOX INCOMING "+note.slug,
};
const json=(v,range=true)=>new Response(JSON.stringify(v),{
  status:200,headers:{"content-type":"application/json",
    ...(range?{"content-range":v.length?"0-"+(v.length-1)+"/"+v.length:"*/0"}:{})},
});
function fakeNetwork({ownerGranted=true,changedSingle=false,wrongRange=false}={}){
  const calls=[];
  async function fetcher(url,opts){
    const target=new URL(url);
    assert.equal(target.origin,new URL(NEON_SYNC_SANDBOX_DATA_API).origin);
    assert.equal(opts.method,"GET");
    assert.equal(opts.cache,"no-store");
    assert.equal(opts.redirect,"manual");
    assert.equal(opts.credentials,"omit");
    assert.equal(opts.headers.Authorization,"Bearer "+jwt);
    calls.push(target.pathname);
    if(target.pathname.endsWith("/blog_admins")){
      return json(ownerGranted?[{user_id:owner}]:[],false);
    }
    assert.ok(target.pathname.endsWith("/knowledge_notes"));
    assert.equal(opts.headers.Prefer,"count=exact");
    if(target.searchParams.has("slug")){
      assert.equal(target.searchParams.get("slug"),"eq."+note.slug);
      assert.equal(target.searchParams.get("limit"),"2");
      const response=json([{...note,content_md:changedSingle?"Different":note.content_md}]);
      if(wrongRange)response.headers.set("content-range","0-0/2");
      return response;
    }
    assert.equal(target.searchParams.get("limit"),"21");
    return json([note]);
  }
  return {fetcher,calls};
}

test("M4 copies exactly one Owner-RLS Sandbox note into a new temp Incoming directory; conflict never overwrites",async()=>{
  const n=fakeNetwork();
  const first=await stageNeonSandboxIncoming({...options,fetcher:n.fetcher});
  try{
    assert.equal(await readFile(first.path,"utf8"),portable(note));
    assert.equal(path.basename(first.path),note.slug+".md");
    assert.ok(first.path.startsWith(tmpdir()));
    assert.deepEqual({originalModified:first.originalModified,baselineSaved:first.baselineSaved},
      {originalModified:false,baselineSaved:false});
    assert.equal(first.sha256,digest);
    assert.equal(first.revision,revision);
    assert.deepEqual(n.calls,[
      "/neondb/rest/v1/blog_admins",
      "/neondb/rest/v1/knowledge_notes",
      "/neondb/rest/v1/knowledge_notes",
    ]);
    const second=await stageNeonSandboxIncoming({...options,fetcher:n.fetcher});
    try{
      assert.notEqual(first.path,second.path);
      assert.equal(await readFile(second.path,"utf8"),portable(note));
      assert.equal(await readFile(first.path,"utf8"),portable(note));
    }finally{
      await rm(path.dirname(second.path),{recursive:true,force:true});
    }
  }finally{
    await rm(path.dirname(first.path),{recursive:true,force:true});
  }
});

test("M4 rejects missing consent or upload direction before any network or filesystem work",async()=>{
  const n=fakeNetwork();
  await assert.rejects(stageNeonSandboxIncoming({
    ...options,typedConfirmation:"",fetcher:n.fetcher,
  }),/per-note Incoming confirmation/);
  await assert.rejects(stageNeonSandboxIncoming({
    ...options,decision:{...choice,choice:"review-upload"},fetcher:n.fetcher,
  }),/per-note Incoming confirmation/);
  await assert.rejects(stageNeonSandboxIncoming({
    ...options,decision:{...choice,expectedRemoteRevision:null},fetcher:n.fetcher,
  }),/per-note Incoming confirmation/);
  assert.equal(n.calls.length,0);
});

test("M4 rejects absent Owner grant and stale remote content before staging",async()=>{
  const noOwner=fakeNetwork({ownerGranted:false});
  await assert.rejects(stageNeonSandboxIncoming({...options,fetcher:noOwner.fetcher}),/Owner RLS grant/);
  assert.equal(noOwner.calls.length,1);
  const changed=fakeNetwork({changedSingle:true});
  await assert.rejects(stageNeonSandboxIncoming({...options,fetcher:changed.fetcher}),/changed after/);
  const incomplete=fakeNetwork({wrongRange:true});
  await assert.rejects(stageNeonSandboxIncoming({...options,fetcher:incomplete.fetcher}),/unavailable or incomplete/);
});
