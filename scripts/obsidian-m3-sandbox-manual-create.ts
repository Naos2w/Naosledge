/**
 * Explicit single-note Neon Sandbox CREATE from a manually supplied portable
 * scratch Markdown note. This never reads or modifies an Obsidian Vault.
 * Short-lived Sandbox Owner JWT, Markdown, and typed per-note confirmation are
 * supplied together over stdin, never via argv/env/files or an HTTP endpoint.
 *
 * This is a Sandbox transfer acceptance entry, NOT an M2 selection executor,
 * baseline writer, scheduled sync, or Production integration.
 */
import {createHash} from "node:crypto";
import {hostname} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {parseObsidianMarkdown,serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {planObsidianReconciliation} from "../lib/obsidian-sync-plan.ts";
import {parseManualM3UploadIntent} from "../lib/obsidian-m2-review-choices.ts";
import {createNeonSandboxNoteOnly} from "../lib/obsidian-neon-sandbox-create.ts";
import {NEON_SYNC_SANDBOX_BRANCH} from "../lib/obsidian-neon-sandbox-readonly.ts";

export const M3_SCRATCH_ONLY_FLAG="--sandbox-scratch-create-only";
const MAX_REQUEST_BYTES=265_000;
type CreateRequest={
  sandboxOwnerJwt:string;markdown:string;typedConfirmation:string;
  handoff?:unknown;
};

export function assertManualM3Invocation(
  platform:string,computerName:string,args:readonly string[],isTerminal:boolean,
):void{
  if(platform!=="win32"||computerName.trim().toUpperCase()!=="MSI"||
     args.length!==1||args[0]!==M3_SCRATCH_ONLY_FLAG||isTerminal){
    throw Error("M3 requires explicit piped scratch-only approval on the MSI device");
  }
}

export async function readScratchCreateRequest(
  source:AsyncIterable<string|Uint8Array>,
):Promise<CreateRequest>{
  const chunks:Buffer[]=[];
  let total=0;
  for await(const chunk of source){
    const part=typeof chunk==="string"?Buffer.from(chunk,"utf8"):Buffer.from(chunk);
    total+=part.length;
    if(total>MAX_REQUEST_BYTES)throw Error("M3 scratch request is too large");
    chunks.push(part);
  }
  let request:unknown;
  try{request=JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;}
  catch{throw Error("M3 scratch request must be JSON");}
  if(!request||typeof request!=="object"||Array.isArray(request)||
     ![3,4].includes(Object.keys(request).length)||
     !["sandboxOwnerJwt","markdown","typedConfirmation"].every(
       key=>Object.hasOwn(request,key)
     )||
     (Object.keys(request).length===4&&!Object.hasOwn(request,"handoff"))){
    throw Error("M3 scratch request must contain exactly one note and confirmation");
  }
  const r=request as Record<string,unknown>;
  if(typeof r.sandboxOwnerJwt!=="string"||r.sandboxOwnerJwt.length>8192||
     !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(r.sandboxOwnerJwt)||
     typeof r.markdown!=="string"||Buffer.byteLength(r.markdown,"utf8")>250_000||
     typeof r.typedConfirmation!=="string"||r.typedConfirmation.length>160){
    throw Error("M3 scratch input is missing or invalid");
  }
  if(Object.hasOwn(r,"handoff")){
    const decision=parseManualM3UploadIntent(r.handoff);
    if(decision.choice!=="review-missing-remote"){
      throw Error("M3 CREATE accepts only a reviewed missing-remote handoff");
    }
  }
  return r as CreateRequest;
}

/** Immutable stdin Markdown is the only source; no filesystem/Vault access. */
export async function createOneReviewedScratchNote(
  request:Awaited<ReturnType<typeof readScratchCreateRequest>>,
  fetcher?:typeof fetch,
):Promise<{baselineSaved:false}>{
  const parsed=parseObsidianMarkdown(request.markdown,"scratch.md","1970-01-01");
  if(!parsed||serializeObsidianMarkdown({
    ...parsed.metadata,content_md:parsed.content_md,
  })!==request.markdown){
    throw Error("M3 requires one canonical portable scratch Markdown note");
  }
  const slug=parsed.metadata.slug;
  if(request.typedConfirmation!=="CREATE SANDBOX "+slug){
    throw Error("M3 requires an independent typed per-note confirmation");
  }
  const digest=createHash("sha256").update(request.markdown,"utf8").digest("hex");
  // No M2 UI intent is treated as executable authorisation. The transport
  // separately verifies the live Owner grant and full remote inventory.
  const plan=planObsidianReconciliation({
    local:[{slug,sha256:digest}],remote:[],baseline:[],
  });
  // M2's handoff is only a version hint, not a write authorization.
  // The independent per-note confirmation and live Owner/RLS checks remain.
  const decision=request.handoff?
    parseManualM3UploadIntent(request.handoff):plan.decisions[0];
  if(decision.choice!=="review-missing-remote"||decision.slug!==slug||
     decision.expectedLocalSha!==digest||
     decision.expectedRemoteSha!==null||decision.expectedRemoteRevision!==null){
    throw Error("M3 reviewed CREATE handoff no longer matches Scratch Markdown");
  }
  const result=await createNeonSandboxNoteOnly({
    branchId:NEON_SYNC_SANDBOX_BRANCH,
    sandboxOwnerJwt:request.sandboxOwnerJwt,
    decision,typedConfirmation:request.typedConfirmation,
    readMarkdown:async()=>request.markdown,fetcher,
  });
  return {baselineSaved:result.baselineSaved};
}

const invoked=process.argv[1]?
  path.resolve(process.argv[1])===fileURLToPath(import.meta.url):false;
if(invoked){
  try{
    assertManualM3Invocation(
      process.platform,hostname(),process.argv.slice(2),!!process.stdin.isTTY,
    );
    const request=await readScratchCreateRequest(process.stdin);
    const result=await createOneReviewedScratchNote(request);
    if(result.baselineSaved!==false)throw Error("Unexpected Baseline write");
    console.log("M3_SANDBOX_SCRATCH_CREATE_VERIFIED; BASELINE_NOT_SAVED");
  }catch{
    // POST may already have committed even if later GET verification failed.
    // Never leak JWT, Markdown, note identifiers or server bodies; no retry.
    console.error("M3_SANDBOX_CREATE_NOT_VERIFIED; inspect Sandbox manually before any retry");
    process.exitCode=1;
  }
}
