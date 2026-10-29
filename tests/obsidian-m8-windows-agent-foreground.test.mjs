import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
  assertM8WindowsReadOnlyAgentInvocation,
  m8OwnerSessionRuntimeSeconds,runM8ReadOnlyForegroundSession,
} from "../scripts/obsidian-m8-windows-readonly-agent.ts";

const owner="00000000-0000-4000-8000-000000000041";
const now=1_800_000_000;
const jwt=(sub=owner,lifetime=3600)=>{
  return "eyJhbGciOiJIUzI1NiJ9."+
    Buffer.from(JSON.stringify({sub,exp:now+lifetime}))
      .toString("base64url")+".syntheticsignature";
};
const actualJwt=(delta=3600)=>{
  return "eyJhbGciOiJIUzI1NiJ9."+
    Buffer.from(JSON.stringify({
      sub:owner,exp:Math.floor(Date.now()/1000)+delta,
    })).toString("base64url")+".syntheticsignature";
};

test("foreground read-only agent must be explicit MSI command with piped token",()=>{
  const valid={
    platform:"win32",hostname:"MSI",
    flags:["--m8-readonly-foreground-agent"],stdinIsTTY:false,
  };
  assert.doesNotThrow(()=>assertM8WindowsReadOnlyAgentInvocation(valid));
  for(const input of [
    {platform:"linux"},{hostname:"PC2"},
    {flags:[]},{flags:["--m8-readonly-foreground-agent","--write"]},
    {stdinIsTTY:true},
  ])assert.throws(()=>assertM8WindowsReadOnlyAgentInvocation({
    ...valid,...input,
  }));
});

test("credential lifetime stops at 120s before expiry and caps foreground runtime",()=>{
  assert.equal(m8OwnerSessionRuntimeSeconds(jwt(owner,3600),now),3480);
  assert.equal(m8OwnerSessionRuntimeSeconds(jwt(owner,80000),now),3600);
  for(const delta of [0,20,90,120])
    assert.throws(()=>m8OwnerSessionRuntimeSeconds(jwt(owner,delta),now));
});

test("on Abort, foreground session stops without transferring notes or leaking Owner secrets",async()=>{
  const controller=new AbortController(),calls=[];
  let emit;
  const ready=new Promise(resolve=>{emit=resolve;});
  const result=runM8ReadOnlyForegroundSession({
    jwt:actualJwt(),signal:controller.signal,
    createAgent:getToken=>({
      start:async()=>{
        calls.push("start");
        const token=await getToken();
        assert.equal(token,actualJwt(), "JWT contents are not changed");
        emit();
      },
      stop:async()=>{calls.push("stop");},
      status:()=>({state:"running",automaticTransfersEnabled:false}),
      pause:()=>{},resume:async()=>{},
    }),
  });
  await ready;
  controller.abort();
  const out=await result;
  assert.deepEqual(calls,["start","stop"]);
  assert.deepEqual(out,{
    started:true,stopped:true,automaticTransfersEnabled:false,
    tokensStoredOnDisk:0,
  });
  assert.doesNotMatch(JSON.stringify(out),/syntheticsignature|Bearer|00000000/);
});

test("foreground never starts if session is near expiration or input invalid",async()=>{
  let started=false;
  const control=new AbortController();
  await assert.rejects(runM8ReadOnlyForegroundSession({
    jwt:actualJwt(30),signal:control.signal,
    createAgent:()=>{
      started=true;
      throw Error("Unexpected agent start");
    },
  }),/short-lived|invalid|subject or lifetime/);
  assert.equal(started,false);
  await assert.rejects(runM8ReadOnlyForegroundSession({
    jwt:actualJwt(),signal:AbortSignal.abort(),
    createAgent:()=>{
      started=true;
      throw Error("Unexpected start");
    },
  }),/already stopped/);
  assert.equal(started,false);
});

test("foreground source contains neither browser cookie harvesting nor persistent auth",async()=>{
  const script=await readFile(new URL(
    "../scripts/obsidian-m8-windows-readonly-agent.ts",import.meta.url),"utf8");
  assert.doesNotMatch(script,/document\.cookie|localStorage|Get-Cookie|setItem\(|writeFile\(|schtasks|pm2\s+start|Start-Service/);
  assert.match(script,/readM7ProductionOwnerJwt\(process\.stdin\)/);
  assert.match(script,/SIGINT/);
  assert.match(script,/SIGTERM/);
});
