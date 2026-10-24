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
/** M4 consent only authorizes a new copy in this session's synthetic Incoming. */
export type SyntheticIncomingConsent={
  slug:string;
  choice:"review-download"|"review-missing-local"|"conflict";
  expectedLocalSha:string|null;
  expectedRemoteSha:string;
  expectedRemoteRevision:string;
  confirmation:string;
  expiresAt:number;
};
export type SyntheticIncomingReceipt={
  slug:string;
  incomingFileName:string;
  sha256:string;
  syntheticOnly:true;
  originalUntouched:true;
  baselineUnchanged:true;
  automaticSyncEnabled:false;
  deleteAllowed:false;
};
/** M5: append-only evidence of approved, rechecked SYNTHETIC equality. */
export type SyntheticBaselineCheckpoint={
  id:string;slug:string;sha256:string;remoteRevision:string;
  action:"approved-upload"|"approved-download"|"approved-restore";
  createdAt:string;syntheticOnly:true;deleteAllowed:false;
};
/**
 * M5 read-only recovery inspection. The random-UUID journal has no certified
 * event order or authentication, so this is NEVER permission to restore,
 * auto-import, synchronize, or choose a winner.
 */
export type SyntheticBaselineReloadPreview={
  notes:Array<{
    slug:string;
    checkpointCount:number;
    checkpointId:string|null;
    status:"matches-current-pair"|"ambiguous-history"|
      "memory-baseline-disagrees"|"changed-local"|"changed-remote"|"changed-both";
  }>;
  syntheticOnly:true;
  autoImportAllowed:false;
  writeAllowed:false;
  deleteAllowed:false;
  manualReviewRequired:true;
};
/** Read-only, bounded text comparison of two current SYNTHETIC conflict versions. */
export type SyntheticConflictComparison={
  slug:string;
  localSha:string;remoteSha:string;remoteRevision:string;
  localLineCount:number;remoteLineCount:number;
  rows:Array<{
    localLine:number|null;remoteLine:number|null;
    localText:string|null;remoteText:string|null;identical:boolean;
  }>;
  hiddenRows:number;truncated:boolean;lineEndingOnlyDifference:boolean;
  syntheticOnly:true;writeAllowed:false;deleteAllowed:false;autoMergeAllowed:false;
};
export type DurableSyntheticReceipt={
  slug:string;beforeSha:string|null;afterSha:string;
  backupId:string|null;syntheticOnly:true;automaticSyncEnabled:false;
};
type Remote={bytes:Buffer;revision:number};
type Pending={consent:SyntheticConsent;nonce:string};
type PendingUpload={consent:SyntheticUploadConsent;nonce:string};
type PendingIncoming={consent:SyntheticIncomingConsent;nonce:string};

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
  const incoming=path.join(folder,"incoming");
  const baselineJournal=path.join(folder,"baseline-journal");
  await mkdir(notes,{mode:0o700});
  await mkdir(backups,{mode:0o700});
  await mkdir(locks,{mode:0o700});
  await mkdir(incoming,{mode:0o700});
  await mkdir(baselineJournal,{mode:0o700});

  const remote=new Map<string,Remote>();
  const baseline=new Map<string,SyncFingerprint>();
  const pending=new Map<string,Pending>();
  const pendingUploads=new Map<string,PendingUpload>();
  const pendingIncoming=new Map<string,PendingIncoming>();
  const restorations=new Map<string,{confirmation:string;expectedSha:string;expiresAt:number}>();
  let destroyed=false;
  const active=new Set<string>();

  const ensureActive=async()=>{
    if(destroyed)throw Error("Synthetic workspace is closed");
    await Promise.all([folder,notes,backups,locks,incoming,baselineJournal].map(ensureRealDirectory));
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
  const resetConsent=()=>{pending.clear();pendingUploads.clear();pendingIncoming.clear();restorations.clear();};

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

  /**
   * Scratch-only, append-only M5 checkpoint. No caller-supplied paths, tokens,
   * network writes, deletions or baseline import. An Incoming copy never calls
   * this function: creating a copy is NOT a completed sync.
   */
  async function appendConfirmedBaseline(
    slug:string,expectedSha:string,
    action:SyntheticBaselineCheckpoint["action"],
  ):Promise<void>{
    const before=remoteFp(slug);
    if(!HASH.test(expectedSha)||!before||before.sha256!==expectedSha||
       await localSha(slug)!==expectedSha){
      throw Error("M5 checkpoint refused: both synthetic sides must agree");
    }
    const item:SyntheticBaselineCheckpoint={
      id:randomUUID(),slug,sha256:expectedSha,
      remoteRevision:before.revision!,action,
      createdAt:new Date().toISOString(),syntheticOnly:true,deleteAllowed:false,
    };
    const stage=path.join(baselineJournal,"."+item.id+".stage");
    const final=path.join(baselineJournal,item.id+".json");
    await ensureRealDirectory(baselineJournal);
    try{
      await writeSyncNew(stage,Buffer.from(JSON.stringify(item),"utf8"));
      // After staging, confirm both sides STILL match, including remote revision.
      const now=remoteFp(slug);
      if(!now||now.sha256!==expectedSha||now.revision!==before.revision||
         await localSha(slug)!==expectedSha){
        throw Error("M5 checkpoint refused: source changed during verification");
      }
      await rename(stage,final);
      await syncDirectoryBestEffort(baselineJournal);
    }finally{
      await rm(stage,{force:true}).catch(()=>{});
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
      incomingConsents:SyntheticIncomingConsent[];
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
      const incomingConsents:SyntheticIncomingConsent[]=[];
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
        if(["review-download","review-missing-local","conflict"].includes(decision.choice)&&
           decision.expectedRemoteSha&&decision.expectedRemoteRevision){
          const nonce=randomUUID();
          const incomingConsent:SyntheticIncomingConsent={
            slug:decision.slug,
            choice:decision.choice as SyntheticIncomingConsent["choice"],
            expectedLocalSha:decision.expectedLocalSha,
            expectedRemoteSha:decision.expectedRemoteSha,
            expectedRemoteRevision:decision.expectedRemoteRevision,
            confirmation:"CONFIRM INCOMING "+decision.slug+" "+nonce,
            expiresAt:Date.now()+MAX_MINUTES*60_000,
          };
          pendingIncoming.set(decision.slug,{consent:incomingConsent,nonce});
          incomingConsents.push({...incomingConsent});
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
      return {plan,consents,uploadConsents,incomingConsents};
    },
    /**
     * M5 manual conflict comparison: pure observation of the current scratch
     * pair. Requires fresh M1 fingerprints, never issues consent, resolves a
     * winner, changes the baseline, or accesses a real Vault / Neon.
     * Rows deliberately expose only short snippets; never log them to CI.
     */
    async compareSyntheticConflict(args:{
      slug:string;expectedLocalSha:string;
      expectedRemoteSha:string;expectedRemoteRevision:string;
    }):Promise<SyntheticConflictComparison>{
      if(!args||typeof args!=="object")throw Error("Synthetic conflict preview required");
      const {slug,expectedLocalSha,expectedRemoteSha,expectedRemoteRevision}=args;
      await ensureActive();
      slugValid(slug);
      if(!HASH.test(expectedLocalSha)||!HASH.test(expectedRemoteSha)||
         !/^synthetic-r[1-9][0-9]*$/.test(expectedRemoteRevision)){
        throw Error("Invalid reviewed synthetic conflict fingerprints");
      }
      const source=await stableBytes(notePath(slug));
      const remoteNow=remoteFp(slug);
      if(!source||sha(source)!==expectedLocalSha||
         remoteNow?.sha256!==expectedRemoteSha||
         remoteNow.revision!==expectedRemoteRevision){
        throw Error("Synthetic conflict preview is stale");
      }
      const decision=planObsidianReconciliation({
        local:[{slug,sha256:expectedLocalSha}],
        remote:[remoteNow],
        baseline:baseline.has(slug)?[baseline.get(slug)!]:[],
      }).decisions[0];
      if(decision.choice!=="conflict"){
        throw Error("Only unresolved synthetic conflicts may be compared");
      }
      const remoteBytes=remote.get(slug)!.bytes;
      if(sha(remoteBytes)!==expectedRemoteSha){
        throw Error("Synthetic conflict source changed during inspection");
      }
      const localLines=source.toString("utf8").split(/\r\n|\n|\r/);
      const remoteLines=remoteBytes.toString("utf8").split(/\r\n|\n|\r/);
      let prefix=0;
      while(prefix<localLines.length&&prefix<remoteLines.length&&
            localLines[prefix]===remoteLines[prefix])prefix++;
      let suffix=0;
      while(suffix<localLines.length-prefix&&
            suffix<remoteLines.length-prefix&&
            localLines[localLines.length-1-suffix]===remoteLines[remoteLines.length-1-suffix]){
        suffix++;
      }
      const middleLocal=localLines.length-prefix-suffix;
      const middleRemote=remoteLines.length-prefix-suffix;
      const middle=Math.max(middleLocal,middleRemote);
      const total=prefix+middle+suffix;
      // Show first/last context AND both edges of the changed span. A huge
      // identical prefix must never hide the actual disagreement.
      const chosen=new Set<number>();
      const add=(start:number,end:number)=>{
        for(let i=Math.max(0,start);i<Math.min(end,total);i++)chosen.add(i);
      };
      add(0,4);add(prefix-3,prefix+36);
      add(prefix+middle-36,prefix+middle+3);
      add(total-4,total);
      const positions=[...chosen].sort((a,b)=>a-b);
      let clipped=false;
      const clip=(value:string|null):string|null=>{
        if(value===null)return null;
        const chars=Array.from(value);
        if(chars.length<=160)return value;
        clipped=true;
        return chars.slice(0,160).join("");
      };
      const rows=positions.map(index=>{
        let li:number|null=null,ri:number|null=null;
        if(index<prefix){
          li=index;ri=index;
        }else if(index<prefix+middle){
          const k=index-prefix;
          if(k<middleLocal)li=prefix+k;
          if(k<middleRemote)ri=prefix+k;
        }else{
          const k=index-prefix-middle;
          li=localLines.length-suffix+k;
          ri=remoteLines.length-suffix+k;
        }
        const left=li===null?null:localLines[li];
        const right=ri===null?null:remoteLines[ri];
        return {
          localLine:li===null?null:li+1,
          remoteLine:ri===null?null:ri+1,
          localText:clip(left),remoteText:clip(right),
          identical:left!==null&&right!==null&&left===right,
        };
      });
      // Recheck both versions once more after building the comparison.
      if(await localSha(slug)!==expectedLocalSha||
         remoteFp(slug)?.sha256!==expectedRemoteSha||
         remoteFp(slug)?.revision!==expectedRemoteRevision){
        throw Error("Synthetic conflict changed while rendering preview");
      }
      return {
        slug,localSha:expectedLocalSha,remoteSha:expectedRemoteSha,
        remoteRevision:expectedRemoteRevision,
        localLineCount:localLines.length,remoteLineCount:remoteLines.length,
        rows,hiddenRows:total-positions.length,
        truncated:clipped||positions.length<total,
        lineEndingOnlyDifference:prefix===localLines.length&&
          prefix===remoteLines.length&&expectedLocalSha!==expectedRemoteSha,
        syntheticOnly:true,writeAllowed:false,deleteAllowed:false,autoMergeAllowed:false,
      };
    },
    /**
     * M4 rehearsal: an explicit single-note decision can ONLY create a fresh
     * Incoming copy inside this factory's random synthetic scratch directory.
     * Conflicts are eligible for "keep both", never a local replacement.
     * It does not advance baseline: the owner still needs to reconcile notes.
     */
    async approvedIncomingDownload(args:{
      slug:string;confirmation:string;
      beforeCommitForSyntheticTest?:()=>Promise<void>;
    }):Promise<SyntheticIncomingReceipt>{
      if(!args||typeof args!=="object")throw Error("Synthetic Incoming approval required");
      const {slug,confirmation}=args;
      await ensureActive();slugValid(slug);
      const grant=pendingIncoming.get(slug);
      if(!grant||confirmation!==grant.consent.confirmation||
         Date.now()>grant.consent.expiresAt){
        throw Error("Explicit, unexpired per-note synthetic Incoming approval required");
      }
      pendingIncoming.delete(slug); // consumed even on stale revision or I/O failure
      return await withLock(slug,async()=>{
        const c=grant.consent;
        const unchanged=async()=>{
          const local=await localSha(slug),remoteNow=remoteFp(slug);
          return local===c.expectedLocalSha&&
            remoteNow?.sha256===c.expectedRemoteSha&&
            remoteNow?.revision===c.expectedRemoteRevision;
        };
        if(!await unchanged())throw Error("Incoming preview is stale");
        const remoteData=remote.get(slug);
        if(!remoteData)throw Error("Synthetic Incoming source no longer exists");
        const bytes=Buffer.from(remoteData.bytes);
        if(bytes.byteLength>MAX_BYTES||sha(bytes)!==c.expectedRemoteSha){
          throw Error("Synthetic Incoming content hash mismatch");
        }
        if(args.beforeCommitForSyntheticTest)await args.beforeCommitForSyntheticTest();
        // Independent Incoming folder never points at the notes directory.
        await ensureRealDirectory(incoming);
        if(!await unchanged())throw Error("Incoming source or local note changed before copy");
        const fileName=slug+"--"+randomUUID()+".md";
        const filename=path.join(incoming,fileName);
        let created=false;
        try{
          // Exclusive new-file creation rejects pre-existing files/symlinks.
          const handle=await open(filename,"wx",0o600);
          created=true;
          try{
            await handle.writeFile(bytes);
            await handle.sync();
          }finally{await handle.close();}
          const copied=await stableBytes(filename);
          if(!copied||sha(copied)!==c.expectedRemoteSha){
            throw Error("Incoming copy integrity verification failed");
          }
          if(!await unchanged())throw Error("Incoming source changed during copy");
          await syncDirectoryBestEffort(incoming);
          // Copying does not reconcile versions; require a new review before
          // any further synthetic action, including an older overwrite grant.
          resetConsent();
          return {
            slug,incomingFileName:fileName,sha256:c.expectedRemoteSha,
            syntheticOnly:true,originalUntouched:true,baselineUnchanged:true,
            automaticSyncEnabled:false,deleteAllowed:false,
          };
        }catch(error){
          // A failed copy cannot leave a partial/unreviewed Incoming file.
          // Never remove the name if exclusive open was rejected.
          if(created)await rm(filename,{force:true}).catch(()=>{});
          throw error;
        }
      });
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
        // Both sides must still match before appending a durable scratch receipt.
        // If evidence cannot be written, do not advance the in-memory baseline.
        await appendConfirmedBaseline(slug,after.sha256,"approved-upload");
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
        await appendConfirmedBaseline(slug,c.expectedRemoteSha,"approved-download");
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
          await appendConfirmedBaseline(info.slug,info.beforeSha,"approved-restore");
          baseline.set(info.slug,{slug:info.slug,sha256:info.beforeSha});
        }
        // M5: a local restore with a different/missing remote is NOT a
        // synchronization. Preserve the previous baseline for manual review;
        // never erase it because one side changed or disappeared.
        resetConsent();
        return {
          slug:info.slug,beforeSha:now,afterSha:info.beforeSha,
          backupId:undo.id,syntheticOnly:true,automaticSyncEnabled:false,
        };
      });
    },
    /** Read-only inspection of M5 scratch evidence (never imports/applies it). */
    async listConfirmedSyntheticBaselines():Promise<SyntheticBaselineCheckpoint[]>{
      await ensureActive();
      const names=(await readdir(baselineJournal)).sort();
      const events:SyntheticBaselineCheckpoint[]=[];
      for(const name of names){
        if(!/^[0-9a-f-]{36}\.json$/.test(name)){
          throw Error("Unexpected M5 checkpoint file");
        }
        const bytes=await stableBytes(path.join(baselineJournal,name));
        if(!bytes)throw Error("M5 checkpoint vanished");
        let value:SyntheticBaselineCheckpoint;
        try{value=JSON.parse(bytes.toString("utf8")) as SyntheticBaselineCheckpoint;}
        catch{throw Error("Invalid M5 checkpoint JSON");}
        if(!value||typeof value!=="object"||
           value.id+".json"!==name||!SAFE.test(value.slug)||
           !HASH.test(value.sha256)||
           !/^synthetic-r[1-9][0-9]*$/.test(value.remoteRevision)||
           !["approved-upload","approved-download","approved-restore"].includes(value.action)||
           typeof value.createdAt!=="string"||!Number.isFinite(Date.parse(value.createdAt))||
           value.syntheticOnly!==true||value.deleteAllowed!==false||
           Object.keys(value).sort().join(",")!==
             "action,createdAt,deleteAllowed,id,remoteRevision,sha256,slug,syntheticOnly"){
          throw Error("Invalid M5 checkpoint evidence");
        }
        events.push({...value});
      }
      return events;
    },
    /**
     * M5 dry-run reload validation from persisted scratch journal evidence.
     * Files are intentionally NOT ordered by UUID or timestamp to select a
     * winning revision. Repeated evidence for one note is ambiguous until a
     * future authenticated, ordered journal format is available.
     *
     * This never imports into baseline, creates approvals or modifies notes.
     * A matching pair is merely a candidate for a human to recheck, NOT proof
     * that the journal is authentic or a permit to synchronize.
     */
    async inspectSyntheticBaselineReload(args:{
      beforeFinalJournalRecheckForSyntheticTest?:()=>Promise<void>;
    }={}):Promise<SyntheticBaselineReloadPreview>{
      const events=await this.listConfirmedSyntheticBaselines();
      await ensureActive();
      const grouped=new Map<string,SyntheticBaselineCheckpoint[]>();
      for(const item of events){
        const prior=grouped.get(item.slug)??[];
        prior.push(item);
        grouped.set(item.slug,prior);
      }
      const notes:SyntheticBaselineReloadPreview["notes"]=[];
      const inspectedSources:Array<{
        slug:string;localSha:string|null;remoteSha:string|null;
        remoteRevision:string|null;baselineSha:string|null;
      }>=[];
      for(const [slug,records] of [...grouped.entries()].sort((a,b)=>a[0].localeCompare(b[0],"en"))){
        if(records.length!==1){
          notes.push({
            slug,checkpointCount:records.length,checkpointId:null,
            status:"ambiguous-history",
          });
          continue;
        }
        const checkpoint=records[0];
        const initialMemory=baseline.get(slug)?.sha256??null;
        const initialLocal=await localSha(slug);
        const initialRemote=remoteFp(slug);
        inspectedSources.push({
          slug,localSha:initialLocal,remoteSha:initialRemote?.sha256??null,
          remoteRevision:initialRemote?.revision??null,baselineSha:initialMemory,
        });
        const localMatches=initialLocal===checkpoint.sha256;
        const remoteMatches=initialRemote?.sha256===checkpoint.sha256&&
          initialRemote.revision===checkpoint.remoteRevision;
        let status:SyntheticBaselineReloadPreview["notes"][number]["status"];
        if(initialMemory!==null&&initialMemory!==checkpoint.sha256){
          status="memory-baseline-disagrees";
        }else if(!localMatches&&!remoteMatches){
          status="changed-both";
        }else if(!localMatches){
          status="changed-local";
        }else if(!remoteMatches){
          status="changed-remote";
        }else{
          status="matches-current-pair";
        }
        const nowRemote=remoteFp(slug);
        if(await localSha(slug)!==initialLocal||
           nowRemote?.sha256!==initialRemote?.sha256||
           nowRemote?.revision!==initialRemote?.revision||
           (baseline.get(slug)?.sha256??null)!==initialMemory){
          throw Error("M5 reload source changed during inspection");
        }
        notes.push({slug,checkpointCount:1,checkpointId:checkpoint.id,status});
      }
      // Re-read every validated checkpoint, not only its filename: an
      // existing .json can be replaced without changing the directory listing.
      // Any mid-inspection change invalidates the entire read-only preview.
      await args.beforeFinalJournalRecheckForSyntheticTest?.();
      const latest=await this.listConfirmedSyntheticBaselines();
      if(latest.length!==events.length||
         latest.some((item,index)=>JSON.stringify(item)!==JSON.stringify(events[index]))){
        throw Error("M5 reload journal changed during inspection");
      }
      // The journal may remain stable while a previously inspected note or
      // in-memory baseline changes during the final journal check.
      for(const seen of inspectedSources){
        const currentRemote=remoteFp(seen.slug);
        if(await localSha(seen.slug)!==seen.localSha||
           (currentRemote?.sha256??null)!==seen.remoteSha||
           (currentRemote?.revision??null)!==seen.remoteRevision||
           (baseline.get(seen.slug)?.sha256??null)!==seen.baselineSha){
          throw Error("M5 reload source changed during inspection");
        }
      }
      return {
        notes,syntheticOnly:true,autoImportAllowed:false,
        writeAllowed:false,deleteAllowed:false,manualReviewRequired:true,
      };
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
