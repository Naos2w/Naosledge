import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,readFile,readdir,rm,writeFile,open}
  from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {
  adoptProductionM8EqualPairing,inspectProductionM8Baseline,
  recordVerifiedProductionM8DownloadNew,
} from "../lib/obsidian-m8-production-baseline-journal.ts";
import {downloadProductionNewNoteOnce}
  from "../lib/obsidian-m8-production-incoming-new.ts";
import {
  inspectM8ProductionIncomingNewPending,acknowledgeM8ProductionIncomingNew,
} from "../lib/obsidian-m8-production-incoming-recovery.ts";
import {executeApprovedM8ProductionNewDownload}
  from "../lib/obsidian-m8-production-incoming-one-shot.ts";
import {fetchProductionOwnerRlsFingerprints}
  from "../lib/obsidian-m8-production-inventory-readonly.ts";
import {readObsidianLocalManifest}
  from "../lib/obsidian-local-manifest.ts";
import {planAutomaticObsidianSync}
  from "../lib/obsidian-auto-sync-policy.ts";
import {serializeObsidianMarkdown}
  from "../lib/obsidian-markdown.ts";
import {RELEASE_DATA_API_URL,RELEASE_NEON_BRANCH}
  from "../lib/neon/production-release.ts";

const OWNER="00000000-0000-4000-8000-000000000041";
const OTHER="00000000-0000-4000-8000-000000000078";
const JWT=(owner=OWNER)=>"eyJhbGciOiJIUzI1NiJ9."+
  Buffer.from(JSON.stringify({sub:owner,
    exp:Math.floor(Date.now()/1000)+3600})).toString("base64url")+
  ".syntheticsignature";
const hash=v=>createHash("sha256").update(v).digest("hex");
const slug="remote-new-note";
const title="Remote-only synthetic";
const stamp="2026-10-29T03:05:00.000Z";
const id="00000000-0000-4000-8000-000000000071";
const row={
  id,slug,title,summary:"OS Temp acceptance",
  content_md:"# Note from Neon\n\n[[new-note]]",
  category:"test",tags:["p2"],learned_on:"2026-10-29",
  updated_at:stamp,
};
const md=serializeObsidianMarkdown({
  slug,title,excerpt:row.summary,content_md:row.content_md,
  category:row.category,tags:row.tags,learned_on:row.learned_on,
});
const expectedSha=hash(md),expectedRev=hash(id+":"+stamp);
const count=(value,range,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{
    "content-type":"application/json",
    ...(range?{"content-range":range}:{})
  },
});
const protector={
  seal:async key=>key.toString("base64"),
  unseal:async source=>Buffer.from(source,"base64"),
};
function ownerApi(){
  let rows=[],getCount=0,postCount=0;
  const fetcher=async(uri,init)=>{
    const url=new URL(uri);
    assert.equal(url.origin,new URL(RELEASE_DATA_API_URL).origin);
    assert.equal(init.method,"GET");
    getCount++;
    const raw=init.headers.Authorization;
    assert.match(raw,/^Bearer /);
    const ownerId=JSON.parse(Buffer.from(raw.slice(7).split(".")[1],
      "base64url").toString("utf8")).sub;
    if(url.pathname.endsWith("/blog_admins")){
      const granted=ownerId===OWNER;
      return count(granted?[{user_id:OWNER}]:[],"0-0/1");
    }
    if(!url.pathname.endsWith("/knowledge_notes"))
      throw Error("Unreviewed private API");
    const offset=Number(url.searchParams.get("offset")||0);
    const list=url.searchParams.has("slug")?
      rows.filter(x=>x.slug===slug):rows;
    const part=list.slice(offset,offset+20);
    const range=part.length?
      offset+"-"+(offset+part.length-1)+"/"+list.length:"*/0";
    return count(part,range);
  };
  return {
    fetcher,
    get getCount(){return getCount;},
    get postCount(){return postCount;},
    setRows:value=>{rows=value.map(x=>({...x}));},
  };
}
const trust={
  initialPairingApproved:true,durableBaselineVerified:true,
  ownerSessionFresh:true,productionSchemaReady:true,
};
async function withFixture(callback){
  const vault=await mkdtemp(path.join(tmpdir(),"naosledge-m8-vault-test-"));
  const privateRoot=await mkdtemp(path.join(tmpdir(),"naosledge-m8-incoming-test-"));
  const journal=await mkdtemp(path.join(tmpdir(),
    "naosledge-m8-production-baseline-test-"));
  const options={
    testRoot:journal,testProtector:protector,
    testReadLocal:()=>readObsidianLocalManifest(vault),
  };
  try{
    const api=ownerApi();
    await adoptProductionM8EqualPairing({
      ownerJwt:JWT(),
      typedConfirmation:"APPROVE M8 PRODUCTION INITIAL EQUALITY",
      fetcher:api.fetcher,options,
    });
    api.setRows([row]);
    const local=await readObsidianLocalManifest(vault);
    const remote=await fetchProductionOwnerRlsFingerprints({
      branchId:RELEASE_NEON_BRANCH,jwt:JWT(),fetcher:api.fetcher,
    });
    const plan=planAutomaticObsidianSync({
      local,remote,baseline:[],trust,
    });
    assert.equal(plan.candidates[0].action,"download-new");
    return await callback({
      vault,privateRoot,journal,options,api,
      candidate:plan.candidates[0],
    });
  }finally{
    await rm(vault,{recursive:true,force:true});
    await rm(privateRoot,{recursive:true,force:true});
    await rm(journal,{recursive:true,force:true});
  }
}
const params=({vault,privateRoot,options,api,candidate},extra={})=>({
  branchId:RELEASE_NEON_BRANCH,ownerJwt:JWT(),candidate,
  typedConfirmation:"APPROVE M8 PRODUCTION DOWNLOAD-NEW "+
    slug+" "+expectedSha.slice(0,12),
  fetcher:api.fetcher,
  testOnly:{vaultRoot:vault,privateRoot,journalOptions:options},
  ...extra,
});
const checkpointReceipt=r=>({
  slug:r.slug,sha256:r.sha256,revision:r.revision,
  localReadbackVerified:r.localReadbackVerified,
  remoteReadbackVerified:r.remoteReadbackVerified,
  originalBackupSha256:r.originalBackupSha256,
  baselineSaved:r.baselineSaved,
  automaticRetryAllowed:r.automaticRetryAllowed,
  intentPath:r.intentPath,
});

test("signed M5 empty pairing + remote-only download-new + independent signed M5 download checkpoint survives restart",async()=>{
  await withFixture(async fixture=>{
    const previous=await inspectProductionM8Baseline({
      ownerJwt:JWT(),fetcher:fixture.api.fetcher,
      options:fixture.options,
    });
    assert.equal(previous.paired,true);
    assert.equal(previous.fingerprints.length,0);
    const target=path.join(fixture.vault,slug+".md");
    const receipt=await downloadProductionNewNoteOnce(params(fixture));
    assert.equal(await readFile(target,"utf8"),md);
    assert.equal(receipt.localReadbackVerified,true);
    assert.equal(receipt.remoteReadbackVerified,true);
    assert.equal(receipt.originalBackupSha256,null);
    assert.equal(receipt.baselineSaved,false);
    assert.equal(receipt.sha256,expectedSha);
    assert.equal(receipt.revision,expectedRev);
    const intent=JSON.parse(await readFile(receipt.intentPath,"utf8"));
    assert.equal(intent.format,"naosledge.m8.production-incoming-new.v1");
    assert.equal(intent.previousLocalSha256,null);
    assert.equal(intent.remoteSha256,expectedSha);
    assert.equal(intent.remoteRevision,expectedRev);
    assert.deepEqual(await readdir(fixture.vault),[slug+".md"]);
    assert.equal(fixture.api.postCount,0);

    const beforeM5=await inspectProductionM8Baseline({
      ownerJwt:JWT(),fetcher:fixture.api.fetcher,
      options:fixture.options,
    });
    assert.equal(beforeM5.recordCount,1);
    assert.deepEqual(beforeM5.fingerprints,[]);
    const saved=await recordVerifiedProductionM8DownloadNew({
      ownerJwt:JWT(),receipt:checkpointReceipt(receipt),
      fetcher:fixture.api.fetcher,options:fixture.options,
    });
    assert.deepEqual(saved,{
      checkpointSaved:true,recordCount:2,autoSyncEnabled:false,
    });
    const reopened=await inspectProductionM8Baseline({
      ownerJwt:JWT(),fetcher:fixture.api.fetcher,
      options:fixture.options,
    });
    assert.deepEqual(reopened.fingerprints,[{
      slug,sha256:expectedSha,revision:expectedRev,
    }]);
    const finalPlan=planAutomaticObsidianSync({
      local:await readObsidianLocalManifest(fixture.vault),
      remote:await fetchProductionOwnerRlsFingerprints({
        branchId:RELEASE_NEON_BRANCH,jwt:JWT(),fetcher:fixture.api.fetcher,
      }),
      baseline:reopened.fingerprints,trust,
    });
    assert.equal(finalPlan.candidates[0].action,"unchanged");
    assert.equal(finalPlan.autoCandidateCount,0);
    assert.equal(fixture.api.postCount,0,"Incoming is GET only");
  });
});

test("download-new never overwrites a local file that appeared before approval",async()=>{
  await withFixture(async fixture=>{
    const target=path.join(fixture.vault,slug+".md");
    await writeFile(target,"# Other writer\n");
    await assert.rejects(downloadProductionNewNoteOnce(params(fixture)));
    assert.equal(await readFile(target,"utf8"),"# Other writer\n");
    assert.deepEqual(await readdir(fixture.privateRoot),[]);
    assert.equal(fixture.api.postCount,0);
  });
});

test("racing local file creation is rejected, leaves the competing contents and durable intent",async()=>{
  await withFixture(async fixture=>{
    const target=path.join(fixture.vault,slug+".md");
    const original=params(fixture);
    await assert.rejects(downloadProductionNewNoteOnce({
      ...original,
      testOnly:{...original.testOnly,
        beforeCommitForTest:async()=>writeFile(target,"# Race winner\n")},
    }));
    assert.equal(await readFile(target,"utf8"),"# Race winner\n");
    assert.deepEqual(await readdir(fixture.vault),[slug+".md"]);
    const ops=await readdir(fixture.privateRoot);
    assert.equal(ops.length,1);
    assert.match(ops[0],/^op-[a-f0-9]{24}$/);
    assert.deepEqual(await readdir(path.join(fixture.privateRoot,ops[0])),
      ["incoming-intent.json"]);
    assert.equal((await inspectProductionM8Baseline({
      ownerJwt:JWT(),fetcher:fixture.api.fetcher,
      options:fixture.options,
    })).recordCount,1);
  });
});

test("stale operation receipts and locks prevent a second incoming attempt",async()=>{
  await withFixture(async fixture=>{
    const pending=path.join(fixture.privateRoot,"op-"+
      "a".repeat(24));
    await (await import("node:fs/promises")).mkdir(pending);
    await assert.rejects(downloadProductionNewNoteOnce(params(fixture)));
    assert.equal((await readdir(fixture.vault)).length,0);
    assert.deepEqual(await readdir(fixture.privateRoot),
      ["op-"+"a".repeat(24)]);
    const lock=path.join(fixture.privateRoot,".m8-incoming-new.lock");
    const h=await open(lock,"wx");
    try{
      await assert.rejects(downloadProductionNewNoteOnce(params(fixture)));
      assert.equal((await readdir(fixture.vault)).length,0);
    }finally{await h.close();}
  });
});

test("invalid Owner, Sandbox branch, missing signed pairing and invalid per-note confirmation never write to the Vault",async()=>{
  await withFixture(async fixture=>{
    const wrong=[
      {ownerJwt:JWT(OTHER)},
      {branchId:"br-quiet-sunset-b4xx4pnx"},
      {typedConfirmation:""},
      {candidate:{...fixture.candidate,action:"download-replace"}},
      {candidate:{...fixture.candidate,executable:true}},
      {candidate:{...fixture.candidate,expectedLocalSha:"a".repeat(64)}},
      {candidate:{...fixture.candidate,expectedRemoteRevision:null}},
    ];
    for(const change of wrong)
      await assert.rejects(downloadProductionNewNoteOnce(
        params(fixture,change)));
    assert.deepEqual(await readdir(fixture.vault),[]);
    assert.deepEqual(await readdir(fixture.privateRoot),[]);
  });
});

test("M5 rejects unverified, tampered, cross-Owner and duplicate download receipts",async()=>{
  await withFixture(async fixture=>{
    const r=await downloadProductionNewNoteOnce(params(fixture));
    const base=checkpointReceipt(r);
    for(const bad of [
      {...base,localReadbackVerified:false},
      {...base,sha256:"f".repeat(64)},
      {...base,revision:"f".repeat(64)},
      {...base,originalBackupSha256:"f".repeat(64)},
      {...base,automaticRetryAllowed:true},
      {...base,forgedField:"SECRET_JWT"},
    ]){
      await assert.rejects(recordVerifiedProductionM8DownloadNew({
        ownerJwt:JWT(),receipt:bad,fetcher:fixture.api.fetcher,
        options:fixture.options,
      }));
    }
    await assert.rejects(recordVerifiedProductionM8DownloadNew({
      ownerJwt:JWT(OTHER),receipt:base,fetcher:fixture.api.fetcher,
      options:fixture.options,
    }));
    assert.equal((await inspectProductionM8Baseline({
      ownerJwt:JWT(),fetcher:fixture.api.fetcher,
      options:fixture.options,
    })).recordCount,1);
    await recordVerifiedProductionM8DownloadNew({
      ownerJwt:JWT(),receipt:base,fetcher:fixture.api.fetcher,
      options:fixture.options,
    });
    await assert.rejects(recordVerifiedProductionM8DownloadNew({
      ownerJwt:JWT(),receipt:base,fetcher:fixture.api.fetcher,
      options:fixture.options,
    }));
    assert.equal((await inspectProductionM8Baseline({
      ownerJwt:JWT(),fetcher:fixture.api.fetcher,
      options:fixture.options,
    })).recordCount,2);
  });
});

test("M5 independently rejects a tampered or missing durable intent even when both note SHA values match",async()=>{
  await withFixture(async fixture=>{
    const result=await downloadProductionNewNoteOnce(params(fixture));
    const proof=checkpointReceipt(result);
    const original=await readFile(result.intentPath,"utf8");
    await writeFile(result.intentPath,
      JSON.stringify({...JSON.parse(original),remoteSha256:"f".repeat(64)}));
    await assert.rejects(recordVerifiedProductionM8DownloadNew({
      ownerJwt:JWT(),receipt:proof,
      fetcher:fixture.api.fetcher,options:fixture.options,
    }));
    await writeFile(result.intentPath,original);
    await assert.rejects(recordVerifiedProductionM8DownloadNew({
      ownerJwt:JWT(),receipt:{...proof,
        intentPath:path.join(fixture.vault,"forged-incoming-intent.json")},
      fetcher:fixture.api.fetcher,options:fixture.options,
    }));
    assert.equal((await inspectProductionM8Baseline({
      ownerJwt:JWT(),fetcher:fixture.api.fetcher,
      options:fixture.options,
    })).recordCount,1);
    await recordVerifiedProductionM8DownloadNew({
      ownerJwt:JWT(),receipt:proof,fetcher:fixture.api.fetcher,
      options:fixture.options,
    });
    assert.equal((await inspectProductionM8Baseline({
      ownerJwt:JWT(),fetcher:fixture.api.fetcher,
      options:fixture.options,
    })).recordCount,2);
  });
});

test("unregistered Production Vault supplied via testOnly is refused before any local or Neon write",async()=>{
  await withFixture(async fixture=>{
    const input=params(fixture);
    await assert.rejects(downloadProductionNewNoteOnce({
      ...input,
      testOnly:{...input.testOnly,
        vaultRoot:"C:\\Naos\\Obsidian\\Naosledge"},
    }));
    assert.deepEqual(await readdir(fixture.privateRoot),[]);
    assert.deepEqual(await readdir(fixture.vault),[]);
  });
});

test("pending receipt stays until signed M5 checkpoint, then precise ACK clears only that operation",async()=>{
  await withFixture(async fixture=>{
    const noPending=await inspectM8ProductionIncomingNewPending({
      testOnly:params(fixture).testOnly,
    });
    assert.equal(noPending.pending,false);
    const receipt=await downloadProductionNewNoteOnce(params(fixture));
    const pending=await inspectM8ProductionIncomingNewPending({
      testOnly:params(fixture).testOnly,
    });
    assert.equal(pending.pending,true);
    assert.equal(pending.state,"applied");
    assert.equal(pending.sha256,expectedSha);
    assert.equal(pending.revision,expectedRev);
    assert.equal(pending.lockPresent,false);
    assert.equal(pending.automaticRetryAllowed,false);
    const ackArgs={
      ownerJwt:JWT(),fetcher:fixture.api.fetcher,
      typedConfirmation:"ACK M8 PRODUCTION DOWNLOAD-NEW "+
        slug+" "+expectedSha.slice(0,12),
      testOnly:params(fixture).testOnly,
    };
    await assert.rejects(acknowledgeM8ProductionIncomingNew(ackArgs));
    assert.equal((await readdir(fixture.privateRoot)).length,1);
    await recordVerifiedProductionM8DownloadNew({
      ownerJwt:JWT(),receipt:checkpointReceipt(receipt),
      fetcher:fixture.api.fetcher,options:fixture.options,
    });
    await assert.rejects(acknowledgeM8ProductionIncomingNew({
      ...ackArgs,typedConfirmation:"ACK EVERYTHING",
    }));
    const completed=await acknowledgeM8ProductionIncomingNew(ackArgs);
    assert.deepEqual(completed,{
      acknowledged:true,baselineVerified:true,incomingOpsRemaining:0,
      noteWrites:0,automaticTransfersEnabled:false,
    });
    assert.deepEqual(await readdir(fixture.privateRoot),[]);
    assert.equal(await readFile(path.join(fixture.vault,slug+".md"),"utf8"),md);
    assert.equal((await inspectM8ProductionIncomingNewPending({
      testOnly:params(fixture).testOnly,
    })).pending,false);
    await assert.rejects(acknowledgeM8ProductionIncomingNew(ackArgs));
  });
});

test("a damaged durable intent is never silently repaired or acknowledged",async()=>{
  await withFixture(async fixture=>{
    const receipt=await downloadProductionNewNoteOnce(params(fixture));
    const old=await readFile(receipt.intentPath,"utf8");
    for(const corrupted of [
      "{invalid",
      JSON.stringify({...JSON.parse(old),branch:"br-quiet-sunset-b4xx4pnx"}),
      JSON.stringify({...JSON.parse(old),secret:"PRIVATE_JWT"}),
    ]){
      await writeFile(receipt.intentPath,corrupted);
      await assert.rejects(inspectM8ProductionIncomingNewPending({
        testOnly:params(fixture).testOnly,
      }));
    }
    // A syntactically valid but false SHA is NOT certification of a
    // different file; it is a manual-review divergence.
    await writeFile(receipt.intentPath,
      JSON.stringify({...JSON.parse(old),remoteSha256:"f".repeat(64)}));
    const diverged=await inspectM8ProductionIncomingNewPending({
      testOnly:params(fixture).testOnly,
    });
    assert.equal(diverged.state,"diverged");
    assert.equal(diverged.automaticRetryAllowed,false);
    await assert.rejects(acknowledgeM8ProductionIncomingNew({
      ownerJwt:JWT(),fetcher:fixture.api.fetcher,
      typedConfirmation:"ACK M8 PRODUCTION DOWNLOAD-NEW "+
        slug+" "+expectedSha.slice(0,12),
      testOnly:params(fixture).testOnly,
    }));
    assert.equal(await readFile(path.join(fixture.vault,slug+".md"),"utf8"),md);
    assert.equal((await inspectProductionM8Baseline({
      ownerJwt:JWT(),fetcher:fixture.api.fetcher,
      options:fixture.options,
    })).recordCount,1);
  });
});

test("post-download third-party edit is classified as diverged and never acknowledged",async()=>{
  await withFixture(async fixture=>{
    const receipt=await downloadProductionNewNoteOnce(params(fixture));
    await recordVerifiedProductionM8DownloadNew({
      ownerJwt:JWT(),receipt:checkpointReceipt(receipt),
      fetcher:fixture.api.fetcher,options:fixture.options,
    });
    await writeFile(path.join(fixture.vault,slug+".md"),"# Third-party content\n");
    const status=await inspectM8ProductionIncomingNewPending({
      testOnly:params(fixture).testOnly,
    });
    assert.equal(status.state,"diverged");
    await assert.rejects(acknowledgeM8ProductionIncomingNew({
      ownerJwt:JWT(),fetcher:fixture.api.fetcher,
      typedConfirmation:"ACK M8 PRODUCTION DOWNLOAD-NEW "+
        slug+" "+expectedSha.slice(0,12),
      testOnly:params(fixture).testOnly,
    }));
    assert.equal((await readdir(fixture.privateRoot)).length,1);
  });
});

test("remote revision changing after signed M5 prevents cleaning the download receipt",async()=>{
  await withFixture(async fixture=>{
    const receipt=await downloadProductionNewNoteOnce(params(fixture));
    await recordVerifiedProductionM8DownloadNew({
      ownerJwt:JWT(),receipt:checkpointReceipt(receipt),
      fetcher:fixture.api.fetcher,options:fixture.options,
    });
    fixture.api.setRows([{...row,updated_at:"2026-10-29T05:00:00.000Z"}]);
    await assert.rejects(acknowledgeM8ProductionIncomingNew({
      ownerJwt:JWT(),fetcher:fixture.api.fetcher,
      typedConfirmation:"ACK M8 PRODUCTION DOWNLOAD-NEW "+
        slug+" "+expectedSha.slice(0,12),
      testOnly:params(fixture).testOnly,
    }));
    assert.equal((await readdir(fixture.privateRoot)).length,1);
    assert.equal(fixture.api.postCount,0);
  });
});

test("leftover lock after process crash requires manual recovery and is never cleared",async()=>{
  await withFixture(async fixture=>{
    const receipt=await downloadProductionNewNoteOnce(params(fixture));
    const lock=path.join(fixture.privateRoot,".m8-incoming-new.lock");
    const handle=await open(lock,"wx");
    try{
      const pending=await inspectM8ProductionIncomingNewPending({
        testOnly:params(fixture).testOnly,
      });
      assert.equal(pending.pending,true);
      assert.equal(pending.lockPresent,true);
      await assert.rejects(acknowledgeM8ProductionIncomingNew({
        ownerJwt:JWT(),fetcher:fixture.api.fetcher,
        typedConfirmation:"ACK M8 PRODUCTION DOWNLOAD-NEW "+
          slug+" "+expectedSha.slice(0,12),
        testOnly:params(fixture).testOnly,
      }));
      assert.equal(await readFile(receipt.intentPath,"utf8").then(x=>x.length>0),true);
      assert.equal((await readdir(fixture.privateRoot)).length,2);
    }finally{await handle.close();}
  });
});

test("one approved single-note operation composes Incoming -> M5 checkpoint -> ACK without retry",async()=>{
  await withFixture(async fixture=>{
    const input=params(fixture);
    const result=await executeApprovedM8ProductionNewDownload({
      branchId:RELEASE_NEON_BRANCH,
      ownerJwt:JWT(),
      candidate:input.candidate,
      fetcher:fixture.api.fetcher,
      testOnly:input.testOnly,
      downloadConfirmation:input.typedConfirmation,
      acknowledgementConfirmation:"ACK M8 PRODUCTION DOWNLOAD-NEW "+
        slug+" "+expectedSha.slice(0,12),
    });
    assert.deepEqual(result,{
      slug,sha256:expectedSha,revision:expectedRev,
      localReadbackVerified:true,remoteReadbackVerified:true,
      checkpointSaved:true,receiptAcknowledged:true,
      automaticTransferStarted:false,automaticRetryAllowed:false,
      automaticDeletionAllowed:false,
    });
    assert.equal(await readFile(path.join(fixture.vault,slug+".md"),"utf8"),md);
    assert.deepEqual(await readdir(fixture.privateRoot),[]);
    const journal=await inspectProductionM8Baseline({
      ownerJwt:JWT(),fetcher:fixture.api.fetcher,
      options:fixture.options,
    });
    assert.equal(journal.recordCount,2);
    assert.equal(journal.fingerprints[0].sha256,expectedSha);
    assert.equal(fixture.api.postCount,0);
    await assert.rejects(executeApprovedM8ProductionNewDownload({
      branchId:RELEASE_NEON_BRANCH,ownerJwt:JWT(),
      candidate:input.candidate,fetcher:fixture.api.fetcher,
      testOnly:input.testOnly,
      downloadConfirmation:input.typedConfirmation,
      acknowledgementConfirmation:"ACK M8 PRODUCTION DOWNLOAD-NEW "+
        slug+" "+expectedSha.slice(0,12),
    }));
    assert.equal(journal.recordCount,2);
    assert.deepEqual(await readdir(fixture.privateRoot),[]);
  });
});

test("wrong acknowledgement is rejected before ANY note, intent or M5 write",async()=>{
  await withFixture(async fixture=>{
    const input=params(fixture);
    await assert.rejects(executeApprovedM8ProductionNewDownload({
      branchId:RELEASE_NEON_BRANCH,ownerJwt:JWT(),
      candidate:input.candidate,fetcher:fixture.api.fetcher,
      testOnly:input.testOnly,
      downloadConfirmation:input.typedConfirmation,
      acknowledgementConfirmation:"ACK EVERYTHING",
    }),/requires explicit verification/);
    assert.deepEqual(await readdir(fixture.vault),[]);
    assert.deepEqual(await readdir(fixture.privateRoot),[]);
    assert.equal((await inspectProductionM8Baseline({
      ownerJwt:JWT(),fetcher:fixture.api.fetcher,
      options:fixture.options,
    })).recordCount,1);
  });
});

test("incoming adapter never invokes a write API on Neon, or the live Agent automatically",async()=>{
  const files=await Promise.all([
    "../lib/obsidian-m8-production-incoming-new.ts",
    "../lib/obsidian-m8-windows-agent-controller.ts",
  ].map(item=>readFile(new URL(item,import.meta.url),"utf8")));
  assert.doesNotMatch(files[0],/method:"POST"|method:"PATCH"|\.rpc\(|update_knowledge_note/);
  assert.doesNotMatch(files[1],/downloadProductionNewNoteOnce/);
});
