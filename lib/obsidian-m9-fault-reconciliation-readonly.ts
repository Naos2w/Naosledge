/**
 * M9 manual fault triage: an independent, READ-ONLY comparison of the
 * durable M5 journal with two fresh local + Production Owner-RLS inventories.
 *
 * A matching snapshot is only evidence for a human review. It NEVER clears
 * .m9-fault-review-required, changes M5, approves retry or restarts an Agent.
 * Any inaccessible or inconsistent evidence is classified as blocked.
 */
import {lstat,readdir,realpath} from "node:fs/promises";
import {homedir,tmpdir} from "node:os";
import path from "node:path";
import {APPROVED_MSI_VAULT,verifyMsiVaultRegistration}
  from "./obsidian-m4-local-apply.ts";
import {RELEASE_NEON_BRANCH}
  from "./neon/production-release.ts";
import {readObsidianLocalManifest}
  from "./obsidian-local-manifest.ts";
import {fetchProductionOwnerRlsFingerprints}
  from "./obsidian-m8-production-inventory-readonly.ts";
import {
  inspectProductionM8Baseline,inspectM9SignedAutoState,
  type ProductionM8JournalOptions,
} from "./obsidian-m8-production-baseline-journal.ts";
import {inspectM9FaultReadOnly}
  from "./obsidian-m9-fault-review-readonly.ts";

type Reason="no-latch"|"untrusted-marker"|"writer-lock-present"|
  "signed-mode-enabled"|"pending-incoming"|"unpaired"|
  "inventory-diverged"|"verification-unavailable"|
  "ready-for-manual-review";

export type M9ReconciliationStatus={
  state:Reason;
  /** Even a verified equality is NOT permission to discard a crash marker. */
  manualReconciliationRequired:boolean;
  signedM5EqualityVerified:boolean;
  automaticRestartAuthorised:false;
  faultMarkerRemoved:false;
  noteWritesPerformed:0;
};

export type M9ReconciliationTestOnly={
  faultRoot:string;
  vaultRoot:string;
  incomingRoot:string;
  journalOptions:ProductionM8JournalOptions;
};

function report(state:Reason):M9ReconciliationStatus{
  return {
    state,
    manualReconciliationRequired:state!=="no-latch",
    signedM5EqualityVerified:state==="ready-for-manual-review",
    automaticRestartAuthorised:false,faultMarkerRemoved:false,
    noteWritesPerformed:0,
  };
}

function testFolder(folder:string,prefix:string):boolean{
  return typeof folder==="string"&&path.isAbsolute(folder)&&
    path.dirname(path.resolve(folder)).toLowerCase()===
      path.resolve(tmpdir()).toLowerCase()&&
    new RegExp("^"+prefix+"[a-zA-Z0-9_-]{6,}$")
      .test(path.basename(folder));
}

async function pendingIncomingIsEmpty(root:string,test:boolean){
  let stat:Awaited<ReturnType<typeof lstat>>;
  try{stat=await lstat(root);}
  catch(e){
    if(!test&&(e as NodeJS.ErrnoException).code==="ENOENT")return true;
    return false;
  }
  if(!stat.isDirectory()||stat.isSymbolicLink()||
     path.resolve(await realpath(root)).toLowerCase()!==
       path.resolve(root).toLowerCase())return false;
  return (await readdir(root)).length===0;
}

function matchesCurrentSignedBaseline(args:{
  baseline:{slug:string;sha256:string;revision?:string|null}[];
  local:{slug:string;sha256:string}[];
  remote:{slug:string;sha256:string;revision?:string|null}[];
}):boolean{
  const sorted=<T extends {slug:string}>(items:T[])=>[...items].sort(
    (a,b)=>a.slug.localeCompare(b.slug,"en"));
  const baseline=sorted(args.baseline);
  const local=sorted(args.local);
  const remote=sorted(args.remote);
  return baseline.length===local.length&&baseline.length===remote.length&&
    baseline.every((x,i)=>
      typeof x.revision==="string"&&x.revision.length>0&&
      x.slug===local[i].slug&&x.sha256===local[i].sha256&&
      x.slug===remote[i].slug&&x.sha256===remote[i].sha256&&
      x.revision===remote[i].revision);
}

/**
 * Diagnostic only: no persistence and no output of JWT, notes, slugs or SHA.
 * A caller still needs a distinct, human-approved clearance procedure.
 */
export async function inspectM9FaultReconciliationReadOnly(args:{
  ownerJwt:string;
  fetcher?:typeof fetch;
  testOnly?:M9ReconciliationTestOnly;
}):Promise<M9ReconciliationStatus>{
  const test=args?.testOnly;
  if(typeof args?.ownerJwt!=="string"||args.ownerJwt.length<1){
    return report("verification-unavailable");
  }
  if(test&&(
     !testFolder(test.faultRoot,"naosledge-m9-fault-test-")||
     !testFolder(test.vaultRoot,"naosledge-m8-vault-test-")||
     !testFolder(test.incomingRoot,"naosledge-m8-incoming-test-")||
     !test.journalOptions?.testRoot||
     !test.journalOptions?.testProtector||
     !test.journalOptions?.testReadLocal)){
    return report("verification-unavailable");
  }
  const faultRoot=test?.faultRoot;
  const fault=await inspectM9FaultReadOnly(
    faultRoot?{testRoot:faultRoot}:undefined).catch(()=>null);
  if(!fault)return report("verification-unavailable");
  if(fault.state==="uninitialized"||fault.state==="no-latch"){
    return report(fault.writerLockPresent?
      "writer-lock-present":"no-latch");
  }
  if(fault.state==="untrusted-marker")return report("untrusted-marker");
  if(fault.writerLockPresent)return report("writer-lock-present");

  const incoming=test?.incomingRoot??path.join(
    process.env.LOCALAPPDATA||path.join(homedir(),"AppData","Local"),
    "Naosledge","m8-production-incoming");
  const vault=test?.vaultRoot??APPROVED_MSI_VAULT;
  const common={ownerJwt:args.ownerJwt,fetcher:args.fetcher,
    options:test?.journalOptions};
  try{
    if(!test)await verifyMsiVaultRegistration();
    if(!await pendingIncomingIsEmpty(incoming,!!test)){
      return report("pending-incoming");
    }
    const mode=await inspectM9SignedAutoState(common);
    if(mode.signedAutoEnabled)return report("signed-mode-enabled");
    const journal=await inspectProductionM8Baseline(common);
    if(!journal.paired||!journal.durableBaselineVerified||
       journal.branch!==RELEASE_NEON_BRANCH||!mode.paired){
      return report("unpaired");
    }
    const local=await readObsidianLocalManifest(vault);
    const remote=await fetchProductionOwnerRlsFingerprints({
      branchId:RELEASE_NEON_BRANCH,jwt:args.ownerJwt,
      fetcher:args.fetcher,
    });
    if(local.unsupportedMarkdownFiles!==0||
       local.directoriesNotScanned!==0||
       !remote.fullInventory||!remote.ownerRlsVerified||
       !matchesCurrentSignedBaseline({
         baseline:journal.fingerprints,
         local:local.fingerprints,remote:remote.fingerprints,
       }))return report("inventory-diverged");

    // Double-read AND revalidate the M5 journal/mode after the network
    // calls. A stale equality must never be treated as a recovery proof.
    const secondLocal=await readObsidianLocalManifest(vault);
    const secondRemote=await fetchProductionOwnerRlsFingerprints({
      branchId:RELEASE_NEON_BRANCH,jwt:args.ownerJwt,
      fetcher:args.fetcher,
    });
    const secondJournal=await inspectProductionM8Baseline(common);
    const secondMode=await inspectM9SignedAutoState(common);
    if(secondMode.signedAutoEnabled||
       secondMode.recordCount!==mode.recordCount||
       secondJournal.recordCount!==journal.recordCount||
       !secondJournal.durableBaselineVerified||
       JSON.stringify(secondJournal.fingerprints)!==
         JSON.stringify(journal.fingerprints)||
       JSON.stringify(secondLocal)!==JSON.stringify(local)||
       JSON.stringify(secondRemote)!==JSON.stringify(remote)||
       !await pendingIncomingIsEmpty(incoming,!!test)){
      return report("verification-unavailable");
    }
    const finalFault=await inspectM9FaultReadOnly(
      faultRoot?{testRoot:faultRoot}:undefined);
    if(finalFault.state!=="review-required"||
       finalFault.writerLockPresent)return report("writer-lock-present");
    return report("ready-for-manual-review");
  }catch{
    return report("verification-unavailable");
  }
}
