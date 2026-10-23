import test from "node:test";
import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

const execFileAsync=promisify(execFile);
const script=fileURLToPath(new URL("../scripts/obsidian-windows-native-share-smoke.ps1",import.meta.url));

test("Windows native guard script is synthetic-only and cannot accept a live Vault path",async()=>{
  const source=await readFile(script,"utf8");
  assert.match(source,/naosledge-native-share-synthetic-only-/);
  assert.match(source,/\[IO\.Path\]::GetTempPath\(\)/);
  assert.match(source,/CreateFileW/);
  assert.match(source,/FILE_SHARE_READ/);
  assert.doesNotMatch(source,/C:\\Naos\\Obsidian\\Naosledge/i);
  assert.doesNotMatch(source,/Neon.*(https|token|password)/i);
  assert.doesNotMatch(source,/^\s*param\s*\(/im,
    "the stand-alone smoke script does not accept an arbitrary target path");
});

test("MSI Windows native share handle rejects independent competing writers, renames and deletes",{
  skip:process.platform!=="win32"?"Requires the real Windows filesystem and PowerShell":false
},async()=>{
  const {stdout,stderr}=await execFileAsync("powershell.exe",[
    "-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass",
    "-File",script,
  ],{timeout:60_000,maxBuffer:16_384,windowsHide:true});
  assert.equal(stderr.trim(),"","successful smoke should not leak OS paths or native errors");
  const evidenceLines=stdout.split(/\r?\n/)
    .filter(line=>line.startsWith("NAOSLEDGE_WINDOWS_NATIVE_SHARE_SMOKE "));
  assert.equal(evidenceLines.length,1);
  const result=JSON.parse(evidenceLines[0].slice("NAOSLEDGE_WINDOWS_NATIVE_SHARE_SMOKE ".length));
  assert.equal(result.status,"pass");
  assert.equal(result.syntheticOnly,true);
  assert.equal(result.nativeApi,"CreateFileW");
  assert.equal(result.shareMode,"FILE_SHARE_READ");
  for(const key of [
    "independentChildProcesses","readWhileHeldAllowed",
    "writeWhileHeldDenied","renameWhileHeldDenied","deleteWhileHeldDenied",
    "writeAfterCloseAllowed","renameAfterCloseAllowed","deleteAfterCloseAllowed",
  ])assert.equal(result[key],true,key);
  assert.equal(result.atomicCompareAndSwapAvailable,false,
    "a native share handle is not an atomic SHA-conditioned replacement");
  assert.equal(result.realVaultTouched,false);
  assert.equal(result.neonProductionTouched,false);
  assert.equal(result.automaticSyncEnabled,false);
  assert.ok(!stdout.includes("synthetic-note.md"),"output must not disclose fixture path");
});
