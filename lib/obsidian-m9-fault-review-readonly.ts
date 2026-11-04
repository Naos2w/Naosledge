/**
 * MSI-only read-only status of M9's durable fault latch and shared writer lock.
 * No credential, Vault, Neon or journal content is accessed. This NEVER
 * clears an uncertain transfer or grants restart approval.
 */
import {lstat,readFile,realpath} from "node:fs/promises";
import {homedir,hostname,tmpdir} from "node:os";
import path from "node:path";

const LOCK=".m8-readonly-agent.lock";
const LATCH=".m9-fault-review-required";
const CONTENT="m9-uncertain-operation-manual-reconciliation-required";
function reject():never{
  throw Error("M9 fault status unavailable; manual reconciliation required");
}
async function fileState(file:string):Promise<"missing"|"file"|"invalid">{
  let stat:Awaited<ReturnType<typeof lstat>>;
  try{stat=await lstat(file);}
  catch(e){
    if((e as NodeJS.ErrnoException).code==="ENOENT")return "missing";
    return "invalid";
  }
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)return "invalid";
  return "file";
}
export type M9ReadOnlyFaultStatus={
  state:"uninitialized"|"no-latch"|"review-required"|"untrusted-marker";
  writerLockPresent:boolean;
  manualReconciliationRequired:boolean;
  automaticRestartAuthorised:false;
  writesPerformed:0;
};
export async function inspectM9FaultReadOnly(args?:{
  /** Only immediate OS TEMP folders with a dedicated test prefix. */
  testRoot?:string;
}):Promise<M9ReadOnlyFaultStatus>{
  const test=args?.testRoot;
  if(test!==undefined&&(
    !path.isAbsolute(test)||
    path.dirname(path.resolve(test)).toLowerCase()!==
      path.resolve(tmpdir()).toLowerCase()||
    !/^naosledge-m9-fault-test-[a-zA-Z0-9_-]{6,}$/.test(
      path.basename(test))))reject();
  if(test===undefined&&(process.platform!=="win32"||
     hostname().trim().toUpperCase()!=="MSI"))reject();
  const root=test??path.join(process.env.LOCALAPPDATA||
    path.join(homedir(),"AppData","Local"),
    "Naosledge","m8-readonly-agent");
  let rootStat:Awaited<ReturnType<typeof lstat>>;
  try{rootStat=await lstat(root);}
  catch(e){
    if(!test&&(e as NodeJS.ErrnoException).code==="ENOENT"){
      return {state:"uninitialized",writerLockPresent:false,
        manualReconciliationRequired:false,
        automaticRestartAuthorised:false,writesPerformed:0};
    }
    reject();
  }
  if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||
     path.resolve(await realpath(root)).toLowerCase()!==
       path.resolve(root).toLowerCase())reject();

  const lockState=await fileState(path.join(root,LOCK));
  const latchState=await fileState(path.join(root,LATCH));
  const writerLockPresent=lockState!=="missing";
  let state:M9ReadOnlyFaultStatus["state"];
  if(lockState==="invalid"||latchState==="invalid"){
    state="untrusted-marker";
  }else if(latchState==="missing"){
    state="no-latch";
  }else{
    const file=path.join(root,LATCH);
    const before=await lstat(file);
    // Never read an unexpectedly large or exchanged marker from a shared
    // filesystem. Treat it as untrusted rather than allocating arbitrary data.
    if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
       before.size!==Buffer.byteLength(CONTENT,"utf8")){
      state="untrusted-marker";
    }else{
      let contents:Buffer;
      try{contents=await readFile(file);}
      catch{reject();}
      const after=await lstat(file);
      state=before.ino===after.ino&&before.size===after.size&&
        before.mtimeMs===after.mtimeMs&&
        contents.equals(Buffer.from(CONTENT,"utf8"))?
        "review-required":"untrusted-marker";
    }
  }
  return {state,writerLockPresent,
    manualReconciliationRequired:state==="review-required"||
      state==="untrusted-marker",
    automaticRestartAuthorised:false,writesPerformed:0};
}
