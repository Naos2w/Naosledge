/**
 * Real OS crash/restart proof for M6's most concrete M4->M5 failure:
 * local replacement + independently fsynced backup occurred, then the Node
 * process EXITED before the signed M5 success entry. This test uses a
 * real subprocess and filesystem, with a SYNTHETIC Owner-RLS reader; there is
 * no live Neon, Production, or real Obsidian Vault I/O.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mkdtemp,readFile,readdir,rm,writeFile} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {readObsidianLocalManifest} from "../lib/obsidian-local-manifest.ts";
import {previewManualObsidianSync} from "../lib/obsidian-manual-sync-review.ts";
import {adoptM5CurrentEquality,readM5ApprovedReview,
  inspectInterruptedM4LocalApply} from "../lib/obsidian-m5-owner-baseline-journal.ts";
import {chooseReviewIntent,serializeManualM4IncomingIntent}
  from "../lib/obsidian-m2-review-choices.ts";
import {stageNeonSandboxIncoming} from "../lib/obsidian-neon-sandbox-incoming.ts";
import {NEON_SYNC_SANDBOX_BRANCH,NEON_SYNC_SANDBOX_DATA_API}
  from "../lib/obsidian-neon-sandbox-readonly.ts";
import {
  M6_INTERRUPTED_M4_FLAG,assertManualM6Invocation,
} from "../scripts/obsidian-m6-sandbox-uncertain-recovery.ts";

const owner="00000000-0000-4000-8000-000000000079";
const jwt="header."+Buffer.from(JSON.stringify({sub:owner})).toString("base64url")+".signature";
const sha=v=>createHash("sha256").update(v).digest("hex");
const base={
  id:"00000000-0000-4000-8000-000000000073",slug:"m6-restart-shared-note",
  title:"Offline restart",summary:"M6 program exit",category:"test",
  tags:["m6"],learned_on:"2026-10-28",
};
const original={...base,content_md:"Original draft",
  updated_at:"2026-10-28T01:00:00.000Z"};
const updated={...base,content_md:"After remote edit",
  updated_at:"2026-10-28T02:00:00.000Z"};
const md=n=>serializeObsidianMarkdown({
  slug:n.slug,title:n.title,excerpt:n.summary,content_md:n.content_md,
  category:n.category,tags:n.tags,learned_on:n.learned_on,
});
const fp=n=>({slug:n.slug,sha256:sha(md(n)),
  revision:sha(n.id+":"+n.updated_at)});
const protector={
  seal:async key=>Buffer.from("synthetic:"+key.toString("base64")).toString("base64"),
  unseal:async blob=>Buffer.from(
    Buffer.from(blob,"base64").toString("utf8").slice(10),"base64",
  ),
};
const json=(rows,range=true)=>new Response(JSON.stringify(rows),{
  status:200,headers:{"content-type":"application/json",
    ...(range?{"content-range":rows.length?
      "0-"+(rows.length-1)+"/"+rows.length:"*/0"}:{})},
});
const ownerFetch=async(url,request)=>{
  const u=new URL(url);
  assert.equal(u.origin,new URL(NEON_SYNC_SANDBOX_DATA_API).origin);
  assert.equal(request.method,"GET");
  assert.equal(request.headers.Authorization,"Bearer "+jwt);
  if(u.pathname.endsWith("/blog_admins"))return json([{user_id:owner}],false);
  assert.ok(u.pathname.endsWith("/knowledge_notes"));
  return json([updated]);
};
async function withFixture(fn){
  const root=await mkdtemp(path.join(tmpdir(),"naosledge-m5-owner-baseline-test-"));
  const vaultRoot=await mkdtemp(path.join(tmpdir(),"naosledge-m4-vault-test-"));
  const staged=[];
  const localFile=path.join(vaultRoot,original.slug+".md");
  await writeFile(localFile,md(original));
  const readPreview=({baseline})=>previewManualObsidianSync({
    baseline,
    readLocal:()=>readObsidianLocalManifest(vaultRoot),
    readRemote:async()=>({fingerprints:[fp(updated)],numberOfNotes:1,
      sandboxOnly:true,rlsEnforcedByDataApi:true,
      writeEnabled:false,fullInventory:true}),
  });
  const options={rootDir:root,protector,readPreview,vaultRoot};
  try{
    const readInitial=({baseline})=>previewManualObsidianSync({
      baseline,
      readLocal:()=>readObsidianLocalManifest(vaultRoot),
      readRemote:async()=>({fingerprints:[fp(original)],numberOfNotes:1,
        sandboxOnly:true,rlsEnforcedByDataApi:true,
        writeEnabled:false,fullInventory:true}),
    });
    await adoptM5CurrentEquality({
      sandboxOwnerJwt:jwt,slug:original.slug,
      sha256:fp(original).sha256,remoteRevision:fp(original).revision,
      typedConfirmation:"ADOPT M5 SANDBOX "+original.slug+" "+
        fp(original).sha256.slice(0,12),
    },{...options,readPreview:readInitial});
    const p=await readM5ApprovedReview({sandboxOwnerJwt:jwt},options);
    assert.equal(p.summary["review-download"],1);
    const handoff=JSON.parse(serializeManualM4IncomingIntent(
      p,chooseReviewIntent(p,{},original.slug,"download"),original.slug,
    ));
    const saved=await stageNeonSandboxIncoming({
      branchId:NEON_SYNC_SANDBOX_BRANCH,sandboxOwnerJwt:jwt,
      decision:handoff.decision,
      typedConfirmation:"SAVE SANDBOX INCOMING "+original.slug,
      fetcher:ownerFetch,
    });
    staged.push(path.dirname(saved.path));
    await fn({root,vaultRoot,localFile,options,handoff,
      receiptPath:saved.receiptPath});
  }finally{
    for(const p of staged)await rm(p,{recursive:true,force:true});
    await rm(root,{recursive:true,force:true});
    await rm(vaultRoot,{recursive:true,force:true});
  }
}
function childCrashScript(){
  const journal=new URL("../lib/obsidian-m5-owner-baseline-journal.ts",import.meta.url).href;
  const review=new URL("../lib/obsidian-manual-sync-review.ts",import.meta.url).href;
  const manifest=new URL("../lib/obsidian-local-manifest.ts",import.meta.url).href;
  return [
    "import {readFileSync} from 'node:fs';",
    "import {applyReviewedM4AndRecordM5} from "+JSON.stringify(journal)+";",
    "import {previewManualObsidianSync} from "+JSON.stringify(review)+";",
    "import {readObsidianLocalManifest} from "+JSON.stringify(manifest)+";",
    "const x=JSON.parse(readFileSync(0,'utf8'));",
    "const protector={seal:async b=>Buffer.from('synthetic:'+b.toString('base64')).toString('base64'),",
    "unseal:async b=>Buffer.from(Buffer.from(b,'base64').toString('utf8').slice(10),'base64')};",
    "let calls=0;",
    "const readPreview=async({baseline})=>{",
    "calls++;",
    "const p=await previewManualObsidianSync({baseline,",
    "readLocal:()=>readObsidianLocalManifest(x.vaultRoot),",
    "readRemote:async()=>({fingerprints:[x.remote],numberOfNotes:1,",
    "sandboxOnly:true,rlsEnforcedByDataApi:true,writeEnabled:false,fullInventory:true})});",
    "if(calls===3){",
    "if(p.decisions[0]?.expectedLocalSha!==x.remote.sha256)process.exit(72);",
    "process.exit(77);", // hard exit WHILE M5 journal lock is held
    "}return p;};",
    "await applyReviewedM4AndRecordM5({sandboxOwnerJwt:x.jwt,",
    "handoff:x.handoff,receiptPath:x.receiptPath,",
    "typedConfirmation:x.confirmation},",
    "{rootDir:x.root,vaultRoot:x.vaultRoot,protector,readPreview});",
    "process.exit(70);",
  ].join("\n");
}
function recoveryScript(){
  const journal=new URL("../lib/obsidian-m5-owner-baseline-journal.ts",import.meta.url).href;
  const review=new URL("../lib/obsidian-manual-sync-review.ts",import.meta.url).href;
  const manifest=new URL("../lib/obsidian-local-manifest.ts",import.meta.url).href;
  return [
    "import {readFileSync} from 'node:fs';",
    "import {inspectInterruptedM4LocalApply} from "+JSON.stringify(journal)+";",
    "import {previewManualObsidianSync} from "+JSON.stringify(review)+";",
    "import {readObsidianLocalManifest} from "+JSON.stringify(manifest)+";",
    "const x=JSON.parse(readFileSync(0,'utf8'));",
    "const protector={seal:async b=>Buffer.from('synthetic:'+b.toString('base64')).toString('base64'),",
    "unseal:async b=>Buffer.from(Buffer.from(b,'base64').toString('utf8').slice(10),'base64')};",
    "const readPreview=({baseline})=>previewManualObsidianSync({baseline,",
    "readLocal:()=>readObsidianLocalManifest(x.vaultRoot),",
    "readRemote:async()=>({fingerprints:[x.remote],numberOfNotes:1,",
    "sandboxOnly:true,rlsEnforcedByDataApi:true,writeEnabled:false,fullInventory:true})});",
    "const result=await inspectInterruptedM4LocalApply({sandboxOwnerJwt:x.jwt},",
    "{rootDir:x.root,vaultRoot:x.vaultRoot,protector,readPreview});",
    "process.stdout.write(JSON.stringify(result));",
  ].join("\n");
}
function call(code,data){
  return spawnSync(process.execPath,[
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--input-type=module","-e",code,
  ],{input:JSON.stringify(data),encoding:"utf8",timeout:20_000});
}

test("M6 REAL child process exits 77 after local rename but before M5 journal, a NEW process diagnoses without retry or mutation",async()=>{
  await withFixture(async({root,vaultRoot,localFile,options,handoff,receiptPath})=>{
    assertManualM6Invocation("win32","MSI",[M6_INTERRUPTED_M4_FLAG],false);
    const data={root,vaultRoot,jwt,handoff,receiptPath,remote:fp(updated),
      confirmation:"APPLY M5 SANDBOX "+updated.slug+" "+
        fp(updated).sha256.slice(0,12)};
    const killed=call(childCrashScript(),data);
    assert.equal(killed.status,77,killed.stderr);
    assert.equal(await readFile(localFile,"utf8"),md(updated),
      "real OS file commit happened BEFORE the process died");
    const originalBackup=path.join(root,"backups","000002-"+original.slug+".bak");
    assert.equal(await readFile(originalBackup,"utf8"),md(original));
    assert.deepEqual(await readdir(path.join(root,"records")),["000001.json"]);
    assert.ok((await readdir(root)).includes("journal.lock"),
      "an abrupt process exit MUST leave the old lock until reviewed");
    await assert.rejects(readM5ApprovedReview({
      sandboxOwnerJwt:jwt,
    },options),/uncommitted or missing M4 backup/);
    const restarted=call(recoveryScript(),data);
    assert.equal(restarted.status,0,restarted.stderr);
    const result=JSON.parse(restarted.stdout);
    assert.deepEqual(result,{
      interruptedBackupFound:true,
      currentLocalState:"matches-current-remote",
      remoteChangedSinceBaseline:true,staleLocalLockPresent:true,
      currentObservationOnly:true,previousTransferProven:false,
      baselineSaved:false,autoRetryAllowed:false,autoRestoreAllowed:false,
    });
    assert.equal(await readFile(localFile,"utf8"),md(updated));
    assert.equal(await readFile(originalBackup,"utf8"),md(original));
    assert.deepEqual(await readdir(path.join(root,"records")),["000001.json"]);
  });
});

test("M6 orphan inspection rejects tampered backup, extra unknown backup, or an unavailable live Owner reader",async()=>{
  await withFixture(async({root,vaultRoot,options,handoff,receiptPath})=>{
    const data={root,vaultRoot,jwt,handoff,receiptPath,remote:fp(updated),
      confirmation:"APPLY M5 SANDBOX "+updated.slug+" "+
        fp(updated).sha256.slice(0,12)};
    assert.equal(call(childCrashScript(),data).status,77);
    const orig=path.join(root,"backups","000002-"+original.slug+".bak");
    await writeFile(orig,"forged");
    await assert.rejects(inspectInterruptedM4LocalApply({
      sandboxOwnerJwt:jwt,
    },options),/backup missing or modified/);
    await writeFile(orig,md(original));
    const unexpected=path.join(root,"backups","000003-unrelated.bak");
    await writeFile(unexpected,"rogue");
    await assert.rejects(inspectInterruptedM4LocalApply({
      sandboxOwnerJwt:jwt,
    },options),/uncommitted or missing M4 backup/);
    await rm(unexpected);
    await assert.rejects(inspectInterruptedM4LocalApply({
      sandboxOwnerJwt:jwt,
    },{...options,readPreview:async()=>{
      throw Error("simulated Owner RLS network disconnect");
    }}),/network disconnect/);
    assert.deepEqual(await readdir(path.join(root,"records")),["000001.json"]);
  });
});
