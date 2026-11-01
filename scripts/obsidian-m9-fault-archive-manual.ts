/**
 * Explicit MSI-only Owner acknowledgement of an already manually reviewed
 * fault. Requires the existing independent DPAPI session and a PRIVATE
 * piped exact one-time confirmation. Archives the fault marker outside Vault.
 *
 * This command NEVER triggers synchronization, signs automatic mode on,
 * updates M5, writes Vault/Production, or automatically authorizes restart.
 */
import {hostname} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  archiveVerifiedM9FaultAfterManualReview,M9_FAULT_ARCHIVE_CONFIRMATION,
} from "../lib/obsidian-m9-fault-archive-manual.ts";
import {createM9IndependentProductionOwnerSession}
  from "../lib/obsidian-m9-independent-owner-session.ts";

const FLAG="--m9-archive-reviewed-fault";
export function assertM9FaultArchiveInvocation(input:{
  platform:string;hostname:string;flags:readonly string[];
  stdinIsTty:boolean;
}):void{
  if(!input||input.platform!=="win32"||
     input.hostname.trim().toUpperCase()!=="MSI"||
     input.flags.length!==1||input.flags[0]!==FLAG||
     input.stdinIsTty){
    throw Error("M9 reviewed-fault archive requires MSI and private pipe");
  }
}
export async function readM9FaultArchiveConsent(
  stream:NodeJS.ReadableStream,
):Promise<string>{
  let input="",bytes=0;
  for await(const chunk of stream){
    const next=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk as string);
    bytes+=next.length;
    if(bytes>256)throw Error("M9 archive consent unavailable");
    input+=next.toString("utf8");
  }
  const trimmed=input.replace(/\r?\n$/,"");
  if(trimmed!==M9_FAULT_ARCHIVE_CONFIRMATION){
    throw Error("M9 archive consent unavailable");
  }
  return trimmed;
}
const invoked=process.argv[1]&&path.resolve(process.argv[1])===
  fileURLToPath(import.meta.url);
if(invoked){
  try{
    assertM9FaultArchiveInvocation({
      platform:process.platform,hostname:hostname(),
      flags:process.argv.slice(2),stdinIsTty:!!process.stdin.isTTY,
    });
    const typedConfirmation=await readM9FaultArchiveConsent(process.stdin);
    const owner=createM9IndependentProductionOwnerSession();
    const ownerJwt=await owner.requestFreshJwt();
    const status=await archiveVerifiedM9FaultAfterManualReview({
      ownerJwt,typedConfirmation,
    });
    console.log("M9_FAULT_EVIDENCE_ARCHIVED "+JSON.stringify(status));
    console.log("NO_AUTO_RESTART; NO_PRODUCTION_OR_VAULT_WRITES");
  }catch{
    console.error("M9_FAULT_ARCHIVE_DENIED; MANUAL_REVIEW_STILL_REQUIRED");
    process.exitCode=1;
  }
}
