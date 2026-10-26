/**
 * MSI manual read-only reinspection of a previously staged private M4 bundle.
 * Confirms ONLY local OS scratch bytes, not a live Neon revision or a Baseline.
 * Never reads an Obsidian Vault, JWT, Markdown from stdin, or writes files.
 */
import {hostname} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {verifyStagedSandboxIncomingReceipt} from "../lib/obsidian-neon-sandbox-incoming.ts";

export const M4_VERIFY_RECEIPT_FLAG="--sandbox-scratch-verify-incoming-only";

export function assertM4ReceiptVerificationInvocation(
  platform:string,computerName:string,args:readonly string[],isTerminal:boolean,
):void{
  if(platform!=="win32"||computerName.trim().toUpperCase()!=="MSI"||
     args.length!==1||args[0]!==M4_VERIFY_RECEIPT_FLAG||isTerminal){
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

const invoked=process.argv[1]?
  path.resolve(process.argv[1])===fileURLToPath(import.meta.url):false;
if(invoked){
  try{
    assertM4ReceiptVerificationInvocation(
      process.platform,hostname(),process.argv.slice(2),!!process.stdin.isTTY,
    );
    const result=await verifyManualIncomingReceipt(process.stdin);
    console.log("M4_INCOMING_SCRATCH_BYTES_VERIFIED");
    if(result.localCopyIncluded)console.log("M4_CONFLICT_PAIR_PRESENT");
    console.log("FILE_ONLY; NOT_NEON_E2E; BASELINE_UNCHANGED");
  }catch{
    console.error("M4_INCOMING_SCRATCH_BYTES_NOT_VERIFIED");
    process.exitCode=1;
  }
}
