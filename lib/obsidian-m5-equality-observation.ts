/**
 * M5: durable READ-ONLY observation of notes currently equal on both sides.
 * The sole live caller uses the registered MSI Vault reader + Sandbox Owner-RLS
 * full inventory. An equality observation is NOT proof of a previous transfer,
 * an approved sync, or an authoritative Baseline.
 */
import {randomUUID} from "node:crypto";
import {lstat,open,readFile,realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import type {ManualReviewPreview} from "./obsidian-manual-sync-review.ts";

type Entry={slug:string;sha256:string;revision:string};
type Observation={
  format:"naosledge.m5.equal-sources-observation.v1";
  source:"registered-msi-vault-and-sandbox-owner-rls-m1";
  entries:Entry[];
  baselineSaved:false;
};
const FORMAT="naosledge.m5.equal-sources-observation.v1";
const SOURCE="registered-msi-vault-and-sandbox-owner-rls-m1";
const SHA=/^[0-9a-f]{64}$/;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FILE=/^naosledge-m5-observation-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/;

function currentEqualEntries(preview:ManualReviewPreview):Entry[]{
  if(preview?.sandboxOnly!==true||preview.readOnly!==true||
     preview.manualTriggerOnly!==true||preview.autoApplyAllowed!==false||
     preview.baselinePersisted!==false||
     preview.automaticSyncEnabled!==false||
     preview.automaticDeleteEnabled!==false||
     preview.previewStatus!=="ready"||
     preview.inventory?.remoteFullInventory!==true||
     preview.inventory?.localCoverageNeedsReview!==false||
     preview.inventory.localUnsupportedMarkdown!==0||
     preview.inventory.localDirectoriesNotScanned!==0||
     !Array.isArray(preview.decisions)){
    throw new Error("M5 requires complete, authorized read-only inventories");
  }
  const entries=preview.decisions.filter(d=>d.choice==="unchanged").map(d=>({
    slug:d.slug,sha256:d.expectedLocalSha!,revision:d.expectedRemoteRevision!,
  }));
  if(entries.length===0||entries.length>20||
     entries.length!==preview.summary.unchanged||
     entries.some(e=>!SLUG.test(e.slug)||e.slug.length>120||
       !SHA.test(e.sha256)||!SHA.test(e.revision))||
     new Set(entries.map(e=>e.slug)).size!==entries.length||
     preview.decisions.some(d=>d.choice==="unchanged"&&(
       d.manualReview!==false||d.expectedLocalSha!==d.expectedRemoteSha))){
    throw new Error("M5 has no complete, versioned two-source equality to inspect");
  }
  return entries.sort((a,b)=>a.slug.localeCompare(b.slug,"en"));
}

function validateObservation(value:unknown):Observation{
  if(!value||typeof value!=="object"||Array.isArray(value)){
    throw new Error("M5 observation metadata is invalid");
  }
  const r=value as Record<string,unknown>;
  if(Object.keys(r).length!==4||r.format!==FORMAT||r.source!==SOURCE||
     r.baselineSaved!==false||!Array.isArray(r.entries)||
     r.entries.length<1||r.entries.length>20){
    throw new Error("M5 observation metadata is invalid");
  }
  const entries=r.entries as unknown[];
  if(entries.some(e=>!e||typeof e!=="object"||Array.isArray(e)||
    Object.keys(e).length!==3||
    !["slug","sha256","revision"].every(k=>Object.hasOwn(e,k))||
    typeof (e as Entry).slug!=="string"||
    (e as Entry).slug.length>120||!SLUG.test((e as Entry).slug)||
    typeof (e as Entry).sha256!=="string"||!SHA.test((e as Entry).sha256)||
    typeof (e as Entry).revision!=="string"||!SHA.test((e as Entry).revision))||
    entries.some((e,i)=>i>0&&
      (entries[i-1] as Entry).slug.localeCompare((e as Entry).slug,"en")>=0)){
    throw new Error("M5 observation entries are malformed or duplicated");
  }
  return r as Observation;
}

export async function saveM5EqualSourceObservation(
  preview:ManualReviewPreview,
):Promise<{path:string;observedNotes:number;baselineSaved:false}>{
  const entries=currentEqualEntries(preview);
  const document:Observation={
    format:FORMAT,source:SOURCE,entries,baselineSaved:false,
  };
  const data=Buffer.from(JSON.stringify(document),"utf8");
  const file=path.join(await realpath(tmpdir()),
    "naosledge-m5-observation-"+randomUUID()+".json");
  const handle=await open(file,"wx",0o600);
  try{
    await handle.writeFile(data);
    await handle.sync();
  }finally{
    await handle.close();
  }
  if(!(await readFile(file)).equals(data)){
    throw new Error("M5 observation persistence could not be verified");
  }
  return {path:file,observedNotes:entries.length,baselineSaved:false};
}

export async function reverifyM5EqualSourceObservation(
  filePath:string,preview:ManualReviewPreview,
):Promise<{stillEqualNotes:number;baselineSaved:false;scope:"fresh-two-source-observation-only"}>{
  // Reject arbitrary paths, symlinks and notes from outside per-user scratch.
  if(typeof filePath!=="string"||filePath.length>4096)throw Error("M5 invalid observation path");
  const root=await realpath(tmpdir());
  const file=path.resolve(filePath);
  if(path.dirname(file).toLowerCase()!==root.toLowerCase()||
     !FILE.test(path.basename(file))){
    throw new Error("M5 observation must be a separate scratch file");
  }
  const stat=await lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>5000){
    throw new Error("M5 observation file is not a bounded ordinary file");
  }
  const raw=await readFile(file);
  const afterRead=await lstat(file);
  if(afterRead.ino!==stat.ino||afterRead.size!==stat.size||
     afterRead.mtimeMs!==stat.mtimeMs||!afterRead.isFile()||
     afterRead.isSymbolicLink()||afterRead.nlink!==1){
    throw new Error("M5 observation file changed during read");
  }
  let parsed:unknown;
  try{parsed=JSON.parse(raw.toString("utf8")) as unknown;}
  catch{throw new Error("M5 observation JSON is invalid");}
  const evidence=validateObservation(parsed);
  if(JSON.stringify(evidence)!==raw.toString("utf8")){
    throw new Error("M5 observation bytes are not canonical");
  }
  // Fresh MSI Vault scan + fresh Owner-RLS full GET (supplied by CLI) determine
  // CURRENT equality. Self-authored historic JSON cannot confer authority.
  const current=currentEqualEntries(preview);
  const bySlug=new Map(current.map(row=>[row.slug,row]));
  if(evidence.entries.some(row=>{
    const now=bySlug.get(row.slug);
    return !now||now.sha256!==row.sha256||now.revision!==row.revision;
  })){
    throw new Error("M5 current local/remote sources disagree with the observation");
  }
  const final=await lstat(file);
  if(final.ino!==stat.ino||final.size!==stat.size||
     final.mtimeMs!==stat.mtimeMs||final.nlink!==1||
     !(await readFile(file)).equals(raw)){
    throw new Error("M5 observation file changed during verification");
  }
  return {stillEqualNotes:evidence.entries.length,baselineSaved:false,
    scope:"fresh-two-source-observation-only"};
}
