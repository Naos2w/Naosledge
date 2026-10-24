/**
 * M3 create-only Neon INTEGRATION SANDBOX transport.
 *
 * A low-level transport for a FUTURE MSI per-note manual approval flow; not a
 * CLI, web action, background sync, or permission to read the real Vault.
 * This module never updates, upserts, deletes, or persists a Baseline.
 * Calling code must collect a fresh, note-specific typed confirmation rather
 * than reusing an M2 UI selection as write approval.
 */
import {createHash} from "node:crypto";
import {parseObsidianMarkdown,serializeObsidianMarkdown}
  from "./obsidian-markdown.ts";
import {
  NEON_SYNC_SANDBOX_BRANCH,NEON_SYNC_SANDBOX_DATA_API,
  fetchVerifiedNeonSandboxOwnerFingerprints,fetchNeonSandboxFingerprints,
} from "./obsidian-neon-sandbox-readonly.ts";
import type {SyncDecision} from "./obsidian-sync-plan.ts";

type Fetcher=typeof fetch;
const SHA=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MARKDOWN_BYTES=250_000;

export async function createNeonSandboxNoteOnly(args:{
  branchId:string;
  sandboxOwnerJwt:string;
  /** M1's inspected decision, never an executable M2 UI selection. */
  decision:SyncDecision;
  /** Re-read Markdown bytes, not a path to an actual Obsidian Vault. */
  markdown:string;
  /** Must be typed for this exact note by a future approved caller. */
  typedConfirmation:string;
  fetcher?:Fetcher;
}):Promise<{slug:string;sha256:string;revision:string;baselineSaved:false}>{
  if(!args||args.branchId!==NEON_SYNC_SANDBOX_BRANCH||
     typeof args.markdown!=="string"||
     Buffer.byteLength(args.markdown,"utf8")>MAX_MARKDOWN_BYTES){
    throw Error("M3 requires one bounded note for the approved Sandbox");
  }
  const d=args.decision;
  if(!d||d.choice!=="review-missing-remote"||d.manualReview!==true||
     d.expectedRemoteSha!==null||d.expectedRemoteRevision!==null||
     typeof d.expectedLocalSha!=="string"||!SHA.test(d.expectedLocalSha)||
     args.typedConfirmation!=="CREATE SANDBOX "+d.slug){
    throw Error("M3 requires a fresh per-note create-only confirmation");
  }
  const parsed=parseObsidianMarkdown(args.markdown,d.slug+".md","1970-01-01");
  if(!parsed||parsed.metadata.slug!==d.slug||
     serializeObsidianMarkdown({...parsed.metadata,content_md:parsed.content_md})!==args.markdown||
     createHash("sha256").update(args.markdown,"utf8").digest("hex")!==d.expectedLocalSha){
    throw Error("M3 Markdown is not the exact reviewed portable note");
  }

  // Independent Owner-RLS proof first: 200 + [] alone does not prove ownership.
  const request=args.fetcher??fetch;
  const before=await fetchVerifiedNeonSandboxOwnerFingerprints({
    branchId:args.branchId,jwt:args.sandboxOwnerJwt,fetcher:request,
  });
  if(before.numberOfNotes>=20||before.fingerprints.some(n=>n.slug===d.slug)){
    throw Error("M3 create stopped: remote note exists or full inventory reached its limit");
  }

  // Only INSERT; (owner_id,slug) is UNIQUE in the existing Neon schema.
  // A concurrent create returns a duplicate conflict rather than overwriting
  // existing content. Do not send on_conflict, resolution=merge, PATCH or PUT.
  const endpoint=new URL(NEON_SYNC_SANDBOX_DATA_API);
  const url=new URL(endpoint.href.replace(/\/$/,"")+"/knowledge_notes");
  url.searchParams.set("select","id,slug");
  const result=await request(url.href,{
    method:"POST",redirect:"manual",credentials:"omit",cache:"no-store",
    headers:{
      Authorization:"Bearer "+args.sandboxOwnerJwt,
      Accept:"application/json","Content-Type":"application/json",
      "Cache-Control":"no-store",Prefer:"return=representation",
    },
    body:JSON.stringify({
      slug:d.slug,title:parsed.metadata.title,
      summary:parsed.metadata.excerpt,content_md:parsed.content_md,
      category:parsed.metadata.category,tags:parsed.metadata.tags,
      learned_on:parsed.metadata.learned_on,
    }),
    signal:AbortSignal.timeout(16000),
  });
  // Do not log server error bodies, URLs, JWTs, Markdown or private slugs.
  if(result.status!==201||
     !/application\/json/i.test(result.headers.get("content-type")||"")){
    throw Error("M3 Sandbox insert was rejected or could not be verified");
  }
  const announced=Number(result.headers.get("content-length")??"0");
  if(!Number.isSafeInteger(announced)||announced>8192){
    throw Error("M3 Sandbox insert response is too large");
  }
  const body=await result.text();
  if(body.length>8192)throw Error("M3 Sandbox insert response is too large");
  let inserted:unknown;
  try{inserted=JSON.parse(body) as unknown;}catch{
    throw Error("M3 Sandbox insert response is invalid");
  }
  if(!Array.isArray(inserted)||inserted.length!==1||
     !inserted[0]||typeof inserted[0]!=="object"||
     (inserted[0] as {slug?:unknown}).slug!==d.slug||
     typeof (inserted[0] as {id?:unknown}).id!=="string"||
     !UUID.test((inserted[0] as {id:string}).id)){
    throw Error("M3 Sandbox did not confirm exactly one created note");
  }

  // A successful HTTP status is not sufficient for Baseline changes. Re-read
  // the complete Sandbox inventory; an ambiguous result requires manual review,
  // never an automatic retry (the insert might already have committed).
  const after=await fetchNeonSandboxFingerprints({
    branchId:args.branchId,jwt:args.sandboxOwnerJwt,fetcher:request,
  });
  const created=after.fingerprints.find(n=>n.slug===d.slug);
  if(after.numberOfNotes!==before.numberOfNotes+1||
     !created||created.sha256!==d.expectedLocalSha||!created.revision){
    throw Error("M3 Sandbox insert needs manual reconciliation; Baseline not saved");
  }
  return {slug:d.slug,sha256:created.sha256,revision:created.revision,
    baselineSaved:false};
}
