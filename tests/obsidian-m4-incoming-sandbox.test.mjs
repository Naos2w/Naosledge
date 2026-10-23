import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,readdir,writeFile,rm,symlink} from "node:fs/promises";
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
const incoming=box=>path.join(box.syntheticWorkspacePath,"incoming");
const names=box=>readdir(incoming(box));

test("M4 review is inert and remote-only notes require a unique one-use Incoming approval",async()=>{
  await withScratch(async box=>{
    await box.seedRemote("remote-only","# Remote only\n");
    const p=await box.preview();
    assert.equal(p.plan.summary["review-missing-local"],1);
    assert.deepEqual(await names(box),[]);
    assert.equal(p.incomingConsents.length,1);
    const approval=p.incomingConsents[0];
    assert.match(approval.confirmation,/^CONFIRM INCOMING remote-only [0-9a-f-]+$/);
    await assert.rejects(box.approvedIncomingDownload({
      slug:"remote-only",confirmation:"yes",
    }),/Explicit, unexpired/);
    assert.deepEqual(await names(box),[]);
    const result=await box.approvedIncomingDownload({
      slug:"remote-only",confirmation:approval.confirmation,
    });
    assert.equal(result.syntheticOnly,true);
    assert.equal(result.originalUntouched,true);
    assert.equal(result.baselineUnchanged,true);
    assert.equal(result.automaticSyncEnabled,false);
    assert.equal(result.deleteAllowed,false);
    assert.equal(result.sha256,sha("# Remote only\n"));
    assert.match(result.incomingFileName,/^remote-only--[0-9a-f-]{36}\.md$/);
    assert.equal(await readFile(path.join(incoming(box),result.incomingFileName),"utf8"),"# Remote only\n");
    assert.equal(await box.readLocalForSyntheticTest("remote-only"),null);
    await assert.rejects(box.approvedDownload({
      slug:"remote-only",confirmation:p.consents[0].confirmation,
    }),/Explicit, unexpired/,
    "M4 copy must invalidate any older synthetic overwrite permission");
    assert.equal((await box.preview()).plan.summary["review-missing-local"],1,
      "copying into Incoming is not a completed synchronization");
    await assert.rejects(box.approvedIncomingDownload({
      slug:"remote-only",confirmation:approval.confirmation,
    }),/Explicit, unexpired/);
  });
});

test("M4 conflicted edits can keep both in Incoming without replacing the original or baseline",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("conflict-note","# Local edit\n");
    await box.seedRemote("conflict-note","# Remote edit\n");
    const p=await box.preview();
    assert.equal(p.plan.summary.conflict,1);
    assert.deepEqual(p.consents,[],"destructive download must stay unavailable in conflict");
    assert.deepEqual(p.uploadConsents,[]);
    assert.equal(p.incomingConsents[0].choice,"conflict");
    const receipt=await box.approvedIncomingDownload({
      slug:"conflict-note",confirmation:p.incomingConsents[0].confirmation,
    });
    assert.equal(await readFile(path.join(incoming(box),receipt.incomingFileName),"utf8"),"# Remote edit\n");
    assert.equal(await box.readLocalForSyntheticTest("conflict-note"),"# Local edit\n");
    assert.equal(await box.readRemoteForSyntheticTest("conflict-note"),"# Remote edit\n");
    assert.equal((await box.preview()).plan.summary.conflict,1,
      "a retained copy cannot implicitly resolve the conflict or advance baseline");
    assert.deepEqual(await box.listDurableBackups(),[]);
  });
});

test("M4 a one-sided remote edit copies to Incoming but cannot clobber local or advance baseline",async()=>{
  await withScratch(async box=>{
    await box.setBaseline([{slug:"shared-note",sha256:sha("baseline")}]);
    await box.seedLocal("shared-note","baseline");
    await box.seedRemote("shared-note","remote update");
    const p=await box.preview();
    assert.equal(p.plan.summary["review-download"],1);
    const approval=p.incomingConsents[0];
    const first=await box.approvedIncomingDownload({
      slug:approval.slug,confirmation:approval.confirmation,
    });
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),"baseline");
    assert.equal((await box.preview()).plan.summary["review-download"],1);
    const fresh=(await box.preview()).incomingConsents[0];
    const second=await box.approvedIncomingDownload({
      slug:fresh.slug,confirmation:fresh.confirmation,
    });
    assert.notEqual(first.incomingFileName,second.incomingFileName,
      "a fresh copy uses a distinct exclusive filename");
    assert.deepEqual((await names(box)).sort(),
      [first.incomingFileName,second.incomingFileName].sort());
    assert.equal(await readFile(path.join(incoming(box),first.incomingFileName),"utf8"),"remote update");
    assert.deepEqual(await box.listDurableBackups(),[]);
  });
});

test("M4 refuses changed remote revision even if its SHA remains the same",async()=>{
  await withScratch(async box=>{
    await box.seedRemote("version-test","same remote text");
    const p=await box.preview();
    const c=p.incomingConsents[0];
    await box.mutateRemote("version-test","same remote text");
    await assert.rejects(box.approvedIncomingDownload({
      slug:"version-test",confirmation:c.confirmation,
    }),/stale/);
    assert.deepEqual(await names(box),[]);
    await assert.rejects(box.approvedIncomingDownload({
      slug:"version-test",confirmation:c.confirmation,
    }),/Explicit, unexpired/);
  });
});

test("M4 refuses local edits during the confirmation window and leaves no Incoming copy",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("dual-author","from local");
    await box.seedRemote("dual-author","from remote");
    const c=(await box.preview()).incomingConsents[0];
    const filename=path.join(box.syntheticWorkspacePath,"notes","dual-author.md");
    await assert.rejects(box.approvedIncomingDownload({
      slug:"dual-author",confirmation:c.confirmation,
      beforeCommitForSyntheticTest:async()=>{await writeFile(filename,"a third local edit");},
    }),/changed before copy/);
    assert.equal(await box.readLocalForSyntheticTest("dual-author"),"a third local edit");
    assert.deepEqual(await names(box),[]);
    assert.equal((await box.preview()).plan.summary.conflict,1);
  });
});

test("M4 never offers Incoming on upload-only, unchanged or both-removed decisions",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("local-only","local");
    await box.seedLocal("equal-note","equal");
    await box.seedRemote("equal-note","equal");
    await box.setBaseline([{slug:"gone-note",sha256:sha("used to exist")}]);
    const p=await box.preview();
    assert.deepEqual(p.incomingConsents,[]);
    await assert.rejects(box.approvedIncomingDownload({
      slug:"local-only",confirmation:"CONFIRM INCOMING local-only forged",
    }),/Explicit, unexpired/);
    await assert.rejects(box.approvedIncomingDownload({
      slug:"gone-note",confirmation:"CONFIRM INCOMING gone-note forged",
    }),/Explicit, unexpired/);
    assert.deepEqual(await names(box),[]);
    assert.equal(typeof box.deleteIncoming,"undefined");
  });
});

test("M4 rejects expiration and malicious slugs before any filesystem copy",async()=>{
  await withScratch(async box=>{
    await box.seedRemote("valid-note","text");
    const c=(await box.preview()).incomingConsents[0];
    await assert.rejects(box.approvedIncomingDownload({
      slug:"../escape",confirmation:c.confirmation,
    }),/Unsafe synthetic slug/);
    const original=Date.now;
    Date.now=()=>c.expiresAt+1;
    try{
      await assert.rejects(box.approvedIncomingDownload({
        slug:"valid-note",confirmation:c.confirmation,
      }),/Explicit, unexpired/);
    }finally{Date.now=original;}
    assert.deepEqual(await names(box),[]);
  });
});

test("M4 refuses a replaced Incoming directory even without symlink permissions",async()=>{
  await withScratch(async box=>{
    await box.seedRemote("safe-remote","source bytes");
    const c=(await box.preview()).incomingConsents[0];
    await rm(incoming(box),{recursive:true});
    await writeFile(incoming(box),"hostile regular file");
    await assert.rejects(box.approvedIncomingDownload({
      slug:"safe-remote",confirmation:c.confirmation,
    }),/Unsafe scratch directory/);
    assert.equal(await readFile(incoming(box),"utf8"),"hostile regular file");
  });
});

test("M4 refuses redirected Incoming directories (if symlinks are supported)",async t=>{
  await withScratch(async box=>{
    await box.seedRemote("safe-remote","remote text");
    const c=(await box.preview()).incomingConsents[0];
    const incomingDir=incoming(box);
    await rm(incomingDir,{recursive:true});
    try{await symlink(path.join(box.syntheticWorkspacePath,"notes"),incomingDir,"dir");}
    catch(error){
      if(["EPERM","EACCES","ENOSYS","ENOTSUP"].includes(error?.code)){
        t.skip("OS disallows test symlinks");
        return;
      }
      throw error;
    }
    await assert.rejects(box.approvedIncomingDownload({
      slug:"safe-remote",confirmation:c.confirmation,
    }),/Unsafe scratch directory|redirected/);
    await assert.rejects(box.preview(),/Unsafe scratch directory|redirected/);
  });
});
