/**
 * M5: a locally durable, owner-approved INITIAL common baseline.
 *
 * This is NOT evidence of an earlier successful transfer. The only accepted
 * event is explicit per-note adoption of two CURRENT, separately rechecked
 * read-only source inventories. It never writes a Vault note or Neon record.
 *
 * Windows DPAPI seals a random local HMAC key to the current Windows user.
 * The journal is chained, append-only and reverified from disk on each use.
 * A malicious process running as the SAME Windows user (or rollback of the
 * whole user profile) remains outside this local-integrity trust boundary.
 */
import {createHmac,randomBytes,timingSafeEqual} from "node:crypto";
import {spawn} from "node:child_process";
import {homedir,hostname,tmpdir} from "node:os";
import {lstat,mkdir,open,readFile,readdir,realpath,unlink} from "node:fs/promises";
import path from "node:path";
import {previewApprovedMsiSandboxSync,readApprovedMsiCanonicalMarkdown}
  from "./obsidian-manual-sync-approved-msi.ts";
import {parseManualM3UploadIntent} from "./obsidian-m2-review-choices.ts";
import {createNeonSandboxNoteOnly} from "./obsidian-neon-sandbox-create.ts";
import {updateNeonSandboxNoteIfUnchanged} from "./obsidian-neon-sandbox-update.ts";
import type {SyncDecision} from "./obsidian-sync-plan.ts";
import {NEON_SYNC_SANDBOX_BRANCH} from "./obsidian-neon-sandbox-readonly.ts";
import type {ManualReviewPreview} from "./obsidian-manual-sync-review.ts";
import type {SyncFingerprint} from "./obsidian-sync-plan.ts";

const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const HASH=/^[0-9a-f]{64}$/;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FORMAT="naosledge.m5.owner-adopted-common-baseline.v1";
const PREFIX="naosledge-m5-owner-baseline-test-";
const GENESIS="0".repeat(64);
const KEYFILE="identity.dpapi";
const RECORDS="records";
const LOCK="journal.lock";
const LIMIT=20;
type Protector={seal:(key:Buffer)=>Promise<string>;unseal:(blob:string)=>Promise<Buffer>};
type Entry={
  format:typeof FORMAT;seq:number;previousMac:string;
  branch:typeof NEON_SYNC_SANDBOX_BRANCH;ownerId:string;
  action:"manual-adopt-current-equality"|"verified-m3-upload";
  slug:string;sha256:string;remoteRevision:string;createdAt:string;
  beforeRemoteSha?:string|null;beforeRemoteRevision?:string|null;
};
type SignedEntry=Entry&{mac:string};
export type M5ApprovedBaselineResult={
  baselineSaved:true;entryCount:number;action:"manual-adopt-current-equality";
  transferConfirmed:false;autoApplyAllowed:false;deleteAllowed:false;
};

function err(message:string):never{throw Error("M5 approved baseline: "+message);}
function validateOwnerJwt(jwt:string):string{
  if(typeof jwt!=="string"||jwt.length>8192||
     !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jwt))err("Owner JWT missing");
  let sub:unknown;
  try{
    const p=JSON.parse(Buffer.from(jwt.split(".")[1],"base64url").toString("utf8"));
    sub=p&&typeof p==="object"&&!Array.isArray(p)?p.sub:undefined;
  }catch{err("Owner JWT subject invalid");}
  if(typeof sub!=="string"||!UUID.test(sub))err("Owner UUID unavailable");
  // Parsing a JWT is NOT authentication. The caller must independently run
  // the existing, pinned Neon Owner-RLS proof before accepting a new event.
  return sub;
}
export function assertM5ApprovedBaselineInvocation(
  platform:string,computer:string,flags:readonly string[],tty:boolean,
):void{
  if(platform!=="win32"||computer.trim().toUpperCase()!=="MSI"||
     flags.length!==1||!["--m5-adopt-current-equality","--m5-inspect-approved-baseline",
       "--m5-review-approved-baseline","--m5-upload-reviewed-note"].includes(flags[0])||
     tty)err("MSI-only, explicit manual flag and piped stdin required");
}
export function approvedBaselineDirectory():string{
  if(process.platform!=="win32"||hostname().trim().toUpperCase()!=="MSI"){
    err("only the registered MSI Windows owner may open the approved store");
  }
  const base=process.env.LOCALAPPDATA||path.join(homedir(),"AppData","Local");
  if(!path.isAbsolute(base))err("Windows LocalAppData path invalid");
  return path.join(base,"Naosledge","m5-owner-baseline");
}

async function dpapi(mode:"seal"|"unseal",bytes:Buffer):Promise<Buffer>{
  if(process.platform!=="win32")err("Windows DPAPI is required; no plaintext fallback");
  // Fixed inline script; raw key/blob only via stdin, never argv/env/logs.
  const operation=mode==="seal"?"Protect":"Unprotect";
  const script="$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security;"+
    "$raw=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());"+
    "$result=[System.Security.Cryptography.ProtectedData]::"+operation+
    "($raw,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);"+
    "[Console]::Out.Write([Convert]::ToBase64String($result))";
  return new Promise((resolve,reject)=>{
    const child=spawn("powershell.exe",[
      "-NoLogo","-NoProfile","-NonInteractive","-Command",script,
    ],{windowsHide:true,stdio:["pipe","pipe","pipe"],
      signal:AbortSignal.timeout(20_000)});
    let response="",stderrSize=0,failed=false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data",(chunk:string)=>{
      response+=chunk;
      if(response.length>8192){failed=true;child.kill();}
    });
    child.stderr.on("data",(chunk:Buffer)=>{stderrSize+=chunk.length;});
    child.on("error",()=>reject(Error("M5 Windows user-key protection unavailable")));
    child.on("close",code=>{
      if(code!==0||failed||stderrSize>8192||
         !/^[A-Za-z0-9+/=]+$/.test(response.trim())){
        reject(Error("M5 Windows user-key protection failed"));
        return;
      }
      try{resolve(Buffer.from(response.trim(),"base64"));}
      catch{reject(Error("M5 Windows user-key protection invalid"));}
    });
    child.stdin.on("error",()=>{});
    child.stdin.end(bytes.toString("base64"));
  });
}
export const windowsM5KeyProtector:Protector={
  seal:async key=>(await dpapi("seal",key)).toString("base64"),
  unseal:async blob=>dpapi("unseal",Buffer.from(blob,"base64")),
};

async function safeDirectory(directory:string):Promise<void>{
  const stat=await lstat(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.nlink<1||
     path.normalize(await realpath(directory)).toLowerCase()!==
       path.normalize(directory).toLowerCase())err("redirected baseline directory");
}
async function checkRoot(root:string,allowCreate:boolean):Promise<void>{
  if(!path.isAbsolute(root)||root.length>1024)err("invalid local baseline root");
  const base=path.dirname(root);
  if(allowCreate){
    await safeDirectory(path.dirname(base));
    try{await mkdir(base,{mode:0o700});}
    catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;}
    await safeDirectory(base);
    try{await mkdir(root,{mode:0o700});}
    catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;}
  }
  await safeDirectory(base);
  await safeDirectory(root);
}
async function safeReadFile(filename:string,maxBytes:number):Promise<Buffer>{
  const before=await lstat(filename);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
     before.size<1||before.size>maxBytes)err("unsafe baseline evidence");
  const bytes=await readFile(filename);
  const after=await lstat(filename);
  if(before.ino!==after.ino||before.size!==after.size||
     before.mtimeMs!==after.mtimeMs||bytes.length!==before.size){
    err("baseline evidence changed during read");
  }
  return bytes;
}
async function writeExclusive(file:string,value:Buffer):Promise<void>{
  const handle=await open(file,"wx",0o600);
  try{await handle.writeFile(value);await handle.sync();}
  finally{await handle.close();}
}
async function withLock<T>(root:string,run:()=>Promise<T>):Promise<T>{
  const lock=path.join(root,LOCK);
  const handle=await open(lock,"wx",0o600).catch(()=>err("another baseline operation is active"));
  const held=await handle.stat();
  try{
    await handle.writeFile("m5-local-owner-session");
    await handle.sync();
    return await run();
  }finally{
    await handle.close();
    // Keep a replaced or missing lock for manual inspection; never clear
    // another writer's lock and then pretend serialized adoption succeeded.
    let current;
    try{current=await lstat(lock);}
    catch{err("baseline lock disappeared during owner adoption");}
    if(!current.isFile()||current.isSymbolicLink()||
       current.nlink!==1||current.ino!==held.ino){
      err("baseline lock replaced during owner adoption");
    }
    await unlink(lock);
  }
}
function validateRecord(row:unknown,seq:number,previousMac:string):Entry{
  if(!row||typeof row!=="object"||Array.isArray(row))err("invalid journal record");
  const a=row as Record<string,unknown>;
  const fields=["format","seq","previousMac","branch","ownerId","action",
    "slug","sha256","remoteRevision","createdAt"];
  const isUpload=a.action==="verified-m3-upload";
  if(Object.keys(a).join(",")!==
       [...fields,...(isUpload?["beforeRemoteSha","beforeRemoteRevision"]:[])].join(",")||
     a.format!==FORMAT||a.seq!==seq||a.previousMac!==previousMac||
     a.branch!==NEON_SYNC_SANDBOX_BRANCH||
     typeof a.ownerId!=="string"||!UUID.test(a.ownerId)||
     (a.action!=="manual-adopt-current-equality"&&!isUpload)||
     (isUpload&&!((a.beforeRemoteSha===null&&a.beforeRemoteRevision===null)||
       (typeof a.beforeRemoteSha==="string"&&HASH.test(a.beforeRemoteSha)&&
        typeof a.beforeRemoteRevision==="string"&&HASH.test(a.beforeRemoteRevision))))||
     typeof a.slug!=="string"||a.slug.length<3||a.slug.length>120||
     !SLUG.test(a.slug)||
     typeof a.sha256!=="string"||!HASH.test(a.sha256)||
     typeof a.remoteRevision!=="string"||!HASH.test(a.remoteRevision)||
     typeof a.createdAt!=="string"||
     !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(a.createdAt)||
     !Number.isFinite(Date.parse(a.createdAt))||
     new Date(a.createdAt).toISOString()!==a.createdAt)err("invalid journal record");
  return a as Entry;
}
function mac(key:Buffer,event:Entry):string{
  return createHmac("sha256",key).update(JSON.stringify(event),"utf8").digest("hex");
}

type Opened={key:Buffer;entries:SignedEntry[]};
async function loadJournal(root:string,ownerId:string,protector:Protector):Promise<Opened|null>{
  let names:string[];
  try{names=await readdir(root);}
  catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return null;throw e;}
  if(!names.includes(KEYFILE)){
    if(names.length===0||(names.length===1&&names[0]===LOCK))return null;
    err("existing journal has no protected identity key");
  }
  if(names.some(name=>![KEYFILE,RECORDS,LOCK].includes(name)))err("unexpected journal entry");
  const keyBytes=await safeReadFile(path.join(root,KEYFILE),8192);
  let keyEnvelope:unknown;
  try{keyEnvelope=JSON.parse(keyBytes.toString("utf8"));}
  catch{err("invalid Windows key envelope");}
  const envelope=keyEnvelope as {format?:unknown;sealed?:unknown};
  if(!envelope||typeof envelope!=="object"||Object.keys(envelope).join(",")!=="format,sealed"||
     envelope.format!=="naosledge.m5.dpapi-key.v1"||
     typeof envelope.sealed!=="string"||envelope.sealed.length>8000||
     !/^[A-Za-z0-9+/=]+$/.test(envelope.sealed)||
     JSON.stringify(envelope)!==keyBytes.toString("utf8"))err("invalid protected key format");
  const key=await protector.unseal(envelope.sealed);
  if(key.length!==32)err("Windows user key invalid");
  if(!names.includes(RECORDS))err("missing persistent journal");
  const records=path.join(root,RECORDS);
  await safeDirectory(records);
  const files=(await readdir(records)).sort();
  if(files.length===0||files.length>LIMIT||files.some(f=>!/^[0-9]{6}\.json$/.test(f))){
    err("incomplete or unexpected persistent journal");
  }
  let prev=GENESIS;
  const latest=new Map<string,Entry>();
  const entries:SignedEntry[]=[];
  for(let i=0;i<files.length;i++){
    if(files[i]!==String(i+1).padStart(6,"0")+".json")err("missing journal sequence");
    const raw=await safeReadFile(path.join(records,files[i]),2500);
    let parsed:unknown;
    try{parsed=JSON.parse(raw.toString("utf8"));}
    catch{err("invalid journal JSON");}
    const row=parsed as Record<string,unknown>;
    if(!row||typeof row!=="object"||Array.isArray(row)||
       Object.keys(row).at(-1)!=="mac"||
       typeof row.mac!=="string"||!HASH.test(row.mac)){
      err("invalid journal authentication metadata");
    }
    const {mac:signature,...unsigned}=row;
    const event=validateRecord(unsigned,i+1,prev);
    const expected=mac(key,event);
    if(!timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(signature as string,"hex"))||
       raw.toString("utf8")!==JSON.stringify({...event,mac:signature})||
       event.ownerId!==ownerId)err("tampered or ambiguous journal");
    const older=latest.get(event.slug);
    if(event.action==="manual-adopt-current-equality"&&older){
      err("duplicate baseline adoption");
    }
    if(event.action==="verified-m3-upload"&&older&&
       (event.beforeRemoteSha!==older.sha256||
        event.beforeRemoteRevision!==older.remoteRevision)){
      err("M5 upload is not chained to its previous adopted baseline");
    }
    latest.set(event.slug,event);
    prev=signature as string;
    entries.push({...event,mac:prev});
  }
  if((await readdir(records)).length!==files.length)err("journal changed during validation");
  return {key,entries};
}
async function initialize(root:string,protector:Protector):Promise<Buffer>{
  const other=(await readdir(root)).filter(x=>x!==LOCK);
  if(other.length)err("cannot initialize a nonempty journal");
  const key=randomBytes(32);
  const sealed=await protector.seal(key);
  const document=Buffer.from(JSON.stringify({
    format:"naosledge.m5.dpapi-key.v1",sealed,
  }),"utf8");
  await writeExclusive(path.join(root,KEYFILE),document);
  await mkdir(path.join(root,RECORDS),{mode:0o700});
  await safeDirectory(path.join(root,RECORDS));
  return key;
}
function validPreviewEqual(
  preview:ManualReviewPreview,slug:string,sha256:string,revision:string,
):boolean{
  const match=preview?.decisions?.find(x=>x.slug===slug);
  return preview?.sandboxOnly===true&&preview.readOnly===true&&
    preview.manualTriggerOnly===true&&preview.previewStatus==="ready"&&
    preview.autoApplyAllowed===false&&preview.inventory?.remoteFullInventory===true&&
    preview.inventory.localCoverageNeedsReview===false&&
    preview.inventory.localUnsupportedMarkdown===0&&
    preview.inventory.localDirectoriesNotScanned===0&&
    match?.choice==="unchanged"&&match.manualReview===false&&
    match.expectedLocalSha===sha256&&match.expectedRemoteSha===sha256&&
    match.expectedRemoteRevision===revision;
}

export type ApprovedJournalDependencies={
  /** Tests only: supplied root and protector MUST be scratch OS-temp. */
  rootDir?:string;
  protector?:Protector;
  readPreview?:typeof previewApprovedMsiSandboxSync;
  /** Test-only source and transport are never available to the live MSI CLI. */
  readMarkdown?:(slug:string,sha:string)=>Promise<string>;
  transfer?:(input:{sandboxOwnerJwt:string;decision:SyncDecision;
    readMarkdown:()=>Promise<string>;typedConfirmation:string})=>Promise<{
    slug:string;sha256:string;revision:string;baselineSaved:false;
  }>;
};
function dependencies(options:ApprovedJournalDependencies={}){
  const root=options.rootDir??approvedBaselineDirectory();
  if(options.rootDir!==undefined||options.protector!==undefined||
     options.readPreview!==undefined||options.readMarkdown!==undefined||
     options.transfer!==undefined){
    if(typeof options.rootDir!=="string"||
       path.dirname(path.resolve(options.rootDir)).toLowerCase()!==
         path.resolve(tmpdir()).toLowerCase()||
       !path.basename(options.rootDir).startsWith(PREFIX)||
       typeof options.protector?.seal!=="function"||
       typeof options.protector.unseal!=="function"||
       typeof options.readPreview!=="function"||
       (options.readMarkdown!==undefined&&typeof options.readMarkdown!=="function")||
       (options.transfer!==undefined&&typeof options.transfer!=="function")){
      err("dependency overrides only permitted in isolated OS-temp tests");
    }
  }
  return {root,protector:options.protector??windowsM5KeyProtector,
    readPreview:options.readPreview??previewApprovedMsiSandboxSync,
    readMarkdown:options.readMarkdown??readApprovedMsiCanonicalMarkdown,
    transfer:options.transfer};
}

/**
 * Explicit human adoption of an already equal pair, not a transfer receipt.
 * The owner UUID is confirmed by a live pinned Owner-RLS preview each time.
 */
export async function adoptM5CurrentEquality(args:{
  sandboxOwnerJwt:string;slug:string;sha256:string;remoteRevision:string;
  typedConfirmation:string;
},options?:ApprovedJournalDependencies):Promise<M5ApprovedBaselineResult>{
  const ownerId=validateOwnerJwt(args?.sandboxOwnerJwt);
  const slug=args?.slug,sha=args?.sha256,revision=args?.remoteRevision;
  if(typeof slug!=="string"||slug.length<3||slug.length>120||
     !SLUG.test(slug)||typeof sha!=="string"||!HASH.test(sha)||
     typeof revision!=="string"||!HASH.test(revision)||
     args.typedConfirmation!=="ADOPT M5 SANDBOX "+slug+" "+sha.slice(0,12)){
    err("per-note owner adoption and reviewed exact version required");
  }
  const {root,protector,readPreview}=dependencies(options);
  const scan=()=>readPreview({sandboxOwnerJwt:args.sandboxOwnerJwt,baseline:[]});
  const first=await scan();
  if(!validPreviewEqual(first,slug,sha,revision))err("first Owner-RLS/Vault equality missing");
  await checkRoot(root,true);
  return withLock(root,async()=>{
    let state=await loadJournal(root,ownerId,protector);
    if(state?.entries.some(x=>x.slug===slug))err("already adopted; never rewrite historic baseline");
    if((state?.entries.length??0)>=LIMIT)err("bounded journal entry limit exceeded");
    const fresh=await scan();
    if(!validPreviewEqual(fresh,slug,sha,revision))err("source changed before adoption");
    const key=state?state.key:await initialize(root,protector);
    const seq=(state?.entries.length??0)+1;
    const event:Entry={
      format:FORMAT,seq,
      previousMac:state?.entries.at(-1)?.mac??GENESIS,
      branch:NEON_SYNC_SANDBOX_BRANCH,ownerId,
      action:"manual-adopt-current-equality",
      slug,sha256:sha,remoteRevision:revision,
      createdAt:new Date().toISOString(),
    };
    const signature=mac(key,event);
    const record=Buffer.from(JSON.stringify({...event,mac:signature}),"utf8");
    const filename=path.join(root,RECORDS,String(seq).padStart(6,"0")+".json");
    await writeExclusive(filename,record);
    const after=await loadJournal(root,ownerId,protector);
    if(after?.entries.length!==seq||after.entries.at(-1)?.mac!==signature){
      err("persisted adoption could not be independently verified");
    }
    return {baselineSaved:true,entryCount:seq,
      action:"manual-adopt-current-equality",transferConfirmed:false,
      autoApplyAllowed:false,deleteAllowed:false};
  });
}

/**
 * The one approved M2 -> M3 -> M5 upload flow on MSI.
 * A reviewed M2 handoff is only an intent; this function requires a fresh
 * independent typed per-note approval, real Owner-RLS preflight, the CURRENT
 * registered local Markdown, and a successful atomic M3 post-write check.
 *
 * Never fall back to saving a Baseline on a failed/ambiguous POST or PATCH.
 * A later M4 Incoming copy is NOT a completed local download.
 */
export async function uploadReviewedM3AndRecordM5(args:{
  sandboxOwnerJwt:string;handoff:unknown;typedConfirmation:string;
},options?:ApprovedJournalDependencies):Promise<{
  baselineSaved:true;transferConfirmed:true;entryCount:number;
  autoApplyAllowed:false;deleteAllowed:false;
}>{
  const ownerId=validateOwnerJwt(args?.sandboxOwnerJwt);
  const decision=parseManualM3UploadIntent(args.handoff);
  const slug=decision.slug,desired=decision.expectedLocalSha!;
  if(args.typedConfirmation!=="UPLOAD M5 SANDBOX "+slug+" "+desired.slice(0,12)){
    err("one reviewed M2 upload and independent per-note confirmation required");
  }
  const {root,protector,readPreview,readMarkdown,transfer}=dependencies(options);
  await checkRoot(root,true);
  return withLock(root,async()=>{
    const journal=await loadJournal(root,ownerId,protector);
    if((journal?.entries.length??0)>=LIMIT)err("bounded journal entry limit exceeded");
    const previous=new Map((journal?.entries??[]).map(item=>[item.slug,item]));
    const prior=previous.get(slug);
    if(prior&&(prior.sha256!==decision.expectedRemoteSha||
       prior.remoteRevision!==decision.expectedRemoteRevision)){
      err("M2 remote version diverges from signed historical Baseline");
    }
    const baseline=[...previous.values()].map(item=>({
      slug:item.slug,sha256:item.sha256,revision:item.remoteRevision,
    }));
    const scan=()=>readPreview({sandboxOwnerJwt:args.sandboxOwnerJwt,baseline});
    const before=await scan();
    const row=before.decisions.find(item=>item.slug===slug);
    if(before.previewStatus!=="ready"||before.sandboxOnly!==true||
       before.readOnly!==true||before.manualTriggerOnly!==true||
       before.autoApplyAllowed!==false||
       before.inventory.remoteFullInventory!==true||
       before.inventory.localCoverageNeedsReview!==false||
       !row||row.expectedLocalSha!==desired||
       row.expectedRemoteSha!==decision.expectedRemoteSha||
       row.expectedRemoteRevision!==decision.expectedRemoteRevision){
      err("M2 reviewed source changed before authorized transfer");
    }
    const read=()=>readMarkdown(slug,desired);
    // The real path invokes the ALREADY VERIFIED M3 Owner-RLS transport.
    // Injected test transport is allowed only with an isolated OS-temp root.
    const send=transfer??(async(input:{
      sandboxOwnerJwt:string;decision:SyncDecision;
      readMarkdown:()=>Promise<string>;typedConfirmation:string;
    })=>decision.choice==="review-missing-remote"?
      createNeonSandboxNoteOnly({
        branchId:NEON_SYNC_SANDBOX_BRANCH,...input,
      }):updateNeonSandboxNoteIfUnchanged({
        branchId:NEON_SYNC_SANDBOX_BRANCH,...input,
      }));
    const result=await send({
      sandboxOwnerJwt:args.sandboxOwnerJwt,decision,readMarkdown:read,
      typedConfirmation:(decision.choice==="review-missing-remote"?
        "CREATE SANDBOX ":"UPDATE SANDBOX ")+slug,
    });
    if(result.baselineSaved!==false||result.slug!==slug||
       result.sha256!==desired||typeof result.revision!=="string"||
       !HASH.test(result.revision)){
      err("M3 transfer did not return one fully verified note");
    }
    // An M3 good HTTP response alone does not persist a Baseline. The
    // separately registered local Vault and Owner-RLS remote MUST still
    // agree on the EXACT post-write revision, twice, while the local
    // journal is exclusively locked.
    const after=await scan();
    if(!validPreviewEqual(after,slug,desired,result.revision)){
      err("M3 finished but M5 two-source verification failed; no retry");
    }
    const last=await scan();
    if(!validPreviewEqual(last,slug,desired,result.revision)){
      err("M5 source changed before durable commit; no retry");
    }
    const key=journal?journal.key:await initialize(root,protector);
    const seq=(journal?.entries.length??0)+1;
    const event:Entry={
      format:FORMAT,seq,
      previousMac:journal?.entries.at(-1)?.mac??GENESIS,
      branch:NEON_SYNC_SANDBOX_BRANCH,ownerId,
      action:"verified-m3-upload",slug,sha256:desired,
      remoteRevision:result.revision,createdAt:new Date().toISOString(),
      beforeRemoteSha:decision.expectedRemoteSha,
      beforeRemoteRevision:decision.expectedRemoteRevision,
    };
    const signature=mac(key,event);
    await writeExclusive(path.join(root,RECORDS,
      String(seq).padStart(6,"0")+".json"),
      Buffer.from(JSON.stringify({...event,mac:signature}),"utf8"));
    const committed=await loadJournal(root,ownerId,protector);
    if(committed?.entries.length!==seq||
       committed.entries.at(-1)?.mac!==signature){
      err("M5 persisted M3 upload could not be independently verified");
    }
    return {baselineSaved:true,transferConfirmed:true,entryCount:seq,
      autoApplyAllowed:false,deleteAllowed:false};
  });
}

/** Load/verify ALL chained evidence before passing the real Baseline to M1/M2. */
async function verifiedM5Review(args:{
  sandboxOwnerJwt:string;
},options?:ApprovedJournalDependencies):Promise<{
  baselineCount:number;preview:ManualReviewPreview;
}>{
  const ownerId=validateOwnerJwt(args?.sandboxOwnerJwt);
  const {root,protector,readPreview}=dependencies(options);
  await checkRoot(root,false);
  const state=await loadJournal(root,ownerId,protector);
  if(!state?.entries.length)err("no approved baseline journal");
  // Later verified M3 uploads replace the previous per-note Baseline in the
  // same signed history; historic events themselves are never deleted.
  const latest=new Map(state.entries.map(item=>[item.slug,item]));
  const baselines:SyncFingerprint[]=[...latest.values()].map(x=>({
    slug:x.slug,sha256:x.sha256,revision:x.remoteRevision,
  }));
  const preview=await readPreview({sandboxOwnerJwt:args.sandboxOwnerJwt,
    baseline:baselines});
  if(preview.sandboxOnly!==true||preview.readOnly!==true||
     preview.manualTriggerOnly!==true||preview.previewStatus!=="ready"||
     preview.baselinePersisted!==false||
     preview.automaticSyncEnabled!==false||
     preview.automaticDeleteEnabled!==false||
     preview.autoApplyAllowed!==false||
     preview.inventory.remoteFullInventory!==true||
     preview.inventory.localCoverageNeedsReview!==false||
     preview.inventory.localUnsupportedMarkdown!==0||
     preview.inventory.localDirectoriesNotScanned!==0){
    err("fresh complete Owner-RLS/Vault reconciliation unavailable");
  }
  const second=await loadJournal(root,ownerId,protector);
  if(!second||JSON.stringify(second.entries)!==JSON.stringify(state.entries)){
    err("baseline journal changed during live reconciliation");
  }
  return {baselineCount:baselines.length,preview};
}

/** A verified preview for the existing M2 JSON import. No automatic action. */
export async function readM5ApprovedReview(args:{
  sandboxOwnerJwt:string;
},options?:ApprovedJournalDependencies):Promise<ManualReviewPreview>{
  return (await verifiedM5Review(args,options)).preview;
}

/** A restart-safe, count-only CLI summary; private note metadata stays local. */
export async function inspectM5OwnerApprovedBaseline(args:{
  sandboxOwnerJwt:string;
},options?:ApprovedJournalDependencies):Promise<{
  baselineCount:number;manualReviewCount:number;conflicts:number;
  possibleDeletionsNeverApplied:number;
  loadedFromAuthenticatedJournal:true;readOnly:true;autoApplyAllowed:false;
  transferConfirmed:false;deleteAllowed:false;
}>{
  const {baselineCount,preview}=await verifiedM5Review(args,options);
  return {baselineCount,manualReviewCount:preview.manualReviewCount,
    conflicts:preview.conflicts,
    possibleDeletionsNeverApplied:preview.possibleDeletionsNeverApplied,
    loadedFromAuthenticatedJournal:true,readOnly:true,
    autoApplyAllowed:false,transferConfirmed:false,deleteAllowed:false};
}
