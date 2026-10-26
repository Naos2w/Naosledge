import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {readFile,rm,writeFile} from "node:fs/promises";
import path from "node:path";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {
  storeVerifiedM3SandboxWitness,reverifyM3SandboxWitness,
} from "../lib/obsidian-m5-sandbox-transfer-witness.ts";
import {
  M5_WITNESS_REVERIFY_FLAG,assertManualM5Invocation,
  readManualM5Request,reverifyManualM5Witness,
} from "../scripts/obsidian-m5-sandbox-reverify-witness.ts";
import {NEON_SYNC_SANDBOX_DATA_API} from "../lib/obsidian-neon-sandbox-readonly.ts";

const owner="m5-witness-offline-owner";
const jwt="header."+Buffer.from(JSON.stringify({sub:owner})).toString("base64url")+".signature";
const note={
  id:"00000000-0000-4000-8000-000000000025",
  slug:"m5-witness-note",title:"M5 manual witness",summary:"offline test",
  content_md:"A portable sandbox-only note",
  category:"筆記",tags:["scratch"],learned_on:"2026-10-26",
  updated_at:"2026-10-26T07:00:00.000Z",
};
const markdown=serializeObsidianMarkdown({
  title:note.title,slug:note.slug,excerpt:note.summary,
  content_md:note.content_md,category:note.category,
  tags:note.tags,learned_on:note.learned_on,
});
const sha=createHash("sha256").update(markdown).digest("hex");
const revision=createHash("sha256").update(note.id+":"+note.updated_at).digest("hex");
const json=(items,includeRange=true)=>new Response(JSON.stringify(items),{
  status:200,headers:{"content-type":"application/json",
    ...(includeRange?{"content-range":items.length?"0-"+(items.length-1)+"/"+items.length:"*/0"}:{})},
});
function fakeNetwork({grant=true,changed=false,revisionChanged=false}={}){
  const calls=[];
  const fetcher=async(url,opts)=>{
    const target=new URL(url);
    calls.push(opts.method+" "+target.pathname);
    assert.equal(target.origin,new URL(NEON_SYNC_SANDBOX_DATA_API).origin);
    assert.equal(opts.method,"GET");
    assert.equal(opts.cache,"no-store");
    assert.equal(opts.redirect,"manual");
    assert.equal(opts.credentials,"omit");
    assert.equal(opts.headers.Authorization,"Bearer "+jwt);
    if(target.pathname.endsWith("/blog_admins")){
      return json(grant?[{user_id:owner}]:[],false);
    }
    assert.ok(target.pathname.endsWith("/knowledge_notes"));
    assert.equal(opts.headers.Prefer,"count=exact");
    const row={...note,
      ...(changed?{content_md:note.content_md+" changed"}:{}),
      ...(revisionChanged?{updated_at:"2026-10-26T07:01:00.000Z"}:{})};
    return json([row]);
  };
  return {fetcher,calls};
}

test("M3 verified Scratch witness persists across a separate Node process; live Owner-RLS reread is still required",async()=>{
  const evidence=await storeVerifiedM3SandboxWitness({
    action:"manual-create",slug:note.slug,sha256:sha,revision,
  });
  try{
    assert.equal(evidence.baselineSaved,false);
    const readAgain=spawnSync(process.execPath,[
      "-e","const fs=require('fs');console.log(JSON.parse(fs.readFileSync(process.argv[1],'utf8')).format)",
      evidence.receiptPath,
    ],{encoding:"utf8",timeout:10000});
    assert.equal(readAgain.status,0,readAgain.stderr);
    assert.equal(readAgain.stdout.trim(),"naosledge.m5.m3-transfer-witness.v1");
    const recorded=await readFile(evidence.receiptPath,"utf8");
    assert.equal(recorded.includes(markdown),false);
    assert.equal(recorded.includes(jwt),false);

    const network=fakeNetwork();
    const request=await readManualM5Request([JSON.stringify({
      sandboxOwnerJwt:jwt,localMarkdown:markdown,receiptPath:evidence.receiptPath,
    })]);
    const result=await reverifyManualM5Witness(request,network.fetcher);
    assert.deepEqual(result,{matchesCurrentScratchPair:true,baselineSaved:false});
    assert.deepEqual(network.calls,[
      "GET /neondb/rest/v1/blog_admins",
      "GET /neondb/rest/v1/knowledge_notes",
      "GET /neondb/rest/v1/knowledge_notes",
    ]);
  }finally{
    await rm(path.dirname(evidence.receiptPath),{recursive:true,force:true});
  }
});

test("M5 missing Owner grant, stale remote revision and edited local scratch fail without Baseline changes",async()=>{
  const evidence=await storeVerifiedM3SandboxWitness({
    action:"manual-update",slug:note.slug,sha256:sha,revision,
  });
  try{
    const args={receiptPath:evidence.receiptPath,localMarkdown:markdown,
      sandboxOwnerJwt:jwt};
    const denied=fakeNetwork({grant:false});
    await assert.rejects(reverifyM3SandboxWitness({...args,fetcher:denied.fetcher}),
      /Owner RLS grant/);
    assert.equal(denied.calls.length,1);
    const stale=fakeNetwork({revisionChanged:true});
    await assert.rejects(reverifyM3SandboxWitness({...args,fetcher:stale.fetcher}),
      /stale or missing/);
    const changedLocal=fakeNetwork();
    await assert.rejects(reverifyM3SandboxWitness({
      ...args,localMarkdown:markdown+"tampered",fetcher:changedLocal.fetcher,
    }),/differs from M3 witness/);
    assert.equal(changedLocal.calls.length,0);

    const forged=JSON.parse(await readFile(evidence.receiptPath,"utf8"));
    forged.sha256="0".repeat(64);
    await writeFile(evidence.receiptPath,JSON.stringify(forged));
    const changedWitness=fakeNetwork();
    await assert.rejects(reverifyM3SandboxWitness({
      ...args,fetcher:changedWitness.fetcher,
    }),/differs from M3 witness/);
    assert.equal(changedWitness.calls.length,0);
    assert.equal((await readFile(evidence.receiptPath,"utf8")).includes(jwt),false);
  }finally{
    await rm(path.dirname(evidence.receiptPath),{recursive:true,force:true});
  }
});

test("M5 manual reinspection requires MSI pipe, exact request and cannot accept a target Vault path",async()=>{
  assertManualM5Invocation("win32","MSI",[M5_WITNESS_REVERIFY_FLAG],false);
  for(const args of [
    ["linux","MSI",[M5_WITNESS_REVERIFY_FLAG],false],
    ["win32","OTHER",[M5_WITNESS_REVERIFY_FLAG],false],
    ["win32","MSI",[],false],
    ["win32","MSI",[M5_WITNESS_REVERIFY_FLAG],true],
  ])assert.throws(()=>assertManualM5Invocation(...args),/explicit MSI stdin/);
  const request={sandboxOwnerJwt:jwt,localMarkdown:markdown,
    receiptPath:"C:\\Naos\\Obsidian\\Naosledge\\private.json"};
  await assert.rejects(reverifyM3SandboxWitness({
    ...request,fetcher:fakeNetwork().fetcher,
  }),/isolated OS scratch file|ENOENT/);
  await assert.rejects(readManualM5Request(["not-json"]),/JSON stdin/);
  await assert.rejects(readManualM5Request([JSON.stringify({
    ...request,extra:true,
  })]),/single exact private witness/);
  await assert.rejects(readManualM5Request([JSON.stringify({
    ...request,sandboxOwnerJwt:"bad",
  })]),/input is invalid/);
});

test("M5 cannot mint a witness from malformed or unverified note result",async()=>{
  for(const input of [
    {action:"manual-create",slug:"../unsafe",sha256:sha,revision},
    {action:"manual-update",slug:note.slug,sha256:"bad",revision},
    {action:"manual-delete",slug:note.slug,sha256:sha,revision},
    {action:"manual-create",slug:note.slug,sha256:sha,revision,token:jwt},
  ]){
    await assert.rejects(storeVerifiedM3SandboxWitness(input),
      /requires a verified single-note/);
  }
});
