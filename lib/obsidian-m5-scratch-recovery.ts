/**
 * M5 read-only, cross-process inspection of a previously created synthetic
 * scratch journal. This can NEVER certify a real Vault/Neon baseline:
 * the journal is unauthenticated and the remote inventory is caller-supplied.
 */
import {lstat,readdir,realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {
  readSyntheticBaselineJournalDirectory,
  type SyntheticBaselineCheckpoint,
} from "./obsidian-durable-write-sandbox.ts";
import {readObsidianLocalManifest} from "./obsidian-local-manifest.ts";
import {planObsidianReconciliation,type SyncFingerprint} from "./obsidian-sync-plan.ts";

type RemoteSnapshot={
  fullInventory:true;
  numberOfNotes:number;
  fingerprints:SyncFingerprint[];
};
type RecoveryStatus="missing-journal-evidence"|"ambiguous-history"|
  "matches-provided-snapshot"|"changed-local"|"changed-remote"|"changed-both";

export type SyntheticCrossProcessRecoveryReport={
  notes:Array<{slug:string;checkpointCount:number;status:RecoveryStatus}>;
  syntheticOnly:true;
  authenticatedRemoteEvidence:false;
  baselineImported:false;
  writeAllowed:false;
  deleteAllowed:false;
  manualReviewRequired:true;
};

const SCRATCH_NAME=/^naosledge-durable-synthetic-only-[A-Za-z0-9]{6}$/;

async function realDirectory(name:string){
  const stat=await lstat(name);
  if(!stat.isDirectory()||stat.isSymbolicLink()||
     path.normalize(await realpath(name)).toLowerCase()!==path.normalize(name).toLowerCase()){
    throw Error("M5 recovery refuses redirected scratch directory");
  }
}

async function localInventory(notes:string){
  // The common Obsidian scanner intentionally skips .obsidian, but synthetic
  // notes are a flat Scratch folder: omissions must never look complete.
  if((await readdir(notes)).some(name=>name.toLowerCase()===".obsidian")){
    throw Error("M5 recovery local inventory is incomplete");
  }
  const local=await readObsidianLocalManifest(notes);
  if(local.unsupportedMarkdownFiles||local.otherFiles||local.directoriesNotScanned){
    throw Error("M5 recovery local inventory is incomplete");
  }
  return local.fingerprints;
}

export async function inspectSyntheticCrossProcessRecovery(args:{
  scratchPath:string;
  remoteSnapshot:RemoteSnapshot;
}):Promise<SyntheticCrossProcessRecoveryReport>{
  if(!args||typeof args.scratchPath!=="string"){
    throw Error("M5 recovery requires a synthetic scratch path");
  }
  const root=path.resolve(args.scratchPath);
  if(path.dirname(root).toLowerCase()!==path.resolve(tmpdir()).toLowerCase()||
     !SCRATCH_NAME.test(path.basename(root))){
    throw Error("M5 recovery is restricted to direct OS-temp synthetic workspaces");
  }
  const snapshot=args.remoteSnapshot;
  if(!snapshot||snapshot.fullInventory!==true||
     !Array.isArray(snapshot.fingerprints)||
     !Number.isSafeInteger(snapshot.numberOfNotes)||
     snapshot.numberOfNotes!==snapshot.fingerprints.length||
     Object.keys(snapshot).sort().join(",")!=="fingerprints,fullInventory,numberOfNotes"||
     snapshot.fingerprints.some(item=>!item||typeof item.revision!=="string")){
    throw Error("M5 recovery requires an explicit complete remote fingerprint snapshot");
  }
  // Validate before touching files: disallow Markdown, JWT or extra fields.
  planObsidianReconciliation({local:[],remote:snapshot.fingerprints,baseline:[]});
  const remote:SyncFingerprint[]=snapshot.fingerprints.map(item=>({...item}));
  const notes=path.join(root,"notes");
  const journal=path.join(root,"baseline-journal");
  await Promise.all([root,notes,journal].map(realDirectory));
  const firstLocal=await localInventory(notes);
  planObsidianReconciliation({local:firstLocal,remote,baseline:[]});
  const firstEvents=await readSyntheticBaselineJournalDirectory(journal);
  const grouped=new Map<string,SyntheticBaselineCheckpoint[]>();
  for(const item of firstEvents){
    const prior=grouped.get(item.slug)??[];
    prior.push(item);
    grouped.set(item.slug,prior);
  }
  const localMap=new Map(firstLocal.map(item=>[item.slug,item.sha256]));
  const remoteMap=new Map(remote.map(item=>[item.slug,item]));
  const allSlugs=[...new Set([...grouped.keys(),...localMap.keys(),...remoteMap.keys()])].sort();
  const report:SyntheticCrossProcessRecoveryReport["notes"]=[];
  for(const slug of allSlugs){
    const records=grouped.get(slug)??[];
    if(records.length!==1){
      report.push({slug,checkpointCount:records.length,status:
        records.length?"ambiguous-history":"missing-journal-evidence"});
      continue;
    }
    const checkpoint=records[0];
    const localMatches=localMap.get(slug)===checkpoint.sha256;
    const remoteFp=remoteMap.get(slug);
    const remoteMatches=remoteFp?.sha256===checkpoint.sha256&&
      remoteFp.revision===checkpoint.remoteRevision;
    const status:RecoveryStatus=localMatches&&remoteMatches
      ?"matches-provided-snapshot":localMatches?"changed-remote"
      :remoteMatches?"changed-local":"changed-both";
    report.push({slug,checkpointCount:1,status});
  }
  // No filename, journal receipt, or local SHA may change during inspection.
  const finalLocal=await localInventory(notes);
  const finalEvents=await readSyntheticBaselineJournalDirectory(journal);
  if(JSON.stringify(finalLocal)!==JSON.stringify(firstLocal)||
     JSON.stringify(finalEvents)!==JSON.stringify(firstEvents)){
    throw Error("M5 recovery sources changed during read-only inspection");
  }
  return {
    notes:report,syntheticOnly:true,authenticatedRemoteEvidence:false,
    baselineImported:false,writeAllowed:false,deleteAllowed:false,
    manualReviewRequired:true,
  };
}
