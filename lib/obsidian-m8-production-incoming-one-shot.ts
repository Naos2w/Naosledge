/**
 * M8 P2 one-shot approved Production download-new / M5 acknowledgement.
 *
 * This is deliberately NOT used by the watcher, scheduler or public website.
 * It requires two explicit confirmations and never retries a failed
 * create-only operation. Any incomplete step leaves durable intent for an
 * independent read-only recovery inspection.
 */
import {downloadProductionNewNoteOnce}
  from "./obsidian-m8-production-incoming-new.ts";
import {recordVerifiedProductionM8DownloadNew,
  type ProductionM8JournalOptions}
  from "./obsidian-m8-production-baseline-journal.ts";
import {acknowledgeM8ProductionIncomingNew}
  from "./obsidian-m8-production-incoming-recovery.ts";
import {RELEASE_NEON_BRANCH} from "./neon/production-release.ts";
import type {AutoSyncCandidate} from "./obsidian-auto-sync-policy.ts";

export async function executeApprovedM8ProductionNewDownload(args:{
  branchId:string;
  ownerJwt:string;
  candidate:AutoSyncCandidate;
  downloadConfirmation:string;
  acknowledgementConfirmation:string;
  fetcher?:typeof fetch;
  signal?:AbortSignal;
  testOnly?:{
    vaultRoot:string;
    privateRoot:string;
    journalOptions:ProductionM8JournalOptions;
  };
}):Promise<{
  slug:string;sha256:string;revision:string;
  localReadbackVerified:true;
  remoteReadbackVerified:true;
  checkpointSaved:true;
  receiptAcknowledged:true;
  automaticTransferStarted:false;
  automaticRetryAllowed:false;
  automaticDeletionAllowed:false;
}>{
  const c=args?.candidate;
  if(!args||args.branchId!==RELEASE_NEON_BRANCH||
     !c||c.action!=="download-new"||
     typeof c.slug!=="string"||
     typeof c.expectedRemoteSha!=="string"||
     !/^[a-f0-9]{64}$/.test(c.expectedRemoteSha)||
     args.downloadConfirmation!==
       "APPROVE M8 PRODUCTION DOWNLOAD-NEW "+c.slug+" "+
       c.expectedRemoteSha.slice(0,12)||
     args.acknowledgementConfirmation!==
       "ACK M8 PRODUCTION DOWNLOAD-NEW "+c.slug+" "+
       c.expectedRemoteSha.slice(0,12)||
     args.signal?.aborted){
    throw Error("M8 approved download-new requires explicit verification");
  }
  try{
    const first=await downloadProductionNewNoteOnce({
      branchId:args.branchId,ownerJwt:args.ownerJwt,
      candidate:args.candidate,typedConfirmation:args.downloadConfirmation,
      fetcher:args.fetcher,signal:args.signal,
      testOnly:args.testOnly,
    });
    // The M5 adapter independently verifies the durable intent AND
    // repeated Owner-RLS/local SHA snapshots. Never trust this receipt alone.
    const saved=await recordVerifiedProductionM8DownloadNew({
      ownerJwt:args.ownerJwt,fetcher:args.fetcher,
      options:args.testOnly?.journalOptions,
      receipt:{
        slug:first.slug,sha256:first.sha256,revision:first.revision,
        intentPath:first.intentPath,
        localReadbackVerified:true,remoteReadbackVerified:true,
        originalBackupSha256:null,
        baselineSaved:false,automaticRetryAllowed:false,
      },
    });
    if(!saved.checkpointSaved)throw Error();
    const ack=await acknowledgeM8ProductionIncomingNew({
      ownerJwt:args.ownerJwt,fetcher:args.fetcher,
      typedConfirmation:args.acknowledgementConfirmation,
      testOnly:args.testOnly,
    });
    if(!ack.acknowledged||!ack.baselineVerified)throw Error();
    return {
      slug:first.slug,sha256:first.sha256,revision:first.revision,
      localReadbackVerified:true,remoteReadbackVerified:true,
      checkpointSaved:true,receiptAcknowledged:true,
      automaticTransferStarted:false,
      automaticRetryAllowed:false,automaticDeletionAllowed:false,
    };
  }catch{
    // The new file and/or M5 checkpoint MAY HAVE COMMITTED.
    // Never retry or rollback. The durable intent is preserved until
    // a separate read-only reconciliation proves the current state.
    throw Error("M8 Production Incoming uncertain; inspect M5 and durable receipt before any retry");
  }
}
