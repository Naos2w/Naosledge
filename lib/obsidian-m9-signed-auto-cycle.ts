/**
 * M9 Production opt-in auto-cycle, executes at most ONE previously unpaired,
 * unconflicted change. Must be called only by the locked Windows M9 host.
 *
 * No automatic delete, rename, conflict resolution, or blind retry. Every
 * transfer independently validates current Owner-RLS/Markdown versions, then
 * the exact signed Owner M5 baseline is advanced AFTER confirmed readback.
 * The caller must get a fresh Owner JWT and a trusted SQL003 readiness proof.
 *
 * The low-level M8 one-shot confirmation phrases are generated ONLY here,
 * after rereading the Owner/Branch-bound signed automatic enrollment.
 * No schedule, startup or token persistence is created on import.
 */
import {createHash} from "node:crypto";
import {lstat,readFile,readdir,realpath} from "node:fs/promises";
import {homedir,tmpdir} from "node:os";
import path from "node:path";
import {RELEASE_NEON_BRANCH} from "./neon/production-release.ts";
import {
  inspectProductionM8Baseline,inspectM9SignedAutoState,
  recordVerifiedProductionM8Upload,
  type ProductionM8JournalOptions,
} from "./obsidian-m8-production-baseline-journal.ts";
import {readObsidianLocalManifest}
  from "./obsidian-local-manifest.ts";
import {fetchProductionOwnerRlsFingerprints}
  from "./obsidian-m8-production-inventory-readonly.ts";
import {planAutomaticObsidianSync,
  type AutoSyncCandidate,type AutoSyncAction}
  from "./obsidian-auto-sync-policy.ts";
import {createProductionNoteOnce,updateProductionNoteCasOnce}
  from "./obsidian-m8-production-cas-update.ts";
import {executeApprovedM8ProductionNewDownload}
  from "./obsidian-m8-production-incoming-one-shot.ts";
import {executeApprovedM8ProductionReplaceOnce}
  from "./obsidian-m8-production-incoming-replace-one-shot.ts";

const SHA=/^[a-f0-9]{64}$/;
const AUTOS=new Set<AutoSyncAction>([
  "upload-create","upload-cas","download-new","download-replace",
]);
const MAX_BYTES=250_000;
const digest=(content:string)=>createHash("sha256").update(content,"utf8").digest("hex");
function fail():never{
  throw Error("M9 auto-cycle requires read-only reconciliation; no automatic retry");
}
function signalCheck(signal?:AbortSignal){
  if(signal?.aborted)fail();
}
async function approvedLocalMarkdown(root:string,chosen:AutoSyncCandidate){
  if(!chosen.expectedLocalSha||!SHA.test(chosen.expectedLocalSha))fail();
  const name=path.join(root,chosen.slug+".md");
  let before;
  try{before=await lstat(name);}catch{fail();}
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
     before.size<1||before.size>MAX_BYTES||
     path.resolve(await realpath(name)).toLowerCase()!==
       path.resolve(name).toLowerCase())fail();
  const bytes=await readFile(name);
  const after=await lstat(name);
  if(after.ino!==before.ino||after.mtimeMs!==before.mtimeMs||
     after.size!==before.size||bytes.length!==before.size)fail();
  const md=bytes.toString("utf8");
  if(Buffer.byteLength(md,"utf8")!==bytes.length||
     digest(md)!==chosen.expectedLocalSha)fail();
  return md;
}
async function noPendingIncoming(
  options?:M9AutoCycleTestOnly,
):Promise<void>{
  const root=options?.privateRoot??path.join(
    process.env.LOCALAPPDATA||path.join(homedir(),"AppData","Local"),
    "Naosledge","m8-production-incoming");
  if(options&&(
      !path.isAbsolute(root)||
      path.dirname(path.resolve(root)).toLowerCase()!==
        path.resolve(tmpdir()).toLowerCase()||
      !/^naosledge-m8-incoming-test-[a-zA-Z0-9_-]{6,}$/.test(
        path.basename(root))))fail();
  try{
    const st=await lstat(root);
    if(!st.isDirectory()||st.isSymbolicLink()||
       path.resolve(await realpath(root)).toLowerCase()!==
         path.resolve(root).toLowerCase()||
       (await readdir(root)).length!==0)fail();
  }catch(e){
    if(!options&&(e as NodeJS.ErrnoException).code==="ENOENT")return;
    fail();
  }
}
export type M9AutoCycleTestOnly={
  vaultRoot:string;privateRoot:string;archiveRoot:string;
  journalOptions:ProductionM8JournalOptions;
};
export type M9CycleReport={
  status:"disabled"|"unpaired"|"schema-not-ready"|
    "idle"|"manual-review"|"transferred";
  action:"none"|"upload-create"|"upload-cas"|
    "download-new"|"download-replace";
  manualReviewCount:number;
  transferCount:0|1;
  signedOptInRequired:true;
  automaticDeletionAllowed:false;
  ownerRlsVerified:true;
  baselineCommitVerified:boolean;
};

export async function runM9SignedAutoCycle(args:{
  ownerJwt:string;
  schemaReady:boolean;
  fetcher?:typeof fetch;
  testOnly?:M9AutoCycleTestOnly;
  signal?:AbortSignal;
  /** Synchronous lifecycle hooks for the one-writer Windows host. */
  onTransferBegin?:()=>void;
  onTransferVerified?:()=>void;
}):Promise<M9CycleReport>{
  if(!args||typeof args.ownerJwt!=="string"||
     typeof args.schemaReady!=="boolean")fail();
  const test=args.testOnly;
  if(test&&(
    !test.journalOptions?.testRoot||
    !test.journalOptions?.testProtector||
    !test.journalOptions?.testReadLocal||
    !path.isAbsolute(test.vaultRoot)||
    path.dirname(path.resolve(test.vaultRoot)).toLowerCase()!==
      path.resolve(tmpdir()).toLowerCase()||
    !/^naosledge-m8-vault-test-[a-zA-Z0-9_-]{6,}$/.test(
      path.basename(test.vaultRoot))||
    !path.isAbsolute(test.archiveRoot)||
    path.dirname(path.resolve(test.archiveRoot)).toLowerCase()!==
      path.resolve(tmpdir()).toLowerCase()||
    !/^naosledge-m8-backups-test-[a-zA-Z0-9_-]{6,}$/.test(
      path.basename(test.archiveRoot))))fail();
  const make=(status:M9CycleReport["status"],action:M9CycleReport["action"],
    review=0,verified=false):M9CycleReport=>({
    status,action,manualReviewCount:review,
    transferCount:status==="transferred"?1:0,
    signedOptInRequired:true,automaticDeletionAllowed:false,
    ownerRlsVerified:true,baselineCommitVerified:verified,
  });
  const fetcher=test?.journalOptions?args.fetcher:args.fetcher;
  signalCheck(args.signal);
  const consent=await inspectM9SignedAutoState({
    ownerJwt:args.ownerJwt,fetcher,options:test?.journalOptions,
  });
  if(!consent.paired)return make("unpaired","none");
  if(!consent.signedAutoEnabled)return make("disabled","none");
  if(!args.schemaReady)return make("schema-not-ready","none");
  await noPendingIncoming(test);
  signalCheck(args.signal);
  const journal=await inspectProductionM8Baseline({
    ownerJwt:args.ownerJwt,fetcher,options:test?.journalOptions,
  });
  if(!journal.paired||!journal.durableBaselineVerified)fail();
  const localRoot=test?.vaultRoot??"C:\\Naos\\Obsidian\\Naosledge";
  const local=await readObsidianLocalManifest(localRoot);
  const remote=await fetchProductionOwnerRlsFingerprints({
    branchId:RELEASE_NEON_BRANCH,jwt:args.ownerJwt,fetcher,signal:args.signal,
  });
  signalCheck(args.signal);
  const plan=planAutomaticObsidianSync({
    local,remote,baseline:journal.fingerprints,
    trust:{
      initialPairingApproved:true,
      durableBaselineVerified:true,
      ownerSessionFresh:true,productionSchemaReady:true,
    },
  });
  if(plan.state!=="ready-to-wire")return make("manual-review","none",
    plan.candidates.length||1);
  const needsManual=plan.manualReviewCount;
  const candidates=plan.candidates.filter(x=>AUTOS.has(x.action));
  if(!candidates.length)return make(needsManual?"manual-review":"idle",
    "none",needsManual,true);
  // Prioritize an existing note CAS over new uploads, then new/modified
  // downloads. One note max/cycle. No unpaired or deletion candidates.
  const order:AutoSyncAction[]=["upload-cas","upload-create",
    "download-new","download-replace"];
  candidates.sort((a,b)=>order.indexOf(a.action)-order.indexOf(b.action)||
    a.slug.localeCompare(b.slug,"en"));
  const selected=candidates[0];
  if(!selected||selected.executable!==false||
     selected.automaticDeletionAllowed!==false||
     selected.baselineCommitOnlyAfterVerifiedReadback!==true)fail();
  // Changes to the JWT, RLS and baseline are rechecked inside EACH adapter.
  // The signed M5 mode can be disabled concurrently: reverify it immediately
  // before the operation and reject if an external request paused the agent.
  const mode=await inspectM9SignedAutoState({
    ownerJwt:args.ownerJwt,fetcher,options:test?.journalOptions,
  });
  if(!mode.signedAutoEnabled||mode.recordCount!==consent.recordCount)fail();
  signalCheck(args.signal);
  // The host must retain its exclusive lock until this operation settles.
  args.onTransferBegin?.();
  try{
    if(selected.action==="upload-create"||selected.action==="upload-cas"){
      const readLocal=()=>approvedLocalMarkdown(localRoot,selected);
      const receipt=selected.action==="upload-create"?
        await createProductionNoteOnce({
          branchId:RELEASE_NEON_BRANCH,ownerJwt:args.ownerJwt,
          candidate:selected,readLocalMarkdown:readLocal,
          typedConfirmation:"TEST M8 PRODUCTION CREATE "+selected.slug+" "+
            selected.expectedLocalSha!.slice(0,12),
          fetcher,signal:args.signal,
        }):
        await updateProductionNoteCasOnce({
          branchId:RELEASE_NEON_BRANCH,ownerJwt:args.ownerJwt,
          candidate:selected,readLocalMarkdown:readLocal,
          typedConfirmation:"TEST M8 PRODUCTION CAS "+selected.slug+" "+
            selected.expectedLocalSha!.slice(0,12),
          fetcher,signal:args.signal,
        });
      await recordVerifiedProductionM8Upload({
        ownerJwt:args.ownerJwt,fetcher,options:test?.journalOptions,
        receipt,
        beforeSha256:journal.fingerprints.find(x=>x.slug===selected.slug)
          ?.sha256??null,
        beforeRevision:journal.fingerprints.find(x=>x.slug===selected.slug)
          ?.revision??null,
      });
    }else if(selected.action==="download-new"){
      await executeApprovedM8ProductionNewDownload({
        branchId:RELEASE_NEON_BRANCH,ownerJwt:args.ownerJwt,
        candidate:selected,fetcher,signal:args.signal,
        downloadConfirmation:"APPROVE M8 PRODUCTION DOWNLOAD-NEW "+
          selected.slug+" "+selected.expectedRemoteSha!.slice(0,12),
        acknowledgementConfirmation:"ACK M8 PRODUCTION DOWNLOAD-NEW "+
          selected.slug+" "+selected.expectedRemoteSha!.slice(0,12),
        testOnly:test&&{vaultRoot:test.vaultRoot,privateRoot:test.privateRoot,
          journalOptions:test.journalOptions},
      });
    }else if(selected.action==="download-replace"){
      await executeApprovedM8ProductionReplaceOnce({
        branchId:RELEASE_NEON_BRANCH,ownerJwt:args.ownerJwt,
        candidate:selected,fetcher,signal:args.signal,
        replaceConfirmation:"APPROVE M8 PRODUCTION DOWNLOAD-REPLACE "+
          selected.slug+" "+selected.expectedRemoteSha!.slice(0,12),
        archiveConfirmation:"ACK M8 PRODUCTION DOWNLOAD-REPLACE "+
          selected.slug+" "+selected.expectedRemoteSha!.slice(0,12),
        testOnly:test&&{
          vaultRoot:test.vaultRoot,privateRoot:test.privateRoot,
          archiveRoot:test.archiveRoot,journalOptions:test.journalOptions,
        },
      });
    }else fail();
    const current=await inspectProductionM8Baseline({
      ownerJwt:args.ownerJwt,fetcher,options:test?.journalOptions,
    });
    const confirmed=current.fingerprints.find(x=>x.slug===selected.slug);
    const shaExpected=selected.action.startsWith("upload-")?
      selected.expectedLocalSha:selected.expectedRemoteSha;
    if(!confirmed||confirmed.sha256!==shaExpected||
       !confirmed.revision)fail();
    args.onTransferVerified?.();
    return make("transferred",selected.action,needsManual,true);
  }catch{fail();}
}
