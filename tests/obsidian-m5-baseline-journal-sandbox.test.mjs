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


test("M5 synthetic conflict comparison shows both versions without granting any write",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("shared-note","intro\nLOCAL decision\nclosing\n");
    await box.seedRemote("shared-note","intro\nREMOTE decision\nclosing\n");
    const d=(await box.preview()).plan.decisions.find(x=>x.slug==="shared-note");
    assert.equal(d.choice,"conflict");
    const comparison=await box.compareSyntheticConflict({
      slug:d.slug,expectedLocalSha:d.expectedLocalSha,
      expectedRemoteSha:d.expectedRemoteSha,
      expectedRemoteRevision:d.expectedRemoteRevision,
    });
    assert.equal(comparison.syntheticOnly,true);
    assert.equal(comparison.writeAllowed,false);
    assert.equal(comparison.deleteAllowed,false);
    assert.equal(comparison.autoMergeAllowed,false);
    assert.equal(comparison.truncated,false);
    assert.ok(comparison.rows.some(x=>x.localText==="LOCAL decision"&&
      x.remoteText==="REMOTE decision"&&!x.identical));
    assert.equal(await box.readLocalForSyntheticTest("shared-note"),
      "intro\nLOCAL decision\nclosing\n");
    assert.equal(await box.readRemoteForSyntheticTest("shared-note"),
      "intro\nREMOTE decision\nclosing\n");
    assert.deepEqual(await box.listConfirmedSyntheticBaselines(),[],
      "comparison is never a successful sync");
    assert.equal((await box.preview()).plan.decisions[0].choice,"conflict");
  });
});

test("M5 conflict comparison rejects stale local, stale remote, fake and non-conflict fingerprints",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("stale-compare","local");
    await box.seedRemote("stale-compare","remote");
    const d=(await box.preview()).plan.decisions[0];
    const requested={
      slug:d.slug,expectedLocalSha:d.expectedLocalSha,
      expectedRemoteSha:d.expectedRemoteSha,
      expectedRemoteRevision:d.expectedRemoteRevision,
    };
    await assert.rejects(box.compareSyntheticConflict({
      ...requested,expectedLocalSha:"a".repeat(64),
    }),/stale/);
    await box.mutateRemote("stale-compare","remote newer");
    await assert.rejects(box.compareSyntheticConflict(requested),/stale/);
    await writeFile(path.join(box.syntheticWorkspacePath,"notes","stale-compare.md"),
      "local newer");
    await assert.rejects(box.compareSyntheticConflict(requested),/stale/);
    const newer=(await box.preview()).plan.decisions[0];
    await assert.rejects(box.compareSyntheticConflict({
      slug:newer.slug,expectedLocalSha:newer.expectedLocalSha,
      expectedRemoteSha:newer.expectedRemoteSha,
      expectedRemoteRevision:"synthetic-r0",
    }),/Invalid reviewed/);
  });
  await withScratch(async box=>{
    await box.seedLocal("matched-note","same");
    await box.seedRemote("matched-note","same");
    const d=(await box.preview()).plan.decisions[0];
    assert.equal(d.choice,"unchanged");
    await assert.rejects(box.compareSyntheticConflict({
      slug:d.slug,expectedLocalSha:d.expectedLocalSha,
      expectedRemoteSha:d.expectedRemoteSha,
      expectedRemoteRevision:d.expectedRemoteRevision,
    }),/Only unresolved/);
  });
});

test("M5 conflict preview is bounded but retains changed span in long Markdown",async()=>{
  await withScratch(async box=>{
    const prefix=Array.from({length:240},(_,i)=>"same line "+i).join("\n");
    const suffix=Array.from({length:240},(_,i)=>"tail line "+i).join("\n");
    await box.seedLocal("large-compare",prefix+"\nLOCAL-only revision\n"+suffix);
    await box.seedRemote("large-compare",prefix+"\nREMOTE-only revision\n"+suffix);
    const d=(await box.preview()).plan.decisions[0];
    const r=await box.compareSyntheticConflict({
      slug:d.slug,expectedLocalSha:d.expectedLocalSha,
      expectedRemoteSha:d.expectedRemoteSha,
      expectedRemoteRevision:d.expectedRemoteRevision,
    });
    assert.ok(r.hiddenRows>0);
    assert.equal(r.truncated,true);
    assert.ok(r.rows.length<=86,"bounded output despite large note");
    assert.ok(r.rows.some(row=>row.localText==="LOCAL-only revision"&&
      row.remoteText==="REMOTE-only revision"),
      "changes after large identical prefix must remain visible");
  });
});

test("M5 flags newline-only conflict while keeping both byte fingerprints",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("newline-note","same\nlines\n");
    await box.seedRemote("newline-note","same\r\nlines\r\n");
    const d=(await box.preview()).plan.decisions[0];
    assert.equal(d.choice,"conflict");
    const r=await box.compareSyntheticConflict({
      slug:d.slug,expectedLocalSha:d.expectedLocalSha,
      expectedRemoteSha:d.expectedRemoteSha,
      expectedRemoteRevision:d.expectedRemoteRevision,
    });
    assert.equal(r.lineEndingOnlyDifference,true);
    assert.notEqual(r.localSha,r.remoteSha);
    assert.equal(r.autoMergeAllowed,false);
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

test("M5 reload exposes unjournaled local and remote sources even with no memory baseline",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("local-only","local");
    await box.seedRemote("remote-only","remote");
    await box.seedLocal("both-only","matching");
    await box.seedRemote("both-only","matching");
    const report=await box.inspectSyntheticBaselineReload();
    assert.deepEqual(report.notes.map(({slug,status,checkpointCount})=>({
      slug,status,checkpointCount,
    })),[
      {slug:"both-only",status:"missing-journal-evidence",checkpointCount:0},
      {slug:"local-only",status:"missing-journal-evidence",checkpointCount:0},
      {slug:"remote-only",status:"missing-journal-evidence",checkpointCount:0},
    ],"matching bytes or an unpaired source must not become invisible during recovery");
    assert.equal(report.autoImportAllowed,false);
    assert.equal(report.writeAllowed,false);
    assert.deepEqual(await box.listConfirmedSyntheticBaselines(),[]);
  });
});

test("M5 reload rejects a new unjournaled remote during final inventory verification",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("first-note","local");
    await assert.rejects(box.inspectSyntheticBaselineReload({
      beforeFinalJournalRecheckForSyntheticTest:async()=>{
        await box.seedRemote("late-remote","new remote source");
      },
    }),/M5 reload source inventory changed during inspection/);
    assert.deepEqual(await box.listConfirmedSyntheticBaselines(),[],
      "a failed reload cannot invent a baseline checkpoint");
  });
});

test("M5 reload refuses changed uncheckpointed local content and incomplete coverage",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("unchecked-local","original");
    await assert.rejects(box.inspectSyntheticBaselineReload({
      beforeFinalJournalRecheckForSyntheticTest:async()=>{
        await writeFile(path.join(box.syntheticWorkspacePath,"notes","unchecked-local.md"),"edited");
      },
    }),/M5 reload source inventory changed during inspection/);
    await writeFile(path.join(box.syntheticWorkspacePath,"notes","unindexed.txt"),"unknown");
    await assert.rejects(box.inspectSyntheticBaselineReload(),
      /M5 reload local inventory is incomplete/,
      "unknown files must not disappear from a recovery inventory");
    assert.deepEqual(await box.listConfirmedSyntheticBaselines(),[]);
  });
});

test("M5 reload identifies a memory baseline with no persisted journal evidence",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("memory-only","same content");
    await box.seedRemote("memory-only","same content");
    await box.setBaseline([{slug:"memory-only",sha256:sha("same content")}]);
    assert.equal((await box.preview()).plan.decisions[0].choice,"unchanged");
    assert.deepEqual(await box.listConfirmedSyntheticBaselines(),[]);
    const report=await box.inspectSyntheticBaselineReload();
    assert.deepEqual(report.notes,[{
      slug:"memory-only",checkpointCount:0,checkpointId:null,
      status:"missing-journal-evidence",
    }],"matching current bytes cannot substitute for persisted sync evidence");
    assert.equal(report.autoImportAllowed,false);
    assert.equal(report.writeAllowed,false);
    assert.equal(report.deleteAllowed,false);
    assert.equal(report.manualReviewRequired,true);
    assert.deepEqual(await box.listConfirmedSyntheticBaselines(),[],
      "read-only inspection must not fabricate a checkpoint");
  });
});

test("M5 reload keeps a recorded note distinct from an unrecorded memory baseline",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("recorded-note","recorded");
    const consent=(await box.preview()).uploadConsents[0];
    await box.approvedUpload({slug:consent.slug,confirmation:consent.confirmation});
    await box.seedLocal("unrecorded-note","unrecorded");
    await box.seedRemote("unrecorded-note","unrecorded");
    await box.setBaseline([
      {slug:"recorded-note",sha256:sha("recorded")},
      {slug:"unrecorded-note",sha256:sha("unrecorded")},
    ]);
    const report=await box.inspectSyntheticBaselineReload();
    assert.deepEqual(report.notes.map(({slug,status,checkpointCount})=>({
      slug,status,checkpointCount,
    })),[
      {slug:"recorded-note",status:"matches-current-pair",checkpointCount:1},
      {slug:"unrecorded-note",status:"missing-journal-evidence",checkpointCount:0},
    ]);
    assert.equal((await box.listConfirmedSyntheticBaselines()).length,1,
      "read-only reload never appends evidence for the memory-only note");
  });
});

test("M5 reload rejects an unrecorded memory baseline added during final inspection",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("late-memory-only","same");
    await box.seedRemote("late-memory-only","same");
    await assert.rejects(box.inspectSyntheticBaselineReload({
      beforeFinalJournalRecheckForSyntheticTest:async()=>{
        await box.setBaseline([{slug:"late-memory-only",sha256:sha("same")}]);
      },
    }),/M5 reload memory baseline changed during inspection/);
    assert.deepEqual(await box.listConfirmedSyntheticBaselines(),[],
      "a transient memory change cannot manufacture a disk checkpoint");
  });
});

test("M5 reload inspection is read-only even for a matching synthetic pair",async()=>{
  await withScratch(async box=>{
    assert.deepEqual((await box.inspectSyntheticBaselineReload()).notes,[],
      "absence of evidence must never be treated as a deletion instruction");
    await box.seedLocal("reload-note","reload source");
    const approval=(await box.preview()).uploadConsents[0];
    await box.approvedUpload({slug:approval.slug,confirmation:approval.confirmation});
    // Simulate loss of the in-memory baseline after a restart; the scratch
    // journal remains. Inspecting it must NEVER silently import the baseline.
    await box.setBaseline([]);
    const report=await box.inspectSyntheticBaselineReload();
    assert.equal(report.notes.length,1);
    assert.equal(report.notes[0].slug,"reload-note");
    assert.equal(report.notes[0].checkpointCount,1);
    assert.equal(report.notes[0].status,"matches-current-pair");
    assert.equal(report.syntheticOnly,true);
    assert.equal(report.autoImportAllowed,false);
    assert.equal(report.writeAllowed,false);
    assert.equal(report.deleteAllowed,false);
    assert.equal(report.manualReviewRequired,true);
    await box.mutateRemote("reload-note","new independent remote edit");
    assert.equal((await box.preview()).plan.decisions[0].choice,"conflict",
      "inspection must not make a missing baseline look synchronized");
  });
});

test("M5 reload inspection fails closed on stale, missing or conflicting synthetic evidence",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("stale-reload","original content");
    const approval=(await box.preview()).uploadConsents[0];
    await box.approvedUpload({slug:approval.slug,confirmation:approval.confirmation});
    assert.equal((await box.inspectSyntheticBaselineReload()).notes[0].status,
      "matches-current-pair");
    await box.mutateRemote("stale-reload","changed remote");
    assert.equal((await box.inspectSyntheticBaselineReload()).notes[0].status,
      "changed-remote","the journal revision cannot silently win");
    const source=path.join(box.syntheticWorkspacePath,"notes","stale-reload.md");
    await writeFile(source,"changed local");
    assert.equal((await box.inspectSyntheticBaselineReload()).notes[0].status,
      "changed-both");
    await rm(source);
    assert.equal((await box.inspectSyntheticBaselineReload()).notes[0].status,
      "changed-both","missing notes cannot authorize deletion");
    assert.deepEqual((await box.listConfirmedSyntheticBaselines()).map(x=>x.slug),
      ["stale-reload"],"inspection never truncates journal evidence");
  });
  await withScratch(async box=>{
    await box.seedLocal("mismatched-memory","current");
    const approval=(await box.preview()).uploadConsents[0];
    await box.approvedUpload({slug:approval.slug,confirmation:approval.confirmation});
    await box.setBaseline([{slug:"mismatched-memory",sha256:sha("prior")}]);
    assert.equal((await box.inspectSyntheticBaselineReload()).notes[0].status,
      "memory-baseline-disagrees");
  });
});

test("M5 reload refuses to choose a winner among unordered historical checkpoints",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("history-note","first");
    const approval=(await box.preview()).uploadConsents[0];
    await box.approvedUpload({slug:approval.slug,confirmation:approval.confirmation});
    await box.mutateRemote("history-note","second");
    const download=(await box.preview()).consents[0];
    await box.approvedDownload({slug:download.slug,confirmation:download.confirmation});
    const log=await box.listConfirmedSyntheticBaselines();
    assert.equal(log.length,2);
    assert.notEqual(log[0].sha256,log[1].sha256);
    const report=await box.inspectSyntheticBaselineReload();
    assert.equal(report.notes.length,1);
    assert.equal(report.notes[0].status,"ambiguous-history");
    assert.equal(report.notes[0].checkpointCount,2);
    assert.equal(report.notes[0].checkpointId,null,
      "UUID filenames and timestamps do not establish a trusted replay order");
    assert.equal(report.autoImportAllowed,false);
  });
});

test("M5 read-only journal rejects forged checkpoint IDs and oversized slugs",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("format-guard","approved");
    const consent=(await box.preview()).uploadConsents[0];
    await box.approvedUpload({slug:consent.slug,confirmation:consent.confirmation});
    const good=(await box.listConfirmedSyntheticBaselines())[0];
    const forgedId="00000000-0000-0000-0000-000000000000";
    const forgedPath=path.join(journal(box),forgedId+".json");
    await writeFile(forgedPath,JSON.stringify({...good,id:forgedId}));
    await assert.rejects(box.listConfirmedSyntheticBaselines(),
      /Unexpected M5 checkpoint file/,
      "an arbitrary 36-character hex/dash name is not a generated UUID v4");
    await rm(forgedPath);

    const goodPath=path.join(journal(box),good.id+".json");
    await writeFile(goodPath,JSON.stringify({...good,slug:"a".repeat(121)}));
    await assert.rejects(box.listConfirmedSyntheticBaselines(),
      /Invalid M5 checkpoint evidence/,
      "a structurally valid JSON record may still exceed the slug contract");
    assert.equal(await box.readLocalForSyntheticTest("format-guard"),"approved");
  });
});

test("M5 journal refuses non-canonical checkpoint timestamps",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("timestamp-guard","approved");
    const consent=(await box.preview()).uploadConsents[0];
    await box.approvedUpload({slug:consent.slug,confirmation:consent.confirmation});
    const record=(await box.listConfirmedSyntheticBaselines())[0];
    const location=path.join(journal(box),record.id+".json");
    for(const createdAt of [
      "0","2026-10-26T08:05:00Z","Wed, 21 Oct 2026 08:05:00 GMT",
      "2026-02-30T08:05:00.000Z",
    ]){
      await writeFile(location,JSON.stringify({...record,createdAt}));
      await assert.rejects(box.listConfirmedSyntheticBaselines(),
        /Invalid M5 checkpoint evidence/,
        "M5 must require the exact UTC millisecond format emitted by new Date().toISOString()");
    }
    await writeFile(location,JSON.stringify(record));
    assert.equal((await box.listConfirmedSyntheticBaselines())[0].createdAt,record.createdAt);
  });
});

test("M5 reload refuses corrupt journal and does not invent a new baseline",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("corrupt-reload","content");
    const approval=(await box.preview()).uploadConsents[0];
    await box.approvedUpload({slug:approval.slug,confirmation:approval.confirmation});
    const checkpoint=(await box.listConfirmedSyntheticBaselines())[0];
    const checkpointPath=path.join(journal(box),checkpoint.id+".json");
    await writeFile(checkpointPath,"{invalid");
    await assert.rejects(box.inspectSyntheticBaselineReload(),
      /Invalid M5 checkpoint JSON/);
    assert.equal(await box.readLocalForSyntheticTest("corrupt-reload"),"content");
  });
});

test("M5 reload rejects changes to an inspected source during final journal verification",async()=>{
  for(const changed of ["local","remote","baseline"]){
    await withScratch(async box=>{
      await box.seedLocal("late-reload","approved");
      const consent=(await box.preview()).uploadConsents[0];
      await box.approvedUpload({slug:consent.slug,confirmation:consent.confirmation});
      const evidence=await box.listConfirmedSyntheticBaselines();
      await assert.rejects(box.inspectSyntheticBaselineReload({
        beforeFinalJournalRecheckForSyntheticTest:async()=>{
          if(changed==="local"){
            await writeFile(path.join(box.syntheticWorkspacePath,"notes","late-reload.md"),"late local edit");
          }else if(changed==="remote"){
            await box.mutateRemote("late-reload","late remote edit");
          }else{
            await box.setBaseline([{slug:"late-reload",sha256:sha("older baseline")}]);
          }
        },
      }),/M5 reload source changed during inspection/,changed);
      assert.deepEqual(await box.listConfirmedSyntheticBaselines(),evidence,
        "read-only inspection must preserve journal evidence");
    });
  }
});

test("M5 reload rejects a valid same-name checkpoint rewrite during inspection",async()=>{
  await withScratch(async box=>{
    await box.seedLocal("tamper-reload","approved");
    const consent=(await box.preview()).uploadConsents[0];
    await box.approvedUpload({slug:consent.slug,confirmation:consent.confirmation});
    const original=(await box.listConfirmedSyntheticBaselines())[0];
    const location=path.join(journal(box),original.id+".json");
    await assert.rejects(box.inspectSyntheticBaselineReload({
      beforeFinalJournalRecheckForSyntheticTest:async()=>{
        // File names and count stay unchanged, but the checkpoint contents
        // have been replaced with another well-formed (untrusted) record.
        await writeFile(location,JSON.stringify({
          ...original,sha256:"0".repeat(64),
        }));
      },
    }),/M5 reload journal changed during inspection/);
    assert.equal(await box.readLocalForSyntheticTest("tamper-reload"),"approved");
    assert.equal((await readdir(journal(box))).length,1);
    assert.equal((await box.preview()).plan.decisions[0].choice,"unchanged",
      "a rejected reload must never change the in-memory baseline");
  });
});
