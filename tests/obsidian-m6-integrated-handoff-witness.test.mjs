import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {readFile,rm} from "node:fs/promises";
import path from "node:path";
import {previewManualObsidianSync} from "../lib/obsidian-manual-sync-review.ts";
import {chooseReviewIntent,serializeManualM3UploadIntent}
  from "../lib/obsidian-m2-review-choices.ts";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {readScratchCreateRequest,createOneReviewedScratchNote}
  from "../scripts/obsidian-m3-sandbox-manual-create.ts";
import {reverifyM3SandboxWitness} from "../lib/obsidian-m5-sandbox-transfer-witness.ts";
import {NEON_SYNC_SANDBOX_DATA_API} from "../lib/obsidian-neon-sandbox-readonly.ts";

const sha=s=>createHash("sha256").update(s,"utf8").digest("hex");
const owner="m6-integrated-synthetic-owner";
const jwt="header."+Buffer.from(JSON.stringify({sub:owner})).toString("base64url")+".signature";
const item={
  id:"de17cacc-4985-43cd-af2c-cf56533253e1",
  slug:"m6-integrated-single-note",title:"Integrated transfer",summary:"Synthetic only",
  content_md:"## Test\n\nM2 M3 M5 joined without Vault access",
  category:"筆記",tags:["scratch"],learned_on:"2026-10-26",
  updated_at:"2026-10-26T15:00:00.000Z",
};
const portable=serializeObsidianMarkdown({
  slug:item.slug,title:item.title,excerpt:item.summary,
  content_md:item.content_md,category:item.category,tags:item.tags,
  learned_on:item.learned_on,
});
const fingerprint=sha(portable);
const revision=sha(item.id+":"+item.updated_at);
const json=(value,status=200,range=true)=>new Response(JSON.stringify(value),{
  status,headers:{"content-type":"application/json",
    ...(range?{"content-range":Array.isArray(value)&&value.length?
      "0-"+(value.length-1)+"/"+value.length:"*/0"}:{})},
});

function syntheticSandbox(){
  let stored=false,granted=true;
  const calls=[];
  async function fetcher(raw,options){
    const url=new URL(raw);
    assert.equal(url.origin,new URL(NEON_SYNC_SANDBOX_DATA_API).origin);
    assert.equal(options.headers.Authorization,"Bearer "+jwt);
    assert.equal(options.credentials,"omit");
    assert.equal(options.redirect,"manual");
    calls.push(options.method+" "+url.pathname);
    if(url.pathname.endsWith("/blog_admins")){
      assert.equal(options.method,"GET");
      return json(granted?[{user_id:owner}]:[],200,false);
    }
    assert.ok(url.pathname.endsWith("/knowledge_notes"));
    if(options.method==="GET"){
      assert.equal(options.headers.Prefer,"count=exact");
      if(url.searchParams.has("slug")){
        assert.equal(url.searchParams.get("slug"),"eq."+item.slug);
      }
      return json(stored?[item]:[]);
    }
    if(options.method==="POST"){
      assert.equal(stored,false,"create-only, no UPSERT");
      assert.equal(options.headers.Prefer,"return=representation");
      assert.deepEqual(JSON.parse(options.body),{
        slug:item.slug,title:item.title,summary:item.summary,
        content_md:item.content_md,category:item.category,
        tags:item.tags,learned_on:item.learned_on,
      });
      stored=true;
      return json([{id:item.id,slug:item.slug}],201);
    }
    throw Error("Unapproved request method");
  }
  return {fetcher,calls,revoke:()=>{granted=false;}};
}

test("M6 offline bridge: reviewed M2 upload -> MSI M3 create -> persisted M5 witness -> fresh Owner-RLS recheck",async()=>{
  const preview=await previewManualObsidianSync({
    baseline:[],
    readLocal:async()=>({
      fingerprints:[{slug:item.slug,sha256:fingerprint}],
      unsupportedMarkdownFiles:0,otherFiles:0,directoriesNotScanned:0,
      autoApplyAllowed:false,
    }),
    readRemote:async()=>({
      fingerprints:[],numberOfNotes:0,sandboxOnly:true,
      rlsEnforcedByDataApi:true,writeEnabled:false,fullInventory:true,
    }),
  });
  const reviewed=chooseReviewIntent(preview,{},item.slug,"upload");
  const handoff=JSON.parse(serializeManualM3UploadIntent(preview,reviewed,item.slug));
  const request=await readScratchCreateRequest([JSON.stringify({
    sandboxOwnerJwt:jwt,markdown:portable,handoff,
    typedConfirmation:"CREATE SANDBOX "+item.slug,
  })]);
  const network=syntheticSandbox();
  const result=await createOneReviewedScratchNote(request,network.fetcher,true);
  assert.equal(result.baselineSaved,false);
  assert.ok(result.receiptPath);
  const receiptPath=result.receiptPath;
  try{
    assert.equal(network.calls.filter(s=>s.startsWith("POST ")).length,1);
    const raw=await readFile(receiptPath,"utf8");
    assert.doesNotMatch(raw,/content_md|sandboxOwnerJwt|password|## Test/);
    const receipt=JSON.parse(raw);
    assert.equal(receipt.sha256,fingerprint);
    assert.equal(receipt.revision,revision);
    assert.equal(receipt.action,"manual-create");
    assert.equal(receipt.baselineSaved,false);

    const childCode='const fs=require("fs");const obj=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(obj.format!=="naosledge.m5.m3-transfer-witness.v1"||obj.baselineSaved!==false)process.exit(2);';
    const child=spawnSync(process.execPath,["-e",childCode,receiptPath],
      {encoding:"utf8",timeout:10000});
    assert.equal(child.status,0,child.stderr,"a separate Node process reads the persisted witness");

    const verified=await reverifyM3SandboxWitness({
      receiptPath,localMarkdown:portable,sandboxOwnerJwt:jwt,
      fetcher:network.fetcher,
    });
    assert.equal(verified.matchesCurrentScratchPair,true);
    assert.equal(verified.baselineSaved,false);
    assert.equal(verified.provenance,"self-reported-m3-witness");

    const before=network.calls.length;
    await assert.rejects(reverifyM3SandboxWitness({
      receiptPath,localMarkdown:portable+"changed",sandboxOwnerJwt:jwt,
      fetcher:network.fetcher,
    }),/differs from M3 witness/);
    assert.equal(network.calls.length,before,"changed local input cannot trigger remote request");
    network.revoke();
    await assert.rejects(reverifyM3SandboxWitness({
      receiptPath,localMarkdown:portable,sandboxOwnerJwt:jwt,
      fetcher:network.fetcher,
    }),/Owner RLS grant/);
    assert.equal(network.calls.filter(s=>s.startsWith("POST ")).length,1);
  }finally{
    await rm(path.dirname(receiptPath),{recursive:true,force:true});
  }
});
