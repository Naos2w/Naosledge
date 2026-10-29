/**
 * M8 Production download-new receipt recovery/acknowledgement.
 *
 * Inspection is local-only, immutable and fail-closed. A successful new
 * download intentionally leaves a durable intent outside Obsidian. Only AFTER
 * signed Owner M5 records the exact same SHA/revision, the separate ACK may
 * remove exactly that one intent. Never remove an unknown operation or lock.
 */
import {createHash} from "node:crypto";
import {hostname,homedir,tmpdir} from "node:os";
import {lstat,readFile,readdir,realpath,open,unlink,rmdir}
  from "node:fs/promises";
import path from "node:path";
import {RELEASE_NEON_BRANCH} from "./neon/production-release.ts";
import {APPROVED_MSI_VAULT,verifyMsiVaultRegistration}
  from "./obsidian-m4-local-apply.ts";
import {inspectProductionM8Baseline,
  type ProductionM8JournalOptions}
  from "./obsidian-m8-production-baseline-journal.ts";
import {fetchProductionOwnerRlsFingerprints}
  from "./obsidian-m8-production-inventory-readonly.ts";
import {readObsidianLocalManifest}
  from "./obsidian-local-manifest.ts";

const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA=/^[a-f0-9]{64}$/;
const TEST_VAULT=/^naosledge-m8-vault-test-[a-zA-Z0-9_-]{6,}$/;
const TEST_PRIVATE=/^naosledge-m8-incoming-test-[a-zA-Z0-9_-]{6,}$/;
const OP=/^op-[a-f0-9]{24}$/;
const FORMAT="naosledge.m8.production-incoming-new.v1";
const KEYS=["format","branch","action","slug","previousLocalSha256",
  "remoteSha256","remoteRevision"];
const digest=(data:Buffer)=>createHash("sha256").update(data).digest("hex");
function refuse():never{
  throw Error("M8 Production Incoming pending operation requires manual inspection");
}
type TestScope={
  vaultRoot:string;privateRoot:string;
  journalOptions:ProductionM8JournalOptions;
};
async function safeDir(folder:string){
  const st=await lstat(folder);
  if(!st.isDirectory()||st.isSymbolicLink()||
     path.normalize(await realpath(folder)).toLowerCase()!==
       path.normalize(folder).toLowerCase())refuse();
}
async function scope(test?:TestScope){
  if(test){
    const t=path.resolve(tmpdir());
    if(!test.vaultRoot||!test.privateRoot||
       !path.isAbsolute(test.vaultRoot)||!path.isAbsolute(test.privateRoot)||
       path.dirname(path.resolve(test.vaultRoot)).toLowerCase()!==t.toLowerCase()||
       path.dirname(path.resolve(test.privateRoot)).toLowerCase()!==t.toLowerCase()||
       !TEST_VAULT.test(path.basename(test.vaultRoot))||
       !TEST_PRIVATE.test(path.basename(test.privateRoot))||
       !test.journalOptions?.testRoot||
       !test.journalOptions?.testProtector||
       !test.journalOptions?.testReadLocal)refuse();
    await safeDir(test.vaultRoot);await safeDir(test.privateRoot);
    return {vault:path.resolve(test.vaultRoot),
      privateRoot:path.resolve(test.privateRoot)};
  }
  if(process.platform!=="win32"||hostname().trim().toUpperCase()!=="MSI")refuse();
  await verifyMsiVaultRegistration();
  await safeDir(APPROVED_MSI_VAULT);
  const base=process.env.LOCALAPPDATA||
    path.join(homedir(),"AppData","Local");
  const privateRoot=path.join(base,"Naosledge","m8-production-incoming");
  await safeDir(privateRoot);
  return {vault:APPROVED_MSI_VAULT,privateRoot};
}
async function readStable(file:string,max:number):Promise<Buffer|null>{
  let before;
  try{before=await lstat(file);}
  catch(e){
    if((e as NodeJS.ErrnoException).code==="ENOENT")return null;
    refuse();
  }
  if(!before.isFile()||before.isSymbolicLink()||
     before.nlink!==1||before.size<1||before.size>max||
     path.normalize(await realpath(file)).toLowerCase()!==
       path.normalize(file).toLowerCase())refuse();
  const value=await readFile(file);
  const after=await lstat(file);
  if(after.ino!==before.ino||after.mtimeMs!==before.mtimeMs||
     after.size!==before.size||value.length!==before.size)refuse();
  return value;
}
type Intent={
  format:typeof FORMAT;
  branch:typeof RELEASE_NEON_BRANCH;
  action:"download-new";
  slug:string;
  previousLocalSha256:null;
  remoteSha256:string;
  remoteRevision:string;
};
function decode(data:Buffer):Intent{
  let value:unknown;
  try{value=JSON.parse(data.toString("utf8"));}catch{refuse();}
  if(!value||typeof value!=="object"||Array.isArray(value))refuse();
  const raw=value as Record<string,unknown>;
  if(JSON.stringify(Object.keys(raw))!==JSON.stringify(KEYS)||
     JSON.stringify(raw)!==data.toString("utf8")||
     raw.format!==FORMAT||raw.branch!==RELEASE_NEON_BRANCH||
     raw.action!=="download-new"||
     typeof raw.slug!=="string"||raw.slug.length<3||
     raw.slug.length>120||!SLUG.test(raw.slug)||
     raw.previousLocalSha256!==null||
     typeof raw.remoteSha256!=="string"||!SHA.test(raw.remoteSha256)||
     typeof raw.remoteRevision!=="string"||!SHA.test(raw.remoteRevision))refuse();
  return raw as Intent;
}
type Pending={
  pending:true;
  state:"applied"|"not-applied"|"diverged";
  lockPresent:boolean;
  intentPath:string;
  slug:string;
  sha256:string;
  revision:string;
  baselineSaved:false;
  automaticRetryAllowed:false;
  manualReviewRequired:true;
  noteWrites:0;
};
export async function inspectM8ProductionIncomingNewPending(args:{
  testOnly?:TestScope;
}):Promise<Pending|{
  pending:false;lockPresent:false;baselineSaved:false;
  automaticRetryAllowed:false;manualReviewRequired:false;noteWrites:0;
}>{
  const {vault,privateRoot}=await scope(args?.testOnly);
  const entries=(await readdir(privateRoot)).sort();
  const locked=entries.includes(".m8-incoming-new.lock");
  const operations=entries.filter(x=>x!==".m8-incoming-new.lock");
  if(operations.length===0){
    if(locked)refuse();
    return {
      pending:false,lockPresent:false,baselineSaved:false,
      automaticRetryAllowed:false,manualReviewRequired:false,noteWrites:0,
    };
  }
  if(operations.length!==1||!OP.test(operations[0]))refuse();
  const op=path.join(privateRoot,operations[0]);
  await safeDir(op);
  if(JSON.stringify(await readdir(op))!==
     JSON.stringify(["incoming-intent.json"]))refuse();
  const intentPath=path.join(op,"incoming-intent.json");
  const buffer=await readStable(intentPath,4096);
  if(!buffer)refuse();
  const intent=decode(buffer);
  const note=await readStable(path.join(vault,intent.slug+".md"),250_000);
  return {
    pending:true,
    state:note===null?"not-applied":
      digest(note)===intent.remoteSha256?"applied":"diverged",
    lockPresent:locked,intentPath,slug:intent.slug,
    sha256:intent.remoteSha256,revision:intent.remoteRevision,
    baselineSaved:false,automaticRetryAllowed:false,
    manualReviewRequired:true,noteWrites:0,
  };
}

/**
 * This only acknowledges a completed, independently signed M5 checkpoint.
 * No note write or cloud mutation occurs. A stale lock or conflicting file
 * leaves the operation untouched for manual investigation.
 */
export async function acknowledgeM8ProductionIncomingNew(args:{
  ownerJwt:string;
  typedConfirmation:string;
  fetcher?:typeof fetch;
  testOnly?:TestScope;
}):Promise<{
  acknowledged:true;baselineVerified:true;incomingOpsRemaining:0;
  noteWrites:0;automaticTransfersEnabled:false;
}>{
  const {vault,privateRoot}=await scope(args?.testOnly);
  const pending=await inspectM8ProductionIncomingNewPending({
    testOnly:args.testOnly,
  });
  if(!pending.pending||pending.lockPresent||pending.state!=="applied"||
     args.typedConfirmation!==
       "ACK M8 PRODUCTION DOWNLOAD-NEW "+pending.slug+" "+
       pending.sha256.slice(0,12))refuse();
  const signed=await inspectProductionM8Baseline({
    ownerJwt:args.ownerJwt,fetcher:args.fetcher,
    options:args.testOnly?.journalOptions,
  });
  const checkpoint=signed.fingerprints.find(x=>x.slug===pending.slug);
  if(!signed.paired||!signed.durableBaselineVerified||
     checkpoint?.sha256!==pending.sha256||
     checkpoint?.revision!==pending.revision)refuse();
  const remote=await fetchProductionOwnerRlsFingerprints({
    branchId:RELEASE_NEON_BRANCH,jwt:args.ownerJwt,
    fetcher:args.fetcher,
  });
  const r=remote.fingerprints.find(x=>x.slug===pending.slug);
  const manifest=await readObsidianLocalManifest(vault);
  const l=manifest.fingerprints.find(x=>x.slug===pending.slug);
  if(!r||!l||r.sha256!==pending.sha256||
     r.revision!==pending.revision||l.sha256!==pending.sha256||
     manifest.unsupportedMarkdownFiles>0||
     manifest.directoriesNotScanned>0)refuse();
  // Final local single writer, then all preconditions are rechecked before
  // removing ONLY the one operator-approved receipt.
  const lock=path.join(privateRoot,".m8-incoming-new.lock");
  let handle:Awaited<ReturnType<typeof open>>;
  try{handle=await open(lock,"wx",0o600);}catch{refuse();}
  const lockStat=await handle.stat();
  try{
    await handle.writeFile("ack-m8-production-new");
    await handle.sync();
    const check=await inspectM8ProductionIncomingNewPending({
      testOnly:args.testOnly,
    });
    if(!check.pending||check.state!=="applied"||
       check.intentPath!==pending.intentPath||
       check.sha256!==pending.sha256||
       check.revision!==pending.revision)refuse();
    const latest=await fetchProductionOwnerRlsFingerprints({
      branchId:RELEASE_NEON_BRANCH,jwt:args.ownerJwt,
      fetcher:args.fetcher,
    });
    const latestNote=latest.fingerprints.find(x=>x.slug===pending.slug);
    const latestLocal=await readObsidianLocalManifest(vault);
    if(latestNote?.sha256!==pending.sha256||
       latestNote?.revision!==pending.revision||
       latestLocal.fingerprints.find(x=>x.slug===pending.slug)?.sha256!==
         pending.sha256||
       latestLocal.unsupportedMarkdownFiles>0||
       latestLocal.directoriesNotScanned>0)refuse();
    // RLS and M5 were proven and the exact intent has not moved.
    await unlink(pending.intentPath);
    await rmdir(path.dirname(pending.intentPath));
  }finally{
    await handle.close();
    const st=await lstat(lock).catch(()=>refuse());
    if(!st.isFile()||st.isSymbolicLink()||
       st.ino!==lockStat.ino)refuse();
    await unlink(lock);
  }
  const leftovers=await readdir(privateRoot);
  if(leftovers.length!==0)refuse();
  return {
    acknowledged:true,baselineVerified:true,incomingOpsRemaining:0,
    noteWrites:0,automaticTransfersEnabled:false,
  };
}
