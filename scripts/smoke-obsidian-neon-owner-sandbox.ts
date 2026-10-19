/**
 * Explicitly authorized 2026-10-19 live Neon INTEGRATION SANDBOX-only
 * synthetic-owner JWT / RLS / note CRUD / stale-CAS / deletion acceptance.
 *
 * Requires an out-of-band, single-ID sandbox admin grant after sign-up.
 * Test credentials and JWTs are generated in RAM, never written to disk/logs.
 *
 * NO production URLs, real MSI Vault I/O, app deployments, cron or AI APIs.
 * Only synthetic users created here; operator must remove their Auth entries
 * and the sandbox-only blog_admins grant after this command completes.
 */
import assert from "node:assert/strict";
import {randomBytes,randomUUID,createHash} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {fetchNeonSandboxFingerprints,NEON_SYNC_SANDBOX_BRANCH,NEON_SYNC_SANDBOX_DATA_API}
  from "../lib/obsidian-neon-sandbox-readonly.ts";
import {planObsidianReconciliation} from "../lib/obsidian-sync-plan.ts";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {requireSandboxOwnerWriteApproval,OWNER_SANDBOX_PROJECT}
  from "../lib/obsidian-neon-owner-sandbox-approval.ts";

const SANDBOX_AUTH="https://ep-square-cloud-b45d18zl.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth";
const API=NEON_SYNC_SANDBOX_DATA_API;
const ORIGIN="http://localhost:3000";
const BRANCH=NEON_SYNC_SANDBOX_BRANCH;
const OWNED_UID_PREFIX="naosledge-obsidian-sandbox-";
const idSuffix=randomUUID().replaceAll("-","").slice(0,13);
const syntheticSlug="obsidian-owner-e2e-"+idSuffix;
const SYNTH_BODY_V1="# Synthetic Obsidian note\n\n[[sandbox-reference]]\nOnly safe test text.";
const SYNTH_BODY_V2="# Synthetic Obsidian note UPDATED\n\n[[sandbox-reference]]\nSafe fake text only.";
const SYNTH_BODY_LOCAL="# Synthetic Obsidian note LOCAL conflict\n\n[[sandbox-reference]]";
const SYNTH_SUMMARY="Only synthetic sandbox metadata";
const SYNTH_TITLE="Obsidian RLS synthetic validation";

function assertSandbox():void{
  requireSandboxOwnerWriteApproval({
    platform:process.platform,computerName:process.env.COMPUTERNAME??"",
    projectId:OWNER_SANDBOX_PROJECT,branchId:BRANCH,
    acknowledgement:process.env.NAOSLEDGE_SYNTHETIC_SANDBOX_WRITE_APPROVED,
  });
  if(new URL(API).hostname!=="ep-square-cloud-b45d18zl.apirest.c-6.us-east-2.aws.neon.tech"||
     new URL(SANDBOX_AUTH).hostname!=="ep-square-cloud-b45d18zl.neonauth.c-6.us-east-2.aws.neon.tech"){
    throw Error("Live synthetic Sandbox host mismatch");
  }
}
function errorMessage(label:string,status:number):Error{
  return Error(label+" unexpected HTTP "+status);
}
async function safeAuth(path:string,body?:unknown,cookie?:string){
  assertSandbox();
  const response=await fetch(SANDBOX_AUTH+path,{
    method:body===undefined?"GET":"POST",
    headers:{
      Origin:ORIGIN,Accept:"application/json",
      ...(body===undefined?{}:{"Content-Type":"application/json"}),
      ...(cookie?{Cookie:cookie}:{}),
    },
    body:body===undefined?undefined:JSON.stringify(body),
    redirect:"manual",
    signal:AbortSignal.timeout(20000),
  });
  if(response.status!==200)throw errorMessage("Sandbox Auth "+path,response.status);
  return response;
}
type Account={id:string;token:string;cookie:string;kind:"owner"|"guest"};
async function makeUser(kind:"owner"|"guest"):Promise<Account>{
  const email=OWNED_UID_PREFIX+kind+"-"+idSuffix+"@example.com";
  const password=randomBytes(35).toString("base64url")+"aA1!";
  const res=await safeAuth("/sign-up/email",{
    email,password,name:"Sandbox Obsidian synthetic "+kind,callbackURL:ORIGIN,
  });
  // No password/JWT/email ever printed or persisted.
  const data=await res.json() as {user?:{id?:string}};
  const id=data.user?.id;
  if(typeof id!=="string"||id.length<10||id.length>256)throw Error("Neon Sandbox signup missing user ID");
  // Print the generated synthetic ID as soon as signup succeeds: even if
  // the session/JWT stage fails, the operator can identify and remove it.
  console.log("SANDBOX_CREATED_AUTH_USER "+kind+" id="+id+" branch="+BRANCH);
  // Keep only minimal httpOnly cookies for the Auth /get-session call in RAM.
  const cookie=res.headers.getSetCookie?.()
    .map(x=>x.split(";")[0]).filter(Boolean).join("; ")??"";
  if(!cookie)throw Error("Synthetic Sandbox signup returned no session cookie");
  const session=await safeAuth("/get-session",undefined,cookie);
  const token=session.headers.get("set-auth-jwt");
  if(!token||token.split(".").length!==3)throw Error("No sandbox owner-scoped JWT");
  const subject=JSON.parse(Buffer.from(token.split(".")[1],"base64url").toString("utf8")).sub;
  if(subject!==id)throw Error("Neon JWT subject does not match synthetic user");
  console.log("SANDBOX_SYNTHETIC_USER "+kind+" id="+id+" branch="+BRANCH);
  return {id,token,cookie,kind};
}
type RestResponse={status:number;data:unknown};
async function api(
  table:"knowledge_notes"|"knowledge_links"|"blog_admins",
  token:string,
  {method="GET",where="",body,returnRows=false}:
    {method?:"GET"|"POST"|"PATCH"|"DELETE";where?:string;body?:unknown;returnRows?:boolean}={},
):Promise<RestResponse>{
  assertSandbox();
  const url=API+"/"+table+(where?(where.startsWith("?")?where:"?"+where):"");
  const r=await fetch(url,{
    method,redirect:"manual",credentials:"omit",
    headers:{
      Authorization:"Bearer "+token,
      Accept:"application/json",
      ...(body===undefined?{}:{"Content-Type":"application/json"}),
      ...(returnRows?{Prefer:"return=representation"}:{}),
    },
    body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(20000),
  });
  let data:unknown=null;
  // Never log server responses (could contain note content).
  try{data=await r.json() as unknown;}catch{}
  return {status:r.status,data};
}
function success(result:RestResponse,label:string,codes=[200,201]):any[]{
  if(!codes.includes(result.status))throw errorMessage(label,result.status);
  if(!Array.isArray(result.data))throw Error(label+" response is not a JSON array");
  return result.data;
}
function expectDenied(result:RestResponse,label:string){
  if(![401,403].includes(result.status)){
    throw errorMessage(label+" expected access denial",result.status);
  }
}
function sha(text:string){return createHash("sha256").update(text).digest("hex");}

let owner:Account|undefined;
let guest:Account|undefined;
let createdNoteId="";
let noteDeleted=false;
const cleanupIssues:string[]=[];
try{
  assertSandbox();
  owner=await makeUser("owner");
  guest=await makeUser("guest");
  // This is the handoff point for exactly one external SQL grant.
  console.log("WAITING_FOR_SANDBOX_ADMIN_GRANT owner_id="+owner.id+" branch="+BRANCH);
  let granted=false;
  for(let i=0;i<180;i++){
    const current=await api("blog_admins",owner.token,{where:"select=user_id"});
    if(current.status===200&&Array.isArray(current.data)){
      if(current.data.some((u:any)=>u?.user_id===owner!.id)){granted=true;break;}
    }else if(![200,403].includes(current.status)){
      throw errorMessage("Owner blog_admins grant poll",current.status);
    }
    await delay(1000);
  }
  if(!granted)throw Error("Sandbox synthetic-owner admin grant timeout");
  console.log("PASS_SANDBOX_SYNTHETIC_OWNER_JWT_ADMIN_GRANT");

  const noGuest=await api("knowledge_notes",guest.token,{where:"select=id"});
  if(noGuest.status===200){
    if(!Array.isArray(noGuest.data)||noGuest.data.length)throw Error("Guest improperly sees private note IDs");
  }else expectDenied(noGuest,"Unprivileged guest note list");

  const guestAttempt=await api("knowledge_notes",guest.token,{
    method:"POST",body:{slug:syntheticSlug+"-guest",title:SYNTH_TITLE,content_md:SYNTH_BODY_V1},
    returnRows:true,
  });
  expectDenied(guestAttempt,"Unprivileged guest insert");
  console.log("PASS_GUEST_JWT_CANNOT_WRITE_PRIVATE_NOTES");

  const draft={
    slug:syntheticSlug,title:SYNTH_TITLE,summary:SYNTH_SUMMARY,
    content_md:SYNTH_BODY_V1,category:"驗證",
    tags:["qa","sandbox"],learned_on:"2026-10-19",
  };
  const inserted=success(await api("knowledge_notes",owner.token,{
    method:"POST",body:draft,returnRows:true,
  }),"owner create",[201]);
  if(inserted.length!==1||inserted[0]?.slug!==syntheticSlug||
     inserted[0]?.owner_id!==owner.id||
     typeof inserted[0]?.id!=="string")throw Error("Synthetic note ownership was not set by JWT");
  createdNoteId=inserted[0].id;
  console.log("PASS_OWNER_JWT_PRIVATE_NOTE_CREATE slug="+syntheticSlug);

  const listWhere="select=id,slug,content_md,updated_at&slug=eq."+syntheticSlug;
  const onlyOwner=success(await api("knowledge_notes",owner.token,{where:listWhere}),"Owner read");
  if(onlyOwner.length!==1||onlyOwner[0].content_md!==SYNTH_BODY_V1)throw Error("Synthetic owner cannot read own note");
  const ownerUpdatedAt=onlyOwner[0].updated_at;
  if(typeof ownerUpdatedAt!=="string")throw Error("Missing note revision timestamp");
  const guestSees=await api("knowledge_notes",guest.token,{where:listWhere});
  if(guestSees.status===200){
    if(!Array.isArray(guestSees.data)||guestSees.data.length)throw Error("Guest saw owner content");
  }else expectDenied(guestSees,"Guest RLS select");
  console.log("PASS_AUTHENTICATED_OWNER_RLS_ISOLATION");

  const fingerprintBefore=await fetchNeonSandboxFingerprints({branchId:BRANCH,jwt:owner.token});
  if(fingerprintBefore.numberOfNotes!==1||fingerprintBefore.fingerprints[0].slug!==syntheticSlug) {
    throw Error("Sandbox owner remote inventory missing synthetic note");
  }
  const markdown=serializeObsidianMarkdown({...draft,excerpt:draft.summary});
  if(sha(markdown)!==fingerprintBefore.fingerprints[0].sha256){
    throw Error("Remote fingerprint does not match portable Obsidian MD export");
  }
  console.log("PASS_REAL_SANDBOX_OWNER_READ_AND_OBSIDIAN_SHA256");

  const link=success(await api("knowledge_links",owner.token,{
    method:"POST",body:{source_note_id:createdNoteId,target_key:"sandbox-reference"},
    returnRows:true,
  }),"owner unresolved wiki relation",[201]);
  if(link.length!==1||link[0].source_note_id!==createdNoteId){
    throw Error("Synthetic private link insertion missing");
  }
  const guestLinks=await api("knowledge_links",guest.token,{
    where:"select=source_note_id&source_note_id=eq."+encodeURIComponent(createdNoteId),
  });
  if(guestLinks.status===200){
    if(!Array.isArray(guestLinks.data)||guestLinks.data.length)throw Error("Guest saw owner wiki link");
  }else expectDenied(guestLinks,"Guest links read");
  console.log("PASS_OWNER_WIKILINK_RLS_AND_GUEST_ISOLATION");

  // Ensure updated_at changes even under PostgreSQL transaction timestamp.
  await delay(1100);
  const casBase="?id=eq."+encodeURIComponent(createdNoteId)+
    "&updated_at=eq."+encodeURIComponent(ownerUpdatedAt);
  const changed=success(await api("knowledge_notes",owner.token,{
    method:"PATCH",where:casBase,body:{content_md:SYNTH_BODY_V2},returnRows:true,
  }),"owner optimistic edit");
  if(changed.length!==1||changed[0].content_md!==SYNTH_BODY_V2||
     changed[0].updated_at===ownerUpdatedAt){
    throw Error("Optimistic update failed to write a new revision");
  }
  const stale=success(await api("knowledge_notes",owner.token,{
    method:"PATCH",where:casBase,body:{content_md:"UNSAFE_STALE_OVERWRITE"},
    returnRows:true,
  }),"stale optimistic edit");
  if(stale.length!==0)throw Error("Stale optimistic update overwrote existing content");
  console.log("PASS_REAL_NEON_OPTIMISTIC_STALE_EDIT_REJECTED");

  const fingerprintAfter=await fetchNeonSandboxFingerprints({branchId:BRANCH,jwt:owner.token});
  if(fingerprintAfter.numberOfNotes!==1||
     fingerprintAfter.fingerprints[0].sha256===fingerprintBefore.fingerprints[0].sha256){
    throw Error("Remote fingerprint revision failed to capture updated note");
  }
  const localConflict=serializeObsidianMarkdown({...draft,excerpt:draft.summary,
    content_md:SYNTH_BODY_LOCAL});
  const plan=planObsidianReconciliation({
    local:[{slug:syntheticSlug,sha256:sha(localConflict)}],
    remote:fingerprintAfter.fingerprints,
    baseline:fingerprintBefore.fingerprints,
  });
  if(plan.summary.conflict!==1||plan.autoApplyAllowed!==false){
    throw Error("Simultaneous Obsidian/Neon divergence was not blocked");
  }
  console.log("PASS_REAL_NEON_TWO_SIDED_CONFLICT_REVIEW_ONLY");

  // Only delete *this* synthetic note, by both random synthetic slug + UUID.
  const filter="?id=eq."+encodeURIComponent(createdNoteId)+
    "&slug=eq."+encodeURIComponent(syntheticSlug);
  const deleted=success(await api("knowledge_notes",owner.token,{
    method:"DELETE",where:filter,returnRows:true,
  }),"owner delete synthetic note");
  if(deleted.length!==1||deleted[0].id!==createdNoteId){
    throw Error("Synthetic note deletion identity mismatch");
  }
  noteDeleted=true;
  const finalNotes=success(await api("knowledge_notes",owner.token,{where:listWhere}),"post-delete read");
  if(finalNotes.length)throw Error("Synthetic note remains after deletion");
  const linkRows=success(await api("knowledge_links",owner.token,{
    where:"select=source_note_id&source_note_id=eq."+encodeURIComponent(createdNoteId),
  }),"post-delete cascade");
  if(linkRows.length)throw Error("Synthetic wiki link remains after cascade");
  const finalFingerprint=await fetchNeonSandboxFingerprints({branchId:BRANCH,jwt:owner.token});
  if(finalFingerprint.numberOfNotes!==0)throw Error("Sandbox remote inventory not clean");
  console.log("PASS_SYNTHETIC_NOTE_DELETE_AND_LINK_CASCADE");
  console.log("SANDBOX_OWNER_E2E_SUCCESS real JWT/RLS/CRUD/CAS/conflict/cleanup; no production");
}catch(error){
  const reason=error instanceof Error?error.message:String(error);
  console.error("SANDBOX_OWNER_E2E_FAILURE "+reason.slice(0,220));
  process.exitCode=1;
}finally{
  // Best effort bounded record cleanup, even after a mid-test exception.
  if(createdNoteId&&!noteDeleted&&owner){
    try{
      const filter="?id=eq."+encodeURIComponent(createdNoteId)+
        "&slug=eq."+encodeURIComponent(syntheticSlug);
      const res=await api("knowledge_notes",owner.token,{
        method:"DELETE",where:filter,returnRows:true,
      });
      if(res.status!==200&&res.status!==204)cleanupIssues.push("synthetic-note-delete-status-"+res.status);
      else console.log("SANDBOX_BEST_EFFORT_SYNTHETIC_NOTE_CLEANUP");
    }catch{cleanupIssues.push("synthetic-note-delete-request-failed");}
  }
  // The outer orchestrator uses these IDs to remove precisely ONE admin
  // grant and these TWO Neon Auth users via branch-scoped connector calls.
  // No password, e-mail, JWT, cookies or content in logs.
  console.log("SANDBOX_CLEANUP_HANDOFF "+JSON.stringify({
    projectId:"bitter-silence-36632892",branchId:BRANCH,
    ownerId:owner?.id??null,guestId:guest?.id??null,
    syntheticSlug,syntheticNoteId:createdNoteId||null,
    syntheticNoteDeleted:noteDeleted,
    needsOperatorAuthAndGrantCleanup:true,
    issues:cleanupIssues,
  }));
}
