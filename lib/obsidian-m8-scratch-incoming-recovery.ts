/**
 * Read-only crash recovery for M8's OS TEMP Incoming rehearsal.
 *
 * The receipt is an UNTRUSTED local crash hint, not an Owner-RLS proof nor
 * permission to resume. The real Vault is intentionally impossible as a
 * source. Never auto-delete, auto-retry, restore, append Baseline or touch Neon.
 */
import {createHash} from "node:crypto";
import {lstat,readFile,readdir,realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {RELEASE_NEON_BRANCH} from "./neon/production-release.ts";

export const M8_SCRATCH_INTENT_FORMAT=
  "naosledge.m8.scratch-incoming-intent.v1" as const;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA=/^[a-f0-9]{64}$/;
const OP_PREFIX="naosledge-m8-scratch-operation-";
const ROOT_PREFIX="naosledge-m8-vault-test-";
const MAX_SIZE=250_000;
type Intent={
  format:typeof M8_SCRATCH_INTENT_FORMAT;
  branch:typeof RELEASE_NEON_BRANCH;
  slug:string;
  action:"download-new"|"download-replace";
  beforeSha256:string|null;
  remoteSha256:string;
  remoteRevision:string;
};
const keys=["format","branch","slug","action","beforeSha256",
  "remoteSha256","remoteRevision"];
function stop():never{throw Error("M8 scratch recovery requires manual inspection");}
function validRoot(root:string,prefix:string){
  if(typeof root!=="string"||!path.isAbsolute(root))stop();
  const result=path.resolve(root);
  if(path.resolve(path.dirname(result)).toLowerCase()!==
     path.resolve(tmpdir()).toLowerCase()||
     !path.basename(result).startsWith(prefix)||
     !/^[a-zA-Z0-9_-]+$/.test(path.basename(result)))stop();
  return result;
}
async function safeDir(root:string){
  const before=await lstat(root);
  if(!before.isDirectory()||before.isSymbolicLink()||
     path.normalize(await realpath(root)).toLowerCase()!==
       path.normalize(root).toLowerCase())stop();
}
async function safeBytes(file:string,max=MAX_SIZE):Promise<Buffer|null>{
  let before;
  try{before=await lstat(file);}catch(e){
    if((e as NodeJS.ErrnoException).code==="ENOENT")return null;
    stop();
  }
  if(!before.isFile()||before.isSymbolicLink()||
     before.nlink!==1||before.size>max||
     path.normalize(await realpath(file)).toLowerCase()!==
       path.normalize(file).toLowerCase())stop();
  const bytes=await readFile(file);
  const after=await lstat(file);
  if(after.ino!==before.ino||after.size!==before.size||
     after.mtimeMs!==before.mtimeMs||bytes.length!==before.size)stop();
  return bytes;
}
function digest(b:Buffer):string{
  return createHash("sha256").update(b).digest("hex");
}
export function encodeM8ScratchIncomingIntent(input:{
  slug:string;action:"download-new"|"download-replace";
  beforeSha256:string|null;remoteSha256:string;remoteRevision:string;
}):Buffer{
  const candidate={
    format:M8_SCRATCH_INTENT_FORMAT,
    branch:RELEASE_NEON_BRANCH,...input,
  };
  if(!validIntent(candidate))stop();
  return Buffer.from(JSON.stringify(candidate),"utf8");
}
function validIntent(value:unknown):value is Intent{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const x=value as Record<string,unknown>;
  if(JSON.stringify(Object.keys(x))!==JSON.stringify(keys))return false;
  return x.format===M8_SCRATCH_INTENT_FORMAT&&
    x.branch===RELEASE_NEON_BRANCH&&
    typeof x.slug==="string"&&x.slug.length>=3&&x.slug.length<=120&&
    SLUG.test(x.slug)&&
    ["download-new","download-replace"].includes(String(x.action))&&
    typeof x.remoteSha256==="string"&&SHA.test(x.remoteSha256)&&
    typeof x.remoteRevision==="string"&&SHA.test(x.remoteRevision)&&
    (x.beforeSha256===null||
      typeof x.beforeSha256==="string"&&SHA.test(x.beforeSha256))&&
    (x.action==="download-new") === (x.beforeSha256===null);
}
export async function inspectM8ScratchIncomingRecovery(args:{
  scratchVaultRoot:string;
  intentPath:string;
}):Promise<{
  state:"applied"|"not-applied"|"diverged"|"missing";
  backupVerified:boolean;
  remoteReadbackPerformed:false;
  localWrites:0;remoteWrites:0;
  baselineSaved:false;
  automaticRetryAllowed:false;
  manualReviewRequired:true;
}>{
  const root=validRoot(args?.scratchVaultRoot,ROOT_PREFIX);
  const operation=validRoot(path.dirname(args?.intentPath||""),OP_PREFIX);
  if(path.basename(args.intentPath)!=="incoming-intent.json"||
     path.resolve(args.intentPath)!==
       path.join(operation,"incoming-intent.json"))stop();
  await safeDir(root);
  await safeDir(operation);
  const raw=await safeBytes(args.intentPath,4096);
  if(!raw||raw.length<2)stop();
  let parsed:unknown;
  try{parsed=JSON.parse(raw.toString("utf8")) as unknown;}catch{stop();}
  if(!validIntent(parsed)||JSON.stringify(parsed)!==raw.toString("utf8"))stop();
  const intent=parsed;
  const backupName=intent.slug+".md.bak";
  const expected=[intent.action==="download-replace"?backupName:null,
    "incoming-intent.json"].filter(Boolean).sort();
  if(JSON.stringify((await readdir(operation)).sort())!==
     JSON.stringify(expected))stop();
  let backupVerified=false;
  if(intent.action==="download-replace"){
    const backup=await safeBytes(path.join(operation,backupName));
    if(!backup||digest(backup)!==intent.beforeSha256)stop();
    backupVerified=true;
  }
  const current=await safeBytes(path.join(root,intent.slug+".md"));
  let state:"applied"|"not-applied"|"diverged"|"missing";
  if(current===null){
    state=intent.beforeSha256===null?"not-applied":"missing";
  }else{
    const actual=digest(current);
    if(actual===intent.remoteSha256)state="applied";
    else if(intent.beforeSha256!==null&&actual===intent.beforeSha256){
      state="not-applied";
    }else state="diverged";
  }
  return {
    state,backupVerified,
    remoteReadbackPerformed:false,
    localWrites:0,remoteWrites:0,
    baselineSaved:false,
    automaticRetryAllowed:false,manualReviewRequired:true,
  };
}
