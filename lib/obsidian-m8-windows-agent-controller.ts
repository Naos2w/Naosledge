/**
 * M8 P2 opt-in Windows read-only agent controller.
 *
 * Owns ONE lock, ONE watcher, ONE low-load scheduler and a fresh credential
 * request on each scan. Does NOT install an autostart service, store a JWT,
 * execute CAS/Incoming, approve initial pairing, mutate M5 or write a Vault
 * Markdown file. Actual Production Owner-RLS and DPAPI journal validation
 * are performed by the existing pinned adapters. No external-facing API.
 */
import {hostname,homedir,tmpdir} from "node:os";
import {lstat,mkdir,open,realpath,unlink} from "node:fs/promises";
import path from "node:path";
import {createM8EphemeralOwnerSource}
  from "./obsidian-m8-owner-session-source.ts";
import {createM8ReadOnlySyncHost,
  type M8ReadOnlyHostSummary} from "./obsidian-m8-readonly-host.ts";
import {inspectProductionM8Baseline,
  type ProductionM8JournalOptions}
  from "./obsidian-m8-production-baseline-journal.ts";
import {verifyMsiVaultRegistration,APPROVED_MSI_VAULT}
  from "./obsidian-m4-local-apply.ts";
import type {AutoSyncClock,AutoSyncScanTrigger}
  from "./obsidian-auto-sync-wakeup.ts";
import type {WatchFactory} from "./obsidian-m8-local-watcher-readonly.ts";

const TEST_PREFIX="naosledge-m8-agent-test-";
const LOCK=".m8-readonly-agent.lock";
function deny():never{
  throw Error("M8 Windows read-only agent unavailable; no transfer started");
}
async function safeDir(directory:string){
  const stat=await lstat(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||
     path.normalize(await realpath(directory)).toLowerCase()!==
       path.normalize(directory).toLowerCase())deny();
}
async function resolveLockRoot(testRoot?:string){
  if(testRoot!==undefined){
    if(typeof testRoot!=="string"||!path.isAbsolute(testRoot)||
       path.dirname(path.resolve(testRoot)).toLowerCase()!==
         path.resolve(tmpdir()).toLowerCase()||
       !path.basename(testRoot).startsWith(TEST_PREFIX)||
       !/^[a-zA-Z0-9_-]+$/.test(path.basename(testRoot)))deny();
    await safeDir(testRoot);
    return path.resolve(testRoot);
  }
  if(process.platform!=="win32"||
     hostname().trim().toUpperCase()!=="MSI")deny();
  // Only the pinned registered MSI Vault may be watched in the real mode.
  await verifyMsiVaultRegistration();
  const base=process.env.LOCALAPPDATA||
    path.join(homedir(),"AppData","Local");
  if(!path.isAbsolute(base))deny();
  await safeDir(base);
  const parent=path.join(base,"Naosledge");
  const lockRoot=path.join(parent,"m8-readonly-agent");
  for(const dir of [parent,lockRoot]){
    try{await mkdir(dir,{mode:0o700});}
    catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")deny();}
    await safeDir(dir);
  }
  return lockRoot;
}
type TestDependencies={
  root:string;
  journal:ProductionM8JournalOptions;
  fetcher:typeof fetch;
  watchFactory?:WatchFactory;
  clock?:AutoSyncClock;
  schemaReady?:boolean;
};
export function createM8WindowsReadOnlyAgent(options:{
  requestFreshJwt:()=>Promise<string>;
  onStatus?:(summary:M8ReadOnlyHostSummary,
    trigger:AutoSyncScanTrigger)=>void;
  onWatcherError?:()=>void;
  /** Isolated fake Owner API / OS Temp only. Real mode has no overrides. */
  testOnly?:TestDependencies;
}){
  if(!options||typeof options.requestFreshJwt!=="function"||
     (options.onStatus!==undefined&&typeof options.onStatus!=="function")||
     (options.onWatcherError!==undefined&&
       typeof options.onWatcherError!=="function"))deny();
  const test=options.testOnly;
  if(test&&(
     typeof test.root!=="string"||
     !test.journal?.testRoot||!test.journal?.testProtector||
     !test.journal?.testReadLocal||typeof test.fetcher!=="function"||
     (test.schemaReady!==undefined&&typeof test.schemaReady!=="boolean")))deny();
  const root=test?.root??APPROVED_MSI_VAULT;
  const ownerSource=createM8EphemeralOwnerSource({
    requestFreshJwt:options.requestFreshJwt,
  });
  const host=createM8ReadOnlySyncHost({
    root,
    getOwnerJwt:()=>ownerSource.acquire(),
    loadPairing:async jwt=>{
      const journal=await inspectProductionM8Baseline({
        ownerJwt:jwt,fetcher:test?.fetcher,options:test?.journal,
      });
      return {
        baseline:journal.fingerprints,
        trust:{
          initialPairingApproved:journal.paired,
          durableBaselineVerified:journal.durableBaselineVerified,
          // JWT subject has passed the separate real signed-JWT RLS grant.
          ownerSessionFresh:true,
          // Never infer that SQL003 exists from a successful note GET.
          // This must be proven by a separate signed Production schema gate.
          productionSchemaReady:test?.schemaReady===true,
        },
      };
    },
    fetcher:test?.fetcher,
    watchFactory:test?.watchFactory,
    clock:test?.clock,
    onWatcherError:options.onWatcherError,
    onStatus:(item,reason)=>{
      if(state==="running")options.onStatus?.(item,reason);
    },
  });
  type State="stopped"|"paused"|"running";
  let state:State="stopped";
  let starting=false;
  let lockHandle:Awaited<ReturnType<typeof open>>|null=null;
  let lockInode:number|null=null;
  let lockPath:string|null=null;
  async function verifyLock(){
    if(!lockHandle||!lockPath||lockInode===null)deny();
    const current=await lstat(lockPath).catch(()=>deny());
    if(!current.isFile()||current.isSymbolicLink()||
       current.nlink!==1||current.ino!==lockInode)deny();
  }
  async function obtainLock(){
    const lockRoot=await resolveLockRoot(test?.root);
    const file=path.join(lockRoot,LOCK);
    let handle:Awaited<ReturnType<typeof open>>;
    try{handle=await open(file,"wx",0o600);}catch{deny();}
    try{
      await handle.writeFile("m8-read-only-single-instance");
      await handle.sync();
      const st=await handle.stat();
      lockInode=st.ino;
      lockPath=file;
      lockHandle=handle;
    }catch{
      await handle.close().catch(()=>{});
      // A partial lock is preserved for deliberate manual recovery.
      deny();
    }
  }
  async function releaseLock(){
    if(!lockHandle)return;
    const held=lockHandle;
    try{
      await verifyLock();
      await held.close();
      await unlink(lockPath!);
      lockHandle=null;
      lockPath=null;
      lockInode=null;
    }catch{
      // Never unlink someone else's lock or auto-clear a stale lock.
      await held.close().catch(()=>{});
      lockHandle=null;
      deny();
    }
  }
  return {
    async start():Promise<void>{
      if(state!=="stopped"||starting)deny();
      starting=true;
      try{
        await obtainLock();
        await host.start();
        state="running";
      }catch{
        host.stop();
        if(lockHandle)await releaseLock();
        state="stopped";
        deny();
      }finally{starting=false;}
    },
    pause():void{
      if(state!=="running")deny();
      host.stop();
      state="paused";
    },
    async resume():Promise<void>{
      if(state!=="paused"||starting)deny();
      starting=true;
      try{
        await verifyLock();
        await host.start();
        state="running";
      }catch{
        host.stop();
        state="paused";
        deny();
      }finally{starting=false;}
    },
    async stop():Promise<void>{
      if(starting)deny();
      host.stop();
      state="stopped";
      await releaseLock();
    },
    status(){
      const health=host.status();
      return {
        state,
        health:state==="running"?health.health:"stopped",
        scanInFlight:state==="running"&&health.scanInFlight,
        last:state==="running"?health.last:null,
        ownerPinned:ownerSource.status().ownerPinned,
        automaticTransfersEnabled:false as const,
        automaticDeletionEnabled:false as const,
        realVaultWrites:0 as const,
        remoteWrites:0 as const,
      };
    },
  };
}
