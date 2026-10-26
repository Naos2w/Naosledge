import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {stageNeonSandboxIncoming} from "../lib/obsidian-neon-sandbox-incoming.ts";
import {
  M4_SCRATCH_INCOMING_FLAG,assertManualM4Invocation,
  readScratchIncomingRequest,stageOneReviewedSandboxIncoming,
} from "../scripts/obsidian-m4-sandbox-manual-incoming.ts";
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
    const staged=await readFile(first.path);
    assert.equal(staged.toString("utf8"),portable(note));
    assert.equal(createHash("sha256").update(staged).digest("hex"),digest,
      "success receipt must describe the persisted Incoming bytes");
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

test("M4/M5 keeps an independently hash-verified local+remote conflict pair without reading or writing a Vault",async()=>{
  const localMarkdown="## Earlier local version\r\n\r\n保留本地版本\r\n";
  const localSha=createHash("sha256").update(localMarkdown).digest("hex");
  const decision={...choice,expectedLocalSha:localSha};
  const payload={sandboxOwnerJwt:jwt,decision,
    typedConfirmation:"SAVE SANDBOX INCOMING "+note.slug,localMarkdown};
  const request=await readScratchIncomingRequest([JSON.stringify(payload)]);
  const network=fakeNetwork();
  const result=await stageOneReviewedSandboxIncoming(request,network.fetcher);
  try{
    assert.ok(result.localCopyPath,"manual M4 returns a second independently saved snapshot");
    assert.equal(path.dirname(result.path),path.dirname(result.localCopyPath));
    assert.equal(path.basename(result.path),note.slug+".md");
    assert.equal(path.basename(result.localCopyPath),note.slug+"--local.md");
    assert.equal(await readFile(result.path,"utf8"),portable(note));
    assert.equal(await readFile(result.localCopyPath,"utf8"),localMarkdown);
    assert.equal(createHash("sha256").update(await readFile(result.localCopyPath))
      .digest("hex"),localSha);
    assert.deepEqual({originalModified:result.originalModified,baselineSaved:result.baselineSaved},
      {originalModified:false,baselineSaved:false});
    assert.equal(network.calls.length,3);
  }finally{
    await rm(path.dirname(result.path),{recursive:true,force:true});
  }

  const badNetwork=fakeNetwork();
  await assert.rejects(stageNeonSandboxIncoming({
    ...options,decision,localMarkdown:localMarkdown+"changed",fetcher:badNetwork.fetcher,
  }),/local conflict snapshot differs/);
  assert.equal(badNetwork.calls.length,0,"mismatched local bytes must abort before GET");
  await assert.rejects(readScratchIncomingRequest([JSON.stringify({
    ...payload,decision:{...decision,choice:"review-download"},
  })]),/only accepted for one reviewed conflict/);
  await assert.rejects(readScratchIncomingRequest([JSON.stringify({
    ...payload,localMarkdown:"x".repeat(250_001),
  })]),/only accepted for one reviewed conflict/);
  await assert.rejects(readScratchIncomingRequest([JSON.stringify({
    ...payload,filename:"C:\\\\Naos\\\\Obsidian",
  })]),/exactly one reviewed note/);
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

test("M4 staging independently rejects contradictory M2 decisions before Owner GET",async()=>{
  const network=fakeNetwork();
  const invalid=[
    {...choice,expectedLocalSha:null}, // conflict requires two present versions
    {...choice,expectedLocalSha:"not-a-sha"},
    {...choice,expectedLocalSha:digest}, // equal SHA belongs to unchanged
    {...choice,choice:"review-download",expectedLocalSha:null},
    {...choice,choice:"review-missing-local",expectedLocalSha:"a".repeat(64)},
    {...choice,choice:"review-missing-local",expectedLocalSha:null,path:"injected"},
  ];
  for(const decision of invalid){
    await assert.rejects(stageNeonSandboxIncoming({
      ...options,decision,fetcher:network.fetcher,
    }),/per-note Incoming confirmation/);
  }
  assert.equal(network.calls.length,0);
});

test("M4 stage accepts consistent reviewed download and missing-local decisions",async()=>{
  const network=fakeNetwork();
  for(const decision of [
    {...choice,choice:"review-download"},
    {...choice,choice:"review-missing-local",expectedLocalSha:null},
  ]){
    const result=await stageNeonSandboxIncoming({
      ...options,decision,fetcher:network.fetcher,
    });
    try{assert.equal(await readFile(result.path,"utf8"),portable(note));}
    finally{await rm(path.dirname(result.path),{recursive:true,force:true});}
  }
  assert.equal(network.calls.length,6);
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

test("M4 MSI manual Incoming entry requires explicit flag, approved host and stdin pipe",async()=>{
  assertManualM4Invocation("win32","MSI",[M4_SCRATCH_INCOMING_FLAG],false);
  for(const bad of [
    ["linux","MSI",[M4_SCRATCH_INCOMING_FLAG],false],
    ["win32","OTHER",[M4_SCRATCH_INCOMING_FLAG],false],
    ["win32","MSI",[],false],
    ["win32","MSI",[M4_SCRATCH_INCOMING_FLAG],true],
  ]){
    assert.throws(()=>assertManualM4Invocation(...bad),/piped manual Incoming/);
  }
  const request={sandboxOwnerJwt:jwt,decision:choice,
    typedConfirmation:"SAVE SANDBOX INCOMING "+note.slug};
  await assert.rejects(readScratchIncomingRequest(["not-json"]),/must be JSON/);
  await assert.rejects(readScratchIncomingRequest(["x".repeat(500_001)]),/too large/);
  await assert.rejects(readScratchIncomingRequest([JSON.stringify({
    ...request,destination:"C:\\Naos\\Obsidian\\Naosledge",
  })]),/local snapshot|exactly one reviewed note/);
  await assert.rejects(readScratchIncomingRequest([JSON.stringify({
    ...request,decision:{...choice,path:"untrusted"},
  })]),/input is invalid/);
  await assert.rejects(readScratchIncomingRequest([JSON.stringify({
    ...request,typedConfirmation:"",
  })]),/per-note read-only decision/);
  await assert.rejects(readScratchIncomingRequest([JSON.stringify({
    ...request,decision:{...choice,choice:"review-upload"},
  })]),/per-note read-only decision/);
});

test("M4 MSI manual request creates one private Scratch Incoming copy with no original write",async()=>{
  const request=await readScratchIncomingRequest([JSON.stringify({
    sandboxOwnerJwt:jwt,decision:choice,
    typedConfirmation:"SAVE SANDBOX INCOMING "+note.slug,
  })]);
  const n=fakeNetwork();
  const result=await stageOneReviewedSandboxIncoming(request,n.fetcher);
  try{
    assert.equal(await readFile(result.path,"utf8"),portable(note));
    assert.equal(path.basename(result.path),note.slug+".md");
    assert.deepEqual({
      originalModified:result.originalModified,baselineSaved:result.baselineSaved,
    },{originalModified:false,baselineSaved:false});
    assert.equal(n.calls.length,3);
  }finally{
    await rm(path.dirname(result.path),{recursive:true,force:true});
  }
  const denied=fakeNetwork();
  await assert.rejects(stageOneReviewedSandboxIncoming({
    ...request,typedConfirmation:"not approved",
  },denied.fetcher),/per-note Incoming confirmation/);
  assert.deepEqual(denied.calls,[]);
});


test("M4 keeps the approved filename and fingerprints when the caller mutates its decision during GET",async()=>{
  const decision={...choice};
  const n=fakeNetwork();
  const result=await stageNeonSandboxIncoming({
    ...options,decision,
    fetcher:async(url,opts)=>{
      decision.slug="different-note";
      decision.expectedRemoteSha="b".repeat(64);
      decision.expectedRemoteRevision="c".repeat(64);
      return n.fetcher(url,opts);
    },
  });
  try{
    assert.equal(path.basename(result.path),note.slug+".md");
    assert.equal(await readFile(result.path,"utf8"),portable(note));
    assert.equal(result.sha256,digest);
    assert.equal(result.revision,revision);
    assert.equal(n.calls.length,3);
  }finally{
    await rm(path.dirname(result.path),{recursive:true,force:true});
  }
});
