/**
 * M6-prep: cross-stage, synthetic-only safety regressions.
 * Every file lives under a fresh random OS TEMP workspace; all remote notes
 * are an in-memory Map. These are NOT Neon Owner-RLS, MSI Vault, or true E2E.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {mkdir,readdir,readFile,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {createDurableSyntheticObsidianWorkspace} from "../lib/obsidian-durable-write-sandbox.ts";
import {readObsidianLocalManifest} from "../lib/obsidian-local-manifest.ts";
import {previewManualObsidianSync} from "../lib/obsidian-manual-sync-review.ts";
import {chooseReviewIntent,summariseReviewIntents} from "../lib/obsidian-m2-review-choices.ts";

async function withScratch(run){
  const box=await createDurableSyntheticObsidianWorkspace();
  assert.equal(path.dirname(box.syntheticWorkspacePath),path.resolve(tmpdir()));
  try{return await run(box);}
  finally{await box.destroyScratch();}
}
const scratchNotes=box=>path.join(box.syntheticWorkspacePath,"notes");
const scratchIncoming=box=>path.join(box.syntheticWorkspacePath,"incoming");

/**
 * Adapter for tests only: models a complete remote fingerprint response from
 * the scratch planner. No Auth tokens, Neon GET, or real MSI path is involved.
 */
async function syntheticReadOnlyReview(box){
  const staged=await box.preview();
  const remote=staged.plan.decisions.filter(row=>row.expectedRemoteSha!==null)
    .map(row=>({
      slug:row.slug,
      sha256:row.expectedRemoteSha,
      revision:row.expectedRemoteRevision,
    }));
  const preview=await previewManualObsidianSync({
    baseline:[],
    readLocal:()=>readObsidianLocalManifest(scratchNotes(box)),
    readRemote:async()=>({
      fingerprints:remote,numberOfNotes:remote.length,
      sandboxOnly:true,rlsEnforcedByDataApi:true,
      writeEnabled:false,fullInventory:true,
    }),
  });
  assert.deepEqual(
    preview.decisions.map(row=>[row.slug,row.choice]),
    staged.plan.decisions.map(row=>[row.slug,row.choice]),
  );
  return {staged,preview};
}

test("M6 synthetic cross-stage: M1 + M2 intents do not execute; M3 uploads, M4 Incoming keeps both, M5 journals only equality",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("local-only","# Local author\n");
    await box.seedRemote("remote-only","# Remote author\n");
    await box.seedLocal("shared-conflict","local independent edit");
    await box.seedRemote("shared-conflict","remote independent edit");

    const {staged,preview}=await syntheticReadOnlyReview(box);
    assert.equal(preview.manualReviewCount,3);
    assert.equal(preview.summary.conflict,1);
    assert.equal(preview.readOnly,true);
    assert.equal(preview.inventory.remoteFullInventory,true);

    let intents={};
    intents=chooseReviewIntent(preview,intents,"local-only","upload");
    intents=chooseReviewIntent(preview,intents,"remote-only","download");
    intents=chooseReviewIntent(preview,intents,"shared-conflict","keep-both");
    assert.deepEqual(summariseReviewIntents(preview,intents),{
      total:3,needsReview:3,selected:3,pending:0,
      upload:1,download:1,keepBoth:1,skipped:0,nonExecutable:true,
    });
    assert.equal(await box.readRemoteForSyntheticTest("local-only"),null,
      "choosing in M2 is never transfer approval");
    assert.deepEqual(await readdir(scratchIncoming(box)),[]);
    assert.deepEqual(await box.listConfirmedSyntheticBaselines(),[]);
    assert.equal(typeof box.deleteNote,"undefined");

    const upload=staged.uploadConsents.find(row=>row.slug==="local-only");
    assert.ok(upload);
    await box.approvedUpload({slug:upload.slug,confirmation:upload.confirmation});
    assert.equal(await box.readRemoteForSyntheticTest("local-only"),"# Local author\n");

    // Each approved operation invalidates older one-time consents. Review
    // again before starting the next note; never replay a previous token.
    const remoteReview=await box.preview();
    const download=remoteReview.incomingConsents.find(row=>row.slug==="remote-only");
    assert.ok(download);
    const incoming=await box.approvedIncomingDownload({
      slug:download.slug,confirmation:download.confirmation,
    });
    assert.equal(incoming.originalUntouched,true);
    assert.equal(incoming.baselineUnchanged,true);
    assert.equal(await box.readLocalForSyntheticTest("remote-only"),null);
    assert.equal(await readFile(path.join(scratchIncoming(box),incoming.incomingFileName),"utf8"),
      "# Remote author\n");

    const conflictReview=await box.preview();
    const keepBoth=conflictReview.incomingConsents.find(row=>row.slug==="shared-conflict");
    assert.ok(keepBoth);
    assert.equal(keepBoth.choice,"conflict");
    const pair=await box.approvedIncomingDownload({
      slug:keepBoth.slug,confirmation:keepBoth.confirmation,
    });
    assert.notEqual(pair.incomingFileName,incoming.incomingFileName);
    assert.equal(await box.readLocalForSyntheticTest("shared-conflict"),"local independent edit");
    assert.equal(await box.readRemoteForSyntheticTest("shared-conflict"),"remote independent edit");
    assert.equal(await readFile(path.join(scratchIncoming(box),pair.incomingFileName),"utf8"),
      "remote independent edit");

    const checkpoints=await box.listConfirmedSyntheticBaselines();
    assert.equal(checkpoints.length,1,"Incoming and conflict copies are NOT successful sync");
    assert.equal(checkpoints[0].slug,"local-only");
    const inspection=await box.inspectSyntheticBaselineReload();
    assert.equal(inspection.notes.length,1);
    assert.equal(inspection.notes[0].status,"matches-current-pair");
    assert.equal(inspection.autoImportAllowed,false);
    assert.equal(inspection.deleteAllowed,false);
    const final=await box.preview();
    assert.equal(final.plan.summary.conflict,1,"conflicting originals remain unresolved");
    assert.equal(final.plan.summary["review-missing-local"],1);
  });
});

test("M6 synthetic cross-stage: stale remote upload and local Incoming edit fail closed without false checkpoints",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("raced-upload","user-written v1");
    const toUpload=(await box.preview()).uploadConsents[0];
    await assert.rejects(box.approvedUpload({
      slug:toUpload.slug,confirmation:toUpload.confirmation,
      beforeCommitForSyntheticTest:async()=>{
        await box.seedRemote("raced-upload","remote concurrent edit");
      },
    }),/changed before upload commit|stale/);
    assert.equal(await box.readLocalForSyntheticTest("raced-upload"),"user-written v1");
    assert.equal(await box.readRemoteForSyntheticTest("raced-upload"),"remote concurrent edit");
    assert.deepEqual(await box.listConfirmedSyntheticBaselines(),[]);

    await box.seedRemote("raced-incoming","cloud v1");
    await box.seedLocal("raced-incoming","original user draft");
    const c=(await box.preview()).incomingConsents.find(row=>row.slug==="raced-incoming");
    assert.ok(c);
    await assert.rejects(box.approvedIncomingDownload({
      slug:c.slug,confirmation:c.confirmation,
      beforeCommitForSyntheticTest:async()=>{
        await writeFile(path.join(scratchNotes(box),"raced-incoming.md"),"new human edit");
      },
    }),/changed before copy|stale/);
    assert.equal(await box.readLocalForSyntheticTest("raced-incoming"),"new human edit");
    assert.equal(await box.readRemoteForSyntheticTest("raced-incoming"),"cloud v1");
    assert.deepEqual(await readdir(scratchIncoming(box)),[]);
    assert.deepEqual(await box.listConfirmedSyntheticBaselines(),[]);
  });
});

test("M6 synthetic cross-stage: uncovered nested notes remain visible to M1/M2 and block scratch execution",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("top-level","visible note");
    const nested=path.join(scratchNotes(box),"nested-notes");
    await mkdir(nested);
    await writeFile(path.join(nested,"hidden.md"),"not included in shallow manifest");
    const manifest=await readObsidianLocalManifest(scratchNotes(box));
    assert.equal(manifest.fingerprints.length,1);
    assert.equal(manifest.directoriesNotScanned,1);
    const preview=await previewManualObsidianSync({
      baseline:[],readLocal:async()=>manifest,
      readRemote:async()=>({
        fingerprints:[],numberOfNotes:0,sandboxOnly:true,
        rlsEnforcedByDataApi:true,writeEnabled:false,fullInventory:true,
      }),
    });
    assert.equal(preview.previewStatus,"partial-local-coverage");
    assert.equal(preview.inventory.localCoverageNeedsReview,true);
    assert.equal(preview.inventory.localDirectoriesNotScanned,1);
    assert.equal(summariseReviewIntents(preview,{}).pending,1);
    await assert.rejects(box.preview(),/unrecognized files or directories/);
    assert.equal(await box.readLocalForSyntheticTest("top-level"),"visible note");
    assert.deepEqual(await box.listConfirmedSyntheticBaselines(),[]);
  });
});

test("M6 synthetic cross-stage: incomplete remote inventory blocks review before any approvals",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("local-safe","local content");
    await assert.rejects(previewManualObsidianSync({
      baseline:[],
      readLocal:()=>readObsidianLocalManifest(scratchNotes(box)),
      readRemote:async()=>({
        fingerprints:[],numberOfNotes:0,sandboxOnly:true,
        rlsEnforcedByDataApi:true,writeEnabled:false,fullInventory:false,
      }),
    }),/Full owner-RLS Neon Sandbox inventory unavailable/);
    assert.equal(await box.readRemoteForSyntheticTest("local-safe"),null);
    assert.deepEqual(await box.listConfirmedSyntheticBaselines(),[]);
  });
});
