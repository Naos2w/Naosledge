/**
 * M1 - compose an Obsidian <-> NaosLedge manual-sync PREVIEW.
 *
 * Read-only orchestrator: it has no local path, Neon URL, JWT, write, rename,
 * delete, upload, download, baseline persistence or background-scheduler API.
 * Approved callers supply existing read-only local / Neon Sandbox readers.
 * A future separately authorized executor must recheck BOTH source versions
 * before any per-note write. This module cannot grant write approval.
 */
import {
  planObsidianReconciliation,
  type SyncChoice,
  type SyncDecision,
  type SyncFingerprint,
} from "./obsidian-sync-plan.ts";
import type {ReadOnlyLocalManifest} from "./obsidian-local-manifest.ts";
import type {RemoteSandboxSnapshot} from "./obsidian-neon-sandbox-readonly.ts";

const LOCAL_FIELDS=new Set([
  "fingerprints","unsupportedMarkdownFiles","otherFiles",
  "directoriesNotScanned","autoApplyAllowed",
]);
const REMOTE_FIELDS=new Set([
  "fingerprints","numberOfNotes","sandboxOnly",
  "rlsEnforcedByDataApi","writeEnabled","fullInventory",
]);
const REMOTE_LIMIT=20;

export type ManualReviewPreviewDecision=SyncDecision&{
  /** A provisional classification, NOT a command or approved operation. */
  perNoteConfirmationRequired:boolean;
  writeAllowed:false;
  deleteAllowed:false;
};

export type ManualReviewPreview={
  sandboxOnly:true;
  readOnly:true;
  manualTriggerOnly:true;
  autoApplyAllowed:false;
  automaticSyncEnabled:false;
  automaticDeleteEnabled:false;
  baselinePersisted:false;
  previewStatus:"ready"|"partial-local-coverage";
  /** These numbers are counts, not filenames or private text. */
  inventory:{
    localSupportedNotes:number;
    remoteNotes:number;
    remoteFullInventory:true;
    localUnsupportedMarkdown:number;
    localOtherFiles:number;
    localDirectoriesNotScanned:number;
    localCoverageNeedsReview:boolean;
  };
  decisions:ManualReviewPreviewDecision[];
  summary:Record<SyncChoice,number>;
  manualReviewCount:number;
  conflicts:number;
  possibleDeletionsNeverApplied:number;
};

function isRecord(x:unknown):x is Record<string,unknown>{
  return x!==null&&typeof x==="object"&&!Array.isArray(x);
}
function exactKeys(x:Record<string,unknown>,allowed:Set<string>):boolean{
  const keys=Object.keys(x);
  return keys.length===allowed.size&&keys.every(key=>allowed.has(key));
}
function count(x:unknown):x is number{
  return Number.isSafeInteger(x)&&typeof x==="number"&&x>=0;
}
function localSnapshot(x:unknown):ReadOnlyLocalManifest{
  if(!isRecord(x)||!exactKeys(x,LOCAL_FIELDS)||
     x.autoApplyAllowed!==false||!Array.isArray(x.fingerprints)||
     !count(x.unsupportedMarkdownFiles)||!count(x.otherFiles)||
     !count(x.directoriesNotScanned)){
    throw Error("Local Obsidian inventory incomplete or invalid; no preview");
  }
  // Do not copy arbitrary provider objects into preview outputs.
  return x as ReadOnlyLocalManifest;
}
function remoteSnapshot(x:unknown):RemoteSandboxSnapshot{
  if(!isRecord(x)||!exactKeys(x,REMOTE_FIELDS)||
     x.sandboxOnly!==true||x.rlsEnforcedByDataApi!==true||
     x.writeEnabled!==false||x.fullInventory!==true||
     !Array.isArray(x.fingerprints)||!count(x.numberOfNotes)||
     x.numberOfNotes!==x.fingerprints.length||x.numberOfNotes>REMOTE_LIMIT){
    // Never reinterpret a partial/error response as an empty remote library.
    throw Error("Full owner-RLS Neon Sandbox inventory required; no preview");
  }
  return x as RemoteSandboxSnapshot;
}

/**
 * The only integration seam: both readers must already be authorized and
 * read-only. No real Vault or network is accessed until those exact callbacks
 * are explicitly provided and invoked by a separately approved caller.
 */
export async function previewManualObsidianSync(args:{
  readLocal:()=>Promise<ReadOnlyLocalManifest>;
  readRemote:()=>Promise<RemoteSandboxSnapshot>;
  /** Explicit input only. Never guessed or saved by this function. */
  baseline:SyncFingerprint[];
}):Promise<ManualReviewPreview>{
  if(!args||typeof args.readLocal!=="function"||
     typeof args.readRemote!=="function"||!Array.isArray(args.baseline)){
    throw Error("Explicit readers and sync baseline are required");
  }
  // Validate the untrusted previous baseline BEFORE making any filesystem or
  // remote read. Invalid/oversized baselines cannot trigger unnecessary I/O.
  planObsidianReconciliation({local:[],remote:[],baseline:args.baseline});
  // Capture the initially approved baseline before yielding to either reader.
  // An in-memory caller must not be able to change a valid baseline while an
  // awaited Owner-RLS GET is running and quietly change conflict directions.
  const initialBaseline=JSON.stringify(args.baseline);
  let local:ReadOnlyLocalManifest;
  try{
    local=localSnapshot(await args.readLocal());
    // Invalid local fingerprints must stop BEFORE any remote Owner GET.
    planObsidianReconciliation({local:local.fingerprints,remote:[],baseline:args.baseline});
  }catch{throw Error("Local Obsidian inventory unavailable; no preview");}
  if(JSON.stringify(args.baseline)!==initialBaseline){
    throw Error("Sync baseline changed during preview; no preview");
  }
  const initialLocal=JSON.stringify(local);

  let remote:RemoteSandboxSnapshot;
  try{remote=remoteSnapshot(await args.readRemote());}
  catch{throw Error("Full owner-RLS Neon Sandbox inventory unavailable; no preview");}
  // A provider may hand back a shared mutable snapshot. Capture what the
  // Owner-RLS GET actually returned before awaiting the second local scan.
  // Otherwise that scan could change the remote list or its completeness
  // flags, and the planner would consume an unverified version.
  const initialRemote=JSON.stringify(remote);

  // The Owner-RLS GET can outlast a local edit. Never return a supposedly
  // current review if the on-disk fingerprints or scan coverage changed while
  // the remote reader was in flight. This remains read-only; a later approved
  // transfer must still recheck both versions under its own authorization.
  let localAfterRemote:ReadOnlyLocalManifest;
  try{localAfterRemote=localSnapshot(await args.readLocal());}
  catch{throw Error("Local Obsidian inventory unavailable after remote read; no preview");}
  if(JSON.stringify(localAfterRemote)!==initialLocal){
    throw Error("Local Obsidian inventory changed during remote read; no preview");
  }
  if(JSON.stringify(remote)!==initialRemote){
    throw Error("Remote Sandbox inventory changed during local recheck; no preview");
  }
  if(JSON.stringify(args.baseline)!==initialBaseline){
    throw Error("Sync baseline changed during preview; no preview");
  }

  // The mature pure planner validates sha256, safe slug, duplicate notes,
  // revision grammar, unexpected fields and max 500 entries on ALL 3 sides.
  // A bad baseline must not be replaced by an assumed empty baseline.
  const plan=planObsidianReconciliation({
    local:local.fingerprints,
    remote:remote.fingerprints,
    baseline:args.baseline,
  });

  const localCoverageNeedsReview=(
    local.unsupportedMarkdownFiles>0||local.directoriesNotScanned>0
  );
  const decisions=plan.decisions.map(d=>({
    ...d,
    // Even a one-sided revision is not consent.  Both-removed retains the
    // baseline until a later explicit owner decision; no deletion is inferred.
    perNoteConfirmationRequired:d.choice!=="unchanged"&&d.choice!=="both-removed",
    writeAllowed:false as const,
    deleteAllowed:false as const,
  }));
  return {
    sandboxOnly:true,readOnly:true,manualTriggerOnly:true,
    autoApplyAllowed:false,automaticSyncEnabled:false,
    automaticDeleteEnabled:false,baselinePersisted:false,
    previewStatus:localCoverageNeedsReview?"partial-local-coverage":"ready",
    inventory:{
      localSupportedNotes:local.fingerprints.length,
      remoteNotes:remote.numberOfNotes,
      remoteFullInventory:true,
      localUnsupportedMarkdown:local.unsupportedMarkdownFiles,
      localOtherFiles:local.otherFiles,
      localDirectoriesNotScanned:local.directoriesNotScanned,
      localCoverageNeedsReview,
    },
    decisions,
    summary:{...plan.summary},
    manualReviewCount:decisions.filter(d=>d.perNoteConfirmationRequired).length,
    conflicts:plan.summary.conflict,
    possibleDeletionsNeverApplied:plan.summary["both-removed"]+
      plan.summary["review-missing-local"]+plan.summary["review-missing-remote"],
  };
}
