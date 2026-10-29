/**
 * Policy for the future low-load Obsidian <-> Production auto-sync agent.
 *
 * Reuses the existing M1 three-way fingerprint planner; this module contains
 * NO network calls, filesystem writes, timers, credentials or executable
 * transfer API. It produces candidates for an eventual Owner-RLS/CAS-backed
 * executor, NOT permission to write.
 *
 * The initial pairing must be approved and its baseline authenticated by the
 * separate durable journal before normal one-sided changes become automatic.
 * A missing note with an existing baseline is a possible DELETE, never an
 * invitation to recreate/erase it automatically.
 */
import {
  planObsidianReconciliation,
  type SyncDecision,type SyncFingerprint,
} from "./obsidian-sync-plan.ts";
import type {ReadOnlyLocalManifest} from "./obsidian-local-manifest.ts";
import {RELEASE_NEON_BRANCH} from "./neon/production-release.ts";

const ALLOWED_REMOTE_KEYS=new Set([
  "branchId","fingerprints","numberOfNotes","fullInventory",
  "ownerRlsVerified","writeEnabled",
]);
const ALLOWED_LOCAL_KEYS=new Set([
  "fingerprints","unsupportedMarkdownFiles","otherFiles",
  "directoriesNotScanned","autoApplyAllowed",
]);
const MAX_NOTES=500;
const REV=/^[A-Za-z0-9:_-]{1,128}$/;

export type AutoSyncRemoteSnapshot={
  branchId:typeof RELEASE_NEON_BRANCH;
  fingerprints:SyncFingerprint[];
  numberOfNotes:number;
  fullInventory:true;
  ownerRlsVerified:true;
  writeEnabled:false;
};
export type AutoSyncTrust={
  /** Verified by the OS-local enrollment flow, not by the planner. */
  initialPairingApproved:boolean;
  /** An intact owner-bound, signed M5 journal was independently reloaded. */
  durableBaselineVerified:boolean;
  /** The transport verified current Neon Auth identity, JWT and RLS. */
  ownerSessionFresh:boolean;
  /** SQL003 schema/ACL gate checked on the paired Production branch. */
  productionSchemaReady:boolean;
};
export type AutoSyncAction=
  |"upload-create"|"upload-cas"
  |"download-new"|"download-replace"
  |"unchanged"
  |"manual-conflict"|"manual-deletion"|"manual-missing-revision"
  |"blocked";

export type AutoSyncCandidate=Pick<SyncDecision,
  "slug"|"choice"|"expectedLocalSha"|"expectedRemoteSha"|"expectedRemoteRevision"
>&{
  action:AutoSyncAction;
  /** Status only: the production transfer adapters are NOT connected. */
  executable:false;
  automaticDeletionAllowed:false;
  requiresFreshTwoSidedRead:true;
  requiresDurableBackup:boolean;
  baselineCommitOnlyAfterVerifiedReadback:true;
};
export type AutoSyncPolicyPlan={
  state:"blocked"|"ready-to-wire";
  reasons:readonly string[];
  candidates:AutoSyncCandidate[];
  autoCandidateCount:number;
  manualReviewCount:number;
  automaticTransfersEnabled:false;
  automaticDeletionEnabled:false;
  backgroundAgentStarted:false;
  baselineUpdated:false;
};

function isRecord(value:unknown):value is Record<string,unknown>{
  return !!value&&typeof value==="object"&&!Array.isArray(value);
}
function exactKeys(x:Record<string,unknown>,expected:Set<string>){
  return Object.keys(x).length===expected.size&&
    Object.keys(x).every(key=>expected.has(key));
}
function count(x:unknown):x is number{
  return typeof x==="number"&&Number.isSafeInteger(x)&&x>=0;
}
function validateLocal(value:unknown):ReadOnlyLocalManifest{
  if(!isRecord(value)||!exactKeys(value,ALLOWED_LOCAL_KEYS)||
     value.autoApplyAllowed!==false||!Array.isArray(value.fingerprints)||
     !count(value.unsupportedMarkdownFiles)||!count(value.directoriesNotScanned)||
     !count(value.otherFiles)){
    throw Error("Auto-sync requires complete validated local metadata");
  }
  return value as ReadOnlyLocalManifest;
}
function validateRemote(value:unknown):AutoSyncRemoteSnapshot{
  if(!isRecord(value)||!exactKeys(value,ALLOWED_REMOTE_KEYS)||
     value.branchId!==RELEASE_NEON_BRANCH||value.fullInventory!==true||
     value.ownerRlsVerified!==true||value.writeEnabled!==false||
     !Array.isArray(value.fingerprints)||!count(value.numberOfNotes)||
     value.numberOfNotes>MAX_NOTES||
     value.numberOfNotes!==value.fingerprints.length){
    throw Error("Auto-sync requires complete Production Owner-RLS inventory");
  }
  return value as AutoSyncRemoteSnapshot;
}
function validateTrust(value:unknown):AutoSyncTrust{
  if(!isRecord(value)||
     !["initialPairingApproved","durableBaselineVerified",
       "ownerSessionFresh","productionSchemaReady"].every(k=>typeof value[k]==="boolean")||
     Object.keys(value).length!==4){
    throw Error("Auto-sync requires explicit verified pairing prerequisites");
  }
  return value as AutoSyncTrust;
}
const automatic=new Set<AutoSyncAction>([
  "upload-create","upload-cas","download-new","download-replace",
]);
function chooseAction(d:SyncDecision,hasBaseline:boolean):AutoSyncAction{
  switch(d.choice){
    case "unchanged":return "unchanged";
    case "conflict":return "manual-conflict";
    case "both-removed":return "manual-deletion";
    case "review-missing-local":
      if(hasBaseline)return "manual-deletion";
      return d.expectedRemoteRevision&&REV.test(d.expectedRemoteRevision)
        ?"download-new":"manual-missing-revision";
    case "review-missing-remote":
      return hasBaseline?"manual-deletion":"upload-create";
    case "review-upload":
      return d.expectedRemoteRevision&&REV.test(d.expectedRemoteRevision)
        ?"upload-cas":"manual-missing-revision";
    case "review-download":
      return d.expectedRemoteRevision&&REV.test(d.expectedRemoteRevision)
        ?"download-replace":"manual-missing-revision";
  }
}

/**
 * Deliberately no IO/executor. The eventual Windows agent must re-read BOTH
 * sides, use create-only or SQL003 CAS, durable backup + atomic local writes,
 * and record an M5 baseline ONLY after the verified post-write readback.
 */
export function planAutomaticObsidianSync(input:{
  local:unknown;
  remote:unknown;
  baseline:unknown;
  trust:unknown;
}):AutoSyncPolicyPlan{
  if(!input||!isRecord(input))throw Error("Auto-sync input invalid");
  const local=validateLocal(input.local);
  const remote=validateRemote(input.remote);
  const trust=validateTrust(input.trust);
  // Validate fingerprints, duplicate slugs, SHA/revision grammar, unexpected
  // data fields and 500-note limit using the existing canonical M1 planner.
  const plan=planObsidianReconciliation({
    local:local.fingerprints,remote:remote.fingerprints,baseline:input.baseline,
  });
  const baseline=input.baseline as SyncFingerprint[];
  // The original M1 validation rejects duplicates/malformed slugs. A Set
  // derived from the validated list is safe for deletion classification.
  const previouslyPresent=new Set(baseline.map(x=>x.slug));
  const reasons:string[]=[];
  if(!trust.initialPairingApproved)reasons.push("initial-pairing-not-approved");
  if(!trust.durableBaselineVerified)reasons.push("durable-baseline-not-verified");
  if(!trust.ownerSessionFresh)reasons.push("owner-session-not-verified");
  if(!trust.productionSchemaReady)reasons.push("production-schema-not-ready");
  if(local.unsupportedMarkdownFiles>0||local.directoriesNotScanned>0){
    reasons.push("local-coverage-incomplete");
  }

  const blocked=reasons.length>0;
  const candidates=plan.decisions.map((d):AutoSyncCandidate=>{
    const action=blocked?"blocked":chooseAction(d,previouslyPresent.has(d.slug));
    return {
      slug:d.slug,choice:d.choice,
      expectedLocalSha:d.expectedLocalSha,
      expectedRemoteSha:d.expectedRemoteSha,
      expectedRemoteRevision:d.expectedRemoteRevision,
      action,
      executable:false,
      automaticDeletionAllowed:false,
      requiresFreshTwoSidedRead:true,
      requiresDurableBackup:action==="download-replace",
      baselineCommitOnlyAfterVerifiedReadback:true,
    };
  });
  return {
    state:blocked?"blocked":"ready-to-wire",
    reasons,
    candidates,
    autoCandidateCount:candidates.filter(x=>automatic.has(x.action)).length,
    manualReviewCount:candidates.filter(x=>x.action.startsWith("manual-")).length,
    automaticTransfersEnabled:false,
    automaticDeletionEnabled:false,
    backgroundAgentStarted:false,
    baselineUpdated:false,
  };
}
