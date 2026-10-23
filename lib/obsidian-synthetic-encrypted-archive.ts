/**
 * Disposable, synthetic-only encrypted archive model.
 *
 * There is NO configurable root path, Vault adapter, Neon client, production
 * decryption endpoint, automatic restore, key store or background scheduler.
 * Only a new direct child of OS TEMP is ever written by this module.
 * The ephemeral 32-byte key must be supplied separately and is never saved.
 */
import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from "node:crypto";
import {mkdir,mkdtemp,open,opendir,lstat,readFile,realpath} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";

const PREFIX="naosledge-encrypted-synthetic-only-";
const ARCHIVE_ID=/^naosledge-encrypted-synthetic-only-[A-Za-z0-9_-]{6,32}$/;
const RECORD_ID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const RECORD_NAME=/^([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\.json$/;
const SYNTHETIC_SLUG=/^synthetic-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SYNTHETIC_BODY_PREFIX="NAOSLEDGE_SYNTHETIC_NOTE:";
const FORMAT="naosledge.synthetic.aes256gcm.v1";
const MARKER_NAME=".synthetic-encrypted-archive-marker";
const MARKER_TEXT="NAOSLEDGE_GENERATED_ENCRYPTED_SYNTHETIC_ARCHIVE_V1";
const FIELDS=new Set(["version","id","syntheticOnly","algorithm","nonce","tag","ciphertext"]);
const NOTE_FIELDS=new Set(["version","slug","body","createdAt"]);
const MAX_RECORDS=128;
const MAX_NOTE_BYTES=250_000;
const MAX_FILE_BYTES=400_000;
const ISO_TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type SyntheticEncryptedArchiveReport={
  syntheticOnly:true;readOnly:true;inspectionComplete:boolean;
  scannedEntries:number;verifiedRecords:number|null;
  invalidRecords:number|null;unexpectedEntries:number|null;
  needsManualReview:boolean;automaticRestoreEnabled:false;
};

function key32(key:unknown):Buffer {
  if(!Buffer.isBuffer(key)||key.length!==32){
    throw Error("Synthetic archive requires a separately supplied 32-byte key");
  }
  return key;
}
function isObject(value:unknown):value is Record<string,unknown>{
  return value!==null&&typeof value==="object"&&!Array.isArray(value);
}
function exactFields(obj:Record<string,unknown>,fields:Set<string>):boolean{
  const names=Object.keys(obj);
  return names.length===fields.size&&names.every(k=>fields.has(k));
}
function timestampValid(value:unknown):value is string{
  if(typeof value!=="string"||!ISO_TIME.test(value))return false;
  const t=Date.parse(value);
  return Number.isFinite(t)&&new Date(t).toISOString()===value;
}
function keyName(id:string){
  if(typeof id!=="string"||!RECORD_ID.test(id))throw Error("Unsafe synthetic record ID");
  return id+".json";
}
function sourceId(archiveId:string):string{
  if(typeof archiveId!=="string"||!ARCHIVE_ID.test(archiveId)){
    throw Error("Unsafe synthetic encrypted archive identifier");
  }
  return archiveId;
}
function rootOf(id:string):string{
  const root=path.resolve(tmpdir(),sourceId(id));
  if(path.dirname(root).toLowerCase()!==path.resolve(tmpdir()).toLowerCase()||
     path.basename(root)!==id)throw Error("Not a direct system TEMP child");
  return root;
}
async function realDirectory(folder:string){
  const st=await lstat(folder);
  if(!st.isDirectory()||st.isSymbolicLink()||
     path.normalize(await realpath(folder)).toLowerCase()!==
     path.normalize(folder).toLowerCase())throw Error("Unsafe synthetic archive directory");
}
async function stableBytes(filename:string,maxBytes:number):Promise<Buffer|null>{
  try{
    const before=await lstat(filename);
    if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
       before.size>maxBytes)return null;
    const bytes=await readFile(filename);
    const after=await lstat(filename);
    if(after.dev!==before.dev||after.ino!==before.ino||
       after.size!==before.size||after.ctimeMs!==before.ctimeMs||
       after.mtimeMs!==before.mtimeMs||bytes.byteLength!==after.size||
       bytes.byteLength>maxBytes)return null;
    return bytes;
  }catch{return null;}
}
async function verifyArchive(id:string):Promise<string>{
  const root=rootOf(id);
  await realDirectory(root);
  const marker=await stableBytes(path.join(root,MARKER_NAME),128);
  if(marker?.toString("utf8")!==MARKER_TEXT){
    throw Error("Not a factory-generated synthetic encrypted archive");
  }
  const records=path.join(root,"records");
  await realDirectory(records);
  return records;
}
function decodeCanonicalBase64(value:unknown,expectedBytes?:number):Buffer{
  if(typeof value!=="string"||value.length>MAX_FILE_BYTES||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw Error("Invalid encoded synthetic archive field");
  const bytes=Buffer.from(value,"base64");
  if(bytes.toString("base64")!==value||
     (expectedBytes!==undefined&&bytes.length!==expectedBytes)){
    throw Error("Invalid canonical synthetic archive field");
  }
  return bytes;
}
function aadFor(id:string):Buffer{
  return Buffer.from("Naosledge:synthetic-encrypted-archive:v1:"+id,"utf8");
}
function openEnvelope(bytes:Buffer,id:string,key:Buffer):{slug:string;body:string}{
  let value:unknown;
  try{value=JSON.parse(bytes.toString("utf8"));}
  catch{throw Error("Encrypted synthetic backup invalid or unauthenticated");}
  if(!isObject(value)||!exactFields(value,FIELDS)||value.version!==1||
     value.id!==id||value.syntheticOnly!==true||
     value.algorithm!=="aes-256-gcm"){
    throw Error("Encrypted synthetic backup invalid or unauthenticated");
  }
  let result:Buffer;
  try{
    const nonce=decodeCanonicalBase64(value.nonce,12);
    const tag=decodeCanonicalBase64(value.tag,16);
    const sealed=decodeCanonicalBase64(value.ciphertext);
    if(!sealed.length||sealed.length>MAX_NOTE_BYTES+2000)throw Error("Oversized backup");
    const decipher=createDecipheriv("aes-256-gcm",key,nonce,{authTagLength:16});
    decipher.setAAD(aadFor(id));
    decipher.setAuthTag(tag);
    result=Buffer.concat([decipher.update(sealed),decipher.final()]);
  }catch{
    // Do not disclose whether a key, tag, ciphertext, or nonce was wrong.
    throw Error("Encrypted synthetic backup invalid or unauthenticated");
  }
  let payload:unknown;
  try{payload=JSON.parse(result.toString("utf8"));}
  catch{throw Error("Encrypted synthetic backup invalid or unauthenticated");}
  if(!isObject(payload)||!exactFields(payload,NOTE_FIELDS)||
     payload.version!==FORMAT||typeof payload.slug!=="string"||
     !SYNTHETIC_SLUG.test(payload.slug)||payload.slug.length>120||
     typeof payload.body!=="string"||
     !payload.body.startsWith(SYNTHETIC_BODY_PREFIX)||
     Buffer.byteLength(payload.body,"utf8")>MAX_NOTE_BYTES||
     !timestampValid(payload.createdAt)){
    throw Error("Encrypted synthetic backup invalid or unauthenticated");
  }
  return {slug:payload.slug,body:payload.body};
}
async function verifyEntry(records:string,id:string,key:Buffer){
  const contents=await stableBytes(path.join(records,keyName(id)),MAX_FILE_BYTES);
  if(!contents)throw Error("Encrypted synthetic backup invalid or unauthenticated");
  return openEnvelope(contents,id,key);
}
async function directorySyncBestEffort(dirname:string){
  try{
    const h=await open(dirname,"r");
    try{await h.sync();}finally{await h.close();}
  }catch(error){
    if(!["EPERM","EACCES","EINVAL","EISDIR"].includes(
      (error as NodeJS.ErrnoException)?.code??"")){
      throw error;
    }
  }
}
async function createFileExclusive(filename:string,contents:Buffer){
  const h=await open(filename,"wx",0o600);
  try{await h.writeFile(contents);await h.sync();}
  finally{await h.close();}
}

/** No production path argument exists. The archive remains until explicit test teardown. */
export async function createSyntheticEncryptedArchive(){
  const root=await mkdtemp(path.join(tmpdir(),PREFIX));
  const archiveId=path.basename(root);
  if(rootOf(archiveId).toLowerCase()!==path.resolve(root).toLowerCase()){
    throw Error("Refusing encrypted scratch archive outside TEMP");
  }
  const records=path.join(root,"records");
  await mkdir(records,{mode:0o700});
  await createFileExclusive(path.join(root,MARKER_NAME),Buffer.from(MARKER_TEXT));
  return {
    archiveId,
    async addSyntheticRecord(input:{key:Buffer;slug:string;body:string}){
      const key=key32(input.key);
      if(typeof input.slug!=="string"||
         !SYNTHETIC_SLUG.test(input.slug)||input.slug.length>120||
         typeof input.body!=="string"||
         !input.body.startsWith(SYNTHETIC_BODY_PREFIX)||
         Buffer.byteLength(input.body,"utf8")>MAX_NOTE_BYTES){
        throw Error("Only bounded synthetic sample notes may be encrypted");
      }
      await verifyArchive(archiveId);
      // A partially written or unexpected record must halt new writes,
      // never get quietly ignored, overwritten, or deleted.
      const existing=await inspectSyntheticEncryptedArchive(archiveId,key);
      if(!existing.inspectionComplete||existing.needsManualReview||
         existing.scannedEntries>=MAX_RECORDS){
        throw Error("Encrypted synthetic archive requires manual review or is full");
      }
      const id=randomUUID();
      const payload=Buffer.from(JSON.stringify({
        version:FORMAT,slug:input.slug,body:input.body,
        createdAt:new Date().toISOString(),
      }),"utf8");
      const nonce=randomBytes(12);
      const cipher=createCipheriv("aes-256-gcm",key,nonce,{authTagLength:16});
      cipher.setAAD(aadFor(id));
      const sealed=Buffer.concat([cipher.update(payload),cipher.final()]);
      const envelope=Buffer.from(JSON.stringify({
        version:1,id,syntheticOnly:true,algorithm:"aes-256-gcm",
        nonce:nonce.toString("base64"),
        tag:cipher.getAuthTag().toString("base64"),
        ciphertext:sealed.toString("base64"),
      }),"utf8");
      if(envelope.byteLength>MAX_FILE_BYTES){
        throw Error("Encrypted synthetic backup size exceeds limits");
      }
      await createFileExclusive(path.join(records,keyName(id)),envelope);
      await directorySyncBestEffort(records);
      return {id,syntheticOnly:true,automaticRestoreEnabled:false};
    },
  };
}

/** No path or plaintext is returned unless caller supplies the separate key. */
export async function readSyntheticEncryptedRecord(archiveId:string,id:string,key:Buffer){
  const safeKey=key32(key);
  keyName(id);
  const records=await verifyArchive(archiveId);
  const value=await verifyEntry(records,id,safeKey);
  return {...value,syntheticOnly:true,automaticRestoreEnabled:false};
}

/** Bounded, read-only, redacted health report; GCM tag authentication is mandatory. */
export async function inspectSyntheticEncryptedArchive(
  archiveId:string,key:Buffer,
):Promise<SyntheticEncryptedArchiveReport>{
  const safeKey=key32(key);
  const records=await verifyArchive(archiveId);
  let scannedEntries=0,verifiedRecords=0,invalidRecords=0,unexpectedEntries=0;
  const dir=await opendir(records);
  for await(const entry of dir){
    scannedEntries++;
    if(scannedEntries>MAX_RECORDS){
      return {
        syntheticOnly:true,readOnly:true,inspectionComplete:false,
        scannedEntries,verifiedRecords:null,invalidRecords:null,
        unexpectedEntries:null,needsManualReview:true,
        automaticRestoreEnabled:false,
      };
    }
    const match=RECORD_NAME.exec(entry.name);
    if(!entry.isFile()||entry.isSymbolicLink()||!match){
      unexpectedEntries++;continue;
    }
    try{await verifyEntry(records,match[1],safeKey);verifiedRecords++;}
    catch{invalidRecords++;}
  }
  return {
    syntheticOnly:true,readOnly:true,inspectionComplete:true,
    scannedEntries,verifiedRecords,invalidRecords,unexpectedEntries,
    needsManualReview:invalidRecords+unexpectedEntries>0,
    automaticRestoreEnabled:false,
  };
}
