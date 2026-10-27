/**
 * MSI manual read-only reinspection of a previously staged private M4 bundle.
 * Confirms ONLY local OS scratch bytes, not a live Neon revision or a Baseline.
 * Never reads an Obsidian Vault, JWT, Markdown from stdin, or writes files.
 */
import {hostname} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {verifyStagedSandboxIncomingReceipt} from "../lib/obsidian-neon-sandbox-incoming.ts";
import {
  fetchVerifiedNeonSandboxMarkdown,NEON_SYNC_SANDBOX_BRANCH,
} from "../lib/obsidian-neon-sandbox-readonly.ts";

export const M4_VERIFY_RECEIPT_FLAG="--sandbox-scratch-verify-incoming-only";
export const M4_VERIFY_RECEIPT_LIVE_FLAG="--sandbox-scratch-verify-incoming-live-readonly";

export function assertM4ReceiptVerificationInvocation(
  platform:string,computerName:string,args:readonly string[],isTerminal:boolean,
):void{
  if(platform!=="win32"||computerName.trim().toUpperCase()!=="MSI"||
     args.length!==1||![M4_VERIFY_RECEIPT_FLAG,M4_VERIFY_RECEIPT_LIVE_FLAG].includes(args[0])||isTerminal){
    throw Error("M4 verification is MSI-only and requires a piped private receipt path");
  }
}

export async function verifyManualIncomingReceipt(
  source:AsyncIterable<string|Uint8Array>,
):Promise<{localCopyIncluded:boolean;baselineSaved:false;verificationScope:"staged-files-only"}>{
  const chunks:Buffer[]=[];
  let total=0;
  for await(const chunk of source){
    const bytes=typeof chunk==="string"?Buffer.from(chunk):Buffer.from(chunk);
    total+=bytes.length;
    if(total>4096)throw Error("M4 receipt path input too large");
    chunks.push(bytes);
  }
  const receiptPath=Buffer.concat(chunks).toString("utf8").trim();
  if(!receiptPath||receiptPath.includes("\0")||receiptPath.includes("\n")){
    throw Error("M4 receipt path input is invalid");
  }
  const receipt=await verifyStagedSandboxIncomingReceipt(receiptPath);
  return {localCopyIncluded:receipt.localCopyPath!==null,
    baselineSaved:false,verificationScope:"staged-files-only"};
}

/**
 * Manual M4 -> M5 restart preflight: verify persisted copies, then re-fetch
 * the SAME remote revision through the pinned Sandbox Owner RLS GET chain.
 * A receipt is self-reported file metadata, never authenticated sync success.
 * This emits no Markdown, credential, Vault access, Baseline or write action.
 */
export async function verifyManualIncomingReceiptAgainstSandbox(
  source:AsyncIterable<string|Uint8Array>,fetcher?:typeof fetch,
):Promise<{localCopyIncluded:boolean;baselineSaved:false;
  verificationScope:"staged-files-and-sandbox-owner-rls-get"}>{
  const chunks:Buffer[]=[];
  let total=0;
  for await(const chunk of source){
    const bytes=typeof chunk==="string"?Buffer.from(chunk):Buffer.from(chunk);
    total+=bytes.length;
    if(total>12_500)throw Error("M4 live verification request is too large");
    chunks.push(bytes);
  }
  let parsed:unknown;
  try{parsed=JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;}
  catch{throw Error("M4 live verification request must be JSON");}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)){
    throw Error("M4 live verification input is invalid");
  }
  const r=parsed as Record<string,unknown>;
  if(Object.keys(r).length!==3||
     !["receiptPath","sandboxOwnerJwt","typedConfirmation"].every(key=>Object.hasOwn(r,key))||
     typeof r.receiptPath!=="string"||r.receiptPath.length>4096||
     !r.receiptPath||/[\0\r\n]/.test(r.receiptPath)||
     typeof r.sandboxOwnerJwt!=="string"||r.sandboxOwnerJwt.length>8192||
     !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(r.sandboxOwnerJwt)||
     typeof r.typedConfirmation!=="string"||r.typedConfirmation.length>160){
    throw Error("M4 live verification input is invalid");
  }
  const before=await verifyStagedSandboxIncomingReceipt(r.receiptPath);
  const slug=path.basename(before.remoteCopyPath,".md");
  if(r.typedConfirmation!=="VERIFY SANDBOX INCOMING "+slug){
    throw Error("M4 live verification requires per-note confirmation");
  }
  await fetchVerifiedNeonSandboxMarkdown({
    branchId:NEON_SYNC_SANDBOX_BRANCH,jwt:r.sandboxOwnerJwt,slug,
    expectedSha256:before.sha256,expectedRevision:before.revision,fetcher,
  });
  // The asynchronous Owner GET cannot certify an Incoming snapshot that was
  // replaced during the request. Reinspect both files and receipt afterward.
  const after=await verifyStagedSandboxIncomingReceipt(r.receiptPath);
  if(after.remoteCopyPath!==before.remoteCopyPath||
     after.localCopyPath!==before.localCopyPath||
     after.sha256!==before.sha256||after.revision!==before.revision){
    throw Error("M4 Incoming evidence changed during Sandbox verification");
  }
  return {localCopyIncluded:after.localCopyPath!==null,baselineSaved:false,
    verificationScope:"staged-files-and-sandbox-owner-rls-get"};
}

const invoked=process.argv[1]?
  path.resolve(process.argv[1])===fileURLToPath(import.meta.url):false;
if(invoked){
  try{
    assertM4ReceiptVerificationInvocation(
      process.platform,hostname(),process.argv.slice(2),!!process.stdin.isTTY,
    );
    const live=process.argv[2]===M4_VERIFY_RECEIPT_LIVE_FLAG;
    const result=live?
      await verifyManualIncomingReceiptAgainstSandbox(process.stdin):
      await verifyManualIncomingReceipt(process.stdin);
    console.log(live?"M4_INCOMING_SANDBOX_OWNER_RLS_FRESHNESS_VERIFIED":
      "M4_INCOMING_SCRATCH_BYTES_VERIFIED");
    if(result.localCopyIncluded)console.log("M4_CONFLICT_PAIR_PRESENT");
    console.log(live?"READONLY_SNAPSHOT; NO_SYNC_PROOF; BASELINE_UNCHANGED":
      "FILE_ONLY; NOT_NEON_E2E; BASELINE_UNCHANGED");
  }catch{
    console.error("M4_INCOMING_SCRATCH_BYTES_NOT_VERIFIED");
    process.exitCode=1;
  }
}
