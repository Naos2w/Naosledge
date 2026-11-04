/**
 * M9 manual fault-clearance candidate: archives, NEVER discards, a reviewed
 * write-ahead marker outside the Vault. Requires separate explicit Owner ACK.
 *
 * A verified current M5 HMAC baseline must equal BOTH full live Owner-RLS and
 * local inventories through two separate full reconciliation passes, with
 * signed automatic mode DISABLED, no Incoming intents and no writer lock.
 *
 * Only a deliberate MSI operator invocation may call real mode. No automatic
 * retry, no M5 adoption, no note readback exported, no Production/Vault writes.
 */
import {randomBytes} from "node:crypto";
import {
  lstat,mkdir,open,readFile,realpath,rename,unlink,
} from "node:fs/promises";
import {homedir,hostname,tmpdir} from "node:os";
import path from "node:path";
import {
  inspectM9FaultReconciliationReadOnly,
  type M9ReconciliationTestOnly,
} from "./obsidian-m9-fault-reconciliation-readonly.ts";
import {inspectM9FaultReadOnly}
  from "./obsidian-m9-fault-review-readonly.ts";

export const M9_FAULT_ARCHIVE_CONFIRMATION=
  "ARCHIVE VERIFIED M9 FAULT AFTER OWNER REVIEW";
const MARKER=".m9-fault-review-required";
const WRITER_LOCK=".m8-readonly-agent.lock";
const CLEARANCE_LOCK=".m9-fault-clearance.lock";
const ARCHIVE=".m9-reviewed-fault-archive";
const CONTENT="m9-uncertain-operation-manual-reconciliation-required";

function refuse():never{
  throw Error("M9 fault must stay blocked until a separate Owner review");
}
async function safeDir(dir:string):Promise<void>{
  const st=await lstat(dir).catch(()=>refuse());
  if(!st.isDirectory()||st.isSymbolicLink()||
     path.resolve(await realpath(dir)).toLowerCase()!==
       path.resolve(dir).toLowerCase())refuse();
}
async function missing(file:string):Promise<boolean>{
  try{await lstat(file);return false;}
  catch(e){
    if((e as NodeJS.ErrnoException).code==="ENOENT")return true;
    refuse();
  }
}
async function rootFor(test?:M9ReconciliationTestOnly){
  if(test){
    if(typeof test.faultRoot!=="string"||
       !path.isAbsolute(test.faultRoot)||
       path.dirname(path.resolve(test.faultRoot)).toLowerCase()!==
         path.resolve(tmpdir()).toLowerCase()||
       !/^naosledge-m9-fault-test-[a-zA-Z0-9_-]{6,}$/.test(
         path.basename(test.faultRoot)))refuse();
    await safeDir(test.faultRoot);
    return test.faultRoot;
  }
  if(process.platform!=="win32"||
     hostname().trim().toUpperCase()!=="MSI")refuse();
  const root=path.join(process.env.LOCALAPPDATA||
    path.join(homedir(),"AppData","Local"),
    "Naosledge","m8-readonly-agent");
  await safeDir(root);
  return root;
}
async function verifyMarker(root:string){
  if(!await missing(path.join(root,WRITER_LOCK)))refuse();
  const file=path.join(root,MARKER);
  const before=await lstat(file).catch(()=>refuse());
  const expected=Buffer.from(CONTENT,"utf8");
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
     before.size!==expected.length)refuse();
  const contents=await readFile(file).catch(()=>refuse());
  const after=await lstat(file).catch(()=>refuse());
  if(after.ino!==before.ino||after.size!==before.size||
     after.mtimeMs!==before.mtimeMs||!contents.equals(expected))refuse();
  return {ino:before.ino,mtimeMs:before.mtimeMs,bytes:expected};
}
export type M9FaultArchiveResult={
  archivedForManualRecord:true;
  automaticRestartAuthorised:false;
  signedReactivationAuthorised:false;
  noteWritesPerformed:0;
  remoteWritesPerformed:0;
};
/**
 * One explicit, consented fault archive. Does NOT approve restart.
 *
 * Failures retain the durable marker (or its archived evidence) and never
 * launch the Agent. The lock prevents a competing Agent start during clearance.
 */
export async function archiveVerifiedM9FaultAfterManualReview(args:{
  ownerJwt:string;
  typedConfirmation:string;
  fetcher?:typeof fetch;
  testOnly?:M9ReconciliationTestOnly;
}):Promise<M9FaultArchiveResult>{
  if(!args||args.typedConfirmation!==M9_FAULT_ARCHIVE_CONFIRMATION||
     typeof args.ownerJwt!=="string"||args.ownerJwt.length<1)refuse();
  const root=await rootFor(args.testOnly);
  // A stale/repeated ACK must never create a blocking clearance lock when
  // there is no valid fault to archive in the first place.
  const initial=await inspectM9FaultReadOnly(
    args.testOnly?{testRoot:root}:undefined).catch(()=>null);
  if(initial?.state!=="review-required"||initial.writerLockPresent)refuse();
  const lockPath=path.join(root,CLEARANCE_LOCK);
  let lock:Awaited<ReturnType<typeof open>>;
  try{lock=await open(lockPath,"wx",0o600);}
  catch{refuse();}
  const lockInode=(await lock.stat()).ino;
  let verifiedArchive=false;
  // Invalid or crashed clearance lock blocks future starts until manual review.
  try{
    await lock.writeFile("m9-single-operator-fault-clearance-in-progress");
    await lock.sync();
    const options={ownerJwt:args.ownerJwt,fetcher:args.fetcher,
      testOnly:args.testOnly};
    // Run the full Owner-RLS/local/M5/incoming/signed-mode proof twice while
    // holding an exclusive clearance lock; do not rely on an earlier status.
    const first=await inspectM9FaultReconciliationReadOnly(options);
    if(first.state!=="ready-for-manual-review"||
       !first.signedM5EqualityVerified)refuse();
    const before=await verifyMarker(root);
    const second=await inspectM9FaultReconciliationReadOnly(options);
    if(second.state!=="ready-for-manual-review"||
       !second.signedM5EqualityVerified)refuse();
    const after=await verifyMarker(root);
    if(before.ino!==after.ino||before.mtimeMs!==after.mtimeMs)refuse();
    const archive=path.join(root,ARCHIVE);
    try{await mkdir(archive,{mode:0o700});}
    catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")refuse();}
    await safeDir(archive);
    const dest=path.join(archive,"fault-"+Date.now()+"-"+
      randomBytes(8).toString("hex")+".marker");
    if(!await missing(dest))refuse();
    // Same-filesystem atomic move retains the original crash marker as
    // evidence without any note, M5, Vault or Production mutation.
    await rename(path.join(root,MARKER),dest);
    const archived=await readFile(dest).catch(()=>refuse());
    if(!archived.equals(before.bytes))refuse();
    const cleared=await inspectM9FaultReadOnly(
      args.testOnly?{testRoot:root}:undefined);
    if(cleared.state!=="no-latch"||cleared.writerLockPresent)refuse();
    verifiedArchive=true;
    return {
      archivedForManualRecord:true,
      automaticRestartAuthorised:false,
      signedReactivationAuthorised:false,
      noteWritesPerformed:0,
      remoteWritesPerformed:0,
    };
  }finally{
    await lock.close().catch(()=>refuse());
    // A lost response AFTER marker rename is not a proven clearance:
    // leave the clearance lock behind so a new Agent can never start.
    const fault=await inspectM9FaultReadOnly(
      args.testOnly?{testRoot:root}:undefined).catch(()=>null);
    if(!verifiedArchive&&fault?.state!=="review-required")refuse();
    const current=await lstat(lockPath).catch(()=>refuse());
    if(!current.isFile()||current.isSymbolicLink()||
       current.nlink!==1||current.ino!==lockInode)refuse();
    await unlink(lockPath).catch(()=>refuse());
  }
}
