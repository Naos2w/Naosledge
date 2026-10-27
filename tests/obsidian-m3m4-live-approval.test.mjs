import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {assertM3M4AcceptanceApproval}
  from "../scripts/obsidian-m3m4-sandbox-live-acceptance.ts";
import {OWNER_SANDBOX_WRITE_ACK}
  from "../lib/obsidian-neon-owner-sandbox-approval.ts";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const valid={
  platform:"win32",computerName:"MSI",
  args:["--m3-m4-sandbox-synthetic-acceptance"],
  generalApproval:OWNER_SANDBOX_WRITE_ACK,
  specificApproval:"M3M4_SYNTHETIC_ONLY_20261028",
};

test("new M3/M4 acceptance never inherits prior unrelated Sandbox write approval",()=>{
  assert.throws(()=>assertM3M4AcceptanceApproval({
    ...valid,specificApproval:undefined,
  }),/new, exact-scope/);
  assert.throws(()=>assertM3M4AcceptanceApproval({
    ...valid,specificApproval:"M1M2_SYNTHETIC_ONLY",
  }),/new, exact-scope/);
  assert.throws(()=>assertM3M4AcceptanceApproval({
    ...valid,generalApproval:undefined,
  }),/Explicit synthetic Sandbox write approval/);
});

test("only MSI and the precise manual entry can open the new Sandbox acceptance",()=>{
  assert.throws(()=>assertM3M4AcceptanceApproval({
    ...valid,computerName:"OTHER",
  }),/restricted to MSI/);
  assert.throws(()=>assertM3M4AcceptanceApproval({
    ...valid,platform:"linux",
  }),/restricted to MSI/);
  assert.throws(()=>assertM3M4AcceptanceApproval({
    ...valid,args:["--some-other-command"],
  }),/new, exact-scope/);
  assert.doesNotThrow(()=>assertM3M4AcceptanceApproval(valid));
});

test("WikiLink live RPC requires its own named Owner scope, never the old M3/M4 approval",()=>{
  const linked={...valid,args:["--m3-m4-sandbox-wikilink-acceptance"],
    wikiApproval:"M3WIKILINK_SYNTHETIC_ONLY_20261028"};
  assert.throws(()=>assertM3M4AcceptanceApproval({
    ...linked,wikiApproval:undefined,
  }),/new, exact-scope/);
  assert.throws(()=>assertM3M4AcceptanceApproval({
    ...valid,wikiApproval:"M3WIKILINK_SYNTHETIC_ONLY_20261028",
    args:["--some-other-command"],
  }),/new, exact-scope/);
  assert.doesNotThrow(()=>assertM3M4AcceptanceApproval(linked));
});

test("unapproved CLI exits before Auth, HTTP, Vault IO, or any write",()=>{
  const script=path.join(root,"scripts","obsidian-m3m4-sandbox-live-acceptance.ts");
  const result=spawnSync(process.execPath,[
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    script,"--m3-m4-sandbox-synthetic-acceptance",
  ],{
    cwd:root,encoding:"utf8",timeout:10_000,
    env:{...process.env,
      NAOSLEDGE_SYNTHETIC_SANDBOX_WRITE_APPROVED:"",
      NAOSLEDGE_M3M4_REAL_E2E_APPROVED:""},
  });
  assert.equal(result.status,1);
  assert.doesNotMatch(result.stdout,/OWNER_CREATED|WAIT_FOR|_PASS|_CLEANUP/);
});
