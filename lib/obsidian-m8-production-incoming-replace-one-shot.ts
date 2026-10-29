/**
 * Explicit, single-note P2 replacement orchestration. NEVER attached to the
 * Windows watcher, a scheduler or a web route. Both confirmation phrases
 * must be provided BEFORE the first local filesystem write; an ambiguous
 * outcome leaves durable backup/intent untouched, with NO automatic retry.
 */
import {RELEASE_NEON_BRANCH} from "./neon/production-release.ts";
import {downloadProductionReplaceOnce}
  from "./obsidian-m8-production-incoming-replace.ts";
import {recordVerifiedProductionM8DownloadReplace,
  type ProductionM8JournalOptions}
  from "./obsidian-m8-production-baseline-journal.ts";
import {acknowledgeM8ProductionReplace}
  from "./obsidian-m8-production-incoming-replace-recovery.ts";
import type {AutoSyncCandidate} from "./obsidian-auto-sync-policy.ts";

export async function executeApprovedM8ProductionReplaceOnce(args:{
  branchId:string;ownerJwt:string;candidate:AutoSyncCandidate;
  replaceConfirmation:string;archiveConfirmation:string;
  fetcher?:typeof fetch;signal?:AbortSignal;
  testOnly?:{
    vaultRoot:string;privateRoot:string;archiveRoot:string;
    journalOptions:ProductionM8JournalOptions;
    beforeCommitForTest?:()=>Promise<void>;
    afterCommitForTest?:()=>Promise<void>;
  };
}):Promise<{
  slug:string;sha256:string;revision:string;
  checkpointSaved:true;backupArchived:true;archivedBackupPath:string;
  automaticTransferStarted:false;automaticRetryAllowed:false;
  automaticDeletionAllowed:false;
}>{
  const c=args?.candidate;
  if(!args||args.branchId!==RELEASE_NEON_BRANCH||
     !c||c.action!=="download-replace"||
     c.choice!=="review-download"||
     typeof c.slug!=="string"||
     typeof c.expectedRemoteSha!=="string"||
     !/^[a-f0-9]{64}$/.test(c.expectedRemoteSha)||
     args.replaceConfirmation!==
       "APPROVE M8 PRODUCTION DOWNLOAD-REPLACE "+c.slug+" "+
         c.expectedRemoteSha.slice(0,12)||
     args.archiveConfirmation!==
       "ACK M8 PRODUCTION DOWNLOAD-REPLACE "+c.slug+" "+
         c.expectedRemoteSha.slice(0,12)||
     args.signal?.aborted)throw Error("M8 replace requires two exact Owner approvals");
  try{
    const first=await downloadProductionReplaceOnce({
      branchId:args.branchId,ownerJwt:args.ownerJwt,candidate:c,
      typedConfirmation:args.replaceConfirmation,fetcher:args.fetcher,
      signal:args.signal,
      testOnly:args.testOnly&&{
        vaultRoot:args.testOnly.vaultRoot,
        privateRoot:args.testOnly.privateRoot,
        journalOptions:args.testOnly.journalOptions,
        beforeCommitForTest:args.testOnly.beforeCommitForTest,
        afterCommitForTest:args.testOnly.afterCommitForTest,
      },
    });
    const checkpoint=await recordVerifiedProductionM8DownloadReplace({
      ownerJwt:args.ownerJwt,fetcher:args.fetcher,
      options:args.testOnly?.journalOptions,
      receipt:{
        slug:first.slug,sha256:first.sha256,revision:first.revision,
        intentPath:first.intentPath,backupPath:first.backupPath,
        originalBackupSha256:first.originalBackupSha256,
        localReadbackVerified:true,remoteReadbackVerified:true,
        baselineSaved:false,automaticRetryAllowed:false,
      },
    });
    if(!checkpoint.checkpointSaved)throw Error();
    const archived=await acknowledgeM8ProductionReplace({
      ownerJwt:args.ownerJwt,fetcher:args.fetcher,
      typedConfirmation:args.archiveConfirmation,
      testOnly:args.testOnly&&{
        vaultRoot:args.testOnly.vaultRoot,
        privateRoot:args.testOnly.privateRoot,
        archiveRoot:args.testOnly.archiveRoot,
        journalOptions:args.testOnly.journalOptions,
      },
    });
    if(!archived.acknowledged||!archived.durableBackupArchived)throw Error();
    return {
      slug:first.slug,sha256:first.sha256,revision:first.revision,
      checkpointSaved:true,backupArchived:true,
      archivedBackupPath:archived.archivedBackupPath,
      automaticTransferStarted:false,automaticRetryAllowed:false,
      automaticDeletionAllowed:false,
    };
  }catch{
    // The file replacement or M5 append may ALREADY have happened.
    // Preserve all evidence, never re-run the write on this code path.
    throw Error("M8 replace outcome uncertain; inspect durable operation and M5 before retry");
  }
}
