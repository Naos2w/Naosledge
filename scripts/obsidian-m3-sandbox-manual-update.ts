/**
 * MSI-only, one manually approved conditional Sandbox update from stdin.
 * No Vault access, Production endpoint, credential persistence or Baseline.
 * A real reviewed decision is required; an M2 click alone is not permission.
 */
import {createHash} from "node:crypto";
import {hostname} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {parseObsidianMarkdown,serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {updateNeonSandboxNoteIfUnchanged} from "../lib/obsidian-neon-sandbox-update.ts";
import {NEON_SYNC_SANDBOX_BRANCH} from "../lib/obsidian-neon-sandbox-readonly.ts";
import type {SyncDecision} from "../lib/obsidian-sync-plan.ts";

export const M3_MANUAL_UPDATE_FLAG="--sandbox-manual-update-only";
const SHA=/^[0-9a-f]{64}$/;
const FIELDS=["slug","choice","manualReview","expectedLocalSha",
  "expectedRemoteSha","expectedRemoteRevision"];
type UpdateRequest={
  sandboxOwnerJwt:string;markdown:string;decision:SyncDecision;typedConfirmation:string;
};

export function assertManualM3UpdateInvocation(
  platform:string,computerName:string,args:readonly string[],isTerminal:boolean,
):void{
  if(platform!=="win32"||computerName.trim().toUpperCase()!=="MSI"||
     args.length!==1||args[0]!==M3_MANUAL_UPDATE_FLAG||isTerminal){
    throw Error("M3 update requires explicit piped manual approval on MSI");
  }
}

export async function readManualUpdateRequest(
  source:AsyncIterable<string|Uint8Array>,
):Promise<UpdateRequest>{
  const chunks:Buffer[]=[];
  let size=0;
  for await(const part of source){
    const bytes=typeof part==="string"?Buffer.from(part,"utf8"):Buffer.from(part);
    size+=bytes.length;
    // Allow JSON escaping of a 250 KB note plus the bounded JWT and decision.
    if(size>1_520_000)throw Error("M3 update request is too large");
    chunks.push(bytes);
  }
  let value:unknown;
  try{value=JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;}
  catch{throw Error("M3 update request must be JSON");}
  if(!value||typeof value!=="object"||Array.isArray(value)||
     Object.keys(value).length!==4||
     !["sandboxOwnerJwt","markdown","decision","typedConfirmation"].every(
       key=>Object.hasOwn(value,key)
     ))throw Error("M3 update requires exactly one note, decision and confirmation");
  const r=value as Record<string,unknown>;
  const d=r.decision;
  if(typeof r.sandboxOwnerJwt!=="string"||r.sandboxOwnerJwt.length>8192||
     !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(r.sandboxOwnerJwt)||
     typeof r.markdown!=="string"||Buffer.byteLength(r.markdown,"utf8")>250_000||
     !d||typeof d!=="object"||Array.isArray(d)||
     Object.keys(d).length!==FIELDS.length||!FIELDS.every(key=>Object.hasOwn(d,key))){
    throw Error("M3 update input is invalid");
  }
  const note=d as Record<string,unknown>;
  if(typeof note.slug!=="string"||note.slug.length<3||note.slug.length>120||
     !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(note.slug)||
     note.choice!=="review-upload"||note.manualReview!==true||
     ![note.expectedLocalSha,note.expectedRemoteSha,note.expectedRemoteRevision].every(
       x=>typeof x==="string"&&SHA.test(x)
     )||note.expectedLocalSha===note.expectedRemoteSha||
     r.typedConfirmation!=="UPDATE SANDBOX "+note.slug){
    throw Error("M3 update requires a reviewed upload and exact per-note confirmation");
  }
  const parsed=parseObsidianMarkdown(r.markdown,note.slug+".md","1970-01-01");
  if(!parsed||parsed.metadata.slug!==note.slug||
     serializeObsidianMarkdown({...parsed.metadata,content_md:parsed.content_md})!==r.markdown||
     createHash("sha256").update(r.markdown,"utf8").digest("hex")!==note.expectedLocalSha){
    throw Error("M3 update requires the exact reviewed canonical Markdown");
  }
  return r as UpdateRequest;
}

export async function updateOneReviewedSandboxNote(
  request:UpdateRequest,fetcher?:typeof fetch,
):Promise<{baselineSaved:false}>{
  const {sandboxOwnerJwt,markdown,decision,typedConfirmation}=request;
  const result=await updateNeonSandboxNoteIfUnchanged({
    branchId:NEON_SYNC_SANDBOX_BRANCH,sandboxOwnerJwt,decision,typedConfirmation,
    readMarkdown:async()=>markdown,fetcher,
  });
  return {baselineSaved:result.baselineSaved};
}

const invoked=process.argv[1]?
  path.resolve(process.argv[1])===fileURLToPath(import.meta.url):false;
if(invoked){
  try{
    assertManualM3UpdateInvocation(
      process.platform,hostname(),process.argv.slice(2),!!process.stdin.isTTY,
    );
    const request=await readManualUpdateRequest(process.stdin);
    const result=await updateOneReviewedSandboxNote(request);
    if(result.baselineSaved!==false)throw Error("Unexpected Baseline write");
    console.log("M3_SANDBOX_UPDATE_VERIFIED; BASELINE_NOT_SAVED");
  }catch{
    // PATCH may already have committed: no retry, private data or server body.
    console.error("M3_SANDBOX_UPDATE_NOT_VERIFIED; inspect Sandbox manually before any retry");
    process.exitCode=1;
  }
}
