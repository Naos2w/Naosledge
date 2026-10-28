/**
 * ONE-TIME, Owner-approved real M6 fault acceptance on pinned Neon Sandbox.
 * Sends a real POST then withholds the acknowledgement; uses real Owner-RLS
 * reads; kills real MSI child processes after OS-temp M4 writes and before
 * their M5 journal commits. No Production or registered Obsidian Vault IO.
 * Never run from CI or background polling.
 */
import assert from "node:assert/strict";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {mkdtemp,readFile,writeFile,readdir,realpath,lstat,rm} from "node:fs/promises";
import {hostname,tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {setTimeout as sleep} from "node:timers/promises";
import {
  NEON_SYNC_SANDBOX_BRANCH as BRANCH,
  NEON_SYNC_SANDBOX_DATA_API as API,
  verifyNeonSandboxOwnerRls,fetchVerifiedNeonSandboxOwnerFingerprints,
} from "../lib/obsidian-neon-sandbox-readonly.ts";
import {OWNER_SANDBOX_PROJECT,requireSandboxOwnerWriteApproval}
  from "../lib/obsidian-neon-owner-sandbox-approval.ts";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {createNeonSandboxNoteOnly} from "../lib/obsidian-neon-sandbox-create.ts";
import {updateNeonSandboxNoteIfUnchanged} from "../lib/obsidian-neon-sandbox-update.ts";
import {stageNeonSandboxIncoming,verifyStagedSandboxIncomingReceipt}
  from "../lib/obsidian-neon-sandbox-incoming.ts";
import {previewManualObsidianSync} from "../lib/obsidian-manual-sync-review.ts";
import {readObsidianLocalManifest} from "../lib/obsidian-local-manifest.ts";
import type {SyncFingerprint,SyncDecision} from "../lib/obsidian-sync-plan.ts";
import {
  adoptM5CurrentEquality,windowsM5KeyProtector,
  applyReviewedM4AndRecordM5,inspectInterruptedM4LocalApply,
  inspectInterruptedM4NewNote,
} from "../lib/obsidian-m5-owner-baseline-journal.ts";
import {inspectUncertainM3SandboxOutcome}
  from "../lib/obsidian-m5-sandbox-transfer-witness.ts";
import {MANUAL_M4_INCOMING_INTENT_FORMAT}
  from "../lib/obsidian-m2-review-choices.ts";

const FILE=fileURLToPath(import.meta.url);
const ROOT=path.dirname(path.dirname(FILE));
const AUTH="https://ep-square-cloud-b45d18zl.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth";
const MAIN="--m6-real-sandbox-fault-acceptance";
const CHILD="--m6-fault-child";
const SCOPE="M6_SANDBOX_FAULT_ONLY_20261028";
const SUFFIX=randomUUID().replaceAll("-","").slice(0,14);
const SLUG="m6-fault-"+SUFFIX;
const sha=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
const md=(slug:string,body:string)=>serializeObsidianMarkdown({
  slug,title:"M6 disposable fault test",excerpt:"Temporary Sandbox E2E",
  category:"測試",tags:["m6"],learned_on:"2026-10-28",content_md:body,
});
const initial=md(SLUG,"# M6 initial\n\nOne-time disposable Sandbox note.");
const changed=md(SLUG,"# M6 changed\n\nReal network and crash fault acceptance.");

type ChildRequest={
  jwt:string;root:string;vault:string;receipt:string;
  handoff:{format:string;decision:SyncDecision};
  mode:"crash-new"|"inspect-new"|"crash-replace"|"inspect-replace";
};
const tempDirs:string[]=[];
let ownerId:string|null=null,jwt:string|null=null,notesCleaned=false;

function approval(mode:string){
  requireSandboxOwnerWriteApproval({
    platform:process.platform,computerName:hostname(),projectId:OWNER_SANDBOX_PROJECT,
    branchId:BRANCH,
    acknowledgement:process.env.NAOSLEDGE_SYNTHETIC_SANDBOX_WRITE_APPROVED,
  });
  if(mode!==MAIN||process.env.NAOSLEDGE_M6_REAL_E2E_APPROVED!==SCOPE||
     new URL(API).hostname!=="ep-square-cloud-b45d18zl.apirest.c-6.us-east-2.aws.neon.tech"||
     new URL(AUTH).hostname!=="ep-square-cloud-b45d18zl.neonauth.c-6.us-east-2.aws.neon.tech"){
    throw Error("M6 requires the current Owner's exact Sandbox fault approval");
  }
}
async function allocated(dir:string,prefix:string){
  const t=await realpath(tmpdir()),p=path.resolve(dir);
  if(path.dirname(p).toLowerCase()!==t.toLowerCase()||
     !path.basename(p).startsWith(prefix)||
     (await realpath(p)).toLowerCase()!==p.toLowerCase()||
     !(await lstat(p)).isDirectory()){
    throw Error("M6 refused non-temporary or redirected working directory");
  }
}
async function freshScratch(){
  const t=await realpath(tmpdir());
  const root=await mkdtemp(path.join(t,"naosledge-m5-owner-baseline-test-"));
  const vault=await mkdtemp(path.join(t,"naosledge-m4-vault-test-"));
  tempDirs.push(root,vault);
  return {root,vault};
}
async function preview(jwt:string,vault:string,baseline:SyncFingerprint[]){
  return previewManualObsidianSync({
    baseline,readLocal:()=>readObsidianLocalManifest(vault),
    readRemote:()=>fetchVerifiedNeonSandboxOwnerFingerprints({branchId:BRANCH,jwt}),
  });
}
async function readChildInput():Promise<ChildRequest>{
  const chunks:Buffer[]=[];let n=0;
  for await(const chunk of process.stdin){
    const b=Buffer.from(chunk);n+=b.length;
    if(n>16000)throw Error("M6 child input too long");
    chunks.push(b);
  }
  const x=JSON.parse(Buffer.concat(chunks).toString("utf8")) as ChildRequest;
  if(!x||typeof x.jwt!=="string"||x.jwt.length>8192||
     typeof x.root!=="string"||typeof x.vault!=="string"||
     typeof x.receipt!=="string"||
     !["crash-new","inspect-new","crash-replace","inspect-replace"].includes(x.mode)||
     !x.handoff?.decision?.slug){
    throw Error("M6 child input invalid");
  }
  return x;
}
async function child(){
  if(process.env.NAOSLEDGE_M6_REAL_E2E_APPROVED!==SCOPE||
     process.env.NAOSLEDGE_SYNTHETIC_SANDBOX_WRITE_APPROVED!==
       "SYNTHETIC_SANDBOX_ONLY"){
    throw Error("M6 child has no Sandbox authorization");
  }
  const x=await readChildInput();
  await allocated(x.root,"naosledge-m5-owner-baseline-test-");
  await allocated(x.vault,"naosledge-m4-vault-test-");
  let reads=0;
  const readPreview=async({sandboxOwnerJwt,baseline}:{
    sandboxOwnerJwt:string;baseline:SyncFingerprint[];
  })=>{
    const p=await preview(sandboxOwnerJwt,x.vault,baseline);
    reads++;
    if(x.mode.startsWith("crash-")&&reads===3){
      const note=p.decisions.find(row=>row.slug===x.handoff.decision.slug);
      if(note?.expectedLocalSha!==x.handoff.decision.expectedRemoteSha){
        process.exit(72);
      }
      // Real OS file already created/replaced; no M5 success record yet.
      process.exit(77);
    }
    return p;
  };
  const opts={rootDir:x.root,vaultRoot:x.vault,
    protector:windowsM5KeyProtector,readPreview};
  if(x.mode.startsWith("crash-")){
    if(typeof x.handoff.decision.expectedRemoteSha!=="string"){
      throw Error("M6 child requires exact reviewed remote SHA");
    }
    await applyReviewedM4AndRecordM5({
      sandboxOwnerJwt:x.jwt,handoff:x.handoff,receiptPath:x.receipt,
      typedConfirmation:"APPLY M5 SANDBOX "+x.handoff.decision.slug+" "+
        x.handoff.decision.expectedRemoteSha.slice(0,12),
    },opts);
    process.exitCode=73;
  }else{
    const output=x.mode==="inspect-new"?
      await inspectInterruptedM4NewNote({
        sandboxOwnerJwt:x.jwt,handoff:x.handoff,receiptPath:x.receipt,
      },opts):
      await inspectInterruptedM4LocalApply({sandboxOwnerJwt:x.jwt},opts);
    assert.equal(output.baselineSaved,false);
    assert.equal(output.previousTransferProven,false);
    assert.equal(output.autoRetryAllowed,false);
    assert.equal(output.autoRestoreAllowed,false);
    console.log("M6_REAL_RECOVERY_OBSERVATION "+JSON.stringify(output));
  }
}
async function runChild(x:ChildRequest,exit:number){
  return new Promise<string>((resolve,reject)=>{
    const c=spawn(process.execPath,[
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",FILE,CHILD,
    ],{cwd:ROOT,windowsHide:true,stdio:["pipe","pipe","pipe"]});
    let out="",errBytes=0,expired=false;
    const timer=setTimeout(()=>{expired=true;c.kill();},60000);
    c.stdout.setEncoding("utf8");
    c.stdout.on("data",(s:string)=>{out+=s;if(out.length>2000)c.kill();});
    c.stderr.on("data",(s:Buffer)=>{errBytes+=s.byteLength;if(errBytes>6000)c.kill();});
    c.on("error",e=>{clearTimeout(timer);reject(e);});
    c.on("close",code=>{
      clearTimeout(timer);
      if(expired||code!==exit||errBytes>6000){
        reject(Error("M6 real child crash/recovery returned unexpected result"));
      }else resolve(out);
    });
    c.stdin.on("error",()=>{});
    c.stdin.end(JSON.stringify(x));
  });
}
async function auth(route:string,body?:object,cookie?:string){
  const res=await fetch(AUTH+route,{
    method:body?"POST":"GET",redirect:"manual",credentials:"omit",
    headers:{Origin:"http://localhost:3000",Accept:"application/json",
      ...(body?{"Content-Type":"application/json"}:{}),
      ...(cookie?{Cookie:cookie}:{})},
    body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.timeout(20000),
  });
  if(res.status!==200)throw Error("M6 disposable Sandbox Auth request failed");
  return res;
}
async function signup(){
  const res=await auth("/sign-up/email",{
    email:"naosledge-m6-"+SUFFIX+"@example.com",
    password:randomBytes(40).toString("base64url")+"aA1!",
    name:"One-time M6 Sandbox Owner",callbackURL:"http://localhost:3000",
  });
  const doc=await res.json() as {user?:{id?:string}};
  const id=doc.user?.id;
  if(typeof id!=="string"||
     !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)){
    throw Error("M6 disposable user id not returned");
  }
  ownerId=id;
  console.log("M6_SYNTHETIC_OWNER_CREATED id="+id+" branch="+BRANCH+" slug="+SLUG);
  const cookie=res.headers.getSetCookie?.()
    .map(s=>s.split(";")[0]).filter(Boolean).join("; ")??"";
  if(!cookie)throw Error("M6 temporary Auth cookie missing");
  const session=await auth("/get-session",undefined,cookie);
  const token=session.headers.get("set-auth-jwt");
  if(!token||token.split(".").length!==3||
     JSON.parse(Buffer.from(token.split(".")[1],"base64url").toString("utf8")).sub!==id){
    throw Error("M6 temporary JWT missing or wrong subject");
  }
  return token;
}
async function waitGrant(token:string){
  console.log("M6_WAIT_FOR_SANDBOX_GRANT id="+ownerId);
  for(let i=0;i<180;i++){
    try{
      await verifyNeonSandboxOwnerRls({branchId:BRANCH,jwt:token});
      console.log("M6_REAL_OWNER_RLS_VERIFIED");return;
    }catch{await sleep(1000);}
  }
  throw Error("M6 Owner RLS grant was not verified");
}
async function inventory(token:string){
  return fetchVerifiedNeonSandboxOwnerFingerprints({branchId:BRANCH,jwt:token});
}
async function cleanupNote(token:string){
  const u=new URL(API+"/knowledge_notes");
  u.searchParams.set("select","id,slug,owner_id");
  u.searchParams.set("slug","eq."+SLUG);
  u.searchParams.set("limit","2");
  const get=await fetch(u.href,{method:"GET",redirect:"manual",credentials:"omit",
    headers:{Authorization:"Bearer "+token,Accept:"application/json",
      Prefer:"count=exact"},signal:AbortSignal.timeout(16000)});
  if(get.status!==200)return false;
  const rows=await get.json() as Array<{id:string;slug:string;owner_id:string}>;
  if(!Array.isArray(rows)||rows.length>1)return false;
  if(rows.length===0)return true;
  const row=rows[0];
  if(row.slug!==SLUG||row.owner_id!==ownerId||
     typeof row.id!=="string")return false;
  const dest=new URL(API+"/knowledge_notes");
  dest.searchParams.set("id","eq."+row.id);
  dest.searchParams.set("slug","eq."+SLUG);
  dest.searchParams.set("owner_id","eq."+ownerId);
  const removed=await fetch(dest.href,{
    method:"DELETE",redirect:"manual",credentials:"omit",
    headers:{Authorization:"Bearer "+token,Accept:"application/json",
      Prefer:"return=representation"},signal:AbortSignal.timeout(16000),
  });
  if(removed.status!==200)return false;
  const deleted=await removed.json() as Array<{id:string}>;
  return Array.isArray(deleted)&&deleted.length===1&&deleted[0].id===row.id&&
    !(await inventory(token)).fingerprints.some(f=>f.slug===SLUG);
}
function handoff(decision:SyncDecision){
  return {format:MANUAL_M4_INCOMING_INTENT_FORMAT,decision};
}
async function runAcceptance(token:string){
  assert.equal((await inventory(token)).numberOfNotes,0);
  let posts=0,committed=false;
  const ackLost:typeof fetch=async(input,init)=>{
    if(init?.method==="POST"){
      posts++;
      const real=await fetch(input,init);
      if(real.status!==201)throw Error("M6 actual POST did not commit");
      committed=true;
      await real.body?.cancel();
      throw Error("M6_INJECTED_POST_ACK_LOST_AFTER_REAL_COMMIT");
    }
    return fetch(input,init);
  };
  await assert.rejects(createNeonSandboxNoteOnly({
    branchId:BRANCH,sandboxOwnerJwt:token,
    decision:{slug:SLUG,choice:"review-missing-remote",manualReview:true,
      expectedLocalSha:sha(initial),expectedRemoteSha:null,expectedRemoteRevision:null},
    readMarkdown:async()=>initial,typedConfirmation:"CREATE SANDBOX "+SLUG,
    fetcher:ackLost,
  }),/M6_INJECTED_POST_ACK_LOST/);
  assert.equal(posts,1);
  assert.equal(committed,true);
  const current=await inventory(token);
  assert.equal(current.numberOfNotes,1);
  const first=current.fingerprints.find(x=>x.slug===SLUG);
  assert.equal(first?.sha256,sha(initial));
  assert.ok(first?.revision);
  console.log("M6_REAL_POST_COMMITTED_ACK_LOST_PASS; ONE_POST");
  const observed=await inspectUncertainM3SandboxOutcome({
    sandboxOwnerJwt:token,localMarkdown:initial,reviewedLocalSha:sha(initial),
    reviewedRemoteSha:null,reviewedRemoteRevision:null,
  });
  assert.equal(observed.currentRemoteState,"matches-supplied-scratch");
  assert.equal(observed.baselineSaved,false);
  assert.equal(observed.transferConfirmed,false);
  assert.equal(observed.automaticRetryAllowed,false);
  console.log("M6_REAL_OWNER_RLS_UNCERTAIN_WRITE_OBSERVED_PASS");
  let interrupted=false;
  const lostGet:typeof fetch=async(input,init)=>{
    const res=await fetch(input,init);
    if(init?.method==="GET"&&new URL(String(input)).pathname.endsWith("/knowledge_notes")){
      interrupted=true;
      await res.body?.cancel();
      throw Error("M6_INJECTED_NETWORK_GET_RESPONSE_LOST");
    }
    return res;
  };
  await assert.rejects(inventoryViaLostGet(token,lostGet),
    /M6_INJECTED_NETWORK_GET_RESPONSE_LOST/);
  assert.equal(interrupted,true);
  console.log("M6_REAL_OWNER_RLS_GET_RESPONSE_LOSS_REFUSED");

  const firstChoice:SyncDecision={slug:SLUG,choice:"review-missing-local",
    manualReview:true,expectedLocalSha:null,
    expectedRemoteSha:sha(initial),expectedRemoteRevision:first.revision};
  const staged=await stageNeonSandboxIncoming({
    branchId:BRANCH,sandboxOwnerJwt:token,decision:firstChoice,
    typedConfirmation:"SAVE SANDBOX INCOMING "+SLUG,
  });
  tempDirs.push(path.dirname(staged.receiptPath));
  assert.equal(await readFile(staged.path,"utf8"),initial);
  assert.equal((await verifyStagedSandboxIncomingReceipt(staged.receiptPath)).sha256,
    sha(initial));
  console.log("M6_REAL_M4_INCOMING_VERIFIED");

  const one=await freshScratch();
  const firstChild:ChildRequest={
    jwt:token,...one,mode:"crash-new",receipt:staged.receiptPath,
    handoff:handoff(firstChoice),
  };
  await runChild(firstChild,77);
  assert.equal(await readFile(path.join(one.vault,SLUG+".md"),"utf8"),initial);
  assert.deepEqual((await readdir(one.root)).sort(),["journal.lock"]);
  const resumed=await runChild({...firstChild,mode:"inspect-new"},0);
  assert.match(resumed,/"currentLocalState":"matches-reviewed-incoming"/);
  assert.match(resumed,/"baselineSaved":false/);
  assert.deepEqual((await readdir(one.root)).sort(),["journal.lock"]);
  console.log("M6_REAL_SANDBOX_NEW_LOCAL_CRASH_RECOVERY_PASS");

  const two=await freshScratch();
  await writeFile(path.join(two.vault,SLUG+".md"),initial);
  const readPreview=async({sandboxOwnerJwt,baseline}:{
    sandboxOwnerJwt:string;baseline:SyncFingerprint[];
  })=>preview(sandboxOwnerJwt,two.vault,baseline);
  const firstAdopt=await adoptM5CurrentEquality({
    sandboxOwnerJwt:token,slug:SLUG,sha256:sha(initial),
    remoteRevision:first.revision,
    typedConfirmation:"ADOPT M5 SANDBOX "+SLUG+" "+sha(initial).slice(0,12),
  },{rootDir:two.root,vaultRoot:two.vault,protector:windowsM5KeyProtector,
    readPreview});
  assert.equal(firstAdopt.baselineSaved,true);
  assert.equal(firstAdopt.transferConfirmed,false);
  console.log("M6_REAL_DPAPI_SCRATCH_BASELINE_PASS");
  await sleep(1100);
  const after=await updateNeonSandboxNoteIfUnchanged({
    branchId:BRANCH,sandboxOwnerJwt:token,
    decision:{slug:SLUG,choice:"review-upload",manualReview:true,
      expectedLocalSha:sha(changed),expectedRemoteSha:sha(initial),
      expectedRemoteRevision:first.revision},
    readMarkdown:async()=>changed,typedConfirmation:"UPDATE SANDBOX "+SLUG,
  });
  assert.equal(after.sha256,sha(changed));
  assert.notEqual(after.revision,first.revision);
  console.log("M6_REAL_SANDBOX_CAS_UPDATE_PASS");
  const secondChoice:SyncDecision={slug:SLUG,choice:"review-download",
    manualReview:true,expectedLocalSha:sha(initial),
    expectedRemoteSha:sha(changed),expectedRemoteRevision:after.revision};
  const staged2=await stageNeonSandboxIncoming({
    branchId:BRANCH,sandboxOwnerJwt:token,decision:secondChoice,
    typedConfirmation:"SAVE SANDBOX INCOMING "+SLUG,
  });
  tempDirs.push(path.dirname(staged2.receiptPath));
  const secondChild:ChildRequest={
    jwt:token,...two,mode:"crash-replace",receipt:staged2.receiptPath,
    handoff:handoff(secondChoice),
  };
  await runChild(secondChild,77);
  assert.equal(await readFile(path.join(two.vault,SLUG+".md"),"utf8"),changed);
  assert.equal(await readFile(path.join(two.root,"backups","000002-"+SLUG+".bak"),"utf8"),
    initial);
  assert.deepEqual(await readdir(path.join(two.root,"records")),["000001.json"]);
  const recovery=await runChild({...secondChild,mode:"inspect-replace"},0);
  assert.match(recovery,/"currentLocalState":"matches-current-remote"/);
  assert.match(recovery,/"previousTransferProven":false/);
  assert.match(recovery,/"baselineSaved":false/);
  console.log("M6_REAL_SANDBOX_REPLACE_CRASH_RECOVERY_PASS");
  console.log("M6_REAL_SANDBOX_FAULT_E2E_PASS; NO_PRODUCTION; NO_REAL_VAULT");
}
async function inventoryViaLostGet(token:string,fetcher:typeof fetch){
  return fetchVerifiedNeonSandboxOwnerFingerprints({branchId:BRANCH,jwt:token,fetcher});
}
async function cleanupTemp(dir:string){
  const t=await realpath(tmpdir()),p=path.resolve(dir);
  const names=["naosledge-m5-owner-baseline-test-","naosledge-m4-vault-test-",
    "naosledge-sandbox-incoming-"];
  if(path.dirname(p).toLowerCase()!==t.toLowerCase()||
     !names.some(n=>path.basename(p).startsWith(n))||
     (await realpath(p)).toLowerCase()!==p.toLowerCase()){
    throw Error("M6 cleanup refused non-temporary path");
  }
  await rm(p,{recursive:true,force:true});
}
async function main(){
  approval(process.argv[2]);
  try{
    jwt=await signup();
    await waitGrant(jwt);
    await runAcceptance(jwt);
  }catch{
    console.error("M6_REAL_SANDBOX_FAULT_E2E_INCOMPLETE; CHECK_CLEANUP");
    process.exitCode=1;
  }finally{
    if(jwt&&ownerId){
      try{notesCleaned=await cleanupNote(jwt);}catch{notesCleaned=false;}
    }else notesCleaned=ownerId===null;
    for(const d of tempDirs.reverse()){
      try{await cleanupTemp(d);}
      catch{
        console.error("M6_PRIVATE_SCRATCH_CLEANUP_UNVERIFIED");
        process.exitCode=1;
      }
    }
    console.log("M6_REAL_SANDBOX_CLEANUP_HANDOFF "+JSON.stringify({
      projectId:OWNER_SANDBOX_PROJECT,branchId:BRANCH,
      syntheticOwnerId:ownerId,syntheticSlug:SLUG,
      syntheticNoteCleaned:notesCleaned,
      temporaryOwnerGrantAndAuthRequireOwnerCleanup:!!ownerId,
    }));
    if(!notesCleaned)process.exitCode=1;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===FILE){
  if(process.argv.length!==3)throw Error("M6 requires one exact CLI mode");
  if(process.argv[2]===CHILD){
    try{await child();}
    catch{console.error("M6_CHILD_NOT_VERIFIED");process.exitCode=1;}
  }else if(process.argv[2]===MAIN){await main();}
  else throw Error("Unknown M6 acceptance CLI mode");
}
