/**
 * Persistent-backup + per-note consent HARDENING REHEARSAL.
 *
 * Writes are restricted to a brand-new randomly named OS TEMP scratch
 * workspace created by this factory. There is NO path argument, production
 * adapter, Neon client, real Obsidian Vault access, schedule or deletion API.
 *
 * Before replacing a synthetic note, fsync an independent .bak and .json
 * receipt, then stage/sync a replacement and recheck both versions. Own
 * processes serialize by O_EXCL lock files; external editors require future
 * platform-specific Windows locks and must NOT use this as Production writer.
 */
import {createHash,randomUUID} from "node:crypto";
import {open,mkdir,mkdtemp,lstat,readFile,realpath,readdir,rename,rm,writeFile,unlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {planObsidianReconciliation,type SyncFingerprint,type SyncPlan} from "./obsidian-sync-plan.ts";
import {readObsidianLocalManifest} from "./obsidian-local-manifest.ts";

const PREFIX="naosledge-durable-synthetic-only-";
const SAFE=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HASH=/^[0-9a-f]{64}$/;
const MAX_BYTES=250_000;
const MAX_MINUTES=10;

export type DurableBackupInfo={
  id:string;slug:string;beforeSha:string;afterSha:string;
  createdAt:string;syntheticOnly:true;
};
export type SyntheticConsent={
  slug:string;choice:"review-download"|"review-missing-local";
  expectedLocalSha:string|null;
  expectedRemoteSha:string;
  expectedRemoteRevision:string;
  confirmation:string;
  expiresAt:number;
};
/** M3 synthetic-only approval: cannot be exchanged for a Neon write token. */
export type SyntheticUploadConsent={
  slug:string;choice:"review-upload"|"review-missing-remote";
  expectedLocalSha:string;
  expectedRemoteSha:string|null;
  expectedRemoteRevision:string|null;
  confirmation:string;
  expiresAt:number;
};
export type SyntheticUploadReceipt={
  slug:string;
  priorRemoteSha:string|null;
  afterSha:string;
  remoteRevision:string;
  syntheticOnly:true;
  automaticSyncEnabled:false;
  deleteAllowed:false;
};
export type DurableSyntheticReceipt={
  slug:string;beforeSha:string|null;afterSha:string;
  backupId:string|null;syntheticOnly:true;automaticSyncEnabled:false;
};
type Remote={bytes:Buffer;revision:number};
type Pending={consent:SyntheticConsent;nonce:string};
type PendingUpload={consent:SyntheticUploadConsent;nonce:string};

function slugValid(slug:string):void{
  if(typeof slug!=="string"||slug.length<3||slug.length>120||!SAFE.test(slug)){
    throw Error("Unsafe synthetic slug");
  }
}
function utf8(value:string):Buffer{
  if(typeof value!=="string")throw Error("Synthetic text must be a string");
  const bytes=Buffer.from(value,"utf8");
  if(bytes.length>MAX_BYTES)throw Error("Synthetic Markdown exceeds 250KB");
  return bytes;
}
function sha(bytes:Uint8Array):string{
  return createHash("sha256").update(bytes).digest("hex");
}
function isMissing(error:unknown):boolean{
  return (error as NodeJS.ErrnoException)?.code==="ENOENT";
}
async function ensureRealDirectory(dirname:string){
  const stat=await lstat(dirname);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error("Unsafe scratch directory");
  const resolved=await realpath(dirname);
  if(path.normalize(resolved).toLowerCase()!==path.normalize(dirname).toLowerCase()){
    throw Error("Scratch directory is redirected");
  }
}
async function stableBytes(filename:string):Promise<Buffer|null>{
  try{
    const before=await lstat(filename);
    if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
       before.size>MAX_BYTES)throw Error("Unsafe or oversized synthetic note");
    const contents=await readFile(filename);
    const after=await lstat(filename);
    if(after.ino!==before.ino||after.mtimeMs!==before.mtimeMs||
       after.size!==before.size||contents.byteLength>MAX_BYTES){
      throw Error("Synthetic note changed while reading");
    }
    return contents;
  }catch(error){
    if(isMissing(error))return null;
    throw error;
  }
}
async function writeSyncNew(filename:string,bytes:Buffer):Promise<void>{
  const handle=await open(filename,"wx",0o600);
  try{
    await handle.writeFile(bytes);
    await handle.sync();
  }finally{
    await handle.close();
  }
}
async function syncDirectoryBestEffort(dirname:string):Promise<void>{
  // File fsync is mandatory. fsync of a directory varies on Windows and
  // may be denied; the installed FS may not provide power-failure durability.
  try{
    const directory=await open(dirname,"r");
    try{await directory.sync();}finally{await directory.close();}
  }catch(error){
    if(!["EPERM","EACCES","EINVAL","EISDIR"].includes(
      (error as NodeJS.ErrnoException).code??""
    ))throw error;
  }
}

export async function createDurableSyntheticObsidianWorkspace(){
  const folder=await mkdtemp(path.join(tmpdir(),PREFIX));
  const resolved=path.resolve(folder);
  if(path.dirname(resolved)!==path.resolve(tmpdir())||
     !path.basename(resolved).startsWith(PREFIX)){
    throw Error("Invalid isolated scratch directory");
  }
  const notes=path.join(folder,"notes");
  const backups=path.join(folder,"backups");
  const locks=path.join(folder,"locks");
  await mkdir(notes,{mode:0o700});
  await mkdir(backups,{mode:0o700});
  await mkdir(locks,{mode:0o700});

  const remote=new Map<string,Remote>();
  const baseline=new Map<string,SyncFingerprint>();
  const pending=new Map<string,Pending>();
  const pendingUploads=new Map<string,PendingUpload>();
  const restorations=new Map<string,{confirmation:string;expectedSha:string;expiresAt:number}>();
  let destroyed=false;
  const active=new Set<string>();

  const ensureActive=async()=>{
    if(destroyed)throw Error("Synthetic workspace is closed");
    await Promise.all([folder,notes,backups,locks].map(ensureRealDirectory));
  };
  const notePath=(slug:string)=>{
    slugValid(slug);
    return path.join(notes,slug+".md");
  };
  const remoteFp=(slug:string):SyncFingerprint|null=>{
    const item=remote.get(slug);
    return item?{slug,sha256:sha(item.bytes),revision:"synthetic-r"+item.revision}:null;
  };
  const localSha=async(slug:string):Promise<string|null>=>{
    const data=await stableBytes(notePath(slug));
    return data===null?null:sha(data);
  };
  const resetConsent=()=>{pending.clear();pendingUploads.clear();restorations.clear();};

  async function withLock<T>(slug:string,run:()=>Promise<T>):Promise<T>{
    await ensureActive();slugValid(slug);
    if(active.has(slug))throw Error("Synthetic note is already being changed");
    active.add(slug);
    const location=path.join(locks,slug+".lock");
    let lock;
    try{
      lock=await open(location,"wx",0o600);
      await lock.writeFile("sandbox-only");
      await lock.sync();
      return await run();
    }finally{
      if(lock){
        await lock.close();
        await unlink(location).catch(()=>{});
      }
      active.delete(slug);
    }
  }

  async function saveBackup(slug:string,before:Buffer,afterSha:string):Promise<DurableBackupInfo>{
    if(!HASH.test(afterSha))throw Error("Invalid future synthetic content hash");
    const id=randomUUID();
    const originalHash=sha(before);
    const record:DurableBackupInfo={
      id,slug,beforeSha:originalHash,afterSha,
      createdAt:new Date().toISOString(),syntheticOnly:true,
    };
    // Write and sync separate backup + metadata *before* replacing the note.
    await writeSyncNew(path.join(backups,id+".bak"),before);
    await writeSyncNew(path.join(backups,id+".json"),
      Buffer.from(JSON.stringify(record),"utf8"));
    await syncDirectoryBestEffort(backups);
    return record;
  }

  async function loadBackup(id:string):Promise<{info:DurableBackupInfo;data:Buffer}>{
    if(typeof id!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)){
      throw Error("Invalid scratch backup identifier");
    }
    const meta=await stableBytes(path.join(backups,id+".json"));
    const data=await stableBytes(path.join(backups,id+".bak"));
    if(!meta||!data)throw Error("Persistent scratch backup is incomplete");
    let info:DurableBackupInfo;
    try{info=JSON.parse(meta.toString("utf8")) as DurableBackupInfo;}
    catch{throw Error("Persistent scratch backup metadata invalid");}
    if(!info||info.id!==id||info.syntheticOnly!==true||
       typeof info.slug!=="string"||!SAFE.test(info.slug)||
       typeof info.beforeSha!=="string"||!HASH.test(info.beforeSha)||
       typeof info.afterSha!=="string"||!HASH.test(info.afterSha)||
       sha(data)!==info.beforeSha){
      throw Error("Persistent scratch backup integrity mismatch");
    }
    return {info,data};
  }

  async function replaceStaged(
    slug:string,body:Buffer,expectedLocalSha:string,
    hook?:()=>Promise<void>,
    recheckRemote?:()=>void,
  ):Promise<void>{
    const staged=path.join(notes,".staged-"+randomUUID());
    await writeSyncNew(staged,body);
    try{
      if(hook)await hook();
      if(recheckRemote)recheckRemote();
      if(await localSha(slug)!==expectedLocalSha){
        throw Error("Synthetic note changed after backup but before replacement");
      }
      // Scratch-only, same-FS rename: real Obsidian needs mandatory Windows
      // file-lock / compare-and-swap integration before reuse.
      await rename(staged,notePath(slug));
      await syncDirectoryBestEffort(notes);
    }finally{
      await rm(staged,{force:true}).catch(()=>{});
    }
  }

  return {
    syntheticWorkspacePath:folder,
    async seedLocal(slug:string,body:string){
      await ensureActive();
      await writeSyncNew(notePath(slug),utf8(body));
      resetConsent();
    },
    async seedRemote(slug:string,body:string){
      await ensureActive();slugValid(slug);
      if(remote.has(slug))throw Error("Synthetic remote already contains slug");
      remote.set(slug,{bytes:utf8(body),revision:1});
      resetConsent();
    },
    async mutateRemote(slug:string,body:string){
      await ensureActive();slugValid(slug);
      const prev=remote.get(slug);
      if(!prev)throw Error("Synthetic remote note absent");
      remote.set(slug,{bytes:utf8(body),revision:prev.revision+1});
      // Do not clear preview: stale-remote detection must reject apply.
    },
    async setBaseline(value:SyncFingerprint[]){
      await ensureActive();
      planObsidianReconciliation({baseline:value,local:[],remote:[]});
      baseline.clear();
      for(const item of value)baseline.set(item.slug,{...item});
      resetConsent();
    },
    async preview():Promise<{
      plan:SyncPlan;
      consents:SyntheticConsent[];
      uploadConsents:SyntheticUploadConsent[];
    }>{
      await ensureActive();
      const snapshot=await readObsidianLocalManifest(notes);
      if(snapshot.unsupportedMarkdownFiles||snapshot.otherFiles||snapshot.directoriesNotScanned){
        throw Error("Synthetic note folder contains unrecognized files or directories");
      }
      const plan=planObsidianReconciliation({
        local:snapshot.fingerprints,
        remote:[...remote.keys()].sort().map(slug=>remoteFp(slug)!),
        baseline:[...baseline.values()],
      });
      resetConsent();
      const consents:SyntheticConsent[]=[];
      const uploadConsents:SyntheticUploadConsent[]=[];
      for(const decision of plan.decisions){
        if(decision.choice==="review-upload"||decision.choice==="review-missing-remote"){
          if(!decision.expectedLocalSha)continue;
          if(decision.choice==="review-upload"&&
             (!decision.expectedRemoteSha||!decision.expectedRemoteRevision))continue;
          const nonce=randomUUID();
          const consent:SyntheticUploadConsent={
            slug:decision.slug,
            choice:decision.choice,
            expectedLocalSha:decision.expectedLocalSha,
            expectedRemoteSha:decision.expectedRemoteSha,
            expectedRemoteRevision:decision.expectedRemoteRevision,
            confirmation:"CONFIRM UPLOAD "+decision.slug+" "+nonce,
            expiresAt:Date.now()+MAX_MINUTES*60_000,
          };
          pendingUploads.set(decision.slug,{consent,nonce});
          uploadConsents.push({...consent});
        }
        if(decision.choice!=="review-download"&&decision.choice!=="review-missing-local")continue;
        if(!decision.expectedRemoteSha||!decision.expectedRemoteRevision)continue;
        const nonce=randomUUID();
        const confirmation="CONFIRM DOWNLOAD "+decision.slug+" "+nonce;
        const consent:SyntheticConsent={
          slug:decision.slug,
          choice:decision.choice,
          expectedLocalSha:decision.expectedLocalSha,
          expectedRemoteSha:decision.expectedRemoteSha,
          expectedRemoteRevision:decision.expectedRemoteRevision,
          confirmation,expiresAt:Date.now()+MAX_MINUTES*60_000,
        };
        pending.set(decision.slug,{consent,nonce});
        consents.push({...consent});
      }
      return {plan,consents,uploadConsents};
    },
    /**
     * M3 upload rehearsal: source is only a scratch Markdown note; destination
     * is only the in-memory synthetic remote Map. Neither API can access a real
     * Obsidian Vault or Neon, and no remote HTTP method is exposed.
     */
    async approvedUpload(args:{
      slug:string;confirmation:string;
      beforeCommitForSyntheticTest?:()=>Promise<void>;
    }):Promise<SyntheticUploadReceipt>{
      if(!args||typeof args!=="object")throw Error("Synthetic upload approval required");
      const {slug,confirmation}=args;
      await ensureActive();slugValid(slug);
      const grant=pendingUploads.get(slug);
      if(!grant||confirmation!==grant.consent.confirmation||
         Date.now()>grant.consent.expiresAt){
        throw Error("Explicit, unexpired per-note synthetic upload approval required");
      }
      // Consent is single-use even when a competing edit aborts the operation.
      pendingUploads.delete(slug);
      return await withLock(slug,async()=>{
        const c=grant.consent;
        const currentLocal=await localSha(slug);
        const currentRemote=remoteFp(slug);
        if(currentLocal!==c.expectedLocalSha||
           (currentRemote?.sha256??null)!==c.expectedRemoteSha||
           (currentRemote?.revision??null)!==c.expectedRemoteRevision){
          throw Error("Preview is stale; local or synthetic remote was modified");
        }
        const bytes=await stableBytes(notePath(slug));
        if(!bytes||sha(bytes)!==c.expectedLocalSha){
          throw Error("Synthetic upload source differs from reviewed fingerprint");
        }
        if(args.beforeCommitForSyntheticTest)await args.beforeCommitForSyntheticTest();
        // Recheck both sides immediately before the atomic in-memory commit.
        // Hash + revision protects against remote ABA/version-only changes.
        const latestLocal=await localSha(slug);
        const latestRemote=remoteFp(slug);
        if(latestLocal!==c.expectedLocalSha||
           (latestRemote?.sha256??null)!==c.expectedRemoteSha||
           (latestRemote?.revision??null)!==c.expectedRemoteRevision){
          throw Error("Synthetic source or remote changed before upload commit");
        }
        const before=remote.get(slug);
        remote.set(slug,{bytes:Buffer.from(bytes),revision:(before?.revision??0)+1});
        const after=remoteFp(slug)!;
        if(after.sha256!==c.expectedLocalSha){
          throw Error("Synthetic upload did not reproduce the approved source");
        }
        // Baseline advances only after an approved upload is confirmed equal.
        baseline.set(slug,{slug,sha256:after.sha256});
        resetConsent();
        return {
          slug,priorRemoteSha:c.expectedRemoteSha,afterSha:after.sha256,
          remoteRevision:after.revision!,
          syntheticOnly:true,automaticSyncEnabled:false,deleteAllowed:false,
        };
      });
    },
    async approvedDownload(args:{
      slug:string;confirmation:string;
      beforeCommitForSyntheticTest?:()=>Promise<void>;
    }):Promise<DurableSyntheticReceipt>{
      const {slug,confirmation}=args;
      await ensureActive();slugValid(slug);
      const current=pending.get(slug);
      if(!current||confirmation!==current.consent.confirmation||
         Date.now()>current.consent.expiresAt){
        throw Error("Explicit, unexpired per-note synthetic approval required");
      }
      // Single-use consent must be consumed even if the operation fails.
      pending.delete(slug);
      return await withLock(slug,async()=>{
        const c=current.consent;
        const l=await localSha(slug),r=remoteFp(slug);
        if(l!==c.expectedLocalSha||r?.sha256!==c.expectedRemoteSha||
           r?.revision!==c.expectedRemoteRevision){
          throw Error("Preview is stale; local or synthetic remote was modified");
        }
        const bytes=remote.get(slug)!.bytes;
        if(sha(bytes)!==c.expectedRemoteSha){
          throw Error("Synthetic remote content hash mismatch");
        }
        const checkSource=()=>{
          const latest=remoteFp(slug);
          if(latest?.sha256!==c.expectedRemoteSha||
             latest?.revision!==c.expectedRemoteRevision){
            throw Error("Synthetic remote changed since per-note approval");
          }
        };
        let backup:DurableBackupInfo|null=null;
        if(l===null){
          // Must never overwrite an existing user note accidentally.
          if(args.beforeCommitForSyntheticTest)await args.beforeCommitForSyntheticTest();
          checkSource();
          await writeSyncNew(notePath(slug),Buffer.from(bytes));
          await syncDirectoryBestEffort(notes);
        }else{
          const previous=await stableBytes(notePath(slug));
          if(!previous||sha(previous)!==l)throw Error("Synthetic local note altered before backup");
          backup=await saveBackup(slug,previous,sha(bytes));
          const fresh=remoteFp(slug);
          if(fresh?.sha256!==c.expectedRemoteSha||fresh?.revision!==c.expectedRemoteRevision){
            throw Error("Synthetic remote changed after backup");
          }
          await replaceStaged(slug,bytes,l,args.beforeCommitForSyntheticTest,checkSource);
        }
        baseline.set(slug,{slug,sha256:c.expectedRemoteSha});
        resetConsent();
        return {
          slug,beforeSha:l,afterSha:c.expectedRemoteSha,
          backupId:backup?.id??null,syntheticOnly:true,automaticSyncEnabled:false,
        };
      });
    },
    async prepareRestore(id:string){
      await ensureActive();
      const {info}=await loadBackup(id);
      const current=await localSha(info.slug);
      if(current!==info.afterSha){
        throw Error("Restoration refused: the current synthetic note is no longer the post-write version");
      }
      const confirmation="CONFIRM RESTORE "+info.slug+" "+id+" "+randomUUID();
      const expiresAt=Date.now()+MAX_MINUTES*60_000;
      restorations.set(id,{confirmation,expectedSha:current,expiresAt});
      return {slug:info.slug,id,confirmation,expectedCurrentSha:current,expiresAt};
    },
    async approvedRestore(args:{
      id:string;confirmation:string;
      beforeCommitForSyntheticTest?:()=>Promise<void>;
    }):Promise<DurableSyntheticReceipt>{
      await ensureActive();
      const {info,data}=await loadBackup(args.id);
      const grant=restorations.get(args.id);
      if(!grant||grant.confirmation!==args.confirmation||
         grant.expiresAt<Date.now()){
        throw Error("Fresh manual restore approval required");
      }
      restorations.delete(args.id);
      return await withLock(info.slug,async()=>{
        const now=await localSha(info.slug);
        if(now!==info.afterSha||now!==grant.expectedSha){
          throw Error("Restoration refused: the synthetic note changed since the backup");
        }
        const existing=await stableBytes(notePath(info.slug));
        if(!existing||sha(existing)!==info.afterSha){
          throw Error("Restoration source content no longer matches post-write revision");
        }
        // Restore is also reversible: store a new, independent backup of
        // the current content before writing the previous content.
        const undo=await saveBackup(info.slug,existing,info.beforeSha);
        await replaceStaged(info.slug,data,now,args.beforeCommitForSyntheticTest);
        const remoteNow=remoteFp(info.slug);
        if(remoteNow&&remoteNow.sha256===info.beforeSha){
          baseline.set(info.slug,{slug:info.slug,sha256:info.beforeSha});
        }else{
          baseline.delete(info.slug);
        }
        resetConsent();
        return {
          slug:info.slug,beforeSha:now,afterSha:info.beforeSha,
          backupId:undo.id,syntheticOnly:true,automaticSyncEnabled:false,
        };
      });
    },
    async listDurableBackups():Promise<DurableBackupInfo[]>{
      await ensureActive();
      const names=(await readdir(backups)).filter(x=>x.endsWith(".json"));
      const all:DurableBackupInfo[]=[];
      for(const name of names)all.push((await loadBackup(name.slice(0,-5))).info);
      return all.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
    },
    async readLocalForSyntheticTest(slug:string){
      await ensureActive();
      const body=await stableBytes(notePath(slug));
      return body?.toString("utf8")??null;
    },
    async readRemoteForSyntheticTest(slug:string){
      await ensureActive();slugValid(slug);
      return remote.get(slug)?.bytes.toString("utf8")??null;
    },
    async readBackupForSyntheticTest(id:string){
      await ensureActive();
      return (await loadBackup(id)).data.toString("utf8");
    },
    async destroyScratch(){
      if(destroyed)return;
      destroyed=true;
      if(path.dirname(resolved)!==path.resolve(tmpdir())||
         !path.basename(resolved).startsWith(PREFIX)){
        throw Error("Refusing cleanup outside the synthetic scratch area");
      }
      await rm(resolved,{recursive:true,force:true});
    },
  };
}
