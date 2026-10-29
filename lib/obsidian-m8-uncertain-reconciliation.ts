/**
 * P1 read-only recovery after an ambiguous Production POST or interrupted
 * local apply. The possible outcomes are observations, NEVER permission to
 * retry the POST, delete notes, or append an M5 baseline.
 */
import {RELEASE_NEON_BRANCH} from "./neon/production-release.ts";
import {fetchProductionOwnerRlsFingerprints}
  from "./obsidian-m8-production-inventory-readonly.ts";

const SHA=/^[a-f0-9]{64}$/;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
type State="current-expected-content"|"still-old-version"|"still-absent"|
  "missing-or-deleted"|"diverged";
function reject():never{
  throw Error("M8 uncertain Production operation requires Owner-RLS read-only reconciliation");
}
export async function inspectM8UncertainProductionOperation(args:{
  branchId:string;
  ownerJwt:string;
  slug:string;
  beforeSha256:string|null;
  beforeRevision:string|null;
  expectedSha256:string;
  fetcher?:typeof fetch;
  signal?:AbortSignal;
}):Promise<{
  state:State;
  currentSha256:string|null;
  currentRevision:string|null;
  ownerRlsVerified:true;
  manualReviewRequired:true;
  automaticRetryAllowed:false;
  automaticDeletionAllowed:false;
  baselineSaved:false;
  remoteWrites:0;
  localWrites:0;
}>{
  if(!args||args.branchId!==RELEASE_NEON_BRANCH||
     typeof args.slug!=="string"||!SLUG.test(args.slug)||
     args.slug.length<3||args.slug.length>120||
     !SHA.test(args.expectedSha256)||
     (args.beforeSha256===null)!==(args.beforeRevision===null)||
     (args.beforeSha256!==null&&
       (!SHA.test(args.beforeSha256)||!SHA.test(args.beforeRevision!)))||
     args.beforeSha256===args.expectedSha256)reject();
  const snapshot=await fetchProductionOwnerRlsFingerprints({
    branchId:args.branchId,jwt:args.ownerJwt,
    fetcher:args.fetcher,signal:args.signal,
  });
  const remote=snapshot.fingerprints.find(x=>x.slug===args.slug);
  let state:State;
  if(!remote){
    state=args.beforeSha256===null?"still-absent":"missing-or-deleted";
  }else if(remote.sha256===args.expectedSha256&&
           (args.beforeRevision===null||
            remote.revision!==args.beforeRevision)){
    state="current-expected-content";
  }else if(args.beforeSha256!==null&&
           remote.sha256===args.beforeSha256&&
           remote.revision===args.beforeRevision){
    state="still-old-version";
  }else{
    state="diverged";
  }
  return {
    state,currentSha256:remote?.sha256??null,
    currentRevision:remote?.revision??null,
    ownerRlsVerified:true,manualReviewRequired:true,
    automaticRetryAllowed:false,automaticDeletionAllowed:false,
    baselineSaved:false,remoteWrites:0,localWrites:0,
  };
}
