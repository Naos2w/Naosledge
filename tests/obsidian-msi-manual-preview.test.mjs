import test from "node:test";
import assert from "node:assert/strict";
import {readFile,unlink} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {makeSyntheticM2Preview} from "../lib/obsidian-m2-synthetic-fixture.ts";
import {
  MANUAL_FIRST_LOOK_FLAG,MANUAL_M2_HANDOFF_FLAG,assertManualM1Invocation,
  readOwnerJwtFromPipe,describeManualM1Acceptance,saveManualM2Handoff,
} from "../scripts/obsidian-msi-manual-preview.ts";

async function* pipe(...values){for(const value of values)yield value;}

test("manual M1 acceptance requires MSI plus explicit first-look flag and piped JWT",()=>{
  for(const flag of [MANUAL_FIRST_LOOK_FLAG,MANUAL_M2_HANDOFF_FLAG]){
    assert.doesNotThrow(()=>assertManualM1Invocation(
      "win32","MSI",[flag],false,
    ));
  }
  for(const args of [[],["--help"],[MANUAL_FIRST_LOOK_FLAG,"other"]]){
    assert.throws(()=>assertManualM1Invocation("win32","MSI",args,false),/flag/);
  }
  assert.throws(()=>assertManualM1Invocation(
    "linux","MSI",[MANUAL_FIRST_LOOK_FLAG],false,
  ),/restricted/);
  assert.throws(()=>assertManualM1Invocation(
    "win32","NAOS-PC",[MANUAL_FIRST_LOOK_FLAG],false,
  ),/restricted/);
  assert.throws(()=>assertManualM1Invocation(
    "win32","MSI",[MANUAL_FIRST_LOOK_FLAG],true,
  ),/Pipe/);
});

test("M1 acceptance pipe accepts bounded 3-part token and never parses argv",async()=>{
  const token=await readOwnerJwtFromPipe(pipe(
    Buffer.from("short-lived."),Buffer.from("sandbox."),"signature\r\n",
  ));
  assert.equal(token,"short-lived.sandbox.signature");
  for(const value of [""," \\n","token","a.b.c.d","a b.c.d","a.b.🎯"]){
    await assert.rejects(readOwnerJwtFromPipe(pipe(value)),/JWT/);
  }
  await assert.rejects(
    readOwnerJwtFromPipe(pipe("a.".padEnd(8191,"a"),"b.c")),
    /too large/,
  );
});

test("successful acceptance output never includes private slugs, hashes or a transfer permission",async()=>{
  const preview=await makeSyntheticM2Preview();
  const report=describeManualM1Acceptance(preview);
  assert.equal(report.mode,"M1_SANDBOX_READONLY_FIRST_LOOK");
  assert.equal(report.explicitlyNoBaseline,true);
  assert.equal(report.conflicts,1);
  assert.equal(report.manualReviewCount,5);
  assert.equal(report.remoteNotes,5);
  assert.equal(report.ownerApprovalGranted,false);
  assert.equal(report.dataTransferred,false);
  assert.equal(report.deleteAllowed,false);
  assert.equal(report.baselineSaved,false);
  const json=JSON.stringify(report);
  for(const privateField of ["react-hooks","nextjs-routing","typescript-notes","expectedLocalSha","expectedRemoteSha","fingerprints","decisions","jwt"]){
    assert.equal(json.includes(privateField),false);
  }
  assert.throws(()=>describeManualM1Acceptance({...preview,readOnly:false}),/read-only/);
});

test("manual M2 handoff writes a single private-metadata-only JSON for local UI import",async()=>{
  const preview=await makeSyntheticM2Preview();
  const file=await saveManualM2Handoff(preview);
  try{
    const content=await readFile(file,"utf8");
    const result=JSON.parse(content);
    assert.deepEqual(Object.keys(result),["format","preview"]);
    assert.equal(result.format,"naosledge.m2.sandbox-readonly.v1");
    assert.deepEqual(result.preview,preview);
    assert.equal(result.preview.readOnly,true);
    assert.equal(result.preview.autoApplyAllowed,false);
    assert.equal(result.preview.baselinePersisted,false);
    assert.equal(content.includes("jwt"),false);
    assert.equal(content.includes("markdownBody"),false);
    await assert.rejects(saveManualM2Handoff({...preview,readOnly:false}),/read-only/);
  }finally{
    await unlink(file);
  }
});

test("live M1/M2 synthetic owner harness refuses to create an account without explicit approval",()=>{
  const script=fileURLToPath(new URL("../scripts/obsidian-m1m2-sandbox-live-acceptance.ts",import.meta.url));
  const result=spawnSync(process.execPath,[
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    script,"--m1-m2-sandbox-synthetic-acceptance",
  ],{encoding:"utf8",timeout:10_000,env:{...process.env,
    NAOSLEDGE_SYNTHETIC_SANDBOX_WRITE_APPROVED:""}});
  assert.equal(result.status,1);
  assert.match(result.stderr,/restricted to MSI Windows|approval acknowledgement/);
  assert.doesNotMatch(result.stdout,/OWNER_CREATED|WAIT_FOR_SANDBOX_ADMIN_GRANT/);
});

test("manual M1 CLI is detached from the website and has no Vault-write or arbitrary-target API",async()=>{
  const file=await readFile(new URL("../scripts/obsidian-msi-manual-preview.ts",import.meta.url),"utf8");
  const route=await readFile(new URL("../app/vault/sync/page.tsx",import.meta.url),"utf8");
  assert.match(file,/previewApprovedMsiSandboxSync/);
  assert.match(file,/baseline:\[\]/);
  assert.match(file,/process\.stdin/);
  assert.match(file,/writeFile\(file,payload,\{flag:"wx",mode:0o600\}\)/);
  assert.doesNotMatch(file,/\brm\(|\brename\(|localStorage|sessionStorage|\.env|--jwt|process\.env|fetch\(|https?:\/\//);
  assert.doesNotMatch(route,/obsidian-msi-manual-preview|previewApprovedMsiSandboxSync/);
});
