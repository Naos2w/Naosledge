import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {makeSyntheticM2Preview} from "../lib/obsidian-m2-synthetic-fixture.ts";
import {
  chooseReviewIntent,reviewIntentOptions,summariseReviewIntents,
} from "../lib/obsidian-m2-review-choices.ts";

test("M2 fixture uses M1's actual reconciliation engine with all necessary statuses",async()=>{
  const p=await makeSyntheticM2Preview();
  assert.equal(p.sandboxOnly,true);
  assert.equal(p.readOnly,true);
  assert.equal(p.autoApplyAllowed,false);
  assert.equal(p.automaticDeleteEnabled,false);
  assert.equal(p.baselinePersisted,false);
  assert.equal(p.inventory.remoteFullInventory,true);
  assert.deepEqual(p.decisions.map(x=>[x.slug,x.choice]),[
    ["already-synced","unchanged"],
    ["local-new","review-missing-remote"],
    ["nextjs-routing","review-download"],
    ["react-hooks","review-upload"],
    ["remote-new","review-missing-local"],
    ["removed-both","both-removed"],
    ["typescript-notes","conflict"],
  ]);
  assert.equal(p.manualReviewCount,5);
  assert.equal(p.conflicts,1);
  assert.ok(p.decisions.every(x=>!x.writeAllowed&&!x.deleteAllowed));
});

test("directions are constrained by the current M1 decision, conflicts can never overwrite",()=>{
  assert.deepEqual(reviewIntentOptions("review-upload"),["upload","skip"]);
  assert.deepEqual(reviewIntentOptions("review-missing-remote"),["upload","skip"]);
  assert.deepEqual(reviewIntentOptions("review-download"),["download","skip"]);
  assert.deepEqual(reviewIntentOptions("review-missing-local"),["download","skip"]);
  assert.deepEqual(reviewIntentOptions("conflict"),["keep-both","skip"]);
  assert.deepEqual(reviewIntentOptions("unchanged"),[]);
  assert.deepEqual(reviewIntentOptions("both-removed"),[]);
  assert.throws(()=>reviewIntentOptions("DELETE"),/Unknown/);
});

test("human note-by-note selections only update a new in-memory object",async()=>{
  const p=await makeSyntheticM2Preview();
  const before={};
  const local=chooseReviewIntent(p,before,"react-hooks","upload");
  const cloud=chooseReviewIntent(p,local,"nextjs-routing","download");
  const conflicted=chooseReviewIntent(p,cloud,"typescript-notes","keep-both");
  const skipped=chooseReviewIntent(p,conflicted,"remote-new","skip");
  assert.deepEqual(before,{});
  assert.deepEqual(local,{"react-hooks":"upload"});
  assert.equal(cloud["nextjs-routing"],"download");
  assert.equal(conflicted["typescript-notes"],"keep-both");
  assert.deepEqual(summariseReviewIntents(p,skipped),{
    total:7,needsReview:5,selected:4,pending:1,
    upload:1,download:1,keepBoth:1,skipped:1,nonExecutable:true,
  });
  assert.deepEqual(summariseReviewIntents(p,{}),{
    total:7,needsReview:5,selected:0,pending:5,
    upload:0,download:0,keepBoth:0,skipped:0,nonExecutable:true,
  });
});

test("all forbidden directions, unknown slugs and implicit deletions are rejected",async()=>{
  const p=await makeSyntheticM2Preview();
  for(const [slug,direction] of [
    ["typescript-notes","upload"],
    ["typescript-notes","download"],
    ["react-hooks","download"],
    ["nextjs-routing","upload"],
    ["local-new","download"],
    ["remote-new","upload"],
    ["removed-both","upload"],
    ["removed-both","keep-both"],
    ["removed-both","skip"],
    ["already-synced","skip"],
    ["not-a-real-note","skip"],
  ]){
    assert.throws(()=>chooseReviewIntent(p,{},slug,direction),/does not allow/);
  }
  assert.throws(()=>summariseReviewIntents(p,{"removed-both":"skip"}),/does not match/);
  assert.throws(()=>summariseReviewIntents(p,{"fake-note":"upload"}),/does not match/);
  assert.throws(()=>summariseReviewIntents(p,{"react-hooks":"delete"}),/does not match/);
});

test("tampered non-read-only or duplicated M1 previews always fail closed",async()=>{
  const p=await makeSyntheticM2Preview();
  for(const damaged of [
    {...p,readOnly:false},
    {...p,automaticSyncEnabled:true},
    {...p,autoApplyAllowed:true},
    {...p,automaticDeleteEnabled:true},
    {...p,baselinePersisted:true},
    {...p,sandboxOnly:false},
    {...p,decisions:[...p.decisions,p.decisions[0]]},
    {...p,decisions:p.decisions.map(x=>({...x,writeAllowed:true}))},
    {...p,decisions:p.decisions.map(x=>({...x,deleteAllowed:true}))},
  ]){
    assert.throws(()=>chooseReviewIntent(damaged,{},"react-hooks","upload"),
      /read-only|unsafe|duplicate/);
  }
  assert.throws(()=>summariseReviewIntents(p,null),/Invalid/);
});

test("M2 private route requires Vault owner and only passes fixture data, no real readers or transfer API",async()=>{
  const src=await readFile(new URL("../app/vault/sync/page.tsx",import.meta.url),"utf8");
  assert.match(src,/await requireVault\(\)/);
  assert.match(src,/makeSyntheticM2Preview\(\)/);
  assert.match(src,/force-dynamic/);
  assert.match(src,/index:false/);
  assert.doesNotMatch(src,/previewApprovedMsiSandboxSync|fetchNeonSandboxFingerprints|readObsidianLocalManifest|writeFile|fetch\(/);
  const ui=await readFile(new URL("../components/vault-manual-sync-review.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(ui,/localStorage|sessionStorage|fetch\(|navigator\.sendBeacon|onSubmit=|use server|\/api\/|deleteNote|post\(/i);
  assert.match(ui,/合成筆記/);
  assert.match(ui,/目前不會執行同步/);
  assert.match(ui,/這不是同步執行清單/);
});
