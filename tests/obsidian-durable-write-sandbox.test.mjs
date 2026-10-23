import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {lstat,readFile,writeFile,rm,open,access,symlink,link} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {createDurableSyntheticObsidianWorkspace} from "../lib/obsidian-durable-write-sandbox.ts";

const sha=text=>createHash("sha256").update(text).digest("hex");

async function withScratch(fn){
  const box=await createDurableSyntheticObsidianWorkspace();
  assert.equal(path.dirname(box.syntheticWorkspacePath),path.resolve(tmpdir()));
  assert.match(path.basename(box.syntheticWorkspacePath),/^naosledge-durable-synthetic-only-/);
  try {return await fn(box);}
  finally {await box.destroyScratch();}
}
const find=(preview,slug)=>preview.consents.find(c=>c.slug===slug);
async function sampleUpdate(box){
  await box.setBaseline([{slug:"shared-note",sha256:sha("old contents")}]);
  await box.seedLocal("shared-note","old contents");
  await box.seedRemote("shared-note","new remote contents");
  const preview=await box.preview();
  assert.equal(preview.plan.decisions[0].choice,"review-download");
  return find(preview,"shared-note");
}

test("inert scratch preview never writes any note or backup",async()=>{
  await withScratch(async box=>{
    const preview=await box.preview();
    assert.deepEqual(preview.plan.decisions,[]);
    assert.equal(preview.plan.autoApplyAllowed,false);
    assert.equal(preview.consents.length,0);
    assert.deepEqual(await box.listDurableBackups(),[]);
    assert.equal(await box.readLocalForSyntheticTest("nothing-there"),null);
    assert.equal(typeof box.deleteNote,"undefined");
    assert.equal(typeof box.schedule,"undefined");
  });
});

test("every synthetic overwrite requires a fresh per-note random confirmation",async()=>{
  await withScratch(async box=>{
    const c=await sampleUpdate(box);
    assert.match(c.confirmation,/^CONFIRM DOWNLOAD shared-note [0-9a-f-]+$/);
    await assert.rejects(box.approvedDownload({
      slug:"shared-note",confirmation:"yes",
    }),/Explicit, unexpired/);
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),"old contents");
    assert.deepEqual(await box.listDurableBackups(),[]);
    const result=await box.approvedDownload({
      slug:"shared-note",confirmation:c.confirmation,
    });
    assert.equal(result.syntheticOnly,true);
    assert.equal(result.automaticSyncEnabled,false);
    assert.equal(result.beforeSha,sha("old contents"));
    assert.equal(result.afterSha,sha("new remote contents"));
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),"new remote contents");
    assert.ok(result.backupId);
    await assert.rejects(box.approvedDownload({
      slug:"shared-note",confirmation:c.confirmation,
    }),/Explicit, unexpired/);
  });
});

test("new local synthetic file uses no-clobber create and no unnecessary backup",async()=>{
  await withScratch(async box=>{
    await box.seedRemote("first-download","synthetic-only");
    const p=await box.preview();
    assert.equal(p.plan.summary["review-missing-local"],1);
    const c=find(p,"first-download");
    const result=await box.approvedDownload({
      slug:"first-download",confirmation:c.confirmation,
    });
    assert.equal(result.backupId,null);
    assert.equal(await box.readLocalForSyntheticTest("first-download"),"synthetic-only");
    assert.deepEqual(await box.listDurableBackups(),[]);
  });
});

test("backups contain exact previous content and independent fsynced receipt",async()=>{
  await withScratch(async box=>{
    const c=await sampleUpdate(box);
    const r=await box.approvedDownload({
      slug:"shared-note",confirmation:c.confirmation,
    });
    const backing=await box.listDurableBackups();
    assert.equal(backing.length,1);
    assert.equal(backing[0].id,r.backupId);
    assert.equal(backing[0].beforeSha,sha("old contents"));
    assert.equal(backing[0].afterSha,sha("new remote contents"));
    assert.equal(backing[0].syntheticOnly,true);
    assert.equal(await box.readBackupForSyntheticTest(r.backupId),"old contents");
    // The backup is a real file, not a temporary variable in process RAM.
    const bpath=path.join(box.syntheticWorkspacePath,"backups",r.backupId+".bak");
    const meta=path.join(box.syntheticWorkspacePath,"backups",r.backupId+".json");
    assert.equal((await readFile(bpath,"utf8")),"old contents");
    assert.equal(JSON.parse(await readFile(meta,"utf8")).id,r.backupId);
  });
});

test("restore also requires independent fresh human confirmation and is itself backed up",async()=>{
  await withScratch(async box=>{
    const c=await sampleUpdate(box);
    const r=await box.approvedDownload({slug:"shared-note",confirmation:c.confirmation});
    const restore=await box.prepareRestore(r.backupId);
    await assert.rejects(box.approvedRestore({
      id:r.backupId,confirmation:"yes",
    }),/Fresh manual restore approval/);
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),"new remote contents");
    const back=await box.approvedRestore({
      id:r.backupId,confirmation:restore.confirmation,
    });
    assert.equal(back.afterSha,sha("old contents"));
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),"old contents");
    assert.equal(await box.readBackupForSyntheticTest(back.backupId),"new remote contents");
    assert.equal((await box.listDurableBackups()).length,2);
    await assert.rejects(box.approvedRestore({
      id:r.backupId,confirmation:restore.confirmation,
    }),/Fresh manual restore approval/);
  });
});

test("user-modified local note after preview is protected from stale download",async()=>{
  await withScratch(async box=>{
    const c=await sampleUpdate(box);
    const n=path.join(box.syntheticWorkspacePath,"notes","shared-note.md");
    await writeFile(n,"local user changed it");
    await assert.rejects(box.approvedDownload({
      slug:"shared-note",confirmation:c.confirmation,
    }),/Preview is stale/);
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),"local user changed it");
    assert.deepEqual(await box.listDurableBackups(),[]);
  });
});

test("modified remote after preview rejects download and preserves local note",async()=>{
  await withScratch(async box=>{
    const c=await sampleUpdate(box);
    await box.mutateRemote("shared-note","remote newer revision");
    await assert.rejects(box.approvedDownload({
      slug:"shared-note",confirmation:c.confirmation,
    }),/Preview is stale/);
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),"old contents");
    assert.deepEqual(await box.listDurableBackups(),[]);
  });
});

test("local change immediately before commit leaves persisted backup and refuses clobber",async()=>{
  await withScratch(async box=>{
    const c=await sampleUpdate(box);
    const p=path.join(box.syntheticWorkspacePath,"notes","shared-note.md");
    await assert.rejects(box.approvedDownload({
      slug:"shared-note",confirmation:c.confirmation,
      beforeCommitForSyntheticTest:async()=>{await writeFile(p,"new edit during commit");},
    }),/changed after backup/);
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),"new edit during commit");
    const backups=await box.listDurableBackups();
    assert.equal(backups.length,1,"pre-commit backup survives failed operation");
    assert.equal(await box.readBackupForSyntheticTest(backups[0].id),"old contents");
  });
});

test("remote change immediately before commit refuses previous approval",async()=>{
  await withScratch(async box=>{
    const c=await sampleUpdate(box);
    await assert.rejects(box.approvedDownload({
      slug:"shared-note",confirmation:c.confirmation,
      beforeCommitForSyntheticTest:async()=>{
        await box.mutateRemote("shared-note","someone changed remote");
      },
    }),/remote changed since per-note approval/);
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),"old contents");
    assert.equal((await box.listDurableBackups()).length,1);
  });
});

test("a new file appearing after preview cannot be overwritten (exclusive create)",async()=>{
  await withScratch(async box=>{
    await box.seedRemote("new-note","remote content");
    const c=find(await box.preview(),"new-note");
    const n=path.join(box.syntheticWorkspacePath,"notes","new-note.md");
    await assert.rejects(box.approvedDownload({
      slug:"new-note",confirmation:c.confirmation,
      beforeCommitForSyntheticTest:async()=>{await writeFile(n,"someone newly created it");},
    }),/EEXIST/);
    assert.equal(await box.readLocalForSyntheticTest("new-note"),"someone newly created it");
    assert.deepEqual(await box.listDurableBackups(),[]);
  });
});

test("missing common baseline and divergent same-name note never produce approvals",async()=>{
  await withScratch(async box=>{
    await box.seedRemote("conflict-note","new from remote");
    await box.seedLocal("conflict-note","different local");
    const p=await box.preview();
    assert.equal(p.plan.summary.conflict,1);
    assert.deepEqual(p.consents,[]);
    await assert.rejects(box.approvedDownload({
      slug:"conflict-note",confirmation:"force",
    }),/Explicit, unexpired/);
    assert.equal(await box.readLocalForSyntheticTest("conflict-note"),"different local");
  });
});

test("missing/deleted remote item never authorizes an automatic local deletion",async()=>{
  await withScratch(async box=>{
    await box.setBaseline([{slug:"removed-elsewhere",sha256:sha("original")}]);
    await box.seedLocal("removed-elsewhere","original");
    const p=await box.preview();
    assert.equal(p.plan.summary["review-missing-remote"],1);
    assert.deepEqual(p.consents,[]);
    assert.equal(typeof box.deleteLocal,"undefined");
  });
});

test("tampering with exposed preview object cannot extend timeout or change allowed version",async()=>{
  await withScratch(async box=>{
    const c=await sampleUpdate(box);
    c.expiresAt=Date.now()-1;
    c.expectedLocalSha="f".repeat(64);
    // A copied public consent must not mutate private in-memory approval.
    const receipt=await box.approvedDownload({slug:"shared-note",confirmation:c.confirmation});
    assert.equal(receipt.afterSha,sha("new remote contents"));
  });
});

test("expired internal consent refuses a write and cannot be replayed",async()=>{
  await withScratch(async box=>{
    const c=await sampleUpdate(box);
    // Simulate clock advancing without timers or external traffic.
    const previous=Date.now;
    Date.now=()=>c.expiresAt+1;
    try{
      await assert.rejects(box.approvedDownload({
        slug:"shared-note",confirmation:c.confirmation,
      }),/Explicit, unexpired/);
    }finally{Date.now=previous;}
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),"old contents");
  });
});

test("an independent lock file prevents competing sync jobs",async()=>{
  await withScratch(async box=>{
    const c=await sampleUpdate(box);
    const file=path.join(box.syntheticWorkspacePath,"locks","shared-note.lock");
    const h=await open(file,"wx");
    try{
      await assert.rejects(box.approvedDownload({
        slug:"shared-note",confirmation:c.confirmation,
      }),/EEXIST/);
      assert.equal(await box.readLocalForSyntheticTest("shared-note"),"old contents");
    }finally{await h.close();await rm(file,{force:true});}
  });
});

test("corrupted persistent backup cannot be applied during restore",async()=>{
  await withScratch(async box=>{
    const c=await sampleUpdate(box);
    const r=await box.approvedDownload({slug:"shared-note",confirmation:c.confirmation});
    const backup=path.join(box.syntheticWorkspacePath,"backups",r.backupId+".bak");
    await writeFile(backup,"corrupted backup bytes");
    await assert.rejects(box.prepareRestore(r.backupId),/integrity mismatch/);
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),"new remote contents");
  });
});

test("restoration refuses if note changed since the previous download",async()=>{
  await withScratch(async box=>{
    const c=await sampleUpdate(box);
    const r=await box.approvedDownload({slug:"shared-note",confirmation:c.confirmation});
    const restore=await box.prepareRestore(r.backupId);
    const n=path.join(box.syntheticWorkspacePath,"notes","shared-note.md");
    await writeFile(n,"locally edited after download");
    await assert.rejects(box.approvedRestore({
      id:r.backupId,confirmation:restore.confirmation,
    }),/Restoration refused/);
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),"locally edited after download");
  });
});

test("symlink/hardlink local files are rejected rather than followed",async t=>{
  await withScratch(async box=>{
    const root=box.syntheticWorkspacePath;
    const original=path.join(root,"notes","safe-note.md");
    await box.seedLocal("safe-note","synthetic");
    await box.seedRemote("safe-note","remote synthetic");
    const hard=path.join(root,"notes","linked-note.md");
    try{await link(original,hard);}
    catch(error){
      if(["EPERM","EACCES","ENOSYS"].includes(error?.code)){
        t.skip("host disallows synthetic hardlinks");
        return;
      }
      throw error;
    }
    await assert.rejects(box.preview(),/hardlinked/);
  });
});

test("M3 synthetic upload creates a missing remote only after single-use per-note consent",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("brand-new-note","# Local author\n");
    const before=await box.preview();
    assert.equal(before.plan.summary["review-missing-remote"],1);
    assert.deepEqual(before.consents,[]);
    assert.equal(before.uploadConsents.length,1);
    const approval=before.uploadConsents[0];
    assert.match(approval.confirmation,/^CONFIRM UPLOAD brand-new-note [0-9a-f-]+$/);
    await assert.rejects(box.approvedUpload({
      slug:approval.slug,confirmation:"approve anything",
    }),/Explicit, unexpired/);
    assert.equal(await box.readRemoteForSyntheticTest(approval.slug),null);
    const receipt=await box.approvedUpload({
      slug:approval.slug,confirmation:approval.confirmation,
    });
    assert.deepEqual(receipt,{
      slug:"brand-new-note",priorRemoteSha:null,afterSha:sha("# Local author\n"),
      remoteRevision:"synthetic-r1",syntheticOnly:true,
      automaticSyncEnabled:false,deleteAllowed:false,
    });
    assert.equal(await box.readRemoteForSyntheticTest(approval.slug),"# Local author\n");
    assert.equal((await box.preview()).plan.summary.unchanged,1);
    await assert.rejects(box.approvedUpload({
      slug:approval.slug,confirmation:approval.confirmation,
    }),/Explicit, unexpired/);
    assert.deepEqual(await box.listDurableBackups(),[]);
  });
});

test("M3 synthetic upload updates only the unchanged-baseline remote and advances revision",async()=>{
  await withScratch(async box=>{
    await box.setBaseline([{slug:"existing-note",sha256:sha("shared v1")}]);
    await box.seedLocal("existing-note","local v2");
    await box.seedRemote("existing-note","shared v1");
    const before=await box.preview();
    assert.equal(before.plan.summary["review-upload"],1);
    const approval=before.uploadConsents[0];
    assert.equal(approval.choice,"review-upload");
    assert.equal(approval.expectedRemoteRevision,"synthetic-r1");
    const receipt=await box.approvedUpload({
      slug:approval.slug,confirmation:approval.confirmation,
    });
    assert.equal(receipt.priorRemoteSha,sha("shared v1"));
    assert.equal(receipt.afterSha,sha("local v2"));
    assert.equal(receipt.remoteRevision,"synthetic-r2");
    assert.equal(await box.readRemoteForSyntheticTest("existing-note"),"local v2");
    assert.equal(await box.readLocalForSyntheticTest("existing-note"),"local v2");
    assert.equal((await box.preview()).plan.summary.unchanged,1);
  });
});

test("M3 synthetic upload cannot overwrite conflicting edits, deletions or reverse directions",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("dual-edit","local changed");
    await box.seedRemote("dual-edit","remote changed");
    await box.seedRemote("only-remote","remote sole author");
    const p=await box.preview();
    assert.equal(p.plan.summary.conflict,1);
    assert.equal(p.plan.summary["review-missing-local"],1);
    assert.deepEqual(p.uploadConsents,[]);
    await assert.rejects(box.approvedUpload({
      slug:"dual-edit",confirmation:"CONFIRM UPLOAD dual-edit force",
    }),/Explicit, unexpired/);
    await assert.rejects(box.approvedUpload({
      slug:"only-remote",confirmation:"CONFIRM UPLOAD only-remote force",
    }),/Explicit, unexpired/);
    assert.equal(await box.readRemoteForSyntheticTest("dual-edit"),"remote changed");
    assert.equal(await box.readRemoteForSyntheticTest("only-remote"),"remote sole author");
    assert.equal(typeof box.deleteRemote,"undefined");
  });
});

test("M3 upload rejects a local user edit after preview; remote and baseline remain unchanged",async()=>{
  await withScratch(async box=>{
    await box.setBaseline([{slug:"upload-note",sha256:sha("base")}]);
    await box.seedLocal("upload-note","first local edit");
    await box.seedRemote("upload-note","base");
    const approval=(await box.preview()).uploadConsents[0];
    const file=path.join(box.syntheticWorkspacePath,"notes","upload-note.md");
    await writeFile(file,"second local edit");
    await assert.rejects(box.approvedUpload({
      slug:"upload-note",confirmation:approval.confirmation,
    }),/Preview is stale/);
    assert.equal(await box.readRemoteForSyntheticTest("upload-note"),"base");
    assert.equal((await box.preview()).plan.summary["review-upload"],1);
    await assert.rejects(box.approvedUpload({
      slug:"upload-note",confirmation:approval.confirmation,
    }),/Explicit, unexpired/);
  });
});

test("M3 upload rejects remote revision changes even when contents are unchanged",async()=>{
  await withScratch(async box=>{
    await box.setBaseline([{slug:"upload-note",sha256:sha("base")}]);
    await box.seedLocal("upload-note","local change");
    await box.seedRemote("upload-note","base");
    const approval=(await box.preview()).uploadConsents[0];
    await box.mutateRemote("upload-note","base"); // same SHA, different revision
    await assert.rejects(box.approvedUpload({
      slug:"upload-note",confirmation:approval.confirmation,
    }),/Preview is stale/);
    assert.equal(await box.readRemoteForSyntheticTest("upload-note"),"base");
    assert.equal((await box.preview()).plan.summary["review-upload"],1);
  });
});

test("M3 upload rechecks both sides after final pause and preserves old baseline on failure",async()=>{
  await withScratch(async box=>{
    await box.setBaseline([{slug:"upload-note",sha256:sha("base")}]);
    await box.seedLocal("upload-note","local change");
    await box.seedRemote("upload-note","base");
    const first=(await box.preview()).uploadConsents[0];
    await assert.rejects(box.approvedUpload({
      slug:"upload-note",confirmation:first.confirmation,
      beforeCommitForSyntheticTest:async()=>{
        await box.mutateRemote("upload-note","remote concurrently changed");
      },
    }),/changed before upload commit/);
    assert.equal(await box.readRemoteForSyntheticTest("upload-note"),"remote concurrently changed");
    assert.equal((await box.preview()).plan.summary.conflict,1,
      "failed upload must not advance baseline past the original version");
  });
  await withScratch(async box=>{
    await box.seedLocal("upload-note","first version");
    const first=(await box.preview()).uploadConsents[0];
    const file=path.join(box.syntheticWorkspacePath,"notes","upload-note.md");
    await assert.rejects(box.approvedUpload({
      slug:"upload-note",confirmation:first.confirmation,
      beforeCommitForSyntheticTest:async()=>{await writeFile(file,"new user version");},
    }),/changed before upload commit/);
    assert.equal(await box.readRemoteForSyntheticTest("upload-note"),null);
    assert.equal((await box.preview()).plan.summary["review-missing-remote"],1);
  });
});

test("M3 upload consent expiration stops all synthetic writes",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("upload-note","local only");
    const approval=(await box.preview()).uploadConsents[0];
    const realNow=Date.now;
    Date.now=()=>approval.expiresAt+1;
    try{
      await assert.rejects(box.approvedUpload({
        slug:approval.slug,confirmation:approval.confirmation,
      }),/Explicit, unexpired/);
    }finally{Date.now=realNow;}
    assert.equal(await box.readRemoteForSyntheticTest("upload-note"),null);
  });
});

test("sandbox wipe is scoped to its own random temporary folder",async()=>{
  const box=await createDurableSyntheticObsidianWorkspace();
  const home=box.syntheticWorkspacePath;
  await box.seedLocal("safe-note","synthetic");
  await box.destroyScratch();
  await box.destroyScratch();
  await assert.rejects(lstat(home),/ENOENT/);
  await assert.rejects(box.preview(),/closed/);
});
