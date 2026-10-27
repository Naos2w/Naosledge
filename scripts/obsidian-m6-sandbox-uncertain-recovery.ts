/**
 * MSI-only READ-ONLY diagnosis after an M3 POST/PATCH with an uncertain result.
 * The input is a separately held, manually reviewed Scratch Markdown and its
 * exact earlier SHA; no Vault paths, arbitrary endpoints, writes or retries.
 * A current SHA match does not prove the failed operation committed.
 */
import {hostname} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {inspectUncertainM3SandboxOutcome}
  from "../lib/obsidian-m5-sandbox-transfer-witness.ts";

export const M6_UNCERTAIN_READONLY_FLAG="--sandbox-inspect-uncertain-m3-readonly";
type M6Request={
  sandboxOwnerJwt:string;localMarkdown:string;reviewedLocalSha:string;
  reviewedRemoteSha:string|null;reviewedRemoteRevision:string|null;
};
const INPUT_LIMIT=1_520_000;

export function assertManualM6Invocation(
  platform:string,computerName:string,args:readonly string[],isTerminal:boolean,
):void{
  if(platform!=="win32"||computerName.trim().toUpperCase()!=="MSI"||
     args.length!==1||args[0]!==M6_UNCERTAIN_READONLY_FLAG||isTerminal){
    throw Error("M6 inspection requires MSI, explicit read-only flag and piped input");
  }
}

export async function readM6UncertainRequest(
  source:AsyncIterable<string|Uint8Array>,
):Promise<M6Request>{
  const chunks:Buffer[]=[];
  let total=0;
  for await(const chunk of source){
    const bytes=typeof chunk==="string"?Buffer.from(chunk,"utf8"):Buffer.from(chunk);
    total+=bytes.length;
    if(total>INPUT_LIMIT)throw Error("M6 read-only input exceeds limit");
    chunks.push(bytes);
  }
  let parsed:unknown;
  try{parsed=JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;}
  catch{throw Error("M6 requires one JSON request");}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)){
    throw Error("M6 request shape invalid");
  }
  const r=parsed as Record<string,unknown>;
  if(Object.keys(r).length!==5||
     !["sandboxOwnerJwt","localMarkdown","reviewedLocalSha",
       "reviewedRemoteSha","reviewedRemoteRevision"].every(key=>
       Object.hasOwn(r,key)
     )||
     typeof r.sandboxOwnerJwt!=="string"||r.sandboxOwnerJwt.length>8192||
     !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(r.sandboxOwnerJwt)||
     typeof r.localMarkdown!=="string"||
     Buffer.byteLength(r.localMarkdown,"utf8")>250_000||
     typeof r.reviewedLocalSha!=="string"||
     !/^[0-9a-f]{64}$/.test(r.reviewedLocalSha)||
     !((r.reviewedRemoteSha===null&&r.reviewedRemoteRevision===null)||
       (typeof r.reviewedRemoteSha==="string"&&
        /^[0-9a-f]{64}$/.test(r.reviewedRemoteSha)&&
        typeof r.reviewedRemoteRevision==="string"&&
        /^[0-9a-f]{64}$/.test(r.reviewedRemoteRevision)&&
        r.reviewedRemoteSha!==r.reviewedLocalSha))){
    throw Error("M6 request fields invalid");
  }
  return r as M6Request;
}

const invoked=process.argv[1]?
  path.resolve(process.argv[1])===fileURLToPath(import.meta.url):false;
if(invoked){
  try{
    assertManualM6Invocation(
      process.platform,hostname(),process.argv.slice(2),!!process.stdin.isTTY,
    );
    const request=await readM6UncertainRequest(process.stdin);
    const result=await inspectUncertainM3SandboxOutcome(request);
    if(result.baselineSaved!==false||result.transferConfirmed!==false||
       result.automaticRetryAllowed!==false)throw Error("Unexpected M6 recovery authority");
    console.log("M6_SANDBOX_CURRENT_REMOTE_STATE "+result.currentRemoteState);
    console.log("CURRENT_OWNER_RLS_OBSERVATION_ONLY; PRIOR_TRANSFER_NOT_PROVEN");
    console.log("NO_AUTOMATIC_RETRY; NO_VAULT_ACCESS; BASELINE_UNCHANGED");
  }catch{
    console.error("M6_UNCERTAIN_SANDBOX_REINSPECTION_NOT_VERIFIED; NO_RETRY");
    process.exitCode=1;
  }
}
