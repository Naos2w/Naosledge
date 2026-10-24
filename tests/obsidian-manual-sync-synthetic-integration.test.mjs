/**
 * Real Node filesystem scanner + M1 planner, but with a deliberately faked
 * authorized Neon Sandbox RLS inventory. No production paths or endpoints.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,readFile,rm,writeFile,readdir,symlink} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {readObsidianLocalManifest} from "../lib/obsidian-local-manifest.ts";
import {previewManualObsidianSync} from "../lib/obsidian-manual-sync-review.ts";

const hash=s=>createHash("sha256").update(s).digest("hex");
const fp=(slug,text,revision)=>({slug,sha256:hash(text),...(revision?{revision}:{})});
const remote=(fingerprints,overrides={})=>({
  fingerprints,numberOfNotes:fingerprints.length,sandboxOnly:true,
  rlsEnforcedByDataApi:true,writeEnabled:false,fullInventory:true,
  ...overrides,
});
async function withScratch(fn){
  const root=await mkdtemp(path.join(tmpdir(),"naosledge-m1-offline-integration-"));
  try{return await fn(root);}finally{await rm(root,{recursive:true,force:true});}
}

test("real local scanner + mocked authorized Neon inventory produce a manual-only upload/download/conflict preview",async()=>{
  await withScratch(async root=>{
    await writeFile(path.join(root,"local-edited.md"),"local v2");
    await writeFile(path.join(root,"remote-edited.md"),"v1");
    await writeFile(path.join(root,"conflicted.md"),"local v2");
    await writeFile(path.join(root,"first-conflict.md"),"new local");
    const filesBefore=(await readdir(root)).sort();
    const localBodiesBefore=await Promise.all(filesBefore.map(n=>readFile(path.join(root,n),"utf8")));
    let localCalls=0,remoteCalls=0;
    const preview=await previewManualObsidianSync({
      readLocal:async()=>{localCalls++;return readObsidianLocalManifest(root);},
      readRemote:async()=>{remoteCalls++;return remote([
        fp("local-edited","v1","rev-a"),
        fp("remote-edited","remote v2","rev-b"),
        fp("conflicted","remote v2","rev-c"),
        fp("first-conflict","new remote","rev-d"),
      ]);},
      baseline:[fp("local-edited","v1"),fp("remote-edited","v1"),fp("conflicted","v1")],
    });
    assert.equal(localCalls,2,"local inventory is rechecked after the remote GET");
    assert.equal(remoteCalls,1);
    assert.deepEqual(preview.decisions.map(x=>[x.slug,x.choice]),[
      ["conflicted","conflict"],
      ["first-conflict","conflict"],
      ["local-edited","review-upload"],
      ["remote-edited","review-download"],
    ]);
    assert.equal(preview.summary.conflict,2);
    assert.equal(preview.manualReviewCount,4);
    assert.equal(preview.previewStatus,"ready");
    assert.equal(preview.autoApplyAllowed,false);
    assert.equal(preview.baselinePersisted,false);
    assert.ok(preview.decisions.every(x=>x.writeAllowed===false&&x.deleteAllowed===false));
    assert.deepEqual((await readdir(root)).sort(),filesBefore);
    assert.deepEqual(await Promise.all(filesBefore.map(n=>readFile(path.join(root,n),"utf8"))),localBodiesBefore);
  });
});

test("unsupported Chinese filenames and real unscanned directories remain explicit coverage warnings",async()=>{
  await withScratch(async root=>{
    await mkdir(path.join(root,".obsidian"));
    await mkdir(path.join(root,"nested-notes"));
    await writeFile(path.join(root,"中文筆記.md"),"a Chinese synthetic title");
    await writeFile(path.join(root,"safe-note.md"),"safe root-level note");
    await writeFile(path.join(root,"nested-notes","hidden.md"),"not scanned");
    let remoteCalls=0;
    const preview=await previewManualObsidianSync({
      readLocal:()=>readObsidianLocalManifest(root),
      readRemote:async()=>{remoteCalls++;return remote([fp("remote-note","cloud","rev-r")]);},
      baseline:[],
    });
    assert.equal(remoteCalls,1);
    assert.equal(preview.previewStatus,"partial-local-coverage");
    assert.equal(preview.inventory.localSupportedNotes,1);
    assert.equal(preview.inventory.localUnsupportedMarkdown,1);
    assert.equal(preview.inventory.localDirectoriesNotScanned,1);
    assert.equal(preview.inventory.localCoverageNeedsReview,true);
    assert.equal(preview.decisions.find(x=>x.slug==="remote-note").choice,"review-missing-local");
    assert.ok(preview.decisions.every(x=>x.writeAllowed===false));
  });
});

test("failed or partial mock Neon owner-RLS read NEVER becomes empty remote inventory",async()=>{
  await withScratch(async root=>{
    await writeFile(path.join(root,"keep-note.md"),"must not vanish");
    await assert.rejects(previewManualObsidianSync({
      readLocal:()=>readObsidianLocalManifest(root),
      readRemote:async()=>{throw Error("synthetic token secret / 401 unauthorized");},
      baseline:[],
    }),err=>{
      assert.match(err.message,/Neon Sandbox inventory unavailable/);
      assert.doesNotMatch(err.message,/secret|401|unauthorized/i);
      return true;
    });
    await assert.rejects(previewManualObsidianSync({
      readLocal:()=>readObsidianLocalManifest(root),
      readRemote:async()=>remote([],{fullInventory:false}),
      baseline:[],
    }),/Full owner-RLS Neon Sandbox inventory unavailable/);
    assert.equal(await readFile(path.join(root,"keep-note.md"),"utf8"),"must not vanish");
  });
});

test("a read-only matching synthetic snapshot requires no review and leaves files untouched",async()=>{
  await withScratch(async root=>{
    const body="# A synthetic Obsidian note\n\n[[linked-note]]";
    await writeFile(path.join(root,"matching-note.md"),body);
    const preview=await previewManualObsidianSync({
      readLocal:()=>readObsidianLocalManifest(root),
      readRemote:async()=>remote([fp("matching-note",body,"rev-4")]),
      baseline:[],
    });
    assert.equal(preview.summary.unchanged,1);
    assert.equal(preview.manualReviewCount,0);
    assert.equal(preview.inventory.remoteFullInventory,true);
    assert.equal(preview.decisions[0].choice,"unchanged");
    assert.equal(preview.decisions[0].writeAllowed,false);
    assert.equal(await readFile(path.join(root,"matching-note.md"),"utf8"),body);
  });
});


test("real config alone is ready; nested notes and Chinese root names independently warn",async()=>{
  await withScratch(async root=>{
    await mkdir(path.join(root,".obsidian"));
    await writeFile(path.join(root,".obsidian","config.md"),"synthetic config, never scanned");
    const preview=()=>previewManualObsidianSync({
      readLocal:()=>readObsidianLocalManifest(root),
      readRemote:async()=>remote([]),baseline:[],
    });
    const ready=await preview();
    assert.equal(ready.previewStatus,"ready");
    assert.equal(ready.inventory.localCoverageNeedsReview,false);
    assert.equal(ready.inventory.localDirectoriesNotScanned,0);
    assert.deepEqual(ready.decisions,[]);
    await mkdir(path.join(root,"actual-notes"));
    await writeFile(path.join(root,"actual-notes","nested-notes.md"),"synthetic nested note");
    const nested=await preview();
    assert.equal(nested.previewStatus,"partial-local-coverage");
    assert.equal(nested.inventory.localDirectoriesNotScanned,1);
    assert.equal(nested.inventory.localUnsupportedMarkdown,0);
    assert.equal(nested.inventory.localSupportedNotes,0);
    await rm(path.join(root,"actual-notes"),{recursive:true});
    await writeFile(path.join(root,"中文筆記.md"),"synthetic unsupported root note");
    const chinese=await preview();
    assert.equal(chinese.previewStatus,"partial-local-coverage");
    assert.equal(chinese.inventory.localDirectoriesNotScanned,0);
    assert.equal(chinese.inventory.localUnsupportedMarkdown,1);
    assert.equal(chinese.autoApplyAllowed,false);
    assert.equal(chinese.baselinePersisted,false);
    assert.equal(await readFile(path.join(root,"中文筆記.md"),"utf8"),"synthetic unsupported root note");
  });
});

test("linked note folder fails closed before any mock remote inventory read",async t=>{
  await withScratch(async root=>{
    await withScratch(async target=>{
      await writeFile(path.join(target,"hidden-note.md"),"synthetic linked note");
      try{await symlink(target,path.join(root,"nested-notes"),process.platform==="win32"?"junction":"dir");}
      catch(error){
        if(["EPERM","EACCES","ENOSYS"].includes(error?.code)){t.skip("OS disallows directory links");return;}
        throw error;
      }
      let remoteCalls=0;
      await assert.rejects(previewManualObsidianSync({
        readLocal:()=>readObsidianLocalManifest(root),
        readRemote:async()=>{remoteCalls++;return remote([]);},baseline:[],
      }),/Local Obsidian inventory unavailable/);
      assert.equal(remoteCalls,0);
    });
  });
});

test("linked .obsidian fails closed before any mock remote inventory read",async t=>{
  await withScratch(async root=>{
    await withScratch(async target=>{
      await writeFile(path.join(target,"nested-notes.md"),"synthetic linked note");
      try{await symlink(target,path.join(root,".obsidian"),process.platform==="win32"?"junction":"dir");}
      catch(error){
        if(["EPERM","EACCES","ENOSYS"].includes(error?.code)){t.skip("OS disallows directory links");return;}
        throw error;
      }
      let remoteCalls=0;
      await assert.rejects(previewManualObsidianSync({
        readLocal:()=>readObsidianLocalManifest(root),
        readRemote:async()=>{remoteCalls++;return remote([]);},baseline:[],
      }),/Local Obsidian inventory unavailable/);
      assert.equal(remoteCalls,0);
    });
  });
});
