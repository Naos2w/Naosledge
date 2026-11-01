import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,writeFile,readFile,readdir,rm,
} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {inspectM9FaultReconciliationReadOnly}
  from "../lib/obsidian-m9-fault-reconciliation-readonly.ts";
import {
  adoptProductionM8EqualPairing,setM9SignedAutomaticMode,
} from "../lib/obsidian-m8-production-baseline-journal.ts";
import {readObsidianLocalManifest}
  from "../lib/obsidian-local-manifest.ts";
import {RELEASE_DATA_API_URL}
  from "../lib/neon/production-release.ts";
import {
  assertM9FaultReconcileInvocation,M9_RECONCILE_FLAG,
} from "../scripts/obsidian-m9-fault-reconcile-readonly.ts";

const OWNER="00000000-0000-4000-8000-000000000041";
const JWT="eyJhbGciOiJIUzI1NiJ9."+
  Buffer.from(JSON.stringify({
    sub:OWNER,exp:Math.floor(Date.now()/1000)+3600,
  })).toString("base64url")+".synthetic";
const MARKER="m9-uncertain-operation-manual-reconciliation-required";
const FAULT=".m9-fault-review-required";
const LOCK=".m8-readonly-agent.lock";
const protector={seal:async b=>b.toString("base64"),
  unseal:async s=>Buffer.from(s,"base64")};
const json=(data,range)=>new Response(JSON.stringify(data),{
  headers:{"content-type":"application/json","content-range":range},
});

async function fixture(fn){
  const faultRoot=await mkdtemp(path.join(tmpdir(),"naosledge-m9-fault-test-"));
  const vaultRoot=await mkdtemp(path.join(tmpdir(),"naosledge-m8-vault-test-"));
  const incomingRoot=await mkdtemp(path.join(tmpdir(),"naosledge-m8-incoming-test-"));
  const journalRoot=await mkdtemp(path.join(tmpdir(),
    "naosledge-m8-production-baseline-test-"));
  const journalOptions={testRoot:journalRoot,testProtector:protector,
    testReadLocal:()=>readObsidianLocalManifest(vaultRoot)};
  let calls=0,offline=false;
  const fetcher=async(url,req)=>{
    calls++;
    if(offline)throw Error("synthetic offline");
    assert.equal(req.method,"GET");
    assert.equal(new URL(url).origin,new URL(RELEASE_DATA_API_URL).origin);
    const pathName=new URL(url).pathname;
    if(pathName.endsWith("/blog_admins"))return json(
      [{user_id:OWNER}],"0-0/1");
    if(pathName.endsWith("/knowledge_notes"))return json([],"*/0");
    throw Error("unexpected endpoint");
  };
  const testOnly={faultRoot,vaultRoot,incomingRoot,journalOptions};
  const assess=()=>inspectM9FaultReconciliationReadOnly({
    ownerJwt:JWT,fetcher,testOnly,
  });
  const latch=()=>writeFile(path.join(faultRoot,FAULT),MARKER);
  const pair=()=>adoptProductionM8EqualPairing({
    ownerJwt:JWT,fetcher,options:journalOptions,
    typedConfirmation:"APPROVE M8 PRODUCTION INITIAL EQUALITY",
  });
  const enable=enabled=>setM9SignedAutomaticMode({
    ownerJwt:JWT,fetcher,options:journalOptions,
    testIncomingRoot:incomingRoot,schemaReady:true,enabled,
    typedConfirmation:(enabled?"ENABLE":"DISABLE")+" M9 PRODUCTION AUTO SYNC",
  });
  try{
    return await fn({assess,latch,pair,enable,testOnly,
      setOffline:value=>{offline=value;},
      get calls(){return calls;}});
  }finally{
    for(const root of [faultRoot,vaultRoot,incomingRoot,journalRoot]){
      await rm(root,{recursive:true,force:true});
    }
  }
}

test("no marker never causes a remote request, write, or restart authorisation",async()=>{
  await fixture(async f=>{
    const status=await f.assess();
    assert.equal(status.state,"no-latch");
    assert.equal(status.signedM5EqualityVerified,false);
    assert.equal(status.automaticRestartAuthorised,false);
    assert.equal(status.faultMarkerRemoved,false);
    assert.equal(f.calls,0);
    assert.deepEqual(await readdir(f.testOnly.faultRoot),[]);
  });
});

test("fault requires a signed pairing and the signed automatic mode to be disabled",async()=>{
  await fixture(async f=>{
    await f.latch();
    assert.equal((await f.assess()).state,"unpaired");
    await f.pair();
    await f.enable(true);
    assert.equal((await f.assess()).state,"signed-mode-enabled");
    await f.enable(false);
    const result=await f.assess();
    assert.equal(result.state,"ready-for-manual-review");
    assert.equal(result.signedM5EqualityVerified,true);
    assert.equal(result.manualReconciliationRequired,true);
    assert.equal(result.automaticRestartAuthorised,false);
    assert.equal(result.faultMarkerRemoved,false);
    assert.equal(result.noteWritesPerformed,0);
    assert.equal(await readFile(path.join(f.testOnly.faultRoot,FAULT),"utf8"),
      MARKER,"even equality must not clear the fault marker");
  });
});

test("a changed local note blocks fault recovery, even after signed mode is disabled",async()=>{
  await fixture(async f=>{
    await f.pair();await f.latch();
    await writeFile(path.join(f.testOnly.vaultRoot,"changed-note.md"),
      "Markdown changed while Agent stopped\n");
    const result=await f.assess();
    assert.equal(result.state,"inventory-diverged");
    assert.equal(result.automaticRestartAuthorised,false);
    assert.equal(result.signedM5EqualityVerified,false);
  });
});

test("pending incoming receipts and a held writer lock block independent reconciliation",async()=>{
  await fixture(async f=>{
    await f.pair();await f.latch();
    await writeFile(path.join(f.testOnly.faultRoot,LOCK),"held-writer");
    assert.equal((await f.assess()).state,"writer-lock-present");
    await rm(path.join(f.testOnly.faultRoot,LOCK));
    await writeFile(path.join(f.testOnly.incomingRoot,"uncertain-intent"),"x");
    assert.equal((await f.assess()).state,"pending-incoming");
  });
});

test("tampered latch and offline Owner-RLS cannot be mistaken for safe recovery",async()=>{
  await fixture(async f=>{
    await f.pair();
    await writeFile(path.join(f.testOnly.faultRoot,FAULT),"tampered");
    assert.equal((await f.assess()).state,"untrusted-marker");
    await writeFile(path.join(f.testOnly.faultRoot,FAULT),MARKER);
    f.setOffline(true);
    assert.equal((await f.assess()).state,"verification-unavailable");
    assert.equal(await readFile(path.join(f.testOnly.faultRoot,FAULT),"utf8"),
      MARKER);
  });
});

test("reconciliation command is MSI-only, exact flag and never an auto-enable entry",()=>{
  assertM9FaultReconcileInvocation({
    platform:"win32",host:"MSI",flags:[M9_RECONCILE_FLAG],
  });
  for(const invalid of [
    {platform:"linux",host:"MSI",flags:[M9_RECONCILE_FLAG]},
    {platform:"win32",host:"PC2",flags:[M9_RECONCILE_FLAG]},
    {platform:"win32",host:"MSI",flags:["--start"]},
    {platform:"win32",host:"MSI",flags:[M9_RECONCILE_FLAG,"--clear"]},
  ]){
    assert.throws(()=>assertM9FaultReconcileInvocation(invalid),/MSI/);
  }
});
