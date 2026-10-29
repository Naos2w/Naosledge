/**
 * M8 Production-only, Owner-bound, Windows DPAPI/HMAC durable baseline.
 *
 * Distinct from the M5 SANDBOX journal: no Sandbox branch, key or record is
 * accepted. This is a standalone opt-in data model, NOT an auto-sync service.
 *
 * Initial pairing requires two CURRENT complete Owner-RLS inventories and
 * two CURRENT local manifests to match EXACTLY; missing/unknown files are
 * never adopted. Later upload receipts are appended only after independent
 * remote and local readback of the exact final SHA/revision. No transfer is
 * executed by this module, and no raw note body, path, JWT or secret is stored.
 *
 * A lock created with wx is intentionally NOT recovered automatically after
 * a process crash: an abandoned lock or partial record stops all writes until
 * a separate operator-led recovery. Threat boundary remains the Windows user.
 */
import {createHmac,randomBytes,timingSafeEqual} from "node:crypto";
import {homedir,hostname,tmpdir} from "node:os";
import {lstat,mkdir,open,readFile,readdir,realpath,unlink}
  from "node:fs/promises";
import path from "node:path";
import {validateProductionOwnerJwt} from "./obsidian-m7-production-owner-readonly.ts";
import {fetchProductionOwnerRlsFingerprints}
  from "./obsidian-m8-production-inventory-readonly.ts";
import {RELEASE_NEON_BRANCH} from "./neon/production-release.ts";
import {windowsM5KeyProtector} from "./obsidian-m5-owner-baseline-journal.ts";
import {readObsidianLocalManifest,type ReadOnlyLocalManifest}
  from "./obsidian-local-manifest.ts";
import {planAutomaticObsidianSync,
  type AutoSyncRemoteSnapshot} from "./obsidian-auto-sync-policy.ts";
import {verifyMsiVaultRegistration,APPROVED_MSI_VAULT}
  from "./obsidian-m4-local-apply.ts";
import type {SyncFingerprint} from "./obsidian-sync-plan.ts";

const FORMAT="naosledge.m8.production.owner-baseline.v1";
const ENVELOPE_FORMAT="naosledge.m8.production.dpapi-key.v1";
const ROOT="m8-production-baseline";
const TEST_PREFIX="naosledge-m8-production-baseline-test-";
const KEYFILE="identity.dpapi";
const RECORDS="records";
const LOCK="journal.lock";
const GENESIS="0".repeat(64);
const MAX_RECORDS=500;
// 500 initial fingerprints with maximal 120-char slugs may exceed 64 KiB.
const MAX_RECORD_BYTES=250_000;
const SHA=/^[a-f0-9]{64}$/;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OWNER=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

export type ProductionM8KeyProtector={
  seal:(key:Buffer)=>Promise<string>;
  unseal:(sealed:string)=>Promise<Buffer>;
};
export type ProductionM8JournalOptions={
  /** Injection is restricted to an actual OS TEMP directory for tests. */
  testRoot?:string;
  testProtector?:ProductionM8KeyProtector;
  /** Only allowed together with testRoot AND testProtector. */
  testReadLocal?:()=>Promise<ReadOnlyLocalManifest>;
};
type EventBase={
  format:typeof FORMAT;
  seq:number;previousMac:string;branch:typeof RELEASE_NEON_BRANCH;
  ownerId:string;createdAt:string;
};
type Initial=EventBase&{
  kind:"approved-initial-pairing";
  notes:SyncFingerprint[];
};
type Upload=EventBase&{
  kind:"verified-upload";
  slug:string;previousSha256:string|null;
  previousRevision:string|null;
  sha256:string;remoteRevision:string;
};
type ManualRecovery=EventBase&{
  kind:"approved-checkpoint-recovery";
  slug:string;previousSha256:string|null;
  previousRevision:string|null;
  sha256:string;remoteRevision:string;
};
type Event=Initial|Upload|ManualRecovery;
type Signed=Event&{mac:string};
type Loaded={key:Buffer;events:Signed[];latest:Map<string,SyncFingerprint>};
function reject():never{
  throw Error("M8 Production baseline unavailable; no automatic sync");
}
function plainHash(x:unknown):x is string{
  return typeof x==="string"&&SHA.test(x);
}
function validSlug(x:unknown):x is string{
  return typeof x==="string"&&x.length>=3&&x.length<=120&&SLUG.test(x);
}
function allowedRoot(options?:ProductionM8JournalOptions){
  if(options&&Object.keys(options).some(key=>
    !["testRoot","testProtector","testReadLocal"].includes(key)))reject();
  if(options?.testRoot!==undefined||
     options?.testProtector!==undefined||
     options?.testReadLocal!==undefined){
    const root=options?.testRoot;
    if(typeof root!=="string"||!path.isAbsolute(root)||
       path.resolve(path.dirname(root)).toLowerCase()!==
         path.resolve(tmpdir()).toLowerCase()||
       !path.basename(root).startsWith(TEST_PREFIX)||
       !/^[a-z0-9-]+$/i.test(path.basename(root))||
       typeof options?.testProtector?.seal!=="function"||
       typeof options?.testProtector?.unseal!=="function"||
       typeof options?.testReadLocal!=="function"){
      reject();
    }
    return {root:path.resolve(root),protector:options.testProtector,
      readLocal:options.testReadLocal,testOnly:true};
  }
  if(process.platform!=="win32"||
     hostname().trim().toUpperCase()!=="MSI")reject();
  const base=process.env.LOCALAPPDATA||
    path.join(homedir(),"AppData","Local");
  if(!path.isAbsolute(base))reject();
  return {
    root:path.join(base,"Naosledge",ROOT),
    protector:windowsM5KeyProtector,
    readLocal:async()=>{
      await verifyMsiVaultRegistration();
      return readObsidianLocalManifest(APPROVED_MSI_VAULT);
    },
    testOnly:false,
  };
}
async function safeFolder(folder:string){
  const st=await lstat(folder);
  if(!st.isDirectory()||st.isSymbolicLink()||
     path.normalize(await realpath(folder)).toLowerCase()!==
       path.normalize(folder).toLowerCase())reject();
}
async function existingRoot(root:string):Promise<boolean>{
  try{await safeFolder(root);return true;}
  catch(e){
    if((e as NodeJS.ErrnoException).code==="ENOENT")return false;
    throw e;
  }
}
async function makeRoot(root:string,testOnly:boolean):Promise<void>{
  if(testOnly){
    await safeFolder(root);
    return;
  }
  // Parent Naosledge is under LocalAppData, never under an Obsidian Vault.
  const parent=path.dirname(root);
  await safeFolder(path.dirname(parent));
  try{await mkdir(parent,{mode:0o700});}catch(e){
    if((e as NodeJS.ErrnoException).code!=="EEXIST")reject();
  }
  await safeFolder(parent);
  try{await mkdir(root,{mode:0o700});}catch(e){
    if((e as NodeJS.ErrnoException).code!=="EEXIST")reject();
  }
  await safeFolder(root);
}
async function readSmall(file:string,max:number):Promise<Buffer>{
  const st=await lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||
     st.size<1||st.size>max)reject();
  const bytes=await readFile(file);
  const after=await lstat(file);
  if(after.ino!==st.ino||after.size!==st.size||
     after.mtimeMs!==st.mtimeMs||bytes.length!==st.size)reject();
  return bytes;
}
async function exclusive(file:string,bytes:Buffer):Promise<void>{
  const handle=await open(file,"wx",0o600);
  try{
    await handle.writeFile(bytes);
    await handle.sync();
  }finally{await handle.close();}
  if(!(await readSmall(file,Math.max(100,bytes.length+1))).equals(bytes))reject();
}
async function lock<T>(root:string,task:()=>Promise<T>):Promise<T>{
  const filename=path.join(root,LOCK);
  let handle;
  try{handle=await open(filename,"wx",0o600);}catch{reject();}
  const before=await handle.stat();
  try{
    await handle.writeFile("m8-production-owner-exclusive");
    await handle.sync();
    return await task();
  }finally{
    await handle.close();
    // Never unlink a changed lock. An abandoned lock is manual recovery.
    let current;
    try{current=await lstat(filename);}catch{reject();}
    if(!current.isFile()||current.isSymbolicLink()||
       current.ino!==before.ino)reject();
    await unlink(filename);
  }
}
function orderedEntryKeys(row:Record<string,unknown>):boolean{
  const base=["format","seq","previousMac","branch","ownerId","createdAt","kind"];
  const extra=row.kind==="approved-initial-pairing"?["notes"]:
    ["verified-upload","approved-checkpoint-recovery"].includes(String(row.kind))?
      ["slug","previousSha256","previousRevision","sha256","remoteRevision"]:[];
  return JSON.stringify(Object.keys(row))===JSON.stringify([...base,...extra]);
}
function validateEntry(value:unknown,seq:number,prev:string,ownerId:string):Event{
  if(!value||typeof value!=="object"||Array.isArray(value))reject();
  const row=value as Record<string,unknown>;
  if(!orderedEntryKeys(row)||
     row.format!==FORMAT||row.seq!==seq||row.previousMac!==prev||
     row.branch!==RELEASE_NEON_BRANCH||row.ownerId!==ownerId||
     typeof row.createdAt!=="string"||
     !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.createdAt)||
     !Number.isFinite(Date.parse(row.createdAt)))reject();
  if(row.kind==="approved-initial-pairing"){
    if(seq!==1||!Array.isArray(row.notes)||row.notes.length>500)reject();
    try{
      planAutomaticObsidianSync({
        local:{
          fingerprints:row.notes,unsupportedMarkdownFiles:0,
          otherFiles:0,directoriesNotScanned:0,autoApplyAllowed:false,
        },
        remote:{
          branchId:RELEASE_NEON_BRANCH,fingerprints:row.notes,
          numberOfNotes:row.notes.length,fullInventory:true,
          ownerRlsVerified:true,writeEnabled:false,
        },
        baseline:row.notes,
        trust:{
          initialPairingApproved:false,durableBaselineVerified:false,
          ownerSessionFresh:true,productionSchemaReady:false,
        },
      });
    }catch{reject();}
    const n=row.notes as SyncFingerprint[];
    if(n.some((x,i)=>!plainHash(x.revision)||
       (i>0&&n[i-1].slug>=x.slug)))reject();
  }else if(row.kind==="verified-upload"||
           row.kind==="approved-checkpoint-recovery"){
    if(!validSlug(row.slug)||!plainHash(row.sha256)||
       !plainHash(row.remoteRevision)||
       (row.previousSha256===null)!==(row.previousRevision===null)||
       (row.previousSha256!==null&&
         (!plainHash(row.previousSha256)||!plainHash(row.previousRevision)))||
       (row.kind==="verified-upload"&&row.previousSha256===row.sha256)||
       (row.kind==="approved-checkpoint-recovery"&&
         row.previousSha256===row.sha256&&
         row.previousRevision===row.remoteRevision))reject();
  }else reject();
  return row as Event;
}
function hmac(key:Buffer,event:Event):string{
  return createHmac("sha256",key).update(JSON.stringify(event)).digest("hex");
}
async function load(root:string,ownerId:string,protector:ProductionM8KeyProtector):
Promise<Loaded|null>{
  const names=(await readdir(root)).sort();
  if(names.length===0||names.length===1&&names[0]===LOCK)return null;
  if(JSON.stringify(names)!==JSON.stringify([KEYFILE,RECORDS].sort())&&
     JSON.stringify(names)!==JSON.stringify([KEYFILE,RECORDS,LOCK].sort()))reject();
  const keyEnvelope=await readSmall(path.join(root,KEYFILE),8192);
  let metadata:unknown;
  try{metadata=JSON.parse(keyEnvelope.toString("utf8")) as unknown;}
  catch{reject();}
  const keyMeta=metadata as {format?:unknown;branch?:unknown;sealed?:unknown};
  if(!keyMeta||typeof keyMeta!=="object"||
     JSON.stringify(Object.keys(keyMeta))!==JSON.stringify(["format","branch","sealed"])||
     keyMeta.format!==ENVELOPE_FORMAT||keyMeta.branch!==RELEASE_NEON_BRANCH||
     typeof keyMeta.sealed!=="string"||keyMeta.sealed.length>8000||
     !/^[A-Za-z0-9+/=]+$/.test(keyMeta.sealed)||
     JSON.stringify(keyMeta)!==keyEnvelope.toString("utf8"))reject();
  let key:Buffer;
  try{key=await protector.unseal(keyMeta.sealed);}catch{reject();}
  if(!Buffer.isBuffer(key)||key.length!==32)reject();
  await safeFolder(path.join(root,RECORDS));
  const files=(await readdir(path.join(root,RECORDS))).sort();
  if(files.length===0||files.length>MAX_RECORDS||
     files.some((name,i)=>name!==String(i+1).padStart(6,"0")+".json"))reject();
  const events:Signed[]=[];
  const latest=new Map<string,SyncFingerprint>();
  let previous=GENESIS;
  for(let i=0;i<files.length;i++){
    const bytes=await readSmall(path.join(root,RECORDS,files[i]),MAX_RECORD_BYTES);
    let data:unknown;
    try{data=JSON.parse(bytes.toString("utf8")) as unknown;}catch{reject();}
    if(!data||typeof data!=="object"||Array.isArray(data))reject();
    const signed=data as Record<string,unknown>;
    if(Object.keys(signed).at(-1)!=="mac"||!plainHash(signed.mac))reject();
    const {mac:signature,...unsigned}=signed;
    const event=validateEntry(unsigned,i+1,previous,ownerId);
    if(bytes.toString("utf8")!==JSON.stringify({...event,mac:signature}))reject();
    const expected=hmac(key,event);
    if(!timingSafeEqual(Buffer.from(expected,"hex"),
      Buffer.from(signature as string,"hex")))reject();
    if(event.kind==="approved-initial-pairing"){
      if(i!==0)reject();
      for(const note of event.notes)latest.set(note.slug,{...note});
    }else{
      if(i===0)reject();
      const before=latest.get(event.slug);
      if((before?.sha256??null)!==event.previousSha256||
         (before?.revision??null)!==event.previousRevision)reject();
      latest.set(event.slug,{
        slug:event.slug,sha256:event.sha256,
        revision:event.remoteRevision,
      });
    }
    events.push({...event,mac:signature as string});
    previous=signature as string;
  }
  if((await readdir(path.join(root,RECORDS))).length!==files.length)reject();
  return {key,events,latest};
}
async function initialize(root:string,protector:ProductionM8KeyProtector):
Promise<Buffer>{
  if((await readdir(root)).filter(x=>x!==LOCK).length)reject();
  const key=randomBytes(32);
  const sealed=await protector.seal(key);
  if(typeof sealed!=="string"||sealed.length>8000||
     !/^[A-Za-z0-9+/=]+$/.test(sealed))reject();
  const envelope=Buffer.from(JSON.stringify({
    format:ENVELOPE_FORMAT,branch:RELEASE_NEON_BRANCH,sealed,
  }));
  await exclusive(path.join(root,KEYFILE),envelope);
  await mkdir(path.join(root,RECORDS),{mode:0o700});
  await safeFolder(path.join(root,RECORDS));
  return key;
}
async function append(root:string,key:Buffer,event:Event):Promise<void>{
  const record=Buffer.from(JSON.stringify({...event,mac:hmac(key,event)}));
  await exclusive(path.join(root,RECORDS,
    String(event.seq).padStart(6,"0")+".json"),record);
}
const EMPTY_TRUST={
  initialPairingApproved:false,durableBaselineVerified:false,
  ownerSessionFresh:true,productionSchemaReady:false,
};
function validateLocal(value:ReadOnlyLocalManifest,remote:AutoSyncRemoteSnapshot){
  const plan=planAutomaticObsidianSync({
    local:value,remote,baseline:[],trust:EMPTY_TRUST,
  });
  if(value.unsupportedMarkdownFiles!==0||
     value.directoriesNotScanned!==0||plan.state!=="blocked")reject();
  return value.fingerprints;
}
async function remote(args:{
  jwt:string;fetcher?:typeof fetch;
}):Promise<AutoSyncRemoteSnapshot>{
  return fetchProductionOwnerRlsFingerprints({
    branchId:RELEASE_NEON_BRANCH,jwt:args.jwt,fetcher:args.fetcher,
  });
}
function verifiedOwner(jwt:string):string{
  const owner=validateProductionOwnerJwt(jwt);
  if(!OWNER.test(owner))reject();
  return owner;
}
export type M8ProductionBaselineStatus={
  paired:boolean;
  branch:typeof RELEASE_NEON_BRANCH;
  recordCount:number;
  fingerprints:SyncFingerprint[];
  durableBaselineVerified:boolean;
  automaticTransfersEnabled:false;
};
/** No filesystem creation, no raw JWT or note bodies. */
export async function inspectProductionM8Baseline(args:{
  ownerJwt:string;fetcher?:typeof fetch;options?:ProductionM8JournalOptions;
}):Promise<M8ProductionBaselineStatus>{
  const ownerId=verifiedOwner(args?.ownerJwt);
  const deps=allowedRoot(args.options);
  await remote({jwt:args.ownerJwt,fetcher:args.fetcher});
  if(!await existingRoot(deps.root)){
    return {paired:false,branch:RELEASE_NEON_BRANCH,
      recordCount:0,fingerprints:[],durableBaselineVerified:false,
      automaticTransfersEnabled:false};
  }
  const names=await readdir(deps.root);
  if(names.includes(LOCK))reject();
  const state=await load(deps.root,ownerId,deps.protector);
  return {
    paired:state!==null,branch:RELEASE_NEON_BRANCH,
    recordCount:state?.events.length??0,
    fingerprints:[...(state?.latest.values()??[])].sort(
      (a,b)=>a.slug.localeCompare(b.slug,"en")),
    durableBaselineVerified:state!==null,
    automaticTransfersEnabled:false,
  };
}
/**
 * Explicit first pairing: only a complete, equal and stable two-sided
 * inventory is admissible. An empty pair is valid but never auto-approved.
 * Tests inject OS TEMP local manifests; real MSI always checks registration.
 */
export async function adoptProductionM8EqualPairing(args:{
  ownerJwt:string;
  typedConfirmation:string;
  fetcher?:typeof fetch;
  options?:ProductionM8JournalOptions;
}):Promise<{
  paired:true;recordCount:1;autoSyncEnabled:false;
  initialNoteCount:number;
}>{
  const ownerId=verifiedOwner(args?.ownerJwt);
  if(args.typedConfirmation!=="APPROVE M8 PRODUCTION INITIAL EQUALITY")reject();
  const deps=allowedRoot(args.options);
  const localBefore=await deps.readLocal();
  const remoteBefore=await remote({jwt:args.ownerJwt,fetcher:args.fetcher});
  const localFingerprints=validateLocal(localBefore,remoteBefore);
  // Local SHA inventory intentionally has NO remote revision; matching is
  // defined by identical slug+portable Markdown SHA, not object JSON shape.
  if(localFingerprints.length!==remoteBefore.fingerprints.length||
     localFingerprints.some((item,i)=>
       item.slug!==remoteBefore.fingerprints[i].slug||
       item.sha256!==remoteBefore.fingerprints[i].sha256))reject();
  const originalLocal=JSON.stringify(localBefore);
  await makeRoot(deps.root,deps.testOnly);
  return lock(deps.root,async()=>{
    if(await load(deps.root,ownerId,deps.protector))reject();
    const localAfter=await deps.readLocal();
    const remoteAfter=await remote({jwt:args.ownerJwt,fetcher:args.fetcher});
    validateLocal(localAfter,remoteAfter);
    if(JSON.stringify(localAfter)!==originalLocal||
       JSON.stringify(remoteAfter.fingerprints)!==
         JSON.stringify(remoteBefore.fingerprints))reject();
    const key=await initialize(deps.root,deps.protector);
    const event:Initial={
      format:FORMAT,seq:1,previousMac:GENESIS,
      branch:RELEASE_NEON_BRANCH,ownerId,
      createdAt:new Date().toISOString(),
      kind:"approved-initial-pairing",
      notes:remoteAfter.fingerprints.map(note=>({...note})),
    };
    await append(deps.root,key,event);
    const state=await load(deps.root,ownerId,deps.protector);
    if(!state||state.events.length!==1||state.latest.size!==event.notes.length)reject();
    return {paired:true,recordCount:1,autoSyncEnabled:false,
      initialNoteCount:event.notes.length};
  });
}

/**
 * Record an already independently verified Production create/CAS receipt.
 * This does NOT invoke any transfer. Rechecks BOTH sides twice while holding
 * an exclusive cross-process journal lock and fails closed if they move.
 * A verified remote POST is not enough: exact local SHA must still agree.
 */
export async function recordVerifiedProductionM8Upload(args:{
  ownerJwt:string;
  receipt:{
    slug:string;sha256:string;revision:string;
    verifiedRemoteReadback:true;baselineSaved:false;
    automaticRetryAllowed:false;
  };
  beforeSha256:string|null;
  beforeRevision:string|null;
  fetcher?:typeof fetch;
  options?:ProductionM8JournalOptions;
}):Promise<{checkpointSaved:true;recordCount:number;autoSyncEnabled:false}>{
  const ownerId=verifiedOwner(args?.ownerJwt);
  const receipt=args?.receipt?{...args.receipt}:undefined;
  if(!receipt||!validSlug(receipt.slug)||!plainHash(receipt.sha256)||
     !plainHash(receipt.revision)||
     receipt.verifiedRemoteReadback!==true||
     receipt.baselineSaved!==false||
     receipt.automaticRetryAllowed!==false||
     (args.beforeSha256===null)!==(args.beforeRevision===null)||
     (args.beforeSha256!==null&&
       (!plainHash(args.beforeSha256)||!plainHash(args.beforeRevision)))||
     args.beforeSha256===receipt.sha256)reject();
  const deps=allowedRoot(args.options);
  if(!await existingRoot(deps.root))reject();
  return lock(deps.root,async()=>{
    const state=await load(deps.root,ownerId,deps.protector);
    if(!state||state.events.length>=MAX_RECORDS)reject();
    const prior=state.latest.get(receipt.slug);
    if((prior?.sha256??null)!==args.beforeSha256||
       (prior?.revision??null)!==args.beforeRevision)reject();

    const localBefore=await deps.readLocal();
    const remoteBefore=await remote({jwt:args.ownerJwt,fetcher:args.fetcher});
    const l=validateLocal(localBefore,remoteBefore).find(x=>x.slug===receipt.slug);
    const r=remoteBefore.fingerprints.find(x=>x.slug===receipt.slug);
    if(!l||!r||l.sha256!==receipt.sha256||
       r.sha256!==receipt.sha256||r.revision!==receipt.revision)reject();
    const localSnapshot=JSON.stringify(localBefore);
    const remoteSnapshot=JSON.stringify(remoteBefore);
    const localAfter=await deps.readLocal();
    const remoteAfter=await remote({jwt:args.ownerJwt,fetcher:args.fetcher});
    validateLocal(localAfter,remoteAfter);
    if(JSON.stringify(localAfter)!==localSnapshot||
       JSON.stringify(remoteAfter)!==remoteSnapshot)reject();

    const event:Upload={
      format:FORMAT,seq:state.events.length+1,
      previousMac:state.events.at(-1)!.mac,
      branch:RELEASE_NEON_BRANCH,ownerId,
      createdAt:new Date().toISOString(),kind:"verified-upload",
      slug:receipt.slug,previousSha256:args.beforeSha256,
      previousRevision:args.beforeRevision,
      sha256:receipt.sha256,remoteRevision:receipt.revision,
    };
    await append(deps.root,state.key,event);
    const reloaded=await load(deps.root,ownerId,deps.protector);
    if(!reloaded||reloaded.events.length!==event.seq||
       reloaded.latest.get(event.slug)?.sha256!==receipt.sha256||
       reloaded.latest.get(event.slug)?.revision!==receipt.revision)reject();
    return {checkpointSaved:true,recordCount:event.seq,autoSyncEnabled:false};
  });
}

/**
 * Explicit human recovery when both CURRENT sides agree but an earlier
 * successful Production write was not appended to M5 (e.g. process crash).
 * NO remote mutation and NO automatic adoption: requires a fresh typed
 * approval, the owner-bound existing journal and two identical rechecks.
 */
export async function manuallyRecoverProductionM8Checkpoint(args:{
  ownerJwt:string;
  slug:string;
  expectedSha256:string;
  expectedRevision:string;
  typedConfirmation:string;
  fetcher?:typeof fetch;
  options?:ProductionM8JournalOptions;
}):Promise<{checkpointRecovered:true;recordCount:number;autoSyncEnabled:false}>{
  const ownerId=verifiedOwner(args?.ownerJwt);
  if(!validSlug(args?.slug)||!plainHash(args?.expectedSha256)||
     !plainHash(args?.expectedRevision)||
     args.typedConfirmation!==
       "RECOVER M8 PRODUCTION "+args.slug+" "+args.expectedSha256.slice(0,12))reject();
  const deps=allowedRoot(args.options);
  if(!await existingRoot(deps.root))reject();
  return lock(deps.root,async()=>{
    const state=await load(deps.root,ownerId,deps.protector);
    if(!state||state.events.length>=MAX_RECORDS)reject();
    const prior=state.latest.get(args.slug);
    if(prior?.sha256===args.expectedSha256&&
       prior?.revision===args.expectedRevision)reject();
    const localBefore=await deps.readLocal();
    const remoteBefore=await remote({jwt:args.ownerJwt,fetcher:args.fetcher});
    const localSha=validateLocal(localBefore,remoteBefore)
      .find(n=>n.slug===args.slug);
    const remoteNote=remoteBefore.fingerprints.find(n=>n.slug===args.slug);
    if(!localSha||!remoteNote||
       localSha.sha256!==args.expectedSha256||
       remoteNote.sha256!==args.expectedSha256||
       remoteNote.revision!==args.expectedRevision)reject();
    const frozenLocal=JSON.stringify(localBefore);
    const frozenRemote=JSON.stringify(remoteBefore);
    const localAfter=await deps.readLocal();
    const remoteAfter=await remote({jwt:args.ownerJwt,fetcher:args.fetcher});
    validateLocal(localAfter,remoteAfter);
    if(JSON.stringify(localAfter)!==frozenLocal||
       JSON.stringify(remoteAfter)!==frozenRemote)reject();
    const event:ManualRecovery={
      format:FORMAT,seq:state.events.length+1,
      previousMac:state.events.at(-1)!.mac,
      branch:RELEASE_NEON_BRANCH,ownerId,
      createdAt:new Date().toISOString(),
      kind:"approved-checkpoint-recovery",
      slug:args.slug,previousSha256:prior?.sha256??null,
      previousRevision:prior?.revision??null,
      sha256:args.expectedSha256,remoteRevision:args.expectedRevision,
    };
    await append(deps.root,state.key,event);
    const final=await load(deps.root,ownerId,deps.protector);
    if(!final||final.events.length!==event.seq||
       final.latest.get(args.slug)?.sha256!==args.expectedSha256||
       final.latest.get(args.slug)?.revision!==args.expectedRevision)reject();
    return {
      checkpointRecovered:true,recordCount:event.seq,
      autoSyncEnabled:false,
    };
  });
}
