import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mkdtemp,readFile,readdir,rm,writeFile} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {previewManualObsidianSync} from "../lib/obsidian-manual-sync-review.ts";
import {readObsidianLocalManifest} from "../lib/obsidian-local-manifest.ts";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {chooseReviewIntent,serializeManualM4IncomingIntent}
  from "../lib/obsidian-m2-review-choices.ts";
import {stageNeonSandboxIncoming}
  from "../lib/obsidian-neon-sandbox-incoming.ts";
import {NEON_SYNC_SANDBOX_BRANCH,NEON_SYNC_SANDBOX_DATA_API}
  from "../lib/obsidian-neon-sandbox-readonly.ts";
import {adoptM5CurrentEquality,applyReviewedM4AndRecordM5,
  readM5ApprovedReview} from "../lib/obsidian-m5-owner-baseline-journal.ts";
import {M5_APPLY_INCOMING,readM5ApprovedBaselineRequest}
  from "../scripts/obsidian-m5-owner-baseline.ts";

const OWNER="00000000-0000-4000-8000-000000000079";
const JWT="header."+Buffer.from(JSON.stringify({sub:OWNER})).toString("base64url")+".signature";
const hash=s=>createHash("sha256").update(s).digest("hex");
const protector={
  seal:async key=>Buffer.from("synthetic:"+key.toString("base64")).toString("base64"),
  unseal:async blob=>Buffer.from(
    Buffer.from(blob,"base64").toString("utf8").slice(10),"base64",
  ),
};
const baseNote={
  id:"00000000-0000-4000-8000-000000000074",slug:"m4-shared-note",
  title:"Shared",summary:"reviewed download",category:"testing",
  tags:["m5"],learned_on:"2026-10-28",
};
function row(content,at){
  return {...baseNote,content_md:content,updated_at:at};
}
function markdown(note){
  return serializeObsidianMarkdown({
    slug:note.slug,title:note.title,excerpt:note.summary,
    content_md:note.content_md,category:note.category,tags:note.tags,
    learned_on:note.learned_on,
  });
}
function fingerprint(note){
  return {slug:note.slug,sha256:hash(markdown(note)),
    revision:hash(note.id+":"+note.updated_at)};
}
const json=(x,range=true)=>new Response(JSON.stringify(x),{
  status:200,headers:{"content-type":"application/json",
    ...(range?{"content-range":x.length?"0-"+(x.length-1)+"/"+x.length:"*/0"}:{})},
});
async function scene(run){
  const root=await mkdtemp(path.join(tmpdir(),"naosledge-m5-owner-baseline-test-"));
  const vaultRoot=await mkdtemp(path.join(tmpdir(),"naosledge-m4-vault-test-"));
  const incomingPaths=[];
  let current=row("First version","2026-10-28T01:00:00.000Z");
  let reads=0,afterRead=null;
  const fetcher=async(url,request)=>{
    const target=new URL(url);
    assert.equal(target.origin,new URL(NEON_SYNC_SANDBOX_DATA_API).origin);
    assert.equal(request.method,"GET");
    assert.equal(request.headers.Authorization,"Bearer "+JWT);
    if(target.pathname.endsWith("/blog_admins"))return json([{user_id:OWNER}],false);
    assert.ok(target.pathname.endsWith("/knowledge_notes"));
    assert.equal(request.headers.Prefer,"count=exact");
    return json([current]);
  };
  const readPreview=async({sandboxOwnerJwt,baseline})=>{
    assert.equal(sandboxOwnerJwt,JWT);
    reads++;
    afterRead?.(reads);
    return previewManualObsidianSync({
      baseline,
      readLocal:()=>readObsidianLocalManifest(vaultRoot),
      readRemote:async()=>({
        fingerprints:[fingerprint(current)],numberOfNotes:1,
        sandboxOnly:true,rlsEnforcedByDataApi:true,
        writeEnabled:false,fullInventory:true,
      }),
    });
  };
  const options={rootDir:root,protector,readPreview,vaultRoot};
  const prepare=async(baseline=[])=>{
    const preview=await readPreview({sandboxOwnerJwt:JWT,baseline});
    const choice=preview.decisions[0].choice==="conflict"?"keep-both":"download";
    const handoff=JSON.parse(serializeManualM4IncomingIntent(
      preview,chooseReviewIntent(preview,{},current.slug,choice),current.slug,
    ));
    const decision=handoff.decision;
    const staged=await stageNeonSandboxIncoming({
      branchId:NEON_SYNC_SANDBOX_BRANCH,sandboxOwnerJwt:JWT,
      decision,typedConfirmation:"SAVE SANDBOX INCOMING "+decision.slug,
      fetcher,
    });
    incomingPaths.push(path.dirname(staged.path));
    return {handoff,staged,decision};
  };
  try{
    await run({
      root,vaultRoot,options,prepare,
      get current(){return current;},
      get reads(){return reads;},
      setRemote:newRow=>{current=newRow;},
      setAfterRead:fn=>{afterRead=fn;},
      path:path.join(vaultRoot,baseNote.slug+".md"),
    });
  }finally{
    for(const p of incomingPaths)await rm(p,{recursive:true,force:true});
    await rm(root,{recursive:true,force:true});
    await rm(vaultRoot,{recursive:true,force:true});
  }
}
const apply=(handoff,receiptPath)=>({
  sandboxOwnerJwt:JWT,handoff,receiptPath,
  typedConfirmation:"APPLY M5 SANDBOX "+handoff.decision.slug+" "+
    handoff.decision.expectedRemoteSha.slice(0,12),
});
const adopt=(item)=>({
  sandboxOwnerJwt:JWT,slug:item.slug,sha256:item.sha256,
  remoteRevision:item.revision,
  typedConfirmation:"ADOPT M5 SANDBOX "+item.slug+" "+item.sha256.slice(0,12),
});

test("M4 Incoming reviewed missing-local -> real OS exclusive create -> M5 journal -> restored M2",async()=>{
  await scene(async env=>{
    const {handoff,staged}=await env.prepare();
    assert.equal(handoff.decision.choice,"review-missing-local");
    const args=apply(handoff,staged.receiptPath);
    assert.deepEqual(await readM5ApprovedBaselineRequest([
      JSON.stringify(args),
    ],M5_APPLY_INCOMING),args);
    const result=await applyReviewedM4AndRecordM5(args,env.options);
    assert.deepEqual(result,{baselineSaved:true,transferConfirmed:true,
      entryCount:1,originalBackedUp:false,autoApplyAllowed:false,
      deleteAllowed:false});
    assert.equal(await readFile(env.path,"utf8"),markdown(env.current));
    assert.deepEqual(await readdir(path.join(env.root,"records")),["000001.json"]);
    const record=JSON.parse(await readFile(
      path.join(env.root,"records","000001.json"),"utf8"));
    assert.equal(record.action,"verified-m4-download");
    assert.equal(record.beforeLocalSha,null);
    const preview=await readM5ApprovedReview({sandboxOwnerJwt:JWT},env.options);
    assert.equal(preview.summary.unchanged,1);
  });
});

test("M4 reviewed remote edit -> durable original backup -> atomic replace -> signed Baseline",async()=>{
  await scene(async env=>{
    const old=fingerprint(env.current);
    await writeFile(env.path,markdown(env.current));
    await adoptM5CurrentEquality(adopt(old),env.options);
    const original=await readFile(env.path);
    env.setRemote(row("Updated by NaosLedge","2026-10-28T01:02:00.000Z"));
    const preview=await readM5ApprovedReview({sandboxOwnerJwt:JWT},env.options);
    assert.equal(preview.summary["review-download"],1);
    const handoff=JSON.parse(serializeManualM4IncomingIntent(
      preview,chooseReviewIntent(preview,{},env.current.slug,"download"),
      env.current.slug,
    ));
    // Stage the real M4 transport with a known-good fake Owner-RLS GET;
    // stageOneReviewed... would recheck the same source. The exact receipt
    // bytes are independently checked again by the M5 local apply.
    const {staged}=await env.prepare([old]);
    const result=await applyReviewedM4AndRecordM5(
      apply(handoff,staged.receiptPath),env.options);
    assert.equal(result.originalBackedUp,true);
    assert.equal(result.entryCount,2);
    assert.equal(await readFile(env.path,"utf8"),markdown(env.current));
    const backup=path.join(env.root,"backups","000002-"+env.current.slug+".bak");
    assert.deepEqual(await readFile(backup),original);
    const last=JSON.parse(await readFile(path.join(env.root,"records","000002.json"),"utf8"));
    assert.equal(last.action,"verified-m4-download");
    assert.equal(last.beforeLocalSha,old.sha256);
    assert.equal(last.backupSha,old.sha256);
    assert.equal((await readM5ApprovedReview({sandboxOwnerJwt:JWT},env.options))
      .summary.unchanged,1);
    // A second Node process must re-verify BOTH historical entries and the
    // original backup, then use only the last per-note event for M2.
    const moduleUrl=new URL("../lib/obsidian-m5-owner-baseline-journal.ts",
      import.meta.url).href;
    const plannerUrl=new URL("../lib/obsidian-manual-sync-review.ts",
      import.meta.url).href;
    const manifestUrl=new URL("../lib/obsidian-local-manifest.ts",
      import.meta.url).href;
    const code=[
      "import {readFileSync} from 'node:fs';",
      "import {readM5ApprovedReview} from "+JSON.stringify(moduleUrl)+";",
      "import {previewManualObsidianSync} from "+JSON.stringify(plannerUrl)+";",
      "import {readObsidianLocalManifest} from "+JSON.stringify(manifestUrl)+";",
      "const p=JSON.parse(readFileSync(0,'utf8'));",
      "const protector={seal:async b=>Buffer.from('synthetic:'+b.toString('base64')).toString('base64'),",
      "unseal:async b=>Buffer.from(Buffer.from(b,'base64').toString('utf8').slice(10),'base64')};",
      "const readPreview=({baseline})=>previewManualObsidianSync({baseline,",
      "readLocal:()=>readObsidianLocalManifest(p.vaultRoot),",
      "readRemote:async()=>({fingerprints:[p.remote],numberOfNotes:1,",
      "sandboxOnly:true,rlsEnforcedByDataApi:true,writeEnabled:false,fullInventory:true})});",
      "const result=await readM5ApprovedReview({sandboxOwnerJwt:p.jwt},",
      "{rootDir:p.root,vaultRoot:p.vaultRoot,protector,readPreview});",
      "process.stdout.write(JSON.stringify(result.summary));",
    ].join("\n");
    const recovered=spawnSync(process.execPath,[
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--input-type=module","-e",code,
    ],{input:JSON.stringify({root:env.root,vaultRoot:env.vaultRoot,
      jwt:JWT,remote:fingerprint(env.current)}),
      encoding:"utf8",timeout:15000});
    assert.equal(recovered.status,0,recovered.stderr);
    assert.equal(JSON.parse(recovered.stdout).unchanged,1);
    await writeFile(backup,"tampered backup");
    await assert.rejects(readM5ApprovedReview({
      sandboxOwnerJwt:JWT,
    },env.options),/backup missing or modified/);
  });
});

test("M4 refuses a local edit after the original M2 download review",async()=>{
  await scene(async env=>{
    const old=fingerprint(env.current);
    await writeFile(env.path,markdown(env.current));
    await adoptM5CurrentEquality(adopt(old),env.options);
    env.setRemote(row("Server reviewed download","2026-10-28T01:03:00.000Z"));
    const preview=await readM5ApprovedReview({sandboxOwnerJwt:JWT},env.options);
    const handoff=JSON.parse(serializeManualM4IncomingIntent(
      preview,chooseReviewIntent(preview,{},env.current.slug,"download"),
      env.current.slug,
    ));
    const {staged}=await env.prepare([old]);
    const changed=markdown(row("Locally changed after review",
      "2026-10-28T01:00:00.000Z"));
    await writeFile(env.path,changed);
    await assert.rejects(applyReviewedM4AndRecordM5(
      apply(handoff,staged.receiptPath),env.options),
    /M2 download decision changed/);
    assert.equal(await readFile(env.path,"utf8"),changed);
    assert.deepEqual(await readdir(path.join(env.root,"records")),["000001.json"]);
    await assert.rejects(readdir(path.join(env.root,"backups")),/ENOENT/);
  });
});

test("M4 two-sided conflict stays Incoming-only and cannot update original or Baseline",async()=>{
  await scene(async env=>{
    const old=fingerprint(env.current);
    await writeFile(env.path,markdown(env.current));
    await adoptM5CurrentEquality(adopt(old),env.options);
    const oldBytes=await readFile(env.path);
    env.setRemote(row("Edited remotely","2026-10-28T01:07:00.000Z"));
    await writeFile(env.path,markdown(row("Edited locally","2026-10-28T01:00:00.000Z")));
    const currentBytes=await readFile(env.path);
    const p=await readM5ApprovedReview({sandboxOwnerJwt:JWT},env.options);
    assert.equal(p.summary.conflict,1);
    const handoff=JSON.parse(serializeManualM4IncomingIntent(
      p,chooseReviewIntent(p,{},env.current.slug,"keep-both"),env.current.slug,
    ));
    await assert.rejects(applyReviewedM4AndRecordM5(
      apply(handoff,"C:\\not-a-real-receipt"),env.options),
    /conflict requires keeping both/);
    assert.deepEqual(await readFile(env.path),currentBytes);
    assert.notDeepEqual(currentBytes,oldBytes);
    assert.deepEqual(await readdir(path.join(env.root,"records")),["000001.json"]);
  });
});

test("M4 post-local-commit remote drift preserves original backup and refuses M5 success",async()=>{
  await scene(async env=>{
    const original=fingerprint(env.current);
    await writeFile(env.path,markdown(env.current));
    await adoptM5CurrentEquality(adopt(original),env.options);
    env.setRemote(row("Server next version","2026-10-28T01:04:00.000Z"));
    const p=await readM5ApprovedReview({sandboxOwnerJwt:JWT},env.options);
    const handoff=JSON.parse(serializeManualM4IncomingIntent(
      p,chooseReviewIntent(p,{},env.current.slug,"download"),env.current.slug,
    ));
    const {staged}=await env.prepare([original]);
    // readPreview calls: one initial after setAfterRead; second recheck;
    // third immediately after the local file was changed.
    let since=0;
    env.setAfterRead(()=>{since++;if(since===3){
      env.setRemote(row("Another server change","2026-10-28T01:06:00.000Z"));
    }});
    await assert.rejects(applyReviewedM4AndRecordM5(
      apply(handoff,staged.receiptPath),env.options),
    /local commit outcome uncertain/);
    assert.equal(await readFile(env.path,"utf8"),
      markdown(row("Server next version","2026-10-28T01:04:00.000Z")));
    assert.deepEqual(await readdir(path.join(env.root,"records")),["000001.json"]);
    const backup=path.join(env.root,"backups","000002-"+env.current.slug+".bak");
    assert.equal((await readFile(backup)).length>0,true);
    await assert.rejects(readM5ApprovedReview({
      sandboxOwnerJwt:JWT,
    },env.options),/uncommitted or missing M4 backup/);
  });
});
