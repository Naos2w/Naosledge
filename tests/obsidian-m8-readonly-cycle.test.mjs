import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {readObsidianLocalManifest} from "../lib/obsidian-local-manifest.ts";
import {inspectM8ReadOnlyPairing} from "../lib/obsidian-m8-readonly-cycle.ts";
import {RELEASE_NEON_BRANCH} from "../lib/neon/production-release.ts";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";

const A="a".repeat(64),B="b".repeat(64),C="c".repeat(64);
const fp=(slug,sha256,revision)=>({
  slug,sha256,...(revision?{revision}:{}),
});
const remote=(fingerprints,changes={})=>({
  branchId:RELEASE_NEON_BRANCH,numberOfNotes:fingerprints.length,
  fingerprints,fullInventory:true,ownerRlsVerified:true,writeEnabled:false,
  ...changes,
});
const local=(fingerprints,changes={})=>({
  fingerprints,unsupportedMarkdownFiles:0,directoriesNotScanned:0,
  otherFiles:0,autoApplyAllowed:false,...changes,
});
const trust=(changes={})=>({
  initialPairingApproved:false,durableBaselineVerified:false,
  ownerSessionFresh:true,productionSchemaReady:true,...changes,
});
async function withRoot(fn){
  const root=await mkdtemp(path.join(tmpdir(),"naosledge-m8-readonly-pairing-"));
  try{return await fn(root);}finally{await rm(root,{recursive:true,force:true});}
}
const assertInert=p=>{
  assert.equal(p.localWrites,0);
  assert.equal(p.remoteWrites,0);
  assert.equal(p.baselineSaved,false);
  assert.equal(p.watcherStarted,false);
  assert.equal(p.automaticTransfersEnabled,false);
  assert.equal(p.automaticDeletionEnabled,false);
  assert.equal(p.originalLocalFilesModified,false);
};

test("initial Owner-RLS pairing enumerates real OS-temp Markdown without transferring it",async()=>{
  await withRoot(async root=>{
    const content="# local draft\n";
    await writeFile(path.join(root,"local-note.md"),content);
    const files=await readdir(root);
    const before=await readFile(path.join(root,"local-note.md"));
    let readLocalCount=0,remoteCount=0;
    const p=await inspectM8ReadOnlyPairing({
      readLocal:async()=>{readLocalCount++;return readObsidianLocalManifest(root);},
      readRemote:async()=>{remoteCount++;return remote([]);},
      baseline:[],trust:trust(),
    });
    assert.equal(readLocalCount,2);
    assert.equal(remoteCount,1);
    assert.equal(p.mode,"initial-review");
    assert.equal(p.localNoteCount,1);
    assert.equal(p.remoteNoteCount,0);
    assert.equal(p.possibleUnpairedFiles,1);
    assert.deepEqual(p.candidateActions,[{slug:"local-note",action:"pairing-review"}]);
    assertInert(p);
    assert.deepEqual(await readdir(root),files);
    assert.deepEqual(await readFile(path.join(root,"local-note.md")),before);
  });
});

test("matching existing note never auto-enrolls or writes a baseline",async()=>{
  await withRoot(async root=>{
    const note={
      slug:"matched-note",title:"Match",excerpt:"same note",
      category:"test",tags:["safe"],learned_on:"2026-10-29",
      content_md:"# Same\n",
    };
    const text=serializeObsidianMarkdown(note);
    await writeFile(path.join(root,note.slug+".md"),text);
    const sha=createHash("sha256").update(text).digest("hex");
    const r=await inspectM8ReadOnlyPairing({
      readLocal:()=>readObsidianLocalManifest(root),
      readRemote:async()=>remote([fp("matched-note",sha,B)]),
      baseline:[],trust:trust(),
    });
    assert.equal(r.mode,"initial-review");
    assert.equal(r.manualReviewCount,0);
    assert.equal(r.candidateActions[0].action,"unchanged");
    assertInert(r);
  });
});

test("unknown Chinese note filename or nested directory is counted and left unchanged",async()=>{
  await withRoot(async root=>{
    await writeFile(path.join(root,"中文筆記.md"),"do not touch");
    await mkdir(path.join(root,"unknown-folder"));
    const before=await readFile(path.join(root,"中文筆記.md"));
    const res=await inspectM8ReadOnlyPairing({
      readLocal:()=>readObsidianLocalManifest(root),
      readRemote:async()=>remote([]),
      baseline:[],trust:trust(),
    });
    assert.equal(res.localNoteCount,0);
    assert.equal(res.unsupportedMarkdownNames,1);
    assert.equal(res.unscannedDirectories,1);
    assert.equal(res.possibleUnpairedFiles,2);
    assert.equal(res.mode,"initial-review");
    assertInert(res);
    assert.deepEqual(await readFile(path.join(root,"中文筆記.md")),before);
  });
});

test("paired one-sided changes are shown only as NON-executable candidates",async()=>{
  const b=[fp("local-edit",A),fp("remote-edit",A)];
  let localReads=0;
  const res=await inspectM8ReadOnlyPairing({
    readLocal:async()=>{localReads++;return local([
      fp("local-edit",B),fp("remote-edit",A),
    ]);},
    readRemote:async()=>remote([
      fp("local-edit",A,"rev-1"),fp("remote-edit",C,"rev-2"),
    ]),
    baseline:b,
    trust:trust({initialPairingApproved:true,durableBaselineVerified:true}),
  });
  assert.equal(localReads,2);
  assert.equal(res.mode,"ready-to-wire");
  assert.deepEqual(res.candidateActions,[
    {slug:"local-edit",action:"upload-cas"},
    {slug:"remote-edit",action:"download-replace"},
  ]);
  assert.equal(res.manualReviewCount,0);
  assertInert(res);
});

test("Owner session loss pauses paired sync even if local fingerprints look unchanged",async()=>{
  const res=await inspectM8ReadOnlyPairing({
    readLocal:async()=>local([fp("note",A)]),
    readRemote:async()=>remote([fp("note",A,"rev")]),
    baseline:[fp("note",A)],
    trust:trust({
      initialPairingApproved:true,durableBaselineVerified:true,
      ownerSessionFresh:false,
    }),
  });
  assert.equal(res.mode,"paused");
  assert.deepEqual(res.candidateActions,[{slug:"note",action:"blocked"}]);
  assertInert(res);
});

test("a drifted local snapshot during the cloud query rejects the entire comparison",async()=>{
  let calls=0,remoteCalls=0;
  await assert.rejects(inspectM8ReadOnlyPairing({
    readLocal:async()=>{calls++;return local([fp("note",calls===1?A:B)]);},
    readRemote:async()=>{remoteCalls++;return remote([]);},
    baseline:[],trust:trust(),
  }),/sources changed/);
  assert.equal(calls,2);
  assert.equal(remoteCalls,1);
});

test("shared mutable remote metadata cannot change during local recheck",async()=>{
  const live=remote([fp("note",A,"rev-1")]);
  let calls=0;
  await assert.rejects(inspectM8ReadOnlyPairing({
    readLocal:async()=>{
      calls++;
      if(calls===2)live.fingerprints[0].sha256=B;
      return local([]);
    },
    readRemote:async()=>live,
    baseline:[],trust:trust(),
  }),/sources changed/);
});

test("pairing permission change during async inspection invalidates the entire result",async()=>{
  const state=trust();
  let calls=0;
  await assert.rejects(inspectM8ReadOnlyPairing({
    readLocal:async()=>{
      calls++;
      if(calls===2)state.initialPairingApproved=true;
      return local([fp("note",A)]);
    },
    readRemote:async()=>remote([]),
    baseline:[],trust:state,
  }),/sources changed/);
  assert.equal(calls,2);
});

test("invalid baseline or trust blocks before local or remote I/O",async()=>{
  let calls=0;
  const readLocal=async()=>{calls++;return local([]);};
  const readRemote=async()=>{calls++;return remote([]);};
  for(const bad of [
    [fp("bad",A),fp("bad",B)],
    [fp("../bad",A)],
    [{slug:"good",sha256:A,privateBody:"secret"}],
  ]){
    await assert.rejects(inspectM8ReadOnlyPairing({
      readLocal,readRemote,baseline:bad,trust:trust(),
    }));
  }
  await assert.rejects(inspectM8ReadOnlyPairing({
    readLocal,readRemote,baseline:[],trust:{...trust(),privateJwt:"secret"},
  }));
  assert.equal(calls,0);
});

test("invalid/incomplete remote responses do not get represented as an empty library",async()=>{
  for(const changes of [
    {ownerRlsVerified:false},
    {fullInventory:false},
    {numberOfNotes:1},
    {writeEnabled:true},
    {branchId:"br-quiet-sunset-b4xx4pnx"},
  ]){
    await assert.rejects(inspectM8ReadOnlyPairing({
      readLocal:async()=>local([]),
      readRemote:async()=>remote([],changes),
      baseline:[],trust:trust(),
    }),/inventory incomplete/);
  }
  await assert.rejects(inspectM8ReadOnlyPairing({
    readLocal:async()=>local([]),
    readRemote:async()=>{throw Error("PRIVATE_JWT_NOT_TO_LEAK");},
    baseline:[],trust:trust(),
  }),err=>{
    assert.match(err.message,/Owner-RLS inventory unavailable/);
    assert.doesNotMatch(err.message,/PRIVATE_JWT/);
    return true;
  });
});

test("aborted read-only scan never produces a pairing result",async()=>{
  const control=new AbortController();
  await assert.rejects(inspectM8ReadOnlyPairing({
    readLocal:async()=>local([]),
    readRemote:async()=>{control.abort();return remote([]);},
    baseline:[],trust:trust(),signal:control.signal,
  }),/Owner-RLS inventory unavailable/);
});
