import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,rm,writeFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import path from "node:path";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {previewManualObsidianSync} from "../lib/obsidian-manual-sync-review.ts";
import {chooseReviewIntent,serializeManualM4IncomingIntent} from "../lib/obsidian-m2-review-choices.ts";
import {
  stageNeonSandboxIncoming,verifyStagedSandboxIncomingReceipt,
} from "../lib/obsidian-neon-sandbox-incoming.ts";
import {
  assertM4ReceiptVerificationInvocation,M4_VERIFY_RECEIPT_FLAG,
  M4_VERIFY_RECEIPT_LIVE_FLAG,verifyManualIncomingReceipt,
  verifyManualIncomingReceiptAgainstSandbox,
} from "../scripts/obsidian-m4-sandbox-verify-receipt.ts";
import {
  M4_SCRATCH_INCOMING_FLAG,assertManualM4Invocation,
  readScratchIncomingRequest,stageOneReviewedSandboxIncoming,
} from "../scripts/obsidian-m4-sandbox-manual-incoming.ts";
import {
  NEON_SYNC_SANDBOX_BRANCH,NEON_SYNC_SANDBOX_DATA_API,
} from "../lib/obsidian-neon-sandbox-readonly.ts";

const owner="m4-sandbox-offline-owner";
const jwt="header."+Buffer.from(JSON.stringify({sub:owner})).toString("base64url")+".signature";
const note={
  id:"00000000-0000-4000-8000-000000000017",
  slug:"sample-incoming",title:"Sandbox Incoming",summary:"One note",
  content_md:"## Private test Markdown\n\nKeep both copies",
  category:"筆記",tags:["sandbox"],learned_on:"2026-10-24",
  updated_at:"2026-10-24T12:20:00.000Z",
};
const portable=n=>serializeObsidianMarkdown({
  title:n.title,slug:n.slug,excerpt:n.summary,content_md:n.content_md,
  category:n.category,tags:n.tags,learned_on:n.learned_on,
});
const digest=createHash("sha256").update(portable(note)).digest("hex");
const revision=createHash("sha256").update(note.id+":"+note.updated_at).digest("hex");
const choice={
  slug:note.slug,choice:"conflict",manualReview:true,
  expectedLocalSha:"a".repeat(64),expectedRemoteSha:digest,
  expectedRemoteRevision:revision,
};
const options={
  branchId:NEON_SYNC_SANDBOX_BRANCH,sandboxOwnerJwt:jwt,decision:choice,
  typedConfirmation:"SAVE SANDBOX INCOMING "+note.slug,
};
const json=(v,range=true)=>new Response(JSON.stringify(v),{
  status:200,headers:{"content-type":"application/json",
    ...(range?{"content-range":v.length?"0-"+(v.length-1)+"/"+v.length:"*/0"}:{})},
});
function fakeNetwork({ownerGranted=true,changedSingle=false,wrongRange=false}={}){
  const calls=[];
  async function fetcher(url,opts){
    const target=new URL(url);
    assert.equal(target.origin,new URL(NEON_SYNC_SANDBOX_DATA_API).origin);
    assert.equal(opts.method,"GET");
    assert.equal(opts.cache,"no-store");
    assert.equal(opts.redirect,"manual");
    assert.equal(opts.credentials,"omit");
    assert.equal(opts.headers.Authorization,"Bearer "+jwt);
    calls.push(target.pathname);
    if(target.pathname.endsWith("/blog_admins")){
      return json(ownerGranted?[{user_id:owner}]:[],false);
    }
    assert.ok(target.pathname.endsWith("/knowledge_notes"));
    assert.equal(opts.headers.Prefer,"count=exact");
    if(target.searchParams.has("slug")){
      assert.equal(target.searchParams.get("slug"),"eq."+note.slug);
      assert.equal(target.searchParams.get("limit"),"2");
      const response=json([{...note,content_md:changedSingle?"Different":note.content_md}]);
      if(wrongRange)response.headers.set("content-range","0-0/2");
      return response;
    }
    assert.equal(target.searchParams.get("limit"),"21");
    return json([note]);
  }
  return {fetcher,calls};
}

test("M4 copies exactly one Owner-RLS Sandbox note into a new temp Incoming directory; conflict never overwrites",async()=>{
  const n=fakeNetwork();
  const first=await stageNeonSandboxIncoming({...options,fetcher:n.fetcher});
  try{
    const staged=await readFile(first.path);
    assert.equal(staged.toString("utf8"),portable(note));
    assert.equal(createHash("sha256").update(staged).digest("hex"),digest,
      "success receipt must describe the persisted Incoming bytes");
    assert.equal(path.basename(first.path),note.slug+".md");
    assert.ok(first.path.startsWith(tmpdir()));
    assert.deepEqual({originalModified:first.originalModified,baselineSaved:first.baselineSaved},
      {originalModified:false,baselineSaved:false});
    assert.equal(first.sha256,digest);
    assert.equal(first.revision,revision);
    assert.deepEqual(n.calls,[
      "/neondb/rest/v1/blog_admins",
      "/neondb/rest/v1/knowledge_notes",
      "/neondb/rest/v1/knowledge_notes",
    ]);
    const second=await stageNeonSandboxIncoming({...options,fetcher:n.fetcher});
    try{
      assert.notEqual(first.path,second.path);
      assert.equal(await readFile(second.path,"utf8"),portable(note));
      assert.equal(await readFile(first.path,"utf8"),portable(note));
    }finally{
      await rm(path.dirname(second.path),{recursive:true,force:true});
    }
  }finally{
    await rm(path.dirname(first.path),{recursive:true,force:true});
  }
});

test("M4/M5 keeps an independently hash-verified local+remote conflict pair without reading or writing a Vault",async()=>{
  const localMarkdown="## Earlier local version\r\n\r\n保留本地版本\r\n";
  const localSha=createHash("sha256").update(localMarkdown).digest("hex");
  const decision={...choice,expectedLocalSha:localSha};
  const payload={sandboxOwnerJwt:jwt,decision,
    typedConfirmation:"SAVE SANDBOX INCOMING "+note.slug,localMarkdown};
  const request=await readScratchIncomingRequest([JSON.stringify(payload)]);
  const network=fakeNetwork();
  const result=await stageOneReviewedSandboxIncoming(request,network.fetcher);
  try{
    assert.ok(result.localCopyPath,"manual M4 returns a second independently saved snapshot");
    assert.equal(path.dirname(result.path),path.dirname(result.localCopyPath));
    assert.equal(path.basename(result.path),note.slug+".md");
    assert.equal(path.basename(result.localCopyPath),note.slug+"--local.md");
    assert.equal(await readFile(result.path,"utf8"),portable(note));
    assert.equal(await readFile(result.localCopyPath,"utf8"),localMarkdown);
    assert.equal(createHash("sha256").update(await readFile(result.localCopyPath))
      .digest("hex"),localSha);
    assert.deepEqual({originalModified:result.originalModified,baselineSaved:result.baselineSaved},
      {originalModified:false,baselineSaved:false});
    assert.equal(network.calls.length,3);
  }finally{
    await rm(path.dirname(result.path),{recursive:true,force:true});
  }

  const badNetwork=fakeNetwork();
  await assert.rejects(stageNeonSandboxIncoming({
    ...options,decision,localMarkdown:localMarkdown+"changed",fetcher:badNetwork.fetcher,
  }),/local conflict snapshot differs/);
  assert.equal(badNetwork.calls.length,0,"mismatched local bytes must abort before GET");
  await assert.rejects(readScratchIncomingRequest([JSON.stringify({
    ...payload,decision:{...decision,choice:"review-download"},
  })]),/only accepted for one reviewed conflict/);
  await assert.rejects(readScratchIncomingRequest([JSON.stringify({
    ...payload,localMarkdown:"x".repeat(250_001),
  })]),/only accepted for one reviewed conflict/);
  await assert.rejects(readScratchIncomingRequest([JSON.stringify({
    ...payload,filename:"C:\\\\Naos\\\\Obsidian",
  })]),/exactly one reviewed note/);
});

test("M4 rejects missing consent or upload direction before any network or filesystem work",async()=>{
  const n=fakeNetwork();
  await assert.rejects(stageNeonSandboxIncoming({
    ...options,typedConfirmation:"",fetcher:n.fetcher,
  }),/per-note Incoming confirmation/);
  await assert.rejects(stageNeonSandboxIncoming({
    ...options,decision:{...choice,choice:"review-upload"},fetcher:n.fetcher,
  }),/per-note Incoming confirmation/);
  await assert.rejects(stageNeonSandboxIncoming({
    ...options,decision:{...choice,expectedRemoteRevision:null},fetcher:n.fetcher,
  }),/per-note Incoming confirmation/);
  assert.equal(n.calls.length,0);
});

test("M4 staging independently rejects contradictory M2 decisions before Owner GET",async()=>{
  const network=fakeNetwork();
  const invalid=[
    {...choice,expectedLocalSha:null}, // conflict requires two present versions
    {...choice,expectedLocalSha:"not-a-sha"},
    {...choice,expectedLocalSha:digest}, // equal SHA belongs to unchanged
    {...choice,choice:"review-download",expectedLocalSha:null},
    {...choice,choice:"review-missing-local",expectedLocalSha:"a".repeat(64)},
    {...choice,choice:"review-missing-local",expectedLocalSha:null,path:"injected"},
  ];
  for(const decision of invalid){
    await assert.rejects(stageNeonSandboxIncoming({
      ...options,decision,fetcher:network.fetcher,
    }),/per-note Incoming confirmation/);
  }
  assert.equal(network.calls.length,0);
});

test("M4 stage accepts consistent reviewed download and missing-local decisions",async()=>{
  const network=fakeNetwork();
  for(const decision of [
    {...choice,choice:"review-download"},
    {...choice,choice:"review-missing-local",expectedLocalSha:null},
  ]){
    const result=await stageNeonSandboxIncoming({
      ...options,decision,fetcher:network.fetcher,
    });
    try{assert.equal(await readFile(result.path,"utf8"),portable(note));}
    finally{await rm(path.dirname(result.path),{recursive:true,force:true});}
  }
  assert.equal(network.calls.length,6);
});

test("M4 rejects absent Owner grant and stale remote content before staging",async()=>{
  const noOwner=fakeNetwork({ownerGranted:false});
  await assert.rejects(stageNeonSandboxIncoming({...options,fetcher:noOwner.fetcher}),/Owner RLS grant/);
  assert.equal(noOwner.calls.length,1);
  const changed=fakeNetwork({changedSingle:true});
  await assert.rejects(stageNeonSandboxIncoming({...options,fetcher:changed.fetcher}),/changed after/);
  const incomplete=fakeNetwork({wrongRange:true});
  await assert.rejects(stageNeonSandboxIncoming({...options,fetcher:incomplete.fetcher}),/unavailable or incomplete/);
});

test("M4 MSI manual Incoming entry requires explicit flag, approved host and stdin pipe",async()=>{
  assertManualM4Invocation("win32","MSI",[M4_SCRATCH_INCOMING_FLAG],false);
  for(const bad of [
    ["linux","MSI",[M4_SCRATCH_INCOMING_FLAG],false],
    ["win32","OTHER",[M4_SCRATCH_INCOMING_FLAG],false],
    ["win32","MSI",[],false],
    ["win32","MSI",[M4_SCRATCH_INCOMING_FLAG],true],
  ]){
    assert.throws(()=>assertManualM4Invocation(...bad),/piped manual Incoming/);
  }
  const request={sandboxOwnerJwt:jwt,decision:choice,
    typedConfirmation:"SAVE SANDBOX INCOMING "+note.slug};
  await assert.rejects(readScratchIncomingRequest(["not-json"]),/must be JSON/);
  await assert.rejects(readScratchIncomingRequest(["x".repeat(500_001)]),/too large/);
  await assert.rejects(readScratchIncomingRequest([JSON.stringify({
    ...request,destination:"C:\\Naos\\Obsidian\\Naosledge",
  })]),/local snapshot|exactly one reviewed note/);
  await assert.rejects(readScratchIncomingRequest([JSON.stringify({
    ...request,decision:{...choice,path:"untrusted"},
  })]),/input is invalid/);
  await assert.rejects(readScratchIncomingRequest([JSON.stringify({
    ...request,typedConfirmation:"",
  })]),/per-note read-only decision/);
  await assert.rejects(readScratchIncomingRequest([JSON.stringify({
    ...request,decision:{...choice,choice:"review-upload"},
  })]),/per-note read-only decision/);
});

test("M2 browser handoff is consumed intact by M4 MSI and stages a verified Incoming file",async()=>{
  const preview=await previewManualObsidianSync({
    baseline:[],
    readLocal:async()=>({
      fingerprints:[{slug:note.slug,sha256:"a".repeat(64)}],
      unsupportedMarkdownFiles:0,otherFiles:0,directoriesNotScanned:0,
      autoApplyAllowed:false,
    }),
    readRemote:async()=>({
      fingerprints:[{slug:note.slug,sha256:digest,revision}],
      numberOfNotes:1,sandboxOnly:true,rlsEnforcedByDataApi:true,
      writeEnabled:false,fullInventory:true,
    }),
  });
  const selected=chooseReviewIntent(preview,{},note.slug,"keep-both");
  const handoff=JSON.parse(serializeManualM4IncomingIntent(preview,selected,note.slug));
  const payload={sandboxOwnerJwt:jwt,handoff,
    typedConfirmation:"SAVE SANDBOX INCOMING "+note.slug};
  const request=await readScratchIncomingRequest([JSON.stringify(payload)]);
  assert.deepEqual(request.decision,choice);
  assert.equal(request.sandboxOwnerJwt,jwt);
  const network=fakeNetwork();
  const staged=await stageOneReviewedSandboxIncoming(request,network.fetcher);
  try{
    const bytes=await readFile(staged.path);
    assert.equal(createHash("sha256").update(bytes).digest("hex"),digest);
    assert.equal(bytes.toString("utf8"),portable(note));
    assert.equal(staged.originalModified,false);
    assert.equal(staged.baselineSaved,false);
    assert.equal(network.calls.length,3);
  }finally{
    await rm(path.dirname(staged.path),{recursive:true,force:true});
  }

  for(const tampered of [
    {...handoff,format:"wrong-format"},
    {...handoff,markdown:"private"},
    {...handoff,decision:{...handoff.decision,destination:"C:/Vault"}},
    {...handoff,decision:{...handoff.decision,expectedRemoteSha:"0".repeat(64),
      expectedLocalSha:"0".repeat(64)}},
  ]){
    await assert.rejects(readScratchIncomingRequest([
      JSON.stringify({...payload,handoff:tampered}),
    ]),/M4 Incoming/);
  }
  await assert.rejects(readScratchIncomingRequest([
    JSON.stringify({...payload,decision:choice}),
  ]),/exactly one reviewed note/);
});

test("M2 handoff plus conflict localMarkdown preserves both copies and a verified receipt",async()=>{
  const localMarkdown="## Independently reviewed local version\n\nLocal edits kept.";
  const localSha=createHash("sha256").update(localMarkdown).digest("hex");
  const preview=await previewManualObsidianSync({
    baseline:[],
    readLocal:async()=>({
      fingerprints:[{slug:note.slug,sha256:localSha}],
      unsupportedMarkdownFiles:0,otherFiles:0,directoriesNotScanned:0,
      autoApplyAllowed:false,
    }),
    readRemote:async()=>({
      fingerprints:[{slug:note.slug,sha256:digest,revision}],
      numberOfNotes:1,sandboxOnly:true,rlsEnforcedByDataApi:true,
      writeEnabled:false,fullInventory:true,
    }),
  });
  const selected=chooseReviewIntent(preview,{},note.slug,"keep-both");
  const handoff=JSON.parse(serializeManualM4IncomingIntent(preview,selected,note.slug));
  const payload={sandboxOwnerJwt:jwt,handoff,
    typedConfirmation:"SAVE SANDBOX INCOMING "+note.slug,localMarkdown};
  const request=await readScratchIncomingRequest([JSON.stringify(payload)]);
  assert.equal(request.localMarkdown,localMarkdown);
  assert.equal(request.decision.expectedLocalSha,localSha);
  const network=fakeNetwork();
  const staged=await stageOneReviewedSandboxIncoming(request,network.fetcher);
  try{
    assert.ok(staged.localCopyPath);
    assert.equal(await readFile(staged.path,"utf8"),portable(note));
    assert.equal(await readFile(staged.localCopyPath,"utf8"),localMarkdown);
    const receipt=await verifyStagedSandboxIncomingReceipt(staged.receiptPath);
    assert.equal(receipt.localCopyPath,staged.localCopyPath);
    assert.equal(receipt.sha256,digest);
    assert.equal(receipt.baselineSaved,false);
    assert.equal(network.calls.length,3);
  }finally{
    await rm(path.dirname(staged.path),{recursive:true,force:true});
  }
  const rejected=fakeNetwork();
  await assert.rejects(stageOneReviewedSandboxIncoming({
    ...request,localMarkdown:localMarkdown+" altered",
  },rejected.fetcher),/local conflict snapshot differs/);
  assert.equal(rejected.calls.length,0);
});

test("M4 MSI manual request creates one private Scratch Incoming copy with no original write",async()=>{
  const request=await readScratchIncomingRequest([JSON.stringify({
    sandboxOwnerJwt:jwt,decision:choice,
    typedConfirmation:"SAVE SANDBOX INCOMING "+note.slug,
  })]);
  const n=fakeNetwork();
  const result=await stageOneReviewedSandboxIncoming(request,n.fetcher);
  try{
    assert.equal(await readFile(result.path,"utf8"),portable(note));
    assert.equal(path.basename(result.path),note.slug+".md");
    assert.deepEqual({
      originalModified:result.originalModified,baselineSaved:result.baselineSaved,
    },{originalModified:false,baselineSaved:false});
    assert.equal(n.calls.length,3);
  }finally{
    await rm(path.dirname(result.path),{recursive:true,force:true});
  }
  const denied=fakeNetwork();
  await assert.rejects(stageOneReviewedSandboxIncoming({
    ...request,typedConfirmation:"not approved",
  },denied.fetcher),/per-note Incoming confirmation/);
  assert.deepEqual(denied.calls,[]);
});


test("M4 Incoming writes a self-described receipt and independently checks scratch bytes after process exit",async()=>{
  assertM4ReceiptVerificationInvocation("win32","MSI",[M4_VERIFY_RECEIPT_FLAG],false);
  assert.throws(()=>assertM4ReceiptVerificationInvocation(
    "linux","MSI",[M4_VERIFY_RECEIPT_FLAG],false,
  ),/MSI-only/);
  const network=fakeNetwork();
  const staged=await stageNeonSandboxIncoming({...options,fetcher:network.fetcher});
  try{
    assert.equal(path.basename(staged.receiptPath),"incoming-receipt.json");
    const saved=await readFile(staged.receiptPath,"utf8");
    assert.equal(saved.includes(jwt),false,"no credential in local receipt");
    assert.equal(saved.includes(note.content_md),false,"no Markdown in receipt");
    const inspected=await verifyStagedSandboxIncomingReceipt(staged.receiptPath);
    assert.deepEqual(inspected,{
      remoteCopyPath:staged.path,localCopyPath:null,
      sha256:digest,revision,baselineSaved:false,
      verificationScope:"staged-files-only",
    });
    assert.deepEqual(await verifyManualIncomingReceipt([staged.receiptPath]),{
      localCopyIncluded:false,baselineSaved:false,
      verificationScope:"staged-files-only",
    });
    const moduleUrl=new URL("../lib/obsidian-neon-sandbox-incoming.ts",import.meta.url).href;
    const code=`import {verifyStagedSandboxIncomingReceipt as verify} from ${JSON.stringify(moduleUrl)}; const result=await verify(process.argv[1]); if(result.baselineSaved!==false||result.verificationScope!=="staged-files-only")process.exit(2);`;
    const child=spawnSync(process.execPath,[
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--input-type=module","-e",code,staged.receiptPath,
    ],{encoding:"utf8",timeout:20000});
    assert.equal(child.status,0,child.stderr,"a fresh Node process can recheck persisted copy bytes");
    assert.equal(network.calls.length,3,"reinspection never performs another Owner GET");
    await writeFile(staged.path,portable(note)+"modified");
    await assert.rejects(verifyStagedSandboxIncomingReceipt(staged.receiptPath),
      /no longer matches/);
  }finally{
    await rm(path.dirname(staged.path),{recursive:true,force:true});
  }
});

test("M4 receipt reinspection checks both conflict snapshots and detects missing evidence",async()=>{
  const localMarkdown="## Local independently preserved\\n";
  const localSha=createHash("sha256").update(localMarkdown).digest("hex");
  const staged=await stageNeonSandboxIncoming({
    ...options,decision:{...choice,expectedLocalSha:localSha},localMarkdown,
    fetcher:fakeNetwork().fetcher,
  });
  try{
    const result=await verifyStagedSandboxIncomingReceipt(staged.receiptPath);
    assert.equal(result.localCopyPath,staged.localCopyPath);
    assert.equal((await verifyManualIncomingReceipt([staged.receiptPath])).localCopyIncluded,true);
    await writeFile(staged.localCopyPath,"changed");
    await assert.rejects(verifyStagedSandboxIncomingReceipt(staged.receiptPath),
      /no longer matches/);
  }finally{
    await rm(path.dirname(staged.path),{recursive:true,force:true});
  }
  await assert.rejects(verifyManualIncomingReceipt(["C:\\\\Naos\\\\Obsidian\\\\Naosledge\\\\x.json"]));
});

test("M4/M5 restart preflight revalidates a saved conflict pair against fresh Sandbox Owner-RLS GET",async()=>{
  assertM4ReceiptVerificationInvocation("win32","MSI",[M4_VERIFY_RECEIPT_LIVE_FLAG],false);
  assert.throws(()=>assertM4ReceiptVerificationInvocation(
    "win32","OTHER",[M4_VERIFY_RECEIPT_LIVE_FLAG],false,
  ),/MSI-only/);
  const localMarkdown="## Preserved local conflict\\n";
  const expectedLocalSha=createHash("sha256").update(localMarkdown).digest("hex");
  const staged=await stageNeonSandboxIncoming({
    ...options,decision:{...choice,expectedLocalSha},
    localMarkdown,fetcher:fakeNetwork().fetcher,
  });
  const request={receiptPath:staged.receiptPath,sandboxOwnerJwt:jwt,
    typedConfirmation:"VERIFY SANDBOX INCOMING "+note.slug};
  try{
    const n=fakeNetwork();
    assert.deepEqual(await verifyManualIncomingReceiptAgainstSandbox(
      [JSON.stringify(request)],n.fetcher,
    ),{localCopyIncluded:true,baselineSaved:false,
      verificationScope:"staged-files-and-sandbox-owner-rls-get"});
    assert.equal(n.calls.length,3,"fresh read requires Owner grant, complete list and exact note");
    const stale=fakeNetwork({changedSingle:true});
    await assert.rejects(verifyManualIncomingReceiptAgainstSandbox(
      [JSON.stringify(request)],stale.fetcher,
    ),/changed after/);
    const revoked=fakeNetwork({ownerGranted:false});
    await assert.rejects(verifyManualIncomingReceiptAgainstSandbox(
      [JSON.stringify(request)],revoked.fetcher,
    ),/Owner RLS grant/);
    assert.equal(revoked.calls.length,1);
    for(const invalid of [
      {...request,typedConfirmation:""},
      {...request,arbitraryDestination:"C:/Vault"},
      {...request,sandboxOwnerJwt:"not-a-jwt"},
    ]){
      const n=fakeNetwork();
      await assert.rejects(verifyManualIncomingReceiptAgainstSandbox(
        [JSON.stringify(invalid)],n.fetcher,
      ));
      assert.equal(n.calls.length,0,"invalid consent cannot contact Sandbox");
    }
    assert.equal((await readFile(staged.localCopyPath,"utf8")),localMarkdown,
      "read-only preflight must not alter conflict copy");
  }finally{
    await rm(path.dirname(staged.path),{recursive:true,force:true});
  }
});

test("M4/M5 live recheck refuses Incoming files changed while Owner GET was in flight",async()=>{
  const staged=await stageNeonSandboxIncoming({...options,fetcher:fakeNetwork().fetcher});
  const request={receiptPath:staged.receiptPath,sandboxOwnerJwt:jwt,
    typedConfirmation:"VERIFY SANDBOX INCOMING "+note.slug};
  const n=fakeNetwork();
  try{
    await assert.rejects(verifyManualIncomingReceiptAgainstSandbox(
      [JSON.stringify(request)],async(url,opts)=>{
        const response=await n.fetcher(url,opts);
        if(new URL(url).searchParams.has("slug")){
          await writeFile(staged.path,"changed while checking remote");
        }
        return response;
      },
    ),/no longer matches/);
    assert.equal(n.calls.length,3);
  }finally{
    await rm(path.dirname(staged.path),{recursive:true,force:true});
  }
});

test("M4 keeps the approved filename and fingerprints when the caller mutates its decision during GET",async()=>{
  const decision={...choice};
  const n=fakeNetwork();
  const result=await stageNeonSandboxIncoming({
    ...options,decision,
    fetcher:async(url,opts)=>{
      decision.slug="different-note";
      decision.expectedRemoteSha="b".repeat(64);
      decision.expectedRemoteRevision="c".repeat(64);
      return n.fetcher(url,opts);
    },
  });
  try{
    assert.equal(path.basename(result.path),note.slug+".md");
    assert.equal(await readFile(result.path,"utf8"),portable(note));
    assert.equal(result.sha256,digest);
    assert.equal(result.revision,revision);
    assert.equal(n.calls.length,3);
  }finally{
    await rm(path.dirname(result.path),{recursive:true,force:true});
  }
});
