/**
 * Manual Obsidian transfer rehearsal in ISOLATED SYNTHETIC STORAGE ONLY.
 *
 * Deliberate boundary: no Neon HTTP client, no personal Vault path input,
 * no credentials, scheduled jobs or production write methods. The only
 * writable folder is a fresh mkdtemp within the operating-system temp dir.
 *
 * This is a rehearsal for future authenticated adapters, NOT an actual sync.
 */
import {createHash,randomUUID} from "node:crypto";
import {lstat,mkdir,mkdtemp,readFile,readdir,rename,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {readObsidianLocalManifest} from "./obsidian-local-manifest.ts";
import {planObsidianReconciliation,type SyncFingerprint,type SyncPlan} from "./obsidian-sync-plan.ts";

const SAFE_SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_BYTES=250_000;
const TEMP_PREFIX="naosledge-obsidian-sandbox-only-";

type ManualDirection="upload"|"download";
export type SandboxApproval={
  slug:string;
  direction:ManualDirection;
  confirmation:string;
};
export type SyntheticTransferReceipt={
  slug:string;
  direction:ManualDirection;
  sha256:string;
  sandboxOnly:true;
  backedUpExistingLocal:boolean;
  automaticSyncEnabled:false;
};

function validSlug(slug:string):void{
  if(typeof slug!=="string"||slug.length<3||slug.length>120||!SAFE_SLUG.test(slug)){
    throw new Error("Unsafe or unsupported Markdown slug");
  }
}
function bytesFor(body:string):Buffer{
  if(typeof body!=="string")throw new Error("Synthetic note must be text");
  const bytes=Buffer.from(body,"utf8");
  if(bytes.byteLength>MAX_BYTES)throw new Error("Synthetic Markdown exceeds sandbox limit");
  return bytes;
}
function digest(bytes:Uint8Array):string{
  return createHash("sha256").update(bytes).digest("hex");
}

type RemoteNote={bytes:Buffer;revision:number};

/**
 * Do not export a "production" constructor. Consumers can only obtain a
 * sandbox session whose local path is created by this function in OS temp.
 */
export async function createObsidianSandbox():Promise<{
  sandboxDirectory:string;
  seedLocal(slug:string,body:string):Promise<void>;
  seedSyntheticRemote(slug:string,body:string):void;
  mutateSyntheticRemote(slug:string,body:string):void;
  setBaseline(fingerprints:SyncFingerprint[]):void;
  preview():Promise<SyncPlan>;
  apply(approval:SandboxApproval):Promise<SyntheticTransferReceipt>;
  localContentForTest(slug:string):Promise<string|null>;
  syntheticRemoteContentForTest(slug:string):string|null;
  localBackupCountForTest():Promise<number>;
  close():Promise<void>;
}>{
  const root=await mkdtemp(path.join(tmpdir(),TEMP_PREFIX));
  const rootResolved=path.resolve(root);
  if(path.dirname(rootResolved)!==path.resolve(tmpdir())||
     !path.basename(rootResolved).startsWith(TEMP_PREFIX)){
    throw new Error("Synthetic root is outside the approved scratch area");
  }
  const remote=new Map<string,RemoteNote>();
  const baseline=new Map<string,SyncFingerprint>();
  let lastPlan:SyncPlan|null=null;
  let closed=false;
  const backupDir=path.join(root,".sandbox-backups");

  function ensureOpen():void{
    if(closed)throw new Error("Synthetic sandbox has been closed");
  }
  function filePath(slug:string):string{
    validSlug(slug);
    return path.join(root,slug+".md");
  }
  async function localSha(slug:string):Promise<string|null>{
    ensureOpen();
    const p=filePath(slug);
    try{
      const stat=await lstat(p);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>MAX_BYTES){
        throw new Error("Unsafe synthetic local note");
      }
      const bytes=await readFile(p);
      const after=await lstat(p);
      if(bytes.byteLength>MAX_BYTES||stat.ino!==after.ino||
         stat.mtimeMs!==after.mtimeMs||stat.size!==after.size){
        throw new Error("Synthetic local note changed while being read");
      }
      return digest(bytes);
    }catch(error){
      if((error as NodeJS.ErrnoException).code==="ENOENT")return null;
      throw error;
    }
  }
  function remoteFp(slug:string):SyncFingerprint|null{
    ensureOpen();
    validSlug(slug);
    const data=remote.get(slug);
    if(!data)return null;
    return {slug,sha256:digest(data.bytes),revision:"sandbox-r"+data.revision};
  }
  async function checkAvailable():Promise<void>{
    const m=await readObsidianLocalManifest(root);
    // Do not let the scanner's config exclusion expand the scratch allowlist.
    const children=await readdir(root,{withFileTypes:true});
    if(m.unsupportedMarkdownFiles||m.otherFiles||m.directoriesNotScanned>1||
       children.some(x=>x.isSymbolicLink()||(x.isDirectory()&&x.name!==".sandbox-backups"))){
      throw new Error("Synthetic sandbox contains unexpected files or folders");
    }
  }
  function invalidatePlan():void{lastPlan=null;}

  return {
    sandboxDirectory:root,
    async seedLocal(slug,body){
      ensureOpen();
      const filename=filePath(slug);
      await writeFile(filename,bytesFor(body),{flag:"wx"});
      invalidatePlan();
    },
    seedSyntheticRemote(slug,body){
      ensureOpen();validSlug(slug);
      if(remote.has(slug))throw new Error("Synthetic remote already contains note");
      remote.set(slug,{bytes:bytesFor(body),revision:1});
      invalidatePlan();
    },
    mutateSyntheticRemote(slug,body){
      ensureOpen();validSlug(slug);
      const prev=remote.get(slug);
      if(!prev)throw new Error("Synthetic remote note missing");
      remote.set(slug,{bytes:bytesFor(body),revision:prev.revision+1});
      // Deliberately leave lastPlan in place: a concurrent remote edit must
      // be caught by the compare-and-swap guard when applying that old plan.
    },
    setBaseline(fingerprints){
      ensureOpen();
      // Reuse the existing strict manifest parser. Do not trust arbitrary
      // callback input to inject paths or private Markdown.
      planObsidianReconciliation({local:[],remote:[],baseline:fingerprints});
      baseline.clear();
      for(const fp of fingerprints)baseline.set(fp.slug,{...fp});
      invalidatePlan();
    },
    async preview(){
      ensureOpen();
      await checkAvailable();
      const local=(await readObsidianLocalManifest(root)).fingerprints;
      const syntheticRemote=[...remote.keys()].sort().map(slug=>remoteFp(slug)!);
      const p=planObsidianReconciliation({
        local,remote:syntheticRemote,baseline:[...baseline.values()],
      });
      lastPlan=p;
      return p;
    },
    async apply(approval){
      ensureOpen();
      if(!lastPlan)throw new Error("Manual preview required before approval");
      if(!approval||typeof approval!=="object")throw new Error("Invalid manual approval");
      validSlug(approval.slug);
      const decision=lastPlan.decisions.find(x=>x.slug===approval.slug);
      if(!decision)throw new Error("Selected note is not in the last preview");
      const dir=approval.direction;
      if(dir!=="upload"&&dir!=="download")throw new Error("Unsupported transfer direction");
      const expectedDirection=(
        decision.choice==="review-upload"||decision.choice==="review-missing-remote"
      )?"upload":(
        decision.choice==="review-download"||decision.choice==="review-missing-local"
      )?"download":null;
      if(expectedDirection!==dir){
        throw new Error("Conflicts, unchanged and deletion decisions cannot be applied");
      }
      if(approval.confirmation!=="APPROVE "+dir.toUpperCase()+" "+approval.slug){
        throw new Error("Explicit per-note confirmation phrase required");
      }

      // Strict optimistic checks on BOTH sides, not just the destination.
      const beforeLocal=await localSha(approval.slug);
      const beforeRemote=remoteFp(approval.slug);
      if(beforeLocal!==decision.expectedLocalSha||
         (beforeRemote?.sha256??null)!==decision.expectedRemoteSha||
         (beforeRemote?.revision??null)!==decision.expectedRemoteRevision){
        throw new Error("Stale preview; source or destination changed");
      }
      const localFile=filePath(approval.slug);
      let source:Buffer;
      let backupCreated=false;
      if(dir==="upload"){
        if(!beforeLocal)throw new Error("Upload source missing");
        source=await readFile(localFile);
        if(digest(source)!==beforeLocal)throw new Error("Upload source changed during read");
        // Synthetic CAS: re-evaluate state immediately before writing.
        const now=remoteFp(approval.slug);
        if((now?.sha256??null)!==decision.expectedRemoteSha||
           (now?.revision??null)!==decision.expectedRemoteRevision){
          throw new Error("Synthetic remote version changed");
        }
        const prior=remote.get(approval.slug);
        remote.set(approval.slug,{bytes:Buffer.from(source),
          revision:(prior?.revision??0)+1});
      }else{
        const from=remote.get(approval.slug);
        if(!from)throw new Error("Download source missing");
        source=Buffer.from(from.bytes);
        if(digest(source)!==beforeRemote?.sha256)throw new Error("Remote source changed during read");
        // Safe read-only check before creating backups or temp files.
        if(await localSha(approval.slug)!==decision.expectedLocalSha){
          throw new Error("Synthetic local version changed");
        }
        if(beforeLocal!==null){
          const old=await readFile(localFile);
          if(digest(old)!==beforeLocal)throw new Error("Synthetic local changed before backup");
          await mkdir(backupDir,{recursive:true});
          const backup=path.join(backupDir,approval.slug+"-"+randomUUID()+".bak");
          await writeFile(backup,old,{flag:"wx"});
          backupCreated=true;
          // Sandbox rehearsal uses temporary, non-production files only.
          const staged=path.join(root,".staged-"+randomUUID()+".md");
          await writeFile(staged,source,{flag:"wx"});
          if(await localSha(approval.slug)!==beforeLocal){
            await rm(staged,{force:true});
            throw new Error("Synthetic local changed before replacement");
          }
          await rename(staged,localFile);
        }else{
          // O_EXCL denies overwriting even if another process creates the
          // note immediately after preview.
          await writeFile(localFile,source,{flag:"wx"});
        }
      }
      const next=digest(source);
      // Baseline is session-memory-only and advances ONLY after a successful
      // synthetic transfer. Never written to the real Obsidian Vault.
      baseline.set(approval.slug,{slug:approval.slug,sha256:next});
      lastPlan=null; // require fresh per-note preview for the next action.
      return {
        slug:approval.slug,direction:dir,sha256:next,sandboxOnly:true,
        backedUpExistingLocal:backupCreated,automaticSyncEnabled:false,
      };
    },
    async localContentForTest(slug){
      ensureOpen();
      const p=filePath(slug);
      try{return await readFile(p,"utf8");}
      catch(error){
        if((error as NodeJS.ErrnoException).code==="ENOENT")return null;
        throw error;
      }
    },
    syntheticRemoteContentForTest(slug){
      ensureOpen();validSlug(slug);
      return remote.get(slug)?.bytes.toString("utf8")??null;
    },
    async localBackupCountForTest(){
      ensureOpen();
      try{return (await readdir(backupDir)).length;}
      catch(error){
        if((error as NodeJS.ErrnoException).code==="ENOENT")return 0;
        throw error;
      }
    },
    async close(){
      if(closed)return;
      closed=true;
      // Only a fresh scratch folder created by this session is removable.
      if(path.dirname(rootResolved)!==path.resolve(tmpdir())||
         !path.basename(rootResolved).startsWith(TEMP_PREFIX)){
        throw new Error("Refusing to clean an unexpected path");
      }
      await rm(rootResolved,{recursive:true,force:true});
    },
  };
}
