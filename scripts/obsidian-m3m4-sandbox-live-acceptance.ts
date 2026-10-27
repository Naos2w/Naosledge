/**
 * M3/M4/M5 real-API acceptance on the fixed Neon Integration Sandbox only.
 * This is a one-time, separately approved synthetic-owner lab exercise, NOT
 * an Obsidian Vault synchronizer or a Production release. The real MSI manual
 * CLIs run in child Node processes and use the actual Sandbox Owner-RLS API.
 *
 * Never execute this as a CI smoke test. The Owner must separately approve
 * this exact M3/M4 acceptance, temporarily grant the emitted synthetic user
 * ID in Integration Sandbox blog_admins, and remove that grant + Auth user.
 */
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {readFile,realpath,lstat,rm} from "node:fs/promises";
import {hostname,tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {setTimeout as delay} from "node:timers/promises";
import {
  NEON_SYNC_SANDBOX_BRANCH,NEON_SYNC_SANDBOX_DATA_API,
  fetchVerifiedNeonSandboxOwnerFingerprints,verifyNeonSandboxOwnerRls,
} from "../lib/obsidian-neon-sandbox-readonly.ts";
import {
  OWNER_SANDBOX_PROJECT,requireSandboxOwnerWriteApproval,
} from "../lib/obsidian-neon-owner-sandbox-approval.ts";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {previewManualObsidianSync} from "../lib/obsidian-manual-sync-review.ts";
import {
  chooseReviewIntent,serializeManualM3UploadIntent,
} from "../lib/obsidian-m2-review-choices.ts";
import {verifyStagedSandboxIncomingReceipt}
  from "../lib/obsidian-neon-sandbox-incoming.ts";

const BRANCH=NEON_SYNC_SANDBOX_BRANCH;
const API=NEON_SYNC_SANDBOX_DATA_API;
const AUTH="https://ep-square-cloud-b45d18zl.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const FLAG="--m3-m4-sandbox-synthetic-acceptance";
const APPROVAL="M3M4_SYNTHETIC_ONLY_20261028";
const WIKILINK_FLAG="--m3-m4-sandbox-wikilink-acceptance";
const WIKILINK_APPROVAL="M3WIKILINK_SYNTHETIC_ONLY_20261028";
const SUFFIX=randomUUID().replaceAll("-","").slice(0,14);
const SLUG="m3m4-acceptance-"+SUFFIX;
const digest=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
const markdown=(body:string)=>serializeObsidianMarkdown({
  slug:SLUG,title:"M3 M4 synthetic acceptance",excerpt:"Disposable sandbox test",
  category:"測試",tags:["m3m4"],learned_on:"2026-10-28",content_md:body,
});

type Command={code:number;output:string};
let syntheticOwnerId:string|null=null;
let jwt:string|null=null;
let noteCleaned=false;
const privatePaths:string[]=[];

export function assertM3M4AcceptanceApproval(input:{
  platform:string;computerName:string;args:readonly string[];
  generalApproval?:string;specificApproval?:string;wikiApproval?:string;
}):void{
  requireSandboxOwnerWriteApproval({
    platform:input.platform,computerName:input.computerName,
    projectId:OWNER_SANDBOX_PROJECT,branchId:BRANCH,
    acknowledgement:input.generalApproval,
  });
  const regular=input.args.length===1&&input.args[0]===FLAG&&
    input.specificApproval===APPROVAL;
  const linked=input.args.length===1&&input.args[0]===WIKILINK_FLAG&&
    input.wikiApproval===WIKILINK_APPROVAL;
  if(!(regular||linked)||
     new URL(API).hostname!=="ep-square-cloud-b45d18zl.apirest.c-6.us-east-2.aws.neon.tech"||
     new URL(AUTH).hostname!=="ep-square-cloud-b45d18zl.neonauth.c-6.us-east-2.aws.neon.tech"){
    throw Error("A new, exact-scope M3/M4 synthetic Sandbox acceptance approval is required");
  }
}

async function authRequest(route:string,body?:object,cookie?:string):Promise<Response>{
  const response=await fetch(AUTH+route,{
    method:body?"POST":"GET",redirect:"manual",credentials:"omit",
    headers:{Origin:"http://localhost:3000",Accept:"application/json",
      ...(body?{"Content-Type":"application/json"}:{}),
      ...(cookie?{Cookie:cookie}:{})},
    body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.timeout(20_000),
  });
  if(response.status!==200)throw Error("Synthetic Sandbox Auth request failed");
  return response;
}

async function createSyntheticOwner():Promise<string>{
  const signup=await authRequest("/sign-up/email",{
    email:"naosledge-m3m4-"+SUFFIX+"@example.com",
    password:randomBytes(40).toString("base64url")+"aA1!",
    name:"Disposable M3 M4 integration owner",
    callbackURL:"http://localhost:3000",
  });
  const payload=await signup.json() as {user?:{id?:string}};
  const id=payload.user?.id;
  if(typeof id!=="string"||id.length<10||id.length>256){
    throw Error("Synthetic Auth user ID unavailable");
  }
  syntheticOwnerId=id;
  // Print only the synthetic ID so a human can grant and later clean it.
  console.log("M3M4_SYNTHETIC_OWNER_CREATED id="+id+" branch="+BRANCH);
  const cookie=signup.headers.getSetCookie?.()
    .map(value=>value.split(";")[0]).filter(Boolean).join("; ")??"";
  if(!cookie)throw Error("Synthetic Auth session cookie unavailable");
  const session=await authRequest("/get-session",undefined,cookie);
  const token=session.headers.get("set-auth-jwt");
  if(!token||token.split(".").length!==3){
    throw Error("Synthetic Owner JWT unavailable");
  }
  const claim=JSON.parse(Buffer.from(token.split(".")[1],"base64url").toString("utf8")) as {sub?:string};
  if(claim.sub!==id)throw Error("Synthetic JWT subject does not match the disposable user");
  return token;
}

async function waitForGrant(token:string):Promise<void>{
  console.log("M3M4_WAIT_FOR_SANDBOX_OWNER_GRANT id="+syntheticOwnerId+" branch="+BRANCH);
  for(let attempt=0;attempt<180;attempt++){
    try{
      await verifyNeonSandboxOwnerRls({branchId:BRANCH,jwt:token});
      console.log("M3M4_OWNER_RLS_VERIFIED");
      return;
    }catch{
      await delay(1000);
    }
  }
  throw Error("Temporary Sandbox Owner grant was not confirmed");
}

async function manualCommand(
  name:string,filename:string,flag:string,request:object,expectSuccess=true,
):Promise<Command>{
  const file=path.join(ROOT,"scripts",filename);
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",file,flag,
    ],{cwd:ROOT,windowsHide:true,stdio:["pipe","pipe","pipe"]});
    let output="",stderrBytes=0,exceeded=false;
    const timeout=setTimeout(()=>{exceeded=true;child.kill();},60_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data",(data:string)=>{
      output+=data;
      if(output.length>8192){exceeded=true;child.kill();}
    });
    child.stderr.on("data",(data:string)=>{
      stderrBytes+=Buffer.byteLength(data);
      if(stderrBytes>8192){exceeded=true;child.kill();}
    });
    child.on("error",error=>{clearTimeout(timeout);reject(error);});
    child.on("close",code=>{
      clearTimeout(timeout);
      if(exceeded||(code===0)!==expectSuccess){
        reject(Error(name+" did not satisfy the required Sandbox verification result"));
      }else resolve({code:code??-1,output});
    });
    child.stdin.on("error",()=>{}); // CLI may refuse before consuming stdin.
    child.stdin.end(JSON.stringify(request));
  });
}

function resultPath(output:string,marker:string):string{
  const match=new RegExp("^"+marker+" (.+)$","m").exec(output);
  if(!match||match[1].trim().length>2048){
    throw Error("MSI acceptance command omitted the private Scratch receipt");
  }
  return match[1].trim();
}

async function checkedScratchDirectory(file:string,prefix:string):Promise<string>{
  const scratch=await realpath(tmpdir());
  const dir=path.dirname(path.resolve(file));
  if(path.dirname(dir).toLowerCase()!==scratch.toLowerCase()||
     !new RegExp("^"+prefix+"[A-Za-z0-9_-]{6}$").test(path.basename(dir))||
     (await realpath(dir)).toLowerCase()!==dir.toLowerCase()||
     !(await lstat(file)).isFile()){
    throw Error("Acceptance may only inspect and clean its isolated OS Scratch");
  }
  return dir;
}

async function ownerInventory(token:string){
  return fetchVerifiedNeonSandboxOwnerFingerprints({branchId:BRANCH,jwt:token});
}

async function inspectSyntheticNote(token:string):Promise<null|{id:string;slug:string;owner_id:string}>{
  const url=new URL(API+"/knowledge_notes");
  url.searchParams.set("select","id,slug,owner_id");
  url.searchParams.set("slug","eq."+SLUG);
  url.searchParams.set("limit","2");
  const response=await fetch(url.href,{
    method:"GET",credentials:"omit",redirect:"manual",cache:"no-store",
    headers:{Authorization:"Bearer "+token,Accept:"application/json",
      Prefer:"count=exact","Cache-Control":"no-store"},
    signal:AbortSignal.timeout(20_000),
  });
  if(response.status!==200||!response.headers.get("content-type")?.includes("application/json")){
    throw Error("Synthetic cleanup inventory is unavailable");
  }
  const raw=await response.text();
  if(Buffer.byteLength(raw,"utf8")>2048)throw Error("Synthetic cleanup inventory too large");
  const rows=JSON.parse(raw) as unknown;
  if(!Array.isArray(rows)||rows.length>1||
     response.headers.get("content-range")?.trim()!==
       (rows.length?"0-0/1":"*/0")){
    throw Error("Synthetic cleanup requires a complete exact single-note inventory");
  }
  if(!rows.length)return null;
  const note=rows[0] as Record<string,unknown>;
  if(Object.keys(note).length!==3||note.slug!==SLUG||
     note.owner_id!==syntheticOwnerId||
     typeof note.id!=="string"||
     !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(note.id)){
    throw Error("Synthetic cleanup identity does not match its disposable owner");
  }
  return note as {id:string;slug:string;owner_id:string};
}

async function removeOnlySyntheticNote(token:string):Promise<boolean>{
  const note=await inspectSyntheticNote(token);
  if(!note)return true;
  const url=new URL(API+"/knowledge_notes");
  url.searchParams.set("id","eq."+note.id);
  url.searchParams.set("slug","eq."+SLUG);
  url.searchParams.set("owner_id","eq."+syntheticOwnerId);
  const response=await fetch(url.href,{
    method:"DELETE",credentials:"omit",redirect:"manual",cache:"no-store",
    headers:{Authorization:"Bearer "+token,Accept:"application/json",
      Prefer:"return=representation","Cache-Control":"no-store"},
    signal:AbortSignal.timeout(20_000),
  });
  if(response.status!==200)return false;
  const rows=await response.json() as Array<{id?:string;slug?:string;owner_id?:string}>;
  return Array.isArray(rows)&&rows.length===1&&rows[0].id===note.id&&
    rows[0].slug===SLUG&&rows[0].owner_id===syntheticOwnerId&&
    (await inspectSyntheticNote(token))===null;
}

async function runAcceptance(token:string,withWikiLinks=false):Promise<void>{
  const original=markdown("# Synthetic M3 note\n\nCreate-only in a private sandbox.");
  const updated=markdown("# Synthetic M3 note UPDATED\n\nConditional update in a private sandbox.");
  const originalSha=digest(original),updatedSha=digest(updated);
  const before=await ownerInventory(token);
  assert.equal(before.numberOfNotes,0,"disposable Owner must start with an empty RLS inventory");

  // Real M2 decision constructor, rather than manually copying six fields.
  const preview=await previewManualObsidianSync({
    baseline:[],
    readLocal:async()=>({
      fingerprints:[{slug:SLUG,sha256:originalSha}],unsupportedMarkdownFiles:0,
      otherFiles:0,directoriesNotScanned:0,autoApplyAllowed:false,
    }),
    readRemote:async()=>before,
  });
  const intent=JSON.parse(serializeManualM3UploadIntent(
    preview,chooseReviewIntent(preview,{},SLUG,"upload"),SLUG,
  )) as unknown;

  const create=await manualCommand("M3 CREATE",
    "obsidian-m3-sandbox-manual-create.ts","--sandbox-scratch-create-only",{
      sandboxOwnerJwt:token,markdown:original,handoff:intent,
      typedConfirmation:"CREATE SANDBOX "+SLUG,
    });
  assert.match(create.output,/M3_SANDBOX_SCRATCH_CREATE_VERIFIED; BASELINE_NOT_SAVED/);
  const firstWitness=resultPath(create.output,"M5_PRIVATE_SCRATCH_WITNESS");
  privatePaths.push(firstWitness);
  await checkedScratchDirectory(firstWitness,"naosledge-sandbox-m3-witness-");
  console.log("M3M4_REAL_M3_CREATE_PASS");
  const afterCreate=await ownerInventory(token);
  assert.equal(afterCreate.numberOfNotes,1);
  const first=afterCreate.fingerprints.find(note=>note.slug===SLUG);
  assert.equal(first?.sha256,originalSha);
  assert.ok(first?.revision);

  const m5=await manualCommand("M5 CREATE recheck",
    "obsidian-m5-sandbox-reverify-witness.ts",
    "--sandbox-scratch-reverify-m3-witness-only",{
      sandboxOwnerJwt:token,localMarkdown:original,receiptPath:firstWitness,
    });
  assert.match(m5.output,/M5_SANDBOX_SCRATCH_AND_REMOTE_READ_ONLY_VERIFIED/);
  console.log("M3M4_REAL_M5_CROSS_PROCESS_READ_PASS");

  const firstDecision={
    slug:SLUG,choice:"review-missing-local",manualReview:true,
    expectedLocalSha:null,expectedRemoteSha:originalSha,
    expectedRemoteRevision:first.revision,
  };
  const incoming=await manualCommand("M4 Incoming",
    "obsidian-m4-sandbox-manual-incoming.ts","--sandbox-scratch-incoming-only",{
      sandboxOwnerJwt:token,decision:firstDecision,
      typedConfirmation:"SAVE SANDBOX INCOMING "+SLUG,
    });
  const firstReceipt=resultPath(incoming.output,"M4_SANDBOX_LOCAL_RECEIPT_SAVED");
  privatePaths.push(firstReceipt);
  await checkedScratchDirectory(firstReceipt,"naosledge-sandbox-incoming-");
  const incomingFile=resultPath(incoming.output,"M4_SANDBOX_INCOMING_SAVED");
  assert.equal(await readFile(incomingFile,"utf8"),original);
  const receipt=await verifyStagedSandboxIncomingReceipt(firstReceipt);
  assert.equal(receipt.sha256,originalSha);
  assert.equal(receipt.baselineSaved,false);
  console.log("M3M4_REAL_M4_INCOMING_PASS");

  // A real conditional PATCH changes the remote revision. Never re-use an
  // old incoming decision to silently accept a newer remote revision.
  await delay(1100);
  const update=await manualCommand("M3 UPDATE",
    "obsidian-m3-sandbox-manual-update.ts","--sandbox-manual-update-only",{
      sandboxOwnerJwt:token,markdown:updated,
      decision:{slug:SLUG,choice:"review-upload",manualReview:true,
        expectedLocalSha:updatedSha,expectedRemoteSha:originalSha,
        expectedRemoteRevision:first.revision},
      typedConfirmation:"UPDATE SANDBOX "+SLUG,
    });
  assert.match(update.output,/M3_SANDBOX_UPDATE_VERIFIED; BASELINE_NOT_SAVED/);
  const secondWitness=resultPath(update.output,"M5_PRIVATE_SCRATCH_WITNESS");
  privatePaths.push(secondWitness);
  await checkedScratchDirectory(secondWitness,"naosledge-sandbox-m3-witness-");
  const afterUpdate=await ownerInventory(token);
  assert.equal(afterUpdate.numberOfNotes,1);
  const latest=afterUpdate.fingerprints.find(note=>note.slug===SLUG);
  assert.equal(latest?.sha256,updatedSha);
  assert.notEqual(latest?.revision,first.revision);
  console.log("M3M4_REAL_M3_CAS_UPDATE_PASS");

  // Cross-process stale witness / stale M4 download must both refuse.
  await manualCommand("M5 stale witness refusal",
    "obsidian-m5-sandbox-reverify-witness.ts",
    "--sandbox-scratch-reverify-m3-witness-only",{
      sandboxOwnerJwt:token,localMarkdown:original,receiptPath:firstWitness,
    },false);
  await manualCommand("M4 stale revision refusal",
    "obsidian-m4-sandbox-manual-incoming.ts","--sandbox-scratch-incoming-only",{
      sandboxOwnerJwt:token,decision:firstDecision,
      typedConfirmation:"SAVE SANDBOX INCOMING "+SLUG,
    },false);
  console.log("M3M4_REAL_STALE_VERSION_REFUSED");

  const conflict=await manualCommand("M4 conflict keep-both",
    "obsidian-m4-sandbox-manual-incoming.ts","--sandbox-scratch-incoming-only",{
      sandboxOwnerJwt:token,localMarkdown:original,
      decision:{slug:SLUG,choice:"conflict",manualReview:true,
        expectedLocalSha:originalSha,expectedRemoteSha:updatedSha,
        expectedRemoteRevision:latest.revision},
      typedConfirmation:"SAVE SANDBOX INCOMING "+SLUG,
    });
  const conflictReceipt=resultPath(conflict.output,"M4_SANDBOX_LOCAL_RECEIPT_SAVED");
  privatePaths.push(conflictReceipt);
  await checkedScratchDirectory(conflictReceipt,"naosledge-sandbox-incoming-");
  const remoteCopy=resultPath(conflict.output,"M4_SANDBOX_INCOMING_SAVED");
  const localCopy=resultPath(conflict.output,"M4_SANDBOX_LOCAL_CONFLICT_COPY_SAVED");
  assert.equal(await readFile(remoteCopy,"utf8"),updated);
  assert.equal(await readFile(localCopy,"utf8"),original);
  const pair=await verifyStagedSandboxIncomingReceipt(conflictReceipt);
  assert.equal(pair.sha256,updatedSha);
  assert.equal(pair.localCopyPath,localCopy);
  assert.equal(pair.baselineSaved,false);
  console.log("M3M4_REAL_M4_CONFLICT_KEEP_BOTH_PASS");

  const secondRecheck=await manualCommand("M5 UPDATE recheck",
    "obsidian-m5-sandbox-reverify-witness.ts",
    "--sandbox-scratch-reverify-m3-witness-only",{
      sandboxOwnerJwt:token,localMarkdown:updated,receiptPath:secondWitness,
    });
  assert.match(secondRecheck.output,/M5_SANDBOX_SCRATCH_AND_REMOTE_READ_ONLY_VERIFIED/);

  if(withWikiLinks){
    // Distinct Owner authorization is REQUIRED for the real SQL003 RPC.
    // One disposable Sandbox note: link-free -> add WikiLink -> remove WikiLink.
    // Both operations use the normal MSI M3 Owner-RLS/CAS manual CLI, never
    // a direct admin SQL update or blind fallback PATCH.
    const linkedNote=markdown("# Synthetic M3 WikiLinks\n\nTest [[sandbox-target]]");
    const linkedSha=digest(linkedNote);
    await delay(1100);
    const linked=await manualCommand("M3 WikiLink CAS add",
      "obsidian-m3-sandbox-manual-update.ts","--sandbox-manual-update-only",{
        sandboxOwnerJwt:token,markdown:linkedNote,
        decision:{slug:SLUG,choice:"review-upload",manualReview:true,
          expectedLocalSha:linkedSha,expectedRemoteSha:updatedSha,
          expectedRemoteRevision:latest.revision},
        typedConfirmation:"UPDATE SANDBOX "+SLUG,
      });
    assert.match(linked.output,/M3_SANDBOX_UPDATE_VERIFIED; BASELINE_NOT_SAVED/);
    const linkedWitness=resultPath(linked.output,"M5_PRIVATE_SCRATCH_WITNESS");
    privatePaths.push(linkedWitness);
    await checkedScratchDirectory(linkedWitness,"naosledge-sandbox-m3-witness-");
    const newFp=(await ownerInventory(token)).fingerprints.find(n=>n.slug===SLUG);
    assert.equal(newFp?.sha256,linkedSha);
    assert.notEqual(newFp?.revision,latest.revision);
    console.log("M3M4_REAL_WIKILINK_CAS_ADD_PASS");

    await delay(1100);
    const removed=await manualCommand("M3 WikiLink CAS remove",
      "obsidian-m3-sandbox-manual-update.ts","--sandbox-manual-update-only",{
        sandboxOwnerJwt:token,markdown:updated,
        decision:{slug:SLUG,choice:"review-upload",manualReview:true,
          expectedLocalSha:updatedSha,expectedRemoteSha:linkedSha,
          expectedRemoteRevision:newFp.revision},
        typedConfirmation:"UPDATE SANDBOX "+SLUG,
      });
    assert.match(removed.output,/M3_SANDBOX_UPDATE_VERIFIED; BASELINE_NOT_SAVED/);
    const removedWitness=resultPath(removed.output,"M5_PRIVATE_SCRATCH_WITNESS");
    privatePaths.push(removedWitness);
    await checkedScratchDirectory(removedWitness,"naosledge-sandbox-m3-witness-");
    const afterRemoval=(await ownerInventory(token)).fingerprints.find(n=>n.slug===SLUG);
    assert.equal(afterRemoval?.sha256,updatedSha);
    assert.notEqual(afterRemoval?.revision,newFp.revision);
    console.log("M3M4_REAL_WIKILINK_CAS_REMOVE_PASS");
  }
  console.log("M3M4_REAL_SANDBOX_M3_M4_M5_E2E_PASS; NO_VAULT_WRITE; NO_BASELINE");
}

async function main():Promise<void>{
  // Check both approval scopes BEFORE creating the temporary Auth user.
  assertM3M4AcceptanceApproval({
    platform:process.platform,computerName:hostname(),args:process.argv.slice(2),
    generalApproval:process.env.NAOSLEDGE_SYNTHETIC_SANDBOX_WRITE_APPROVED,
    specificApproval:process.env.NAOSLEDGE_M3M4_REAL_E2E_APPROVED,
    wikiApproval:process.env.NAOSLEDGE_M3_WIKILINK_E2E_APPROVED,
  });
  try{
    jwt=await createSyntheticOwner();
    await waitForGrant(jwt);
    await runAcceptance(jwt,process.argv[2]===WIKILINK_FLAG);
  }catch{
    console.error("M3M4_SANDBOX_E2E_NOT_COMPLETED; inspect exact synthetic cleanup handoff");
    process.exitCode=1;
  }finally{
    // Only delete the disposable owner+slug created by THIS script; never
    // delete a real user or any note whose owner cannot be verified.
    if(jwt&&syntheticOwnerId){
      try{noteCleaned=await removeOnlySyntheticNote(jwt);}
      catch{noteCleaned=false;}
    }else noteCleaned=syntheticOwnerId===null;
    for(const file of privatePaths){
      try{
        const prefix=path.basename(file)==="transfer-witness.json"?
          "naosledge-sandbox-m3-witness-":"naosledge-sandbox-incoming-";
        const dir=await checkedScratchDirectory(file,prefix);
        await rm(dir,{recursive:true,force:true});
      }catch{
        console.error("M3M4_PRIVATE_SCRATCH_CLEANUP_UNVERIFIED; manual owner inspection required");
        process.exitCode=1;
      }
    }
    console.log("M3M4_SANDBOX_CLEANUP_HANDOFF "+JSON.stringify({
      projectId:OWNER_SANDBOX_PROJECT,branchId:BRANCH,
      syntheticOwnerId,syntheticSlug:SLUG,syntheticNoteCleaned:noteCleaned,
      temporaryGrantAndAuthUserRequireOwnerCleanup:!!syntheticOwnerId,
    }));
    if(!noteCleaned)process.exitCode=1;
  }
}

const invoked=process.argv[1]?
  path.resolve(process.argv[1])===fileURLToPath(import.meta.url):false;
if(invoked)await main();
