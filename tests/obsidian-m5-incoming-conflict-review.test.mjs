import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,rm} from "node:fs/promises";
import path from "node:path";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {stageNeonSandboxIncoming} from "../lib/obsidian-neon-sandbox-incoming.ts";
import {NEON_SYNC_SANDBOX_BRANCH} from "../lib/obsidian-neon-sandbox-readonly.ts";
import {inspectM4IncomingConflict} from "../lib/obsidian-m5-incoming-conflict-review.ts";

const sha=s=>createHash("sha256").update(s).digest("hex");
const note={
  id:"00000000-0000-4000-8000-000000000091",
  slug:"offline-conflict",title:"Offline Conflict",summary:"No private data",
  content_md:"## Synthetic remote\nUpdated in sandbox simulation",
  category:"測試",tags:["synthetic"],learned_on:"2026-10-26",
  updated_at:"2026-10-26T11:00:00.000Z",
};
const localMarkdown="## Synthetic local\r\nUnmerged local content\r\n";
const remoteMarkdown=serializeObsidianMarkdown({
  title:note.title,slug:note.slug,excerpt:note.summary,
  content_md:note.content_md,category:note.category,
  tags:note.tags,learned_on:note.learned_on,
});
const remoteSha=sha(remoteMarkdown);
const localSha=sha(localMarkdown);
const revision=sha(note.id+":"+note.updated_at);
const fakeJwt="header."+Buffer.from(JSON.stringify({sub:"offline-synthetic-owner"})).toString("base64url")+".signature";

function json(rows,range=true){
  return new Response(JSON.stringify(rows),{status:200,headers:{
    "content-type":"application/json",
    ...(range?{"content-range":rows.length?"0-"+(rows.length-1)+"/"+rows.length:"*/0"}:{}),
  }});
}
async function fetcher(url,options){
  assert.equal(options.method,"GET");
  const target=new URL(url);
  if(target.pathname.endsWith("/blog_admins")){
    return json([{user_id:"offline-synthetic-owner"}],false);
  }
  assert.ok(target.pathname.endsWith("/knowledge_notes"));
  return json([note]);
}
function browserFile(name,bytes){
  const snapshot=Buffer.from(bytes);
  return {name,size:snapshot.length,arrayBuffer:async()=>Uint8Array.from(snapshot).buffer};
}
async function fromM4(result){
  return Promise.all([
    browserFile("incoming-receipt.json",await readFile(result.receiptPath)),
    browserFile("offline-conflict.md",await readFile(result.path)),
    browserFile("offline-conflict--local.md",await readFile(result.localCopyPath)),
  ]);
}
async function stage(){
  return stageNeonSandboxIncoming({
    branchId:NEON_SYNC_SANDBOX_BRANCH,sandboxOwnerJwt:fakeJwt,
    decision:{
      slug:note.slug,choice:"conflict",manualReview:true,
      expectedLocalSha:localSha,expectedRemoteSha:remoteSha,
      expectedRemoteRevision:revision,
    },
    typedConfirmation:"SAVE SANDBOX INCOMING "+note.slug,
    localMarkdown,fetcher,
  });
}

test("M4 persisted three-file conflict bundle feeds M5 browser-local side-by-side review",async()=>{
  const result=await stage();
  try{
    const files=await fromM4(result);
    const seen=await inspectM4IncomingConflict(files);
    assert.deepEqual(seen,{
      slug:note.slug,remoteRevision:revision,
      remoteSha256:remoteSha,localSha256:localSha,
      remoteMarkdown,localMarkdown,
    });
  }finally{
    await rm(path.dirname(result.path),{recursive:true,force:true});
  }
});

test("M5 UI import blocks altered persisted copies and invented receipts instead of showing content",async()=>{
  const result=await stage();
  try{
    const files=await fromM4(result);
    await assert.rejects(()=>inspectM4IncomingConflict([
      files[0],browserFile(files[1].name,"## Tampered"),files[2],
    ]),/SHA-256/);
    await assert.rejects(()=>inspectM4IncomingConflict([
      browserFile("incoming-receipt.json",JSON.stringify({
        format:"naosledge.m4.incoming-copy.v1",slug:note.slug,
        choice:"review-download",remoteSha256:remoteSha,
        remoteRevision:revision,localSha256:localSha,
      })),files[1],files[2],
    ]),/雙版本衝突/);
    await assert.rejects(()=>inspectM4IncomingConflict(files.slice(0,2)),/同時選取/);
    await assert.rejects(()=>inspectM4IncomingConflict([
      files[0],files[1],browserFile("another-note--local.md",localMarkdown),
    ]),/檔名/);
  }finally{
    await rm(path.dirname(result.path),{recursive:true,force:true});
  }
});
