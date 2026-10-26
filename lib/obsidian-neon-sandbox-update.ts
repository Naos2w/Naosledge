/**
 * M3: one manually approved conditional UPDATE against the pinned Neon
 * integration Sandbox. Never touches the real Vault or Production and never
 * writes a sync Baseline. The database WHERE clause, not a prior GET alone,
 * prevents overwriting a concurrently edited note.
 */
import {createHash} from "node:crypto";
import {parseObsidianMarkdown,serializeObsidianMarkdown}
  from "./obsidian-markdown.ts";
import {extractWikiReferences} from "./wiki-links.ts";
import {
  NEON_SYNC_SANDBOX_BRANCH,NEON_SYNC_SANDBOX_DATA_API,
  fetchVerifiedNeonSandboxOwnerFingerprints,fetchNeonSandboxFingerprints,
  fetchVerifiedNeonSandboxMarkdown,
} from "./obsidian-neon-sandbox-readonly.ts";
import type {SyncDecision} from "./obsidian-sync-plan.ts";

type Fetcher=typeof fetch;
const SHA=/^[0-9a-f]{64}$/;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function digest(s:string):string{
  return createHash("sha256").update(s,"utf8").digest("hex");
}

async function smallJsonRows(response:Response,requireExactRange:boolean):Promise<unknown[]>{
  if(response.status!==200||
     !/application\/json/i.test(response.headers.get("content-type")||"")||
     (requireExactRange&&response.headers.get("content-range")?.trim()!=="0-0/1")){
    throw Error("M3 conditional Sandbox response unavailable or incomplete");
  }
  const length=response.headers.get("content-length");
  if(length!==null&&(!Number.isSafeInteger(Number(length))||Number(length)>8192)){
    throw Error("M3 conditional Sandbox response too large");
  }
  const raw=await response.text();
  if(Buffer.byteLength(raw,"utf8")>8192)throw Error("M3 conditional Sandbox response too large");
  try{
    const rows=JSON.parse(raw) as unknown;
    if(Array.isArray(rows))return rows;
  }catch{
    // Never leak a private server response or JWT.
  }
  throw Error("M3 conditional Sandbox response invalid");
}

function checkedIdentity(row:unknown,slug:string):{id:string;updatedAt:string}{
  if(!row||typeof row!=="object"||Array.isArray(row)){
    throw Error("M3 conditional Sandbox returned invalid note identity");
  }
  const fields=row as Record<string,unknown>;
  if(fields.slug!==slug||typeof fields.id!=="string"||!UUID.test(fields.id)||
     typeof fields.updated_at!=="string"||fields.updated_at.length>50||
     !Number.isFinite(Date.parse(fields.updated_at))){
    throw Error("M3 conditional Sandbox returned invalid note identity");
  }
  return {id:fields.id,updatedAt:fields.updated_at};
}

/** Exact RLS-visible link inventory, not a bounded partial list. */
async function readOutgoingWikiIndex(
  request:Fetcher,endpoint:string,jwt:string,noteId:string,
):Promise<string[]>{
  const url=new URL(endpoint+"/knowledge_links");
  url.searchParams.set("select","target_key");
  url.searchParams.set("source_note_id","eq."+noteId);
  url.searchParams.set("order","target_key.asc");
  url.searchParams.set("limit","81");
  const response=await request(url.href,{
    method:"GET",redirect:"manual",credentials:"omit",cache:"no-store",
    headers:{Authorization:"Bearer "+jwt,Accept:"application/json",
      "Cache-Control":"no-store",Prefer:"count=exact"},
    signal:AbortSignal.timeout(16000),
  });
  if(response.status!==200||
     !(response.headers.get("content-type")||"").toLowerCase().includes("application/json")){
    throw Error("M3 outgoing WikiLink inventory unavailable");
  }
  const raw=await response.text();
  if(Buffer.byteLength(raw,"utf8")>16384){
    throw Error("M3 outgoing WikiLink inventory exceeds limit");
  }
  let value:unknown;
  try{value=JSON.parse(raw) as unknown;}catch{
    throw Error("M3 outgoing WikiLink inventory invalid");
  }
  if(!Array.isArray(value)||value.length>80)throw Error("M3 outgoing WikiLink inventory incomplete");
  const keys:string[]=[];
  for(const item of value){
    if(!item||typeof item!=="object"||Array.isArray(item)||
       Object.keys(item).length!==1||
       typeof (item as {target_key?:unknown}).target_key!=="string"){
      throw Error("M3 outgoing WikiLink inventory invalid");
    }
    keys.push((item as {target_key:string}).target_key);
  }
  const range=keys.length===0?"*/0":`0-${keys.length-1}/${keys.length}`;
  if(response.headers.get("content-range")?.trim()!==range||
     keys.some((key,i)=>key!==key.trim().toLowerCase()||
       key.length<1||key.length>160||(i>0&&keys[i-1]>=key))){
    throw Error("M3 outgoing WikiLink inventory incomplete");
  }
  return keys;
}

export async function updateNeonSandboxNoteIfUnchanged(args:{
  branchId:string;
  sandboxOwnerJwt:string;
  /** Reviewed M1 decision based on a trusted Baseline, not just an M2 click. */
  decision:SyncDecision;
  /** Re-read the exact approved portable .md only after remote preflight. */
  readMarkdown:()=>Promise<string>;
  typedConfirmation:string;
  fetcher?:Fetcher;
}):Promise<{slug:string;sha256:string;revision:string;baselineSaved:false}>{
  const d=args?.decision?{...args.decision}:null;
  if(!args||args.branchId!==NEON_SYNC_SANDBOX_BRANCH||
     typeof args.readMarkdown!=="function"||!d||
     d.choice!=="review-upload"||d.manualReview!==true||
     typeof d.slug!=="string"||d.slug.length<3||d.slug.length>120||
     !SLUG.test(d.slug)||
     typeof d.expectedLocalSha!=="string"||!SHA.test(d.expectedLocalSha)||
     typeof d.expectedRemoteSha!=="string"||!SHA.test(d.expectedRemoteSha)||
     typeof d.expectedRemoteRevision!=="string"||!SHA.test(d.expectedRemoteRevision)||
     d.expectedRemoteSha===d.expectedLocalSha||
     args.typedConfirmation!=="UPDATE SANDBOX "+d.slug){
    throw Error("M3 requires a separately approved single-note conditional update");
  }
  const request=args.fetcher??fetch;
  const before=await fetchVerifiedNeonSandboxOwnerFingerprints({
    branchId:args.branchId,jwt:args.sandboxOwnerJwt,fetcher:request,
  });
  const old=before.fingerprints.find(n=>n.slug===d.slug);
  if(!old||old.sha256!==d.expectedRemoteSha||
     old.revision!==d.expectedRemoteRevision){
    throw Error("M3 remote Sandbox version changed before update");
  }

  // Get the true row identity + updated_at; the reviewed revision is the SHA
  // of precisely these two fields in the existing read-only adapter.
  const endpoint=NEON_SYNC_SANDBOX_DATA_API.replace(/\/$/,"")+"/knowledge_notes";
  const witnessUrl=new URL(endpoint);
  witnessUrl.searchParams.set("select","id,slug,updated_at");
  witnessUrl.searchParams.set("slug","eq."+d.slug);
  witnessUrl.searchParams.set("limit","2");
  const witnessResponse=await request(witnessUrl.href,{
    method:"GET",redirect:"manual",credentials:"omit",cache:"no-store",
    headers:{
      Authorization:"Bearer "+args.sandboxOwnerJwt,Accept:"application/json",
      "Cache-Control":"no-store",Prefer:"count=exact",
    },
    signal:AbortSignal.timeout(16000),
  });
  const witnesses=await smallJsonRows(witnessResponse,true);
  if(witnesses.length!==1)throw Error("M3 conditional Sandbox identity unavailable");
  const identity=checkedIdentity(witnesses[0],d.slug);
  const witnessedRevision=digest(identity.id+":"+identity.updatedAt);
  if(witnessedRevision!==d.expectedRemoteRevision){
    throw Error("M3 remote Sandbox version changed before update");
  }

  const markdown=await args.readMarkdown();
  if(typeof markdown!=="string"||Buffer.byteLength(markdown,"utf8")>250_000){
    throw Error("M3 requires one bounded portable Markdown note");
  }
  const parsed=parseObsidianMarkdown(markdown,d.slug+".md","1970-01-01");
  if(!parsed||parsed.metadata.slug!==d.slug||
     serializeObsidianMarkdown({...parsed.metadata,content_md:parsed.content_md})!==markdown||
     digest(markdown)!==d.expectedLocalSha){
    throw Error("M3 local Markdown changed since individual review");
  }

  const newWikiKeys=extractWikiReferences(parsed.content_md);
  if(newWikiKeys.length>80)throw Error("M3 conditional update exceeds WikiLink limit");
  const originalMarkdown=await fetchVerifiedNeonSandboxMarkdown({
    branchId:args.branchId,jwt:args.sandboxOwnerJwt,slug:d.slug,
    expectedSha256:d.expectedRemoteSha,
    expectedRevision:d.expectedRemoteRevision,fetcher:request,
  });
  const original=parseObsidianMarkdown(originalMarkdown,d.slug+".md","1970-01-01");
  if(!original)throw Error("M3 Sandbox original Markdown unavailable");
  const oldWikiKeys=extractWikiReferences(original.content_md);
  const atomicWikiUpdate=newWikiKeys.length>0||oldWikiKeys.length>0;
  let updated:{id:string;updatedAt:string};

  if(atomicWikiUpdate){
    // Refuse stale or inconsistent RLS-visible backlinks before the write.
    // The SQL RPC repeats this check *under the note-row lock*; the GET
    // alone is never considered CAS authorization.
    const indexed=await readOutgoingWikiIndex(
      request,NEON_SYNC_SANDBOX_DATA_API,args.sandboxOwnerJwt,identity.id,
    );
    if(JSON.stringify(indexed)!==JSON.stringify([...oldWikiKeys].sort())){
      throw Error("M3 outgoing WikiLink index differs from reviewed Markdown");
    }
    // This NEW candidate RPC must be separately approved and installed on
    // the pinned Sandbox. A missing RPC fails closed; NEVER fall back to the
    // old blind save_knowledge_note(p_id) or a direct PATCH.
    const rpcUrl=NEON_SYNC_SANDBOX_DATA_API+"/rpc/update_knowledge_note_cas_with_links";
    const response=await request(rpcUrl,{
      method:"POST",redirect:"manual",credentials:"omit",cache:"no-store",
      headers:{Authorization:"Bearer "+args.sandboxOwnerJwt,
        Accept:"application/json","Content-Type":"application/json",
        "Cache-Control":"no-store",Prefer:"return=representation"},
      body:JSON.stringify({
        p_id:identity.id,p_slug:d.slug,p_expected_updated_at:identity.updatedAt,
        p_expected_links:oldWikiKeys,p_title:parsed.metadata.title,
        p_summary:parsed.metadata.excerpt,p_content_md:parsed.content_md,
        p_category:parsed.metadata.category,p_tags:parsed.metadata.tags,
        p_learned_on:parsed.metadata.learned_on,p_links:newWikiKeys,
      }),
      signal:AbortSignal.timeout(16000),
    });
    if(response.status!==200||
       !(response.headers.get("content-type")||"").toLowerCase().includes("application/json")){
      throw Error("M3 atomic WikiLink update needs manual reconciliation");
    }
    const reply=await response.text();
    if(Buffer.byteLength(reply,"utf8")>2048){
      throw Error("M3 atomic WikiLink update needs manual reconciliation");
    }
    let returnedId:unknown;
    try{returnedId=JSON.parse(reply) as unknown;}catch{
      throw Error("M3 atomic WikiLink update needs manual reconciliation");
    }
    if(returnedId!==identity.id){
      throw Error("M3 atomic WikiLink update needs manual reconciliation");
    }
    // PostgREST scalar RPC returns only a UUID. Witness its actual new row
    // revision before trusting the inventory fingerprint.
    const witnessed=await request(witnessUrl.href,{
      method:"GET",redirect:"manual",credentials:"omit",cache:"no-store",
      headers:{Authorization:"Bearer "+args.sandboxOwnerJwt,
        Accept:"application/json","Cache-Control":"no-store",Prefer:"count=exact"},
      signal:AbortSignal.timeout(16000),
    });
    const rows=await smallJsonRows(witnessed,true);
    if(rows.length!==1)throw Error("M3 atomic WikiLink update needs manual reconciliation");
    updated=checkedIdentity(rows[0],d.slug);
  }else{
    // Link-free legacy route keeps its original strict empty-index check and
    // single-statement row-level CAS PATCH, without requiring the new RPC.
    const linksUrl=new URL(NEON_SYNC_SANDBOX_DATA_API.replace(/\/$/,"")+"/knowledge_links");
    linksUrl.searchParams.set("select","target_key");
    linksUrl.searchParams.set("source_note_id","eq."+identity.id);
    linksUrl.searchParams.set("limit","1");
    const linksResponse=await request(linksUrl.href,{
      method:"GET",redirect:"manual",credentials:"omit",cache:"no-store",
      headers:{Authorization:"Bearer "+args.sandboxOwnerJwt,Accept:"application/json",
        "Cache-Control":"no-store",Prefer:"count=exact"},
      signal:AbortSignal.timeout(16000),
    });
    const links=await smallJsonRows(linksResponse,false);
    if(links.length!==0||linksResponse.headers.get("content-range")?.trim()!=="*/0"){
      throw Error("M3 Sandbox update cannot preserve the outgoing WikiLink index");
    }
    const patchUrl=new URL(endpoint);
    patchUrl.searchParams.set("id","eq."+identity.id);
    patchUrl.searchParams.set("slug","eq."+d.slug);
    patchUrl.searchParams.set("updated_at","eq."+identity.updatedAt);
    patchUrl.searchParams.set("select","id,slug,updated_at");
    const patchResponse=await request(patchUrl.href,{
      method:"PATCH",redirect:"manual",credentials:"omit",cache:"no-store",
      headers:{
        Authorization:"Bearer "+args.sandboxOwnerJwt,Accept:"application/json",
        "Content-Type":"application/json","Cache-Control":"no-store",
        Prefer:"return=representation",
      },
      body:JSON.stringify({
        title:parsed.metadata.title,summary:parsed.metadata.excerpt,
        content_md:parsed.content_md,category:parsed.metadata.category,
        tags:parsed.metadata.tags,learned_on:parsed.metadata.learned_on,
      }),
      signal:AbortSignal.timeout(16000),
    });
    const updatedRows=await smallJsonRows(patchResponse,false);
    if(updatedRows.length!==1)throw Error("M3 conditional update needs manual reconciliation");
    updated=checkedIdentity(updatedRows[0],d.slug);
  }
  if(updated.id!==identity.id||updated.updatedAt===identity.updatedAt){
    throw Error("M3 conditional update needs manual reconciliation");
  }

  const after=await fetchNeonSandboxFingerprints({
    branchId:args.branchId,jwt:args.sandboxOwnerJwt,fetcher:request,
  });
  const verified=after.fingerprints.find(n=>n.slug===d.slug);
  const newRevision=digest(updated.id+":"+updated.updatedAt);
  if(!verified||verified.sha256!==d.expectedLocalSha||
     verified.revision!==newRevision||after.numberOfNotes!==before.numberOfNotes){
    throw Error("M3 conditional update needs manual reconciliation; Baseline not saved");
  }
  if(atomicWikiUpdate){
    // The note and backlinks must both match, including links REMOVED by
    // this update. An HTTP 200 or correct note content alone is not success.
    const actual=await readOutgoingWikiIndex(
      request,NEON_SYNC_SANDBOX_DATA_API,args.sandboxOwnerJwt,identity.id,
    );
    if(JSON.stringify(actual)!==JSON.stringify([...newWikiKeys].sort())){
      throw Error("M3 atomic WikiLink update needs manual reconciliation; Baseline not saved");
    }
    const final=await fetchNeonSandboxFingerprints({
      branchId:args.branchId,jwt:args.sandboxOwnerJwt,fetcher:request,
    });
    const current=final.fingerprints.find(n=>n.slug===d.slug);
    if(final.numberOfNotes!==after.numberOfNotes||
       current?.sha256!==verified.sha256||
       current?.revision!==verified.revision){
      throw Error("M3 atomic WikiLink update needs manual reconciliation; Baseline not saved");
    }
  }
  return {slug:d.slug,sha256:verified.sha256,revision:verified.revision!,
    baselineSaved:false};
}
