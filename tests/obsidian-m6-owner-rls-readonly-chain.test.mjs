/**
 * M6 preparation: use the REAL pinned M1 Owner-RLS + inventory GET adapter
 * with simulated HTTP, then feed its result to the M2 intent-only review.
 * This test never contacts Neon, uses a real JWT, or touches an actual Vault.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {tmpdir} from "node:os";
import path from "node:path";
import {createDurableSyntheticObsidianWorkspace} from "../lib/obsidian-durable-write-sandbox.ts";
import {readObsidianLocalManifest} from "../lib/obsidian-local-manifest.ts";
import {previewManualObsidianSync} from "../lib/obsidian-manual-sync-review.ts";
import {chooseReviewIntent,summariseReviewIntents} from "../lib/obsidian-m2-review-choices.ts";
import {
  fetchVerifiedNeonSandboxOwnerFingerprints,
  NEON_SYNC_SANDBOX_BRANCH,NEON_SYNC_SANDBOX_DATA_API,
} from "../lib/obsidian-neon-sandbox-readonly.ts";

const owner="synthetic-owner-m6";
const pretendJwt="header."+Buffer.from(JSON.stringify({sub:owner})).toString("base64url")+".signature";
const asJson=(value,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{
    "content-type":"application/json",
    ...(Array.isArray(value)?{"content-range":value.length?
      `0-${value.length-1}/${value.length}`:"*/0"}:{}),
  },
});
async function withScratch(run){
  const box=await createDurableSyntheticObsidianWorkspace();
  assert.equal(path.dirname(box.syntheticWorkspacePath),path.resolve(tmpdir()));
  try{return await run(box);}
  finally{await box.destroyScratch();}
}
function mockedOwnerHttp({adminRows=[{user_id:owner}],noteResponse=()=>asJson([]),calls=[]}={}){
  const root=new URL(NEON_SYNC_SANDBOX_DATA_API);
  return async(url,request)=>{
    const endpoint=new URL(url);
    assert.equal(endpoint.origin,root.origin,"only the pinned Sandbox hostname");
    assert.equal(request.method,"GET");
    assert.equal(request.redirect,"manual");
    assert.equal(request.credentials,"omit");
    assert.equal(request.body,undefined);
    assert.equal(request.headers.Authorization,"Bearer "+pretendJwt);
    assert.ok(request.signal);
    if(endpoint.pathname==="/neondb/rest/v1/blog_admins"){
      calls.push("owner-grant");
      assert.equal(endpoint.searchParams.get("user_id"),"eq."+owner);
      assert.equal(endpoint.searchParams.get("limit"),"2");
      return asJson(adminRows);
    }
    if(endpoint.pathname==="/neondb/rest/v1/knowledge_notes"){
      calls.push("note-inventory");
      assert.equal(endpoint.searchParams.get("limit"),"21");
      assert.equal(request.headers.Prefer,"count=exact");
      return noteResponse();
    }
    throw Error("Unexpected synthetic URL");
  };
}
async function reviewWithHttp(box,fetcher){
  return previewManualObsidianSync({
    baseline:[],
    readLocal:()=>readObsidianLocalManifest(path.join(box.syntheticWorkspacePath,"notes")),
    readRemote:()=>fetchVerifiedNeonSandboxOwnerFingerprints({
      branchId:NEON_SYNC_SANDBOX_BRANCH,jwt:pretendJwt,fetcher,
    }),
  });
}

test("M6 offline Owner-RLS proof is required before an empty GET can drive non-executable M2 intents",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("local-draft","local author's content");
    const calls=[];
    const preview=await reviewWithHttp(box,mockedOwnerHttp({calls}));
    assert.deepEqual(calls,["owner-grant","note-inventory"]);
    assert.equal(preview.inventory.remoteFullInventory,true);
    assert.equal(preview.previewStatus,"ready");
    assert.equal(preview.decisions.length,1);
    assert.equal(preview.decisions[0].choice,"review-missing-remote");
    const intents=chooseReviewIntent(preview,{},"local-draft","upload");
    assert.equal(summariseReviewIntents(preview,intents).nonExecutable,true);
    assert.equal(await box.readLocalForSyntheticTest("local-draft"),"local author's content");
    assert.equal(await box.readRemoteForSyntheticTest("local-draft"),null);
    assert.deepEqual(await box.listConfirmedSyntheticBaselines(),[]);
  });
});

test("M6 refuses a 200 empty page without proof of the entire Sandbox inventory",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("cannot-infer-delete","still here");
    for(const contentRange of [null,"*/*","*/3"]){
      const calls=[];
      const noteResponse=()=>new Response("[]",{
        status:200,headers:{
          "content-type":"application/json",
          ...(contentRange===null?{}:{"content-range":contentRange}),
        },
      });
      await assert.rejects(reviewWithHttp(box,mockedOwnerHttp({calls,noteResponse})),
        /Full owner-RLS Neon Sandbox inventory unavailable/);
      assert.deepEqual(calls,["owner-grant","note-inventory"]);
      assert.equal(await box.readLocalForSyntheticTest("cannot-infer-delete"),"still here");
      assert.deepEqual(await box.listConfirmedSyntheticBaselines(),[]);
    }
  });
});

test("M6 offline non-Owner 200 + [] must stop BEFORE fetching notes or exposing review choices",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("not-authorized","private local draft");
    for(const adminRows of [[],[{user_id:"somebody-else"}]]){
      const calls=[];
      await assert.rejects(reviewWithHttp(box,mockedOwnerHttp({adminRows,calls})),
        /Full owner-RLS Neon Sandbox inventory unavailable/);
      assert.deepEqual(calls,["owner-grant"]);
    }
    assert.equal(await box.readRemoteForSyntheticTest("not-authorized"),null);
    assert.deepEqual(await box.listConfirmedSyntheticBaselines(),[]);
  });
});

test("M6 offline API/auth/network/partial-body failures never become an empty successful inventory",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("offline-draft","untouched");
    for(const [name,noteResponse] of [
      ["unauthorized",()=>new Response("private-error-body",{status:401})],
      ["server-error",()=>new Response("private-error-body",{status:503})],
      ["partial-body",()=>new Response('[{"private-note":',{status:200,headers:{"content-type":"application/json"}})],
      ["network-error",()=>{throw new TypeError("synthetic connection dropped");}],
    ]){
      const calls=[];
      await assert.rejects(reviewWithHttp(box,mockedOwnerHttp({calls,noteResponse})),error=>{
        assert.ok(error instanceof Error,name);
        assert.doesNotMatch(error.message,/private-error-body|private-note|local author's content/);
        return true;
      },name);
      assert.deepEqual(calls,["owner-grant","note-inventory"],name);
      assert.equal(await box.readLocalForSyntheticTest("offline-draft"),"untouched");
      assert.equal(await box.readRemoteForSyntheticTest("offline-draft"),null);
      assert.deepEqual(await box.listConfirmedSyntheticBaselines(),[]);
    }
  });
});
