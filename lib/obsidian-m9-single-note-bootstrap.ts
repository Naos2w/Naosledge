/**
 * Exact one-note bootstrap for the current non-equal MSI Vault (local=1,
 * Owner-RLS cloud=0). This NEVER runs from the automatic Agent. An Owner
 * must inspect the local note and separately approve its precise slug/SHA.
 *
 * Create-only RPC first, then full equality verified by M5; a lost response
 * or failed M5 append is uncertain and must NOT automatically retry.
 */
import {createHash} from "node:crypto";
import {hostname,tmpdir} from "node:os";
import {lstat,realpath,readFile,readdir} from "node:fs/promises";
import path from "node:path";
import {RELEASE_NEON_BRANCH} from "./neon/production-release.ts";
import {APPROVED_MSI_VAULT,verifyMsiVaultRegistration}
  from "./obsidian-m4-local-apply.ts";
import {readObsidianLocalManifest}
  from "./obsidian-local-manifest.ts";
import {fetchProductionOwnerRlsFingerprints}
  from "./obsidian-m8-production-inventory-readonly.ts";
import {inspectProductionM8Baseline,adoptProductionM8EqualPairing,
  type ProductionM8JournalOptions}
  from "./obsidian-m8-production-baseline-journal.ts";
import {createProductionNoteOnce}
  from "./obsidian-m8-production-cas-update.ts";
import {reviewM8NonEqualInitialPairing}
  from "./obsidian-m8-first-pairing-review.ts";

const SHA=/^[a-f0-9]{64}$/;
const TEST_ROOT=/^naosledge-m8-vault-test-[a-zA-Z0-9_-]{6,}$/;
function stop():never{
  throw Error("M9 first-note onboarding requires explicit Owner review");
}
async function safeVault(dir:string){
  const st=await lstat(dir);
  if(!st.isDirectory()||st.isSymbolicLink()||
     path.resolve(await realpath(dir)).toLowerCase()!==
       path.resolve(dir).toLowerCase())stop();
}
export async function bootstrapM9SingleLocalNote(args:{
  ownerJwt:string;
  slug:string;
  approvedSha256:string;
  typedConfirmation:string;
  schemaReady:boolean;
  fetcher?:typeof fetch;
  testOnly?:{
    vaultRoot:string;
    journalOptions:ProductionM8JournalOptions;
  };
}):Promise<{
  pairingApproved:true;initialNoteCount:1;
  automaticSyncEnabled:false;
  remoteCreateVerified:true;baselineSaved:true;
}>{
  if(!args||args.schemaReady!==true||
     typeof args.slug!=="string"||
     !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.slug)||
     args.slug.length<3||args.slug.length>120||
     typeof args.approvedSha256!=="string"||
     !SHA.test(args.approvedSha256)||
     args.typedConfirmation!==
       "APPROVE M9 SINGLE LOCAL BOOTSTRAP "+args.slug+" "+
       args.approvedSha256.slice(0,12))stop();
  const injected=args.testOnly;
  if(injected){
    if(!path.isAbsolute(injected.vaultRoot)||
       path.dirname(path.resolve(injected.vaultRoot)).toLowerCase()!==
         path.resolve(tmpdir()).toLowerCase()||
       !TEST_ROOT.test(path.basename(injected.vaultRoot))||
       !injected.journalOptions?.testRoot||
       !injected.journalOptions?.testProtector||
       !injected.journalOptions?.testReadLocal)stop();
  }else{
    if(process.platform!=="win32"||
       hostname().trim().toUpperCase()!=="MSI")stop();
    await verifyMsiVaultRegistration();
  }
  const vault=injected?.vaultRoot??APPROVED_MSI_VAULT;
  await safeVault(vault);
  const fetcher=args.fetcher??fetch;
  const signed=await inspectProductionM8Baseline({
    ownerJwt:args.ownerJwt,fetcher,options:injected?.journalOptions,
  });
  if(signed.paired||signed.durableBaselineVerified)stop();
  const local=await readObsidianLocalManifest(vault);
  const remote=await fetchProductionOwnerRlsFingerprints({
    branchId:RELEASE_NEON_BRANCH,jwt:args.ownerJwt,fetcher,
  });
  if(local.fingerprints.length!==1||
     local.fingerprints[0].slug!==args.slug||
     local.fingerprints[0].sha256!==args.approvedSha256||
     local.unsupportedMarkdownFiles!==0||
     local.directoriesNotScanned!==0||
     remote.numberOfNotes!==0)stop();
  const review=reviewM8NonEqualInitialPairing({local,remote});
  if(review.mode!=="requires-initial-owner-review"||
     review.reviewDecisions.length!==1||
     review.reviewDecisions[0].disposition!=="approve-local-only-create"||
     review.reviewDecisions[0].expectedLocalSha!==args.approvedSha256)stop();
  const pathToFile=path.join(vault,args.slug+".md");
  const readMarkdown=async()=>{
    const before=await lstat(pathToFile);
    if(!before.isFile()||before.isSymbolicLink()||
       before.nlink!==1||before.size>250_000)stop();
    const content=await readFile(pathToFile);
    const after=await lstat(pathToFile);
    if(before.ino!==after.ino||before.mtimeMs!==after.mtimeMs||
       before.size!==after.size||
       createHash("sha256").update(content).digest("hex")!==
         args.approvedSha256)stop();
    return content.toString("utf8");
  };
  // Exact one-note immutable decision. Legacy QA confirmation is internally
  // minted only after the explicit M9 Owner approval and Owner RLS review.
  const chosen={
    slug:args.slug,choice:"review-missing-remote" as const,
    action:"upload-create" as const,
    expectedLocalSha:args.approvedSha256,
    expectedRemoteSha:null,expectedRemoteRevision:null,
    executable:false as const,automaticDeletionAllowed:false as const,
    requiresFreshTwoSidedRead:true as const,
    requiresDurableBackup:false,
    baselineCommitOnlyAfterVerifiedReadback:true as const,
  };
  try{
    const saved=await createProductionNoteOnce({
      branchId:RELEASE_NEON_BRANCH,ownerJwt:args.ownerJwt,
      candidate:chosen,fetcher,readLocalMarkdown:readMarkdown,
      typedConfirmation:"TEST M8 PRODUCTION CREATE "+args.slug+" "+
        args.approvedSha256.slice(0,12),
    });
    if(!saved.verifiedRemoteReadback)stop();
    const accepted=await adoptProductionM8EqualPairing({
      ownerJwt:args.ownerJwt,fetcher,
      options:injected?.journalOptions,
      typedConfirmation:"APPROVE M8 PRODUCTION INITIAL EQUALITY",
    });
    if(!accepted.paired||accepted.initialNoteCount!==1)stop();
    return {
      pairingApproved:true,initialNoteCount:1,
      automaticSyncEnabled:false,remoteCreateVerified:true,
      baselineSaved:true,
    };
  }catch{
    // Remote create might already have COMMITTED. Do not retry.
    throw Error("M9 first-note onboarding uncertain; check Owner-RLS and M5 manually");
  }
}
