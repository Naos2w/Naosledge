import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

const win=process.platform==="win32";
const helper=fileURLToPath(new URL(
  "../scripts/obsidian-m8-windows-native-replace.ps1",import.meta.url));
const digest=b=>createHash("sha256").update(b).digest("hex");
async function fixture(fn){
  const root=await mkdtemp(path.join(tmpdir(),"naosledge-m8-vault-test-native-"));
  const target=path.join(root,"synthetic.md");
  const staged=path.join(root,".m8-synthetic.pending");
  const backup=path.join(root,"native-original.md.bak");
  try{
    await writeFile(target,"# Original Windows file\n");
    await writeFile(staged,"# Updated Windows file\n");
    return await fn({root,target,staged,backup,
      old:"# Original Windows file\n",next:"# Updated Windows file\n"});
  }finally{await rm(root,{recursive:true,force:true});}
}
const call=(v,expected)=>spawnSync("powershell.exe",[
  "-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass",
  "-File",helper,
  "-Target",v.target,"-Staged",v.staged,
  "-ReplacementBackup",v.backup,"-ExpectedSha256",expected,
],{encoding:"utf8",timeout:20_000,windowsHide:true});

test("native Windows File.Replace holds share-mode lock and independently writes an original backup",{skip:!win},async()=>{
  await fixture(async v=>{
    const result=call(v,digest(Buffer.from(v.old)));
    assert.equal(result.status,0,"Native helper did not complete: "+
      (result.stderr||"").slice(0,75));
    assert.equal(await readFile(v.target,"utf8"),v.next);
    assert.equal(await readFile(v.backup,"utf8"),v.old);
    await assert.rejects(readFile(v.staged),error=>error.code==="ENOENT");
  });
});

test("native Windows replacement refuses a concurrent writer's open handle",{skip:!win},async()=>{
  await fixture(async v=>{
    const script=[
      "$ErrorActionPreference='Stop'",
      "$target=$env:M8_TEST_TARGET",
      "$stage=$env:M8_TEST_STAGE",
      "$backup=$env:M8_TEST_BACKUP",
      "$helper=$env:M8_TEST_HELPER",
      "$expected=$env:M8_TEST_SHA",
      "$writer=[System.IO.FileStream]::new($target,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))",
      "try {",
      "  & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $helper -Target $target -Staged $stage -ReplacementBackup $backup -ExpectedSha256 $expected | Out-Null",
      "  if($LASTEXITCODE -eq 0){exit 11}",
      "} finally {$writer.Dispose()}",
      "if(-not [string]::Equals([System.IO.File]::ReadAllText($target),('# Original Windows file'+[string][char]10))){exit 12}",
      "exit 0",
    ].join(";");
    const encoded=Buffer.from(script,"utf16le").toString("base64");
    const result=spawnSync("powershell.exe",[
      "-NoProfile","-NonInteractive","-EncodedCommand",encoded,
    ],{
      encoding:"utf8",timeout:20_000,windowsHide:true,
      env:{...process.env,M8_TEST_TARGET:v.target,M8_TEST_STAGE:v.staged,
        M8_TEST_BACKUP:v.backup,M8_TEST_HELPER:helper,
        M8_TEST_SHA:digest(Buffer.from(v.old))},
    });
    assert.equal(result.status,0,"Concurrent writer check did not pass");
    assert.equal(await readFile(v.target,"utf8"),v.old);
    assert.equal(await readFile(v.staged,"utf8"),v.next);
  });
});
