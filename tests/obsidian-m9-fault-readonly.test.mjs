import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,readdir,rm,link} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {inspectM9FaultReadOnly}
  from "../lib/obsidian-m9-fault-review-readonly.ts";
import {assertM9FaultReadOnlyInvocation,M9_FAULT_FLAG}
  from "../scripts/obsidian-m9-fault-readonly.ts";

const FAULT=".m9-fault-review-required";
const LOCK=".m8-readonly-agent.lock";
const MARKER="m9-uncertain-operation-manual-reconciliation-required";
async function withRoot(fn){
  const root=await mkdtemp(path.join(tmpdir(),"naosledge-m9-fault-test-"));
  try{return await fn(root);}
  finally{await rm(root,{recursive:true,force:true});}
}

test("read-only fault status starts unlatched without granting restart",async()=>{
  await withRoot(async root=>{
    const result=await inspectM9FaultReadOnly({testRoot:root});
    assert.deepEqual(result,{
      state:"no-latch",writerLockPresent:false,
      manualReconciliationRequired:false,
      automaticRestartAuthorised:false,writesPerformed:0,
    });
    assert.deepEqual(await readdir(root),[]);
  });
});

test("a durable in-flight marker and writer lock require manual review; inspection never removes either",async()=>{
  await withRoot(async root=>{
    await writeFile(path.join(root,LOCK),"m9-signed-optin-single-writer");
    await writeFile(path.join(root,FAULT),MARKER);
    const before=await readdir(root);
    const result=await inspectM9FaultReadOnly({testRoot:root});
    assert.equal(result.state,"review-required");
    assert.equal(result.writerLockPresent,true);
    assert.equal(result.manualReconciliationRequired,true);
    assert.equal(result.automaticRestartAuthorised,false);
    assert.equal(result.writesPerformed,0);
    assert.deepEqual(await readdir(root),before);
    assert.equal(await readFile(path.join(root,FAULT),"utf8"),MARKER);
  });
});

test("malformed or hard-linked fault marker is reported as untrusted, never silently cleared",async()=>{
  await withRoot(async root=>{
    const latch=path.join(root,FAULT);
    await writeFile(latch,"unexpected content");
    assert.equal((await inspectM9FaultReadOnly({testRoot:root})).state,
      "untrusted-marker");
    await rm(latch);
    await writeFile(latch,MARKER);
    await link(latch,path.join(root,"marker-hardlink"));
    const result=await inspectM9FaultReadOnly({testRoot:root});
    assert.equal(result.state,"untrusted-marker");
    assert.equal(result.manualReconciliationRequired,true);
    assert.equal(result.automaticRestartAuthorised,false);
  });
});

test("a held single-writer lock with no fault marker is not an automatic restart authorisation",async()=>{
  await withRoot(async root=>{
    await writeFile(path.join(root,LOCK),"m8-readonly-agent");
    const status=await inspectM9FaultReadOnly({testRoot:root});
    assert.equal(status.state,"no-latch");
    assert.equal(status.writerLockPresent,true);
    assert.equal(status.automaticRestartAuthorised,false);
  });
});

test("fault status never permits an arbitrary filesystem root or host invocation",async()=>{
  await assert.rejects(
    inspectM9FaultReadOnly({testRoot:path.resolve(tmpdir())}),
    /manual reconciliation required/);
  assertM9FaultReadOnlyInvocation({
    platform:"win32",host:"MSI",flags:[M9_FAULT_FLAG],
  });
  for(const args of [
    {platform:"linux",host:"MSI",flags:[M9_FAULT_FLAG]},
    {platform:"win32",host:"PC2",flags:[M9_FAULT_FLAG]},
    {platform:"win32",host:"MSI",flags:[]},
    {platform:"win32",host:"MSI",flags:["--clear-m9-latch"]},
  ]){
    assert.throws(()=>assertM9FaultReadOnlyInvocation(args),
      /requires MSI/);
  }
});
