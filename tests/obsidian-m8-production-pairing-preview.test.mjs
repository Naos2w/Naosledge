import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
  assertM8InitialReadOnlyInvocation,previewM8InitialPairingReadOnly,
} from "../scripts/obsidian-m8-production-pairing-preview.ts";
import {RELEASE_NEON_BRANCH} from "../lib/neon/production-release.ts";

const A="a".repeat(64);
const local=(fingerprints=[])=>({
  fingerprints,unsupportedMarkdownFiles:1,otherFiles:0,
  directoriesNotScanned:0,autoApplyAllowed:false,
});
const remote=(fingerprints=[])=>({
  branchId:RELEASE_NEON_BRANCH,
  fingerprints,numberOfNotes:fingerprints.length,
  fullInventory:true,ownerRlsVerified:true,writeEnabled:false,
});
const active={
  registered:true,autoSyncEnabled:false,configPresent:true,
  appConfigPresent:true,matchedRegistrations:1,
};
test("M8 pairing CLI is restricted to MSI and one explicit read-only flag",()=>{
  assert.doesNotThrow(()=>assertM8InitialReadOnlyInvocation({
    platform:"win32",hostname:"MSI",
    flags:["--m8-first-pairing-readonly"],stdinIsTerminal:false,
  }));
  for(const v of [
    {platform:"linux"},
    {hostname:"PC2"},
    {flags:[]},
    {flags:["--m8-first-pairing-readonly","--write"]},
    {stdinIsTerminal:true},
  ])assert.throws(()=>assertM8InitialReadOnlyInvocation({
    platform:"win32",hostname:"MSI",
    flags:["--m8-first-pairing-readonly"],stdinIsTerminal:false,...v,
  }));
});

test("Owner-first pairing prints only counts, with no slugs, note bodies or JWT",async()=>{
  const subject="synthetic.private.jwt";
  const result=await previewM8InitialPairingReadOnly({
    jwt:subject,vaultPath:"C:\\Naos\\Obsidian\\Naosledge",
    registryPath:"C:\\Users\\Synthetic\\AppData\\Roaming\\obsidian\\obsidian.json",
    registrationReader:async()=>active,
    localReader:async()=>local([{slug:"top-secret-note",sha256:A}]),
    remoteReader:async()=>remote([{slug:"another-secret",sha256:A,revision:A}]),
  });
  assert.equal(result.mode,"M8_FIRST_PAIRING_READONLY");
  assert.equal(result.localNotes,1);
  assert.equal(result.remoteNotes,1);
  assert.equal(result.manualReviews,2);
  assert.equal(result.unsupportedMarkdownNames,1);
  assert.equal(result.unpairedCandidates,3);
  assert.equal(result.remoteFullInventoryRead,true);
  assert.equal(result.ownerRlsVerified,true);
  assert.equal(result.baselineSaved,false);
  assert.equal(result.initialPairingApproved,false);
  assert.equal(result.automaticTransfersEnabled,false);
  assert.equal(result.localWrites,0);
  assert.equal(result.remoteWrites,0);
  assert.doesNotMatch(JSON.stringify(result),/top-secret|another-secret|synthetic.private.jwt/);
});

test("unregistered Obsidian Vault never reaches Owner-RLS remote inventory",async()=>{
  let localReads=0,remoteReads=0;
  await assert.rejects(previewM8InitialPairingReadOnly({
    jwt:"a.b.c",
    registrationReader:async()=>({...active,registered:false}),
    localReader:async()=>{localReads++;return local();},
    remoteReader:async()=>{remoteReads++;return remote();},
  }),/registered Obsidian Vault/);
  assert.equal(localReads,0);
  assert.equal(remoteReads,0);
});

test("incomplete Production inventory fails without output or baseline adoption",async()=>{
  await assert.rejects(previewM8InitialPairingReadOnly({
    jwt:"a.b.c",
    registrationReader:async()=>active,
    localReader:async()=>local(),
    remoteReader:async()=>({...remote([]),fullInventory:false}),
  }));
});

test("script does not read cookies, auto-start watchers, or expose a writer",async()=>{
  const source=await readFile(new URL(
    "../scripts/obsidian-m8-production-pairing-preview.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/getSession\(|document\.cookie|headers\.get\("cookie"\)|writeFile\(|rename\(|\.insert\(|\.delete\(|setInterval\(/i);
});
