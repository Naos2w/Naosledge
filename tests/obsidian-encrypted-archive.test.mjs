import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {readFile,writeFile,readdir,rm} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {
  createSyntheticEncryptedArchive,readSyntheticEncryptedRecord,
  inspectSyntheticEncryptedArchive,
} from "../lib/obsidian-synthetic-encrypted-archive.ts";

const worker=fileURLToPath(new URL("../scripts/obsidian-encrypted-archive-worker.ts",import.meta.url));
const ARCHIVE=/^naosledge-encrypted-synthetic-only-[A-Za-z0-9_-]{6,32}$/;
const PREFIX="NAOSLEDGE_SYNTHETIC_NOTE:";
const original="NAOSLEDGE_SYNTHETIC_NOTE: this is not real Obsidian content";

function ownRoot(archiveId){
  assert.match(archiveId,ARCHIVE);
  const root=path.resolve(tmpdir(),archiveId);
  assert.equal(path.dirname(root).toLowerCase(),path.resolve(tmpdir()).toLowerCase());
  return root;
}
async function cleanup(archiveId){
  if(archiveId)await rm(ownRoot(archiveId),{recursive:true,force:true});
}
async function withArchive(callback){
  const box=await createSyntheticEncryptedArchive();
  try{return await callback(box,ownRoot(box.archiveId));}
  finally{await cleanup(box.archiveId);}
}
function runWorker(mode,key,...args){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",worker,mode,...args,
    ],{stdio:["pipe","pipe","pipe"],windowsHide:true});
    let stdout="",stderr="";
    const deadline=setTimeout(()=>child.kill(),20_000);
    child.stdout.on("data",chunk=>{
      stdout+=chunk.toString("utf8");
      if(stdout.length>10_000)child.kill();
    });
    child.stderr.on("data",chunk=>{
      stderr+=chunk.toString("utf8");
      if(stderr.length>10_000)child.kill();
    });
    child.once("error",error=>{clearTimeout(deadline);reject(error);});
    child.once("close",code=>{
      clearTimeout(deadline);resolve({code,stdout,stderr});
    });
    child.stdin.end(key.toString("base64"));
  });
}
function recordFile(root,id){
  assert.match(id,/^[0-9a-f-]{36}$/);
  return path.join(root,"records",id+".json");
}
function safeReport(report){
  assert.equal(report.syntheticOnly,true);
  assert.equal(report.readOnly,true);
  assert.equal(report.automaticRestoreEnabled,false);
  assert.ok(!JSON.stringify(report).includes("synthetic-encrypted-note"));
  assert.ok(!JSON.stringify(report).includes("NAOSLEDGE_SYNTHETIC_NOTE"));
}

test("encrypted synthetic backup survives writer exit and authenticates in a new independent process",async()=>{
  const key=randomBytes(32);
  let id;
  try{
    const writerResult=await runWorker("create",key);
    assert.equal(writerResult.code,0,writerResult.stderr);
    assert.equal(writerResult.stderr.trim(),"");
    const prefix="NAOSLEDGE_ENCRYPTED_SYNTHETIC_WRITER ";
    const lines=writerResult.stdout.split(/\r?\n/).filter(x=>x.startsWith(prefix));
    assert.equal(lines.length,1);
    const meta=JSON.parse(lines[0].slice(prefix.length));
    id=meta.archiveId;
    assert.equal(meta.syntheticOnly,true);
    const root=ownRoot(id);
    const saved=await readFile(recordFile(root,meta.recordId),"utf8");
    assert.ok(!saved.includes("private-looking sample"));
    assert.ok(!saved.includes("synthetic-encrypted-note"));
    assert.ok(!saved.includes(key.toString("base64")));
    assert.ok(!saved.includes(key.toString("hex")));
    assert.equal((await readdir(path.join(root,"records"))).length,1);

    const reopened=await runWorker("read",key,id,meta.recordId);
    assert.equal(reopened.code,0,reopened.stderr);
    assert.equal(reopened.stderr.trim(),"");
    const reportPrefix="NAOSLEDGE_ENCRYPTED_SYNTHETIC_READER ";
    const results=reopened.stdout.split(/\r?\n/).filter(x=>x.startsWith(reportPrefix));
    assert.equal(results.length,1);
    const proof=JSON.parse(results[0].slice(reportPrefix.length));
    assert.equal(proof.authenticated,true);
    assert.equal(proof.readOnly,true);
    assert.equal(proof.syntheticOnly,true);
    assert.equal(proof.automaticRestoreEnabled,false);
    assert.ok(!reopened.stdout.includes("private-looking sample"));

    const wrong=await runWorker("read",randomBytes(32),id,meta.recordId);
    assert.equal(wrong.code,2);
    assert.match(wrong.stderr,/SYNTHETIC_ENCRYPTED_ARCHIVE_OPERATION_REJECTED/);
    assert.ok(!wrong.stdout.includes("private-looking sample"));
    assert.equal((await readdir(path.join(root,"records"))).length,1,
      "incorrect keys must not cause deletion or destructive recovery");
    safeReport(await inspectSyntheticEncryptedArchive(id,key));
  }finally{
    await cleanup(id);
    key.fill(0);
  }
});

test("fresh authenticated encryption uses unique IVs, hides slug/body and never writes keys",async()=>{
  await withArchive(async(box,root)=>{
    const key=randomBytes(32);
    const first=await box.addSyntheticRecord({key,slug:"synthetic-one",body:original});
    const second=await box.addSyntheticRecord({key,slug:"synthetic-one",body:original});
    const a=JSON.parse(await readFile(recordFile(root,first.id),"utf8"));
    const b=JSON.parse(await readFile(recordFile(root,second.id),"utf8"));
    assert.equal(a.algorithm,"aes-256-gcm");
    assert.notEqual(a.nonce,b.nonce);
    assert.notEqual(a.ciphertext,b.ciphertext);
    assert.ok(!JSON.stringify(a).includes("synthetic-one"));
    assert.ok(!JSON.stringify(a).includes(original));
    const verified=await readSyntheticEncryptedRecord(box.archiveId,first.id,key);
    assert.equal(verified.slug,"synthetic-one");
    assert.equal(verified.body,original);
    assert.equal(verified.automaticRestoreEnabled,false);
    const audit=await inspectSyntheticEncryptedArchive(box.archiveId,key);
    safeReport(audit);
    assert.equal(audit.verifiedRecords,2);
    assert.equal(audit.needsManualReview,false);
    await assert.rejects(readSyntheticEncryptedRecord(box.archiveId,first.id,randomBytes(32)),
      /unauthenticated/);
    await assert.rejects(box.addSyntheticRecord({
      key:Buffer.alloc(16),slug:"synthetic-two",body:original,
    }),/32-byte key/);
    await assert.rejects(box.addSyntheticRecord({
      key,slug:"real-private-note",body:original,
    }),/Only bounded synthetic/);
    await assert.rejects(box.addSyntheticRecord({
      key,slug:"synthetic-two",body:"actual private note",
    }),/Only bounded synthetic/);
    key.fill(0);
  });
});

test("corrupt record header/tag/nonce/ciphertext and unknown schema fail closed without erasing evidence",async()=>{
  await withArchive(async(box,root)=>{
    const key=randomBytes(32);
    const receipt=await box.addSyntheticRecord({key,slug:"synthetic-only",body:original});
    const location=recordFile(root,receipt.id);
    const originalEnvelope=JSON.parse(await readFile(location,"utf8"));
    const cases=[
      {name:"wrong version",change:x=>({...x,version:2})},
      {name:"unexpected field",change:x=>({...x,localVaultPath:"not-allowed"})},
      {name:"wrong record id",change:x=>({...x,id:randomUUID()})},
      {name:"wrong algorithm",change:x=>({...x,algorithm:"aes-256-cbc"})},
      {name:"wrong nonce",change:x=>({...x,nonce:randomBytes(12).toString("base64")})},
      {name:"wrong auth tag",change:x=>({...x,tag:randomBytes(16).toString("base64")})},
      {name:"corrupt ciphertext",change:x=>({...x,ciphertext:randomBytes(16).toString("base64")})},
      {name:"invalid base64",change:x=>({...x,nonce:"not-base64%%"})},
      {name:"missing tag",change:x=>{const {tag,...rest}=x;return rest;}},
    ];
    for(const c of cases){
      const poisoned=JSON.stringify(c.change(originalEnvelope));
      await writeFile(location,poisoned);
      await assert.rejects(readSyntheticEncryptedRecord(box.archiveId,receipt.id,key),
        /invalid or unauthenticated/,c.name);
      const health=await inspectSyntheticEncryptedArchive(box.archiveId,key);
      safeReport(health);
      assert.equal(health.inspectionComplete,true,c.name);
      assert.equal(health.verifiedRecords,0,c.name);
      assert.equal(health.invalidRecords,1,c.name);
      assert.equal(health.needsManualReview,true,c.name);
      await assert.rejects(box.addSyntheticRecord({
        key,slug:"synthetic-retry",body:original,
      }),/manual review/,c.name);
      assert.equal(await readFile(location,"utf8"),poisoned,
        "poisoned backup must remain available for forensic inspection");
      await writeFile(location,JSON.stringify(originalEnvelope));
    }
    const restored=await inspectSyntheticEncryptedArchive(box.archiveId,key);
    assert.equal(restored.verifiedRecords,1);
    assert.equal(restored.needsManualReview,false);
    key.fill(0);
  });
});

test("unrecognized and over-capacity synthetic archive entries never trigger automatic cleanup",async()=>{
  await withArchive(async(box,root)=>{
    const key=randomBytes(32);
    const valid=await box.addSyntheticRecord({
      key,slug:"synthetic-good",body:original,
    });
    const records=path.join(root,"records");
    await writeFile(path.join(records,"unexpected.partial"),"synthetic broken transaction");
    const broken=await inspectSyntheticEncryptedArchive(box.archiveId,key);
    safeReport(broken);
    assert.equal(broken.verifiedRecords,1);
    assert.equal(broken.unexpectedEntries,1);
    assert.equal(broken.needsManualReview,true);
    await assert.rejects(box.addSyntheticRecord({
      key,slug:"synthetic-later",body:original,
    }),/manual review/);
    for(let i=0;i<129;i++){
      await writeFile(path.join(records,"unexpected-"+i+".partial"),"");
    }
    const partial=await inspectSyntheticEncryptedArchive(box.archiveId,key);
    safeReport(partial);
    assert.equal(partial.inspectionComplete,false);
    assert.equal(partial.verifiedRecords,null);
    assert.equal(partial.invalidRecords,null);
    assert.equal(partial.unexpectedEntries,null);
    assert.equal(partial.needsManualReview,true);
    assert.equal((await readdir(records)).length,131);
    assert.equal((await readFile(recordFile(root,valid.id),"utf8")).length>0,true);
    key.fill(0);
  });
});

test("invalid ids, paths, fake markers and non-synthetic worker input are rejected",async()=>{
  await withArchive(async(box,root)=>{
    const key=randomBytes(32);
    await assert.rejects(readSyntheticEncryptedRecord("../Naosledge",randomUUID(),key),
      /Unsafe synthetic encrypted archive identifier/);
    await assert.rejects(readSyntheticEncryptedRecord(box.archiveId,"..\\sneaky",key),
      /Unsafe synthetic record ID/);
    const r=await runWorker("read",key,"C:\\Naos\\Obsidian\\Naosledge",randomUUID());
    assert.equal(r.code,2);
    assert.match(r.stderr,/SYNTHETIC_ENCRYPTED_ARCHIVE_OPERATION_REJECTED/);
    assert.ok(!r.stdout.includes("NAOSLEDGE_ENCRYPTED_SYNTHETIC_READER"));
    const bad=await runWorker("create",Buffer.alloc(32),"/absolute/extra");
    assert.equal(bad.code,2);
    await writeFile(path.join(root,".synthetic-encrypted-archive-marker"),"wrong marker");
    await assert.rejects(inspectSyntheticEncryptedArchive(box.archiveId,key),
      /Not a factory-generated/);
    key.fill(0);
  });
});
