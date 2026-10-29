/**
 * M8 isolated read-only host composition for the future MSI agent.
 *
 * Explicit start() joins the existing wakeup scheduler, a read-only root
 * watcher and the Production Owner-RLS fingerprint reader. There is NO
 * source writer, create/update/delete call, local backup replacement, M5
 * checkpoint mutation, cron installation or module import side effect.
 *
 * The trusted Windows entrypoint must provide short-lived Owner JWTs and
 * independently verified M5 pairing metadata for each scan. Never store the
 * JWT in an environment variable, process arguments, file or visible UI.
 */
import {readObsidianLocalManifest} from "./obsidian-local-manifest.ts";
import {fetchProductionOwnerRlsFingerprints}
  from "./obsidian-m8-production-inventory-readonly.ts";
import {inspectM8ReadOnlyPairing,type M8ReadOnlyPairingStatus}
  from "./obsidian-m8-readonly-cycle.ts";
import {createObsidianRootReadOnlyWatcher,type WatchFactory}
  from "./obsidian-m8-local-watcher-readonly.ts";
import {createObsidianAutoSyncWakeup,
  type AutoSyncClock,type AutoSyncScanTrigger}
  from "./obsidian-auto-sync-wakeup.ts";
import {RELEASE_NEON_BRANCH} from "./neon/production-release.ts";
import type {SyncFingerprint} from "./obsidian-sync-plan.ts";
import type {AutoSyncTrust} from "./obsidian-auto-sync-policy.ts";

export type M8ReadOnlyHostSummary={
  mode:M8ReadOnlyPairingStatus["mode"];
  localNotes:number;
  remoteNotes:number;
  manualReviews:number;
  unknownNames:number;
  unscannedDirectories:number;
  remoteWrites:0;
  localWrites:0;
  automaticTransfersEnabled:false;
};

function summary(p:M8ReadOnlyPairingStatus):M8ReadOnlyHostSummary{
  return {
    mode:p.mode,
    localNotes:p.localNoteCount,
    remoteNotes:p.remoteNoteCount,
    manualReviews:p.manualReviewCount,
    unknownNames:p.unsupportedMarkdownNames,
    unscannedDirectories:p.unscannedDirectories,
    remoteWrites:0,localWrites:0,automaticTransfersEnabled:false,
  };
}
export function createM8ReadOnlySyncHost(options:{
  root:string;
  /** Issued by real Production Auth, never returned from this host. */
  getOwnerJwt:()=>Promise<string>;
  /** Must be read from the separately verified local M5 journal. */
  loadPairing:(jwt:string)=>Promise<{baseline:SyncFingerprint[];trust:AutoSyncTrust}>;
  onStatus?:(status:M8ReadOnlyHostSummary,trigger:AutoSyncScanTrigger)=>void;
  onWatcherError?:()=>void;
  fetcher?:typeof fetch;
  watchFactory?:WatchFactory;
  clock?:AutoSyncClock;
}){
  if(!options||typeof options.getOwnerJwt!=="function"||
     typeof options.loadPairing!=="function"||
     (options.onStatus!==undefined&&typeof options.onStatus!=="function")){
    throw Error("M8 Owner read-only host requires trusted readers");
  }
  let last:M8ReadOnlyHostSummary|null=null,starting=false;
  const wakeup=createObsidianAutoSyncWakeup({
    clock:options.clock,
    onCheck:async(signal,trigger)=>{
      // Use ONE fresh JWT for both the signed M5 Owner journal and
      // the subsequent full Owner-RLS inventory. Prevent different
      // identities or sessions between separate credential callbacks.
      const jwt=await options.getOwnerJwt();
      if(signal.aborted)return;
      const pairing=await options.loadPairing(jwt);
      if(signal.aborted)return;
      const scan=await inspectM8ReadOnlyPairing({
        readLocal:()=>readObsidianLocalManifest(options.root),
        readRemote:()=>fetchProductionOwnerRlsFingerprints({
          branchId:RELEASE_NEON_BRANCH,jwt,signal,fetcher:options.fetcher,
        }),
        baseline:pairing.baseline,trust:pairing.trust,signal,
      });
      if(signal.aborted)return;
      last=summary(scan);
      options.onStatus?.({...last},trigger);
    },
  });
  const watcher=createObsidianRootReadOnlyWatcher({
    root:options.root,
    watcherFactory:options.watchFactory,
    onLocalChange:()=>wakeup.signalLocalChange(),
    onError:()=>{
      wakeup.stop();
      try{options.onWatcherError?.();}catch{}
    },
  });
  return {
    async start():Promise<void>{
      if(wakeup.status().started)return;
      if(starting)throw Error("M8 host already starting");
      starting=true;
      try{
        await watcher.start();
        wakeup.start();
      }catch(error){
        watcher.stop();
        throw error;
      }finally{starting=false;}
    },
    stop(){
      // Abort in-flight scan before unwatching the folder.
      wakeup.stop();
      watcher.stop();
    },
    status(){
      const s=wakeup.status();
      return {
        running:s.started&&watcher.status().started,
        health:s.lastResult,
        scanInFlight:s.scanInFlight,
        consecutiveFailures:s.consecutiveFailures,
        last:s.lastResult==="error"?null:last?{...last}:null,
        automaticTransfersEnabled:false as const,
      };
    },
  };
}
