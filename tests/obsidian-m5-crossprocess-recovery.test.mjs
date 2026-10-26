import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readdir,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createDurableSyntheticObsidianWorkspace} from "../lib/obsidian-durable-write-sandbox.ts";

const cli=fileURLToPath(new URL("../scripts/obsidian-m5-scratch-recovery.ts",import.meta.url));
const run=(root,snapshot)=>spawnSync(process.execPath,[
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",cli,
  "--synthetic-readonly",root,
],{
  input:JSON.stringify(snapshot),encoding:"utf8",timeout:15000,
});
const snapshot=events=>({
  fullInventory:true,numberOfNotes:events.length,
  fingerprints:events.map(item=>({
    slug:item.slug,sha256:item.sha256,revision:item.remoteRevision,
  })),
});

test("M5 separate Node process reads prior scratch journal without memory or writing",async()=>{
  const box=await createDurableSyntheticObsidianWorkspace();
  try{
    await box.seedLocal("cross-note","# approved synthetic\n");
    const consent=(await box.preview()).uploadConsents[0];
    await box.approvedUpload({slug:consent.slug,confirmation:consent.confirmation});
    await box.seedLocal("unsynced-note","# local-only\n");
    const events=await box.listConfirmedSyntheticBaselines();
    const journal=path.join(box.syntheticWorkspacePath,"baseline-journal");
    const before=await readdir(journal);
    const first=run(box.syntheticWorkspacePath,snapshot(events));
    assert.equal(first.status,0,first.stderr);
    const report=JSON.parse(first.stdout);
    assert.deepEqual(report.notes,[
      {slug:"cross-note",checkpointCount:1,status:"matches-provided-snapshot"},
      {slug:"unsynced-note",checkpointCount:0,status:"missing-journal-evidence"},
    ]);
    assert.equal(report.authenticatedRemoteEvidence,false);
    assert.equal(report.baselineImported,false);
    assert.equal(report.writeAllowed,false);
    assert.equal(report.manualReviewRequired,true);

    await writeFile(path.join(box.syntheticWorkspacePath,"notes","cross-note.md"),"# locally edited\n");
    const afterLocal=run(box.syntheticWorkspacePath,snapshot(events));
    assert.equal(afterLocal.status,0,afterLocal.stderr);
    assert.equal(JSON.parse(afterLocal.stdout).notes[0].status,"changed-local");
    const remoteChanged=snapshot(events);
    remoteChanged.fingerprints[0].revision="synthetic-r2";
    const afterBoth=run(box.syntheticWorkspacePath,remoteChanged);
    assert.equal(afterBoth.status,0,afterBoth.stderr);
    assert.equal(JSON.parse(afterBoth.stdout).notes[0].status,"changed-both");
    assert.deepEqual(await readdir(journal),before,"inspection must never append a checkpoint");
  }finally{await box.destroyScratch();}
});

test("M5 new process refuses incomplete remote evidence and modified persisted receipts",async()=>{
  const box=await createDurableSyntheticObsidianWorkspace();
  try{
    await box.seedLocal("saved-note","synthetic\n");
    const c=(await box.preview()).uploadConsents[0];
    await box.approvedUpload({slug:c.slug,confirmation:c.confirmation});
    const evidence=await box.listConfirmedSyntheticBaselines();
    const invalid=snapshot(evidence);
    invalid.fullInventory=false;
    assert.equal(run(box.syntheticWorkspacePath,invalid).status,1);

    const filename=path.join(box.syntheticWorkspacePath,"baseline-journal",evidence[0].id+".json");
    const original=await readFile(filename,"utf8");
    await writeFile(filename,original.replace('"sha256":','"sha256":"'+"0".repeat(64)+'","sha256":'));
    assert.equal(run(box.syntheticWorkspacePath,snapshot(evidence)).status,1);
    assert.equal(run(path.dirname(box.syntheticWorkspacePath),snapshot(evidence)).status,1);
  }finally{await box.destroyScratch();}
});
