import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {lstat,readFile,writeFile,rm,open,access,symlink,link,readdir} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {createDurableSyntheticObsidianWorkspace} from "../lib/obsidian-durable-write-sandbox.ts";

const sha=text=>createHash("sha256").update(text).digest("hex");
const execFileAsync=promisify(execFile);

/**
 * A real, independent Node process plays an external editor. Its destination
 * is limited to this test's own factory-created synthetic scratch notes.
 * Completion is awaited to make collision timing deterministic.
 */
async function editSyntheticNoteFromChild(box,slug,contents,{exclusive=false}={}){
  assert.match(slug,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const notes=path.join(box.syntheticWorkspacePath,"notes");
  const filename=path.join(notes,slug+".md");
  assert.equal(path.dirname(filename),notes);
  const script=[
    "const fs=require('node:fs');",
    "fs.writeFileSync(process.argv[1],process.argv[2],{flag:process.argv[3]});",
    "process.stdout.write(String(process.pid));",
  ].join("");
  const {stdout}=await execFileAsync(
    process.execPath,
    ["-e",script,filename,contents,exclusive?"wx":"w"],
    {windowsHide:true,timeout:10_000,maxBuffer:1024},
  );
  const childPid=Number(stdout);
  assert.ok(Number.isSafeInteger(childPid)&&childPid>0);
  assert.notEqual(childPid,process.pid,"the editor must be a separate OS process");
}

/** Keep the prior inode alive so the replacement cannot reuse its file ID. */
async function replaceSyntheticIdentityFromChild(box,slug,contents){
  assert.match(slug,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const notes=path.join(box.syntheticWorkspacePath,"notes");
  const current=path.join(notes,slug+".md");
  const preserved=path.join(notes,".synthetic-external-preserved-"+randomUUID()+".bak");
  const script=[
    "const fs=require('node:fs');",
    "fs.renameSync(process.argv[1],process.argv[2]);",
    "fs.writeFileSync(process.argv[1],process.argv[3],{flag:'wx'});",
    "process.stdout.write(String(process.pid));",
  ].join("");
  const {stdout}=await execFileAsync(process.execPath,
    ["-e",script,current,preserved,contents],
    {windowsHide:true,timeout:10_000,maxBuffer:1024});
  assert.notEqual(Number(stdout),process.pid);
  return preserved;
}

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

test("external Windows child edit during synthetic overwrite is detected after backup",async()=>{
  await withScratch(async box=>{
    const approval=await sampleUpdate(box);
    const note=path.join(box.syntheticWorkspacePath,"notes","shared-note.md");
    const lock=path.join(box.syntheticWorkspacePath,"locks","shared-note.lock");
    await assert.rejects(box.approvedDownload({
      slug:"shared-note",confirmation:approval.confirmation,
      beforeCommitForSyntheticTest:async()=>{
        assert.equal((await lstat(lock)).isFile(),true,
          "a cooperative lock exists but cannot stop a separate editor");
        await editSyntheticNoteFromChild(box,"shared-note","child process last-minute edit");
      },
    }),/changed after backup/);
    assert.equal(await readFile(note,"utf8"),"child process last-minute edit");
    const backups=await box.listDurableBackups();
    assert.equal(backups.length,1);
    assert.equal(await box.readBackupForSyntheticTest(backups[0].id),"old contents");
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),"child process last-minute edit");
  });
});

test("external child creates missing note before download; exclusive create refuses overwrite",async()=>{
  await withScratch(async box=>{
    await box.seedRemote("brand-new-note","synthetic remote content");
    const approval=find(await box.preview(),"brand-new-note");
    await assert.rejects(box.approvedDownload({
      slug:"brand-new-note",confirmation:approval.confirmation,
      beforeCommitForSyntheticTest:()=>editSyntheticNoteFromChild(
        box,"brand-new-note","child created its own note",{exclusive:true},
      ),
    }),/EEXIST/);
    assert.equal(await box.readLocalForSyntheticTest("brand-new-note"),
      "child created its own note");
    assert.deepEqual(await box.listDurableBackups(),[]);
  });
});

test("external Windows child edit during approved synthetic restore preserves latest note",async()=>{
  await withScratch(async box=>{
    const consent=await sampleUpdate(box);
    const download=await box.approvedDownload({
      slug:"shared-note",confirmation:consent.confirmation,
    });
    const restore=await box.prepareRestore(download.backupId);
    await assert.rejects(box.approvedRestore({
      id:download.backupId,confirmation:restore.confirmation,
      beforeCommitForSyntheticTest:()=>editSyntheticNoteFromChild(
        box,"shared-note","child edited during restore",
      ),
    }),/changed after backup/);
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),
      "child edited during restore");
    const backups=await box.listDurableBackups();
    assert.equal(backups.length,2,"reversible restore backup survives aborted restore");
    assert.ok(backups.some(b=>b.beforeSha===sha("new remote contents")));
  });
});

test("external child replacing an identical-content inode cannot trick synthetic overwrite",async()=>{
  await withScratch(async box=>{
    const consent=await sampleUpdate(box);
    let moved;
    await assert.rejects(box.approvedDownload({
      slug:"shared-note",confirmation:consent.confirmation,
      beforeCommitForSyntheticTest:async()=>{
        moved=await replaceSyntheticIdentityFromChild(box,"shared-note","old contents");
      },
    }),/identity changed after backup/);
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),"old contents");
    assert.equal(await readFile(moved,"utf8"),"old contents");
    const backups=await box.listDurableBackups();
    assert.equal(backups.length,1,"abort retains reversible backup");
    assert.equal(await box.readBackupForSyntheticTest(backups[0].id),"old contents");
  });
});

test("external child swapping identical-content inode also cancels approved restore",async()=>{
  await withScratch(async box=>{
    const c=await sampleUpdate(box);
    const download=await box.approvedDownload({
      slug:"shared-note",confirmation:c.confirmation,
    });
    const approval=await box.prepareRestore(download.backupId);
    let moved;
    await assert.rejects(box.approvedRestore({
      id:download.backupId,confirmation:approval.confirmation,
      beforeCommitForSyntheticTest:async()=>{
        moved=await replaceSyntheticIdentityFromChild(
          box,"shared-note","new remote contents",
        );
      },
    }),/identity changed after backup/);
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),"new remote contents");
    assert.equal(await readFile(moved,"utf8"),"new remote contents");
    assert.equal((await box.listDurableBackups()).length,2,
      "restore abort keeps undo backup without changing original");
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

test("untrusted backup manifest fields, identity and time fail closed",async()=>{
  const cases=[
    {label:"unexpected path",change:x=>({...x,localPath:"../../outside"})},
    {label:"missing timestamp",change:x=>{const {createdAt,...rest}=x;return rest;}},
    {label:"noncanonical timestamp",change:x=>({...x,createdAt:"2026-02-30T00:00:00.000Z"})},
    {label:"path traversal slug",change:x=>({...x,slug:"../../outside"})},
    {label:"incorrect transaction ID",change:x=>({...x,id:randomUUID()})},
    {label:"oversized metadata",change:x=>({...x,padding:"a".repeat(5000)}),
      reason:/metadata exceeds safe limits/},
  ];
  for(const c of cases){
    await withScratch(async box=>{
      const approval=await sampleUpdate(box);
      const receipt=await box.approvedDownload({
        slug:"shared-note",confirmation:approval.confirmation,
      });
      const location=path.join(box.syntheticWorkspacePath,"backups",receipt.backupId+".json");
      const original=JSON.parse(await readFile(location,"utf8"));
      const modified=JSON.stringify(c.change(original));
      await writeFile(location,modified);
      await assert.rejects(box.listDurableBackups(),c.reason??/integrity mismatch/,c.label);
      await assert.rejects(box.prepareRestore(receipt.backupId),
        c.reason??/integrity mismatch/,c.label);
      assert.equal(await box.readLocalForSyntheticTest("shared-note"),
        "new remote contents",c.label);
      assert.equal(await readFile(location,"utf8"),modified,
        "suspicious synthetic manifest remains for manual inspection");
    });
  }
});

test("tampering with a backup manifest after restore approval refuses restoration",async()=>{
  await withScratch(async box=>{
    const c=await sampleUpdate(box);
    const receipt=await box.approvedDownload({
      slug:"shared-note",confirmation:c.confirmation,
    });
    const approval=await box.prepareRestore(receipt.backupId);
    const location=path.join(box.syntheticWorkspacePath,"backups",receipt.backupId+".json");
    const meta=JSON.parse(await readFile(location,"utf8"));
    await writeFile(location,JSON.stringify({...meta,createdAt:"invalid-date"}));
    await assert.rejects(box.approvedRestore({
      id:receipt.backupId,confirmation:approval.confirmation,
    }),/integrity mismatch/);
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),
      "new remote contents");
    assert.equal((await readdir(path.join(box.syntheticWorkspacePath,"backups"))).length,2,
      "a refused restore must not generate a new backup");
  });
});

test("read-only recovery audit reports healthy empty and complete scratch catalogs",async()=>{
  await withScratch(async box=>{
    const empty=await box.inspectSyntheticBackupRecovery();
    assert.deepEqual(empty,{
      syntheticOnly:true,readOnly:true,inspectionComplete:true,
      scannedEntries:0,validPairs:0,orphanBackups:0,
      orphanMetadata:0,invalidPairs:0,unexpectedEntries:0,
      needsManualReview:false,
    });
    const c=await sampleUpdate(box);
    const receipt=await box.approvedDownload({
      slug:"shared-note",confirmation:c.confirmation,
    });
    const report=await box.inspectSyntheticBackupRecovery();
    assert.equal(report.inspectionComplete,true);
    assert.equal(report.validPairs,1);
    assert.equal(report.scannedEntries,2);
    assert.equal(report.needsManualReview,false);
    assert.equal((await box.listDurableBackups()).length,1);
    const serialized=JSON.stringify(report);
    assert.ok(!serialized.includes(receipt.backupId));
    assert.ok(!serialized.includes("shared-note"));
    assert.ok(!serialized.includes("old contents"));
    assert.ok(!serialized.includes(box.syntheticWorkspacePath));
  });
});

test("read-only recovery audit detects orphan and unexpected backup entries without deleting evidence",async()=>{
  await withScratch(async box=>{
    const dir=path.join(box.syntheticWorkspacePath,"backups");
    const orphanBackup=path.join(dir,randomUUID()+".bak");
    const orphanMetadata=path.join(dir,randomUUID()+".json");
    const unexpected=path.join(dir,"unexpected.partial");
    await writeFile(orphanBackup,"synthetic missing metadata");
    await writeFile(orphanMetadata,"{\"synthetic\":true}");
    await writeFile(unexpected,"synthetic crash trace");
    const before=(await readdir(dir)).sort();
    const report=await box.inspectSyntheticBackupRecovery();
    assert.equal(report.inspectionComplete,true);
    assert.equal(report.validPairs,0);
    assert.equal(report.orphanBackups,1);
    assert.equal(report.orphanMetadata,1);
    assert.equal(report.unexpectedEntries,1);
    assert.equal(report.invalidPairs,0);
    assert.equal(report.scannedEntries,3);
    assert.equal(report.needsManualReview,true);
    assert.deepEqual((await readdir(dir)).sort(),before);
    assert.equal(await readFile(orphanBackup,"utf8"),"synthetic missing metadata");
    assert.equal(await readFile(unexpected,"utf8"),"synthetic crash trace");
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),null);
    const redacted=JSON.stringify(report);
    for(const item of [...before,"synthetic crash trace","synthetic missing metadata"]){
      assert.ok(!redacted.includes(item),"recovery report must not expose filenames or bodies");
    }
  });
});

test("read-only recovery audit detects corrupted paired bytes while preserving the original",async()=>{
  await withScratch(async box=>{
    const c=await sampleUpdate(box);
    const receipt=await box.approvedDownload({
      slug:"shared-note",confirmation:c.confirmation,
    });
    const filename=path.join(box.syntheticWorkspacePath,"backups",receipt.backupId+".bak");
    await writeFile(filename,"tampered synthetic backup");
    const report=await box.inspectSyntheticBackupRecovery();
    assert.equal(report.inspectionComplete,true);
    assert.equal(report.validPairs,0);
    assert.equal(report.invalidPairs,1);
    assert.equal(report.needsManualReview,true);
    assert.equal(report.orphanBackups,0);
    assert.equal(report.orphanMetadata,0);
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),"new remote contents");
    assert.equal(await readFile(filename,"utf8"),"tampered synthetic backup");
  });
});

test("over-limit recovery audit marks counts unknown and requires manual review",async()=>{
  await withScratch(async box=>{
    const dir=path.join(box.syntheticWorkspacePath,"backups");
    for(let i=0;i<1025;i++){
      await writeFile(path.join(dir,"unexpected-"+i+".partial"),"");
    }
    const report=await box.inspectSyntheticBackupRecovery();
    assert.equal(report.syntheticOnly,true);
    assert.equal(report.readOnly,true);
    assert.equal(report.inspectionComplete,false);
    assert.equal(report.scannedEntries,1025);
    assert.equal(report.needsManualReview,true);
    assert.equal(report.validPairs,null);
    assert.equal(report.orphanBackups,null);
    assert.equal(report.orphanMetadata,null);
    assert.equal(report.invalidPairs,null);
    assert.equal(report.unexpectedEntries,null);
    assert.equal((await readdir(dir)).length,1025);
  });
});

test("an orphaned backup blocks a new approved overwrite and preserves original",async()=>{
  await withScratch(async box=>{
    const approval=await sampleUpdate(box);
    const file=path.join(box.syntheticWorkspacePath,"backups",randomUUID()+".bak");
    await writeFile(file,"synthetic crash evidence");
    await assert.rejects(box.approvedDownload({
      slug:"shared-note",confirmation:approval.confirmation,
    }),/Synthetic backup catalog unsafe/);
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),"old contents");
    assert.equal(await readFile(file,"utf8"),"synthetic crash evidence");
    assert.deepEqual(await readdir(path.join(box.syntheticWorkspacePath,"locks")),[]);
  });
});

test("even a missing local note cannot be created with a corrupt backup catalog",async()=>{
  await withScratch(async box=>{
    await box.seedRemote("first-note","synthetic incoming");
    const approval=find(await box.preview(),"first-note");
    const file=path.join(box.syntheticWorkspacePath,"backups","unfinished.partial");
    await writeFile(file,"unfinished synthetic backup");
    await assert.rejects(box.approvedDownload({
      slug:"first-note",confirmation:approval.confirmation,
    }),/Synthetic backup catalog unsafe/);
    assert.equal(await box.readLocalForSyntheticTest("first-note"),null);
    assert.equal(await readFile(file,"utf8"),"unfinished synthetic backup");
  });
});

test("corrupting a completed backup during the synthetic commit hook blocks replacement",async()=>{
  await withScratch(async box=>{
    const approval=await sampleUpdate(box);
    const backups=path.join(box.syntheticWorkspacePath,"backups");
    await assert.rejects(box.approvedDownload({
      slug:"shared-note",confirmation:approval.confirmation,
      beforeCommitForSyntheticTest:async()=>{
        const [filename]= (await readdir(backups)).filter(x=>x.endsWith(".bak"));
        assert.ok(filename);
        await writeFile(path.join(backups,filename),"corrupt backup during commit");
      },
    }),/Synthetic backup catalog unsafe/);
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),"old contents");
    const report=await box.inspectSyntheticBackupRecovery();
    assert.equal(report.invalidPairs,1);
    assert.equal(report.needsManualReview,true);
  });
});

test("unrelated corrupt backup prevents approved restore and preserves both note and evidence",async()=>{
  await withScratch(async box=>{
    const c=await sampleUpdate(box);
    const written=await box.approvedDownload({slug:"shared-note",confirmation:c.confirmation});
    const restore=await box.prepareRestore(written.backupId);
    const dir=path.join(box.syntheticWorkspacePath,"backups");
    const orphan=path.join(dir,randomUUID()+".json");
    await writeFile(orphan,"{}");
    await assert.rejects(box.approvedRestore({
      id:written.backupId,confirmation:restore.confirmation,
    }),/Synthetic backup catalog unsafe/);
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),"new remote contents");
    assert.equal((await readdir(dir)).length,3);
    assert.equal(await readFile(orphan,"utf8"),"{}");
  });
});

test("cooperative writes to different notes share one exclusive scratch catalog lock",async()=>{
  await withScratch(async box=>{
    await box.setBaseline([
      {slug:"alpha-note",sha256:sha("old alpha")},
      {slug:"beta-note",sha256:sha("old beta")},
    ]);
    await box.seedLocal("alpha-note","old alpha");
    await box.seedLocal("beta-note","old beta");
    await box.seedRemote("alpha-note","new alpha");
    await box.seedRemote("beta-note","new beta");
    const review=await box.preview();
    const a=find(review,"alpha-note"),b=find(review,"beta-note");
    assert.ok(a&&b);
    let enterFirst,releaseFirst;
    const firstEntered=new Promise(resolve=>{enterFirst=resolve;});
    const holdFirst=new Promise(resolve=>{releaseFirst=resolve;});
    const first=box.approvedDownload({
      slug:"alpha-note",confirmation:a.confirmation,
      beforeCommitForSyntheticTest:async()=>{
        enterFirst();
        await holdFirst;
      },
    });
    await firstEntered;
    try{
      const catalogLock=path.join(box.syntheticWorkspacePath,"locks","backup-catalog.lock");
      assert.equal((await lstat(catalogLock)).isFile(),true);
      await assert.rejects(box.approvedDownload({
        slug:"beta-note",confirmation:b.confirmation,
      }),/EEXIST/);
      assert.equal(await box.readLocalForSyntheticTest("beta-note"),"old beta");
    }finally{
      releaseFirst();
    }
    await first;
    assert.equal(await box.readLocalForSyntheticTest("alpha-note"),"new alpha");
    assert.equal(await box.readLocalForSyntheticTest("beta-note"),"old beta");
    assert.deepEqual(await readdir(path.join(box.syntheticWorkspacePath,"locks")),[]);
    const report=await box.inspectSyntheticBackupRecovery();
    assert.equal(report.validPairs,1);
    assert.equal(report.needsManualReview,false);
  });
});

test("full but valid backup catalog refuses a new transaction before creating files",async()=>{
  await withScratch(async box=>{
    const approval=await sampleUpdate(box);
    const backups=path.join(box.syntheticWorkspacePath,"backups");
    const previous="archived synthetic content";
    for(let i=0;i<512;i++){
      const id=randomUUID();
      await writeFile(path.join(backups,id+".bak"),previous);
      await writeFile(path.join(backups,id+".json"),JSON.stringify({
        id,slug:"archived-note",beforeSha:sha(previous),afterSha:sha("later"),
        createdAt:"2026-10-22T00:00:00.000Z",syntheticOnly:true,
      }));
    }
    const report=await box.inspectSyntheticBackupRecovery();
    assert.equal(report.inspectionComplete,true);
    assert.equal(report.needsManualReview,false);
    assert.equal(report.scannedEntries,1024);
    assert.equal(report.validPairs,512);
    await assert.rejects(box.approvedDownload({
      slug:"shared-note",confirmation:approval.confirmation,
    }),/at capacity/);
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),"old contents");
    assert.equal((await readdir(backups)).length,1024);
  });
});

test("closed synthetic workspace refuses subsequent recovery inspection",async()=>{
  const box=await createDurableSyntheticObsidianWorkspace();
  await box.destroyScratch();
  await assert.rejects(box.inspectSyntheticBackupRecovery(),/closed/);
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

test("sandbox wipe is scoped to its own random temporary folder",async()=>{
  const box=await createDurableSyntheticObsidianWorkspace();
  const home=box.syntheticWorkspacePath;
  await box.seedLocal("safe-note","synthetic");
  await box.destroyScratch();
  await box.destroyScratch();
  await assert.rejects(lstat(home),/ENOENT/);
  await assert.rejects(box.preview(),/closed/);
});
