import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  requireSandboxOwnerWriteApproval,OWNER_SANDBOX_WRITE_ACK,
  OWNER_SANDBOX_BRANCH,OWNER_SANDBOX_PROJECT,
} from "../lib/obsidian-neon-owner-sandbox-approval.ts";

const approved={
  platform:"win32",computerName:"MSI",
  branchId:OWNER_SANDBOX_BRANCH,projectId:OWNER_SANDBOX_PROJECT,
  acknowledgement:OWNER_SANDBOX_WRITE_ACK,
};

test("explicit Owner acknowledgement and exact MSI Sandbox are required",()=>{
  assert.doesNotThrow(()=>requireSandboxOwnerWriteApproval(approved));
  assert.doesNotThrow(()=>requireSandboxOwnerWriteApproval({...approved,computerName:" mSi "}));
});

test("production or adjacent branches cannot receive synthetic write approval",()=>{
  for(const branchId of ["br-aged-sound-b43h5r2c","production","",null]){
    assert.throws(()=>requireSandboxOwnerWriteApproval({...approved,branchId}),/nonproduction/);
  }
  for(const projectId of ["","another-project",null]){
    assert.throws(()=>requireSandboxOwnerWriteApproval({...approved,projectId}),/nonproduction/);
  }
});

test("wrong device is not a valid synthetic E2E operator",()=>{
  for(const computerName of ["NAOS-PC","MSI2","","LAPTOP"]){
    assert.throws(()=>requireSandboxOwnerWriteApproval({...approved,computerName}),/MSI Windows/);
  }
  for(const platform of ["linux","darwin"]){
    assert.throws(()=>requireSandboxOwnerWriteApproval({...approved,platform}),/MSI Windows/);
  }
});

test("missing or altered write approval cannot trigger a synthetic signup",()=>{
  for(const acknowledgement of [
    "",undefined,"yes","I_APPROVE","SYNTHETIC_SANDBOX_ONLY ",
    "SYNTHETIC_SANDBOX_ONLY\n","PRODUCTION_TOO",
  ]) assert.throws(
    ()=>requireSandboxOwnerWriteApproval({...approved,acknowledgement}),
    /Explicit synthetic Sandbox write approval/,
  );
});

test("live synthetic owner E2E executable fails before any network without acknowledgement",()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
  const run=spawnSync(process.execPath,[
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    path.join(root,"scripts","smoke-obsidian-neon-owner-sandbox.ts"),
  ],{
    cwd:root,
    env:{...process.env,NAOSLEDGE_SYNTHETIC_SANDBOX_WRITE_APPROVED:""},
    timeout:10000,encoding:"utf8",
  });
  assert.notEqual(run.status,0,"missing approval MUST fail");
  assert.match(run.stderr||"",/SANDBOX_OWNER_E2E_FAILURE/);
  assert.doesNotMatch((run.stdout||"")+" "+(run.stderr||""),
    /SANDBOX_CREATED_AUTH_USER|WAITING_FOR_SANDBOX_ADMIN_GRANT/);
});
