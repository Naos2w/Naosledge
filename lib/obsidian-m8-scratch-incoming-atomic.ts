/**
 * M8 P1: isolated scratch-only Production download/write rehearsal.
 *
 * This adapter intentionally CANNOT touch the real Obsidian Vault. Paths
 * must be fresh direct children of OS Temp named "naosledge-m8-vault-test-*".
 * It rechecks the RLS-visible Production revision, then performs a durable
 * local backup and a same-directory staged atomic replacement in scratch.
 *
 * A live Vault executor still requires owner-enrolled M5 journal support,
 * process-level file locking and crash recovery; do not remove the temp
 * restriction merely because these tests pass.
 */
import {createHash,randomBytes} from "node:crypto";
import {lstat,realpath,readFile,mkdtemp,open,rename,link,unlink,rm}
  from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {RELEASE_NEON_BRANCH} from "./neon/production-release.ts";
import {
  fetchProductionOwnerRlsFingerprints,fetchVerifiedProductionNoteMarkdown,
} from "./obsidian-m8-production-inventory-readonly.ts";
import type {AutoSyncCandidate} from "./obsidian-auto-sync-policy.ts";

const SHA=/^[0-9a-f]{64}$/;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROOT=/^naosledge-m8-vault-test-[A-Za-z0-9_-]{6,}$/;
const MAX_BYTES=250_000;
const digest=(data:Buffer|string)=>
  createHash("sha256").update(data).digest("hex");
function stop():never{
  throw Error("M8 isolated Incoming stopped: sources changed or unsafe");
}
function uncertain():never{
  throw Error("M8 isolated Incoming may have committed: inspect backup; no Baseline");
}
function check(signal?:AbortSignal){
  if(signal?.aborted)stop();
}
async function verifiedScratchRoot(root:string):Promise<string>{
  if(typeof root!=="string"||!path.isAbsolute(root))stop();
  const actual=path.resolve(root);
  const parent=path.resolve(tmpdir());
  if(path.dirname(actual).toLowerCase()!==parent.toLowerCase()||
     !ROOT.test(path.basename(actual)))stop();
  const base=await lstat(actual);
  if(!base.isDirectory()||base.isSymbolicLink()||
     path.normalize(await realpath(actual)).toLowerCase()!==
       path.normalize(actual).toLowerCase())stop();
  return actual;
}
async function currentNote(filename:string,expected:string|null):Promise<Buffer|null>{
  let before;
  try{before=await lstat(filename);}
  catch(e){
    if((e as NodeJS.ErrnoException).code==="ENOENT"){
      if(expected!==null)stop();
      return null;
    }
    stop();
  }
  if(expected===null||!before.isFile()||before.isSymbolicLink()||
     before.nlink!==1||before.size>MAX_BYTES||
     path.normalize(await realpath(filename)).toLowerCase()!==
       path.normalize(filename).toLowerCase())stop();
  const content=await readFile(filename);
  const after=await lstat(filename);
  if(content.length!==before.size||after.ino!==before.ino||
     after.mtimeMs!==before.mtimeMs||after.size!==before.size||
     digest(content)!==expected)stop();
  return content;
}
async function durableWrite(filename:string,bytes:Buffer){
  const handle=await open(filename,"wx",0o600);
  try{
    await handle.writeFile(bytes);
    await handle.sync();
  }finally{await handle.close();}
  if(!Buffer.from(await readFile(filename)).equals(bytes))stop();
}
export async function applyVerifiedProductionIncomingToScratch(args:{
  branchId:string;
  ownerJwt:string;
  candidate:AutoSyncCandidate;
  scratchVaultRoot:string;
  /** QA-only explicit consent. Never called by the production M8 watcher. */
  typedConfirmation:string;
  fetcher?:typeof fetch;
  signal?:AbortSignal;
  /** Only called on isolated OS Temp test roots before the final CAS check. */
  beforeCommitForTest?:()=>Promise<void>;
}):Promise<{
  slug:string;sha256:string;revision:string;
  localReadbackVerified:true;
  backupPath:string|null;
  originalBackupSha256:string|null;
  baselineSaved:false;
  remoteWrites:0;
  realVaultTouched:false;
}>{
  const c=args?.candidate?{...args.candidate}:undefined;
  if(!args||args.branchId!==RELEASE_NEON_BRANCH||!c||
     !["download-new","download-replace"].includes(c.action)||
     !["review-missing-local","review-download"].includes(c.choice)||
     c.executable!==false||
     typeof c.slug!=="string"||c.slug.length<3||
     c.slug.length>120||!SLUG.test(c.slug)||
     typeof c.expectedRemoteSha!=="string"||!SHA.test(c.expectedRemoteSha)||
     typeof c.expectedRemoteRevision!=="string"||
     !SHA.test(c.expectedRemoteRevision)||
     (c.action==="download-new")!==(c.expectedLocalSha===null)||
     (c.action==="download-replace")!==(c.choice==="review-download")||
     (c.expectedLocalSha!==null&&
       (typeof c.expectedLocalSha!=="string"||!SHA.test(c.expectedLocalSha)))||
     (args.beforeCommitForTest!==undefined&&typeof args.beforeCommitForTest!=="function")||
     args.typedConfirmation!==
       "TEST M8 SCRATCH "+c.action+" "+c.slug+" "+c.expectedRemoteSha.slice(0,12)){
    stop();
  }
  check(args.signal);
  const root=await verifiedScratchRoot(args.scratchVaultRoot);
  const target=path.join(root,c.slug+".md");
  // Prove the exact reviewed source state before accessing the cloud.
  const before=await currentNote(target,c.expectedLocalSha);
  const fetcher=args.fetcher??fetch;
  const remote=await fetchVerifiedProductionNoteMarkdown({
    branchId:args.branchId,jwt:args.ownerJwt,slug:c.slug,
    expectedSha256:c.expectedRemoteSha,
    expectedRevision:c.expectedRemoteRevision,
    fetcher,signal:args.signal,
  });
  if(Buffer.byteLength(remote.markdown,"utf8")>MAX_BYTES)stop();
  const bytes=Buffer.from(remote.markdown,"utf8");
  if(digest(bytes)!==c.expectedRemoteSha)stop();
  // No writing until the local file is re-read, including inode + mtime.
  const fresh=await currentNote(target,c.expectedLocalSha);
  if((fresh===null)!==(before===null)||
     (fresh!==null&&before!==null&&!fresh.equals(before)))stop();
  const again=await fetchProductionOwnerRlsFingerprints({
    branchId:args.branchId,jwt:args.ownerJwt,fetcher,signal:args.signal,
  });
  const match=again.fingerprints.find(n=>n.slug===c.slug);
  if(!match||match.sha256!==c.expectedRemoteSha||
     match.revision!==c.expectedRemoteRevision)stop();
  check(args.signal);

  // Backup resides outside the scanned note root and remains if an
  // irreversible rename happens before a crash. No automatic cleanup of
  // a potentially needed backup after a commit.
  let backupRoot:string|null=null,backupPath:string|null=null;
  let staged:string|null=null,committed=false;
  try{
    if(before!==null){
      backupRoot=await mkdtemp(path.join(path.resolve(tmpdir()),
        "naosledge-m8-scratch-backup-"));
      backupPath=path.join(backupRoot,c.slug+".md.bak");
      await durableWrite(backupPath,before);
      if(digest(await readFile(backupPath))!==c.expectedLocalSha)stop();
    }
    staged=path.join(root,"."+c.slug+".m8-next-"+
      randomBytes(9).toString("hex")+".md");
    await durableWrite(staged,bytes);
    // Injected fault tests simulate an editor modifying the original
    // after the backup, before the final direct file comparison.
    await args.beforeCommitForTest?.();
    check(args.signal);
    const justBefore=await currentNote(target,c.expectedLocalSha);
    if((justBefore===null)!==(before===null)||
       (justBefore!==null&&before!==null&&!justBefore.equals(before)))stop();
    // An absent destination MUST be created with fail-if-exists semantics.
    // link() will not replace a note created by a competing process.
    if(c.action==="download-new"){
      await link(staged,target);
      committed=true;
      await unlink(staged);
      staged=null;
    }else{
      // Atomic rename is restricted to disposable OS-temp scratch. The live
      // Vault will require stronger cross-process locking before activation.
      await rename(staged,target);
      committed=true;
      staged=null;
    }
    const actual=await currentNote(target,c.expectedRemoteSha);
    if(!actual||!actual.equals(bytes))uncertain();
    const final=await fetchProductionOwnerRlsFingerprints({
      branchId:args.branchId,jwt:args.ownerJwt,fetcher,signal:args.signal,
    });
    const version=final.fingerprints.find(n=>n.slug===c.slug);
    if(!version||version.sha256!==c.expectedRemoteSha||
       version.revision!==c.expectedRemoteRevision)uncertain();
    return {
      slug:c.slug,sha256:c.expectedRemoteSha,
      revision:c.expectedRemoteRevision,
      localReadbackVerified:true,
      backupPath,originalBackupSha256:before?digest(before):null,
      baselineSaved:false,remoteWrites:0,realVaultTouched:false,
    };
  }catch{
    if(committed)uncertain();
    stop();
  }finally{
    if(staged!==null)await unlink(staged).catch(()=>{});
    // Backups intentionally remain if an operation may have modified the
    // destination. In tests they are explicitly cleaned after verifying SHA.
    if(!committed&&backupRoot!==null)await rm(backupRoot,{
      recursive:true,force:true,
    }).catch(()=>{});
  }
  // TypeScript control-flow guard: no completion without verified readback.
  return stop();
}
