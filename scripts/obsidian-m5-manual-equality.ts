/**
 * MSI manual M5 observation: approved Vault READ + fixed Sandbox Owner-RLS GET.
 * No Baseline database, restore, transfer, Vault writes or remote mutations.
 * Short-lived Sandbox JWT and optional prior receipt path enter via stdin only.
 */
import {hostname} from "node:os";
import {unlink} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {previewApprovedMsiSandboxSync} from "../lib/obsidian-manual-sync-approved-msi.ts";
import {
  saveM5EqualSourceObservation,reverifyM5EqualSourceObservation,
} from "../lib/obsidian-m5-equality-observation.ts";

export const M5_OBSERVE="--sandbox-m5-observe-current-equality-readonly";
export const M5_REVERIFY="--sandbox-m5-reverify-current-equality-readonly";

type Request={sandboxOwnerJwt:string;observationPath?:string};
export function assertManualM5Invocation(
  platform:string,computer:string,flags:readonly string[],terminal:boolean,
){
  if(platform!=="win32"||computer.trim().toUpperCase()!=="MSI"||
     flags.length!==1||![M5_OBSERVE,M5_REVERIFY].includes(flags[0])||
     terminal){
    throw Error("M5 requires an explicit MSI-only read-only flag and piped input");
  }
}
export async function readM5ManualRequest(
  chunks:AsyncIterable<string|Uint8Array>,mode:string,
):Promise<Request>{
  let size=0;
  const parts:Buffer[]=[];
  for await(const chunk of chunks){
    const bytes=typeof chunk==="string"?Buffer.from(chunk):Buffer.from(chunk);
    size+=bytes.length;
    if(size>12_000)throw Error("M5 manual input exceeds limit");
    parts.push(bytes);
  }
  let parsed:unknown;
  try{parsed=JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown;}
  catch{throw Error("M5 manual request is invalid");}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)){
    throw Error("M5 manual request is invalid");
  }
  const r=parsed as Record<string,unknown>;
  const keys=mode===M5_REVERIFY?["sandboxOwnerJwt","observationPath"]:
    mode===M5_OBSERVE?["sandboxOwnerJwt"]:[];
  if(!keys.length||Object.keys(r).length!==keys.length||
     !keys.every(k=>Object.hasOwn(r,k))||
     typeof r.sandboxOwnerJwt!=="string"||r.sandboxOwnerJwt.length>8192||
     !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(r.sandboxOwnerJwt)||
     (mode===M5_REVERIFY&&(
       typeof r.observationPath!=="string"||r.observationPath.length>4096))){
    throw Error("M5 manual request fields are invalid");
  }
  return r as Request;
}

export async function runM5ManualObservation(
  mode:string,request:Request,
  readPreview:typeof previewApprovedMsiSandboxSync=previewApprovedMsiSandboxSync,
):Promise<{path?:string;count:number;baselineSaved:false}>{
  // Calling the approved MSI adapter performs two Vault scans around the
  // authenticated, full-inventory Owner-RLS GET. Only CURRENT equality counts.
  const readBoth=()=>readPreview({
    sandboxOwnerJwt:request.sandboxOwnerJwt,baseline:[],
  });
  // Both independently registered Vault + Owner-RLS reads are required:
  // a snapshot that was equal before persistence may be stale afterwards.
  const initial=await readBoth();
  if(mode===M5_OBSERVE){
    const saved=await saveM5EqualSourceObservation(initial);
    try{
      const confirmed=await readBoth();
      const checked=await reverifyM5EqualSourceObservation(saved.path,confirmed);
      if(checked.stillEqualNotes!==saved.observedNotes){
        throw Error("M5 equal-source observation changed during persistence");
      }
      return {path:saved.path,count:saved.observedNotes,baselineSaved:false};
    }catch(error){
      // Only remove THIS invocation's brand-new scratch receipt; never touch
      // a Vault file, a historic receipt or any remote Sandbox record.
      try{await unlink(saved.path);}
      catch{throw Error("M5 stale observation cleanup needs manual inspection");}
      throw error;
    }
  }
  if(mode===M5_REVERIFY&&request.observationPath){
    await reverifyM5EqualSourceObservation(request.observationPath,initial);
    const confirmed=await readBoth();
    const checked=await reverifyM5EqualSourceObservation(
      request.observationPath,confirmed,
    );
    return {count:checked.stillEqualNotes,baselineSaved:false};
  }
  throw Error("M5 mode or observation path missing");
}

const invoked=process.argv[1]?
  path.resolve(process.argv[1])===fileURLToPath(import.meta.url):false;
if(invoked){
  try{
    assertManualM5Invocation(process.platform,hostname(),
      process.argv.slice(2),!!process.stdin.isTTY);
    const request=await readM5ManualRequest(process.stdin,process.argv[2]);
    const result=await runM5ManualObservation(process.argv[2],request);
    if(result.path){
      // Path contains private note identifiers/SHA: keep only on local MSI.
      console.log("M5_EQUALITY_OBSERVATION_FILE "+result.path);
    }
    console.log("M5_CURRENT_EQUAL_NOTES "+result.count);
    console.log("CURRENT_READONLY_OBSERVATION_ONLY; BASELINE_UNCHANGED");
  }catch{
    console.error("M5_CURRENT_EQUALITY_NOT_VERIFIED");
    process.exitCode=1;
  }
}
