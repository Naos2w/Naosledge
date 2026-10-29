import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,readFile,readdir,writeFile,rm,open,mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {
  adoptProductionM8EqualPairing,inspectProductionM8Baseline,
  recordVerifiedProductionM8DownloadReplace,
} from "../lib/obsidian-m8-production-baseline-journal.ts";
import {downloadProductionReplaceOnce}
  from "../lib/obsidian-m8-production-incoming-replace.ts";
import {inspectM8ProductionReplacePending,acknowledgeM8ProductionReplace}
  from "../lib/obsidian-m8-production-incoming-replace-recovery.ts";
import {executeApprovedM8ProductionReplaceOnce}
  from "../lib/obsidian-m8-production-incoming-replace-one-shot.ts";
import {readObsidianLocalManifest} from "../lib/obsidian-local-manifest.ts";
import {fetchProductionOwnerRlsFingerprints}
  from "../lib/obsidian-m8-production-inventory-readonly.ts";
import {planAutomaticObsidianSync}
  from "../lib/obsidian-auto-sync-policy.ts";
import {serializeObsidianMarkdown}
  from "../lib/obsidian-markdown.ts";
import {RELEASE_DATA_API_URL,RELEASE_NEON_BRANCH}
  from "../lib/neon/production-release.ts";

const OWNER="00000000-0000-4000-8000-000000000041";
const OTHER="00000000-0000-4000-8000-000000000099";
const JWT=(sub=OWNER)=>"eyJhbGciOiJIUzI1NiJ9."+
  Buffer.from(JSON.stringify({sub,exp:Math.floor(Date.now()/1000)+3600}))
    .toString("base64url")+".syntheticsignature";
const slug="replace-synthetic";
const id="00000000-0000-4000-8000-000000000071";
const date="2026-10-29";
const oldTimestamp="2026-10-29T02:00:00Z";
const newTimestamp="2026-10-29T03:00:00Z";
const record=(body,time)=>({
  id,slug,title:"M8 replace test",summary:"synthetic",
  content_md:body,category:"test",tags:[],
  learned_on:date,updated_at:time,
});
const oldRow=record("# Old local\n\n[[old-link]]",oldTimestamp);
const newRow=record("# New remote\n\n[[new-link]]",newTimestamp);
const markdown=row=>serializeObsidianMarkdown({
  title:row.title,slug:row.slug,excerpt:row.summary,
  content_md:row.content_md,category:row.category,tags:row.tags,
  learned_on:row.learned_on,
});
const oldBytes=markdown(oldRow);
const newBytes=markdown(newRow);
const sha=data=>createHash("sha256").update(data).digest("hex");
const oldSha=sha(oldBytes),newSha=sha(newBytes);
const newRevision=sha(id+":"+newTimestamp);
const reply=(payload,range)=>new Response(JSON.stringify(payload),{
  status:200,headers:{"content-type":"application/json",
    "content-range":range},
});
function fakeOwner(){
  let row={...oldRow},requests=0,posts=0;
  const fetcher=async(url,options)=>{
    requests++;
    const parsed=new URL(url);
    assert.equal(parsed.origin,new URL(RELEASE_DATA_API_URL).origin);
    assert.equal(options.method,"GET");
    assert.equal(options.redirect,"manual");
    assert.equal(options.credentials,"omit");
    const auth=options.headers.Authorization;
    assert.match(auth,/^Bearer /);
    const payload=JSON.parse(Buffer.from(auth.slice(7).split(".")[1],"base64url"));
    if(parsed.pathname.endsWith("/blog_admins")){
      return reply(payload.sub===OWNER?[{user_id:OWNER}]:[],
        payload.sub===OWNER?"0-0/1":"*/0");
    }
    if(!parsed.pathname.endsWith("/knowledge_notes"))
      throw Error("Unexpected test endpoint");
    return reply([{...row}],"0-0/1");
  };
  return {fetcher,
    get requests(){return requests;},get posts(){return posts;},
    setRow:value=>{row={...value};},
    get row(){return row},
  };
}
const protector={
  seal:async b=>b.toString("base64"),
  unseal:async txt=>Buffer.from(txt,"base64"),
};
const trust={
  initialPairingApproved:true,durableBaselineVerified:true,
  ownerSessionFresh:true,productionSchemaReady:true,
};
async function withFixture(run){
  const vault=await mkdtemp(path.join(tmpdir(),"naosledge-m8-vault-test-"));
  const privateRoot=await mkdtemp(path.join(tmpdir(),"naosledge-m8-incoming-test-"));
  const archiveRoot=await mkdtemp(path.join(tmpdir(),"naosledge-m8-backups-test-"));
  const journal=await mkdtemp(path.join(tmpdir(),"naosledge-m8-production-baseline-test-"));
  const options={testRoot:journal,testProtector:protector,
    testReadLocal:()=>readObsidianLocalManifest(vault)};
  try{
    const remote=fakeOwner();
    await writeFile(path.join(vault,slug+".md"),oldBytes);
    await adoptProductionM8EqualPairing({
      ownerJwt:JWT(),fetcher:remote.fetcher,options,
      typedConfirmation:"APPROVE M8 PRODUCTION INITIAL EQUALITY",
    });
    const paired=await inspectProductionM8Baseline({
      ownerJwt:JWT(),fetcher:remote.fetcher,options,
    });
    assert.equal(paired.recordCount,1);
    assert.equal(paired.fingerprints[0].sha256,oldSha);
    remote.setRow(newRow);
    const plan=planAutomaticObsidianSync({
      local:await readObsidianLocalManifest(vault),
      remote:await fetchProductionOwnerRlsFingerprints({
        branchId:RELEASE_NEON_BRANCH,jwt:JWT(),fetcher:remote.fetcher,
      }),
      baseline:paired.fingerprints,trust,
    });
    assert.equal(plan.candidates.length,1);
    assert.equal(plan.candidates[0].action,"download-replace");
    return await run({vault,privateRoot,archiveRoot,journal,options,
      remote,candidate:plan.candidates[0]});
  }finally{
    await rm(vault,{recursive:true,force:true});
    await rm(privateRoot,{recursive:true,force:true});
    await rm(archiveRoot,{recursive:true,force:true});
    await rm(journal,{recursive:true,force:true});
  }
}
const params=(f,extra={})=>({
  branchId:RELEASE_NEON_BRANCH,ownerJwt:JWT(),
  candidate:f.candidate,fetcher:f.remote.fetcher,
  typedConfirmation:"APPROVE M8 PRODUCTION DOWNLOAD-REPLACE "+
    slug+" "+newSha.slice(0,12),
  testOnly:{vaultRoot:f.vault,privateRoot:f.privateRoot,
    journalOptions:f.options},
  ...extra,
});
const proof=receipt=>({
  slug:receipt.slug,sha256:receipt.sha256,
  revision:receipt.revision,
  originalBackupSha256:receipt.originalBackupSha256,
  backupPath:receipt.backupPath,intentPath:receipt.intentPath,
  localReadbackVerified:receipt.localReadbackVerified,
  remoteReadbackVerified:receipt.remoteReadbackVerified,
  baselineSaved:receipt.baselineSaved,
  automaticRetryAllowed:receipt.automaticRetryAllowed,
});
async function journal(f){
  return inspectProductionM8Baseline({
    ownerJwt:JWT(),fetcher:f.remote.fetcher,options:f.options,
  });
}

test("approved replace: durable backup + atomic overwrite + exact Owner-RLS + signed M5 checkpoint survive restart",async()=>{
  await withFixture(async f=>{
    const target=path.join(f.vault,slug+".md");
    const before=await readFile(target,"utf8");
    const receipt=await downloadProductionReplaceOnce(params(f));
    assert.equal(before,oldBytes);
    assert.equal(await readFile(target,"utf8"),newBytes);
    assert.equal(await readFile(receipt.backupPath,"utf8"),oldBytes);
    assert.equal(receipt.originalBackupSha256,oldSha);
    assert.equal(receipt.sha256,newSha);
    assert.equal(receipt.revision,newRevision);
    assert.equal(receipt.localReadbackVerified,true);
    assert.equal(receipt.remoteReadbackVerified,true);
    assert.equal(receipt.baselineSaved,false);
    const intent=JSON.parse(await readFile(receipt.intentPath,"utf8"));
    assert.deepEqual(intent,{
      format:"naosledge.m8.production-incoming-replace.v1",
      branch:RELEASE_NEON_BRANCH,action:"download-replace",
      slug,previousLocalSha256:oldSha,
      remoteSha256:newSha,remoteRevision:newRevision,
    });
    assert.deepEqual(await readdir(f.vault),[slug+".md"]);
    assert.deepEqual((await readdir(path.dirname(receipt.intentPath))).sort(),
      ["incoming-intent.json",slug+".md.bak",
        ...(process.platform==="win32"?["windows-native-original.md.bak"]:[])].sort());
    assert.equal((await journal(f)).recordCount,1);
    const saved=await recordVerifiedProductionM8DownloadReplace({
      ownerJwt:JWT(),fetcher:f.remote.fetcher,options:f.options,
      receipt:proof(receipt),
    });
    assert.deepEqual(saved,{checkpointSaved:true,recordCount:2,autoSyncEnabled:false});
    const loaded=await journal(f);
    assert.deepEqual(loaded.fingerprints,[{
      slug,sha256:newSha,revision:newRevision,
    }]);
    const currentPlan=planAutomaticObsidianSync({
      local:await readObsidianLocalManifest(f.vault),
      remote:await fetchProductionOwnerRlsFingerprints({
        branchId:RELEASE_NEON_BRANCH,jwt:JWT(),fetcher:f.remote.fetcher,
      }),
      baseline:loaded.fingerprints,trust,
    });
    assert.equal(currentPlan.candidates[0].action,"unchanged");
    assert.equal(f.remote.posts,0);
  });
});

test("new-file API cannot overwrite and replacement requires a valid existing source",async()=>{
  await withFixture(async f=>{
    const origin=await readFile(path.join(f.vault,slug+".md"),"utf8");
    for(const diff of [
      {typedConfirmation:""},
      {candidate:{...f.candidate,action:"download-new"}},
      {candidate:{...f.candidate,choice:"review-missing-local"}},
      {candidate:{...f.candidate,expectedLocalSha:null}},
      {candidate:{...f.candidate,expectedRemoteRevision:null}},
      {branchId:"br-quiet-sunset-b4xx4pnx"},
      {ownerJwt:JWT(OTHER)},
    ])await assert.rejects(downloadProductionReplaceOnce(params(f,diff)));
    assert.equal(await readFile(path.join(f.vault,slug+".md"),"utf8"),origin);
    assert.deepEqual(await readdir(f.privateRoot),[]);
    assert.equal(f.remote.posts,0);
  });
});

test("nonmatching or edited local SHA rejects BEFORE creating backup/intent",async()=>{
  await withFixture(async f=>{
    const target=path.join(f.vault,slug+".md");
    await writeFile(target,"# Unrelated user edit\n");
    await assert.rejects(downloadProductionReplaceOnce(params(f)));
    assert.equal(await readFile(target,"utf8"),"# Unrelated user edit\n");
    assert.deepEqual(await readdir(f.privateRoot),[]);
    assert.equal((await journal(f)).recordCount,1);
  });
});

test("external edit between durable backup and atomic rename never gets overwritten",async()=>{
  await withFixture(async f=>{
    const target=path.join(f.vault,slug+".md");
    const input=params(f);
    await assert.rejects(downloadProductionReplaceOnce({
      ...input,testOnly:{...input.testOnly,
        beforeCommitForTest:async()=>writeFile(target,"# Competitor update\n")},
    }));
    assert.equal(await readFile(target,"utf8"),"# Competitor update\n");
    const operations=await readdir(f.privateRoot);
    assert.equal(operations.length,1);
    const files=await readdir(path.join(f.privateRoot,operations[0]));
    assert.deepEqual(files.sort(),["incoming-intent.json",slug+".md.bak"].sort());
    assert.equal(await readFile(path.join(f.privateRoot,operations[0],
      slug+".md.bak"),"utf8"),oldBytes);
    assert.equal((await journal(f)).recordCount,1);
    assert.deepEqual(await readdir(f.vault),[slug+".md"]);
  });
});

test("duplicate concurrent Naosledge operations are serialized by a shared private-root lock",async()=>{
  await withFixture(async f=>{
    const lock=path.join(f.privateRoot,".m8-incoming-new.lock");
    const h=await open(lock,"wx",0o600);
    try{
      await assert.rejects(downloadProductionReplaceOnce(params(f)));
      assert.equal(await readFile(path.join(f.vault,slug+".md"),"utf8"),oldBytes);
      assert.equal(await readFile(lock,"utf8"),"");
      assert.equal((await journal(f)).recordCount,1);
    }finally{await h.close();}
  });
});

test("stale operation records always block any next replacement",async()=>{
  await withFixture(async f=>{
    const op=path.join(f.privateRoot,"op-"+"a".repeat(24));
    await mkdir(op);
    await assert.rejects(downloadProductionReplaceOnce(params(f)));
    assert.equal(await readFile(path.join(f.vault,slug+".md"),"utf8"),oldBytes);
    assert.deepEqual(await readdir(f.privateRoot),["op-"+"a".repeat(24)]);
  });
});

test("M5 rejects falsified backup, misplaced intent, stale revision and duplicate checkpoint",async()=>{
  await withFixture(async f=>{
    const result=await downloadProductionReplaceOnce(params(f));
    const known=proof(result);
    for(const falsified of [
      {...known,sha256:"f".repeat(64)},
      {...known,revision:"f".repeat(64)},
      {...known,originalBackupSha256:"f".repeat(64)},
      {...known,backupPath:path.join(f.vault,"made-up.md.bak")},
      {...known,intentPath:path.join(f.vault,"incoming-intent.json")},
      {...known,localReadbackVerified:false},
      {...known,unknownField:"secret"},
    ]){
      await assert.rejects(recordVerifiedProductionM8DownloadReplace({
        ownerJwt:JWT(),fetcher:f.remote.fetcher,options:f.options,
        receipt:falsified,
      }));
    }
    assert.equal((await journal(f)).recordCount,1);
    const before=await readFile(result.backupPath);
    await writeFile(result.backupPath,Buffer.from("# Tampered backup\n"));
    await assert.rejects(recordVerifiedProductionM8DownloadReplace({
      ownerJwt:JWT(),fetcher:f.remote.fetcher,options:f.options,
      receipt:known,
    }));
    await writeFile(result.backupPath,before);
    const saved=await recordVerifiedProductionM8DownloadReplace({
      ownerJwt:JWT(),fetcher:f.remote.fetcher,options:f.options,
      receipt:known,
    });
    assert.equal(saved.recordCount,2);
    await assert.rejects(recordVerifiedProductionM8DownloadReplace({
      ownerJwt:JWT(),fetcher:f.remote.fetcher,options:f.options,
      receipt:known,
    }));
    assert.equal((await journal(f)).recordCount,2);
  });
});

test("once original M5 was never approved or was bound to a different owner, no live write is possible",async()=>{
  await withFixture(async f=>{
    const input=params(f);
    await assert.rejects(downloadProductionReplaceOnce({
      ...input,testOnly:{...input.testOnly,
        journalOptions:{...f.options,
          testRoot:path.join(f.vault,"not-a-journal")},
      },
    }));
    assert.equal(await readFile(path.join(f.vault,slug+".md"),"utf8"),oldBytes);
    assert.equal(f.remote.posts,0);
  });
});

test("original backup and M5 remain when local swap committed but remote readback fails",async()=>{
  await withFixture(async f=>{
    const target=path.join(f.vault,slug+".md");
    const input=params(f);
    await assert.rejects(downloadProductionReplaceOnce({
      ...input,testOnly:{...input.testOnly,
        afterCommitForTest:async()=>{throw Error("TEST_OUTCOME_LOST");}},
    }),/uncertain/);
    assert.equal(await readFile(target,"utf8"),newBytes);
    assert.equal((await journal(f)).recordCount,1);
    const operations=await readdir(f.privateRoot);
    assert.equal(operations.length,1);
    assert.equal(await readFile(path.join(f.privateRoot,operations[0],
      slug+".md.bak"),"utf8"),oldBytes);
  });
});

test("recovery classifies pending replace and only ACK after signed M5; original backup is archived forever",async()=>{
  await withFixture(async f=>{
    const noPending=await inspectM8ProductionReplacePending({
      testOnly:{vaultRoot:f.vault,privateRoot:f.privateRoot,
        archiveRoot:f.archiveRoot,journalOptions:f.options},
    });
    assert.equal(noPending.pending,false);
    const receipt=await downloadProductionReplaceOnce(params(f));
    const scoped={vaultRoot:f.vault,privateRoot:f.privateRoot,
      archiveRoot:f.archiveRoot,journalOptions:f.options};
    const pending=await inspectM8ProductionReplacePending({testOnly:scoped});
    assert.equal(pending.pending,true);
    assert.equal(pending.state,"applied");
    assert.equal(pending.backupVerified,true);
    assert.equal(pending.sha256,newSha);
    assert.equal(pending.originalBackupSha256,oldSha);
    const args={
      ownerJwt:JWT(),fetcher:f.remote.fetcher,
      typedConfirmation:"ACK M8 PRODUCTION DOWNLOAD-REPLACE "+
        slug+" "+newSha.slice(0,12),
      testOnly:scoped,
    };
    await assert.rejects(acknowledgeM8ProductionReplace(args));
    assert.equal((await readdir(f.privateRoot)).length,1);
    await recordVerifiedProductionM8DownloadReplace({
      ownerJwt:JWT(),fetcher:f.remote.fetcher,options:f.options,
      receipt:proof(receipt),
    });
    await assert.rejects(acknowledgeM8ProductionReplace({
      ...args,typedConfirmation:"ACK ALL",
    }));
    const result=await acknowledgeM8ProductionReplace(args);
    assert.equal(result.acknowledged,true);
    assert.equal(result.durableBackupArchived,true);
    assert.equal(result.localNoteWrites,0);
    assert.equal(result.remoteWrites,0);
    assert.equal(await readFile(result.archivedBackupPath,"utf8"),oldBytes);
    assert.deepEqual(await readdir(f.privateRoot),[]);
    const archived=await readdir(f.archiveRoot);
    assert.equal(archived.length,1);
    assert.deepEqual((await readdir(path.join(f.archiveRoot,archived[0]))).sort(),
      ["incoming-intent.json",slug+".md.bak",
        ...(process.platform==="win32"?["windows-native-original.md.bak"]:[])].sort());
    assert.equal(await readFile(path.join(f.vault,slug+".md"),"utf8"),newBytes);
    const after=await inspectM8ProductionReplacePending({testOnly:scoped});
    assert.equal(after.pending,false);
    await assert.rejects(acknowledgeM8ProductionReplace(args));
  });
});

test("pending recovery exposes not-applied, diverged, missing, or held lock without altering files",async()=>{
  await withFixture(async f=>{
    const input=params(f);
    const target=path.join(f.vault,slug+".md");
    await assert.rejects(downloadProductionReplaceOnce({
      ...input,testOnly:{...input.testOnly,
        beforeCommitForTest:async()=>{throw Error("synthetic interrupted")}},
    }));
    const scoped={vaultRoot:f.vault,privateRoot:f.privateRoot,
      archiveRoot:f.archiveRoot,journalOptions:f.options};
    const before=await inspectM8ProductionReplacePending({testOnly:scoped});
    assert.equal(before.state,"not-applied");
    assert.equal(before.backupVerified,true);
    assert.equal(before.baselineSaved,false);
    assert.equal(await readFile(target,"utf8"),oldBytes);
    await writeFile(target,"# another writer\n");
    const drift=await inspectM8ProductionReplacePending({testOnly:scoped});
    assert.equal(drift.state,"diverged");
    const h=await open(path.join(f.privateRoot,".m8-incoming-new.lock"),"wx");
    try{
      const locked=await inspectM8ProductionReplacePending({testOnly:scoped});
      assert.equal(locked.lockPresent,true);
      await assert.rejects(acknowledgeM8ProductionReplace({
        ownerJwt:JWT(),fetcher:f.remote.fetcher,testOnly:scoped,
        typedConfirmation:"ACK M8 PRODUCTION DOWNLOAD-REPLACE "+
          slug+" "+newSha.slice(0,12),
      }));
    }finally{await h.close();}
    // Unknown changes and durable backup stay available for manual repair.
    assert.equal(await readFile(before.backupPath,"utf8"),oldBytes);
    assert.equal((await journal(f)).recordCount,1);
  });
});

test("tampered replace backup, unrecognized receipt or remote revision drift cannot be ACKed",async()=>{
  await withFixture(async f=>{
    const r=await downloadProductionReplaceOnce(params(f));
    const scoped={vaultRoot:f.vault,privateRoot:f.privateRoot,
      archiveRoot:f.archiveRoot,journalOptions:f.options};
    await recordVerifiedProductionM8DownloadReplace({
      ownerJwt:JWT(),fetcher:f.remote.fetcher,options:f.options,
      receipt:proof(r),
    });
    const ackArgs={
      ownerJwt:JWT(),fetcher:f.remote.fetcher,testOnly:scoped,
      typedConfirmation:"ACK M8 PRODUCTION DOWNLOAD-REPLACE "+
        slug+" "+newSha.slice(0,12),
    };
    const preserved=await readFile(r.backupPath);
    await writeFile(r.backupPath,"# forged backup");
    await assert.rejects(inspectM8ProductionReplacePending({testOnly:scoped}));
    await assert.rejects(acknowledgeM8ProductionReplace(ackArgs));
    await writeFile(r.backupPath,preserved);
    f.remote.setRow({...newRow,updated_at:"2026-10-29T04:00:00Z"});
    await assert.rejects(acknowledgeM8ProductionReplace(ackArgs));
    assert.equal((await readdir(f.privateRoot)).length,1);
    assert.deepEqual(await readdir(f.archiveRoot),[]);
    assert.equal(await readFile(path.join(f.vault,slug+".md"),"utf8"),newBytes);
  });
});

test("backup archives cannot be placed into a real Vault using testOnly escape",async()=>{
  await withFixture(async f=>{
    const scoped={
      vaultRoot:f.vault,privateRoot:f.privateRoot,
      archiveRoot:"C:\\Naos\\Obsidian\\Naosledge",
      journalOptions:f.options,
    };
    await assert.rejects(inspectM8ProductionReplacePending({
      testOnly:scoped,
    }));
    assert.deepEqual(await readdir(f.archiveRoot),[]);
  });
});

test("approved one-shot replacement completes M5 and ARCHIVES old backup without touching Neon",async()=>{
  await withFixture(async f=>{
    const input=params(f);
    const result=await executeApprovedM8ProductionReplaceOnce({
      branchId:RELEASE_NEON_BRANCH,ownerJwt:JWT(),
      candidate:f.candidate,fetcher:f.remote.fetcher,
      replaceConfirmation:input.typedConfirmation,
      archiveConfirmation:"ACK M8 PRODUCTION DOWNLOAD-REPLACE "+
        slug+" "+newSha.slice(0,12),
      testOnly:{vaultRoot:f.vault,privateRoot:f.privateRoot,
        archiveRoot:f.archiveRoot,journalOptions:f.options},
    });
    assert.deepEqual({
      slug:result.slug,sha256:result.sha256,revision:result.revision,
      checkpointSaved:result.checkpointSaved,backupArchived:result.backupArchived,
      automaticTransferStarted:result.automaticTransferStarted,
      automaticRetryAllowed:result.automaticRetryAllowed,
    },{
      slug,sha256:newSha,revision:newRevision,
      checkpointSaved:true,backupArchived:true,
      automaticTransferStarted:false,automaticRetryAllowed:false,
    });
    assert.equal(await readFile(result.archivedBackupPath,"utf8"),oldBytes);
    assert.equal(await readFile(path.join(f.vault,slug+".md"),"utf8"),newBytes);
    assert.equal((await journal(f)).recordCount,2);
    assert.deepEqual(await readdir(f.privateRoot),[]);
    assert.equal(f.remote.posts,0);
    await assert.rejects(executeApprovedM8ProductionReplaceOnce({
      branchId:RELEASE_NEON_BRANCH,ownerJwt:JWT(),
      candidate:f.candidate,fetcher:f.remote.fetcher,
      replaceConfirmation:input.typedConfirmation,
      archiveConfirmation:"ACK M8 PRODUCTION DOWNLOAD-REPLACE "+
        slug+" "+newSha.slice(0,12),
      testOnly:{vaultRoot:f.vault,privateRoot:f.privateRoot,
        archiveRoot:f.archiveRoot,journalOptions:f.options},
    }));
    assert.equal((await journal(f)).recordCount,2);
  });
});

test("one-shot denies missing ACK approval BEFORE any backup, write or RLS scan",async()=>{
  await withFixture(async f=>{
    const before=f.remote.requests;
    await assert.rejects(executeApprovedM8ProductionReplaceOnce({
      branchId:RELEASE_NEON_BRANCH,ownerJwt:JWT(),
      candidate:f.candidate,fetcher:f.remote.fetcher,
      replaceConfirmation:params(f).typedConfirmation,
      archiveConfirmation:"APPROVE ALL",
      testOnly:{vaultRoot:f.vault,privateRoot:f.privateRoot,
        archiveRoot:f.archiveRoot,journalOptions:f.options},
    }),/two exact Owner approvals/);
    assert.equal(f.remote.requests,before);
    assert.equal(await readFile(path.join(f.vault,slug+".md"),"utf8"),oldBytes);
    assert.deepEqual(await readdir(f.privateRoot),[]);
  });
});

test("one-shot interrupted after atomic rename keeps original backup, pending receipt and OLD M5 baseline",async()=>{
  await withFixture(async f=>{
    await assert.rejects(executeApprovedM8ProductionReplaceOnce({
      branchId:RELEASE_NEON_BRANCH,ownerJwt:JWT(),
      candidate:f.candidate,fetcher:f.remote.fetcher,
      replaceConfirmation:params(f).typedConfirmation,
      archiveConfirmation:"ACK M8 PRODUCTION DOWNLOAD-REPLACE "+
        slug+" "+newSha.slice(0,12),
      testOnly:{vaultRoot:f.vault,privateRoot:f.privateRoot,
        archiveRoot:f.archiveRoot,journalOptions:f.options,
        afterCommitForTest:async()=>{throw Error("synthetic crash");}},
    }),/outcome uncertain/);
    assert.equal(await readFile(path.join(f.vault,slug+".md"),"utf8"),newBytes);
    const state=await inspectM8ProductionReplacePending({
      testOnly:{vaultRoot:f.vault,privateRoot:f.privateRoot,
        archiveRoot:f.archiveRoot,journalOptions:f.options},
    });
    assert.equal(state.state,"applied");
    assert.equal(await readFile(state.backupPath,"utf8"),oldBytes);
    assert.equal((await journal(f)).recordCount,1);
    assert.deepEqual(await readdir(f.archiveRoot),[]);
  });
});

test("replace adapter is not installed into the autonomous watcher or website",async()=>{
  const [agent,web,source]=await Promise.all([
    readFile(new URL("../lib/obsidian-m8-windows-agent-controller.ts",import.meta.url),"utf8"),
    readFile(new URL("../app/vault/sync/page.tsx",import.meta.url),"utf8"),
    readFile(new URL("../lib/obsidian-m8-production-incoming-replace.ts",import.meta.url),"utf8"),
  ]);
  assert.doesNotMatch(agent,/downloadProductionReplaceOnce/);
  assert.doesNotMatch(web,/downloadProductionReplaceOnce/);
  assert.doesNotMatch(source,/method:"POST"|method:"PATCH"|\.rpc\(/);
});
