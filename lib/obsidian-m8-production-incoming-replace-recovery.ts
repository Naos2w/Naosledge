/**
 * M8 existing-note Incoming read-only recovery + explicit ACK.
 *
 * Never restores, deletes a note, retries, writes to Neon, or mutates M5.
 * ACK is an explicit one-note action AFTER independently signed M5 evidence,
 * full fresh Owner-RLS and local SHA. It atomically ARCHIVES the entire
 * operation directory (original .bak + intent), NEVER destroys the backup.
 */
import {createHash} from "node:crypto";
import {homedir,hostname,tmpdir} from "node:os";
import {lstat,realpath,readFile,readdir,open,mkdir,rename}
  from "node:fs/promises";
import path from "node:path";
import {APPROVED_MSI_VAULT,verifyMsiVaultRegistration}
  from "./obsidian-m4-local-apply.ts";
import {RELEASE_NEON_BRANCH} from "./neon/production-release.ts";
import {readObsidianLocalManifest}
  from "./obsidian-local-manifest.ts";
import {fetchProductionOwnerRlsFingerprints}
  from "./obsidian-m8-production-inventory-readonly.ts";
import {inspectProductionM8Baseline,
  type ProductionM8JournalOptions}
  from "./obsidian-m8-production-baseline-journal.ts";

const TEST_VAULT=/^naosledge-m8-vault-test-[a-zA-Z0-9_-]{6,}$/;
const TEST_PENDING=/^naosledge-m8-incoming-test-[a-zA-Z0-9_-]{6,}$/;
const TEST_BACKUP=/^naosledge-m8-backups-test-[a-zA-Z0-9_-]{6,}$/;
const OP=/^op-[a-f0-9]{24}$/;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA=/^[a-f0-9]{64}$/;
const FORMAT="naosledge.m8.production-incoming-replace.v1";
const KEYS=["format","branch","action","slug",
  "previousLocalSha256","remoteSha256","remoteRevision"];
function stop():never{
  throw Error("M8 Production replace recovery requires manual review");
}
const digest=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
function testChild(value:string,pattern:RegExp){
  return typeof value==="string"&&path.isAbsolute(value)&&
    path.dirname(path.resolve(value)).toLowerCase()===
      path.resolve(tmpdir()).toLowerCase()&&
    pattern.test(path.basename(value));
}
async function safeDir(dir:string){
  const st=await lstat(dir);
  if(!st.isDirectory()||st.isSymbolicLink()||
     path.normalize(await realpath(dir)).toLowerCase()!==
       path.normalize(dir).toLowerCase())stop();
}
type TestScope={
  vaultRoot:string;privateRoot:string;archiveRoot:string;
  journalOptions:ProductionM8JournalOptions;
};
async function scope(test?:TestScope){
  if(test){
    if(!testChild(test.vaultRoot,TEST_VAULT)||
       !testChild(test.privateRoot,TEST_PENDING)||
       !testChild(test.archiveRoot,TEST_BACKUP)||
       !test.journalOptions?.testRoot||
       !test.journalOptions?.testProtector||
       !test.journalOptions?.testReadLocal)stop();
    for(const dir of [test.vaultRoot,test.privateRoot,test.archiveRoot])
      await safeDir(dir);
    return {
      vault:path.resolve(test.vaultRoot),
      privateRoot:path.resolve(test.privateRoot),
      archiveRoot:path.resolve(test.archiveRoot),
    };
  }
  if(process.platform!=="win32"||hostname().trim().toUpperCase()!=="MSI")stop();
  await verifyMsiVaultRegistration();
  await safeDir(APPROVED_MSI_VAULT);
  const base=process.env.LOCALAPPDATA||
    path.join(homedir(),"AppData","Local");
  await safeDir(base);
  const parent=path.join(base,"Naosledge");
  const privateRoot=path.join(parent,"m8-production-incoming");
  const archiveRoot=path.join(parent,"m8-production-backups");
  await safeDir(parent);
  await safeDir(privateRoot);
  try{await mkdir(archiveRoot,{mode:0o700});}
  catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")stop();}
  await safeDir(archiveRoot);
  return {vault:APPROVED_MSI_VAULT,privateRoot,archiveRoot};
}
async function readSafe(file:string):Promise<Buffer|null>{
  let before;
  try{before=await lstat(file);}
  catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return null;stop();}
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
     before.size<1||before.size>250_000||
     path.normalize(await realpath(file)).toLowerCase()!==
       path.normalize(file).toLowerCase())stop();
  const bytes=await readFile(file);
  const after=await lstat(file);
  if(bytes.length!==before.size||after.ino!==before.ino||
     after.size!==before.size||after.mtimeMs!==before.mtimeMs)stop();
  return bytes;
}
type Pending={
  pending:true;
  state:"applied"|"not-applied"|"diverged"|"missing";
  lockPresent:boolean;slug:string;sha256:string;revision:string;
  originalBackupSha256:string;backupPath:string;intentPath:string;
  backupVerified:true;manualReviewRequired:true;
  automaticRetryAllowed:false;baselineSaved:false;
  localWrites:0;remoteWrites:0;
};
type NoPending={
  pending:false;lockPresent:false;manualReviewRequired:false;
  automaticRetryAllowed:false;baselineSaved:false;
  localWrites:0;remoteWrites:0;
};
export async function inspectM8ProductionReplacePending(args:{
  testOnly?:TestScope;
}):Promise<Pending|NoPending>{
  const place=await scope(args?.testOnly);
  const items=(await readdir(place.privateRoot)).sort();
  const lockPresent=items.includes(".m8-incoming-new.lock");
  const jobs=items.filter(x=>x!==".m8-incoming-new.lock");
  if(jobs.length===0){
    if(lockPresent)stop();
    return {pending:false,lockPresent:false,manualReviewRequired:false,
      automaticRetryAllowed:false,baselineSaved:false,
      localWrites:0,remoteWrites:0};
  }
  if(jobs.length!==1||!OP.test(jobs[0]))stop();
  const root=path.join(place.privateRoot,jobs[0]);
  await safeDir(root);
  const intentPath=path.join(root,"incoming-intent.json");
  const raw=await readSafe(intentPath);
  if(!raw||raw.length>4096)stop();
  let decoded:unknown;
  try{decoded=JSON.parse(raw.toString("utf8")) as unknown;}
  catch{stop();}
  if(!decoded||typeof decoded!=="object"||Array.isArray(decoded))stop();
  const v=decoded as Record<string,unknown>;
  if(JSON.stringify(Object.keys(v))!==JSON.stringify(KEYS)||
     JSON.stringify(v)!==raw.toString("utf8")||
     v.format!==FORMAT||v.branch!==RELEASE_NEON_BRANCH||
     v.action!=="download-replace"||
     typeof v.slug!=="string"||v.slug.length<3||
     v.slug.length>120||!SLUG.test(v.slug)||
     typeof v.previousLocalSha256!=="string"||
     !SHA.test(v.previousLocalSha256)||
     typeof v.remoteSha256!=="string"||!SHA.test(v.remoteSha256)||
     typeof v.remoteRevision!=="string"||!SHA.test(v.remoteRevision)||
     v.previousLocalSha256===v.remoteSha256)stop();
  const slug=v.slug as string;
  const backupPath=path.join(root,slug+".md.bak");
  const files=(await readdir(root)).sort();
  const normalFiles=["incoming-intent.json",slug+".md.bak"].sort();
  const nativeFiles=[
    "incoming-intent.json",slug+".md.bak",
    "windows-native-original.md.bak",
  ].sort();
  const nativeComplete=JSON.stringify(files)===JSON.stringify(nativeFiles);
  const basicComplete=JSON.stringify(files)===JSON.stringify(normalFiles);
  // Interrupted BEFORE Win32 File.Replace legitimately lacks the second
  // backup. No completed Windows replacement can be ACKed without it.
  if(!nativeComplete&&!basicComplete)stop();
  const backup=await readSafe(backupPath);
  if(!backup||digest(backup)!==v.previousLocalSha256)stop();
  if(nativeComplete){
    const win=await readSafe(path.join(root,"windows-native-original.md.bak"));
    if(!win||digest(win)!==v.previousLocalSha256)stop();
  }
  const actual=await readSafe(path.join(place.vault,slug+".md"));
  let state:Pending["state"];
  if(actual===null)state="missing";
  else if(digest(actual)===v.remoteSha256)state="applied";
  else if(digest(actual)===v.previousLocalSha256)state="not-applied";
  else state="diverged";
  if(process.platform==="win32"&&state==="applied"&&!nativeComplete)stop();
  return {
    pending:true,state,lockPresent,slug,
    sha256:v.remoteSha256 as string,
    revision:v.remoteRevision as string,
    originalBackupSha256:v.previousLocalSha256 as string,
    backupPath,intentPath,backupVerified:true,
    manualReviewRequired:true,automaticRetryAllowed:false,
    baselineSaved:false,localWrites:0,remoteWrites:0,
  };
}
export async function acknowledgeM8ProductionReplace(args:{
  ownerJwt:string;typedConfirmation:string;
  fetcher?:typeof fetch;testOnly?:TestScope;
}):Promise<{
  acknowledged:true;durableBackupArchived:true;
  archivedBackupPath:string;pendingOperationsRemaining:0;
  localNoteWrites:0;remoteWrites:0;automaticTransfersEnabled:false;
}>{
  const place=await scope(args?.testOnly);
  const pending=await inspectM8ProductionReplacePending({
    testOnly:args.testOnly,
  });
  if(!pending.pending||pending.lockPresent||pending.state!=="applied"||
     args.typedConfirmation!==
       "ACK M8 PRODUCTION DOWNLOAD-REPLACE "+pending.slug+" "+
       pending.sha256.slice(0,12))stop();
  const signed=await inspectProductionM8Baseline({
    ownerJwt:args.ownerJwt,fetcher:args.fetcher,
    options:args.testOnly?.journalOptions,
  });
  const checkpoint=signed.fingerprints.find(x=>x.slug===pending.slug);
  if(!signed.paired||!signed.durableBaselineVerified||
     checkpoint?.sha256!==pending.sha256||
     checkpoint?.revision!==pending.revision)stop();
  const previous=(await fetchProductionOwnerRlsFingerprints({
    branchId:RELEASE_NEON_BRANCH,jwt:args.ownerJwt,
    fetcher:args.fetcher,
  })).fingerprints.find(x=>x.slug===pending.slug);
  const local=await readObsidianLocalManifest(place.vault);
  if(previous?.sha256!==pending.sha256||
     previous?.revision!==pending.revision||
     local.fingerprints.find(x=>x.slug===pending.slug)?.sha256!==
       pending.sha256||local.unsupportedMarkdownFiles>0||
     local.directoriesNotScanned>0)stop();

  // Same private lock as create-only/replace. Atomic archive moves original
  // backup and intent together, retains the previous version permanently.
  const file=path.join(place.privateRoot,".m8-incoming-new.lock");
  let h:Awaited<ReturnType<typeof open>>;
  try{h=await open(file,"wx",0o600);}catch{stop();}
  const marker=await h.stat();
  try{
    await h.writeFile("ack-m8-replace");
    await h.sync();
    const check=await inspectM8ProductionReplacePending({
      testOnly:args.testOnly,
    });
    if(!check.pending||check.state!=="applied"||
       check.intentPath!==pending.intentPath||
       check.originalBackupSha256!==pending.originalBackupSha256||
       check.sha256!==pending.sha256||
       check.revision!==pending.revision)stop();
    const remoteNow=(await fetchProductionOwnerRlsFingerprints({
      branchId:RELEASE_NEON_BRANCH,jwt:args.ownerJwt,
      fetcher:args.fetcher,
    })).fingerprints.find(x=>x.slug===pending.slug);
    const localNow=await readObsidianLocalManifest(place.vault);
    if(remoteNow?.sha256!==pending.sha256||
       remoteNow?.revision!==pending.revision||
       localNow.fingerprints.find(x=>x.slug===pending.slug)?.sha256!==
         pending.sha256||
       localNow.unsupportedMarkdownFiles>0||
       localNow.directoriesNotScanned>0)stop();
    const op=path.dirname(pending.intentPath);
    const archived=path.join(place.archiveRoot,path.basename(op));
    try{await lstat(archived);stop();}
    catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
    await rename(op,archived);
    const archivedBackupPath=path.join(archived,pending.slug+".md.bak");
    if(digest((await readSafe(archivedBackupPath))??Buffer.alloc(0))!==
       pending.originalBackupSha256)stop();
    return {
      acknowledged:true,durableBackupArchived:true,
      archivedBackupPath,pendingOperationsRemaining:0,
      localNoteWrites:0,remoteWrites:0,automaticTransfersEnabled:false,
    };
  }finally{
    await h.close();
    const last=await lstat(file).catch(()=>stop());
    if(!last.isFile()||last.isSymbolicLink()||
       last.nlink!==1||last.ino!==marker.ino)stop();
    const {unlink}=await import("node:fs/promises");
    await unlink(file);
  }
}
