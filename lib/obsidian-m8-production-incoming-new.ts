/**
 * M8 P2 approved Production Incoming: CREATE-ONLY note in a pinned MSI Vault.
 *
 * This is NOT wired to the Windows watcher. Even when M5 is paired, this API
 * additionally requires a per-note human approval. Existing files are NEVER
 * replaced. A future overwrite adapter needs OS-level cross-process locking.
 *
 * Durable intent is stored outside the scanned Vault BEFORE the first write.
 * If a crash leaves an intent/lock, further Incoming is blocked until
 * separately reviewed. No automatic rollback or Baseline update here.
 */
import {createHash,randomBytes} from "node:crypto";
import {hostname,homedir,tmpdir} from "node:os";
import {lstat,mkdir,open,readFile,realpath,readdir,link,unlink}
  from "node:fs/promises";
import path from "node:path";
import {RELEASE_NEON_BRANCH} from "./neon/production-release.ts";
import {fetchVerifiedProductionNoteMarkdown}
  from "./obsidian-m8-production-inventory-readonly.ts";
import {inspectProductionM8Baseline,
  type ProductionM8JournalOptions}
  from "./obsidian-m8-production-baseline-journal.ts";
import {APPROVED_MSI_VAULT,verifyMsiVaultRegistration}
  from "./obsidian-m4-local-apply.ts";
import {readObsidianLocalManifest}
  from "./obsidian-local-manifest.ts";
import type {AutoSyncCandidate} from "./obsidian-auto-sync-policy.ts";

const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA=/^[a-f0-9]{64}$/;
const VAULT_TEST=/^naosledge-m8-vault-test-[a-zA-Z0-9_-]{6,}$/;
const PRIV_TEST=/^naosledge-m8-incoming-test-[a-zA-Z0-9_-]{6,}$/;
const INTENT_FORMAT="naosledge.m8.production-incoming-new.v1";
const MAX_MD_BYTES=250_000;
const hash=(v:string|Buffer)=>createHash("sha256").update(v).digest("hex");
function refuse():never{
  throw Error("M8 Production Incoming stopped: reviewed create-only state required");
}
function uncertain():never{
  throw Error("M8 Production Incoming uncertain: manual recovery required; no M5 checkpoint");
}
function checkSignal(signal?:AbortSignal){
  if(signal?.aborted)refuse();
}
async function safeDir(dir:string):Promise<void>{
  const st=await lstat(dir);
  if(!st.isDirectory()||st.isSymbolicLink()||
     path.normalize(await realpath(dir)).toLowerCase()!==
       path.normalize(dir).toLowerCase())refuse();
}
function osTempChild(dir:string,pattern:RegExp):boolean{
  return path.isAbsolute(dir)&&
    path.dirname(path.resolve(dir)).toLowerCase()===
      path.resolve(tmpdir()).toLowerCase()&&
    pattern.test(path.basename(dir));
}
async function roots(test?:{
  vaultRoot:string;
  privateRoot:string;
  journalOptions:ProductionM8JournalOptions;
}):Promise<{vault:string;privateRoot:string}>{
  if(test!==undefined){
    if(!test||!osTempChild(test.vaultRoot,VAULT_TEST)||
       !osTempChild(test.privateRoot,PRIV_TEST)||
       !test.journalOptions?.testRoot||
       !test.journalOptions?.testProtector||
       !test.journalOptions?.testReadLocal)refuse();
    await safeDir(test.vaultRoot);
    await safeDir(test.privateRoot);
    return {vault:path.resolve(test.vaultRoot),
      privateRoot:path.resolve(test.privateRoot)};
  }
  if(process.platform!=="win32"||hostname().trim().toUpperCase()!=="MSI")refuse();
  await verifyMsiVaultRegistration();
  await safeDir(APPROVED_MSI_VAULT);
  const base=process.env.LOCALAPPDATA||
    path.join(homedir(),"AppData","Local");
  if(!path.isAbsolute(base))refuse();
  await safeDir(base);
  const parent=path.join(base,"Naosledge");
  const privateRoot=path.join(parent,"m8-production-incoming");
  for(const folder of [parent,privateRoot]){
    try{await mkdir(folder,{mode:0o700});}
    catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")refuse();}
    await safeDir(folder);
  }
  return {vault:APPROVED_MSI_VAULT,privateRoot};
}
async function ensureMissing(filename:string){
  try{await lstat(filename);refuse();}
  catch(e){
    if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;
  }
}
async function durableFile(filename:string,data:Buffer){
  const h=await open(filename,"wx",0o600);
  try{await h.writeFile(data);await h.sync();}
  finally{await h.close();}
  const back=await readFile(filename);
  if(!back.equals(data))refuse();
}
async function withExclusiveRoot<T>(root:string,work:()=>Promise<T>):Promise<T>{
  const lock=path.join(root,".m8-incoming-new.lock");
  let h:Awaited<ReturnType<typeof open>>;
  try{h=await open(lock,"wx",0o600);}catch{refuse();}
  const st=await h.stat();
  try{
    await h.writeFile("m8-production-incoming-new-single-writer");
    await h.sync();
    return await work();
  }finally{
    await h.close();
    const current=await lstat(lock).catch(()=>refuse());
    if(!current.isFile()||current.isSymbolicLink()||
       current.nlink!==1||current.ino!==st.ino)refuse();
    await unlink(lock);
  }
}
export async function downloadProductionNewNoteOnce(args:{
  branchId:string;
  ownerJwt:string;
  candidate:AutoSyncCandidate;
  typedConfirmation:string;
  fetcher?:typeof fetch;
  signal?:AbortSignal;
  /** Only permitted when BOTH directories are fresh direct OS Temp children. */
  testOnly?:{
    vaultRoot:string;
    privateRoot:string;
    journalOptions:ProductionM8JournalOptions;
    beforeCommitForTest?:()=>Promise<void>;
  };
}):Promise<{
  slug:string;sha256:string;revision:string;
  localReadbackVerified:true;
  remoteReadbackVerified:true;
  originalBackupSha256:null;
  baselineSaved:false;
  automaticRetryAllowed:false;
  intentPath:string;
}>{
  const c=args?.candidate?{...args.candidate}:undefined;
  if(!args||args.branchId!==RELEASE_NEON_BRANCH||!c||
     c.action!=="download-new"||c.choice!=="review-missing-local"||
     c.executable!==false||c.requiresFreshTwoSidedRead!==true||
     c.automaticDeletionAllowed!==false||
     typeof c.slug!=="string"||!SLUG.test(c.slug)||
     c.slug.length<3||c.slug.length>120||
     c.expectedLocalSha!==null||
     typeof c.expectedRemoteSha!=="string"||!SHA.test(c.expectedRemoteSha)||
     typeof c.expectedRemoteRevision!=="string"||
     !SHA.test(c.expectedRemoteRevision)||
     args.typedConfirmation!==
       "APPROVE M8 PRODUCTION DOWNLOAD-NEW "+c.slug+" "+
       c.expectedRemoteSha.slice(0,12)||
     (args.testOnly?.beforeCommitForTest!==undefined&&
       typeof args.testOnly.beforeCommitForTest!=="function"))refuse();
  const approvedRevision:string=c.expectedRemoteRevision!;
  const approvedSha256:string=c.expectedRemoteSha!;
  checkSignal(args.signal);
  const location=await roots(args.testOnly);
  const fetcher=args.fetcher??fetch;
  // This is only a subsequent new cloud note after initial approved pairing.
  // Missing / stale / cross-Owner signed M5 rejects prior to local writes.
  const paired=await inspectProductionM8Baseline({
    ownerJwt:args.ownerJwt,fetcher,options:args.testOnly?.journalOptions,
  });
  if(!paired.paired||!paired.durableBaselineVerified||
     paired.fingerprints.some(x=>x.slug===c.slug))refuse();
  const target=path.join(location.vault,c.slug+".md");
  await ensureMissing(target);
  const coverage=await readObsidianLocalManifest(location.vault);
  if(coverage.unsupportedMarkdownFiles>0||coverage.directoriesNotScanned>0||
     coverage.fingerprints.some(x=>x.slug===c.slug))refuse();
  const remote=await fetchVerifiedProductionNoteMarkdown({
    branchId:args.branchId,jwt:args.ownerJwt,slug:c.slug,
    expectedSha256:c.expectedRemoteSha,
    expectedRevision:c.expectedRemoteRevision,
    fetcher,signal:args.signal,
  });
  const bytes=Buffer.from(remote.markdown,"utf8");
  if(bytes.length<1||bytes.length>MAX_MD_BYTES||
     hash(bytes)!==c.expectedRemoteSha)refuse();
  await ensureMissing(target);
  const newer=await readObsidianLocalManifest(location.vault);
  if(JSON.stringify(newer)!==JSON.stringify(coverage))refuse();
  checkSignal(args.signal);
  return withExclusiveRoot(location.privateRoot,async()=>{
    // No pending operations may be forgotten. A completed intent is also
    // preserved until an independent M5 checkpoint and explicit cleanup.
    const entries=await readdir(location.privateRoot);
    if(entries.some(x=>x!==".m8-incoming-new.lock"))refuse();
    await ensureMissing(target);
    const op=path.join(location.privateRoot,"op-"+
      randomBytes(12).toString("hex"));
    await mkdir(op,{mode:0o700});
    await safeDir(op);
    const intentPath=path.join(op,"incoming-intent.json");
    const intent=Buffer.from(JSON.stringify({
      format:INTENT_FORMAT,branch:RELEASE_NEON_BRANCH,
      action:"download-new",slug:c.slug,
      previousLocalSha256:null,
      remoteSha256:c.expectedRemoteSha,
      remoteRevision:approvedRevision,
    }),"utf8");
    await durableFile(intentPath,intent);
    const staging=path.join(location.vault,
      ".m8-stage-"+randomBytes(12).toString("hex")+".pending");
    let committed=false;
    try{
      await durableFile(staging,bytes);
      await args.testOnly?.beforeCommitForTest?.();
      checkSignal(args.signal);
      await ensureMissing(target);
      // Atomic fail-if-exists; a competing file is NEVER overwritten.
      await link(staging,target);
      committed=true;
      await unlink(staging);
      const stat=await lstat(target);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
         hash(await readFile(target))!==c.expectedRemoteSha)uncertain();
      const confirmed=await fetchVerifiedProductionNoteMarkdown({
        branchId:args.branchId,jwt:args.ownerJwt,slug:c.slug,
        expectedSha256:approvedSha256,
        expectedRevision:approvedRevision,
        fetcher,signal:args.signal,
      });
      if(confirmed.markdown!==remote.markdown)uncertain();
      const local=await readObsidianLocalManifest(location.vault);
      const note=local.fingerprints.find(x=>x.slug===c.slug);
      if(!note||note.sha256!==c.expectedRemoteSha||
         local.directoriesNotScanned>0||local.unsupportedMarkdownFiles>0)uncertain();
      return {
        slug:c.slug,sha256:c.expectedRemoteSha,
        revision:approvedRevision,
        localReadbackVerified:true,remoteReadbackVerified:true,
        originalBackupSha256:null,baselineSaved:false,
        automaticRetryAllowed:false,intentPath,
      };
    }catch{
      if(committed)uncertain();
      refuse();
    }finally{
      // After a non-commit, discard ONLY the staging file. A durable intent
      // remains for explicit recovery, including crashes after link().
      if(!committed)await unlink(staging).catch(()=>{});
    }
  });
}
