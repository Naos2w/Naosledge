import test from "node:test";
import assert from "node:assert/strict";
import {Readable} from "node:stream";
import {readFile} from "node:fs/promises";
import {
  validateM9SessionCli,parseM9PrivateEnrollment,
} from "../scripts/obsidian-m9-independent-session-cli.ts";

const base={
  platform:"win32",hostname:"MSI",
  flags:["--m9-independent-owner-enroll"],stdinIsTty:false,
};
const enrollment={
  email:"user@example.com",password:"TOP_SECRET_SYNTHETIC",
  typedConfirmation:"ENROLL M9 INDEPENDENT PRODUCTION SESSION",
};
test("MSI foreground independent sign-in requires exact flag and private STDIN",()=>{
  assert.equal(validateM9SessionCli(base),"enroll");
  assert.equal(validateM9SessionCli({...base,
    flags:["--m9-independent-owner-health"]}),"health");
  for(const change of [
    {platform:"linux"},{hostname:"PC2"},
    {flags:["--m9-independent-owner-enroll","--write"]},
    {flags:[]},{stdinIsTty:true},
  ])assert.throws(()=>validateM9SessionCli({...base,...change}));
});

test("credentials are read only from bounded private JSON stdin",async()=>{
  const json=JSON.stringify(enrollment);
  const parsed=await parseM9PrivateEnrollment(Readable.from([json]));
  assert.deepEqual(parsed,enrollment);
  const tooLarge=JSON.stringify({...enrollment,
    password:"x".repeat(5_000)});
  await assert.rejects(parseM9PrivateEnrollment(Readable.from([tooLarge])));
  for(const bad of [
    "not valid JSON", "null",
    JSON.stringify({...enrollment,unexpectedField:"MALICIOUS"}),
    JSON.stringify({...enrollment,
      typedConfirmation:"ENROLL EVERYTHING"}),
  ]){
    await assert.rejects(parseM9PrivateEnrollment(Readable.from([bad])));
  }
});

test("MSI wizard reads SecureString and does not place secrets in argv or environment",async()=>{
  const source=await readFile(new URL(
    "../scripts/obsidian-m9-independent-session-wizard.ps1",import.meta.url),"utf8");
  assert.match(source,/Read-Host .* -AsSecureString/);
  assert.match(source,/ZeroFreeBSTR/);
  assert.match(source,/ConvertTo-Json -Compress/);
  assert.match(source,/--m9-independent-owner-enroll/);
  assert.doesNotMatch(source,/process\.env\.[A-Za-z]*PASSWORD|Set-Clipboard|Out-File|Start-Transcript/);
});
