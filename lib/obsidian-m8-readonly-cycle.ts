/**
 * M8 pairing/read-only scan coordinator. This does not start a watcher and
 * grants no transfer capability. A separate MSI process supplies readers.
 *
 * A trusted future Owner adapter can pass fetchProductionOwnerRlsFingerprints
 * and the existing readObsidianLocalManifest; both remain read-only here.
 */
import {
  planObsidianReconciliation,type SyncFingerprint,
} from "./obsidian-sync-plan.ts";
import {planAutomaticObsidianSync,
  type AutoSyncRemoteSnapshot,type AutoSyncTrust,type AutoSyncAction}
  from "./obsidian-auto-sync-policy.ts";
import {RELEASE_NEON_BRANCH} from "./neon/production-release.ts";
import type {ReadOnlyLocalManifest} from "./obsidian-local-manifest.ts";

export type M8ReadOnlyPairingStatus={
  mode:"initial-review"|"paused"|"ready-to-wire";
  localNoteCount:number;
  remoteNoteCount:number;
  unscannedDirectories:number;
  unsupportedMarkdownNames:number;
  possibleUnpairedFiles:number;
  manualReviewCount:number;
  candidateActions:readonly {slug:string;action:AutoSyncAction|"pairing-review"}[];
  comparisonPerformed:true;
  remoteFullInventoryRead:true;
  originalLocalFilesModified:false;
  remoteWrites:0;
  localWrites:0;
  baselineSaved:false;
  watcherStarted:false;
  automaticTransfersEnabled:false;
  automaticDeletionEnabled:false;
};

function ensureCurrent(signal?:AbortSignal){
  if(signal?.aborted)throw Error("M8 inventory inspection interrupted");
}
const EMPTY_REMOTE:AutoSyncRemoteSnapshot={
  branchId:RELEASE_NEON_BRANCH,fingerprints:[],numberOfNotes:0,
  fullInventory:true,ownerRlsVerified:true,writeEnabled:false,
};
const EMPTY_LOCAL:ReadOnlyLocalManifest={
  fingerprints:[],unsupportedMarkdownFiles:0,otherFiles:0,
  directoriesNotScanned:0,autoApplyAllowed:false,
};

/**
 * Initial empty pairing MUST be marked unapproved; matching SHA does not
 * automatically enroll a device. After a signed M5 baseline is independently
 * verified, this coordinator can display (not execute) automatic candidates.
 */
export async function inspectM8ReadOnlyPairing(args:{
  readLocal:()=>Promise<ReadOnlyLocalManifest>;
  readRemote:()=>Promise<AutoSyncRemoteSnapshot>;
  baseline:SyncFingerprint[];
  trust:AutoSyncTrust;
  signal?:AbortSignal;
}):Promise<M8ReadOnlyPairingStatus>{
  if(!args||typeof args.readLocal!=="function"||
     typeof args.readRemote!=="function"||!Array.isArray(args.baseline)){
    throw Error("M8 requires explicit read-only readers and baseline");
  }
  // Reject malformed Owner enrollment and baselines before any I/O.
  planAutomaticObsidianSync({
    local:EMPTY_LOCAL,remote:EMPTY_REMOTE,
    baseline:args.baseline,trust:args.trust,
  });
  // Capture permission state BEFORE any awaited local/remote operation.
  const initialTrust=JSON.stringify(args.trust);
  const initialBaseline=JSON.stringify(args.baseline);
  ensureCurrent(args.signal);
  let local:ReadOnlyLocalManifest,remote:AutoSyncRemoteSnapshot;
  try{
    local=await args.readLocal();
    ensureCurrent(args.signal);
    if(JSON.stringify(args.trust)!==initialTrust||
       JSON.stringify(args.baseline)!==initialBaseline){
      throw Error("M8 pairing changed during local scan");
    }
    // Validate local coverage and all fingerprints prior to a private GET.
    planAutomaticObsidianSync({
      local,remote:EMPTY_REMOTE,baseline:args.baseline,trust:args.trust,
    });
  }catch{throw Error("M8 initial local scan incomplete");}
  const originalLocal=JSON.stringify(local);
  try{
    remote=await args.readRemote();
    ensureCurrent(args.signal);
    if(JSON.stringify(args.trust)!==initialTrust||
       JSON.stringify(args.baseline)!==initialBaseline){
      throw Error("M8 pairing changed during remote scan");
    }
  }catch{throw Error("M8 Production Owner-RLS inventory unavailable");}
  let result:ReturnType<typeof planAutomaticObsidianSync>;
  try{
    result=planAutomaticObsidianSync({
      local,remote,baseline:args.baseline,trust:args.trust,
    });
  }catch{throw Error("M8 Production Owner-RLS inventory incomplete");}
  const remoteSnapshot=JSON.stringify(remote);
  let localAfter:ReadOnlyLocalManifest;
  try{
    localAfter=await args.readLocal();
    ensureCurrent(args.signal);
  }catch{throw Error("M8 local rescan unavailable");}
  if(JSON.stringify(localAfter)!==originalLocal||
     JSON.stringify(args.baseline)!==initialBaseline||
     JSON.stringify(args.trust)!==initialTrust||
     JSON.stringify(remote)!==remoteSnapshot){
    throw Error("M8 sources changed during inspection");
  }

  // Show unsigned/unpaired metadata for human review ONLY; no transfer
  // candidates are granted until initial pairing and journal are approved.
  const initial=args.trust.initialPairingApproved!==true||
    args.trust.durableBaselineVerified!==true;
  const comparison=planObsidianReconciliation({
    local:local.fingerprints,remote:remote.fingerprints,
    baseline:initial?[]:args.baseline,
  });
  const reviewCount=comparison.decisions.filter(d=>d.manualReview).length;
  const mode=initial?"initial-review":
    result.state==="ready-to-wire"?"ready-to-wire":"paused";
  const actions=initial?
    comparison.decisions.map(d=>({
      slug:d.slug,
      action:(d.choice==="unchanged"?"unchanged":"pairing-review") as
        AutoSyncAction|"pairing-review",
    })):
    result.candidates.map(d=>({slug:d.slug,action:d.action}));
  return {
    mode,
    localNoteCount:local.fingerprints.length,
    remoteNoteCount:remote.numberOfNotes,
    unscannedDirectories:local.directoriesNotScanned,
    unsupportedMarkdownNames:local.unsupportedMarkdownFiles,
    possibleUnpairedFiles:initial?
      reviewCount+local.unsupportedMarkdownFiles+local.directoriesNotScanned:0,
    manualReviewCount:initial?reviewCount:result.manualReviewCount,
    candidateActions:actions,
    comparisonPerformed:true,
    remoteFullInventoryRead:true,
    originalLocalFilesModified:false,
    remoteWrites:0,localWrites:0,
    baselineSaved:false,watcherStarted:false,
    automaticTransfersEnabled:false,automaticDeletionEnabled:false,
  };
}
