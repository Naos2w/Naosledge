import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,readFile,readdir,rm,writeFile,unlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {
  encodeM8ScratchIncomingIntent,inspectM8ScratchIncomingRecovery,
} from "../lib/obsidian-m8-scratch-incoming-recovery.ts";

const SHA=source=>createHash("sha256").update(source).digest("hex");
const slug="m8-recovery-synthetic";
const original="# Local before crash\n";
const incoming="# Remote after crash\n";
const revision="d".repeat(64);
async function withScratch(fn){
  const vault=await mkdtemp(path.join(tmpdir(),"naosledge-m8-vault-test-"));
  const operation=await mkdtemp(path.join(tmpdir(),
    "naosledge-m8-scratch-operation-"));
  try{return await fn({vault,operation});}
  finally{
    await rm(vault,{recursive:true,force:true});
    await rm(operation,{recursive:true,force:true});
  }
}
async function intent(operation,action){
  const file=path.join(operation,"incoming-intent.json");
  await writeFile(file,encodeM8ScratchIncomingIntent({
    slug,action,beforeSha256:action==="download-new"?null:SHA(original),
    remoteSha256:SHA(incoming),remoteRevision:revision,
  }));
  if(action==="download-replace")
    await writeFile(path.join(operation,slug+".md.bak"),original);
  return file;
}
const inspect=(vault,intentPath)=>inspectM8ScratchIncomingRecovery({
  scratchVaultRoot:vault,intentPath,
});
const inert=result=>{
  assert.equal(result.manualReviewRequired,true);
  assert.equal(result.automaticRetryAllowed,false);
  assert.equal(result.baselineSaved,false);
  assert.equal(result.localWrites,0);
  assert.equal(result.remoteWrites,0);
  assert.equal(result.remoteReadbackPerformed,false);
};
test("restart recovery identifies original file as not-applied; never retries or overwrites",async()=>{
  await withScratch(async({vault,operation})=>{
    const current=path.join(vault,slug+".md");
    await writeFile(current,original);
    const receipt=await intent(operation,"download-replace");
    const result=await inspect(vault,receipt);
    assert.equal(result.state,"not-applied");
    assert.equal(result.backupVerified,true);
    assert.equal(await readFile(current,"utf8"),original);
    inert(result);
  });
});
test("if crash happens after atomic rename, recovery sees new SHA but still requires human review",async()=>{
  await withScratch(async({vault,operation})=>{
    const current=path.join(vault,slug+".md");
    await writeFile(current,incoming);
    const receipt=await intent(operation,"download-replace");
    const result=await inspect(vault,receipt);
    assert.equal(result.state,"applied");
    assert.equal(result.backupVerified,true);
    assert.equal(await readFile(path.join(operation,slug+".md.bak"),"utf8"),original);
    inert(result);
  });
});
test("deleted, diverged or unknown content never becomes an automatic recovery write",async()=>{
  await withScratch(async({vault,operation})=>{
    const current=path.join(vault,slug+".md");
    const receipt=await intent(operation,"download-replace");
    const missing=await inspect(vault,receipt);
    assert.equal(missing.state,"missing");
    await writeFile(current,"# Third-party write\n");
    const diverged=await inspect(vault,receipt);
    assert.equal(diverged.state,"diverged");
    inert(missing);inert(diverged);
  });
});
test("download-new missing target is not-applied; an unrecognized target is divergence",async()=>{
  await withScratch(async({vault,operation})=>{
    const current=path.join(vault,slug+".md");
    const receipt=await intent(operation,"download-new");
    assert.equal((await inspect(vault,receipt)).state,"not-applied");
    await writeFile(current,incoming);
    const applied=await inspect(vault,receipt);
    assert.equal(applied.state,"applied");
    assert.equal(applied.backupVerified,false);
    await writeFile(current,original);
    assert.equal((await inspect(vault,receipt)).state,"diverged");
  });
});
test("missing or modified backup refuses to certify local recovery state",async()=>{
  await withScratch(async({vault,operation})=>{
    const receipt=await intent(operation,"download-replace");
    await writeFile(path.join(operation,slug+".md.bak"),"# changed backup");
    await assert.rejects(inspect(vault,receipt),/manual inspection/);
    await unlink(path.join(operation,slug+".md.bak"));
    await assert.rejects(inspect(vault,receipt),/manual inspection/);
  });
});
test("tampered, additional-key and malformed receipts must be rejected",async()=>{
  await withScratch(async({vault,operation})=>{
    const receipt=await intent(operation,"download-new");
    const originalText=await readFile(receipt,"utf8");
    const malformed=[
      "{not json",
      JSON.stringify({...JSON.parse(originalText),format:"sandbox"}),
      JSON.stringify({...JSON.parse(originalText),branch:"br-quiet-sunset-b4xx4pnx"}),
      JSON.stringify({...JSON.parse(originalText),slug:"../private"}),
      JSON.stringify({...JSON.parse(originalText),secret:"PRIVATE_JWT"}),
      JSON.stringify({...JSON.parse(originalText),beforeSha256:SHA(original)}),
    ];
    for(const modified of malformed){
      await writeFile(receipt,modified);
      await assert.rejects(inspect(vault,receipt),/manual inspection/);
    }
    await writeFile(receipt,originalText);
    await writeFile(path.join(operation,"unknown-extra.txt"),"unsafe");
    await assert.rejects(inspect(vault,receipt),/manual inspection/);
  });
});
test("neither a real Obsidian Vault nor an unrelated temp directory can be inspected as an M8 operation",async()=>{
  await withScratch(async({vault,operation})=>{
    const receipt=await intent(operation,"download-new");
    await assert.rejects(inspectM8ScratchIncomingRecovery({
      scratchVaultRoot:"C:\\Naos\\Obsidian\\Naosledge",intentPath:receipt,
    }),/manual inspection/);
    await assert.rejects(inspectM8ScratchIncomingRecovery({
      scratchVaultRoot:vault,
      intentPath:path.join(vault,"incoming-intent.json"),
    }),/manual inspection/);
  });
});
test("recovery module cannot perform writes, remote calls or baseline commits",async()=>{
  const script=await readFile(new URL(
    "../lib/obsidian-m8-scratch-incoming-recovery.ts",import.meta.url),"utf8");
  assert.doesNotMatch(script,/writeFile\(|rename\(|unlink\(|\.rpc\(|fetch\(|setInterval\(/);
  assert.ok(!script.includes("process.env"));
});
