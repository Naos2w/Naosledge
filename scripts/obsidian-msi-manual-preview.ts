/**
 * Explicit MSI-only first-look M1 acceptance against the fixed Neon Sandbox.
 *
 * Invoke MANUALLY with --sandbox-first-look-readonly (counts only) or the
 * explicitly redirected --sandbox-m2-review-json (private metadata), piping
 * a short-lived SANDBOX OWNER JWT via stdin; never argv, files or env vars.
 * This is NOT a website endpoint or scheduled job. It never writes a Vault,
 * persists a baseline or approves synchronization. The JSON mode outputs
 * private slugs/hashes ONLY to redirected stdout; never JWT or Markdown.
 */
import {hostname} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {previewApprovedMsiSandboxSync} from "../lib/obsidian-manual-sync-approved-msi.ts";
import type {ManualReviewPreview} from "../lib/obsidian-manual-sync-review.ts";
import {serializeManualM2Handoff} from "../lib/obsidian-m2-review-choices.ts";

export const MANUAL_FIRST_LOOK_FLAG="--sandbox-first-look-readonly";
export const MANUAL_M2_HANDOFF_FLAG="--sandbox-m2-review-json";

export function assertManualM1Invocation(
  platform:string,computerName:string,args:readonly string[],isTerminal:boolean,
  stdoutIsTerminal=false,
):void{
  if(platform!=="win32"||computerName.trim().toUpperCase()!=="MSI"){
    throw new Error("Manual M1 first-look is restricted to the approved MSI device");
  }
  if(args.length!==1||!
     [MANUAL_FIRST_LOOK_FLAG,MANUAL_M2_HANDOFF_FLAG].includes(args[0])){
    throw new Error("Explicit Sandbox read-only flag is required");
  }
  if(args[0]===MANUAL_M2_HANDOFF_FLAG&&stdoutIsTerminal){
    throw new Error("Private M2 metadata must be redirected, not displayed in a terminal");
  }
  if(isTerminal){
    throw new Error("Pipe a short-lived Sandbox owner JWT on stdin; never type it as an argument");
  }
}

/** Bounded ASCII input; do not copy a JWT to argv, environment or a file. */
export async function readOwnerJwtFromPipe(source:AsyncIterable<string|Uint8Array>):
  Promise<string>{
  let size=0;
  const parts:Buffer[]=[];
  for await(const part of source){
    const bytes=typeof part==="string"?Buffer.from(part,"utf8"):Buffer.from(part);
    size+=bytes.length;
    if(size>8192)throw new Error("Sandbox JWT stdin input is too large");
    parts.push(bytes);
  }
  const jwt=Buffer.concat(parts).toString("utf8").trim();
  if(jwt.length<5||jwt.length>8192||
     !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jwt)){
    throw new Error("Short-lived Sandbox owner JWT is missing or malformed");
  }
  return jwt;
}

/** Deliberately return aggregate counts only, never slugs/SHA/Markdown/JWT. */
export function describeManualM1Acceptance(preview:ManualReviewPreview){
  if(preview.sandboxOnly!==true||preview.readOnly!==true||
     preview.manualTriggerOnly!==true||preview.automaticSyncEnabled!==false||
     preview.automaticDeleteEnabled!==false||preview.baselinePersisted!==false){
    throw new Error("M1 live preview did not preserve read-only guarantees");
  }
  return {
    mode:"M1_SANDBOX_READONLY_FIRST_LOOK",
    explicitlyNoBaseline:true,
    previewStatus:preview.previewStatus,
    localSupportedNotes:preview.inventory.localSupportedNotes,
    localUnsupportedMarkdown:preview.inventory.localUnsupportedMarkdown,
    localDirectoriesNotScanned:preview.inventory.localDirectoriesNotScanned,
    remoteNotes:preview.inventory.remoteNotes,
    remoteFullInventory:preview.inventory.remoteFullInventory,
    manualReviewCount:preview.manualReviewCount,
    conflicts:preview.conflicts,
    possibleDeletionsNeverApplied:preview.possibleDeletionsNeverApplied,
    choices:{
      unchanged:preview.summary.unchanged,
      reviewUpload:preview.summary["review-upload"],
      reviewDownload:preview.summary["review-download"],
      conflict:preview.summary.conflict,
      reviewMissingLocal:preview.summary["review-missing-local"],
      reviewMissingRemote:preview.summary["review-missing-remote"],
      bothRemoved:preview.summary["both-removed"],
    },
    ownerApprovalGranted:false,
    dataTransferred:false,
    deleteAllowed:false,
    baselineSaved:false,
  };
}

const invoked=process.argv[1]?
  path.resolve(process.argv[1])===fileURLToPath(import.meta.url):false;
if(invoked){
  try{
    // The host and explicit manual flag must pass BEFORE reading any secret,
    // local filesystem content, or calling the remote Sandbox.
    assertManualM1Invocation(
      process.platform,hostname(),process.argv.slice(2),!!process.stdin.isTTY,
      !!process.stdout.isTTY,
    );
    const jwt=await readOwnerJwtFromPipe(process.stdin);
    // Initial observation only. An empty baseline is never treated as a
    // successful sync or as proof that either side is the newest version.
    const preview=await previewApprovedMsiSandboxSync({
      sandboxOwnerJwt:jwt,baseline:[],
    });
    if(process.argv[2]===MANUAL_M2_HANDOFF_FLAG){
      // Private slugs and hashes: stdout is redirected to an Owner-controlled
      // local JSON file. Never include JWT, Markdown or server responses.
      process.stdout.write(serializeManualM2Handoff(preview)+"\n");
    }else{
      console.log("M1_SANDBOX_READONLY_RESULT "+JSON.stringify(
        describeManualM1Acceptance(preview),
      ));
    }
  }catch{
    // Fail closed without serializing server responses, filenames, or JWTs.
    console.error("M1_SANDBOX_READONLY_NOT_COMPLETED (check MSI registration, explicit flag, Sandbox-only Owner JWT and network)");
    process.exitCode=1;
  }
}
