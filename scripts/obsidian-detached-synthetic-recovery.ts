/**
 * Read-only process-restart inspection of a factory-created NaosLedge TEMP
 * scratch backup area. This CLI has no production Vault path or write API.
 * A fixed marker is a scope guard, NOT authentication or proof of durability.
 */
import {createHash} from "node:crypto";
import {lstat,opendir,readFile,realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

const PREFIX="naosledge-durable-synthetic-only-";
const ID_PATTERN=/^naosledge-durable-synthetic-only-[A-Za-z0-9_-]{6,32}$/;
const MARKER=".synthetic-recovery-marker";
const MARKER_TEXT="NAOSLEDGE_GENERATED_SYNTHETIC_RECOVERY_V1";
const BACKUP_ENTRY=/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(bak|json)$/;
const SHA=/^[0-9a-f]{64}$/;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FIELDS=new Set(["id","slug","beforeSha","afterSha","createdAt","syntheticOnly"]);
const MAX_ENTRIES=1024;
const MAX_NOTE_BYTES=250_000;
const MAX_METADATA_BYTES=4096;

function sha(data:Uint8Array){return createHash("sha256").update(data).digest("hex");}

async function safeDirectory(dirname:string):Promise<void>{
  const st=await lstat(dirname);
  if(!st.isDirectory()||st.isSymbolicLink())throw Error("Unsafe synthetic recovery directory");
  if(path.normalize(await realpath(dirname)).toLowerCase()!==
     path.normalize(dirname).toLowerCase()){
    throw Error("Redirected synthetic recovery directory");
  }
}

/** Read file with bounded size, no symlink/hardlink, plus a before/after identity check. */
async function stableFile(filename:string,maxBytes:number):Promise<Buffer|null>{
  try{
    const before=await lstat(filename);
    if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
       before.size>maxBytes)return null;
    const bytes=await readFile(filename);
    const after=await lstat(filename);
    if(bytes.byteLength>maxBytes||before.dev!==after.dev||
       before.ino!==after.ino||before.size!==after.size||
       before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||
       bytes.byteLength!==after.size)return null;
    return bytes;
  }catch{
    return null;
  }
}

async function validBackupPair(backups:string,id:string):Promise<boolean>{
  const bytes=await stableFile(path.join(backups,id+".bak"),MAX_NOTE_BYTES);
  const metadata=await stableFile(path.join(backups,id+".json"),MAX_METADATA_BYTES);
  if(!bytes||!metadata)return false;
  let data:Record<string,unknown>;
  try{data=JSON.parse(metadata.toString("utf8")) as Record<string,unknown>;}
  catch{return false;}
  if(!data||typeof data!=="object"||Array.isArray(data)||
     Object.keys(data).length!==FIELDS.size||
     Object.keys(data).some(key=>!FIELDS.has(key))||
     data.id!==id||data.syntheticOnly!==true||
     typeof data.slug!=="string"||data.slug.length<3||
     data.slug.length>120||!SLUG.test(data.slug)||
     typeof data.beforeSha!=="string"||!SHA.test(data.beforeSha)||
     typeof data.afterSha!=="string"||!SHA.test(data.afterSha)||
     typeof data.createdAt!=="string"||!ISO.test(data.createdAt)){
    return false;
  }
  const parsed=Date.parse(data.createdAt);
  if(Number.isNaN(parsed)||new Date(parsed).toISOString()!==data.createdAt)return false;
  return sha(bytes)===data.beforeSha;
}

/**
 * Accept a generated basename ONLY. Deliberately no caller-supplied paths:
 * root must be exactly one direct child of OS TEMP and contain the factory's
 * marker. It reads only backup metadata and backup bytes, never note bodies.
 */
export async function inspectDetachedSyntheticRecovery(id:string){
  if(typeof id!=="string"||!ID_PATTERN.test(id)||!id.startsWith(PREFIX)){
    throw Error("Invalid synthetic recovery fixture identifier");
  }
  const root=path.resolve(tmpdir(),id);
  if(path.dirname(root).toLowerCase()!==path.resolve(tmpdir()).toLowerCase()||
     path.basename(root)!==id){
    throw Error("Synthetic recovery must stay in the direct TEMP child");
  }
  await safeDirectory(root);
  const marker=await stableFile(path.join(root,MARKER),128);
  if(marker?.toString("utf8")!==MARKER_TEXT){
    throw Error("Not a generated synthetic recovery workspace");
  }
  const backups=path.join(root,"backups");
  const locks=path.join(root,"locks");
  await safeDirectory(backups);
  await safeDirectory(locks);
  // A lock left by a terminated writer is evidence, not permission to delete.
  let staleLockEntries=0;
  const lockDirectory=await opendir(locks);
  for await(const _entry of lockDirectory){
    staleLockEntries++;
    if(staleLockEntries>MAX_ENTRIES){
      return {
        syntheticOnly:true,readOnly:true,inspectionComplete:false,
        scannedEntries:0,validPairs:null,orphanBackups:null,
        orphanMetadata:null,invalidPairs:null,unexpectedEntries:null,
        staleLockEntries:null,needsManualReview:true,writerResumed:false,
      } as const;
    }
  }
  const pairs=new Map<string,{bak:boolean;json:boolean}>();
  let scannedEntries=0;
  let unexpectedEntries=0;
  const directory=await opendir(backups);
  for await(const entry of directory){
    scannedEntries++;
    if(scannedEntries>MAX_ENTRIES){
      return {
        syntheticOnly:true,readOnly:true,inspectionComplete:false,
        scannedEntries,validPairs:null,orphanBackups:null,
        orphanMetadata:null,invalidPairs:null,unexpectedEntries:null,
        staleLockEntries:null,needsManualReview:true,writerResumed:false,
      } as const;
    }
    const matched=BACKUP_ENTRY.exec(entry.name);
    if(!entry.isFile()||entry.isSymbolicLink()||!matched){
      unexpectedEntries++;
      continue;
    }
    const item=pairs.get(matched[1])??{bak:false,json:false};
    if(matched[2]==="bak")item.bak=true;
    else item.json=true;
    pairs.set(matched[1],item);
  }
  let validPairs=0,orphanBackups=0,orphanMetadata=0,invalidPairs=0;
  for(const [id,item] of pairs){
    if(!item.json){orphanBackups++;continue;}
    if(!item.bak){orphanMetadata++;continue;}
    if(await validBackupPair(backups,id))validPairs++;
    else invalidPairs++;
  }
  return {
    syntheticOnly:true,readOnly:true,inspectionComplete:true,
    scannedEntries,validPairs,orphanBackups,orphanMetadata,
    invalidPairs,unexpectedEntries,staleLockEntries,
    needsManualReview:orphanBackups+orphanMetadata+
      invalidPairs+unexpectedEntries+staleLockEntries>0,
    writerResumed:false,
  } as const;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==4||process.argv[2]!=="--inspect-id"){
    console.error("SYNTHETIC_RECOVERY_ARGUMENT_REJECTED");
    process.exitCode=2;
  }else{
    inspectDetachedSyntheticRecovery(process.argv[3]).then(
      report=>console.log("NAOSLEDGE_DETACHED_RECOVERY "+JSON.stringify(report)),
      ()=>{console.error("SYNTHETIC_RECOVERY_REJECTED");process.exitCode=2;},
    );
  }
}
