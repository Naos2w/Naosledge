/**
 * M8 P1: bounded, single-note, Owner-RLS Production WikiLink CAS adapter.
 *
 * NOT registered with any website route, watcher or service. One explicit
 * synthetic approval is required to invoke this low-level adapter. Future
 * automatic activation requires independent Production M5 enrollment.
 *
 * The SQL003 RPC is the ONLY mutation path. No blind PATCH/upsert, no
 * transport retry, no delete, no fallback to save_knowledge_note. On a lost
 * POST response, assume the server MAY HAVE COMMITTED and stop without an M5
 * checkpoint; the next operator action must be read-only reconciliation.
 */
import {createHash} from "node:crypto";
import {RELEASE_DATA_API_URL,RELEASE_NEON_BRANCH}
  from "./neon/production-release.ts";
import {
  fetchProductionOwnerRlsFingerprints,fetchVerifiedProductionNoteMarkdown,
} from "./obsidian-m8-production-inventory-readonly.ts";
import {parseObsidianMarkdown,serializeObsidianMarkdown}
  from "./obsidian-markdown.ts";
import {extractWikiReferences} from "./wiki-links.ts";
import type {AutoSyncCandidate} from "./obsidian-auto-sync-policy.ts";

const SHA=/^[0-9a-f]{64}$/;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_MARKDOWN_BYTES=250_000;
const PINNED="https://ep-purple-recipe-b43kznn2.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1";

function stop():never{
  throw Error("M8 Production CAS stopped: reconciliation required; no Baseline");
}
function uncertain():never{
  throw Error("M8 Production CAS outcome uncertain: do not retry; reconcile read-only");
}
function signalCheck(signal?:AbortSignal):void{if(signal?.aborted)stop();}
function remoteVersion(a:unknown,b:unknown){
  return typeof a==="string"&&SHA.test(a)&&typeof b==="string"&&SHA.test(b);
}
function sha(value:string){return createHash("sha256").update(value,"utf8").digest("hex");}
function validateSource(markdown:string,slug:string,expectedSha:string){
  if(typeof markdown!=="string"||
     Buffer.byteLength(markdown,"utf8")>MAX_MARKDOWN_BYTES||
     sha(markdown)!==expectedSha)stop();
  const parsed=parseObsidianMarkdown(markdown,slug+".md","1970-01-01");
  if(!parsed||parsed.metadata.slug!==slug||
     serializeObsidianMarkdown({
       ...parsed.metadata,content_md:parsed.content_md,
     })!==markdown)stop();
  const links=extractWikiReferences(parsed.content_md);
  if(links.length>80)stop();
  return {parsed,links:[...links].sort()};
}
async function readLimited(response:Response,maxBytes:number){
  const announced=response.headers.get("content-length");
  if(announced!==null&&(!/^\d+$/.test(announced)||Number(announced)>maxBytes))stop();
  if(!response.body)stop();
  let size=0;const bytes:Uint8Array[]=[];
  const reader=response.body.getReader();
  try{
    while(true){
      const part=await reader.read();
      if(part.done)break;
      size+=part.value.byteLength;
      if(size>maxBytes){await reader.cancel();stop();}
      bytes.push(part.value);
    }
  }catch{stop();}
  finally{reader.releaseLock();}
  try{return JSON.parse(new TextDecoder("utf-8",{fatal:true})
    .decode(Buffer.concat(bytes))) as unknown;
  }catch{stop();}
}
async function outgoingIndex(args:{
  fetcher:typeof fetch;jwt:string;noteId:string;signal?:AbortSignal;
}):Promise<string[]>{
  signalCheck(args.signal);
  const url=new URL(RELEASE_DATA_API_URL+"/knowledge_links");
  url.searchParams.set("select","target_key");
  url.searchParams.set("source_note_id","eq."+args.noteId);
  url.searchParams.set("order","target_key.asc");
  url.searchParams.set("limit","81");
  let response:Response;
  try{
    response=await args.fetcher(url.href,{
      method:"GET",redirect:"manual",credentials:"omit",cache:"no-store",
      headers:{Authorization:"Bearer "+args.jwt,Accept:"application/json",
        "Cache-Control":"no-store",Prefer:"count=exact"},
      signal:args.signal?AbortSignal.any([args.signal,AbortSignal.timeout(16000)]):
        AbortSignal.timeout(16000),
    });
  }catch{stop();}
  if(response.status!==200||
     !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type")||""))stop();
  const raw=await readLimited(response,16384);
  if(!Array.isArray(raw)||raw.length>80)stop();
  const keys:string[]=[];
  for(const item of raw){
    if(!item||typeof item!=="object"||Array.isArray(item)||
       Object.keys(item).length!==1||
       typeof (item as {target_key?:unknown}).target_key!=="string")stop();
    keys.push((item as {target_key:string}).target_key);
  }
  const range=keys.length===0?"*/0":
    "0-"+(keys.length-1)+"/"+keys.length;
  if(response.headers.get("content-range")?.trim()!==range||
     keys.some((key,i)=>key.length<1||key.length>160||
       key!==key.toLowerCase().trim()||
       (i>0&&keys[i-1]>=key)))stop();
  signalCheck(args.signal);
  return keys;
}
export async function updateProductionNoteCasOnce(args:{
  branchId:string;
  ownerJwt:string;
  candidate:AutoSyncCandidate;
  readLocalMarkdown:()=>Promise<string>;
  /** QA-only approval, NOT an auto-sync pairing certificate. */
  typedConfirmation:string;
  fetcher?:typeof fetch;
  signal?:AbortSignal;
}):Promise<{
  slug:string;sha256:string;revision:string;
  verifiedRemoteReadback:true;
  incomingWrites:0;
  baselineSaved:false;
  automaticRetryAllowed:false;
}>{
  const c=args?.candidate?{...args.candidate}:undefined;
  if(!args||args.branchId!==RELEASE_NEON_BRANCH||
     RELEASE_DATA_API_URL!==PINNED||
     typeof args.readLocalMarkdown!=="function"||
     !c||c.action!=="upload-cas"||c.choice!=="review-upload"||
     c.executable!==false||
     typeof c.slug!=="string"||!SLUG.test(c.slug)||
     c.slug.length<3||c.slug.length>120||
     !remoteVersion(c.expectedRemoteSha,c.expectedRemoteRevision)||
     typeof c.expectedLocalSha!=="string"||!SHA.test(c.expectedLocalSha)||
     c.expectedLocalSha===c.expectedRemoteSha||
     c.expectedLocalSha===null||
     c.expectedRemoteSha===null||c.expectedRemoteRevision===null||
     args.typedConfirmation!==
       "TEST M8 PRODUCTION CAS "+c.slug+" "+c.expectedLocalSha.slice(0,12)){
    stop();
  }
  // Validate the local bytes immediately and after the awaited remote proof.
  // No raw Markdown is logged, returned or saved by the adapter.
  signalCheck(args.signal);
  const first=await args.readLocalMarkdown();
  const local=validateSource(first,c.slug,c.expectedLocalSha);
  const fetcher=args.fetcher??fetch;
  const note=await fetchVerifiedProductionNoteMarkdown({
    branchId:args.branchId,jwt:args.ownerJwt,slug:c.slug,
    expectedSha256:c.expectedRemoteSha,
    expectedRevision:c.expectedRemoteRevision,
    fetcher,signal:args.signal,
  });
  const old=parseObsidianMarkdown(note.markdown,c.slug+".md","1970-01-01");
  if(!old)stop();
  const oldKeys=[...extractWikiReferences(old.content_md)].sort();
  if(oldKeys.length>80)stop();
  const recorded=await outgoingIndex({
    fetcher,jwt:args.ownerJwt,noteId:note.id,signal:args.signal,
  });
  if(JSON.stringify(recorded)!==JSON.stringify(oldKeys))stop();

  const currentLocal=await args.readLocalMarkdown();
  if(currentLocal!==first)stop();
  validateSource(currentLocal,c.slug,c.expectedLocalSha);
  // A fresh Owner-RLS inventory before submitting prevents unrelated
  // additions/deletions from being silently treated as a stable snapshot.
  const before=await fetchProductionOwnerRlsFingerprints({
    branchId:args.branchId,jwt:args.ownerJwt,fetcher,signal:args.signal,
  });
  const current=before.fingerprints.find(n=>n.slug===c.slug);
  if(!current||current.sha256!==c.expectedRemoteSha||
     current.revision!==c.expectedRemoteRevision)stop();
  signalCheck(args.signal);
  // SQL003 checks id+slug+updated_at AND old links under a row lock. Even
  // a race after this GET cannot blindly overwrite the remote version.
  const url=RELEASE_DATA_API_URL+"/rpc/update_knowledge_note_cas_with_links";
  const body={
    p_id:note.id,p_slug:note.slug,p_expected_updated_at:note.updatedAt,
    p_expected_links:oldKeys,
    p_title:local.parsed.metadata.title,p_summary:local.parsed.metadata.excerpt,
    p_content_md:local.parsed.content_md,p_category:local.parsed.metadata.category,
    p_tags:local.parsed.metadata.tags,p_learned_on:local.parsed.metadata.learned_on,
    p_links:local.links,
  };
  let response:Response;
  try{
    response=await fetcher(url,{
      method:"POST",redirect:"manual",credentials:"omit",cache:"no-store",
      headers:{
        Authorization:"Bearer "+args.ownerJwt,
        Accept:"application/json","Content-Type":"application/json",
        "Cache-Control":"no-store",Prefer:"return=representation",
      },
      body:JSON.stringify(body),
      signal:args.signal?AbortSignal.any([args.signal,AbortSignal.timeout(16000)]):
        AbortSignal.timeout(16000),
    });
  }catch{uncertain();}
  // A non-200 / malformed reply may still have COMMITTED. Never retry POST.
  if(response.status!==200||
     !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type")||""))uncertain();
  let returned:unknown;
  try{returned=await readLimited(response,2048);}
  catch{uncertain();}
  if(returned!==note.id)uncertain();
  // Only read-only rechecks after the irreversible RPC. If any fail, report
  // uncertainty; never retry the change or advance the M5 Baseline.
  try{
    const after=await fetchProductionOwnerRlsFingerprints({
      branchId:args.branchId,jwt:args.ownerJwt,fetcher,signal:args.signal,
    });
    const next=after.fingerprints.find(n=>n.slug===c.slug);
    if(after.numberOfNotes!==before.numberOfNotes||
       !next||next.sha256!==c.expectedLocalSha||
       !next.revision||next.revision===c.expectedRemoteRevision)uncertain();
    const witness=await fetchVerifiedProductionNoteMarkdown({
      branchId:args.branchId,jwt:args.ownerJwt,slug:c.slug,
      expectedSha256:next.sha256,expectedRevision:next.revision,
      fetcher,signal:args.signal,
    });
    if(witness.id!==note.id||witness.updatedAt===note.updatedAt||
       witness.markdown!==currentLocal)uncertain();
    const links=await outgoingIndex({
      fetcher,jwt:args.ownerJwt,noteId:note.id,signal:args.signal,
    });
    if(JSON.stringify(links)!==JSON.stringify(local.links))uncertain();
    const freshLocal=await args.readLocalMarkdown();
    if(freshLocal!==currentLocal)uncertain();
    return {
      slug:c.slug,sha256:next.sha256,revision:next.revision,
      verifiedRemoteReadback:true,incomingWrites:0,baselineSaved:false,
      automaticRetryAllowed:false,
    };
  }catch{uncertain();}
}

/**
 * M8 P1 Production create-only adapter using the already-installed atomic
 * SQL002 save RPC with p_id=null. This has no UPDATE fallback, cannot
 * overwrite an existing owner+slug (unique constraint), and is not connected
 * to the background watcher or any public route. On response loss, stop.
 */
export async function createProductionNoteOnce(args:{
  branchId:string;
  ownerJwt:string;
  candidate:AutoSyncCandidate;
  readLocalMarkdown:()=>Promise<string>;
  typedConfirmation:string;
  fetcher?:typeof fetch;
  signal?:AbortSignal;
}):Promise<{
  slug:string;sha256:string;revision:string;
  verifiedRemoteReadback:true;
  baselineSaved:false;
  automaticRetryAllowed:false;
}>{
  const c=args?.candidate?{...args.candidate}:undefined;
  if(!args||args.branchId!==RELEASE_NEON_BRANCH||
     RELEASE_DATA_API_URL!==PINNED||
     typeof args.readLocalMarkdown!=="function"||
     !c||c.action!=="upload-create"||c.choice!=="review-missing-remote"||
     c.executable!==false||
     typeof c.slug!=="string"||!SLUG.test(c.slug)||
     c.slug.length<3||c.slug.length>120||
     typeof c.expectedLocalSha!=="string"||!SHA.test(c.expectedLocalSha)||
     c.expectedRemoteSha!==null||c.expectedRemoteRevision!==null||
     args.typedConfirmation!==
       "TEST M8 PRODUCTION CREATE "+c.slug+" "+c.expectedLocalSha.slice(0,12)){
    stop();
  }
  signalCheck(args.signal);
  const first=await args.readLocalMarkdown();
  const local=validateSource(first,c.slug,c.expectedLocalSha);
  const fetcher=args.fetcher??fetch;
  const before=await fetchProductionOwnerRlsFingerprints({
    branchId:args.branchId,jwt:args.ownerJwt,fetcher,signal:args.signal,
  });
  if(before.numberOfNotes>=500||
     before.fingerprints.some(n=>n.slug===c.slug))stop();
  const again=await args.readLocalMarkdown();
  if(again!==first)stop();
  // Recheck all remote hashes right before the atomic create-only RPC.
  const current=await fetchProductionOwnerRlsFingerprints({
    branchId:args.branchId,jwt:args.ownerJwt,fetcher,signal:args.signal,
  });
  if(JSON.stringify(before.fingerprints)!==
     JSON.stringify(current.fingerprints))stop();
  signalCheck(args.signal);
  let response:Response;
  try{
    response=await fetcher(RELEASE_DATA_API_URL+"/rpc/save_knowledge_note",{
      method:"POST",redirect:"manual",credentials:"omit",cache:"no-store",
      headers:{
        Authorization:"Bearer "+args.ownerJwt,
        Accept:"application/json","Content-Type":"application/json",
        "Cache-Control":"no-store",Prefer:"return=representation",
      },
      body:JSON.stringify({
        // Never pass an existing ID: SQL002 takes its INSERT-only path.
        p_id:null,p_slug:c.slug,
        p_title:local.parsed.metadata.title,
        p_summary:local.parsed.metadata.excerpt,
        p_content_md:local.parsed.content_md,
        p_category:local.parsed.metadata.category,
        p_tags:local.parsed.metadata.tags,
        p_learned_on:local.parsed.metadata.learned_on,
        p_links:local.links,
      }),
      signal:args.signal?AbortSignal.any([args.signal,AbortSignal.timeout(16000)]):
        AbortSignal.timeout(16000),
    });
  }catch{uncertain();}
  if(response.status!==200||
     !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type")||""))uncertain();
  let id:unknown;
  try{id=await readLimited(response,2048);}catch{uncertain();}
  if(typeof id!=="string"||
     !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))uncertain();
  try{
    const after=await fetchProductionOwnerRlsFingerprints({
      branchId:args.branchId,jwt:args.ownerJwt,fetcher,signal:args.signal,
    });
    const added=after.fingerprints.find(n=>n.slug===c.slug);
    if(after.numberOfNotes!==before.numberOfNotes+1||
       !added||added.sha256!==c.expectedLocalSha||!added.revision)uncertain();
    const witness=await fetchVerifiedProductionNoteMarkdown({
      branchId:args.branchId,jwt:args.ownerJwt,slug:c.slug,
      expectedSha256:added.sha256,expectedRevision:added.revision,
      fetcher,signal:args.signal,
    });
    if(witness.id!==id||witness.markdown!==first)uncertain();
    const links=await outgoingIndex({
      fetcher,jwt:args.ownerJwt,noteId:witness.id,signal:args.signal,
    });
    if(JSON.stringify(links)!==JSON.stringify(local.links))uncertain();
    const localAgain=await args.readLocalMarkdown();
    if(localAgain!==first)uncertain();
    return {
      slug:c.slug,sha256:added.sha256,revision:added.revision,
      verifiedRemoteReadback:true,baselineSaved:false,
      automaticRetryAllowed:false,
    };
  }catch{uncertain();}
}
