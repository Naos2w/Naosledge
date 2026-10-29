/**
 * M8 P2 explicit-first-pairing review for a NON-EQUAL local/remote library.
 *
 * A signed Owner-RLS snapshot and complete local fingerprint manifest
 * identify the outstanding choices. This NEVER enrolls the device, uploads
 * an unknown local note, deletes data, invokes SQL003, or updates M5.
 * Exact slugs/hashes are returned only to trusted MSI Node code, never
 * published by the foreground agent's aggregate onStatus callback.
 */
import {planAutomaticObsidianSync,type AutoSyncRemoteSnapshot}
  from "./obsidian-auto-sync-policy.ts";
import type {ReadOnlyLocalManifest} from "./obsidian-local-manifest.ts";
import {RELEASE_NEON_BRANCH} from "./neon/production-release.ts";
import type {SyncChoice} from "./obsidian-sync-plan.ts";

export type M8InitialReviewDisposition=
  "approve-local-only-create"|"approve-remote-only-download"|
  "approve-equal-note"|"manual-name-collision";

export type M8InitialReviewDecision={
  slug:string;
  disposition:M8InitialReviewDisposition;
  expectedLocalSha:string|null;
  expectedRemoteSha:string|null;
  expectedRemoteRevision:string|null;
  requiresExplicitOwnerApproval:true;
  executable:false;
};
export type M8InitialReview={
  mode:"blocked"|"requires-initial-owner-review";
  localCount:number;
  remoteCount:number;
  unsupportedNames:number;
  unscannedDirectories:number;
  reviewDecisions:readonly M8InitialReviewDecision[];
  noteWrites:0;
  baselineCreated:false;
  automaticTransfersEnabled:false;
  autoApproveAllowed:false;
};
const MAP:Record<SyncChoice,M8InitialReviewDisposition>={
  "review-missing-remote":"approve-local-only-create",
  "review-missing-local":"approve-remote-only-download",
  unchanged:"approve-equal-note",
  conflict:"manual-name-collision",
  "review-upload":"manual-name-collision",
  "review-download":"manual-name-collision",
  "both-removed":"manual-name-collision",
};
export function reviewM8NonEqualInitialPairing(input:{
  local:ReadOnlyLocalManifest;
  remote:AutoSyncRemoteSnapshot;
}):M8InitialReview{
  if(!input||!input.local||!input.remote)throw Error("M8 initial review requires both verified inventories");
  // The Production Owner-RLS completeness validation must run even though
  // every candidate is manual and no durable baseline exists yet.
  const p=planAutomaticObsidianSync({
    local:input.local,remote:input.remote,baseline:[],
    trust:{
      initialPairingApproved:false,durableBaselineVerified:false,
      ownerSessionFresh:true,productionSchemaReady:false,
    },
  });
  if(input.remote.branchId!==RELEASE_NEON_BRANCH)throw Error("M8 initial review branch mismatch");
  const blocked=input.local.unsupportedMarkdownFiles>0||
    input.local.directoriesNotScanned>0;
  const decisions=p.candidates.map(x=>({
    slug:x.slug,disposition:MAP[x.choice],
    expectedLocalSha:x.expectedLocalSha,
    expectedRemoteSha:x.expectedRemoteSha,
    expectedRemoteRevision:x.expectedRemoteRevision,
    requiresExplicitOwnerApproval:true as const,
    executable:false as const,
  }));
  return {
    mode:blocked?"blocked":"requires-initial-owner-review",
    localCount:input.local.fingerprints.length,
    remoteCount:input.remote.numberOfNotes,
    unsupportedNames:input.local.unsupportedMarkdownFiles,
    unscannedDirectories:input.local.directoriesNotScanned,
    reviewDecisions:decisions,
    noteWrites:0,baselineCreated:false,
    automaticTransfersEnabled:false,autoApproveAllowed:false,
  };
}
