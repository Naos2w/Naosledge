import test from "node:test";
import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {promisify} from "node:util";
import {mkdtemp,readFile,readdir,rm,unlink,writeFile} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {createDurableSyntheticObsidianWorkspace} from "../lib/obsidian-durable-write-sandbox.ts";

const execFileAsync=promisify(execFile);
const writer=fileURLToPath(new URL("../scripts/obsidian-synthetic-interrupted-writer.ts",import.meta.url));
const inspector=fileURLToPath(new URL("../scripts/obsidian-detached-synthetic-recovery.ts",import.meta.url));
const run=(script,...args)=>execFileAsync(process.execPath,[
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",script,...args,
],{timeout:30_000,maxBuffer:8192,windowsHide:true});
const ID=/^naosledge-durable-synthetic-only-[A-Za-z0-9_-]{6,32}$/;

function ownScratchPath(id){
  assert.match(id,ID);
  const root=path.resolve(tmpdir(),id);
  assert.equal(path.dirname(root).toLowerCase(),path.resolve(tmpdir()).toLowerCase());
  return root;
}
async function inspect(id){
  const {stdout,stderr}=await run(inspector,"--inspect-id",id);
  assert.equal(stderr.trim(),"");
  const prefix="NAOSLEDGE_DETACHED_RECOVERY ";
  const lines=stdout.split(/\r?\n/).filter(line=>line.startsWith(prefix));
  assert.equal(lines.length,1);
  assert.ok(!stdout.includes("restart-note"));
  assert.ok(!stdout.includes(path.resolve(tmpdir())));
  return JSON.parse(lines[0].slice(prefix.length));
}

test("interrupted synthetic writer exits; new OS process inventories orphan backups and stale locks without altering evidence",async()=>{
  let id;
  let root;
  try{
    let interruption;
    try{await run(writer);}catch(error){interruption=error;}
    assert.ok(interruption,"fixture intentionally terminates with nonzero code");
    assert.equal(interruption.code,47);
    const prefix="NAOSLEDGE_SYNTHETIC_INTERRUPTED_WRITER ";
    const names=(interruption.stdout??"").split(/\r?\n/)
      .filter(line=>line.startsWith(prefix));
    assert.equal(names.length,1);
    id=names[0].slice(prefix.length);
    root=ownScratchPath(id);
    const backups=path.join(root,"backups");
    const locks=path.join(root,"locks");
    const note=path.join(root,"notes","restart-note.md");
    const before=(await readdir(backups)).sort();
    assert.equal(before.length,3);
    assert.deepEqual(await readdir(locks),["backup-catalog.lock"]);
    assert.equal(await readFile(note,"utf8"),"synthetic-new");

    const report=await inspect(id);
    assert.equal(report.syntheticOnly,true);
    assert.equal(report.readOnly,true);
    assert.equal(report.writerResumed,false);
    assert.equal(report.inspectionComplete,true);
    assert.equal(report.scannedEntries,3);
    assert.equal(report.validPairs,1);
    assert.equal(report.orphanBackups,1);
    assert.equal(report.orphanMetadata,0);
    assert.equal(report.invalidPairs,0);
    assert.equal(report.unexpectedEntries,0);
    assert.equal(report.staleLockEntries,1);
    assert.equal(report.needsManualReview,true);
    assert.deepEqual(await inspect(id),report,
      "second process invocation does not depend on original writer memory");
    assert.deepEqual((await readdir(backups)).sort(),before,
      "the read-only inspector must never auto-heal interrupted backups");
    assert.deepEqual(await readdir(locks),["backup-catalog.lock"]);
    assert.equal(await readFile(note,"utf8"),"synthetic-new");

    // Test-harness-only explicit cleanup of exact orphan/lock, not automatic
    // recovery, and never applied to a live Vault or Production.
    const orphan=before.find(name=>name.endsWith(".bak")&&
      !before.includes(name.slice(0,-4)+".json"));
    assert.ok(orphan);
    await unlink(path.join(backups,orphan));
    await unlink(path.join(locks,"backup-catalog.lock"));
    const clean=await inspect(id);
    assert.equal(clean.validPairs,1);
    assert.equal(clean.orphanBackups,0);
    assert.equal(clean.staleLockEntries,0);
    assert.equal(clean.needsManualReview,false);
    assert.equal(clean.scannedEntries,2);
    assert.equal(await readFile(note,"utf8"),"synthetic-new");
  }finally{
    if(root&&id){
      assert.equal(root,ownScratchPath(id));
      await rm(root,{recursive:true,force:true});
    }
  }
});


test("fresh recovery process fails closed on corrupt metadata and refuses partial over-capacity audit",async()=>{
  const box=await createDurableSyntheticObsidianWorkspace();
  const id=path.basename(box.syntheticWorkspacePath);
  const root=ownScratchPath(id);
  try{
    await box.setBaseline([{
      slug:"retained-note",
      sha256:createHash("sha256").update("synthetic-before").digest("hex"),
    }]);
    await box.seedLocal("retained-note","synthetic-before");
    await box.seedRemote("retained-note","synthetic-after");
    const grant=(await box.preview()).consents.find(c=>c.slug==="retained-note");
    assert.ok(grant);
    const receipt=await box.approvedDownload({
      slug:"retained-note",confirmation:grant.confirmation,
    });
    const dir=path.join(root,"backups");
    const metadata=path.join(dir,receipt.backupId+".json");
    await writeFile(metadata,JSON.stringify({syntheticOnly:true,extra:"unexpected"}));
    const bad=await inspect(id);
    assert.equal(bad.inspectionComplete,true);
    assert.equal(bad.validPairs,0);
    assert.equal(bad.invalidPairs,1);
    assert.equal(bad.needsManualReview,true);
    assert.equal(bad.writerResumed,false);
    assert.equal(await readFile(metadata,"utf8"),
      JSON.stringify({syntheticOnly:true,extra:"unexpected"}));
    assert.equal(await box.readLocalForSyntheticTest("retained-note"),"synthetic-after");

    for(let i=0;i<1025;i++){
      await writeFile(path.join(dir,"unrecognized-"+i+".partial"),"");
    }
    const partial=await inspect(id);
    assert.equal(partial.inspectionComplete,false);
    assert.equal(partial.scannedEntries,1025);
    assert.equal(partial.validPairs,null);
    assert.equal(partial.orphanBackups,null);
    assert.equal(partial.orphanMetadata,null);
    assert.equal(partial.invalidPairs,null);
    assert.equal(partial.unexpectedEntries,null);
    assert.equal(partial.needsManualReview,true);
    assert.equal((await readdir(dir)).length,1027);
    assert.equal(await box.readLocalForSyntheticTest("retained-note"),"synthetic-after");
  }finally{
    await box.destroyScratch();
  }
});

test("detached recovery CLI rejects paths, fake fixtures and extra arguments without reading arbitrary directories",async()=>{
  for(const args of [
    ["--inspect-id","../../Naosledge"],
    ["--inspect-id","C:\\Naos\\Obsidian\\Naosledge"],
    ["--inspect-id","something-else"],
    ["--inspect-id","naosledge-durable-synthetic-only-abcdef","--enable-write"],
  ]){
    await assert.rejects(run(inspector,...args),error=>{
      assert.equal(error.code,2);
      assert.match(error.stderr,/SYNTHETIC_RECOVERY_(?:ARGUMENT_)?REJECTED/);
      assert.ok(!error.stdout?.includes("NAOSLEDGE_DETACHED_RECOVERY"));
      return true;
    });
  }

  const root=await mkdtemp(path.join(tmpdir(),"naosledge-durable-synthetic-only-"));
  const id=path.basename(root);
  try{
    assert.equal(root,ownScratchPath(id));
    await assert.rejects(run(inspector,"--inspect-id",id),error=>{
      assert.equal(error.code,2);
      assert.match(error.stderr,/SYNTHETIC_RECOVERY_REJECTED/);
      return true;
    });
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});
