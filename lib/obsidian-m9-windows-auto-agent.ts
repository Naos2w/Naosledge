/**
 * M9 opt-in Windows automatic two-way synchronization Agent.
 *
 * Shares the SINGLE MSI instance lock with the M8 read-only Agent, plus
 * the existing 800ms local event debounce / 60s cloud polling primitive.
 * No persistent JWT storage; a fresh trusted Owner token is requested for
 * EVERY cycle. A trusted SQL003 readiness check is also required.
 *
 * Transfers run only after a separate signed Owner-bound M5 opt-in and initial
 * pairing. A failure (possibly committed POST/rename) LATCHES faulted state:
 * NO background auto-retry, no forced rollback. Manual read-only recovery
 * and explicit operator restart are required. Never installs a service.
 */
import {hostname,homedir,tmpdir} from "node:os";
import {lstat,mkdir,open,realpath,unlink} from "node:fs/promises";
import path from "node:path";
import {createM8EphemeralOwnerSource}
  from "./obsidian-m8-owner-session-source.ts";
import {runM9SignedAutoCycle,
  type M9AutoCycleTestOnly,type M9CycleReport}
  from "./obsidian-m9-signed-auto-cycle.ts";
import {createObsidianAutoSyncWakeup,
  type AutoSyncClock,type AutoSyncScanTrigger}
  from "./obsidian-auto-sync-wakeup.ts";
import {createObsidianRootReadOnlyWatcher,type WatchFactory}
  from "./obsidian-m8-local-watcher-readonly.ts";
import {APPROVED_MSI_VAULT,verifyMsiVaultRegistration}
  from "./obsidian-m4-local-apply.ts";

const LOCK=".m8-readonly-agent.lock";
// Durable review marker is separate from the shared M8 instance lock, so
// read-only inspection can still run after an uncertain M9 transfer.
const FAULT_LATCH=".m9-fault-review-required";
function stop():never{
  throw Error("M9 Windows agent stopped; manual review required");
}
async function safeFolder(p:string){
  const st=await lstat(p);
  if(!st.isDirectory()||st.isSymbolicLink()||
     path.resolve(await realpath(p)).toLowerCase()!==
       path.resolve(p).toLowerCase())stop();
}
type M9AgentTestOnly=M9AutoCycleTestOnly&{
  fetcher:typeof fetch;
  clock?:AutoSyncClock;
  watchFactory?:WatchFactory;
};
export function createM9WindowsAutoAgent(args:{
  requestFreshJwt:()=>Promise<string>;
  /** Must check actual Production SQL003/ACL readiness; never infer from GET. */
  verifyProductionSchema:(ownerJwt:string)=>Promise<boolean>;
  onCycle?:(report:M9CycleReport,trigger:AutoSyncScanTrigger)=>void;
  onFault?:()=>void;
  testOnly?:M9AgentTestOnly;
}){
  if(!args||typeof args.requestFreshJwt!=="function"||
     typeof args.verifyProductionSchema!=="function"||
     (args.onCycle!==undefined&&typeof args.onCycle!=="function")||
     (args.onFault!==undefined&&typeof args.onFault!=="function"))stop();
  const test=args.testOnly;
  if(test&&(
     typeof test.fetcher!=="function"||
     !path.isAbsolute(test.vaultRoot)||
     path.dirname(path.resolve(test.vaultRoot)).toLowerCase()!==
       path.resolve(tmpdir()).toLowerCase()||
     !/^naosledge-m8-vault-test-[a-zA-Z0-9_-]{6,}$/.test(
       path.basename(test.vaultRoot))||
     !test.journalOptions?.testRoot))stop();
  const root=test?.vaultRoot??APPROVED_MSI_VAULT;
  const jwtSource=createM8EphemeralOwnerSource({
    requestFreshJwt:args.requestFreshJwt,
  });
  type State="stopped"|"running"|"paused"|"faulted";
  let state:State="stopped",starting=false;
  let last:M9CycleReport|null=null,faults=0,scans=0;
  let lockHandle:Awaited<ReturnType<typeof open>>|null=null;
  let lockPath:string|null=null,lockInode:number|null=null;
  let scanDrain:Promise<void>=Promise.resolve();
  let unconfirmedWrite=false;
  const assertLock=async()=>{
    if(!lockHandle||!lockPath||lockInode===null)stop();
    const current=await lstat(lockPath).catch(()=>stop());
    if(!current.isFile()||current.isSymbolicLink()||
       current.nlink!==1||current.ino!==lockInode)stop();
  };
  const lockRoot=async()=>{
    if(test){
      await safeFolder(root);
      return path.resolve(root);
    }
    if(process.platform!=="win32"||
       hostname().trim().toUpperCase()!=="MSI")stop();
    await verifyMsiVaultRegistration();
    const base=process.env.LOCALAPPDATA||
      path.join(homedir(),"AppData","Local");
    await safeFolder(base);
    const parent=path.join(base,"Naosledge");
    const dedicated=path.join(parent,"m8-readonly-agent");
    for(const dir of [parent,dedicated]){
      try{await mkdir(dir,{mode:0o700});}
      catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")stop();}
      await safeFolder(dir);
    }
    return dedicated;
  };
  const acquireLock=async()=>{
    const folder=await lockRoot();
    // Even a new process must not auto-restart after an uncertain transfer.
    try{await lstat(path.join(folder,FAULT_LATCH));stop();}
    catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")stop();}
    const file=path.join(folder,LOCK);
    let handle:Awaited<ReturnType<typeof open>>;
    try{handle=await open(file,"wx",0o600);}
    catch{stop();}
    try{
      await handle.writeFile("m9-signed-optin-single-writer");
      await handle.sync();
      lockInode=(await handle.stat()).ino;
      lockPath=file;lockHandle=handle;
    }catch{
      await handle.close().catch(()=>{});
      // Preserve an ambiguous lock for operator review.
      stop();
    }
  };
  const persistFaultLatch=async()=>{
    await assertLock();
    const file=path.join(path.dirname(lockPath!),FAULT_LATCH);
    let handle:Awaited<ReturnType<typeof open>>|null=null;
    try{
      handle=await open(file,"wx",0o600);
      await handle.writeFile("m9-uncertain-operation-manual-reconciliation-required");
      await handle.sync();
      await handle.close();
    }catch{
      await handle?.close().catch(()=>{});
      // Keep the shared lock if writing the durable marker was uncertain.
      // An operator can inspect/resolve both without an automatic retry.
      stop();
    }
  };
  const releaseLock=async()=>{
    if(!lockHandle)return;
    const handle=lockHandle;
    await assertLock();
    await handle.close();
    await unlink(lockPath!);
    lockHandle=null;lockPath=null;lockInode=null;
  };
  const wakeup=createObsidianAutoSyncWakeup({
    clock:test?.clock,
    onCheck:async(signal,reason)=>{
      let settle:()=>void=()=>{};
      scanDrain=new Promise<void>(resolve=>{settle=resolve;});
      try{
      if(state!=="running"||signal.aborted)return;
      try{
        await assertLock();
        const jwt=await jwtSource.acquire();
        if(signal.aborted)return;
        const ready=await args.verifyProductionSchema(jwt);
        if(typeof ready!=="boolean")stop();
        if(signal.aborted)return;
        const report=await runM9SignedAutoCycle({
          ownerJwt:jwt,schemaReady:ready,
          fetcher:test?.fetcher,
          testOnly:test&&{
            vaultRoot:test.vaultRoot,privateRoot:test.privateRoot,
            archiveRoot:test.archiveRoot,
            journalOptions:test.journalOptions,
          },
          signal,
          onTransferBegin:()=>{unconfirmedWrite=true;},
          onTransferVerified:()=>{unconfirmedWrite=false;},
        });
        if(state!=="running"||signal.aborted)return;
        scans++;
        last=report;
        args.onCycle?.({...report},reason);
      }catch{
        // Stop polling instead of blindly retrying a possibly committed write.
        if(state==="running"){
          state="faulted";faults++;
          watcher.stop();wakeup.stop();
          try{args.onFault?.();}catch{}
        }
      }
      }finally{settle();}
    },
  });
  const watcher=createObsidianRootReadOnlyWatcher({
    root,
    watcherFactory:test?.watchFactory,
    onLocalChange:()=>wakeup.signalLocalChange(),
    onError:()=>{
      if(state==="running"){
        state="faulted";faults++;
        wakeup.stop();watcher.stop();
        try{args.onFault?.();}catch{}
      }
    },
  });
  const startIO=async()=>{
    await assertLock();
    await watcher.start();
    state="running";
    wakeup.start();
  };
  return {
    async start(){
      if(state!=="stopped"||starting||faults>0)stop();
      starting=true;
      try{
        await acquireLock();
        await startIO();
      }catch{
        watcher.stop();wakeup.stop();
        if(lockHandle)await releaseLock();
        state="stopped";stop();
      }finally{starting=false;}
    },
    pause(){
      if(state!=="running")stop();
      if(unconfirmedWrite){
        state="faulted";faults++;
        try{args.onFault?.();}catch{}
      }else state="paused";
      wakeup.stop();watcher.stop();
    },
    async resume(){
      if(state!=="paused"||starting)stop();
      starting=true;
      try{
        await scanDrain;
        if(unconfirmedWrite){state="faulted";faults++;stop();}
        await startIO();
      }catch{
        wakeup.stop();watcher.stop();
        if(state!=="faulted")state="paused";
        stop();
      }finally{starting=false;}
    },
    async stop(){
      if(starting)stop();
      // A transfer in flight at the instant of stop requires review even
      // if its final HTTP acknowledgment arrives during the drain.
      const interruptedTransfer=unconfirmedWrite;
      state="stopped";wakeup.stop();watcher.stop();
      // Abort is not proof that an outstanding POST was not committed.
      // Drain the exact in-flight cycle BEFORE releasing the writer lock.
      await scanDrain;
      if((interruptedTransfer||unconfirmedWrite)&&faults===0)faults++;
      if(lockHandle&&faults>0)await persistFaultLatch();
      await releaseLock();
    },
    status(){
      return {
        state,scans,faults,
        last:state==="running"&&last?{...last}:null,
        tokenStored:false,
        ownerPinned:jwtSource.status().ownerPinned,
        autoTransferProcessRunning:state==="running",
        automaticDeletionAllowed:false as const,
      };
    },
  };
}
