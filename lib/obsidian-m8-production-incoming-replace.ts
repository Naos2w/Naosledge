/**
 * M8 Production download-replace, opt-in per note and NOT connected to Agent.
 *
 * Independently backs up the ORIGINAL bytes to private durable storage before
 * a same-folder atomic rename. Refuses changed inode/mtime/SHA, invalid M5
 * owner baseline, mismatched RLS revision, unknown files, pending operations,
 * or an unapproved slug. No remote mutation and NO automatic retry.
 *
 * A cooperative cross-process wx lock protects Naosledge writers. Third-party
 * editors may not respect the lock: this API rechecks immediately before
 * rename but MUST NOT be enabled for unattended live replacement without a
 * Windows native share-mode writer lock / live integration acceptance.
 */
import {createHash,randomBytes} from "node:crypto";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {homedir,hostname,tmpdir} from "node:os";
import {lstat,realpath,readFile,open,mkdir,readdir,rename,unlink} from "node:fs/promises";
import path from "node:path";
import {RELEASE_NEON_BRANCH} from "./neon/production-release.ts";
import {APPROVED_MSI_VAULT,verifyMsiVaultRegistration}
  from "./obsidian-m4-local-apply.ts";
import {inspectProductionM8Baseline,
  type ProductionM8JournalOptions}
  from "./obsidian-m8-production-baseline-journal.ts";
import {fetchProductionOwnerRlsFingerprints,
  fetchVerifiedProductionNoteMarkdown}
  from "./obsidian-m8-production-inventory-readonly.ts";
import {readObsidianLocalManifest}
  from "./obsidian-local-manifest.ts";
import type {AutoSyncCandidate} from "./obsidian-auto-sync-policy.ts";

const SHA=/^[a-f0-9]{64}$/;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX=250_000;
const VAULT_TEST=/^naosledge-m8-vault-test-[a-zA-Z0-9_-]{6,}$/;
const PRIVATE_TEST=/^naosledge-m8-incoming-test-[a-zA-Z0-9_-]{6,}$/;
const sha=(bytes:Buffer|string)=>createHash("sha256").update(bytes).digest("hex");
const OP=/^op-[a-f0-9]{24}$/;
function reject():never{
  throw Error("M8 Production replace stopped: reviewed source, backup and RLS required");
}
function uncertain():never{
  throw Error("M8 Production replace outcome uncertain: inspect durable backup and M5 before retry");
}
async function safeDirectory(dir:string){
  const st=await lstat(dir);
  if(!st.isDirectory()||st.isSymbolicLink()||
     path.normalize(await realpath(dir)).toLowerCase()!==
       path.normalize(dir).toLowerCase())reject();
}
function osTempChild(dir:string,rule:RegExp){
  return typeof dir==="string"&&path.isAbsolute(dir)&&
    path.dirname(path.resolve(dir)).toLowerCase()===
      path.resolve(tmpdir()).toLowerCase()&&rule.test(path.basename(dir));
}
type TestOnly={
  vaultRoot:string;
  privateRoot:string;
  journalOptions:ProductionM8JournalOptions;
  beforeCommitForTest?:()=>Promise<void>;
  afterCommitForTest?:()=>Promise<void>;
};
async function roots(test?:TestOnly){
  if(test!==undefined){
    if(!test||!osTempChild(test.vaultRoot,VAULT_TEST)||
       !osTempChild(test.privateRoot,PRIVATE_TEST)||
       !test.journalOptions?.testRoot||
       !test.journalOptions?.testProtector||
       !test.journalOptions?.testReadLocal||
       (test.beforeCommitForTest!==undefined&&
        typeof test.beforeCommitForTest!=="function")||
       (test.afterCommitForTest!==undefined&&
        typeof test.afterCommitForTest!=="function"))reject();
    await safeDirectory(test.vaultRoot);
    await safeDirectory(test.privateRoot);
    return {vault:path.resolve(test.vaultRoot),
      privateRoot:path.resolve(test.privateRoot)};
  }
  if(process.platform!=="win32"||
     hostname().trim().toUpperCase()!=="MSI")reject();
  await verifyMsiVaultRegistration();
  await safeDirectory(APPROVED_MSI_VAULT);
  const base=process.env.LOCALAPPDATA||
    path.join(homedir(),"AppData","Local");
  if(!path.isAbsolute(base))reject();
  await safeDirectory(base);
  const parent=path.join(base,"Naosledge");
  const privateRoot=path.join(parent,"m8-production-incoming");
  for(const dir of [parent,privateRoot]){
    try{await mkdir(dir,{mode:0o700});}
    catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")reject();}
    await safeDirectory(dir);
  }
  return {vault:APPROVED_MSI_VAULT,privateRoot};
}
async function readStable(target:string):Promise<{
  bytes:Buffer;inode:number;mtimeMs:number;size:number;
}>{
  let before;
  try{before=await lstat(target);}catch{reject();}
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
     before.size<1||before.size>MAX||
     path.normalize(await realpath(target)).toLowerCase()!==
       path.normalize(target).toLowerCase())reject();
  const bytes=await readFile(target);
  const after=await lstat(target);
  if(bytes.length!==before.size||after.ino!==before.ino||
     after.mtimeMs!==before.mtimeMs||after.size!==before.size)reject();
  return {bytes,inode:before.ino,mtimeMs:before.mtimeMs,size:before.size};
}
async function durable(filename:string,content:Buffer){
  const h=await open(filename,"wx",0o600);
  try{await h.writeFile(content);await h.sync();}
  finally{await h.close();}
  if(!Buffer.from(await readFile(filename)).equals(content))reject();
}
async function locked<T>(root:string,task:()=>Promise<T>):Promise<T>{
  // Deliberately the SAME lock as the P2b new-note Incoming adapter.
  const filename=path.join(root,".m8-incoming-new.lock");
  let h:Awaited<ReturnType<typeof open>>;
  try{h=await open(filename,"wx",0o600);}catch{reject();}
  const marker=await h.stat();
  try{
    await h.writeFile("m8-Production-cooperative-download-writer");
    await h.sync();
    return await task();
  }finally{
    await h.close();
    const after=await lstat(filename).catch(()=>reject());
    if(!after.isFile()||after.isSymbolicLink()||after.nlink!==1||
       after.ino!==marker.ino)reject();
    await unlink(filename);
  }
}
async function windowsNativeReplace(
  target:string,staged:string,extraBackup:string,expectedOld:string,
):Promise<void>{
  if(process.platform!=="win32")reject();
  const script=fileURLToPath(new URL(
    "../scripts/obsidian-m8-windows-native-replace.ps1",import.meta.url));
  await new Promise<void>((resolve,fail)=>{
    let exited=false;
    const child=spawn("powershell.exe",[
      "-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass",
      "-File",script,"-Target",target,"-Staged",staged,
      "-ReplacementBackup",extraBackup,"-ExpectedSha256",expectedOld,
    ],{stdio:"ignore",windowsHide:true});
    const timeout=setTimeout(()=>{
      if(!exited){child.kill();fail(Error("Native replace timed out"));}
    },25_000);
    child.once("error",()=>{clearTimeout(timeout);fail(Error("Native replace refused"));});
    child.once("exit",code=>{
      exited=true;clearTimeout(timeout);
      if(code===0)resolve();else fail(Error("Native replace refused"));
    });
  });
}
export async function downloadProductionReplaceOnce(args:{
  branchId:string;ownerJwt:string;candidate:AutoSyncCandidate;
  typedConfirmation:string;fetcher?:typeof fetch;
  signal?:AbortSignal;testOnly?:TestOnly;
}):Promise<{
  slug:string;sha256:string;revision:string;
  originalBackupSha256:string;backupPath:string;intentPath:string;
  localReadbackVerified:true;remoteReadbackVerified:true;
  baselineSaved:false;automaticRetryAllowed:false;
}>{
  const c=args?.candidate?{...args.candidate}:undefined;
  if(!args||args.branchId!==RELEASE_NEON_BRANCH||
     !c||c.action!=="download-replace"||c.choice!=="review-download"||
     c.executable!==false||c.requiresDurableBackup!==true||
     c.requiresFreshTwoSidedRead!==true||
     c.automaticDeletionAllowed!==false||
     typeof c.slug!=="string"||!SLUG.test(c.slug)||
     c.slug.length<3||c.slug.length>120||
     typeof c.expectedLocalSha!=="string"||!SHA.test(c.expectedLocalSha)||
     typeof c.expectedRemoteSha!=="string"||!SHA.test(c.expectedRemoteSha)||
     typeof c.expectedRemoteRevision!=="string"||
     !SHA.test(c.expectedRemoteRevision)||
     c.expectedLocalSha===c.expectedRemoteSha||
     args.typedConfirmation!==
       "APPROVE M8 PRODUCTION DOWNLOAD-REPLACE "+c.slug+" "+
       c.expectedRemoteSha.slice(0,12)||
     args.signal?.aborted)reject();
  const expectedOld=c.expectedLocalSha!;
  const expectedNew=c.expectedRemoteSha!;
  const expectedRevision=c.expectedRemoteRevision!;
  const dirs=await roots(args.testOnly);
  const fetcher=args.fetcher??fetch;
  const stored=await inspectProductionM8Baseline({
    ownerJwt:args.ownerJwt,fetcher,options:args.testOnly?.journalOptions,
  });
  const prior=stored.fingerprints.find(x=>x.slug===c.slug);
  if(!stored.paired||!stored.durableBaselineVerified||
     !prior||prior.sha256!==expectedOld||
     typeof prior.revision!=="string"||!SHA.test(prior.revision))reject();
  const localPath=path.join(dirs.vault,c.slug+".md");
  const original=await readStable(localPath);
  if(sha(original.bytes)!==expectedOld)reject();
  const localBefore=await readObsidianLocalManifest(dirs.vault);
  if(localBefore.unsupportedMarkdownFiles>0||
     localBefore.directoriesNotScanned>0||
     localBefore.fingerprints.find(x=>x.slug===c.slug)?.sha256!==expectedOld)reject();
  const cloud=await fetchVerifiedProductionNoteMarkdown({
    branchId:args.branchId,jwt:args.ownerJwt,slug:c.slug,
    expectedSha256:expectedNew,expectedRevision,
    fetcher,signal:args.signal,
  });
  const incoming=Buffer.from(cloud.markdown,"utf8");
  if(incoming.length<1||incoming.length>MAX||
     sha(incoming)!==expectedNew)reject();
  const localAgain=await readObsidianLocalManifest(dirs.vault);
  if(JSON.stringify(localBefore)!==JSON.stringify(localAgain))reject();
  if(args.signal?.aborted)reject();
  return locked(dirs.privateRoot,async()=>{
    // Refuse ANY previous unresolved receipt, even for another slug.
    if(JSON.stringify(await readdir(dirs.privateRoot))!==
       JSON.stringify([".m8-incoming-new.lock"]))reject();
    const check=await readStable(localPath);
    if(sha(check.bytes)!==expectedOld||
       check.inode!==original.inode||
       check.mtimeMs!==original.mtimeMs||
       check.size!==original.size)reject();
    const fresh=await fetchProductionOwnerRlsFingerprints({
      branchId:args.branchId,jwt:args.ownerJwt,
      fetcher,signal:args.signal,
    });
    if(fresh.fingerprints.find(x=>x.slug===c.slug)?.sha256!==expectedNew||
       fresh.fingerprints.find(x=>x.slug===c.slug)?.revision!==
         expectedRevision)reject();
    const opId="op-"+randomBytes(12).toString("hex");
    if(!OP.test(opId))reject();
    const op=path.join(dirs.privateRoot,opId);
    await mkdir(op,{mode:0o700});
    await safeDirectory(op);
    const backupPath=path.join(op,c.slug+".md.bak");
    const nativeBackupPath=path.join(op,"windows-native-original.md.bak");
    const intentPath=path.join(op,"incoming-intent.json");
    const staged=path.join(dirs.vault,
      ".m8-replace-"+opId+".pending");
    let committed=false,nativeAttempted=false;
    try{
      await durable(backupPath,original.bytes);
      if(sha(await readFile(backupPath))!==expectedOld)reject();
      await durable(intentPath,Buffer.from(JSON.stringify({
        format:"naosledge.m8.production-incoming-replace.v1",
        branch:RELEASE_NEON_BRANCH,
        action:"download-replace",slug:c.slug,
        previousLocalSha256:expectedOld,
        remoteSha256:expectedNew,
        remoteRevision:expectedRevision,
      }),"utf8"));
      await durable(staged,incoming);
      await args.testOnly?.beforeCommitForTest?.();
      if(args.signal?.aborted)reject();
      const last=await readStable(localPath);
      if(sha(last.bytes)!==expectedOld||
         last.inode!==original.inode||
         last.mtimeMs!==original.mtimeMs||
         last.size!==original.size)reject();
      // On real MSI, Win32 FileShare.Read|Delete excludes external editors
      // holding a WRITE handle across the final hash check and ReplaceFileW.
      // OS TEMP on Linux CI can use POSIX atomic rename for synthetic tests.
      if(process.platform==="win32"){
        nativeAttempted=true;
        await windowsNativeReplace(localPath,staged,nativeBackupPath,expectedOld);
        if(sha(await readFile(nativeBackupPath))!==expectedOld)uncertain();
      }else if(args.testOnly){
        await rename(staged,localPath);
      }else reject();
      committed=true;
      await args.testOnly?.afterCommitForTest?.();
      const applied=await readStable(localPath);
      if(sha(applied.bytes)!==expectedNew)uncertain();
      const latest=await fetchVerifiedProductionNoteMarkdown({
        branchId:args.branchId,jwt:args.ownerJwt,slug:c.slug,
        expectedSha256:expectedNew,expectedRevision,
        fetcher,signal:args.signal,
      });
      if(latest.markdown!==cloud.markdown)uncertain();
      const manifest=await readObsidianLocalManifest(dirs.vault);
      if(manifest.fingerprints.find(x=>x.slug===c.slug)?.sha256!==
           expectedNew||
         manifest.unsupportedMarkdownFiles>0||
         manifest.directoriesNotScanned>0)uncertain();
      return {
        slug:c.slug,sha256:expectedNew,revision:expectedRevision,
        originalBackupSha256:expectedOld,backupPath,intentPath,
        localReadbackVerified:true,remoteReadbackVerified:true,
        baselineSaved:false,automaticRetryAllowed:false,
      };
    }catch{
      if(committed||nativeAttempted)uncertain();
      reject();
    }finally{
      // Do not delete the operation record or backup, even on error.
      // Remove only the temporary staged target when possible.
      if(!committed&&!nativeAttempted)await unlink(staged).catch(()=>{});
    }
  });
}
