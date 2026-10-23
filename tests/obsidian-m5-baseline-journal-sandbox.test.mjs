import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,readdir,writeFile,rm} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {createDurableSyntheticObsidianWorkspace} from "../lib/obsidian-durable-write-sandbox.ts";

const sha=text=>createHash("sha256").update(text).digest("hex");
async function withScratch(run){
  const box=await createDurableSyntheticObsidianWorkspace();
  assert.equal(path.dirname(box.syntheticWorkspacePath),path.resolve(tmpdir()));
  try{return await run(box);}
  finally{await box.destroyScratch();}
}
const journal=box=>path.join(box.syntheticWorkspacePath,"baseline-journal");

test("M5 approved synthetic upload records a persisted one-note equality checkpoint",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("upl-note","# LOCAL APPROVED\n");
    await box.seedRemote("remote-only","other");
    assert.deepEqual(await box.listConfirmedSyntheticBaselines(),[]);
    const review=await box.preview();
    const approval=review.uploadConsents.find(c=>c.slug==="upl-note");
    assert.ok(approval);
    const receipt=await box.approvedUpload({
      slug:approval.slug,confirmation:approval.confirmation,
    });
    assert.equal(receipt.syntheticOnly,true);
    assert.equal((await box.preview()).plan.decisions.find(x=>x.slug==="upl-note").choice,"unchanged");
    const events=await box.listConfirmedSyntheticBaselines();
    assert.equal(events.length,1);
    assert.equal(events[0].slug,"upl-note");
    assert.equal(events[0].sha256,sha("# LOCAL APPROVED\n"));
    assert.equal(events[0].remoteRevision,"synthetic-r1");
    assert.equal(events[0].action,"approved-upload");
    assert.equal(events[0].syntheticOnly,true);
    assert.equal(events[0].deleteAllowed,false);
    const files=await readdir(journal(box));
    assert.deepEqual(files,[events[0].id+".json"]);
    const raw=await readFile(path.join(journal(box),files[0]),"utf8");
    assert.equal(JSON.parse(raw).sha256,events[0].sha256);
    assert.equal(raw.includes("# LOCAL APPROVED"),false,"journal cannot leak note text");
    await assert.rejects(box.approvedUpload({
      slug:approval.slug,confirmation:approval.confirmation,
    }),/Explicit, unexpired/);
    assert.equal((await box.listConfirmedSyntheticBaselines()).length,1,
      "one-time approval must not append another event");
  });
});

test("M5 approved synthetic download records equality, while later differing restore preserves old baseline",async()=>{
  await withScratch(async box=>{
    await box.setBaseline([{slug:"back-note",sha256:sha("before")}]);
    await box.seedLocal("back-note","before");
    await box.seedRemote("back-note","after");
    const c=(await box.preview()).consents[0];
    const downloaded=await box.approvedDownload({slug:c.slug,confirmation:c.confirmation});
    assert.equal((await box.listConfirmedSyntheticBaselines()).length,1);
    assert.equal((await box.listConfirmedSyntheticBaselines())[0].action,"approved-download");
    const r=await box.prepareRestore(downloaded.backupId);
    const restored=await box.approvedRestore({id:r.id,confirmation:r.confirmation});
    assert.equal(restored.afterSha,sha("before"));
    assert.equal(await box.readLocalForSyntheticTest("back-note"),"before");
    assert.equal(await box.readRemoteForSyntheticTest("back-note"),"after");
    assert.equal((await box.preview()).plan.decisions[0].choice,"review-upload",
      "previous baseline must remain after a divergent restore; clearing it would produce conflict");
    assert.equal((await box.listConfirmedSyntheticBaselines()).length,1,
      "a restore that leaves sides different cannot certify new equality");
  });
});

test("M5 approved restore appends a new checkpoint only when remote also matches",async()=>{
  await withScratch(async box=>{
    await box.setBaseline([{slug:"restore-note",sha256:sha("old")}]);
    await box.seedLocal("restore-note","old");
    await box.seedRemote("restore-note","new");
    const c=(await box.preview()).consents[0];
    const written=await box.approvedDownload({slug:c.slug,confirmation:c.confirmation});
    await box.mutateRemote("restore-note","old");
    const restore=await box.prepareRestore(written.backupId);
    await box.approvedRestore({id:restore.id,confirmation:restore.confirmation});
    const events=await box.listConfirmedSyntheticBaselines();
    assert.equal(events.length,2);
    assert.deepEqual(new Set(events.map(x=>x.action)),
      new Set(["approved-download","approved-restore"]));
    assert.equal(events.find(x=>x.action==="approved-restore").sha256,sha("old"));
    assert.equal((await box.preview()).plan.decisions[0].choice,"unchanged");
  });
});

test("M5 Incoming copy never advances baseline nor writes a checkpoint",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("conflict-note","left");
    await box.seedRemote("conflict-note","right");
    const c=(await box.preview()).incomingConsents[0];
    await box.approvedIncomingDownload({slug:c.slug,confirmation:c.confirmation});
    assert.deepEqual(await box.listConfirmedSyntheticBaselines(),[]);
    assert.deepEqual(await readdir(journal(box)),[]);
    assert.equal((await box.preview()).plan.decisions[0].choice,"conflict");
  });
});

test("M5 stale or wrong approvals never create baseline evidence",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("stale-note","local first");
    await box.seedRemote("stale-note","remote first");
    const p=await box.preview();
    assert.equal(p.uploadConsents.length,0,"unbased conflict offers no upload");
    const c=p.incomingConsents[0];
    await box.mutateRemote("stale-note","remote changed");
    await assert.rejects(box.approvedIncomingDownload({
      slug:c.slug,confirmation:c.confirmation,
    }),/stale/);
    assert.deepEqual(await box.listConfirmedSyntheticBaselines(),[]);
    assert.equal((await box.preview()).plan.decisions[0].choice,"conflict");
  });
});

test("M5 rejects corrupt or redirected scratch journal instead of treating it as empty",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("test-note","content");
    const c=(await box.preview()).uploadConsents[0];
    await box.approvedUpload({slug:c.slug,confirmation:c.confirmation});
    const events=await box.listConfirmedSyntheticBaselines();
    const filename=path.join(journal(box),events[0].id+".json");
    await writeFile(filename,"{not json}");
    await assert.rejects(box.listConfirmedSyntheticBaselines(),/Invalid M5 checkpoint JSON/);
    await rm(journal(box),{recursive:true});
    await writeFile(journal(box),"journal replaced by file");
    await assert.rejects(box.listConfirmedSyntheticBaselines(),/Unsafe scratch directory/);
    assert.equal(await readFile(journal(box),"utf8"),"journal replaced by file");
  });
});
