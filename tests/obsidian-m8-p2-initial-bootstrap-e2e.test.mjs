import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,rm,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {reviewM8NonEqualInitialPairing}
  from "../lib/obsidian-m8-first-pairing-review.ts";
import {readObsidianLocalManifest}
  from "../lib/obsidian-local-manifest.ts";
import {fetchProductionOwnerRlsFingerprints}
  from "../lib/obsidian-m8-production-inventory-readonly.ts";
import {createProductionNoteOnce}
  from "../lib/obsidian-m8-production-cas-update.ts";
import {adoptProductionM8EqualPairing,inspectProductionM8Baseline}
  from "../lib/obsidian-m8-production-baseline-journal.ts";
import {createM8WindowsReadOnlyAgent}
  from "../lib/obsidian-m8-windows-agent-controller.ts";
import {RELEASE_NEON_BRANCH,RELEASE_DATA_API_URL}
  from "../lib/neon/production-release.ts";
import {serializeObsidianMarkdown}
  from "../lib/obsidian-markdown.ts";

const OWNER="00000000-0000-4000-8000-000000000041";
const ID="00000000-0000-4000-8000-000000000055";
const SLUG="approved-local-synthetic";
const JWT="eyJhbGciOiJIUzI1NiJ9."+
  Buffer.from(JSON.stringify({
    sub:OWNER,exp:Math.floor(Date.now()/1000)+3600,
  })).toString("base64url")+".syntheticsignature";
const SHA=value=>createHash("sha256").update(value).digest("hex");
const note={
  id:ID,slug:SLUG,title:"M8 initial bootstrap",
  summary:"synthetic OS Temp only",
  content_md:"# First pairing test\n\n[[reviewed-link]]",
  category:"test",tags:["p2"],learned_on:"2026-10-29",
  updated_at:"2026-10-29T04:00:00Z",
};
const text=serializeObsidianMarkdown({
  title:note.title,slug:note.slug,excerpt:note.summary,
  content_md:note.content_md,category:note.category,
  tags:note.tags,learned_on:note.learned_on,
});
const reply=(value,range,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{
    "content-type":"application/json",
    ...(range?{"content-range":range}:{})
  },
});
function fakeServer(initial=[]){
  let rows=initial.map(x=>({...x})),links=[],postCount=0;
  let getCount=0;
  const fetcher=async(url,options)=>{
    const uri=new URL(url);
    assert.equal(uri.origin,new URL(RELEASE_DATA_API_URL).origin);
    assert.equal(options.headers.Authorization,"Bearer "+JWT);
    if(options.method==="GET"){
      getCount++;
      if(uri.pathname.endsWith("/blog_admins")){
        assert.equal(uri.searchParams.get("user_id"),"eq."+OWNER);
        return reply([{user_id:OWNER}],"0-0/1");
      }
      if(uri.pathname.endsWith("/knowledge_notes")){
        const filtered=uri.searchParams.has("slug")?
          rows.filter(n=>n.slug==="approved-local-synthetic"):rows;
        const count=filtered.length;
        return reply(filtered,count?"0-"+(count-1)+"/"+count:"*/0");
      }
      if(uri.pathname.endsWith("/knowledge_links")){
        const count=links.length;
        return reply(links.map(target_key=>({target_key})),
          count?"0-"+(count-1)+"/"+count:"*/0");
      }
      throw Error("Unexpected fake Owner GET");
    }
    assert.equal(options.method,"POST");
    assert.ok(uri.pathname.endsWith("/rpc/save_knowledge_note"));
    postCount++;
    const body=JSON.parse(options.body);
    assert.equal(body.p_id,null);
    assert.equal(body.p_slug,SLUG);
    assert.deepEqual(body.p_links,["reviewed-link"]);
    if(rows.some(x=>x.slug===SLUG))
      return reply({code:"23505"},null,409);
    rows=[{id:ID,slug:body.p_slug,title:body.p_title,
      summary:body.p_summary,content_md:body.p_content_md,
      category:body.p_category,tags:body.p_tags,
      learned_on:body.p_learned_on,updated_at:note.updated_at}];
    links=[...body.p_links];
    return reply(ID,null);
  };
  return {fetcher,get postCount(){return postCount},
    get getCount(){return getCount},get rows(){return rows},
    get links(){return links}};
}
const protector={
  seal:async key=>key.toString("base64"),
  unseal:async data=>Buffer.from(data,"base64"),
};
async function scratch(fn){
  const root=await mkdtemp(path.join(tmpdir(),"naosledge-m8-agent-test-"));
  const journal=await mkdtemp(path.join(tmpdir(),
    "naosledge-m8-production-baseline-test-"));
  const options={
    testRoot:journal,testProtector:protector,
    testReadLocal:()=>readObsidianLocalManifest(root),
  };
  try{return await fn({root,journal,options});}
  finally{
    await rm(root,{recursive:true,force:true});
    await rm(journal,{recursive:true,force:true});
  }
}
const snapshot=async(root,server)=>({
  local:await readObsidianLocalManifest(root),
  remote:await fetchProductionOwnerRlsFingerprints({
    branchId:RELEASE_NEON_BRANCH,jwt:JWT,fetcher:server.fetcher,
  }),
});
async function waitFor(predicate,ms=5000){
  const until=Date.now()+ms;
  while(Date.now()<until){
    if(predicate())return;
    await new Promise(resolve=>setTimeout(resolve,30));
  }
  throw Error("P2 initial bootstrap condition not reached");
}

test("initial non-equal local 1/cloud 0 produces explicit single-note human review, no writes",async()=>{
  await scratch(async({root,journal})=>{
    const file=path.join(root,SLUG+".md");
    await writeFile(file,text);
    const pristine=await readFile(file);
    const server=fakeServer([]);
    const review=reviewM8NonEqualInitialPairing(await snapshot(root,server));
    assert.equal(review.mode,"requires-initial-owner-review");
    assert.equal(review.localCount,1);
    assert.equal(review.remoteCount,0);
    assert.equal(review.autoApproveAllowed,false);
    assert.equal(review.noteWrites,0);
    assert.equal(review.baselineCreated,false);
    assert.deepEqual(review.reviewDecisions,[{
      slug:SLUG,disposition:"approve-local-only-create",
      expectedLocalSha:SHA(text),expectedRemoteSha:null,
      expectedRemoteRevision:null,requiresExplicitOwnerApproval:true,
      executable:false,
    }]);
    assert.equal(server.postCount,0);
    assert.deepEqual(await readdir(journal),[]);
    assert.deepEqual(await readFile(file),pristine);
  });
});

test("same-name different Markdown is human conflict; unknown names block onboarding",async()=>{
  const local={
    fingerprints:[{slug:SLUG,sha256:"a".repeat(64)}],
    unsupportedMarkdownFiles:0,otherFiles:0,
    directoriesNotScanned:0,autoApplyAllowed:false,
  };
  const remote={
    branchId:RELEASE_NEON_BRANCH,
    fingerprints:[{slug:SLUG,sha256:"b".repeat(64),
      revision:"c".repeat(64)}],
    numberOfNotes:1,fullInventory:true,
    ownerRlsVerified:true,writeEnabled:false,
  };
  const review=reviewM8NonEqualInitialPairing({local,remote});
  assert.equal(review.reviewDecisions[0].disposition,"manual-name-collision");
  assert.equal(review.noteWrites,0);
  assert.equal(review.autoApproveAllowed,false);
  const blocked=reviewM8NonEqualInitialPairing({
    local:{...local,unsupportedMarkdownFiles:1},
    remote,
  });
  assert.equal(blocked.mode,"blocked");
  assert.equal(blocked.unsupportedNames,1);
  assert.equal(blocked.automaticTransfersEnabled,false);
  const unknownOwner={...remote,ownerRlsVerified:false};
  assert.throws(()=>reviewM8NonEqualInitialPairing({
    local,remote:unknownOwner,
  }),/Owner-RLS inventory/);
});

test("remote-only requires explicit download review, not a local create or deletion",()=>{
  const local={
    fingerprints:[],unsupportedMarkdownFiles:0,otherFiles:0,
    directoriesNotScanned:0,autoApplyAllowed:false,
  };
  const remote={
    branchId:RELEASE_NEON_BRANCH,
    fingerprints:[{slug:SLUG,sha256:"a".repeat(64),revision:"b".repeat(64)}],
    numberOfNotes:1,fullInventory:true,
    ownerRlsVerified:true,writeEnabled:false,
  };
  const r=reviewM8NonEqualInitialPairing({local,remote});
  assert.equal(r.reviewDecisions[0].disposition,"approve-remote-only-download");
  assert.equal(r.reviewDecisions[0].requiresExplicitOwnerApproval,true);
  assert.equal(r.autoApproveAllowed,false);
});

test("synthetic human-approved initial local-only create -> Production Owner GET -> signed M5 pairing -> read-only Agent",async()=>{
  await scratch(async({root,options,journal})=>{
    const filename=path.join(root,SLUG+".md");
    await writeFile(filename,text);
    const server=fakeServer([]);
    const before=reviewM8NonEqualInitialPairing(
      await snapshot(root,server));
    assert.equal(before.reviewDecisions.length,1);
    assert.equal(before.reviewDecisions[0].disposition,
      "approve-local-only-create");
    assert.equal(server.postCount,0);
    const selected=before.reviewDecisions[0];
    const reviewedCandidate={
      slug:selected.slug,choice:"review-missing-remote",
      action:"upload-create",executable:false,
      automaticDeletionAllowed:false,requiresFreshTwoSidedRead:true,
      requiresDurableBackup:false,baselineCommitOnlyAfterVerifiedReadback:true,
      expectedLocalSha:selected.expectedLocalSha,
      expectedRemoteSha:null,expectedRemoteRevision:null,
    };
    // This explicit QA-only phrase is separate from initial M5 adoption.
    await assert.rejects(createProductionNoteOnce({
      branchId:RELEASE_NEON_BRANCH,ownerJwt:JWT,
      candidate:reviewedCandidate,readLocalMarkdown:()=>readFile(filename,"utf8"),
      typedConfirmation:"",fetcher:server.fetcher,
    }));
    assert.equal(server.postCount,0);
    const created=await createProductionNoteOnce({
      branchId:RELEASE_NEON_BRANCH,ownerJwt:JWT,
      candidate:reviewedCandidate,readLocalMarkdown:()=>readFile(filename,"utf8"),
      typedConfirmation:"TEST M8 PRODUCTION CREATE "+SLUG+" "+
        SHA(text).slice(0,12),
      fetcher:server.fetcher,
    });
    assert.equal(server.postCount,1);
    assert.equal(created.verifiedRemoteReadback,true);
    assert.deepEqual(server.links,["reviewed-link"]);
    const after=reviewM8NonEqualInitialPairing(await snapshot(root,server));
    assert.equal(after.reviewDecisions[0].disposition,"approve-equal-note");
    assert.equal(after.baselineCreated,false,
      "a successful create alone is NOT pairing approval");
    assert.deepEqual(await readdir(journal),[],
      "M5 was not initialized during Production create");
    const approved=await adoptProductionM8EqualPairing({
      ownerJwt:JWT,fetcher:server.fetcher,options,
      typedConfirmation:"APPROVE M8 PRODUCTION INITIAL EQUALITY",
    });
    assert.equal(approved.paired,true);
    const reopened=await inspectProductionM8Baseline({
      ownerJwt:JWT,fetcher:server.fetcher,options,
    });
    assert.equal(reopened.recordCount,1);
    assert.equal(reopened.fingerprints[0].sha256,SHA(text));
    assert.equal(reopened.automaticTransfersEnabled,false);
    assert.deepEqual(await readFile(filename,"utf8"),text);

    const agent=createM8WindowsReadOnlyAgent({
      requestFreshJwt:async()=>JWT,
      testOnly:{root,journal:options,fetcher:server.fetcher,
        schemaReady:true},
    });
    await agent.start();
    try{
      await waitFor(()=>agent.status().health==="success");
      assert.equal(agent.status().last.mode,"ready-to-wire");
      assert.equal(agent.status().last.localNotes,1);
      assert.equal(agent.status().last.remoteNotes,1);
      assert.equal(agent.status().automaticTransfersEnabled,false);
      assert.equal(server.postCount,1,
        "the ready-to-wire Agent NEVER resubmits the initial transfer");
    }finally{await agent.stop();}
  });
});

test("initial review module has no write, timer, network or cookie API",async()=>{
  const source=await readFile(new URL(
    "../lib/obsidian-m8-first-pairing-review.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/fetch\(|writeFile\(|rename\(|unlink\(|setInterval\(|\.rpc\(|cookie|localStorage/);
});
