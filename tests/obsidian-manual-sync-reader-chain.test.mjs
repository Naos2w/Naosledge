/**
 * Integration chain: real Markdown serializer -> real FS scanner -> real
 * fixed Neon Sandbox GET reader (fake network Response) -> M1 planner.
 * No real network, Vault, production token, writes to Neon or auto-sync.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
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
  status:200,headers:{
    "content-type":"application/json",
    "content-range":data.length?`0-${data.length-1}/${data.length}`:"*/0",
  },
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
        assert.equal(request.headers.Prefer,"count=exact");
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

test("M1 refuses stale local fingerprints if a note changes during the remote GET",async()=>{
  await withScratch(async root=>{
    const filename=path.join(root,"portable-note.md");
    await writeFile(filename,portable);
    let localReads=0,remoteReads=0;
    await assert.rejects(previewManualObsidianSync({
      baseline:[],
      readLocal:async()=>{localReads++;return readObsidianLocalManifest(root);},
      readRemote:async()=>{
        remoteReads++;
        await writeFile(filename,portable+"\nlocal edit during remote read");
        return fetchNeonSandboxFingerprints({
          branchId:NEON_SYNC_SANDBOX_BRANCH,jwt,
          fetcher:async()=>result([note]),
        });
      },
    }),/Local Obsidian inventory changed during remote read/);
    assert.equal(localReads,2);
    assert.equal(remoteReads,1);
    assert.equal(await readFile(filename,"utf8"),portable+"\nlocal edit during remote read");
  });
});

test("M1 refuses newly uncovered folders and second-pass local reader failures",async()=>{
  await withScratch(async root=>{
    await writeFile(path.join(root,"portable-note.md"),portable);
    await assert.rejects(previewManualObsidianSync({
      baseline:[],readLocal:()=>readObsidianLocalManifest(root),
      readRemote:async()=>{
        await mkdir(path.join(root,"new-nested-notes"));
        return fetchNeonSandboxFingerprints({
          branchId:NEON_SYNC_SANDBOX_BRANCH,jwt,
          fetcher:async()=>result([note]),
        });
      },
    }),/Local Obsidian inventory changed during remote read/);
    await rm(path.join(root,"new-nested-notes"),{recursive:true});
    let calls=0;
    await assert.rejects(previewManualObsidianSync({
      baseline:[],
      readLocal:async()=>{
        if(++calls===2)throw Error("PRIVATE_LOCAL_READER_DETAILS");
        return readObsidianLocalManifest(root);
      },
      readRemote:async()=>({
        fingerprints:[],numberOfNotes:0,sandboxOnly:true,
        rlsEnforcedByDataApi:true,writeEnabled:false,fullInventory:true,
      }),
    }),error=>{
      assert.match(error.message,/Local Obsidian inventory unavailable after remote read/);
      assert.doesNotMatch(error.message,/PRIVATE_LOCAL_READER_DETAILS/);
      return true;
    });
    assert.equal(calls,2);
  });
});
