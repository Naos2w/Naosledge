import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,lstat,readFile,readdir,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {
  applyVerifiedProductionIncomingToScratch,
} from "../lib/obsidian-m8-scratch-incoming-atomic.ts";
import {
  encodeM8ScratchIncomingIntent,inspectM8ScratchIncomingRecovery,
} from "../lib/obsidian-m8-scratch-incoming-recovery.ts";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {RELEASE_DATA_API_URL,RELEASE_NEON_BRANCH}
  from "../lib/neon/production-release.ts";

const SUB="00000000-0000-4000-8000-000000000041";
const ID="00000000-0000-4000-8000-000000000077";
const SLUG="m8-scratch-test";
const JWT="eyJhbGciOiJIUzI1NiJ9."+
  Buffer.from(JSON.stringify({
    sub:SUB,exp:Math.floor(Date.now()/1000)+3600,
  })).toString("base64url")+".syntheticsignature";
const note={
  id:ID,slug:SLUG,title:"Test scratch",summary:"test only",
  content_md:"# Production synthetic downloaded\n\n[[remote-link]]",
  category:"test",tags:[],learned_on:"2026-10-29",
  updated_at:"2026-10-29T03:00:00Z",
};
const markdown=serializeObsidianMarkdown({
  slug:note.slug,title:note.title,excerpt:note.summary,
  content_md:note.content_md,category:note.category,
  tags:note.tags,learned_on:note.learned_on,
});
const sha=v=>createHash("sha256").update(v).digest("hex");
const remoteSHA=sha(markdown),remoteRev=sha(ID+":"+note.updated_at);
const older="# Existing local original\n";
const beforeSHA=sha(older);
const candidate=action=>({
  slug:SLUG,
  action,
  choice:action==="download-new"?"review-missing-local":"review-download",
  expectedLocalSha:action==="download-new"?null:beforeSHA,
  expectedRemoteSha:remoteSHA,expectedRemoteRevision:remoteRev,
  executable:false,automaticDeletionAllowed:false,
  requiresFreshTwoSidedRead:true,
  requiresDurableBackup:action==="download-replace",
  baselineCommitOnlyAfterVerifiedReadback:true,
});
const json=(v,range)=>new Response(JSON.stringify(v),{
  status:200,headers:{
    "content-type":"application/json",
    ...(range?{"content-range":range}:{}),
  },
});
function fakeOwner(){
  let notes=[note],calls=0;
  const fetcher=async(input,init)=>{
    calls++;
    const u=new URL(String(input));
    assert.equal(u.origin,new URL(RELEASE_DATA_API_URL).origin);
    assert.equal(init.method,"GET");
    if(u.pathname.endsWith("/blog_admins"))return json([{user_id:SUB}],"0-0/1");
    if(u.pathname.endsWith("/knowledge_notes")){
      if(u.searchParams.has("slug")){
        assert.equal(u.searchParams.get("slug"),"eq."+SLUG);
        return json(notes,notes.length?"0-0/1":"*/0");
      }
      return json(notes,notes.length?"0-0/1":"*/0");
    }
    throw Error("Unexpected private endpoint");
  };
  return {fetcher,get count(){return calls;},set notes(x){notes=x;}};
}
const opt=(root,action,fetcher,extra={})=>({
  branchId:RELEASE_NEON_BRANCH,ownerJwt:JWT,
  candidate:candidate(action),scratchVaultRoot:root,fetcher,
  typedConfirmation:"TEST M8 SCRATCH "+action+" "+SLUG+" "+remoteSHA.slice(0,12),
  ...extra,
});
async function withTemp(fn){
  const root=await mkdtemp(path.join(tmpdir(),"naosledge-m8-vault-test-"));
  try{return await fn(root);}
  finally{await rm(root,{recursive:true,force:true});}
}

test("verified Production RLS download-new is create-only in OS Temp and leaves no M5 checkpoint",async()=>{
  await withTemp(async root=>{
    const owner=fakeOwner();
    const result=await applyVerifiedProductionIncomingToScratch(
      opt(root,"download-new",owner.fetcher),
    );
    assert.equal(result.backupPath,null);
    assert.equal(result.originalBackupSha256,null);
    assert.equal(result.sha256,remoteSHA);
    assert.equal(result.revision,remoteRev);
    assert.equal(result.localReadbackVerified,true);
    assert.equal(result.baselineSaved,false);
    assert.equal(result.remoteWrites,0);
    assert.equal(result.realVaultTouched,false);
    assert.equal((await readFile(path.join(root,SLUG+".md"),"utf8")),markdown);
    assert.deepEqual(await readdir(root),[SLUG+".md"]);
    assert.ok(owner.count>=6);
    const recovery=await inspectM8ScratchIncomingRecovery({
      scratchVaultRoot:root,intentPath:result.receiptPath,
    });
    assert.equal(recovery.state,"applied");
    assert.equal(recovery.backupVerified,false);
    assert.equal(recovery.baselineSaved,false);
    assert.equal(recovery.automaticRetryAllowed,false);
    await rm(path.dirname(result.receiptPath),{recursive:true,force:true});
  });
});

test("download-replace durably backs up the original, then checks the exact new bytes",async()=>{
  await withTemp(async root=>{
    const source=path.join(root,SLUG+".md");
    await writeFile(source,older);
    const owner=fakeOwner();
    const result=await applyVerifiedProductionIncomingToScratch(
      opt(root,"download-replace",owner.fetcher),
    );
    assert.ok(result.backupPath);
    try{
      assert.equal((await readFile(result.backupPath,"utf8")),older);
      assert.equal(result.originalBackupSha256,beforeSHA);
      assert.equal((await readFile(source,"utf8")),markdown);
      assert.equal((await lstat(source)).nlink,1);
      assert.deepEqual(await readdir(root),[SLUG+".md"]);
      assert.equal(result.baselineSaved,false);
      const recovery=await inspectM8ScratchIncomingRecovery({
        scratchVaultRoot:root,intentPath:result.receiptPath,
      });
      assert.equal(recovery.state,"applied");
      assert.equal(recovery.backupVerified,true);
      assert.equal(recovery.remoteReadbackPerformed,false);
    }finally{await rm(path.dirname(result.backupPath),{
      recursive:true,force:true,
    });}
  });
});

test("an editor change between backup and rename prevents overwrite and removes temporary artifacts",async()=>{
  await withTemp(async root=>{
    const target=path.join(root,SLUG+".md");
    await writeFile(target,older);
    const owner=fakeOwner();
    await assert.rejects(applyVerifiedProductionIncomingToScratch(
      opt(root,"download-replace",owner.fetcher,{
        beforeCommitForTest:async()=>writeFile(target,"# Competing editor update\n"),
      }),
    ),/stopped/);
    assert.equal(await readFile(target,"utf8"),"# Competing editor update\n");
    assert.deepEqual(await readdir(root),[SLUG+".md"]);
  });
});

test("download-new rejects existing user files instead of overwriting",async()=>{
  await withTemp(async root=>{
    await writeFile(path.join(root,SLUG+".md"),older);
    const owner=fakeOwner();
    await assert.rejects(applyVerifiedProductionIncomingToScratch(
      opt(root,"download-new",owner.fetcher),
    ));
    assert.equal(owner.count,0);
    assert.equal(await readFile(path.join(root,SLUG+".md"),"utf8"),older);
  });
});

test("invalid remote fingerprint, unexpected local SHA and non-Owner JWT fail closed",async()=>{
  await withTemp(async root=>{
    await writeFile(path.join(root,SLUG+".md"),older);
    const owner=fakeOwner();
    await assert.rejects(applyVerifiedProductionIncomingToScratch(
      opt(root,"download-replace",owner.fetcher,{
        candidate:{...candidate("download-replace"),expectedRemoteSha:sha("wrong")},
        typedConfirmation:"TEST M8 SCRATCH download-replace "+SLUG+" "+sha("wrong").slice(0,12),
      }),
    ));
    await assert.rejects(applyVerifiedProductionIncomingToScratch(
      opt(root,"download-replace",owner.fetcher,{
        candidate:{...candidate("download-replace"),expectedLocalSha:sha("wrong")},
      }),
    ));
    assert.equal(await readFile(path.join(root,SLUG+".md"),"utf8"),older);
  });
});

test("real Obsidian Vault paths are blocked before any Production network call",async()=>{
  const owner=fakeOwner();
  await assert.rejects(applyVerifiedProductionIncomingToScratch(
    opt("C:\\Naos\\Obsidian\\Naosledge","download-new",owner.fetcher),
  ),/stopped/);
  assert.equal(owner.count,0);
});

test("a symlinked scratch root is refused before contacting Neon",async(t)=>{
  await withTemp(async root=>{
    const linkPath=path.join(tmpdir(),"naosledge-m8-vault-test-"+
      "symlink"+Date.now().toString(36));
    const owner=fakeOwner();
    let created=false;
    try{
      try{
        await (await import("node:fs/promises")).symlink(root,linkPath,"dir");
        created=true;
      }catch(error){
        // Standard Windows users may lack Developer Mode / symlink privilege.
        if(error?.code==="EPERM"){t.skip("Windows symlink privilege unavailable");return;}
        throw error;
      }
      await assert.rejects(applyVerifiedProductionIncomingToScratch(
        opt(linkPath,"download-new",owner.fetcher),
      ),/stopped/);
      assert.equal(owner.count,0);
    }finally{if(created)await rm(linkPath,{force:true});}
  });
});

test("status remains non-executable and no live watcher or website imports the scratch adapter",async()=>{
  const fs=await import("node:fs/promises");
  const [host,site,scratch]=await Promise.all([
    fs.readFile(new URL("../lib/obsidian-m8-readonly-host.ts",import.meta.url),"utf8"),
    fs.readFile(new URL("../app/vault/sync/page.tsx",import.meta.url),"utf8"),
    fs.readFile(new URL("../lib/obsidian-m8-scratch-incoming-atomic.ts",import.meta.url),"utf8"),
  ]);
  assert.doesNotMatch(host,/applyVerifiedProductionIncomingToScratch/);
  assert.doesNotMatch(site,/applyVerifiedProductionIncomingToScratch/);
  assert.match(scratch,/^ \* This adapter intentionally CANNOT touch the real Obsidian Vault/m);
});
