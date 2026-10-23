/**
 * Integration chain: real Markdown serializer -> real FS scanner -> real
 * fixed Neon Sandbox GET reader (fake network Response) -> M1 planner.
 * No real network, Vault, production token, writes to Neon or auto-sync.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {readObsidianLocalManifest} from "../lib/obsidian-local-manifest.ts";
import {
  fetchNeonSandboxFingerprints,NEON_SYNC_SANDBOX_BRANCH,
  NEON_SYNC_SANDBOX_DATA_API,
} from "../lib/obsidian-neon-sandbox-readonly.ts";
import {previewManualObsidianSync} from "../lib/obsidian-manual-sync-review.ts";

const jwt="test-only.sandbox.signature";
const sha=value=>createHash("sha256").update(value).digest("hex");
const note={
  id:"00000000-0000-4000-8000-000000000098",
  slug:"portable-note",
  title:"Synthetic knowledge",
  summary:"Test only",
  content_md:"# Synthetic note\n\n[[next-step]]",
  category:"QA",
  tags:["Sandbox"],
  learned_on:"2026-10-23",
  updated_at:"2026-10-23T06:00:00.000Z",
};
const portable=serializeObsidianMarkdown({
  title:note.title,slug:note.slug,excerpt:note.summary,
  category:note.category,tags:note.tags,learned_on:note.learned_on,
  content_md:note.content_md,
});

async function withScratch(callback){
  const root=await mkdtemp(path.join(tmpdir(),"naosledge-m1-real-reader-test-"));
  try{return await callback(root);}
  finally{await rm(root,{recursive:true,force:true});}
}
const result=data=>new Response(JSON.stringify(data),{
  status:200,headers:{"content-type":"application/json"},
});

test("real GET reader plus real local scanner detect unchanged and locally edited portable Markdown without writes",async()=>{
  await withScratch(async root=>{
    const filename=path.join(root,"portable-note.md");
    await writeFile(filename,portable,"utf8");
    let httpCalls=0;
    const getSandbox=()=>fetchNeonSandboxFingerprints({
      branchId:NEON_SYNC_SANDBOX_BRANCH,jwt,
      fetcher:async(url,request)=>{
        httpCalls++;
        assert.equal(request.method,"GET");
        assert.equal(request.redirect,"manual");
        assert.equal(request.credentials,"omit");
        assert.equal(request.body,undefined);
        assert.equal(request.headers.Authorization,"Bearer "+jwt);
        assert.equal(new URL(url).origin,new URL(NEON_SYNC_SANDBOX_DATA_API).origin);
        assert.equal(new URL(url).pathname,"/neondb/rest/v1/knowledge_notes");
        return result([note]);
      },
    });
    const base=[{slug:note.slug,sha256:sha(portable)}];
    const original=await previewManualObsidianSync({
      readLocal:()=>readObsidianLocalManifest(root),
      readRemote:getSandbox,
      baseline:base,
    });
    assert.equal(original.summary.unchanged,1);
    assert.equal(original.manualReviewCount,0);
    assert.equal(original.autoApplyAllowed,false);
    assert.equal(original.decisions[0].writeAllowed,false);
    assert.equal(original.decisions[0].deleteAllowed,false);
    assert.equal(original.inventory.remoteFullInventory,true);
    assert.equal(original.previewStatus,"ready");
    assert.equal(await readFile(filename,"utf8"),portable);

    const localEdited=portable+"\n\nLocal-only synthetic change";
    await writeFile(filename,localEdited,"utf8");
    const next=await previewManualObsidianSync({
      readLocal:()=>readObsidianLocalManifest(root),
      readRemote:getSandbox,
      baseline:base,
    });
    assert.equal(next.summary["review-upload"],1);
    assert.equal(next.decisions[0].choice,"review-upload");
    assert.equal(next.decisions[0].expectedLocalSha,sha(localEdited));
    assert.equal(next.decisions[0].expectedRemoteSha,sha(portable));
    assert.equal(next.decisions[0].writeAllowed,false);
    assert.equal(next.decisions[0].deleteAllowed,false);
    assert.equal(next.baselinePersisted,false);
    assert.equal(httpCalls,2);
    assert.equal(await readFile(filename,"utf8"),localEdited);
    assert.doesNotMatch(JSON.stringify(next),/# Synthetic note|Local-only synthetic change|test-only\.sandbox\.signature/);
  });
});

test("401 or incomplete real reader cannot become a missing-remote deletion plan",async()=>{
  await withScratch(async root=>{
    const filename=path.join(root,"portable-note.md");
    await writeFile(filename,portable);
    let failedCalls=0;
    const blocked=()=>fetchNeonSandboxFingerprints({
      branchId:NEON_SYNC_SANDBOX_BRANCH,jwt,
      fetcher:async()=>{
        failedCalls++;
        return new Response(JSON.stringify({error:"CONFIDENTIAL_ERROR"}),{
          status:401,headers:{"content-type":"application/json"},
        });
      },
    });
    await assert.rejects(previewManualObsidianSync({
      readLocal:()=>readObsidianLocalManifest(root),
      readRemote:blocked,
      baseline:[],
    }),err=>{
      assert.match(err.message,/Neon Sandbox inventory unavailable/);
      assert.doesNotMatch(err.message,/CONFIDENTIAL_ERROR|401|test-only/);
      return true;
    });
    assert.equal(failedCalls,1);
    assert.equal(await readFile(filename,"utf8"),portable);
  });
});
