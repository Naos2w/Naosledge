/**
 * MSI-only, manually triggered M4 Sandbox Incoming acceptance.
 * One reviewed note and a short-lived Sandbox Owner JWT arrive via bounded
 * stdin JSON; there is no Vault path, destination override, website action,
 * background polling, overwrite, delete, or Baseline persistence.
 */
import {hostname} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {stageNeonSandboxIncoming} from "../lib/obsidian-neon-sandbox-incoming.ts";
import {NEON_SYNC_SANDBOX_BRANCH} from "../lib/obsidian-neon-sandbox-readonly.ts";
import type {SyncDecision} from "../lib/obsidian-sync-plan.ts";

export const M4_SCRATCH_INCOMING_FLAG="--sandbox-scratch-incoming-only";
// Optional local conflict snapshot may carry up to 250 KiB of UTF-8 Markdown.
const MAX_REQUEST_BYTES=500_000;
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SHA=/^[0-9a-f]{64}$/;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DECISION_FIELDS=[
  "slug","choice","manualReview","expectedLocalSha",
  "expectedRemoteSha","expectedRemoteRevision",
] as const;

export function assertManualM4Invocation(
  platform:string,computerName:string,args:readonly string[],isTerminal:boolean,
):void{
  if(platform!=="win32"||computerName.trim().toUpperCase()!=="MSI"||
     args.length!==1||args[0]!==M4_SCRATCH_INCOMING_FLAG||isTerminal){
    throw Error("M4 requires explicit piped manual Incoming approval on MSI");
  }
}

export async function readScratchIncomingRequest(
  source:AsyncIterable<string|Uint8Array>,
):Promise<{sandboxOwnerJwt:string;decision:SyncDecision;typedConfirmation:string;localMarkdown?:string}>{
  const chunks:Buffer[]=[];
  let total=0;
  for await(const part of source){
    const bytes=typeof part==="string"?Buffer.from(part,"utf8"):Buffer.from(part);
    total+=bytes.length;
    if(total>MAX_REQUEST_BYTES)throw Error("M4 Incoming request is too large");
    chunks.push(bytes);
  }
  let parsed:unknown;
  try{parsed=JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;}
  catch{throw Error("M4 Incoming request must be JSON");}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||
     ![3,4].includes(Object.keys(parsed).length)||
     !["sandboxOwnerJwt","decision","typedConfirmation"].every(
       key=>Object.hasOwn(parsed,key)
     )){
    throw Error("M4 Incoming requires exactly one reviewed note and confirmation");
  }
  const r=parsed as Record<string,unknown>;
  const d=r.decision;
  if(typeof r.sandboxOwnerJwt!=="string"||r.sandboxOwnerJwt.length>8192||
     !JWT.test(r.sandboxOwnerJwt)||!d||typeof d!=="object"||
     Array.isArray(d)||Object.keys(d).length!==DECISION_FIELDS.length||
     !DECISION_FIELDS.every(key=>Object.hasOwn(d,key))||
     typeof r.typedConfirmation!=="string"||r.typedConfirmation.length>160){
    throw Error("M4 Incoming input is invalid");
  }
  const note=d as Record<string,unknown>;
  const hasLocal=Object.hasOwn(r,"localMarkdown");
  if((Object.keys(r).length===4&&!hasLocal)||
     (hasLocal&&(note.choice!=="conflict"||
       typeof r.localMarkdown!=="string"||
       Buffer.byteLength(r.localMarkdown,"utf8")>250_000))){
    throw Error("M4 local snapshot is only accepted for one reviewed conflict");
  }
  if(typeof note.slug!=="string"||note.slug.length<3||note.slug.length>120||
     !SLUG.test(note.slug)||
     (typeof note.choice!=="string"||
       !["review-download","review-missing-local","conflict"].includes(note.choice))||
     note.manualReview!==true||
     (note.expectedLocalSha!==null&&
       (typeof note.expectedLocalSha!=="string"||!SHA.test(note.expectedLocalSha)))||
     typeof note.expectedRemoteSha!=="string"||!SHA.test(note.expectedRemoteSha)||
     typeof note.expectedRemoteRevision!=="string"||!SHA.test(note.expectedRemoteRevision)||
     (note.choice==="review-missing-local")!==(note.expectedLocalSha===null)||
     (note.expectedLocalSha!==null&&note.expectedLocalSha===note.expectedRemoteSha)||
     r.typedConfirmation!=="SAVE SANDBOX INCOMING "+note.slug){
    throw Error("M4 Incoming requires an exact per-note read-only decision and confirmation");
  }
  return r as {sandboxOwnerJwt:string;decision:SyncDecision;typedConfirmation:string;localMarkdown?:string};
}

/** Save only a new OS scratch copy. Never write an Obsidian original. */
export async function stageOneReviewedSandboxIncoming(
  request:Awaited<ReturnType<typeof readScratchIncomingRequest>>,
  fetcher?:typeof fetch,
):Promise<{path:string;localCopyPath:string|null;originalModified:false;baselineSaved:false}>{
  const result=await stageNeonSandboxIncoming({
    branchId:NEON_SYNC_SANDBOX_BRANCH,
    sandboxOwnerJwt:request.sandboxOwnerJwt,
    decision:request.decision,
    typedConfirmation:request.typedConfirmation,
    localMarkdown:request.localMarkdown,
    fetcher,
  });
  return {path:result.path,localCopyPath:result.localCopyPath,
    originalModified:result.originalModified,
    baselineSaved:result.baselineSaved};
}

const invoked=process.argv[1]?
  path.resolve(process.argv[1])===fileURLToPath(import.meta.url):false;
if(invoked){
  try{
    assertManualM4Invocation(
      process.platform,hostname(),process.argv.slice(2),!!process.stdin.isTTY,
    );
    const request=await readScratchIncomingRequest(process.stdin);
    const result=await stageOneReviewedSandboxIncoming(request);
    if(result.originalModified!==false||result.baselineSaved!==false){
      throw Error("Unexpected modification");
    }
    // Private path is shown only to the person running this manual command.
    console.log("M4_SANDBOX_INCOMING_SAVED "+result.path);
    if(result.localCopyPath){
      console.log("M4_SANDBOX_LOCAL_CONFLICT_COPY_SAVED "+result.localCopyPath);
    }
    console.log("PRIVATE_SCRATCH_COPY_ONLY; ORIGINAL_AND_BASELINE_UNCHANGED");
  }catch{
    // Never echo JWT, note content, server response, or note identifiers.
    console.error("M4_SANDBOX_INCOMING_NOT_VERIFIED; no automatic retry");
    process.exitCode=1;
  }
}
