/**
 * MSI manual M5 reread of one persisted M3 Scratch transfer witness.
 * Explicit stdin includes a short-lived Sandbox Owner JWT and the CURRENT
 * independently supplied scratch Markdown; no Vault path/read, write, sync,
 * Baseline import, automatic retry, or Production access is permitted.
 */
import {hostname} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {reverifyM3SandboxWitness} from "../lib/obsidian-m5-sandbox-transfer-witness.ts";

export const M5_WITNESS_REVERIFY_FLAG="--sandbox-scratch-reverify-m3-witness-only";
const MAX_REQUEST_BYTES=1_520_000;
type Request={receiptPath:string;localMarkdown:string;sandboxOwnerJwt:string};

export function assertManualM5Invocation(
  platform:string,computerName:string,args:readonly string[],isTerminal:boolean,
):void{
  if(platform!=="win32"||computerName.trim().toUpperCase()!=="MSI"||
     args.length!==1||args[0]!==M5_WITNESS_REVERIFY_FLAG||isTerminal){
    throw Error("M5 witness verification requires explicit MSI stdin invocation");
  }
}

export async function readManualM5Request(
  source:AsyncIterable<string|Uint8Array>,
):Promise<Request>{
  const chunks:Buffer[]=[];
  let size=0;
  for await(const piece of source){
    const bytes=typeof piece==="string"?Buffer.from(piece,"utf8"):Buffer.from(piece);
    size+=bytes.length;
    if(size>MAX_REQUEST_BYTES)throw Error("M5 verification request too large");
    chunks.push(bytes);
  }
  let parsed:unknown;
  try{parsed=JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;}
  catch{throw Error("M5 verification requires JSON stdin");}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||
     Object.keys(parsed).length!==3||
     !["receiptPath","localMarkdown","sandboxOwnerJwt"].every(
       key=>Object.hasOwn(parsed,key),
     )){
    throw Error("M5 requires a single exact private witness and current Scratch note");
  }
  const r=parsed as Record<string,unknown>;
  if(typeof r.receiptPath!=="string"||r.receiptPath.length>2048||
     typeof r.localMarkdown!=="string"||
     Buffer.byteLength(r.localMarkdown,"utf8")>250_000||
     typeof r.sandboxOwnerJwt!=="string"||r.sandboxOwnerJwt.length>8192||
     !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(r.sandboxOwnerJwt)){
    throw Error("M5 witness input is invalid");
  }
  return r as Request;
}

export async function reverifyManualM5Witness(
  request:Request,fetcher?:typeof fetch,
):Promise<{matchesCurrentScratchPair:true;baselineSaved:false}>{
  const result=await reverifyM3SandboxWitness({...request,fetcher});
  return {matchesCurrentScratchPair:result.matchesCurrentScratchPair,
    baselineSaved:result.baselineSaved};
}

const invoked=process.argv[1]?
  path.resolve(process.argv[1])===fileURLToPath(import.meta.url):false;
if(invoked){
  try{
    assertManualM5Invocation(
      process.platform,hostname(),process.argv.slice(2),!!process.stdin.isTTY,
    );
    const request=await readManualM5Request(process.stdin);
    const result=await reverifyManualM5Witness(request);
    if(!result.matchesCurrentScratchPair||result.baselineSaved!==false){
      throw Error("Unexpected M5 verification result");
    }
    console.log("M5_SANDBOX_SCRATCH_AND_REMOTE_READ_ONLY_VERIFIED");
    console.log("SELF_REPORTED_WITNESS; NO_VAULT_PROOF; BASELINE_UNCHANGED");
  }catch{
    console.error("M5_WITNESS_NOT_VERIFIED; NO_BASELINE_CHANGE");
    process.exitCode=1;
  }
}
