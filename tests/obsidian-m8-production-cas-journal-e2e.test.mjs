import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {
  adoptProductionM8EqualPairing,inspectProductionM8Baseline,
  recordVerifiedProductionM8Upload,manuallyRecoverProductionM8Checkpoint,
} from "../lib/obsidian-m8-production-baseline-journal.ts";
import {
  updateProductionNoteCasOnce,createProductionNoteOnce,
} from "../lib/obsidian-m8-production-cas-update.ts";
import {fetchProductionOwnerRlsFingerprints}
  from "../lib/obsidian-m8-production-inventory-readonly.ts";
import {planAutomaticObsidianSync}
  from "../lib/obsidian-auto-sync-policy.ts";
import {readObsidianLocalManifest} from "../lib/obsidian-local-manifest.ts";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {RELEASE_NEON_BRANCH,RELEASE_DATA_API_URL}
  from "../lib/neon/production-release.ts";

const SUB="00000000-0000-4000-8000-000000000041";
const ID="00000000-0000-4000-8000-000000000091";
const SLUG="m8-e2e-journal";
const sha=s=>createHash("sha256").update(s).digest("hex");
const jwt="eyJhbGciOiJIUzI1NiJ9."+
  Buffer.from(JSON.stringify({sub:SUB,exp:Math.floor(Date.now()/1000)+3600}))
    .toString("base64url")+".syntheticsignature";
const protector={
  seal:async key=>key.toString("base64"),
  unseal:async data=>Buffer.from(data,"base64"),
};
const stamp1="2026-10-29T03:00:00.000Z";
const stamp2="2026-10-29T03:05:00.000Z";
const note=(body,updatedAt)=>({
  id:ID,slug:SLUG,title:"M8 E2E synthetic",
  summary:"isolated non-personal test",content_md:body,
  category:"test",tags:[],learned_on:"2026-10-29",
  updated_at:updatedAt,
});
const v1=note("# V1\n\n[[old-link]]",stamp1);
const v2=note("# V2\n\n[[new-link]]",stamp2);
const fmt=row=>serializeObsidianMarkdown({
  title:row.title,slug:row.slug,excerpt:row.summary,
  category:row.category,tags:row.tags,learned_on:row.learned_on,
  content_md:row.content_md,
});
const revision=row=>sha(row.id+":"+row.updated_at);
const resp=(value,range,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{"content-type":"application/json",
    ...(range?{"content-range":range}:{})},
});
function fakeServer(initial,opts={}){
  let row=initial?{...initial}:null;
  let links=initial?(initial.content_md.includes("old-link")?
    ["old-link"]:["new-link"]):[];
  let posts=0;
  const fetcher=async(uri,config)=>{
    const url=new URL(uri);
    assert.equal(url.origin,new URL(RELEASE_DATA_API_URL).origin);
    assert.equal(config.headers.Authorization,"Bearer "+jwt);
    if(url.pathname.endsWith("/blog_admins"))
      return resp([{user_id:SUB}],"0-0/1");
    if(url.pathname.endsWith("/knowledge_notes")){
      assert.equal(config.method,"GET");
      return resp(row?[{...row}]:[],row?"0-0/1":"*/0");
    }
    if(url.pathname.endsWith("/knowledge_links")){
      assert.equal(config.method,"GET");
      return resp(links.map(target_key=>({target_key})),
        links.length?"0-"+(links.length-1)+"/"+links.length:"*/0");
    }
    if(url.pathname.endsWith("/rpc/update_knowledge_note_cas_with_links")){
      assert.equal(config.method,"POST");
      posts++;
      const b=JSON.parse(config.body);
      assert.equal(b.p_id,ID);
      assert.equal(b.p_slug,SLUG);
      assert.deepEqual(b.p_expected_links,links);
      assert.equal(b.p_expected_updated_at,row.updated_at);
      assert.equal(b.p_links.length,1);
      if(!row||row.updated_at!==b.p_expected_updated_at)
        return resp({code:"40001"},null,409);
      row={...row,content_md:b.p_content_md,summary:b.p_summary,
        title:b.p_title,category:b.p_category,tags:b.p_tags,
        learned_on:b.p_learned_on,updated_at:stamp2};
      links=[...b.p_links];
      if(opts.loseResponseAfterCommit)throw Error("PRIVATE_TRANSPORT_FAULT");
      return resp(ID,null);
    }
    if(url.pathname.endsWith("/rpc/save_knowledge_note")){
      assert.equal(config.method,"POST");
      posts++;
      const b=JSON.parse(config.body);
      assert.equal(b.p_id,null);
      if(row)return resp({code:"23505"},null,409);
      row={
        id:ID,slug:b.p_slug,title:b.p_title,summary:b.p_summary,
        content_md:b.p_content_md,category:b.p_category,
        tags:b.p_tags,learned_on:b.p_learned_on,updated_at:stamp2,
      };
      links=[...b.p_links];
      if(opts.loseResponseAfterCommit)throw Error("PRIVATE_TRANSPORT_FAULT");
      return resp(ID,null);
    }
    throw Error("Unexpected fake server endpoint");
  };
  return {fetcher,get posts(){return posts},
    get row(){return row},get links(){return links}};
}
async function withScratch(callback){
  const root=await mkdtemp(path.join(tmpdir(),
    "naosledge-m8-production-baseline-test-"));
  const vault=await mkdtemp(path.join(tmpdir(),
    "naosledge-m8-vault-test-"));
  const opt={
    testRoot:root,testProtector:protector,
    testReadLocal:()=>readObsidianLocalManifest(vault),
  };
  try{return await callback({root,vault,opt});}finally{
    await rm(root,{recursive:true,force:true});
    await rm(vault,{recursive:true,force:true});
  }
}
const trust={
  initialPairingApproved:true,durableBaselineVerified:true,
  ownerSessionFresh:true,productionSchemaReady:true,
};
async function plan(vault,owner,baseline){
  return planAutomaticObsidianSync({
    local:await readObsidianLocalManifest(vault),
    remote:await fetchProductionOwnerRlsFingerprints({
      branchId:RELEASE_NEON_BRANCH,jwt,fetcher:owner.fetcher,
    }),
    baseline,trust,
  });
}
const pairing=(owner,opt)=>adoptProductionM8EqualPairing({
  ownerJwt:jwt,typedConfirmation:"APPROVE M8 PRODUCTION INITIAL EQUALITY",
  fetcher:owner.fetcher,options:opt,
});
const load=(owner,opt)=>inspectProductionM8Baseline({
  ownerJwt:jwt,fetcher:owner.fetcher,options:opt,
});
const checkpoint=(owner,opt,receipt,before)=>recordVerifiedProductionM8Upload({
  ownerJwt:jwt,fetcher:owner.fetcher,options:opt,receipt,
  beforeSha256:before?.sha256??null,
  beforeRevision:before?.revision??null,
});
test("synthetic CAS update + independent owner readback + signed M5 checkpoint survives restart",async()=>{
  await withScratch(async({vault,opt})=>{
    const owner=fakeServer(v1),filename=path.join(vault,SLUG+".md");
    await writeFile(filename,fmt(v1));
    await pairing(owner,opt);
    const prior=(await load(owner,opt)).fingerprints[0];
    assert.equal(prior.sha256,sha(fmt(v1)));
    assert.equal(prior.revision,revision(v1));
    await writeFile(filename,fmt(v2));
    const before=await plan(vault,owner,[prior]);
    assert.deepEqual(before.candidates.map(x=>x.action),["upload-cas"]);
    const candidate=before.candidates[0];
    const receipt=await updateProductionNoteCasOnce({
      branchId:RELEASE_NEON_BRANCH,ownerJwt:jwt,
      candidate,readLocalMarkdown:()=>readFile(filename,"utf8"),
      typedConfirmation:"TEST M8 PRODUCTION CAS "+SLUG+" "+
        candidate.expectedLocalSha.slice(0,12),
      fetcher:owner.fetcher,
    });
    assert.equal(owner.posts,1);
    assert.equal(receipt.verifiedRemoteReadback,true);
    const saved=await checkpoint(owner,opt,receipt,prior);
    assert.equal(saved.checkpointSaved,true);
    assert.equal(saved.recordCount,2);
    const restarted=await load(owner,opt);
    assert.equal(restarted.paired,true);
    assert.equal(restarted.recordCount,2);
    assert.equal(restarted.fingerprints[0].sha256,sha(fmt(v2)));
    assert.equal(restarted.fingerprints[0].revision,revision(v2));
    const after=await plan(vault,owner,restarted.fingerprints);
    assert.deepEqual(after.candidates.map(x=>x.action),["unchanged"]);
    assert.equal(after.autoCandidateCount,0);
    assert.equal(after.manualReviewCount,0);
    assert.equal(owner.posts,1);
    assert.deepEqual(owner.links,["new-link"]);
  });
});
test("create-only after signed empty pairing writes one new remote row then one M5 checkpoint",async()=>{
  await withScratch(async({vault,opt})=>{
    const owner=fakeServer(null);
    await pairing(owner,opt);
    const filename=path.join(vault,SLUG+".md");
    await writeFile(filename,fmt(v2));
    const prior=(await load(owner,opt)).fingerprints;
    assert.deepEqual(prior,[]);
    const initialPlan=await plan(vault,owner,[]);
    assert.equal(initialPlan.candidates[0].action,"upload-create");
    const candidate=initialPlan.candidates[0];
    const r=await createProductionNoteOnce({
      branchId:RELEASE_NEON_BRANCH,ownerJwt:jwt,
      candidate,readLocalMarkdown:()=>readFile(filename,"utf8"),
      typedConfirmation:"TEST M8 PRODUCTION CREATE "+SLUG+" "+
        candidate.expectedLocalSha.slice(0,12),
      fetcher:owner.fetcher,
    });
    assert.equal(owner.posts,1);
    const saved=await checkpoint(owner,opt,r,null);
    assert.equal(saved.recordCount,2);
    const after=await plan(vault,owner,(await load(owner,opt)).fingerprints);
    assert.equal(after.candidates[0].action,"unchanged");
    assert.equal(after.autoCandidateCount,0);
  });
});
test("process crash after Production CAS but before signed M5 checkpoint requires manual recovery",async()=>{
  await withScratch(async({vault,opt})=>{
    const owner=fakeServer(v1,{loseResponseAfterCommit:true});
    const filename=path.join(vault,SLUG+".md");
    await writeFile(filename,fmt(v1));
    await pairing(owner,opt);
    const prior=(await load(owner,opt)).fingerprints[0];
    await writeFile(filename,fmt(v2));
    const candidate=(await plan(vault,owner,[prior])).candidates[0];
    await assert.rejects(updateProductionNoteCasOnce({
      branchId:RELEASE_NEON_BRANCH,ownerJwt:jwt,
      candidate,readLocalMarkdown:()=>readFile(filename,"utf8"),
      typedConfirmation:"TEST M8 PRODUCTION CAS "+SLUG+" "+
        candidate.expectedLocalSha.slice(0,12),
      fetcher:owner.fetcher,
    }),/outcome uncertain/);
    assert.equal(owner.posts,1);
    assert.equal(owner.row.content_md,v2.content_md);
    const stillOld=(await load(owner,opt)).fingerprints;
    assert.equal(stillOld[0].sha256,sha(fmt(v1)));
    const next=await plan(vault,owner,stillOld);
    assert.equal(next.candidates[0].choice,"unchanged");
    assert.equal(next.candidates[0].action,"manual-checkpoint-recovery");
    assert.equal(next.autoCandidateCount,0);
    assert.equal(next.manualReviewCount,1);
    assert.equal(owner.posts,1,"no blind retry");
    // A SEPARATE human approval is required even after both current
    // sources agree. The recovery API only appends verified M5 evidence.
    await assert.rejects(manuallyRecoverProductionM8Checkpoint({
      ownerJwt:jwt,slug:SLUG,expectedSha256:sha(fmt(v2)),
      expectedRevision:revision(v2),typedConfirmation:"",
      fetcher:owner.fetcher,options:opt,
    }));
    const repaired=await manuallyRecoverProductionM8Checkpoint({
      ownerJwt:jwt,slug:SLUG,expectedSha256:sha(fmt(v2)),
      expectedRevision:revision(v2),
      typedConfirmation:"RECOVER M8 PRODUCTION "+SLUG+" "+
        sha(fmt(v2)).slice(0,12),
      fetcher:owner.fetcher,options:opt,
    });
    assert.deepEqual(repaired,{
      checkpointRecovered:true,recordCount:2,autoSyncEnabled:false,
    });
    const recovered=await load(owner,opt);
    assert.equal(recovered.fingerprints[0].sha256,sha(fmt(v2)));
    assert.equal(recovered.fingerprints[0].revision,revision(v2));
    const restored=await plan(vault,owner,recovered.fingerprints);
    assert.equal(restored.candidates[0].action,"unchanged");
    assert.equal(restored.manualReviewCount,0);
    assert.equal(owner.posts,1,"recovery never sends POST");
  });
});
