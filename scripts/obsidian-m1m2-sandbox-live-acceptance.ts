/**
 * Explicit synthetic Owner-JWT acceptance for ONLY the pinned Neon integration
 * Sandbox and approved MSI Vault. The M1/M2 product operations are read-only;
 * this harness creates one disposable Sandbox Auth identity and ONE synthetic
 * remote note to exercise a nonempty real review, then deletes that test note.
 *
 * An external operator must temporarily grant exactly the displayed synthetic
 * user ID in Sandbox public.blog_admins, then remove that grant AND delete the
 * synthetic Auth user after the cleanup handoff. Never run on Production.
 * Credentials/JWT stay in process memory, never argv, env, logs, or files.
 */
import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {readFile,unlink} from "node:fs/promises";
import {hostname} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {setTimeout as delay} from "node:timers/promises";
import {
  NEON_SYNC_SANDBOX_BRANCH,NEON_SYNC_SANDBOX_DATA_API,
  verifyNeonSandboxOwnerRls,
} from "../lib/obsidian-neon-sandbox-readonly.ts";
import {parseManualM2Handoff} from "../lib/obsidian-m2-review-choices.ts";
import {
  OWNER_SANDBOX_PROJECT,requireSandboxOwnerWriteApproval,
} from "../lib/obsidian-neon-owner-sandbox-approval.ts";

const AUTH="https://ep-square-cloud-b45d18zl.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth";
const SANDBOX=NEON_SYNC_SANDBOX_BRANCH;
const API=NEON_SYNC_SANDBOX_DATA_API;
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const SUFFIX=randomUUID().replaceAll("-","").slice(0,14);
const SLUG="m1m2-acceptance-"+SUFFIX;
let syntheticOwnerId:string|null=null;
let syntheticNoteId:string|null=null;
let localHandoff:string|null=null;
let noteCleaned=false;

function assertAuthorized():void{
  requireSandboxOwnerWriteApproval({
    platform:process.platform,computerName:hostname(),
    branchId:SANDBOX,projectId:OWNER_SANDBOX_PROJECT,
    acknowledgement:process.env.NAOSLEDGE_SYNTHETIC_SANDBOX_WRITE_APPROVED,
  });
  if(process.argv.length!==3||
     process.argv[2]!=="--m1-m2-sandbox-synthetic-acceptance"||
     new URL(API).hostname!=="ep-square-cloud-b45d18zl.apirest.c-6.us-east-2.aws.neon.tech"||
     new URL(AUTH).hostname!=="ep-square-cloud-b45d18zl.neonauth.c-6.us-east-2.aws.neon.tech"){
    throw Error("Explicit pinned Sandbox M1/M2 acceptance invocation required");
  }
}
async function auth(pathPart:string,body?:object,cookie?:string):Promise<Response>{
  const res=await fetch(AUTH+pathPart,{
    method:body?"POST":"GET",redirect:"manual",
    headers:{Origin:"http://localhost:3000",Accept:"application/json",
      ...(body?{"Content-Type":"application/json"}:{}),
      ...(cookie?{Cookie:cookie}:{})},
    body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.timeout(20_000),
  });
  if(res.status!==200)throw Error("Sandbox Auth "+pathPart+" HTTP "+res.status);
  return res;
}
async function createOwnerJwt():Promise<string>{
  const registration=await auth("/sign-up/email",{
    email:"naosledge-m1m2-"+SUFFIX+"@example.com",
    password:randomBytes(40).toString("base64url")+"aA1!",
    name:"Naosledge M1/M2 disposable test owner",
    callbackURL:"http://localhost:3000",
  });
  const record=await registration.json() as {user?:{id?:string}};
  const id=record.user?.id;
  if(typeof id!=="string"||id.length<10||id.length>256)throw Error("Synthetic Auth ID unavailable");
  syntheticOwnerId=id;
  console.log("M1M2_SANDBOX_OWNER_CREATED id="+id+" branch="+SANDBOX);
  const cookie=registration.headers.getSetCookie?.()
    .map(v=>v.split(";")[0]).filter(Boolean).join("; ")??"";
  if(!cookie)throw Error("Synthetic Auth session cookie unavailable");
  const session=await auth("/get-session",undefined,cookie);
  const jwt=session.headers.get("set-auth-jwt");
  if(!jwt||jwt.split(".").length!==3)throw Error("Sandbox Owner JWT unavailable");
  const claim=JSON.parse(Buffer.from(jwt.split(".")[1],"base64url").toString("utf8")) as {sub?:string};
  if(claim.sub!==id)throw Error("Sandbox JWT subject mismatches synthetic owner");
  return jwt;
}
async function waitForTemporaryGrant(jwt:string):Promise<void>{
  console.log("M1M2_WAIT_FOR_SANDBOX_ADMIN_GRANT id="+syntheticOwnerId+" branch="+SANDBOX);
  for(let i=0;i<180;i++){
    try{
      await verifyNeonSandboxOwnerRls({branchId:SANDBOX,jwt});
      console.log("M1M2_REAL_OWNER_RLS_PASS");
      return;
    }catch{}
    await delay(1000);
  }
  throw Error("Timed out waiting for exact synthetic Sandbox Owner grant");
}
async function createOneSyntheticNote(jwt:string):Promise<void>{
  const response=await fetch(API+"/knowledge_notes",{
    method:"POST",redirect:"manual",credentials:"omit",
    headers:{Authorization:"Bearer "+jwt,Accept:"application/json",
      "Content-Type":"application/json",Prefer:"return=representation"},
    body:JSON.stringify({
      slug:SLUG,title:"M1 M2 sandbox acceptance",
      summary:"Synthetic test metadata only",content_md:"# M1 M2 test\n\nSynthetic Sandbox-only note.",
      category:"測試",tags:["acceptance"],learned_on:"2026-10-26",
    }),
    signal:AbortSignal.timeout(20_000),
  });
  if(response.status!==201)throw Error("Synthetic Sandbox note insert failed HTTP "+response.status);
  const notes=await response.json() as Array<{id?:string;slug?:string;owner_id?:string}>;
  if(!Array.isArray(notes)||notes.length!==1||notes[0].slug!==SLUG||
     notes[0].owner_id!==syntheticOwnerId||!notes[0].id){
    throw Error("Synthetic note insert returned unexpected ownership");
  }
  syntheticNoteId=notes[0].id;
  console.log("M1M2_SANDBOX_TEST_NOTE_CREATED");
}
async function cli(args:string[],jwt:string):Promise<string>{
  const script=path.join(ROOT,"scripts","obsidian-msi-manual-preview.ts");
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",script,...args,
    ],{cwd:ROOT,windowsHide:true,stdio:["pipe","pipe","pipe"]});
    let out="",errors="";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data",chunk=>{out+=chunk;if(out.length>16000)child.kill();});
    child.stderr.on("data",chunk=>{errors+=chunk;if(errors.length>16000)child.kill();});
    child.on("error",reject);
    child.on("exit",code=>code===0?resolve(out):
      reject(Error("Real MSI M1/M2 CLI rejected the Owner read-only request")));
    child.stdin.end(jwt+"\n");
  });
}
async function verifyRealM1M2(jwt:string):Promise<void>{
  const m1=await cli(["--sandbox-first-look-readonly"],jwt);
  const match=/^M1_SANDBOX_READONLY_RESULT (.+)$/m.exec(m1);
  if(!match)throw Error("M1 command did not return a read-only result");
  const result=JSON.parse(match[1]) as Record<string,unknown>;
  assert.equal(result.remoteFullInventory,true);
  assert.equal(result.remoteNotes,1);
  assert.equal(result.localSupportedNotes,0);
  assert.equal(result.localUnsupportedMarkdown,0);
  assert.equal(result.localDirectoriesNotScanned,0);
  assert.equal(result.manualReviewCount,1);
  assert.equal(result.conflicts,0);
  assert.equal(result.ownerApprovalGranted,false);
  assert.equal(result.dataTransferred,false);
  assert.equal(result.baselineSaved,false);
  console.log("M1_REAL_SANDBOX_READONLY_PASS remote=1 local=0 review=1 writes=0");

  const m2=await cli(["--sandbox-m2-readonly-handoff"],jwt);
  const file=/^M2_SANDBOX_READONLY_HANDOFF_SAVED (.+)$/m.exec(m2)?.[1]?.trim();
  if(!file)throw Error("MSI Owner-RLS handoff was not exported");
  localHandoff=file;
  const parsed=parseManualM2Handoff(await readFile(file,"utf8"));
  assert.equal(parsed.inventory.remoteFullInventory,true);
  assert.equal(parsed.inventory.remoteNotes,1);
  assert.equal(parsed.inventory.localSupportedNotes,0);
  assert.equal(parsed.decisions.length,1);
  assert.equal(parsed.decisions[0].slug,SLUG);
  assert.equal(parsed.decisions[0].choice,"review-missing-local");
  assert.equal(parsed.decisions[0].writeAllowed,false);
  assert.equal(parsed.decisions[0].deleteAllowed,false);
  console.log("M2_REAL_MSI_HANDOFF_PASS remote=1 local=0 choice=review-missing-local");

  // Runs actual M2 React component in a localhost Chrome fixture, importing
  // the literal JSON emitted by the real M1/M2 MSI CLI above. No JWT is shared.
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(process.execPath,[
      path.join(ROOT,"scripts","smoke-obsidian-m2-ui.mjs"),
    ],{cwd:ROOT,windowsHide:true,stdio:["ignore","pipe","pipe"],
      env:{...process.env,NAOSLEDGE_M1M2_REAL_SANDBOX_HANDOFF:file}});
    let stdout="",stderr="";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data",chunk=>{stdout+=chunk;if(stdout.length>20_000)child.kill();});
    child.stderr.on("data",chunk=>{stderr+=chunk;if(stderr.length>20_000)child.kill();});
    child.on("error",reject);
    child.on("exit",code=>{
      if(code!==0||!stdout.includes("PASS REAL Sandbox JWT/RLS-derived MSI JSON")||
         !stdout.includes("M2_BROWSER_OFFLINE_SUCCESS")){
        reject(Error("M2 Chrome failed to import/review the real Sandbox snapshot"));
      }else resolve();
    });
  });
  console.log("M2_REAL_SANDBOX_TO_CHROME_PASS no_sync_or_remote_browser_requests");
}
async function removeOnlySyntheticNote(jwt:string):Promise<boolean>{
  if(!syntheticNoteId)return true;
  const where="?id=eq."+encodeURIComponent(syntheticNoteId)+
    "&slug=eq."+encodeURIComponent(SLUG);
  const res=await fetch(API+"/knowledge_notes"+where,{
    method:"DELETE",redirect:"manual",credentials:"omit",
    headers:{Authorization:"Bearer "+jwt,Accept:"application/json",
      Prefer:"return=representation"},
    signal:AbortSignal.timeout(20_000),
  });
  if(res.status!==200)return false;
  const rows=await res.json() as Array<{id?:string;slug?:string}>;
  return Array.isArray(rows)&&rows.length===1&&
    rows[0].id===syntheticNoteId&&rows[0].slug===SLUG;
}

assertAuthorized();
let token:string|undefined;
try{
  token=await createOwnerJwt();
  await waitForTemporaryGrant(token);
  await createOneSyntheticNote(token);
  await verifyRealM1M2(token);
  console.log("M1M2_REAL_SANDBOX_E2E_SUCCESS");
}catch{
  console.error("M1M2_SANDBOX_E2E_NOT_COMPLETED (review safe status and cleanup handoff)");
  process.exitCode=1;
}finally{
  if(token&&syntheticNoteId){
    try{noteCleaned=await removeOnlySyntheticNote(token);}
    catch{noteCleaned=false;}
  }else noteCleaned=syntheticNoteId===null;
  if(localHandoff)await unlink(localHandoff).catch(()=>{});
  console.log("M1M2_SANDBOX_CLEANUP_HANDOFF "+JSON.stringify({
    projectId:OWNER_SANDBOX_PROJECT,branchId:SANDBOX,
    syntheticOwnerId,syntheticNoteId,syntheticNoteSlug:SLUG,
    syntheticNoteCleaned:noteCleaned,
    temporaryGrantAndAuthUserRequireCleanup:!!syntheticOwnerId,
  }));
  if(!noteCleaned)process.exitCode=1;
}
