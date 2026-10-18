import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {inspectObsidianInstallation} from "../scripts/obsidian-msi-preflight.ts";

const local="C:\\Users\\Synthetic\\AppData\\Local";
const config={
  platform:"win32",
  hostname:"MSI",
  localAppData:local,
  programFiles:"C:\\Program Files",
  programFilesX86:"C:\\Program Files (x86)",
  pathExists:()=>false,
};

test("MSI Windows without Obsidian recommends exact winget package; no install",()=>{
  let checks=0;
  const p=inspectObsidianInstallation({...config,pathExists:()=>{
    checks++;return false;
  }});
  assert.equal(p.supportedWindows,true);
  assert.equal(p.targetIsMsi,true);
  assert.equal(p.knownExecutableFound,false);
  assert.equal(checks,4);
  assert.equal(p.packageId,"Obsidian.Obsidian");
  assert.match(p.installCommand,/winget install --id Obsidian\.Obsidian --exact/);
  assert.doesNotMatch(JSON.stringify(p),/Synthetic|AppData|SECRET|cookie|markdown/i);
});

test("preflight detects a known installed exe without opening its private Vault",()=>{
  const candidate=path.win32.join(local,"Programs","Obsidian","Obsidian.exe");
  const found=inspectObsidianInstallation({
    ...config,pathExists:(p)=>p===candidate,
  });
  assert.equal(found.knownExecutableFound,true);
  assert.equal(found.targetIsMsi,true);
});

test("wrong machine or non-Windows does not claim MSI readiness",()=>{
  const other=inspectObsidianInstallation({...config,hostname:"NAOS-PC"});
  const linux=inspectObsidianInstallation({...config,platform:"linux"});
  assert.equal(other.targetIsMsi,false);
  assert.equal(linux.supportedWindows,false);
});

test("MSI matching is case-insensitive and no data paths are returned",()=>{
  const a=inspectObsidianInstallation({...config,hostname:" mSi "});
  assert.equal(a.targetIsMsi,true);
  assert.equal(Object.hasOwn(a,"vaultFolder"),false);
  assert.equal(Object.hasOwn(a,"files"),false);
});
