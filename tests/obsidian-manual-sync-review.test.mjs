import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {previewManualObsidianSync} from "../lib/obsidian-manual-sync-review.ts";

const sha=text=>createHash("sha256").update(text).digest("hex");
const fp=(slug,body,revision)=>({
  slug,sha256:sha(body),...(revision?{revision}:{}),
});
const local=(fingerprints=[],extra={})=>({
  fingerprints,unsupportedMarkdownFiles:0,otherFiles:0,
  directoriesNotScanned:0,autoApplyAllowed:false,...extra,
});
const remote=(fingerprints=[],extra={})=>({
  fingerprints,numberOfNotes:fingerprints.length,sandboxOnly:true,
  rlsEnforcedByDataApi:true,writeEnabled:false,fullInventory:true,...extra,
});
async function review(l,r,baseline=[]){
  let localCalls=0,remoteCalls=0;
  const output=await previewManualObsidianSync({
    readLocal:async()=>{localCalls++;return l;},
    readRemote:async()=>{remoteCalls++;return r;},
    baseline,
  });
  assert.equal(localCalls,2,"remote inventory must be bracketed by local scans");
  assert.equal(remoteCalls,1);
  return output;
}

test("two editing entrances classify one-sided edits, first-time conflict and missing notes without applying writes",async()=>{
  const base=[
    fp("local-updated","v1"),fp("remote-updated","v1"),
    fp("both-updated","v1"),fp("both-gone","v1"),
  ];
  const onDisk=local([
    fp("local-updated","v2"),
    fp("remote-updated","v1"),
    fp("both-updated","local v2"),
    fp("first-conflict","local"),
    fp("local-only","from Obsidian"),
    fp("unchanged","shared"),
  ]);
  const fromNeon=remote([
    fp("local-updated","v1","rev_1"),
    fp("remote-updated","v2","rev_2"),
    fp("both-updated","remote v2","rev_3"),
    fp("first-conflict","cloud","rev_4"),
    fp("remote-only","from NaosLedge","rev_5"),
    fp("unchanged","shared","rev_6"),
  ]);
  const p=await review(onDisk,fromNeon,base);
  assert.deepEqual(p.decisions.map(d=>[d.slug,d.choice]),[
    ["both-gone","both-removed"],
    ["both-updated","conflict"],
    ["first-conflict","conflict"],
    ["local-only","review-missing-remote"],
    ["local-updated","review-upload"],
    ["remote-only","review-missing-local"],
    ["remote-updated","review-download"],
    ["unchanged","unchanged"],
  ]);
  assert.equal(p.summary.conflict,2);
  assert.equal(p.manualReviewCount,6);
  assert.equal(p.possibleDeletionsNeverApplied,3);
  assert.equal(p.previewStatus,"ready");
  assert.equal(p.inventory.remoteFullInventory,true);
  assert.equal(p.inventory.localSupportedNotes,6);
  assert.equal(p.inventory.remoteNotes,6);
  assert.equal(p.readOnly,true);
  assert.equal(p.sandboxOnly,true);
  assert.equal(p.manualTriggerOnly,true);
  assert.equal(p.automaticDeleteEnabled,false);
  assert.equal(p.automaticSyncEnabled,false);
  assert.equal(p.autoApplyAllowed,false);
  assert.equal(p.baselinePersisted,false);
  assert.ok(p.decisions.every(x=>x.writeAllowed===false&&x.deleteAllowed===false));
  assert.equal(p.decisions.find(x=>x.slug==="remote-updated").expectedRemoteRevision,"rev_2");
  assert.equal(p.decisions.find(x=>x.slug==="both-gone").perNoteConfirmationRequired,false);
});

test("no baseline means same SHA unchanged, divergent same slug conflict, never infer newest timestamp",async()=>{
  const p=await review(
    local([fp("first-same","same"),fp("first-different","older")]),
    remote([fp("first-same","same","rev-x"),fp("first-different","newer","rev-y")]),
  );
  assert.deepEqual(p.decisions.map(x=>[x.slug,x.choice]),[
    ["first-different","conflict"],["first-same","unchanged"],
  ]);
  assert.equal(p.manualReviewCount,1);
  assert.equal(p.decisions[0].deleteAllowed,false);
});

test("a valid authenticated empty remote inventory is not confused with remote outage",async()=>{
  const p=await review(local([fp("local-only","note")]),remote([]));
  assert.equal(p.decisions[0].choice,"review-missing-remote");
  assert.equal(p.inventory.remoteNotes,0);
  assert.equal(p.inventory.remoteFullInventory,true);
  assert.equal(p.decisions[0].writeAllowed,false);
});

test("partial/unauthenticated/oversized remote inventories stop before any decision or delete",async()=>{
  const bad=[
    remote([],{fullInventory:false}),
    remote([],{rlsEnforcedByDataApi:false}),
    remote([],{sandboxOnly:false}),
    remote([],{writeEnabled:true}),
    remote([],{numberOfNotes:1}),
    remote(Array.from({length:21},(_,i)=>fp(`note-${i}`,"text"))),
    {...remote([]),content_md:"secret"},
    null,
    [],
  ];
  for(const snapshot of bad){
    await assert.rejects(previewManualObsidianSync({
      readLocal:async()=>local([fp("local-only","content")]),
      readRemote:async()=>snapshot,
      baseline:[],
    }),err=>{
      assert.match(err.message,/Full owner-RLS Neon Sandbox inventory unavailable/);
      assert.doesNotMatch(err.message,/secret|content|password|jwt/i);
      return true;
    });
  }
});

test("remote GET reader failure is redacted, never treated as empty remote",async()=>{
  let remoteCalls=0;
  await assert.rejects(previewManualObsidianSync({
    readLocal:async()=>local([fp("local-only","content")]),
    readRemote:async()=>{remoteCalls++;throw Error("Bearer JWT secret: VeryPrivateMarkdownBody");},
    baseline:[],
  }),err=>{
    assert.match(err.message,/Sandbox inventory unavailable/);
    assert.doesNotMatch(err.message,/Bearer|VeryPrivate|JWT secret/);
    return true;
  });
  assert.equal(remoteCalls,1);
});

test("bad local snapshot prevents even starting remote read",async()=>{
  let remoteCalls=0;
  for(const localValue of [
    local([],{autoApplyAllowed:true}),local([],{unsupportedMarkdownFiles:-1}),
    local([],{directoriesNotScanned:1.5}),
    {...local([]),path:"C:\\Private"},
    null,
  ]){
    await assert.rejects(previewManualObsidianSync({
      readLocal:async()=>localValue,
      readRemote:async()=>{remoteCalls++;return remote([]);},
      baseline:[],
    }),/Local Obsidian inventory unavailable/);
  }
  assert.equal(remoteCalls,0);
});

test("unsupported Chinese filenames and unscanned directories are surfaced as partial coverage, not silently synced",async()=>{
  const p=await review(
    local([fp("supported-note","v1")],{
      unsupportedMarkdownFiles:2,otherFiles:3,directoriesNotScanned:1,
    }),
    remote([fp("cloud-note","v2","rev_A")]),
  );
  assert.equal(p.previewStatus,"partial-local-coverage");
  assert.equal(p.inventory.localCoverageNeedsReview,true);
  assert.equal(p.inventory.localUnsupportedMarkdown,2);
  assert.equal(p.inventory.localDirectoriesNotScanned,1);
  assert.equal(p.inventory.localOtherFiles,3);
  assert.equal(p.decisions.find(x=>x.slug==="cloud-note").choice,"review-missing-local");
  assert.ok(p.decisions.every(x=>x.writeAllowed===false));
});

test("duplicate, malformed or untrusted fingerprints and baseline refuse preview",async()=>{
  const localNotes=local([fp("valid-note","v1")]);
  const cases=[
    {l:local([{...fp("valid-note","v1"),content_md:"private"}]),r:remote([]),b:[]},
    {l:local([fp("valid-note","v1"),fp("valid-note","v2")]),r:remote([]),b:[]},
    {l:localNotes,r:remote([{...fp("remote-note","x"),owner_id:"account"}]),b:[]},
    {l:localNotes,r:remote([]),b:[{...fp("base-note","old"),path:"../../bad"}]},
    {l:localNotes,r:remote([]),b:[{slug:"invalid-hash",sha256:"not-sha"}]},
    {l:localNotes,r:remote([]),b:[fp("unsafe/path","v1")]},
  ];
  for(const c of cases){
    await assert.rejects(previewManualObsidianSync({
      readLocal:async()=>c.l,readRemote:async()=>c.r,baseline:c.b,
    }),/unsafe|malformed|Local Obsidian inventory unavailable/);
  }
});

test("invalid baseline is refused before any local or remote I/O",async()=>{
  let localCalls=0,remoteCalls=0;
  await assert.rejects(previewManualObsidianSync({
    readLocal:async()=>{localCalls++;return local([]);},
    readRemote:async()=>{remoteCalls++;return remote([]);},
    baseline:[{slug:"bad/slug",sha256:sha("version")}],
  }),/unsafe|malformed/);
  assert.equal(localCalls,0);
  assert.equal(remoteCalls,0);
});

test("no reader, implicit baseline, or unexpected input shape can start M1",async()=>{
  await assert.rejects(previewManualObsidianSync(),/Explicit readers/);
  await assert.rejects(previewManualObsidianSync({
    readLocal:async()=>local([]),readRemote:async()=>remote([]),
  }),/Explicit readers/);
  await assert.rejects(previewManualObsidianSync({
    readLocal:null,readRemote:async()=>remote([]),baseline:[],
  }),/Explicit readers/);
});

test("baseline changed during either asynchronous reader cannot redirect a review",async()=>{
  for(const stage of ["local","remote"]){
    const baseline=[fp("shared-note","original")];
    let remoteCalls=0;
    const options={
      baseline,
      readLocal:async()=>{
        if(stage==="local")baseline[0].sha256=sha("secretly-changed");
        return local([fp("shared-note","local-edit")]);
      },
      readRemote:async()=>{
        remoteCalls++;
        if(stage==="remote")baseline[0].sha256=sha("secretly-changed");
        return remote([fp("shared-note","original","r1")]);
      },
    };
    await assert.rejects(previewManualObsidianSync(options),
      /Sync baseline changed during preview/);
    assert.equal(remoteCalls,stage==="local"?0:1);
  }
});

test("shared mutable local manifest cannot hide an edit during Owner-RLS GET",async()=>{
  const manifest=local([fp("shared-note","before")]);
  let reads=0;
  await assert.rejects(previewManualObsidianSync({
    baseline:[],
    readLocal:async()=>{reads++;return manifest;},
    readRemote:async()=>{
      // A cached provider returns the same reference at both read points.
      manifest.fingerprints[0].sha256=sha("after");
      return remote([fp("shared-note","remote","r1")]);
    },
  }),/Local Obsidian inventory changed during remote read/);
  assert.equal(reads,2);
});

test("malformed local fingerprints never trigger a remote Owner-RLS GET",async()=>{
  let remoteCalls=0;
  await assert.rejects(previewManualObsidianSync({
    baseline:[],
    readLocal:async()=>local([{...fp("safe-note","data"),content_md:"PRIVATE"}]),
    readRemote:async()=>{remoteCalls++;return remote([]);},
  }),/Local Obsidian inventory unavailable/);
  assert.equal(remoteCalls,0);
});

test("preview never mutates baseline, local or remote inputs and returns no raw Markdown / credentials",async()=>{
  const baseline=[fp("same-note","old")];
  const l=local([fp("same-note","updated")]);
  const r=remote([fp("same-note","old","r1")]);
  const before=JSON.stringify({baseline,l,r});
  const p=await review(l,r,baseline);
  assert.equal(JSON.stringify({baseline,l,r}),before);
  const text=JSON.stringify(p);
  assert.doesNotMatch(text,/content_md|Bearer|JWT|owner_id|password|PRIVATE_SECRET_BODY/i);
  assert.equal(p.decisions[0].choice,"review-upload");
  p.summary.unchanged=999;
  assert.equal(baseline.length,1);
  assert.equal(l.fingerprints.length,1);
  assert.equal(r.fingerprints.length,1);
});
