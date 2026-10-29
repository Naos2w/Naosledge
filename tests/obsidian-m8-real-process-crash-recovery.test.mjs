import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,readFile,rm,stat,writeFile,open,unlink}
  from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {inspectM8ScratchIncomingRecovery}
  from "../lib/obsidian-m8-scratch-incoming-recovery.ts";

const worker=fileURLToPath(new URL(
  "./fixtures/obsidian-m8-scratch-crash-worker.mjs",import.meta.url));
const slug="m8-process-crash";
const original="# Original before process exit\n";
async function forcedCrash(phase){
  const vault=await mkdtemp(path.join(tmpdir(),"naosledge-m8-vault-test-"));
  const target=path.join(vault,slug+".md");
  let intentPath=null;
  try{
    await writeFile(target,original);
    const child=spawn(process.execPath,[
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      worker,vault,phase,
    ],{windowsHide:true,stdio:["ignore","pipe","pipe"]});
    let stdout="",stderr="";
    const done=new Promise((resolve,reject)=>{
      child.stdout.on("data",chunk=>{stdout+=chunk.toString("utf8");});
      child.stderr.on("data",chunk=>{stderr+=chunk.toString("utf8");});
      child.once("error",reject);
      child.once("exit",(code,signal)=>resolve({code,signal}));
    });
    const timer=setTimeout(()=>child.kill(),12000);
    const exit=await done.finally(()=>clearTimeout(timer));
    assert.equal(exit.code,73,"Worker exited before injected crash: "+stderr.slice(0,250));
    const match=/M8_CRASH_INTENT=([A-Za-z0-9_-]+)/.exec(stdout);
    assert.ok(match,"Expected durable intent after forced process exit");
    intentPath=Buffer.from(match[1],"base64url").toString("utf8");
    assert.equal(path.basename(intentPath),"incoming-intent.json");
    assert.equal(path.dirname(path.dirname(intentPath)),
      path.resolve(tmpdir()));
    const receipt=JSON.parse(await readFile(intentPath,"utf8"));
    assert.equal(receipt.slug,slug);
    const expectedState=phase==="before"?"not-applied":"applied";
    const check=await inspectM8ScratchIncomingRecovery({
      scratchVaultRoot:vault,intentPath,
    });
    assert.equal(check.state,expectedState);
    assert.equal(check.backupVerified,true);
    assert.equal(check.manualReviewRequired,true);
    assert.equal(check.baselineSaved,false);
    assert.equal(check.automaticRetryAllowed,false);
    assert.equal(await readFile(path.join(path.dirname(intentPath),
      slug+".md.bak"),"utf8"),original);
    const current=await readFile(target,"utf8");
    if(phase==="before")assert.equal(current,original);
    else assert.notEqual(current,original);
    // The abandoned exclusive file lock is intentionally NOT cleared
    // automatically, demonstrating the cross-process crash boundary.
    const lock=path.join(vault,".m8-incoming.lock");
    assert.ok((await stat(lock)).isFile());
    await assert.rejects(open(lock,"wx"),error=>{
      assert.equal(error.code,"EEXIST");return true;
    });
    // Test fixture cleanup is explicitly confined to the OS TEMP folder.
    await unlink(lock);
    assert.equal(check.remoteReadbackPerformed,false);
  }finally{
    await rm(vault,{recursive:true,force:true});
    // Never sweep OS TEMP for similarly named operations: other tests or
    // user processes may own them. Only delete THIS subprocess receipt root.
    if(intentPath!==null){
      const op=path.dirname(intentPath);
      if(path.dirname(op).toLowerCase()===
           path.resolve(tmpdir()).toLowerCase()&&
         path.basename(op).startsWith("naosledge-m8-scratch-operation-")){
        await rm(op,{recursive:true,force:true});
      }
    }
  }
}
test("real subprocess crash before atomic replace leaves durable backup and not-applied evidence",async()=>{
  await forcedCrash("before");
});
test("real subprocess crash after atomic replace leaves durable backup and applied evidence",async()=>{
  await forcedCrash("after");
});
